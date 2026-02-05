/**
 * Voucher Routes - ShelterOS Integration
 *
 * Endpoints:
 * POST   /api/v1/vouchers                 → issueVoucher
 * GET    /api/v1/vouchers/:id             → getVoucher
 * GET    /api/v1/vouchers/:id/status      → getVoucherStatus
 * POST   /api/v1/vouchers/:id/cancel      → cancelVoucher
 * GET    /api/v1/vouchers                 → listVouchers (with filters)
 * POST   /api/v1/vouchers/validate        → validateVoucher (pre-procedure check)
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { EventStore } from '../../event-store';
import { GrantService } from '../../application/grant-service';
import { IdempotencyService } from '../../application/idempotency-service';
import { requirePermission, requireClientType, PERMISSIONS } from '../middleware/auth';
import {
  ApiResponse,
  PaginatedResponse,
  IssueVoucherRequest,
  VoucherResponse,
  VoucherStatusResponse,
  ValidateVoucherRequest,
  ValidateVoucherResponse,
} from '../types';
import { GrantId, VoucherId, MoneyCents } from '../../domain-types';

export function createVoucherRouter(
  pool: Pool,
  store: EventStore,
  idempotency: IdempotencyService
): Router {
  const router = Router();
  const grantService = new GrantService(pool, store, idempotency);

  /**
   * POST /api/v1/vouchers - Issue a new voucher
   * Required: GRANTEE or ADMIN
   */
  router.post(
    '/',
    requirePermission(PERMISSIONS.VOUCHER_ISSUE),
    requireClientType('GRANTEE', 'ADMIN'),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const body = req.body as IssueVoucherRequest;
        const credentials = req.credentials!;

        // Validate required fields
        if (!body.grantId || !body.countyCode || !body.maxReimbursementCents) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'grantId, countyCode, and maxReimbursementCents are required',
            },
          };
          res.status(400).json(response);
          return;
        }

        // LIRP vouchers require income verification artifact
        if (body.isLIRP && !body.incomeVerificationArtifactId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'LIRP_REQUIRES_INCOME_VERIFICATION',
              message: 'LIRP vouchers require incomeVerificationArtifactId',
            },
          };
          res.status(400).json(response);
          return;
        }

        // Generate idempotency key from request content
        const idempotencyKey = req.headers['idempotency-key'] as string ||
          crypto.createHash('sha256')
            .update(JSON.stringify({
              grantId: body.grantId,
              countyCode: body.countyCode,
              recipientName: body.recipientName,
              animalType: body.animalType,
              procedureType: body.procedureType,
            }))
            .digest('hex');

        const voucherId = (body.voucherId || crypto.randomUUID()) as VoucherId;

        const result = await grantService.issueVoucherOnline({
          idempotencyKey,
          grantId: body.grantId as GrantId,
          voucherId,
          maxReimbursementCents: BigInt(body.maxReimbursementCents) as MoneyCents,
          isLIRP: body.isLIRP,
          recipientType: body.recipientType,
          recipientName: body.recipientName,
          animalType: body.animalType,
          procedureType: body.procedureType,
          expiresAt: new Date(body.expiresAt),
          coPayRequired: false, // LIRP forbids co-pay
          actorId: credentials.clientId,
          actorType: credentials.clientType === 'ADMIN' ? 'ADMIN' : 'APPLICANT',
          correlationId: crypto.randomUUID(),
        });

        // Fetch the created voucher
        const voucherRow = await pool.query(
          `SELECT * FROM vouchers_projection WHERE voucher_id = $1`,
          [voucherId]
        );

        const voucher = voucherRow.rows[0];
        const response: ApiResponse<VoucherResponse> = {
          success: true,
          data: {
            voucherId: voucher.voucher_id,
            voucherCode: result.voucherCode,
            grantId: body.grantId,
            countyCode: body.countyCode,
            status: voucher.status,
            maxReimbursementCents: voucher.max_reimbursement_cents.toString(),
            isLIRP: voucher.is_lirp,
            recipientType: body.recipientType,
            recipientName: body.recipientName,
            animalType: body.animalType,
            procedureType: body.procedureType,
            issuedAt: voucher.issued_at?.toISOString() || null,
            expiresAt: voucher.expires_at.toISOString(),
            redeemedAt: null,
            expiredAt: null,
            voidedAt: null,
          },
        };

        res.status(201).json(response);
      } catch (error) {
        const err = error as Error;
        const errorCode = err.message.includes('INSUFFICIENT_FUNDS') ? 'INSUFFICIENT_FUNDS' :
                         err.message.includes('GRANT_PERIOD_ENDED') ? 'GRANT_PERIOD_ENDED' :
                         err.message.includes('LIRP_COPAY_FORBIDDEN') ? 'LIRP_COPAY_FORBIDDEN' :
                         'VOUCHER_ISSUE_FAILED';

        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: errorCode,
            message: err.message,
          },
        };
        res.status(400).json(response);
      }
    }
  );

  /**
   * GET /api/v1/vouchers/:id - Get voucher details
   */
  router.get(
    '/:id',
    requirePermission(PERMISSIONS.VOUCHER_READ),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const voucherId = req.params.id;

        const result = await pool.query(
          `SELECT * FROM vouchers_projection WHERE voucher_id = $1`,
          [voucherId]
        );

        if (result.rows.length === 0) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'VOUCHER_NOT_FOUND',
              message: `Voucher ${voucherId} not found`,
            },
          };
          res.status(404).json(response);
          return;
        }

        const v = result.rows[0];
        const response: ApiResponse<VoucherResponse> = {
          success: true,
          data: {
            voucherId: v.voucher_id,
            voucherCode: v.voucher_code,
            grantId: v.grant_id,
            countyCode: v.county_code,
            status: v.status,
            maxReimbursementCents: v.max_reimbursement_cents.toString(),
            isLIRP: v.is_lirp,
            recipientType: '', // Not stored in projection
            recipientName: '', // Not stored in projection
            animalType: '',
            procedureType: '',
            issuedAt: v.issued_at?.toISOString() || null,
            expiresAt: v.expires_at.toISOString(),
            redeemedAt: v.redeemed_at?.toISOString() || null,
            expiredAt: v.expired_at?.toISOString() || null,
            voidedAt: v.voided_at?.toISOString() || null,
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'VOUCHER_FETCH_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  /**
   * GET /api/v1/vouchers/:id/status - Get voucher status (lightweight)
   */
  router.get(
    '/:id/status',
    requirePermission(PERMISSIONS.VOUCHER_READ),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const voucherId = req.params.id;

        const result = await pool.query(
          `SELECT
            v.voucher_id,
            v.voucher_code,
            v.status,
            v.max_reimbursement_cents,
            v.is_lirp,
            v.expires_at,
            v.redeemed_at,
            c.clinic_id as redeemed_by_clinic_id,
            c.claim_id
          FROM vouchers_projection v
          LEFT JOIN claims_projection c ON c.voucher_id = v.voucher_id
          WHERE v.voucher_id = $1`,
          [voucherId]
        );

        if (result.rows.length === 0) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'VOUCHER_NOT_FOUND',
              message: `Voucher ${voucherId} not found`,
            },
          };
          res.status(404).json(response);
          return;
        }

        const v = result.rows[0];
        const isValid = v.status === 'ISSUED' && new Date(v.expires_at) > new Date();

        const response: ApiResponse<VoucherStatusResponse> = {
          success: true,
          data: {
            voucherId: v.voucher_id,
            voucherCode: v.voucher_code,
            status: v.status,
            isValid,
            canRedeem: isValid,
            maxReimbursementCents: v.max_reimbursement_cents.toString(),
            isLIRP: v.is_lirp,
            expiresAt: v.expires_at.toISOString(),
            redeemedAt: v.redeemed_at?.toISOString() || null,
            redeemedByClinicId: v.redeemed_by_clinic_id || null,
            claimId: v.claim_id || null,
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'VOUCHER_STATUS_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  /**
   * POST /api/v1/vouchers/:id/cancel - Cancel/void a voucher
   */
  router.post(
    '/:id/cancel',
    requirePermission(PERMISSIONS.VOUCHER_CANCEL),
    requireClientType('GRANTEE', 'ADMIN'),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const voucherId = req.params.id as VoucherId;
        const { reason } = req.body as { reason?: string };
        const credentials = req.credentials!;

        // Check voucher exists and is voidable
        const voucherResult = await pool.query(
          `SELECT status FROM vouchers_projection WHERE voucher_id = $1`,
          [voucherId]
        );

        if (voucherResult.rows.length === 0) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'VOUCHER_NOT_FOUND',
              message: `Voucher ${voucherId} not found`,
            },
          };
          res.status(404).json(response);
          return;
        }

        const currentStatus = voucherResult.rows[0].status;
        if (currentStatus !== 'ISSUED' && currentStatus !== 'TENTATIVE') {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'VOUCHER_NOT_VOIDABLE',
              message: `Voucher in status ${currentStatus} cannot be voided`,
            },
          };
          res.status(400).json(response);
          return;
        }

        // Emit VOUCHER_VOIDED event
        const eventId = EventStore.newEventId();
        const grantCycleId = credentials.grantCycleId;

        await store.append({
          eventId,
          aggregateType: 'VOUCHER',
          aggregateId: voucherId,
          eventType: 'VOUCHER_VOIDED',
          eventData: {
            reason: reason || 'Cancelled by grantee',
          },
          occurredAt: new Date(),
          grantCycleId,
          correlationId: crypto.randomUUID(),
          causationId: null,
          actorId: credentials.clientId as `${string}-${string}-${string}-${string}-${string}`,
          actorType: credentials.clientType === 'ADMIN' ? 'ADMIN' : 'APPLICANT',
        });

        // Update projection
        await pool.query(
          `UPDATE vouchers_projection
           SET status = 'VOIDED', voided_at = clock_timestamp()
           WHERE voucher_id = $1`,
          [voucherId]
        );

        const response: ApiResponse<{ voucherId: string; status: string }> = {
          success: true,
          data: {
            voucherId,
            status: 'VOIDED',
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'VOUCHER_CANCEL_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  /**
   * GET /api/v1/vouchers - List vouchers with filters
   */
  router.get(
    '/',
    requirePermission(PERMISSIONS.VOUCHER_READ),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const credentials = req.credentials!;
        const {
          grantCycleId,
          grantId,
          countyCode,
          status,
          offset = '0',
          limit = '50',
        } = req.query;

        const queryParams: unknown[] = [];
        const conditions: string[] = [];
        let paramIndex = 1;

        // Grantees can only see their grant cycle's vouchers
        if (credentials.clientType === 'GRANTEE') {
          conditions.push(`v.grant_id IN (
            SELECT grant_id FROM grant_balances_projection WHERE grant_cycle_id = $${paramIndex}
          )`);
          queryParams.push(credentials.grantCycleId);
          paramIndex++;
        }

        if (grantCycleId) {
          conditions.push(`v.grant_id IN (
            SELECT grant_id FROM grant_balances_projection WHERE grant_cycle_id = $${paramIndex}
          )`);
          queryParams.push(grantCycleId);
          paramIndex++;
        }

        if (grantId) {
          conditions.push(`v.grant_id = $${paramIndex}`);
          queryParams.push(grantId);
          paramIndex++;
        }

        if (countyCode) {
          conditions.push(`v.county_code = $${paramIndex}`);
          queryParams.push(countyCode);
          paramIndex++;
        }

        if (status) {
          conditions.push(`v.status = $${paramIndex}`);
          queryParams.push(status);
          paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Get total count
        const countResult = await pool.query(
          `SELECT COUNT(*) as total FROM vouchers_projection v ${whereClause}`,
          queryParams
        );
        const total = parseInt(countResult.rows[0].total);

        // Get paginated results
        const offsetNum = parseInt(offset as string);
        const limitNum = Math.min(parseInt(limit as string), 100);

        queryParams.push(limitNum, offsetNum);

        const result = await pool.query(
          `SELECT * FROM vouchers_projection v
           ${whereClause}
           ORDER BY issued_at DESC NULLS LAST
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          queryParams
        );

        const items: VoucherResponse[] = result.rows.map(v => ({
          voucherId: v.voucher_id,
          voucherCode: v.voucher_code,
          grantId: v.grant_id,
          countyCode: v.county_code,
          status: v.status,
          maxReimbursementCents: v.max_reimbursement_cents.toString(),
          isLIRP: v.is_lirp,
          recipientType: '',
          recipientName: '',
          animalType: '',
          procedureType: '',
          issuedAt: v.issued_at?.toISOString() || null,
          expiresAt: v.expires_at.toISOString(),
          redeemedAt: v.redeemed_at?.toISOString() || null,
          expiredAt: v.expired_at?.toISOString() || null,
          voidedAt: v.voided_at?.toISOString() || null,
        }));

        const response: ApiResponse<PaginatedResponse<VoucherResponse>> = {
          success: true,
          data: {
            items,
            pagination: {
              offset: offsetNum,
              limit: limitNum,
              total,
              hasMore: offsetNum + items.length < total,
            },
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'VOUCHER_LIST_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  /**
   * POST /api/v1/vouchers/validate - Validate voucher before procedure
   * Used by VetOS to check if voucher is valid before submitting claim
   */
  router.post(
    '/validate',
    requirePermission(PERMISSIONS.VOUCHER_VALIDATE),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const body = req.body as ValidateVoucherRequest;
        const errors: string[] = [];

        const result = await pool.query(
          `SELECT * FROM vouchers_projection WHERE voucher_code = $1`,
          [body.voucherCode]
        );

        if (result.rows.length === 0) {
          const response: ApiResponse<ValidateVoucherResponse> = {
            success: true,
            data: {
              valid: false,
              voucherId: '',
              maxReimbursementCents: '0',
              isLIRP: false,
              coPayForbidden: false,
              expiresAt: '',
              errors: ['VOUCHER_NOT_FOUND'],
            },
          };
          res.json(response);
          return;
        }

        const v = result.rows[0];

        // Check status
        if (v.status !== 'ISSUED') {
          errors.push(`VOUCHER_STATUS_INVALID: ${v.status}`);
        }

        // Check expiry
        if (new Date(v.expires_at) < new Date()) {
          errors.push('VOUCHER_EXPIRED');
        }

        // Check if already redeemed
        if (v.redeemed_at) {
          errors.push('VOUCHER_ALREADY_REDEEMED');
        }

        const response: ApiResponse<ValidateVoucherResponse> = {
          success: true,
          data: {
            valid: errors.length === 0,
            voucherId: v.voucher_id,
            maxReimbursementCents: v.max_reimbursement_cents.toString(),
            isLIRP: v.is_lirp,
            coPayForbidden: v.is_lirp, // LIRP vouchers forbid co-pay
            expiresAt: v.expires_at.toISOString(),
            errors,
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'VOUCHER_VALIDATE_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  return router;
}
