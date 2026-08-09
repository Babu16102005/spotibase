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
