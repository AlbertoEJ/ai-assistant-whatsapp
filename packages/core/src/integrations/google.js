/**
 * Google Workspace integration client.
 * Creates authenticated API clients using OAuth2 tokens from DB.
 * Auto-refreshes expired tokens.
 *
 * Per googleapis docs: use google.auth.OAuth2 with stored tokens.
 */
import { google } from 'googleapis'
import * as repos from '@bot/db/src/repositories/index.js'
import config from '@bot/shared/src/config.js'
import { createLogger } from '@bot/shared/src/logger.js'

const intRepo = repos.integrations
const log = createLogger('google-client')

/**
 * Get an authenticated OAuth2 client for a user.
 * Returns { client, gmail, calendar, drive, tasks } or { error }.
 */
export async function getClient(userId) {
  const integration = await intRepo.findByUserAndProvider(userId, 'google')
  if (!integration || !integration.access_token) {
    return { error: 'Google Workspace no conectado. Conecta tu cuenta desde el panel.' }
  }

  const oauth2Client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
  )

  oauth2Client.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token,
  })

  // Auto-refresh handler: save new tokens to DB
  oauth2Client.on('tokens', async (tokens) => {
    try {
      await intRepo.updateTokens(integration.id, {
        accessToken: tokens.access_token || integration.access_token,
        refreshToken: tokens.refresh_token || integration.refresh_token,
        tokenExpires: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      })
      log.info('Google tokens refreshed', { userId })
    } catch (err) {
      log.error('Failed to save refreshed tokens', { userId, error: err.message })
    }
  })

  return {
    client: oauth2Client,
    gmail: google.gmail({ version: 'v1', auth: oauth2Client }),
    calendar: google.calendar({ version: 'v3', auth: oauth2Client }),
    drive: google.drive({ version: 'v3', auth: oauth2Client }),
    tasks: google.tasks({ version: 'v1', auth: oauth2Client }),
  }
}

/**
 * Wrap a Google API call with error handling.
 */
export async function safeCall(apiCall) {
  try {
    const res = await apiCall()
    return res.data
  } catch (err) {
    const status = err.response?.status
    const message = err.response?.data?.error?.message || err.message

    if (status === 401) {
      return { error: 'Token de Google expirado o revocado. Reconecta desde el panel.' }
    }
    if (status === 403) {
      return { error: `Sin permisos de Google: ${message}` }
    }
    if (status === 404) {
      return { error: 'Recurso no encontrado en Google.' }
    }

    log.error('Google API error', { status, message })
    return { error: `Error de Google: ${message}` }
  }
}
