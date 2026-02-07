# WINDSURF_03A — Phase 4 Conformance Test Fixture Recipe

**System:** ShelterOS Grant Management Module (WVSNP)
**Purpose:** Exact minimal event sequences for all 14 Phase 4 conformance tests.
**Rule:** NO MOCKS for core domain logic. Real events → real projections → real assertions.
**Stubs allowed ONLY for:** Wall-clock time (`Date.now()` / `new Date()`), if the repo already has a time provider.

---

## SHARED TEST UNIVERSE

Every test draws from this shared set of identifiers. Use these exact values so tests are readable and cross-referenceable.

### Fixed Identifiers (Constants)

```typescript
// ── Org & Cycle ──────────────────────────────────────────
const ORG_ID          = '00000000-aaaa-4000-8000-000000000001'; // orgId
const GRANT_CYCLE_ID  = 'FY2026';                               // VARCHAR(20)
const PERIOD_START    = '2025-07-01';
const PERIOD_END      = '2026-06-30';

// ── Grants ───────────────────────────────────────────────
const GRANT_A_ID      = '00000000-bbbb-4000-8000-000000000001'; // $10,000 allocation
const GRANT_B_ID      = '00000000-bbbb-4000-8000-000000000002'; // $5,000 allocation

// ── Participating Vets ───────────────────────────────────
const VET_ALPHA_ID    = '00000000-cccc-4000-8000-000000000001';
const VET_BETA_ID     = '00000000-cccc-4000-8000-000000000002';

// ── Vouchers ─────────────────────────────────────────────
const VOUCHER_1_ID    = '00000000-dddd-4000-8000-000000000001'; // $75  — normal
const VOUCHER_2_ID    = '00000000-dddd-4000-8000-000000000002'; // $75  — normal
const VOUCHER_3_ID    = '00000000-dddd-4000-8000-000000000003'; // $100 — will be VOIDED
const VOUCHER_4_ID    = '00000000-dddd-4000-8000-000000000004'; // $75  — post-close attempt (should fail)

// ── Claims ───────────────────────────────────────────────
const CLAIM_1_ID      = '00000000-eeee-4000-8000-000000000001'; // redeems VOUCHER_1
const CLAIM_2_ID      = '00000000-eeee-4000-8000-000000000002'; // redeems VOUCHER_2

// ── Invoices ─────────────────────────────────────────────
const INVOICE_1_ID    = '00000000-ffff-4000-8000-000000000001'; // VET_ALPHA batch
const INVOICE_2_ID    = '00000000-ffff-4000-8000-000000000002'; // VET_BETA batch

// ── OASIS Export ─────────────────────────────────────────
const BATCH_1_ID      = '00000000-1111-4000-8000-000000000001';

// ── Closeout ─────────────────────────────────────────────
const CLOSEOUT_ID     = '00000000-2222-4000-8000-000000000001';

// ── Tracing ──────────────────────────────────────────────
const CORRELATION_ID  = '00000000-9999-4000-8000-000000000001';
// causationId = the eventId of the prior event in the chain
```

### Event Factory Helper

Every test should use a helper that stamps the mandatory envelope fields. Do NOT let Windsurf skip any of these.

```typescript
function makeEvent(overrides: Partial<DomainEvent>): DomainEvent {
  const eventId = crypto.randomUUID(); // UUIDv7 in prod; UUIDv4 fine in tests
  return {
    eventId,
    orgId:         ORG_ID,
    grantCycleId:  GRANT_CYCLE_ID,
    correlationId: CORRELATION_ID,
    causationId:   overrides.causationId ?? eventId, // self-caused if first in chain
    occurredAt:    overrides.occurredAt ?? new Date().toISOString(),
    ingestedAt:    new Date().toISOString(), // always server-stamped
    ...overrides,
  };
}
```

### Money Convention

All dollar amounts are stored as **integer cents** (bigint in the ledger, number in test fixtures for readability). The `Money` type wraps this.

```
$75.00  → 7500
$100.00 → 10000
$5000   → 500000
$10000  → 1000000
```

---

## BASELINE EVENT SEQUENCE

Tests 1, 3, 10, 11, 12, 13, and 14 all need a "warm" system state. Rather than repeating setup in every test, define a shared **baseline sequence** that each test can load, then add its specific events on top.

Insert these events **in this order** into `event_log`:

