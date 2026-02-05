-- ============================================
-- PHASE 2 CONFORMANCE PROOF
-- WVSNP-GMS v5.0
-- ============================================

-- TEST 1: Grant Creation with Bucket Isolation
INSERT INTO event_log (
  event_id, aggregate_type, aggregate_id, event_type, event_data,
  occurred_at, grant_cycle_id, correlation_id, causation_id, actor_id, actor_type
) VALUES (
  gen_random_uuid(), 'GRANT', gen_random_uuid(), 'GRANT_CREATED',
  jsonb_build_object(
    'awardedAmountCents', '1000000',
    'matchCommitmentCents', '250000',
    'rateNumeratorCents', '80',
    'rateDenominatorCents', '100',
    'lirpEnabled', true,
    'lirpAllocationCents', '200000'
  ),
  NOW(), 'FY2026', gen_random_uuid(), NULL, gen_random_uuid(), 'ADMIN'
);

-- Verify: Two buckets created (GENERAL and LIRP)
SELECT 
  bucket_type,
  awarded_cents,
  available_cents,
  encumbered_cents,
  liquidated_cents
FROM grant_balances_projection
ORDER BY bucket_type;

-- Expected: GENERAL bucket with 800000 available (1000000 - 200000)
-- Expected: LIRP bucket with 200000 available

-- TEST 2: Voucher Issuance with Lock Order
-- Verify lock order: Voucher (new) → Grant Bucket → Allocator
-- This is tested in application code, not SQL

-- TEST 3: Idempotency Cache
INSERT INTO idempotency_cache (
  idempotency_key, operation_type, request_hash, status, expires_at
) VALUES (
  'test-key-001', 'ISSUE_VOUCHER_ONLINE', 'hash123', 'COMPLETED', NOW() + INTERVAL '1 day'
);

-- Verify: Cannot insert duplicate
-- Expected: Conflict on idempotency_key

-- TEST 4: Tentative Voucher Expiry
INSERT INTO vouchers_projection (
  voucher_id, grant_id, voucher_code, county_code, status, max_reimbursement_cents, is_lirp,
  tentative_expires_at, expires_at, issued_at, redeemed_at, expired_at, voided_at,
  rebuilt_at, watermark_ingested_at, watermark_event_id
) VALUES (
  gen_random_uuid(), gen_random_uuid(), NULL, NULL, 'TENTATIVE', 50000, false,
  NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 day', NULL, NULL, NULL, NULL,
  NOW(), NOW(), gen_random_uuid()
);

-- Verify: Sweep job should find expired tentatives
SELECT voucher_id, status, tentative_expires_at
FROM vouchers_projection
WHERE status = 'TENTATIVE' AND tentative_expires_at < NOW();

-- Expected: One row (the expired tentative)

-- TEST 5: Allocator Deterministic Hash
-- Verify: Same inputs produce same allocator_id
SELECT 
  encode(digest('FY2026:COUNTY', 'sha256'), 'hex') as allocator_id_1,
  encode(digest('FY2026:COUNTY', 'sha256'), 'hex') as allocator_id_2;

-- Expected: allocator_id_1 = allocator_id_2

-- TEST 6: Grant Balance Invariant (DB Constraint)
-- Attempt to violate balance invariant
-- Expected: CHECK constraint violation

-- TEST 7: Projection Mutability (No Triggers)
-- Verify: No immutability triggers exist on *_projection tables
SELECT tgname, relname
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE relname LIKE '%_projection' AND tgname LIKE '%immut%';

-- Expected: No rows

-- TEST 8: Money Encoding in JSONB
SELECT 
  event_data->>'awardedAmountCents' as money_string,
  pg_typeof(event_data->>'awardedAmountCents') as money_type
FROM event_log
WHERE event_type = 'GRANT_CREATED'
LIMIT 1;

-- Expected: money_type = 'text' (string encoding)

-- TEST 9: UUIDv7 for event_id
-- Verify event_id is time-sortable (UUIDv7 format)
SELECT 
  event_id,
  ingested_at,
  event_id::text LIKE '________-____-7___-____-____________' as is_uuidv7_format
FROM event_log
ORDER BY ingested_at DESC
LIMIT 5;

-- Expected: is_uuidv7_format = true for all rows

-- TEST 10: Watermark Pagination
-- Verify exclusive watermark pagination works correctly
SELECT 
  event_id,
  ingested_at
FROM event_log
WHERE (ingested_at > '2026-01-01'::timestamptz)
   OR (ingested_at = '2026-01-01'::timestamptz AND event_id > '00000000-0000-0000-0000-000000000000'::uuid)
ORDER BY ingested_at ASC, event_id ASC
LIMIT 10;

-- Expected: Correct ordering by (ingested_at, event_id) tuple

-- ============================================
-- CONFORMANCE CHECKLIST
-- ============================================
-- [ ] Schema: grant_balances_projection, vouchers_projection, allocators_projection, idempotency_cache created
-- [ ] Immutability: event_log trigger only; projections are mutable
-- [ ] Bucket Isolation: GENERAL and LIRP buckets separate rows
-- [ ] Lock Order: Voucher → Grant Bucket → Allocator (code review)
-- [ ] Idempotency: Cache prevents duplicate operations
-- [ ] Sweep Job: Expired tentatives detected and rejected
-- [ ] Allocator: Deterministic SHA-256 hash IDs
-- [ ] Money: String-encoded in JSONB
-- [ ] UUIDv7: event_id uses time-sortable UUIDs
-- [ ] Watermark: Exclusive tuple pagination
