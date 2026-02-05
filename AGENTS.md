# AGENTS.md - WVSNP APPLICATION (WVSNP-GMS)
## Canonical Execution Law for AI Agents + Humans
**Status:** REQUIRED  
**Source of Truth:** `WVSNP-GMS-Specification-v4.5 (1).md` (treat as read-only)

---

# 0) PRIME DIRECTIVE
This repository implements an **event-sourced**, **append-only**, **audit-grade** grant management system.
**Domain truth lives ONLY in the event log.** All other tables are projections and may be rebuilt at any time.

Agents MUST follow the spec exactly. If the spec is ambiguous, **fail closed** and stop with an explicit error.

---

# 1) DOCTRINES (NON-NEGOTIABLE)

## 1.1 Chronology Doctrine (Dual Time)
- **occurredAt** = client/business truth (may be offline, may be skewed)
- **ingestedAt** = server truth (authoritative ordering for enforcement)
- NEVER use `createdAt/updatedAt` for domain logic. If they exist, they are non-domain metadata only.

## 1.2 Identity Doctrine
- No auto-increment IDs (no BIGSERIAL, no integer PKs).
- IDs are **client-generated** for offline safety.
- Use **UUIDv7** for event_id only (approved exception, see docs/IDENTITY_EXCEPTIONS.md).
- Use **UUIDv4** for all aggregate IDs (grantId, voucherId, claimId, etc.).
- Deterministic hash IDs (SHA-256) only for approved exceptions (allocatorId, claimFingerprint).
- See `docs/IDENTITY_EXCEPTIONS.md` for complete exception registry.

## 1.3 Namespace Doctrine
- Event names are **SCREAMING_SNAKE_CASE** only.
- Never invent dotted names or alternate conventions.

## 1.4 Immutability Doctrine
- Canonical tables are **append-only**.
- No UPDATE/DELETE of domain truth. Corrections are new events.

## 1.5 Money Doctrine
- Money is **integer cents** in storage and domain.
- Domain computation uses **BigInt** only (branded MoneyCents).
- No float math. No JS `number` for cents in domain logic.

## 1.6 Context Doctrine
Every event MUST include:
- `grantCycleId`
- `correlationId`
- `causationId` (nullable only for root)
- `actorId`
- `actorType`
Never emit canonical domain events from client UI.

---

# 2) SPEC AUTHORITY + CHANGE CONTROL
- The spec file is canonical. Treat it as read-only.
- If implementation reveals an ambiguity:
  1) Stop
  2) Write a short "Ambiguity Report" in `/docs/ambiguities/YYYY-MM-DD.md`
  3) Propose an amendment (do not silently decide)

---

# 3) PHASE DISCIPLINE
The system is implemented in phases. Do NOT implement later phases early.

## Phase 1 (Kernel)
Required deliverables:
- Event Log schema + immutability enforcement
- Artifact Log schema + immutability enforcement
- Append API with server-stamped `ingestedAt`
- Pagination/watermark rule: (ingested_at, event_id) tuple ordering, **exclusive** watermark fetch
- Deterministic replay/rebuild of projections (with rebuild metadata)

## Phase 2+ (Operational Kernel / Money Engine)
NOT permitted until Phase 1 passes conformance.

---

# 4) CONFORMANCE (FAIL-CLOSED)
Each phase MUST include a checklist with evidence:
- schema statements
- indexes
- trigger definitions
- sample append + replay proof
- pagination proof (no skip/duplicate)

If any item is missing, phase is not complete.

---

# 5) SECURITY MINIMUMS
- Submission tokens (if present) must be: signed, bound, one-time use, and consumed.
- Never trust client clocks for deadline enforcement.
- Server enforces deadlines using `ingestedAt`.

---

# 6) PROHIBITED BEHAVIORS
- CRUD tables as source of truth
- "Just update the row"
- trusting client time for ordering/deadlines
- generating canonical events from UI
- storing money as float/decimal in domain logic
- inventing new event types beyond the spec

---

# 7) WORKFLOW FOR AGENTS
1) Read spec
2) Implement Phase 1 only
3) Add Phase 1 conformance evidence
4) Stop and report status
