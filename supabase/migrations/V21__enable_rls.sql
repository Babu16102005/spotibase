-- ============================================================
-- V21: Row Level Security on application tables
-- ============================================================
-- WHY THIS IS SAFE FOR THE BACKEND:
--   The Spring backend connects to the database as the `postgres`
--   superuser role (application.yml: SPRING_DATASOURCE_USERNAME defaults
--   to `postgres.<project-ref>` on the Supabase pooler). Superusers and
--   table owners BYPASS RLS, so enabling RLS does not affect the
--   backend's JDBC/JPA read/write path at all. We deliberately do NOT
--   use FORCE ROW LEVEL SECURITY, which would also restrict the owner.
--
-- WHAT IT ACHIEVES:
--   PostgREST (the REST API exposed through SUPABASE_URL with the anon
--   key) is a real attack surface: without RLS, the anon key can read
--   and write every table — including users.email / password_hash and
--   listening history. Enabling RLS with NO anon/authenticated policies
--   makes all app data invisible and immutable through PostgREST.
--   A permissive policy is added ONLY for service_role, so future
--   server-side REST access keeps working.
--
-- WHY NO anon/authenticated POLICIES:
--   The app authenticates with its own JWT (SecurityConfig.java), which
--   Supabase does not recognize, and it never queries data through
--   PostgREST — only through JPA/JDBC as `postgres`. An anon/authenticated
--   policy would grant data access to any client holding the (public)
--   anon key, which is the exact scenario RLS is meant to prevent.
--   If a future feature needs PostgREST data access (e.g. realtime),
--   add narrowly-scoped policies then, per feature.
-- ============================================================

-- Helper: enable RLS + service-role-only access for one table.
-- (Service role bypasses RLS anyway; the explicit policy documents intent
-- and keeps REST access working even if BYPASSRLS is ever removed.)
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'users', 'user_favorite_genres', 'genres', 'artists', 'albums',
        'songs', 'playlists', 'playlist_songs', 'liked_songs',
        'liked_albums', 'liked_artists', 'followers', 'listening_history',
        'recently_played', 'queues', 'notifications', 'downloads',
        'user_settings', 'song_contributing_artists'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format(
            'DROP POLICY IF EXISTS "service_role_all" ON %I;', tbl);
        EXECUTE format(
            'CREATE POLICY "service_role_all" ON %I FOR ALL TO service_role USING (true) WITH CHECK (true);',
            tbl);
    END LOOP;
END $$;
