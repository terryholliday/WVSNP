/**
 * Admin Routes - WVDA Portal Only
 *
 * Endpoints:
 * POST   /api/v1/claims/:id/adjudicate  → adjudicateClaim
 * POST   /api/v1/invoices/generate      → generateInvoice
 * POST   /api/v1/oasis/export           → generateOASISBatch
 * POST   /api/v1/oasis/export/:id/submit → submitBatch
 * GET    /api/v1/oasis/export/:id       → getBatch
 * POST   /api/v1/closeout/preflight     → runPreFlight
 * POST   /api/v1/closeout/start         → startCloseout
 * POST   /api/v1/closeout/reconcile     → reconcile
 * POST   /api/v1/closeout/close         → closeCycle
 * GET    /api/v1/closeout/:id           → getCloseoutStatus
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { EventStore } from '../../event-store';
import { ClaimService } from '../../application/claim-service';
import { InvoiceService } from '../../application/invoice-service';
import { OasisService } from '../../application/oasis-service';
import { CloseoutService } from '../../application/closeout-service';
import { IdempotencyService } from '../../application/idempotency-service';
import { requirePermission, requireClientType, PERMISSIONS } from '../middleware/auth';
import {
  ApiResponse,
  AdjudicateClaimRequest,
  GenerateInvoiceRequest,
  GenerateOASISBatchRequest,
  SubmitOASISBatchRequest,
  InvoiceResponse,
  OASISBatchResponse,
  PreflightResponse,
  CloseoutStatusResponse,
} from '../types';
import { ClaimId, MoneyCents } from '../../domain-types';

export function createAdminRouter(
  pool: Pool,
  store: EventStore,
  idempotency: IdempotencyService
): Router {
  const router = Router();
  const claimService = new ClaimService(pool, store, idempotency);
  const invoiceService = new InvoiceService(pool, store);
  const oasisService = new OasisService(pool, store, idempotency);
  const closeoutService = new CloseoutService(pool, store);

  // All admin routes require ADMIN client type
  router.use(requireClientType('ADMIN'));

  /**
   * POST /api/v1/claims/:id/adjudicate - Approve or deny a claim
   */
  router.post(
    '/claims/:id/adjudicate',
    requirePermission(PERMISSIONS.CLAIM_ADJUDICATE),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const claimId = req.params.id as ClaimId;
        const body = req.body as AdjudicateClaimRequest;
        const credentials = req.credentials!;

        if (!body.decision || !body.reason || !body.policySnapshotId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'decision, reason, and policySnapshotId are required',
            },
          };
          res.status(400).json(response);
          return;
        }

        if (body.decision === 'APPROVE' && !body.approvedAmountCents) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'APPROVED_AMOUNT_REQUIRED',
              message: 'approvedAmountCents is required when decision is APPROVE',
            },
          };
          res.status(400).json(response);
          return;
        }

        const idempotencyKey = req.headers['idempotency-key'] as string ||
          crypto.createHash('sha256')
            .update(`adjudicate:${claimId}:${body.decision}:${Date.now()}`)
            .digest('hex');

        if (body.decision === 'APPROVE') {
          await claimService.adjudicateClaim({
            idempotencyKey,
            claimId,
            decision: 'APPROVE',
            approvedAmountCents: BigInt(body.approvedAmountCents!) as MoneyCents,
            decisionBasis: {
              policySnapshotId: body.policySnapshotId,
              decidedBy: credentials.clientId,
              decidedAt: new Date().toISOString(),
              reason: body.reason,
            },
            actorId: credentials.clientId,
            correlationId: crypto.randomUUID(),
          });
        } else {
          await claimService.adjudicateClaim({
            idempotencyKey,
            claimId,
            decision: 'DENY',
            decisionBasis: {
              policySnapshotId: body.policySnapshotId,
              decidedBy: credentials.clientId,
              decidedAt: new Date().toISOString(),
              reason: body.reason,
            },
            actorId: credentials.clientId,
            correlationId: crypto.randomUUID(),
          });
        }

        // Fetch updated claim
        const claimResult = await pool.query(
          `SELECT * FROM claims_projection WHERE claim_id = $1`,
          [claimId]
        );

        const claim = claimResult.rows[0];
        const response: ApiResponse<{ claimId: string; status: string; approvedAmountCents: string | null }> = {
          success: true,
          data: {
            claimId: claim.claim_id,
            status: claim.status,
            approvedAmountCents: claim.approved_amount_cents?.toString() || null,
          },
        };

        res.json(response);
      } catch (error) {
        const err = error as Error;
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: err.message.includes('CLAIM_ALREADY_ADJUDICATED') ? 'CLAIM_ALREADY_ADJUDICATED' :
                  err.message.includes('CLAIM_NOT_FOUND') ? 'CLAIM_NOT_FOUND' :
                  'ADJUDICATION_FAILED',
            message: err.message,
          },
        };
        res.status(400).json(response);
      }
    }
  );

  /**
   * POST /api/v1/invoices/generate - Generate invoices for a period
   */
  router.post(
    '/invoices/generate',
    requirePermission(PERMISSIONS.INVOICE_GENERATE),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const body = req.body as GenerateInvoiceRequest;
        const credentials = req.credentials!;

        if (!body.grantCycleId || !body.periodStart || !body.periodEnd) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'grantCycleId, periodStart, and periodEnd are required',
            },
          };
          res.status(400).json(response);
          return;
        }

        const invoices = await invoiceService.generateInvoices({
          grantCycleId: body.grantCycleId,
          periodStart: new Date(body.periodStart),
          periodEnd: new Date(body.periodEnd),
          actorId: credentials.clientId,
          correlationId: crypto.randomUUID(),
        });

        // Fetch generated invoices
        const invoiceIds = invoices.map(i => i.invoiceId);
        const result = await pool.query(
          `SELECT * FROM invoices_projection WHERE invoice_id = ANY($1)`,
          [invoiceIds]
        );

        const items: InvoiceResponse[] = result.rows.map(i => ({
          invoiceId: i.invoice_id,
          clinicId: i.clinic_id,
          grantCycleId: i.grant_cycle_id,
          periodStart: i.invoice_period_start.toISOString().split('T')[0],
          periodEnd: i.invoice_period_end.toISOString().split('T')[0],
          totalAmountCents: i.total_amount_cents.toString(),
          claimCount: Array.isArray(i.claim_ids) ? i.claim_ids.length : 0,
          status: i.status,
          submittedAt: i.submitted_at?.toISOString() || null,
          oasisExportBatchId: i.oasis_export_batch_id || null,
        }));

        const response: ApiResponse<{ invoices: InvoiceResponse[]; count: number }> = {
          success: true,
          data: {
            invoices: items,
            count: items.length,
          },
        };

        res.status(201).json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'INVOICE_GENERATE_FAILED',
            message: (error as Error).message,
          },
        };
        res.status(400).json(response);
      }
    }
  );

  /**
   * POST /api/v1/oasis/export - Generate OASIS export batch
   */
  router.post(
    '/oasis/export',
    requirePermission(PERMISSIONS.OASIS_EXPORT),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const body = req.body as GenerateOASISBatchRequest;
        const credentials = req.credentials!;

        if (!body.grantCycleId || !body.periodStart || !body.periodEnd) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'grantCycleId, periodStart, and periodEnd are required',
            },
          };
          res.status(400).json(response);
          return;
        }

        const idempotencyKey = req.headers['idempotency-key'] as string ||
          crypto.createHash('sha256')
            .update(`oasis:${body.grantCycleId}:${body.periodStart}:${body.periodEnd}`)
            .digest('hex');

        const result = await oasisService.generateExportBatch({
          idempotencyKey,
          grantCycleId: body.grantCycleId,
          periodStart: new Date(body.periodStart),
          periodEnd: new Date(body.periodEnd),
          actorId: credentials.clientId,
          correlationId: crypto.randomUUID(),
        });

        // Fetch the batch
        const batchResult = await pool.query(
          `SELECT * FROM oasis_export_batches_projection WHERE export_batch_id = $1`,
          [result.exportBatchId]
        );

        const batch = batchResult.rows[0];
        const response: ApiResponse<OASISBatchResponse> = {
          success: true,
          data: {
            exportBatchId: batch.export_batch_id,
            batchCode: batch.batch_code,
            grantCycleId: batch.grant_cycle_id,
            periodStart: batch.period_start.toISOString().split('T')[0],
            periodEnd: batch.period_end.toISOString().split('T')[0],
            status: batch.status,
            recordCount: batch.record_count,
            controlTotalCents: batch.control_total_cents.toString(),
            artifactId: batch.artifact_id || null,
            submittedAt: batch.submitted_at?.toISOString() || null,
            acknowledgedAt: batch.acknowledged_at?.toISOString() || null,
            rejectionReason: batch.rejection_reason || null,
          },
        };

        res.status(201).json(response);
      } catch (error) {
        const err = error as Error;
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: err.message.includes('DUPLICATE_BATCH') ? 'DUPLICATE_BATCH' :
                  err.message.includes('NO_INVOICES') ? 'NO_INVOICES_TO_EXPORT' :
                  'OASIS_EXPORT_FAILED',
            message: err.message,
          },
        };
        res.status(400).json(response);
      }
    }
  );

  /**
   * POST /api/v1/oasis/export/:id/submit - Submit batch to Treasury
   */
  router.post(
    '/oasis/export/:id/submit',
    requirePermission(PERMISSIONS.OASIS_EXPORT),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const exportBatchId = req.params.id;
        const body = req.body as SubmitOASISBatchRequest;
        const credentials = req.credentials!;

        if (!body.submissionMethod) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'submissionMethod is required',
            },
          };
          res.status(400).json(response);
          return;
        }

        await oasisService.submitBatch({
          exportBatchId,
          submissionMethod: body.submissionMethod,
          oasisRefId: body.oasisRefId,
          actorId: credentials.clientId,
          correlationId: crypto.randomUUID(),
        });

        // Fetch updated batch
        const batchResult = await pool.query(
          `SELECT * FROM oasis_export_batches_projection WHERE export_batch_id = $1`,
          [exportBatchId]
        );

        const batch = batchResult.rows[0];
        const response: ApiResponse<OASISBatchResponse> = {
          success: true,
          data: {
            exportBatchId: batch.export_batch_id,
            batchCode: batch.batch_code,
            grantCycleId: batch.grant_cycle_id,
            periodStart: batch.period_start.toISOString().split('T')[0],
            periodEnd: batch.period_end.toISOString().split('T')[0],
            status: batch.status,
            recordCount: batch.record_count,
            controlTotalCents: batch.control_total_cents.toString(),
            artifactId: batch.artifact_id || null,
            submittedAt: batch.submitted_at?.toISOString() || null,
            acknowledgedAt: batch.acknowledged_at?.toISOString() || null,
            rejectionReason: batch.rejection_reason || null,
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'OASIS_SUBMIT_FAILED',
            message: (error as Error).message,
          },
        };
        res.status(400).json(response);
      }
    }
  );

  /**
   * GET /api/v1/oasis/export/:id - Get batch details
   */
  router.get(
    '/oasis/export/:id',
    requirePermission(PERMISSIONS.OASIS_EXPORT),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const exportBatchId = req.params.id;

        const result = await pool.query(
          `SELECT * FROM oasis_export_batches_projection WHERE export_batch_id = $1`,
          [exportBatchId]
        );

        if (result.rows.length === 0) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'BATCH_NOT_FOUND',
              message: `Export batch ${exportBatchId} not found`,
            },
          };
          res.status(404).json(response);
          return;
        }

        const batch = result.rows[0];
        const response: ApiResponse<OASISBatchResponse> = {
          success: true,
          data: {
            exportBatchId: batch.export_batch_id,
            batchCode: batch.batch_code,
            grantCycleId: batch.grant_cycle_id,
            periodStart: batch.period_start.toISOString().split('T')[0],
            periodEnd: batch.period_end.toISOString().split('T')[0],
            status: batch.status,
            recordCount: batch.record_count,
            controlTotalCents: batch.control_total_cents.toString(),
            artifactId: batch.artifact_id || null,
            submittedAt: batch.submitted_at?.toISOString() || null,
            acknowledgedAt: batch.acknowledged_at?.toISOString() || null,
            rejectionReason: batch.rejection_reason || null,
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'BATCH_FETCH_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  /**
   * POST /api/v1/closeout/preflight - Run pre-flight checks
   */
  router.post(
    '/closeout/preflight',
    requirePermission(PERMISSIONS.CLOSEOUT_MANAGE),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { grantCycleId } = req.body;
        const credentials = req.credentials!;

        if (!grantCycleId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'grantCycleId is required',
            },
          };
          res.status(400).json(response);
          return;
        }

        const result = await closeoutService.runPreflight({
          grantCycleId,
          actorId: credentials.clientId,
          correlationId: crypto.randomUUID(),
        });

        const response: ApiResponse<PreflightResponse> = {
          success: true,
          data: {
            grantCycleId,
            status: result.passed ? 'PASSED' : 'FAILED',
            checks: result.checks,
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'PREFLIGHT_FAILED',
            message: (error as Error).message,
          },
        };
        res.status(400).json(response);
      }
    }
  );

  /**
   * POST /api/v1/closeout/start - Start closeout process
   */
  router.post(
    '/closeout/start',
    requirePermission(PERMISSIONS.CLOSEOUT_MANAGE),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { grantCycleId } = req.body;
        const credentials = req.credentials!;

        if (!grantCycleId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'grantCycleId is required',
            },
          };
          res.status(400).json(response);
          return;
        }

        await closeoutService.startCloseout({
          grantCycleId,
          actorId: credentials.clientId,
          correlationId: crypto.randomUUID(),
        });

        const response: ApiResponse<{ grantCycleId: string; status: string }> = {
          success: true,
          data: {
            grantCycleId,
            status: 'STARTED',
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'CLOSEOUT_START_FAILED',
            message: (error as Error).message,
          },
        };
        res.status(400).json(response);
      }
    }
  );

  /**
   * POST /api/v1/closeout/reconcile - Reconcile financials
   */
  router.post(
    '/closeout/reconcile',
    requirePermission(PERMISSIONS.CLOSEOUT_MANAGE),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { grantCycleId } = req.body;
        const credentials = req.credentials!;

        if (!grantCycleId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'grantCycleId is required',
            },
          };
          res.status(400).json(response);
          return;
        }

        await closeoutService.reconcile({
          grantCycleId,
          actorId: credentials.clientId,
          correlationId: crypto.randomUUID(),
        });

        const response: ApiResponse<{ grantCycleId: string; status: string }> = {
          success: true,
          data: {
            grantCycleId,
            status: 'RECONCILED',
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'RECONCILE_FAILED',
            message: (error as Error).message,
          },
        };
        res.status(400).json(response);
      }
    }
  );

  /**
   * POST /api/v1/closeout/close - Final close
   */
  router.post(
    '/closeout/close',
    requirePermission(PERMISSIONS.CLOSEOUT_MANAGE),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { grantCycleId } = req.body;
        const credentials = req.credentials!;

        if (!grantCycleId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'grantCycleId is required',
            },
          };
          res.status(400).json(response);
          return;
        }

        await closeoutService.closeCycle({
          grantCycleId,
          actorId: credentials.clientId,
          correlationId: crypto.randomUUID(),
        });

        const response: ApiResponse<{ grantCycleId: string; status: string }> = {
          success: true,
          data: {
            grantCycleId,
            status: 'CLOSED',
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'CLOSE_FAILED',
            message: (error as Error).message,
          },
        };
        res.status(400).json(response);
      }
    }
  );

  /**
   * GET /api/v1/closeout/:id - Get closeout status
   */
  router.get(
    '/closeout/:id',
    requirePermission(PERMISSIONS.CLOSEOUT_MANAGE),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const grantCycleId = req.params.id;

        const result = await pool.query(
          `SELECT * FROM grant_cycle_closeout_projection WHERE grant_cycle_id = $1`,
          [grantCycleId]
        );

        if (result.rows.length === 0) {
          const response: ApiResponse<CloseoutStatusResponse> = {
            success: true,
            data: {
              grantCycleId,
              status: 'NOT_STARTED',
              preflightStatus: null,
              financialSummary: null,
              activitySummary: null,
              auditHoldReason: null,
              closedAt: null,
            },
          };
          res.json(response);
          return;
        }

        const row = result.rows[0];
        const response: ApiResponse<CloseoutStatusResponse> = {
          success: true,
          data: {
            grantCycleId: row.grant_cycle_id,
            status: row.closeout_status,
            preflightStatus: row.preflight_status,
            financialSummary: row.financial_summary,
            activitySummary: row.activity_summary,
            auditHoldReason: row.audit_hold_reason || null,
            closedAt: row.closed_at?.toISOString() || null,
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'CLOSEOUT_FETCH_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  return router;
}
