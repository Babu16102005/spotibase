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
