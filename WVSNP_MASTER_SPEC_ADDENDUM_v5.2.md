# WVSNP-GMS — MASTER SPECIFICATION ADDENDUM v5.2
## Governance Amendment: Claim Identity + De-Dupe Physics (Ratifies v5.1+)

**Codename:** WVSNP-GMS  
**Applies To:** All implementations and audits performed on/after adoption of this addendum  
**Purpose:** Resolve v5.0 Law 3.6 drift by ratifying the v5.1+ identity model for claims (UUID identity + deterministic fingerprint for de-dupe).

---

## Document Control

- **Status:** GOVERNING LAW (Addendum)
- **Supersedes:** **LAW 3.6** in `WVSNP_MASTER_SPEC_v5.0.md` (only)
- **Does Not Change:** Event ID doctrine (UUIDv7), allocator deterministic ID doctrine, money doctrine, chronology doctrine

---

## Executive Summary (What changed and why)

### What v5.0 said
- Claim identity must be deterministic hash (Law 3.6).

### What we are ratifying as governing law (v5.1+ reality)
- **ClaimId is a UUIDv4 identity** (stable entity identifier).
- **ClaimFingerprint is deterministic SHA-256** over a canonicalized business tuple and is used **only for de-duplication**, not identity.

### Why this is the correct model
- **Offline-first + retries** require graceful de-dupe and idempotent outcomes.
- **Deterministic “identity”** built from mutable business facts creates governance hazards (rule changes, procedure code corrections, etc.).
- We preserve deterministic physics where it matters (de-dupe) without collapsing identity into derivations.

---

# LAW 3.6 (REPLACED) — CLAIM IDENTITY & DE-DUPLICATION

## LAW 3.6 — CLAIM IDENTITY IS UUIDv4; DEDUPE IS FINGERPRINT (v5.2)

### 3.6.1 ClaimId (Identity)
- **ClaimId MUST be UUIDv4** (or CUID2 where explicitly allowed).
- ClaimId is the **aggregate identity** for Claim events (`aggregate_id = claimId`).
- ClaimId MUST NOT be derived from business data (no deterministic identity hashing for ClaimId).

### 3.6.2 ClaimFingerprint (Deterministic De-Dupe Key)
- **ClaimFingerprint MUST be SHA-256** of a **canonicalized** tuple.
- ClaimFingerprint is used for **duplicate detection only** and MUST NOT be:
  - used as an aggregateId in events
  - used as a foreign key to other aggregates
  - used as a URL/API identifier
  - assumed unique globally (uniqueness is scoped; see 3.6.4)

### 3.6.3 Canonical Fingerprint Input (Single Function)
Implementations MUST define **one** canonicalization function and forbid inline concatenation.

**Canonical input format (normative):**
```
{voucherId}:{clinicId}:{procedureCode}:{dateOfService}:rabies={0|1}
```

**Canonicalization rules (normative):**
- `voucherId`, `clinicId`: lowercase UUID string form
- `procedureCode`: uppercase, trimmed
- `dateOfService`: ISO `YYYY-MM-DD` (no time component)
- `rabies`: `0` or `1` (explicit)

Then compute:
- `ClaimFingerprint = SHA256(utf8(canonicalString))` → 64 hex chars

### 3.6.4 Fingerprint Uniqueness Scope (Atomic)
ClaimFingerprint uniqueness MUST be enforced by an **atomic unique constraint** scoped at minimum by grant cycle and clinic:

**Normative constraint:**
- `UNIQUE (grant_cycle_id, clinic_id, claim_fingerprint)`

(Implementations MAY further scope by program bucket where required, but MUST NOT weaken this minimum scope.)

### 3.6.5 De-Dupe Behavior (Idempotent Outcome)
On receiving a claim submission that produces a fingerprint collision under the uniqueness constraint:

- The system MUST return the **existing ClaimId** (and a duplicate status) rather than failing the operation.
- The system MUST NOT emit a second `CLAIM_SUBMITTED` event for a duplicate fingerprint.

**Normative response shape (illustrative):**
```json
{ "status": "DUPLICATE_DETECTED", "claimId": "<existing-uuidv4>" }
```

### 3.6.6 Audit Evidence
The system MUST store ClaimFingerprint on the claim projection and MUST be able to produce evidence queries showing:
- all claims for a clinic/cycle
- fingerprint collisions (should be zero beyond the single canonical record)
- the ClaimId returned for a given fingerprint

---

# Identity Exceptions Registry (REQUIRED UPDATE)

`docs/IDENTITY_EXCEPTIONS.md` MUST be updated so that:
- **REMOVE** any exception that claims “ClaimId MUST be deterministic hash” (this is no longer governing law).
- **ADD** an explicit entry for ClaimFingerprint:

## ClaimFingerprint (De-Dupe Only)
- **MUST BE:** SHA-256 hex (64 chars)
- **ROLE:** de-duplication key only (NOT identity)
- **FORBIDDEN USES:** aggregateId, foreign key, URL/API identifier

No other identity doctrine changes are introduced by this addendum.

---

# Schema Requirements (Normative)

### Event Log
- `event_log.aggregate_id` remains `UUID` (unchanged).

### Claims Projection (minimum required columns)
- `claim_id UUID PRIMARY KEY`
- `claim_fingerprint VARCHAR(64) NOT NULL`
- `grant_cycle_id UUID NOT NULL`
- `clinic_id UUID NOT NULL`
- plus all other Phase 3 settlement columns as specified

### Required Index/Constraint
- `UNIQUE (grant_cycle_id, clinic_id, claim_fingerprint)`

---

# Conformance Tests (Minimum Additions)

Implementations MUST include tests proving:

1. **Canonicalization stability**
   - formatting variants (uuid case, whitespace, procedure code case) → same fingerprint

2. **Atomic de-dupe under concurrency**
   - concurrent identical submissions → only one `CLAIM_SUBMITTED` event
   - second request returns existing ClaimId with `DUPLICATE_DETECTED`

3. **Fingerprint non-identity**
   - attempts to use fingerprint as aggregateId fail schema/type checks (lint or compile-time guard)

---

# Adoption Note

This addendum is adopted specifically to eliminate ambiguity during Phase 4 (export/closeout) where auditors require:
- stable identifiers (ClaimId)
- deterministic de-duplication physics (ClaimFingerprint)
- reproducible, watermark-frozen selection logic

**END OF ADDENDUM v5.2**
