-- 20260602_breeding_iq_scores_add_overrides_tier.sql
-- api/breeding-iq/index.js writes `manual_overrides` and `tier` and reads them
-- back, but the live breeding_iq_scores table never had those columns — so the
-- POST (save score snapshot) was failing with a 500 and the GET silently fell
-- back to "no overrides". Add the columns the feature was built around.
-- Applied to live Supabase via apply_migration on 2026-06-02. Idempotent.

ALTER TABLE public.breeding_iq_scores
    ADD COLUMN IF NOT EXISTS manual_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS tier text;

-- Note for future devs: this table's timestamp column is `calculated_at`,
-- NOT `created_at`. The API previously ordered by a non-existent `created_at`;
-- that was fixed in the same change (api/breeding-iq/index.js).
