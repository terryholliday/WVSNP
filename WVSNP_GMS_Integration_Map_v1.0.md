# WVSNP-GMS ↔ VetOS / ShelterOS Integration Map

> **Version:** 1.0  
> **Date:** February 4, 2026  
> **Purpose:** Map every WVSNP-GMS touchpoint into the existing VetOS and ShelterOS architectures  
> **Audience:** Terry (PROVENIQ Foundation)

---

## 1. The Big Picture

WVSNP-GMS is **not a standalone app** for clinic staff and county grantees. It's a module that lives inside the tools they already use:

```
┌─────────────────────────────────────────────────────────┐
│                    WVSNP-GMS BACKEND                     │
│              (Separate Event Store + API)                 │
│                                                          │
│   Vouchers · Claims · Invoices · Payments · Closeout     │
│   ─────────────────────────────────────────────────────  │
│   Grant Balances · OASIS Export · Reconciliation          │
└────────┬───────────────────┬──────────────────┬──────────┘
         │ REST/tRPC API     │ REST/tRPC API    │ Direct
    ┌────┴────┐        ┌────┴─────┐      ┌────┴──────┐
    │  VetOS  │        │ ShelterOS │      │   WVDA    │
    │  "WVSNP │        │  "WVSNP   │      │   Admin   │
    │  Claims"│        │  Grants"  │      │  Portal   │
    │  module │        │  module   │      │           │
    └─────────┘        └──────────┘      └───────────┘
    Vet staff           County grantees    WVDA staff
    submits claims      issues vouchers    oversees everything
```

**Three separate event stores. Never merged:**

| Event Store | Contains | Why Separate |
|-------------|----------|--------------|
| VetOS | Clinical records, appointments, medical history | HIPAA-adjacent; clinical truth |
| ShelterOS | Intake, adoption, foster, animals | Shelter operations |
| WVSNP-GMS | Vouchers, claims, invoices, payments, grants | Grant compliance; auditor-facing |

An auditor reviewing WVSNP can see *only* grant events. They don't wade through 50,000 appointment-scheduling events from VetOS.

---

## 2. VetOS Integration Points

### 2.1 Which VetOS Prompts Touch WVSNP?

Here's your existing VetOS 72-prompt roadmap with WVSNP integration marked:

| Prompt | Series | Name | WVSNP Impact | Integration Type |
|--------|--------|------|--------------|-----------------|
| 37 | P00 | Premium Contracts | ✅ | Add WVSNP event contracts |
| 38 | P01 | Event Sourcing Core | ✅ | Cross-store event references |
| 39 | P02 | CQRS + Query Layer | ✅ | GMS query projections |
| 42 | P06 | Identity + Credentialing | ✅ | Clinic registration with WVSNP |
| 43 | P07 | Global Policy Engine | ✅ | WVSNP eligibility rules |
| 47 | O04 | Anesthesia Management | ⚠️ | Procedure completion triggers |
| 49 | O05 | Consent Management | ✅ | WVSNP consent forms |
| 52 | O01 | Billing Engine | 🔴 **CRITICAL** | WVSNP claim submission flow |
| 59 | I06 | Portals | ✅ | Clinic WVSNP portal tab |
| 60 | P11 | Integrations Hub | 🔴 **CRITICAL** | GMS API client |
| 61 | P09 | Notification Hub | ✅ | Payment notifications |
| 67 | P10 | Document Generation | ✅ | WVSNP reports/receipts |

### 2.2 Detailed Integration by Prompt

---

#### PROMPT 52 — O01: Billing Engine (🔴 CRITICAL)

**This is the #1 integration point.** The billing engine already handles:
- Charge capture after procedures
- Invoice generation
- Payment processing
- Rescue contracts (volume pricing for shelters)

**WVSNP plugs in here as a "payer type":**

