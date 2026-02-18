# BARK/BITE DUEL Build Package
## Codex 5.3 — Parallel Agent Edition
### PROVENIQ Foundation · barkwv.org
**Status:** Canonical · Ready for DUEL Execution

---

## HOW TO USE THIS DOCUMENT

This package is structured for **4 parallel agents** running simultaneously. Each agent has a self-contained scope, a defined set of outputs, and explicit **boundary contracts** — the data it produces for other agents and the data it consumes from them. No agent can drift into another's territory.

Paste the **Universal Preamble** into every agent prompt first. Then paste the agent's own section. That's it.

---

# UNIVERSAL PREAMBLE
## Paste this into EVERY agent before their specific instructions

```
SUBSTRATE: Codex 5.3
DOMAIN: barkwv.org (BARK Act / BITE Fund — West Virginia statutory compliance platform)
FUTURE ALIAS: *.wv.gov (all paths must support domain aliasing without breaking QR links)

=== FAIL-CLOSED CANONICAL INVARIANTS ===
Violating any of these is a blocking error. Do not guess. Do not "helpfully" diverge.
Create a TODO ticket and block the merge if policy is ambiguous.

1. EVENT SOURCING ONLY
   - No SQL UPDATE or DELETE as source of truth.
   - State is derived projections only. The event log IS the truth.

2. DUAL-TIME (mandatory on every event)
   - occurredAt = client/business truth (what time it happened in real life)
   - ingestedAt = server-stamped (set at ingest; client value ignored and overwritten)
   - Never use createdAt or updatedAt for business logic.
   - Never use client clocks for ordering.

3. ID POLICY
   - PRIMARY: CUID2 for all IDs (shorter, URL-safe, client-generatable for offline)
   - ALLOWED: UUIDv4 ONLY for legacy system interoperability, and only when explicitly documented
   - NEVER: integer auto-increment, never mixed within a bounded context
   - Generate IDs client-side so offline workflows can create records before sync

4. UNIVERSAL BARK EVENT ENVELOPE (required on every event, zero exceptions)
   Every event payload must extend this envelope. Ingest REJECTS any event missing any field.

   {
     eventId:        EventId          // CUID2, client-generated
     eventType:      BarkEventType    // SCREAMING_SNAKE_CASE, from approved catalog
     occurredAt:     string           // ISO8601 — client business truth
     ingestedAt:     string           // ISO8601 — server stamps this; client value overwritten
     orgId:          OrgId            // WVDA umbrella org — always required
     countyId:       CountyId | null  // Required field; null if not county-scoped
     agencyId:       AgencyId | null  // Required field; null if not agency-scoped
     correlationId:  CorrelationId    // CUID2 — same across entire causal chain
     causationId:    CausationId      // CUID2 — eventId of direct cause; ROOT_CAUSE if origin
     actorId:        ActorId          // CUID2 — who triggered this
     actorRole:      ActorRole        // enum (see below)
     subjectType:    SubjectType      // enum — what this event is about
     subjectId:      SubjectId        // branded ID matching subjectType
     schemaVersion:  number           // bump on breaking payload changes
     idempotencyKey: string | null    // optional deterministic retry key
   }

   ActorRole enum:
     WVDA_ADMIN | COUNTY_OFFICER | INSPECTOR | BREEDER | TRANSPORTER | MARKETPLACE | SYSTEM

5. EVENT NOMENCLATURE
   - SCREAMING_SNAKE_CASE only (e.g. IMPOUND_INTAKE_RECORDED)
   - No dot-notation, no PascalCase, no camelCase for event types

6. IMMUTABILITY
   - Corrections are NEW events: *_AMENDED, *_VOIDED, *_CORRECTED
   - Never overwrite. Never soft-delete core domain records.
   - Retention policies use archival STATE TRANSITIONS, not destructive deletes.

7. EVENTS TABLE SCHEMA LOCK
   - Migrations MUST NOT alter events table columns, types, or names.
   - Allowed migrations: new projection tables, new projection columns, new indexes.
   - Any PR touching events table schema is auto-rejected.

8. BRANDED TYPES — import from @bark/domain (see Agent A outputs)
   - Never use raw string for any ID field.
   - All ID constructors use CUID2.

9. PUBLIC vs RESTRICTED FIELDS
   - Enforce at projection/query layer.
   - Public endpoints must never expose restricted fields.
   - Media access: expiring signed URLs only. Storage keys must not be enumerable.

10. CAUSATION PROTOCOL
    - causationId = eventId of the direct upstream event that caused this one
    - correlationId = unchanged across the entire causal chain
    - Origin events: causationId = ROOT_CAUSE (typed constant, not null, not self-reference)

11. QR PERMANENCE CONTRACT
    - Path schema: verify.barkwv.org/v1/l/{licenseId}
    - This path NEVER changes. Domain aliases may change. Redirect targets may change.
    - v1 path is frozen for the lifetime of the system.
    - Tokens: HMAC over (licenseId | expiresOn | issuerKeyId)

12. OFFLINE CONFLICT RESOLUTION
    - Never overwrite on sync collision.
    - Preserve both event streams.
    - Emit DUPLICATE_REVIEW_FLAGGED when collision heuristics match (same chip + same time window)
    - Emit IMPOUND_RECORD_LINKED to indicate records refer to same case
    - IMPOUND_RECORD_SUPERSEDED only via human review event — never automatic

13. LOCATION FUZZING
    - Do NOT round to 2 decimal places (that is ~1.1 km, too precise or too coarse depending on policy)
    - Use grid-snapping to ~0.25 miles (≈ 402 meters)
    - Snap to 0.0036 degrees latitude; longitude snap = 0.0036 / cos(lat_radians)
    - Method must be deterministic and documented in code comments

14. EVIDENCE BUNDLE INTEGRITY
    - Canonical format: manifest.json (machine-grade)
    - Optional: manifest.pdf (human-readable for court)
    - bundleHash = SHA256( canonical_json(manifest) ) with entries sorted deterministically
    - bundleHash included in the sealing event payload

=== PR CONFORMANCE CHECKLIST ===
Every PR must pass ALL of these before merge:
  □ All events extend BARK_EVENT_ENVELOPE (no exceptions)
  □ occurredAt + ingestedAt present on every event
  □ All ID fields use @bark/domain branded types (zero raw strings)
  □ CUID2 used for all new IDs (UUIDv4 only if explicitly documented for legacy)
  □ SCREAMING_SNAKE_CASE event names only
  □ orgId, countyId, agencyId, correlationId, causationId, actorId, actorRole all present
  □ causationId = ROOT_CAUSE for origin events (not null, not self-reference)
  □ Public endpoints expose zero restricted fields (verified by security test)
  □ Media served via expiring signed URLs only
  □ No migration touches events table schema
  □ Offline sync: no overwrite, DUPLICATE_REVIEW_FLAGGED emitted on collision
  □ Location fuzzing uses grid-snap method (not decimal rounding)
  □ Evidence bundles include manifest.json + bundleHash
  □ Acceptance tests pass + security tests pass
  □ Alias-domain plan documented (barkwv.org → *.wv.gov without breaking QR paths)
```

