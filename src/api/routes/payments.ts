/**
 * Payment Routes - VetOS Integration (Read-only)
 *
 * Endpoints:
 * GET    /api/v1/payments              → listPayments (clinic payments)
 * GET    /api/v1/payments/:id          → getPayment
 * GET    /api/v1/payments/summary      → getClinicPaymentSummary
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { requirePermission, PERMISSIONS } from '../middleware/auth';
import {
  ApiResponse,
  PaginatedResponse,
  PaymentResponse,
  ClinicPaymentSummary,
} from '../types';

export function createPaymentRouter(pool: Pool): Router {
  const router = Router();

  /**
   * GET /api/v1/payments - List payments with filters
   */
  router.get(
    '/',
    requirePermission(PERMISSIONS.PAYMENT_READ),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const credentials = req.credentials!;
        const {
          clinicId,
          invoiceId,
          dateFrom,
          dateTo,
          offset = '0',
          limit = '50',
        } = req.query;

        const queryParams: unknown[] = [];
        const conditions: string[] = [];
        let paramIndex = 1;

        // Clinics can only see their own payments
        if (credentials.clientType === 'CLINIC') {
          conditions.push(`i.clinic_id = $${paramIndex}`);
          queryParams.push(credentials.clientId);
          paramIndex++;
        } else if (clinicId) {
          conditions.push(`i.clinic_id = $${paramIndex}`);
          queryParams.push(clinicId);
          paramIndex++;
        }

        if (invoiceId) {
          conditions.push(`p.invoice_id = $${paramIndex}`);
          queryParams.push(invoiceId);
          paramIndex++;
        }

        if (dateFrom) {
          conditions.push(`p.recorded_at >= $${paramIndex}`);
          queryParams.push(dateFrom);
          paramIndex++;
        }

        if (dateTo) {
          conditions.push(`p.recorded_at <= $${paramIndex}`);
          queryParams.push(dateTo);
          paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Get total count
        const countResult = await pool.query(
          `SELECT COUNT(*) as total
           FROM payments_projection p
           JOIN invoices_projection i ON p.invoice_id = i.invoice_id
           ${whereClause}`,
          queryParams
        );
        const total = parseInt(countResult.rows[0].total);

        // Get paginated results
        const offsetNum = parseInt(offset as string);
        const limitNum = Math.min(parseInt(limit as string), 100);

        queryParams.push(limitNum, offsetNum);

        const result = await pool.query(
          `SELECT p.*, i.clinic_id
           FROM payments_projection p
           JOIN invoices_projection i ON p.invoice_id = i.invoice_id
           ${whereClause}
           ORDER BY p.recorded_at DESC
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          queryParams
        );

        const items: PaymentResponse[] = result.rows.map(p => ({
          paymentId: p.payment_id,
          invoiceId: p.invoice_id,
          clinicId: p.clinic_id,
          amountCents: p.amount_cents.toString(),
          paymentChannel: p.payment_channel,
          referenceId: p.reference_id || null,
          recordedAt: p.recorded_at.toISOString(),
        }));

        const response: ApiResponse<PaginatedResponse<PaymentResponse>> = {
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
            code: 'PAYMENT_LIST_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  /**
   * GET /api/v1/payments/summary - Get clinic payment summary
   */
  router.get(
    '/summary',
    requirePermission(PERMISSIONS.PAYMENT_READ),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const credentials = req.credentials!;
        const { clinicId: queryClinicId } = req.query;

        // Determine which clinic to query
        const clinicId = credentials.clientType === 'CLINIC'
          ? credentials.clientId
          : queryClinicId as string;

        if (!clinicId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'CLINIC_ID_REQUIRED',
              message: 'clinicId is required for non-clinic clients',
            },
          };
          res.status(400).json(response);
          return;
        }

        // Get total paid
        const paidResult = await pool.query(
          `SELECT COALESCE(SUM(p.amount_cents), 0) as total_paid
           FROM payments_projection p
           JOIN invoices_projection i ON p.invoice_id = i.invoice_id
           WHERE i.clinic_id = $1`,
          [clinicId]
        );

        // Get total pending (approved claims not yet paid)
        const pendingResult = await pool.query(
          `SELECT COALESCE(SUM(i.total_amount_cents), 0) -
                  COALESCE((SELECT SUM(p.amount_cents) FROM payments_projection p WHERE p.invoice_id = i.invoice_id), 0) as total_pending
           FROM invoices_projection i
           WHERE i.clinic_id = $1 AND i.status IN ('SUBMITTED', 'DRAFT')`,
          [clinicId]
        );

        // Get recent payments
        const recentResult = await pool.query(
          `SELECT p.*, i.clinic_id
           FROM payments_projection p
           JOIN invoices_projection i ON p.invoice_id = i.invoice_id
           WHERE i.clinic_id = $1
           ORDER BY p.recorded_at DESC
           LIMIT 10`,
          [clinicId]
        );

        const payments: PaymentResponse[] = recentResult.rows.map(p => ({
          paymentId: p.payment_id,
          invoiceId: p.invoice_id,
          clinicId: p.clinic_id,
          amountCents: p.amount_cents.toString(),
          paymentChannel: p.payment_channel,
          referenceId: p.reference_id || null,
          recordedAt: p.recorded_at.toISOString(),
        }));

        const response: ApiResponse<ClinicPaymentSummary> = {
          success: true,
          data: {
            clinicId,
            totalPaidCents: paidResult.rows[0].total_paid.toString(),
            totalPendingCents: (pendingResult.rows[0]?.total_pending || 0).toString(),
            payments,
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'PAYMENT_SUMMARY_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  /**
   * GET /api/v1/payments/:id - Get payment details
   */
  router.get(
    '/:id',
    requirePermission(PERMISSIONS.PAYMENT_READ),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const paymentId = req.params.id;
        const credentials = req.credentials!;

        const result = await pool.query(
          `SELECT p.*, i.clinic_id
           FROM payments_projection p
           JOIN invoices_projection i ON p.invoice_id = i.invoice_id
           WHERE p.payment_id = $1`,
          [paymentId]
        );

        if (result.rows.length === 0) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'PAYMENT_NOT_FOUND',
              message: `Payment ${paymentId} not found`,
            },
          };
          res.status(404).json(response);
          return;
        }

        const p = result.rows[0];

        // Clinics can only see their own payments
        if (credentials.clientType === 'CLINIC' && p.clinic_id !== credentials.clientId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'RESOURCE_ACCESS_DENIED',
              message: 'You do not have access to this payment',
            },
          };
          res.status(403).json(response);
          return;
        }

        const response: ApiResponse<PaymentResponse> = {
          success: true,
          data: {
            paymentId: p.payment_id,
            invoiceId: p.invoice_id,
            clinicId: p.clinic_id,
            amountCents: p.amount_cents.toString(),
            paymentChannel: p.payment_channel,
            referenceId: p.reference_id || null,
            recordedAt: p.recorded_at.toISOString(),
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'PAYMENT_FETCH_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  return router;
}
