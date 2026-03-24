/**
 * Session summaries (layer 3 — episodic memory).
 * Generated on session rotation, indexed in vector store.
 */
import * as repos from '@bot/db/src/repositories/index.js'
import * as embeddings from './embeddings.js'
import { createLogger } from '@bot/shared/src/logger.js'

const memoryRepo = repos.memory

const log = createLogger('summaries')

const SUMMARY_PROMPT = `Resume esta conversación en español. Incluye:
1. Temas principales discutidos
2. Decisiones tomadas
3. Tareas pendientes o compromisos
4. Información personal relevante que el usuario compartió

Sé conciso (máximo 300 palabras). No incluyas saludos ni despedidas.`

async function save(userId, sessionId, content) {
  const summary = await memoryRepo.createSummary(userId, sessionId, content)

  const vector = await embeddings.embed(content)
  if (vector) {
    await memoryRepo.addEmbedding(userId, {
      source: 'summary',
      sourceId: summary.id,
      text: content,
      embedding: vector,
      metadata: { sessionId },
    })
    log.debug('Summary indexed', { userId })
  }

  return summary
}

async function getRecent(userId, limit = 3) {
  return memoryRepo.getRecentSummaries(userId, limit)
}

function buildSummaryPrompt() {
  return SUMMARY_PROMPT
}

export { save, getRecent, buildSummaryPrompt }
