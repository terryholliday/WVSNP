# WINDSURF — BUILD PHASE 4 (v5.2 FINAL) WV OASIS EXPORT + GRANT CYCLE CLOSEOUT

> **Role:** Windsurf (Execution Layer Only)  
> **Scope:** Implement Phase 4 export pipeline + cycle closeout + conformance tests  
> **Prerequisite:** Phases 1–3 stable (v5.1 patched)  
> **DO NOT** redesign Phases 1–3. Extend them.

---

## ABSOLUTE CANON (NON-NEGOTIABLE)

| Rule | Requirement |
|------|-------------|
| **Event Truth** | Event log is truth. Projections are disposable and rebuildable. |
| **Immutability** | No UPDATE/DELETE on event_log. Corrections are new events. |
| **Dual Time** | `occurredAt` (client assertion) + `ingestedAt` (server via `clock_timestamp()`). |
| **Ordering** | `(ingestedAt, eventId)` — never UUIDv4 for sort order. |
| **IDs** | UUIDv7 for event_id. UUIDv4/CUID2 for aggregates. See `IDENTITY_EXCEPTIONS.md`. |
| **Events** | SCREAMING_SNAKE_CASE only. |
| **Trace** | Every event envelope: `grantCycleId`, `correlationId`, `causationId`, `actorId`, `actorType`. |
| **Forbidden** | No `createdAt`/`updatedAt` in business logic. No `*_STATUS_UPDATED` events. |
| **Determinism** | Export selection replay-stable under frozen watermark tuple. |

---

## PHASE 4 OBJECTIVES

```
A) WV OASIS Export
   - Deterministic invoice selection under watermark tuple
   - Per-invoice audit trail (ITEM_ADDED events)
   - Fixed-width file with control totals
   - SHA-256 file hash as "Receipt of Truth"
   - Idempotent generation, submission, retry
   - VOIDED + REJECTED as separate workflows

B) Grant Cycle Closeout
   - Cycle-level aggregate (not per-grant)
   - Pre-flight validation before closeout starts
   - Matching funds + activity summary reconciliation
   - Explicit lock: blocked vs allowed event matrix
   - Audit hold/resolve for investigative pauses
```

---

# SECTION 1 — DOMAIN EVENTS

## 1A: Export Batch (Aggregate: OasisExportBatch)

```
OASIS_EXPORT_BATCH_CREATED
  exportBatchId: ExportBatchId (UUIDv4)
  grantCycleId: GrantCycleId
  periodStart: LocalDate
  periodEnd: LocalDate
  watermarkIngestedAt: Timestamp
  watermarkEventId: EventId (UUIDv7)
  batchFingerprint: string (SHA-256)
  generatedByActorId: ActorId

OASIS_EXPORT_BATCH_ITEM_ADDED
  exportBatchId: ExportBatchId
  invoiceId: InvoiceId
  clinicId: ClinicId
  oasisVendorCode: string
  amountCents: MoneyCents
  invoicePeriodStart: LocalDate
  invoicePeriodEnd: LocalDate

OASIS_EXPORT_FILE_RENDERED
  exportBatchId: ExportBatchId
  artifactId: ArtifactId
  fileFormat: 'FIXED_WIDTH'
  formatVersion: string (e.g., "OASIS_FW_v1")
  sha256: string
  contentLength: number
  recordCount: number
  controlTotalCents: MoneyCents

OASIS_EXPORT_BATCH_SUBMITTED
  exportBatchId: ExportBatchId
  submissionMethod: 'MANUAL_UPLOAD' | 'API'
  submittedByActorId: ActorId

OASIS_EXPORT_BATCH_ACKNOWLEDGED
  exportBatchId: ExportBatchId
  oasisRefId: OasisRefId (branded)
  acceptedAt: occurredAt
  notes?: string

OASIS_EXPORT_BATCH_REJECTED
  exportBatchId: ExportBatchId
  rejectionReason: string
  rejectionCode?: string
  rejectedBySource: 'TREASURY'

OASIS_EXPORT_BATCH_VOIDED
  exportBatchId: ExportBatchId
  reason: string
  voidedByActorId: ActorId
```

