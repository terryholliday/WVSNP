# WVSNP Portal - Quick Start Guide

## Step 1: Create Database

From the WVSNP APPLICATION directory:

```powershell
cd "c:\Users\Admin1\Desktop\AI Projects\WVSNP APPLICATION"
npm run setup:db
```

This automatically creates:
- ✅ `event_log` - Immutable event store
- ✅ `artifact_log` - File artifacts
- ✅ `vouchers_projection` - Voucher state
- ✅ `claims_projection` - Claim state
- ✅ `invoices_projection` - Invoice state
- ✅ `grant_balances_projection` - Grant balances
- ✅ And 10+ more projection tables

## Step 2: Seed Demo Data

```powershell
npm run seed:demo
```

This populates the database with realistic West Virginia data:
- 1 Active Grant Cycle (FY2025)
- 24 Grants across 8 WV counties
- ~2,400 Vouchers with realistic codes
- ~1,920 Claims (95% approved)
- 84 Monthly Invoices

## Step 3: Start the API Server

```powershell
npm run dev
```

The API will start on `http://localhost:4000/api/v1`

## Step 4: Start the Admin Portal

In a new terminal:

```powershell
cd "c:\Users\Admin1\Desktop\AI Projects\PROVENIQ\wvda-admin-portal"
npm run dev
```

Portal available at `http://localhost:3000`

## Step 5: Explore the Demo

### Analytics Dashboard
Visit: `http://localhost:3000/analytics`

You'll see:
- 📊 Key metrics with trend indicators
- 📈 Monthly activity line charts
- 🥧 County distribution pie chart
- 📊 Procedure breakdown bar charts

### Other Features
- **Claims**: `http://localhost:3000/claims` - Adjudicate claims
- **Invoices**: `http://localhost:3000/invoices` - Generate invoices
- **Exports**: `http://localhost:3000/exports` - OASIS exports
- **Reports**: `http://localhost:3000/reports` - Performance reports

## Troubleshooting

### "database does not exist"
```powershell
psql -U postgres -c "CREATE DATABASE wvsnp_gms;"
```

### "password authentication failed"
Update the password in:
- API: `src/api/server.ts` line 19
- Seed: `src/scripts/seed-demo-data.ts` line 10

Or set environment variable:
```powershell
$env:DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/wvsnp_gms"
```

### "relation does not exist"
Run the schema file:
```powershell
psql -U postgres -d wvsnp_gms -f db\schema.sql
```

## Complete Setup (All Steps)

```powershell
# 1. Navigate to WVSNP APPLICATION
cd "c:\Users\Admin1\Desktop\AI Projects\WVSNP APPLICATION"

# 2. Create database and schema
npm run setup:db

# 3. Seed demo data
npm run seed:demo

# 4. Start API (in terminal 1)
npm run dev

# 5. Start Admin Portal (in terminal 2 - new window)
cd "c:\Users\Admin1\Desktop\AI Projects\PROVENIQ\wvda-admin-portal"
npm run dev

# 6. Visit http://localhost:3000/analytics
```

## What You'll See

After seeding, the analytics dashboard will show:
- **2,400+ vouchers issued** across Kanawha, Berkeley, Cabell, Monongalia, Wood, Raleigh, Harrison, and Mercer counties
- **1,824 claims approved** with a 95% approval rate
- **~$1.2M total reimbursed** to veterinary clinics
- **Monthly trends** showing program growth over 8 months
- **County distribution** with Kanawha leading at ~450 vouchers
- **Procedure breakdown** showing Dog Spay, Dog Neuter, Cat Spay, Cat Neuter volumes

Perfect for demonstrating to WVDA administrators! 🎉
