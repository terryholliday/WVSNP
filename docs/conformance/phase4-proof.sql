-- ============================================
-- PHASE 4 CONFORMANCE PROOF (OASIS EXPORT + CLOSEOUT)
-- WVSNP-GMS v5.2
-- ============================================

-- TEST 1: Export batch unique constraint exists
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'oasis_export_batches_projection'::regclass
  AND conname = 'uq_export_batch_params';

-- Expected: One row with contype = 'u'

-- TEST 2: Batch fingerprint is SHA-256 (64 hex chars)
SELECT batch_fingerprint
FROM oasis_export_batches_projection
WHERE batch_fingerprint !~ '^[0-9a-f]{64}$';

-- Expected: EMPTY (all fingerprints are valid SHA-256)

-- TEST 3: Export batch status values
SELECT DISTINCT status
FROM oasis_export_batches_projection;

-- Expected: Only valid statuses (CREATED, FILE_RENDERED, SUBMITTED, ACKNOWLEDGED, REJECTED, VOIDED)

-- TEST 4: File rendered events have required fields
SELECT event_id
FROM event_log
WHERE event_type = 'OASIS_EXPORT_FILE_RENDERED'
  AND (
    event_data->>'sha256' IS NULL
    OR event_data->>'formatVersion' IS NULL
    OR event_data->>'artifactId' IS NULL
  );

-- Expected: EMPTY (all FILE_RENDERED events have required fields)

-- TEST 5: Format version is pinned
SELECT DISTINCT event_data->>'formatVersion' as format_version
FROM event_log
WHERE event_type = 'OASIS_EXPORT_FILE_RENDERED';

-- Expected: 'OASIS_FW_v1' (or other specific version)

-- TEST 6: Invoices released after REJECTED/VOIDED
SELECT i.invoice_id, b.status
FROM invoices_projection i
JOIN oasis_export_batches_projection b ON b.export_batch_id = i.oasis_export_batch_id
WHERE b.status IN ('REJECTED', 'VOIDED');

-- Expected: EMPTY (invoices should have NULL export_batch_id after rejection/void)

-- TEST 7: No invoice events for batch rejection/void
SELECT event_id, event_type
FROM event_log
WHERE event_type LIKE 'INVOICE_%'
  AND causation_id IN (
    SELECT event_id FROM event_log 
    WHERE event_type IN ('OASIS_EXPORT_BATCH_REJECTED', 'OASIS_EXPORT_BATCH_VOIDED')
  );

-- Expected: EMPTY (batch rejection/void does NOT emit invoice events)

-- TEST 8: Closeout preflight checks structure
SELECT preflight_checks
FROM grant_cycle_closeout_projection
WHERE preflight_checks IS NOT NULL
LIMIT 1;

-- Expected: JSONB array with check objects containing 'check', 'pass', 'details'

-- TEST 9: Financial summary invariant
SELECT grant_cycle_id,
  (financial_summary->>'awardedCents')::bigint as awarded,
  (financial_summary->>'liquidatedCents')::bigint as liquidated,
  (financial_summary->>'releasedCents')::bigint as released,
  (financial_summary->>'unspentCents')::bigint as unspent,
  (financial_summary->>'liquidatedCents')::bigint + 
  (financial_summary->>'releasedCents')::bigint + 
  (financial_summary->>'unspentCents')::bigint as sum
FROM grant_cycle_closeout_projection
WHERE closeout_status IN ('RECONCILED', 'CLOSED')
  AND (financial_summary->>'awardedCents')::bigint != 
      ((financial_summary->>'liquidatedCents')::bigint + 
       (financial_summary->>'releasedCents')::bigint + 
       (financial_summary->>'unspentCents')::bigint);

-- Expected: EMPTY (invariant holds: awarded = liquidated + released + unspent)

-- TEST 10: Matching funds shortfall calculation
SELECT grant_cycle_id,
  (matching_funds->>'committedCents')::bigint as committed,
  (matching_funds->>'reportedCents')::bigint as reported,
  (matching_funds->>'shortfallCents')::bigint as shortfall,
  (matching_funds->>'committedCents')::bigint - 
  (matching_funds->>'reportedCents')::bigint as calculated_shortfall
FROM grant_cycle_closeout_projection
WHERE closeout_status IN ('RECONCILED', 'CLOSED')
  AND (matching_funds->>'shortfallCents')::bigint != 
      ((matching_funds->>'committedCents')::bigint - 
       (matching_funds->>'reportedCents')::bigint);

-- Expected: EMPTY (shortfall = committed - reported)

-- TEST 11: Blocked events after cycle closed
SELECT event_id, event_type, grant_cycle_id
FROM event_log
WHERE event_type IN (
  'VOUCHER_ISSUED',
  'VOUCHER_ISSUED_TENTATIVE',
  'CLAIM_SUBMITTED',
  'CLAIM_APPROVED',
  'CLAIM_ADJUSTED',
  'INVOICE_GENERATED',
  'GRANT_FUNDS_ENCUMBERED',
  'GRANT_FUNDS_LIQUIDATED'
)
AND grant_cycle_id IN (
  SELECT grant_cycle_id FROM grant_cycle_closeout_projection WHERE closeout_status = 'CLOSED'
)
AND ingested_at > (
  SELECT ingested_at FROM event_log 
  WHERE event_type = 'GRANT_CYCLE_CLOSED' 
    AND grant_cycle_id = event_log.grant_cycle_id
  LIMIT 1
);

-- Expected: EMPTY (no blocked events after closeout)