**REJECTED vs VOIDED:**
- REJECTED = Treasury said no (external). Fix and regenerate under new batch.
- VOIDED = We caught an error before submission (internal). Cancel and regenerate.
- Both release invoices back to the unassigned pool (projection-derived, not invoice events).

---

## 1B: Grant Cycle Closeout (Aggregate: GrantCycleCloseout)

```
GRANT_CYCLE_CLOSEOUT_PREFLIGHT_COMPLETED
  grantCycleId: GrantCycleId
  status: 'PASSED' | 'FAILED'
  checks: PreflightCheck[]
  initiatedByActorId: ActorId

GRANT_CYCLE_CLOSEOUT_STARTED
  grantCycleId: GrantCycleId
  startedByActorId: ActorId

GRANT_CYCLE_CLOSEOUT_RECONCILED
  grantCycleId: GrantCycleId
  watermarkIngestedAt: Timestamp
  watermarkEventId: EventId
  financialSummary: FinancialSummary
  matchingFunds: MatchingFundsSummary
  activitySummary: ActivitySummary

GRANT_CYCLE_CLOSEOUT_ARTIFACT_ATTACHED
  grantCycleId: GrantCycleId
  artifactId: ArtifactId
  artifactType: 'FINAL_REPORT' | 'FINANCIAL_SUMMARY' | 'ACTIVITY_REPORT'
  sha256: string
  contentLength: number

GRANT_CYCLE_CLOSED
  grantCycleId: GrantCycleId
  closedByActorId: ActorId
  finalBalanceCents: MoneyCents

GRANT_CYCLE_CLOSEOUT_AUDIT_HOLD
  grantCycleId: GrantCycleId
  reason: string
  initiatedByActorId: ActorId

GRANT_CYCLE_CLOSEOUT_AUDIT_RESOLVED
  grantCycleId: GrantCycleId
  resolution: string
  resolvedByActorId: ActorId
```

---

## 1C: Deadline Events (Cycle Governance)

```
GRANT_PERIOD_ENDED
  grantCycleId: GrantCycleId
  periodEndDate: LocalDate (June 30)

GRANT_CLAIMS_DEADLINE_PASSED
  grantCycleId: GrantCycleId
  deadlineDate: LocalDate (November 15)
```

---

# SECTION 2 — SELECTION & DETERMINISM

## 2A: Invoice Selection Query

```sql
SELECT i.*, c.oasis_vendor_code
FROM invoices_projection i
JOIN vet_clinics_projection c ON c.clinic_id = i.clinic_id
WHERE i.is_submitted = true
  AND i.oasis_export_batch_id IS NULL
  AND c.oasis_vendor_code IS NOT NULL
  AND (
    i.last_event_ingested_at < $1
    OR (i.last_event_ingested_at = $1 AND i.last_event_id <= $2)
  )
ORDER BY
  i.last_event_ingested_at ASC,
  i.last_event_id ASC,
  i.invoice_id ASC;
```

**Critical Rules:**
- `$1` = watermarkIngestedAt, `$2` = watermarkEventId
- Ordering by `(ingestedAt, eventId)` — NEVER by UUIDv4 invoice_id alone
- `invoice_id` is tie-break only (third position)
- Missing `oasis_vendor_code` excludes invoice from batch (fail-closed)
- Same watermark + same events = same file hash (deterministic)

## 2B: Batch Fingerprint

```
BatchFingerprint = SHA-256(grantCycleId + ":" + periodStart + ":" + periodEnd + ":" + sorted(invoiceIds).join(","))
```

- De-duplication aid, NOT the aggregate ID
- Same pattern as ClaimFingerprint
- Stored in OASIS_EXPORT_BATCH_CREATED event

## 2C: Fail-Closed Validation

Before emitting OASIS_EXPORT_FILE_RENDERED, validate:

| Check | Failure Action |
|-------|----------------|
| Clinic missing oasisVendorCode | Exclude from batch (or fail entire batch) |
| Invoice missing required fields | BLOCK generation, no FILE_RENDERED |
| Control totals mismatch | BLOCK generation, no FILE_RENDERED |
| Batch already has FILE_RENDERED | Return existing (idempotent) |
| Cycle is CLOSED | BLOCK generation, return error |

---

# SECTION 3 — IDEMPOTENCY

## 3A: Batch Generation

```
UNIQUE(grant_cycle_id, period_start, period_end, watermark_ingested_at, watermark_event_id)
  ON oasis_export_batches_projection
```

