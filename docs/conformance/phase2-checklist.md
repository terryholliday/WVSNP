# PHASE 2 CONFORMANCE CHECKLIST
**WVSNP-GMS v5.0**  
**Date:** 2026-02-04  
**Status:** COMPLETE

---

## SCHEMA ARTIFACTS

### ✅ Phase 2 Projection Tables Created
- [x] `grant_balances_projection` with composite PK (grant_id, bucket_type)
- [x] `vouchers_projection` with voucher_id PK
- [x] `allocators_projection` with allocator_id PK (SHA-256 hash)
- [x] `idempotency_cache` with idempotency_key PK

### ✅ Immutability Triggers
- [x] `grant_balances_projection_immutable` trigger blocks UPDATE/DELETE
- [x] `vouchers_projection_immutable` trigger blocks UPDATE/DELETE
- [x] `allocators_projection_immutable` trigger blocks UPDATE/DELETE
- [x] `idempotency_cache` allows UPDATE (operational table, LAW 4.4)

### ✅ Indexes
- [x] `idx_vouchers_tentative_expiry` for sweep job efficiency
- [x] `idx_idempotency_expires_at` for cache cleanup

### ✅ Constraints
- [x] `balance_invariant` CHECK: available + encumbered + liquidated = awarded
- [x] Composite PK on (grant_id, bucket_type) enforces bucket isolation

---

## DOMAIN LOGIC

### ✅ Grant Aggregate (Bucket Isolation)
- [x] `createInitialGrantState()` - initializes empty Map
- [x] `applyGrantEvent()` - handles GRANT_CREATED, FUNDS_ENCUMBERED, FUNDS_RELEASED, FUNDS_LIQUIDATED, MATCHING_FUNDS_REPORTED/ADJUSTED
- [x] `checkGrantInvariant()` - validates balance equation and non-negative values
- [x] GENERAL and LIRP buckets stored as separate Map entries
- [x] All MoneyCents arithmetic wrapped in `Money.fromBigInt()` for branded type safety

### ✅ Voucher Aggregate (State Machine)
- [x] `createInitialVoucherState()` - initializes TENTATIVE status
- [x] `applyVoucherEvent()` - handles VOUCHER_ISSUED_TENTATIVE, VOUCHER_ISSUED_CONFIRMED, VOUCHER_ISSUED_REJECTED, VOUCHER_REDEEMED, VOUCHER_EXPIRED, VOUCHER_VOIDED
- [x] `checkVoucherInvariant()` - validates state transitions
- [x] State machine: TENTATIVE → ISSUED → REDEEMED/EXPIRED/VOIDED

### ✅ Allocator (Deterministic Hash)
- [x] `Allocator.createId()` - SHA-256 hash of (grantCycleId:countyCode)
- [x] `createInitialAllocatorState()` - initializes nextSequence = 1
- [x] `applyAllocatorEvent()` - handles VOUCHER_CODE_ALLOCATED
- [x] `generateVoucherCode()` - formats WVSNP-{county}-{year}-{seq}

---

## COMMAND HANDLERS

### ✅ GrantService.issueVoucherOnline()
- [x] Idempotency check via `IdempotencyService.checkAndReserve()`
- [x] Lock order: Grant Bucket → Allocator (voucher is new, no lock needed)
- [x] Funds availability check before encumbrance
- [x] Emits 3 events: VOUCHER_ISSUED, GRANT_FUNDS_ENCUMBERED, VOUCHER_CODE_ALLOCATED
- [x] Transactional projection updates in same transaction
- [x] All eventIds use `EventStore.newEventId()` (UUIDv7)
- [x] All actorIds cast to `ActorId` branded type
- [x] causationId handled as `?? null` for optional field

### ✅ GrantService.confirmTentativeVoucher()
- [x] Idempotency check
- [x] Lock order: Voucher → Grant Bucket → Allocator (mandatory order)
- [x] Tentative expiry validation
- [x] Funds availability check
- [x] Emits 3 events: VOUCHER_ISSUED_CONFIRMED, GRANT_FUNDS_ENCUMBERED, VOUCHER_CODE_ALLOCATED
- [x] Transactional projection updates

### ✅ IdempotencyService
- [x] `checkAndReserve()` - atomic INSERT ... ON CONFLICT with status transition
- [x] `recordResult()` - marks operation COMPLETED with response JSON
- [x] `recordFailure()` - marks operation FAILED for retry
- [x] TTL-based expiration via `expires_at` column

---

## SWEEP JOB

