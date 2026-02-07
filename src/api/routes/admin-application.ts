import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { FraudDetectionService } from '../../domain/application/fraud-detection';
import { FraudSeverity } from '../../domain/application/application-types';

// Fixed admin org for WVSNP program administration
const ADMIN_ORG_ID = '550e8400-e29b-41d4-a716-446655440000'; // WVSNP Program Org

export function createAdminApplicationRouter(pool: Pool): Router {
  const router = Router();
  const fraudService = new FraudDetectionService();

  /**
   * GET /admin/applications/queue
   * Gets applications queue for admin review
   */
  router.get('/queue', async (req: Request, res: Response) => {
    try {
      // TODO: Add admin authentication middleware
      // For now, assume authenticated admin context

      const { status = 'SUBMITTED', limit = '50', offset = '0' } = req.query;

      const client = await pool.connect();
      try {
        const result = await client.query(`
          SELECT
            application_id,
            grantee_id,
            grant_cycle_id,
            organization_name,
            organization_type,
            requested_amount_cents,
            match_commitment_cents,
            status,
            completeness_percent,
            priority_score,
            submitted_at,
            evidence_refs,
            fraud_signals
          FROM applications_projection
          WHERE status = $1
          ORDER BY submitted_at ASC
          LIMIT $2 OFFSET $3
        `, [status, parseInt(limit as string), parseInt(offset as string)]);

        const applications = result.rows.map(row => ({
          applicationId: row.application_id,
          granteeId: row.grantee_id,
          grantCycleId: row.grant_cycle_id,
          organizationName: row.organization_name,
          organizationType: row.organization_type,
          requestedAmountCents: row.requested_amount_cents,
          matchCommitmentCents: row.match_commitment_cents,
          status: row.status,
          completenessPercent: row.completeness_percent,
          priorityScore: row.priority_score,
          submittedAt: row.submitted_at,
          evidenceCount: Array.isArray(row.evidence_refs) ? row.evidence_refs.length : 0,
          fraudSignalsCount: Array.isArray(row.fraud_signals) ? row.fraud_signals.length : 0,
          criticalFraudSignalsCount: Array.isArray(row.fraud_signals)
            ? row.fraud_signals.filter((s: any) => s.severity === 'HIGH' || s.severity === 'CRITICAL').length
            : 0
        }));

        res.status(200).json({
          success: true,
          data: {
            applications,
            pagination: {
              limit: parseInt(limit as string),
              offset: parseInt(offset as string),
              count: applications.length
            }
          }
        });

      } finally {
        client.release();
      }

    } catch (error: any) {
      console.error('Admin applications queue error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve applications queue'
        }
      });
    }
  });

  /**
   * GET /admin/applications/:applicationId
   * Gets detailed application information for admin review
   */
  router.get('/:applicationId', async (req: Request, res: Response) => {
    try {
      const { applicationId } = req.params;

      const client = await pool.connect();
      try {
        // Get application details
        const appResult = await client.query(`
          SELECT * FROM applications_projection WHERE application_id = $1
        `, [applicationId]);

        if (appResult.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: {
              code: 'APPLICATION_NOT_FOUND',
              message: 'Application not found'
            }
          });
        }

        const application = appResult.rows[0];

        // Get evidence details
        const evidenceResult = await client.query(`
          SELECT
            er.evidence_ref_id,
            er.evidence_type,
            er.file_name,
            er.mime_type,
            er.size_bytes,
            er.sha256,
            er.storage_key,
            er.uploaded_at
          FROM evidence_refs er
          WHERE er.application_id = $1
          ORDER BY er.uploaded_at ASC
        `, [applicationId]);

        // Get event history for audit trail
        const eventResult = await client.query(`
          SELECT
            event_type,
            event_data,
            occurred_at,
            actor_id,
            actor_type
          FROM event_log
          WHERE aggregate_id = $1 AND aggregate_type = 'APPLICATION'
          ORDER BY occurred_at ASC
        `, [applicationId]);

        const detailedApplication = {
          applicationId: application.application_id,
          granteeId: application.grantee_id,
          grantCycleId: application.grant_cycle_id,
          organizationName: application.organization_name,
          organizationType: application.organization_type,
          requestedAmountCents: application.requested_amount_cents,
          matchCommitmentCents: application.match_commitment_cents,
          status: application.status,
          completenessPercent: application.completeness_percent,
          priorityScore: application.priority_score,
          submittedAt: application.submitted_at,
          decisionAt: application.decision_at,
          evidence: evidenceResult.rows.map(row => ({
            evidenceRefId: row.evidence_ref_id,
            evidenceType: row.evidence_type,
            fileName: row.file_name,
            mimeType: row.mime_type,
            sizeBytes: row.size_bytes,
            sha256: row.sha256,
            storageKey: row.storage_key,
            uploadedAt: row.uploaded_at
          })),
          fraudSignals: Array.isArray(application.fraud_signals) ? application.fraud_signals : [],
          eventHistory: eventResult.rows.map(row => ({
            eventType: row.event_type,
            eventData: row.event_data,
            occurredAt: row.occurred_at,
            actorId: row.actor_id,
            actorType: row.actor_type
          }))
        };

        res.status(200).json({
          success: true,
          data: detailedApplication
        });

      } finally {
        client.release();
      }

    } catch (error: any) {
      console.error('Admin application details error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve application details'
        }
      });
    }
  });

  /**
   * GET /admin/fraud-alerts
   * Gets fraud alerts queue for admin review
   */
  router.get('/fraud-alerts', async (req: Request, res: Response) => {
    try {
      const { severity, limit = '50', offset = '0' } = req.query;

      const severityFilter = severity ? (severity as string).split(',').map(s => s.trim().toUpperCase() as FraudSeverity) : undefined;

      const alerts = await fraudService.getFraudAlerts(pool, {
        severity: severityFilter,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      });

      res.status(200).json({
        success: true,
        data: {
          alerts,
          pagination: {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            count: alerts.length
          }
        }
      });

    } catch (error: any) {
      console.error('Fraud alerts error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve fraud alerts'
        }
      });
    }
  });

  /**
   * POST /admin/fraud-alerts/:signalId/acknowledge
   * Acknowledges a fraud signal
   */
  router.post('/fraud-alerts/:signalId/acknowledge', async (req: Request, res: Response) => {
    try {
      const { signalId } = req.params;
      const { adminActorId } = req.body;

      if (!adminActorId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_ADMIN_ACTOR_ID',
            message: 'adminActorId is required'
          }
        });
      }

      await fraudService.acknowledgeFraudSignal(pool, signalId, adminActorId);

      res.status(200).json({
        success: true,
        data: { signalId, acknowledged: true }
      });

    } catch (error: any) {
      console.error('Acknowledge fraud signal error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to acknowledge fraud signal'
        }
      });
    }
  });

  /**
   * GET /admin/statistics/fraud
   * Gets fraud statistics for dashboard
   */
  router.get('/statistics/fraud', async (req: Request, res: Response) => {
    try {
      const { grantCycleId } = req.query;

      const statistics = await fraudService.getFraudStatistics(
        pool,
        grantCycleId as string | undefined
      );

      res.status(200).json({
        success: true,
        data: statistics
      });

    } catch (error: any) {
      console.error('Fraud statistics error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve fraud statistics'
        }
      });
    }
  });

  /**
   * GET /admin/statistics/applications
   * Gets application statistics for dashboard
   */
  router.get('/statistics/applications', async (req: Request, res: Response) => {
    try {
      const { grantCycleId } = req.query;

      const client = await pool.connect();
      try {
        const cycleFilter = grantCycleId ? 'WHERE grant_cycle_id = $1' : '';
        const params = grantCycleId ? [grantCycleId] : [];

        const result = await client.query(`
          SELECT
            COUNT(*) as total_applications,
            COUNT(CASE WHEN status = 'DRAFT' THEN 1 END) as draft_applications,
            COUNT(CASE WHEN status = 'SUBMITTED' THEN 1 END) as submitted_applications,
            COUNT(CASE WHEN status = 'UNDER_REVIEW' THEN 1 END) as under_review_applications,
            COUNT(CASE WHEN status = 'AWARDED' THEN 1 END) as awarded_applications,
            COUNT(CASE WHEN status = 'DENIED' THEN 1 END) as denied_applications,
            COUNT(CASE WHEN status = 'WAITLISTED' THEN 1 END) as waitlisted_applications,
            SUM(requested_amount_cents) as total_requested_cents,
            AVG(requested_amount_cents) as average_requested_cents
          FROM applications_projection
          ${cycleFilter}
        `, params);

        const stats = result.rows[0];

        res.status(200).json({
          success: true,
          data: {
            totalApplications: parseInt(stats.total_applications) || 0,
            draftApplications: parseInt(stats.draft_applications) || 0,
            submittedApplications: parseInt(stats.submitted_applications) || 0,
            underReviewApplications: parseInt(stats.under_review_applications) || 0,
            awardedApplications: parseInt(stats.awarded_applications) || 0,
            deniedApplications: parseInt(stats.denied_applications) || 0,
            waitlistedApplications: parseInt(stats.waitlisted_applications) || 0,
            totalRequestedAmountCents: stats.total_requested_cents || '0',
            averageRequestedAmountCents: stats.average_requested_cents || '0'
          }
        });

      } finally {
        client.release();
      }

    } catch (error: any) {
      console.error('Application statistics error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve application statistics'
        }
      });
    }
  });

  return router;
}
