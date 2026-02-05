# WINDSURF — CRITICAL PRE-PHASE 4 STABILIZATION (v5.3)

> **Role:** Windsurf (Surgical Patch — NO new features)  
> **Scope:** Fix all audit findings in existing Phases 1–3 codebase  
> **Priority:** BLOCKING — Phase 4 cannot begin until ALL fixes verified  
> **DO NOT** add features. DO NOT proceed to Phase 4. Fix only.

---

## GOVERNING LAW

- `WVSNP_MASTER_SPEC_v5.0.md`
- `docs/IDENTITY_EXCEPTIONS.md` (v5.2) — provided below
- Addendum v5.2 is canonical. Prior versions are superseded.

---

## DIAGNOSIS

The system is currently **fighting itself**:

- Schema defines tables twice (Phase 2 columns never exist)
- Immutability triggers block the projectors from writing
- AllocatorId can't fit in the UUID column
- Invoice pipeline is dead (approved_event_id never populated)
- Money math uses floating point (Number() instead of BigInt)

**None of these are feature gaps. They are structural fractures.**

---

## FIX ORDER (STRICT SEQUENCE)

```
Phase 0: Schema Surgery (runtime blockers)
  Fix 1  — Duplicate table definitions
  Fix 2  — Projection immutability triggers
  Fix 3  — AllocatorId UUID formatting
  Fix 4  — grant_cycle_id column type

Phase 1: Pipeline Repair (data flow blockers)
  Fix 5  — approved_event_id population
  Fix 6  — Sweep job trace fields
  Fix 7  — Claims not marked invoiced

Phase 2: Identity Alignment (v5.2 compliance)
  Fix 8  — ClaimId must be client-generated UUIDv4

Phase 3: Business Logic Corrections
  Fix 9  — LIRP co-pay enforcement
  Fix 10 — Money doctrine (BigInt, no Number())
  Fix 11 — Carry-forward adjustment filtering
  Fix 12 — Voucher expiry validation

Phase 4: Docs & Tests
  Fix 13 — IDENTITY_EXCEPTIONS.md v5.2
  Fix 14 — Conformance proof update
```

---

# PHASE 0 — SCHEMA SURGERY

## Fix 1 — Duplicate Table Definitions

**Problem:** `grant_balances_projection` and `vouchers_projection` are defined twice with `CREATE TABLE IF NOT EXISTS`. The first (Phase 1) definition wins. Phase 2 columns (`bucket_type`, `is_lirp`, etc.) never exist. Bucket isolation queries fail silently.

**Fix:**
```
1. Search schema.sql for ALL occurrences of:
   - CREATE TABLE grant_balances_projection
   - CREATE TABLE vouchers_projection
   
2. COUNT occurrences. If more than 1 of either, you have duplicates.

3. KEEP ONLY the most complete definition (Phase 2 version).
   DELETE the Phase 1 version entirely.

4. The surviving grant_balances_projection MUST include:
   - grant_id UUID NOT NULL
   - grant_cycle_id UUID NOT NULL
   - bucket_type VARCHAR(10) NOT NULL  ← Phase 2 column
   - awarded_cents BIGINT NOT NULL
   - encumbered_cents BIGINT NOT NULL
   - liquidated_cents BIGINT NOT NULL
   - released_cents BIGINT NOT NULL
   - available_cents BIGINT NOT NULL
   - watermark_ingested_at TIMESTAMPTZ NOT NULL
   - watermark_event_id UUID NOT NULL
   - PRIMARY KEY (grant_id, bucket_type)

5. The surviving vouchers_projection MUST include:
   - voucher_id UUID PRIMARY KEY
   - is_lirp BOOLEAN NOT NULL  ← Phase 2 column
   - county_code VARCHAR(10)
   - expires_at TIMESTAMPTZ NOT NULL
   - status VARCHAR(20) NOT NULL
   - All other Phase 2 columns
   - watermark_ingested_at TIMESTAMPTZ NOT NULL
   - watermark_event_id UUID NOT NULL
```

