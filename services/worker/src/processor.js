/**
 * Message processor — the main pipeline.
 *
 * Flow: billing check → session → history → context → AI → tags → response
 */
import { ai, tags, billing, permissions } from '@bot/core/src/index.js'
import { channels as channelRepo, usage as usageRepo, audit as auditRepo, files as fileRepo, attachments as attachRepo, integrations as intRepo } from '@bot/db/src/repositories/index.js'
import { extract as extractFile } from '@bot/core/src/files/extractor.js'
import { publish } from '@bot/shared/src/events.js'
import { createLogger } from '@bot/shared/src/logger.js'
import { getOrCreate, checkRotation, loadHistory, saveMessage } from './session-manager.js'
import { estimateCost } from '@bot/core/src/ai/router.js'
import { crons as cronRepo } from '@bot/db/src/repositories/index.js'

const log = createLogger('processor')

const { runner: aiRunner } = ai

/**
 * Process an incoming message job.
 *
 * @param {Object} data - Job data from BullMQ
 * @param {string} data.userId
 * @param {string} data.channelId
 * @param {string} data.platform
 * @param {string} data.orgId
 * @param {string} data.userName
 * @param {string} data.plan
 * @param {string} data.text
 * @param {Object[]} data.files
 */
async function process(data) {
  const { userId, channelId, platform, orgId, userName, plan, timezone, text, files = [] } = data
  const startTime = Date.now()

  // Load user's active integrations (determines which tools are available)
  const userIntegrations = await intRepo.findByUser(userId)
  const activeProviders = userIntegrations.map(i => i.provider)

  log.info('Processing message', { userId, platform, textLength: text?.length })

  // 1. Billing check
  const billingCheck = await billing.canSendMessage(orgId)
  if (!billingCheck.allowed) {
    await publishResponse(userId, channelId, platform, billingCheck.reason)
    return
  }

  // Warn at 80% usage
  if (await billing.isNearLimit(orgId) && !billingCheck.isOverage) {
    const remaining = billingCheck.limit - billingCheck.used
    await publishResponse(userId, channelId, platform,
      `⚠️ Te quedan ${remaining} mensajes en tu plan este mes.`)
  }

  // 2. Get session
  let prompt = text || ''
  const allowedTools = permissions.getAllowedTools(plan)
  let session = await getOrCreate(userId, channelId)
  session = await checkRotation(userId, session, userName, allowedTools)

  // 3. Register new files as session attachments
  // Files are already saved to disk by the router. Here we only register
  // them as session attachments so the model knows they exist.
  // The model uses get_attachment tool to read them when needed.
  const multimodalParts = []

  // Track new files to register as attachments AFTER the AI responds
  const pendingAttachments = []

  for (const file of files) {
    const fileData = await fileRepo.get(userId, file.name)
    if (!fileData?.content) continue

    const buf = Buffer.isBuffer(fileData.content) ? fileData.content : Buffer.from(fileData.content)
    const extracted = await extractFile(buf, file.name, file.mimeType)

    const isImage = extracted.type === 'multimodal' && extracted.part?.type === 'image'
    const mime = file.mimeType || 'application/octet-stream'
    pendingAttachments.push({
      filename: file.name,
      mimeType: mime,
      isImage,
      textContent: extracted.type === 'text' ? extracted.content : null,
    })

    if (extracted.type === 'multimodal') {
      multimodalParts.push(extracted.part)
    } else if (extracted.type === 'text') {
      // Office/text files: include extracted text in prompt
      prompt = extracted.content + '\n\n' + prompt
    }
  }

  // 4. For follow-ups: re-include session attachments
  if (pendingAttachments.length === 0 && prompt.trim()) {
    const attachments = await attachRepo.findBySession(session.id)
    for (const att of attachments) {
      if (att.text_content) {
        // Office/text files: include cached extracted text (cheap)
        prompt = att.text_content + '\n\n' + prompt
      } else {
        // PDFs/images: re-send binary (Gemini reads natively)
        const fileData = await fileRepo.get(userId, att.filename)
        if (!fileData?.content) continue

        const buf = Buffer.isBuffer(fileData.content) ? fileData.content : Buffer.from(fileData.content)
        const extracted = await extractFile(buf, att.filename, att.mime_type)

        if (extracted.type === 'multimodal') {
          multimodalParts.push(extracted.part)
        }
      }
    }
  }

  if (!prompt.trim() && multimodalParts.length === 0) return
  // Detect audio parts (used for routing and prompt)
  const hasAudio = multimodalParts.some(p => p.type === 'file' && (p.mediaType?.startsWith('audio/') || p.mediaType?.startsWith('video/')))

  // Block audio on free plan
  if (hasAudio && plan === 'free') {
    await publishResponse(userId, channelId, platform,
      'Los mensajes de voz están disponibles en los planes de pago. Actualiza tu plan para enviar audios.')
    return
  }

  if (!prompt.trim() && multimodalParts.length > 0) {
    if (hasAudio) {
      prompt = 'El usuario envió un mensaje de voz. Transcríbelo y responde a lo que dice. Si no tiene instrucciones claras, responde al contenido.'
    } else {
      prompt = 'El usuario envió un archivo. Descríbelo brevemente y pregunta qué quiere hacer con él.'
    }
  }

  // 5. Load conversation history
  const history = await loadHistory(session.id)

  // 6. Save user message
  await saveMessage(session.id, userId, {
    role: 'user',
    content: prompt,
  })

  // 7. Run AI (sessionId passed for get_attachment tool and prompt builder)
  // Send typing indicator every 4s while AI processes (Telegram typing expires after 5s)
  const typingInterval = setInterval(() => {
    publish('typing', { userId, channelId, platform }).catch(() => {})
  }, 4000)
  publish('typing', { userId, channelId, platform }).catch(() => {})

  try {
    const result = await aiRunner.run({
      userId,
      userName,
      prompt,
      allowedTools,
      history,
      multimodalParts,
      sessionId: session.id,
      options: { hasFiles: files.length > 0, hasAudio, activeProviders, plan, timezone },
    })

    // 7. Handle empty text with tool calls
    // When the model calls a tool (create_pdf, get_attachment, etc.) it sometimes
    // doesn't generate text. Build a response from tool results.
    let responseText = result.text
    if (!responseText && result.toolCalls?.length > 0) {
      const toolMessages = []
      for (const tc of result.toolCalls) {
        if (tc.result?.success) {
          toolMessages.push(tc.result.message || `Herramienta ${tc.toolName} ejecutada exitosamente.`)
        } else if (tc.result?.error) {
          toolMessages.push(`Error en ${tc.toolName}: ${tc.result.error}`)
        }
      }
      responseText = toolMessages.join('\n') || 'Listo.'
    }

    // 8. Parse tags from response
    const parsed = tags.parse(responseText)

    // 9. Save AI response messages (preserves tool calls + results for multi-turn)
    // Use responseMessages from AI SDK which has proper tool-call/tool-result pairing
    if (result.responseMessages?.length) {
      for (const msg of result.responseMessages) {
        const isToolCall = msg.role === 'assistant' && Array.isArray(msg.content)
          && msg.content.some(p => p.type === 'tool-call')
        const isToolResult = msg.role === 'tool'

        await saveMessage(session.id, userId, {
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content
            : msg.role === 'assistant' && !isToolCall ? (msg.content?.[0]?.text || responseText)
            : JSON.stringify(msg.content),
          toolCalls: isToolCall
            ? msg.content.filter(p => p.type === 'tool-call').map(p => ({
                toolCallId: p.toolCallId, toolName: p.toolName, args: p.args,
              }))
            : null,
          toolResult: isToolResult
            ? msg.content : null,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          model: result.model,
        })
      }
    } else {
      await saveMessage(session.id, userId, {
        role: 'assistant', content: responseText,
        tokensIn: result.tokensIn, tokensOut: result.tokensOut, model: result.model,
      })
    }

    // 9. Track usage
    const cost = estimateCost(
      result.tier, result.tokensIn, result.tokensOut
    )
    await billing.incrementUsage(orgId)
    await usageRepo.track({
      orgId,
      userId,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: cost,
    })

    // 10. Publish response
    await publishResponse(userId, channelId, platform, parsed.cleaned, {
      buttons: parsed.buttons,
      files: parsed.files,
      crons: parsed.crons,
    })

    // 11. Register pending attachments (after AI responded, for future follow-ups)
    for (const att of pendingAttachments) {
      await attachRepo.add({
        sessionId: session.id,
        userId,
        filename: att.filename,
        mimeType: att.mimeType,
        textContent: att.textContent,
        isImage: att.isImage,
      })
    }

    // 12. Process cron tags
    if (parsed.crons.length > 0) {
      for (const cron of parsed.crons) {
        await cronRepo.create({
          userId,
          schedule: cron.schedule,
          prompt: cron.prompt,
          isOnce: cron.isOnce,
        })
        log.info('Cron created from tag', { userId, schedule: cron.schedule })
      }
    }

    // 12. Audit
    await auditRepo.log({
      orgId,
      userId,
      action: 'message',
      detail: prompt.slice(0, 200),
      metadata: {
        model: result.model,
        tier: result.tier,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        durationMs: Date.now() - startTime,
      },
    })

    log.info('Message processed', {
      userId, model: result.model,
      durationMs: Date.now() - startTime,
    })
  } catch (err) {
    log.error('Processing failed', { userId, error: err.message })
    await publishResponse(userId, channelId, platform,
      `Error: ${err.message.slice(0, 300)}. Intenta de nuevo o escribe /clear.`)
  } finally {
    clearInterval(typingInterval)
  }
}

async function publishResponse(userId, channelId, platform, text, extras = {}) {
  if (!text && !extras.files?.length) return

  await publish('outgoing_message', {
    userId,
    channelId,
    platform,
    text: text || '',
    buttons: extras.buttons || [],
    files: extras.files || [],
  })
}

export { process }
