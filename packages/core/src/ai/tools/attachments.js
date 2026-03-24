/**
 * Session attachment tools.
 * The model calls get_attachment when it needs to see a file.
 * Uses toModelOutput to return multimodal content (images, PDFs)
 * that the model can actually see.
 */
import { z } from 'zod'
import { tool } from 'ai'
import * as repos from '@bot/db/src/repositories/index.js'
import { createLogger } from '@bot/shared/src/logger.js'

const fileRepo = repos.files
const attachRepo = repos.attachments

const log = createLogger('tools-attachments')

function create(userId, sessionId) {
  return {
    get_attachment: tool({
      description: 'Lee un archivo que el usuario compartió en esta conversación. Úsalo cuando necesites ver el contenido de una imagen, PDF u otro documento para responder una pregunta del usuario.',
      parameters: z.object({
        filename: z.string().describe('Nombre del archivo a leer (de la lista de archivos en esta sesión)'),
      }),
      execute: async ({ filename }) => {
        const attachments = await attachRepo.findBySession(sessionId)
        const att = attachments.find(a => a.filename === filename)
        if (!att) {
          return { error: `Archivo "${filename}" no encontrado en esta sesión. Archivos disponibles: ${attachments.map(a => a.filename).join(', ') || 'ninguno'}` }
        }

        const fileData = await fileRepo.get(userId, filename)
        if (!fileData?.content) {
          return { error: `No se pudo leer el archivo "${filename}"` }
        }

        const buf = Buffer.isBuffer(fileData.content)
          ? fileData.content
          : Buffer.from(fileData.content)

        log.info('Attachment loaded', { userId, filename, size: buf.length, mime: att.mime_type })

        return {
          filename,
          mimeType: att.mime_type,
          isImage: att.is_image,
          data: buf.toString('base64'),
        }
      },

      // Convert tool result to multimodal content the model can see
      toModelOutput({ output }) {
        if (output.error) {
          return { type: 'content', value: [{ type: 'text', text: output.error }] }
        }

        if (output.isImage) {
          return {
            type: 'content',
            value: [{ type: 'media', data: output.data, mediaType: output.mimeType }],
          }
        }

        // PDF and other files
        return {
          type: 'content',
          value: [{ type: 'media', data: output.data, mediaType: output.mimeType }],
        }
      },
    }),
  }
}

export { create }
