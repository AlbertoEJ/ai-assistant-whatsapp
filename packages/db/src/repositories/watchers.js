import { query } from '../client.js'

export async function findByUser(userId) {
  const { rows } = await query(
    'SELECT * FROM watchers WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC',
    [userId]
  )
  return rows
}

export async function findByType(type) {
  const { rows } = await query(
    'SELECT * FROM watchers WHERE type = $1 AND is_active = true',
    [type]
  )
  return rows
}

export async function create({ userId, type, condition, action = 'notify', messageTemplate }) {
  const { rows } = await query(
    `INSERT INTO watchers (user_id, type, condition, action, message_template)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, type, JSON.stringify(condition), action, messageTemplate]
  )
  return rows[0]
}

export async function updateSubscription(id, subscriptionId, expiresAt) {
  await query(
    'UPDATE watchers SET subscription_id = $2, expires_at = $3 WHERE id = $1',
    [id, subscriptionId, expiresAt]
  )
}

export async function findExpiring(minutesBefore = 60) {
  const { rows } = await query(
    `SELECT * FROM watchers
     WHERE is_active = true AND expires_at IS NOT NULL
       AND expires_at < now() + interval '1 minute' * $1`,
    [minutesBefore]
  )
  return rows
}

export async function deactivate(id) {
  await query('UPDATE watchers SET is_active = false WHERE id = $1', [id])
}

export async function remove(id, userId) {
  await query('DELETE FROM watchers WHERE id = $1 AND user_id = $2', [id, userId])
}
