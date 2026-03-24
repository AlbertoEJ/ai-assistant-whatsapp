/**
 * Seed script — creates test org, user, and channel for local testing.
 *
 * Usage: DATABASE_URL=postgres://bot:bot@localhost:5432/bot node scripts/seed.js
 *
 * Customize TELEGRAM_USER_ID and USER_EMAIL below.
 */
import { query, close } from '../packages/db/src/client.js'

// ========================================
// CONFIGURE THESE FOR YOUR SETUP
// ========================================
const TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID || 'YOUR_TELEGRAM_ID'
const USER_NAME = process.env.USER_NAME || 'Your Name'
const USER_EMAIL = process.env.USER_EMAIL || 'you@example.com'
const ORG_NAME = process.env.ORG_NAME || 'My Team'
// ========================================

async function seed() {
  console.log('[seed] Starting...')

  // Check if org already exists
  const { rows: existingOrgs } = await query(
    "SELECT id FROM organizations WHERE slug = 'seed-team'"
  )

  if (existingOrgs.length > 0) {
    console.log('[seed] Seed data already exists. Use --reset to recreate.')
    if (process.argv.includes('--reset')) {
      console.log('[seed] Resetting seed data...')
      await query("DELETE FROM organizations WHERE slug = 'seed-team'")
    } else {
      await close()
      return
    }
  }

  // Create organization
  const { rows: orgs } = await query(
    `INSERT INTO organizations (name, slug, plan, max_users, messages_limit)
     VALUES ($1, 'seed-team', 'equipo', 10, 6000)
     RETURNING id`,
    [ORG_NAME]
  )
  const orgId = orgs[0].id
  console.log(`[seed] Organization created: ${orgId}`)

  // Create user
  const { rows: users } = await query(
    `INSERT INTO users (org_id, name, email, role, allowed_tools)
     VALUES ($1, $2, $3, 'admin', $4)
     RETURNING id`,
    [orgId, USER_NAME, USER_EMAIL, [
      'read_file', 'write_file', 'list_files',
      'create_pdf', 'create_excel', 'create_reminder',
      'gmail_search', 'gmail_read', 'gmail_send',
      'calendar_list', 'calendar_create',
      'drive_list', 'tasks_list', 'tasks_create',
      'outlook_list', 'outlook_read', 'outlook_send',
      'ms_calendar_list', 'ms_calendar_create',
      'onedrive_list', 'ms_tasks_list', 'ms_tasks_create',
    ]]
  )
  const userId = users[0].id
  console.log(`[seed] User created: ${userId} (${USER_NAME})`)

  // Create Telegram channel
  await query(
    `INSERT INTO channels (user_id, platform, platform_id, platform_meta)
     VALUES ($1, 'telegram', $2, $3)`,
    [userId, TELEGRAM_USER_ID, JSON.stringify({ name: USER_NAME })]
  )
  console.log(`[seed] Telegram channel linked: ${TELEGRAM_USER_ID}`)

  // Create default memory + soul
  await query(
    `INSERT INTO user_memory (user_id, type, content) VALUES ($1, 'memory', $2)`,
    [userId, `# Datos del usuario\n- Nombre: ${USER_NAME}\n\n# Preferencias\n- (por descubrir)\n\n# Contexto\n- (se actualiza con cada conversación)`]
  )
  await query(
    `INSERT INTO user_memory (user_id, type, content) VALUES ($1, 'soul', $2)`,
    [userId, '- Habla en español, sé directo y conciso\n- No uses emojis salvo que te lo pidan\n- Prioriza soluciones prácticas']
  )
  console.log('[seed] Memory + soul created')

  console.log('\n[seed] Done! Summary:')
  console.log(`  Org:     ${ORG_NAME} (${orgId})`)
  console.log(`  User:    ${USER_NAME} (${userId})`)
  console.log(`  Plan:    equipo (6,000 msgs/month)`)
  console.log(`  Channel: telegram:${TELEGRAM_USER_ID}`)
  console.log('\nNext: set TELEGRAM_BOT_TOKEN and GEMINI_API_KEY in .env, then start the services.')

  await close()
}

seed().catch(err => {
  console.error('[seed] Fatal:', err.message)
  process.exit(1)
})
