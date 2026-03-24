/**
 * Cron job executor.
 * Processes scheduled tasks by running them through the AI pipeline.
 */
import { ai, permissions } from '@bot/core/src/index.js'
import { channels as channelRepo, crons as cronRepo, integrations as intRepo } from '@bot/db/src/repositories/index.js'
import { publish } from '@bot/shared/src/events.js'
import { createLogger } from '@bot/shared/src/logger.js'

const log = createLogger('cron-executor')

const { runner: aiRunner } = ai

/**
 * Execute a cron job.
 */
async function execute(data) {
  const { cronId, userId, orgId, userName, plan, timezone, prompt, isOnce } = data

  log.info('Executing cron', { cronId, userId, prompt: prompt.slice(0, 50) })

  try {
    const allowedTools = permissions.getAllowedTools(plan)

    // Load active integrations so the AI has access to Google/Microsoft tools
    const userIntegrations = await intRepo.findByUser(userId)
    const activeProviders = userIntegrations.map(i => i.provider)

    const result = await aiRunner.run({
      userId,
      userName,
      prompt,
      allowedTools,
      history: [],
      options: {
        forceTier: 'standard',
        activeProviders,
        plan,
        timezone,
      },
    })

    if (result.text && !result.text.includes('[NADA]')) {
      const channel = await channelRepo.findLastActiveForUser(userId)
      if (channel) {
        await publish('outgoing_message', {
          userId,
          channelId: channel.id,
          platform: channel.platform,
          text: result.text,
          buttons: [],
          files: [],
        })
      }
    }

    // Deactivate one-time crons (skip for heartbeat which uses non-UUID id)
    if (isOnce && cronId && cronId !== 'heartbeat') {
      await cronRepo.deactivate(cronId)
      log.info('One-time cron deactivated', { cronId })
    }

    log.info('Cron executed', { cronId, userId, model: result.model })
  } catch (err) {
    log.error('Cron execution failed', { cronId, userId, error: err.message })
  }
}

export { execute }
