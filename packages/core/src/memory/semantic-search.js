/**
 * Semantic search (layer 4).
 * Finds relevant context from memory and summaries via pgvector.
 * Falls back to keyword search over recent summaries if embeddings unavailable.
 */
import * as repos from '@bot/db/src/repositories/index.js'
import * as embeddings from './embeddings.js'
import { createLogger } from '@bot/shared/src/logger.js'

const memoryRepo = repos.memory

const log = createLogger('semantic-search')

async function findRelevantContext(userId, query, { topK = 3, minScore = 0.4 } = {}) {
  const vector = await embeddings.embed(query)

  if (vector) {
    return searchByVector(userId, vector, topK, minScore)
  }

  return fallbackKeywordSearch(userId, query)
}

async function searchByVector(userId, vector, topK, minScore) {
  const results = await memoryRepo.searchSimilar(userId, vector, { topK, minScore })

  if (results.length === 0) return ''

  const contextParts = results.map(r =>
    `[Contexto relevante (${r.source}, similitud: ${(r.similarity * 100).toFixed(0)}%)]\n${r.text}`
  )

  log.debug('Semantic search results', { userId, count: results.length })
  return contextParts.join('\n\n') + '\n\n'
}

async function fallbackKeywordSearch(userId, query) {
  const summaries = await memoryRepo.getRecentSummaries(userId, 5)
  if (summaries.length === 0) return ''

  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  if (keywords.length === 0) {
    const recent = summaries.slice(0, 2)
    return formatSummaries(recent)
  }

  const scored = summaries.map(s => {
    const text = s.content.toLowerCase()
    const hits = keywords.filter(k => text.includes(k)).length
    return { ...s, score: hits }
  })

  const relevant = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 3)

  if (relevant.length === 0) {
    return formatSummaries(summaries.slice(0, 2))
  }

  return formatSummaries(relevant)
}

function formatSummaries(summaries) {
  if (summaries.length === 0) return ''
  const parts = summaries.map(s => `[Resumen previo]\n${s.content}`)
  return parts.join('\n\n') + '\n\n'
}

export { findRelevantContext }
