-- 20260602_rls_initplan_and_indexes.sql
-- Performance pass from Supabase advisors. Applied live via apply_migration.
--
-- 1. auth_rls_initplan (WARN ×30): every RLS policy called auth.uid()
--    directly, which Postgres re-evaluates once PER ROW. Wrapping it as
--    (select auth.uid()) makes it a one-time scalar subquery per statement.
--    No behavior change — the API uses the service-role client (bypasses RLS)
--    for these tables, so this only affects direct PostgREST access + is
--    defense-in-depth. Matters at scale.
--
-- 2. unindexed_foreign_keys (INFO ×4) + hot list-query paths: added covering
--    indexes for FK columns and the (user_id, …) filters every list endpoint
--    runs. breeder_relationships(owner_id, status) is the highest-frequency
--    filter in the app (getProgramUserIds runs on nearly every request).
--
-- The ALTER POLICY statements below mirror the live policy definitions with
-- auth.uid() -> (select auth.uid()). Kept verbatim for reproducibility.

ALTER POLICY "Owners can delete relationships" ON public.breeder_relationships USING ((select auth.uid()) = owner_id);
ALTER POLICY "Owners can insert relationships" ON public.breeder_relationships WITH CHECK ((select auth.uid()) = owner_id);
ALTER POLICY "Users can view own relationships" ON public.breeder_relationships USING (((select auth.uid()) = owner_id) OR ((select auth.uid()) = breeder_id));
ALTER POLICY "Owners can update relationships" ON public.breeder_relationships USING ((select auth.uid()) = owner_id);

ALTER POLICY "Users can insert own scores" ON public.breeding_iq_scores WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own scores" ON public.breeding_iq_scores USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can delete own calendar_events" ON public.calendar_events USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own calendar_events" ON public.calendar_events WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own calendar_events" ON public.calendar_events USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own calendar_events" ON public.calendar_events USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can delete own dogs" ON public.dogs USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own dogs" ON public.dogs WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own dogs" ON public.dogs USING ((select auth.uid()) = user_id);
ALTER POLICY "Program owners can view sub-breeder dogs" ON public.dogs USING (((select auth.uid()) = user_id) OR (EXISTS ( SELECT 1 FROM breeder_relationships br WHERE ((br.owner_id = (select auth.uid())) AND (br.breeder_id = dogs.user_id) AND (br.status = 'active'::text)))));

ALTER POLICY "Users can insert own files" ON public.files WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own files" ON public.files USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own files" ON public.files USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can delete own guardians" ON public.guardians USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own guardians" ON public.guardians WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own guardians" ON public.guardians USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own guardians" ON public.guardians USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can delete own litters" ON public.litters USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own litters" ON public.litters WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own litters" ON public.litters USING ((select auth.uid()) = user_id);
ALTER POLICY "Program owners can view sub-breeder litters" ON public.litters USING (((select auth.uid()) = user_id) OR (EXISTS ( SELECT 1 FROM breeder_relationships br WHERE ((br.owner_id = (select auth.uid())) AND (br.breeder_id = litters.user_id) AND (br.status = 'active'::text)))));

ALTER POLICY "Users can view own profile" ON public.profiles USING ((select auth.uid()) = id);
ALTER POLICY "Users can update own profile" ON public.profiles USING ((select auth.uid()) = id);

CREATE INDEX IF NOT EXISTS idx_breeder_relationships_breeder_id ON public.breeder_relationships (breeder_id);
CREATE INDEX IF NOT EXISTS idx_breeder_relationships_owner_status ON public.breeder_relationships (owner_id, status);
CREATE INDEX IF NOT EXISTS idx_dogs_guardian_id ON public.dogs (guardian_id);
CREATE INDEX IF NOT EXISTS idx_litters_dam_id ON public.litters (dam_id);
CREATE INDEX IF NOT EXISTS idx_litters_sire_id ON public.litters (sire_id);
CREATE INDEX IF NOT EXISTS idx_dogs_user_status ON public.dogs (user_id, status);
CREATE INDEX IF NOT EXISTS idx_litters_user_breed_date ON public.litters (user_id, breed_date DESC);
CREATE INDEX IF NOT EXISTS idx_guardians_user_family ON public.guardians (user_id, family_name);
