-- Users (people who interact with the bot)
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT,
  role            TEXT NOT NULL DEFAULT 'user',  -- admin, user
  allowed_tools   TEXT[] NOT NULL DEFAULT '{"Read","Glob","Grep"}',
  timezone        TEXT NOT NULL DEFAULT 'America/Mexico_City',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_email ON users(email);
