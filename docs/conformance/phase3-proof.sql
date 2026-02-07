-- ============================================
-- PHASE 3 CONFORMANCE PROOF (SETTLEMENT)
-- WVSNP-GMS v5.0
-- ============================================

-- TEST 1: ClaimId is valid UUIDv4 format
SELECT claim_id
FROM claims_projection
WHERE claim_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- Expected: EMPTY (all UUIDv4)

-- TEST 2: ClaimFingerprint is 64-char hex
SELECT claim_fingerprint
FROM claims_projection
WHERE claim_fingerprint !~ '^[0-9a-f]{64}$';

-- Expected: EMPTY

-- TEST 3: Fingerprint uniqueness constraint exists
SELECT conname
FROM pg_constraint
WHERE conrelid = 'claims_projection'::regclass AND contype = 'u';

-- Expected: Contains fingerprint unique constraint

-- TEST 4: No projection has immutability trigger (except event_log)
SELECT tgname, relname
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE relname LIKE '%_projection' AND tgname LIKE '%immut%';

-- Expected: EMPTY

-- TEST 5: approved_event_id is populated for approved claims
SELECT COUNT(*) FROM claims_projection
WHERE status IN ('APPROVED','INVOICED') AND approved_event_id IS NULL;

-- Expected: 0

-- TEST 6: No Number() in money operations (code review)
-- Run: grep -rn "Number(" src/application/ | grep -ic "cent|amount"
-- Expected: 0

-- TEST 7: VET_CLINIC_* Event Naming
-- Verify: Clinic events use VET_CLINIC_* prefix (not CLINIC_*)
SELECT event_type
FROM event_log
WHERE aggregate_type = 'CLINIC'
  AND event_type NOT LIKE 'VET_CLINIC_%'
LIMIT 1;

-- Expected: No rows (all clinic events must use VET_CLINIC_* prefix)

-- TEST 8: Clinic Eligibility (LAW 7.1)
-- Verify: Claims require ACTIVE status and VALID license
INSERT INTO vet_clinics_projection (
  clinic_id, clinic_name, status, license_status, license_number, license_expires_at,
  oasis_vendor_code, payment_info, registered_at, suspended_at, reinstated_at,
  rebuilt_at, watermark_ingested_at, watermark_event_id
) VALUES (
  gen_random_uuid(), 'Test Clinic', 'ACTIVE', 'VALID', 'LIC-12345', NOW() + INTERVAL '1 year',
  NULL, NULL, NOW(), NULL, NULL,
  NOW(), NOW(), gen_random_uuid()
);

-- Verify: Suspended clinic cannot submit claims
UPDATE vet_clinics_projection SET status = 'SUSPENDED' WHERE clinic_name = 'Test Clinic';
-- Expected: Claim submission should fail with CLINIC_NOT_ACTIVE

-- TEST 9: Claim Date Validation (LAW 7.2)
-- Verify: Procedure date must be within voucher validity AND grant period AND before submission deadline
-- This is tested in application code, not SQL

-- TEST 10: Decision Basis with Policy Snapshot
-- Verify: CLAIM_APPROVED/DENIED events include decisionBasis with policySnapshotId
SELECT 
  event_type,
  event_data->>'decisionBasis' as decision_basis,
  event_data->'decisionBasis'->>'policySnapshotId' as policy_snapshot_id
FROM event_log
WHERE event_type IN ('CLAIM_APPROVED', 'CLAIM_DENIED')
LIMIT 1;

-- Expected: policy_snapshot_id is NOT NULL

-- TEST 11: CLAIM_DECISION_CONFLICT_RECORDED
-- Verify: Concurrent adjudication emits conflict event
-- This requires concurrent transactions (integration test)

-- TEST 12: Invoice Immutability After Submission (LAW 2.9)
-- Verify: INVOICE_SUBMITTED locks invoice forever
INSERT INTO invoices_projection (
  invoice_id, clinic_id, invoice_period_start, invoice_period_end,
  total_amount_cents, claim_ids, adjustment_ids, status, submitted_at, generated_at,
  rebuilt_at, watermark_ingested_at, watermark_event_id
) VALUES (
  gen_random_uuid(), gen_random_uuid(), '2026-01-01', '2026-01-31',
  100000, '[]'::jsonb, '[]'::jsonb, 'SUBMITTED', NOW(), NOW(),
  NOW(), NOW(), gen_random_uuid()
);

-- Attempt to UPDATE submitted invoice
-- Expected: Application logic rejects mutation (projection triggers removed)

-- TEST 13: No INVOICE_STATUS_UPDATED Event (LAW 7.6)
-- Verify: Invoice status is projection-derived, not event-based
SELECT event_type
FROM event_log
WHERE event_type = 'INVOICE_STATUS_UPDATED'
LIMIT 1;

