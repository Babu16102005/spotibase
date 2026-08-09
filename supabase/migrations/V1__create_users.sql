CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(100) NOT NULL UNIQUE,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(500),
    avatar_url VARCHAR(500),
    cover_url VARCHAR(500),
    bio VARCHAR(500),
    country VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    supabase_uid VARCHAR(500),
    auth_provider VARCHAR(100),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    total_listening_time_ms BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- User favorite genres (element collection)
CREATE TABLE user_favorite_genres (
    user_id VARCHAR(36) NOT NULL,
    genre VARCHAR(100) NOT NULL,
    PRIMARY KEY (user_id, genre),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(active);
CREATE INDEX idx_users_created_at ON users(created_at);