- If batch exists for same parameters, return existing exportBatchId
- Do NOT create duplicate batches

## 3B: File Rendering

- If OASIS_EXPORT_FILE_RENDERED exists for exportBatchId, return existing artifact
- Re-render only after VOIDED + new batch created

## 3C: Submission

- If OASIS_EXPORT_BATCH_SUBMITTED exists, repeated attempts are no-ops
- Return existing submission status

---

# SECTION 4 — FIXED-WIDTH RENDERER

## 4A: Format Specification

**Format Version:** `OASIS_FW_v1`  
**Record Width:** 100 characters per line  
**Line Ending:** CRLF  
**Encoding:** ASCII

**Header Record (Line 1):**

| Field | Width | Position | Format |
|-------|-------|----------|--------|
| recordType | 1 | 1 | "H" |
| batchCode | 20 | 2-21 | Left-padded space |
| generationDate | 8 | 22-29 | MMDDYYYY |
| recordCount | 6 | 30-35 | Right-padded zero |
| controlTotal | 12 | 36-47 | Right-padded zero, cents |
| fundCode | 5 | 48-52 | "WVSNP" |
| formatVersion | 10 | 53-62 | "OASIS_FW_v1" |
| filler | 38 | 63-100 | Spaces |

**Detail Record (Lines 2–N):**

| Field | Width | Position | Format |
|-------|-------|----------|--------|
| recordType | 1 | 1 | "D" |
| vendorCode | 10 | 2-11 | Left-padded space |
| invoiceCode | 15 | 12-26 | Left-padded space |
| invoiceDate | 8 | 27-34 | MMDDYYYY |
| paymentAmount | 12 | 35-46 | Right-padded zero, cents |
| fundCode | 5 | 47-51 | "WVSNP" |
| orgCode | 5 | 52-56 | WVDA org code |
| objectCode | 4 | 57-60 | Expense type |
| description | 30 | 61-90 | Left-padded space, truncate |
| filler | 10 | 91-100 | Spaces |

**Footer Record (Line N+1):**

| Field | Width | Position | Format |
|-------|-------|----------|--------|
| recordType | 1 | 1 | "F" |
| batchCode | 20 | 2-21 | Same as header |
| recordCount | 6 | 22-27 | Must match header |
| controlTotal | 12 | 28-39 | Must match header |
| filler | 61 | 40-100 | Spaces |

> ⚠️ **NOTE:** This layout is a working specification. If WV Treasury provides an official OASIS import format document, that supersedes this layout. Pin the `formatVersion` in every FILE_RENDERED event so format changes are traceable.

## 4B: Renderer Rules

- Renderer is a **pure function**: `(invoices[], batchMetadata) → string`
- No side effects, no DB access
- Truncate strings that exceed field width (never overflow)
- Pad numbers with leading zeros (never negative)
- Control totals = sum of all detail paymentAmount fields
- Record count = number of detail records (excludes header/footer)
- Assert: footer totals === header totals === computed totals
- If assertion fails → DO NOT emit FILE_RENDERED

## 4C: Format Versioning

```typescript
const OASIS_FORMAT_VERSION = 'OASIS_FW_v1' as const;
```

- Stored as constant in renderer module
- Included in every OASIS_EXPORT_FILE_RENDERED event
- When Treasury changes format: bump version, keep old renderer for replay

---

# SECTION 5 — GRANT CYCLE CLOSEOUT

## 5A: Deadline Enforcement

| Date | Event | System Action |
|------|-------|---------------|
| June 30 | Grant period ends | Emit `GRANT_PERIOD_ENDED`. Block new voucher issuance. |
| November 15 | Claim deadline | Emit `GRANT_CLAIMS_DEADLINE_PASSED`. Block new claim submission. |
| November 15 | Report deadline | Admin must submit final report. |
| November 30 | Payment deadline | Warning only. All invoices should be paid. |

**Enforcement in existing services:**

```
Voucher issuance (Phase 2):
  IF GRANT_PERIOD_ENDED exists for cycle → REJECT

Claim submission (Phase 3):
  IF GRANT_CLAIMS_DEADLINE_PASSED exists for cycle → REJECT
  IF dateOfService > grantPeriodEnd (June 30) → REJECT
```

