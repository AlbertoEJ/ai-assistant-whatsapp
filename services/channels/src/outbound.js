/**
 * Outbound message handler.
 * Subscribes to outgoing_message events from Redis
 * and routes them to the correct platform adapter.
 */
import { subscribe } from '@bot/shared/src/events.js'
import { channels as channelRepo, files as fileRepo } from '@bot/db/src/repositories/index.js'
import { query } from '@bot/db/src/client.js'
import { createLogger } from '@bot/shared/src/logger.js'

const log = createLogger('outbound')

const adapters = new Map()

function registerAdapter(platform, adapter) {
  adapters.set(platform, adapter)
  log.info('Adapter registered', { platform })
}

function getAdapter(platform) {
  return adapters.get(platform) || null
}

/**
 * Start listening for outgoing messages.
 */
function start() {
  // Typing indicator from worker (keeps "typing..." alive during AI processing)
  subscribe('typing', async (data) => {
    const { userId, channelId, platform } = data
    const adapter = getAdapter(platform)
    if (!adapter?.sendTyping) return

    let platformId
    if (channelId) {
      const { rows } = await query('SELECT platform_id FROM channels WHERE id = $1', [channelId])
      platformId = rows[0]?.platform_id
    }
    if (!platformId) {
      const channel = await channelRepo.findLastActiveForUser(userId)
      if (channel) platformId = channel.platform_id
    }
    if (platformId) await adapter.sendTyping(platformId)
  })

  subscribe('outgoing_message', async (data) => {
    const { userId, channelId, platform, text, buttons, files } = data

    const adapter = getAdapter(platform)
    if (!adapter) {
      log.error('No adapter for platform', { platform, userId })
      return
    }

    // Resolve platform ID from channel
    let platformId
    if (channelId) {
      const { rows } = await query(
        'SELECT platform_id FROM channels WHERE id = $1',
        [channelId]
      )
      platformId = rows[0]?.platform_id
    }

    if (!platformId) {
      // Fallback: find last active channel for user on this platform
      const channel = await channelRepo.findLastActiveForUser(userId)
      if (channel?.platform === platform) {
        platformId = channel.platform_id
      }
    }

    if (!platformId) {
      log.error('No platform ID found', { userId, channelId, platform })
      return
    }

    // Send text
    if (text) {
      await adapter.send(platformId, text, { buttons })
    }

    // Send files
    if (files?.length) {
      for (const f of files) {
        const fileData = await fileRepo.get(userId, f.filename)
        if (fileData?.content) {
          await adapter.sendFile(platformId, fileData.content, fileData.filename, fileData.mime_type)
        } else {
          await adapter.send(platformId, `No se encontró el archivo: ${f.filename}`)
        }
      }
    }

    log.debug('Outbound sent', { userId, platform, textLength: text?.length, textPreview: text?.slice(0, 100) })
  })

  log.info('Outbound handler started')
}

export { registerAdapter, getAdapter, start }
