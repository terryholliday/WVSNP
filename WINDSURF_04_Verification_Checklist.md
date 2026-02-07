# WINDSURF_04 — Public Portal Verification Checklist

**Context:** Windsurf has declared the public portal 100% complete. Before accepting this, run the following verification checks. Paste output/screenshots for each.

---

## PART 1: Does It Actually Run?

```bash
# From the wvsnp-public-portal directory:
npm install
npm run build
npm run dev
```

**Expected:** Dev server starts without errors. If it fails, paste the full error output.

Open http://localhost:3000 in a browser. You should see the landing page with three clear paths:
- "Apply for a Voucher"
- "Check Application Status"  
- "Program Participant Reporting"

**Screenshot required.**

---

## PART 2: Application Wizard (Job 1) — Walk Through It

### Test 2A: Eligibility Screening Gate
1. Navigate to `/apply/eligibility`
2. Select a county other than WV (or answer "No" to pet ownership)
3. **Expected:** Kind rejection message with alternative resources. NOT a dead-end.
4. Reset and answer all questions correctly
5. **Expected:** Proceeds to Step 2

### Test 2B: Full Application Flow
1. Complete Steps 1-4 with valid data
2. At Step 5 (Evidence Upload), select a file
3. **Verify:** Does the UI display a "Document fingerprint: [hash]" before upload?
4. **Verify:** Does the upload progress indicator work?
5. Complete Step 6 (Review)
6. **Verify:** Does the review page show a read-only summary of ALL entered data?
7. Submit the application
8. **Verify:** Does the confirmation page show:
   - The reference code in large text?
   - A copy button?
   - Estimated review timeline?
   - Link to status check?

### Test 2C: Auto-Save / Resume
1. Start a new application, complete Steps 1-3
2. Close the browser entirely (not just the tab)
3. Reopen browser, navigate to the portal
4. **Verify:** Can you resume at Step 4 with Steps 1-3 data intact?
5. **How?** Magic link? Reference code entry? Automatic detection?

### Test 2D: Reference Code Format
1. Submit an application and note the reference code
2. **Verify format:** `WVSNP-{4 chars}-{4 chars}`, uppercase only
3. **Verify no ambiguous characters:** Should NOT contain 0, O, 1, I, or L

---

## PART 3: Status Check (Job 2)

### Test 3A: Status Lookup
1. Navigate to `/status`
2. Enter the reference code from Test 2B + email address
3. **Verify:** Status page loads with timeline display
4. **Verify:** Status text is human-readable ("Application Received"), NOT internal event names ("APPLICATION_SUBMITTED")

### Test 3B: Invalid Lookup
1. Enter a fake reference code
2. **Expected:** Friendly error message, NOT a crash or blank screen

---

## PART 4: Reporting Portal (Job 3)

### Test 4A: Authentication Flow
1. Navigate to `/report`
2. Enter a participant code (e.g., `VET-WV-1234`) + email
3. **What happens?**
   - If backend endpoints don't exist yet: Does it show a clear error? Or does it crash silently?
   - If the UI just shows a form without actually validating: That's NOT "✅ implemented"

### Test 4B: Vet Service Completion Form
1. Assuming you can get past auth, does the service form show:
   - Practice info (read-only)?
   - Outstanding vouchers list?
   - Date of service field?
   - Procedure type (Spay/Neuter)?
   - Animal weight?
   - Complications dropdown?
   - Attestation checkbox?

### Test 4C: Org Outcome Reporting Form
1. Does the outcome form show:
   - Organization info (read-only)?
   - Grant allocation and balance?
   - Reporting period selector?
   - Matching funds amount + source description?
   - Document upload with SHA-256?
   - Animals served count (by species)?
   - Program narrative text area?
   - Attestation checkbox?

**CRITICAL QUESTION:** For both 4B and 4C — do the submit buttons actually call an API endpoint? Or do they just console.log the payload? If they console.log, the reporting portal is a mockup, not an implementation.

---

## PART 5: Chain of Custody (SHA-256)

### Test 5A: Hash Verification
1. Pick a known file (e.g., a small text file)
2. Compute its SHA-256 hash independently:
   ```bash
   shasum -a 256 testfile.txt
   ```
3. Upload the same file through the portal
4. **Verify:** Does the portal display a hash? Does it match your independent computation?

If the portal doesn't display a hash, or displays something that doesn't match, the Chain of Custody protocol is not implemented — it's just a file upload.

---

## PART 6: Mobile Responsiveness

1. Open Chrome DevTools → Toggle Device Toolbar
2. Set width to 375px (iPhone SE)
3. Navigate through the entire application wizard
4. **Verify:** All form fields are usable. Nothing overflows. Buttons are tappable.
5. Check the status page and reporting login at 375px too.

---

## PART 7: Offline Resilience

### Test 7A: Network Drop During Form Entry
1. Start the application wizard, complete Steps 1-2
2. In Chrome DevTools → Network tab → set to "Offline"
3. Continue filling out Step 3
4. **Verify:** Form doesn't crash. Data is preserved locally.
5. Set network back to "Online"
6. **Verify:** Data syncs to the API on reconnection

### Test 7B: Reference Code Generation Offline
1. Set network to "Offline" before starting a new application
2. **Verify:** Reference code is still generated (client-side generation, no server dependency)

---

## PART 8: Code Quality

```bash
# TypeScript compilation
npx tsc --noEmit

# Check for placeholder/TODO markers
grep -rn 'TODO\|FIXME\|PLACEHOLDER\|console.log' src/ --include='*.ts' --include='*.tsx'

# Check for hardcoded test data in production code
grep -rn 'dummy\|mock\|fake\|test@\|example.com' src/ --include='*.ts' --include='*.tsx' | grep -v '__tests__' | grep -v '.test.'
```

Paste output for each.

---

## VERDICT CRITERIA

**PASS** = All Parts 1-8 produce expected results, API calls actually hit endpoints (or gracefully handle missing endpoints with clear messaging), and `tsc --noEmit` is clean.

**PARTIAL** = Structure is correct and forms render, but API integration is incomplete (console.log instead of fetch), offline resilience is missing, or Chain of Custody is just a file upload without hash verification.

**FAIL** = Build doesn't compile, pages crash, or critical flows (eligibility gate, auto-save, status lookup) don't function.

Most Windsurf "100% complete" declarations land in the PARTIAL category. Run the checks and find out which one this is.
