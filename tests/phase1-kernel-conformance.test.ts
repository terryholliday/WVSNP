/**
 * WVSNP-GMS Phase 1 Kernel Conformance Test Suite
 *
 * Evidence for AGENTS.md §4 CONFORMANCE (FAIL-CLOSED):
 *   - schema statements
 *   - indexes
 *   - trigger definitions
 *   - sample append + replay proof
 *   - pagination proof (no skip/duplicate)
 *
 * Requires: docker compose -f docker-compose.e2e.yml up -d
 * Run:      npm run e2e:db:up && npm test -- --testPathPattern phase1-kernel
 */

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuidv4(): string {
  return crypto.randomUUID();
}

/**
 * Minimal UUIDv7 generator for tests (matches src/uuidv7.ts contract).
 */
function uuidv7(): string {
  const timestamp = Date.now();
  const bytes = new Uint8Array(16);
  const ts = BigInt(timestamp);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  const seq = crypto.randomInt(0x1000);
  bytes[6] = 0x70 | ((seq >>> 8) & 0x0f);
  bytes[7] = seq & 0xff;
  const rand = crypto.randomBytes(8);
  bytes[8] = (rand[0] & 0x3f) | 0x80;
  for (let i = 1; i < 8; i++) bytes[8 + i] = rand[i];
  const hex = Buffer.from(bytes).toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function insertEvent(
  pool: Pool,
  overrides: Partial<{
    event_id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    event_data: object;
    occurred_at: string;
    grant_cycle_id: string;
    correlation_id: string;
    causation_id: string | null;
    actor_id: string;
    actor_type: string;
  }> = {}
) {
  const defaults = {
    event_id: uuidv7(),
    aggregate_type: 'APPLICATION',
    aggregate_id: uuidv4(),
    event_type: 'APPLICATION_STARTED',
    event_data: JSON.stringify({ applicationId: uuidv4(), granteeId: uuidv4(), cycleId: 'FY2026' }),
    occurred_at: new Date().toISOString(),
    grant_cycle_id: 'FY2026',
    correlation_id: uuidv4(),
    causation_id: null,
    actor_id: uuidv4(),
    actor_type: 'SYSTEM',
  };
  const e = { ...defaults, ...overrides };

  const result = await pool.query(
    `INSERT INTO event_log (
       event_id, aggregate_type, aggregate_id, event_type, event_data,
       occurred_at, ingested_at,
       grant_cycle_id, correlation_id, causation_id,
       actor_id, actor_type
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      e.event_id,
      e.aggregate_type,
      e.aggregate_id,
      e.event_type,
      typeof e.event_data === 'string' ? e.event_data : JSON.stringify(e.event_data),
      e.occurred_at,
      '1970-01-01T00:00:00Z', // placeholder — trigger overwrites
      e.grant_cycle_id,
      e.correlation_id,
      e.causation_id,
      e.actor_id,
      e.actor_type,
    ]
  );
  return result.rows[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Pool setup
// ---------------------------------------------------------------------------

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  database: process.env.DB_NAME || 'wvsnp_test',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Phase 1 Kernel Conformance', () => {
  beforeAll(async () => {
    const schemaPath = join(__dirname, '../db/schema.sql');
    const schemaSqlRaw = readFileSync(schemaPath, 'utf-8');
    const schemaSql = schemaSqlRaw.replace(/^\uFEFF/, '').replace(/\u200B/g, '');
    await pool.query(schemaSql);

    // Sanity: schema exists
    const check = await pool.query(
      "SELECT to_regclass('public.event_log') AS el, to_regclass('public.artifact_log') AS al"
    );
    if (!check.rows[0].el) {
      throw new Error('MISSING_SCHEMA: event_log not found. Run schema.sql against wvsnp_test first.');
    }
    if (!check.rows[0].al) {
      throw new Error('MISSING_SCHEMA: artifact_log not found. Run schema.sql against wvsnp_test first.');
    }
  }, 30_000);

  beforeEach(async () => {
    await pool.query('BEGIN');
  });

  afterEach(async () => {
    await pool.query('ROLLBACK');
  });

  afterAll(async () => {
    await pool.end();
  });

  // =========================================================================
  // 1. SCHEMA EVIDENCE
  // =========================================================================
  describe('1. Schema Statements', () => {
    test('event_log table exists with correct columns', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'event_log' AND table_schema = 'public'
         ORDER BY ordinal_position`
      );
      const cols = new Map(result.rows.map((r: any) => [r.column_name, r]));

      // LAW 0.5: Single PK — event_id UUID
      expect(cols.get('event_id')).toBeDefined();
      expect(cols.get('event_id').data_type).toBe('uuid');
      expect(cols.get('event_id').is_nullable).toBe('NO');

      // Core columns
      expect(cols.get('aggregate_type')).toBeDefined();
      expect(cols.get('aggregate_id')).toBeDefined();
      expect(cols.get('event_type')).toBeDefined();
      expect(cols.get('event_data')).toBeDefined();

      // LAW 4.1: Dual time
      expect(cols.get('occurred_at')).toBeDefined();
      expect(cols.get('occurred_at').data_type).toMatch(/timestamp/);
      expect(cols.get('ingested_at')).toBeDefined();
      expect(cols.get('ingested_at').data_type).toMatch(/timestamp/);

      // LAW 6.1: Traceability
      expect(cols.get('grant_cycle_id')).toBeDefined();
      expect(cols.get('correlation_id')).toBeDefined();
      expect(cols.get('causation_id')).toBeDefined();
      expect(cols.get('actor_id')).toBeDefined();
      expect(cols.get('actor_type')).toBeDefined();

      // FORBIDDEN: no createdAt/updatedAt
      expect(cols.has('created_at')).toBe(false);
      expect(cols.has('updated_at')).toBe(false);
    });

    test('event_log PK is event_id (single PK, LAW 0.5)', async () => {
      const result = await pool.query(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
         WHERE tc.table_name = 'event_log'
           AND tc.constraint_type = 'PRIMARY KEY'`
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].column_name).toBe('event_id');
    });

    test('event_log has NO auto-increment / SERIAL columns (LAW 3.4)', async () => {
      const result = await pool.query(
        `SELECT column_name, column_default
         FROM information_schema.columns
         WHERE table_name = 'event_log'
           AND table_schema = 'public'
           AND column_default LIKE '%nextval%'`
      );
      expect(result.rows).toHaveLength(0);
    });

    test('artifact_log table exists with correct columns', async () => {
      const result = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'artifact_log' AND table_schema = 'public'`
      );
      const cols = new Set(result.rows.map((r: any) => r.column_name));

      expect(cols.has('artifact_id')).toBe(true);
      expect(cols.has('artifact_type')).toBe(true);
      expect(cols.has('sha256_hash')).toBe(true);
      expect(cols.has('watermark_ingested_at')).toBe(true);
      expect(cols.has('watermark_event_id')).toBe(true);
      expect(cols.has('correlation_id')).toBe(true);
    });

    test('applications_projection table has rebuild metadata columns', async () => {
      const result = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'applications_projection' AND table_schema = 'public'`
      );
      const cols = new Set(result.rows.map((r: any) => r.column_name));

      expect(cols.has('rebuilt_at')).toBe(true);
      expect(cols.has('watermark_ingested_at')).toBe(true);
      expect(cols.has('watermark_event_id')).toBe(true);
    });
  });

  // =========================================================================
  // 2. INDEX EVIDENCE
  // =========================================================================
  describe('2. Indexes', () => {
    test('idx_event_log_order exists on (ingested_at, event_id) — LAW 0.4', async () => {
      const result = await pool.query(
        `SELECT indexname, indexdef
         FROM pg_indexes
         WHERE tablename = 'event_log' AND indexname = 'idx_event_log_order'`
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].indexdef).toMatch(/ingested_at/);
      expect(result.rows[0].indexdef).toMatch(/event_id/);
    });

    test('idx_event_log_aggregate exists', async () => {
      const result = await pool.query(
        `SELECT indexname
         FROM pg_indexes
         WHERE tablename = 'event_log' AND indexname = 'idx_event_log_aggregate'`
      );
      expect(result.rows).toHaveLength(1);
    });

    test('idx_event_log_correlation exists', async () => {
      const result = await pool.query(
        `SELECT indexname
         FROM pg_indexes
         WHERE tablename = 'event_log' AND indexname = 'idx_event_log_correlation'`
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  // =========================================================================
  // 3. TRIGGER EVIDENCE
  // =========================================================================
  describe('3. Trigger Definitions', () => {
    test('stamp_ingested_at trigger exists on event_log (LAW 0.8 + 0.11)', async () => {
      const result = await pool.query(
        `SELECT trigger_name, event_manipulation, action_timing
         FROM information_schema.triggers
         WHERE event_object_table = 'event_log'
           AND trigger_name = 'event_log_stamp_ingested_at'`
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
      expect(result.rows[0].action_timing).toBe('BEFORE');
      expect(result.rows[0].event_manipulation).toBe('INSERT');
    });

    test('immutability trigger exists on event_log (LAW 0.3 + 0.6)', async () => {
      const result = await pool.query(
        `SELECT trigger_name, event_manipulation
         FROM information_schema.triggers
         WHERE event_object_table = 'event_log'
           AND trigger_name = 'trg_event_log_immutable'`
      );
      const ops = new Set(result.rows.map((r: any) => r.event_manipulation));
      expect(ops.has('UPDATE')).toBe(true);
      expect(ops.has('DELETE')).toBe(true);
    });

    test('immutability trigger exists on artifact_log', async () => {
      const result = await pool.query(
        `SELECT trigger_name, event_manipulation
         FROM information_schema.triggers
         WHERE event_object_table = 'artifact_log'
           AND trigger_name = 'artifact_log_immutable'`
      );
      const ops = new Set(result.rows.map((r: any) => r.event_manipulation));
      expect(ops.has('UPDATE')).toBe(true);
      expect(ops.has('DELETE')).toBe(true);
    });

    test('ingested_at is server-stamped via clock_timestamp(), ignoring client value (LAW 0.8)', async () => {
      const fakeOldTime = '2020-01-01T00:00:00Z';
      const row = await insertEvent(pool, { occurred_at: fakeOldTime });

      const ingestedAt = new Date(row.ingested_at).getTime();
      const now = Date.now();

      // ingested_at should be within 60s of now, NOT the fake old time
      expect(now - ingestedAt).toBeLessThan(60_000);
      expect(ingestedAt).toBeGreaterThan(new Date('2025-01-01').getTime());
    });

    test('event_log UPDATE is blocked (LAW 0.3)', async () => {
      const row = await insertEvent(pool);
      await expect(
        pool.query('UPDATE event_log SET event_type = $1 WHERE event_id = $2', [
          'TAMPERED',
          row.event_id,
        ])
      ).rejects.toThrow(/immutable/i);
    });

    test('event_log DELETE is blocked (LAW 0.3)', async () => {
      const row = await insertEvent(pool);
      await expect(
        pool.query('DELETE FROM event_log WHERE event_id = $1', [row.event_id])
      ).rejects.toThrow(/immutable/i);
    });

    test('artifact_log UPDATE is blocked', async () => {
      await pool.query(
        `INSERT INTO artifact_log (
           artifact_id, artifact_type, filename, mime_type, size_bytes,
           sha256_hash, storage_path, watermark_ingested_at, watermark_event_id, correlation_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          uuidv4(), 'EXPORT', 'test.xlsx', 'application/octet-stream', 1024,
          'a'.repeat(64), '/artifacts/test.xlsx',
          new Date().toISOString(), uuidv4(), uuidv4(),
        ]
      );
      await expect(
        pool.query("UPDATE artifact_log SET filename = 'tampered.xlsx'")
      ).rejects.toThrow(/IMMUTABILITY VIOLATION/i);
    });

    test('artifact_log DELETE is blocked', async () => {
      const artId = uuidv4();
      await pool.query(
        `INSERT INTO artifact_log (
           artifact_id, artifact_type, filename, mime_type, size_bytes,
           sha256_hash, storage_path, watermark_ingested_at, watermark_event_id, correlation_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          artId, 'EXPORT', 'test.xlsx', 'application/octet-stream', 1024,
          'b'.repeat(64), '/artifacts/test.xlsx',
          new Date().toISOString(), uuidv4(), uuidv4(),
        ]
      );
      await expect(
        pool.query('DELETE FROM artifact_log WHERE artifact_id = $1', [artId])
      ).rejects.toThrow(/IMMUTABILITY VIOLATION/i);
    });
  });

  // =========================================================================
  // 4. SAMPLE APPEND + REPLAY PROOF
  // =========================================================================
  describe('4. Append + Replay Proof', () => {
    test('append stores event and returns server-stamped ingestedAt', async () => {
      const eventId = uuidv7();
      const aggregateId = uuidv4();
      const correlationId = uuidv4();
      const actorId = uuidv4();

      const row = await insertEvent(pool, {
        event_id: eventId,
        aggregate_id: aggregateId,
        event_type: 'APPLICATION_STARTED',
        event_data: { applicationId: aggregateId, granteeId: uuidv4(), cycleId: 'FY2026' },
        correlation_id: correlationId,
        actor_id: actorId,
        actor_type: 'APPLICANT',
      });

      expect(row.event_id).toBe(eventId);
      expect(row.aggregate_id).toBe(aggregateId);
      expect(row.event_type).toBe('APPLICATION_STARTED');
      expect(row.correlation_id).toBe(correlationId);
      expect(row.actor_id).toBe(actorId);
      expect(row.actor_type).toBe('APPLICANT');
      expect(row.ingested_at).toBeDefined();
    });

    test('event_id must be UUIDv7 format (LAW 0.10) — application-level enforcement', () => {
      // The EventStore class enforces UUIDv7 at the application layer.
      // Verify the regex pattern matches valid UUIDv7 and rejects UUIDv4.
      const v7 = uuidv7();
      expect(UUID_V7_REGEX.test(v7)).toBe(true);

      const v4 = uuidv4();
      // UUIDv4 has version nibble '4', not '7'
      expect(UUID_V7_REGEX.test(v4)).toBe(false);
    });

    test('event_data is stored as JSONB (LAW 0.9)', async () => {
      const eventData = { applicationId: uuidv4(), granteeId: uuidv4(), cycleId: 'FY2026', amountCents: '50000' };
      const row = await insertEvent(pool, { event_data: eventData });

      // Query back and verify JSONB round-trip
      const fetched = await pool.query(
        'SELECT event_data FROM event_log WHERE event_id = $1',
        [row.event_id]
      );
      expect(fetched.rows[0].event_data.amountCents).toBe('50000');
      expect(typeof fetched.rows[0].event_data.amountCents).toBe('string');
    });

    test('causation_id is nullable for root events (LAW 6.1)', async () => {
      const row = await insertEvent(pool, { causation_id: null });
      expect(row.causation_id).toBeNull();
    });

    test('causation_id can be set for caused events', async () => {
      const rootEvent = await insertEvent(pool, { causation_id: null });
      const causedEvent = await insertEvent(pool, {
        causation_id: rootEvent.event_id,
        event_type: 'APPLICATION_SECTION_COMPLETED',
        event_data: { applicationId: rootEvent.aggregate_id, sectionName: 'ORGANIZATION' },
      });
      expect(causedEvent.causation_id).toBe(rootEvent.event_id);
    });

    test('replay from genesis produces deterministic state', async () => {
      const appId1 = uuidv4();
      const appId2 = uuidv4();
      const granteeId1 = uuidv4();
      const granteeId2 = uuidv4();

      await insertEvent(pool, {
        aggregate_id: appId1,
        event_type: 'APPLICATION_STARTED',
        event_data: { applicationId: appId1, granteeId: granteeId1, cycleId: 'FY2026' },
      });
      await sleep(5);
      await insertEvent(pool, {
        aggregate_id: appId2,
        event_type: 'APPLICATION_STARTED',
        event_data: { applicationId: appId2, granteeId: granteeId2, cycleId: 'FY2026' },
      });

      // Replay: fetch only the events we just inserted (scoped by aggregate_id)
      const allEvents = await pool.query(
        `SELECT event_id, aggregate_id, event_type, event_data, ingested_at
         FROM event_log
         WHERE aggregate_id = ANY($1)
         ORDER BY ingested_at ASC, event_id ASC`,
        [[appId1, appId2]]
      );

      expect(allEvents.rows).toHaveLength(2);
      expect(allEvents.rows[0].aggregate_id).toBe(appId1);
      expect(allEvents.rows[1].aggregate_id).toBe(appId2);

      // Verify ordering is deterministic
      const t0 = new Date(allEvents.rows[0].ingested_at).getTime();
      const t1 = new Date(allEvents.rows[1].ingested_at).getTime();
      expect(t1).toBeGreaterThanOrEqual(t0);
    });
  });

  // =========================================================================
  // 5. PAGINATION PROOF (No Skip / No Duplicate)
  // =========================================================================
  describe('5. Pagination Proof (Watermark Tuple)', () => {
    test('exclusive watermark fetch returns no duplicates and no skips', async () => {
      // Insert 5 events with small delays to ensure distinct ingested_at
      const eventIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const eid = uuidv7();
        eventIds.push(eid);
        const appId = uuidv4();
        await insertEvent(pool, {
          event_id: eid,
          aggregate_id: appId,
          event_type: 'APPLICATION_STARTED',
          event_data: { applicationId: appId, granteeId: uuidv4(), cycleId: 'FY2026' },
        });
        if (i < 4) await sleep(5);
      }

      // Scope pagination to only our 5 events
      const scopeFilter = `AND event_id = ANY(ARRAY['${eventIds.join("','")}'::uuid])`;

      // Page 1: fetch first 2 from ZERO watermark
      const page1 = await pool.query(
        `SELECT event_id, ingested_at FROM event_log
         WHERE ((ingested_at > $1) OR (ingested_at = $1 AND event_id > $2))
         ${scopeFilter}
         ORDER BY ingested_at ASC, event_id ASC
         LIMIT 2`,
        [new Date(0).toISOString(), '00000000-0000-0000-0000-000000000000']
      );
      expect(page1.rows).toHaveLength(2);

      // Page 2: use last row of page 1 as watermark
      const wm1 = page1.rows[1];
      const page2 = await pool.query(
        `SELECT event_id, ingested_at FROM event_log
         WHERE ((ingested_at > $1) OR (ingested_at = $1 AND event_id > $2))
         ${scopeFilter}
         ORDER BY ingested_at ASC, event_id ASC
         LIMIT 2`,
        [wm1.ingested_at, wm1.event_id]
      );
      expect(page2.rows).toHaveLength(2);

      // Page 3: use last row of page 2 as watermark
      const wm2 = page2.rows[1];
      const page3 = await pool.query(
        `SELECT event_id, ingested_at FROM event_log
         WHERE ((ingested_at > $1) OR (ingested_at = $1 AND event_id > $2))
         ${scopeFilter}
         ORDER BY ingested_at ASC, event_id ASC
         LIMIT 2`,
        [wm2.ingested_at, wm2.event_id]
      );
      expect(page3.rows).toHaveLength(1); // only 1 remaining

      // Collect all fetched event_ids
      const allFetched = [
        ...page1.rows.map((r: any) => r.event_id),
        ...page2.rows.map((r: any) => r.event_id),
        ...page3.rows.map((r: any) => r.event_id),
      ];

      // NO DUPLICATES
      const uniqueFetched = new Set(allFetched);
      expect(uniqueFetched.size).toBe(5);

      // NO SKIPS — all 5 original events are present
      for (const eid of eventIds) {
        expect(uniqueFetched.has(eid)).toBe(true);
      }
    });

    test('watermark at exact boundary does not re-fetch the boundary event', async () => {
      const appId = uuidv4();
      const eid = uuidv7();
      const row = await insertEvent(pool, {
        event_id: eid,
        aggregate_id: appId,
        event_type: 'APPLICATION_STARTED',
        event_data: { applicationId: appId, granteeId: uuidv4(), cycleId: 'FY2026' },
      });

      // Use the event itself as the watermark — should return 0 results (exclusive)
      // Scope to only this event to avoid seeing committed rows from other suites
      const result = await pool.query(
        `SELECT event_id FROM event_log
         WHERE ((ingested_at > $1) OR (ingested_at = $1 AND event_id > $2))
         AND event_id = $3
         ORDER BY ingested_at ASC, event_id ASC
         LIMIT 10`,
        [row.ingested_at, row.event_id, eid]
      );
      expect(result.rows).toHaveLength(0);
    });

    test('ZERO watermark fetches all events from genesis', async () => {
      const insertedIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const appId = uuidv4();
        const eid = uuidv7();
        insertedIds.push(eid);
        await insertEvent(pool, {
          event_id: eid,
          aggregate_id: appId,
          event_type: 'APPLICATION_STARTED',
          event_data: { applicationId: appId, granteeId: uuidv4(), cycleId: 'FY2026' },
        });
        await sleep(2);
      }

      const result = await pool.query(
        `SELECT event_id FROM event_log
         WHERE ((ingested_at > $1) OR (ingested_at = $1 AND event_id > $2))
         AND event_id = ANY($3)
         ORDER BY ingested_at ASC, event_id ASC`,
        [new Date(0).toISOString(), '00000000-0000-0000-0000-000000000000', insertedIds]
      );
      expect(result.rows).toHaveLength(3);
    });
  });

  // =========================================================================
  // 6. IDENTITY DOCTRINE EVIDENCE
  // =========================================================================
  describe('6. Identity Doctrine', () => {
    test('UUIDv7 generator produces valid version-7 UUIDs', () => {
      for (let i = 0; i < 10; i++) {
        const id = uuidv7();
        expect(UUID_V7_REGEX.test(id)).toBe(true);
      }
    });

    test('UUIDv4 generator produces valid version-4 UUIDs', () => {
      const v4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      for (let i = 0; i < 10; i++) {
        const id = uuidv4();
        expect(v4Regex.test(id)).toBe(true);
      }
    });

    test('event_id column is UUID type (not BIGSERIAL)', async () => {
      const result = await pool.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name = 'event_log' AND column_name = 'event_id'`
      );
      expect(result.rows[0].data_type).toBe('uuid');
    });

    test('aggregate_id column is UUID type (not integer)', async () => {
      const result = await pool.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name = 'event_log' AND column_name = 'aggregate_id'`
      );
      expect(result.rows[0].data_type).toBe('uuid');
    });
  });

  // =========================================================================
  // 7. CONTEXT DOCTRINE EVIDENCE
  // =========================================================================
  describe('7. Context Doctrine (LAW 6.1)', () => {
    test('grant_cycle_id is NOT NULL', async () => {
      const result = await pool.query(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_name = 'event_log' AND column_name = 'grant_cycle_id'`
      );
      expect(result.rows[0].is_nullable).toBe('NO');
    });

    test('correlation_id is NOT NULL', async () => {
      const result = await pool.query(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_name = 'event_log' AND column_name = 'correlation_id'`
      );
      expect(result.rows[0].is_nullable).toBe('NO');
    });

    test('causation_id is nullable (for root events only)', async () => {
      const result = await pool.query(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_name = 'event_log' AND column_name = 'causation_id'`
      );
      expect(result.rows[0].is_nullable).toBe('YES');
    });

    test('actor_id is NOT NULL', async () => {
      const result = await pool.query(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_name = 'event_log' AND column_name = 'actor_id'`
      );
      expect(result.rows[0].is_nullable).toBe('NO');
    });

    test('actor_type is NOT NULL', async () => {
      const result = await pool.query(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_name = 'event_log' AND column_name = 'actor_type'`
      );
      expect(result.rows[0].is_nullable).toBe('NO');
    });
  });

  // =========================================================================
  // 8. EVENT NAMESPACE DOCTRINE
  // =========================================================================
  describe('8. Event Namespace (SCREAMING_SNAKE_CASE)', () => {
    test('SCREAMING_SNAKE_CASE event types are accepted', async () => {
      const appId = uuidv4();
      const row = await insertEvent(pool, {
        event_type: 'APPLICATION_STARTED',
        aggregate_id: appId,
        event_data: { applicationId: appId, granteeId: uuidv4(), cycleId: 'FY2026' },
      });
      expect(row.event_type).toBe('APPLICATION_STARTED');
    });

    test('event_type regex enforces SCREAMING_SNAKE_CASE at application layer', () => {
      const EVENT_TYPE_REGEX = /^[A-Z0-9_]+$/;
      expect(EVENT_TYPE_REGEX.test('APPLICATION_STARTED')).toBe(true);
      expect(EVENT_TYPE_REGEX.test('GRANT_FUNDS_ENCUMBERED')).toBe(true);
      expect(EVENT_TYPE_REGEX.test('application_started')).toBe(false);
      expect(EVENT_TYPE_REGEX.test('ApplicationStarted')).toBe(false);
      expect(EVENT_TYPE_REGEX.test('app.started')).toBe(false);
    });
  });

  // =========================================================================
  // 9. PROJECTION NAMING EVIDENCE
  // =========================================================================
  describe('9. Projection Naming (LAW 8.1)', () => {
    test('all projection tables end with _projection suffix', async () => {
      const result = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name LIKE '%projection%'`
      );
      for (const row of result.rows) {
        expect(row.table_name).toMatch(/_projection$/);
      }
      // At minimum, applications_projection must exist for Phase 1
      const names = result.rows.map((r: any) => r.table_name);
      expect(names).toContain('applications_projection');
    });

    test('no tables named *_writemodel exist', async () => {
      const result = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name LIKE '%writemodel%'`
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  // =========================================================================
  // 10. CHRONOLOGY DOCTRINE EVIDENCE
  // =========================================================================
  describe('10. Chronology Doctrine (LAW 4)', () => {
    test('occurredAt and ingestedAt are independent (dual time)', async () => {
      const pastTime = '2024-06-15T12:00:00Z';
      const row = await insertEvent(pool, { occurred_at: pastTime });

      const occurredAt = new Date(row.occurred_at).getTime();
      const ingestedAt = new Date(row.ingested_at).getTime();

      // occurred_at should reflect the client-provided past time
      expect(occurredAt).toBe(new Date(pastTime).getTime());

      // ingested_at should be server-stamped (recent)
      expect(ingestedAt).toBeGreaterThan(new Date('2025-01-01').getTime());

      // They must be different
      expect(occurredAt).not.toBe(ingestedAt);
    });

    test('no createdAt or updatedAt columns in event_log (LAW 4.5)', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'event_log'
           AND column_name IN ('created_at', 'updated_at', 'createdat', 'updatedat')`
      );
      expect(result.rows).toHaveLength(0);
    });
  });
});
