/**
 * User files repository.
 * Files stored on disk at data/uploads/{userId}/
 * DB only stores metadata (path, mime type, size).
 * AI model never accesses paths directly — processor reads and passes content.
 */
import fs from 'node:fs'
import path from 'node:path'
import { query } from '../client.js'

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'data', 'uploads')

function getUserDir(userId) {
  const dir = path.join(UPLOADS_DIR, userId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function getFilePath(userId, filename) {
  // Prevent path traversal
  const safe = path.basename(filename)
  return path.join(getUserDir(userId), safe)
}

async function get(userId, filename) {
  const { rows } = await query(
    'SELECT * FROM user_files WHERE user_id = $1 AND filename = $2',
    [userId, filename]
  )
  if (!rows[0]) return null

  const filePath = getFilePath(userId, filename)
  let content = null
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath)
  }

  return { ...rows[0], content }
}

async function list(userId) {
  const { rows } = await query(
    'SELECT id, filename, mime_type, size_bytes, created_at FROM user_files WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  )
  return rows
}

async function upsert({ userId, filename, content, mimeType, metadata = {} }) {
  const safe = path.basename(filename)
  const filePath = getFilePath(userId, safe)
  const size = content ? content.length : 0

  // Write to disk
  if (content) {
    fs.writeFileSync(filePath, content)
  }

  // Save metadata to DB (no binary content in DB)
  const { rows } = await query(
    `INSERT INTO user_files (user_id, filename, mime_type, size_bytes, metadata)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, filename)
     DO UPDATE SET mime_type = $3, size_bytes = $4, metadata = $5, created_at = now()
     RETURNING id, filename, mime_type, size_bytes, created_at`,
    [userId, safe, mimeType, size, JSON.stringify(metadata)]
  )
  return rows[0]
}

async function remove(userId, filename) {
  const filePath = getFilePath(userId, filename)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)

  const { rowCount } = await query(
    'DELETE FROM user_files WHERE user_id = $1 AND filename = $2',
    [userId, filename]
  )
  return rowCount > 0
}

async function getTotalSize(userId) {
  const { rows } = await query(
    'SELECT COALESCE(SUM(size_bytes), 0)::int AS total FROM user_files WHERE user_id = $1',
    [userId]
  )
  return rows[0].total
}

export { get, list, upsert, remove, getTotalSize }
