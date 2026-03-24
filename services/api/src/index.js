/**
 * API service entry point.
 * Handles webhooks for WhatsApp and integration OAuth callbacks.
 */
import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import config from '@bot/shared/src/config.js'
import { createLogger } from '@bot/shared/src/logger.js'

// Routes
import healthRoutes from './routes/health.js'
import integrationRoutes from './routes/integrations.js'
import webhookRoutes from './webhooks/index.js'

const log = createLogger('api')

const fastify = Fastify({
  logger: config.nodeEnv === 'production',
})

// CORS
await fastify.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
})

// Register routes
await fastify.register(healthRoutes)
await fastify.register(integrationRoutes)
await fastify.register(webhookRoutes)

// Start server
try {
  await fastify.listen({ port: config.apiPort, host: '0.0.0.0' })
  log.info('API service started', { port: config.apiPort })
} catch (err) {
  log.error('Failed to start API', err)
  process.exit(1)
}

// Graceful shutdown
async function shutdown() {
  log.info('Shutting down API...')
  await fastify.close()
  log.info('API stopped')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
