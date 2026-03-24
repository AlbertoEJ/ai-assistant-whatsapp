/**
 * Tag parser — extracts special tags from AI responses.
 *
 * Tags:
 *   [CREATE_CRON:schedule|prompt]       → scheduled task
 *   [CREATE_CRON_ONCE:schedule|prompt]  → one-time task
 *   [SEND_FILE:filename]               → send file to user
 *   [BUTTONS:opt1|opt2|opt3]           → interactive buttons
 */

const CRON_REGEX = /\[CREATE_CRON(?:_(ONCE))?:(.+?)\|(.+?)\]/g
const FILE_REGEX = /\[SEND_FILE:(.+?)\]/g
const BUTTON_REGEX = /\[BUTTONS:(.+?)\]/g

/**
 * Parse all tags from AI response text.
 * Returns extracted data and cleaned text.
 */
function parse(text) {
  if (!text) return { cleaned: '', crons: [], files: [], buttons: [] }

  const crons = []
  const files = []
  let buttons = []

  // Extract crons
  let match
  while ((match = CRON_REGEX.exec(text)) !== null) {
    crons.push({
      isOnce: match[1] === 'ONCE',
      schedule: match[2].trim(),
      prompt: match[3].trim(),
    })
  }

  // Extract files
  while ((match = FILE_REGEX.exec(text)) !== null) {
    files.push({ filename: match[1].trim() })
  }

  // Extract buttons (only last match, to avoid duplicates)
  while ((match = BUTTON_REGEX.exec(text)) !== null) {
    buttons = match[1].split('|').map(b => b.trim()).filter(Boolean)
  }

  // Clean tags from response
  let cleaned = text
    .replace(CRON_REGEX, '')
    .replace(FILE_REGEX, '')
    .replace(BUTTON_REGEX, '')
    .trim()

  return { cleaned, crons, files, buttons }
}

/**
 * Check if text contains any tags.
 */
function hasTags(text) {
  if (!text) return false
  return CRON_REGEX.test(text) || FILE_REGEX.test(text) || BUTTON_REGEX.test(text)
}

export { parse, hasTags }
