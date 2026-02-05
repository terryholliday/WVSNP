/**
 * Claim Routes - VetOS Integration
 *
 * Endpoints:
 * POST   /api/v1/claims              → submitClaim
 * GET    /api/v1/claims/:id          → getClaim
 * GET    /api/v1/claims/:id/status   → getClaimStatus
 * GET    /api/v1/claims              → listClaims (with filters)
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { EventStore } from '../../event-store';
import { ClaimService } from '../../application/claim-service';
import { IdempotencyService } from '../../application/idempotency-service';
import { requirePermission, requireClientType, requireResourceAccess, PERMISSIONS } from '../middleware/auth';
import {
  ApiResponse,
  PaginatedResponse,
  SubmitClaimRequest,
  ClaimResponse,
  ClaimStatusResponse,
} from '../types';
import { ClaimId, VoucherId, ClinicId, MoneyCents } from '../../domain-types';

export function createClaimRouter(
  pool: Pool,
  store: EventStore,
  idempotency: IdempotencyService
): Router {
  const router = Router();
  const claimService = new ClaimService(pool, store, idempotency);

  /**
   * POST /api/v1/claims - Submit a new claim
   * Required: CLINIC or ADMIN
   */
  router.post(
    '/',
    requirePermission(PERMISSIONS.CLAIM_SUBMIT),
    requireClientType('CLINIC', 'ADMIN'),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const body = req.body as SubmitClaimRequest;
        const credentials = req.credentials!;

        // Clinic can only submit claims for themselves
        if (credentials.clientType === 'CLINIC' && body.clinicId !== credentials.clientId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'CLINIC_MISMATCH',
              message: 'Clinics can only submit claims for themselves',
            },
          };
          res.status(403).json(response);
          return;
        }

        // Validate required fields
        if (!body.voucherId || !body.clinicId || !body.procedureCode || !body.dateOfService) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'voucherId, clinicId, procedureCode, and dateOfService are required',
            },
          };
          res.status(400).json(response);
          return;
        }

        // Validate artifacts
        if (!body.artifacts?.procedureReportId || !body.artifacts?.clinicInvoiceId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'MISSING_ARTIFACTS',
              message: 'procedureReportId and clinicInvoiceId are required',
            },
          };
          res.status(400).json(response);
          return;
        }

        // Rabies vaccine requires certificate
        if (body.rabiesVaccineIncluded && !body.artifacts.rabiesCertificateId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'MISSING_RABIES_CERTIFICATE',
              message: 'rabiesCertificateId is required when rabiesVaccineIncluded is true',
            },
          };
          res.status(400).json(response);
          return;
        }

        // Generate idempotency key
        const idempotencyKey = req.headers['idempotency-key'] as string ||
          crypto.createHash('sha256')
            .update(JSON.stringify({
              voucherId: body.voucherId,
              clinicId: body.clinicId,
              procedureCode: body.procedureCode,
              dateOfService: body.dateOfService,
            }))
            .digest('hex');

        const result = await claimService.submitClaim({
          idempotencyKey,
          claimId: body.claimId as ClaimId | undefined,
          grantCycleId: credentials.grantCycleId,
          voucherId: body.voucherId as VoucherId,
          clinicId: body.clinicId as ClinicId,
          procedureCode: body.procedureCode,
          dateOfService: new Date(body.dateOfService),
          submittedAmountCents: BigInt(body.submittedAmountCents) as MoneyCents,
          coPayCollectedCents: body.coPayCollectedCents ? BigInt(body.coPayCollectedCents) as MoneyCents : undefined,
          rabiesVaccineIncluded: body.rabiesVaccineIncluded,
          artifacts: body.artifacts,
          actorId: credentials.clientId,
          actorType: credentials.clientType === 'ADMIN' ? 'ADMIN' : 'APPLICANT',
          correlationId: crypto.randomUUID(),
        });

        // Fetch the created claim
        const claimRow = await pool.query(
          `SELECT * FROM claims_projection WHERE claim_id = $1`,
          [result.claimId]
        );

        const claim = claimRow.rows[0];
        const response: ApiResponse<ClaimResponse> = {
          success: true,
          data: {
            claimId: claim.claim_id,
            voucherId: claim.voucher_id,
            clinicId: claim.clinic_id,
            grantCycleId: claim.grant_cycle_id,
            procedureCode: claim.procedure_code,
            dateOfService: claim.date_of_service.toISOString().split('T')[0],
            status: claim.status,
            submittedAmountCents: claim.submitted_amount_cents.toString(),
            approvedAmountCents: claim.approved_amount_cents?.toString() || null,
            decisionBasis: claim.decision_basis,
            submittedAt: claim.submitted_at.toISOString(),
            approvedAt: claim.approved_at?.toISOString() || null,
            deniedAt: claim.denied_at?.toISOString() || null,
            invoicedAt: claim.invoiced_at?.toISOString() || null,
            invoiceId: claim.invoice_id || null,
          },
        };

        res.status(201).json(response);
      } catch (error) {
        const err = error as Error;
        const errorCode =
          err.message.includes('LIRP_COPAY_FORBIDDEN') ? 'LIRP_COPAY_FORBIDDEN' :
          err.message.includes('VOUCHER_NOT_FOUND') ? 'VOUCHER_NOT_FOUND' :
          err.message.includes('VOUCHER_NOT_ISSUED') ? 'VOUCHER_NOT_ISSUED' :
          err.message.includes('VOUCHER_EXPIRED') ? 'VOUCHER_EXPIRED' :
          err.message.includes('CLINIC_NOT_ACTIVE') ? 'CLINIC_NOT_ACTIVE' :
          err.message.includes('CLINIC_LICENSE_INVALID') ? 'CLINIC_LICENSE_INVALID' :
          err.message.includes('DATE_OUTSIDE_VOUCHER_VALIDITY') ? 'DATE_OUTSIDE_VOUCHER_VALIDITY' :
          err.message.includes('DATE_OUTSIDE_GRANT_PERIOD') ? 'DATE_OUTSIDE_GRANT_PERIOD' :
          err.message.includes('PAST_SUBMISSION_DEADLINE') ? 'PAST_SUBMISSION_DEADLINE' :
          err.message.includes('DUPLICATE_CLAIM') ? 'DUPLICATE_CLAIM' :
          'CLAIM_SUBMIT_FAILED';

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
   * GET /api/v1/claims/:id - Get claim details
   */
  router.get(
    '/:id',
    requirePermission(PERMISSIONS.CLAIM_READ),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const claimId = req.params.id;
        const credentials = req.credentials!;

        const result = await pool.query(
          `SELECT * FROM claims_projection WHERE claim_id = $1`,
          [claimId]
        );

        if (result.rows.length === 0) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'CLAIM_NOT_FOUND',
              message: `Claim ${claimId} not found`,
            },
          };
          res.status(404).json(response);
          return;
        }

        const claim = result.rows[0];

        // Clinics can only see their own claims
        if (credentials.clientType === 'CLINIC' && claim.clinic_id !== credentials.clientId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'RESOURCE_ACCESS_DENIED',
              message: 'You do not have access to this claim',
            },
          };
          res.status(403).json(response);
          return;
        }

        const response: ApiResponse<ClaimResponse> = {
          success: true,
          data: {
            claimId: claim.claim_id,
            voucherId: claim.voucher_id,
            clinicId: claim.clinic_id,
            grantCycleId: claim.grant_cycle_id,
            procedureCode: claim.procedure_code,
            dateOfService: claim.date_of_service.toISOString().split('T')[0],
            status: claim.status,
            submittedAmountCents: claim.submitted_amount_cents.toString(),
            approvedAmountCents: claim.approved_amount_cents?.toString() || null,
            decisionBasis: claim.decision_basis,
            submittedAt: claim.submitted_at.toISOString(),
            approvedAt: claim.approved_at?.toISOString() || null,
            deniedAt: claim.denied_at?.toISOString() || null,
            invoicedAt: claim.invoiced_at?.toISOString() || null,
            invoiceId: claim.invoice_id || null,
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'CLAIM_FETCH_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  /**
   * GET /api/v1/claims/:id/status - Get claim status (lightweight)
   */
  router.get(
    '/:id/status',
    requirePermission(PERMISSIONS.CLAIM_READ),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const claimId = req.params.id;
        const credentials = req.credentials!;

        const result = await pool.query(
          `SELECT
            c.claim_id,
            c.clinic_id,
            c.status,
            c.approved_amount_cents,
            c.decision_basis,
            c.invoice_id,
            i.status as invoice_status,
            COALESCE(SUM(p.amount_cents), 0) as paid_amount_cents,
            i.total_amount_cents as invoice_total_cents
          FROM claims_projection c
          LEFT JOIN invoices_projection i ON c.invoice_id = i.invoice_id
          LEFT JOIN payments_projection p ON i.invoice_id = p.invoice_id
          WHERE c.claim_id = $1
          GROUP BY c.claim_id, c.clinic_id, c.status, c.approved_amount_cents,
                   c.decision_basis, c.invoice_id, i.status, i.total_amount_cents`,
          [claimId]
        );

        if (result.rows.length === 0) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'CLAIM_NOT_FOUND',
              message: `Claim ${claimId} not found`,
            },
          };
          res.status(404).json(response);
          return;
        }

        const row = result.rows[0];

        // Clinics can only see their own claims
        if (credentials.clientType === 'CLINIC' && row.clinic_id !== credentials.clientId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'RESOURCE_ACCESS_DENIED',
              message: 'You do not have access to this claim',
            },
          };
          res.status(403).json(response);
          return;
        }

        // Derive payment status
        let paymentStatus: 'PENDING' | 'PAID' | 'PARTIALLY_PAID' | null = null;
        if (row.invoice_id) {
          const paidCents = BigInt(row.paid_amount_cents || 0);
          const totalCents = BigInt(row.invoice_total_cents || 0);
          if (paidCents >= totalCents && totalCents > 0n) {
            paymentStatus = 'PAID';
          } else if (paidCents > 0n) {
            paymentStatus = 'PARTIALLY_PAID';
          } else {
            paymentStatus = 'PENDING';
          }
        }

        const response: ApiResponse<ClaimStatusResponse> = {
          success: true,
          data: {
            claimId: row.claim_id,
            status: row.status,
            approvedAmountCents: row.approved_amount_cents?.toString() || null,
            reason: row.decision_basis?.reason || null,
            invoiceId: row.invoice_id || null,
            paymentStatus,
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'CLAIM_STATUS_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  /**
   * GET /api/v1/claims - List claims with filters
   */
  router.get(
    '/',
    requirePermission(PERMISSIONS.CLAIM_READ),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const credentials = req.credentials!;
        const {
          clinicId,
          voucherId,
          status,
          grantCycleId,
          dateFrom,
          dateTo,
          offset = '0',
          limit = '50',
        } = req.query;

        const queryParams: unknown[] = [];
        const conditions: string[] = [];
        let paramIndex = 1;

        // Clinics can only see their own claims
        if (credentials.clientType === 'CLINIC') {
          conditions.push(`c.clinic_id = $${paramIndex}`);
          queryParams.push(credentials.clientId);
          paramIndex++;
        } else if (clinicId) {
          conditions.push(`c.clinic_id = $${paramIndex}`);
          queryParams.push(clinicId);
          paramIndex++;
        }

        if (voucherId) {
          conditions.push(`c.voucher_id = $${paramIndex}`);
          queryParams.push(voucherId);
          paramIndex++;
        }

        if (status) {
          conditions.push(`c.status = $${paramIndex}`);
          queryParams.push(status);
          paramIndex++;
        }

        if (grantCycleId) {
          conditions.push(`c.grant_cycle_id = $${paramIndex}`);
          queryParams.push(grantCycleId);
          paramIndex++;
        }

        if (dateFrom) {
          conditions.push(`c.date_of_service >= $${paramIndex}`);
          queryParams.push(dateFrom);
          paramIndex++;
        }

        if (dateTo) {
          conditions.push(`c.date_of_service <= $${paramIndex}`);
          queryParams.push(dateTo);
          paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Get total count
        const countResult = await pool.query(
          `SELECT COUNT(*) as total FROM claims_projection c ${whereClause}`,
          queryParams
        );
        const total = parseInt(countResult.rows[0].total);

        // Get paginated results
        const offsetNum = parseInt(offset as string);
        const limitNum = Math.min(parseInt(limit as string), 100);

        queryParams.push(limitNum, offsetNum);

        const result = await pool.query(
          `SELECT * FROM claims_projection c
           ${whereClause}
           ORDER BY submitted_at DESC
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          queryParams
        );

        const items: ClaimResponse[] = result.rows.map(claim => ({
          claimId: claim.claim_id,
          voucherId: claim.voucher_id,
          clinicId: claim.clinic_id,
          grantCycleId: claim.grant_cycle_id,
          procedureCode: claim.procedure_code,
          dateOfService: claim.date_of_service.toISOString().split('T')[0],
          status: claim.status,
          submittedAmountCents: claim.submitted_amount_cents.toString(),
          approvedAmountCents: claim.approved_amount_cents?.toString() || null,
          decisionBasis: claim.decision_basis,
          submittedAt: claim.submitted_at.toISOString(),
          approvedAt: claim.approved_at?.toISOString() || null,
          deniedAt: claim.denied_at?.toISOString() || null,
          invoicedAt: claim.invoiced_at?.toISOString() || null,
          invoiceId: claim.invoice_id || null,
        }));

        const response: ApiResponse<PaginatedResponse<ClaimResponse>> = {
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
            code: 'CLAIM_LIST_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  return router;
}