---

# AGENT A — FOUNDATION LAYER
## Scope: @bark/domain · BARK_EVENT_ENVELOPE · Ingest Gate · W8 Security/Audit

**Runs first (or in parallel with others if others import mock types until A ships)**
**All other agents depend on A's outputs.**

### Boundary Contract — Agent A PRODUCES:
- `@bark/domain` npm package (branded types + CUID2 constructors)
- `BARK_EVENT_ENVELOPE` Zod schema + TypeScript type
- Ingest gate middleware (validates envelope, stamps ingestedAt, rejects on missing fields)
- RBAC scope model
- Audit log service (correlationId thread tracing)

### Boundary Contract — Agent A CONSUMES:
- Nothing. Agent A is the foundation.

---

### W8: Security, Privacy & Audit Harness

**Purpose:** Cross-cutting. Every other workstream plugs into these services.

**RBAC Scope Model:**

| Role | Scope Token | Access Level |
|------|-------------|--------------|
| Public (anonymous) | `bark:public` | Registry search, license verify, impound feed |
| County Officer | `bark:county` | Impound intake, microchip workflow, compliance clock |
| Inspector | `bark:inspector` | Evidence capture, inspection workflows, corrective orders |
| Breeder | `bark:breeder` | Own filings, own license status |
| Transporter | `bark:transporter` | Own manifests, sensor log uploads |
| Marketplace Partner | `bark:marketplace` | Batch verify, logs export, outage records |
| WVDA Admin | `bark:wvda` | All of the above + license lifecycle + fund reports |
| System | `bark:system` | Internal service-to-service only |

**PII Minimization Rules:**
- Public projections: no personal names, no addresses, no phone numbers
- County projections: name + contact allowed for operational use
- WVDA only: full PII access
- Redaction rules defined as projection-layer filters, not data deletion

**Media Access:**
- All photos/videos/documents served via expiring signed URLs (expiry: 15 minutes default)
- Storage keys must be non-enumerable (use CUID2-based paths, not sequential)
- No direct storage bucket access from public endpoints

**Audit Log Service:**
- Every ingest call logged with: eventId, correlationId, causationId, actorId, actorRole, endpoint, timestamp
- Audit log is append-only (separate from domain event log)
- Audit log queryable by correlationId to trace full causal chains

**Breach Response Workflow:**
- `SECURITY_BREACH_DETECTED` event (SYSTEM actor)
- `BREACH_NOTIFICATION_ISSUED` event (WVDA_ADMIN actor)
- 10-day notification policy tracked as compliance clock

**Acceptance Tests:**
```
□ Unauthorized role cannot access restricted projection fields
□ Public endpoint returns zero restricted fields (automated field-by-field assertion)
□ Media URLs expire and return 403 after expiry
□ Storage key enumeration attack returns no valid URLs
□ correlationId traces correctly through 3-hop causal chain in audit log
□ Missing envelope field at ingest returns 400 with field name in error body
□ ingestedAt on returned event never matches client-submitted value (server always overwrites)
```

---

### @bark/domain Package Specification

```typescript
// @bark/domain/ids.ts
// All constructors use CUID2

type Brand<T, B> = T & { readonly __brand: B };

// Tenancy & Context
export type OrgId            = Brand<string, 'OrgId'>;
export type CountyId         = Brand<string, 'CountyId'>;
export type AgencyId         = Brand<string, 'AgencyId'>;

// Actors
export type ActorId          = Brand<string, 'ActorId'>;

// Causality
export type EventId          = Brand<string, 'EventId'>;
export type CorrelationId    = Brand<string, 'CorrelationId'>;
export type CausationId      = Brand<string, 'CausationId'>;
export const ROOT_CAUSE      = 'ROOT_CAUSE' as const satisfies string;

// Domain Subjects
export type LicenseId              = Brand<string, 'LicenseId'>;
export type InspectionId           = Brand<string, 'InspectionId'>;
export type EvidenceItemId         = Brand<string, 'EvidenceItemId'>;
export type ManifestId             = Brand<string, 'ManifestId'>;
export type ImpoundRecordId        = Brand<string, 'ImpoundRecordId'>;
export type MarketplacePartnerId   = Brand<string, 'MarketplacePartnerId'>;
export type TrainingModuleId       = Brand<string, 'TrainingModuleId'>;
export type CertificateId          = Brand<string, 'CertificateId'>;
export type FundTransactionId      = Brand<string, 'FundTransactionId'>;
export type BreederId              = Brand<string, 'BreederId'>;
export type TransporterId          = Brand<string, 'TransporterId'>;
export type InspectorId            = Brand<string, 'InspectorId'>;

// SubjectType enum (controls which branded ID is valid as subjectId)
export type SubjectType =
  | 'LICENSE' | 'IMPOUND_RECORD' | 'INSPECTION' | 'EVIDENCE_ITEM'
  | 'FUND_TRANSACTION' | 'TRAINING_MODULE' | 'CERTIFICATE' | 'MANIFEST'
  | 'MARKETPLACE_PARTNER' | 'BREEDER' | 'TRANSPORTER';

// ActorRole enum
export type ActorRole =
  | 'WVDA_ADMIN' | 'COUNTY_OFFICER' | 'INSPECTOR'
  | 'BREEDER' | 'TRANSPORTER' | 'MARKETPLACE' | 'SYSTEM';

// Constructors — always CUID2
import { createId } from '@paralleldrive/cuid2';
export const newOrgId             = (): OrgId             => createId() as OrgId;
export const newCountyId          = (): CountyId          => createId() as CountyId;
export const newLicenseId         = (): LicenseId         => createId() as LicenseId;
export const newInspectionId      = (): InspectionId      => createId() as InspectionId;
export const newEvidenceItemId    = (): EvidenceItemId    => createId() as EvidenceItemId;
export const newImpoundRecordId   = (): ImpoundRecordId   => createId() as ImpoundRecordId;
export const newEventId           = (): EventId           => createId() as EventId;
export const newCorrelationId     = (): CorrelationId     => createId() as CorrelationId;
// ... repeat pattern for all types
```

---

### Agent A Execution Pack (Build + Self-Check)

Use this section as the operational handoff contract for Agent A implementation.

#### A1) Required Deliverables (must all exist)