```
Event #  | event_type                | Key Payload
---------|---------------------------|--------------------------------------------
E01      | GRANT_CYCLE_OPENED        | { grantCycleId: 'FY2026', periodStart, periodEnd }
E02      | GRANT_ALLOCATED           | { grantId: GRANT_A_ID, amountCents: 1000000, granteeOrgId: ... }
E03      | GRANT_ALLOCATED           | { grantId: GRANT_B_ID, amountCents: 500000, granteeOrgId: ... }
E04      | VET_ENROLLED              | { vetId: VET_ALPHA_ID, grantId: GRANT_A_ID }
E05      | VET_ENROLLED              | { vetId: VET_BETA_ID, grantId: GRANT_B_ID }
E06      | VOUCHER_ISSUED            | { voucherId: VOUCHER_1_ID, grantId: GRANT_A_ID, amountCents: 7500, vetId: VET_ALPHA_ID }
E07      | VOUCHER_ISSUED            | { voucherId: VOUCHER_2_ID, grantId: GRANT_B_ID, amountCents: 7500, vetId: VET_BETA_ID }
E08      | VOUCHER_ISSUED            | { voucherId: VOUCHER_3_ID, grantId: GRANT_A_ID, amountCents: 10000, vetId: VET_ALPHA_ID }
E09      | CLAIM_SUBMITTED           | { claimId: CLAIM_1_ID, voucherId: VOUCHER_1_ID, amountCents: 7500, vetId: VET_ALPHA_ID }
E10      | CLAIM_APPROVED            | { claimId: CLAIM_1_ID }
E11      | CLAIM_SUBMITTED           | { claimId: CLAIM_2_ID, voucherId: VOUCHER_2_ID, amountCents: 7500, vetId: VET_BETA_ID }
E12      | CLAIM_APPROVED            | { claimId: CLAIM_2_ID }
E13      | VOUCHER_VOIDED            | { voucherId: VOUCHER_3_ID, reason: 'Duplicate issuance' }
E14      | INVOICE_GENERATED         | { invoiceId: INVOICE_1_ID, vetId: VET_ALPHA_ID, grantCycleId: 'FY2026', claims: [CLAIM_1_ID], totalCents: 7500 }
E15      | INVOICE_GENERATED         | { invoiceId: INVOICE_2_ID, vetId: VET_BETA_ID, grantCycleId: 'FY2026', claims: [CLAIM_2_ID], totalCents: 7500 }
```

**After projections rebuild on this baseline:**
- 3 vouchers issued (1 voided)
- 2 claims approved
- 2 invoices generated
- Total active disbursement: $150.00 (7500 + 7500)
- Voided amount: $100.00 (VOUCHER_3, excluded from totals)

---

## TEST-BY-TEST FIXTURE RECIPES

---

### TEST 1: Control Totals Match Between Batch and Individual Records

**Goal:** The OASIS export batch's summary totals must exactly equal the sum of individual line items.

**Setup:** Baseline events E01–E15, then:

```
E16  | OASIS_BATCH_INITIATED     | { batchId: BATCH_1_ID, grantCycleId: 'FY2026', periodStart, periodEnd }
E17  | OASIS_FILE_RENDERED        | { batchId: BATCH_1_ID, sha256: '<computed>', lineCount: 2, controlTotalCents: 15000 }
```

**Assertion:**
```typescript
// Fetch batch projection
const batch = await getBatchProjection(BATCH_1_ID);

// Fetch individual invoice line items included in this batch
const lines = await getInvoiceLinesForBatch(BATCH_1_ID);
const lineSum = lines.reduce((sum, l) => sum + l.amountCents, 0);

expect(batch.controlTotalCents).toBe(15000);
expect(batch.lineCount).toBe(2);
expect(lineSum).toBe(batch.controlTotalCents);  // THE CRITICAL ASSERTION
expect(lines.length).toBe(batch.lineCount);
```

**What this catches:** Off-by-one in line counting, voided records leaking into totals, rounding errors in Money aggregation.

---

### TEST 3: Fixed-Width Output Matches OASIS Spec

**Goal:** The rendered export file has correct field widths, padding, and alignment per the OASIS fixed-width format spec.

**Setup:** Baseline E01–E15 + batch events E16–E17 (same as Test 1).

