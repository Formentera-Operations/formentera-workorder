# Formentera Work Order App

A mobile-first Next.js app that replicates the Retool Work Order App, self-hosted on Vercel + Supabase.

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Snowflake**: Location/vendor dropdowns via API routes
- **Hosting**: Vercel

## Setup

### 1. Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run `supabase-migration.sql`
3. Import your existing CSV data using the **Table Editor** or `psql`
4. Get your project URL and anon key from **Settings → API**

### 2. Environment Variables

Copy `.env.local.example` to `.env.local` and fill in:

```bash
cp .env.local.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

SNOWFLAKE_ACCOUNT=your_account.region
SNOWFLAKE_USERNAME=your_username
# Key-pair (JWT) auth — PEM private key on one line with literal \n newlines
SNOWFLAKE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
SNOWFLAKE_DATABASE=FO_STAGE_DB
SNOWFLAKE_SCHEMA=your_schema
SNOWFLAKE_WAREHOUSE=your_warehouse
SNOWFLAKE_ROLE=your_role
```

### 3. Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 4. Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Add all environment variables in the Vercel dashboard under **Settings → Environment Variables**.

## App Structure

```
app/
  page.tsx                        # Home screen
  my-tickets/page.tsx             # My Tickets (user's own tickets)
  maintenance/
    page.tsx                      # Maintenance (all tickets)
    new/page.tsx                  # New Maintenance Form
    [id]/
      page.tsx                    # Ticket detail (Summary/Initial Report/Dispatch/Repairs tabs)
      issue-photos/page.tsx       # Issue photo viewer
      repair-images/page.tsx      # Repair photo viewer
  api/
    tickets/route.ts              # GET list, POST new ticket
    tickets/[id]/route.ts         # GET detail, PATCH update
    dispatch/route.ts             # POST/PATCH dispatch
    repairs/route.ts              # POST repairs/closeout
    employees/route.ts            # GET employees list
    equipment/route.ts            # GET equipment types/names
    vendors/route.ts              # GET vendors from Snowflake
    well-facility/route.ts        # GET well/facility data from Snowflake
```

## Data Migration from Retool DB

Import your existing CSV exports into Supabase:

1. Go to **Table Editor** in Supabase
2. For each table, use **Import data from CSV**
3. Import in this order (to respect foreign keys):
   - `employees`
   - `equipment_Type`
   - `equipment_library`
   - `Maintenance_Form_Submission`
   - `Dispatch`
   - `Repairs_Closeout`
   - `vendor_payment_details`

## Auth Setup

The app uses **Supabase Auth** with email/password login.

### 1. Enable Email Auth in Supabase
- Go to **Authentication → Providers → Email** → Enable
- Optional: Disable "Enable email confirmations" for an internal app (no email verification required)

### 2. Run the auth SQL
```sql
-- In Supabase SQL Editor, run:
supabase-auth-setup.sql
```
This enables Row Level Security and creates policies so only authenticated users can access data.

### 3. Add your users
Go to **Authentication → Users → Add user** and add each field team member with their `@formenteraops.com` email.

To set a display name (used throughout the app), add metadata when creating users:
```json
{ "full_name": "Brandon Paehl" }
```

Or via SQL:
```sql
UPDATE auth.users
SET raw_user_meta_data = jsonb_set(raw_user_meta_data, '{full_name}', '"Brandon Paehl"')
WHERE email = 'brandon.paehl@formenteraops.com';
```

### How the name is derived
The app uses `full_name` from user metadata → falls back to deriving from the email address (e.g. `brandon.paehl@…` becomes `Brandon Paehl`).

