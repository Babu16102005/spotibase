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
