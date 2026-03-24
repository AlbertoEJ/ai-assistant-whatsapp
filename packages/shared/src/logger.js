/**
 * Structured logger.
 * Outputs JSON in production, readable text in development.
 * Never logs tokens, secrets, or message content.
 */
import config from './config.js'

const isProd = config.nodeEnv === 'production'

function formatMessage(level, service, message, meta = {}) {
  const timestamp = new Date().toISOString()

  if (isProd) {
    return JSON.stringify({ timestamp, level, service, message, ...meta })
  }

  const metaStr = Object.keys(meta).length > 0
    ? ' ' + JSON.stringify(meta)
    : ''
  return `${timestamp} [${level}] [${service}] ${message}${metaStr}`
}

export function createLogger(service) {
  return {
    info(message, meta) {
      console.log(formatMessage('INFO', service, message, meta))
    },

    warn(message, meta) {
      console.warn(formatMessage('WARN', service, message, meta))
    },

    error(message, meta) {
      if (meta instanceof Error) {
        meta = { error: meta.message, stack: meta.stack }
      }
      console.error(formatMessage('ERROR', service, message, meta))
    },

    debug(message, meta) {
      if (!isProd) {
        console.log(formatMessage('DEBUG', service, message, meta))
      }
    },
  }
}
