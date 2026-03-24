/**
 * Model router — decides which AI model to use based on message complexity.
 *
 * Tiers:
 *   light    → Grok 4.1 Fast           (text + images, tool calls, web search, cheapest)
 *   standard → Gemini 2.5 Flash        (audio, multimodal, Google Search grounding, Maps)
 *   complex  → Grok 4.20               (deep reasoning, web search, images)
 *
 * Fallback: each tier falls back to Gemini 2.5 Flash if API key not set.
 *
 * Audio messages ALWAYS go to standard (Gemini is the only model with native audio).
 * Images without audio go to light (Grok supports image input).
 *
 * Future: When gemini-3.1-flash-lite leaves preview, evaluate as
 *         standard tier replacement ($0.25/$1.50 vs $0.30/$2.50).
 */
import { google } from '@ai-sdk/google'

const LIGHT_PATTERNS = [
  /^(hola|hey|buenas|buenos días|buenas tardes|buenas noches|gracias|ok|sí|no|va|sale)$/i,
  /^.{1,10}$/,
]

const COMPLEX_PATTERNS = [
  /(anali[zs]a|an[aá]lisis|profundidad|detallad[oa]|detalle\b|exhaustiv[oa]|completo|contrato|legal|revisa con cuidado)/i,
]

/**
 * Classify message into a tier using pattern matching.
 * Audio always goes to standard (only Gemini supports native audio).
 * Images go to light (Grok supports images at $0.20/MTok).
 */
function classify(message, { hasFiles = false, hasAudio = false } = {}) {
  if (!message || message.trim().length === 0) return 'light'

  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(message)) return 'complex'
  }

  // Audio → always Gemini (only model with native audio support)
  if (hasAudio) return 'standard'

  // Images/PDFs → light is fine (Grok supports images)
  // but if no Grok key, fall through to standard
  if (hasFiles && !hasGrokKey()) return 'standard'

  for (const pattern of LIGHT_PATTERNS) {
    if (pattern.test(message.trim())) return 'light'
  }

  return hasFiles ? 'standard' : 'standard'
}

function hasGrokKey() {
  return !!process.env.XAI_API_KEY
}

/** Gemini 2.5 Flash with light thinking for tool planning. */
function geminiFlash() {
  return google('gemini-2.5-flash', { thinkingConfig: { thinkingBudget: 1024 } })
}

/**
 * Get the AI SDK model instance for a tier.
 */
async function getModel(tier) {
  switch (tier) {
    case 'light':
      if (hasGrokKey()) {
        const { xai } = await import('@ai-sdk/xai')
        return xai('grok-4-1-fast-reasoning')
      }
      return geminiFlash()
    case 'complex':
      if (hasGrokKey()) {
        const { xai } = await import('@ai-sdk/xai')
        return xai('grok-4.20-0309-reasoning')
      }
      return geminiFlash()
    case 'standard':
    default:
      return geminiFlash()
  }
}

function getModelName(tier) {
  switch (tier) {
    case 'light': return hasGrokKey() ? 'grok-4-1-fast' : 'gemini-2.5-flash'
    case 'complex': return hasGrokKey() ? 'grok-4.20' : 'gemini-2.5-flash'
    case 'standard':
    default: return 'gemini-2.5-flash'
  }
}

function getCostPerMillion(tier) {
  switch (tier) {
    case 'light': return hasGrokKey()
      ? { input: 0.20, output: 0.50 }
      : { input: 0.30, output: 2.50 }
    case 'complex': return hasGrokKey()
      ? { input: 2.00, output: 6.00 }
      : { input: 0.30, output: 2.50 }
    case 'standard':
    default: return { input: 0.30, output: 2.50 }
  }
}

function estimateCost(tier, tokensIn, tokensOut) {
  const rates = getCostPerMillion(tier)
  return (tokensIn / 1_000_000) * rates.input + (tokensOut / 1_000_000) * rates.output
}

export { classify, getModel, getModelName, getCostPerMillion, estimateCost }
