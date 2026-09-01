-- V22: Enable pg_trgm for fuzzy search (was commented in V18)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Optional trigram indexes for suggestions (if not already exists)
CREATE INDEX IF NOT EXISTS idx_songs_name_trgm ON songs USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_artists_name_trgm ON artists USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_albums_name_trgm ON albums USING GIN (name gin_trgm_ops);
