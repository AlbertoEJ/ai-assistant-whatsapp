-- Conversation sessions
CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id    UUID REFERENCES channels(id) ON DELETE SET NULL,
  message_count INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user_active ON sessions(user_id) WHERE is_active = true;

-- Message history (for context window)
CREATE TABLE messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,  -- user, assistant, system, tool
  content     TEXT NOT NULL,
  tool_calls  JSONB,          -- tool calls made by assistant
  tool_result JSONB,          -- result of tool execution
  tokens_in   INT DEFAULT 0,
  tokens_out  INT DEFAULT 0,
  model       TEXT,           -- which model was used
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_messages_user ON messages(user_id, created_at);
