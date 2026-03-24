/**
 * Microsoft 365 integration client.
 * Creates authenticated Graph API client using tokens from DB.
 *
 * Uses fetch directly (lightweight, no heavy SDK).
 * Per Microsoft Graph docs: Bearer token + REST endpoints.
 */
import * as repos from '@bot/db/src/repositories/index.js'
import config from '@bot/shared/src/config.js'
import { createLogger } from '@bot/shared/src/logger.js'

const intRepo = repos.integrations
const log = createLogger('microsoft-client')

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

/**
 * Get a valid access token, refreshing if expired.
 */
export async function getToken(userId) {
  const integration = await intRepo.findByUserAndProvider(userId, 'microsoft')
  if (!integration || !integration.access_token) {
    return { error: 'Microsoft 365 no conectado. Conecta tu cuenta desde el panel.' }
  }

  // Check if token is expired (5 min buffer)
  if (integration.token_expires && new Date(integration.token_expires) < new Date(Date.now() + 300000)) {
    if (!integration.refresh_token) {
      return { error: 'Token de Microsoft expirado y sin refresh token. Reconecta desde el panel.' }
    }

    // Refresh the token
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.msClientId,
          client_secret: config.msClientSecret,
          refresh_token: integration.refresh_token,
          grant_type: 'refresh_token',
        }),
      })

      if (!res.ok) {
        return { error: 'Error al refrescar token de Microsoft. Reconecta desde el panel.' }
      }

      const tokens = await res.json()
      await intRepo.updateTokens(integration.id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || integration.refresh_token,
        tokenExpires: new Date(Date.now() + tokens.expires_in * 1000),
      })

      log.info('Microsoft token refreshed', { userId })
      return { token: tokens.access_token }
    } catch (err) {
      log.error('Microsoft token refresh failed', { userId, error: err.message })
      return { error: 'Error al refrescar token de Microsoft.' }
    }
  }

  return { token: integration.access_token }
}

/**
 * Make an authenticated request to Microsoft Graph API.
 */
export async function graphRequest(userId, path, options = {}) {
  const auth = await getToken(userId)
  if (auth.error) return { error: auth.error }

  try {
    const res = await fetch(`${GRAPH_BASE}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text()
      const status = res.status

      if (status === 401) {
        return { error: 'Token de Microsoft expirado o revocado. Reconecta desde el panel.' }
      }
      if (status === 403) {
        return { error: 'Sin permisos de Microsoft para esta operación.' }
      }

      log.error('Graph API error', { userId, path, status, body: text.slice(0, 500) })
      return { error: `Error de Microsoft (${status}): ${text.slice(0, 200)}` }
    }

    if (res.status === 204 || res.status === 202) return { success: true }

    // Some endpoints return 200 with empty body
    const text2 = await res.text()
    if (!text2) return { success: true }
    try { return JSON.parse(text2) } catch { return { success: true, raw: text2 } }
  } catch (err) {
    log.error('Graph API request failed', { userId, path, error: err.message })
    return { error: `Error de conexión con Microsoft: ${err.message.slice(0, 200)}` }
  }
}