- `packages/bark-domain/src/ids.ts`
  - Branded ID types + CUID2 constructors for every ID listed above
- `packages/bark-domain/src/events.ts`
  - `BARK_EVENT_ENVELOPE` Zod schema
  - `BarkEventEnvelope` TypeScript type via `z.infer`
- `src/api/middleware/ingest-gate.ts`
  - Envelope validation
  - `ingestedAt` overwrite on server
  - Fail-closed 400 on missing/invalid envelope field
- `src/api/middleware/rbac.ts`
  - Scope-token enforcement for `bark:*` model
  - Public field redaction hooks for projection handlers
- `src/services/audit-log-service.ts`
  - Append-only ingest audit rows
  - Query by `correlationId` with ordered causal chain

#### A2) Required Tests (artifact evidence)

- `tests/agent-a/ingest-gate.test.ts`
  - Missing required envelope field returns 400 + field name
  - Client-sent `ingestedAt` is ignored/overwritten
- `tests/agent-a/rbac.test.ts`
  - Restricted fields blocked for unauthorized scopes
  - Public projections return zero restricted fields
- `tests/agent-a/audit-log.test.ts`
  - 3-hop `correlationId` chain is queryable in causal order
  - Audit log remains append-only
- `tests/agent-a/media-signed-url.test.ts`
  - URL expires at configured TTL
  - Enumeration attempts do not produce valid objects

#### A3) Handoff Gate (Agent A cannot declare done until all pass)

```text
[ ] @bark/domain package builds and exports branded types + constructors
[ ] BARK_EVENT_ENVELOPE validates all required fields in canonical order
[ ] Ingest gate stamps server ingestedAt and rejects malformed envelope input
[ ] RBAC enforces bark:public / bark:county / bark:inspector / bark:wvda boundaries
[ ] Audit log writes are append-only and correlationId query works end-to-end
[ ] All Agent A tests pass in CI
[ ] Conformance evidence doc updated with file pointers + test output
```

#### A4) Self-Check Commands

```bash
# 1) Type/lint check (fail closed)
pnpm -r typecheck && pnpm -r lint

# 2) Agent A scoped tests
pnpm test tests/agent-a

# 3) Conformance proof capture
pnpm test -- --reporter=default --reporter=junit
```

If any command fails, Agent A status is BLOCKED and handoff to Agents B/C/D is not allowed.

---

# AGENT B — PUBLIC COMPLIANCE SURFACE
## Scope: W1 (Registry + Verify + QR + API) · W2 (Transparency Hub)

**Depends on:** Agent A outputs (@bark/domain, envelope, RBAC)
**Produces for others:** License status projections (consumed by W6, W9, W10)

### Boundary Contract — Agent B PRODUCES:
- Public license registry read models
- `LICENSE_VERIFICATION_PERFORMED` event stream (consumed by W6 for safe-harbor logs)
- `DASHBOARD_SNAPSHOT_PUBLISHED` events (consumed by W10 for grant reporting)
- Stable QR verification URLs at `verify.barkwv.org/v1/l/{licenseId}`

### Boundary Contract — Agent B CONSUMES:
- `@bark/domain` from Agent A
- `BARK_EVENT_ENVELOPE` from Agent A
- RBAC scope tokens from Agent A (bark:public, bark:wvda)

---

### W1: Registry + Verify + QR + Public API

**Subdomains:** `verify.barkwv.org`, `registry.barkwv.org`, `api.barkwv.org`, `docs.barkwv.org`

**Event Catalog — W1:**
```
BREEDER_LICENSED
BREEDER_LICENSE_RENEWED
BREEDER_LICENSE_STATUS_CHANGED    // payload: previousStatus, newStatus, reason
TRANSPORTER_LICENSED
TRANSPORTER_LICENSE_RENEWED
TRANSPORTER_LICENSE_STATUS_CHANGED
LICENSE_VERIFICATION_PERFORMED    // log every check — human + machine + batch
LICENSE_VERIFICATION_TOKEN_ISSUED
```

**License Status Lifecycle:**
```
PENDING_REVIEW → ACTIVE → EXPIRED (auto on date)
                        → SUSPENDED (admin action, reversible)
                        → REVOKED (admin action, permanent)
```

**Public Registry Projection (bark:public fields only):**
```
licenseId, licenseNumber, licenseType (BREEDER|TRANSPORTER),
status, county, activeFrom, expiresOn,
inspectionGrade (A/B/C/F or PENDING),
enforcementActions (count only — no details at public level)
```
No PII. No personal names. No addresses.

**QR + Verification API:**

```
GET verify.barkwv.org/v1/l/{licenseId}
  → Human-readable license status page
  → Machine-readable: Accept: application/json

GET api.barkwv.org/v1/verify/{licenseId}
  → Single license verify
  → Returns: status, validUntil, signedToken

POST api.barkwv.org/v1/verify/batch
  → Up to 100 licenseIds per request
  → Rate limit: 1000/hour per partner key
  → Emits: MARKETPLACE_BATCH_VERIFICATION_PERFORMED (W6 event, causedBy this request)

Signed Token Format:
  HMAC-SHA256( licenseId + "|" + expiresOn + "|" + issuerKeyId )
  Token verified on verify.* without database lookup (anti-spoof)
```

**Anti-Abuse:**
- Public verify endpoints: 60 req/min per IP
- Registry search: 30 req/min per IP
- WAF rules for enumeration patterns
- Bot detection on verify.* and registry.*

**Acceptance Tests — W1:**
```
□ QR URL verify.barkwv.org/v1/l/{id} resolves for valid licenseId
□ Signed token cannot be forged (tampered token returns 401)
□ Batch verify returns correct status for 100 mixed valid/invalid IDs
□ Every verify call produces LICENSE_VERIFICATION_PERFORMED event with correlationId
□ Public projection contains zero PII fields
□ Suspended license returns SUSPENDED status (not ACTIVE) within 1 minute of status change
□ QR URL resolves correctly when accessed via *.wv.gov alias
□ Rate limit triggers at threshold and returns 429
```

---

### W2: Transparency Hub

**Subdomain:** `data.barkwv.org`

**Event Catalog — W2:**
```
DASHBOARD_SNAPSHOT_PUBLISHED
CSV_EXPORT_PUBLISHED
CAPACITY_WORKBOOK_PUBLISHED
TRANSPARENCY_ARTIFACT_HASH_ANCHORED   // immutable hash record for each publication
```

**Transparency Artifact Registry:**
Every published artifact (dashboard snapshot, CSV, workbook) gets:
- Immutable `artifactId` (CUID2)
- `contentHash` (SHA256 of content at publish time)
- `TRANSPARENCY_ARTIFACT_HASH_ANCHORED` event (makes the publication auditable)
- Stable public URL that never changes (content versioned, not URL-versioned)

