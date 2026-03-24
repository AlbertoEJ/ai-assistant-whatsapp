/**
 * WhatsApp Cloud API adapter.
 * Uses Meta's Graph API for sending/receiving messages.
 * Incoming messages arrive via webhook (handled in api service).
 * This adapter only handles outbound messages + processing inbound webhook payloads.
 */
import BaseAdapter from './base.js'
import { createLogger } from '@bot/shared/src/logger.js'
import config from '@bot/shared/src/config.js'

const log = createLogger('whatsapp')

const GRAPH_API = 'https://graph.facebook.com/v21.0'

class WhatsAppAdapter extends BaseAdapter {
  constructor(onMessage) {
    super('whatsapp')
    this.onMessage = onMessage
  }

  async start() {
    if (!config.whatsappPhoneNumberId || !config.whatsappAccessToken) {
      log.warn('No WhatsApp credentials set, WhatsApp adapter disabled')
      return
    }
    log.info('WhatsApp adapter started')
  }

  async stop() {
    log.info('WhatsApp adapter stopped')
  }

  /** Send a text message. WhatsApp has 4096 char limit per message. */
  async send(platformId, text, options = {}) {
    if (!text) return

    // Split long messages
    const parts = splitText(text, 4096)
    for (const part of parts) {
      await this._sendMessage(platformId, {
        type: 'text',
        text: { body: part },
      })
    }

    // Send buttons if provided (WhatsApp interactive message)
    if (options.buttons?.length > 0) {
      await this._sendButtons(platformId, options.buttons)
    }
  }

  /** Send a file/document. */
  async sendFile(platformId, fileBuffer, filename, mimeType) {
    // Step 1: Upload media to WhatsApp
    const mediaId = await this._uploadMedia(fileBuffer, filename, mimeType)
    if (!mediaId) {
      await this.send(platformId, `No se pudo enviar el archivo: ${filename}`)
      return
    }

    // Step 2: Send media message
    const isImage = mimeType?.startsWith('image/')
    const isAudio = mimeType?.startsWith('audio/')
    const isVideo = mimeType?.startsWith('video/')

    let mediaType = 'document'
    let mediaBody = { id: mediaId, filename }
    if (isImage) { mediaType = 'image'; mediaBody = { id: mediaId } }
    if (isAudio) { mediaType = 'audio'; mediaBody = { id: mediaId } }
    if (isVideo) { mediaType = 'video'; mediaBody = { id: mediaId } }

    await this._sendMessage(platformId, {
      type: mediaType,
      [mediaType]: mediaBody,
    })
  }

  /** Send typing indicator (WhatsApp doesn't have a persistent typing, but we can mark as read). */
  async sendTyping(platformId) {
    // WhatsApp doesn't support typing indicators via Cloud API
    // We could mark messages as read instead, but that requires a message ID
  }

  /** Process incoming webhook payload from Meta. */
  async processWebhook(body) {
    if (!body?.entry) return

    for (const entry of body.entry) {
      const changes = entry.changes || []
      for (const change of changes) {
        if (change.field !== 'messages') continue

        const value = change.value
        if (!value?.messages) continue

        const metadata = value.metadata
        const contacts = value.contacts || []

        for (const msg of value.messages) {
          try {
            await this._handleMessage(msg, metadata, contacts)
          } catch (err) {
            log.error('WhatsApp message handler error', { error: err.message })
          }
        }
      }
    }
  }

  /** Handle a single incoming message. */
  async _handleMessage(msg, metadata, contacts) {
    const rawFrom = msg.from // phone number as received (e.g., "521XXXXXXXXXX")
    const platformId = normalizePhone(rawFrom) // normalized for DB lookup + sending
    const contact = contacts.find(c => c.wa_id === rawFrom || c.wa_id === platformId)
    const contactName = contact?.profile?.name || platformId

    let text = ''
    let file = null

    switch (msg.type) {
      case 'text':
        text = msg.text?.body || ''
        break

      case 'image':
        file = await this._downloadMedia(msg.image.id, `image_${Date.now()}.jpg`, msg.image.mime_type || 'image/jpeg')
        text = msg.image.caption || ''
        break

      case 'document':
        file = await this._downloadMedia(msg.document.id, msg.document.filename || 'document', msg.document.mime_type || 'application/octet-stream')
        text = msg.document.caption || ''
        break

      case 'audio':
        file = await this._downloadMedia(msg.audio.id, `audio_${Date.now()}.ogg`, msg.audio.mime_type || 'audio/ogg')
        break

      case 'video':
        file = await this._downloadMedia(msg.video.id, `video_${Date.now()}.mp4`, msg.video.mime_type || 'video/mp4')
        text = msg.video.caption || ''
        break

      case 'sticker':
        text = '[sticker]'
        break

      case 'location':
        text = `Ubicación: ${msg.location.latitude}, ${msg.location.longitude}`
        if (msg.location.name) text += ` (${msg.location.name})`
        break

      case 'reaction':
        // Ignore reactions
        return

      default:
        log.debug('Unsupported WhatsApp message type', { type: msg.type })
        return
    }

    // Ignore empty messages
    if (!text && !file) return

    // Check for commands
    if (text.startsWith('/')) {
      // Handle as command
    }

    // Mark as read
    await this._markAsRead(msg.id)

    // Emit to channel service
    await this.onMessage({
      platform: 'whatsapp',
      platformId,
      chatId: platformId,
      text,
      files: file ? [file] : [],
      contactName,
    })
  }