**Verify:** `grep -c "CREATE TABLE.*grant_balances_projection" db/schema.sql` → must return `1`  
**Verify:** `grep -c "CREATE TABLE.*vouchers_projection" db/schema.sql` → must return `1`

---

## Fix 2 — Projection Immutability Triggers

**Problem:** `forbid_mutation` triggers on projection tables block UPDATE and DELETE. But projectors MUST do `ON CONFLICT DO UPDATE` and `UPDATE` to maintain derived state. These triggers cause runtime crashes.

**Governing Rule:** In event sourcing, the **event_log is immutable**. Projections are **disposable, mutable derived views**. Immutability enforcement belongs on `event_log` ONLY.

**Fix:**
```
1. Search schema.sql for ALL trigger definitions on *_projection tables:
   - forbid_mutation
   - prevent_mutation
   - immutable
   - Any trigger that blocks UPDATE or DELETE

2. REMOVE every such trigger from projection tables:
   - grant_balances_projection
   - vouchers_projection
   - claims_projection
   - invoices_projection
   - payments_projection
   - vet_clinics_projection
   - invoice_adjustments_projection
   - allocators_projection

3. KEEP the immutability trigger on event_log:

   CREATE OR REPLACE FUNCTION prevent_event_mutation()
   RETURNS TRIGGER AS $$
   BEGIN
     RAISE EXCEPTION 'event_log is immutable: % not allowed', TG_OP;
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER trg_event_log_immutable
     BEFORE UPDATE OR DELETE ON event_log
     FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();

4. If artifact_log table exists, KEEP its immutability trigger too.
```

**Verify:** `grep -n "forbid_mutation\|prevent_mutation\|immutable" db/schema.sql | grep -v event_log | grep -v artifact_log` → must be EMPTY

---

## Fix 3 — AllocatorId UUID Formatting

**Problem:** AllocatorId is SHA-256 per IDENTITY_EXCEPTIONS.md, but `event_log.aggregate_id` is UUID. A raw 64-char hex string won't fit in a UUID column.

**Fix:** Convert SHA-256 to UUID format (hash-derived UUID). Use first 32 hex chars formatted as 8-4-4-4-12.

**Reference Implementation:**
```typescript
import crypto from 'node:crypto';

function getAllocatorId(grantCycleId: string, countyCode: string): AllocatorId {
  const input = `VoucherCodeAllocator:${grantCycleId}:${countyCode}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  // Format first 32 hex chars as UUID: 8-4-4-4-12
  const uuid = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
  return uuid as AllocatorId;
}
```

**Files to update:**
```
- src/domain-types.ts: Ensure AllocatorId is branded UUID string
- src/domain/allocator/voucher-code-allocator.ts: Use UUID-formatted hash
- src/application/grant-service.ts: Verify getAllocatorId returns UUID format
```

**Verify:** `getAllocatorId('cycle-123', 'GREENBRIER')` returns string matching UUID regex

---

## Fix 4 — grant_cycle_id Column Type

**Problem:** `claims_projection.grant_cycle_id` is `VARCHAR(20)` but v5.2 requires UUID for all entity IDs. Joins with other tables using UUID will fail or produce wrong results.

**Fix:**
```
In db/schema.sql, change claims_projection:
  WRONG:  grant_cycle_id VARCHAR(20)
  RIGHT:  grant_cycle_id UUID NOT NULL
```

**Verify:** `grep "grant_cycle_id" db/schema.sql | grep claims` → shows UUID type

---

# PHASE 1 — PIPELINE REPAIR

## Fix 5 — approved_event_id Population

**Problem:** `approved_event_id` column exists in `claims_projection` but is NEVER populated. The claim reducer doesn't receive `event_id` from the event envelope. Invoice generation filters on this column, so ALL approved claims are excluded. **Invoices are empty.**

**Files to update:**
```
- src/domain/claim/claim-logic.ts (reducer)
- src/projections/claim-projector.ts (projection writer)
- src/application/claim-service.ts (adjudication handler)
```

**Fix:**
```
1. In claim-logic.ts, update reducer for CLAIM_APPROVED:
   - The reducer must receive the event envelope (not just eventData)
   - On CLAIM_APPROVED, capture:
     state.approvedEventId = event.eventId     // UUIDv7
     state.approvedAt = event.ingestedAt       // server truth

