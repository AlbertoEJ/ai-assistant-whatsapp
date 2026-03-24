/**
 * Message limits — simple usage tracking.
 * Configure MESSAGE_LIMIT env var to set max messages per month (default: unlimited).
 */
import { query } from '@bot/db/src/client.js'

const MESSAGE_LIMIT = parseInt(process.env.MESSAGE_LIMIT) || 0 // 0 = unlimited

async function canSendMessage(orgId) {
  if (!MESSAGE_LIMIT) return { allowed: true, used: 0, limit: 0, plan: 'default' }

  const { rows } = await query(
    'SELECT plan, "messagesLimit", "messagesUsed" FROM organization WHERE id = $1',
    [orgId]
  ).catch(() => ({ rows: [] }))

  if (!rows[0]) return { allowed: true, used: 0, limit: MESSAGE_LIMIT, plan: 'default' }

  const { plan, messagesLimit, messagesUsed } = rows[0]
  const limit = messagesLimit || MESSAGE_LIMIT

  if (messagesUsed >= limit) {
    return { allowed: false, reason: 'Message limit reached.', used: messagesUsed, limit }
  }

  return { allowed: true, used: messagesUsed, limit, plan: plan || 'default' }
}

async function incrementUsage(orgId) {
  await query(
    'UPDATE organization SET "messagesUsed" = "messagesUsed" + 1 WHERE id = $1',
    [orgId]
  ).catch(() => {})
}

async function resetMonthlyUsage(orgId) {
  await query('UPDATE organization SET "messagesUsed" = 0 WHERE id = $1', [orgId]).catch(() => {})
}

function getPlanLimits() {
  return { messagesLimit: MESSAGE_LIMIT || 999999, audioEnabled: true, webSearchEnabled: true }
}

async function isNearLimit(orgId, threshold = 0.8) {
  if (!MESSAGE_LIMIT) return false
  const { rows } = await query(
    'SELECT "messagesLimit", "messagesUsed" FROM organization WHERE id = $1', [orgId]
  ).catch(() => ({ rows: [] }))
  if (!rows[0]) return false
  return rows[0].messagesUsed >= (rows[0].messagesLimit || MESSAGE_LIMIT) * threshold
}

export { canSendMessage, incrementUsage, resetMonthlyUsage, getPlanLimits, isNearLimit }
