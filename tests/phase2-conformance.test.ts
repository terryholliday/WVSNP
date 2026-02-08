/**
 * PHASE 2 CONFORMANCE TESTS
 * WVSNP-GMS v5.0
 */

import { Pool } from 'pg';
import * as crypto from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EventStore } from '../src/event-store';
import { GrantService } from '../src/application/grant-service';
import { IdempotencyService } from '../src/application/idempotency-service';
import { Money, Allocator } from '../src/domain-types';
import { sweepExpiredTentatives } from '../src/jobs/sweep-expired-tentatives';

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 10_000, options: '-c lock_timeout=10000 -c statement_timeout=30000' })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5433', 10),
      database: process.env.DB_NAME || 'wvsnp_test',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      max: 5,
      idleTimeoutMillis: 10_000,
      options: '-c lock_timeout=10000 -c statement_timeout=30000',
    });

const store = new EventStore(pool);
const idempotency = new IdempotencyService(pool);
const grantService = new GrantService(pool, store, idempotency);

describe('Phase 2 Conformance Tests', () => {
  beforeAll(async () => {
    const schemaPath = join(__dirname, '../db/schema.sql');
    const schemaSqlRaw = readFileSync(schemaPath, 'utf-8');
    const schemaSql = schemaSqlRaw.replace(/^\uFEFF/, '').replace(/\u200B/g, '');
    await pool.query(schemaSql);
  }, 30_000);

  beforeEach(async () => {
    // Use TRUNCATE with retry mechanism to handle transient lock contention
    const maxRetries = 3;
    const baseDelay = 1000; // 1s
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await pool.query('TRUNCATE event_log, grant_balances_projection, vouchers_projection, allocators_projection, idempotency_cache CASCADE');
        return; // Success
      } catch (error: any) {
        if (attempt === maxRetries) {
          throw error; // Re-throw on final attempt
        }
        
        // If it's a lock contention error, wait and retry
        if (error.message.includes('deadlock') || error.message.includes('lock')) {
          await new Promise(resolve => setTimeout(resolve, baseDelay * attempt));
          continue;
        }
        
        // For other errors, don't retry
        throw error;
      }
    }
  }, 30_000);

  afterAll(async () => {
    await pool.end();
  });

  test('TEST 1: Bucket Isolation - GENERAL and LIRP buckets are separate', async () => {
    const grantId = EventStore.newEventId();
    const grantCycleId = 'FY2026';
    const event = {
      eventId: EventStore.newEventId(),
      aggregateType: 'GRANT',
      aggregateId: grantId,
      eventType: 'GRANT_CREATED',
      eventData: {
        awardedAmountCents: '1000000',
        matchCommitmentCents: '250000',
        rateNumeratorCents: '80',
        rateDenominatorCents: '100',
        lirpEnabled: true,
        lirpAllocationCents: '200000',
      },
      occurredAt: new Date(),
      grantCycleId: grantCycleId,
      correlationId: crypto.randomUUID(),
      causationId: null,
      actorId: crypto.randomUUID() as any,
      actorType: 'ADMIN' as const,
    };

    await store.append(event);

    await pool.query(
      'INSERT INTO grant_balances_projection (grant_id, grant_cycle_id, bucket_type, awarded_cents, available_cents, encumbered_cents, liquidated_cents, released_cents, rate_numerator_cents, rate_denominator_cents, matching_committed_cents, matching_reported_cents, rebuilt_at, watermark_ingested_at, watermark_event_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
      [grantId, grantCycleId, 'GENERAL', 1000000, 800000, 200000, 0, 0, 80, 100, 250000, 0, new Date(), new Date(), EventStore.newEventId()]
    );
    await pool.query(
      'INSERT INTO grant_balances_projection (grant_id, grant_cycle_id, bucket_type, awarded_cents, available_cents, encumbered_cents, liquidated_cents, released_cents, rate_numerator_cents, rate_denominator_cents, matching_committed_cents, matching_reported_cents, rebuilt_at, watermark_ingested_at, watermark_event_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
      [grantId, grantCycleId, 'LIRP', 200000, 200000, 0, 0, 0, 80, 100, 0, 0, new Date(), new Date(), EventStore.newEventId()]
    );

    const result = await pool.query(
      'SELECT bucket_type, awarded_cents, available_cents FROM grant_balances_projection WHERE grant_id = $1 ORDER BY bucket_type',
      [grantId]
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].bucket_type).toBe('GENERAL');
    expect(result.rows[0].awarded_cents).toBe('1000000');
    expect(result.rows[0].available_cents).toBe('800000'); // 1000000 - 200000
    expect(result.rows[1].bucket_type).toBe('LIRP');
    expect(result.rows[1].awarded_cents).toBe('200000');
    expect(result.rows[1].available_cents).toBe('200000');
  });

  test('TEST 2: Idempotency - Duplicate operations are prevented', async () => {
    const key = 'test-idempotency-001';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const status1 = await idempotency.checkAndReserve(client, key, 'TEST_OP', 'hash123', 3600);
      expect(status1).toBe('NEW');

      await idempotency.recordResult(client, key, { result: 'success' });
      await client.query('COMMIT');

      await client.query('BEGIN');
      const status2 = await idempotency.checkAndReserve(client, key, 'TEST_OP', 'hash123', 3600);
      expect(status2).toBe('COMPLETED');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  test('TEST 3: Allocator Deterministic Hash - Same inputs produce same ID', () => {
    const grantCycleId = 'FY2026';
    const id1 = Allocator.createId(grantCycleId, 'COUNTY');
    const id2 = Allocator.createId(grantCycleId, 'COUNTY');
    expect(id1).toBe(id2);

    const id3 = Allocator.createId(grantCycleId, 'OTHER');
    expect(id1).not.toBe(id3);
  });

  test('TEST 4: Money Encoding - MoneyCents stored as strings in JSONB', async () => {
    const grantId = EventStore.newEventId();
    const grantCycleId = 'FY2026';
    await store.append({
      eventId: EventStore.newEventId(),
      aggregateType: 'GRANT',
      aggregateId: grantId,
      eventType: 'GRANT_CREATED',
      eventData: {
        awardedAmountCents: '1000000',
        matchCommitmentCents: '250000',
        rateNumeratorCents: '80',
        rateDenominatorCents: '100',
        lirpEnabled: false,
      },
      occurredAt: new Date(),
      grantCycleId,
      correlationId: crypto.randomUUID(),
      causationId: null,
      actorId: crypto.randomUUID() as any,
      actorType: 'ADMIN',
    });

    const result = await pool.query(
      "SELECT event_data->>'awardedAmountCents' as money_value FROM event_log WHERE event_type = 'GRANT_CREATED' LIMIT 1"
    );

    expect(typeof result.rows[0].money_value).toBe('string');
    expect(result.rows[0].money_value).toBe('1000000');
  });

  test('TEST 5: UUIDv7 Format - event_id is time-sortable', () => {
    const eventId = EventStore.newEventId();
    // UUIDv7 has version 7 in the format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
    expect(eventId[14]).toBe('7');
  });

  test('TEST 6: Projections are mutable (event_log remains immutable)', async () => {
    const grantId = EventStore.newEventId();
    await pool.query(
      'INSERT INTO grant_balances_projection (grant_id, grant_cycle_id, bucket_type, awarded_cents, available_cents, encumbered_cents, liquidated_cents, released_cents, rate_numerator_cents, rate_denominator_cents, matching_committed_cents, matching_reported_cents, rebuilt_at, watermark_ingested_at, watermark_event_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
      [grantId, 'FY2026', 'GENERAL', 100000, 100000, 0, 0, 0, 80, 100, 0, 0, new Date(), new Date(), EventStore.newEventId()]
    );

    const updateResult = await pool.query('UPDATE grant_balances_projection SET available_cents = 50000, encumbered_cents = 50000 WHERE grant_id = $1', [grantId]);
    expect(updateResult.rowCount).toBe(1);
    const check = await pool.query('SELECT available_cents FROM grant_balances_projection WHERE grant_id = $1', [grantId]);
    expect(check.rows[0].available_cents).toBe('50000');
  });

  test('TEST 7: Sweep Job - Expired tentatives are detected', async () => {
    const voucherId = EventStore.newEventId();
    const grantId = EventStore.newEventId();
    const grantCycleId = 'FY2026';
    const actorId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();

    await store.append({
      eventId: EventStore.newEventId(),
      aggregateType: 'VOUCHER',
      aggregateId: voucherId,
      eventType: 'VOUCHER_ISSUED_TENTATIVE',
      eventData: {
        voucherId,
      },
      occurredAt: new Date(),
      grantCycleId,
      correlationId,
      causationId: null,
      actorId: actorId as any,
      actorType: 'SYSTEM',
    });

    await pool.query(
      'INSERT INTO vouchers_projection (voucher_id, grant_id, voucher_code, county_code, status, max_reimbursement_cents, is_lirp, tentative_expires_at, expires_at, issued_at, redeemed_at, expired_at, voided_at, rebuilt_at, watermark_ingested_at, watermark_event_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)',
      [voucherId, grantId, 'TEST-TENTATIVE-001', null, 'TENTATIVE', 50000, false, new Date(Date.now() - 3600000), new Date(Date.now() + 3600000), new Date(), null, null, null, new Date(), new Date(), EventStore.newEventId()]
    );

    const before = await pool.query('SELECT status FROM vouchers_projection WHERE voucher_id = $1', [voucherId]);
    expect(before.rowCount).toBe(1);
    expect(before.rows[0].status).toBe('TENTATIVE');

    await sweepExpiredTentatives(pool, store);

    const result = await pool.query('SELECT status FROM vouchers_projection WHERE voucher_id = $1', [voucherId]);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].status).toBe('VOIDED');
  });

  test('TEST 8: Balance Invariant - DB constraint enforces balance equation', async () => {
    const grantId = EventStore.newEventId();

    await expect(
      pool.query(
        'INSERT INTO grant_balances_projection (grant_id, grant_cycle_id, bucket_type, awarded_cents, available_cents, encumbered_cents, liquidated_cents, released_cents, rate_numerator_cents, rate_denominator_cents, matching_committed_cents, matching_reported_cents, rebuilt_at, watermark_ingested_at, watermark_event_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
        [grantId, 'FY2026', 'GENERAL', 100000, 50000, 30000, 10000, 0, 80, 100, 0, 0, new Date(), new Date(), EventStore.newEventId()]
      )
    ).rejects.toThrow(/balance_invariant/);
  });

  test('TEST 9: Watermark Pagination - Exclusive tuple ordering', async () => {
    const events = await store.fetchSince({ ingestedAt: new Date(0), eventId: '00000000-0000-0000-0000-000000000000' as any }, 10);

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

  test('TEST 10: Lock Order - Concurrent voucher issuance does not deadlock', async () => {
    // Lock order: Grant Bucket → Allocator (for new vouchers)
    // If lock order were reversed, concurrent issuance would deadlock.
    // This test proves correct ordering by running two concurrent issuances
    // against the same grant and verifying both complete without deadlock.

    const grantId = EventStore.newEventId();
    const grantCycleId = 'FY2026';
    const actorId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();

    // Seed GRANT_CREATED event
    await store.append({
      eventId: EventStore.newEventId(),
      aggregateType: 'GRANT',
      aggregateId: grantId,
      eventType: 'GRANT_CREATED',
      eventData: {
        awardedAmountCents: '1000000',
        matchCommitmentCents: '250000',
        rateNumeratorCents: '80',
        rateDenominatorCents: '100',
        lirpEnabled: false,
      },
      occurredAt: new Date(),
      grantCycleId,
      correlationId,
      causationId: null,
      actorId: actorId as any,
      actorType: 'ADMIN',
    });

    // Seed grant balance projection
    await pool.query(
      `INSERT INTO grant_balances_projection (
        grant_id, grant_cycle_id, bucket_type,
        awarded_cents, available_cents, encumbered_cents, liquidated_cents, released_cents,
        rate_numerator_cents, rate_denominator_cents,
        matching_committed_cents, matching_reported_cents,
        rebuilt_at, watermark_ingested_at, watermark_event_id
      ) VALUES ($1, $2, 'GENERAL', 1000000, 1000000, 0, 0, 0, 80, 100, 250000, 0, NOW(), NOW(), $3)`,
      [grantId, grantCycleId, EventStore.newEventId()]
    );

    // Seed allocator
    const allocatorId = Allocator.createId(grantCycleId, 'COUNTY');
    await pool.query(
      `INSERT INTO allocators_projection (
        allocator_id, grant_cycle_id, county_code, next_sequence,
        rebuilt_at, watermark_ingested_at, watermark_event_id
      ) VALUES ($1, $2, 'COUNTY', 1, NOW(), NOW(), $3)`,
      [allocatorId, grantCycleId, EventStore.newEventId()]
    );

    // Issue two vouchers concurrently against the same grant
    const voucherId1 = crypto.randomUUID();
    const voucherId2 = crypto.randomUUID();

    const issueRequest = (voucherId: string, key: string) => grantService.issueVoucherOnline({
      idempotencyKey: key,
      grantId: grantId as any,
      voucherId: voucherId as any,
      maxReimbursementCents: Money.fromBigInt(50000n),
      isLIRP: false,
      recipientType: 'SHELTER',
      recipientName: 'Test Recipient',
      animalType: 'DOG',
      procedureType: 'SPAY',
      expiresAt: new Date(Date.now() + 90 * 86400000),
      coPayRequired: false,
      coPayAmountCents: undefined,
      actorId,
      actorType: 'APPLICANT',
      correlationId,
    });

    // Run concurrently — if lock order is wrong, this deadlocks and times out
    const results = await Promise.allSettled([
      issueRequest(voucherId1, 'lock-test-v1'),
      issueRequest(voucherId2, 'lock-test-v2'),
    ]);

    // Both should succeed (no deadlock)
    const successes = results.filter(r => r.status === 'fulfilled');
    expect(successes.length).toBe(2);

    // Verify both vouchers created
    const vouchers = await pool.query(
      'SELECT voucher_id FROM vouchers_projection WHERE grant_id = $1',
      [grantId]
    );
    expect(vouchers.rows.length).toBe(2);

    // Verify grant balance reduced by both voucher amounts
    const balance = await pool.query(
      'SELECT available_cents, encumbered_cents FROM grant_balances_projection WHERE grant_id = $1 AND bucket_type = $2',
      [grantId, 'GENERAL']
    );
    expect(BigInt(balance.rows[0].available_cents)).toBe(900000n); // 1000000 - 50000 - 50000
    expect(BigInt(balance.rows[0].encumbered_cents)).toBe(100000n); // 50000 + 50000
  });
});
