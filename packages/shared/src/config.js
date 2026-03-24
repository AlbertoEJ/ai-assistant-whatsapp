/**
 * Centralized config from environment variables.
 * Uses getters to read env vars at runtime (not import time).
 * This ensures dotenv has loaded before values are accessed.
 */
const config = {
  get databaseUrl() { return process.env.DATABASE_URL || 'postgres://bot:bot@localhost:5432/bot' },
  get redisUrl() { return process.env.REDIS_URL || 'redis://localhost:6379' },

  get geminiApiKey() { return process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '' },
  get anthropicApiKey() { return process.env.ANTHROPIC_API_KEY || '' },
  get ollamaUrl() { return process.env.OLLAMA_URL || 'http://localhost:11434' },
  get embeddingModel() { return process.env.EMBEDDING_MODEL || 'nomic-embed-text' },

  get telegramBotToken() { return process.env.TELEGRAM_BOT_TOKEN || '' },
  get whatsappPhoneNumberId() { return process.env.WHATSAPP_PHONE_NUMBER_ID || '' },
  get whatsappAccessToken() { return process.env.WHATSAPP_ACCESS_TOKEN || '' },
  get whatsappVerifyToken() { return process.env.WHATSAPP_VERIFY_TOKEN || '' },
  get whatsappAppSecret() { return process.env.WHATSAPP_APP_SECRET || '' },

  get googleClientId() { return process.env.GOOGLE_CLIENT_ID || '' },
  get googleClientSecret() { return process.env.GOOGLE_CLIENT_SECRET || '' },
  get googleRedirectUri() { return process.env.GOOGLE_REDIRECT_URI || '' },

  get msClientId() { return process.env.MS_CLIENT_ID || '' },
  get msClientSecret() { return process.env.MS_CLIENT_SECRET || '' },
  get msRedirectUri() { return process.env.MS_REDIRECT_URI || '' },

  get betterAuthSecret() { return process.env.BETTER_AUTH_SECRET || '' },
  get betterAuthUrl() { return process.env.BETTER_AUTH_URL || 'http://localhost:3000' },

  get stripeSecretKey() { return process.env.STRIPE_SECRET_KEY || '' },
  get stripeWebhookSecret() { return process.env.STRIPE_WEBHOOK_SECRET || '' },

  get apiPort() { return parseInt(process.env.API_PORT) || 3000 },
  get timezone() { return process.env.TIMEZONE || 'America/Mexico_City' },
  get nodeEnv() { return process.env.NODE_ENV || 'development' },

  get maxConcurrentGlobal() { return parseInt(process.env.MAX_CONCURRENT_GLOBAL) || 3 },
  get maxConcurrentPerUser() { return parseInt(process.env.MAX_CONCURRENT_PER_USER) || 2 },
}

export default config