-- TEST 12: Allowed events after cycle closed
SELECT COUNT(*) as allowed_events_count
FROM event_log
WHERE event_type IN (
  'PAYMENT_RECORDED',
  'OASIS_EXPORT_BATCH_CREATED',
  'OASIS_EXPORT_BATCH_SUBMITTED',
  'GRANT_CYCLE_CLOSEOUT_AUDIT_HOLD'
)
AND grant_cycle_id IN (
  SELECT grant_cycle_id FROM grant_cycle_closeout_projection WHERE closeout_status = 'CLOSED'
);

-- Expected: >= 0 (these events are still allowed after closeout)

-- TEST 13: Deadline enforcement - GRANT_PERIOD_ENDED
SELECT COUNT(*) as vouchers_after_period_end
FROM event_log
WHERE event_type IN ('VOUCHER_ISSUED', 'VOUCHER_ISSUED_TENTATIVE')
  AND grant_cycle_id IN (
    SELECT grant_cycle_id FROM event_log WHERE event_type = 'GRANT_PERIOD_ENDED'
  )
  AND ingested_at > (
    SELECT ingested_at FROM event_log e2 
    WHERE e2.event_type = 'GRANT_PERIOD_ENDED' 
      AND e2.grant_cycle_id = event_log.grant_cycle_id
    LIMIT 1
  );

-- Expected: 0 (no vouchers issued after period ended)

-- TEST 14: Deadline enforcement - GRANT_CLAIMS_DEADLINE_PASSED
SELECT COUNT(*) as claims_after_deadline
FROM event_log
WHERE event_type = 'CLAIM_SUBMITTED'
  AND grant_cycle_id IN (
    SELECT grant_cycle_id FROM event_log WHERE event_type = 'GRANT_CLAIMS_DEADLINE_PASSED'
  )
  AND ingested_at > (
    SELECT ingested_at FROM event_log e2 
    WHERE e2.event_type = 'GRANT_CLAIMS_DEADLINE_PASSED' 
      AND e2.grant_cycle_id = event_log.grant_cycle_id
    LIMIT 1
  );

-- Expected: 0 (no claims submitted after deadline)

-- TEST 15: Watermark tuple ordering in export selection
-- Verify invoices are ordered by (last_event_ingested_at, last_event_id, invoice_id)
SELECT invoice_id, last_event_ingested_at, last_event_id
FROM invoices_projection
WHERE status = 'SUBMITTED'
  AND oasis_export_batch_id IS NULL
ORDER BY last_event_ingested_at ASC, last_event_id ASC, invoice_id ASC
LIMIT 10;

-- Expected: Results in deterministic order

-- TEST 16: Control totals match in batch
SELECT 
  b.export_batch_id,
  b.control_total_cents as batch_total,
  SUM(i.amount_cents) as items_total
FROM oasis_export_batches_projection b
JOIN oasis_export_batch_items_projection i ON i.export_batch_id = b.export_batch_id
GROUP BY b.export_batch_id, b.control_total_cents
HAVING b.control_total_cents != SUM(i.amount_cents);

-- Expected: EMPTY (batch total matches sum of items)

-- TEST 17: Record count matches in batch
SELECT 
  b.export_batch_id,
  b.record_count as batch_count,
  COUNT(i.invoice_id) as items_count
FROM oasis_export_batches_projection b
JOIN oasis_export_batch_items_projection i ON i.export_batch_id = b.export_batch_id
GROUP BY b.export_batch_id, b.record_count
HAVING b.record_count != COUNT(i.invoice_id);

-- Expected: EMPTY (batch count matches number of items)

-- TEST 18: Audit hold prevents closeout
SELECT grant_cycle_id
FROM grant_cycle_closeout_projection
WHERE closeout_status = 'CLOSED'
  AND audit_hold_at IS NOT NULL
  AND (audit_resolved_at IS NULL OR audit_resolved_at < closed_at);

-- Expected: EMPTY (cannot close while audit hold is active)

-- TEST 19: ExportBatchId is UUIDv4
SELECT export_batch_id
FROM oasis_export_batches_projection
WHERE export_batch_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- Expected: EMPTY (all are valid UUIDv4)

-- TEST 20: No STATUS_UPDATED events (projection-derived)
SELECT event_id, event_type
FROM event_log
WHERE event_type LIKE '%_STATUS_UPDATED';

-- Expected: EMPTY (status is always projection-derived, never event-based)

-- ============================================
-- CONFORMANCE CHECKLIST
-- ============================================
-- [ ] Export batch unique constraint on 5-tuple
-- [ ] Batch fingerprint is SHA-256
-- [ ] File rendered events have sha256, formatVersion, artifactId
-- [ ] Format version pinned (OASIS_FW_v1)
-- [ ] Invoices released after REJECTED/VOIDED
-- [ ] No invoice events for batch rejection/void
-- [ ] Preflight checks structure valid
-- [ ] Financial summary invariant holds
-- [ ] Matching funds shortfall correct
-- [ ] Blocked events rejected after cycle closed
-- [ ] Allowed events still work after cycle closed
-- [ ] GRANT_PERIOD_ENDED blocks voucher issuance
-- [ ] GRANT_CLAIMS_DEADLINE_PASSED blocks claim submission
-- [ ] Watermark tuple ordering deterministic
-- [ ] Control totals match in batches
-- [ ] Record counts match in batches
-- [ ] Audit hold prevents closeout
-- [ ] ExportBatchId is UUIDv4
-- [ ] No STATUS_UPDATED events exist
