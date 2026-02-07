# Quick Seed Instructions

The seed script is ready to populate your WVSNP portal with realistic West Virginia demo data.

## Option 1: Use Environment Variable (Recommended)

Set the DATABASE_URL environment variable to match your PostgreSQL setup:

```powershell
$env:DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/wvsnp_gms"
npm run seed:demo
```

Optional reset (clears event_log + projections before seeding):

```powershell
$env:SEED_RESET="1"
npm run seed:demo
```

Replace `YOUR_PASSWORD` with your actual PostgreSQL password.

## Option 2: Edit the Seed Script

If you prefer, edit the connection string directly in:
`src/scripts/seed-demo-data.ts` (line 10)

Change:
```typescript
connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/wvsnp_gms',
```

To match your database credentials.

## What Gets Created

Once you run `npm run seed:demo`, you'll get:

- **1 Grant Cycle** - FY2025 (Active)
- **Multiple Grants** - County-based demo grants
- **Vouchers** - Realistic codes like `KANAWHA-20240715-0001`
- **Claims** - 80% redemption, 90% approval rate
- **Invoices** - Monthly invoices by clinic

The seed script emits current event types and builds projections automatically.

## After Seeding

Visit the admin portal to see the data:

1. **Analytics Dashboard**: `http://localhost:3000/analytics`
   - Interactive charts with real data
   - Monthly trends and county distribution
   - Procedure breakdowns

2. **Claims**: `http://localhost:3000/claims`
   - Pending and adjudicated claims
   - Real voucher codes and clinic data

3. **Reports**: `http://localhost:3000/reports`
   - County performance metrics
   - Utilization rates

## Troubleshooting

**"password authentication failed"**
- The DATABASE_URL password doesn't match your PostgreSQL setup
- Check your PostgreSQL password with: `psql -U postgres -d wvsnp_gms`
- Update the connection string accordingly

**"relation 'event_log' does not exist"**
- You need to create the database schema first
- Run the migrations in `db/migrations/` folder

**"database 'wvsnp_gms' does not exist"**
- Create the database: `createdb -U postgres wvsnp_gms`
- Or in psql: `CREATE DATABASE wvsnp_gms;`

## Demo Ready!

Once seeded, your WVSNP portal will have realistic West Virginia data perfect for demonstrating to WVDA administrators how the system handles real-world grant management scenarios.



