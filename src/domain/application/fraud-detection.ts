import { Pool } from 'pg';
import { FraudSignal, FraudSeverity, ApplicationId } from './application-types';

export interface FraudDetectionContext {
  applicationId: ApplicationId;
  grantCycleId: string;
  granteeId: string;
  organizationName: string;
  organizationType: string;
  requestedAmountCents: bigint;
  actorId: string;
  occurredAt: Date;
}

export interface FraudSignalTemplate {
  signalCode: string;
  severity: FraudSeverity;
  evidence: (context: FraudDetectionContext) => Record<string, any>;
  condition: (context: FraudDetectionContext, pool: Pool) => Promise<boolean>;
  recommendedAction: string;
}

export class FraudDetectionService {
  private readonly signalTemplates: FraudSignalTemplate[] = [
    {
      signalCode: 'DUPLICATE_APPLICATION_SAME_GRANTEE',
      severity: 'HIGH',
      evidence: (ctx) => ({
        granteeId: ctx.granteeId,
        grantCycleId: ctx.grantCycleId,
        organizationName: ctx.organizationName
      }),
      condition: async (ctx, pool) => {
        const client = await pool.connect();
        try {
          const result = await client.query(`
            SELECT COUNT(*) as count
            FROM applications_projection
            WHERE grantee_id = $1 AND grant_cycle_id = $2 AND status != 'DENIED'
          `, [ctx.granteeId, ctx.grantCycleId]);

          return parseInt(result.rows[0].count) > 0;
        } finally {
          client.release();
        }
      },
      recommendedAction: 'Review for duplicate submission from same organization'
    },

    {
      signalCode: 'SUSPICIOUSLY_SHORT_ORG_NAME',
      severity: 'MEDIUM',
      evidence: (ctx) => ({
        organizationName: ctx.organizationName,
        length: ctx.organizationName.length
      }),
      condition: async (ctx) => {
        return ctx.organizationName.trim().length < 5;
      },
      recommendedAction: 'Verify organization legitimacy and contact information'
    },

    {
      signalCode: 'UNUSUALLY_HIGH_REQUEST_AMOUNT',
      severity: 'MEDIUM',
      evidence: (ctx) => ({
        requestedAmountCents: ctx.requestedAmountCents.toString(),
        organizationType: ctx.organizationType
      }),
      condition: async (ctx) => {
        // Flag requests over $50K for most organization types
        const threshold = 50_000_00; // $50,000 in cents
        return ctx.requestedAmountCents > threshold;
      },
      recommendedAction: 'Review funding request amount against organization capacity'
    },

    {
      signalCode: 'RAPID_SUCCESSIVE_APPLICATIONS',
      severity: 'LOW',
      evidence: (ctx) => ({
        actorId: ctx.actorId,
        occurredAt: ctx.occurredAt.toISOString()
      }),
      condition: async (ctx, pool) => {
        const client = await pool.connect();
        try {
          // Check for applications from same actor in last 24 hours
          const oneDayAgo = new Date(ctx.occurredAt.getTime() - 24 * 60 * 60 * 1000);
          const result = await client.query(`
            SELECT COUNT(*) as count
            FROM event_log
            WHERE actor_id = $1
              AND event_type = 'APPLICATION_STARTED'
              AND occurred_at > $2
              AND aggregate_id != $3
          `, [ctx.actorId, oneDayAgo, ctx.applicationId]);

          return parseInt(result.rows[0].count) > 0;
        } finally {
          client.release();
        }
      },
      recommendedAction: 'Monitor for potential spam or automated submissions'
    },

    {
      signalCode: 'SUSPICIOUS_ORGANIZATION_TYPE_MISMATCH',
      severity: 'LOW',
      evidence: (ctx) => ({
        organizationName: ctx.organizationName,
        organizationType: ctx.organizationType
      }),
      condition: async (ctx) => {
        // Simple heuristics - can be enhanced with ML later
        const name = ctx.organizationName.toLowerCase();

        if (ctx.organizationType === 'VETERINARY_CLINIC' &&
            !name.includes('vet') && !name.includes('clinic') && !name.includes('animal')) {
          return true;
        }

        if (ctx.organizationType === 'HUMANE_SOCIETY' &&
            !name.includes('humane') && !name.includes('society') && !name.includes('animal')) {
          return true;
        }

        return false;
      },
      recommendedAction: 'Verify organization type matches provided name and description'
    }
  ];

