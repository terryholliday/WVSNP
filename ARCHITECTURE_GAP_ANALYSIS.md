# WVSNP-GMS ARCHITECTURE GAP ANALYSIS
**Date:** February 2026  
**Status:** CRITICAL GAP IDENTIFIED

---

## EXECUTIVE SUMMARY

**Finding:** The WVSNP-GMS implementation has a **complete backend kernel** (Phases 1-4) but is **missing the public-facing application intake portal**. This creates a "admin-complete but citizen-incomplete" system that violates the original program design.

**Impact:** Citizens cannot apply for WVSNP grants. The system can only process applications that are manually created by administrators.

**Root Cause:** Product boundary drift - the "application" track was implicitly deferred or conflated with admin portals (ShelterOS/VetOS).

---

## WHAT EXISTS (Backend Infrastructure)

### ✅ Event Catalog - Application Events Defined
From `WVSNP_MASTER_SPEC_v5.0.md`:
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

### ✅ Database Schema - Projection Table Exists
From `db/schema.sql:122-142`:
```sql
CREATE TABLE IF NOT EXISTS applications_projection (
  application_id UUID PRIMARY KEY,
  grantee_id UUID NOT NULL,
  grant_cycle_id VARCHAR(20) NOT NULL,
  organization_name VARCHAR(255),
  organization_type VARCHAR(50),
  requested_amount_cents BIGINT,
  match_commitment_cents BIGINT,
  match_level VARCHAR(20),
  status VARCHAR(30),
  completeness_percent INTEGER,
  priority_score INTEGER,
  rebuilt_at TIMESTAMPTZ NOT NULL,
  watermark_ingested_at TIMESTAMPTZ NOT NULL,
  watermark_event_id UUID NOT NULL
);
```

### ✅ Projection Rebuild - Application Support Exists
From `src/projections/rebuild.ts:14`:
```typescript
'APPLICATION_SUBMITTED',
```

And rebuild logic at lines 97-135 that writes to `applications_projection`.

---

## WHAT'S MISSING (Public Intake Portal)

### ❌ No Public Web Application
**Search Results:**
- No `src/application/application-service.ts` (application submission handler)
- No public routes in `src/api/` for application intake
- No domain logic in `src/domain/application/` for application state machines

**Expected Location:** Separate public portal repo or public routes within this repo.

### ❌ No Application Submission Logic
**Missing Components:**
1. **Application Service** - handles `submitApplication()` command
2. **Application Domain Logic** - state machine for application lifecycle
3. **Evidence Upload Pipeline** - attachment handling for proof documents
4. **Fraud Scoring Service** - advisory flags for admin review
5. **Public API Routes** - unauthenticated endpoints for intake

### ❌ No Public UI
**Expected Deliverables:**
- Public application form (household/org info, service area, requested assistance)
- Save & resume capability (offline-friendly with idempotency)
- Document upload interface
- Submission confirmation + tracking

---

## ARCHITECTURAL PATTERN (Canon-Safe Solution)

### Pattern A: Program Tenancy (RECOMMENDED)

**Tenancy Model:**
- `orgId` = WVSNP Program Organization (state-level)
- `actorId` = Public Applicant Principal (citizen identity)
- Keeps existing tenancy doctrine intact

**Event Flow:**
```
Public WVSNP Portal (anonymous → lightly authenticated)
  ↓ emits commands
Pet-Command-Bridge (same as ShelterOS/VetOS)
  ↓ writes events
Global Event Log (event_log table)
  ↓ projects to
applications_projection
  ↓ consumed by
ShelterOS Grant Module (admin review queue)
  ↓ adjudication
APPLICATION_AWARDED / APPLICATION_DENIED
```

**Key Principle:** Public portal writes to the **same ledger**, ShelterOS/VetOS read from **same projections**.

---

## REPOSITORY STRUCTURE ASSESSMENT

### Current Structure
```
c:\Users\Admin1\Desktop\AI Projects\WVSNP APPLICATION\
├── db/              ✅ Schema includes applications_projection
├── src/
│   ├── api/         ✅ Admin API routes (claims, invoices, closeout)
│   ├── application/ ✅ Services (grant, claim, invoice, closeout, oasis)
│   │                ❌ MISSING: application-service.ts
│   ├── domain/      ✅ Domain logic (grant, claim, voucher, closeout)
│   │                ❌ MISSING: domain/application/
│   ├── projections/ ✅ Rebuild logic exists for applications
│   └── scripts/     ✅ Setup and seed scripts
└── tests/           ⚠️  Conformance tests (mostly placeholders)
```

### Missing Subsystem: Public Application Intake

**Recommended Addition:**
```
src/
├── application/
│   └── application-service.ts        ← NEW: handles submitApplication()
├── domain/
│   └── application/
│       ├── application-logic.ts      ← NEW: state machine
│       ├── eligibility-rules.ts      ← NEW: screening logic
│       └── fraud-scoring.ts          ← NEW: advisory flags
└── api/
    └── routes/
        └── public-application.ts     ← NEW: public intake endpoints
```

