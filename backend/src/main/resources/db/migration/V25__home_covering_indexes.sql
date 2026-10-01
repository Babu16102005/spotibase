-- ============================================================
-- V25: Home-screen covering indexes
-- ============================================================
-- Goal: make home-screen queries index-only (covering) and
-- avoid heap fetches / sorts on the hot paths:
--   recently-played feed, genre top-charts, listening-history
--   lookups, liked-library checks, new-releases feed.
--
-- Verified against prior migrations (V5, V8-V10, V12-V13):
--   recently_played(user_id, item_type, item_id, played_at) -- V13
--   songs(genre_id, play_count, created_at, archived,
--         release_date, artist_id)                          -- V5
--   listening_history(user_id, song_id, played_at)          -- V12
--   liked_songs(user_id, song_id, liked_at)                 -- V8
--   liked_albums(user_id, album_id, liked_at)               -- V9
--   liked_artists(user_id, artist_id, liked_at)             -- V10
--
-- Safety:
--   * CREATE-only migration: indexes only, no ALTER / DROP /
--     UPDATE / DELETE, so no data loss is possible.
--   * Every statement is IF NOT EXISTS -> re-runnable.
--   * No CONCURRENTLY on purpose: Flyway runs each migration
--     in a single transaction and CREATE INDEX CONCURRENTLY
--     cannot run inside a transaction block.
-- ============================================================

-- 1. Recently-played feed: WHERE user_id = ? ORDER BY played_at DESC
--    Covering (item_type, item_id) so the feed resolves as an
--    index-only scan without touching the heap.
CREATE INDEX IF NOT EXISTS idx_recently_played_user_played_cover
    ON recently_played (user_id, played_at DESC)
    INCLUDE (item_type, item_id);

-- 2. Genre top-charts: WHERE genre_id = ? AND archived = FALSE
--    ORDER BY play_count DESC, created_at DESC
--    Partial index keeps only the servable catalog (archived = FALSE).
CREATE INDEX IF NOT EXISTS idx_songs_genre_playcount
    ON songs (genre_id, play_count DESC, created_at DESC)
    WHERE archived = FALSE;

-- 3. Listening-history lookups: WHERE user_id = ? AND song_id = ?
--    ORDER BY played_at DESC (dedup / resume / history checks).
CREATE INDEX IF NOT EXISTS idx_listening_history_user_song_cover
    ON listening_history (user_id, song_id, played_at DESC);

-- 4a. Liked-songs library: WHERE user_id = ? ORDER BY liked_at DESC
--    NOTE: spec asked for INCLUDE (id), but liked_songs has no `id`
--    column -- PK is (user_id, song_id). INCLUDE (song_id) makes it
--    covering with zero heap fetches instead of failing the migration.
CREATE INDEX IF NOT EXISTS idx_liked_songs_user_liked
    ON liked_songs (user_id, liked_at DESC)
    INCLUDE (song_id);

-- 4b. Liked-artists library: same shape, PK is (user_id, artist_id).
CREATE INDEX IF NOT EXISTS idx_liked_artists_user_liked
    ON liked_artists (user_id, liked_at DESC)
    INCLUDE (artist_id);

-- 4c. Liked-albums library: same shape, PK is (user_id, album_id).
CREATE INDEX IF NOT EXISTS idx_liked_albums_user_liked
    ON liked_albums (user_id, liked_at DESC)
    INCLUDE (album_id);

-- 5. New-releases feed: WHERE archived = FALSE ORDER BY release_date DESC
--    Covering (artist_id, genre_id) so cards render from the index.
--    NOTE: leading `archived` key column is redundant with the partial
--    predicate (archived is constant FALSE inside the index), so only
--    release_date is keyed; predicate preserves the requested scoping.
CREATE INDEX IF NOT EXISTS idx_songs_active_release
    ON songs (release_date DESC)
    INCLUDE (artist_id, genre_id)
    WHERE archived = FALSE;
