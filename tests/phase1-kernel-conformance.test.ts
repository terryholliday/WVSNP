/**
 * PHASE 1 KERNEL CONFORMANCE TESTS
 * WVSNP-GMS v4.5
 *
 * Proves:
 *   1. Event Log schema + immutability enforcement
 *   2. Artifact Log schema + immutability enforcement
 *   3. Append API with server-stamped ingestedAt
 *   4. Append + Replay Proof (deterministic state)
 *   5. Pagination / Watermark Tuple ordering (exclusive)
 */

import { Pool } from 'pg';
import * as crypto from 'crypto';
import { EventStore, Watermark, DomainEvent } from '../src/event-store';
import { rebuildAllProjections } from '../src/projections/rebuild';
import { truncateWithRetry } from './test-utils';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'wvsnp_test',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const store = new EventStore(pool);

// Helper: create a minimal valid APPLICATION_STARTED event
function makeAppStartedEvent(overrides: Partial<Omit<DomainEvent, 'ingestedAt'>> = {}): Omit<DomainEvent, 'ingestedAt'> {
  const applicationId = crypto.randomUUID();
  const granteeId = crypto.randomUUID();
  const grantCycleId = overrides.grantCycleId ?? crypto.randomUUID();
  return {
    eventId: EventStore.newEventId(),
    aggregateType: 'APPLICATION',
    aggregateId: applicationId,
    eventType: 'APPLICATION_STARTED',
    eventData: {
      applicationId,
      granteeId,
      cycleId: grantCycleId,
    },
    occurredAt: new Date(),
    grantCycleId,
    correlationId: crypto.randomUUID(),
    causationId: null,
    actorId: crypto.randomUUID() as any,
    actorType: 'APPLICANT',
    ...overrides,
  };
}