**Dashboards (monthly, auto-published):**
- Active breeders by county
- Inspections completed vs. overdue
- Corrective orders open vs. closed
- Impound intake + disposition rates
- BITE Fund balance (from W9 projection)
- Marketplace safe-harbor compliance rate (from W6)

**Reproducibility Invariant:**
Every dashboard number must be derivable from event projections with zero ambiguity.
If a number can't be reproduced from events alone, it is not a valid dashboard metric.

**CSV Exports:**
- Match dashboard totals exactly (verified by acceptance test)
- SHA256 hash in response headers
- Downloadable at stable URLs

**Acceptance Tests — W2:**
```
□ Dashboard totals match event-projection-derived totals (automated reconciliation test)
□ CSV totals match dashboard totals for same time period
□ Re-downloading published artifact returns identical contentHash
□ TRANSPARENCY_ARTIFACT_HASH_ANCHORED event exists for every published artifact
□ Workbook publication history is append-only (no silent overwrites)
```

---

# AGENT C — COUNTY OPERATIONS + ENFORCEMENT
## Scope: W3 (Impound + Microchip) · W4 (Evidence Packs) · W5 (Breeder + Transporter Filings)

**Depends on:** Agent A outputs
**Produces for others:** Inspection summaries → W1 (for license grade); Impound metrics → W2

### Boundary Contract — Agent C PRODUCES:
- `INSPECTION_COMPLETED` events with grade (consumed by W1 to update registry)
- Impound intake counts (consumed by W2 dashboards)
- `MICROCHIP_LOOKUP_PERFORMED` events (consumed by W10 for compliance reporting)

### Boundary Contract — Agent C CONSUMES:
- `@bark/domain` from Agent A
- RBAC scope tokens from Agent A (bark:county, bark:inspector, bark:breeder, bark:transporter)

---

### W3: Statewide Impound Database + 24-Hour Compliance Engine

**Subdomains:** `impound.barkwv.org` (public feed), `portal.barkwv.org/county/` (officer workflow)

**Event Catalog — W3:**
```
IMPOUND_INTAKE_RECORDED
IMPOUND_PUBLIC_POSTED
IMPOUND_POSTING_SLA_BREACHED        // auto-emitted if 24hr passes without IMPOUND_PUBLIC_POSTED
MICROCHIP_SCANNED
MICROCHIP_LOOKUP_PERFORMED
MICROCHIP_NO_HIT_ESCALATED          // when scan finds chip but no registry match
OWNER_NOTIFICATION_ATTEMPTED
OWNER_NOTIFICATION_CONFIRMED
IMPOUND_DISPOSITION_RECORDED        // RECLAIMED | ADOPTED | TRANSFERRED | EUTHANIZED | ESCAPED
DUPLICATE_REVIEW_FLAGGED            // offline conflict collision
IMPOUND_RECORD_LINKED               // two records = same animal case
IMPOUND_RECORD_SUPERSEDED           // human review closes duplicate (never automatic)
```

**Compliance Clock (24-hour SLA):**
- Timer starts at `ingestedAt` of `IMPOUND_INTAKE_RECORDED` (server truth for enforcement)
- `occurredAt` remains required and visible for business chronology/context
- Target: `IMPOUND_PUBLIC_POSTED` within 24 hours
- Reminder notification at 18 hours
- `IMPOUND_POSTING_SLA_BREACHED` event at 24 hours if not posted
- SLA breach visible on county compliance dashboard (W10)

**Offline Queue:**
- Officers can create records with no network connection
- Records stored locally with client-generated CUID2 IDs
- On sync: both records preserved if conflict detected
- Collision heuristic: same microchip number OR (same county + same species + same color + within 2-hour window)
- On collision: emit `DUPLICATE_REVIEW_FLAGGED`; county supervisor must resolve via human review events

**Location Fuzzing (mandatory):**
- Input: precise GPS coordinates
- Output: grid-snapped coordinates (≈ 0.25 mile / 402m precision)
- Formula: snapped_lat = round(lat / 0.0036) × 0.0036
- snapped_lng = round(lng / (0.0036 / cos(lat × π/180))) × (0.0036 / cos(lat × π/180))
- Precise coordinates stored in restricted projection only (bark:county and above)
- Public feed always shows snapped coordinates

**Microchip Workflow:**
1. Officer scans chip at intake → `MICROCHIP_SCANNED`
2. System queries AAHA (or equivalent) lookup API → `MICROCHIP_LOOKUP_PERFORMED` (outcome: HIT | NO_HIT | ERROR)
3. HIT: owner notification workflow begins → `OWNER_NOTIFICATION_ATTEMPTED`
4. NO_HIT: escalation queue → `MICROCHIP_NO_HIT_ESCALATED` (visible to WVDA)

**Public Impound Feed:**
- 90-day retention in public projection (policy, not deletion — records move to ARCHIVED state)
- Internal retention: 2 years minimum
- Retention transitions are state-change events (`IMPOUND_RECORD_ARCHIVED`), never deletes

**Acceptance Tests — W3:**
```
□ Record created offline → synced → public post appears within 24-hour SLA window
□ IMPOUND_POSTING_SLA_BREACHED emitted at exactly 24 hours if no public post
□ Location fuzzing: output coordinates never more precise than ~402m from true location
□ Location fuzzing: deterministic (same input always produces same output)
□ Duplicate offline sync: both records preserved; DUPLICATE_REVIEW_FLAGGED emitted
□ IMPOUND_RECORD_SUPERSEDED only exists with a prior human-actor causationId (never SYSTEM)
□ Public feed shows snapped coordinates only; precise coordinates require bark:county
□ Microchip scan triggers AAHA lookup within 60 seconds
□ NO_HIT escalation appears in WVDA queue within 5 minutes
```

---

### W4: Inspector Evidence Pack System

**Subdomain:** `portal.barkwv.org/inspector/`

**Event Catalog — W4:**
```
INSPECTION_STARTED
EVIDENCE_ITEM_CAPTURED              // each photo/video/note/reading
EVIDENCE_ITEM_HASH_RECORDED         // SHA256 of item at capture time
INSPECTION_COMPLETED                // includes grade + bundleHash of sealed manifest
EVIDENCE_BUNDLE_SEALED              // canonical manifest.json generated + bundleHash
EVIDENCE_BUNDLE_EXPORTED
CORRECTIVE_ORDER_ISSUED
CORRECTIVE_ORDER_DEADLINE_SET
REINSPECTION_SCHEDULED
REINSPECTION_RECORDED
CORRECTIVE_ORDER_CLOSED             // WVDA admin actor only
```

