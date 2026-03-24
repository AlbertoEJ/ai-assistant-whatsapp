import { query } from '../client.js'

export async function findByUserid(userId) {
  const { rows } = await query(
    'SELECT * FROM channels WHERE user_id = $1 AND enabled = true ORDER BY last_active DESC',
    [userId]
  )
  return rows
}

export async function findByPlatform(platform, platformId) {
  const { rows } = await query(
    'SELECT * FROM channels WHERE platform = $1 AND platform_id = $2',
    [platform, platformId]
  )
  return rows[0] || null
}

export async function create({ userId, platform, platformId, platformMeta = {} }) {
  const { rows } = await query(
    `INSERT INTO channels (user_id, platform, platform_id, platform_meta)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (platform, platform_id) DO UPDATE SET user_id = $1, enabled = true
     RETURNING *`,
    [userId, platform, platformId, JSON.stringify(platformMeta)]
  )
  return rows[0]
}

export async function updateLastActive(id) {
  await query('UPDATE channels SET last_active = now() WHERE id = $1', [id])
}

export async function disable(id) {
  await query('UPDATE channels SET enabled = false WHERE id = $1', [id])
}

export async function enable(id) {
  await query('UPDATE channels SET enabled = true WHERE id = $1', [id])
}

export async function remove(id) {
  await query('DELETE FROM channels WHERE id = $1', [id])
}

export async function findLastActiveForUser(userId) {
  const { rows } = await query(
    `SELECT * FROM channels WHERE user_id = $1 AND enabled = true
     ORDER BY last_active DESC NULLS LAST LIMIT 1`,
    [userId]
  )
  return rows[0] || null
}