2. In claim-projector.ts (or wherever projection is updated):
   - On CLAIM_APPROVED event:
     UPDATE claims_projection
     SET status = 'APPROVED',
         approved_event_id = $eventId,
         approved_at = $ingestedAt,
         reimbursement_amount_cents = $amount,
         decision_basis = $decisionBasis
     WHERE claim_id = $claimId

3. In claim-service.ts adjudicateClaim():
   - After appending CLAIM_APPROVED event, get back the event_id
   - Pass event_id to projection update

4. Verify invoice selection query works:
   SELECT * FROM claims_projection
   WHERE status IN ('APPROVED', 'ADJUSTED')
     AND invoice_id IS NULL
     AND approved_at IS NOT NULL
     AND approved_event_id IS NOT NULL
     AND (approved_at < $W OR (approved_at = $W AND approved_event_id <= $E))
```

**Verify:** After approving a claim, `SELECT approved_event_id FROM claims_projection WHERE claim_id = $1` → NOT NULL

---

## Fix 6 — Sweep Job Trace Fields

**Problem:** Sweep job emits events with non-UUID strings for `correlationId` and `actorId` (e.g., "SYSTEM", "sweep-job"). Schema requires UUID columns. Insert fails.

**Files:** `src/jobs/sweep-expired-tentatives.ts`

**Fix:**
```
1. Define system constants:
   // Well-known system actor (fixed UUID — same across all runs)
   const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000' as ActorId;

2. Per sweep run, generate ONE correlation ID:
   const sweepCorrelationId = crypto.randomUUID() as CorrelationId;

3. For each event emitted during sweep:
   {
     actorId: SYSTEM_ACTOR_ID,
     actorType: 'SYSTEM',
     correlationId: sweepCorrelationId,  // shared across all events in this run
     causationId: originalTentativeEventId,  // the event being swept
   }

4. All trace fields must be valid UUID strings.
```

**Verify:** `grep "actorId" src/jobs/sweep-expired-tentatives.ts` → shows UUID constant, not string literal

---

## Fix 7 — Claims Not Marked Invoiced

**Problem:** When claims are included in an invoice, they are NOT updated in `claims_projection`. The same claim can be included in multiple invoices.

**Files:** `src/application/invoice-service.ts`

**Fix:**
```
1. After emitting INVOICE_GENERATED, for each claim in the invoice:
   a. Emit CLAIM_INVOICED event:
      {
        eventType: 'CLAIM_INVOICED',
        eventData: { claimId, invoiceId, invoiceCode }
      }
   b. Update claims_projection:
      UPDATE claims_projection
      SET status = 'INVOICED', invoice_id = $invoiceId
      WHERE claim_id = $claimId

2. Invoice selection query MUST filter:
   WHERE invoice_id IS NULL