```
Normal flow:
  Procedure → Charge → Invoice → Client pays

WVSNP flow:
  Procedure → Charge → WVSNP Claim → GMS approves → State pays clinic

Mixed flow (if co-pay applies):
  Procedure → Charge → Split:
    → Client portion → Invoice → Client pays
    → WVSNP portion → Claim → GMS → State pays
```

**What to add to Prompt 52 (O01):**

```
New Payer Type: WVSNP_GRANT
- When procedure is linked to a WVSNP voucher:
  1. Auto-generate WVSNP claim via GMS API
  2. Charge is "held" until GMS responds (APPROVED/DENIED)
  3. If APPROVED: charge resolved against grant funds
  4. If DENIED: charge falls back to client invoice
  5. If LIRP voucher: co-pay is FORBIDDEN (reject co-pay line)

New Billing Event:
  WVSNP_CLAIM_LINKED { chargeId, claimId, voucherId, gmsApiRef }

New Payment Source:
  WVSNP_GRANT_PAYMENT { invoiceId, gmsPaymentId, amountCents }

Rescue Contract Reuse:
  The existing RescueContract pattern can model WVSNP:
  - organizationType: 'WVSNP_GRANTEE'
  - pricingModel: 'FLAT_FEE_SCHEDULE' (WVDA-approved amounts)
  - requiresPreAuthorization: true (voucher = pre-auth)
```

**User Experience (Vet Tech at Checkout):**

```
1. Tech completes spay surgery in VetOS
2. Tech goes to checkout/billing screen
3. System detects: "This patient has a WVSNP voucher"
4. Prompt: "Submit WVSNP claim?"  [Yes] [No, bill client]
5. If Yes:
   - Pre-fills: procedure code, date, clinic ID, voucher ID
   - Tech confirms details
   - VetOS calls GMS API: submitClaim(...)
   - Status shows: "WVSNP Claim Submitted — Pending Approval"
6. Once approved: "WVSNP Claim Approved — $75.00 from grant funds"
```

---

#### PROMPT 60 — P11: Integrations Hub (🔴 CRITICAL)

**This is where the GMS API client lives.** P11 handles all external system connections.

**What to add to Prompt 60 (P11):**

```
New Integration: WVSNP-GMS
  Type: REST API Client
  Base URL: configurable per environment
  Auth: API key per clinic (issued during WVSNP registration)

  Outbound Calls (VetOS → GMS):
    POST /claims          → submitClaim()
    GET  /claims/:id      → getClaimStatus()
    GET  /payments/clinic  → getClinicPayments()
    GET  /vouchers/:code   → validateVoucher()

  Inbound Webhooks (GMS → VetOS):
    POST /webhooks/wvsnp/claim-approved
    POST /webhooks/wvsnp/claim-denied
    POST /webhooks/wvsnp/payment-recorded

  Error Handling:
    - GMS unreachable → queue claim locally, retry
    - Claim rejected → notify billing module, fall back to client
    - Duplicate detected → show existing claim status

  Offline Behavior:
    - Claims queued in VetOS offline store
    - Synced when connection restored
    - Matches P04 (Offline-First Architecture)
```

---

#### PROMPT 42 — P06: Identity + Credentialing

**What to add:**

```
New Credential Type: WVSNP_PARTICIPATION
  - Clinic must register with WVDA to participate
  - Registration stores: oasisVendorCode, granteeId, countyCode
  - Without this credential, WVSNP module is hidden/disabled

New Validation:
  - Clinic must have active WVSNP_PARTICIPATION to submit claims
  - oasisVendorCode must be present (required for OASIS export)
```

---

#### PROMPT 43 — P07: Global Policy Engine

**What to add:**

