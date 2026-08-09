CREATE TABLE songs (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(300) NOT NULL,
    artist_id VARCHAR(36) NOT NULL,
    album_id VARCHAR(36),
    genre_id VARCHAR(36),
    language VARCHAR(100),
    composer VARCHAR(300),
    lyrics TEXT,
    duration VARCHAR(10),
    duration_ms BIGINT NOT NULL DEFAULT 0,
    release_date DATE NOT NULL,
    track_number INT NOT NULL DEFAULT 1,
    disc_number INT NOT NULL DEFAULT 1,
    file_url VARCHAR(500),
    cover_url VARCHAR(500),
    file_format VARCHAR(50),
    file_size BIGINT NOT NULL DEFAULT 0,
    bitrate INT NOT NULL DEFAULT 320,
    sample_rate INT NOT NULL DEFAULT 44100,
    explicit BOOLEAN NOT NULL DEFAULT FALSE,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    play_count BIGINT NOT NULL DEFAULT 0,
    fts_vector tsvector,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE SET NULL,
    FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE SET NULL
);

CREATE INDEX idx_songs_name ON songs(name);
CREATE INDEX idx_songs_artist_id ON songs(artist_id);
CREATE INDEX idx_songs_album_id ON songs(album_id);
CREATE INDEX idx_songs_genre_id ON songs(genre_id);
CREATE INDEX idx_songs_language ON songs(language);
CREATE INDEX idx_songs_release_date ON songs(release_date);
CREATE INDEX idx_songs_play_count ON songs(play_count DESC);
CREATE INDEX idx_songs_fts ON songs USING GIN(fts_vector);
CREATE INDEX idx_songs_archived ON songs(archived) WHERE archived = FALSE;

-- Full-text search trigger
CREATE OR REPLACE FUNCTION songs_fts_trigger() RETURNS trigger AS $$
BEGIN
    NEW.fts_vector := to_tsvector('english', COALESCE(NEW.name, '') || ' ' || 
                                   COALESCE((SELECT a.name FROM artists a WHERE a.id = NEW.artist_id), '') || ' ' ||
                                   COALESCE(NEW.language, '') || ' ' ||
                                   COALESCE(NEW.composer, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER songs_fts_update BEFORE INSERT OR UPDATE ON songs
    FOR EACH ROW EXECUTE FUNCTION songs_fts_trigger();
