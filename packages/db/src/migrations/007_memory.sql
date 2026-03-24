-- User memory (persistent facts + personality)
CREATE TABLE user_memory (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,  -- memory, soul
  content     TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_memory_user_type ON user_memory(user_id, type);

-- Session summaries (episodic memory)
CREATE TABLE summaries (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id  UUID REFERENCES sessions(id) ON DELETE SET NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_summaries_user ON summaries(user_id, created_at DESC);

-- Vector embeddings (semantic search)
CREATE TABLE embeddings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,  -- memory, summary, session
  source_id   UUID,           -- reference to source record
  text        TEXT NOT NULL,
  embedding   vector(768),    -- nomic-embed-text dimension
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_embeddings_user ON embeddings(user_id);

-- HNSW index for fast similarity search
CREATE INDEX idx_embeddings_vector ON embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
