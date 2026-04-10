-- ========================================================================
-- BreedIQ · Dog Photos Storage Bucket
-- Run this in the Supabase SQL editor (or dashboard → Storage → New bucket)
-- ========================================================================

-- 1. Create bucket (public read, authenticated write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'dog-photos',
    'dog-photos',
    true,                                                 -- public read
    5242880,                                              -- 5 MB per file
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. RLS policies — users can only write in their own {user_id}/ folder

-- Anyone can read (since bucket is public)
DROP POLICY IF EXISTS "dog-photos-public-read" ON storage.objects;
CREATE POLICY "dog-photos-public-read" ON storage.objects
    FOR SELECT
    USING (bucket_id = 'dog-photos');

-- Authenticated users can upload into their own folder
DROP POLICY IF EXISTS "dog-photos-own-insert" ON storage.objects;
CREATE POLICY "dog-photos-own-insert" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'dog-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Authenticated users can update/replace their own files
DROP POLICY IF EXISTS "dog-photos-own-update" ON storage.objects;
CREATE POLICY "dog-photos-own-update" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'dog-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Authenticated users can delete their own files
DROP POLICY IF EXISTS "dog-photos-own-delete" ON storage.objects;
CREATE POLICY "dog-photos-own-delete" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'dog-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- ========================================================================
-- Done. After this runs, dog.html's upload button will work once the
-- anon key + URL are exposed to the client (see config.js setup step).
-- ========================================================================
