-- 20260504_drop_temp_transfer.sql
-- Drop the leftover _temp_transfer staging table.
--
-- Background:
-- Supabase's security linter flagged the table for an "always-true" anon INSERT
-- policy (allow_anon_insert WITH CHECK (true)) that effectively bypassed RLS,
-- letting any unauthenticated visitor write rows. The table was a 4-column
-- text-chunk staging area (id, chunk_index, content, created_at) — likely
-- a remnant of an earlier streaming-onboarding flow that was replaced by the
-- current api/onboarding/upload.js + api/onboarding/process.js routes.
--
-- Verified before dropping:
--   * 0 rows in the live table
--   * Zero references in breediq-site/ (grep across .js, .html, .sql, .md)
--   * Advisor warning rls_policy_always_true cleared after drop
--
-- Applied via Supabase MCP apply_migration on 2026-05-04.

DROP TABLE IF EXISTS public._temp_transfer CASCADE;
