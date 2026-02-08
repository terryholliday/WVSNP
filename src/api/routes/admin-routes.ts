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
import {
  approveClaimSchema,
  denyClaimSchema,
  generateMonthlyInvoicesSchema,
  generateOasisExportSchema,
  submitOasisBatchSchema,
  acknowledgeOasisBatchSchema,
  rejectOasisBatchSchema,
  voidOasisBatchSchema,
  closeoutReconcileSchema,
  closeoutAuditHoldSchema,
  closeoutAuditResolveSchema,
  listClaimsAdminQuerySchema,
} from '../schemas/admin-schemas';
import { ExportBatchId, OasisRefId } from '../../domain/oasis/batch-logic';
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

  // ─── OASIS LIFECYCLE ────────────────────────────────────────────────

  // List OASIS Export Batches
  router.get('/exports/oasis', requirePermission('exports:generate'), async (req, res, next) => {
    try {
      const { grantCycleId, status, limit = '50' } = req.query as any;

      let query = `
        SELECT export_batch_id, grant_cycle_id, batch_code, status,
               record_count, control_total_cents, period_start, period_end,
               file_sha256, watermark_ingested_at, watermark_event_id
        FROM oasis_export_batches_projection
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (grantCycleId) {
        query += ` AND grant_cycle_id = $${paramIndex}`;
        params.push(grantCycleId);
        paramIndex++;
      }
      if (status) {
        query += ` AND status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      query += ` ORDER BY watermark_ingested_at DESC LIMIT $${paramIndex}`;
      params.push(parseInt(limit));

      const result = await pool.query(query, params);

      res.json({
        batches: result.rows.map(row => ({
          exportBatchId: row.export_batch_id,
          grantCycleId: row.grant_cycle_id,
          batchCode: row.batch_code,
          status: row.status,
          recordCount: row.record_count,
          controlTotalCents: row.control_total_cents?.toString(),
          periodStart: row.period_start,
          periodEnd: row.period_end,
          fileSha256: row.file_sha256,
        })),
        count: result.rows.length
      });
    } catch (error) {
      next(error);
    }
  });

  // Get OASIS Export Batch Details
  router.get('/exports/oasis/:exportBatchId', requirePermission('exports:generate'), async (req, res, next) => {
    try {
      const { exportBatchId } = req.params;

      const batchResult = await pool.query(
        'SELECT * FROM oasis_export_batches_projection WHERE export_batch_id = $1',
        [exportBatchId]
      );
      if (batchResult.rows.length === 0) {
        throw new ApiError(404, 'BATCH_NOT_FOUND', 'Export batch not found');
      }

      const itemsResult = await pool.query(
        'SELECT * FROM oasis_export_batch_items_projection WHERE export_batch_id = $1 ORDER BY invoice_id',
        [exportBatchId]
      );

      const batch = batchResult.rows[0];
      res.json({
        exportBatchId: batch.export_batch_id,
        grantCycleId: batch.grant_cycle_id,
        batchCode: batch.batch_code,
        status: batch.status,
        recordCount: batch.record_count,
        controlTotalCents: batch.control_total_cents?.toString(),
        periodStart: batch.period_start,
        periodEnd: batch.period_end,
        fileSha256: batch.file_sha256,
        items: itemsResult.rows.map(item => ({
          invoiceId: item.invoice_id,
          clinicId: item.clinic_id,
          oasisVendorCode: item.oasis_vendor_code,
          amountCents: item.amount_cents?.toString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  // Submit OASIS Export Batch
  router.post('/exports/oasis/:exportBatchId/submit', requirePermission('exports:generate'), validate(submitOasisBatchSchema), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;

      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const result = await oasisService.submitBatch({
        idempotencyKey,
        exportBatchId: req.params.exportBatchId as ExportBatchId,
        submissionMethod: req.body.submissionMethod,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!,
      });

      res.json({
        exportBatchId: req.params.exportBatchId,
        status: result.status,
        submittedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  // Acknowledge OASIS Export Batch
  router.post('/exports/oasis/:exportBatchId/acknowledge', requirePermission('exports:generate'), validate(acknowledgeOasisBatchSchema), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;

      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const result = await oasisService.acknowledgeBatch({
        idempotencyKey,
        exportBatchId: req.params.exportBatchId as ExportBatchId,
        oasisRefId: req.body.oasisRefId as OasisRefId,
        acceptedAt: new Date(req.body.acceptedAt),
        notes: req.body.notes,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!,
      });

      res.json({
        exportBatchId: req.params.exportBatchId,
        status: result.status,
        acknowledgedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  // Reject OASIS Export Batch
  router.post('/exports/oasis/:exportBatchId/reject', requirePermission('exports:generate'), validate(rejectOasisBatchSchema), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;

      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const result = await oasisService.rejectBatch({
        idempotencyKey,
        exportBatchId: req.params.exportBatchId as ExportBatchId,
        rejectionReason: req.body.rejectionReason,
        rejectionCode: req.body.rejectionCode,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!,
      });

      res.json({
        exportBatchId: req.params.exportBatchId,
        status: result.status,
        rejectedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  // Void OASIS Export Batch
  router.post('/exports/oasis/:exportBatchId/void', requirePermission('exports:generate'), validate(voidOasisBatchSchema), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;

      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const result = await oasisService.voidBatch({
        idempotencyKey,
        exportBatchId: req.params.exportBatchId as ExportBatchId,
        reason: req.body.reason,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!,
      });

      res.json({
        exportBatchId: req.params.exportBatchId,
        status: result.status,
        voidedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  // Download OASIS Export File
  router.get('/exports/:exportBatchId/download', requirePermission('exports:generate'), async (req, res, next) => {
    try {
      const { exportBatchId } = req.params;

      const batchResult = await pool.query(
        'SELECT artifact_id, file_sha256, batch_code FROM oasis_export_batches_projection WHERE export_batch_id = $1',
        [exportBatchId]
      );
      if (batchResult.rows.length === 0) {
        throw new ApiError(404, 'BATCH_NOT_FOUND', 'Export batch not found');
      }

      const batch = batchResult.rows[0];
      if (!batch.artifact_id) {
        throw new ApiError(400, 'FILE_NOT_RENDERED', 'Export file has not been rendered yet');
      }

      const artifactResult = await pool.query(
        'SELECT content_bytes, content_type FROM artifact_log WHERE artifact_id = $1',
        [batch.artifact_id]
      );
      if (artifactResult.rows.length === 0) {
        throw new ApiError(404, 'ARTIFACT_NOT_FOUND', 'Export file artifact not found');
      }

      const artifact = artifactResult.rows[0];
      res.setHeader('Content-Type', artifact.content_type || 'text/plain; charset=us-ascii');
      res.setHeader('Content-Disposition', `attachment; filename="${batch.batch_code}.txt"`);
      res.setHeader('X-File-SHA256', batch.file_sha256 || '');
      res.send(artifact.content_bytes);
    } catch (error) {
      next(error);
    }
  });

  // ─── GRANT CYCLE CLOSEOUT LIFECYCLE ─────────────────────────────────

  // Get Closeout Status
  router.get('/closeout/:grantCycleId', requirePermission('closeout:manage'), async (req, res, next) => {
    try {
      const result = await pool.query(
        'SELECT * FROM grant_cycle_closeout_projection WHERE grant_cycle_id = $1',
        [req.params.grantCycleId]
      );

      if (result.rows.length === 0) {
        return res.json({
          grantCycleId: req.params.grantCycleId,
          closeoutStatus: 'NOT_STARTED',
          preflightStatus: null,
          checks: null,
          financialSummary: null,
          matchingFunds: null,
        });
      }

      const row = result.rows[0];
      res.json({
        grantCycleId: row.grant_cycle_id,
        closeoutStatus: row.closeout_status,
        preflightStatus: row.preflight_status,
        checks: row.checks,
        financialSummary: row.financial_summary,
        matchingFunds: row.matching_funds,
        auditHoldReason: row.audit_hold_reason,
        auditResolution: row.audit_resolution,
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

  // Start Closeout
  router.post('/closeout/:grantCycleId/start', requirePermission('closeout:manage'), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;

      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const result = await closeoutService.startCloseout({
        idempotencyKey,
        grantCycleId: req.params.grantCycleId,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!,
      });

      res.json({
        grantCycleId: req.params.grantCycleId,
        status: result.status,
        startedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  // Reconcile
  router.post('/closeout/:grantCycleId/reconcile', requirePermission('closeout:manage'), validate(closeoutReconcileSchema), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;

      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const result = await closeoutService.reconcile({
        idempotencyKey,
        grantCycleId: req.params.grantCycleId,
        watermarkIngestedAt: new Date(req.body.watermarkIngestedAt),
        watermarkEventId: req.body.watermarkEventId,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!,
      });

      res.json({
        grantCycleId: req.params.grantCycleId,
        status: result.status,
        reconciledAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  // Close Grant Cycle
  router.post('/closeout/:grantCycleId/close', requirePermission('closeout:manage'), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;

      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const result = await closeoutService.close({
        idempotencyKey,
        grantCycleId: req.params.grantCycleId,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!,
      });

      res.json({
        grantCycleId: req.params.grantCycleId,
        status: result.status,
        closedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  // Audit Hold
  router.post('/closeout/:grantCycleId/audit-hold', requirePermission('closeout:manage'), validate(closeoutAuditHoldSchema), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;

      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const result = await closeoutService.auditHold({
        idempotencyKey,
        grantCycleId: req.params.grantCycleId,
        reason: req.body.reason,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!,
      });

      res.json({
        grantCycleId: req.params.grantCycleId,
        status: result.status,
      });
    } catch (error) {
      next(error);
    }
  });

  // Audit Resolve
  router.post('/closeout/:grantCycleId/audit-resolve', requirePermission('closeout:manage'), validate(closeoutAuditResolveSchema), async (req, res, next) => {
    try {
      const userId = req.auth!.userId!;
      const idempotencyKey = req.headers['idempotency-key'] as string;

      if (!idempotencyKey) {
        throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const result = await closeoutService.auditResolve({
        idempotencyKey,
        grantCycleId: req.params.grantCycleId,
        resolution: req.body.resolution,
        actorId: userId,
        actorType: 'ADMIN',
        correlationId: req.correlationId!,
      });

      res.json({
        grantCycleId: req.params.grantCycleId,
        status: result.status,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
