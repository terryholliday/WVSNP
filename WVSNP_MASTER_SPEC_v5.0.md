# WVSNP GRANT MANAGEMENT SYSTEM — MASTER SPECIFICATION v5.0
## "Audit-Grade / Fail-Closed / Event-Sourced"

**Codename:** WVSNP-GMS  
**Legislative Authority:** WV Code §19-20C-1 et seq.  
**Architecture:** Event Sourcing with UUIDv7 + BigInt Money Kernel  
**Status:** EXECUTION READY  
**Date:** February 2026

---

# PART I: FOUNDATIONAL LAWS (KERNEL)

## LAW 0 — THE EVENT LOG IS TRUTH

| Law | Rule |
|-----|------|
| 0.0 | **UUIDv7 Exception:** `event_id` MAY be server-generated UUIDv7 for storage locality. It MUST NOT be used for business ordering. Ordering uses `ingestedAt`. All aggregate IDs remain UUIDv4. |
| 0.1 | **Single Source of Truth:** `event_log` is the only canonical storage. All other tables are disposable projections. |
| 0.2 | **Rebuildability:** All state must be rebuildable by replaying events from genesis. |
| 0.3 | **Immutability:** `UPDATE` and `DELETE` are forbidden on the `event_log`. |
| 0.4 | **Ordering:** Events are ordered by `(ingested_at, event_id)` tuple. |
| 0.5 | **Schema:** Single PK declaration. No duplicates. |
| 0.6 | **Enforcement:** DB Triggers must block mutation. |
| 0.7 | **Pagination:** Strict tuple comparison `(ingested_at > wm.t) OR (ingested_at = wm.t AND event_id > wm.id)`. |
| 0.8 | **Server Time:** `ingested_at` is stamped by `clock_timestamp()` on INSERT. Client time is ignored for ordering. |
| 0.9 | **Encoding:** JSONB stores MoneyCents and UUIDs as **Strings**. |
| 0.10 | **Causality:** `event_id` MUST be **UUIDv7** (Time-Sortable). UUIDv4 is FORBIDDEN for event_id. |
| 0.11 | **Trigger Precision:** Use `clock_timestamp()` for ingestion precision. |

## LAW 1 — MONEY PHYSICS

| Law | Rule |
|-----|------|
| 1.1 | **Storage:** Money is stored as `MoneyCents` (BigInt). |
| 1.2 | **Rates:** Reimbursement Rates are Rational `{ numerator, denominator }` (BigInt). |
| 1.3 | **Math:** All calculations use BigInt with `ROUND_HALF_UP`. |
| 1.4 | **Type Safety:** `MoneyCents` is a Branded BigInt type. `number` is FORBIDDEN for money. |
| 1.5 | **Parsing:** Strict String parsing (No floats, no commas). |
| 1.6 | **Formatting:** BigInt division/modulus only. |

## LAW 2 — FINANCIAL FINALITY

| Law | Rule |
|-----|------|
| 2.1 | **Encumbrance:** Funds are reserved at `VOUCHER_ISSUED`. |
| 2.2 | **Liquidation:** Funds are spent at `CLAIM_APPROVED`. |
| 2.3 | **Release:** Funds return to pool at `VOUCHER_EXPIRED` or `CLAIM_DENIED`. |
| 2.4 | **Atomic Checks:** `FOR UPDATE` locking required on Grant Balances before issuance. |
| 2.5 | **Bucket Isolation:** GENERAL and LIRP are separate rows with independent locks. |
| 2.6 | **Lock Order:** Mandatory: (1) Voucher → (2) Grant Bucket → (3) Allocator. |
| 2.7 | **Expiration Cap:** `voucher.expiresAt ≤ grantCycleEndAt` (June 30). |
| 2.8 | **Matching Funds:** Track committed vs. reported via events. |
| 2.9 | **Invoice Finality:** Invoices are immutable after `INVOICE_SUBMITTED`. Adjustments use **Carry-Forward** only. |

## LAW 3 — IDENTITY PHYSICS