**OR** (if separate portal):
```
c:\Users\Admin1\Desktop\AI Projects\PROVENIQ\
└── WVSNP-PUBLIC-PORTAL\              ← NEW REPO
    ├── src/
    │   ├── pages/                    ← Next.js public pages
    │   ├── components/               ← Form components
    │   └── lib/
    │       └── wvsnp-api-client.ts   ← Calls WVSNP-GMS API
    └── public/
```

---

## PHASE P0: PUBLIC APPLICATION INTAKE (Implementation Plan)

### Minimal v1 Scope

#### 1. Application Submission Service
**File:** `src/application/application-service.ts`

**Methods:**
- `startApplication(request)` → emits `APPLICATION_STARTED`
- `completeSection(request)` → emits `APPLICATION_SECTION_COMPLETED`
- `submitApplication(request)` → emits `APPLICATION_SUBMITTED`
- `consumeToken(request)` → emits `APPLICATION_TOKEN_CONSUMED`

**Idempotency:** Required on all commands (24h TTL)

**Tenancy:** Uses `orgId` = WVSNP Program Org, `actorId` = Applicant Principal

#### 2. Application Domain Logic
**File:** `src/domain/application/application-logic.ts`

**State Machine:**
```typescript
export type ApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'SCORED'
  | 'AWARDED'
  | 'WAITLISTED'
  | 'DENIED';

export interface ApplicationState {
  applicationId: string;
  granteeId: string;
  grantCycleId: string;
  status: ApplicationStatus;
  sections: Record<string, boolean>; // completeness tracking
  completenessPercent: number;
  priorityScore: number | null;
  submittedAt: Date | null;
  // ... evidence, attestations, etc.
}
```

**Event Handlers:**
- `applyApplicationEvent(state, event)`
- `checkApplicationInvariant(state)`

#### 3. Public API Routes
**File:** `src/api/routes/public-application.ts`

**Endpoints:**
```typescript
POST   /api/v1/public/applications/start
POST   /api/v1/public/applications/:id/sections/:sectionId/complete
POST   /api/v1/public/applications/:id/submit
POST   /api/v1/public/applications/:id/attachments
GET    /api/v1/public/applications/:id/status
```

**Auth:** Public (no JWT required for start/resume), optional light auth for submission

**Rate Limiting:** Required (prevent spam)

#### 4. Evidence Upload Pipeline
**File:** `src/application/evidence-service.ts`

**Capabilities:**
- Upload to artifact store (S3-compatible or local)
- Emit `ATTACHMENT_ADDED` events
- Virus scanning (advisory)
- File type validation

#### 5. Fraud Scoring (Advisory)
**File:** `src/domain/application/fraud-scoring.ts`

**Flags:**
- Duplicate application detection (same household/org)
- Velocity checks (too many applications too fast)
- Evidence quality scoring
- **Advisory only** - does not block submission

#### 6. Admin Review Queue
**Integration:** ShelterOS Grant Module reads `applications_projection`

**Workflow:**
- Admin sees submitted applications
- Can view evidence, run scoring
- Emits `APPLICATION_AWARDED` or `APPLICATION_DENIED`
- Triggers downstream grant creation if awarded

---

## VERIFICATION GATES

### Phase P0 Completion Checklist

- [ ] `application-service.ts` implements all 4 command handlers
- [ ] `application-logic.ts` state machine handles all 8 application events
- [ ] Public API routes are accessible without ShelterOS/VetOS auth
- [ ] Evidence upload pipeline writes to artifact store + emits events
- [ ] Fraud scoring runs on submission (advisory flags only)
- [ ] `applications_projection` is populated by rebuild pipeline
- [ ] ShelterOS admin can view submitted applications
- [ ] End-to-end test: public submit → admin review → award → grant created

---

## DECISION REQUIRED

**Question:** Should the public intake portal be:

**Option A:** Separate Next.js app (recommended for clean separation)
- **Pros:** Clear product boundary, independent deployment, public-optimized UX
- **Cons:** Requires new repo, API client abstraction

**Option B:** Public routes within WVSNP-GMS repo
- **Pros:** Single codebase, shared domain logic
- **Cons:** Mixes public/admin concerns, harder to secure

**Recommendation:** **Option A** - separate `WVSNP-PUBLIC-PORTAL` repo that calls WVSNP-GMS API.

---

## NEXT STEPS

1. **User Decision:** Choose Option A or B for portal location
2. **Create Application Service:** Implement `src/application/application-service.ts`
3. **Create Domain Logic:** Implement `src/domain/application/application-logic.ts`
4. **Create Public Routes:** Implement `src/api/routes/public-application.ts`
5. **Build Public Portal:** (if Option A) Create new Next.js repo
6. **Integration Test:** End-to-end submission → review → award flow

---

## CANON COMPLIANCE

✅ **Event Sourcing:** All application state derived from events  
✅ **Dual Time:** `occurredAt` (client) + `ingestedAt` (server)  
✅ **Idempotency:** All commands require idempotency keys  
✅ **Tenancy:** Uses `orgId` = WVSNP Program, `actorId` = Applicant  
✅ **Immutability:** No UPDATE/DELETE on event_log  
✅ **Rebuildability:** `applications_projection` is disposable  
✅ **UUIDv4:** Application IDs are client-generated  
✅ **UUIDv7:** Event IDs are server-generated  

---

**Status:** READY FOR IMPLEMENTATION  
**Blocker:** User decision on portal location (Option A vs B)