```
New Policy Rules (WVSNP):
  - WVSNP_ELIGIBLE_PROCEDURES: [DOG_SPAY, DOG_NEUTER, CAT_SPAY, CAT_NEUTER, 
                                 COMMUNITY_CAT_SPAY, COMMUNITY_CAT_NEUTER]
  - WVSNP_LIRP_COPAY_FORBIDDEN: true
  - WVSNP_VOUCHER_REQUIRED: true (can't submit claim without valid voucher)
  - WVSNP_RABIES_VACCINE_INCLUDED: conditional per grant cycle rules
  - WVSNP_MAX_REIMBURSEMENT: per procedure type (from WVDA fee schedule)
```

---

#### PROMPT 49 — O05: Consent Management

**What to add:**

```
New Consent Form: WVSNP_PROGRAM_CONSENT
  - Owner acknowledges animal will be sterilized under WVSNP
  - Owner confirms income eligibility (for LIRP if applicable)
  - Clinic confirms animal is not already sterilized
  - Form must be signed BEFORE procedure (not after)
  - Stored as artifact linked to claim
```

---

#### PROMPT 59 — I06: Portals (Referring + Owner)

**What to add:**

```
New Portal Section: Clinic WVSNP Dashboard
  - Pending claims (submitted, awaiting approval)
  - Approved claims (awaiting payment)
  - Payment history (received from state)
  - Voucher lookup (validate voucher before procedure)
  - Monthly summary (procedures by type, reimbursement totals)
```

---

#### PROMPT 61 — P09: Notification Hub

**What to add:**

```
New Notification Channels (WVSNP):
  - CLAIM_APPROVED → "WVSNP claim #ABC approved for $75.00"
  - CLAIM_DENIED → "WVSNP claim #ABC denied: [reason]"
  - PAYMENT_RECEIVED → "WVSNP payment of $450.00 deposited"
  - GRANT_PERIOD_ENDING → "WVSNP grant period ends June 30"
  - CLAIMS_DEADLINE → "WVSNP claims deadline November 15"
```

---

## 3. ShelterOS Integration Points

ShelterOS is where **county grantees** manage the program. They issue vouchers, track budgets, and file reports.

### 3.1 Module: WVSNP Grants

This is a new top-level module inside ShelterOS:

```
ShelterOS Navigation:
  📋 Dashboard
  🐕 Animals
  🏠 Adoptions
  👥 Foster Care
  📊 Reports
  ────────────
  🏛️ WVSNP Grants  ← NEW MODULE
```

### 3.2 ShelterOS WVSNP Screens

#### Screen 1: Grant Overview Dashboard

```
┌─────────────────────────────────────────────────────┐
│  WVSNP Grant: FY2025-2026                           │
│  Status: ● Active    Period: Jul 1 – Jun 30         │
├──────────────┬──────────────┬───────────────────────┤
│  GENERAL     │  LIRP        │  TOTALS               │
│  Awarded:    │  Awarded:    │  Awarded:   $50,000   │
│   $40,000    │   $10,000    │  Used:      $28,750   │
│  Used:       │  Used:       │  Available: $21,250   │
│   $25,000    │   $3,750     │                       │
│  Available:  │  Available:  │  Vouchers:  142       │
│   $15,000    │   $6,250     │  Redeemed:  98        │
├──────────────┴──────────────┴───────────────────────┤
│  📊 By County                                        │
│  Greenbrier: 45 vouchers │ Monroe: 23 │ Pocahontas: 30│
└─────────────────────────────────────────────────────┘
```

**Data Source:** GMS API → `getGrantBudget(grantId)`, `getVoucherSummary(grantId)`

---

#### Screen 2: Voucher Issuance

```
┌─────────────────────────────────────────────────────┐
│  Issue New Voucher                                   │
├─────────────────────────────────────────────────────┤
│  Pet Owner Name:    [ Jane Smith              ]     │
│  Phone:             [ 304-555-1234            ]     │
│  County:            [ Greenbrier         ▼ ]        │
│  Address:           [ 123 Main St, Lewisburg  ]     │
│                                                      │
│  Animal Info:                                        │
│  Species:           ( ) Dog  ( ) Cat                 │
│  Procedure:         [ ] Spay  [ ] Neuter             │
│  Community Cat?     [ ] Yes (no owner, TNR)          │
│                                                      │
│  Funding Bucket:    ( ) General  ( ) LIRP            │
│  If LIRP: Income verification attached? [ ] Yes     │
│                                                      │
│  Estimated Amount:  $75.00 (auto from fee schedule)  │
│                                                      │
│         [ Cancel ]              [ Issue Voucher ]    │
└─────────────────────────────────────────────────────┘
```

