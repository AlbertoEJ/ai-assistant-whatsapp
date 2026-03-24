/**
 * Session manager.
 * Handles conversation session lifecycle:
 * - Reset: daily (4 AM) or idle (45 min) — NOT by message count
 * - Compaction: summarize old messages when approaching token limit
 * - Memory flush: extract facts before compaction
 */
import { sessions as sessionRepo, messages as messageRepo } from '@bot/db/src/repositories/index.js'
import { ai, memory } from '@bot/core/src/index.js'
import { config } from '@bot/shared/src/index.js'
import { createLogger } from '@bot/shared/src/logger.js'

const log = createLogger('session-manager')

const { runner: aiRunner } = ai
const { summaryManager, userMemory } = memory

const SESSION_IDLE_MS = parseInt(process.env.SESSION_IDLE_MS) || 45 * 60 * 1000 // 45 min
const DAILY_RESET_HOUR = parseInt(process.env.DAILY_RESET_HOUR) || 4 // 4 AM
const CONTEXT_TOKEN_LIMIT = parseInt(process.env.CONTEXT_TOKEN_LIMIT) || 900000 // ~90% of 1M
const COMPACTION_THRESHOLD = 0.7 // compact at 70% of limit (~630K tokens)

/**
 * Get or create active session for a user.
 */
async function getOrCreate(userId, channelId = null) {
  let session = await sessionRepo.findActive(userId)
  if (!session) {
    session = await sessionRepo.create(userId, channelId)
    log.debug('New session created', { userId, sessionId: session.id })
  }
  return session
}

/**
 * Load conversation history for context window.
 * Includes tool calls/results so the model retains IDs across turns.
 *
 * Per AI SDK docs, the format for messages with tool calls is:
 *   { role: 'assistant', content: [{ type: 'tool-call', ... }] }
 *   { role: 'tool', content: [{ type: 'tool-result', ... }] }
 */
async function loadHistory(sessionId, limit = 100) {
  const messages = await messageRepo.findBySession(sessionId, limit)
  const result = []

  for (const m of messages) {
    if (m.role === 'user') {
      // Merge consecutive user messages
      const last = result[result.length - 1]
      if (last && last.role === 'user') {
        if (typeof last.content === 'string') {
          last.content += '\n' + m.content
        }
      } else {
        result.push({ role: 'user', content: m.content })
      }
    } else if (m.role === 'assistant') {
      // Check if content is JSON (tool-call parts from responseMessages)
      let parsedContent = null
      if (m.content && m.content.startsWith('[')) {
        try { parsedContent = JSON.parse(m.content) } catch {}
      }

      if (parsedContent && Array.isArray(parsedContent)) {
        // Already in AI SDK format — pass as-is
        result.push({ role: 'assistant', content: parsedContent })
      } else if (m.tool_calls && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        // Old format with tool_calls column
        const contentParts = []
        if (m.content && !m.content.startsWith('[')) contentParts.push({ type: 'text', text: m.content })
        for (const tc of m.tool_calls) {
          contentParts.push({
            type: 'tool-call',
            toolCallId: tc.toolCallId || `call_${Date.now()}`,
            toolName: tc.toolName,
            args: tc.args || {},
          })
        }
        result.push({ role: 'assistant', content: contentParts })
      } else {
        // Plain text — merge consecutive
        const last = result[result.length - 1]
        if (last && last.role === 'assistant' && typeof last.content === 'string') {
          last.content += '\n' + m.content
        } else {
          result.push({ role: 'assistant', content: m.content || '' })
        }
      }
    } else if (m.role === 'tool') {
      // Tool result message — parse JSON content
      let content = m.content
      if (typeof content === 'string') {
        try { content = JSON.parse(content) } catch {}
      }
      // Also check tool_result column
      if (m.tool_result && Array.isArray(m.tool_result)) {
        content = m.tool_result
      }
      if (Array.isArray(content)) {
        result.push({ role: 'tool', content })
      }
    }
  }

  return result
}

/**
 * Save a message to the session.
 */