**Assertion:**
```typescript
const rendered = await renderOasisFile(BATCH_1_ID);
const lines = rendered.split('\n').filter(l => l.length > 0);

// Header record (line 0)
expect(lines[0].length).toBe(OASIS_RECORD_LENGTH); // e.g., 200 chars
expect(lines[0].substring(0, 5)).toBe('WVSNP');    // Program code, left-aligned
expect(lines[0].substring(5, 25)).toBe('FY2026'.padEnd(20)); // Cycle ID

// Detail records (lines 1–N)
for (const detail of lines.slice(1, -1)) {
  expect(detail.length).toBe(OASIS_RECORD_LENGTH);
  // Amount field: right-justified, zero-padded, 10 chars
  const amountField = detail.substring(AMOUNT_OFFSET, AMOUNT_OFFSET + 10);
  expect(amountField).toMatch(/^\d{10}$/);  // No spaces, no decimals
}

// Trailer record (last line)
const trailer = lines[lines.length - 1];
expect(trailer.length).toBe(OASIS_RECORD_LENGTH);
// Control total in trailer must match batch controlTotalCents
const trailerTotal = parseInt(trailer.substring(TRAILER_TOTAL_OFFSET, TRAILER_TOTAL_OFFSET + 12));
expect(trailerTotal).toBe(15000);
```

**NOTE:** The exact field offsets (`AMOUNT_OFFSET`, `TRAILER_TOTAL_OFFSET`, `OASIS_RECORD_LENGTH`) must come from the OASIS format spec constant file. If those constants don't exist yet, create them in a `oasis-format.ts` constants file. Do NOT hardcode magic numbers in the test.

---

### TEST 4: Closeout Lock Prevents Vouchers (Validates Step 4 Fix)

**Goal:** After `GRANT_CYCLE_CLOSED`, voucher issuance is blocked.

**Setup:** Baseline E01–E15, then:

```
E16  | GRANT_PERIOD_ENDED         | { grantCycleId: 'FY2026' }
E17  | PREFLIGHT_COMPLETED        | { closeoutId: CLOSEOUT_ID, grantCycleId: 'FY2026', checks: [...] }
E18  | GRANT_CYCLE_CLOSED         | { grantCycleId: 'FY2026', closeoutId: CLOSEOUT_ID }
```

**Assertion:**
```typescript
// Attempt to issue VOUCHER_4 AFTER cycle close
await expect(
  issueVoucher({
    voucherId: VOUCHER_4_ID,
    grantId: GRANT_A_ID,
    amountCents: 7500,
    vetId: VET_ALPHA_ID,
    grantCycleId: GRANT_CYCLE_ID,
  })
).rejects.toThrow('GRANT_CYCLE_CLOSED');

// Verify no VOUCHER_ISSUED event was appended
const postCloseVouchers = await queryEventLog({
  eventType: 'VOUCHER_ISSUED',
  afterEventId: E18.eventId,
});
expect(postCloseVouchers).toHaveLength(0);
```

**What this catches:** The exact bug from BUG 4 — missing guard in `grant-service.ts`.

---

### TEST 5: Audit Hold Pauses Closeout Timeline

**Goal:** When an audit hold is placed, the closeout state machine stops advancing.

**Setup:** Baseline E01–E15, then:

```
E16  | GRANT_PERIOD_ENDED         | { grantCycleId: 'FY2026' }
E17  | PREFLIGHT_COMPLETED        | { closeoutId: CLOSEOUT_ID, grantCycleId: 'FY2026' }
E18  | AUDIT_HOLD_PLACED          | { closeoutId: CLOSEOUT_ID, reason: 'WVDA desk review', placedBy: 'auditor-001' }
```

**Assertion:**
```typescript
const closeout = await getCloseoutProjection(CLOSEOUT_ID);
expect(closeout.status).toBe('AUDIT_HOLD');

// Attempt to advance to RECONCILIATION while on hold
await expect(
  initiateReconciliation({ closeoutId: CLOSEOUT_ID, grantCycleId: GRANT_CYCLE_ID })
).rejects.toThrow(); // Exact error string depends on your state machine — match it

// Verify closeout status hasn't changed
const closeoutAfter = await getCloseoutProjection(CLOSEOUT_ID);
expect(closeoutAfter.status).toBe('AUDIT_HOLD');
```

---

### TEST 6: Audit Resolve Resumes Closeout Timeline

**Goal:** After audit hold is resolved, the closeout can proceed.

**Setup:** Same as Test 5, plus:

```
E19  | AUDIT_HOLD_RESOLVED        | { closeoutId: CLOSEOUT_ID, resolution: 'No findings', resolvedBy: 'auditor-001' }
```

