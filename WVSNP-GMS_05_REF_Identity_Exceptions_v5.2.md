# IDENTITY EXCEPTIONS (WVSNP-GMS v5.2)

---

## DEFAULT RULES

| Scope | Type | Requirement |
|-------|------|-------------|
| Event IDs | UUIDv7 | Server-generated. Time-sortable. Used for ordering tie-breaks. |
| Aggregate IDs | UUIDv4 | Client-generated via `crypto.randomUUID()`. Random. Offline-safe. |

**Standard Aggregate IDs (No Exception):**
- GrantId
- GrantCycleId
- VoucherId
- ClaimId
- InvoiceId
- PaymentId
- ClinicId
- AdjustmentId
- ExportBatchId

---

## APPROVED EXCEPTIONS

### 1. Voucher Code Allocator ID

| Field | Value |
|-------|-------|
| **Type** | Deterministic hash-derived UUID |
| **Formula** | `UUID(SHA-256("VoucherCodeAllocator:" + grantCycleId + ":" + countyCode))` |
| **Reason** | Stable singleton per (grantCycleId, countyCode) without global search |
| **Approved** | Phase 2 |

### 2. Claim Fingerprint

| Field | Value |
|-------|-------|
| **Type** | SHA-256 hash |
| **Formula** | `SHA-256(voucherId + ":" + clinicId + ":" + procedureCode + ":" + dateOfService + ":rabies=" + 0\|1)` |
| **Purpose** | Atomic duplicate detection via UNIQUE constraint |
| **Approved** | Phase 3 v5.1 |

> ### ⚠️ CRITICAL: ClaimFingerprint is NOT an Identity
>
> **FORBIDDEN Uses:**
> - ❌ As aggregateId in events
> - ❌ As foreign key in other tables
> - ❌ As URL parameter or API identifier
> - ❌ As external reference
>
> ClaimFingerprint is a **de-duplication property** enforced by:
> `UNIQUE(grant_cycle_id, clinic_id, claim_fingerprint)` on `claims_projection`

### 3. Batch Fingerprint

| Field | Value |
|-------|-------|
| **Type** | SHA-256 hash |
| **Formula** | `SHA-256(grantCycleId + ":" + periodStart + ":" + periodEnd + ":" + sorted(invoiceIds).join(","))` |
| **Purpose** | Semantic de-duplication for export batches |
| **Approved** | Phase 4 v5.2 |

> Same restrictions as ClaimFingerprint: NOT an identity, NOT a foreign key.

---

## GOVERNANCE

- New exceptions require documented justification
- All exceptions recorded in this file
- This file is the single source of truth for identity policy
- Referenced by AGENTS.md
