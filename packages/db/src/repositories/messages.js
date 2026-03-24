import { query } from '../client.js'

export async function create({ sessionId, userId, role, content, toolCalls, toolResult, tokensIn, tokensOut, model }) {
  const { rows } = await query(
    `INSERT INTO messages (session_id, user_id, role, content, tool_calls, tool_result, tokens_in, tokens_out, model)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      sessionId, userId, role, content,
      toolCalls ? JSON.stringify(toolCalls) : null,
      toolResult ? JSON.stringify(toolResult) : null,
      tokensIn || 0, tokensOut || 0, model,
    ]
  )
  return rows[0]
}

export async function findBySession(sessionId, limit = 50) {
  const { rows } = await query(
    `SELECT * FROM messages WHERE session_id = $1
     ORDER BY created_at ASC LIMIT $2`,
    [sessionId, limit]
  )
  return rows
}

export async function findRecentByUser(userId, limit = 20) {
  const { rows } = await query(
    `SELECT m.* FROM messages m
     JOIN conversation_sessions s ON m.session_id = s.id
     WHERE m.user_id = $1
     ORDER BY m.created_at DESC LIMIT $2`,
    [userId, limit]
  )
  return rows.reverse()
}

export async function countBySession(sessionId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS count FROM messages WHERE session_id = $1',
    [sessionId]
  )
  return rows[0].count
}
