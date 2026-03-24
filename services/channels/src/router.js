/**
 * Channel router.
 * Resolves platform identity → internal user.
 * Enqueues messages for the worker.
 */
import { channels as channelRepo, files as fileRepo, sessions as sessionRepo, integrations as intRepo } from '@bot/db/src/repositories/index.js'
import { query } from '@bot/db/src/client.js'
import { createQueue } from '@bot/shared/src/queue.js'
import { createLogger } from '@bot/shared/src/logger.js'
import { canConnectIntegration } from '@bot/core/src/users/permissions.js'
import config from '@bot/shared/src/config.js'

const log = createLogger('router')

let aiQueue = null

function getAiQueue() {
  if (!aiQueue) aiQueue = createQueue('ai_jobs')
  return aiQueue
}

/**
 * Route an incoming message from any platform to the worker.
 *
 * @param {Object} message
 * @param {string} message.platform - telegram, whatsapp
 * @param {string} message.platformId - platform-specific user ID
 * @param {string} message.chatId - platform chat ID (for replies)
 * @param {string} message.text
 * @param {Object[]} message.files
 * @param {boolean} [message.isCommand]
 */
async function route(message) {
  const { platform, platformId, text, files, isCommand } = message

  // Look up channel → user
  const channel = await channelRepo.findByPlatform(platform, platformId)
  if (!channel) {
    log.warn('Unknown sender', { platform, platformId })
    return { routed: false, reason: 'unknown_sender' }
  }

  // Update last active
  await channelRepo.updateLastActive(channel.id)

  // Load user + org info (via Better Auth tables)
  const { rows } = await query(
    `SELECT u.id, u.name, u."isActive", u.timezone,
            m.role, o.id AS org_id, o.plan
     FROM "user" u
     JOIN member m ON m."userId" = u.id
     JOIN organization o ON o.id = m."organizationId"
     WHERE u.id = $1
     LIMIT 1`,
    [channel.user_id]
  )

  if (!rows[0] || !rows[0].isActive) {
    log.warn('Inactive user', { platform, platformId, userId: channel.user_id })
    return { routed: false, reason: 'inactive_user' }
  }

  const user = rows[0]

  // Handle commands
  if (isCommand) {
    return handleCommand(text, user, channel)
  }

  // Save files to user_files DB (not passed as binary through queue)
  const savedFiles = []
  for (const f of files) {
    if (f.buffer) {
      const saved = await fileRepo.upsert({
        userId: user.id,
        filename: f.name,
        content: f.buffer,
        mimeType: f.mimeType || 'application/octet-stream',
      })
      savedFiles.push({ name: f.name, type: f.type, mimeType: f.mimeType, fileId: saved.id })
    }
  }

  // Enqueue for worker (file content stored in DB, only references in job)
  await getAiQueue().add('message', {
    userId: user.id,
    channelId: channel.id,
    platform,
    orgId: user.org_id,
    userName: user.name,
    plan: user.plan,
    timezone: user.timezone || config.timezone,
    text,
    files: savedFiles,
  })

  log.debug('Message routed', { userId: user.id, platform })
  return { routed: true, userId: user.id }
}

/**
 * Handle special commands from chat.
 */
async function handleCommand(text, user, channel) {
  const cmd = text.split(' ')[0].toLowerCase()

  switch (cmd) {
    case '/clear': {
      // Flush memory + summarize before deactivating (same as auto-reset)
      const session = await sessionRepo.findActive(user.id)
      if (session) {
        if (session.message_count >= 3) {
          // Enqueue flush job so it doesn't block the response
          if (!aiQueue) aiQueue = createQueue('ai_jobs')
          await aiQueue.add('flush_session', {
            userId: user.id,
            sessionId: session.id,
            userName: user.name,
          })
        }
        await sessionRepo.deactivate(session.id)
      }
      return { routed: true, command: 'clear', respond: 'Sesión guardada y reiniciada.' }
    }

    case '/panel':
      // TODO: Generate OTP via Better Auth and send to user
      return { routed: true, command: 'panel', respond: 'Abre tu panel en: (URL pendiente)' }

    case '/connect': {
      const args = text.split(' ')
      const provider = args[1]?.toLowerCase()

      if (!provider || !['google', 'microsoft'].includes(provider)) {
        return { routed: true, command: 'connect', respond: 'Usa: /connect google o /connect microsoft' }
      }

      // Check plan
      const currentIntegrations = await intRepo.findByUser(user.id)
      const currentProviders = currentIntegrations.map(i => i.provider)
      const check = canConnectIntegration(user.plan, provider, currentProviders)

      if (!check.allowed) {
        return { routed: true, command: 'connect', respond: check.reason }
      }

      if (currentProviders.includes(provider)) {
        return { routed: true, command: 'connect', respond: `${provider === 'google' ? 'Google' : 'Microsoft'} ya está conectado.` }
      }

      // Generate OAuth URL directly (no auth needed — userId in state param)
      let connectUrl
      if (provider === 'google') {
        const scopes = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/tasks'
        const redirectUri = `${config.betterAuthUrl}/api/integrations/google/callback`
        connectUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
          `client_id=${config.googleClientId}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&response_type=code` +
          `&scope=${encodeURIComponent(scopes)}` +
          `&access_type=offline` +
          `&prompt=consent` +
          `&state=${user.id}`
      } else {
        const scopes = 'openid profile email offline_access Mail.ReadWrite Mail.Send Calendars.ReadWrite Files.Read.All Tasks.ReadWrite'
        const redirectUri = `${config.betterAuthUrl}/api/integrations/microsoft/callback`
        connectUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
          `client_id=${config.msClientId}` +
          `&response_type=code` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&scope=${encodeURIComponent(scopes)}` +
          `&state=${user.id}` +
          `&prompt=consent`
      }

      const providerName = provider === 'google' ? 'Google' : 'Microsoft'
      return {
        routed: true,
        command: 'connect',
        respond: `Para conectar ${providerName}, abre este link:\n\n${connectUrl}`,
      }
    }

    case '/disconnect': {
      const provider = text.split(' ')[1]?.toLowerCase()
      if (!provider || !['google', 'microsoft'].includes(provider)) {
        return { routed: true, command: 'disconnect', respond: 'Usa: /disconnect google o /disconnect microsoft' }
      }

      const integration = await intRepo.findByUserAndProvider(user.id, provider)
      if (!integration) {
        return { routed: true, command: 'disconnect', respond: `${provider === 'google' ? 'Google' : 'Microsoft'} no está conectado.` }
      }

      await intRepo.disable(integration.id)
      const providerName = provider === 'google' ? 'Google Workspace' : 'Microsoft 365'
      return { routed: true, command: 'disconnect', respond: `${providerName} desconectado.` }
    }

    default:
      return { routed: false, reason: 'unknown_command' }
  }
}

export { route }
