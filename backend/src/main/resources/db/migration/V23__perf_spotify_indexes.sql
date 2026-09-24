-- ============================================================
-- V23: Spotify-like listing / search performance indexes
-- ============================================================
-- NOTE: No CONCURRENTLY here on purpose — Flyway runs each
-- migration in a single transaction and CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction block.
-- Plain CREATE INDEX IF NOT EXISTS keeps the migration
-- idempotent and re-runnable.
--
-- Verified against prior migrations:
--   songs(archived, created_at, play_count, release_date, name,
--         primary_artist_name [V19], album_name [V19])  -- V5 + V19
--   users(email, active)                                -- V1 (column is `active`, not `is_active`)
--   liked_songs(user_id, song_id, liked_at)             -- V8
--   listening_history(user_id, song_id, skipped,
--                     played_at)                         -- V12
--   pg_trgm extension                                   -- V22 (required for the GIN trigram indexes)
-- ============================================================

-- Active-song listing: default browse / "all songs" ordered newest-first.
-- Matches: SELECT ... WHERE archived = false ORDER BY created_at DESC (+ id tiebreak).
CREATE INDEX IF NOT EXISTS idx_songs_active_created
    ON songs(archived, created_at DESC, id ASC)
    WHERE archived = FALSE;

-- Top charts / popular: matches findTopSongs
-- (WHERE archived = false ORDER BY play_count DESC, created_at DESC).
CREATE INDEX IF NOT EXISTS idx_songs_active_playcount
    ON songs(archived, play_count DESC, created_at DESC)
    WHERE archived = FALSE;

-- New releases: matches findNewReleases
-- (WHERE archived = false ORDER BY created_at DESC, release_date DESC).
CREATE INDEX IF NOT EXISTS idx_songs_active_new
    ON songs(archived, created_at DESC, release_date DESC)
    WHERE archived = FALSE;

-- Active-song name lookup / prefix search ordering.
CREATE INDEX IF NOT EXISTS idx_songs_active_name
    ON songs(archived, name)
    WHERE archived = FALSE;

-- Fuzzy search on denormalized fields (pg_trgm enabled in V22).
-- Matches searchSongs() similarity() / % operator usage.
CREATE INDEX IF NOT EXISTS idx_songs_artist_name_trgm
    ON songs USING GIN (primary_artist_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_songs_album_name_trgm
    ON songs USING GIN (album_name gin_trgm_ops);

-- Active-user email lookup (login / session resolution).
-- Column is `active` per V1__create_users.sql.
CREATE INDEX IF NOT EXISTS idx_users_email_active
    ON users(email)
    WHERE active = TRUE;

-- Liked-songs lookups by (user, song).
-- NOTE: PRIMARY KEY (user_id, song_id) from V8 already provides this
-- ordering; this index is kept for explicit query-plan stability and
-- is a no-op duplicate if the PK index satisfies the planner.
CREATE INDEX IF NOT EXISTS idx_liked_songs_user_song
    ON liked_songs(user_id, song_id);

-- Listening-history joins / existence checks by (user, song).
CREATE INDEX IF NOT EXISTS idx_listening_history_user_song
    ON listening_history(user_id, song_id);

-- Listening-history filtered views (e.g. skipped vs completed,
-- "recently played excluding skips" ordered by recency).
CREATE INDEX IF NOT EXISTS idx_listening_history_user_skipped_played
    ON listening_history(user_id, skipped, played_at DESC);
