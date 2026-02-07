# WVSNP Demo Setup Guide

## Quick Start for Demonstration

This guide will help you set up the WVSNP Grant Management System with realistic West Virginia data for demonstration purposes.

## Prerequisites

1. **PostgreSQL Database** running on `localhost:5432`
2. **Database created:** `wvsnp_gms`
3. **Node.js** installed (v18+)
4. **Dependencies installed:** `npm install`

## Step 1: Initialize Database Schema

Run the database migrations to create all required tables:

```bash
# Run migrations (if you have a migration tool)
# Or manually execute the SQL files in db/migrations/
```

Required tables:
- `event_log` - Immutable event store
- `grant_cycles` - Grant cycle projections
- `grants` - Grant projections
- `vouchers` - Voucher projections
- `claims` - Claim projections
- `invoices` - Invoice projections

## Step 2: Seed Demo Data

Generate realistic West Virginia data:

```bash
npm run seed:demo
```

This will create:
- **1 Grant Cycle** - FY2025 (July 2024 - June 2025)
- **24 Grants** - 8 major WV counties × 3 bucket types (SPAY/NEUTER/LIRP)
- **~2,400 Vouchers** - Distributed across 8 months with realistic patterns
- **~1,920 Claims** - 80% redemption rate with 95% approval rate
- **84 Invoices** - Monthly invoices for 12 clinics over 7 months

### Demo Data Includes:

**Major Counties:**
- Greenbrier (Lewisburg area)
- Kanawha (Charleston area)
- Berkeley (Eastern Panhandle)
- Cabell (Huntington area)
- Monongalia (Morgantown area)
- Wood (Parkersburg area)
- Raleigh (Beckley area)
- Harrison (Clarksburg area)
- Mercer (Bluefield area)

**Realistic Clinic Names:**
- Charleston Animal Hospital
- Fairlea Animal Clinic
- Mountaineer Veterinary Clinic
- Blue Ridge Animal Care
- Appalachian Pet Hospital
- New River Veterinary Services
- And 7 more...

**Realistic Shelter Names:**
- Greenbrier Humane Society
- Kanawha-Charleston Humane Association
- Berkeley County Animal Shelter
- Cabell-Wayne Animal Shelter
- And 9 more...

## Step 3: Start the API Server

```bash
npm run dev
```

The API will be available at `http://localhost:4000/api/v1`

## Step 4: Start the Admin Portal

In a new terminal:

```bash
cd "c:\Users\Admin1\Desktop\AI Projects\PROVENIQ\wvda-admin-portal"
npm run dev
```

The portal will be available at `http://localhost:3000`

## Step 5: Explore the Demo

### Analytics Dashboard
Navigate to: `http://localhost:3000/analytics`

**What you'll see:**
- 📊 **Key Metrics Cards** with trend indicators
  - ~2,400 vouchers issued (+12%)
  - ~1,824 claims approved (+8%)
  - ~$1.2M total reimbursed (+15%)
  - 95% approval rate
- 📈 **Monthly Trends Chart** - Line chart showing vouchers, claims, and approvals over 8 months
- 🥧 **County Distribution** - Pie chart of top counties by volume
- 📊 **Procedure Breakdown** - Bar charts for procedure types and reimbursement

### Claims Adjudication
Navigate to: `http://localhost:3000/claims`

**What you'll see:**
- List of submitted claims (some pending, most approved/denied)
- Approve/deny modal with amount adjustment
- Claim details with voucher codes and clinic information

### Invoice Dashboard
Navigate to: `http://localhost:3000/invoices`

**What you'll see:**
- Monthly invoice generation interface
- Historical invoices for 12 clinics over 7 months
- Total amounts and claim counts

### OASIS Export
Navigate to: `http://localhost:3000/exports`

**What you'll see:**
- Fixed-width file generation for WV Treasury
- Export metadata (batch ID, record count, SHA-256 hash)
- Download capability

### Grant Cycle Management
Navigate to: `http://localhost:3000/grants`

**What you'll see:**
- FY2025 grant cycle with status indicators
- Grant balances by bucket type
- Utilization metrics

### Performance Reports
Navigate to: `http://localhost:3000/reports`

**What you'll see:**
- Program-wide performance metrics
- County-level statistics table
- Utilization rates with color coding

## Step 6: Start ShelterOS Module (Optional)

In another terminal:

```bash
cd "c:\Users\Admin1\Desktop\AI Projects\PROVENIQ\shelteros-wvsnp-module"
npm run dev
```

The grantee portal will be available at `http://localhost:3001` (or 3000 if admin portal isn't running)

**What you'll see:**
- Grant overview dashboard with balances
- Voucher issuance interface
- Voucher status tracking
- County performance reports
- Deadline tracker

## Demo Talking Points

### For WVDA Administrators

1. **Real-time Analytics**
   - "The analytics dashboard provides instant insights into program performance"
   - "We can see trends month-over-month with growth indicators"
   - "County distribution helps identify high-performing regions"

2. **Efficient Claim Processing**
   - "Claims are automatically validated against voucher codes"
   - "Approve or deny with one click, with full audit trail"
   - "95% approval rate shows program effectiveness"

3. **Automated Invoicing**
   - "Monthly invoices generated automatically for each clinic"
   - "Deterministic selection ensures consistency"
   - "Ready for OASIS export to Treasury"

4. **Historical Data Import**
   - "Import previous fiscal years' data for multi-year analysis"
   - "CSV templates provided for easy data migration"
   - "Compare year-over-year performance"

5. **Audit Trail**
   - "Every action recorded in immutable event log"
   - "Full traceability with correlation IDs"
   - "Meets state audit requirements"

### For Shelters/Grantees

1. **Easy Voucher Issuance**
   - "Issue vouchers in seconds with all 55 WV counties available"
   - "Automatic code generation (COUNTY-DATE-NUMBER format)"
   - "Real-time balance tracking"

2. **Grant Management**
   - "See available funds by bucket type (SPAY/NEUTER/LIRP)"
   - "Utilization rates and progress bars"
   - "Quick actions for common tasks"

3. **Performance Tracking**
   - "Monthly activity reports"
   - "Redemption rate analysis"
   - "Export capabilities for board meetings"

### For Veterinary Clinics

1. **Simple Integration**
   - "Validate vouchers before procedure"
   - "Submit claims with one API call"
   - "Track claim status in real-time"

2. **Fast Reimbursement**
   - "Claims adjudicated within 3-12 days"
   - "Monthly invoices generated automatically"
   - "Payment via OASIS system"

## Resetting Demo Data

To reset and regenerate demo data:

```bash
# Clear event log
psql -d wvsnp_gms -c "TRUNCATE event_log CASCADE;"

# Rebuild projections (if needed)
npm run rebuild:projections

# Reseed
npm run seed:demo
```

## Troubleshooting

### "Cannot connect to database"
- Ensure PostgreSQL is running
- Check connection string in environment variables
- Verify database `wvsnp_gms` exists

### "Event log table not found"
- Run database migrations first
- Check that all tables are created

### "No data showing in portal"
- Verify seed script completed successfully
- Check API server is running on port 4000
- Verify frontend is connecting to correct API URL

## Support

For questions or issues during demonstration:
- Check API server logs for errors
- Verify all services are running
- Review browser console for frontend errors

---

**Ready to demonstrate the power of modern grant management! 🎉**