**Evidence Capture (mobile-first, responsive web):**
- Photo/video: preserve EXIF metadata (timestamp, GPS if available)
- Each item immediately hashed on capture: `itemHash = SHA256(file_content)`
- `EVIDENCE_ITEM_HASH_RECORDED` event emitted per item
- Items stored at non-enumerable signed-URL paths

**Evidence Bundle Sealing:**
On `INSPECTION_COMPLETED`, system generates:
```json
// manifest.json (canonical)
{
  "inspectionId": "...",
  "licenseId": "...",
  "sealedAt": "ISO8601",
  "inspector": { "actorId": "...", "role": "INSPECTOR" },
  "items": [
    { "evidenceItemId": "...", "capturedAt": "...", "itemHash": "SHA256...", "type": "PHOTO" }
  ]
}
// Entries sorted by capturedAt ASC, then evidenceItemId ASC (deterministic)
// Top-level keys and nested object keys sorted deterministically (canonical_json)
// bundleHash = SHA256( canonical_json(manifest) )
// bundleHash included in EVIDENCE_BUNDLE_SEALED and INSPECTION_COMPLETED events
```

**Chain-of-Custody Log:**
Full audit trail: who accessed the bundle, when, from what IP, under which scope token.

**Export Bundle:**
- `manifest.json` (canonical)
- `manifest.pdf` (human-readable for court/AG)
- `evidence.zip` (all items + manifest)
- Bundle download triggers `EVIDENCE_BUNDLE_EXPORTED` event

**5-Year Retention:**
- `EVIDENCE_RECORD_ARCHIVED` state transition at 5 years (not deletion)
- Archived records accessible to bark:wvda and bark:inspector indefinitely

**Acceptance Tests — W4:**
```
□ Evidence item hash stable across download (SHA256 matches original capture hash)
□ Tampered item detected: modified file produces different hash, bundle invalidated
□ bundleHash stable: re-generating manifest from same events produces identical hash
□ Export bundle contains provenance metadata (actorId, occurredAt, inspectionId)
□ Public cannot access evidence (bark:inspector minimum required)
□ Chain-of-custody log entry created for every bundle access
□ CORRECTIVE_ORDER_CLOSED requires actorRole = WVDA_ADMIN (system rejects other roles)
```

---

### W5: Breeder + Transporter Compliance Filings

**Subdomain:** `portal.barkwv.org/breeder/`, `portal.barkwv.org/transporter/`

**Event Catalog — W5:**
```
MICROCHIP_TRANSFER_CONFIRMED        // within 7 days of sale/transfer
DISCLOSURE_FORM_PUBLISHED           // WVDA publishes new version
DISCLOSURE_ACKNOWLEDGED             // buyer acknowledgment (e-sign)
QUARTERLY_INVENTORY_RECORDED        // with photo attachments
TRANSPORT_MANIFEST_RECORDED
TRANSPORT_SENSOR_LOG_ATTACHED       // native device export + calibration record
TRANSPORT_SENSOR_INTERVAL_VALIDATED // system validates 15-min intervals for 6+ dogs
TRANSPORT_SENSOR_INTERVAL_VIOLATION // emitted if intervals fail validation
MICROCHIP_TRANSFER_SLA_BREACHED
```

**Disclosure Form Versioning:**
- Every published form is an immutable artifact with `formVersion` and `publishedAt`
- Historical form snapshots preserved forever
- Acknowledgment records reference specific `formVersion` (not "latest")
- `DISCLOSURE_ACKNOWLEDGED` includes: actorId, formVersion, occurredAt, ingestedAt

**Microchip Transfer Filing:**
- 7-day window from transfer: tracked as compliance clock
- `MICROCHIP_TRANSFER_SLA_BREACHED` emitted if 7 days pass without confirmation

**Sensor Log Validation (Transport — 6+ dogs):**
- 15-minute interval requirement
- System validates intervals on upload
- Gap > 15 minutes in a required period → `TRANSPORT_SENSOR_INTERVAL_VIOLATION`
- Validation result recorded in `TRANSPORT_SENSOR_INTERVAL_VALIDATED`
- 30-day retention: archive state transition, not deletion

**5-Year Record Retention (Filings):**
- State transition to ARCHIVED at 5 years
- Printable exports available throughout retention period

**Acceptance Tests — W5:**
```
□ Disclosure acknowledgment references specific formVersion (not "latest")
□ Historical form version retrievable after newer version published
□ Microchip transfer SLA clock triggers MICROCHIP_TRANSFER_SLA_BREACHED at 7 days
□ Sensor log upload with 18-minute gap emits TRANSPORT_SENSOR_INTERVAL_VIOLATION
□ Sensor log upload with valid 15-min intervals emits TRANSPORT_SENSOR_INTERVAL_VALIDATED
□ Filing proof export includes actorId, occurredAt, ingestedAt, formVersion
□ Retention archive: records accessible after 5 years (not deleted)
```

### Agent C Self-Check (Required Before Handoff)

```
□ W3/W4/W5 events validated against BARK_EVENT_ENVELOPE (including orgId/countyId/agencyId/correlationId/causationId)
□ All Agent C event names are SCREAMING_SNAKE_CASE and included in the approved catalogs above
□ All SLA/deadline enforcement uses ingestedAt (server truth), with occurredAt retained for business chronology
□ Conflict handling verified append-only (DUPLICATE_REVIEW_FLAGGED, IMPOUND_RECORD_LINKED, IMPOUND_RECORD_SUPERSEDED)
□ Evidence sealing verified deterministic (canonical manifest ordering + stable bundleHash)
□ RBAC tests prove public/restricted field separation for impound + evidence surfaces
□ Acceptance tests for W3/W4/W5 executed and attached as artifact evidence in docs/conformance
```

---

# AGENT D — MARKETPLACE + FUND + GOVERNANCE
## Scope: W6 (Marketplace Console) · W7 (Training) · W9 (BITE Fund) · W10 (WVDA Admin)

**Depends on:** Agent A (foundation) + Agent B (license status events) + Agent C (inspection data)
**Produces:** Final governance layer — no other agents depend on D's outputs

### Boundary Contract — Agent D PRODUCES:
- Marketplace safe-harbor proof logs and partner compliance exports (W6)
- Training certification lifecycle events and verification records (W7)
- BITE Fund immutable ledger projections + monthly/quarterly fund artifacts (W9)
- WVDA statewide admin command events + statewide grant reporting artifacts (W10)

### Boundary Contract — Agent D CONSUMES:
- `LICENSE_VERIFICATION_PERFORMED` events from Agent B (W1)
- `DASHBOARD_SNAPSHOT_PUBLISHED` events from Agent B (W2)
- `INSPECTION_COMPLETED` events from Agent C (W4)
- `IMPOUND_INTAKE_RECORDED` metrics from Agent C (W3)
- `@bark/domain` from Agent A
- RBAC scope tokens from Agent A

