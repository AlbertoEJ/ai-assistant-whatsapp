/**
 * Telegram channel adapter.
 * Uses node-telegram-bot-api with long polling.
 */
import TelegramBot from 'node-telegram-bot-api'
import BaseAdapter from './base.js'
import { createLogger } from '@bot/shared/src/logger.js'

import { splitMessage, buildInlineKeyboard } from '../formatter.js'

const log = createLogger('telegram')

class TelegramAdapter extends BaseAdapter {
  constructor(token, onMessage) {
    super('telegram')
    this.token = token
    this.onMessage = onMessage
    this.bot = null
  }

  async start() {
    if (!this.token) {
      log.warn('No TELEGRAM_BOT_TOKEN set, Telegram adapter disabled')
      return
    }

    this.bot = new TelegramBot(this.token, { polling: true })

    this.bot.on('polling_error', (err) => {
      log.error('Polling error', { code: err.code, message: err.message })
    })

    this.bot.on('message', async (msg) => {
      try {
        await this._handleMessage(msg)
      } catch (err) {
        log.error('Message handler error', { error: err.message })
      }
    })

    this.bot.on('callback_query', async (query) => {
      await this._handleCallbackQuery(query)
    })

    log.info('Telegram adapter started')
  }

  async stop() {
    if (this.bot) {
      await this.bot.stopPolling()
      this.bot = null
      log.info('Telegram adapter stopped')
    }
  }

  async send(platformId, text, options = {}) {
    if (!this.bot || !text) return

    const parts = splitMessage(text)
    const lastIdx = parts.length - 1

    for (let i = 0; i < parts.length; i++) {
      const opts = {}

      // Add buttons to last message part
      if (i === lastIdx && options.buttons?.length) {
        opts.reply_markup = buildInlineKeyboard(options.buttons)
      }

      await this.bot.sendMessage(platformId, parts[i], opts).catch(() => {
        // Retry once
        this.bot.sendMessage(platformId, parts[i], opts).catch(() => {})
      })
    }
  }

  async sendFile(platformId, fileBuffer, filename, mimeType) {
    if (!this.bot) return

    if (mimeType?.startsWith('image/')) {
      await this.bot.sendPhoto(platformId, fileBuffer, {}, { filename, contentType: mimeType })
    } else {
      await this.bot.sendDocument(platformId, fileBuffer, {}, { filename, contentType: mimeType })
    }
  }

  async sendTyping(platformId) {
    if (!this.bot) return
    await this.bot.sendChatAction(platformId, 'typing').catch(() => {})
  }

  async editMessage(platformId, messageId, text) {
    if (!this.bot) return
    await this.bot.editMessageText(text, {
      chat_id: platformId,
      message_id: messageId,
    }).catch(() => {})
  }

  async deleteMessage(platformId, messageId) {
    if (!this.bot) return
    await this.bot.deleteMessage(platformId, messageId).catch(() => {})
  }

  /** Handle incoming Telegram message. */
  async _handleMessage(msg) {
    const text = msg.text || msg.caption || ''
    const platformId = String(msg.from.id)

    // Ignore commands (handled separately or via web panel)
    if (text.startsWith('/')) {
      await this._handleCommand(msg, text)
      return
    }

    // Ignore empty messages without files
    if (!text && !msg.photo && !msg.document && !msg.voice && !msg.audio && !msg.video_note) return

    // Download file if present
    let file = null
    if (msg.photo || msg.document || msg.voice || msg.audio || msg.video_note) {
      file = await this._downloadFile(msg)
    }

    // Send typing
    await this.sendTyping(msg.chat.id)

    // Emit to channel service
    await this.onMessage({
      platform: 'telegram',
      platformId,
      chatId: String(msg.chat.id),
      text,
      files: file ? [file] : [],
    })
  }

  /** Handle callback query (button presses). */
  async _handleCallbackQuery(query) {
    const data = query.data || ''
    const platformId = String(query.from.id)
    const chatId = String(query.message.chat.id)

    await this.bot.answerCallbackQuery(query.id).catch(() => {})

    // Remove buttons from original message
    await this.bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
    }).catch(() => {})

    if (data.startsWith('action:')) {
      // Action buttons → send as command
      const action = data.slice(7)
      await this.onMessage({
        platform: 'telegram', platformId, chatId,
        text: `/${action}`,
        files: [],
        isCommand: true,
      })
    } else if (data.startsWith('btn:')) {
      // Text buttons → send as regular message
      await this.onMessage({
        platform: 'telegram', platformId, chatId,
        text: data.slice(4),
        files: [],
      })
    }
    // URL buttons are handled by Telegram directly (open browser)
  }

  /** Handle slash commands. */
  async _handleCommand(msg, text) {
    const chatId = msg.chat.id
    const cmd = text.split(' ')[0].toLowerCase()

    switch (cmd) {
      case '/start':
        await this.bot.sendMessage(chatId,
          'Bienvenido. Escribe cualquier mensaje para empezar a conversar con tu asistente.\n\n' +
          'Gestiona tu cuenta desde el panel web: /panel')
        break

      case '/panel':
        // This will be handled by the channel router to generate OTP
        await this.onMessage({
          platform: 'telegram',
          platformId: String(msg.from.id),
          chatId: String(chatId),
          text: '/panel',
          files: [],
          isCommand: true,
        })
        break

      case '/clear':
        await this.onMessage({
          platform: 'telegram',
          platformId: String(msg.from.id),
          chatId: String(chatId),
          text: '/clear',
          files: [],
          isCommand: true,
        })
        break

      case '/connect':
      case '/disconnect':
        await this.onMessage({
          platform: 'telegram',
          platformId: String(msg.from.id),
          chatId: String(chatId),
          text,
          files: [],
          isCommand: true,
        })
        break

      default:
        // Unknown command — ignore silently
        break
    }
  }

  /** Download a file from Telegram. */
  async _downloadFile(msg) {
    try {
      let fileId, fileName, type

      if (msg.document) {
        fileId = msg.document.file_id
        fileName = msg.document.file_name || 'document'
        type = 'document'
      } else if (msg.photo) {
        const largest = msg.photo[msg.photo.length - 1]
        fileId = largest.file_id
        fileName = `photo_${Date.now()}.jpg`
        type = 'image'
      } else if (msg.voice) {
        fileId = msg.voice.file_id
        fileName = `voice_${Date.now()}.ogg`
        type = 'audio'
      } else if (msg.audio) {
        fileId = msg.audio.file_id
        fileName = msg.audio.file_name || `audio_${Date.now()}.mp3`
        type = 'audio'
      } else if (msg.video_note) {
        fileId = msg.video_note.file_id
        fileName = `videonote_${Date.now()}.mp4`
        type = 'audio'
      } else {
        return null
      }

      const fileLink = await this.bot.getFileLink(fileId)
      const res = await fetch(fileLink)
      if (!res.ok) return null

      const buffer = Buffer.from(await res.arrayBuffer())

      return { name: fileName, type, buffer, mimeType: res.headers.get('content-type') }
    } catch (err) {
      log.error('File download failed', { error: err.message })
      return null
    }
  }
}

export default TelegramAdapter
