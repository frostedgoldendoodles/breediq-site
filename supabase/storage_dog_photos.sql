-- ========================================================================
-- BreedIQ · Dog Photos Storage Bucket (private, owner-only read)
-- Run this in the Supabase SQL editor.
-- ========================================================================
--
-- Photos are compressed in the browser (≤1600 px, ~600 KB JPEG) then POSTed
-- to /api/dogs/:id/photo, which uses the service role to write into this
-- bucket at `{user_id}/{dog_id}-{ts}.{ext}`. The dogs.photo_url column
-- stores that storage path; the dogs API mints short-lived signed URLs on
-- read so only authenticated owners can view their own photos.

-- 1. Create bucket (PRIVATE — no public reads)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'dog-photos',
    'dog-photos',
    false,                                                -- private
    5242880,                                              -- 5 MB per file (plenty after compression)
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. RLS policies — each user can only touch their own {user_id}/ folder.
--    Reads also go through the service role (API-generated signed URLs),
--    but we keep an owner-only SELECT policy as defense-in-depth in case
--    a user-scoped client is ever used.

-- Remove any legacy public-read policy from earlier setups.
DROP POLICY IF EXISTS "dog-photos-public-read" ON storage.objects;

DROP POLICY IF EXISTS "dog-photos-own-read" ON storage.objects;
CREATE POLICY "dog-photos-own-read" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'dog-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "dog-photos-own-insert" ON storage.objects;
CREATE POLICY "dog-photos-own-insert" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'dog-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "dog-photos-own-update" ON storage.objects;
CREATE POLICY "dog-photos-own-update" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'dog-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "dog-photos-own-delete" ON storage.objects;
CREATE POLICY "dog-photos-own-delete" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'dog-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );
