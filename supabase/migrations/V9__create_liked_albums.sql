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
