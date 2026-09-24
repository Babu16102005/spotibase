-- ============================================================
-- V24: Fast prefix + fuzzy voice search indexes
-- ============================================================
-- Goal: make prefix autocomplete ("pla...") and fuzzy voice
-- transcripts ("bohemian rapsody") fast on songs / artists /
-- albums / playlists without touching existing data.
--
-- Verified against prior migrations:
--   songs(name, primary_artist_name [V19], album_name [V19],
--         mood_tags JSONB [V21], archived)            -- V5 + V19 + V21
--   artists(name)                                     -- V3 (no archived col)
--   albums(name, archived)                            -- V4
--   playlists(name, is_public, archived)              -- V6
--   pg_trgm extension + idx_songs_name_trgm,
--     idx_artists_name_trgm, idx_albums_name_trgm     -- V22
--   idx_songs_artist_name_trgm (primary_artist_name),
--     idx_songs_album_name_trgm (album_name)          -- V23
--   idx_songs_mood_tags / vibe_tags / activity_tags
--     (GIN on JSONB)                                  -- V21
--
-- Safety:
--   * CREATE-only migration: indexes + idempotent
--     CREATE EXTENSION. No ALTER COLUMN / DROP / UPDATE /
--     DELETE, so no data loss is possible.
--   * Every statement is IF NOT EXISTS -> re-runnable.
--   * No CONCURRENTLY on purpose: Flyway runs each migration
--     in a single transaction and CREATE INDEX CONCURRENTLY
--     cannot run inside a transaction block.
--
-- How SearchService / SongRepository should use these
-- (no Java change required -- operators below are served by
-- the indexes created here):
--   Fuzzy (typo-tolerant, pg_trgm %, case-sensitive):
--     WHERE name % :q
--        OR primary_artist_name % :q
--        OR album_name % :q
--     ORDER BY GREATEST(similarity(name, :q),
--                       similarity(primary_artist_name, :q),
--                       similarity(album_name, :q)) DESC
--     -- already used by SongRepository.searchSongs(); served by
--     -- the V22/V23 GIN trigram indexes re-asserted in §A.
--   Fuzzy voice (case-insensitive, transcripts vary in case):
--     WHERE lower(name) % lower(:q)
--        OR lower(primary_artist_name) % lower(:q)
--        OR lower(album_name) % lower(:q)
--     -- served by the lower() GIN trigram indexes in §B.
--   Prefix autocomplete (fast, case-insensitive):
--     WHERE lower(name) LIKE lower(:prefix || '%')
--        -- served by the lower() btree pattern_ops indexes in §C.
--     WHERE name LIKE :prefix || '%'
--        -- served by the plain btree pattern_ops indexes in §C.
--   Substring suggestions (ILIKE '%...%'):
--     WHERE name ILIKE '%' || :q || '%'
--     -- served by any GIN trigram index (§A/§B); pg_trgm
--     -- accelerates LIKE/ILIKE as well as % / similarity().
--   Mood-voice queries (e.g. "play something chill"):
--     WHERE mood_tags ? :mood            -- key existence
--        OR mood_tags @> to_jsonb(:mood) -- contains
--     -- served by idx_songs_mood_tags (V21, re-asserted in §A).
--   Threshold tuning is per-session, app-side (do NOT set it
--   globally here):
--     SET pg_trgm.similarity_threshold = 0.3;  -- default
--     -- lower (e.g. 0.2) = more tolerant voice matching.
-- ============================================================

-- Extension must exist before any gin_trgm_ops index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- §A. Re-assert core fuzzy / tag indexes (self-heal).
-- No-ops when V21/V22/V23 applied; heal DBs that skipped them.
--   songs(name), artist (denormalized + table), album
--   (denormalized + table), mood_tags GIN as requested.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_songs_name_trgm
    ON songs USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_songs_artist_name_trgm
    ON songs USING GIN (primary_artist_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_songs_album_name_trgm
    ON songs USING GIN (album_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_artists_name_trgm
    ON artists USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_albums_name_trgm
    ON albums USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_songs_mood_tags
    ON songs USING GIN (mood_tags);

CREATE INDEX IF NOT EXISTS idx_songs_vibe_tags
    ON songs USING GIN (vibe_tags);

CREATE INDEX IF NOT EXISTS idx_songs_activity_tags
    ON songs USING GIN (activity_tags);

-- ============================================================
-- §B. NEW: case-insensitive fuzzy voice search.
-- similarity() / % are case-sensitive, but voice transcripts
-- vary in case, so index lower() expressions. Query with
-- lower(col) % lower(:q) / similarity(lower(col), lower(:q)).
-- Songs partial predicate matches the app's archived = false
-- filter (SongRepository.searchSongs, suggestions). Artists
-- have no archived column -> full index. Playlists are queried
-- without an archived predicate (PlaylistRepository JPQL
-- filters is_public only) -> full index so it always applies.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_songs_name_lower_trgm
    ON songs USING GIN (lower(name) gin_trgm_ops)
    WHERE archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_songs_primary_artist_lower_trgm
    ON songs USING GIN (lower(primary_artist_name) gin_trgm_ops)
    WHERE archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_songs_album_name_lower_trgm
    ON songs USING GIN (lower(album_name) gin_trgm_ops)
    WHERE archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_artists_name_lower_trgm
    ON artists USING GIN (lower(name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_albums_name_lower_trgm
    ON albums USING GIN (lower(name) gin_trgm_ops)
    WHERE archived = FALSE;

-- Playlists had no trigram index (full scan on every playlist
-- search). Plain trgm serves both LIKE '%q%' and % / similarity().
CREATE INDEX IF NOT EXISTS idx_playlists_name_trgm
    ON playlists USING GIN (name gin_trgm_ops);

-- ============================================================
-- §C. NEW: fast prefix search (autocomplete + "play ..." voice
-- first-words). Default btree opclasses cannot do pattern range
-- scans under most locales, hence varchar_pattern_ops /
-- text_pattern_ops. lower() variants serve ILIKE 'prefix%'.
-- ============================================================
-- Songs: LIKE 'prefix%' (case-sensitive) on active catalog.
CREATE INDEX IF NOT EXISTS idx_songs_name_prefix
    ON songs (name varchar_pattern_ops)
    WHERE archived = FALSE;

-- Songs: ILIKE 'prefix%' via lower(name) LIKE lower(prefix% ).
CREATE INDEX IF NOT EXISTS idx_songs_name_lower_prefix
    ON songs (lower(name) text_pattern_ops)
    WHERE archived = FALSE;

-- Artists: prefix + ILIKE prefix (no archived column -> full).
CREATE INDEX IF NOT EXISTS idx_artists_name_prefix
    ON artists (name varchar_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_artists_name_lower_prefix
    ON artists (lower(name) text_pattern_ops);

-- Albums: prefix + ILIKE prefix on active catalog.
CREATE INDEX IF NOT EXISTS idx_albums_name_prefix
    ON albums (name varchar_pattern_ops)
    WHERE archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_albums_name_lower_prefix
    ON albums (lower(name) text_pattern_ops)
    WHERE archived = FALSE;

-- Playlists: prefix + ILIKE prefix (full index, see §B note).
CREATE INDEX IF NOT EXISTS idx_playlists_name_prefix
    ON playlists (name varchar_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_playlists_name_lower_prefix
    ON playlists (lower(name) text_pattern_ops);