-- Expected: No rows (INVOICE_STATUS_UPDATED is FORBIDDEN)

-- TEST 14: Payment Recording
-- Verify: PAYMENT_RECORDED events update projection
INSERT INTO event_log (
  event_id, aggregate_type, aggregate_id, event_type, event_data,
  occurred_at, grant_cycle_id, correlation_id, causation_id, actor_id, actor_type
) VALUES (
  gen_random_uuid(), 'PAYMENT', gen_random_uuid(), 'PAYMENT_RECORDED',
  jsonb_build_object(
    'invoiceId', gen_random_uuid()::text,
    'amountCents', '50000',
    'paymentChannel', 'ACH',
    'referenceId', 'REF-12345'
  ),
  NOW(), 'FY2026', gen_random_uuid(), NULL, gen_random_uuid(), 'SYSTEM'
);

-- Verify: Payment appears in payments_projection
SELECT payment_id, amount_cents, payment_channel
FROM payments_projection
ORDER BY recorded_at DESC
LIMIT 1;

-- Expected: One row with amount_cents = 50000

-- TEST 15: Projection-Derived Invoice Status
-- Verify: Invoice status computed from payments (not stored in events)
-- Create invoice with total 100000
-- Record payment of 50000
-- Expected: Status = 'PARTIALLY_PAID'
-- Record payment of 50000
-- Expected: Status = 'PAID'

-- TEST 16: Carry-Forward Adjustments (LAW 2.9)
-- Verify: Unapplied adjustments are carried forward to next invoice
INSERT INTO invoice_adjustments_projection (
  adjustment_id, source_invoice_id, grant_cycle_id, clinic_id, target_invoice_id, amount_cents, reason,
  created_at, applied_at, rebuilt_at, watermark_ingested_at, watermark_event_id
) VALUES (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), NULL, NULL, -5000, 'Overpayment correction',
  NOW(), NULL, NOW(), NOW(), gen_random_uuid()
);

-- Verify: Adjustment with NULL target_invoice_id is available for carry-forward
SELECT adjustment_id, amount_cents, reason
FROM invoice_adjustments_projection
WHERE target_invoice_id IS NULL;

-- Expected: One row (unapplied adjustment)

-- TEST 17: Monthly Invoice Generation (LAW 7.3)
-- Verify: Invoices generated for prior month on the 1st
-- This is tested in application code with America/New_York timezone

-- TEST 18: LIRP Co-Pay Forbidden (LAW 7.4)
-- Verify: LIRP vouchers cannot have co-pay
-- This is enforced in application code

-- TEST 19: Required Artifacts (LAW 7.5)
-- Verify: Claims include procedure report + clinic invoice + conditional docs
SELECT 
  event_data->'artifacts'->>'procedureReport' as procedure_report,
  event_data->'artifacts'->>'clinicInvoice' as clinic_invoice
FROM event_log
WHERE event_type = 'CLAIM_SUBMITTED'
LIMIT 1;

-- Expected: Both fields are NOT NULL

-- TEST 20: Projection Table Naming (LAW 8.1)
-- Verify: All projection tables use *_projection suffix (not *_writemodel)
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE '%_writemodel';

-- Expected: No rows (all projections must use *_projection suffix)

-- ============================================
-- CONFORMANCE CHECKLIST (v5.2)
-- ============================================
-- [ ] ClaimId is client-generated UUIDv4 (NOT SHA-256 hash)
-- [ ] ClaimFingerprint is SHA-256 (de-dupe only, NOT an identity)
-- [ ] No projection immutability triggers (only event_log/artifact_log)
-- [ ] approved_event_id populated for all approved claims
-- [ ] VET_CLINIC_* event naming
-- [ ] Clinic eligibility enforcement (ACTIVE + VALID license)
-- [ ] Claim date validation (voucher + grant period + deadline)
-- [ ] Decision basis with policySnapshotId
-- [ ] CLAIM_DECISION_CONFLICT_RECORDED on concurrent adjudication
-- [ ] Invoice immutability after INVOICE_SUBMITTED
-- [ ] No INVOICE_STATUS_UPDATED event (projection-derived)
-- [ ] Payment recording and projection
-- [ ] Projection-derived invoice status (PAID/PARTIALLY_PAID)
-- [ ] Carry-forward adjustments
-- [ ] Monthly invoice generation (1st of month for prior month)
-- [ ] LIRP co-pay forbidden
-- [ ] Required artifacts on claims
-- [ ] *_projection table naming (not *_writemodel)
-- [ ] No Number() on money fields (BigInt only)
