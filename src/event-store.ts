import { Pool } from 'pg';
import { uuidv7 } from './uuidv7';
import type { EventId, ActorId } from './domain-types';

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuidV7(value: string, field: string): void {
  if (!UUID_V7_REGEX.test(value)) {
    throw new Error(`UUID_V7_REQUIRED:${field}`);
  }
}

function assertNoBigInt(value: unknown, path: string = 'eventData'): void {
  if (typeof value === 'bigint') {
    throw new Error(`EVENT_DATA_BIGINT_FORBIDDEN:${path}`);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertNoBigInt(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertNoBigInt(child, `${path}.${key}`);
    }
  }
}

// === WATERMARK ===
export interface Watermark {
  ingestedAt: Date;
  eventId: EventId;
}

export const Watermark = {
  ZERO: {
    ingestedAt: new Date(0),
    eventId: '00000000-0000-0000-0000-000000000000' as EventId,
  } as Watermark,

  from: (event: DomainEvent): Watermark => ({
    ingestedAt: event.ingestedAt,
    eventId: event.eventId,
  }),
};

// === DOMAIN EVENT ===
export interface DomainEvent {
  eventId: EventId;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  occurredAt: Date;
  ingestedAt: Date;
  grantCycleId: string;
  correlationId: string;
  causationId: string | null;
  actorId: ActorId;
  actorType: 'APPLICANT' | 'ADMIN' | 'SYSTEM';
}

// === EVENT STORE ===
export class EventStore {
  constructor(private pool: Pool) {}

  static newEventId(): EventId {
    return uuidv7() as EventId;
  }

  async fetchSince(watermark: Watermark, limit: number = 1000): Promise<DomainEvent[]> {
    const sql = `
      SELECT
        event_id,
        aggregate_type,
        aggregate_id,
        event_type,
        event_data,
        occurred_at,
        ingested_at,
        grant_cycle_id,
        correlation_id,
        causation_id,
        actor_id,
        actor_type
      FROM event_log
      WHERE (ingested_at > $1)
         OR (ingested_at = $1 AND event_id > $2)
      ORDER BY ingested_at ASC, event_id ASC
      LIMIT $3
    `;

    const result = await this.pool.query(sql, [
      watermark.ingestedAt.toISOString(),
      watermark.eventId,
      limit,
    ]);

    return result.rows.map((row) => ({
      eventId: row.event_id as EventId,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      eventData: row.event_data,
      occurredAt: new Date(row.occurred_at),
      ingestedAt: new Date(row.ingested_at),
      grantCycleId: row.grant_cycle_id,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      actorId: row.actor_id as ActorId,
      actorType: row.actor_type,
    }));
  }

  async append(event: Omit<DomainEvent, 'ingestedAt'>): Promise<DomainEvent> {
    assertUuidV7(event.eventId, 'eventId');
    assertNoBigInt(event.eventData);

    const sql = `
      INSERT INTO event_log (
        event_id,
        aggregate_type,
        aggregate_id,
        event_type,
        event_data,
        occurred_at,
        grant_cycle_id,
        correlation_id,
        causation_id,
        actor_id,
        actor_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING ingested_at
    `;

    const result = await this.pool.query(sql, [
      event.eventId,
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      JSON.stringify(event.eventData),
      event.occurredAt.toISOString(),
      event.grantCycleId,
      event.correlationId,
      event.causationId,
      event.actorId,
      event.actorType,
    ]);

    return {
      ...event,
      ingestedAt: new Date(result.rows[0].ingested_at),
    };
  }

  async isTokenConsumed(submissionTokenId: string): Promise<boolean> {
    const sql = `
      SELECT 1 FROM event_log
      WHERE event_type = 'SUBMISSION_TOKEN_CONSUMED'
        AND event_data->>'submissionTokenId' = $1
      LIMIT 1
    `;

    const result = await this.pool.query(sql, [submissionTokenId]);
    return (result.rowCount ?? 0) > 0;
  }
}