async function saveMessage(sessionId, userId, { role, content, toolCalls, tokensIn, tokensOut, model }) {
  await messageRepo.create({
    sessionId,
    userId,
    role,
    content,
    toolCalls,
    tokensIn: tokensIn || 0,
    tokensOut: tokensOut || 0,
    model,
  })
  await sessionRepo.incrementCount(sessionId)
}

/**
 * Check if session should be reset (daily or idle).
 * Returns the (possibly new) active session.
 */
async function checkRotation(userId, session, userName, allowedTools) {
  const shouldReset = checkShouldReset(session)

  if (shouldReset) {
    log.info('Session reset triggered', { userId, sessionId: session.id, reason: shouldReset })
    return await resetSession(userId, session, userName)
  }

  return session
}

/**
 * Check reset conditions: daily reset at DAILY_RESET_HOUR or idle timeout.
 */
function checkShouldReset(session) {
  const lastMsg = new Date(session.last_message).getTime()
  const now = Date.now()

  // Idle reset
  if (now - lastMsg > SESSION_IDLE_MS) {
    return 'idle'
  }

  // Daily reset: if session started before today's reset hour
  const today = new Date()
  const resetTime = new Date(today)
  resetTime.setHours(DAILY_RESET_HOUR, 0, 0, 0)

  // If current time is past reset hour and session started before reset hour
  const sessionCreated = new Date(session.created_at).getTime()
  if (now > resetTime.getTime() && sessionCreated < resetTime.getTime()) {
    return 'daily'
  }

  return null
}

/**
 * Reset session: flush memory, generate summary, create new session.
 */
async function resetSession(userId, session, userName) {
  if (session.message_count >= 3) {
    await flushAndSummarize(userId, session, userName)
  }

  await sessionRepo.deactivate(session.id)
  const newSession = await sessionRepo.create(userId)
  log.info('Session reset', { userId, oldId: session.id, newId: newSession.id })

  return newSession
}

/**
 * Memory flush + summary generation.
 * Extracts important facts to memory, then generates a session summary.
 */
async function flushAndSummarize(userId, session, userName) {
  try {
    const history = await loadHistory(session.id, 100)
    if (history.length < 3) return

    // 1. Memory flush: extract facts from conversation
    const memoryFlushPrompt = `Revisa esta conversación y extrae SOLO los hechos nuevos e importantes sobre el usuario que deberían recordarse permanentemente. Formato:
- Dato 1
- Dato 2
Si no hay hechos nuevos relevantes, responde exactamente: [NADA]`

    const flushResult = await aiRunner.run({
      userId, userName,
      prompt: memoryFlushPrompt,
      allowedTools: [],
      history,
      options: { forceTier: 'light' },
    })

    if (flushResult.text && !flushResult.text.includes('[NADA]')) {
      const currentMemory = await userMemory.getMemory(userId) || ''
      const updatedMemory = currentMemory + '\n\n## Actualización automática\n' + flushResult.text
      await userMemory.setMemory(userId, updatedMemory)
      log.info('Memory flush completed', { userId })
    }

    // 2. Generate session summary
    const summaryPrompt = summaryManager.buildSummaryPrompt()
    const summaryResult = await aiRunner.run({
      userId, userName,
      prompt: summaryPrompt,
      allowedTools: [],
      history,
      options: { forceTier: 'light' },
    })

    if (summaryResult.text && !summaryResult.text.includes('(sin respuesta)')) {
      await summaryManager.save(userId, session.id, summaryResult.text)
      log.info('Summary generated', { userId, sessionId: session.id })
    }
  } catch (err) {
    log.error('Flush and summarize failed', { userId, error: err.message })
  }
}

/**
 * Flush session from /clear command.
 * Extracts memory + generates summary for a session being manually closed.
 */
async function flushSession({ userId, sessionId, userName }) {
  // Session already deactivated by /clear, but we still need it for history
  const { query: dbQuery } = await import('@bot/db/src/client.js')
  const { rows } = await dbQuery('SELECT * FROM conversation_sessions WHERE id = $1', [sessionId])
  if (!rows[0]) return
  await flushAndSummarize(userId, rows[0], userName)
  log.info('Manual flush completed', { userId, sessionId })
}

export { getOrCreate, loadHistory, saveMessage, checkRotation, flushSession }
