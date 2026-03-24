/**
 * File content extractor.
 * Converts any supported file format to text that the AI model can understand.
 *
 * Strategy:
 *   PDF, Images     → send as multimodal binary (Gemini reads natively)
 *   Office docs     → extract text with officeparser (preserves structure)
 *   Text files      → read as UTF-8 string
 *   Unknown         → attempt text read, fallback to "unsupported format"
 */
import { createLogger } from '@bot/shared/src/logger.js'

const log = createLogger('file-extractor')

/** Formats that Gemini can read as binary multimodal content. */
const NATIVE_MULTIMODAL = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/mp4',
  'video/mp4', 'video/webm',
])

/** Formats that are plain text — read directly as string. */
const TEXT_FORMATS = new Set([
  'text/plain', 'text/csv', 'text/html', 'text/xml', 'text/markdown',
  'application/json', 'application/xml',
])

/** File extensions for text-based formats. */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.csv', '.html', '.htm', '.xml', '.md', '.json', '.yaml', '.yml',
  '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.css', '.sql', '.sh',
  '.env', '.log', '.ini', '.toml', '.conf',
])

/** Office formats that officeparser handles. */
const OFFICE_EXTENSIONS = new Set([
  '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.rtf',
])

/**
 * Determine how to handle a file based on its mime type and filename.
 *
 * @returns {{ mode: 'multimodal' | 'text' | 'office' | 'unsupported', mime: string }}
 */
function classifyFile(filename, mimeType) {
  const ext = getExtension(filename)

  // Fix mime type from filename if Telegram reports octet-stream
  let mime = mimeType || 'application/octet-stream'
  if (mime === 'application/octet-stream') {
    mime = mimeFromExtension(ext) || mime
  }

  // Strip parameters from MIME type (e.g., "audio/ogg; codecs=opus" → "audio/ogg")
  const baseMime = mime.split(';')[0].trim()

  if (NATIVE_MULTIMODAL.has(baseMime)) return { mode: 'multimodal', mime: baseMime }
  if (TEXT_FORMATS.has(mime) || TEXT_EXTENSIONS.has(ext)) return { mode: 'text', mime }
  if (OFFICE_EXTENSIONS.has(ext)) return { mode: 'office', mime }

  return { mode: 'unsupported', mime }
}

/**
 * Extract text content from an office document (docx, xlsx, pptx, etc.)
 *
 * @param {Buffer} buffer - File content
 * @param {string} filename - For logging
 * @returns {Promise<string>} Extracted text with structure preserved
 */
async function extractOfficeText(buffer, filename) {
  try {
    const officeParser = (await import('officeparser')).default
    const ast = await officeParser.parseOffice(buffer)
    const text = ast.toText()

    if (!text || text.trim().length === 0) {
      return '[Documento vacío o sin texto extraíble]'
    }

    log.info('Office text extracted', { filename, chars: text.length })
    return text
  } catch (err) {
    log.error('Office extraction failed', { filename, error: err.message })
    return `[Error al extraer texto de ${filename}: ${err.message}]`
  }
}

/**
 * Extract readable content from a file buffer.
 * Returns either a multimodal part (for PDFs/images) or text string (for everything else).
 *
 * @param {Buffer} buffer - File content
 * @param {string} filename
 * @param {string} mimeType
 * @returns {Promise<{ type: 'multimodal', part: Object } | { type: 'text', content: string }>}
 */
async function extract(buffer, filename, mimeType) {
  const { mode, mime } = classifyFile(filename, mimeType)

  switch (mode) {
    case 'multimodal': {
      const base64 = buffer.toString('base64')
      if (mime.startsWith('image/')) {
        return { type: 'multimodal', part: { type: 'image', image: base64 } }
      }
      return { type: 'multimodal', part: { type: 'file', mediaType: mime, data: base64 } }
    }

    case 'text': {
      const text = buffer.toString('utf-8')
      return { type: 'text', content: `[Contenido de "${filename}"]\n${text}` }
    }

    case 'office': {
      const text = await extractOfficeText(buffer, filename)
      return { type: 'text', content: `[Contenido de "${filename}"]\n${text}` }
    }

    default:
      return { type: 'text', content: `[Formato no soportado: ${filename} (${mime}). Envía como PDF, imagen, o texto plano.]` }
  }
}

function getExtension(filename) {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

function mimeFromExtension(ext) {
  const map = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
    '.txt': 'text/plain', '.csv': 'text/csv',
    '.html': 'text/html', '.htm': 'text/html',
    '.xml': 'text/xml', '.json': 'application/json',
    '.md': 'text/markdown',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.odt': 'application/vnd.oasis.opendocument.text',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.odp': 'application/vnd.oasis.opendocument.presentation',
    '.rtf': 'application/rtf',
    '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.webm': 'audio/webm',
    '.m4a': 'audio/mp4',
    '.mp4': 'video/mp4',
  }
  return map[ext] || null
}

export { extract, classifyFile }