| Law | Rule |
|-----|------|
| 3.1 | **Aggregate IDs:** Client-generated UUIDv4 via `crypto.randomUUID()`. |
| 3.2 | **Event IDs:** Server-generated UUIDv7 (exception documented in 0.0). |
| 3.3 | **Branded Types:** All IDs use branded types (not raw strings). |
| 3.4 | **No Auto-Increment:** Integer IDs are FORBIDDEN. |
| 3.5 | **Client-Side Generation:** IDs generated client-side for offline capability. |
| 3.6 | **Claim Identity:** Deterministic Hash `SHA-256(voucherId + clinicId + procedureCode + dateOfService)`. |

## LAW 4 — TIME DOCTRINE

| Law | Rule |
|-----|------|
| 4.1 | **Dual Time:** Every event has `occurredAt` (client/business) + `ingestedAt` (server truth). |
| 4.2 | **Server Authority:** `ingestedAt` is authoritative for ordering. |
| 4.3 | **Business Time:** `occurredAt` is client assertion of when it happened in real life. |
| 4.4 | **Operational Cache:** Use `recordedAt` + `expiresAt` (NOT createdAt/updatedAt). |
| 4.5 | **Forbidden Names:** `createdAt` and `updatedAt` are FORBIDDEN in business logic. |

## LAW 5 — OPERATIONAL PHYSICS

| Law | Rule |
|-----|------|
| 5.1 | **Deadline:** Server-ingested time is the only deadline gate. |
| 5.2 | **Tokens:** Submission Tokens are Signed, Bound, and One-Time Use. |
| 5.3 | **Token Consumption:** Tokens are burned upon use via `SUBMISSION_TOKEN_CONSUMED`. |
| 5.4 | **Signatures:** Deterministic canonical string signing (HMAC-SHA256). |
| 5.5 | **Submission:** Online-Only Handshake required. |
| 5.6 | **Deferred Codes:** Offline vouchers use `PENDING-*` codes. Official codes assigned on confirmation. |
| 5.7 | **Allocator ID:** Deterministic Hash `SHA-256(Cycle:County)`. NOT UUIDv7. |
| 5.8 | **Allocator Replay:** Allocator state is purely event-derived. |
| 5.9 | **Race Safety:** Confirmation and Sweep both use `FOR UPDATE` locking. |
| 5.10 | **Idempotency:** Client operations require Idempotency Keys (24h TTL). |

## LAW 6 — ADJUDICATION & TRACE

| Law | Rule |
|-----|------|
| 6.1 | **Traceability:** Every event must carry `correlationId`, `causationId`, and `actorId`. |
| 6.2 | **LIRP Enforcement:** "Must-Honor" logic is server-enforced. |
| 6.3 | **Decision Basis:** Every `CLAIM_APPROVED` or `DENIED` must include `{ ruleId, policyVersion, policySnapshotId, evidenceRefs }`. |
| 6.4 | **Concurrency:** First terminal decision wins. Subsequent attempts emit `CLAIM_DECISION_CONFLICT_RECORDED`. |

## LAW 7 — SETTLEMENT PHYSICS

| Law | Rule |
|-----|------|
| 7.1 | **Clinic Registration:** Claims require clinic with ACTIVE registration and valid license. |
| 7.2 | **Procedure Date:** Must be within voucher validity AND grant period AND before submission deadline. |
| 7.3 | **Invoice Schedule:** Generated monthly on the 1st for prior month (America/New_York). |
| 7.4 | **LIRP Claims:** Co-pay is FORBIDDEN for LIRP vouchers. |
| 7.5 | **Required Artifacts:** Claims must include procedure report + clinic invoice + conditional documents. |
| 7.6 | **Payment Events:** Payments are events. Invoice status is PROJECTION-DERIVED (no INVOICE_STATUS_UPDATED). |
| 7.7 | **wvOASIS Export:** Fixed-width text format for Treasury integration. |
| 7.8 | **Grant Closeout:** Final report required with financial + activity summaries. |

## LAW 8 — PROJECTION NAMING

