-- OAuth integrations (Google Workspace, Microsoft 365)
CREATE TABLE integrations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,  -- google, microsoft
  access_token    TEXT,
  refresh_token   TEXT,
  token_expires   TIMESTAMPTZ,
  scopes          TEXT[],
  provider_meta   JSONB DEFAULT '{}',  -- provider-specific data
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_integrations_user_provider ON integrations(user_id, provider);