**Assertion:**
```typescript
const closeout = await getCloseoutProjection(CLOSEOUT_ID);
expect(closeout.status).not.toBe('AUDIT_HOLD');
// Status should now be whatever comes after PREFLIGHT in the state machine
// (likely 'READY_FOR_RECONCILIATION' or similar — match your state machine)

// Reconciliation should now succeed
await expect(
  initiateReconciliation({ closeoutId: CLOSEOUT_ID, grantCycleId: GRANT_CYCLE_ID })
).resolves.not.toThrow();
```

---

### TEST 7: Deadline Enforcement Blocks Operations After GRANT_PERIOD_ENDED

**Goal:** After the grant period ends, new voucher issuance is blocked even WITHOUT a full cycle close.

**Setup:** Baseline E01–E05 only (no vouchers issued yet), then:

```
E06  | GRANT_PERIOD_ENDED         | { grantCycleId: 'FY2026', occurredAt: '2026-06-30T23:59:59Z' }
```

**Assertion:**
```typescript
// Attempt to issue a voucher after period end but before cycle close
await expect(
  issueVoucher({
    voucherId: VOUCHER_1_ID,
    grantId: GRANT_A_ID,
    amountCents: 7500,
    vetId: VET_ALPHA_ID,
    grantCycleId: GRANT_CYCLE_ID,
  })
).rejects.toThrow('GRANT_PERIOD_ENDED');
```

**Why this is separate from Test 4:** Test 4 validates the `GRANT_CYCLE_CLOSED` guard (BUG 4 fix). Test 7 validates the pre-existing `GRANT_PERIOD_ENDED` guard. Both must work independently.

---

### TEST 10: Voided Records Excluded From Export Totals

**Goal:** VOUCHER_3 ($100) was voided. It must NOT appear in OASIS export line items or control totals.

**Setup:** Baseline E01–E15 + batch events E16–E17 (same as Test 1).

**Assertion:**
```typescript
const rendered = await renderOasisFile(BATCH_1_ID);
const detailLines = parseOasisDetailRecords(rendered);

// Only 2 detail lines (VOUCHER_1 and VOUCHER_2 claims), NOT 3
expect(detailLines).toHaveLength(2);

// No line references VOUCHER_3
const voucher3Lines = detailLines.filter(l => l.voucherId === VOUCHER_3_ID);
expect(voucher3Lines).toHaveLength(0);

// Control total is $150.00 (7500 + 7500), NOT $250.00
const batch = await getBatchProjection(BATCH_1_ID);
expect(batch.controlTotalCents).toBe(15000); // NOT 25000
```

---

### TEST 11: Matching Funds Reconciliation — Correct Shortfall + Surplus

**Goal:** Shortfall clamps to zero when grantee over-reports. Surplus captures the overage.

**Setup:** Baseline E01–E15 + closeout start, then matching funds reports:

```
E16  | GRANT_PERIOD_ENDED             | { grantCycleId: 'FY2026' }
E17  | PREFLIGHT_COMPLETED            | { closeoutId: CLOSEOUT_ID, grantCycleId: 'FY2026' }
E18  | MATCHING_FUNDS_COMMITTED       | { grantId: GRANT_A_ID, committedCents: 200000 }  // $2,000 committed
E19  | MATCHING_FUNDS_COMMITTED       | { grantId: GRANT_B_ID, committedCents: 100000 }  // $1,000 committed
E20  | MATCHING_FUNDS_REPORTED        | { grantId: GRANT_A_ID, reportedCents: 150000 }   // $1,500 reported (SHORTFALL: $500)
E21  | MATCHING_FUNDS_REPORTED        | { grantId: GRANT_B_ID, reportedCents: 120000 }   // $1,200 reported (SURPLUS: $200)
```

**Assertion:**
```typescript
const recon = await runReconciliation({ closeoutId: CLOSEOUT_ID, grantCycleId: GRANT_CYCLE_ID });

// GRANT_A: committed $2000, reported $1500 → shortfall $500, surplus $0
const grantA = recon.grantResults.find(g => g.grantId === GRANT_A_ID);
expect(grantA.shortfallCents).toBe(50000);
expect(grantA.surplusCents).toBe(0);

// GRANT_B: committed $1000, reported $1200 → shortfall $0, surplus $200
const grantB = recon.grantResults.find(g => g.grantId === GRANT_B_ID);
expect(grantB.shortfallCents).toBe(0);      // CLAMPED — this was the BUG 6 crash
expect(grantB.surplusCents).toBe(20000);     // Surplus captured, not discarded

// Totals
expect(recon.totalShortfallCents).toBe(50000);
expect(recon.totalSurplusCents).toBe(20000);
```