**What Happens on Submit:**
1. ShelterOS calls GMS API: `issueVoucher(grantId, countyCode, details)`
2. GMS checks grant balance → enough funds? → encumber funds
3. GMS emits `VOUCHER_ISSUED` → returns voucher code
4. ShelterOS displays: "Voucher V-2025-0143 issued. Print for pet owner."

---

#### Screen 3: Voucher Lookup & Status

```
┌─────────────────────────────────────────────────────┐
│  Search: [ V-2025-0143 ]  [🔍]                      │
├─────────────────────────────────────────────────────┤
│  Voucher: V-2025-0143                                │
│  Status:  ● REDEEMED                                 │
│  Issued:  Oct 15, 2025  │  Expires: Oct 15, 2026    │
│  Owner:   Jane Smith    │  County: Greenbrier        │
│  Type:    Cat Spay (General)                         │
│  Amount:  $75.00                                     │
│                                                      │
│  Redemption:                                         │
│  Clinic:  Mountain Valley Vet │ Nov 2, 2025          │
│  Claim:   #CLM-2025-0098    │ Status: APPROVED       │
│  Invoice: #INV-2025-0034    │ Payment: Pending       │
└─────────────────────────────────────────────────────┘
```

**Data Source:** GMS API → `getVoucherStatus(voucherCode)`

---

#### Screen 4: County Activity Reports

```
┌─────────────────────────────────────────────────────┐
│  Activity Report: October 2025                       │
├──────────┬─────────┬──────────┬───────┬─────────────┤
│ County   │ Vouchers│ Redeemed │ Spent │ Remaining   │
├──────────┼─────────┼──────────┼───────┼─────────────┤
│Greenbrier│    45   │    38    │$2,850 │  $12,150    │
│Monroe    │    23   │    19    │$1,425 │   $6,075    │
│Pocahontas│    30   │    22    │$1,650 │   $5,850    │
├──────────┼─────────┼──────────┼───────┼─────────────┤
│ TOTAL    │    98   │    79    │$5,925 │  $24,075    │
└──────────┴─────────┴──────────┴───────┴─────────────┘

  Procedures:  Dog Spay: 22 │ Dog Neuter: 18 │ Cat Spay: 24 │ Cat Neuter: 15
  
  [ Export PDF ]  [ Export CSV ]
```

**Data Source:** GMS API → `getCountyReport(grantCycleId, periodStart, periodEnd)`

---

#### Screen 5: Deadline Tracker

```
┌─────────────────────────────────────────────────────┐
│  WVSNP Deadlines                                     │
├─────────────────────────────────────────────────────┤
│  ✅  Jun 30, 2025  Grant period ended                │
│  ⚠️  Nov 15, 2025  Claims deadline — 18 days left   │
│  ⬜  Nov 15, 2025  Final report due                  │
│  ⬜  Nov 30, 2025  All payments must be complete     │
│                                                      │
│  Pre-Closeout Checklist:                             │
│  ✅ All approved claims invoiced                     │
│  ✅ All invoices exported to OASIS                   │
│  ⚠️ 3 export batches awaiting Treasury ACK           │
│  ⬜ Matching funds documentation uploaded             │
│  ⬜ Final activity report submitted                  │
└─────────────────────────────────────────────────────┘
```

---

## 4. WVDA Admin Portal (Standalone)

This is the only **new application**. Smallest user count (WVDA staff only).

### 4.1 Screens

