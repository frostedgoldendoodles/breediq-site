-- BreedIQ Database Schema
-- Run this in the Supabase SQL Editor after creating your project
-- This creates all tables needed for the MVP: auth profiles, dogs, litters, guardians, files, and breeding IQ

-- ============================================================
-- 1. PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    kennel_name TEXT,
    phone TEXT,
    timezone TEXT DEFAULT 'America/Denver',
    plan TEXT DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'kennel')),
    stripe_customer_id TEXT,
    onboarding_completed BOOLEAN DEFAULT FALSE,
    calendar_feed_token TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup for the public ICS subscription feed (see /api/calendar/feed/[token].ics)
CREATE INDEX IF NOT EXISTS profiles_calendar_feed_token_idx
    ON public.profiles (calendar_feed_token)
    WHERE calendar_feed_token IS NOT NULL;

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 2. DOGS
-- ============================================================
CREATE TABLE public.dogs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    call_name TEXT,
    breed TEXT DEFAULT 'Goldendoodle',
    sex TEXT CHECK (sex IN ('female', 'male')),
    color TEXT,
    weight_lbs NUMERIC,
    date_of_birth DATE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'retired', 'guardian', 'sold', 'deceased')),
    role TEXT CHECK (role IN ('dam', 'stud', 'prospect')),
    is_intact BOOLEAN DEFAULT TRUE,

    -- Genetics
    embark_id TEXT,
    embark_url TEXT,
    coi_percentage NUMERIC,
    genetic_tests JSONB DEFAULT '{}',

    -- Health
    ofa_clearances JSONB DEFAULT '{}',
    vet_records_current BOOLEAN DEFAULT FALSE,
    vet_last_visit DATE,
    health_notes TEXT,

    -- Reproduction
    last_heat_date DATE,
    avg_heat_cycle_days INTEGER,
    heat_status TEXT DEFAULT 'none' CHECK (heat_status IN ('none', 'in_heat', 'bred', 'pregnant', 'nursing')),

    -- Guardian (FK added after guardians table is created)
    guardian_id UUID,

    -- Media
    photo_url TEXT,
    pedigree_url TEXT,

    -- Metadata
    notes TEXT,
    source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'ai_onboarding', 'import')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dogs_user_id ON public.dogs(user_id);
CREATE INDEX idx_dogs_status ON public.dogs(status);

-- ============================================================
-- 3. LITTERS
-- ============================================================
CREATE TABLE public.litters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    dam_id UUID REFERENCES public.dogs(id) ON DELETE SET NULL,
    sire_id UUID REFERENCES public.dogs(id) ON DELETE SET NULL,

    -- Breeding
    breed_date DATE,
    due_date DATE,
    whelp_date DATE,

    -- Litter data
    status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'confirmed', 'born', 'available', 'placed', 'archived')),
    puppy_count INTEGER,
    males_count INTEGER,
    females_count INTEGER,

    -- Milestones
    ultrasound_date DATE,
    xray_date DATE,

    -- Go-home
    go_home_date DATE,

    -- Pricing
    price_per_puppy NUMERIC,

    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_litters_user_id ON public.litters(user_id);
CREATE INDEX idx_litters_status ON public.litters(status);

-- ============================================================
-- 4. GUARDIANS
-- ============================================================
CREATE TABLE public.guardians (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    family_name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,

    -- Check-in tracking
    last_checkin DATE,
    checkin_frequency_days INTEGER DEFAULT 30,
    checkin_notes TEXT,

    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_guardians_user_id ON public.guardians(user_id);

-- Add deferred FK from dogs -> guardians (now that guardians table exists)
ALTER TABLE public.dogs ADD CONSTRAINT dogs_guardian_id_fkey
    FOREIGN KEY (guardian_id) REFERENCES public.guardians(id) ON DELETE SET NULL;

-- ============================================================
-- 5. FILES (tracking uploaded documents for AI onboarding)
-- ============================================================
CREATE TABLE public.files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_type TEXT, -- 'image', 'pdf', 'spreadsheet', 'text', 'other'
    mime_type TEXT,
    file_size INTEGER,
    storage_path TEXT NOT NULL, -- Supabase Storage path

    -- AI processing
    processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    extracted_data JSONB, -- AI-extracted structured data
    extraction_confidence NUMERIC, -- 0-1 confidence score

    purpose TEXT DEFAULT 'onboarding' CHECK (purpose IN ('onboarding', 'health_record', 'pedigree', 'contract', 'other')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_files_user_id ON public.files(user_id);

-- ============================================================
-- 6. BREEDING IQ SCORES (snapshot history)
-- ============================================================
CREATE TABLE public.breeding_iq_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    total_score INTEGER NOT NULL, -- The Breeding IQ (0-160)
    health_genetics_score INTEGER DEFAULT 0, -- Out of 54
    program_management_score INTEGER DEFAULT 0, -- Out of 53
    buyer_experience_score INTEGER DEFAULT 0, -- Out of 53
    breakdown JSONB, -- Detailed item-by-item breakdown
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_breeding_iq_user_id ON public.breeding_iq_scores(user_id);
CREATE INDEX idx_breeding_iq_calculated ON public.breeding_iq_scores(calculated_at DESC);

-- ============================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- Users can only see/edit their own data
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.litters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.breeding_iq_scores ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own profile
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Dogs: users can CRUD their own dogs
CREATE POLICY "Users can view own dogs" ON public.dogs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own dogs" ON public.dogs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own dogs" ON public.dogs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own dogs" ON public.dogs FOR DELETE USING (auth.uid() = user_id);

-- Litters: users can CRUD their own litters
CREATE POLICY "Users can view own litters" ON public.litters FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own litters" ON public.litters FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own litters" ON public.litters FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own litters" ON public.litters FOR DELETE USING (auth.uid() = user_id);

-- Guardians: users can CRUD their own guardians
CREATE POLICY "Users can view own guardians" ON public.guardians FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own guardians" ON public.guardians FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own guardians" ON public.guardians FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own guardians" ON public.guardians FOR DELETE USING (auth.uid() = user_id);

-- Files: users can manage their own files
CREATE POLICY "Users can view own files" ON public.files FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own files" ON public.files FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own files" ON public.files FOR UPDATE USING (auth.uid() = user_id);

-- Breeding IQ: users can view their own scores
CREATE POLICY "Users can view own scores" ON public.breeding_iq_scores FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own scores" ON public.breeding_iq_scores FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 8. STORAGE BUCKET
-- Run this separately or via the Supabase dashboard
-- ============================================================
-- INSERT INTO storage.buckets (id, name, public) VALUES ('uploads', 'uploads', false);

-- Storage policy: users can upload to their own folder
-- CREATE POLICY "Users can upload own files" ON storage.objects FOR INSERT WITH CHECK (
--     bucket_id = 'uploads' AND auth.uid()::text = (storage.foldername(name))[1]
-- );
-- CREATE POLICY "Users can view own files" ON storage.objects FOR SELECT USING (
--     bucket_id = 'uploads' AND auth.uid()::text = (storage.foldername(name))[1]
-- );

-- ============================================================
-- 9. UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_dogs_updated_at BEFORE UPDATE ON public.dogs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_litters_updated_at BEFORE UPDATE ON public.litters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_guardians_updated_at BEFORE UPDATE ON public.guardians FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
