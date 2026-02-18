-- ============================================
-- WVSNP-GMS KERNEL SCHEMA (v4.5 FINAL)
-- Source: WVSNP-GMS-Specification-v4.5 (1).md
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- EVENT LOG (Canonical, Append-Only)
-- ============================================
CREATE TABLE IF NOT EXISTS event_log (
  -- LAW 0.6: Single PK
  -- LAW 0.10: Must be UUIDv7 (enforced in application)
  event_id UUID PRIMARY KEY,

  aggregate_type VARCHAR(50) NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,

  -- LAW 0.9: JSONB with string-encoded money
  event_data JSONB NOT NULL,

  -- CHRONOLOGY
  occurred_at TIMESTAMPTZ NOT NULL,  -- Client time (recorded)
  ingested_at TIMESTAMPTZ NOT NULL,  -- Server time (NO DEFAULT - trigger enforced)

  -- TENANCY
  grant_cycle_id VARCHAR(20) NOT NULL,
  correlation_id UUID NOT NULL,
  causation_id UUID,
  actor_id UUID NOT NULL,
  actor_type VARCHAR(20) NOT NULL
);

-- LAW 0.7: Tuple ordering index
CREATE INDEX IF NOT EXISTS idx_event_log_order
  ON event_log(ingested_at ASC, event_id ASC);

CREATE INDEX IF NOT EXISTS idx_event_log_aggregate
  ON event_log(aggregate_type, aggregate_id, ingested_at ASC, event_id ASC);

CREATE INDEX IF NOT EXISTS idx_event_log_correlation
  ON event_log(correlation_id);

-- Token lookups
CREATE INDEX IF NOT EXISTS idx_event_log_token_consumed
  ON event_log((event_data->>'submissionTokenId'))
  WHERE event_type = 'SUBMISSION_TOKEN_CONSUMED';

-- Tentative voucher lookups
CREATE INDEX IF NOT EXISTS idx_event_log_tentative
  ON event_log((event_data->>'voucherId'))
  WHERE event_type = 'VOUCHER_ISSUED_TENTATIVE';

-- ============================================
-- LAW 0.8 + 0.11: Server-stamped ingested_at
-- ============================================
CREATE OR REPLACE FUNCTION stamp_ingested_at()
RETURNS trigger AS $$
BEGIN
  -- Truncate to millisecond precision so that JavaScript Date (which only
  -- supports ms) can represent the value without loss.  This prevents the
  -- watermark pagination comparisons from silently re-fetching the boundary
  -- event when the sub-millisecond fraction is dropped during the JS
  -- round-trip.
  NEW.ingested_at := date_trunc('milliseconds', clock_timestamp());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_log_stamp_ingested_at ON event_log;
CREATE TRIGGER event_log_stamp_ingested_at
BEFORE INSERT ON event_log
FOR EACH ROW EXECUTE FUNCTION stamp_ingested_at();

-- ============================================
-- LAW 0.5: Immutability enforcement
-- ============================================
CREATE OR REPLACE FUNCTION prevent_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'event_log is immutable: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_event_log_immutable ON event_log;
CREATE TRIGGER trg_event_log_immutable
BEFORE UPDATE OR DELETE ON event_log
FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();

CREATE OR REPLACE FUNCTION prevent_artifact_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABILITY VIOLATION: % on % is forbidden.', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ARTIFACT LOG
-- ============================================
CREATE TABLE IF NOT EXISTS artifact_log (
  artifact_id UUID PRIMARY KEY,
  artifact_type VARCHAR(50) NOT NULL,

  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256_hash VARCHAR(64) NOT NULL,
  storage_path TEXT NOT NULL,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL,

  correlation_id UUID NOT NULL
);

DROP TRIGGER IF EXISTS artifact_log_immutable ON artifact_log;
CREATE TRIGGER artifact_log_immutable
BEFORE UPDATE OR DELETE ON artifact_log
FOR EACH ROW EXECUTE FUNCTION prevent_artifact_mutation();