| Screen | Function |
|--------|----------|
| Grant Cycle Management | Create/configure grant cycles, set budgets, manage fee schedules |
| Claim Adjudication Queue | Review, approve, deny, adjust claims |
| Invoice Dashboard | Generate invoices, view batch status |
| OASIS Export Console | Generate batches, submit to Treasury, track ACK/rejection |
| Closeout Wizard | Pre-flight check → reconciliation → final close |
| Cross-County Dashboard | Statewide view: all grantees, all counties, all metrics |
| Audit Trail Viewer | Event log browser with filters |

### 4.2 WVDA Portal — No VetOS/ShelterOS Dependency

This portal talks **directly** to the GMS API. It doesn't go through VetOS or ShelterOS. WVDA staff don't need clinical or shelter tools — they need oversight.

---

## 5. API Contract (The Bridge)

This is the API that connects all three systems:

### 5.1 Voucher Operations (ShelterOS → GMS)

```
POST   /api/v1/vouchers                    → issueVoucher
GET    /api/v1/vouchers/:id                → getVoucher
GET    /api/v1/vouchers/:id/status         → getVoucherStatus
POST   /api/v1/vouchers/:id/cancel         → cancelVoucher
GET    /api/v1/vouchers?grantCycleId=X     → listVouchers (with filters)
```

### 5.2 Claim Operations (VetOS → GMS)

```
POST   /api/v1/claims                      → submitClaim
GET    /api/v1/claims/:id                  → getClaim
GET    /api/v1/claims/:id/status           → getClaimStatus
GET    /api/v1/claims?clinicId=X           → listClinicClaims
POST   /api/v1/vouchers/:code/validate     → validateVoucher (pre-procedure check)
```

### 5.3 Payment Operations (VetOS reads)

```
GET    /api/v1/payments?clinicId=X         → getClinicPayments
GET    /api/v1/payments/:id                → getPaymentDetail
```

### 5.4 Grant Operations (ShelterOS + WVDA)

```
GET    /api/v1/grants/:id/budget           → getGrantBudget
GET    /api/v1/grants/:id/activity         → getActivitySummary
GET    /api/v1/reports/county/:code        → getCountyReport
```

### 5.5 Admin Operations (WVDA Portal only)

```
POST   /api/v1/claims/:id/adjudicate       → adjudicateClaim
POST   /api/v1/invoices/generate            → generateInvoice
POST   /api/v1/oasis/export                 → generateOASISBatch
POST   /api/v1/oasis/export/:id/submit      → submitBatch
POST   /api/v1/closeout/preflight           → runPreFlight
POST   /api/v1/closeout/start               → startCloseout
POST   /api/v1/closeout/reconcile           → reconcile
POST   /api/v1/closeout/close               → closeCycle
```

### 5.6 Webhooks (GMS → VetOS / ShelterOS)

```
POST   /webhooks/wvsnp/claim-status-changed
       { claimId, status, reason, amountCents }

POST   /webhooks/wvsnp/payment-recorded
       { clinicId, invoiceId, amountCents, depositDate }

POST   /webhooks/wvsnp/voucher-redeemed
       { voucherId, clinicId, claimId, dateOfService }

POST   /webhooks/wvsnp/grant-deadline-approaching
       { grantCycleId, deadline, daysRemaining }
```

---

## 6. Updated Roadmap (Execution Order)

