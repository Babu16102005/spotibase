-- V21: AI Song Metadata & Assistant Support
-- Controlled vocabulary: mood, vibe, activity + audio features

-- Add AI-generated metadata columns to songs (JSONB for tags, REAL for scores)
ALTER TABLE songs
    ADD COLUMN IF NOT EXISTS mood_tags JSONB,
    ADD COLUMN IF NOT EXISTS vibe_tags JSONB,
    ADD COLUMN IF NOT EXISTS activity_tags JSONB,
    ADD COLUMN IF NOT EXISTS energy_score REAL,
    ADD COLUMN IF NOT EXISTS valence_score REAL,
    ADD COLUMN IF NOT EXISTS bpm REAL,
    ADD COLUMN IF NOT EXISTS ai_tagged BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ai_tagged_at TIMESTAMP;

-- Indexes for AI filtering (GIN on JSONB)
CREATE INDEX IF NOT EXISTS idx_songs_mood_tags ON songs USING GIN (mood_tags);
CREATE INDEX IF NOT EXISTS idx_songs_vibe_tags ON songs USING GIN (vibe_tags);
CREATE INDEX IF NOT EXISTS idx_songs_activity_tags ON songs USING GIN (activity_tags);
CREATE INDEX IF NOT EXISTS idx_songs_ai_tagged ON songs(ai_tagged) WHERE ai_tagged = TRUE;

-- Optional: assistant conversation history (short-term, for multi-turn context)
CREATE TABLE IF NOT EXISTS ai_conversations (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transcript TEXT NOT NULL,
    actions_json JSONB NOT NULL,
    response TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id, created_at DESC);

-- Comment: pgvector / song_embeddings deferred to V22 when semantic search is needed
-- CREATE EXTENSION IF NOT EXISTS vector;
