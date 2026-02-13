import { Router } from 'express';
import { Pool } from 'pg';
import { EventStore } from '../../event-store';
import { IdempotencyService } from '../../application/idempotency-service';
import { ClaimService } from '../../application/claim-service';
import { validate, validateQuery } from '../middleware/validator';
import { submitClaimSchema, listClaimsQuerySchema, listInvoicesQuerySchema } from '../schemas/clinic-schemas';
import { ApiError } from '../middleware/auth';
import { Money } from '../../domain-types';

export function createClinicRoutes(pool: Pool, eventStore: EventStore, idempotency: IdempotencyService) {
  const router = Router();
  const claimService = new ClaimService(pool, eventStore, idempotency);

  // Submit Claim
  router.post('/claims', validate(submitClaimSchema), async (req, res, next) => {
    try {
      const clinicId = req.auth!.entityId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;
      
      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      // Resolve grantCycleId from voucher (not from user input)
      const voucherLookup = await pool.query(
        'SELECT v.grant_id, gb.grant_cycle_id FROM vouchers_projection v JOIN grant_balances_projection gb ON gb.grant_id = v.grant_id WHERE v.voucher_id = $1 LIMIT 1',
        [req.body.voucherId]
      );
      if (voucherLookup.rows.length === 0) {
        throw new ApiError(404, 'VOUCHER_NOT_FOUND', 'Voucher not found');
      }
      const grantCycleId = voucherLookup.rows[0].grant_cycle_id;

      const result = await claimService.submitClaim({
        idempotencyKey,
        claimId: undefined,
        grantCycleId,
        clinicId,
        voucherId: req.body.voucherId,
        procedureCode: req.body.procedureCode,
        dateOfService: new Date(req.body.dateOfService),
        submittedAmountCents: Money.fromBigInt(BigInt(req.body.submittedAmountCents)),
        coPayCollectedCents: req.body.coPayCollectedCents ? Money.fromBigInt(BigInt(req.body.coPayCollectedCents)) : undefined,
        artifacts: req.body.artifacts,
        correlationId: req.correlationId!,
        actorId: clinicId,
        actorType: 'APPLICANT'
      });

      res.status(201).json({
        claimId: result.claimId,
        status: 'SUBMITTED',
        submittedAt: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // List Claims
  router.get('/claims', validateQuery(listClaimsQuerySchema), async (req, res, next) => {
    try {
      const clinicId = req.auth!.entityId!;
      const { status } = req.query as any;
      const limit = parseInt(req.query.limit as string, 10) || 50;

      const query = `
        SELECT claim_id, voucher_id, procedure_code, date_of_service, status,
               submitted_amount_cents, approved_amount_cents, invoice_id,
               submitted_at, approved_at, denied_at, invoiced_at
        FROM claims_projection
        WHERE clinic_id = $1
        ${status ? 'AND status = $2' : ''}
        ORDER BY submitted_at DESC
        LIMIT $${status ? 3 : 2}
      `;

      const params = status ? [clinicId, status, limit] : [clinicId, limit];
      const result = await pool.query(query, params);

      res.json({
        claims: result.rows.map(row => ({
          claimId: row.claim_id,
          voucherId: row.voucher_id,
          procedureCode: row.procedure_code,
          dateOfService: row.date_of_service,
          status: row.status,
          submittedAmountCents: row.submitted_amount_cents,
          approvedAmountCents: row.approved_amount_cents,
          invoiceId: row.invoice_id,
          submittedAt: row.submitted_at?.toISOString(),
          approvedAt: row.approved_at?.toISOString(),
          deniedAt: row.denied_at?.toISOString(),
          invoicedAt: row.invoiced_at?.toISOString()
        })),
        hasMore: result.rows.length === limit
      });
    } catch (error) {
      next(error);
    }
  });

  // Get Claim Details
  router.get('/claims/:claimId', async (req, res, next) => {
    try {
      const clinicId = req.auth!.entityId!;
      const { claimId } = req.params;

      const result = await pool.query(
        `SELECT * FROM claims_projection WHERE claim_id = $1 AND clinic_id = $2`,
        [claimId, clinicId]
      );

      if (result.rows.length === 0) {
        throw new ApiError(404, 'CLAIM_NOT_FOUND', 'Claim not found');
      }

      const claim = result.rows[0];
      res.json({
        claimId: claim.claim_id,
        voucherId: claim.voucher_id,
        procedureCode: claim.procedure_code,
        dateOfService: claim.date_of_service,
        status: claim.status,
        submittedAmountCents: claim.submitted_amount_cents,
        approvedAmountCents: claim.approved_amount_cents,
        decisionBasis: claim.decision_basis,
        invoiceId: claim.invoice_id,
        submittedAt: claim.submitted_at?.toISOString(),
        approvedAt: claim.approved_at?.toISOString(),
        deniedAt: claim.denied_at?.toISOString(),
        invoicedAt: claim.invoiced_at?.toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // List Invoices
  router.get('/invoices', validateQuery(listInvoicesQuerySchema), async (req, res, next) => {
    try {
      const clinicId = req.auth!.entityId!;
      const { status } = req.query as any;
      const limit = parseInt(req.query.limit as string, 10) || 50;

      const query = `
        SELECT invoice_id, invoice_period_start, invoice_period_end,
               total_amount_cents, status, generated_at, submitted_at
        FROM invoices_projection
        WHERE clinic_id = $1
        ${status ? 'AND status = $2' : ''}
        ORDER BY generated_at DESC
        LIMIT $${status ? 3 : 2}
      `;

      const params = status ? [clinicId, status, limit] : [clinicId, limit];
      const result = await pool.query(query, params);

      res.json({
        invoices: result.rows.map(row => ({
          invoiceId: row.invoice_id,
          periodStart: row.invoice_period_start,
          periodEnd: row.invoice_period_end,
          totalAmountCents: row.total_amount_cents,
          status: row.status,
          generatedAt: row.generated_at?.toISOString(),
          submittedAt: row.submitted_at?.toISOString()
        })),
        hasMore: result.rows.length === limit
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
