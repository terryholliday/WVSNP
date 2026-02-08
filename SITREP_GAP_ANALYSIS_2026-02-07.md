# WVSNP-GMS SITREP & GAP ANALYSIS
**Date:** February 7, 2026  
**Analyst:** Proveniq Prime  
**Spec Authority:** `WVSNP_MASTER_SPEC_v5.0.md` + Addendum v5.2

---

# PART I: SITUATION REPORT (SITREP)

## 1. Overall Architecture Status

| Layer | Status | Notes |
|-------|--------|-------|
| **Event Log (Kernel)** | ✅ COMPLETE | Append-only, immutability triggers, UUIDv7 event IDs, dual-time, watermark pagination |
| **Artifact Log** | ✅ COMPLETE | Immutability triggers, SHA-256, watermark metadata |
| **Domain Types** | ✅ COMPLETE | Branded types, MoneyCents BigInt, ReimbursementRate engine, deterministic IDs |
| **Event Store** | ✅ COMPLETE | UUIDv7 enforcement, BigInt guard, watermark fetch, append with clock_timestamp() |
| **Projections Schema** | ✅ COMPLETE | All 11 projection tables with `_projection` suffix, rebuild metadata |
| **Projection Rebuild** | ⚠️ PARTIAL | Only rebuilds `applications_projection`; Phase 2-4 projections NOT rebuilt |
| **API Server** | ✅ COMPLETE | Dual servers (port 3000 kernel, port 4000 full API), auth, rate limiting |
| **Application Domain** | ✅ COMPLETE | State machine, validators, fraud detection, evidence service |
| **Grant Domain** | ✅ COMPLETE | Bucket isolation (GENERAL/LIRP), balance invariant, matching funds |
| **Voucher Domain** | ✅ COMPLETE | State machine (TENTATIVE→ISSUED→REDEEMED), sweep job, allocator |
| **Claim Domain** | ✅ COMPLETE | Fingerprint de-dupe, license validation, artifact gating, conflict recording |
| **Invoice Domain** | ✅ COMPLETE | Monthly generation, carry-forward adjustments, projection-derived status |
| **OASIS Export** | ✅ COMPLETE | Batch generation, fixed-width renderer, deterministic file hash |
| **Grant Closeout** | ✅ COMPLETE | Preflight checks, reconciliation, audit hold, final report |
| **Public Portal** | ✅ EXISTS | Next.js app in `wvsnp-public-portal/` |
| **Grantee Portal** | ✅ EXISTS | Next.js app in `wvsnp-grantee-portal/` |

## 2. File Inventory

### Backend (`src/`)
| File | Size | Purpose |
|------|------|---------|
| `domain-types.ts` | 6.3KB | Branded types, Money, Rate, Claim, Allocator, Closeout |
| `event-store.ts` | 4.4KB | EventStore class, Watermark, DomainEvent |
| `uuidv7.ts` | 1.5KB | UUIDv7 generator with sequence overflow protection |
| `server.ts` | 4.8KB | Kernel API server (port 3000) |
| `api/server.ts` | 3.5KB | Full API server (port 4000) with auth, CORS, rate limiting |
| `application/application-service.ts` | 12KB | Start, submit, attach evidence, fraud detection |
| `application/grant-service.ts` | 19.8KB | Grant creation, voucher issuance, fund operations |
| `application/claim-service.ts` | 18.6KB | Claim submission, adjudication, conflict detection |
| `application/invoice-service.ts` | 13.1KB | Monthly invoice generation, carry-forward |
| `application/oasis-service.ts` | 27.6KB | OASIS batch generation, rendering, submission |
| `application/closeout-service.ts` | 23.5KB | Preflight, reconciliation, audit hold, final report |
| `application/evidence-service.ts` | 7.6KB | Evidence upload pipeline |
| `application/idempotency-service.ts` | 2.1KB | Idempotency cache operations |
| `domain/application/` | 4 files | Logic, types, validators, fraud detection |
| `domain/grant/grant-logic.ts` | 4.7KB | Grant state machine, bucket operations |
| `domain/voucher/` | 2 files | Voucher state machine, allocator |
| `domain/claim/claim-logic.ts` | 5.9KB | Claim state machine, validation |
| `domain/invoice/invoice-logic.ts` | 3.7KB | Invoice state machine, adjustment logic |
| `domain/oasis/` | 2 files | Batch logic, fixed-width renderer |
| `domain/closeout/cycle-logic.ts` | 9.4KB | Closeout state machine |
| `projections/rebuild.ts` | 5.9KB | Projection rebuild (applications only) |
| `api/routes/` | 6 files | Public, admin, clinic, grantee routes |
| `api/middleware/` | 4 files | Auth, error handler, logger, validator |
| `api/schemas/` | 3 files | Zod validation schemas |

