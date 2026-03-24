import { query } from '../client.js'

export async function findByUser(userId) {
  const { rows } = await query(
    'SELECT * FROM crons WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC',
    [userId]
  )
  return rows
}

export async function findDue() {
  const { rows } = await query(
    `SELECT * FROM crons
     WHERE is_active = true AND next_run IS NOT NULL AND next_run <= now()
     ORDER BY next_run ASC`
  )
  return rows
}

export async function create({ userId, schedule, prompt, isOnce = false }) {
  const { rows } = await query(
    `INSERT INTO crons (user_id, schedule, prompt, is_once)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, schedule, prompt, isOnce]
  )
  return rows[0]
}

export async function updateLastRun(id, nextRun = null) {
  await query(
    'UPDATE crons SET last_run = now(), next_run = $2 WHERE id = $1',
    [id, nextRun]
  )
}

export async function deactivate(id) {
  await query('UPDATE crons SET is_active = false WHERE id = $1', [id])
}

export async function remove(id, userId) {
  await query('DELETE FROM crons WHERE id = $1 AND user_id = $2', [id, userId])
}
