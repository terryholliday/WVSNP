/**
 * Grant Routes - ShelterOS + WVDA Integration
 *
 * Endpoints:
 * GET    /api/v1/grants/:id/budget     → getGrantBudget
 * GET    /api/v1/grants/:id/activity   → getActivitySummary
 * GET    /api/v1/reports/county/:code  → getCountyReport
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { requirePermission, PERMISSIONS } from '../middleware/auth';
import {
  ApiResponse,
  GrantBudgetResponse,
  ActivitySummaryResponse,
  CountyReportResponse,
} from '../types';

export function createGrantRouter(pool: Pool): Router {
  const router = Router();

  /**
   * GET /api/v1/grants/:id/budget - Get grant budget breakdown
   */
  router.get(
    '/:id/budget',
    requirePermission(PERMISSIONS.GRANT_READ),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const grantId = req.params.id;

        const result = await pool.query(
          `SELECT
            grant_id,
            grant_cycle_id,
            bucket_type,
            awarded_cents,
            available_cents,
            encumbered_cents,
            liquidated_cents
          FROM grant_balances_projection
          WHERE grant_id = $1
          ORDER BY bucket_type`,
          [grantId]
        );

        if (result.rows.length === 0) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'GRANT_NOT_FOUND',
              message: `Grant ${grantId} not found`,
            },
          };
          res.status(404).json(response);
          return;
        }

        const buckets = result.rows.map(row => ({
          type: row.bucket_type as 'GENERAL' | 'LIRP',
          awardedCents: row.awarded_cents.toString(),
          availableCents: row.available_cents.toString(),
          encumberedCents: row.encumbered_cents.toString(),
          liquidatedCents: row.liquidated_cents.toString(),
        }));

        // Calculate totals
        const totals = {
          awardedCents: result.rows.reduce((sum, r) => sum + BigInt(r.awarded_cents), 0n).toString(),
          availableCents: result.rows.reduce((sum, r) => sum + BigInt(r.available_cents), 0n).toString(),
          encumberedCents: result.rows.reduce((sum, r) => sum + BigInt(r.encumbered_cents), 0n).toString(),
          liquidatedCents: result.rows.reduce((sum, r) => sum + BigInt(r.liquidated_cents), 0n).toString(),
        };

        const response: ApiResponse<GrantBudgetResponse> = {
          success: true,
          data: {
            grantId,
            grantCycleId: result.rows[0].grant_cycle_id,
            buckets,
            totals,
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'GRANT_BUDGET_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  /**
   * GET /api/v1/grants/:id/activity - Get grant activity summary
   */
  router.get(
    '/:id/activity',
    requirePermission(PERMISSIONS.GRANT_READ),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const grantId = req.params.id;

        // Get grant cycle ID
        const grantResult = await pool.query(
          `SELECT grant_cycle_id FROM grant_balances_projection WHERE grant_id = $1 LIMIT 1`,
          [grantId]
        );

        if (grantResult.rows.length === 0) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'GRANT_NOT_FOUND',
              message: `Grant ${grantId} not found`,
            },
          };
          res.status(404).json(response);
          return;
        }

        const grantCycleId = grantResult.rows[0].grant_cycle_id;

        // Get voucher counts
        const voucherResult = await pool.query(
          `SELECT
            COUNT(*) FILTER (WHERE status = 'ISSUED') as issued,
            COUNT(*) FILTER (WHERE status = 'REDEEMED') as redeemed,
            COUNT(*) FILTER (WHERE status = 'EXPIRED') as expired,
            COUNT(*) FILTER (WHERE status = 'VOIDED') as voided,
            COUNT(*) FILTER (WHERE status = 'TENTATIVE') as pending
          FROM vouchers_projection
          WHERE grant_id = $1`,
          [grantId]
        );

        // Get claim counts
        const claimResult = await pool.query(
          `SELECT
            COUNT(*) FILTER (WHERE status = 'SUBMITTED') as submitted,
            COUNT(*) FILTER (WHERE status = 'APPROVED') as approved,
            COUNT(*) FILTER (WHERE status = 'DENIED') as denied,
            COUNT(*) FILTER (WHERE status = 'INVOICED') as invoiced
          FROM claims_projection
          WHERE grant_cycle_id = $1`,
          [grantCycleId]
        );

        // Get procedure counts by type
        const procedureResult = await pool.query(
          `SELECT
            procedure_code,
            COUNT(*) as count
          FROM claims_projection
          WHERE grant_cycle_id = $1 AND status IN ('APPROVED', 'INVOICED')
          GROUP BY procedure_code`,
          [grantCycleId]
        );

        // Parse procedure counts
        const procedureCounts: Record<string, number> = {};
        for (const row of procedureResult.rows) {
          procedureCounts[row.procedure_code] = parseInt(row.count);
        }

        // Get unique counties
        const countyResult = await pool.query(
          `SELECT DISTINCT county_code FROM vouchers_projection WHERE grant_id = $1`,
          [grantId]
        );

        const vr = voucherResult.rows[0];
        const cr = claimResult.rows[0];

        const response: ApiResponse<ActivitySummaryResponse> = {
          success: true,
          data: {
            grantId,
            grantCycleId,
            vouchers: {
              issued: parseInt(vr.issued || 0),
              redeemed: parseInt(vr.redeemed || 0),
              expired: parseInt(vr.expired || 0),
              voided: parseInt(vr.voided || 0),
              pending: parseInt(vr.pending || 0),
            },
            claims: {
              submitted: parseInt(cr.submitted || 0),
              approved: parseInt(cr.approved || 0),
              denied: parseInt(cr.denied || 0),
              invoiced: parseInt(cr.invoiced || 0),
            },
            animals: {
              dogs: {
                spay: procedureCounts['DOG_SPAY'] || 0,
                neuter: procedureCounts['DOG_NEUTER'] || 0,
              },
              cats: {
                spay: procedureCounts['CAT_SPAY'] || 0,
                neuter: procedureCounts['CAT_NEUTER'] || 0,
              },
              communityCats: {
                spay: procedureCounts['COMMUNITY_CAT_SPAY'] || 0,
                neuter: procedureCounts['COMMUNITY_CAT_NEUTER'] || 0,
              },
            },
            counties: countyResult.rows.map(r => r.county_code).filter(Boolean),
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'GRANT_ACTIVITY_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  /**
   * GET /api/v1/reports/county/:code - Get county report
   */
  router.get(
    '/reports/county/:code',
    requirePermission(PERMISSIONS.REPORT_READ),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const countyCode = req.params.code;
        const { grantCycleId, periodStart, periodEnd } = req.query;

        if (!grantCycleId) {
          const response: ApiResponse<null> = {
            success: false,
            error: {
              code: 'GRANT_CYCLE_ID_REQUIRED',
              message: 'grantCycleId query parameter is required',
            },
          };
          res.status(400).json(response);
          return;
        }

        // Build date filter
        const dateConditions: string[] = [];
        const queryParams: unknown[] = [countyCode, grantCycleId];

        if (periodStart) {
          dateConditions.push(`v.issued_at >= $3`);
          queryParams.push(periodStart);
        }
        if (periodEnd) {
          dateConditions.push(`v.issued_at <= $${queryParams.length + 1}`);
          queryParams.push(periodEnd);
        }

        const dateFilter = dateConditions.length > 0 ? `AND ${dateConditions.join(' AND ')}` : '';

        // Get voucher stats for county
        const voucherResult = await pool.query(
          `SELECT
            COUNT(*) as issued,
            COUNT(*) FILTER (WHERE status = 'REDEEMED') as redeemed,
            COALESCE(SUM(max_reimbursement_cents) FILTER (WHERE status IN ('REDEEMED', 'INVOICED')), 0) as spent_cents,
            COALESCE(SUM(max_reimbursement_cents) FILTER (WHERE status = 'ISSUED'), 0) as remaining_cents
          FROM vouchers_projection v
          JOIN grant_balances_projection g ON v.grant_id = g.grant_id
          WHERE v.county_code = $1 AND g.grant_cycle_id = $2 ${dateFilter}`,
          queryParams
        );

        // Get procedure counts
        const procedureParams = [countyCode, grantCycleId];
        if (periodStart) procedureParams.push(periodStart as string);
        if (periodEnd) procedureParams.push(periodEnd as string);

        const procDateFilter = periodStart || periodEnd
          ? `AND c.date_of_service >= ${periodStart ? `$3` : 'c.date_of_service'} AND c.date_of_service <= ${periodEnd ? `$${procedureParams.length}` : 'c.date_of_service'}`
          : '';

        const procedureResult = await pool.query(
          `SELECT
            c.procedure_code,
            COUNT(*) as count
          FROM claims_projection c
          JOIN vouchers_projection v ON c.voucher_id = v.voucher_id
          WHERE v.county_code = $1 AND c.grant_cycle_id = $2
            AND c.status IN ('APPROVED', 'INVOICED')
            ${procDateFilter}
          GROUP BY c.procedure_code`,
          procedureParams
        );

        const procedureCounts: Record<string, number> = {};
        for (const row of procedureResult.rows) {
          procedureCounts[row.procedure_code] = parseInt(row.count);
        }

        const vr = voucherResult.rows[0];

        const response: ApiResponse<CountyReportResponse> = {
          success: true,
          data: {
            countyCode,
            grantCycleId: grantCycleId as string,
            periodStart: (periodStart as string) || '',
            periodEnd: (periodEnd as string) || '',
            vouchers: {
              issued: parseInt(vr.issued || 0),
              redeemed: parseInt(vr.redeemed || 0),
              spentCents: (vr.spent_cents || 0).toString(),
              remainingCents: (vr.remaining_cents || 0).toString(),
            },
            procedures: {
              dogSpay: procedureCounts['DOG_SPAY'] || 0,
              dogNeuter: procedureCounts['DOG_NEUTER'] || 0,
              catSpay: procedureCounts['CAT_SPAY'] || 0,
              catNeuter: procedureCounts['CAT_NEUTER'] || 0,
            },
          },
        };

        res.json(response);
      } catch (error) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'COUNTY_REPORT_ERROR',
            message: (error as Error).message,
          },
        };
        res.status(500).json(response);
      }
    }
  );

  return router;
}
