import { query } from '../client.js'

export async function get(userId, type) {
  const { rows } = await query(
    'SELECT * FROM user_memory WHERE user_id = $1 AND type = $2',
    [userId, type]
  )
  return rows[0] || null
}

export async function upsert(userId, type, content) {
  const { rows } = await query(
    `INSERT INTO user_memory (user_id, type, content)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, type)
     DO UPDATE SET content = $3, updated_at = now()
     RETURNING *`,
    [userId, type, content]
  )
  return rows[0]
}

export async function getMemory(userId) {
  return get(userId, 'memory')
}

export async function getSoul(userId) {
  return get(userId, 'soul')
}

export async function setMemory(userId, content) {
  return upsert(userId, 'memory', content)
}

export async function setSoul(userId, content) {
  return upsert(userId, 'soul', content)
}

export async function createSummary(userId, sessionId, content) {
  const { rows } = await query(
    `INSERT INTO summaries (user_id, session_id, content)
     VALUES ($1, $2, $3) RETURNING *`,
    [userId, sessionId, content]
  )
  return rows[0]
}

export async function getRecentSummaries(userId, limit = 3) {
  const { rows } = await query(
    'SELECT * FROM summaries WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  )
  return rows.reverse()
}

export async function addEmbedding(userId, { source, sourceId, text, embedding, metadata = {} }) {
  const vectorStr = `[${embedding.join(',')}]`
  const { rows } = await query(
    `INSERT INTO embeddings (user_id, source, source_id, text, embedding, metadata)
     VALUES ($1, $2, $3, $4, $5::vector, $6) RETURNING id`,
    [userId, source, sourceId, text, vectorStr, JSON.stringify(metadata)]
  )
  return rows[0]
}

export async function searchSimilar(userId, embedding, { topK = 3, minScore = 0.4 } = {}) {
  const vectorStr = `[${embedding.join(',')}]`
  const { rows } = await query(
    `SELECT id, source, text, metadata,
       1 - (embedding <=> $2::vector) AS similarity
     FROM embeddings
     WHERE user_id = $1
       AND 1 - (embedding <=> $2::vector) > $3
     ORDER BY embedding <=> $2::vector
     LIMIT $4`,
    [userId, vectorStr, minScore, topK]
  )
  return rows
}

export async function deleteEmbeddingsBySource(userId, source, sourceId) {
  await query(
    'DELETE FROM embeddings WHERE user_id = $1 AND source = $2 AND source_id = $3',
    [userId, source, sourceId]
  )
}
