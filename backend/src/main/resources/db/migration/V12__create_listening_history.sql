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