## 5B: Pre-Flight Check

Before closeout can start, run automated validation:

```
PreflightCheck[] = [
  { check: 'ALL_APPROVED_CLAIMS_INVOICED',    pass: boolean, details: string },
  { check: 'ALL_SUBMITTED_INVOICES_EXPORTED',  pass: boolean, details: string },
  { check: 'ALL_EXPORT_BATCHES_ACKNOWLEDGED',  pass: boolean, details: string },
  { check: 'ALL_PAYMENTS_RECORDED',            pass: boolean, details: string },
  { check: 'NO_PENDING_ADJUSTMENTS',           pass: boolean, details: string },
  { check: 'MATCHING_FUNDS_REPORTED',          pass: boolean, details: string },
]
```

- Emit `GRANT_CYCLE_CLOSEOUT_PREFLIGHT_COMPLETED` with results
- If any check fails → closeout CANNOT start
- Pre-flight can be re-run after fixes

## 5C: Reconciliation Payloads

**FinancialSummary:**
```
awardedCents: MoneyCents
encumberedCents: MoneyCents
liquidatedCents: MoneyCents
releasedCents: MoneyCents
unspentCents: MoneyCents
```

**Invariant:** `awardedCents === liquidatedCents + releasedCents + unspentCents`

**MatchingFundsSummary:**
```
committedCents: MoneyCents
reportedCents: MoneyCents
shortfallCents: MoneyCents
evidenceArtifactIds: ArtifactId[]
```

**ActivitySummary:**
```
vouchersIssued: number
vouchersRedeemed: number
vouchersExpired: number
vouchersVoided: number
claimsSubmitted: number
claimsApproved: number
claimsDenied: number
claimsAdjusted: number
invoicesGenerated: number
invoicesPaid: number
dogSpays: number
dogNeuters: number
catSpays: number
catNeuters: number
communityCatSpays: number
communityCatNeuters: number
totalAnimalsServed: number
countiesCovered: string[]
```

## 5D: Closeout Lock (EXPLICIT MATRIX)

After `GRANT_CYCLE_CLOSED` is emitted:

**🚫 BLOCKED (Reject with GRANT_CYCLE_CLOSED error):**
```
VOUCHER_ISSUED
VOUCHER_ISSUED_TENTATIVE
CLAIM_SUBMITTED
CLAIM_APPROVED
CLAIM_ADJUSTED
INVOICE_GENERATED
GRANT_FUNDS_ENCUMBERED
GRANT_FUNDS_LIQUIDATED
```

**✅ STILL ALLOWED:**
```
PAYMENT_RECORDED (settling existing invoices)
PAYMENT_SHORTFALL_FLAGGED
PAYMENT_SHORTFALL_RESOLVED
OASIS_EXPORT_BATCH_* (exporting already-approved work)
GRANT_CYCLE_CLOSEOUT_ARTIFACT_ATTACHED
GRANT_CYCLE_CLOSEOUT_AUDIT_HOLD
GRANT_CYCLE_CLOSEOUT_AUDIT_RESOLVED
```

**Implementation:** Every command handler for a blocked event must check:
```
IF grantCycleCloseoutStatus === 'CLOSED' → REJECT
```

## 5E: Audit Hold

```
Lifecycle:
  CLOSEOUT_STARTED → RECONCILED → CLOSED
                   → AUDIT_HOLD → AUDIT_RESOLVED → CLOSED
```

- AUDIT_HOLD pauses closeout. Cannot proceed to CLOSED until resolved.
- AUDIT_HOLD does NOT reopen financial events. Books stay locked.
- AUDIT_RESOLVED allows proceeding to CLOSED.

---

# SECTION 6 — INVOICE RELEASE (REJECTED/VOIDED BATCHES)

When a batch is REJECTED or VOIDED:

**Projection behavior:**
- Clear `oasis_export_batch_id` on affected invoices in `invoices_projection`
- This is **projection-derived** from batch status, NOT an invoice event
- Invoices become eligible for the next batch generation

**Rules:**
- Do NOT emit invoice-level events for batch rejection/voiding
- The batch events (REJECTED/VOIDED) are sufficient audit trail
- Projection rebuild logic: if batch status is REJECTED or VOIDED, invoice's `oasis_export_batch_id` = NULL

