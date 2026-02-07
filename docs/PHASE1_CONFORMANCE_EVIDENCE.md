# WVSNP-GMS Phase 1 Kernel — Conformance Evidence

**Date:** 2026-02-07  
**Spec Authority:** `WVSNP_MASTER_SPEC_v5.0.md` (read-only)  
**AGENTS.md §4:** FAIL-CLOSED — every item requires artifact evidence.

---

## Checklist (per AGENTS.md §4)

| # | Requirement | Evidence | Status |
|---|-------------|----------|--------|
| 1 | Schema statements | `db/schema.sql` lines 11–33 (event_log), 96–112 (artifact_log) | ✅ |
| 2 | Indexes | `db/schema.sql` lines 36–53 (3 indexes) | ✅ |
| 3 | Trigger: stamp_ingested_at | `db/schema.sql` lines 58–69 | ✅ |
| 4 | Trigger: prevent_event_mutation | `db/schema.sql` lines 74–84 | ✅ |
| 5 | Trigger: prevent_artifact_mutation | `db/schema.sql` lines 86–117 | ✅ |
| 6 | Append API (server-stamped ingestedAt) | `src/event-store.ts` EventStore.append() | ✅ |
| 7 | Pagination (exclusive watermark tuple) | `src/event-store.ts` EventStore.fetchSince() | ✅ |
| 8 | Deterministic replay/rebuild | `src/projections/rebuild.ts` rebuildAllProjections() | ✅ |
| 9 | Rebuild metadata | `src/projections/rebuild.ts` RebuildResult interface | ✅ |
| 10 | Conformance test suite | `tests/phase1-kernel-conformance.test.ts` (10 sections, 30+ tests) | ✅ |

---

## 1. Event Log Schema (LAW 0)

**File:** `db/schema.sql` lines 11–33

```sql
CREATE TABLE IF NOT EXISTS event_log (
  event_id UUID PRIMARY KEY,              -- LAW 0.5: Single PK, LAW 0.10: UUIDv7
  aggregate_type VARCHAR(50) NOT NULL,
  aggregate_id UUID NOT NULL,             -- LAW 3.1: UUIDv4
  event_type VARCHAR(100) NOT NULL,       -- LAW 1.3 Namespace: SCREAMING_SNAKE_CASE
  event_data JSONB NOT NULL,              -- LAW 0.9: JSONB with string-encoded money
  occurred_at TIMESTAMPTZ NOT NULL,       -- LAW 4.1: Client/business truth
  ingested_at TIMESTAMPTZ NOT NULL,       -- LAW 4.1: Server truth (trigger-stamped)
  grant_cycle_id VARCHAR(20) NOT NULL,    -- LAW 6.1: Context
  correlation_id UUID NOT NULL,           -- LAW 6.1: Traceability
  causation_id UUID,                      -- LAW 6.1: Nullable for root events
  actor_id UUID NOT NULL,                 -- LAW 6.1: Actor
  actor_type VARCHAR(20) NOT NULL         -- LAW 6.1: Actor type
);
```

**Doctrine compliance:**
- No `createdAt` / `updatedAt` columns (LAW 4.5)
- No auto-increment / SERIAL columns (LAW 3.4)
- `event_id` is UUID (UUIDv7 enforced at application layer)
- `aggregate_id` is UUID (UUIDv4 generated client-side)

---

## 2. Indexes (LAW 0.4 + 0.7)

**File:** `db/schema.sql` lines 36–53

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_event_log_order` | `(ingested_at ASC, event_id ASC)` | LAW 0.4: Tuple ordering |
| `idx_event_log_aggregate` | `(aggregate_type, aggregate_id, ingested_at ASC, event_id ASC)` | Aggregate stream replay |
| `idx_event_log_correlation` | `(correlation_id)` | LAW 6.1: Correlation trace |

---

## 3. Triggers

### 3a. Server-Stamped ingested_at (LAW 0.8 + 0.11)

**File:** `db/schema.sql` lines 58–69

```sql
CREATE OR REPLACE FUNCTION stamp_ingested_at()
RETURNS trigger AS $$
BEGIN
  NEW.ingested_at := clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_log_stamp_ingested_at
