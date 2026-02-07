import { Router } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { EventStore } from '../../event-store';
import { IdempotencyService } from '../../application/idempotency-service';
import { GrantService } from '../../application/grant-service';
import { validate, validateQuery } from '../middleware/validator';
import { issueVoucherSchema, issueTentativeVoucherSchema, confirmTentativeVoucherSchema, listVouchersQuerySchema } from '../schemas/grantee-schemas';
import { ApiError } from '../middleware/auth';
import { Money } from '../../domain-types';

export function createGranteeRoutes(pool: Pool, eventStore: EventStore, idempotency: IdempotencyService) {
  const router = Router();
  const grantService = new GrantService(pool, eventStore, idempotency);

  // Issue Voucher
  router.post('/vouchers', validate(issueVoucherSchema), async (req, res, next) => {
    try {
      const granteeId = req.auth!.entityId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;
      
      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const voucherId = crypto.randomUUID() as any; // VoucherId type
      const result = await grantService.issueVoucherOnline({
        idempotencyKey,
        grantId: req.body.grantId as any,
        voucherId,
        maxReimbursementCents: Money.fromBigInt(BigInt(req.body.maxReimbursementCents)),
        isLIRP: req.body.isLIRP,
        recipientType: 'SHELTER',
        recipientName: granteeId,
        animalType: req.body.procedureType.includes('DOG') ? 'DOG' : 'CAT',
        procedureType: req.body.procedureType,
        expiresAt: new Date(req.body.expiresAt),
        coPayRequired: false,
        coPayAmountCents: undefined,
        actorId: granteeId,
        actorType: 'APPLICANT',
        correlationId: req.correlationId!
      });

      res.status(201).json({
        voucherId,
        voucherCode: result.voucherCode,
        status: 'ISSUED',
        issuedAt: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // Issue Tentative Voucher
  router.post('/vouchers/tentative', validate(issueTentativeVoucherSchema), async (req, res, next) => {
    try {
      const granteeId = req.auth!.entityId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;
      
      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const voucherId = crypto.randomUUID() as any; // VoucherId type
      const result = await grantService.issueVoucherOnline({
        idempotencyKey,
        grantId: req.body.grantId as any,
        voucherId,
        maxReimbursementCents: Money.fromBigInt(BigInt(req.body.maxReimbursementCents)),
        isLIRP: false,
        recipientType: 'SHELTER',
        recipientName: granteeId,
        animalType: req.body.procedureType.includes('DOG') ? 'DOG' : 'CAT',
        procedureType: req.body.procedureType,
        expiresAt: new Date(req.body.tentativeExpiresAt),
        coPayRequired: false,
        coPayAmountCents: undefined,
        actorId: granteeId,
        actorType: 'APPLICANT',
        correlationId: req.correlationId!
      });

      res.status(201).json({
        voucherId,
        voucherCode: result.voucherCode,
        status: 'TENTATIVE',
        tentativeExpiresAt: req.body.tentativeExpiresAt
      });
    } catch (error) {
      next(error);
    }
  });

  // Confirm Tentative Voucher
  router.post('/vouchers/:voucherId/confirm', validate(confirmTentativeVoucherSchema), async (req, res, next) => {
    try {
      const granteeId = req.auth!.entityId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;
      
      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      // First fetch the voucher to get grantId
      const voucherRow = await pool.query(
        'SELECT grant_id FROM vouchers_projection WHERE voucher_id = $1',
        [req.params.voucherId]
      );
      if (voucherRow.rows.length === 0) {
        throw new ApiError(404, 'VOUCHER_NOT_FOUND', 'Voucher not found');
      }

      const result = await grantService.confirmTentativeVoucher({
        idempotencyKey,
        voucherId: req.params.voucherId as any,
        grantId: voucherRow.rows[0].grant_id as any,
        confirmedAt: new Date(),
        actorId: granteeId,
        actorType: 'APPLICANT',
        correlationId: req.correlationId!
      });

      res.json({
        voucherId: req.params.voucherId,
        status: 'ISSUED',
        confirmedAt: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // List Vouchers
  router.get('/vouchers', validateQuery(listVouchersQuerySchema), async (req, res, next) => {
    try {
      const granteeId = req.auth!.entityId!;
      const { status, countyCode, limit } = req.query as any;

      let query = `
        SELECT v.voucher_id, v.voucher_code, v.status, v.issued_at, v.redeemed_at, v.expired_at
        FROM vouchers_projection v
        JOIN grants_projection g ON g.grant_id = v.grant_id
        WHERE g.grantee_id = $1
      `;
      const params: any[] = [granteeId];
      let paramIndex = 2;

      if (status) {
        query += ` AND v.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (countyCode) {
        query += ` AND v.county_code = $${paramIndex}`;
        params.push(countyCode);
        paramIndex++;
      }

      query += ` ORDER BY v.issued_at DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await pool.query(query, params);

      res.json({
        vouchers: result.rows.map(row => ({
          voucherId: row.voucher_id,
          voucherCode: row.voucher_code,
          status: row.status,
          issuedAt: row.issued_at?.toISOString(),
          redeemedAt: row.redeemed_at?.toISOString(),
          expiredAt: row.expired_at?.toISOString()
        })),
        hasMore: result.rows.length === limit
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
