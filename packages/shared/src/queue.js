/**
 * BullMQ job queue wrapper.
 *
 * Production requirements (per BullMQ docs):
 *   - Redis: maxmemory-policy=noeviction, appendonly=yes
 *   - Worker connections: maxRetriesPerRequest=null
 *   - Queue connections: enableOfflineQueue=false (fail fast)
 */
import { Queue, Worker } from 'bullmq'
import Redis from 'ioredis'
import config from './config.js'
import { createLogger } from './logger.js'

const log = createLogger('queue')

function createWorkerConnection() {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      return Math.max(Math.min(Math.exp(times), 20000), 1000)
    },
  })
}

function createQueueConnection() {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    retryStrategy(times) {
      return Math.max(Math.min(Math.exp(times), 20000), 1000)
    },
  })
}

export function createQueue(name) {
  const queue = new Queue(name, {
    connection: createQueueConnection(),
    defaultJobOptions: {
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
      attempts: 2,
      backoff: { type: 'exponential', delay: 1000 },
    },
  })

  queue.on('error', (err) => {
    log.error(`Queue error: ${name}`, err)
  })

  log.info(`Queue created: ${name}`)
  return queue
}

export function createWorker(queueName, processor, opts = {}) {
  const worker = new Worker(queueName, processor, {
    connection: createWorkerConnection(),
    concurrency: opts.concurrency || 1,
    ...opts,
  })

  worker.on('completed', (job) => {
    log.debug(`Job completed: ${queueName}/${job.id}`)
  })

  worker.on('failed', (job, err) => {
    log.error(`Job failed: ${queueName}/${job?.id}`, err)
  })

  worker.on('error', (err) => {
    log.error(`Worker error: ${queueName}`, err)
  })

  log.info(`Worker started: ${queueName} (concurrency: ${opts.concurrency || 1})`)
  return worker
}
