/**
 * OAuth integration routes.
 * Handles connecting/disconnecting Google and Microsoft.
 * Both web panel and chat bot can initiate the flow.
 *
 * Flow:
 *   1. GET /api/integrations/google/connect → returns OAuth URL
 *   2. User visits URL → Google consent → redirect to callback
 *   3. GET /api/integrations/google/callback?code=... → exchanges code for tokens
 */
import { google } from 'googleapis'
import { requireAuth } from '../middleware.js'
import { integrations as intRepo } from '@bot/db/src/repositories/index.js'
import { query } from '@bot/db/src/client.js'
import { canConnectIntegration } from '@bot/core/src/users/permissions.js'
import config from '@bot/shared/src/config.js'
import { createLogger } from '@bot/shared/src/logger.js'
import { publish } from '@bot/shared/src/events.js'
import { channels as channelRepo } from '@bot/db/src/repositories/index.js'

const log = createLogger('integrations')

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/tasks',
]

function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    `${config.betterAuthUrl}/api/integrations/google/callback`,
  )
}

/**
 * Notify user in their last active chat channel.
 */
async function notifyUser(userId, text) {
  const channel = await channelRepo.findLastActiveForUser(userId)
  if (channel) {
    await publish('outgoing_message', {
      userId,
      channelId: channel.id,
      platform: channel.platform,
      text,
      buttons: [],
      files: [],
    })
  }
}

export default async function integrationRoutes(fastify) {
  // List user's integrations
  fastify.get('/api/integrations', { preHandler: requireAuth }, async (request) => {
    const integrations = await intRepo.findByUser(request.user.id)
    return {
      integrations: integrations.map(i => ({
        id: i.id,
        provider: i.provider,
        enabled: i.enabled,
        scopes: i.scopes,
        createdAt: i.created_at,
      })),
    }
  })

  // ========== GOOGLE ==========

  // Start Google OAuth flow — returns URL to redirect user
  fastify.get('/api/integrations/google/connect', { preHandler: requireAuth }, async (request, reply) => {
    // Check plan allows this integration
    const { rows } = await query(
      'SELECT o.plan FROM member m JOIN organization o ON o.id = m."organizationId" WHERE m."userId" = $1 LIMIT 1',
      [request.user.id]
    )
    const plan = rows[0]?.plan || 'free'
    const currentIntegrations = await intRepo.findByUser(request.user.id)
    const currentProviders = currentIntegrations.map(i => i.provider)

    const check = canConnectIntegration(plan, 'google', currentProviders)
    if (!check.allowed) {
      return reply.status(403).send({ error: check.reason })
    }

    const oauth2Client = createOAuth2Client()
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state: request.user.id,
    })

    return { url }
  })

  // Google OAuth callback — receives code, exchanges for tokens
  fastify.get('/api/integrations/google/callback', async (request, reply) => {
    const { code, state: userId } = request.query

    if (!code || !userId) {
      return reply.status(400).send({ error: 'Código o usuario faltante' })
    }

    try {
      const oauth2Client = createOAuth2Client()
      const { tokens } = await oauth2Client.getToken(code)

      await intRepo.upsert({
        userId,
        provider: 'google',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpires: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scopes: GOOGLE_SCOPES,
      })

      log.info('Google connected', { userId })

      // Notify user in chat
      await notifyUser(userId, '✅ Google Workspace conectado. Ya puedo acceder a tu email, calendario, Drive y tareas.\n\nPrueba preguntándome: "¿qué emails tengo sin leer?"')

      return reply.type('text/html').send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:50px">
          <h1>✅ Google conectado</h1>
          <p>Ya puedes cerrar esta ventana y volver al bot.</p>
        </body></html>
      `)
    } catch (err) {
      log.error('Google OAuth callback failed', { userId, error: err.message })
      return reply.status(500).send({ error: 'Error al conectar Google' })
    }
  })

  // Disconnect Google
  fastify.delete('/api/integrations/google', { preHandler: requireAuth }, async (request) => {
    const integration = await intRepo.findByUserAndProvider(request.user.id, 'google')
    if (integration) {
      await intRepo.disable(integration.id)
      log.info('Google disconnected', { userId: request.user.id })
    }
    return { success: true }
  })

  // ========== MICROSOFT ==========

  // Start Microsoft OAuth flow
  fastify.get('/api/integrations/microsoft/connect', { preHandler: requireAuth }, async (request, reply) => {
    const { rows } = await query(
      'SELECT o.plan FROM member m JOIN organization o ON o.id = m."organizationId" WHERE m."userId" = $1 LIMIT 1',
      [request.user.id]
    )
    const plan = rows[0]?.plan || 'free'
    const currentIntegrations = await intRepo.findByUser(request.user.id)
    const currentProviders = currentIntegrations.map(i => i.provider)

    const check = canConnectIntegration(plan, 'microsoft', currentProviders)
    if (!check.allowed) {
      return reply.status(403).send({ error: check.reason })
    }

    const redirectUri = `${config.betterAuthUrl}/api/integrations/microsoft/callback`
    const scopes = 'openid profile email offline_access Mail.ReadWrite Mail.Send Calendars.ReadWrite Files.Read.All Tasks.ReadWrite'

    const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${config.msClientId}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&state=${request.user.id}` +
      `&prompt=consent`

    return { url }
  })

  // Microsoft OAuth callback
  fastify.get('/api/integrations/microsoft/callback', async (request, reply) => {
    const { code, state: userId } = request.query

    if (!code || !userId) {
      return reply.status(400).send({ error: 'Código o usuario faltante' })
    }

    try {
      const redirectUri = `${config.betterAuthUrl}/api/integrations/microsoft/callback`
      const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.msClientId,
          client_secret: config.msClientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        log.error('Microsoft token exchange failed', { userId, status: res.status })
        return reply.status(500).send({ error: 'Error al conectar Microsoft' })
      }

      const tokens = await res.json()

      await intRepo.upsert({
        userId,
        provider: 'microsoft',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpires: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: tokens.scope?.split(' ') || [],
      })

      log.info('Microsoft connected', { userId })

      await notifyUser(userId, '✅ Microsoft 365 conectado. Ya puedo acceder a tu correo de Outlook, calendario, OneDrive y tareas.\n\nPrueba preguntándome: "¿qué emails tengo en Outlook?"')

      return reply.type('text/html').send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:50px">
          <h1>✅ Microsoft conectado</h1>
          <p>Ya puedes cerrar esta ventana y volver al bot.</p>
        </body></html>
      `)
    } catch (err) {
      log.error('Microsoft OAuth callback failed', { userId, error: err.message })
      return reply.status(500).send({ error: 'Error al conectar Microsoft' })
    }
  })

  // Disconnect Microsoft
  fastify.delete('/api/integrations/microsoft', { preHandler: requireAuth }, async (request) => {
    const integration = await intRepo.findByUserAndProvider(request.user.id, 'microsoft')
    if (integration) {
      await intRepo.disable(integration.id)
      log.info('Microsoft disconnected', { userId: request.user.id })
    }
    return { success: true }
  })
}
