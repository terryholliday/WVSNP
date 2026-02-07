# WVSNP with Supabase - Quick Setup

Using Supabase is the easiest way to get started with the WVSNP portal without installing PostgreSQL locally.

## Step 1: Create Supabase Project

1. Go to https://supabase.com
2. Sign up or log in
3. Click "New Project"
4. Choose:
   - **Name**: `wvsnp-gms` (or any name you prefer)
   - **Database Password**: Create a strong password (save it!)
   - **Region**: Choose closest to you
   - **Pricing Plan**: Free tier is perfect for demo

## Step 2: Get Connection String

1. In your Supabase project, go to **Project Settings** (gear icon)
2. Click **Database** in the left sidebar
3. Scroll to **Connection string**
4. Select **URI** tab
5. Copy the connection string (looks like):
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxxx.supabase.co:5432/postgres
   ```
6. Replace `[YOUR-PASSWORD]` with your actual database password

## Step 3: Configure WVSNP Application

Create a `.env` file in the WVSNP APPLICATION directory:

```powershell
cd "c:\Users\Admin1\Desktop\AI Projects\WVSNP APPLICATION"
New-Item -Path ".env" -ItemType File
```

Add your connection string to `.env`:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.xxxxxxxxxxxxx.supabase.co:5432/postgres
API_PORT=4000
JWT_SECRET=dev-secret-change-in-production
```

## Step 4: Setup Database Schema

```powershell
npm run setup:db
```

This will:
- Connect to your Supabase database
- Create all required tables
- Set up triggers and indexes

## Step 5: Seed Demo Data

```powershell
npm run seed:demo
```

This populates your database with:
- 2,400+ vouchers
- 1,920 claims
- 84 invoices
- Realistic West Virginia data

## Step 6: Start the Application

```powershell
# Terminal 1: API Server
npm run dev

# Terminal 2: Admin Portal
cd "c:\Users\Admin1\Desktop\AI Projects\PROVENIQ\wvda-admin-portal"
npm run dev
```

Visit `http://localhost:3000/analytics` to see your demo!

## Advantages of Supabase

✅ **No local installation** - Works immediately  
✅ **Free tier** - Perfect for demos and development  
✅ **Automatic backups** - Your data is safe  
✅ **Web interface** - View/edit data in Supabase dashboard  
✅ **Production-ready** - Can scale when needed  

## View Your Data

You can view and query your data directly in Supabase:

1. Go to your Supabase project
2. Click **Table Editor** or **SQL Editor**
3. Browse tables like `event_log`, `vouchers_projection`, `claims_projection`

## Troubleshooting

### "password authentication failed"
- Double-check your connection string
- Make sure you replaced `[YOUR-PASSWORD]` with actual password
- Verify password in Supabase Project Settings → Database

### "connection refused"
- Check your internet connection
- Verify the Supabase project is active
- Try regenerating the connection string

### "relation does not exist"
- Run `npm run setup:db` first to create tables
- Check Supabase Table Editor to verify tables exist

## Alternative: Local PostgreSQL

If you prefer local PostgreSQL:

1. Install PostgreSQL from https://www.postgresql.org/download/windows/
2. Set password during installation
3. Use local connection:
   ```powershell
   $env:POSTGRES_PASSWORD="YourPassword"
   npm run setup:db
   ```

But Supabase is recommended for quick demos! 🚀