**What this catches:** BUG 6 — `Money.fromBigInt(negative)` crash when reported > committed.

---

### TEST 12: Activity Summary Counts Are Accurate (Not Placeholder Zeros)

**Goal:** The closeout activity summary reflects real counts, not the hardcoded zeros from the current placeholder.

**Setup:** Baseline E01–E15 + closeout start (E16–E17 from Test 11).

**Assertion:**
```typescript
const summary = await getActivitySummary({ closeoutId: CLOSEOUT_ID, grantCycleId: GRANT_CYCLE_ID });

expect(summary.totalVouchersIssued).toBe(3);       // E06, E07, E08
expect(summary.totalVouchersVoided).toBe(1);        // E13 (VOUCHER_3)
expect(summary.totalVouchersActive).toBe(2);         // 3 issued - 1 voided
expect(summary.totalClaimsSubmitted).toBe(2);        // E09, E11
expect(summary.totalClaimsApproved).toBe(2);         // E10, E12
expect(summary.totalInvoicesGenerated).toBe(2);      // E14, E15
expect(summary.totalDisbursementCents).toBe(15000);  // $75 + $75 (voided excluded)
```

---

### TEST 13: Genesis Rebuild Produces Identical Projections

**Goal:** Drop all projection tables, rebuild from the full event log, and get identical state.

**Setup:** Baseline E01–E15 + any additional events needed to have meaningful projection state (use the full set from Test 11: E16–E21).

**Procedure:**
```typescript
// 1. Snapshot current projection state
const before = {
  grantBalances:  await snapshot('grant_balances_projection'),
  claims:         await snapshot('claims_projection'),
  invoices:       await snapshot('invoices_projection'),
  vouchers:       await snapshot('vouchers_projection'),  // if exists
  oasisBatches:   await snapshot('oasis_export_batches_projection'),
  closeout:       await snapshot('grant_cycle_closeout_projection'),
};

// 2. Drop all projection tables (or TRUNCATE — whichever rebuild.ts expects)
await dropAllProjections();

// 3. Rebuild from event_log genesis
await rebuildAllProjections();

// 4. Snapshot again
const after = {
  grantBalances:  await snapshot('grant_balances_projection'),
  claims:         await snapshot('claims_projection'),
  invoices:       await snapshot('invoices_projection'),
  vouchers:       await snapshot('vouchers_projection'),
  oasisBatches:   await snapshot('oasis_export_batches_projection'),
  closeout:       await snapshot('grant_cycle_closeout_projection'),
};

// 5. Deep equality — row-for-row, column-for-column
//    Exclude ingestedAt columns (system time, non-deterministic)
expect(stripIngestedAt(after.grantBalances)).toEqual(stripIngestedAt(before.grantBalances));
expect(stripIngestedAt(after.claims)).toEqual(stripIngestedAt(before.claims));
expect(stripIngestedAt(after.invoices)).toEqual(stripIngestedAt(before.invoices));
expect(stripIngestedAt(after.oasisBatches)).toEqual(stripIngestedAt(before.oasisBatches));
expect(stripIngestedAt(after.closeout)).toEqual(stripIngestedAt(before.closeout));
```

**Critical:** The `stripIngestedAt` helper must remove `ingestedAt` / `ingested_at` columns from comparison because they are system-time (Trust Doctrine — these will differ between original write and rebuild). `occurredAt` MUST be identical.

---

### TEST 14: Replay Determinism — Same Events → Same Output Hash

**Goal:** Running the OASIS export twice on the same event log produces byte-identical output.

**Setup:** Baseline E01–E15 + batch events.

**Procedure:**
```typescript
// Run 1
const batch1Events = [...baselineEvents, ...batchInitEvents];
await insertEvents(batch1Events);
await rebuildAllProjections();
const output1 = await renderOasisFile(BATCH_1_ID);
const hash1 = crypto.createHash('sha256').update(output1).digest('hex');

// Wipe and replay
await dropAllProjections();
await truncateEventLog();
await insertEvents(batch1Events);  // Same events, same order
await rebuildAllProjections();
const output2 = await renderOasisFile(BATCH_1_ID);
const hash2 = crypto.createHash('sha256').update(output2).digest('hex');

// Byte-identical
expect(hash1).toBe(hash2);
expect(output1).toBe(output2); // Belt AND suspenders
```

