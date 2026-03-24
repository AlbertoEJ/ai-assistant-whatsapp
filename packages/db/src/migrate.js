import fs from 'node:fs'
import path from 'node:path'
import { query, close } from './client.js'

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations')

async function run(reset = false) {
  console.log('[migrate] Starting...')

  if (reset) {
    console.log('[migrate] Resetting database...')
    await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  }

  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  const { rows: applied } = await query('SELECT name FROM _migrations ORDER BY name')
  const appliedSet = new Set(applied.map(r => r.name))

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()

  let count = 0
  for (const file of files) {
    if (appliedSet.has(file)) continue

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    console.log(`[migrate] Applying ${file}...`)

    try {
      await query(sql)
      await query('INSERT INTO _migrations (name) VALUES ($1)', [file])
      count++
    } catch (err) {
      console.error(`[migrate] FAILED on ${file}: ${err.message}`)
      process.exit(1)
    }
  }

  console.log(`[migrate] Done. Applied ${count} new migration(s).`)
  await close()
}

const reset = process.argv.includes('--reset')
run(reset).catch(err => {
  console.error('[migrate] Fatal:', err.message)
  process.exit(1)
})
