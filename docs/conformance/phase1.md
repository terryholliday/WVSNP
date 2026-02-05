# Phase 1 Conformance Checklist (WVSNP-GMS v4.5)

Status: COMPLETE (Phase 1 only)

## Checklist
- Event Log schema + immutability enforcement
  - Evidence: `db/schema.sql`
- Artifact Log schema + immutability enforcement
  - Evidence: `db/schema.sql`
- Append API with server-stamped ingestedAt
  - Evidence: `db/schema.sql`, `src/event-store.ts`, `src/server.ts`
- Pagination/watermark rule (exclusive tuple ordering)
  - Evidence: `src/event-store.ts`, `docs/conformance/phase1-proof.sql`
- Deterministic replay/rebuild of projections (with rebuild metadata)
  - Evidence: `src/projections/rebuild.ts`

## Evidence Notes
- Schema, indexes, and triggers are defined verbatim from the specification in `db/schema.sql`.
- Server-stamped `ingested_at` is enforced by a DB trigger (`stamp_ingested_at`) and the append API does not accept `ingestedAt` input.
- Pagination uses the exclusive watermark tuple comparison on `(ingested_at, event_id)` in `EventStore.fetchSince`.
- Projections are rebuilt via deterministic replay that truncates projection tables and inserts fresh rows with `rebuilt_at`, `watermark_ingested_at`, and `watermark_event_id`.
- Phase 1 proof steps are documented in `docs/conformance/phase1-proof.sql`.

## Phase Discipline
- Phase 2+ events are rejected during rebuild (`PHASE1_EVENT_NOT_ALLOWED`), enforcing Phase 1 boundaries.