### Database (`db/`)
| File | Purpose |
|------|---------|
| `schema.sql` | 433 lines — full schema (event_log, artifact_log, 11 projections, triggers, indexes) |
| `init-database.sql` | Database initialization |
| `migrations/` | 1 migration |

### Tests (`tests/`)
| File | Tests | Status |
|------|-------|--------|
| `phase1-kernel-conformance.test.ts` | 22 tests | ⚠️ SYNTAX ERROR (see Gap #1) |
| `phase2-conformance.test.ts` | 10 tests | ⚠️ 1 placeholder (lock order) |
| `phase3-v5.1-conformance.test.ts` | 6 tests | ⚠️ 1 placeholder (replay determinism) |
| `phase4-v5.2-conformance.test.ts` | 14 tests | ⚠️ 10 placeholders (`expect(true).toBe(true)`) |

---

# PART II: GAP ANALYSIS

## CRITICAL GAPS (Must Fix)

### GAP-C1: `created_at` Column in `invoice_adjustments_projection` (LAW 4.5 VIOLATION)
- **Location:** `db/schema.sql:333`
- **Violation:** Column named `created_at` in `invoice_adjustments_projection`
- **Spec:** LAW 4.5 — `createdAt` and `updatedAt` are FORBIDDEN in business logic
- **Impact:** Propagates to `src/domain/invoice/invoice-logic.ts:24` (`createdAt` field in `AdjustmentState`), `src/application/invoice-service.ts:82` (ORDER BY `created_at`)
- **Fix:** Rename to `recorded_at` (operational cache per LAW 4.4)

### GAP-C2: Phase 1 Test File Syntax Error
- **Location:** `tests/phase1-kernel-conformance.test.ts:782`
- **Issue:** Mismatched `describe`/`test` block nesting — the `Chronology Doctrine` describe block closes prematurely at line 782 with `});` but the `no createdAt` test at line 784 is outside the describe block
- **Impact:** Test suite may fail to parse or produce incorrect results
- **Fix:** Fix the nesting so the test at line 784 is inside the describe block

### GAP-C3: `FRAUD_SIGNAL_DETECTED` is NOT in the Spec Event Catalog
- **Location:** `src/application/application-service.ts:313`, `src/domain/application/application-logic.ts:95`
- **Violation:** AGENTS.md §6 — "inventing new event types beyond the spec"
- **Spec Catalog:** Does not include `FRAUD_SIGNAL_DETECTED`
- **Impact:** Non-canonical event type polluting the event log
- **Fix:** Either (a) add to spec via ambiguity report, or (b) move fraud signals to a separate advisory table (not event_log)

### GAP-C4: `APPLICATION_EVIDENCE_ATTACHED` is NOT in the Spec Event Catalog
- **Location:** `src/application/application-service.ts:177`
- **Violation:** Same as GAP-C3 — event type not in spec
- **Spec Catalog:** Lists `APPLICATION_STARTED`, `APPLICATION_SECTION_COMPLETED`, `APPLICATION_SUBMITTED`, `APPLICATION_TOKEN_CONSUMED`, `APPLICATION_SCORED`, `APPLICATION_AWARDED`, `APPLICATION_WAITLISTED`, `APPLICATION_DENIED`
- **Fix:** File ambiguity report; likely should be `ATTACHMENT_ADDED` (which IS in the rebuild allowlist)

### GAP-C5: Rebuild Pipeline Only Covers Phase 1
- **Location:** `src/projections/rebuild.ts`
- **Violation:** LAW 0.2 — "All state must be rebuildable by replaying events from genesis"
- **Impact:** `grant_balances_projection`, `vouchers_projection`, `allocators_projection`, `claims_projection`, `invoices_projection`, `vet_clinics_projection`, `payments_projection`, `invoice_adjustments_projection`, `oasis_export_batches_projection`, `grant_cycle_closeout_projection` are NOT rebuildable
- **Severity:** HIGH — This means projections cannot be verified as disposable

## HIGH GAPS (Should Fix)

### GAP-H1: 10 of 14 Phase 4 Tests Are Placeholders
- **Location:** `tests/phase4-v5.2-conformance.test.ts`
- **Impact:** Phase 4 conformance is NOT proven. Tests 1, 3-8, 10-14 are `expect(true).toBe(true)` stubs
- **AGENTS.md §4:** "If any item is missing, phase is not complete"

### GAP-H2: Phase 3 Test 2 (Replay Determinism) Is Placeholder
- **Location:** `tests/phase3-v5.1-conformance.test.ts:152`
- **Impact:** Invoice replay determinism is unproven

### GAP-H3: Missing Spec Events Not Implemented
- **Events in spec but NOT in any domain logic:**
  - `APPLICATION_SECTION_COMPLETED` — in rebuild allowlist but no handler in `application-logic.ts`
  - `APPLICATION_TOKEN_CONSUMED` — in spec, no handler
  - `APPLICATION_WAITLISTED` — in spec, no handler
  - `GRANT_AGREEMENT_SIGNED` — in spec, no handler
  - `GRANT_ACTIVATED` — in spec, no handler
  - `GRANT_SUSPENDED` / `GRANT_REINSTATED` — in spec, no handler
  - `GRANT_CLOSED` — in spec, no handler
  - `LIRP_MUST_HONOR_ENFORCED` — in spec, no handler
  - `VOUCHER_AMENDED` — in spec, comment "Add if needed" in voucher-logic.ts:93
  - `PAYMENT_SHORTFALL_FLAGGED` / `PAYMENT_SHORTFALL_RESOLVED` — in spec, no handler
  - `GRANT_PERIOD_ENDED` — in spec, no handler
  - `GRANT_CLAIMS_DEADLINE_PASSED` — in spec, no handler

### GAP-H4: `evidence-service.ts` Uses `created_at` Column
- **Location:** `src/application/evidence-service.ts:215`
- **Impact:** References a `created_at` column (likely in an upload_tokens or similar table not in schema.sql)
- **Fix:** Verify table definition; rename if it's a domain table

### GAP-H5: Rebuild Allowlist / Domain Logic Mismatch
- **Location:** `src/projections/rebuild.ts:4-23`
- **Issue:** Rebuild allowlist includes events like `APPLICATION_FIELD_RECORDED`, `APPLICATION_FIELD_CLEARED`, `APPLICATION_LIRP_MODE_SET`, `APPLICATION_PRIORITY_FACTORS_COMPUTED`, `APPLICATION_APPROVED`, `APPLICATION_EXPORT_GENERATED`, `SUBMISSION_TOKEN_ISSUED`, `SUBMISSION_TOKEN_CONSUMED`, `APPLICATION_SUBMISSION_REJECTED` — but `application-logic.ts` doesn't handle most of these
- **Impact:** Rebuild would accept events it can't actually project

### GAP-H6: `canSubmitApplication()` Requires 100% Completeness But No Section Completion Flow
- **Location:** `src/domain/application/application-logic.ts:187-194`
- **Issue:** `canSubmitApplication` requires `completenessPercent === 100`, but there's no `APPLICATION_SECTION_COMPLETED` handler to incrementally build completeness. The only way to reach 100% is via `APPLICATION_SUBMITTED` itself (which sets it to 100)
- **Impact:** Circular dependency — can't submit without 100%, can't reach 100% without submitting

### GAP-H7: Grant Balance Invariant Doesn't Account for `released_cents`
- **Location:** `db/schema.sql:172-173`
- **Constraint:** `available_cents + encumbered_cents + liquidated_cents = awarded_cents`
- **Issue:** `released_cents` is tracked but NOT in the invariant. After a release, `available_cents` increases AND `released_cents` increases, so the constraint still holds — but `released_cents` is essentially a memo field, not part of the balance equation. This is correct but should be documented.

## MEDIUM GAPS (Nice to Fix)

### GAP-M1: Dual Server Configuration
- **Issue:** Two Express servers (`src/server.ts` on port 3000, `src/api/server.ts` on port 4000) with overlapping functionality
- **Impact:** Confusion about which server to use; `server.ts` mounts public/admin application routes AND raw event append
- **Fix:** Consolidate to single API server or clearly document separation

### GAP-M2: `grantCycleId` Type Inconsistency
- **Schema:** `VARCHAR(20)` in all tables
- **Addendum v5.2:** `grant_cycle_id UUID NOT NULL` in claims_projection spec
- **Actual schema:** `grant_cycle_id VARCHAR(20)` (correct for "FY2026" format)
- **Fix:** The addendum has a typo; VARCHAR(20) is correct. Document this.

### GAP-M3: No E2E API Tests
- **Location:** `tests/api-e2e/` — directory exists but content unknown
- **Impact:** API routes are untested end-to-end

### GAP-M4: Portal Integration Not Wired
- **Issue:** Both `wvsnp-public-portal` and `wvsnp-grantee-portal` exist as Next.js apps but their integration with the backend API is unverified
- **Impact:** Frontend-to-backend flow is unproven

### GAP-M5: No `CLAIM_DECISION_CONFLICT_RECORDED` Test
- **Spec:** LAW 6.4 — "First terminal decision wins. Subsequent attempts emit CLAIM_DECISION_CONFLICT_RECORDED"
- **Impact:** Concurrent adjudication conflict handling is unproven

---

# PART III: CONFORMANCE CHECKLIST (Updated)

| Category | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| **Identity** | UUIDv7 for event_id only | ✅ | `event-store.ts:117`, `uuidv7.ts`, Phase 1 test |
| | UUIDv4 for all aggregate IDs | ✅ | `domain-types.ts`, `crypto.randomUUID()` usage |
| | Deterministic hash for ClaimFingerprint | ✅ | `domain-types.ts:132-158` |
| | Deterministic hash for AllocatorId | ✅ | `domain-types.ts:177-184` |
| | ClaimId is UUIDv4 (v5.2 addendum) | ✅ | `domain-types.ts:116-118` |
| **Time** | occurredAt + ingestedAt on all events | ✅ | `schema.sql:25-26`, `event-store.ts:55-56` |
| | No createdAt/updatedAt in business logic | ❌ | **GAP-C1**: `invoice_adjustments_projection.created_at` |
| **Money** | MoneyCents branded bigint | ✅ | `domain-types.ts:9` |
| | String encoding in JSONB | ✅ | `Money.toJSON()`, Phase 2 test |
| | No float math | ✅ | BigInt throughout |
| **Immutability** | No UPDATE/DELETE on event_log | ✅ | Triggers proven in Phase 1 tests |
| | Invoice locked after SUBMITTED | ✅ | `invoice-logic.ts:59-65` |
| | No INVOICE_STATUS_UPDATED event | ✅ | `invoice-logic.ts:67-68`, `computeInvoiceStatus()` |
| **Traceability** | correlationId + causationId + actorId | ✅ | Schema NOT NULL constraints, Phase 1 tests |
| | decisionBasis with policySnapshotId | ✅ | `claim-logic.ts:5-10`, `admin-routes.ts:123` |
| | CLAIM_DECISION_CONFLICT_RECORDED | ⚠️ | Logic exists in `claim-logic.ts:132` but **untested** |
| **Naming** | SCREAMING_SNAKE_CASE events | ✅ | Regex enforcement in `server.ts:9` |
| | VET_CLINIC_* for clinic events | ✅ | Schema uses `vet_clinics_projection` |
| | *_projection for tables | ✅ | All 11 tables use suffix |
| **Rebuildability** | All projections rebuildable from events | ❌ | **GAP-C5**: Only `applications_projection` rebuilt |
| **Phase 4** | OASIS export determinism proven | ❌ | **GAP-H1**: Placeholder tests |
| | Closeout lock proven | ❌ | **GAP-H1**: Placeholder tests |

---

# PART IV: ACTION PLAN

## Priority 1: CRITICAL FIXES (Compliance Violations)

### FIX-C1: Rename `created_at` → `recorded_at` in invoice_adjustments_projection
- **Files:** `db/schema.sql:333`, `src/domain/invoice/invoice-logic.ts:24,78,89`, `src/application/invoice-service.ts:82`
- **Effort:** 30 min
- **Risk:** Low (column rename in projection table)

### FIX-C2: Fix Phase 1 Test Syntax Error
- **File:** `tests/phase1-kernel-conformance.test.ts:782`
- **Effort:** 5 min
- **Risk:** None

### FIX-C3: Resolve Non-Canonical Event Types
- **Action:** File ambiguity reports for `FRAUD_SIGNAL_DETECTED` and `APPLICATION_EVIDENCE_ATTACHED`
- **Recommended:** Rename `APPLICATION_EVIDENCE_ATTACHED` → `ATTACHMENT_ADDED` (already in allowlist); move fraud signals to advisory table or add to spec
- **Effort:** 1 hour
- **Risk:** Medium (event migration if events already exist in production)

### FIX-C5: Implement Full Projection Rebuild Pipeline
- **File:** `src/projections/rebuild.ts`
- **Action:** Add rebuild handlers for all 10 remaining projection tables
- **Effort:** 4-6 hours
- **Risk:** Medium (must match all service logic exactly)

## Priority 2: HIGH FIXES (Conformance Evidence)

### FIX-H1: Implement Phase 4 Placeholder Tests
- **File:** `tests/phase4-v5.2-conformance.test.ts`
- **Action:** Replace 10 `expect(true).toBe(true)` stubs with real tests
- **Effort:** 4-6 hours
- **Risk:** Low

### FIX-H2: Implement Phase 3 Replay Determinism Test
- **File:** `tests/phase3-v5.1-conformance.test.ts:152`
- **Effort:** 1-2 hours
- **Risk:** Low

### FIX-H3: Add Missing Event Handlers
- **Files:** `src/domain/application/application-logic.ts`, `src/domain/grant/grant-logic.ts`, `src/domain/voucher/voucher-logic.ts`
- **Action:** Add handlers for all spec events not yet handled
- **Effort:** 3-4 hours
- **Risk:** Medium

### FIX-H5: Reconcile Rebuild Allowlist with Domain Logic
- **File:** `src/projections/rebuild.ts:4-23`
- **Action:** Either add handlers for all allowlisted events or remove events that aren't projected
- **Effort:** 1 hour
- **Risk:** Low

### FIX-H6: Fix Application Completeness Circular Dependency
- **File:** `src/domain/application/application-logic.ts`
- **Action:** Add `APPLICATION_SECTION_COMPLETED` handler that increments completeness
- **Effort:** 1 hour
- **Risk:** Low

## Priority 3: MEDIUM FIXES (Quality)

### FIX-M1: Consolidate or Document Dual Server
- **Effort:** 1 hour
- **Risk:** Low

### FIX-M3: Add E2E API Tests
- **Effort:** 4-6 hours
- **Risk:** Low

### FIX-M4: Verify Portal Integration
- **Effort:** 2-3 hours
- **Risk:** Low

### FIX-M5: Add CLAIM_DECISION_CONFLICT_RECORDED Test
- **Effort:** 1 hour
- **Risk:** Low

---

# PART V: IMPLEMENTATION PLAN

## Sprint 1: Critical Compliance (Day 1)
**Goal:** Zero compliance violations

| # | Task | File(s) | Est. |
|---|------|---------|------|
| 1.1 | Rename `created_at` → `recorded_at` in schema + all references | `db/schema.sql`, `invoice-logic.ts`, `invoice-service.ts` | 30m |
| 1.2 | Fix Phase 1 test syntax error | `phase1-kernel-conformance.test.ts` | 5m |
| 1.3 | File ambiguity reports for non-canonical events | `docs/ambiguities/` | 30m |
| 1.4 | Rename `APPLICATION_EVIDENCE_ATTACHED` → `ATTACHMENT_ADDED` | `application-service.ts`, `application-logic.ts` | 30m |
| 1.5 | Move `FRAUD_SIGNAL_DETECTED` to advisory table OR add to spec | Multiple files | 1h |

**Verification:** `npm test` passes, no `created_at` in schema grep, no non-canonical events in code grep

## Sprint 2: Rebuild Pipeline (Day 2-3)
**Goal:** LAW 0.2 compliance — all projections rebuildable

| # | Task | File(s) | Est. |
|---|------|---------|------|
| 2.1 | Add grant_balances_projection rebuild handler | `rebuild.ts` | 1h |
| 2.2 | Add vouchers_projection rebuild handler | `rebuild.ts` | 1h |
| 2.3 | Add allocators_projection rebuild handler | `rebuild.ts` | 30m |
| 2.4 | Add claims_projection rebuild handler | `rebuild.ts` | 1h |
| 2.5 | Add vet_clinics_projection rebuild handler | `rebuild.ts` | 30m |
| 2.6 | Add invoices_projection rebuild handler | `rebuild.ts` | 1h |
| 2.7 | Add payments_projection rebuild handler | `rebuild.ts` | 30m |
| 2.8 | Add invoice_adjustments_projection rebuild handler | `rebuild.ts` | 30m |
| 2.9 | Add oasis_export_batches_projection rebuild handler | `rebuild.ts` | 30m |
| 2.10 | Add grant_cycle_closeout_projection rebuild handler | `rebuild.ts` | 30m |
| 2.11 | Add rebuild determinism test (drop + rebuild + compare) | `tests/` | 1h |

**Verification:** `POST /events/rebuild` rebuilds all projections; determinism test passes

## Sprint 3: Missing Event Handlers + Completeness Fix (Day 3-4)
**Goal:** All spec events handled

| # | Task | File(s) | Est. |
|---|------|---------|------|
| 3.1 | Add `APPLICATION_SECTION_COMPLETED` handler | `application-logic.ts` | 30m |
| 3.2 | Add `APPLICATION_TOKEN_CONSUMED` handler | `application-logic.ts` | 15m |
| 3.3 | Add `APPLICATION_WAITLISTED` handler | `application-logic.ts` | 15m |
| 3.4 | Add grant lifecycle handlers (AGREEMENT_SIGNED, ACTIVATED, SUSPENDED, REINSTATED, CLOSED) | `grant-logic.ts` | 1h |
| 3.5 | Add `LIRP_MUST_HONOR_ENFORCED` handler | `grant-logic.ts` | 30m |
| 3.6 | Add `VOUCHER_AMENDED` handler | `voucher-logic.ts` | 15m |
| 3.7 | Add payment shortfall handlers | New file or `invoice-logic.ts` | 30m |
| 3.8 | Add grant period/deadline handlers | `grant-logic.ts` or `cycle-logic.ts` | 30m |
| 3.9 | Fix completeness circular dependency | `application-logic.ts` | 30m |
| 3.10 | Reconcile rebuild allowlist | `rebuild.ts` | 30m |

**Verification:** All spec events have handlers; `canSubmitApplication` works with section completion flow

## Sprint 4: Test Completion (Day 4-5)
**Goal:** All conformance tests are real (no placeholders)

| # | Task | File(s) | Est. |
|---|------|---------|------|
| 4.1 | Phase 4 Test 1: Export determinism (seed → generate → rebuild → compare SHA) | `phase4-v5.2-conformance.test.ts` | 1h |
| 4.2 | Phase 4 Tests 3-5: Submission idempotency, VOIDED/REJECTED release | Same | 1.5h |
| 4.3 | Phase 4 Tests 6-8: Vendor code gating, control totals, fixed-width format | Same | 1.5h |
| 4.4 | Phase 4 Tests 10-14: Closeout lock, audit hold, deadline, reconciliation, replay | Same | 2h |
| 4.5 | Phase 3 Test 2: Invoice replay determinism | `phase3-v5.1-conformance.test.ts` | 1h |
| 4.6 | Phase 2 Test 10: Lock order (concurrent transaction test) | `phase2-conformance.test.ts` | 1h |
| 4.7 | Add CLAIM_DECISION_CONFLICT_RECORDED test | New or existing test file | 1h |

**Verification:** `npm test` — all tests pass, zero placeholders

## Sprint 5: Integration & Polish (Day 5-6)
**Goal:** End-to-end verification

| # | Task | File(s) | Est. |
|---|------|---------|------|
| 5.1 | Consolidate/document dual server | `server.ts`, `api/server.ts` | 1h |
| 5.2 | Add E2E API tests for critical paths | `tests/api-e2e/` | 4h |
| 5.3 | Verify portal → backend integration | Portal apps | 2h |
| 5.4 | Document grantCycleId type (VARCHAR not UUID) | `docs/ambiguities/` | 15m |
| 5.5 | Update conformance evidence docs | `docs/conformance/` | 1h |

---

# PART VI: RISK MATRIX

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Non-canonical events already in production event_log | Medium | HIGH | Check if events exist; if so, they're permanent (immutable). Document as legacy. |
| Rebuild pipeline introduces bugs in projections | Medium | HIGH | Test rebuild determinism before deploying |
| Phase 4 placeholder tests hide real bugs | HIGH | HIGH | Sprint 4 is critical path |
| Portal integration fails silently | Medium | Medium | Sprint 5 E2E tests |

---

# SUMMARY

| Metric | Count |
|--------|-------|
| **Critical Gaps** | 5 |
| **High Gaps** | 6 |
| **Medium Gaps** | 5 |
| **Placeholder Tests** | 12 of ~52 total |
| **Missing Event Handlers** | ~12 spec events |
| **Estimated Total Effort** | ~35-45 hours (5-6 working days) |

**Bottom Line:** The kernel (Phase 1) is solid. The domain services (Phases 2-4) are functionally complete but have **unproven conformance** due to placeholder tests and a **non-functional rebuild pipeline**. There are 3 compliance violations that must be fixed immediately (`created_at`, non-canonical events, rebuild gap). The portals exist but integration is unverified.

**Recommended Execution Order:** Sprint 1 (critical fixes) → Sprint 2 (rebuild) → Sprint 3 (event handlers) → Sprint 4 (tests) → Sprint 5 (integration)

---

**END OF SITREP & GAP ANALYSIS**
