import { Router } from 'express';
import { Pool } from 'pg';
import { EventStore } from '../../event-store';
import { IdempotencyService } from '../../application/idempotency-service';
import { ClaimService } from '../../application/claim-service';
import { InvoiceService } from '../../application/invoice-service';
import { OasisService } from '../../application/oasis-service';
import { CloseoutService } from '../../application/closeout-service';
import { validate, validateQuery } from '../middleware/validator';
import { requirePermission } from '../middleware/auth';
import { approveClaimSchema, denyClaimSchema, generateMonthlyInvoicesSchema, generateOasisExportSchema, listClaimsAdminQuerySchema } from '../schemas/admin-schemas';
import { ApiError } from '../middleware/auth';
import { Money } from '../../domain-types';

export function createAdminRoutes(pool: Pool, eventStore: EventStore, idempotency: IdempotencyService) {
  const router = Router();
  const claimService = new ClaimService(pool, eventStore, idempotency);
  const invoiceService = new InvoiceService(pool, eventStore, idempotency);
  const oasisService = new OasisService(pool, eventStore, idempotency);
  const closeoutService = new CloseoutService(pool, eventStore, idempotency);

  // Get latest event watermark for invoice generation
  router.get('/watermark', requirePermission('invoices:generate'), async (req, res, next) => {
    try {
      const result = await pool.query(`
        SELECT event_id, ingested_at
        FROM event_log
        ORDER BY ingested_at DESC, event_id DESC
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: {
            code: 'NO_EVENTS',
            message: 'No events found in event log',
            correlationId: req.correlationId
          }
        });
      }

      res.json({
        latestEventId: result.rows[0].event_id,
        latestIngestedAt: result.rows[0].ingested_at.toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // List Claims for Adjudication
  router.get('/claims', requirePermission('claims:view'), validateQuery(listClaimsAdminQuerySchema), async (req, res, next) => {
    try {
      const { status, clinicId, grantCycleId, limit } = req.query as any;

      let query = `
        SELECT c.claim_id, c.clinic_id, c.voucher_id, c.procedure_code, c.date_of_service,
               c.status, c.submitted_amount_cents, c.submitted_at,
               vc.clinic_name
        FROM claims_projection c
        JOIN vet_clinics_projection vc ON vc.clinic_id = c.clinic_id
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (status) {
        query += ` AND c.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (clinicId) {
        query += ` AND c.clinic_id = $${paramIndex}`;
        params.push(clinicId);
        paramIndex++;
      }

      if (grantCycleId) {
        query += ` AND c.grant_cycle_id = $${paramIndex}`;
        params.push(grantCycleId);
        paramIndex++;
      }

      query += ` ORDER BY c.submitted_at DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await pool.query(query, params);

      res.json({
        claims: result.rows.map(row => ({
          claimId: row.claim_id,
          clinicId: row.clinic_id,
          clinicName: row.clinic_name,
          voucherId: row.voucher_id,
          procedureCode: row.procedure_code,
          dateOfService: row.date_of_service,
          submittedAmountCents: row.submitted_amount_cents,
          submittedAt: row.submitted_at?.toISOString()
        })),
        hasMore: result.rows.length === limit
      });
    } catch (error) {
      next(error);
    }
  });

  // Approve Claim
  router.post('/claims/:claimId/approve', requirePermission('claims:approve'), validate(approveClaimSchema), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;
      
      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      await claimService.adjudicateClaim({
        idempotencyKey,
        claimId: req.params.claimId as any,
        decision: 'APPROVE',
        approvedAmountCents: Money.fromBigInt(BigInt(req.body.approvedAmountCents)),
        decisionBasis: {
          policySnapshotId: req.body.policySnapshotId,
          decidedBy: userId,
          decidedAt: new Date(),
          reason: req.body.reason
        },
        correlationId: req.correlationId!,
        actorId: userId,
        actorType: 'ADMIN'
      });

      res.json({
        claimId: req.params.claimId,
        status: 'APPROVED',
        approvedAt: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // Deny Claim
  router.post('/claims/:claimId/deny', requirePermission('claims:deny'), validate(denyClaimSchema), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;
      
      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      await claimService.adjudicateClaim({
        idempotencyKey,
        claimId: req.params.claimId as any,
        decision: 'DENY',
        decisionBasis: {
          policySnapshotId: req.body.policySnapshotId,
          decidedBy: userId,
          decidedAt: new Date(),
          reason: req.body.reason
        },
        correlationId: req.correlationId!,
        actorId: userId,
        actorType: 'ADMIN'
      });

      res.json({
        claimId: req.params.claimId,
        status: 'DENIED',
        deniedAt: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // Generate Monthly Invoices
  router.post('/invoices/generate', requirePermission('invoices:generate'), validate(generateMonthlyInvoicesSchema), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;
      
      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const result = await invoiceService.generateMonthlyInvoices({
        idempotencyKey,
        year: req.body.year,
        month: req.body.month,
        watermarkIngestedAt: new Date(req.body.watermarkIngestedAt),
        watermarkEventId: req.body.watermarkEventId,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!
      });

      res.json({
        invoiceIds: result.invoiceIds,
        totalInvoices: result.invoiceIds.length
      });
    } catch (error) {
      next(error);
    }
  });

  // Generate OASIS Export
  router.post('/exports/oasis', requirePermission('exports:generate'), validate(generateOasisExportSchema), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;
      
      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const batchResult = await oasisService.generateExportBatch({
        idempotencyKey: idempotencyKey + ':batch',
        grantCycleId: req.body.grantCycleId,
        periodStart: new Date(req.body.periodStart),
        periodEnd: new Date(req.body.periodEnd),
        watermarkIngestedAt: new Date(req.body.watermarkIngestedAt),
        watermarkEventId: req.body.watermarkEventId,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!
      });

      const fileResult = await oasisService.renderExportFile({
        idempotencyKey: idempotencyKey + ':file',
        exportBatchId: batchResult.exportBatchId,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!
      });

      // Fetch batch details for record count and control total
      const batchDetails = await pool.query(
        'SELECT record_count, control_total_cents FROM oasis_export_batches_projection WHERE export_batch_id = $1',
        [batchResult.exportBatchId]
      );

      res.json({
        exportBatchId: batchResult.exportBatchId,
        recordCount: batchDetails.rows[0]?.record_count || 0,
        controlTotalCents: batchDetails.rows[0]?.control_total_cents || '0',
        artifactId: fileResult.artifactId,
        fileSha256: fileResult.sha256,
        downloadUrl: `/api/v1/admin/exports/${batchResult.exportBatchId}/download`
      });
    } catch (error) {
      next(error);
    }
  });

  // Run Closeout Preflight
  router.post('/closeout/:grantCycleId/preflight', requirePermission('closeout:manage'), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;
      
      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const result = await closeoutService.runPreflight({
        idempotencyKey,
        grantCycleId: req.params.grantCycleId,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!
      });

      res.json({
        status: result.status,
        checks: result.checks
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
