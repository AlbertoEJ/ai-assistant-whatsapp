/**
 * Embedding provider (layer 4 support).
 * Uses Ollama with nomic-embed-text for local, free embeddings.
 */
import { config } from '@bot/shared'
import { createLogger } from '@bot/shared/src/logger.js'

const log = createLogger('embeddings')

let available = null

async function checkAvailable() {
  if (available !== null) return available
  try {
    const res = await fetch(`${config.ollamaUrl}/api/tags`)
    if (!res.ok) { available = false; return false }
    const data = await res.json()
    available = data.models?.some(m => m.name.includes(config.embeddingModel)) || false
    if (!available) log.warn(`Embedding model ${config.embeddingModel} not found in Ollama`)
    return available
  } catch {
    available = false
    log.warn('Ollama not reachable, embeddings disabled')
    return false
  }
}

async function embed(text) {
  if (!await checkAvailable()) return null

  const truncated = text.slice(0, 30000)
  try {
    const res = await fetch(`${config.ollamaUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.embeddingModel, input: truncated }),
    })

    if (!res.ok) {
      log.error(`Ollama embed failed: ${res.status}`)
      return null
    }

    const data = await res.json()
    return data.embeddings?.[0] || null
  } catch (err) {
    log.error('Embedding error', err)
    return null
  }
}

function isAvailable() {
  return available === true
}

export { embed, isAvailable, checkAvailable }
