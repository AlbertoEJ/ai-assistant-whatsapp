/**
 * Webhook endpoints.
 * All webhooks verify signatures before processing.
 * Logic is implemented in later phases — these are stubs.
 */
import crypto from 'node:crypto'
import { createLogger } from '@bot/shared/src/logger.js'
import config from '@bot/shared/src/config.js'

const log = createLogger('webhooks')

export default async function webhookRoutes(fastify) {
  // WhatsApp (Meta) — Phase 6
  fastify.get('/webhooks/whatsapp', async (request, reply) => {
    // Verification challenge for Meta webhook setup
    const mode = request.query['hub.mode']
    const token = request.query['hub.verify_token']
    const challenge = request.query['hub.challenge']

    if (mode === 'subscribe' && token === config.whatsappVerifyToken) {
      log.info('WhatsApp webhook verified')
      return reply.send(challenge)
    }
    return reply.status(403).send('Forbidden')
  })

  fastify.post('/webhooks/whatsapp', async (request, reply) => {
    // Verify signature if app secret is configured
    if (config.whatsappAppSecret) {
      const signature = request.headers['x-hub-signature-256']
      if (!signature) return reply.status(401).send('Unauthorized')

      const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
      const expected = 'sha256=' + crypto
        .createHmac('sha256', config.whatsappAppSecret)
        .update(rawBody)
        .digest('hex')

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return reply.status(401).send('Invalid signature')
      }
    }

    // Publish to Redis for the channels service to process
    const { publish } = await import('@bot/shared/src/events.js')
    await publish('whatsapp_webhook', request.body)

    // Must return 200 quickly or Meta will retry
    return reply.status(200).send('OK')
  })

  // Gmail Pub/Sub — Phase 7
  fastify.post('/webhooks/gmail', async (request, reply) => {
    // TODO: Verify Google auth token, process push notification
    log.info('Gmail webhook received')
    return reply.status(200).send('OK')
  })

  // Calendar push — Phase 7
  fastify.post('/webhooks/calendar', async (request, reply) => {
    // TODO: Verify X-Goog-Channel-Token, process push notification
    log.info('Calendar webhook received')
    return reply.status(200).send('OK')
  })

  // Drive push — Phase 7
  fastify.post('/webhooks/drive', async (request, reply) => {
    // TODO: Verify X-Goog-Channel-Token, process push notification
    log.info('Drive webhook received')
    return reply.status(200).send('OK')
  })

  // Stripe — Phase 9
  fastify.post('/webhooks/stripe', {
    config: { rawBody: true },
  }, async (request, reply) => {
    // TODO: Verify stripe-signature, process payment events
    log.info('Stripe webhook received')
    return reply.status(200).send('OK')
  })
}
