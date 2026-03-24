/**
 * Base channel adapter interface.
 * All platform adapters (Telegram, WhatsApp, etc.) must implement these methods.
 *
 * Each method receives platform-specific IDs and data.
 * The adapter translates to/from the platform's native API.
 */

class BaseAdapter {
  constructor(name) {
    this.name = name
  }

  /** Send a text message. */
  async send(platformId, text, options = {}) {
    throw new Error(`${this.name}.send() not implemented`)
  }

  /** Send a file/document. */
  async sendFile(platformId, fileBuffer, filename, mimeType) {
    throw new Error(`${this.name}.sendFile() not implemented`)
  }

  /** Send typing indicator. */
  async sendTyping(platformId) {
    throw new Error(`${this.name}.sendTyping() not implemented`)
  }

  /** Edit a previously sent message. */
  async editMessage(platformId, messageId, text) {
    throw new Error(`${this.name}.editMessage() not implemented`)
  }

  /** Delete a previously sent message. */
  async deleteMessage(platformId, messageId) {
    throw new Error(`${this.name}.deleteMessage() not implemented`)
  }

  /** Start listening for incoming messages. */
  async start() {
    throw new Error(`${this.name}.start() not implemented`)
  }

  /** Stop listening and clean up. */
  async stop() {
    throw new Error(`${this.name}.stop() not implemented`)
  }
}

export default BaseAdapter
