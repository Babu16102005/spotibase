-- ============================================================
-- V19: Contributing Artists, Album Artist, Denormalized Fields
-- ============================================================

-- Enable pg_trgm for fuzzy search (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 1. Song ↔ Contributing Artists (many-to-many with roles)
-- ============================================================
CREATE TABLE song_contributing_artists (
    song_id VARCHAR(36) NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    artist_id VARCHAR(36) NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'FEATURING',
    position INT NOT NULL DEFAULT 0,
    PRIMARY KEY (song_id, artist_id, role)
);

CREATE INDEX idx_song_contrib_artists_song ON song_contributing_artists(song_id);
CREATE INDEX idx_song_contrib_artists_artist ON song_contributing_artists(artist_id);
CREATE INDEX idx_song_contrib_artists_role ON song_contributing_artists(role);

-- ============================================================
-- 2. Add album_artist_id + denormalized fields to songs
-- ============================================================
ALTER TABLE songs 
    ADD COLUMN IF NOT EXISTS album_artist_id VARCHAR(36) REFERENCES artists(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS primary_artist_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS album_name VARCHAR(300),
    ADD COLUMN IF NOT EXISTS cover_url_cached VARCHAR(500);

-- Backfill denormalized fields from existing relationships.
-- (The UPDATE target cannot be referenced inside FROM joins, so resolve
-- the values in a CTE first.)
WITH resolved AS (
    SELECT
        s.id AS song_id,
        a.name AS artist_name,
        al.name AS album_name,
        COALESCE(s.cover_url, al.cover_url) AS cover
    FROM songs s
    JOIN artists a ON a.id = s.artist_id
    LEFT JOIN albums al ON al.id = s.album_id
)
UPDATE songs s
SET
    primary_artist_name = r.artist_name,
    album_name = r.album_name,
    cover_url_cached = r.cover
FROM resolved r
WHERE r.song_id = s.id
  AND (s.primary_artist_name IS NULL OR s.album_name IS NULL);

-- ============================================================
-- 3. Composite indexes for Spotify-like query patterns
-- ============================================================

-- Home feed: featured first, then newest
CREATE INDEX IF NOT EXISTS idx_songs_home_feed 
    ON songs(archived, featured DESC, release_date DESC) 
    WHERE archived = FALSE;

-- Artist page: songs by artist, newest first
CREATE INDEX IF NOT EXISTS idx_songs_artist_page 
    ON songs(artist_id, archived, release_date DESC) 
    WHERE archived = FALSE;

-- Album page: songs by album, ordered by disc/track
CREATE INDEX IF NOT EXISTS idx_songs_album_page 
    ON songs(album_id, disc_number, track_number) 
    WHERE archived = FALSE;

-- Album artist page: songs where artist is album artist
CREATE INDEX IF NOT EXISTS idx_songs_album_artist_page 
    ON songs(album_artist_id, archived, release_date DESC) 
    WHERE archived = FALSE AND album_artist_id IS NOT NULL;

-- Search: trigram indexes for fuzzy matching on denormalized fields
CREATE INDEX IF NOT EXISTS idx_songs_name_trgm 
    ON songs USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_songs_primary_artist_name_trgm 
    ON songs USING GIN (primary_artist_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_songs_album_name_trgm 
    ON songs USING GIN (album_name gin_trgm_ops);

-- Genre filtering
CREATE INDEX IF NOT EXISTS idx_songs_genre_listing 
    ON songs(genre_id, archived, release_date DESC) 
    WHERE archived = FALSE;

-- ============================================================
-- 4. Trigger to keep denormalized fields in sync
-- ============================================================
CREATE OR REPLACE FUNCTION sync_song_denormalized_fields() RETURNS trigger AS $$
BEGIN
    -- Sync primary artist name
    IF NEW.artist_id IS DISTINCT FROM OLD.artist_id OR NEW.primary_artist_name IS NULL THEN
        SELECT name INTO NEW.primary_artist_name 
        FROM artists WHERE id = NEW.artist_id;
    END IF;

    -- Sync album name and cover
    IF NEW.album_id IS DISTINCT FROM OLD.album_id OR NEW.album_name IS NULL THEN
        SELECT name, cover_url INTO NEW.album_name, NEW.cover_url_cached
        FROM albums WHERE id = NEW.album_id;
    END IF;

    -- Sync album artist name if needed
    IF NEW.album_artist_id IS DISTINCT FROM OLD.album_artist_id THEN
        -- album_artist_name would need a separate column if denormalized
        NULL; -- placeholder
    END IF;

    -- Fallback cover: song cover > album cover
    IF NEW.cover_url_cached IS NULL THEN
        NEW.cover_url_cached := COALESCE(NEW.cover_url, 
            (SELECT cover_url FROM albums WHERE id = NEW.album_id));
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_song_denormalized ON songs;
CREATE TRIGGER sync_song_denormalized 
    BEFORE INSERT OR UPDATE ON songs
    FOR EACH ROW EXECUTE FUNCTION sync_song_denormalized_fields();

-- ============================================================
-- 5. Trigger to update album stats when contributing artists change
-- ============================================================
-- (Album stats already handled in SongService.updateAlbumStats)

-- ============================================================
-- Migration complete
-- ============================================================