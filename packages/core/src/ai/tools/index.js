/**
 * Tool registry.
 * Builds all available tools scoped to a specific user.
 * Integration tools only registered for connected platforms.
 * connect/disconnect tools always available (for onboarding).
 */
import * as filesystem from './filesystem.js'
import * as documents from './documents.js'
import * as google from './google.js'
import * as microsoft from './microsoft.js'
import * as reminders from './reminders.js'
import * as attachments from './attachments.js'
const ALWAYS_ALLOWED = ['read_file', 'list_files', 'get_attachment']

/**
 * @param {string} userId
 * @param {string[]} allowedTools - Tool names this user's plan allows
 * @param {string} [sessionId] - Current session ID (for get_attachment)
 * @param {string} [timezone] - User's timezone from DB
 * @param {string[]} [activeProviders] - Connected providers: ['google', 'microsoft']
 * @param {string} [plan] - User's plan (for connect_integration limits)
 */
function buildToolsForUser(userId, allowedTools = [], sessionId = null, timezone = 'UTC', activeProviders = [], plan = 'free') {
  const opts = { timezone }
  const all = {
    ...filesystem.create(userId),
    ...documents.create(userId),
    ...reminders.create(userId),
    ...(sessionId ? attachments.create(userId, sessionId) : {}),
    ...(activeProviders.includes('google') ? google.create(userId, opts) : {}),
    ...(activeProviders.includes('microsoft') ? microsoft.create(userId, opts) : {}),
  }

  const allowed = new Set([...allowedTools, ...ALWAYS_ALLOWED])

  return Object.fromEntries(
    Object.entries(all).filter(([name]) => allowed.has(name))
  )
}

function listAll() {
  return [
    ...Object.keys(filesystem.create('_')),
    ...Object.keys(documents.create('_')),
    ...Object.keys(google.create('_')),
    ...Object.keys(microsoft.create('_')),
    ...Object.keys(reminders.create('_')),
    ...Object.keys(integrations.create('_')),
    'get_attachment',
  ]
}

export { buildToolsForUser, listAll }
