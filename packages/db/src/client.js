import pg from 'pg'

const { Pool } = pg

let pool = null

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })

    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message)
    })
  }
  return pool
}

export function query(text, params) {
  return getPool().query(text, params)
}

export function getClient() {
  return getPool().connect()
}

export async function transaction(fn) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function close() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
