-- ============================================================
-- V23: Home HEAVY-tier indexes (daily-mixes / made-for-you)
-- ============================================================
-- CONTEXT:
--   Home HEAVY tier (RecommendationService.getDailyMix /
--   getMadeForYou / getBasedOnListening, fanned out via
--   getHomeHeavy with 1500ms fail-open timeout) is the heaviest
--   Postgres path on the home feed. Critical/secondary tiers are
--   already covered (V19 home_feed / genre_listing, V22 featured /
--   created_at). This migration closes the remaining gaps so the
--   cache-miss path stays fast:
--
--   Q1 daily-mix genres:
--     SELECT g.id, g.name FROM listening_history lh
--     JOIN songs s ON lh.song_id = s.id
--     JOIN genres g ON s.genre_id = g.id
--     WHERE lh.user_id = ? AND lh.skipped = false
--     GROUP BY g.id, g.name ORDER BY COUNT(*) DESC LIMIT 6
--   Q2 per-genre candidates (x up to 6) + made-for-you candidates:
--     SELECT s.id FROM songs s
--     WHERE s.genre_id = ? AND s.archived = false
--     AND s.id NOT IN (
--       SELECT lh.song_id FROM listening_history lh
--       WHERE lh.user_id = ?)
--     ORDER BY s.play_count DESC LIMIT 10/30
--   Q3 recent history (based-on-listening):
--     SELECT lh.song_id FROM listening_history lh
--     WHERE lh.user_id = ? AND lh.skipped = false
--     ORDER BY lh.played_at DESC LIMIT 10
--   Q4 trending / popular fallback:
--     SELECT ... FROM songs
--     WHERE archived = false ORDER BY play_count DESC LIMIT n
--   Q5 recently-played rail (HEAVY shares loader with critical):
--     SELECT ... FROM recently_played
--     WHERE user_id = ? ORDER BY played_at DESC LIMIT 20
--
-- VERIFIED AGAINST PRIOR SUPABASE MIGRATIONS:
--   listening_history(user_id, song_id, skipped, played_at) -- V12
--   songs(genre_id, play_count, archived)                   -- V5
--   recently_played(user_id, played_at, item_type, item_id) -- V13
--   (Supabase track is at V22; backend Flyway V23/V25 carry the
--   same definitions under the same names where exact.)
--
-- SAFETY:
--   * CREATE-only migration: 5x CREATE INDEX, no ALTER / DROP /
--     UPDATE / DELETE, no column/constraint/trigger/RLS change.
--     V21 RLS policies are unaffected (indexes don't change
--     visibility). No schema break for PostgREST / JPA entities
--     (ListeningHistory, RecentlyPlayed, Song unchanged).
--   * Every statement is IF NOT EXISTS -> idempotent, re-runnable,
--     safe for out-of-order / partial applies.
--   * Plain CREATE INDEX (no CONCURRENTLY) so this runs inside the
--     Supabase migration transaction / SQL Editor. Table locks are
--     brief; tables are small (<1M rows expected). For zero-downtime
--     on very large songs/listening_history tables, run the same
--     definitions manually with CONCURRENTLY outside a transaction.
--   * Rollback (run only if you need to revert V23):
--       DROP INDEX IF EXISTS idx_listening_history_user_skipped_played;
--       DROP INDEX IF EXISTS idx_listening_history_user_song;
--       DROP INDEX IF EXISTS idx_songs_genre_playcount;
--       DROP INDEX IF EXISTS idx_songs_archived_playcount;
--       -- NOTE: idx_recently_played_played_at dates to V13; it is
--       -- re-asserted here with IF NOT EXISTS (no-op when V13
--       -- applied) so do NOT drop it on V23 rollback unless you
--       -- intend to revert V13 as well.
-- ============================================================

-- 1. listening_history(user_id, skipped, played_at DESC)
--    Serves Q1 (WHERE user_id = ? AND skipped = false, grouped for
--    genre affinity) and Q3 (same predicate + ORDER BY played_at
--    DESC LIMIT 10). Leading (user_id, skipped) narrows to the
--    user's completed plays; played_at DESC delivers recency order
--    directly from the index without a sort.
--    Name matches backend Flyway V23 for cross-track consistency.
CREATE INDEX IF NOT EXISTS idx_listening_history_user_skipped_played
    ON listening_history(user_id, skipped, played_at DESC);

