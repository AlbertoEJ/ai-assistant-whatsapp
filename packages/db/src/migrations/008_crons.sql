-- Scheduled tasks (crons)
CREATE TABLE crons (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule    TEXT NOT NULL,       -- cron expression
  prompt      TEXT NOT NULL,       -- what to execute
  is_once     BOOLEAN DEFAULT false,
  is_active   BOOLEAN DEFAULT true,
  last_run    TIMESTAMPTZ,
  next_run    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crons_user ON crons(user_id) WHERE is_active = true;
CREATE INDEX idx_crons_next_run ON crons(next_run) WHERE is_active = true;
