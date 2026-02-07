import { Pool, PoolClient } from 'pg';
import { EventStore, Watermark, DomainEvent } from '../event-store';

const PHASE1_ALLOWED_EVENTS = new Set([
  'APPLICATION_STARTED',
  'APPLICATION_FIELD_RECORDED',
  'APPLICATION_FIELD_CLEARED',
  'APPLICATION_SECTION_COMPLETED',
  'APPLICATION_LIRP_MODE_SET',
  'APPLICATION_PRIORITY_FACTORS_COMPUTED',
  'ATTACHMENT_ADDED',
  'ATTACHMENT_REMOVED',
  'ATTESTATION_RECORDED',
  'APPLICATION_SUBMITTED',
  'SUBMISSION_DEADLINE_ENFORCED',
  'APPLICATION_EVENT_REJECTED',
  'APPLICATION_APPROVED',
  'APPLICATION_DENIED',
  'APPLICATION_EXPORT_GENERATED',
  'SUBMISSION_TOKEN_ISSUED',
  'SUBMISSION_TOKEN_CONSUMED',
  'APPLICATION_SUBMISSION_REJECTED',
]);

interface ApplicationState {
  applicationId: string;
  granteeId: string;
  grantCycleId: string;
}

interface ProjectionWatermark {
  rebuiltAt: Date;
  watermarkIngestedAt: Date;
  watermarkEventId: string;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`MISSING_REQUIRED_FIELD:${field}`);
  }
  return value;
}

function isPhase1Event(event: DomainEvent): boolean {
  return PHASE1_ALLOWED_EVENTS.has(event.eventType);
}

function applyApplicationEvent(
  state: Map<string, ApplicationState>,
  event: DomainEvent
): void {
  const data = event.eventData as Record<string, unknown>;

  if (event.eventType === 'APPLICATION_STARTED') {
    const applicationId = requireString(data.applicationId, 'applicationId');
    const granteeId = requireString(data.granteeId, 'granteeId');
    const grantCycleId = requireString(data.cycleId, 'cycleId');
    if (event.aggregateId && event.aggregateId !== applicationId) {
      throw new Error(`APPLICATION_AGGREGATE_MISMATCH:${event.aggregateId}`);
    }
    if (event.grantCycleId !== grantCycleId) {
      throw new Error(`GRANT_CYCLE_MISMATCH:${event.grantCycleId}`);
    }

    if (state.has(applicationId)) {
      throw new Error(`APPLICATION_ALREADY_STARTED:${applicationId}`);
    }

    state.set(applicationId, {
      applicationId,
      granteeId,
      grantCycleId,
    });
    return;
  }

  if (!event.eventType.startsWith('APPLICATION_') && !event.eventType.startsWith('ATTACHMENT_') && event.eventType !== 'ATTESTATION_RECORDED') {
    return;
  }

  const applicationId = requireString(data.applicationId, 'applicationId');
  if (event.aggregateId && event.aggregateId !== applicationId) {
    throw new Error(`APPLICATION_AGGREGATE_MISMATCH:${event.aggregateId}`);
  }
  if (!state.has(applicationId)) {
    throw new Error(`APPLICATION_STATE_MISSING:${applicationId}`);
  }
}

async function insertApplicationsProjection(
  client: PoolClient,
  applications: Map<string, ApplicationState>,
  watermark: ProjectionWatermark
): Promise<void> {
  for (const app of applications.values()) {
    await client.query(
      `
      INSERT INTO applications_projection (
        application_id,
        grantee_id,
        grant_cycle_id,
        organization_name,
        organization_type,
        requested_amount_cents,
        match_commitment_cents,
        match_level,
        status,
        completeness_percent,
        priority_score,
        rebuilt_at,
        watermark_ingested_at,
        watermark_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        app.applicationId,
        app.granteeId,
        app.grantCycleId,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        watermark.rebuiltAt,
        watermark.watermarkIngestedAt,
        watermark.watermarkEventId,
      ]
    );
  }
}

async function truncateProjections(client: PoolClient): Promise<void> {
  await client.query('TRUNCATE TABLE applications_projection, grant_balances_projection, vouchers_projection');
}

function computeWatermark(lastEvent: DomainEvent | null, rebuiltAt: Date): ProjectionWatermark {
  if (!lastEvent) {
    return {
      rebuiltAt,
      watermarkIngestedAt: Watermark.ZERO.ingestedAt,
      watermarkEventId: Watermark.ZERO.eventId,
    };
  }

  return {
    rebuiltAt,
    watermarkIngestedAt: lastEvent.ingestedAt,
    watermarkEventId: lastEvent.eventId,
  };
}

export async function rebuildAllProjections(pool: Pool): Promise<void> {
  const store = new EventStore(pool);
  const applications = new Map<string, ApplicationState>();

  let watermark = Watermark.ZERO;
  let lastEvent: DomainEvent | null = null;

  while (true) {
    const events = await store.fetchSince(watermark, 1000);
    if (events.length === 0) {
      break;
    }

    for (const event of events) {
      if (isPhase1Event(event)) {
        applyApplicationEvent(applications, event);
      }
      lastEvent = event;
    }

    watermark = Watermark.from(events[events.length - 1]);
  }

  const rebuiltAt = new Date();
  const projectionWatermark = computeWatermark(lastEvent, rebuiltAt);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await truncateProjections(client);
    await insertApplicationsProjection(client, applications, projectionWatermark);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