| Law | Rule |
|-----|------|
| 8.1 | **Table Suffix:** Use `*_projection` (NOT `*_writemodel`). |
| 8.2 | **Disposable:** Projections are rebuildable from events. |
| 8.3 | **Lockable:** Projections CAN be locked FOR UPDATE for concurrency. |
| 8.4 | **Not Truth:** event_log is the ONLY source of truth. |

---

# PART II: DOMAIN LOGIC

## PHASE 1: APPLICATION
- **Eligibility:** 501(c)(3) / Government Check
- **Scoring:** Derived Priority Score
- **Export:** Template-based XLSX generation
- **Token:** Signed submission tokens

## PHASE 2: GRANT OPS
- **Grant Logic:** Pure Reducer + Rate Engine + Bucket Isolation
- **Voucher Machine:** State transitions (`TENTATIVE` → `ISSUED` → `REDEEMED`)
- **Allocator:** Event-Sourced Monotonic Sequencer (deterministic hash ID)
- **Sync:** Conflict Resolution via Event Rejection
- **LIRP:** Must-Honor server enforcement

## PHASE 3: SETTLEMENT
- **Claim Logic:** Deterministic ID + Adjudication Trace + Policy Snapshot
- **Invoice Logic:** Aggregate Approved Claims + Carry-Forward Adjustments
- **Payment Logic:** Event-based recording → Projection computes status
- **Closeout:** Final report with all summaries

---

# PART III: EVENT CATALOG

## Application Events
```
APPLICATION_STARTED
APPLICATION_SECTION_COMPLETED
APPLICATION_SUBMITTED
APPLICATION_TOKEN_CONSUMED
APPLICATION_SCORED
APPLICATION_AWARDED
APPLICATION_WAITLISTED
APPLICATION_DENIED
```

## Grant Events
```
GRANT_CREATED
GRANT_AGREEMENT_SIGNED
GRANT_ACTIVATED
GRANT_FUNDS_ENCUMBERED        { grantId, voucherId, amountCents, isLIRP }
GRANT_FUNDS_RELEASED          { grantId, voucherId, amountCents, reason }
GRANT_FUNDS_LIQUIDATED        { grantId, claimId, amountCents }
GRANT_SUSPENDED
GRANT_REINSTATED
GRANT_CLOSED
LIRP_MUST_HONOR_ENFORCED
MATCHING_FUNDS_REPORTED
MATCHING_FUNDS_ADJUSTED
```

## Voucher Events
```
VOUCHER_ISSUED
VOUCHER_ISSUED_TENTATIVE
VOUCHER_ISSUED_CONFIRMED      { voucherId, voucherCode }
VOUCHER_ISSUED_REJECTED       { reason }
VOUCHER_REDEEMED
VOUCHER_EXPIRED
VOUCHER_VOIDED
VOUCHER_AMENDED
```

## Allocator Events
```
VOUCHER_CODE_ALLOCATOR_INITIALIZED
VOUCHER_CODE_ALLOCATED
```

## Vet Clinic Events
```
VET_CLINIC_REGISTERED
VET_CLINIC_LICENSE_STATUS_RECORDED
VET_CLINIC_SUSPENDED
VET_CLINIC_REINSTATED
VET_CLINIC_PAYMENT_INFO_UPDATED
VET_CLINIC_OASIS_VENDOR_CODE_ASSIGNED
```

## Claim Events
```
CLAIM_SUBMITTED               { claimId, voucherId, clinicId, procedureCode, dateOfService }
CLAIM_APPROVED                { claimId, decisionBasis }
CLAIM_DENIED                  { claimId, decisionBasis }
CLAIM_ADJUSTED                { claimId, newAmount, reason }
CLAIM_INVOICED                { claimId, invoiceId }
CLAIM_DECISION_CONFLICT_RECORDED { claimId, attemptedDecision, winningEventId }
```