  /** Download media from WhatsApp servers. */
  async _downloadMedia(mediaId, filename, mimeType) {
    try {
      // Step 1: Get media URL
      const res = await fetch(`${GRAPH_API}/${mediaId}`, {
        headers: { Authorization: `Bearer ${config.whatsappAccessToken}` },
      })
      if (!res.ok) {
        log.error('WhatsApp media URL fetch failed', { mediaId, status: res.status })
        return null
      }
      const { url } = await res.json()

      // Step 2: Download the actual file
      const fileRes = await fetch(url, {
        headers: { Authorization: `Bearer ${config.whatsappAccessToken}` },
      })
      if (!fileRes.ok) return null

      const buffer = Buffer.from(await fileRes.arrayBuffer())
      return { name: filename, type: mimeType?.startsWith('image/') ? 'image' : mimeType?.startsWith('audio/') ? 'audio' : 'document', buffer, mimeType }
    } catch (err) {
      log.error('WhatsApp media download failed', { mediaId, error: err.message })
      return null
    }
  }

  /** Upload media to WhatsApp for sending. */
  async _uploadMedia(fileBuffer, filename, mimeType) {
    try {
      const formData = new FormData()
      formData.append('file', new Blob([fileBuffer], { type: mimeType }), filename)
      formData.append('messaging_product', 'whatsapp')
      formData.append('type', mimeType)

      const res = await fetch(`${GRAPH_API}/${config.whatsappPhoneNumberId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.whatsappAccessToken}` },
        body: formData,
      })

      if (!res.ok) {
        log.error('WhatsApp media upload failed', { status: res.status })
        return null
      }

      const data = await res.json()
      return data.id
    } catch (err) {
      log.error('WhatsApp media upload error', { error: err.message })
      return null
    }
  }

  /** Send a message via WhatsApp Cloud API. */
  async _sendMessage(to, messageBody) {
    try {
      const res = await fetch(`${GRAPH_API}/${config.whatsappPhoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.whatsappAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          ...messageBody,
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        log.error('WhatsApp send failed', { to, status: res.status, body: text.slice(0, 200) })
      }
    } catch (err) {
      log.error('WhatsApp send error', { to, error: err.message })
    }
  }

  /** Send interactive buttons (max 3 for reply buttons). */
  async _sendButtons(to, buttons) {
    // WhatsApp supports max 3 reply buttons
    const waButtons = buttons.slice(0, 3).map((btn, i) => {
      const label = typeof btn === 'string' ? btn : btn.label || btn.text || `Opción ${i + 1}`
      return {
        type: 'reply',
        reply: { id: `btn_${i}`, title: label.slice(0, 20) }, // max 20 chars
      }
    })

    await this._sendMessage(to, {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Elige una opción:' },
        action: { buttons: waButtons },
      },
    })
  }

  /** Mark a message as read. */
  async _markAsRead(messageId) {
    try {
      await fetch(`${GRAPH_API}/${config.whatsappPhoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.whatsappAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      })
    } catch {} // best effort
  }
}

/** Split text into chunks respecting WhatsApp's 4096 char limit. */
function splitText(text, maxLength) {
  if (text.length <= maxLength) return [text]
  const parts = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining)
      break
    }
    // Try to split at newline
    let splitAt = remaining.lastIndexOf('\n', maxLength)
    if (splitAt < maxLength * 0.3) splitAt = maxLength
    parts.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }
  return parts
}

/**
 * Normalize Mexican phone numbers.
 * Meta webhook sends "521XXXXXXXXXX" (with 1 after country code)
 * but the API expects "52XXXXXXXXXX" (without 1) for sending.
 * Mexican mobile numbers changed format — the "1" prefix is no longer needed.
 */
function normalizePhone(phone) {
  // Mexico: 521XXXXXXXXXX → 52XXXXXXXXXX (remove the 1 after 52)
  if (phone.startsWith('521') && phone.length === 13) {
    return '52' + phone.slice(3)
  }
  return phone
}

export default WhatsAppAdapter
