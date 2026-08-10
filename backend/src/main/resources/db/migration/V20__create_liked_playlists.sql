-- V20: Create liked_playlists join table for user-playlist likes
-- Referenced by Playlist.likedBy (Playlist.java @JoinTable name="liked_playlists")
-- This table was missing from the original Flyway V1-V19 sequence.

CREATE TABLE liked_playlists (
    user_id VARCHAR(36) NOT NULL,
    playlist_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, playlist_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);

CREATE INDEX idx_liked_playlists_user_id ON liked_playlists(user_id);
CREATE INDEX idx_liked_playlists_playlist_id ON liked_playlists(playlist_id);