3. This prevents re-invoicing deterministically.
```

**Verify:** After invoice generation, `SELECT COUNT(*) FROM claims_projection WHERE status = 'INVOICED' AND invoice_id IS NOT NULL` → matches claim count in invoice

---

# PHASE 2 — IDENTITY ALIGNMENT

## Fix 8 — ClaimId Must Be Client-Generated UUIDv4

**Problem:** v5.2 requires ClaimId as client-generated UUIDv4. Code generates UUIDv7 server-side via `EventStore.newEventId()` and doesn't accept client-provided ClaimId.

**Files:** `src/application/claim-service.ts`, `src/domain-types.ts`

**Fix:**
```
1. In the submit claim request type:
   - Accept claimId: ClaimId from client
   - If not provided (backoffice/migration): generate via crypto.randomUUID()
   - NEVER use EventStore.newEventId() for ClaimId (that's UUIDv7 for events only)

2. Validate format:
   - Must match UUIDv4 pattern
   - Reject if UUIDv7 or other format

3. De-duplication remains via ClaimFingerprint:
   - fingerprint = SHA-256(canonicalized business tuple)
   - UNIQUE(grant_cycle_id, clinic_id, claim_fingerprint) on projection
   - ON CONFLICT → return { status: 'DUPLICATE_DETECTED', claimId: existingId }

4. EventStore.newEventId() usage audit:
   - ALLOWED for: event_id generation only
   - FORBIDDEN for: claimId, invoiceId, paymentId, or any aggregate ID
```

**Verify:** `grep "newEventId\|uuidv7" src/application/claim-service.ts` → NOT found for aggregate ID generation

---

# PHASE 3 — BUSINESS LOGIC CORRECTIONS

## Fix 9 — LIRP Co-Pay Enforcement

**Problem:** LIRP "co-pay forbidden" rule (LAW 7.4) is not enforced in voucher issuance or claim submission. A LIRP voucher can have co-pay charges.

**Files:** `src/application/grant-service.ts`, `src/application/claim-service.ts`

**Fix:**
```
1. In claim-service.ts submitClaim():
   - Load voucher from vouchers_projection
   - IF voucher.is_lirp === true AND request.coPayCollectedCents > 0n:
     → REJECT with 'LIRP_COPAY_FORBIDDEN'
     → DO NOT emit CLAIM_SUBMITTED

2. In grant-service.ts (voucher issuance):
   - When issuing from LIRP bucket, verify is_lirp = true on voucher
   - When issuing from GENERAL bucket, verify is_lirp = false

3. Check must happen BEFORE event emission (fail-closed).
```

**Verify:** `grep "LIRP_COPAY_FORBIDDEN" src/application/claim-service.ts` → found

---

## Fix 10 — Money Doctrine (No Number())

**Problem:** Multiple files use `Number()` to convert MoneyCents values. This introduces floating-point precision errors on large amounts and violates LAW 1.4.

**Files:** `src/application/grant-service.ts`, `src/application/claim-service.ts`, `src/application/invoice-service.ts`

**Fix:**
```
1. Search ALL .ts files in src/application/ for Number() on money fields:
   grep -rn "Number(" src/application/ | grep -i "cent\|amount\|cost\|balance"

2. Replace every occurrence:
   WRONG:  if (Number(amount) > Number(available))
   RIGHT:  if (amount > available)  // both BigInt, direct comparison

   WRONG:  const total = Number(a) + Number(b)
   RIGHT:  const total = a + b  // BigInt addition

   WRONG:  JSON.stringify({ amount: Number(cents) })
   RIGHT:  JSON.stringify({ amount: cents.toString() })

3. Also search for parseFloat and parseInt on money fields:
   grep -rn "parseFloat\|parseInt" src/application/ | grep -i "cent\|amount"
   Replace with BigInt() parsing.

4. JSONB storage must use string encoding:
   { "amountCents": "15000" }  // String, not number
```

**Verify:** `grep -rn "Number(" src/application/ | grep -ic "cent\|amount\|cost\|balance"` → returns 0

---

## Fix 11 — Carry-Forward Adjustment Filtering

**Problem:** Carry-forward adjustments are applied to every clinic. A TODO comment says "always true" in the filter condition.

**Files:** `src/application/invoice-service.ts` (~line 81)

**Fix:**
```
1. Find the adjustment selection query
2. Filter by clinic:

   SELECT * FROM invoice_adjustments_projection
   WHERE grant_cycle_id = $1
     AND applied_to_invoice_id IS NULL
     AND (clinic_id = $targetClinicId OR clinic_id IS NULL)

   - clinic_id matches: clinic-specific adjustment
   - clinic_id IS NULL: grant-level adjustment (applies to any)

3. Remove the TODO comment
```

**Verify:** Adjustment for Clinic A does NOT appear on Clinic B invoice

---

## Fix 12 — Voucher Expiry Validation

**Problem:** Claim validation checks `now + 365 days` instead of the voucher's actual `expires_at` field from `vouchers_projection`.

**Files:** `src/application/claim-service.ts` (~line 124)

**Fix:**
```
1. Replace the expiry check:
   WRONG:  if (dateOfService > addDays(now, 365))
   RIGHT:  if (new Date(request.dateOfService) > new Date(voucher.expiresAt))

2. Implement full LAW 7.2 four-layer date validation:
   a. dateOfService >= voucher.validFrom (or issuedAt)
   b. dateOfService <= voucher.expiresAt
   c. dateOfService <= grantPeriodEnd (June 30)
   d. submissionTimestamp <= claimDeadline (November 15)

3. All dates from vouchers_projection, not computed from NOW().
```

**Verify:** `grep "365\|addDays" src/application/claim-service.ts` → NOT found

---

# PHASE 4 — DOCS & TESTS

## Fix 13 — IDENTITY_EXCEPTIONS.md

**Problem:** Current doc contradicts v5.2. References `EventStore.newEventId()` for UUIDv4 (it produces UUIDv7).

**Fix:** Replace `docs/IDENTITY_EXCEPTIONS.md` with this exact content:

```markdown
# IDENTITY EXCEPTIONS (WVSNP-GMS v5.2)

## DEFAULT RULES

| Scope | Type | Requirement |
|-------|------|-------------|
| Event IDs | UUIDv7 | Server-generated via EventStore.newEventId(). Time-sortable. |
| Aggregate IDs | UUIDv4 | Client-generated via crypto.randomUUID(). Random. Offline-safe. |

Standard Aggregate IDs (No Exception):
GrantId, GrantCycleId, VoucherId, ClaimId, InvoiceId, PaymentId,
ClinicId, AdjustmentId, ExportBatchId

## APPROVED EXCEPTIONS

### 1. Voucher Code Allocator ID
- Type: Deterministic hash-derived UUID
- Formula: SHA-256("VoucherCodeAllocator:" + grantCycleId + ":" + countyCode)
          → first 32 hex chars → formatted as UUID (8-4-4-4-12)
- Reason: Stable singleton per (grantCycleId, countyCode) without global search

### 2. Claim Fingerprint (DE-DUPE ONLY — NOT AN IDENTITY)
- Type: SHA-256 hash (64 hex chars)
- Formula: SHA-256(voucherId + ":" + clinicId + ":" + procedureCode + ":" + dateOfService + ":rabies=" + 0|1)
- Constraint: UNIQUE(grant_cycle_id, clinic_id, claim_fingerprint) on claims_projection
- FORBIDDEN: As aggregateId, FK, URL param, or API identifier

### 3. Batch Fingerprint (Phase 4, DE-DUPE ONLY)
- Type: SHA-256 hash
- Formula: SHA-256(grantCycleId + ":" + periodStart + ":" + periodEnd + ":" + sorted(invoiceIds))
- FORBIDDEN: Same restrictions as Claim Fingerprint

## CRITICAL RULE
EventStore.newEventId() produces UUIDv7 → for EVENT IDs ONLY.
crypto.randomUUID() produces UUIDv4 → for AGGREGATE IDs.
NEVER use newEventId() for aggregate/entity IDs.
```

---

## Fix 14 — Conformance Proof Update

**Files:** `docs/conformance/phase3-proof.sql`

**Fix:**
```
1. REMOVE: Any test asserting ClaimId = SHA-256 hash
2. REMOVE: Any test asserting ClaimId is deterministic

3. ADD these tests:

   -- Test: ClaimId is valid UUIDv4 format
   SELECT claim_id FROM claims_projection
   WHERE claim_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   -- Expected: EMPTY (all UUIDv4)

   -- Test: ClaimFingerprint is 64-char hex
   SELECT claim_fingerprint FROM claims_projection
   WHERE claim_fingerprint !~ '^[0-9a-f]{64}$'
   -- Expected: EMPTY

   -- Test: Fingerprint uniqueness constraint exists
   SELECT conname FROM pg_constraint
   WHERE conrelid = 'claims_projection'::regclass AND contype = 'u'
   -- Expected: Contains fingerprint unique constraint

   -- Test: No projection has immutability trigger (except event_log)
   SELECT tgname, relname FROM pg_trigger t
   JOIN pg_class c ON t.tgrelid = c.oid
   WHERE relname LIKE '%_projection' AND tgname LIKE '%immut%'
   -- Expected: EMPTY

   -- Test: approved_event_id is populated for approved claims
   SELECT COUNT(*) FROM claims_projection
   WHERE status IN ('APPROVED','INVOICED') AND approved_event_id IS NULL
   -- Expected: 0

   -- Test: No Number() in money operations (code review)
   -- Run: grep -rn "Number(" src/application/ | grep -ic "cent|amount"
   -- Expected: 0
```

---

# STOP CONDITIONS

If any of the following occur, **STOP and report**:

- Fixing one issue breaks a previously fixed issue
- event_log immutability trigger is removed (NEVER remove this)
- Projection immutability triggers are kept (ALWAYS remove these)
- ClaimId generated as UUIDv7 or SHA-256
- Number() still used on money fields after Fix 10
- Any NEW event type or feature created (this is a PATCH, not a feature build)
- grant_cycle_id typed as VARCHAR instead of UUID

---

# VERIFICATION CHECKLIST

After ALL fixes applied, run every check:

| # | Check | Command | Expected |
|---|-------|---------|----------|
| 1 | No duplicate grant_balances | `grep -c "CREATE TABLE.*grant_balances_projection" db/schema.sql` | 1 |
| 2 | No duplicate vouchers | `grep -c "CREATE TABLE.*vouchers_projection" db/schema.sql` | 1 |
| 3 | bucket_type exists | `grep "bucket_type" db/schema.sql` | Found in grant_balances_projection |
| 4 | No projection triggers | `grep -n "immut\|forbid_mutation" db/schema.sql \| grep -v event_log \| grep -v artifact_log` | Empty |
| 5 | Event log trigger exists | `grep "immut\|forbid_mutation" db/schema.sql \| grep event_log` | Found |
| 6 | AllocatorId is UUID format | `grep "AllocatorId" src/domain-types.ts` | Branded UUID |
| 7 | grant_cycle_id is UUID | `grep "grant_cycle_id" db/schema.sql \| grep claims` | UUID type |
| 8 | approved_event_id in reducer | `grep "approved_event_id\|approvedEventId" src/domain/claim/claim-logic.ts` | Found |
| 9 | approved_event_id in projector | `grep "approved_event_id" src/projections/claim-projector.ts` | Found |
| 10 | Sweep uses UUID actors | `grep "actorId" src/jobs/sweep-expired-tentatives.ts` | UUID format |
| 11 | Claims marked invoiced | `grep "CLAIM_INVOICED" src/application/invoice-service.ts` | Found |
| 12 | ClaimId is UUIDv4 | `grep "randomUUID" src/application/claim-service.ts` | Found |
| 13 | No UUIDv7 for ClaimId | `grep "newEventId" src/application/claim-service.ts` | NOT found for claimId |
| 14 | LIRP co-pay check | `grep "LIRP_COPAY_FORBIDDEN" src/application/claim-service.ts` | Found |
| 15 | No Number() on money | `grep -rn "Number(" src/application/ \| grep -ic "cent\|amount"` | 0 |
| 16 | Adjustment filtered | `grep "clinic_id" src/application/invoice-service.ts` | In adjustment query |
| 17 | No +365 hack | `grep "365\|addDays" src/application/claim-service.ts` | NOT found |
| 18 | Identity doc is v5.2 | `head -1 docs/IDENTITY_EXCEPTIONS.md` | Contains "v5.2" |
| 19 | Build passes | `pnpm build` | Exit 0 |
| 20 | Tests pass | `pnpm test` | All green |

---

## AFTER PATCHING

Once all 20 checks pass:

```
1. Commit: "fix: pre-Phase4 stabilization (v5.3)"
2. Tag: v5.3-stabilized
3. Open CLEAN Windsurf thread
4. Paste WINDSURF_Phase4_v5.2_FINAL.md
5. Build Phase 4
```

**DO NOT start Phase 4 until all 20 checks pass.**

---

**BEGIN FIXES. Strict sequence: Fix 1 → Fix 14. Report after each phase.**