BEFORE INSERT ON event_log
FOR EACH ROW EXECUTE FUNCTION stamp_ingested_at();
```

**Evidence:** Test `ingested_at is server-stamped via clock_timestamp()` proves client-provided value is overwritten.

### 3b. Event Log Immutability (LAW 0.3 + 0.6)

**File:** `db/schema.sql` lines 74–84

```sql
CREATE OR REPLACE FUNCTION prevent_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'event_log is immutable: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_event_log_immutable
BEFORE UPDATE OR DELETE ON event_log
FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();
```

**Evidence:** Tests `event_log UPDATE is blocked` and `event_log DELETE is blocked` confirm trigger fires.

### 3c. Artifact Log Immutability

**File:** `db/schema.sql` lines 86–117

```sql
CREATE TRIGGER artifact_log_immutable
BEFORE UPDATE OR DELETE ON artifact_log
FOR EACH ROW EXECUTE FUNCTION prevent_artifact_mutation();
```

**Evidence:** Tests `artifact_log UPDATE is blocked` and `artifact_log DELETE is blocked` confirm trigger fires.

---

## 4. Append API

**File:** `src/event-store.ts` — `EventStore.append()`

- Validates `event_id` is UUIDv7 via regex (LAW 0.10)
- Validates no BigInt values in `eventData` (LAW 0.9: string encoding)
- Rejects client-provided `ingestedAt` (server stamps via `clock_timestamp()`)
- Returns the appended event with server-stamped `ingestedAt`

**HTTP Endpoint:** `POST /events` in `src/server.ts`

- Validates SCREAMING_SNAKE_CASE event type
- Validates all required context fields (grantCycleId, correlationId, actorId, actorType)
- Rejects `ingestedAt` in request body (`INGESTED_AT_FORBIDDEN`)
- Returns 201 with appended event

---

## 5. Pagination / Watermark (LAW 0.7)

**File:** `src/event-store.ts` — `EventStore.fetchSince()`

```sql
WHERE (ingested_at > $1) OR (ingested_at = $1 AND event_id > $2)
ORDER BY ingested_at ASC, event_id ASC
LIMIT $3
```

**Watermark contract:**
- `Watermark.ZERO` = `{ ingestedAt: 1970-01-01, eventId: 00000000-... }` — fetches from genesis
- Exclusive comparison: the watermark event itself is never re-fetched
- Tuple ordering ensures no skip/duplicate even with identical `ingested_at` timestamps

**HTTP Endpoint:** `POST /events/query` in `src/server.ts`

**Evidence:** Test section `5. Pagination Proof` verifies:
- 5 events paginated in batches of 2 → all 5 recovered, zero duplicates, zero skips
- Watermark at exact boundary returns 0 results (exclusive)
- ZERO watermark fetches all events from genesis

---

## 6. Deterministic Replay / Rebuild

**File:** `src/projections/rebuild.ts` — `rebuildAllProjections()`

1. Fetches all events from genesis using `Watermark.ZERO`
2. Pages through in batches of 1000 using exclusive watermark
3. Applies each event to in-memory state (Phase 1 event whitelist enforced)
4. Truncates projection tables in a transaction
5. Inserts rebuilt projections with watermark metadata
6. Returns `RebuildResult` with:
   - `rebuiltAt` — ISO timestamp of rebuild
   - `eventsReplayed` — total event count
   - `projectionsRebuilt` — list of rebuilt tables
   - `watermark` — final `{ ingestedAt, eventId }` tuple

**HTTP Endpoint:** `POST /events/rebuild` in `src/server.ts`

**Rebuild metadata columns** on `applications_projection`:
- `rebuilt_at TIMESTAMPTZ NOT NULL`
- `watermark_ingested_at TIMESTAMPTZ NOT NULL`
- `watermark_event_id UUID NOT NULL`

---

## 7. Identity Doctrine (LAW 3)

| Scope | Type | Generator | File |
|-------|------|-----------|------|
| `event_id` | UUIDv7 | `EventStore.newEventId()` → `uuidv7()` | `src/uuidv7.ts` |
| Aggregate IDs | UUIDv4 | `crypto.randomUUID()` | `src/domain-types.ts` |
| `allocatorId` | SHA-256 hash → UUID format | `Allocator.createId()` | `src/domain-types.ts` |
| `claimFingerprint` | SHA-256 hash (64 hex) | `Claim.createFingerprint()` | `src/domain-types.ts` |

**Approved exceptions:** See `docs/IDENTITY_EXCEPTIONS.md`

---

## 8. Test Suite

**File:** `tests/phase1-kernel-conformance.test.ts`

| Section | Tests | What It Proves |
|---------|-------|----------------|
| 1. Schema Statements | 5 | Correct columns, types, PK, no auto-increment |
| 2. Indexes | 3 | All required indexes exist |
| 3. Trigger Definitions | 7 | ingested_at stamping, immutability on event_log + artifact_log |
| 4. Append + Replay | 6 | Append returns ingestedAt, UUIDv7 validation, JSONB round-trip, causation chain, deterministic replay |
| 5. Pagination Proof | 3 | No skip/duplicate, exclusive watermark, ZERO watermark |
| 6. Identity Doctrine | 4 | UUIDv7/v4 format validation, column types |
| 7. Context Doctrine | 5 | NOT NULL constraints on required context fields |
| 8. Event Namespace | 2 | SCREAMING_SNAKE_CASE enforcement |
| 9. Projection Naming | 2 | *_projection suffix, no *_writemodel |
| 10. Chronology Doctrine | 2 | Dual time independence, no createdAt/updatedAt |

**Run command:**
```bash
npm run e2e:db:up
psql -h localhost -p 5433 -U postgres -d wvsnp_test -f db/schema.sql
npx jest --testPathPattern phase1-kernel-conformance
```

---

## Verdict

**Phase 1 Kernel: COMPLETE**

All AGENTS.md §4 conformance items have artifact evidence:
- ✅ Schema statements
- ✅ Indexes
- ✅ Trigger definitions
- ✅ Sample append + replay proof
- ✅ Pagination proof (no skip/duplicate)

Phase 2+ implementation is now permitted per AGENTS.md §3.
