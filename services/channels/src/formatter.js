/**
 * Message formatting utilities.
 * Platform-agnostic functions for splitting, buttons, etc.
 * No external dependencies — safe for unit testing.
 */

const TELEGRAM_MAX = 4000
const WHATSAPP_MAX = 4096

/**
 * Split a long message into parts at newline boundaries.
 */
function splitMessage(text, maxLen = TELEGRAM_MAX) {
  if (text.length <= maxLen) return [text]

  const parts = []
  let remaining = text

  while (remaining.length > 0) {
    let cut = remaining.lastIndexOf('\n', maxLen)
    if (cut <= 0) cut = maxLen
    parts.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut).trimStart()
  }

  return parts
}

/**
 * Build Telegram inline keyboard from button definitions.
 * Supports two formats:
 *   - Simple text: "Opción 1" → callback button
 *   - URL button: "url:Conectar Google|https://..." → opens link
 *   - Action button: "action:disconnect_google|Desconectar Google" → sends action to bot
 *
 * Rows of 2 buttons max.
 */
function buildInlineKeyboard(buttons) {
  const rows = []
  const parsedButtons = buttons.map(b => {
    if (b.startsWith('url:')) {
      const [label, url] = b.slice(4).split('|')
      return { text: label, url }
    }
    if (b.startsWith('action:')) {
      const [action, label] = b.slice(7).split('|')
      return { text: label || action, callback_data: `action:${action.slice(0, 55)}` }
    }
    return { text: b, callback_data: `btn:${b.slice(0, 60)}` }
  })

  for (let i = 0; i < parsedButtons.length; i += 2) {
    const row = [parsedButtons[i]]
    if (parsedButtons[i + 1]) row.push(parsedButtons[i + 1])
    rows.push(row)
  }

  return { inline_keyboard: rows }
}

export { splitMessage, buildInlineKeyboard, TELEGRAM_MAX, WHATSAPP_MAX }