---

### W6: Marketplace Partner Console + Safe-Harbor Logs

**Subdomain:** `portal.barkwv.org/marketplace/`, `api.barkwv.org/v1/partner/`

**Event Catalog — W6:**
```
MARKETPLACE_PARTNER_REGISTERED
MARKETPLACE_API_KEY_ISSUED
MARKETPLACE_API_KEY_REVOKED
MARKETPLACE_BATCH_VERIFICATION_PERFORMED
MARKETPLACE_OUTAGE_RECORDED         // partner self-reports outage
MARKETPLACE_OUTAGE_RESOLVED
LISTING_REMOVAL_NOTICE_SENT         // sent to platform for invalid license
LISTING_REMOVAL_NOTICE_ACKNOWLEDGED // 24-hour expectation clock starts
LISTING_REMOVAL_SLA_BREACHED        // if no action within 24 hours
MARKETPLACE_VERIFICATION_LOG_EXPORTED
```

**Safe-Harbor Mechanism:**
- Partner must verify licenses before listing
- `MARKETPLACE_BATCH_VERIFICATION_PERFORMED` is the proof record
- 2-year retention on all verification logs (state transition at 2 years, not deletion)
- Log export available: CSV with all verification calls, results, timestamps

**Outage Mode:**
- Partner records outage: `MARKETPLACE_OUTAGE_RECORDED`
- During outage: degraded compliance guidance provided (log gap acknowledged, not waived)
- Retry rule: system suggests retry intervals
- Outage closed: `MARKETPLACE_OUTAGE_RESOLVED`

**Invalid Listing Workflow:**
- WVDA identifies invalid listing → `LISTING_REMOVAL_NOTICE_SENT`
- 24-hour clock starts for platform to act
- `LISTING_REMOVAL_SLA_BREACHED` if no acknowledgment

**Acceptance Tests — W6:**
```
□ Mock marketplace integration completes full safe-harbor flow end-to-end
□ Verification log export matches actual API call records for test period
□ Outage simulation: outage recorded, retry behavior triggered, outage resolved
□ LISTING_REMOVAL_SLA_BREACHED emitted at exactly 24 hours without acknowledgment
□ Expired API key returns 401 with clear error code
□ 2-year retention: logs accessible, not deleted, at 2-year mark (test with time-travel)
```

---

### W7: Training + Certification System

**Subdomain:** `training.barkwv.org`

**Event Catalog — W7:**
```
TRAINING_MODULE_PUBLISHED           // includes significanceLevel
TRAINING_MODULE_VERSION_PUBLISHED   // new version of existing module
TRAINING_COMPLETED
TRAINING_QUIZ_PASSED
TRAINING_CERTIFICATE_ISSUED
TRAINING_CERTIFICATE_VERIFIED       // log every external verification
RECERTIFICATION_REQUIRED            // emitted when MAJOR/CRITICAL update published
RECERTIFICATION_DEADLINE_SET
```

**Training Version Significance (mandatory field on TRAINING_MODULE_VERSION_PUBLISHED):**
```
MINOR    → No re-certification required (typo fixes, clarifications)
MAJOR    → Re-certification required within 90 days
CRITICAL → Existing certificate immediately suspended; re-cert required before next action
```

**Role-Based Modules:**
| Module | Required For |
|--------|-------------|
| County Intake Compliance | bark:county |
| Digital Evidence Capture | bark:inspector |
| Microchip Workflow | bark:county, bark:inspector |
| Marketplace Compliance Basics | bark:marketplace |
| WVDA Admin Operations | bark:wvda |

**Certificate Integrity:**
- Every certificate references: `trainingModuleId`, `moduleVersion`, `completedAt`, `actorId`
- Certificates verifiable at public endpoint: `training.barkwv.org/verify/{certificateId}`
- Certificate remains valid with its version noted (not invalidated by MINOR updates)
- Certificate suspended on CRITICAL update (RECERTIFICATION_REQUIRED event)

**Acceptance Tests — W7:**
```
□ Certificate verification endpoint returns valid for active cert, suspended for CRITICAL-flagged cert
□ RECERTIFICATION_REQUIRED emitted within 5 minutes of CRITICAL version publish
□ MAJOR version: 90-day recertification deadline set automatically
□ MINOR version: no recertification events emitted
□ Completion event references specific moduleVersion (not "current")
□ Historical completion records valid even after newer version published
```

---

### W9: B.I.T.E. Fund Ledger

**Subdomain:** `portal.barkwv.org/wvda/fund/` (bark:wvda only)

**Purpose:** Immutable, audit-grade proof that the law's "polluter pays" self-funding mechanism works. Balance is never stored as a mutable field — it is always projected from events.

**Event Catalog — W9:**
```
BITE_LICENSE_FEE_RECEIVED           // from W1 license events
BITE_PENALTY_ASSESSED               // from enforcement events
BITE_PENALTY_COLLECTED
BITE_PENALTY_WAIVED                 // requires: reason, authorizedBy (WVDA_ADMIN actorId)
BITE_DISBURSEMENT_AUTHORIZED        // WVDA_ADMIN actor; causationId of authorization required
BITE_DISBURSEMENT_RECORDED          // causationId = BITE_DISBURSEMENT_AUTHORIZED eventId
BITE_FUND_BALANCE_SNAPSHOT_PUBLISHED
BITE_AUDIT_REPORT_PUBLISHED
```

**Invariants:**
- Fund balance = SUM(credits) - SUM(debits) derived from event log (never stored)
- No `BITE_DISBURSEMENT_RECORDED` without prior `BITE_DISBURSEMENT_AUTHORIZED` (causation enforced at ingest)
- Every waived penalty records reason + authorizing actorId
- No negative balance allowed: disbursement authorization blocked if projected balance insufficient

**Disbursement Categories:**
- INVESTIGATION (enforcement operations)
- TREATMENT (animal care, veterinary)
- ENFORCEMENT (legal, compliance)

**Projections:**
- Current balance (running total from events)
- Revenue by source: LICENSE_FEES vs. PENALTIES
- Disbursement history by category
- Quarterly grant report (for WVDA + legislature)

**Publication:**
- `BITE_FUND_BALANCE_SNAPSHOT_PUBLISHED` monthly (auto)
- `BITE_AUDIT_REPORT_PUBLISHED` quarterly
- Both are immutable artifacts with contentHash (same pattern as W2 transparency artifacts)

