-- Event watchers (push notification rules)
CREATE TABLE watchers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,  -- email, calendar, drive
  condition       JSONB NOT NULL, -- { "from": "juan@...", "subject_contains": "urgente" }
  action          TEXT NOT NULL DEFAULT 'notify',  -- notify, notify_ai (uses AI to interpret)
  message_template TEXT,          -- "Email de {{from}}: {{subject}}"
  is_active       BOOLEAN DEFAULT true,
  subscription_id TEXT,           -- Google Pub/Sub or webhook subscription ID
  expires_at      TIMESTAMPTZ,   -- when the push subscription expires
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_watchers_user ON watchers(user_id) WHERE is_active = true;
CREATE INDEX idx_watchers_type ON watchers(type) WHERE is_active = true;
