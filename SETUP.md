# BreedIQ Backend Setup Guide

## Overview
BreedIQ uses **Vercel** (serverless API + hosting) and **Supabase** (auth + database + file storage).
This guide walks you through setting up everything from scratch.

---

## Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in (or create an account)
2. Click **New Project**
3. Name it `breediq`
4. Choose a strong database password (save this somewhere safe)
5. Select region: **West US (Oregon)** (closest to Utah)
6. Click **Create new project** — wait ~2 minutes for it to spin up

## Step 2: Run Database Migration

1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **New query**
3. Copy the entire contents of `supabase/migration.sql` and paste it in
4. Click **Run** — you should see "Success" for all statements
5. Verify: Go to **Table Editor** — you should see tables: profiles, dogs, litters, guardians, files, breeding_iq_scores

## Step 3: Create Storage Buckets

**Bucket 1 — `uploads` (private, onboarding files):**
1. In Supabase dashboard, go to **Storage** (left sidebar)
2. Click **New bucket**
3. Name it `uploads`
4. Toggle **Public** to OFF (keep it private)
5. Set file size limit to `10MB`
6. Click **Create bucket**

**Bucket 2 — `dog-photos` (private, dog profile photos):**
1. Open **SQL Editor**
2. Paste and run `supabase/storage_dog_photos.sql` — this creates the bucket
   plus the RLS policies so each user can only read, write, and delete
   inside their own `{user_id}/` folder.
3. Verify in **Storage** that `dog-photos` appears and is **not** marked
   Public.

> **How photo privacy works.** The bucket is private. The browser compresses
> uploads (longest edge ≤1600 px, JPEG q≈0.82, ~300–600 KB target) and POSTs
> them to `/api/dogs/:id/photo`, which uploads via the service role and
> stores the storage path (not a URL) on `dogs.photo_url`. The dogs read API
> mints a short-lived (1 hour) signed URL for the owner on each fetch, so
> photos are only viewable by the authenticated user and URLs expire on
> their own.

## Step 4: Get Your Supabase Keys

1. Go to **Settings** > **API** in Supabase dashboard
2. Copy these three values:
   - **Project URL** → this is your `SUPABASE_URL`
   - **anon public** key → this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role secret** key → this is your `SUPABASE_SERVICE_ROLE_KEY`

⚠️ The service_role key has full database access — never expose it in frontend code.

## Step 5: Add Environment Variables to Vercel

1. Go to [vercel.com](https://vercel.com) > your breediq-site project
2. Go to **Settings** > **Environment Variables**
3. Add each of these (all environments: Production, Preview, Development):

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service_role key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your anon key |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (for AI onboarding) |
| `STRIPE_SECRET_KEY` | Already set from before |

4. Click **Save** for each one
5. **Redeploy** the project for changes to take effect (Deployments > ... > Redeploy)

## Step 6: Configure Supabase Auth

1. In Supabase dashboard, go to **Authentication** > **Providers**
2. Make sure **Email** provider is enabled
3. Under **Authentication** > **URL Configuration**:
   - Set **Site URL** to `https://breediq.ai`
   - Add `https://breediq.ai/**` to **Redirect URLs**

## Step 7: Verify Everything Works

After deploying, test these API endpoints:

```bash
# Test signup (replace with test data)
curl -X POST https://breediq.ai/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123","full_name":"Test User","kennel_name":"Test Kennel"}'

# Test login
curl -X POST https://breediq.ai/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'

# Test get user (use the access_token from login response)
curl https://breediq.ai/api/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Test Breeding IQ Score
curl https://breediq.ai/api/breeding-iq \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## API Routes Reference

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/signup` | Create account |
| POST | `/api/auth/login` | Sign in, get session |
| GET | `/api/auth/me` | Get current user + stats |
| GET | `/api/auth/logout` | Clear session cookies |

### Dogs
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/dogs` | List dogs (filters: status, role, sex, search) |
| POST | `/api/dogs` | Create dog |
| GET | `/api/dogs/:id` | Get dog + litter history |
| PUT | `/api/dogs/:id` | Update dog |
| DELETE | `/api/dogs/:id` | Archive dog (soft delete) |

### Litters
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/litters` | List litters with dam/sire (filter: status) |
| POST | `/api/litters` | Create litter (auto-calculates 61-day due date) |
| GET | `/api/litters/:id` | Get litter with gestation tracking |
| PUT | `/api/litters/:id` | Update litter (auto-updates dam heat_status) |
| DELETE | `/api/litters/:id` | Archive litter |

### Breeding IQ
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/breeding-iq` | Calculate current score from live data |
| POST | `/api/breeding-iq` | Save score snapshot + manual overrides |

### Onboarding
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/onboarding/upload` | Upload file (base64) to Supabase Storage |
| POST | `/api/onboarding/process` | Send files to AI for data extraction |
| POST | `/api/onboarding/confirm` | Save extracted data to database |

---

## Architecture

```
breediq.ai (Vercel)
├── index.html          (landing page)
├── signup.html         (create account)
├── login.html          (sign in)
├── dashboard.html      (main app - requires auth)
├── onboarding.html     (AI-powered data import)
├── api/
│   ├── auth/           (signup, login, logout, me)
│   ├── dogs/           (CRUD + search)
│   ├── litters/        (CRUD + gestation tracking)
│   ├── breeding-iq/    (score calculation + snapshots)
│   └── onboarding/     (upload, AI process, confirm)
├── lib/
│   └── supabase.js     (client helpers + auth middleware)
└── supabase/
    └── migration.sql   (database schema)
```

All API routes are Vercel serverless functions. Auth uses Supabase Auth with JWT cookies.
Data is isolated per-user via Row Level Security (RLS) in Supabase.