**What this catches:** BUG 5 (`Date.now()` in batch codes), BUG 10 (dummy watermarks changing between runs), and any other nondeterministic seed.

---

### EXTRA TEST: batchCode Determinism (Validates Step 6)

**Goal:** The batch code is identical across replays.

**Setup:** Same as Test 14.

**Assertion:**
```typescript
// After first render
const batch1 = await getBatchProjection(BATCH_1_ID);
const code1 = batch1.batchCode;

// After wipe + replay
const batch2 = await getBatchProjection(BATCH_1_ID);
const code2 = batch2.batchCode;

expect(code1).toBe(code2);
expect(code1).not.toContain(String(Date.now()).substring(0, 8)); // No timestamp fragments
expect(code1).toMatch(/^WVSNP-FY2026-/); // Correct prefix
```

---

## TESTS 2, 8, 9 (Not in Mandatory List)

These tests exist in the file but were NOT flagged as mandatory replacements in the audit. If they are currently `expect(true).toBe(true)`:

- **Test 2:** Likely "Export ordering" — assert `ingested_at, event_id, invoice_id` sort order in rendered output
- **Test 8:** Likely "Pre-flight event emission" — assert `PREFLIGHT_COMPLETED` event is emitted with correct payload
- **Test 9:** Likely "Matching funds payload structure" — assert the reconciliation event contains all required fields

Implement real assertions for these too if time allows, using the same fixture patterns above. But the 11 mandatory tests + the batchCode extra test are the hard gate.

---

## HELPER UTILITIES TO CREATE

Windsurf should create these in a `tests/helpers/` directory:

```typescript
// tests/helpers/event-factory.ts
export function makeEvent(overrides: Partial<DomainEvent>): DomainEvent { ... }

// tests/helpers/fixture-loader.ts
export async function insertBaselineEvents(client: PoolClient): Promise<EventMap> { ... }
// Returns a map of E01–E15 with their assigned eventIds for causation chaining

// tests/helpers/projection-snapshot.ts
export async function snapshot(tableName: string): Promise<Row[]> { ... }
export function stripIngestedAt(rows: Row[]): Row[] { ... }
export async function dropAllProjections(client: PoolClient): Promise<void> { ... }

// tests/helpers/oasis-parser.ts
export function parseOasisDetailRecords(rendered: string): OasisDetailRecord[] { ... }
// Parses fixed-width output into structured records for assertion
```

---

## EVENT DEPENDENCY GRAPH

For reference, this shows which events cause which (causation chains):

```
E01 GRANT_CYCLE_OPENED
├── E02 GRANT_ALLOCATED (Grant A)
│   ├── E04 VET_ENROLLED (Alpha)
│   ├── E06 VOUCHER_ISSUED (V1)
│   │   └── E09 CLAIM_SUBMITTED (C1)
│   │       └── E10 CLAIM_APPROVED (C1)
│   │           └── E14 INVOICE_GENERATED (Inv 1)
│   └── E08 VOUCHER_ISSUED (V3)
│       └── E13 VOUCHER_VOIDED (V3)
├── E03 GRANT_ALLOCATED (Grant B)
│   ├── E05 VET_ENROLLED (Beta)
│   └── E07 VOUCHER_ISSUED (V2)
│       └── E11 CLAIM_SUBMITTED (C2)
│           └── E12 CLAIM_APPROVED (C2)
│               └── E15 INVOICE_GENERATED (Inv 2)
```

Every event's `causationId` should point to its parent in this tree. Every event's `correlationId` is `CORRELATION_ID` (single operation context for test simplicity).

---

## FINAL NOTES

1. **No test should mock `event_log` reads.** The whole point is proving the projection layer derives correctly from ledger truth.
2. **`ingestedAt` will differ between runs.** This is expected and correct per the Trust Doctrine. Strip it from comparisons.
3. **`occurredAt` must be deterministic in tests.** Use fixed timestamps, not `new Date()`. Example: `occurredAt: '2025-10-15T14:30:00Z'`.
4. **Event ordering matters.** Insert events in the exact order shown. The projectors may depend on seeing events in ingestion order.
5. **If a test needs wall-clock time** (e.g., for deadline enforcement), use the repo's existing time provider stub. If none exists, create a minimal `TimeProvider` interface with a `now()` method and inject it.