**Acceptance Tests — W9:**
```
□ Projected balance from events = SUM(credits) - SUM(debits) with zero discrepancy
□ BITE_DISBURSEMENT_RECORDED without prior BITE_DISBURSEMENT_AUTHORIZED → ingest rejection
□ Disbursement authorization blocked if projected balance < disbursement amount
□ Waived penalty without reason field → ingest rejection
□ Published fund snapshot hash stable across downloads
□ Quarterly report reproducible from event projections alone
```

---

### W10: WVDA State Administration Console

**Subdomain:** `portal.barkwv.org/wvda/` (bark:wvda only)

**Purpose:** The state-level command center. WVDA cannot operate the law without this.

**Event Catalog — W10:**
```
WVDA_LICENSE_ACTION_TAKEN           // issue | renew | suspend | revoke; includes reason
WVDA_INSPECTOR_CREDENTIALED
WVDA_INSPECTOR_CREDENTIAL_REVOKED
WVDA_CORRECTIVE_ORDER_REVIEWED      // approved | rejected | escalated
WVDA_CORRECTIVE_ORDER_CLOSED        // requires prior WVDA_CORRECTIVE_ORDER_REVIEWED
WVDA_GRANT_REPORT_PUBLISHED
WVDA_COUNTY_ONBOARDED
WVDA_COUNTY_OFFICER_ROLE_ASSIGNED
```

**Capabilities:**

**License Lifecycle Management:**
- Issue, renew, suspend, revoke licenses
- Every action = `WVDA_LICENSE_ACTION_TAKEN` event with `actorId` (no anonymous admin actions)
- Triggers corresponding W1 status change event (causation chain: W10 event → W1 event)

**Statewide Compliance Dashboard:**
- All 55 counties: impound SLA compliance rate (from W3)
- All active licenses: inspection grade distribution (from W4)
- Open corrective orders by county (from W4)
- Microchip no-hit escalation queue (from W3)
- BITE Fund balance (from W9)

**Corrective Order Approval Chain:**
- Inspector issues order (W4)
- WVDA reviews: `WVDA_CORRECTIVE_ORDER_REVIEWED`
- WVDA closes: `WVDA_CORRECTIVE_ORDER_CLOSED` (cannot close without prior review event)

**County Onboarding:**
- `WVDA_COUNTY_ONBOARDED` event
- `WVDA_COUNTY_OFFICER_ROLE_ASSIGNED` for each officer
- Training compliance tracked per county

**Grant Reporting:**
- Pulls W9 projections + W3 impound metrics + W4 inspection data
- `WVDA_GRANT_REPORT_PUBLISHED` with contentHash (immutable artifact)

**Acceptance Tests — W10:**
```
□ WVDA_ADMIN role required for all W10 actions; other roles return 403
□ WVDA_LICENSE_ACTION_TAKEN always includes actorId (system cannot issue without actor)
□ License status change in W10 produces corresponding W1 projection update within 60 seconds
□ WVDA_CORRECTIVE_ORDER_CLOSED without prior WVDA_CORRECTIVE_ORDER_REVIEWED → ingest rejection
□ Statewide dashboard numbers match event-projection-derived totals (reconciliation test)
□ Grant report reproducible from W9 + W3 + W4 projections alone
□ County onboarding produces correct role assignments for all listed officers
```

---

# DEPENDENCY MAP + EXECUTION ORDER

```
Agent A (Foundation)
    ├── @bark/domain package
    ├── BARK_EVENT_ENVELOPE + ingest gate
    ├── RBAC scope model
    └── Audit log service
         │
         ├── Agent B (Public Surface) — starts immediately after A ships domain types
         │     ├── W1: Registry + Verify + QR + API
         │     └── W2: Transparency Hub
         │           │
         │           └── feeds → Agent D (W10 grant reporting pulls W2 snapshots)
         │
         ├── Agent C (County + Enforcement) — starts immediately after A ships
         │     ├── W3: Impound + Microchip
         │     ├── W4: Evidence Packs
         │     └── W5: Breeder + Transporter Filings
         │           │
         │           └── feeds → Agent D (W10 dashboard pulls W3/W4 metrics)
         │                       Agent B (W1 pulls W4 inspection grades)
         │
         └── Agent D (Marketplace + Fund + Governance) — starts after B and C have events flowing
               ├── W6: Marketplace Console (depends on W1 license events)
               ├── W7: Training + Certification
               ├── W9: BITE Fund Ledger (depends on license/penalty events from B/C)
               └── W10: WVDA Admin Console (depends on B + C projections)
```

**Critical path for MVP:**
`Agent A → Agent B (W1) → Agent D (W6)` — this unlocks the marketplace safe-harbor flow, which is the first legislative priority.

**Milestone schedule:**
- M1 (Public Compliance MVP): Agents A + B complete → verify, registry, data live
- M2 (County Operations): Agent C complete → impound + microchip + evidence + filings live
- M3 (Full Governance): Agent D complete → marketplace console + BITE Fund + WVDA admin live

---

# FULL EVENT CATALOG (Master Reference)

All events inherit `BARK_EVENT_ENVELOPE`. Listed below are the domain-specific payload fields only.

