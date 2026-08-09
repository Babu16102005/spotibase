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
