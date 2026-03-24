/**
 * Redis Pub/Sub event bus for inter-service communication.
 */
import Redis from 'ioredis'
import config from './config.js'
import { createLogger } from './logger.js'

const log = createLogger('events')

let publisher = null
let subscriber = null

function getPublisher() {
  if (!publisher) {
    publisher = new Redis(config.redisUrl)
    publisher.on('error', (err) => log.error('Redis publisher error', err))
  }
  return publisher
}

function getSubscriber() {
  if (!subscriber) {
    subscriber = new Redis(config.redisUrl)
    subscriber.on('error', (err) => log.error('Redis subscriber error', err))
  }
  return subscriber
}

export async function publish(channel, data) {
  const msg = JSON.stringify(data)
  await getPublisher().publish(channel, msg)
  log.debug(`Published to ${channel}`, { channel })
}

export function subscribe(channel, handler) {
  const sub = getSubscriber()
  sub.subscribe(channel)
  sub.on('message', async (ch, message) => {
    if (ch !== channel) return
    try {
      const data = JSON.parse(message)
      await handler(data)
    } catch (err) {
      log.error(`Error handling event on ${channel}`, err)
    }
  })
  log.info(`Subscribed to ${channel}`)
}

export async function close() {
  if (publisher) { await publisher.quit(); publisher = null }
  if (subscriber) { await subscriber.quit(); subscriber = null }
}
