/**
 * AI Runner — executes the AI pipeline using Vercel AI SDK v6.
 *
 * Per AI SDK docs (ai-sdk.dev):
 * - stopWhen + stepCountIs instead of maxSteps
 * - totalUsage for accurate token counts across all steps
 * - response.messages for correct conversation history
 * - onStepFinish for per-step logging
 * - Tool results flow back to model automatically via stopWhen loop
 */
import { generateText, stepCountIs } from 'ai'
import * as router from './router.js'
import * as promptBuilder from './prompt-builder.js'
import { semanticSearch } from '../memory/index.js'
import { buildToolsForUser } from './tools/index.js'
import { createLogger } from '@bot/shared/src/logger.js'

const log = createLogger('ai-runner')

const MAX_STEPS = 10
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1000

const FALLBACK_TIER = {
  light: 'standard',
  standard: 'complex',
  complex: null,
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRetryable(err) {
  const msg = err.message || ''
  return (
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('503') ||
    msg.includes('timeout') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT')
  )
}

/**
 * Run the AI pipeline for a user message.
 */
async function run({ userId, userName, prompt, allowedTools, history = [], multimodalParts = [], sessionId = null, options = {} }) {
  const tier = options.forceTier || router.classify(prompt, { hasFiles: options.hasFiles, hasAudio: options.hasAudio })

  // Build context (done once, reused across retries)
  const [systemPrompt, context] = await Promise.all([
    promptBuilder.build(userId, userName, { activeIntegrations: options.activeIntegrations, sessionId, plan: options.plan }),
    semanticSearch.findRelevantContext(userId, prompt),
  ])

  const enrichedPrompt = context ? context + prompt : prompt
  const tools = buildToolsForUser(userId, allowedTools, sessionId, options.timezone, options.activeProviders || [], options.plan)

  // Build message history — preserve tool calls/results for context
  // Messages come pre-formatted from session-manager (user, assistant with tool-calls, tool results)
  const cleanHistory = []
  for (const m of history) {
    if (m.role === 'tool') {
      // Tool result messages — pass as-is
      cleanHistory.push(m)
    } else if (m.role === 'assistant' && Array.isArray(m.content)) {
      // Assistant with tool calls — pass as-is
      cleanHistory.push(m)
    } else {
      // Regular text messages — merge consecutive same-role
      const content = typeof m.content === 'string' ? m.content : String(m.content)
      const last = cleanHistory[cleanHistory.length - 1]
      if (last && last.role === m.role && typeof last.content === 'string') {
        last.content += '\n' + content
      } else {
        cleanHistory.push({ role: m.role, content })
      }
    }
  }

  // Remove last message if it's 'user' (current message replaces it)
  if (cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1].role === 'user') {
    cleanHistory.pop()
  }

  // Build current user message
  let currentMessage
  if (multimodalParts.length > 0) {
    currentMessage = {
      role: 'user',
      content: [
        { type: 'text', text: enrichedPrompt },
        ...multimodalParts,
      ],
    }
  } else {
    currentMessage = { role: 'user', content: enrichedPrompt }
  }

  const messages = [...cleanHistory, currentMessage]

  // Try with primary model, retry on transient errors, fallback on persistent failure
  let currentTier = tier
  let lastError = null

  for (let tierAttempt = 0; tierAttempt < 2; tierAttempt++) {
    const model = await router.getModel(currentTier)
    const modelName = router.getModelName(currentTier)

    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      try {
        if (retry > 0) log.info('Retrying', { userId, tier: currentTier, retry })

        log.info('AI run', { userId, tier: currentTier, modelName, promptLength: prompt.length, hasMultimodal: multimodalParts.length > 0 })

        const result = await generateText({
          model,
          system: systemPrompt,
          messages,
          tools,
          stopWhen: stepCountIs(MAX_STEPS),
          temperature: 0.7,

          // Per-step logging for analytics
          onStepFinish({ stepNumber, text, toolCalls, finishReason, usage }) {
            if (toolCalls?.length > 0) {
              const toolNames = toolCalls.map(tc => tc.toolName).join(', ')
              log.debug('Step', { userId, step: stepNumber, tools: toolNames, finishReason })
            }
          },
        })

        // Use totalUsage for accurate token counts across ALL steps
        // AI SDK v6 uses inputTokens/outputTokens (not promptTokens/completionTokens)
        const tokensIn = result.totalUsage?.inputTokens || result.usage?.inputTokens || 0
        const tokensOut = result.totalUsage?.outputTokens || result.usage?.outputTokens || 0

        // Collect all tool calls across all steps
        const allToolCalls = result.steps?.flatMap(s =>
          (s.toolCalls || []).map(tc => ({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.args,
            result: tc.result,
          }))
        ) || []

        // Log warnings if any
        if (result.warnings?.length) {
          log.warn('AI warnings', { userId, warnings: result.warnings })
        }
        if (result.finishReason === 'error') {
          log.error('AI finished with error', { userId, text: result.text?.slice(0, 200), steps: result.steps?.length })
        }

        log.info('AI complete', {
          userId, tier: currentTier, modelName,
          tokensIn, tokensOut,
          steps: result.steps?.length || 1,
          toolsCalled: allToolCalls.map(tc => tc.toolName),
          finishReason: result.finishReason,
        })

        return {
          text: result.text || '',
          tier: currentTier,
          model: modelName,
          tokensIn,
          tokensOut,
          toolCalls: allToolCalls,
          // response.messages has the full conversation including tool results
          // useful for saving accurate history
          responseMessages: result.response?.messages || [],
        }
      } catch (err) {
        lastError = err
        log.error('AI run failed', { userId, tier: currentTier, retry, error: err.message })

        if (isRetryable(err) && retry < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * (retry + 1))
          continue
        }
        break
      }
    }

    // Try fallback tier
    const fallback = FALLBACK_TIER[currentTier]
    if (fallback) {
      log.warn('Falling back to higher tier', { userId, from: currentTier, to: fallback })
      currentTier = fallback
    } else {
      break
    }
  }

  throw lastError || new Error('AI execution failed after all retries')
}

export { run }