-- ============================================
-- PROJECTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS applications_projection (
  application_id UUID PRIMARY KEY,
  grantee_id UUID NOT NULL,
  grant_cycle_id VARCHAR(20) NOT NULL,

  organization_name VARCHAR(255),
  organization_type VARCHAR(50),

  requested_amount_cents BIGINT,
  match_commitment_cents BIGINT,

  match_level VARCHAR(20),
  status VARCHAR(30),

  completeness_percent INTEGER,
  priority_score INTEGER,

  rebuilt_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS transparency_artifacts_projection (
  artifact_id UUID PRIMARY KEY,
  artifact_type VARCHAR(50) NOT NULL,
  snapshot_period VARCHAR(7),
  stable_path TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  content_json JSONB NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transparency_stable_path
  ON transparency_artifacts_projection(stable_path);

CREATE INDEX IF NOT EXISTS idx_transparency_period
  ON transparency_artifacts_projection(snapshot_period, published_at DESC);


-- ============================================
-- PHASE 2 PROJECTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS grant_balances_projection (
  grant_id UUID NOT NULL,
  grant_cycle_id VARCHAR(20) NOT NULL,
  bucket_type VARCHAR(10) NOT NULL,  -- 'GENERAL' or 'LIRP'
  awarded_cents BIGINT NOT NULL,
  available_cents BIGINT NOT NULL,
  encumbered_cents BIGINT NOT NULL,
  liquidated_cents BIGINT NOT NULL,
  released_cents BIGINT NOT NULL,
  rate_numerator_cents BIGINT NOT NULL,
  rate_denominator_cents BIGINT NOT NULL,
  matching_committed_cents BIGINT NOT NULL DEFAULT 0,
  matching_reported_cents BIGINT NOT NULL DEFAULT 0,
  rebuilt_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL,
  PRIMARY KEY (grant_id, bucket_type),
  CONSTRAINT balance_invariant CHECK (
    available_cents + encumbered_cents + liquidated_cents = awarded_cents
  )
);

CREATE TABLE IF NOT EXISTS vouchers_projection (
  voucher_id UUID PRIMARY KEY,
  grant_id UUID NOT NULL,
  voucher_code VARCHAR(50),
  county_code VARCHAR(10),
  status VARCHAR(20) NOT NULL,
  max_reimbursement_cents BIGINT NOT NULL,
  is_lirp BOOLEAN NOT NULL DEFAULT FALSE,
  tentative_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  issued_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  rebuilt_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vouchers_tentative_expiry
  ON vouchers_projection(tentative_expires_at)
  WHERE status = 'TENTATIVE';

CREATE TABLE IF NOT EXISTS allocators_projection (
  allocator_id UUID PRIMARY KEY,  -- Hash-derived UUID (see IDENTITY_EXCEPTIONS.md)
  grant_cycle_id VARCHAR(20) NOT NULL,
  county_code VARCHAR(20) NOT NULL,
  next_sequence BIGINT NOT NULL DEFAULT 1,
  rebuilt_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL
);


-- ============================================
-- IDEMPOTENCY CACHE (Operational, UPDATE allowed)
-- ============================================
CREATE TABLE IF NOT EXISTS idempotency_cache (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  operation_type VARCHAR(50) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  response_json JSONB,
  status VARCHAR(20) NOT NULL,  -- 'NEW', 'PROCESSING', 'COMPLETED', 'FAILED'
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at
  ON idempotency_cache(expires_at);

-- No mutation trigger on idempotency_cache, as UPDATE is allowed (LAW 4.4)

-- ============================================
-- PHASE 3 PROJECTIONS (SETTLEMENT)
-- ============================================
CREATE TABLE IF NOT EXISTS vet_clinics_projection (
  clinic_id UUID PRIMARY KEY,
  clinic_name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL,
  license_status VARCHAR(20) NOT NULL,
  license_number VARCHAR(100),
  license_expires_at TIMESTAMPTZ,
  oasis_vendor_code VARCHAR(50),
  payment_info JSONB,
  registered_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  reinstated_at TIMESTAMPTZ,
  rebuilt_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL
);


CREATE TABLE IF NOT EXISTS claims_projection (
  claim_id UUID PRIMARY KEY,  -- UUIDv4 (LAW 3.1)
  claim_fingerprint VARCHAR(64) NOT NULL,  -- SHA-256 for de-duplication only
  grant_cycle_id VARCHAR(20) NOT NULL,
  voucher_id UUID NOT NULL,
  clinic_id UUID NOT NULL,
  procedure_code VARCHAR(50) NOT NULL,
  date_of_service DATE NOT NULL,
  status VARCHAR(20) NOT NULL,
  submitted_amount_cents BIGINT NOT NULL,
  approved_amount_cents BIGINT,
  decision_basis JSONB,
  invoice_id UUID,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_event_id UUID,  -- FIX: UUIDv7 from CLAIM_APPROVED event for watermark tuple
  denied_at TIMESTAMPTZ,
  adjusted_at TIMESTAMPTZ,
  invoiced_at TIMESTAMPTZ,
  rebuilt_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL,
  CONSTRAINT unique_claim_fingerprint UNIQUE (grant_cycle_id, clinic_id, claim_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_claims_voucher_id
  ON claims_projection(voucher_id);

CREATE INDEX IF NOT EXISTS idx_claims_clinic_id
  ON claims_projection(clinic_id);

CREATE INDEX IF NOT EXISTS idx_claims_status
  ON claims_projection(status);

CREATE TABLE IF NOT EXISTS invoices_projection (
  invoice_id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL,
  grant_cycle_id VARCHAR(20) NOT NULL,
  invoice_period_start DATE NOT NULL,
  invoice_period_end DATE NOT NULL,
  total_amount_cents BIGINT NOT NULL,
  claim_ids JSONB NOT NULL,  -- Array of claim IDs
  adjustment_ids JSONB,  -- Array of adjustment IDs
  status VARCHAR(20) NOT NULL,  -- DRAFT, SUBMITTED, PAID, PARTIALLY_PAID
  submitted_at TIMESTAMPTZ,
  generated_at TIMESTAMPTZ NOT NULL,
  oasis_export_batch_id UUID,
  rebuilt_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_clinic_id
  ON invoices_projection(clinic_id);

CREATE INDEX IF NOT EXISTS idx_invoices_period
  ON invoices_projection(invoice_period_start, invoice_period_end);

CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON invoices_projection(status);

CREATE TABLE IF NOT EXISTS payments_projection (
  payment_id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL,
  amount_cents BIGINT NOT NULL,
  payment_channel VARCHAR(50) NOT NULL,
  reference_id VARCHAR(255),
  recorded_at TIMESTAMPTZ NOT NULL,
  rebuilt_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice_id
  ON payments_projection(invoice_id);

CREATE TABLE IF NOT EXISTS invoice_adjustments_projection (
  adjustment_id UUID PRIMARY KEY,
  source_invoice_id UUID NOT NULL,
  grant_cycle_id VARCHAR(20) NOT NULL,
  clinic_id UUID,
  target_invoice_id UUID,
  amount_cents BIGINT NOT NULL,
  reason VARCHAR(255),
  recorded_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ,
  rebuilt_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_adjustments_source_invoice
  ON invoice_adjustments_projection(source_invoice_id);

CREATE INDEX IF NOT EXISTS idx_adjustments_target_invoice
  ON invoice_adjustments_projection(target_invoice_id);

-- ============================================
-- PHASE 4 PROJECTIONS (OASIS EXPORT + CLOSEOUT)
-- ============================================

-- OASIS Export Batches
CREATE TABLE IF NOT EXISTS oasis_export_batches_projection (
  export_batch_id UUID PRIMARY KEY,
  grant_cycle_id VARCHAR(20) NOT NULL,
  batch_code VARCHAR(30) NOT NULL,
  batch_fingerprint VARCHAR(64) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  control_total_cents BIGINT NOT NULL DEFAULT 0,
  artifact_id UUID,
  file_sha256 VARCHAR(64),
  format_version VARCHAR(20),
  submitted_at TIMESTAMPTZ,
  submission_method VARCHAR(20),
  oasis_ref_id VARCHAR(50),
  acknowledged_at TIMESTAMPTZ,
  rejection_reason TEXT,
  rejection_code VARCHAR(50),
  voided_reason TEXT,
  voided_by_actor_id UUID,
  rebuilt_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at_row TIMESTAMPTZ NOT NULL,
  watermark_event_id_row UUID NOT NULL,

  CONSTRAINT uq_export_batch_params
    UNIQUE(grant_cycle_id, period_start, period_end, watermark_ingested_at, watermark_event_id)
);

CREATE INDEX IF NOT EXISTS idx_oasis_batches_status
  ON oasis_export_batches_projection(status);

CREATE INDEX IF NOT EXISTS idx_oasis_batches_cycle
  ON oasis_export_batches_projection(grant_cycle_id);

-- OASIS Export Batch Items
CREATE TABLE IF NOT EXISTS oasis_export_batch_items_projection (
  export_batch_id UUID NOT NULL REFERENCES oasis_export_batches_projection(export_batch_id),
  invoice_id UUID NOT NULL,
  clinic_id UUID NOT NULL,
  oasis_vendor_code VARCHAR(20) NOT NULL,
  amount_cents BIGINT NOT NULL,
  invoice_period_start DATE NOT NULL,
  invoice_period_end DATE NOT NULL,
  PRIMARY KEY (export_batch_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_batch_items_invoice
  ON oasis_export_batch_items_projection(invoice_id);

-- Grant Cycle Closeout
CREATE TABLE IF NOT EXISTS grant_cycle_closeout_projection (
  grant_cycle_id VARCHAR(20) PRIMARY KEY,
  closeout_status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED',
  preflight_status VARCHAR(10),
  preflight_checks JSONB,
  started_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  financial_summary JSONB,
  matching_funds JSONB,
  activity_summary JSONB,
  reconciliation_watermark_ingested_at TIMESTAMPTZ,
  reconciliation_watermark_event_id UUID,
  closed_at TIMESTAMPTZ,
  closed_by_actor_id UUID,
  final_balance_cents BIGINT,
  audit_hold_reason TEXT,
  audit_hold_at TIMESTAMPTZ,
  audit_resolved_at TIMESTAMPTZ,
  audit_resolution TEXT,
  rebuilt_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL
);

-- ALTER existing tables for Phase 4
ALTER TABLE invoices_projection 
  ADD COLUMN IF NOT EXISTS oasis_export_batch_id UUID,
  ADD COLUMN IF NOT EXISTS last_event_ingested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_event_id UUID;