## Invoice Events
```
INVOICE_GENERATED             { invoiceId, claimIds[], adjustmentIds[] }
INVOICE_SUBMITTED             { invoiceId } — LOCKS FOREVER
INVOICE_ADJUSTMENT_CREATED    { adjustmentId, sourceInvoiceId, amountCents }
INVOICE_ADJUSTMENT_APPLIED    { adjustmentId, targetInvoiceId }
```

## Payment Events
```
PAYMENT_RECORDED              { paymentId, invoiceId, amountCents, channel, referenceId }
PAYMENT_SHORTFALL_FLAGGED
PAYMENT_SHORTFALL_RESOLVED
```

## wvOASIS Events
```
OASIS_BATCH_GENERATED
OASIS_BATCH_SUBMITTED
OASIS_BATCH_ACKNOWLEDGED
OASIS_BATCH_REJECTED
```

## Grant Closeout Events
```
GRANT_PERIOD_ENDED
GRANT_CLAIMS_DEADLINE_PASSED
GRANT_FINAL_REPORT_GENERATED
GRANT_FINAL_REPORT_SUBMITTED
GRANT_CLOSEOUT_APPROVED
GRANT_CLOSEOUT_AUDIT_HOLD
GRANT_CLOSEOUT_AUDIT_RESOLVED
```

---

# PART IV: EXECUTION PROMPTS

## PROMPT A: PHASE 1 & 2 (KERNEL + OPS)
*Use this in a new Windsurf thread to build the core.*

```
I have the WVSNP_MASTER_SPEC_v5.0. Initialize the pnpm monorepo.
Implement domain-types.ts enforcing BigInt/UUIDv7.
Create the event_log schema with the clock_timestamp() trigger.
Build the Grant and Voucher aggregates with bucket isolation.
Implement the Allocator with deterministic hash ID.
Ensure all events have occurredAt + ingestedAt (never createdAt/updatedAt).
```

## PROMPT B: PHASE 3 (SETTLEMENT)
*Use this in a CLEAN Windsurf thread once Phase 2 is stable.*

```
Load the WVSNP_MASTER_SPEC_v5.0.
Implement the Claim aggregate with Deterministic IDs (Law 3.6).
Implement the Invoice generator with Carry-Forward logic (Law 2.9).
Ensure CLAIM_DECISION_CONFLICT_RECORDED is emitted on concurrent adjudication.
Invoice settlement status is PROJECTION-DERIVED (no INVOICE_STATUS_UPDATED event).
Use VET_CLINIC_* naming for clinic events.
All projection tables named *_projection (not *_writemodel).
```

---

# PART V: KEY DATES (FY2026)

| Date | Event |
|------|-------|
| January 20, 2026 | Application deadline |
| July 1, 2025 | Grant period starts |
| June 30, 2026 | Grant period ends |
| November 15, 2026 | Claim submission deadline |
| November 15, 2026 | Final report deadline |
| November 30, 2026 | Final payment deadline |

---

# PART VI: CONFORMANCE CHECKLIST

| Category | Requirement | Status |
|----------|-------------|--------|
| **Identity** | UUIDv7 for event_id only | ☐ |
| | UUIDv4 for all aggregate IDs | ☐ |
| | Deterministic hash for ClaimId | ☐ |
| | Deterministic hash for AllocatorId | ☐ |
| **Time** | occurredAt + ingestedAt on all events | ☐ |
| | No createdAt/updatedAt in business logic | ☐ |
| **Money** | MoneyCents branded bigint | ☐ |
| | String encoding in JSONB | ☐ |
| **Immutability** | No UPDATE/DELETE on event_log | ☐ |
| | Invoice locked after SUBMITTED | ☐ |
| | No INVOICE_STATUS_UPDATED event | ☐ |
| **Traceability** | correlationId + causationId + actorId | ☐ |
| | decisionBasis with policySnapshotId | ☐ |
| | CLAIM_DECISION_CONFLICT_RECORDED | ☐ |
| **Naming** | SCREAMING_SNAKE_CASE events | ☐ |
| | VET_CLINIC_* for clinic events | ☐ |
| | *_projection for tables | ☐ |

---

**END OF MASTER SPECIFICATION v5.0**
