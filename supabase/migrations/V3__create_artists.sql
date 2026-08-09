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
