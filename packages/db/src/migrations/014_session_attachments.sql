-- Session attachments: files shared during a conversation session
-- Re-included in context for follow-up messages
CREATE TABLE session_attachments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  text_content TEXT,           -- extracted text from PDFs (for cheap re-inclusion)
  is_image    BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_session ON session_attachments(session_id);