// Helper: small sleep to guarantee distinct ingested_at timestamps
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Phase 1 Kernel Conformance', () => {
  afterAll(async () => {
    await pool.end();
  });

  // =========================================================
  // 1. EVENT LOG SCHEMA + IMMUTABILITY
  // =========================================================
  describe('1. Event Log Schema', () => {
    beforeAll(async () => {
      await truncateWithRetry(pool, 'event_log');
    });

    test('event_log table exists with required columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'event_log'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map((r: any) => r.column_name);
      expect(columns).toContain('event_id');
      expect(columns).toContain('aggregate_type');
      expect(columns).toContain('aggregate_id');
      expect(columns).toContain('event_type');
      expect(columns).toContain('event_data');
      expect(columns).toContain('occurred_at');
      expect(columns).toContain('ingested_at');
      expect(columns).toContain('grant_cycle_id');
      expect(columns).toContain('correlation_id');
      expect(columns).toContain('causation_id');
      expect(columns).toContain('actor_id');
      expect(columns).toContain('actor_type');
    });

    test('event_id is the primary key', async () => {
      const result = await pool.query(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'event_log'
          AND tc.constraint_type = 'PRIMARY KEY'
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].column_name).toBe('event_id');
    });

    test('UPDATE on event_log is rejected (immutability)', async () => {
      const evt = makeAppStartedEvent();
      await store.append(evt);

      await expect(
        pool.query(
          `UPDATE event_log SET event_type = 'HACKED' WHERE event_id = $1`,
          [evt.eventId]
        )
      ).rejects.toThrow(/immutable/i);
    });

    test('DELETE on event_log is rejected (immutability)', async () => {
      const result = await pool.query('SELECT event_id FROM event_log LIMIT 1');
      if (result.rows.length > 0) {
        await expect(
          pool.query('DELETE FROM event_log WHERE event_id = $1', [result.rows[0].event_id])
        ).rejects.toThrow(/immutable/i);
      }
    });

    test('ordering index exists on (ingested_at, event_id)', async () => {
      const result = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'event_log'
          AND indexdef LIKE '%ingested_at%'
          AND indexdef LIKE '%event_id%'
      `);

      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================
  // 2. ARTIFACT LOG SCHEMA + IMMUTABILITY
  // =========================================================
  describe('2. Artifact Log Schema', () => {
    test('artifact_log table exists with required columns', async () => {
      const result = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'artifact_log'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map((r: any) => r.column_name);
      expect(columns).toContain('artifact_id');
      expect(columns).toContain('artifact_type');
      expect(columns).toContain('filename');
      expect(columns).toContain('sha256_hash');
      expect(columns).toContain('watermark_ingested_at');
      expect(columns).toContain('watermark_event_id');
    });

    test('UPDATE on artifact_log is rejected (immutability)', async () => {
      // Insert a test artifact row
      const artifactId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO artifact_log
          (artifact_id, artifact_type, filename, mime_type, size_bytes, sha256_hash, storage_path,
           watermark_ingested_at, watermark_event_id, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          artifactId, 'TEST', 'test.txt', 'text/plain', 100,
          'a'.repeat(64), '/tmp/test',
          new Date(), crypto.randomUUID(), crypto.randomUUID(),
        ]
      );

      await expect(
        pool.query(`UPDATE artifact_log SET filename = 'hacked.txt' WHERE artifact_id = $1`, [artifactId])
      ).rejects.toThrow(/IMMUTABILITY/i);
    });

    test('DELETE on artifact_log is rejected (immutability)', async () => {
      const result = await pool.query('SELECT artifact_id FROM artifact_log LIMIT 1');
      if (result.rows.length > 0) {
        await expect(
          pool.query('DELETE FROM artifact_log WHERE artifact_id = $1', [result.rows[0].artifact_id])
        ).rejects.toThrow(/IMMUTABILITY/i);
      }
    });
  });

  // =========================================================
  // 3. APPEND API + SERVER-STAMPED ingestedAt
  // =========================================================
  describe('3. Append API + Server-Stamped ingestedAt', () => {
    beforeAll(async () => {
      await truncateWithRetry(pool, 'event_log');
    });

    test('append sets server-stamped ingestedAt via trigger', async () => {
      const before = new Date();
      const evt = makeAppStartedEvent();
      const appended = await store.append(evt);
      const after = new Date();

      expect(appended.ingestedAt).toBeDefined();
      expect(appended.ingestedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
      expect(appended.ingestedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1);
    });

    test('ingestedAt is never client-supplied (trigger overwrites any value)', async () => {
      // Even if someone inserts with a bogus ingested_at, the trigger overwrites it
      const eventId = EventStore.newEventId();
      const applicationId = crypto.randomUUID();
      const grantCycleId = crypto.randomUUID();
      const bogusTime = new Date('2000-01-01T00:00:00Z');

      await pool.query(
        `INSERT INTO event_log
          (event_id, aggregate_type, aggregate_id, event_type, event_data,
           occurred_at, ingested_at, grant_cycle_id, correlation_id, causation_id,
           actor_id, actor_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          eventId, 'APPLICATION', applicationId, 'APPLICATION_STARTED',
          JSON.stringify({ applicationId, granteeId: crypto.randomUUID(), cycleId: grantCycleId }),
          new Date().toISOString(), bogusTime.toISOString(),
          grantCycleId, crypto.randomUUID(), null,
          crypto.randomUUID(), 'APPLICANT',
        ]
      );

      const result = await pool.query('SELECT ingested_at FROM event_log WHERE event_id = $1', [eventId]);
      const storedTime = new Date(result.rows[0].ingested_at);
      // The trigger should have overwritten the bogus 2000-01-01 value
      expect(storedTime.getFullYear()).toBeGreaterThanOrEqual(2025);
    });

    test('eventId must be UUIDv7 format', async () => {
      const evt = makeAppStartedEvent();
      evt.eventId = 'not-a-uuid-v7' as any;

      await expect(store.append(evt)).rejects.toThrow(/UUID_V7_REQUIRED/);
    });

    test('eventId with UUIDv4 format is rejected', async () => {
      const evt = makeAppStartedEvent();
      evt.eventId = crypto.randomUUID() as any; // UUIDv4

      await expect(store.append(evt)).rejects.toThrow(/UUID_V7_REQUIRED/);
    });

    test('event_data with BigInt values is rejected', async () => {
      const evt = makeAppStartedEvent();
      (evt.eventData as any).bigValue = BigInt(123);

      await expect(store.append(evt)).rejects.toThrow(/EVENT_DATA_BIGINT_FORBIDDEN/);
    });

    test('multiple appends produce monotonically non-decreasing ingestedAt', async () => {
      const events: DomainEvent[] = [];

      for (let i = 0; i < 3; i++) {
        const appended = await store.append(makeAppStartedEvent());
        events.push(appended);
      }

      for (let i = 1; i < events.length; i++) {
        expect(events[i].ingestedAt.getTime()).toBeGreaterThanOrEqual(
          events[i - 1].ingestedAt.getTime()
        );
      }
    });

    test('duplicate event_id is rejected (primary key)', async () => {
      const evt = makeAppStartedEvent();
      await store.append(evt);

      const dup = makeAppStartedEvent();
      dup.eventId = evt.eventId; // same PK

      await expect(store.append(dup)).rejects.toThrow();
    });
  });

  // =========================================================
  // 4. APPEND + REPLAY PROOF
  // =========================================================
  describe('4. Append + Replay Proof', () => {
    beforeAll(async () => {
      // Clean slate: truncate all tables to ensure isolation
      await truncateWithRetry(pool, 'event_log, applications_projection, grant_balances_projection, vouchers_projection');
    });

    test('replay from genesis produces deterministic state', async () => {
      const grantCycleId = crypto.randomUUID();

      // Append two APPLICATION_STARTED events
      const evt1 = makeAppStartedEvent({ grantCycleId });
      const evt2 = makeAppStartedEvent({ grantCycleId });

      await store.append(evt1);
      await sleep(5); // ensure distinct ingested_at
      await store.append(evt2);

      // Replay from genesis
      const allEvents = await store.fetchSince(Watermark.ZERO, 1000);
      expect(allEvents).toHaveLength(2);
      expect(allEvents[0].eventId).toBe(evt1.eventId);
      expect(allEvents[1].eventId).toBe(evt2.eventId);
    });

    test('rebuild projections from event log produces correct rows', async () => {
      // Events from previous test are still in event_log
      await rebuildAllProjections(pool);

      const result = await pool.query(
        'SELECT application_id, grantee_id, grant_cycle_id FROM applications_projection ORDER BY application_id'
      );

      expect(result.rows).toHaveLength(2);

      // Each row has rebuild metadata
      const meta = await pool.query(
        'SELECT rebuilt_at, watermark_ingested_at, watermark_event_id FROM applications_projection LIMIT 1'
      );
      expect(meta.rows[0].rebuilt_at).toBeDefined();
      expect(meta.rows[0].watermark_ingested_at).toBeDefined();
      expect(meta.rows[0].watermark_event_id).toBeDefined();
    });

    test('second rebuild produces identical projection state', async () => {
      const before = await pool.query(
        'SELECT application_id, grantee_id, grant_cycle_id FROM applications_projection ORDER BY application_id'
      );

      await rebuildAllProjections(pool);

      const after = await pool.query(
        'SELECT application_id, grantee_id, grant_cycle_id FROM applications_projection ORDER BY application_id'
      );

      expect(after.rows).toHaveLength(before.rows.length);
      for (let i = 0; i < before.rows.length; i++) {
        expect(after.rows[i].application_id).toBe(before.rows[i].application_id);
        expect(after.rows[i].grantee_id).toBe(before.rows[i].grantee_id);
        expect(after.rows[i].grant_cycle_id).toBe(before.rows[i].grant_cycle_id);
      }
    });
  });

  // =========================================================
  // 5. PAGINATION PROOF (WATERMARK TUPLE)
  // =========================================================
  describe('5. Pagination Proof (Watermark Tuple)', () => {
    let insertedEvents: DomainEvent[] = [];

    beforeAll(async () => {
      // Clean slate: truncate to ensure no leftover events
      await truncateWithRetry(pool, 'event_log');
      insertedEvents = [];

      // Insert 3 events with small gaps for distinct ingested_at
      for (let i = 0; i < 3; i++) {
        const appended = await store.append(makeAppStartedEvent());
        insertedEvents.push(appended);
        if (i < 2) await sleep(5);
      }
    });

    test('events are ordered by (ingested_at, event_id) ascending', async () => {
      const events = await store.fetchSince(Watermark.ZERO, 1000);

      for (let i = 1; i < events.length; i++) {
        const prev = events[i - 1];
        const curr = events[i];
        const prevTime = prev.ingestedAt.getTime();
        const currTime = curr.ingestedAt.getTime();

        expect(
          currTime > prevTime || (currTime === prevTime && curr.eventId > prev.eventId)
        ).toBe(true);
      }
    });

    test('exclusive watermark fetch returns no duplicates and no skips', async () => {
      // Fetch using watermark of the second event - should return only the third
      const watermark = Watermark.from(insertedEvents[1]);
      const page = await store.fetchSince(watermark, 1000);

      expect(page).toHaveLength(1);
      expect(page[0].eventId).toBe(insertedEvents[2].eventId);
    });

    test('sequential pagination covers all events without gaps', async () => {
      const collected: DomainEvent[] = [];
      let watermark = Watermark.ZERO;

      // Fetch one at a time
      while (true) {
        const batch = await store.fetchSince(watermark, 1);
        if (batch.length === 0) break;
        collected.push(...batch);
        watermark = Watermark.from(batch[batch.length - 1]);
      }

      expect(collected).toHaveLength(insertedEvents.length);
      for (let i = 0; i < insertedEvents.length; i++) {
        expect(collected[i].eventId).toBe(insertedEvents[i].eventId);
      }
    });

    test('watermark at exact boundary does not re-fetch the boundary event', async () => {
      // Use the last event's watermark - should return 0 events
      const watermark = Watermark.from(insertedEvents[insertedEvents.length - 1]);
      const page = await store.fetchSince(watermark, 1000);

      expect(page).toHaveLength(0);
    });

    test('ZERO watermark fetches all events from genesis', async () => {
      const all = await store.fetchSince(Watermark.ZERO, 1000);
      expect(all).toHaveLength(3);

      // Verify they match what we inserted
      for (let i = 0; i < insertedEvents.length; i++) {
        expect(all[i].eventId).toBe(insertedEvents[i].eventId);
      }
    });
  });
});
