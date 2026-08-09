CREATE TABLE genres (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    image_url VARCHAR(500),
    color VARCHAR(10),
    sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_genres_name ON genres(name);
