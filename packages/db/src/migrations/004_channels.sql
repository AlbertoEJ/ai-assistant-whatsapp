-- Channels linked to users (Telegram, WhatsApp, etc.)
CREATE TABLE channels (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,  -- telegram, whatsapp, slack
  platform_id   TEXT NOT NULL,  -- Telegram user ID, phone number, etc.
  platform_meta JSONB DEFAULT '{}',  -- platform-specific data (username, etc.)
  enabled       BOOLEAN NOT NULL DEFAULT true,
  last_active   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure one platform_id per platform (no duplicates)
CREATE UNIQUE INDEX idx_channels_platform ON channels(platform, platform_id);
CREATE INDEX idx_channels_user ON channels(user_id);
