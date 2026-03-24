/**
 * Channels service entry point.
 * Starts all platform adapters and the outbound handler.
 */
import 'dotenv/config'

import { config } from '@bot/shared/src/index.js'
import { createLogger } from '@bot/shared/src/logger.js'
import { subscribe } from '@bot/shared/src/events.js'
import TelegramAdapter from './adapters/telegram.js'
import WhatsAppAdapter from './adapters/whatsapp.js'
import { route } from './router.js'
import { registerAdapter, start as startOutbound } from './outbound.js'

const log = createLogger('channels')

// Message handler shared by all adapters
async function handleMessage(message, adapter) {
  const result = await route(message)
  if (result.respond) {
    await adapter.send(message.chatId, result.respond)
  }
}

// Create Telegram adapter
const telegram = new TelegramAdapter(config.telegramBotToken, (msg) => handleMessage(msg, telegram))

// Create WhatsApp adapter
const whatsapp = new WhatsAppAdapter((msg) => handleMessage(msg, whatsapp))

// Register adapters for outbound delivery
registerAdapter('telegram', telegram)
registerAdapter('whatsapp', whatsapp)

// Start everything
async function start() {
  await telegram.start()
  await whatsapp.start()

  // Listen for WhatsApp webhooks forwarded from API service via Redis
  subscribe('whatsapp_webhook', async (body) => {
    await whatsapp.processWebhook(body)
  })

  startOutbound()
  log.info('Channels service started')
}

// Graceful shutdown
async function shutdown() {
  log.info('Shutting down channels...')
  await telegram.stop()
  await whatsapp.stop()
  log.info('Channels stopped')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

start().catch((err) => {
  log.error('Failed to start channels', err)
  process.exit(1)
})