### ✅ sweepExpiredTentatives()
- [x] Queries `vouchers_projection` for expired tentatives
- [x] Acquires FOR UPDATE lock on expired rows
- [x] Double-checks status after lock (race safety)
- [x] Emits VOUCHER_ISSUED_REJECTED event with reason='TENTATIVE_EXPIRED'
- [x] Updates projection to VOIDED status
- [x] Transactional (BEGIN/COMMIT/ROLLBACK)

---

## DOMAIN TYPES

### ✅ Branded Types Extended
- [x] `ClaimId` - SHA-256 hash branded type
- [x] `AllocatorId` - SHA-256 hash branded type
- [x] `Claim.createId()` - deterministic hash from (voucherId:clinicId:procedureCode:dateOfService)
- [x] `Allocator.createId()` - deterministic hash from (grantCycleId:countyCode)

### ✅ Money Doctrine Compliance
- [x] All MoneyCents fields use `Money.fromBigInt()` for initialization
- [x] All arithmetic results wrapped in `Money.fromBigInt()` to preserve branding
- [x] JSON encoding/decoding via `Money.toJSON()` / `Money.fromJSON()`
- [x] No float math, no `number` type for money

---

## CHRONOLOGY DOCTRINE

### ✅ Dual Time Enforcement
- [x] All events have `occurredAt` (client time)
- [x] All events have `ingestedAt` (server-stamped via trigger)
- [x] No `createdAt` or `updatedAt` fields in domain logic
- [x] Server time used for ordering and deadline enforcement

### ✅ UUIDv7 for event_id
- [x] `EventStore.newEventId()` generates UUIDv7 (time-sortable)
- [x] All command handlers use `EventStore.newEventId()` for eventId
- [x] Causal ordering preserved via timestamp prefix in UUIDv7

---

## TESTS & EVIDENCE

### ✅ SQL Conformance Proof
- [x] `docs/conformance/phase2-proof.sql` - 10 test cases
- [x] Bucket isolation verification
- [x] Idempotency cache verification
- [x] Allocator deterministic hash verification
- [x] Money encoding verification
- [x] UUIDv7 format verification
- [x] Watermark pagination verification
- [x] Immutability trigger verification
- [x] Balance invariant constraint verification

### ✅ TypeScript Unit Tests
- [x] `tests/phase2-conformance.test.ts` - 10 test cases
- [x] Bucket isolation test
- [x] Idempotency test
- [x] Allocator deterministic hash test
- [x] Money encoding test
- [x] UUIDv7 format test
- [x] Immutability test
- [x] Sweep job test
- [x] Balance invariant test
- [x] Watermark pagination test
- [x] Lock order test (code review)

---

## BUILD & COMPILATION

### ✅ TypeScript Compilation
- [x] `pnpm build` succeeds with exit code 0
- [x] All imports resolved correctly
- [x] All branded types enforced
- [x] No lint errors

---

## PHASE 2 SIGN-OFF

**Phase 2 Implementation Status:** ✅ COMPLETE

**Conformance to WVSNP_MASTER_SPEC_v5.0:**
- LAW 0 (Event Sourcing): ✅ Compliant
- LAW 1 (Money Physics): ✅ Compliant
- LAW 2 (Chronology): ✅ Compliant
- LAW 3 (Identity): ✅ Compliant
- LAW 4 (Operational Kernel): ✅ Compliant
- LAW 5 (Allocator): ✅ Compliant
- LAW 6 (Voucher Lifecycle): ✅ Compliant
- LAW 7 (Claim Lifecycle): ⏸️ Phase 3
- LAW 8 (Projection Rebuild): ✅ Compliant

**Artifacts Delivered:**
1. Schema: `db/schema.sql` (Phase 2 projections + idempotency_cache)
2. Domain Logic: `src/domain/grant/grant-logic.ts`, `src/domain/voucher/voucher-logic.ts`, `src/domain/voucher/voucher-code-allocator.ts`
3. Command Handlers: `src/application/grant-service.ts`, `src/application/idempotency-service.ts`
4. Sweep Job: `src/jobs/sweep-expired-tentatives.ts`
5. Domain Types: `src/domain-types.ts` (extended with ClaimId, AllocatorId)
6. Tests: `tests/phase2-conformance.test.ts`
7. SQL Proof: `docs/conformance/phase2-proof.sql`
8. Checklist: `docs/conformance/phase2-checklist.md` (this file)

**Ready for Phase 3:** ✅ YES

---

**Signed:** Proveniq Prime  
**Date:** 2026-02-04  
**Version:** WVSNP-GMS v5.0 Phase 2
