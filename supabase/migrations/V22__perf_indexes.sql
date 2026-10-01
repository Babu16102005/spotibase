-- ============================================================
-- V22: Perf indexes for hot card-feed paths
-- ============================================================
-- CONTEXT:
--   Frontend React Query + backend Caffeine L1 + Redis 30s + ?fields=card
--   already done. This migration closes the last index gaps in
--   supabase-schema.sql so every hot path is index-backed and the
--   cache-miss path (Postgres) stays fast.
--
-- SAFETY:
--   * All statements are idempotent (IF NOT EXISTS).
--   * Plain CREATE INDEX (no CONCURRENTLY) so this runs inside the
--     Supabase migration transaction / SQL Editor. Table locks are
--     brief; tables are small (<1M rows expected). For zero-downtime
--     on very large songs tables, run the same definitions manually
--     with CONCURRENTLY outside a transaction instead.
--   * Does NOT alter columns, constraints, triggers, or RLS.
--     V21 RLS policies are unaffected (indexes don't change visibility).
--   * Rollback (run only if you need to revert V22):
--       DROP INDEX IF EXISTS idx_songs_featured;
--       DROP INDEX IF EXISTS idx_songs_created_at;
--       -- NOTE: idx_playlist_songs_position already existed since V7 /
--       -- supabase-schema.sql; do NOT drop it on rollback unless you
--       -- intend to revert V7 as well.
-- ============================================================

-- 1. songs(featured) — MISSING in supabase-schema.sql / V5.
--    V19 idx_songs_home_feed (archived, featured DESC, release_date DESC)
--    covers one composite ordering, but there was no simple partial
--    index matching the albums/playlists convention:
--      albums    -> idx_albums_featured    WHERE featured = TRUE
--      playlists -> idx_playlists_featured WHERE featured = TRUE
--    Hot path: GET /songs?featured=true&fields=card (featured carousel,
--    home feed cache-miss). Partial index keeps it tiny (only featured rows).
CREATE INDEX IF NOT EXISTS idx_songs_featured
    ON songs(featured)
    WHERE featured = TRUE;

-- 2. songs(created_at DESC) for new-releases — MISSING in
--    supabase-schema.sql / V5. Only idx_songs_release_date existed, but
--    the new-releases feed orders by ingestion time (created_at), not
--    release_date. Partial predicate matches the card-feed filter
--    (archived = FALSE) used by ?fields=card listings.
--    Hot path: GET /songs?sort=newest&fields=card ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS idx_songs_created_at
    ON songs(created_at DESC)
    WHERE archived = FALSE;

-- 3. playlist_songs(playlist_id, position) — ALREADY EXISTS as
--    idx_playlist_songs_position since V7 / supabase-schema.sql.
--    Re-asserted here with IF NOT EXISTS so environments that applied
--    migrations out of order or partial V7 still converge. No-op otherwise.
--    Hot path: GET /playlists/{id}/songs?fields=card ORDER BY position.
CREATE INDEX IF NOT EXISTS idx_playlist_songs_position
    ON playlist_songs(playlist_id, position);

-- ============================================================
-- Verification queries (run after applying):
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename IN ('songs','playlist_songs')
--      AND indexname IN ('idx_songs_featured','idx_songs_created_at',
--                        'idx_playlist_songs_position');
-- Expected: 3 rows.
--
--   EXPLAIN (COSTS OFF)
--   SELECT id, name FROM songs WHERE featured = TRUE LIMIT 20;
-- Expected: Index Scan using idx_songs_featured (or idx_songs_home_feed).
--
--   EXPLAIN (COSTS OFF)
--   SELECT id, name FROM songs WHERE archived = FALSE
--    ORDER BY created_at DESC LIMIT 20;
-- Expected: Index Scan using idx_songs_created_at.
-- ============================================================
