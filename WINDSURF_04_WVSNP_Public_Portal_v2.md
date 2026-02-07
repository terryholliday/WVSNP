# WINDSURF_04 — WVSNP Public Portal (Citizen-Facing Interface)

**System:** WVSNP Grant Management — Public Access Layer
**Prerequisite:** Phase 4 Stabilization (WINDSURF_03B) must be COMPLETE before this work ships. You may build in parallel but do NOT merge until the completion gate passes.
**Architecture Decision:** Standalone Public Portal. Completely separate from ShelterOS admin.

---

## SCOPE — Three Jobs, Nothing Else

This portal exists for exactly three purposes:

1. **Apply** — Citizens submit applications for spay/neuter vouchers
2. **Check Status** — Applicants track where their application stands
3. **Report** — Non-platform participants (vets not on VetOS, grantee orgs not on ShelterOS) report service completion and matching fund contributions back to WVDA

That's it. This is NOT a dashboard. NOT an analytics tool. NOT a general-purpose animal welfare portal. The WVSNP GMS consumes data from ShelterOS, VetOS, and Mayday — but none of that surfaces here. The public portal is a narrow, purpose-built interface for the people who interact with the grant program directly.

---

## 0) GROUND RULES

**You MUST:**
- Build a standalone frontend application that calls the existing `/api/v1/public/applications/*` endpoints
- Keep the public portal completely separate from ShelterOS admin routes and authentication
- Make every form mobile-responsive (rural WV — many applicants will be on phones)
- Ensure the application works on slow/intermittent connections (rural broadband reality)

**You MUST NOT:**
- Create user accounts or passwords for public applicants
- Expose any admin, review, or internal endpoints to the public portal
- Add new backend API endpoints without explicit instruction — the backend is built
- Use any UI component library that requires a paid license
- Build any features beyond the three jobs listed above

---

## 1) IDENTITY MODEL — No Accounts, Just Applications

Citizens are NOT "users" of this system. They are applicants. Do NOT build a login/registration flow.

### How Applicants Access Their Application:

**On first visit:**
1. Applicant starts a new application
2. System generates a 12-character **Application Reference Code** (e.g., `WVSNP-A7K2-M9X4`)
   - Format: `WVSNP-{4 alphanumeric}-{4 alphanumeric}` (uppercase, no ambiguous chars: no 0/O, 1/I/L)
   - Generated client-side (offline-capable)
3. Applicant provides their **email address** (required) and **phone number** (optional)
4. System sends a confirmation email with the reference code and a magic link
5. Application is associated with the reference code, NOT with an "account"

**On return visit (resume or status check):**
- **Option 1:** Click the magic link from their email → goes directly to their application
- **Option 2:** Enter Reference Code + last 4 digits of phone OR email address on file → retrieves application
- Magic links expire after 30 days. Reference codes are permanent for the life of the grant cycle.

**Why this approach:**
- Zero friction — no passwords to remember or reset
- Accessible to populations with low tech literacy
- Reference code can be read over the phone to a WVDA helpline agent
- No PII stored beyond what's needed for the application itself

### How Non-Platform Participants Access Reporting:

Vets and grantee orgs who need to report use a **separate identity path** — see Section 4 (Reporting Portal) for details. They are NOT applicants and should not be funneled through the application flow.

---

## 2) JOB 1 — APPLICATION FORM FLOW (Multi-Step Wizard)

