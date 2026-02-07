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
