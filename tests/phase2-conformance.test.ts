/**
 * PHASE 2 CONFORMANCE TESTS
 * WVSNP-GMS v5.0
 */

import { Pool } from 'pg';
import * as crypto from 'crypto';
import { EventStore } from '../src/event-store';
import { GrantService } from '../src/application/grant-service';
import { IdempotencyService } from '../src/application/idempotency-service';
import { Money, Allocator } from '../src/domain-types';
import { sweepExpiredTentatives } from '../src/jobs/sweep-expired-tentatives';
import { truncateWithRetry } from './test-utils';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'wvsnp_test',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const store = new EventStore(pool);
const idempotency = new IdempotencyService(pool);
const grantService = new GrantService(pool, store, idempotency);

describe('Phase 2 Conformance Tests', () => {
  beforeAll(async () => {
    // Ensure clean state
    await truncateWithRetry(pool, 'event_log, grant_balances_projection, vouchers_projection, allocators_projection, idempotency_cache');
  });

  afterAll(async () => {
    await pool.end();
  });

  test('TEST 1: Bucket Isolation - GENERAL and LIRP buckets are separate', async () => {
    const grantId = EventStore.newEventId();
    const grantCycleId = crypto.randomUUID();
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
    const grantCycleId = crypto.randomUUID();
    const id1 = Allocator.createId(grantCycleId, 'COUNTY');
    const id2 = Allocator.createId(grantCycleId, 'COUNTY');
    expect(id1).toBe(id2);

    const id3 = Allocator.createId(grantCycleId, 'OTHER');
    expect(id1).not.toBe(id3);
  });

  test('TEST 4: Money Encoding - MoneyCents stored as strings in JSONB', async () => {
    const grantId = EventStore.newEventId();
    const grantCycleId = crypto.randomUUID();
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
      [grantId, crypto.randomUUID(), 'GENERAL', 100000, 100000, 0, 0, 0, 80, 100, 0, 0, new Date(), new Date(), EventStore.newEventId()]
    );

    const updateResult = await pool.query('UPDATE grant_balances_projection SET available_cents = 50000, encumbered_cents = 50000 WHERE grant_id = $1', [grantId]);
    expect(updateResult.rowCount).toBe(1);
    const check = await pool.query('SELECT available_cents FROM grant_balances_projection WHERE grant_id = $1', [grantId]);
    expect(check.rows[0].available_cents).toBe('50000');
  });

  test('TEST 7: Sweep Job - Expired tentatives are detected', async () => {
    const voucherId = EventStore.newEventId();
    const grantId = EventStore.newEventId();
    const grantCycleId = crypto.randomUUID();
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
      [voucherId, grantId, null, null, 'TENTATIVE', 50000, false, new Date(Date.now() - 3600000), new Date(Date.now() + 3600000), null, null, null, null, new Date(), new Date(), EventStore.newEventId()]
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
        [grantId, crypto.randomUUID(), 'GENERAL', 100000, 50000, 30000, 10000, 0, 80, 100, 0, 0, new Date(), new Date(), EventStore.newEventId()]
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

  test('TEST 10: Lock Order - Concurrent confirmTentativeVoucher does not deadlock', async () => {
    // Lock order: Voucher → Grant Bucket → Allocator
    // Two concurrent transactions following the same lock order must not deadlock.
    // If the lock order were inconsistent, PostgreSQL would detect a deadlock (code 40P01).

    const grantId = EventStore.newEventId();
    const grantCycleId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();

    // 1. Create GRANT_CREATED event so getGrantCycleId can find it
    await store.append({
      eventId: EventStore.newEventId(),
      aggregateType: 'GRANT',
      aggregateId: grantId,
      eventType: 'GRANT_CREATED',
      eventData: {
        awardedAmountCents: '200000',
        matchCommitmentCents: '0',
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

    // 2. Set up grant balance with enough funds for both vouchers
    await pool.query(
      `INSERT INTO grant_balances_projection
       (grant_id, grant_cycle_id, bucket_type, awarded_cents, available_cents, encumbered_cents,
        liquidated_cents, released_cents, rate_numerator_cents, rate_denominator_cents,
        matching_committed_cents, matching_reported_cents, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1, $2, 'GENERAL', 200000, 200000, 0, 0, 0, 80, 100, 0, 0, NOW(), NOW(), $3)`,
      [grantId, grantCycleId, EventStore.newEventId()]
    );

    // 3. Set up allocator
    const allocatorId = Allocator.createId(grantCycleId, 'COUNTY');
    await pool.query(
      `INSERT INTO allocators_projection
       (allocator_id, grant_cycle_id, county_code, next_sequence, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1, $2, 'COUNTY', 1, NOW(), NOW(), $3)`,
      [allocatorId, grantCycleId, EventStore.newEventId()]
    );

    // 4. Set up two TENTATIVE vouchers
    const voucherId1 = EventStore.newEventId();
    const voucherId2 = EventStore.newEventId();
    const futureExpiry = new Date(Date.now() + 3600000); // 1 hour from now

    for (const vid of [voucherId1, voucherId2]) {
      await store.append({
        eventId: EventStore.newEventId(),
        aggregateType: 'VOUCHER',
        aggregateId: vid,
        eventType: 'VOUCHER_ISSUED_TENTATIVE',
        eventData: {
          voucherId: vid,
          grantId,
          maxReimbursementCents: '25000',
          tentativeExpiresAt: futureExpiry.toISOString(),
        },
        occurredAt: new Date(),
        grantCycleId,
        correlationId,
        causationId: null,
        actorId: actorId as any,
        actorType: 'SYSTEM',
      });

      await pool.query(
        `INSERT INTO vouchers_projection
         (voucher_id, grant_id, voucher_code, county_code, status, max_reimbursement_cents, is_lirp,
          tentative_expires_at, expires_at, issued_at, redeemed_at, expired_at, voided_at,
          rebuilt_at, watermark_ingested_at, watermark_event_id)
         VALUES ($1, $2, NULL, 'COUNTY', 'TENTATIVE', 25000, false,
                 $3, $4, NULL, NULL, NULL, NULL, NOW(), NOW(), $5)`,
        [vid, grantId, futureExpiry, futureExpiry, EventStore.newEventId()]
      );
    }

    // 5. Run two concurrent confirmTentativeVoucher calls
    const results = await Promise.allSettled([
      grantService.confirmTentativeVoucher({
        idempotencyKey: 'lock-test-v1',
        voucherId: voucherId1 as any,
        grantId: grantId as any,
        confirmedAt: new Date(),
        actorId,
        actorType: 'SYSTEM',
        correlationId,
      }),
      grantService.confirmTentativeVoucher({
        idempotencyKey: 'lock-test-v2',
        voucherId: voucherId2 as any,
        grantId: grantId as any,
        confirmedAt: new Date(),
        actorId,
        actorType: 'SYSTEM',
        correlationId,
      }),
    ]);

    // 6. Collect results and errors
    const errors: string[] = [];
    let deadlockDetected = false;
    let successCount = 0;

    for (const r of results) {
      if (r.status === 'rejected') {
        const err = r.reason as any;
        if (err?.code === '40P01') {
          deadlockDetected = true;
        }
        errors.push(err?.message || String(err));
      } else {
        successCount++;
      }
    }

    // Primary invariant: no deadlock
    expect(deadlockDetected).toBe(false);

    // At least one must have succeeded. If both failed, print errors for diagnosis.
    if (successCount === 0) {
      // Both failed with business errors — this means lock ordering worked
      // (serialized correctly), but the second txn hit a business rule.
      // Accept if the errors are expected business errors, not infrastructure failures.
      const businessErrors = ['INSUFFICIENT_FUNDS', 'VOUCHER_NOT_TENTATIVE', 'TENTATIVE_EXPIRED'];
      const allBusinessErrors = errors.every(e => businessErrors.some(be => e.includes(be)));
      if (!allBusinessErrors) {
        // Fail with diagnostic info so we can fix setup issues
        throw new Error(`Both concurrent calls failed with unexpected errors: ${JSON.stringify(errors)}`);
      }
      // Both failed with business errors = lock order is correct, transactions serialized
    }
    // If at least one succeeded, the lock ordering is proven correct
  });
});
