-- ============================================================
-- SpotiBase Database Schema
-- Run this entire script in Supabase SQL Editor
-- ============================================================

-- V18 (part 1): Extensions must be enabled first
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- V1: Users
-- ============================================================
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(100) NOT NULL UNIQUE,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(500),
    avatar_url VARCHAR(500),
    cover_url VARCHAR(500),
    bio VARCHAR(500),
    country VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    supabase_uid VARCHAR(500),
    auth_provider VARCHAR(100),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    total_listening_time_ms BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE user_favorite_genres (
    user_id VARCHAR(36) NOT NULL,
    genre VARCHAR(100) NOT NULL,
    PRIMARY KEY (user_id, genre),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(active);
CREATE INDEX idx_users_created_at ON users(created_at);

-- ============================================================
-- V2: Genres
-- ============================================================
CREATE TABLE genres (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    image_url VARCHAR(500),
    color VARCHAR(10),
    sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_genres_name ON genres(name);

-- ============================================================
-- V3: Artists
-- ============================================================
CREATE TABLE artists (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    bio TEXT,
    image_url VARCHAR(500),
    cover_url VARCHAR(500),
    monthly_listeners BIGINT NOT NULL DEFAULT 0,
    follower_count BIGINT NOT NULL DEFAULT 0,
    user_id VARCHAR(36),
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_artists_name ON artists(name);
CREATE INDEX idx_artists_user_id ON artists(user_id);
CREATE INDEX idx_artists_monthly_listeners ON artists(monthly_listeners DESC);

-- ============================================================
-- V4: Albums
-- ============================================================
CREATE TABLE albums (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(300) NOT NULL,
    description TEXT,
    artist_id VARCHAR(36) NOT NULL,
    genre_id VARCHAR(36),
    cover_url VARCHAR(500),
    release_date DATE NOT NULL,
    song_count INT NOT NULL DEFAULT 0,
    total_duration_ms BIGINT NOT NULL DEFAULT 0,
    type VARCHAR(100) DEFAULT 'ALBUM',
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE,
    FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE SET NULL
);

CREATE INDEX idx_albums_name ON albums(name);
CREATE INDEX idx_albums_artist_id ON albums(artist_id);
CREATE INDEX idx_albums_genre_id ON albums(genre_id);
CREATE INDEX idx_albums_release_date ON albums(release_date);
CREATE INDEX idx_albums_featured ON albums(featured) WHERE featured = TRUE;

-- ============================================================
-- V5: Songs
-- ============================================================
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

-- ============================================================
-- V6: Playlists
-- ============================================================
CREATE TABLE playlists (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(300) NOT NULL,
    description TEXT,
    user_id VARCHAR(36) NOT NULL,
    cover_url VARCHAR(500),
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    is_collaborative BOOLEAN NOT NULL DEFAULT FALSE,
    song_count INT NOT NULL DEFAULT 0,
    total_duration_ms BIGINT NOT NULL DEFAULT 0,
    type VARCHAR(20) DEFAULT 'USER',
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    like_count BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_playlists_user_id ON playlists(user_id);
CREATE INDEX idx_playlists_name ON playlists(name);
CREATE INDEX idx_playlists_is_public ON playlists(is_public);
CREATE INDEX idx_playlists_featured ON playlists(featured) WHERE featured = TRUE;

-- ============================================================
-- V7: Playlist Songs
-- ============================================================
CREATE TABLE playlist_songs (
    id VARCHAR(36) PRIMARY KEY,
    playlist_id VARCHAR(36) NOT NULL,
    song_id VARCHAR(36) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    added_by VARCHAR(36),
    added_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    UNIQUE (playlist_id, position)
);

CREATE INDEX idx_playlist_songs_playlist_id ON playlist_songs(playlist_id);
CREATE INDEX idx_playlist_songs_song_id ON playlist_songs(song_id);
CREATE INDEX idx_playlist_songs_position ON playlist_songs(playlist_id, position);

-- ============================================================
-- V8: Liked Songs
-- ============================================================
CREATE TABLE liked_songs (
    user_id VARCHAR(36) NOT NULL,
    song_id VARCHAR(36) NOT NULL,
    liked_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, song_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE INDEX idx_liked_songs_user_id ON liked_songs(user_id);
CREATE INDEX idx_liked_songs_song_id ON liked_songs(song_id);

-- ============================================================
-- V9: Liked Albums
-- ============================================================
CREATE TABLE liked_albums (
    user_id VARCHAR(36) NOT NULL,
    album_id VARCHAR(36) NOT NULL,
    liked_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, album_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);

CREATE INDEX idx_liked_albums_user_id ON liked_albums(user_id);
CREATE INDEX idx_liked_albums_album_id ON liked_albums(album_id);

-- ============================================================
-- V10: Liked Artists
-- ============================================================
CREATE TABLE liked_artists (
    user_id VARCHAR(36) NOT NULL,
    artist_id VARCHAR(36) NOT NULL,
    liked_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, artist_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE INDEX idx_liked_artists_user_id ON liked_artists(user_id);
CREATE INDEX idx_liked_artists_artist_id ON liked_artists(artist_id);

-- ============================================================
-- V11: Followers
-- ============================================================
CREATE TABLE followers (
    follower_id VARCHAR(36) NOT NULL,
    following_id VARCHAR(36) NOT NULL,
    followed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id),
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
    CHECK (follower_id != following_id)
);

CREATE INDEX idx_followers_follower_id ON followers(follower_id);
CREATE INDEX idx_followers_following_id ON followers(following_id);

-- ============================================================
-- V12: Listening History
-- ============================================================
CREATE TABLE listening_history (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    song_id VARCHAR(36) NOT NULL,
    duration_played_ms BIGINT NOT NULL DEFAULT 0,
    source VARCHAR(50),
    skipped BOOLEAN NOT NULL DEFAULT FALSE,
    played_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_listening_history_user_id ON listening_history(user_id);
CREATE INDEX idx_listening_history_song_id ON listening_history(song_id);
CREATE INDEX idx_listening_history_played_at ON listening_history(user_id, played_at DESC);
CREATE INDEX idx_listening_history_source ON listening_history(source);

-- ============================================================
-- V13: Recently Played
-- ============================================================
CREATE TABLE recently_played (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    item_type VARCHAR(20) NOT NULL,
    item_id VARCHAR(36) NOT NULL,
    played_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, item_type, item_id)
);

CREATE INDEX idx_recently_played_user_id ON recently_played(user_id);
CREATE INDEX idx_recently_played_played_at ON recently_played(user_id, played_at DESC);
CREATE INDEX idx_recently_played_item ON recently_played(item_type, item_id);

-- ============================================================
-- V14: Queues
-- ============================================================
CREATE TABLE queues (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    song_id VARCHAR(36) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    source VARCHAR(50),
    played BOOLEAN NOT NULL DEFAULT FALSE,
    added_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_queues_user_id ON queues(user_id);
CREATE INDEX idx_queues_position ON queues(user_id, position);

-- ============================================================
-- V15: Notifications
-- ============================================================
CREATE TABLE notifications (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(300) NOT NULL,
    body TEXT,
    data_json JSONB,
    image_url VARCHAR(500),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created_at ON notifications(user_id, created_at DESC);

-- ============================================================
-- V16: Downloads
-- ============================================================
CREATE TABLE downloads (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    song_id VARCHAR(36) NOT NULL,
    file_path VARCHAR(500),
    quality VARCHAR(50) DEFAULT 'HIGH',
    status VARCHAR(50) DEFAULT 'DOWNLOADING',
    file_size BIGINT NOT NULL DEFAULT 0,
    downloaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_played_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, song_id)
);

CREATE INDEX idx_downloads_user_id ON downloads(user_id);
CREATE INDEX idx_downloads_song_id ON downloads(song_id);
CREATE INDEX idx_downloads_status ON downloads(user_id, status);

-- ============================================================
-- V17: User Settings
-- ============================================================
CREATE TABLE user_settings (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL UNIQUE,
    streaming_quality VARCHAR(20) DEFAULT 'HIGH',
    download_quality VARCHAR(20) DEFAULT 'HIGH',
    crossfade_duration INT NOT NULL DEFAULT 0,
    gapless_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    normalize_volume BOOLEAN NOT NULL DEFAULT TRUE,
    explicit_filter BOOLEAN NOT NULL DEFAULT FALSE,
    mono_audio BOOLEAN NOT NULL DEFAULT FALSE,
    bass_boost INT NOT NULL DEFAULT 0,
    treble INT NOT NULL DEFAULT 0,
    theme VARCHAR(20) DEFAULT 'DARK',
    language VARCHAR(10) DEFAULT 'en',
    wifi_only_download BOOLEAN NOT NULL DEFAULT FALSE,
    smart_downloads BOOLEAN NOT NULL DEFAULT TRUE,
    auto_play BOOLEAN NOT NULL DEFAULT TRUE,
    sleep_timer_minutes INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- V18 (part 2): Additional Indexes & Triggers
-- ============================================================
CREATE INDEX idx_songs_name_trgm ON songs USING GIN (name gin_trgm_ops);
CREATE INDEX idx_artists_name_trgm ON artists USING GIN (name gin_trgm_ops);
CREATE INDEX idx_albums_name_trgm ON albums USING GIN (name gin_trgm_ops);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_artists_updated_at BEFORE UPDATE ON artists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_albums_updated_at BEFORE UPDATE ON albums
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_songs_updated_at BEFORE UPDATE ON songs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_playlists_updated_at BEFORE UPDATE ON playlists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Schema created successfully!
-- ============================================================
