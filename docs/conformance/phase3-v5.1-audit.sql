-- ============================================
-- PHASE 3 v5.1 PATCH AUDIT QUERIES
-- WVSNP-GMS Canon Violation Fixes
-- ============================================

-- FIX 4: AUDIT QUERY - Event-Backed Adjustments
-- Every row in invoice_adjustments_projection must have corresponding event

-- TEST 1: Verify all adjustments have INVOICE_ADJUSTMENT_CREATED event
SELECT 
  ap.adjustment_id,
  ap.source_invoice_id,
  ap.amount_cents,
  ap.created_at
FROM invoice_adjustments_projection ap
LEFT JOIN event_log el ON el.aggregate_id = ap.adjustment_id
  AND el.event_type = 'INVOICE_ADJUSTMENT_CREATED'
WHERE el.event_id IS NULL;

-- Expected: EMPTY RESULT (all adjustments must have corresponding event)
-- If rows returned: VIOLATION - adjustments written directly to projection without event

-- TEST 2: Verify all applied adjustments have INVOICE_ADJUSTMENT_APPLIED event
SELECT 
  ap.adjustment_id,
  ap.target_invoice_id,
  ap.applied_at
FROM invoice_adjustments_projection ap
WHERE ap.target_invoice_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM event_log el
    WHERE el.aggregate_id = ap.adjustment_id
      AND el.event_type = 'INVOICE_ADJUSTMENT_APPLIED'
      AND el.event_data->>'targetInvoiceId' = ap.target_invoice_id::text
  );

-- Expected: EMPTY RESULT (all applied adjustments must have corresponding event)

-- TEST 3: Verify no direct INSERT/UPDATE to adjustments without event trail
-- This is a policy check - all adjustments must flow through InvoiceService
-- Manual verification required in application code

-- FIX 1: AUDIT QUERY - ClaimId is UUIDv4, not SHA-256
SELECT 
  claim_id,
  claim_fingerprint,
  LENGTH(claim_id::text) as id_length,
  LENGTH(claim_fingerprint) as fingerprint_length
FROM claims_projection
LIMIT 5;

-- Expected: 
-- - id_length = 36 (UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
-- - fingerprint_length = 64 (SHA-256 hex)

-- TEST 4: Verify claim_fingerprint uniqueness constraint
SELECT 
  grant_cycle_id,
  clinic_id,
  claim_fingerprint,
  COUNT(*) as duplicate_count
FROM claims_projection
GROUP BY grant_cycle_id, clinic_id, claim_fingerprint
HAVING COUNT(*) > 1;

-- Expected: EMPTY RESULT (no duplicates allowed per unique constraint)

-- FIX 3: AUDIT QUERY - No created_at/updated_at in business logic
-- Verify invoice selection uses event timestamps only
SELECT 
  invoice_id,
  invoice_period_start,
  invoice_period_end,
  generated_at,
  submitted_at
FROM invoices_projection
WHERE generated_at IS NOT NULL
ORDER BY generated_at DESC
LIMIT 5;

-- Expected: All timestamps are from events, not NOW() or CURRENT_TIMESTAMP

-- TEST 5: Verify INVOICE_GENERATED events include generationWatermark
SELECT 
  event_id,
  event_data->>'periodStart' as period_start,
  event_data->>'periodEnd' as period_end,
  event_data->>'generationWatermark' as watermark,
  ingested_at
FROM event_log
WHERE event_type = 'INVOICE_GENERATED'
ORDER BY ingested_at DESC
LIMIT 5;

-- Expected: generationWatermark is NOT NULL for all INVOICE_GENERATED events

-- FIX 5: AUDIT QUERY - License check evidence captured
SELECT 
  claim_id,
  event_data->'licenseCheckEvidence'->>'licenseNumber' as license_number,
  event_data->'licenseCheckEvidence'->>'licenseStatus' as license_status,
  event_data->'licenseCheckEvidence'->>'validForDateOfService' as valid_for_dos,
  event_data->>'dateOfService' as date_of_service
FROM event_log
WHERE event_type = 'CLAIM_SUBMITTED'
ORDER BY ingested_at DESC
LIMIT 5;

-- Expected: licenseCheckEvidence is NOT NULL for all CLAIM_SUBMITTED events

-- FIX 6: AUDIT QUERY - Hard artifact enforcement
SELECT 
  event_id,
  event_data->'artifacts'->>'procedureReportId' as procedure_report,
  event_data->'artifacts'->>'clinicInvoiceId' as clinic_invoice,
  event_data->'artifacts'->>'rabiesCertificateId' as rabies_cert,
  event_data->'artifacts'->>'coPayReceiptId' as copay_receipt
FROM event_log
WHERE event_type = 'CLAIM_SUBMITTED'
ORDER BY ingested_at DESC
LIMIT 5;

-- Expected: 
-- - procedureReportId is ALWAYS NOT NULL
-- - clinicInvoiceId is ALWAYS NOT NULL
-- - rabiesCertificateId is NOT NULL if rabies procedure
-- - coPayReceiptId is NOT NULL if co-pay collected

-- TEST 6: Verify no CLAIM_SUBMITTED events without required artifacts
SELECT 
  event_id,
  aggregate_id as claim_id,
  ingested_at
FROM event_log
WHERE event_type = 'CLAIM_SUBMITTED'
  AND (
    event_data->'artifacts'->>'procedureReportId' IS NULL
    OR event_data->'artifacts'->>'clinicInvoiceId' IS NULL
  );

-- Expected: EMPTY RESULT (no claims submitted without required artifacts)

-- REPLAY DETERMINISM TEST
-- Verify that dropping and rebuilding projections produces identical results
-- This must be run manually:
-- 1. Save current projection state
-- 2. TRUNCATE claims_projection, invoices_projection, invoice_adjustments_projection
-- 3. Rebuild from event_log
-- 4. Compare with saved state
-- Expected: IDENTICAL results (deterministic replay)

-- ============================================
-- CONFORMANCE SUMMARY
-- ============================================
-- [ ] All adjustments have INVOICE_ADJUSTMENT_CREATED event
-- [ ] All applied adjustments have INVOICE_ADJUSTMENT_APPLIED event
-- [ ] ClaimId is UUIDv4 format (36 chars with hyphens)
-- [ ] ClaimFingerprint is SHA-256 (64 hex chars)
-- [ ] Unique constraint on (grant_cycle_id, clinic_id, claim_fingerprint)
-- [ ] INVOICE_GENERATED events include generationWatermark
-- [ ] CLAIM_SUBMITTED events include licenseCheckEvidence
-- [ ] CLAIM_SUBMITTED events include all required artifacts
-- [ ] No CLAIM_SUBMITTED without procedureReportId + clinicInvoiceId
-- [ ] Replay determinism verified
