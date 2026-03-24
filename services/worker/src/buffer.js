/**
 * Message buffer.
 * Accumulates rapid messages from the same user within a time window
 * before processing them as a single prompt.
 */

const BUFFER_MS = 1500
const buffers = new Map()

/** Optional logger — set via setLogger() to avoid hard dependency. */
let log = { debug() {} }

function setLogger(logger) {
  log = logger
}

/**
 * Add a message to the buffer. Returns a promise that resolves
 * when the buffer window closes with all accumulated messages.
 *
 * @param {string} userId
 * @param {Object} message - { text, files }
 * @returns {Promise<{ texts: string[], files: Object[] } | null>}
 */
function accumulate(userId, message) {
  return new Promise((resolve) => {
    if (!buffers.has(userId)) {
      buffers.set(userId, {
        texts: [],
        files: [],
        resolve: null,
        timer: null,
      })
    }

    const buf = buffers.get(userId)

    if (message.text) buf.texts.push(message.text)
    if (message.files?.length) buf.files.push(...message.files)

    if (!buf.resolve) {
      buf.resolve = resolve
    } else {
      resolve(null)
    }

    if (buf.timer) clearTimeout(buf.timer)

    buf.timer = setTimeout(() => {
      const accumulated = buffers.get(userId)
      buffers.delete(userId)

      if (accumulated?.resolve) {
        log.debug('Buffer flush', { userId, texts: accumulated.texts.length, files: accumulated.files.length })
        accumulated.resolve({
          texts: accumulated.texts,
          files: accumulated.files,
        })
      }
    }, BUFFER_MS)
  })
}

function hasPending(userId) {
  return buffers.has(userId)
}

function clear(userId) {
  const buf = buffers.get(userId)
  if (buf) {
    if (buf.timer) clearTimeout(buf.timer)
    if (buf.resolve) buf.resolve(null)
    buffers.delete(userId)
  }
}

export { accumulate, hasPending, clear, setLogger }
