import { query } from '../client.js'

export async function findActive(userId) {
  const { rows } = await query(
    'SELECT * FROM conversation_sessions WHERE user_id = $1 AND is_active = true LIMIT 1',
    [userId]
  )
  return rows[0] || null
}

export async function create(userId, channelId = null) {
  const { rows } = await query(
    `INSERT INTO conversation_sessions (user_id, channel_id)
     VALUES ($1, $2) RETURNING *`,
    [userId, channelId]
  )
  return rows[0]
}

export async function incrementCount(id) {
  await query(
    'UPDATE conversation_sessions SET message_count = message_count + 1, last_message = now() WHERE id = $1',
    [id]
  )
}

export async function deactivate(id) {
  await query(
    'UPDATE conversation_sessions SET is_active = false WHERE id = $1',
    [id]
  )
}

export async function shouldRotate(id, maxMessages = 30, idleMs = 7200000) {
  const { rows } = await query(
    'SELECT message_count, last_message FROM conversation_sessions WHERE id = $1',
    [id]
  )
  if (!rows[0]) return true

  const { message_count, last_message } = rows[0]
  if (message_count >= maxMessages) return true

  const idleSince = Date.now() - new Date(last_message).getTime()
  if (idleSince >= idleMs) return true

  return false
}