```
PHASE A: WVSNP-GMS Backend (YOU ARE HERE)
  ✅ Phase 1: Event Store + Money Kernel
  ✅ Phase 2: Grant Ops + Vouchers + LIRP
  ✅ Phase 3: Claims + Invoices + Payments
  ⏳ Stabilization Patch (v5.3) ← DO THIS NEXT
  ⏳ Phase 4: OASIS Export + Closeout
  ⬜ Phase 5: REST API Layer + Auth

PHASE B: VetOS WVSNP Module
  Depends on: VetOS P06 (Identity), P07 (Policy), O01 (Billing)
  ⬜ B1: Add WVSNP payer type to Billing Engine (Prompt 52 amendment)
  ⬜ B2: Add GMS API client to Integrations Hub (Prompt 60 amendment)
  ⬜ B3: Add WVSNP consent form (Prompt 49 amendment)
  ⬜ B4: Add WVSNP clinic portal tab (Prompt 59 amendment)
  ⬜ B5: Add WVSNP notifications (Prompt 61 amendment)

PHASE C: ShelterOS WVSNP Module
  Depends on: ShelterOS core being functional
  ⬜ C1: Grant Overview Dashboard
  ⬜ C2: Voucher Issuance Screen
  ⬜ C3: Voucher Status/Lookup
  ⬜ C4: County Reports
  ⬜ C5: Deadline Tracker

PHASE D: WVDA Admin Portal
  Depends on: GMS API (Phase A5)
  ⬜ D1: Grant Cycle Management
  ⬜ D2: Claim Adjudication Queue
  ⬜ D3: Invoice Dashboard
  ⬜ D4: OASIS Export Console
  ⬜ D5: Closeout Wizard
  ⬜ D6: Cross-County Dashboard
```

### Critical Path

```
Stabilization (v5.3) → Phase 4 → API Layer → All UI work can begin
                                      │
                    ┌─────────────────┼─────────────────┐
                    ↓                 ↓                 ↓
              VetOS Module     ShelterOS Module    WVDA Portal
              (parallel)       (parallel)          (parallel)
```

The API layer is the **bottleneck**. Once that exists, all three UI efforts can run in parallel.

---

## 7. The "One More Click" Principle

The entire integration strategy follows one rule:

> **No user should need to leave their primary tool or enter data twice.**

| User | Primary Tool | WVSNP Action | Extra Clicks |
|------|-------------|--------------|--------------|
| Vet tech | VetOS | Submit claim after surgery | 1 button |
| Grantee | ShelterOS | Issue voucher | 1 form |
| WVDA admin | Admin Portal | Approve claim | 1 button |

Everything else — voucher validation, fund encumbrance, invoice generation, OASIS export — happens automatically in the background.

That's what makes this a system instead of paperwork.

---

## 8. What Changes in Existing VetOS Prompts

These are **amendments** to existing prompt specs, not new prompts:

| Prompt | Amendment |
|--------|-----------|
| **37 (P00)** | Add WVSNP event contracts to premium contract library |
| **42 (P06)** | Add WVSNP_PARTICIPATION credential type for clinics |
| **43 (P07)** | Add WVSNP eligibility rules to policy engine |
| **49 (O05)** | Add WVSNP_PROGRAM_CONSENT form template |
| **52 (O01)** | Add WVSNP payer type, claim integration, LIRP co-pay block |
| **59 (I06)** | Add WVSNP dashboard section to clinic portal |
| **60 (P11)** | Add GMS API client with offline queue |
| **61 (P09)** | Add WVSNP notification templates |
| **67 (P10)** | Add WVSNP voucher receipt + claim confirmation templates |

**No new VetOS prompts needed.** WVSNP is an integration, not a rewrite.

---

## 9. Authentication & Multi-Tenant Bridge

```
VetOS Tenant (clinicId + orgId)
  → maps to →
GMS Participant (clinicId + oasisVendorCode)

ShelterOS Tenant (orgId)
  → maps to →
GMS Grantee (granteeId + countyCode)
```

### Registration Flow

```
1. WVDA approves clinic for WVSNP participation
2. GMS issues API key for clinic
3. VetOS admin enters API key in Settings → Integrations → WVSNP
4. VetOS stores: { apiKey, oasisVendorCode, granteeId }
5. WVSNP module becomes visible in VetOS navigation
```

Same pattern for ShelterOS: WVDA approves grantee → GMS issues credentials → ShelterOS admin configures.

---

*PROVENIQ Foundation | PET COMMAND Ecosystem | February 2026*
