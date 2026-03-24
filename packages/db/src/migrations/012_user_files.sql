-- User files (isolated storage, no filesystem access)
CREATE TABLE user_files (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  content     BYTEA,
  mime_type   TEXT,
  size_bytes  INT DEFAULT 0,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One file per name per user
CREATE UNIQUE INDEX idx_files_user_name ON user_files(user_id, filename);
CREATE INDEX idx_files_user ON user_files(user_id);