The application is a sequential wizard. Each step saves automatically on completion (not on every keystroke — that's too chatty for slow connections).

### Step 1: Eligibility Screening (Gate — must pass to continue)
- County of residence (dropdown — all 55 WV counties)
- Confirmation: "Do you currently own or are you the primary caretaker of a dog or cat?" (Yes/No)
- Income qualification question (per program rules — defer to WVDA eligibility criteria)
- **If ineligible:** Show a clear, kind message explaining why and listing alternative resources. Do NOT dead-end them.

### Step 2: Applicant Information
- Full legal name
- Mailing address (WV addresses — validate state = WV)
- Email address (pre-filled if provided in Step 1)
- Phone number (optional but encouraged)
- Preferred contact method (email / phone / mail)

### Step 3: Animal Information
- How many animals need service? (1–5 per application, per program rules)
- For each animal:
  - Species (Dog / Cat)
  - Name
  - Approximate age
  - Sex (Male / Female)
  - Breed (free text — do NOT use a breed dropdown, people don't always know)
  - Spay/neuter status (Already spayed/neutered = ineligible for that animal — show message, allow removing)
  - Has the animal been seen by a vet in the last 12 months? (Yes / No / Unsure)
  - Microchip number (optional — if they know it)

### Step 4: Veterinarian Selection
- Show participating vets near the applicant's county
  - Pull from the existing enrolled vet data (VET_ENROLLED events)
  - Display: Vet name, clinic name, city, phone number
  - Allow "No preference" selection
- If no participating vets in their county: show nearest options + message about the program working to expand coverage

### Step 5: Supporting Evidence Upload
- Required: Proof of income qualification (upload document)
- Optional: Photo of animal(s)
- Upload requirements:
  - Max file size: 10MB per file
  - Accepted formats: JPG, PNG, PDF
  - Progress indicator with percentage
  - **Chain of Custody:** Client computes SHA-256 hash before upload. Hash is sent alongside the file. Server verifies hash matches received bytes. Hash is recorded in the `EVIDENCE_UPLOADED` event payload. Display the hash to the applicant as a "receipt fingerprint."
- Allow "I'll upload later" — application can be submitted without evidence, but status shows "Evidence Pending"

### Step 6: Review & Submit
- Summary of all entered information (read-only display)
- Checkbox: "I certify that the information provided is true and accurate to the best of my knowledge"
- **Submit button** — emits `APPLICATION_SUBMITTED` event via the existing API
- Post-submit screen:
  - "Your application has been submitted!"
  - Reference code displayed prominently (large font, copy button)
  - "Save this code — you'll need it to check your status"
  - Estimated review timeline
  - Link to status check page

### Auto-Save Behavior:
- Each completed step is saved via the API immediately
- If the applicant closes and returns, they resume at the last incomplete step
- Saved data persists for the life of the grant cycle
- Show a "Last saved: [timestamp]" indicator so applicants know their work isn't lost

---

## 3) JOB 2 — STATUS CHECK PAGE

Accessible without going through the application flow.

**URL:** `/status`

**Input:** Reference Code + email address on file (or last 4 of phone)

**Display:**
```
Application: WVSNP-A7K2-M9X4
Submitted: January 15, 2026
Status: Under Review

Timeline:
  ✅ Application Received — Jan 15, 2026
  ✅ Evidence Verified — Jan 18, 2026
  🔄 Administrative Review — In Progress
  ⬚ Voucher Issuance — Pending
  ⬚ Veterinary Service — Pending
  ⬚ Service Confirmed — Pending
```

**Status values** (mapped from internal event types — do NOT expose internal event names):
| Internal Event | Public Status | Display Text |
|----------------|---------------|-------------|
| APPLICATION_SUBMITTED | received | Application Received |
| EVIDENCE_UPLOADED | evidence_received | Evidence Received |
| EVIDENCE_VERIFIED | evidence_verified | Evidence Verified |
| APPLICATION_UNDER_REVIEW | in_review | Under Review |
| APPLICATION_APPROVED | approved | Approved — Voucher Being Issued |
| VOUCHER_ISSUED | voucher_issued | Voucher Issued (check email for details) |
| CLAIM_SUBMITTED | service_reported | Veterinary Service Reported |
| CLAIM_APPROVED | service_confirmed | Service Confirmed — Complete |
| APPLICATION_DENIED | denied | Not Approved (see details below) |
| APPLICATION_RETURNED | returned | Action Needed (see details below) |

**For denied/returned:** Show the reason in plain language (mapped from internal codes to human-readable text). Include WVDA contact info for questions or appeals.

**For voucher_issued status:** Display:
- Voucher code (or partial code for security)
- Selected veterinarian's name and phone number
- Voucher expiration date
- "Contact your selected veterinarian to schedule your appointment"

---

## 4) JOB 3 — REPORTING PORTAL (Non-Platform Participants)

### The Problem This Solves

When a vet uses VetOS, service completion reports flow in automatically. When a grantee org uses ShelterOS, matching fund reports flow in automatically. But not everyone uses those platforms. The WVSNP still needs:

- **Non-VetOS vets** to confirm they performed the spay/neuter service
- **Non-ShelterOS grantee organizations** to report matching fund contributions and program outcomes

Without this, the system has a gap between "voucher issued" and "service confirmed" for any participant outside the PET COMMAND ecosystem.

### Identity Model for Reporters

Reporters ARE identified participants — unlike anonymous citizen applicants, these are veterinarians and organizations that have a relationship with the program. They were enrolled via `VET_ENROLLED` or `GRANT_ALLOCATED` events.

**Access method:**
1. When a vet or grantee org is enrolled in the WVSNP program, WVDA issues them a **Participant Code** (e.g., `VET-WV-3847` or `ORG-WV-0092`)
   - Generated during enrollment, delivered via email from WVDA
   - Format: `{VET|ORG}-WV-{4 digits}`
2. To access the reporting portal, participant enters:
   - Participant Code
   - Email address on file (the one from enrollment)
3. System validates the code + email against enrolled participant records
4. On successful validation, system sends a **time-limited magic link** (expires 24 hours) to the email on file
5. Clicking the link opens their reporting dashboard

**Why magic links (not passwords):**
- Small rural vet offices don't need another password
- The link goes to the email WVDA already has on file — this IS the identity verification
- 24-hour expiry is short because these sessions involve financial data

### Vet Service Completion Report

**URL:** `/report/service` (accessible only via magic link)

**What the vet sees after authentication:**
- Their practice info (read-only, pulled from enrollment data)
- A list of **outstanding vouchers** assigned to their practice that haven't been claimed yet
  - Voucher code, animal species, applicant name (first name + last initial only)
  - Issued date, expiration date

**To report a completed service, vet selects a voucher and provides:**
- Date of service (`occurredAt` — business truth)
- Procedure performed (Spay / Neuter — must match voucher type)
- Animal weight at time of service
- Complications (None / Minor / Major — if Major, free text description required)
- Additional services performed beyond the voucher (free text, optional)
- Vet's signature attestation: "I certify that the above procedure was performed at my facility"

**On submit:** Emits `CLAIM_SUBMITTED` event with the vet's participant code as the `claimantId`. This flows into the existing claim approval pipeline — an admin still reviews and approves it.

**What the vet CANNOT do:**
- See applicant PII beyond first name + last initial
- Modify voucher amounts
- Approve their own claims
- See any data outside their own practice's vouchers

### Grantee Organization Outcome Report

**URL:** `/report/outcomes` (accessible only via magic link)

**What the grantee org sees after authentication:**
- Their organization info (read-only)
- Current grant allocation and balance
- Reporting deadline for the current cycle

**To submit a periodic outcome report, the org provides:**
- Reporting period (start date – end date)
- Matching funds contributed this period
  - Amount (in dollars)
  - Source description (e.g., "County general fund", "Private donation from XYZ Foundation")
  - Supporting documentation upload (same Chain of Custody protocol as evidence uploads — SHA-256 hash computed client-side, verified server-side, recorded in event)
- Animals served this period (count by species: dogs / cats)
- Program narrative (free text, max 2000 chars — brief description of activities and outcomes)
- Attestation: "I certify that the above information is accurate and that matching funds were used in accordance with grant terms"

**On submit:** Emits `MATCHING_FUNDS_REPORTED` event (ties into the reconciliation pipeline from Phase 4).

**What the org CANNOT do:**
- See individual applicant data
- Modify their grant allocation
- View other organizations' data
- Submit reports for periods outside their grant term

---

## 5) TECHNICAL REQUIREMENTS

### Offline Resilience
- Form state saves to localStorage/IndexedDB as the applicant types
- If connection drops mid-step, data is preserved locally
- On reconnection, sync local state to the API
- The Reference Code is generated client-side (no server round-trip needed to start an application)

### Accessibility
- WCAG 2.1 AA compliance minimum
- All form fields have proper labels and aria attributes
- Error messages are associated with their fields
- Tab navigation works through the entire wizard
- Screen reader tested (or at minimum, structured for screen reader compatibility)
- Color is never the only indicator of state (use icons + text alongside color)

### Performance
- Initial page load under 3 seconds on 3G connection
- No unnecessary JavaScript bundles — code-split by wizard step
- Images lazy-loaded
- Evidence upload uses chunked upload with resume capability (for large files on slow connections)

### Evidence & Document Upload — Chain of Custody Protocol
This applies to ALL uploads across the portal (applicant evidence AND grantee org documentation):
```
1. Client selects file
2. Client computes SHA-256 hash of file bytes (Web Crypto API)
3. Client displays hash to uploader: "Document fingerprint: a1b2c3..."
4. Client uploads file + hash to the appropriate API endpoint
5. Server receives file, independently computes SHA-256
6. Server compares client hash vs server hash
7. If match → accept, record hash in the relevant event payload
8. If mismatch → reject upload, ask uploader to retry
9. Uploader sees "Upload verified ✓" with matching fingerprint
```

---

## 6) WHAT NOT TO BUILD

- **No admin features.** The public portal does not show reviewer dashboards, approval workflows, or any admin functionality.
- **No payment processing.** Vouchers are issued through the existing grant management flow, not through the portal.
- **No chat or messaging.** Contact info (phone, email) for WVDA is displayed statically.
- **No notification system beyond email.** The API handles email dispatch; the portal just tells people to check their email.
- **No analytics dashboard.** Usage analytics are a separate concern.
- **No cross-participant data visibility.** Vets see only their vouchers. Orgs see only their grants. Applicants see only their applications.
- **No data from ShelterOS, VetOS, or Mayday.** The WVSNP GMS consumes data from those systems internally. None of it surfaces in this portal.

---

## 7) NAVIGATION STRUCTURE

```
wvsnp-portal.wv.gov (or similar)
│
├── /                       # Landing page
│   ├── "Apply for a Voucher" → /apply/eligibility
│   ├── "Check Application Status" → /status
│   └── "Program Participant Reporting" → /report
│
├── /apply/                 # APPLICATION WIZARD (Job 1)
│   ├── /eligibility        # Step 1: Screening gate
│   ├── /applicant          # Step 2: Personal info
│   ├── /animals            # Step 3: Animal info
│   ├── /veterinarian       # Step 4: Vet selection
│   ├── /evidence           # Step 5: Document upload
│   ├── /review             # Step 6: Review & submit
│   └── /confirmation       # Post-submit success page
│
├── /status                 # STATUS CHECK (Job 2)
│   └── /status/{refCode}   # Direct link to specific application
│
├── /report/                # REPORTING PORTAL (Job 3)
│   ├── /report/login       # Participant code + email → magic link
│   ├── /report/service     # Vet service completion form
│   └── /report/outcomes    # Grantee org outcome reporting
│
└── /resume/{token}         # Magic link landing (applicants)
```

---

## 8) FILE STRUCTURE

```
wvsnp-public-portal/
├── src/
│   ├── pages/
│   │   ├── index.tsx                    # Landing — three clear paths
│   │   ├── apply/
│   │   │   ├── eligibility.tsx          # Step 1
│   │   │   ├── applicant.tsx            # Step 2
│   │   │   ├── animals.tsx              # Step 3
│   │   │   ├── veterinarian.tsx         # Step 4
│   │   │   ├── evidence.tsx             # Step 5
│   │   │   ├── review.tsx               # Step 6
│   │   │   └── confirmation.tsx         # Post-submit
│   │   ├── status.tsx                   # Status check
│   │   ├── resume.tsx                   # Magic link landing (applicants)
│   │   └── report/
│   │       ├── login.tsx                # Participant authentication
│   │       ├── service.tsx              # Vet service completion
│   │       └── outcomes.tsx             # Grantee org reporting
│   ├── components/
│   │   ├── wizard/                      # Step navigation, progress bar
│   │   ├── forms/                       # Shared form components
│   │   ├── upload/                      # Evidence upload with hash verification
│   │   ├── status/                      # Status timeline display
│   │   └── report/                      # Reporting-specific components
│   ├── lib/
│   │   ├── api-client.ts               # HTTP client for /api/v1/public/*
│   │   ├── reference-code.ts           # Client-side application code generation
│   │   ├── hash.ts                      # SHA-256 computation (Web Crypto API)
│   │   └── offline-store.ts            # IndexedDB persistence
│   └── constants/
│       ├── counties.ts                  # All 55 WV counties
│       ├── status-mapping.ts           # Internal events → public status text
│       └── eligibility-rules.ts        # Screening logic
```

---

## 9) BACKEND API NOTES

The application wizard and status check use the **existing** `/api/v1/public/applications/*` endpoints. Do not add new endpoints for those.

The reporting portal (Job 3) **will require new endpoints** that do not currently exist:

```
POST   /api/v1/public/report/auth           # Validate participant code + email, send magic link
GET    /api/v1/public/report/auth/{token}    # Validate magic link token, return session
GET    /api/v1/public/report/vouchers        # List outstanding vouchers for authenticated vet
POST   /api/v1/public/report/service         # Submit service completion (emits CLAIM_SUBMITTED)
GET    /api/v1/public/report/grant-summary   # Get grant balance + deadline for authenticated org
POST   /api/v1/public/report/outcomes        # Submit outcome report (emits MATCHING_FUNDS_REPORTED)
```

These endpoints must:
- Authenticate via magic link token (short-lived, tied to participant code)
- Scope all queries to the authenticated participant only (vet sees only their vouchers, org sees only their grant)
- Emit events through the existing EventStore — same event envelope, same doctrine compliance
- Never expose data across participant boundaries

**Flag for discussion:** These new endpoints should be designed and reviewed before Windsurf implements them. They touch the trust boundary between public internet and the event ledger.

---

## 10) COMPLETION GATE

### Application Wizard (Job 1)
- [ ] All 6 steps complete and successfully call the submission API
- [ ] Eligibility screening prevents ineligible applicants (with kind message + resources)
- [ ] Evidence upload computes and verifies SHA-256 hash end-to-end
- [ ] Auto-save preserves form state across browser close/reopen
- [ ] Reference code generated client-side, displayed prominently post-submit

### Status Check (Job 2)
- [ ] Reference code + email/phone lookup retrieves correct application
- [ ] Status timeline displays all states correctly with human-readable text
- [ ] Denied/returned applications show reason + WVDA contact info
- [ ] Voucher-issued status shows vet info and scheduling instructions

### Reporting Portal (Job 3)
- [ ] Participant code + email validation works
- [ ] Magic link authentication flow works end-to-end
- [ ] Vet sees only their own outstanding vouchers
- [ ] Service completion form emits CLAIM_SUBMITTED with correct payload
- [ ] Grantee org sees only their own grant data
- [ ] Outcome report form emits MATCHING_FUNDS_REPORTED with correct payload
- [ ] Document uploads use Chain of Custody protocol (SHA-256)
- [ ] No cross-participant data leakage

### Cross-Cutting
- [ ] All forms mobile-responsive (test at 375px width minimum)
- [ ] No admin endpoints accessible from the public portal
- [ ] `tsc --noEmit` → zero errors
- [ ] Offline form persistence works (close browser, reopen, data intact)