  /**
   * Runs fraud detection on an application context
   */
  async detectFraudSignals(context: FraudDetectionContext, pool: Pool): Promise<FraudSignal[]> {
    const signals: FraudSignal[] = [];

    for (const template of this.signalTemplates) {
      try {
        const conditionMet = await template.condition(context, pool);
        if (conditionMet) {
          const signal: FraudSignal = {
            signalId: crypto.randomUUID(),
            signalCode: template.signalCode,
            severity: template.severity,
            evidence: template.evidence(context),
            detectedAt: new Date(),
            recommendedAction: template.recommendedAction
          };
          signals.push(signal);
        }
      } catch (error) {
        // Log error but don't fail the entire detection process
        console.error(`Fraud detection error for ${template.signalCode}:`, error);
      }
    }

    return signals;
  }

  /**
   * Gets fraud alerts for admin review
   */
  async getFraudAlerts(pool: Pool, options: {
    severity?: FraudSeverity[];
    limit?: number;
    offset?: number;
  } = {}): Promise<any[]> {
    const client = await pool.connect();
    try {
      const { severity = [], limit = 50, offset = 0 } = options;

      let severityFilter = '';
      if (severity.length > 0) {
        const placeholders = severity.map((_, i) => `$${i + 3}`).join(',');
        severityFilter = `AND fs.severity IN (${placeholders})`;
      }

      const query = `
        SELECT
          fs.signal_id,
          fs.signal_code,
          fs.severity,
          fs.evidence,
          fs.detected_at,
          fs.recommended_action,
          ap.application_id,
          ap.organization_name,
          ap.organization_type,
          ap.requested_amount_cents,
          ap.status as application_status,
          ap.submitted_at
        FROM fraud_signals fs
        JOIN applications_projection ap ON fs.application_id = ap.application_id
        WHERE ap.status IN ('SUBMITTED', 'UNDER_REVIEW')
        ${severityFilter}
        ORDER BY fs.detected_at DESC
        LIMIT $${severity.length + 1} OFFSET $${severity.length + 2}
      `;

      const params = [...severity.map(s => s.toUpperCase()), limit, offset];
      const result = await client.query(query, params);

      return result.rows.map(row => ({
        signalId: row.signal_id,
        signalCode: row.signal_code,
        severity: row.severity,
        evidence: row.evidence,
        detectedAt: row.detected_at,
        recommendedAction: row.recommended_action,
        application: {
          applicationId: row.application_id,
          organizationName: row.organization_name,
          organizationType: row.organization_type,
          requestedAmountCents: row.requested_amount_cents,
          status: row.application_status,
          submittedAt: row.submitted_at
        }
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Acknowledges a fraud signal (admin action)
   */
  async acknowledgeFraudSignal(pool: Pool, signalId: string, adminActorId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mark signal as acknowledged
      await client.query(`
        UPDATE fraud_signals
        SET acknowledged_at = NOW(), acknowledged_by = $2
        WHERE signal_id = $1
      `, [signalId, adminActorId]);

      // Emit audit event
      await client.query(`
        INSERT INTO event_log (
          event_id, event_type, aggregate_id, aggregate_type,
          event_data, occurred_at, ingested_at, correlation_id, causation_id,
          actor_id, actor_type
        ) VALUES (
          $1, 'FRAUD_SIGNAL_ACKNOWLEDGED', $2, 'APPLICATION',
          $3, NOW(), NOW(), $4, NULL, $5, 'ADMIN'
        )
      `, [
        crypto.randomUUID(),
        signalId,
        JSON.stringify({ signalId, acknowledgedBy: adminActorId }),
        crypto.randomUUID(),
        adminActorId
      ]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Gets fraud statistics for dashboard
   */
  async getFraudStatistics(pool: Pool, grantCycleId?: string): Promise<any> {
    const client = await pool.connect();
    try {
      const cycleFilter = grantCycleId ? 'AND ap.grant_cycle_id = $1' : '';
      const params = grantCycleId ? [grantCycleId] : [];

      const result = await client.query(`
        SELECT
          COUNT(*) as total_signals,
          COUNT(CASE WHEN fs.severity = 'CRITICAL' THEN 1 END) as critical_signals,
          COUNT(CASE WHEN fs.severity = 'HIGH' THEN 1 END) as high_signals,
          COUNT(CASE WHEN fs.severity = 'MEDIUM' THEN 1 END) as medium_signals,
          COUNT(CASE WHEN fs.severity = 'LOW' THEN 1 END) as low_signals,
          COUNT(CASE WHEN acknowledged_at IS NOT NULL THEN 1 END) as acknowledged_signals,
          COUNT(CASE WHEN acknowledged_at IS NULL THEN 1 END) as unacknowledged_signals
        FROM fraud_signals fs
        JOIN applications_projection ap ON fs.application_id = ap.application_id
        WHERE ap.status IN ('SUBMITTED', 'UNDER_REVIEW')
        ${cycleFilter}
      `, params);

      return result.rows[0];
    } finally {
      client.release();
    }
  }
}
