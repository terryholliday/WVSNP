# WVSNP-GMS Gap Analysis & Enhancement Report

> **Date:** 2026-02-06
> **System:** WVSNP-GMS (West Virginia Spay/Neuter Program — Grant Management System)
> **Codebase Version:** Phase 4 v5.2 (reported COMPLETE)
> **Spec Version:** Master Spec v5.0 + Addendum v5.2
> **Reviewer Scope:** Full codebase review — structure, schema, services, domain logic, tests, security, specs, conformance docs

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [PART A — Gaps](#3-part-a--gaps)
   - [A1. Structural / Schema Gaps (Blocking)](#a1-structural--schema-gaps-blocking)
   - [A2. Pipeline & Data-Flow Gaps (Blocking)](#a2-pipeline--data-flow-gaps-blocking)
   - [A3. Identity & Compliance Gaps](#a3-identity--compliance-gaps)
   - [A4. Business Logic Gaps](#a4-business-logic-gaps)
   - [A5. API & Interface Gaps](#a5-api--interface-gaps)
   - [A6. Security Gaps](#a6-security-gaps)
   - [A7. Testing Gaps](#a7-testing-gaps)
   - [A8. Documentation & Specification Gaps](#a8-documentation--specification-gaps)
4. [PART B — Recommended Features & Enhancements](#4-part-b--recommended-features--enhancements)
   - [B1. Operational Efficiency](#b1-operational-efficiency)
   - [B2. Transparency & Auditability](#b2-transparency--auditability)
   - [B3. Integration & Workflow](#b3-integration--workflow)
   - [B4. Resilience & Reliability](#b4-resilience--reliability)
   - [B5. Developer Experience](#b5-developer-experience)
5. [Gap Impact Matrix](#5-gap-impact-matrix)
6. [Dependency Graph](#6-dependency-graph)
7. [Appendix: Files Reviewed](#7-appendix-files-reviewed)

---

## 1. EXECUTIVE SUMMARY

The WVSNP-GMS is an event-sourced, audit-grade grant management system implementing WV Code §19-20C-1 et seq. It manages the complete lifecycle of veterinary services grants across four phases: Application, Grant Operations, Settlement, and Export/Closeout.

**Architecture assessment:** The core architecture (event sourcing, BigInt money kernel, UUIDv7 event ordering, dual-time model, watermark tuple pagination) is sound and well-designed for its regulatory purpose.

**Critical finding:** Despite Phase 4 being reported as COMPLETE, the system contains **14 structural fractures** documented in the v5.3 stabilization patch (`WINDSURF_01_Stabilization_v5.3.md`) that prevent Phases 1-3 from functioning. Since Phase 4 depends on Phases 1-3, **no phase of the system can execute end-to-end in its current state.**

### Summary Counts

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| **Structural/Schema** | 4 | 0 | 0 | 0 |
| **Pipeline/Data-Flow** | 2 | 1 | 0 | 0 |
| **Identity/Compliance** | 2 | 0 | 0 | 0 |
| **Business Logic** | 1 | 2 | 2 | 0 |
| **API/Interface** | 0 | 3 | 2 | 1 |
| **Security** | 2 | 2 | 2 | 1 |
| **Testing** | 0 | 2 | 1 | 0 |
| **Documentation** | 0 | 0 | 1 | 1 |
| **Totals** | **11** | **10** | **8** | **3** |

---

## 2. SYSTEM OVERVIEW

### Tech Stack
- **Runtime:** Node.js + TypeScript 5.4 (CommonJS)
- **Framework:** Express.js 4.18
- **Database:** PostgreSQL (via `pg` 8.11)
- **Test Framework:** Jest 29 with ts-jest
- **Package Manager:** pnpm

### Architecture
- Event-sourced append-only log (`event_log` table, immutable via triggers)
- 13 projection tables (rebuildable read models derived from events)
- 6 application services (grant, claim, invoice, closeout, oasis, idempotency)
- 8 domain logic modules (grant, voucher, claim, invoice, clinic, closeout, oasis batch, oasis renderer)
- 3 HTTP endpoints (`GET /health`, `POST /events`, `POST /events/query`)

### Source Distribution
| Layer | Files | Approx. Lines |
|-------|-------|---------------|
| Application Services | 6 | ~2,600 |
| Domain Logic | 10 | ~590 |
| Infrastructure (server, event-store, types, uuid) | 4 | ~15,500 |
| Tests | 3 | ~780 |
| Schema (SQL) | 1 | ~420 |

---

## 3. PART A — GAPS

### A1. Structural / Schema Gaps (Blocking)

These prevent the database from functioning correctly. All are documented in `WINDSURF_01_Stabilization_v5.3.md`.

#### GAP-A1.1: Duplicate Table Definitions
- **Severity:** CRITICAL
- **Source:** `db/schema.sql`
- **Issue:** `grant_balances_projection` and `vouchers_projection` are defined twice with `CREATE TABLE IF NOT EXISTS`. The Phase 1 (minimal) definition wins; Phase 2 columns (`bucket_type`, `is_lirp`, `county_code`, etc.) never exist in the database.
- **Impact:** Bucket isolation queries fail silently. GENERAL vs LIRP fund separation does not work. All grant-related operations return incorrect data.
- **Affects:** Grant service, voucher issuance, fund encumbrance, closeout reconciliation.
- **Ref:** v5.3 Fix 1

#### GAP-A1.2: Projection Immutability Triggers Block Writes
- **Severity:** CRITICAL
- **Source:** `db/schema.sql`
- **Issue:** Immutability triggers (`prevent_*_mutation`) are applied to ALL projection tables. Per event-sourcing architecture, only `event_log` should be immutable — projections must be updatable (they are disposable derived views rebuilt from events).
- **Impact:** Every `ON CONFLICT DO UPDATE` in projection writers crashes. No projection can be updated after initial insert. The entire projector pipeline is broken.
- **Affects:** All 13 projection tables, all services that read projections.
- **Ref:** v5.3 Fix 2

#### GAP-A1.3: AllocatorId Exceeds UUID Column Width
- **Severity:** CRITICAL
- **Source:** `src/domain/voucher/voucher-code-allocator.ts`, `db/schema.sql`
- **Issue:** `AllocatorId` is generated as a 64-character SHA-256 hex string, but `event_log.aggregate_id` and `allocators_projection.allocator_id` are UUID columns (36 chars max). INSERT fails.
- **Impact:** Voucher code allocation is impossible. No vouchers can be issued with deterministic codes.
- **Affects:** Grant service (`issueVoucherOnline`, `confirmTentativeVoucher`), voucher lifecycle.
- **Ref:** v5.3 Fix 3

#### GAP-A1.4: Column Type Mismatch on `claims_projection.grant_cycle_id`
- **Severity:** CRITICAL
- **Source:** `db/schema.sql`
- **Issue:** `claims_projection.grant_cycle_id` is typed as `VARCHAR(20)` while all other tables use `UUID`. JOIN operations between claims and other tables (grants, invoices, closeout) fail or produce incorrect results due to type coercion.
- **Impact:** Claims cannot be correctly associated with grant cycles for invoicing, export, or closeout.
- **Affects:** Claim service, invoice generation, OASIS export, closeout preflight.
- **Ref:** v5.3 Fix 4

---

### A2. Pipeline & Data-Flow Gaps (Blocking)

#### GAP-A2.1: `approved_event_id` Never Populated (Invoice Pipeline Dead)
- **Severity:** CRITICAL
- **Source:** `src/domain/claim/claim-logic.ts`, `src/application/claim-service.ts`
- **Issue:** The claim reducer does not receive the `event_id` from the event envelope, so `claims_projection.approved_event_id` is always NULL. Invoice generation (`invoice-service.ts`) filters claims by this column to select approved claims within a watermark window. Because the column is always NULL, **all invoice generation queries return zero claims**.
- **Impact:** No invoices can ever be generated. The entire settlement pipeline (claims → invoices → export → closeout) is dead.
- **Affects:** Invoice service, OASIS export, closeout reconciliation, payment tracking.
- **Ref:** v5.3 Fix 5

#### GAP-A2.2: Sweep Job Uses Non-UUID Trace Fields
- **Severity:** CRITICAL
- **Source:** `src/jobs/sweep-expired-tentatives.ts`
- **Issue:** The sweep job uses string literals ("SYSTEM", "sweep-job") for `correlationId` and `actorId`, but the schema requires UUID format. The INSERT into `event_log` fails with a constraint violation.
- **Impact:** Expired tentative vouchers are never swept. Resources remain encumbered indefinitely. Grant funds are locked permanently for tentative vouchers that were never confirmed.
- **Affects:** Grant fund availability, voucher lifecycle, fund reporting accuracy.
- **Ref:** v5.3 Fix 6

#### GAP-A2.3: Claims Not Marked Invoiced After `INVOICE_GENERATED`
- **Severity:** HIGH
- **Source:** `src/application/invoice-service.ts`
- **Issue:** After claims are included in an invoice, the system does not emit a `CLAIM_INVOICED` event or update `claims_projection.status` to `'INVOICED'`. The same claim can be included in multiple invoices across successive monthly runs.
- **Impact:** Double-invoicing of claims. Financial reporting overstates amounts owed. Closeout preflight check ("all approved claims invoiced") always fails because claims remain in `APPROVED` status permanently.
- **Affects:** Invoice accuracy, financial integrity, closeout workflow, OASIS export totals.
- **Ref:** v5.3 Fix 7

---

### A3. Identity & Compliance Gaps

#### GAP-A3.1: ClaimId Generated as UUIDv7 Instead of UUIDv4
- **Severity:** CRITICAL
- **Source:** `src/application/claim-service.ts`
- **Issue:** Per the v5.2 Addendum (ratified by `WVSNP_MASTER_SPEC_ADDENDUM_v5.2.md`), ClaimId must be a client-generated UUIDv4 (like all other aggregate IDs). The code instead generates ClaimId via `EventStore.newEventId()` which produces a UUIDv7 (server-generated, time-sortable). This violates LAW 3.1 (aggregate IDs are UUIDv4) and breaks offline-safe claim submission.
- **Impact:** Claims cannot be created offline. The identity model is inconsistent with all other aggregates. ClaimFingerprint-based de-duplication (v5.2 requirement) is not implemented.
- **Affects:** Claim submission, offline capability, de-duplication safety, v5.2 compliance.
- **Ref:** v5.3 Fix 8, Addendum v5.2 Section 3.6

#### GAP-A3.2: ClaimFingerprint De-Duplication Not Implemented
- **Severity:** CRITICAL
- **Source:** `src/application/claim-service.ts`, `src/domain/claim/claim-logic.ts`
- **Issue:** The v5.2 Addendum specifies a canonical fingerprint `SHA-256(voucherId:clinicId:procedureCode:dateOfService:rabies=0|1)` with a `UNIQUE(grant_cycle_id, clinic_id, claim_fingerprint)` database constraint. On duplicate, the system should return the existing ClaimId with `DUPLICATE_DETECTED` status. While the schema has the constraint and `domain-types.ts` has a `Claim.createFingerprint()` function, the claim service does not use the fingerprint for de-duplication.
- **Impact:** Duplicate claims can be submitted (one per idempotency key window). After the 24h idempotency TTL expires, the same procedure can be invoiced again.
- **Affects:** Financial integrity, claim accuracy, audit compliance.
- **Ref:** Addendum v5.2 Sections 3.6.2-3.6.6 (not addressed in v5.3 patch)

---

### A4. Business Logic Gaps

#### GAP-A4.1: Money Math Uses `Number()` Instead of BigInt
- **Severity:** CRITICAL
- **Source:** `src/application/grant-service.ts`, `src/application/claim-service.ts`, `src/application/invoice-service.ts`
- **Issue:** Multiple files convert `MoneyCents` values using `Number()` instead of maintaining BigInt arithmetic. LAW 1.4 states "`number` is FORBIDDEN for money."
- **Impact:** Floating-point precision errors on large amounts. For example, `Number(9007199254740993n)` silently rounds to `9007199254740992`. Over time, rounding errors accumulate in grant balances, invoice totals, and OASIS export control totals.
- **Affects:** All financial calculations, grant balance invariants, invoice totals, OASIS control totals, closeout reconciliation.
- **Ref:** v5.3 Fix 10

#### GAP-A4.2: LIRP Co-Pay Not Enforced
- **Severity:** HIGH
- **Source:** `src/application/claim-service.ts`, `src/application/grant-service.ts`
- **Issue:** LAW 7.4 states "Co-pay is FORBIDDEN for LIRP vouchers." Neither voucher issuance nor claim submission validates this rule. A LIRP voucher can be issued with `coPayRequired: true` and claims can include `coPayCollectedCents > 0`.
- **Impact:** Regulatory non-compliance. LIRP is specifically designed as a low-income relief program where co-pay is prohibited by statute.
- **Affects:** LIRP voucher issuance, LIRP claim submission, regulatory compliance.
- **Ref:** v5.3 Fix 9

#### GAP-A4.3: Voucher Expiry Validation Incorrect
- **Severity:** HIGH
- **Source:** `src/application/grant-service.ts`
- **Issue:** Voucher expiry validation uses `now + 365 days` as the expiration ceiling instead of the actual `grantCycleEndAt` date (June 30 per LAW 2.7). A voucher issued May 1 gets validated against May 1 + 365 = April 30 next year, not June 30 of the current grant cycle.
- **Impact:** Vouchers can be issued with expiration dates beyond the grant cycle end, allowing claims against closed cycles.
- **Affects:** Grant cycle integrity, closeout workflow.
- **Ref:** v5.3 Fix 12

#### GAP-A4.4: Carry-Forward Adjustment Filtering Broken
- **Severity:** MEDIUM
- **Source:** `src/application/invoice-service.ts`
- **Issue:** The carry-forward adjustment filter has a TODO comment indicating the filter condition is "always true." All pending adjustments from all clinics are applied to every clinic's invoice generation run.
- **Impact:** Adjustments intended for Clinic A are applied to Clinic B's invoice. Cross-clinic financial contamination.
- **Affects:** Invoice accuracy, per-clinic financial reporting.
- **Ref:** v5.3 Fix 11

#### GAP-A4.5: Reimbursement Rate Engine Not Visible
- **Severity:** MEDIUM
- **Source:** Spec LAW 1.2 vs. codebase
- **Issue:** LAW 1.2 specifies a Rational rate type `{ numeratorCents, denominatorCents }` with `ROUND_HALF_UP` rounding for calculating reimbursement amounts. While `grant_balances_projection` has `rate_numerator_cents` and `rate_denominator_cents` columns, no rate calculation engine is invoked during claim adjudication to compute the reimbursable amount.
- **Impact:** Claim approval amounts may not reflect the correct grant reimbursement rate.
- **Affects:** Claim adjudication accuracy, financial reporting.

---

### A5. API & Interface Gaps

#### GAP-A5.1: No Read/Query Endpoints for Aggregates
- **Severity:** HIGH
- **Source:** `src/server.ts` (only 3 endpoints defined)
- **Issue:** The HTTP layer exposes only `GET /health`, `POST /events`, and `POST /events/query`. There are no endpoints to query aggregate state:
  - No `GET /grants/:id` or `GET /grants/:id/balance`
  - No `GET /vouchers/:id`
  - No `GET /claims/:id` or `GET /claims?clinicId=...&status=APPROVED`
  - No `GET /invoices/:id` or `GET /invoices?clinicId=...&period=2026-01`
  - No `GET /oasis-batches/:id`
  - No `GET /closeout/:grantCycleId`
- **Impact:** Consuming systems (VetOS, ShelterOS, WVDA Admin Portal) must replay the entire event stream to reconstruct current state. This is impractical for real-time UIs showing voucher status, claim status, or grant balances.
- **Affects:** All integration partners, real-time dashboards, admin workflows.

#### GAP-A5.2: Application Services Not Exposed via HTTP
- **Severity:** HIGH
- **Source:** `src/server.ts`, `src/application/*.ts`
- **Issue:** Six application services with 18 operations exist but none are exposed as HTTP endpoints. The services are only callable within the Node.js process. External systems cannot:
  - Issue vouchers (`GrantService.issueVoucherOnline`)
  - Submit claims (`ClaimService.submitClaim`)
  - Adjudicate claims (`ClaimService.adjudicateClaim`)
  - Generate invoices (`InvoiceService.generateMonthlyInvoices`)
  - Generate/submit OASIS exports (`OasisService.*`)
  - Run closeout (`CloseoutService.*`)
- **Impact:** The system has no callable API beyond raw event submission. Integrators must construct raw events manually, which bypasses all service-layer validation, state machine enforcement, and financial invariant checking.
- **Affects:** All external consumers, operational workflows, admin operations.

#### GAP-A5.3: No Artifact Storage/Retrieval Layer
- **Severity:** HIGH
- **Source:** `db/schema.sql` (`artifact_log` table), `src/domain/artifact/artifact-types.ts`
- **Issue:** Artifact metadata is defined (`artifact_log` table, `ArtifactMetadata` type, `validateArtifactProvenance` function), and claim submission requires artifact IDs (`procedureReportId`, `clinicInvoiceId`, etc.). However, there is no:
  - Upload endpoint for artifacts
  - Storage backend (S3, blob storage, filesystem)
  - Download/retrieval endpoint
  - Virus scanning pipeline (quarantine status is defined but no scanner integration)
- **Impact:** Claims cannot attach required evidence documents. The artifact validation in `claim-service.ts` references artifact IDs that have no mechanism for creation.
- **Affects:** Claim submission, audit evidence trail, WVDA review workflow.

#### GAP-A5.4: No Webhook/Notification System
- **Severity:** MEDIUM
- **Source:** `WVSNP_GMS_Integration_Map_v1.0.md`
- **Issue:** The integration map specifies 4 webhook types (claim status changes, payment events, voucher events, deadline warnings) that consuming systems need. No webhook infrastructure exists.
- **Impact:** VetOS and ShelterOS must poll the event query endpoint to detect changes. This increases latency and server load.
- **Affects:** VetOS integration, ShelterOS integration, real-time user notifications.

#### GAP-A5.5: No API Versioning
- **Severity:** MEDIUM
- **Source:** `src/server.ts`
- **Issue:** Routes are bare (`/events`, `/events/query`) with no version prefix (e.g., `/v1/events`). Breaking changes to the event schema or query format will break all consumers simultaneously with no migration path.
- **Impact:** No backward compatibility guarantee for API consumers.
- **Affects:** All integration partners, deployment coordination.

#### GAP-A5.6: No OpenAPI/Swagger Documentation
- **Severity:** LOW
- **Source:** Entire codebase
- **Issue:** No machine-readable API specification exists. Integrators must read source code to understand request/response formats.
- **Impact:** Slower integration development, higher risk of integration errors.
- **Affects:** VetOS team, ShelterOS team, WVDA portal team.

---

### A6. Security Gaps

#### GAP-A6.1: No Authentication
- **Severity:** CRITICAL
- **Source:** `src/server.ts`
- **Issue:** All endpoints are publicly accessible. No JWT, OAuth2, API key, or session-based authentication. Any HTTP client can submit events to the immutable event log or read the full event history.
- **Impact:** Unauthorized parties can inject fraudulent events (fake claims, fake approvals, fake payments), read sensitive grant and clinic data, and corrupt the append-only audit log.
- **Affects:** Data integrity, regulatory compliance, PII protection, financial safety.

#### GAP-A6.2: No Authorization (RBAC)
- **Severity:** CRITICAL
- **Source:** `src/server.ts:62-63`
- **Issue:** The `actorType` field (`APPLICANT`, `ADMIN`, `SYSTEM`) is supplied by the client in the request body and trusted without verification. Any requester can claim to be `ADMIN` or `SYSTEM` and perform privileged operations (adjudicate claims, close grant cycles, submit OASIS exports).
- **Impact:** Complete authorization bypass. Privilege escalation is trivial.
- **Affects:** All operations requiring ADMIN or SYSTEM privilege.

#### GAP-A6.3: Error Messages Leak Internal State
- **Severity:** HIGH
- **Source:** `src/server.ts:96-97, 111-112`
- **Issue:** Raw error messages are returned to clients: `res.status(400).json({ error: (error as Error).message })`. Error codes like `CLINIC_NOT_FOUND`, `GRANT_CYCLE_CLOSED`, `VOUCHER_NOT_FOUND` reveal internal system state, database schema, and business logic to external callers.
- **Impact:** Information disclosure aids reconnaissance for targeted attacks.
- **Affects:** API security posture.

#### GAP-A6.4: No Rate Limiting
- **Severity:** HIGH
- **Source:** `package.json` (no rate-limit dependency), `src/server.ts` (no middleware)
- **Issue:** No request rate limiting exists. The event query endpoint allows fetching up to 1000 events per request with no throttling.
- **Impact:** Denial-of-service attacks. Database overload via unbounded queries. Brute-force enumeration of event data.
- **Affects:** System availability, data confidentiality.

#### GAP-A6.5: Sensitive Data in Idempotency Cache (Unencrypted)
- **Severity:** MEDIUM
- **Source:** `src/application/idempotency-service.ts`
- **Issue:** Operation responses (which may contain claim details, financial amounts, clinic information) are stored as plaintext JSON in the `idempotency_cache` table with a 24-hour TTL.
- **Impact:** Sensitive data exposure if database is accessed by unauthorized users.
- **Affects:** PII protection, compliance.

#### GAP-A6.6: No Security Headers
- **Severity:** MEDIUM
- **Source:** `src/server.ts`
- **Issue:** No security headers middleware (e.g., `helmet.js`). Missing headers include `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`.
- **Impact:** Standard web security protections absent.
- **Affects:** Security posture assessment.

#### GAP-A6.7: No Startup Validation of Required Environment Variables
- **Severity:** LOW
- **Source:** `src/server.ts:82`
- **Issue:** `DATABASE_URL` is read from `process.env` without validation. If unset, the application starts but crashes on first database operation with an unclear error.
- **Impact:** Confusing deployment failures.
- **Affects:** Deployment reliability.

---

### A7. Testing Gaps

#### GAP-A7.1: Phase 4 Conformance Tests Are Placeholder Stubs
- **Severity:** HIGH
- **Source:** `tests/phase4-v5.2-conformance.test.ts`
- **Issue:** 11 of 14 Phase 4 tests are placeholder stubs (`expect(true).toBe(true)`). Untested areas include:
  - OASIS file rendering (fixed-width format, control totals, CRLF)
  - Batch void/rejection releasing invoices
  - Missing vendor code exclusion
  - Closeout lock enforcement (blocking events after cycle closed)
  - Audit hold logic
  - Deadline enforcement (June 30, Nov 15)
  - Reconciliation financial invariant
  - Replay determinism
- **Impact:** Phase 4 has no verified test coverage. Conformance claims cannot be substantiated.
- **Affects:** Regulatory confidence, deployment readiness.

#### GAP-A7.2: No End-to-End Workflow Tests
- **Severity:** HIGH
- **Source:** `tests/` directory (3 files, all phase-specific)
- **Issue:** No test exercises the complete lifecycle: Grant creation → Voucher issuance → Claim submission → Claim approval → Invoice generation → OASIS export → Closeout. Each phase is tested in isolation.
- **Impact:** Integration bugs between phases (e.g., the invoice pipeline being dead per GAP-A2.1) are not caught by tests.
- **Affects:** Overall system correctness assurance.

#### GAP-A7.3: Domain Logic Unit Tests Missing
- **Severity:** MEDIUM
- **Source:** `src/domain/` (8 domain logic files)
- **Issue:** Only 3 of 8 domain logic files have any test coverage, and that coverage is indirect (tested through service-layer integration tests). No direct unit tests exist for:
  - `oasis/renderer.ts` (209 lines — fixed-width file generation)
  - `oasis/batch-logic.ts` (184 lines — batch state machine)
  - `closeout/cycle-logic.ts` (244 lines — closeout state machine)
  - `clinic/clinic-logic.ts` (101 lines — clinic registration, license validation)
  - `voucher/voucher-logic.ts` (104 lines — only ~10% indirect coverage)
- **Impact:** Domain invariants are unverified. State machine edge cases untested.
- **Affects:** Domain correctness confidence.

---

### A8. Documentation & Specification Gaps

#### GAP-A8.1: Missing XLSX Application Template
- **Severity:** MEDIUM
- **Source:** `docs/ambiguities/2026-02-05.md`
- **Issue:** The spec references a `spay-neuter-application.xlsx` file at a Windows path (`/mnt/user-data/uploads/`) that does not exist. This file is needed to derive the `FIELD_TO_CELL_MAP` for Phase 1 application parsing.
- **Impact:** Phase 1 (Application) cannot be completed without this reference document.
- **Affects:** Phase 1 application intake workflow.

#### GAP-A8.2: No `.env.example` File
- **Severity:** LOW
- **Source:** Project root
- **Issue:** No template file documents required environment variables (`DATABASE_URL`, `PORT`). Developers must read source code to determine configuration requirements.
- **Impact:** Slower onboarding for new developers and deployment teams.
- **Affects:** Developer experience, deployment documentation.

---

## 4. PART B — RECOMMENDED FEATURES & ENHANCEMENTS

The following are not gaps per se, but features and workflow improvements that would make the WVSNP-GMS work better, more efficiently, and with better transparency.

### B1. Operational Efficiency

#### B1.1: RESTful Projection Query API
- **Priority:** HIGH
- **Description:** Expose read-only endpoints for each projection table:
  ```
  GET /v1/grants/:grantId/balance
  GET /v1/vouchers/:voucherId
  GET /v1/vouchers?grantId=...&status=ISSUED
  GET /v1/claims?clinicId=...&status=APPROVED&period=2026-01
  GET /v1/invoices?clinicId=...&status=SUBMITTED
  GET /v1/oasis-batches?grantCycleId=...&status=CREATED
  GET /v1/closeout/:grantCycleId
  ```
- **Benefit:** Consuming systems (VetOS, ShelterOS, WVDA) can query current state directly instead of replaying events. Reduces integration complexity, network traffic, and client-side processing.

#### B1.2: Command API for Service Operations
- **Priority:** HIGH
- **Description:** Expose the 18 application service operations as typed HTTP endpoints:
  ```
  POST /v1/vouchers/issue
  POST /v1/claims/submit
  POST /v1/claims/:claimId/adjudicate
  POST /v1/invoices/generate
  POST /v1/oasis/batches/generate
  POST /v1/oasis/batches/:batchId/submit
  POST /v1/closeout/:grantCycleId/preflight
  POST /v1/closeout/:grantCycleId/start
  ```
- **Benefit:** Integrators use high-level commands with full service-layer validation instead of constructing raw events. Eliminates the risk of malformed events bypassing business rules.

#### B1.3: Scheduled Job Framework
- **Priority:** MEDIUM
- **Description:** Implement a scheduled job runner for recurring operations:
  - Sweep expired tentative vouchers (currently a standalone script)
  - Monthly invoice generation (1st of each month)
  - Idempotency cache cleanup (expired entries)
  - License expiration warnings (30-day, 7-day ahead)
- **Benefit:** Reduces manual operational burden. Ensures time-sensitive operations happen reliably.

#### B1.4: Batch Claim Adjudication
- **Priority:** MEDIUM
- **Description:** Add a batch adjudication endpoint that processes multiple claims at once with a single policy decision:
  ```
  POST /v1/claims/adjudicate-batch
  { claimIds: [...], decision: "APPROVE", decisionBasis: {...} }
  ```
- **Benefit:** WVDA administrators can approve/deny groups of claims efficiently instead of one-at-a-time, which is critical during high-volume periods.

#### B1.5: Automatic Invoice Submission
- **Priority:** LOW
- **Description:** After invoice generation, automatically transition invoices to SUBMITTED status when all required conditions are met (all claims verified, artifacts attached, clinic banking info validated).
- **Benefit:** Reduces manual steps in the settlement pipeline.

---

### B2. Transparency & Auditability

#### B2.1: Event Stream Dashboard / Admin Audit Viewer
- **Priority:** HIGH
- **Description:** Build a read-only web interface or API for browsing the event log with filtering by:
  - Grant cycle
  - Aggregate type/ID
  - Event type
  - Actor ID/type
  - Time range (occurredAt, ingestedAt)
  - Correlation ID (trace a full operation chain)
- **Benefit:** WVDA auditors can investigate any operation without SQL access. Full transparency into system decisions.

#### B2.2: Decision Audit Trail with Policy Snapshots
- **Priority:** HIGH
- **Description:** Implement the LAW 6.3 requirement: every `CLAIM_APPROVED` or `CLAIM_DENIED` event must include `{ ruleId, policyVersion, policySnapshotId, evidenceRefs }`. Store policy snapshots as immutable artifacts so auditors can replay any decision against the exact rules that applied at adjudication time.
- **Benefit:** Regulatory compliance. Auditors can verify that every claim decision followed the correct policy. Eliminates disputes about what rules were active when a decision was made.

#### B2.3: Financial Transparency Reports
- **Priority:** HIGH
- **Description:** Add report generation endpoints that produce:
  - **Grant Balance Report:** Per-grant, per-bucket snapshot (awarded, encumbered, liquidated, released, available)
  - **County Activity Report:** Vouchers issued, claims filed, animals served, by county
  - **Clinic Settlement Report:** Per-clinic claim totals, invoice status, payment status
  - **Matching Funds Report:** Committed vs. reported gap per grantee
  - **Unspent Funds Report:** Available balance approaching cycle end
- **Benefit:** Program administrators, grantees, and auditors have clear visibility into fund utilization without manual SQL queries.

#### B2.4: Projection Rebuild Audit Log
- **Priority:** MEDIUM
- **Description:** When projections are rebuilt via `npm run rebuild:projections`, log a `PROJECTION_REBUILD_COMPLETED` event (operational, not domain) with:
  - Rebuild timestamp
  - Number of events replayed
  - Final watermark position
  - Checksums of key projection counts
- **Benefit:** Audit trail for projection rebuilds. Ability to verify that rebuilds are deterministic (same event count, same final state).

#### B2.5: Matching Funds Evidence Submission Workflow
- **Priority:** MEDIUM
- **Description:** Implement the matching funds reporting flow:
  1. Grantee submits matching funds evidence (receipts, payroll records)
  2. System emits `MATCHING_FUNDS_REPORTED` event with artifact references
  3. Closeout preflight validates matching funds commitment met
  4. Shortfall flagged if reported < committed
- **Benefit:** Currently specified in spec but no submission mechanism exists. Required for grant cycle closeout.

#### B2.6: Real-Time Event Notifications (Webhooks)
- **Priority:** MEDIUM
- **Description:** Implement a webhook system:
  - Consumers register webhook URLs for event types they care about
  - On event append, matching webhooks are fired asynchronously
  - Include retry with exponential backoff and dead-letter queue
  - Webhook types: `claim.status_changed`, `payment.recorded`, `voucher.issued`, `deadline.approaching`
- **Benefit:** VetOS and ShelterOS receive real-time updates instead of polling. Clinic staff see instant claim status changes. Grantees get payment notifications.

---

### B3. Integration & Workflow

#### B3.1: Structured Error Response with Remediation Guidance
- **Priority:** HIGH
- **Description:** Replace raw error strings with structured error objects:
  ```json
  {
    "error": {
      "code": "GRANT_PERIOD_ENDED",
      "message": "The grant period ended on 2026-06-30.",
      "field": "expiresAt",
      "remediation": "Contact WVDA to request an extension or use next cycle's grant."
    }
  }
  ```
- **Benefit:** Frontend developers can display actionable error messages to users. Reduces support tickets from clinics confused by cryptic error codes.

#### B3.2: Health Check with Dependency Status
- **Priority:** MEDIUM
- **Description:** Enhance `GET /health` to report dependency status:
  ```json
  {
    "status": "ok",
    "database": { "connected": true, "latencyMs": 3 },
    "eventLog": { "totalEvents": 45231, "latestIngestedAt": "2026-02-06T..." },
    "projections": { "lastRebuilt": "2026-02-05T...", "watermark": "..." },
    "version": "5.2.0"
  }
  ```
- **Benefit:** Operations team can monitor system health without separate tooling. Load balancers can make intelligent routing decisions.

#### B3.3: Claim Status Tracking for Clinics
- **Priority:** MEDIUM
- **Description:** Add an endpoint for clinics to check the status of their submitted claims:
  ```
  GET /v1/clinics/:clinicId/claims?status=PENDING
  ```
  Returns claim status, expected payment date, and any required actions (missing artifacts, license renewal needed).
- **Benefit:** Clinics have transparency into their claim pipeline without contacting WVDA.

#### B3.4: Voucher Lookup and Verification
- **Priority:** MEDIUM
- **Description:** Add endpoint for clinics to verify a voucher is valid before performing a procedure:
  ```
  GET /v1/vouchers/verify?code=WVSNP-KAN-2026-0042
  ```
  Returns: voucher status, max reimbursement, expiration, LIRP flag, remaining balance.
- **Benefit:** Clinics confirm voucher validity before service, preventing claim denials after the fact.

#### B3.5: OASIS Export File Download Endpoint
- **Priority:** LOW
- **Description:** After `OASIS_EXPORT_FILE_RENDERED`, expose the fixed-width file for download:
  ```
  GET /v1/oasis/batches/:batchId/file
  ```
  Returns the rendered file with `Content-Type: text/plain` and SHA-256 header for verification.
- **Benefit:** WVDA staff can download export files directly without file system access.

---

### B4. Resilience & Reliability

#### B4.1: Database Connection Pool Health Monitoring
- **Priority:** HIGH
- **Description:** Add connection pool monitoring (active connections, idle connections, queue depth, connection errors). Expose as metrics endpoint and/or include in health check.
- **Benefit:** Early warning of database connection exhaustion. Prevents silent failures where all requests hang waiting for connections.

#### B4.2: Graceful Shutdown
- **Priority:** MEDIUM
- **Description:** Implement `SIGTERM`/`SIGINT` handlers that:
  1. Stop accepting new requests
  2. Wait for in-flight requests to complete (with timeout)
  3. Close database connections cleanly
  4. Exit with code 0
- **Benefit:** Clean deployments without dropped requests or orphaned database transactions.

#### B4.3: Structured Logging
- **Priority:** MEDIUM
- **Description:** Replace `console.log` with structured JSON logging including:
  - Request ID (trace individual requests)
  - Correlation ID (trace across events)
  - Actor ID (who triggered the operation)
  - Duration (request processing time)
  - Error details with stack traces (server-side only)
- **Benefit:** Enables log aggregation (ELK, CloudWatch, Datadog). Supports incident investigation and performance monitoring.

#### B4.4: Database Migration System
- **Priority:** MEDIUM
- **Description:** Replace the single `schema.sql` file with a versioned migration system (e.g., `node-pg-migrate`, `knex migrations`). Each schema change gets a numbered, idempotent migration file.
- **Benefit:** Safe schema evolution. Rollback capability. Deployment automation.

#### B4.5: Circuit Breaker for External Dependencies
- **Priority:** LOW
- **Description:** When OASIS export submission integrates with the WV Treasury system, implement a circuit breaker pattern to handle Treasury system downtime gracefully.
- **Benefit:** Prevents cascading failures. Provides clear feedback when external systems are unavailable.

---

### B5. Developer Experience

#### B5.1: OpenAPI Specification
- **Priority:** HIGH
- **Description:** Generate or write an OpenAPI 3.0 spec for all endpoints (current and proposed). Include request/response schemas, error codes, authentication requirements.
- **Benefit:** Auto-generated client SDKs for VetOS, ShelterOS, and WVDA teams. Interactive API documentation (Swagger UI). Contract-based testing.

#### B5.2: Seed Data & Local Development Setup
- **Priority:** MEDIUM
- **Description:** Provide:
  - `docker-compose.yml` for local PostgreSQL
  - `db/seed.sql` with sample grant cycles, clinics, vouchers, claims
  - `.env.example` with documented variables
  - `scripts/setup-local.sh` that does all of the above
- **Benefit:** New developers can set up a working environment in minutes instead of hours. Reproducible development environments.

#### B5.3: CI/CD Pipeline Configuration
- **Priority:** MEDIUM
- **Description:** Add GitHub Actions (or equivalent) workflow:
  1. Install dependencies
  2. Type-check (`tsc --noEmit`)
  3. Run tests (with PostgreSQL service container)
  4. Build (`npm run build`)
  5. (Optional) Deploy on merge to main
- **Benefit:** Automated quality gates. Prevents broken code from reaching production.

#### B5.4: Integration Test Harness
- **Priority:** MEDIUM
- **Description:** Build a test harness that simulates the VetOS/ShelterOS integration:
  - Register a clinic
  - Issue vouchers
  - Submit claims
  - Run adjudication
  - Generate invoices
  - Export to OASIS
  - Close cycle
- **Benefit:** Validates the full integration contract before deployment. Catches regression in cross-system workflows.

---

## 5. GAP IMPACT MATRIX

| Gap ID | Severity | Blocks Phase 1 | Blocks Phase 2 | Blocks Phase 3 | Blocks Phase 4 | Blocks Integration |
|--------|----------|:-:|:-:|:-:|:-:|:-:|
| A1.1 | CRITICAL | | X | X | X | X |
| A1.2 | CRITICAL | X | X | X | X | X |
| A1.3 | CRITICAL | | X | | X | X |
| A1.4 | CRITICAL | | | X | X | X |
| A2.1 | CRITICAL | | | X | X | X |
| A2.2 | CRITICAL | | X | | X | |
| A2.3 | HIGH | | | X | X | X |
| A3.1 | CRITICAL | | | X | X | X |
| A3.2 | CRITICAL | | | X | X | X |
| A4.1 | CRITICAL | | X | X | X | X |
| A4.2 | HIGH | | X | X | | |
| A4.3 | HIGH | | X | | X | |
| A4.4 | MEDIUM | | | X | X | |
| A4.5 | MEDIUM | | | X | | |
| A5.1 | HIGH | | | | | X |
| A5.2 | HIGH | | | | | X |
| A5.3 | HIGH | | | X | | X |
| A5.4 | MEDIUM | | | | | X |
| A5.5 | MEDIUM | | | | | X |
| A5.6 | LOW | | | | | X |
| A6.1 | CRITICAL | X | X | X | X | X |
| A6.2 | CRITICAL | X | X | X | X | X |
| A6.3 | HIGH | | | | | X |
| A6.4 | HIGH | | | | | X |
| A6.5 | MEDIUM | | | X | | |
| A6.6 | MEDIUM | | | | | X |
| A6.7 | LOW | X | X | X | X | X |
| A7.1 | HIGH | | | | X | |
| A7.2 | HIGH | | | | X | |
| A7.3 | MEDIUM | | | X | X | |
| A8.1 | MEDIUM | X | | | | |
| A8.2 | LOW | | | | | |

---

## 6. DEPENDENCY GRAPH

```
IMMEDIATE (Must fix before anything works)
├── GAP-A1.1  Duplicate table definitions
├── GAP-A1.2  Projection immutability triggers
├── GAP-A1.3  AllocatorId UUID formatting
├── GAP-A1.4  Column type mismatch
└── GAP-A4.1  Money math (Number → BigInt)
      ↓
PHASE 2 UNBLOCK (Voucher + Grant operations)
├── GAP-A2.2  Sweep job trace fields
├── GAP-A4.2  LIRP co-pay enforcement
└── GAP-A4.3  Voucher expiry validation
      ↓
PHASE 3 UNBLOCK (Claims + Invoices)
├── GAP-A2.1  approved_event_id population
├── GAP-A2.3  Claims not marked invoiced
├── GAP-A3.1  ClaimId UUIDv4 (not v7)
├── GAP-A3.2  ClaimFingerprint de-duplication
├── GAP-A4.4  Carry-forward adjustment filtering
└── GAP-A4.5  Reimbursement rate engine
      ↓
PHASE 4 VERIFY (OASIS + Closeout can execute)
├── GAP-A7.1  Phase 4 placeholder tests → real tests
└── GAP-A7.2  End-to-end workflow tests
      ↓
PRODUCTION READINESS (Security + API)
├── GAP-A6.1  Authentication
├── GAP-A6.2  Authorization
├── GAP-A5.1  Read/Query endpoints
├── GAP-A5.2  Service HTTP endpoints
├── GAP-A5.3  Artifact storage
└── GAP-A6.3  Error message sanitization
      ↓
INTEGRATION (VetOS, ShelterOS, WVDA)
├── GAP-A5.4  Webhooks
├── GAP-A5.5  API versioning
└── GAP-A5.6  OpenAPI docs
```

---

## 7. APPENDIX: FILES REVIEWED

| File | Path | Lines | Reviewed |
|------|------|-------|----------|
| Server | `src/server.ts` | 120 | Full |
| Event Store | `src/event-store.ts` | ~4,313 | Key sections |
| Domain Types | `src/domain-types.ts` | ~5,606 | Key sections |
| UUIDv7 | `src/uuidv7.ts` | ~1,507 | Key sections |
| Grant Service | `src/application/grant-service.ts` | 453 | Full |
| Claim Service | `src/application/claim-service.ts` | 454 | Full |
| Invoice Service | `src/application/invoice-service.ts` | 319 | Full |
| Closeout Service | `src/application/closeout-service.ts` | 607 | Full |
| OASIS Service | `src/application/oasis-service.ts` | 726 | Full |
| Idempotency Service | `src/application/idempotency-service.ts` | 65 | Full |
| Grant Logic | `src/domain/grant/grant-logic.ts` | 116 | Full |
| Voucher Logic | `src/domain/voucher/voucher-logic.ts` | 104 | Full |
| Voucher Allocator | `src/domain/voucher/voucher-code-allocator.ts` | ~50 | Full |
| Claim Logic | `src/domain/claim/claim-logic.ts` | 179 | Full |
| Invoice Logic | `src/domain/invoice/invoice-logic.ts` | 133 | Full |
| Clinic Logic | `src/domain/clinic/clinic-logic.ts` | 101 | Full |
| Closeout Logic | `src/domain/closeout/cycle-logic.ts` | ~244 | Full |
| OASIS Renderer | `src/domain/oasis/renderer.ts` | ~209 | Full |
| OASIS Batch Logic | `src/domain/oasis/batch-logic.ts` | ~184 | Full |
| Artifact Types | `src/domain/artifact/artifact-types.ts` | 56 | Full |
| Projection Rebuild | `src/projections/rebuild.ts` | ~100 | Full |
| Sweep Job | `src/jobs/sweep-expired-tentatives.ts` | ~80 | Full |
| Schema | `db/schema.sql` | ~420 | Full |
| Phase 2 Tests | `tests/phase2-conformance.test.ts` | 237 | Full |
| Phase 3 Tests | `tests/phase3-v5.1-conformance.test.ts` | 291 | Full |
| Phase 4 Tests | `tests/phase4-v5.2-conformance.test.ts` | 251 | Full |
| Master Spec | `WVSNP_MASTER_SPEC_v5.0.md` | ~315 | Full |
| Addendum v5.2 | `WVSNP_MASTER_SPEC_ADDENDUM_v5.2.md` | ~100 | Full |
| Identity Exceptions | `IDENTITY_EXCEPTIONS_v5.2.md` | ~80 | Full |
| Integration Map | `WVSNP_GMS_Integration_Map_v1.0.md` | ~200 | Full |
| AGENTS.md | `AGENTS.md` | ~50 | Full |
| Stabilization v5.3 | `WINDSURF_01_Stabilization_v5.3.md` | ~200 | Full |
| Phase 4 Build Guide | `WINDSURF_02_Phase4_OASIS_v5.2.md` | ~300 | Full |
| Ambiguities | `docs/ambiguities/2026-02-05.md` | ~30 | Full |
| Phase 4 Summary | `docs/conformance/phase4-v5.2-implementation-summary.md` | ~100 | Full |
| Package.json | `package.json` | 24 | Full |
| Jest Config | `jest.config.cjs` | ~10 | Full |
| TypeScript Config | `tsconfig.json` | ~15 | Full |
| .gitignore | `.gitignore` | ~12 | Full |

---

*Report generated 2026-02-06 via comprehensive codebase review.*
