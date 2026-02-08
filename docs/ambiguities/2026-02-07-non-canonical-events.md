# Ambiguity Report: Non-Canonical Event Types in Implementation
**Date:** 2026-02-07  
**Reporter:** Proveniq Prime  
**Status:** RESOLUTION REQUIRED  
**Spec Authority:** `WVSNP_MASTER_SPEC_v5.0.md` Part III: Event Catalog

---

## Ambiguity 1: `APPLICATION_EVIDENCE_ATTACHED`

### Finding
The implementation emits `APPLICATION_EVIDENCE_ATTACHED` in:
- `src/application/application-service.ts:177`
- `src/domain/application/application-logic.ts:68`

### Spec Says
The Event Catalog (Part III) lists these Application Events:
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

`APPLICATION_EVIDENCE_ATTACHED` is NOT in this list.

However, the rebuild allowlist in `src/projections/rebuild.ts` includes `ATTACHMENT_ADDED` which appears to serve the same purpose.

### Proposed Amendment
**Rename `APPLICATION_EVIDENCE_ATTACHED` → `ATTACHMENT_ADDED`** to align with the existing rebuild allowlist. `ATTACHMENT_ADDED` is already recognized by the projection rebuild pipeline and semantically equivalent.

### Impact
- If `APPLICATION_EVIDENCE_ATTACHED` events already exist in a production event_log, they are permanent (immutable). The rebuild pipeline must handle both event names during a transition period.
- New code should emit only `ATTACHMENT_ADDED`.

---

## Ambiguity 2: `FRAUD_SIGNAL_DETECTED`

### Finding
The implementation emits `FRAUD_SIGNAL_DETECTED` in:
- `src/application/application-service.ts:313`
- `src/domain/application/application-logic.ts:95`

### Spec Says
`FRAUD_SIGNAL_DETECTED` is NOT in the Event Catalog (Part III). No fraud-related events are defined in the spec.

### Analysis
Fraud signals are **advisory only** — they do not block submission and do not change application state transitions. They are metadata annotations, not domain state changes.

Writing advisory metadata to the canonical event_log has implications:
1. It inflates the event stream with non-domain events
2. It creates ordering dependencies where none should exist
3. It violates AGENTS.md §6: "inventing new event types beyond the spec"

### Proposed Amendment (Two Options)

**Option A (RECOMMENDED): Add to Spec**
Add `FRAUD_SIGNAL_DETECTED` to the Application Events catalog as an advisory event:
```
FRAUD_SIGNAL_DETECTED  { applicationId, signalCode, severity, evidence, recommendedAction }
```
This is the simplest path since the event is already in production code and the event_log is immutable.

**Option B: Move to Advisory Table**
Create a separate `fraud_signals` operational table (not event_log) for advisory signals. This keeps the canonical event stream clean but requires refactoring.

### Recommendation
**Option A** — add to spec. The event is already emitted, the event_log is immutable, and the signal is legitimately associated with the application aggregate lifecycle.

---

## Required Actions

1. Spec owner must approve one option for each ambiguity
2. If Option A for both: update `WVSNP_MASTER_SPEC_v5.0.md` Part III Event Catalog
3. Implementation must be updated to match the approved resolution
4. Rebuild pipeline must handle any legacy event names

**END OF AMBIGUITY REPORT**
