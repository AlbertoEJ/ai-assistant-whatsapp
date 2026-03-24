/**
 * Worker service entry point.
 * Consumes ai_jobs and cron_jobs from BullMQ queues.
 */
import 'dotenv/config'

import { createLogger } from '@bot/shared/src/logger.js'
import { createWorker } from '@bot/shared/src/queue.js'
import { config } from '@bot/shared/src/index.js'
import { process as processMessage } from './processor.js'
import { execute } from './cron-executor.js'
import { start as startHeartbeat, stop as stopHeartbeat } from './heartbeat.js'
import { flushSession } from './session-manager.js'

const log = createLogger('worker')

// AI job worker
const aiWorker = createWorker('ai_jobs', async (job) => {
  if (job.name === 'flush_session') return flushSession(job.data)
  return processMessage(job.data)
}, { concurrency: config.maxConcurrentGlobal })

// Cron job worker
const cronWorker = createWorker('cron_jobs', async (job) => {
  return execute(job.data)
}, { concurrency: 2 })

// Start heartbeat scheduler
startHeartbeat()

// Graceful shutdown
async function shutdown() {
  log.info('Shutting down worker...')
  stopHeartbeat()
  await aiWorker.close()
  await cronWorker.close()
  log.info('Worker stopped')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

log.info('Worker started', {
  aiConcurrency: config.maxConcurrentGlobal,
  cronConcurrency: 2,
})
