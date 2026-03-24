import { query } from '../client.js'

export async function findByUser(userId) {
  const { rows } = await query(
    'SELECT * FROM integrations WHERE user_id = $1 AND enabled = true',
    [userId]
  )
  return rows
}

export async function findByUserAndProvider(userId, provider) {
  const { rows } = await query(
    'SELECT * FROM integrations WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  )
  return rows[0] || null
}

export async function upsert({ userId, provider, accessToken, refreshToken, tokenExpires, scopes }) {
  const { rows } = await query(
    `INSERT INTO integrations (user_id, provider, access_token, refresh_token, token_expires, scopes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, provider)
     DO UPDATE SET access_token = $3, refresh_token = $4, token_expires = $5,
       scopes = $6, enabled = true, updated_at = now()
     RETURNING *`,
    [userId, provider, accessToken, refreshToken, tokenExpires, scopes]
  )
  return rows[0]
}

export async function updateTokens(id, { accessToken, refreshToken, tokenExpires }) {
  await query(
    `UPDATE integrations SET access_token = $2, refresh_token = $3,
     token_expires = $4, updated_at = now() WHERE id = $1`,
    [id, accessToken, refreshToken, tokenExpires]
  )
}

export async function disable(id) {
  await query(
    'UPDATE integrations SET enabled = false, updated_at = now() WHERE id = $1',
    [id]
  )
}

export async function findExpiring(minutesBefore = 5) {
  const { rows } = await query(
    `SELECT * FROM integrations
     WHERE enabled = true AND token_expires IS NOT NULL
       AND token_expires < now() + interval '1 minute' * $1`,
    [minutesBefore]
  )
  return rows
}
