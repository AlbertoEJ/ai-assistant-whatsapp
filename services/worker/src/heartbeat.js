/**
 * Heartbeat — proactive assistant.
 * Periodically checks calendar/email/tasks and notifies if something needs attention.
 */
import { createQueue } from '@bot/shared/src/queue.js'
import { query } from '@bot/db/src/client.js'
import config from '@bot/shared/src/config.js'
import { createLogger } from '@bot/shared/src/logger.js'

const log = createLogger('heartbeat')

let interval = null
let cronQueue = null
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS) || 0
const QUIET_HOURS_START = parseInt(process.env.QUIET_HOURS_START) || 23
const QUIET_HOURS_END = parseInt(process.env.QUIET_HOURS_END) || 7

function isQuietHours() {
  const now = new Date()
  const hour = parseInt(now.toLocaleString('es-MX', {
    timeZone: config.timezone,
    hour: 'numeric',
    hour12: false,
  }))
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END
}

function buildHeartbeatPrompt() {
  const timeStr = new Date().toLocaleTimeString('es-MX', { timeZone: config.timezone })
  return `Eres un asistente personal proactivo. Revisa el estado actual del usuario y SOLO notifica si hay algo importante.

REVISA (usa las herramientas de calendario, correo y tareas disponibles):
1. CALENDARIO: Eventos próximos en las siguientes 2 horas.
2. CORREO: Emails no leídos recientes. Solo menciona los importantes/urgentes.
3. PENDIENTES: Tareas vencidas o próximas.

REGLAS:
- Si NO hay nada relevante, responde EXACTAMENTE: [NADA]
- Si hay algo, sé breve y directo.
- NO saludes, NO des contexto innecesario. Ve al grano.
- Hora actual del usuario: ${timeStr}`
}

async function tick() {
  if (isQuietHours()) {
    log.debug('Quiet hours, skipping heartbeat')
    return
  }

  const { rows: users } = await query(`
    SELECT DISTINCT u.id, u.name, u.timezone, m."organizationId" AS org_id, o.plan
    FROM "user" u
    JOIN integrations i ON i.user_id = u.id AND i.enabled = true
    JOIN member m ON m."userId" = u.id
    JOIN organization o ON o.id = m."organizationId"
    WHERE u."isActive" = true AND o.plan != 'free'
  `)

  if (users.length === 0) return

  if (!cronQueue) cronQueue = createQueue('cron_jobs')

  for (const user of users) {
    await cronQueue.add('heartbeat', {
      cronId: 'heartbeat',
      userId: user.id,
      orgId: user.org_id,
      userName: user.name,
      plan: user.plan,
      timezone: user.timezone || config.timezone,
      prompt: buildHeartbeatPrompt(),
      isOnce: false,
    })
  }

  log.info('Heartbeat tick', { usersChecked: users.length })
}

function start() {
  if (interval) return
  if (!HEARTBEAT_INTERVAL_MS) {
    log.info('Heartbeat disabled (HEARTBEAT_INTERVAL_MS=0)')
    return
  }
  interval = setInterval(tick, HEARTBEAT_INTERVAL_MS)
  log.info('Heartbeat started', { intervalMin: HEARTBEAT_INTERVAL_MS / 60000 })

  // First check after 5 minutes (not 1 min — give services time to stabilize)
  setTimeout(tick, 5 * 60 * 1000)
}

function stop() {
  if (interval) {
    clearInterval(interval)
    interval = null
    log.info('Heartbeat stopped')
  }
}

export { start, stop }
