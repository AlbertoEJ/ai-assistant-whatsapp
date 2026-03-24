/**
 * File system tools — sandboxed via user_files table.
 * NO real filesystem access. Everything goes through PostgreSQL.
 */
import { z } from 'zod'
import { tool } from 'ai'
import * as repos from '@bot/db/src/repositories/index.js'

const fileRepo = repos.files

function create(userId) {
  return {
    read_file: tool({
      description: 'Lee un archivo del usuario. Devuelve el contenido como texto.',
      parameters: z.object({
        filename: z.string().describe('Nombre del archivo a leer'),
      }),
      execute: async ({ filename }) => {
        const file = await fileRepo.get(userId, filename)
        if (!file) return { error: `Archivo "${filename}" no encontrado` }
        return {
          filename: file.filename,
          content: file.content ? file.content.toString('utf-8') : '',
          mimeType: file.mime_type,
          sizeBytes: file.size_bytes,
        }
      },
    }),

    write_file: tool({
      description: 'Escribe o crea un archivo para el usuario.',
      parameters: z.object({
        filename: z.string().describe('Nombre del archivo'),
        content: z.string().describe('Contenido del archivo'),
      }),
      execute: async ({ filename, content }) => {
        const buf = Buffer.from(content, 'utf-8')
        const result = await fileRepo.upsert({
          userId,
          filename,
          content: buf,
          mimeType: 'text/plain',
        })
        return { success: true, filename: result.filename, sizeBytes: result.size_bytes }
      },
    }),

    list_files: tool({
      description: 'Lista los archivos del usuario.',
      parameters: z.object({}),
      execute: async () => {
        const files = await fileRepo.list(userId)
        if (files.length === 0) return { files: [], message: 'No hay archivos' }
        return {
          files: files.map(f => ({
            filename: f.filename,
            mimeType: f.mime_type,
            sizeBytes: f.size_bytes,
            createdAt: f.created_at,
          })),
        }
      },
    }),
  }
}

export { create }
