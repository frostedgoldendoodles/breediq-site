-- 20260602_reconcile_breeder_relationships.sql
-- Schema-of-record reconciliation. The breeder_relationships table — the
-- backbone of the program-owner / sub-breeder model, queried across ~8 files
-- and the lib/supabase.js getProgramUserIds helper — was created out-of-band
-- and never recorded in any migration. This file documents the table AS IT
-- EXISTS in production so the schema is reproducible from source. It is
-- idempotent (IF NOT EXISTS) and safe to run against the live DB.

CREATE TABLE IF NOT EXISTS public.breeder_relationships (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    breeder_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role        text NOT NULL DEFAULT 'sub_breeder',
    status      text NOT NULL DEFAULT 'active',
    permissions jsonb DEFAULT '{"view_dogs": true, "view_health": true, "view_litters": true}'::jsonb,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.breeder_relationships ENABLE ROW LEVEL SECURITY;

-- Policies (match live):
--   a program owner can see/manage rows where they are the owner.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='breeder_relationships' AND policyname='Users can view own relationships') THEN
        CREATE POLICY "Users can view own relationships" ON public.breeder_relationships
            FOR SELECT USING ((select auth.uid()) = owner_id OR (select auth.uid()) = breeder_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='breeder_relationships' AND policyname='Owners can insert relationships') THEN
        CREATE POLICY "Owners can insert relationships" ON public.breeder_relationships
            FOR INSERT WITH CHECK ((select auth.uid()) = owner_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='breeder_relationships' AND policyname='Owners can update relationships') THEN
        CREATE POLICY "Owners can update relationships" ON public.breeder_relationships
            FOR UPDATE USING ((select auth.uid()) = owner_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='breeder_relationships' AND policyname='Owners can delete relationships') THEN
        CREATE POLICY "Owners can delete relationships" ON public.breeder_relationships
            FOR DELETE USING ((select auth.uid()) = owner_id);
    END IF;
END $$;