---

# SECTION 7 — PROJECTIONS & SCHEMA

## 7A: New Tables

```sql
CREATE TABLE oasis_export_batches_projection (
  export_batch_id UUID PRIMARY KEY,
  grant_cycle_id UUID NOT NULL,
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
  voided_reason TEXT,
  voided_by_actor_id UUID,
  watermark_ingested_at_row TIMESTAMPTZ NOT NULL,
  watermark_event_id_row UUID NOT NULL,

  CONSTRAINT uq_export_batch_params
    UNIQUE(grant_cycle_id, period_start, period_end, watermark_ingested_at, watermark_event_id)
);

CREATE TABLE oasis_export_batch_items_projection (
  export_batch_id UUID NOT NULL REFERENCES oasis_export_batches_projection(export_batch_id),
  invoice_id UUID NOT NULL,
  clinic_id UUID NOT NULL,
  oasis_vendor_code VARCHAR(20) NOT NULL,
  amount_cents BIGINT NOT NULL,
  invoice_period_start DATE NOT NULL,
  invoice_period_end DATE NOT NULL,
  PRIMARY KEY (export_batch_id, invoice_id)
);

CREATE TABLE grant_cycle_closeout_projection (
  grant_cycle_id UUID PRIMARY KEY,
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
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL
);
```

## 7B: Schema Updates

```sql
-- Add to invoices_projection
ALTER TABLE invoices_projection ADD COLUMN IF NOT EXISTS
  oasis_export_batch_id UUID,
  last_event_ingested_at TIMESTAMPTZ NOT NULL,
  last_event_id UUID NOT NULL;

-- Add to grants_projection (cycle governance)
ALTER TABLE grants_projection ADD COLUMN IF NOT EXISTS
  period_ended_at TIMESTAMPTZ,
  claims_deadline_passed_at TIMESTAMPTZ;
```

---

# SECTION 8 — FILES TO CREATE / UPDATE

**New Files:**
```
src/domain/oasis/batch-logic.ts         — Reducer + state machine
src/domain/oasis/renderer.ts            — Pure function: invoices → fixed-width string
src/domain/closeout/cycle-logic.ts      — Reducer + lock check
src/application/oasis-service.ts        — Generate, render, submit, ack, reject, void
src/application/closeout-service.ts     — Preflight, start, reconcile, close, hold, resolve
src/projections/oasis-projector.ts      — Batch + items projection builder
src/projections/closeout-projector.ts   — Cycle closeout projection builder
docs/conformance/phase4-proof.sql       — Audit queries
tests/phase4-v5.2-conformance.test.ts   — All conformance tests
```

**Updated Files:**
```
db/schema.sql                           — New tables + ALTER statements
src/application/voucher-service.ts      — Add GRANT_PERIOD_ENDED check
src/application/claim-service.ts        — Add GRANT_CLAIMS_DEADLINE_PASSED check
docs/IDENTITY_EXCEPTIONS.md            — Add ExportBatchId + BatchFingerprint
```

---

# SECTION 9 — CONFORMANCE TESTS

### Test 1: Export Determinism
```
Given: Seed events + watermark W1
When: Generate export batch
Then: File SHA-256 = X
When: Rebuild projections from genesis, generate again with W1
Then: File SHA-256 = X (identical)
```

### Test 2: Export Idempotency (Generation)
```
Given: Batch generated for (cycleId, periodStart, periodEnd, W1)
When: Generate again with same parameters
Then: Returns existing exportBatchId
And: No duplicate OASIS_EXPORT_BATCH_CREATED event
```

### Test 3: Export Idempotency (Submission)
```
Given: Batch submitted
When: Submit again
Then: No-op, returns existing status
And: No duplicate OASIS_EXPORT_BATCH_SUBMITTED event
```

### Test 4: VOIDED Releases Invoices
```
Given: Batch with 3 invoices, VOIDED
When: Generate new batch for same period
Then: Same 3 invoices eligible for new batch
And: New exportBatchId (different from voided)
```

### Test 5: REJECTED Releases Invoices
```
Given: Batch submitted, Treasury rejects
When: OASIS_EXPORT_BATCH_REJECTED recorded
Then: Invoices have oasis_export_batch_id = NULL in projection
And: Eligible for next batch
```

