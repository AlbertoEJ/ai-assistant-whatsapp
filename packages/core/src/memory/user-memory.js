/**
 * User memory (layer 1) and soul (layer 2).
 * Persistent facts and personality stored in PostgreSQL.
 */
import * as repos from '@bot/db/src/repositories/index.js'

const memoryRepo = repos.memory

const DEFAULT_MEMORY = `# Datos del usuario
- (vacío, se llena conforme interactúa)

# Preferencias
- (por descubrir)

# Contexto
- (se actualiza con cada conversación)`

const DEFAULT_SOUL = `- Habla en español, sé directo y conciso
- No uses emojis salvo que te lo pidan
- Prioriza soluciones prácticas`

async function getMemory(userId) {
  const record = await memoryRepo.getMemory(userId)
  return record ? record.content : ''
}

async function getSoul(userId) {
  const record = await memoryRepo.getSoul(userId)
  return record ? record.content : ''
}

async function setMemory(userId, content) {
  return memoryRepo.setMemory(userId, content)
}

async function setSoul(userId, content) {
  return memoryRepo.setSoul(userId, content)
}

async function ensureDefaults(userId) {
  const mem = await memoryRepo.getMemory(userId)
  if (!mem) await memoryRepo.setMemory(userId, DEFAULT_MEMORY)

  const soul = await memoryRepo.getSoul(userId)
  if (!soul) await memoryRepo.setSoul(userId, DEFAULT_SOUL)
}

export { getMemory, getSoul, setMemory, setSoul, ensureDefaults }
