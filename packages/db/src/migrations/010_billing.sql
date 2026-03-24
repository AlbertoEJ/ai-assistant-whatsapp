-- Usage tracking for billing
CREATE TABLE usage (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,       -- gemini-2.5-flash, claude-sonnet, etc.
  tokens_in   INT NOT NULL DEFAULT 0,
  tokens_out  INT NOT NULL DEFAULT 0,
  cost_usd    NUMERIC(10,6) NOT NULL DEFAULT 0, -- estimated cost
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partition-friendly index for monthly queries
CREATE INDEX idx_usage_org_date ON usage(org_id, created_at);
CREATE INDEX idx_usage_user_date ON usage(user_id, created_at);

-- Daily aggregated view for dashboard
CREATE MATERIALIZED VIEW usage_daily AS
SELECT
  org_id,
  user_id,
  model,
  date_trunc('day', created_at) AS day,
  SUM(tokens_in) AS total_tokens_in,
  SUM(tokens_out) AS total_tokens_out,
  SUM(cost_usd) AS total_cost
FROM usage
GROUP BY org_id, user_id, model, date_trunc('day', created_at);
