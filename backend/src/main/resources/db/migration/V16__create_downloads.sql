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