### Test 6: Missing Vendor Code Blocks Export
```
Given: Clinic without oasisVendorCode
When: Generate export batch
Then: Clinic's invoices excluded from batch
And: Log warning (or fail entire batch per policy)
```

### Test 7: Control Totals Match
```
Given: Batch with N invoices
When: File rendered
Then: Header recordCount = N
And: Header controlTotal = sum of detail amounts
And: Footer recordCount = Header recordCount
And: Footer controlTotal = Header controlTotal
```

### Test 8: Fixed-Width Format
```
Given: Rendered file
Then: Every line is exactly 100 characters
And: Header starts with "H"
And: Details start with "D"
And: Footer starts with "F"
```

### Test 9: Closeout Pre-Flight
```
Given: Unapproved claims exist
When: Run pre-flight
Then: PREFLIGHT status = FAILED
And: Cannot start closeout
```

### Test 10: Closeout Lock
```
Given: GRANT_CYCLE_CLOSED emitted
When: Attempt VOUCHER_ISSUED for that cycle
Then: REJECTED with GRANT_CYCLE_CLOSED error
When: Attempt CLAIM_SUBMITTED for that cycle
Then: REJECTED with GRANT_CYCLE_CLOSED error
When: Attempt PAYMENT_RECORDED for existing invoice
Then: ALLOWED (settling existing obligations)
```

### Test 11: Audit Hold Pauses Closeout
```
Given: Closeout RECONCILED
When: AUDIT_HOLD emitted
Then: Cannot proceed to CLOSED
When: AUDIT_RESOLVED emitted
Then: Can proceed to CLOSED
```

### Test 12: Deadline Enforcement
```
Given: GRANT_PERIOD_ENDED emitted
When: Attempt to issue voucher
Then: REJECTED

Given: GRANT_CLAIMS_DEADLINE_PASSED emitted
When: Attempt to submit claim
Then: REJECTED
```

### Test 13: Reconciliation Invariant
```
Given: Closeout reconciled
Then: awardedCents === liquidatedCents + releasedCents + unspentCents
And: matchingFunds.shortfallCents === committedCents - reportedCents
```

### Test 14: Replay Determinism
```
Given: Full event_log from genesis
When: Drop all projections, rebuild
Then: oasis_export_batches_projection identical
And: grant_cycle_closeout_projection identical
And: All derived statuses match
```

---

# SECTION 10 — STOP CONDITIONS

If any of the following occur, **STOP and report**:

- `createdAt`/`updatedAt` in business logic
- Export file ordered by UUIDv4 alone
- `*_STATUS_UPDATED` event created
- Closeout lock not enforced on blocked events
- Adjustments written to projection without event
- Control totals computed outside renderer
- Missing `formatVersion` in FILE_RENDERED
- Missing `sha256` in FILE_RENDERED
- Invoice events emitted for batch REJECTED/VOIDED
- ClaimId reverted to SHA-256 hash

---

# SECTION 11 — VERIFICATION CHECKLIST

After build, verify:

| Check | Command/Query | Expected |
|-------|---------------|----------|
| Batch UNIQUE constraint | `\d oasis_export_batches_projection` | 5-column UNIQUE |
| Export ordering | grep renderer.ts for ORDER BY | `ingested_at, event_id, invoice_id` |
| SHA-256 in event | grep FILE_RENDERED | `sha256` field present |
| Format version | grep renderer.ts | `OASIS_FW_v1` constant |
| VOIDED event exists | grep batch-logic.ts | `OASIS_EXPORT_BATCH_VOIDED` |
| Closeout block list | grep claim-service.ts + voucher-service.ts | Cycle closed check |
| Pre-flight event | grep closeout-service.ts | `PREFLIGHT_COMPLETED` |
| Matching funds | grep closeout-service.ts | `matchingFunds` payload |
| Activity summary | grep closeout-service.ts | `activitySummary` payload |
| Audit hold | grep cycle-logic.ts | `AUDIT_HOLD` + `AUDIT_RESOLVED` |
| Deadline enforcement | grep voucher-service.ts | `GRANT_PERIOD_ENDED` check |
| Build passes | `pnpm build` | Exit 0 |
| Tests pass | `pnpm test` | All green |

---

**BEGIN PHASE 4 BUILD.**
