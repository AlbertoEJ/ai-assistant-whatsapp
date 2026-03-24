-- Organizations (teams/companies that pay for the service)
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free',  -- free, inicio, equipo, empresa
  stripe_customer_id  TEXT,
  stripe_subscription_id TEXT,
  max_users       INT NOT NULL DEFAULT 1,
  messages_limit  INT NOT NULL DEFAULT 100,
  messages_used   INT NOT NULL DEFAULT 0,
  billing_cycle_start TIMESTAMPTZ DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