| Event | Agent | Key Payload Fields |
|-------|-------|--------------------|
| BREEDER_LICENSED | B/W1 | licenseId, licenseType, countyId, expiresOn |
| BREEDER_LICENSE_STATUS_CHANGED | B/W1 | licenseId, previousStatus, newStatus, reason |
| TRANSPORTER_LICENSED | B/W1 | licenseId, licenseType |
| TRANSPORTER_LICENSE_STATUS_CHANGED | B/W1 | licenseId, previousStatus, newStatus, reason |
| LICENSE_VERIFICATION_PERFORMED | B/W1 | licenseId, verifierType (HUMAN/MACHINE/BATCH), result |
| LICENSE_VERIFICATION_TOKEN_ISSUED | B/W1 | licenseId, expiresOn, issuerKeyId |
| DASHBOARD_SNAPSHOT_PUBLISHED | B/W2 | snapshotPeriod, contentHash, artifactId |
| CSV_EXPORT_PUBLISHED | B/W2 | exportType, contentHash, artifactId |
| CAPACITY_WORKBOOK_PUBLISHED | B/W2 | workbookVersion, contentHash, artifactId |
| TRANSPARENCY_ARTIFACT_HASH_ANCHORED | B/W2 | artifactId, contentHash, artifactType |
| IMPOUND_INTAKE_RECORDED | C/W3 | impoundRecordId, species, microchipNumber, locationSnapped |
| IMPOUND_PUBLIC_POSTED | C/W3 | impoundRecordId, postUrl |
| IMPOUND_POSTING_SLA_BREACHED | C/W3 | impoundRecordId, intakeOccurredAt, slaHours |
| MICROCHIP_SCANNED | C/W3 | impoundRecordId, microchipNumber, scanResult |
| MICROCHIP_LOOKUP_PERFORMED | C/W3 | microchipNumber, provider, outcome (HIT/NO_HIT/ERROR) |
| MICROCHIP_NO_HIT_ESCALATED | C/W3 | microchipNumber, impoundRecordId |
| OWNER_NOTIFICATION_ATTEMPTED | C/W3 | impoundRecordId, channel, outcome |
| IMPOUND_DISPOSITION_RECORDED | C/W3 | impoundRecordId, disposition |
| DUPLICATE_REVIEW_FLAGGED | C/W3 | impoundRecordIds[], collisionBasis |
| IMPOUND_RECORD_LINKED | C/W3 | primaryRecordId, linkedRecordId |
| IMPOUND_RECORD_SUPERSEDED | C/W3 | supersededRecordId, survivingRecordId, reviewedBy |
| INSPECTION_STARTED | C/W4 | inspectionId, licenseId, inspectorId |
| EVIDENCE_ITEM_CAPTURED | C/W4 | inspectionId, evidenceItemId, itemType, itemHash |
| EVIDENCE_BUNDLE_SEALED | C/W4 | inspectionId, bundleHash, itemCount |
| INSPECTION_COMPLETED | C/W4 | inspectionId, grade, bundleHash |
| CORRECTIVE_ORDER_ISSUED | C/W4 | inspectionId, orderId, deadline |
| REINSPECTION_RECORDED | C/W4 | originalInspectionId, reinspectionId, outcome |
| MICROCHIP_TRANSFER_CONFIRMED | C/W5 | licenseId, microchipNumber, transferDate |
| DISCLOSURE_FORM_PUBLISHED | C/W5 | formId, formVersion, publishedAt |
| DISCLOSURE_ACKNOWLEDGED | C/W5 | formId, formVersion, actorId |
| QUARTERLY_INVENTORY_RECORDED | C/W5 | licenseId, dogCount, photoItemIds[] |
| TRANSPORT_MANIFEST_RECORDED | C/W5 | manifestId, transporterId, dogCount, routeOrigin, routeDest |
| TRANSPORT_SENSOR_LOG_ATTACHED | C/W5 | manifestId, logHash, calibrationHash |
| TRANSPORT_SENSOR_INTERVAL_VALIDATED | C/W5 | manifestId, dogCount, isCompliant |
| TRANSPORT_SENSOR_INTERVAL_VIOLATION | C/W5 | manifestId, gapMinutes, gapStartAt |
| MARKETPLACE_PARTNER_REGISTERED | D/W6 | partnerId, partnerName, scopeTokens[] |
| MARKETPLACE_API_KEY_ISSUED | D/W6 | partnerId, keyId, issuedBy |
| MARKETPLACE_API_KEY_REVOKED | D/W6 | partnerId, keyId, revokedBy, reason |
| MARKETPLACE_BATCH_VERIFICATION_PERFORMED | D/W6 | partnerId, licenseIds[], resultSummary |
| MARKETPLACE_OUTAGE_RECORDED | D/W6 | partnerId, outageStartAt, reportedBy |
| MARKETPLACE_OUTAGE_RESOLVED | D/W6 | partnerId, outageEndAt |
| LISTING_REMOVAL_NOTICE_SENT | D/W6 | partnerId, licenseId, listingId |
| LISTING_REMOVAL_NOTICE_ACKNOWLEDGED | D/W6 | partnerId, licenseId, listingId, acknowledgedAt |
| LISTING_REMOVAL_SLA_BREACHED | D/W6 | partnerId, licenseId, noticeOccurredAt |
| MARKETPLACE_VERIFICATION_LOG_EXPORTED | D/W6 | partnerId, exportPeriod, artifactId, contentHash |
| TRAINING_MODULE_PUBLISHED | D/W7 | moduleId, targetRole, significanceLevel |
| TRAINING_MODULE_VERSION_PUBLISHED | D/W7 | moduleId, previousVersion, newVersion, significanceLevel |
| TRAINING_COMPLETED | D/W7 | moduleId, moduleVersion, actorId |
| TRAINING_QUIZ_PASSED | D/W7 | moduleId, moduleVersion, actorId, scorePercent |
| TRAINING_CERTIFICATE_ISSUED | D/W7 | certificateId, moduleId, moduleVersion, actorId |
| TRAINING_CERTIFICATE_VERIFIED | D/W7 | certificateId, verifiedBy, verificationChannel |
| RECERTIFICATION_REQUIRED | D/W7 | moduleId, newVersion, deadline (null if CRITICAL) |
| RECERTIFICATION_DEADLINE_SET | D/W7 | moduleId, moduleVersion, deadline |
| BITE_LICENSE_FEE_RECEIVED | D/W9 | fundTxId, licenseId, amount, feeType |
| BITE_PENALTY_ASSESSED | D/W9 | fundTxId, licenseId, amount, violationType |
| BITE_PENALTY_COLLECTED | D/W9 | fundTxId, assessedEventId |
| BITE_PENALTY_WAIVED | D/W9 | fundTxId, assessedEventId, reason, authorizedBy |
| BITE_DISBURSEMENT_AUTHORIZED | D/W9 | fundTxId, amount, category, authorizedBy |
| BITE_DISBURSEMENT_RECORDED | D/W9 | fundTxId, authorizationEventId, amount, category |
| BITE_FUND_BALANCE_SNAPSHOT_PUBLISHED | D/W9 | snapshotAt, balance, contentHash |
| BITE_AUDIT_REPORT_PUBLISHED | D/W9 | reportPeriod, contentHash, artifactId |
| WVDA_LICENSE_ACTION_TAKEN | D/W10 | licenseId, action, reason, actorId |
| WVDA_INSPECTOR_CREDENTIALED | D/W10 | inspectorId, countyScope, actorId |
| WVDA_INSPECTOR_CREDENTIAL_REVOKED | D/W10 | inspectorId, countyScope, actorId, reason |
| WVDA_CORRECTIVE_ORDER_REVIEWED | D/W10 | orderId, reviewOutcome, actorId |
| WVDA_CORRECTIVE_ORDER_CLOSED | D/W10 | orderId, reviewEventId, actorId |
| WVDA_GRANT_REPORT_PUBLISHED | D/W10 | reportPeriod, contentHash, artifactId |
| WVDA_COUNTY_ONBOARDED | D/W10 | countyId, countyName, actorId |
| WVDA_COUNTY_OFFICER_ROLE_ASSIGNED | D/W10 | countyId, officerId, role |

**Total events: 68**

---

*PROVENIQ Foundation · Greenbrier County, West Virginia*
*BARK Act + BITE Fund · barkwv.org*
*Build for the animals. Build it right. Build it once.*