-- 2. listening_history(user_id, song_id)
--    Serves the Q2 anti-join: s.id NOT IN (SELECT lh.song_id WHERE
--    lh.user_id = ?). Lets the planner probe one user's history by
--    index instead of scanning. (V12 only had single-column
--    (user_id) and (song_id) indexes; the composite covers the
--    correlated subquery's exact predicate shape.)
--    Name matches backend Flyway V23 for cross-track consistency.
CREATE INDEX IF NOT EXISTS idx_listening_history_user_song
    ON listening_history(user_id, song_id);

-- 3. songs(genre_id, play_count DESC) WHERE archived = FALSE
--    Serves Q2 per-genre / made-for-you candidates:
--    WHERE genre_id = ? AND archived = false
--    ORDER BY play_count DESC LIMIT n.
--    Partial predicate keeps only the servable catalog (archived
--    rows excluded), so the index stays small and the top-N comes
--    back as a pure index scan. (V5 had separate (genre_id) and
--    (play_count DESC) indexes; V19 idx_songs_genre_listing orders
--    by release_date, not play_count -- neither serves this
--    ORDER BY shape.)
CREATE INDEX IF NOT EXISTS idx_songs_genre_playcount
    ON songs(genre_id, play_count DESC)
    WHERE archived = FALSE;

-- 4. songs(archived, play_count DESC) WHERE archived = FALSE
--    Serves Q4 trending / popular fallback:
--    WHERE archived = false ORDER BY play_count DESC LIMIT n.
--    The leading `archived` key mirrors the backend V23 composite
--    convention (planner stability for the archived-first predicate
--    shape); it is constant FALSE inside the partial index, so the
--    effective ordering is play_count DESC over servable rows only.
CREATE INDEX IF NOT EXISTS idx_songs_archived_playcount
    ON songs(archived, play_count DESC)
    WHERE archived = FALSE;

-- 5. recently_played(user_id, played_at DESC) -- RE-ASSERT V13
--    Serves Q5: WHERE user_id = ? ORDER BY played_at DESC LIMIT 20.
--    Already exists as idx_recently_played_played_at since V13 /
--    supabase-schema.sql; re-asserted here with IF NOT EXISTS so
--    environments that applied migrations out of order or partial
--    V13 still converge. No-op otherwise -- creates NO duplicate
--    index and NO extra write overhead when V13 is present.
CREATE INDEX IF NOT EXISTS idx_recently_played_played_at
    ON recently_played(user_id, played_at DESC);

-- ============================================================
-- Verification queries (run after applying):
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename IN ('listening_history','songs','recently_played')
--      AND indexname IN ('idx_listening_history_user_skipped_played',
--                        'idx_listening_history_user_song',
--                        'idx_songs_genre_playcount',
--                        'idx_songs_archived_playcount',
--                        'idx_recently_played_played_at');
-- Expected: 5 rows.
--
--   EXPLAIN (COSTS OFF)
--   SELECT lh.song_id FROM listening_history lh
--    WHERE lh.user_id = 'u1' AND lh.skipped = false
--    ORDER BY lh.played_at DESC LIMIT 10;
-- Expected: Index Scan using idx_listening_history_user_skipped_played.
--
--   EXPLAIN (COSTS OFF)
--   SELECT s.id FROM songs s
--    WHERE s.genre_id = 'g1' AND s.archived = false
--      AND s.id NOT IN (
--        SELECT lh.song_id FROM listening_history lh
--        WHERE lh.user_id = 'u1')
--    ORDER BY s.play_count DESC LIMIT 10;
-- Expected: Index Scan using idx_songs_genre_playcount for the outer
--   songs access + Index (Only) Scan using
--   idx_listening_history_user_song for the anti-join subquery.
--
--   EXPLAIN (COSTS OFF)
--   SELECT s.id FROM songs s
--    WHERE s.archived = false
--    ORDER BY s.play_count DESC LIMIT 30;
-- Expected: Index Scan using idx_songs_archived_playcount.
--
--   EXPLAIN (COSTS OFF)
--   SELECT * FROM recently_played
--    WHERE user_id = 'u1' ORDER BY played_at DESC LIMIT 20;
-- Expected: Index Scan using idx_recently_played_played_at.
-- ============================================================
