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
