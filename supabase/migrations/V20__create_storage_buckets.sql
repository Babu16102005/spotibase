-- ============================================================
-- V20: Supabase Storage — "spotibase" bucket + access policies
-- ============================================================
-- The backend (backend/src/main/java/com/spotibase/service/StorageService.java)
-- uploads everything with the SERVICE_ROLE key and falls back to
-- auto-creating the bucket via REST if it is missing. This migration makes
-- the bucket and its security model explicit and idempotent, so the same
-- settings exist everywhere the schema is applied:
--
--   * bucket name:    spotibase
--   * public:         true   -> public URLs /storage/v1/object/public/spotibase/<path>
--   * size limit:     52,428,800 bytes (50 MiB) — matches the backend's
--                     50 MB cap in StorageService.validateAudioFile()
--   * mime types:     images + audio — everything the backend validates
--
-- Path layout used by the backend (application.yml -> supabase.storage.*):
--   songs/{artistId}/<uuid>.<ext>     (Supabase fallback; R2 is primary)
--   covers/{ownerId}/<uuid>.<ext>
--   avatars/{userId}/<uuid>.<ext>
--
-- SECURITY MODEL (documented decision):
--   The app authenticates with its OWN JWT (SecurityConfig.java) — Supabase
--   Auth is NOT used — so clients never hold a valid Supabase token.
--   All uploads/deletes are server-mediated: the Spring backend signs every
--   storage request with the service-role key. Therefore:
--     * SELECT  -> PUBLIC: the bucket is public by design (covers/avatars
--                  are served to unauthenticated clients via public URLs).
--     * INSERT / UPDATE / DELETE -> service_role ONLY.
--     * There is intentionally NO anon/authenticated write policy.
-- ============================================================

-- 1. Create/update the bucket (idempotent).
--    file_size_limit is stored in BYTES: 52428800 = 50 MiB.
--    (id and name are the same string, as the storage API expects.)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'spotibase',
    'spotibase',
    TRUE,
    52428800,
    ARRAY[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
        'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac',
        'audio/aac', 'audio/mp4', 'audio/ogg', 'audio/x-m4a'
    ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public             = EXCLUDED.public,
    file_size_limit    = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 2. RLS policies on storage.objects
--    (storage.objects ships with RLS already enabled; these four
--    policies are the only ones SpotiBase needs.)
-- ============================================================

-- 2a. Public read: any role (anon / authenticated / service_role) may read.
DROP POLICY IF EXISTS "spotibase_public_read" ON storage.objects;
CREATE POLICY "spotibase_public_read" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'spotibase');

-- 2b. Writes are server-mediated only (service role).
DROP POLICY IF EXISTS "spotibase_insert_service" ON storage.objects;
CREATE POLICY "spotibase_insert_service" ON storage.objects
    FOR INSERT TO service_role
    WITH CHECK (bucket_id = 'spotibase');

DROP POLICY IF EXISTS "spotibase_update_service" ON storage.objects;
CREATE POLICY "spotibase_update_service" ON storage.objects
    FOR UPDATE TO service_role
    USING (bucket_id = 'spotibase')
    WITH CHECK (bucket_id = 'spotibase');

DROP POLICY IF EXISTS "spotibase_delete_service" ON storage.objects;
CREATE POLICY "spotibase_delete_service" ON storage.objects
    FOR DELETE TO service_role
    USING (bucket_id = 'spotibase');
