import { query } from '../client.js'

export async function add({ sessionId, userId, filename, mimeType, textContent, isImage }) {
  const { rows } = await query(
    `INSERT INTO session_attachments (session_id, user_id, filename, mime_type, text_content, is_image)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [sessionId, userId, filename, mimeType, textContent || null, isImage || false]
  )
  return rows[0]
}

export async function findBySession(sessionId) {
  const { rows } = await query(
    'SELECT * FROM session_attachments WHERE session_id = $1 ORDER BY created_at ASC',
    [sessionId]
  )
  return rows
}
