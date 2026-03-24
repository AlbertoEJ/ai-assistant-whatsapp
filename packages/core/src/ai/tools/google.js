/**
 * Google Workspace tools.
 * Uses googleapis SDK for direct HTTP calls.
 * Auth handled by integrations/google.js (auto-refresh tokens).
 */
import { z } from 'zod'
import { tool } from 'ai'
import { getClient, safeCall } from '../../integrations/google.js'
import { createLogger } from '@bot/shared/src/logger.js'

const log = createLogger('tools-google')

function create(userId, { timezone = 'UTC' } = {}) {
  return {
    // ========== GMAIL ==========
    gmail_search: tool({
      description: 'Busca emails en Gmail. Usa sintaxis de Gmail: from:email, subject:texto, is:unread, has:attachment, etc.',
      parameters: z.object({
        query: z.string().describe('Búsqueda Gmail (ej: "from:juan@mail.com", "is:unread", "subject:factura", "from:empresa has:attachment")'),
        maxResults: z.number().optional().describe('Máximo resultados (default 10)'),
      }),
      execute: async (args) => {
        let q = args.query || args.q || args.search
        if (!q) return { error: 'Se requiere query de búsqueda.' }

        // Auto-add from: if query looks like a bare email address
        if (q.includes('@') && !q.includes(':')) {
          q = `from:${q}`
        }

        const g = await getClient(userId)
        if (g.error) return { error: g.error }
        return safeCall(() => g.gmail.users.messages.list({
          userId: 'me', q, maxResults: args.maxResults || 10,
        }))
      },
    }),

    gmail_read: tool({
      description: 'Lee un email específico de Gmail. Devuelve asunto, remitente, cuerpo.',
      parameters: z.object({
        id: z.string().describe('ID del mensaje (de gmail_search results)'),
      }),
      execute: async ({ id }) => {
        if (!id) return { error: 'Se requiere id del mensaje' }
        const g = await getClient(userId)
        if (g.error) return { error: g.error }
        return safeCall(() => g.gmail.users.messages.get({
          userId: 'me', id, format: 'full',
        }))
      },
    }),

    gmail_send: tool({
      description: 'Envía un email desde Gmail. Puede incluir archivos adjuntos previamente descargados (usa el nombre exacto del archivo).',
      parameters: z.object({
        to: z.string().describe('Email del destinatario'),
        subject: z.string().describe('Asunto'),
        body: z.string().describe('Cuerpo del email'),
        attachments: z.array(z.string()).optional().describe('Lista de nombres de archivos previamente descargados para adjuntar'),
      }),
      execute: async ({ to, subject, body, attachments: fileNames }) => {
        const g = await getClient(userId)
        if (g.error) return { error: g.error }

        // Load attachment files if specified
        const files = []
        if (fileNames?.length > 0) {
          const { files: fileRepo } = await import('@bot/db/src/repositories/index.js')
          for (const name of fileNames) {
            const file = await fileRepo.get(userId, name)
            if (file?.content) {
              files.push({ filename: file.filename, mimeType: file.mime_type || 'application/octet-stream', content: file.content })
            }
          }
        }

        let mimeMessage
        if (files.length > 0) {
          const boundary = `boundary_${Date.now()}`
          mimeMessage = `To: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\n` +
            `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
            `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`
          for (const f of files) {
            const b64 = f.content.toString('base64')
            mimeMessage += `--${boundary}\r\n` +
              `Content-Type: ${f.mimeType}; name="${f.filename}"\r\n` +
              `Content-Disposition: attachment; filename="${f.filename}"\r\n` +
              `Content-Transfer-Encoding: base64\r\n\r\n` +
              `${b64}\r\n`
          }
          mimeMessage += `--${boundary}--`
        } else {
          mimeMessage = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
        }

        const raw = Buffer.from(mimeMessage).toString('base64url')
        const result = await safeCall(() => g.gmail.users.messages.send({
          userId: 'me', requestBody: { raw },
        }))
        if (result?.error) return result
        return { success: true, message: `Email enviado a ${to}${files.length > 0 ? ` con ${files.length} adjunto(s)` : ''}.` }
      },
    }),

    gmail_reply: tool({
      description: 'Responde a un email en Gmail.',
      parameters: z.object({
        id: z.string().describe('ID del mensaje al que responder'),
        threadId: z.string().describe('ID del hilo'),
        body: z.string().describe('Cuerpo de la respuesta'),
      }),
      execute: async ({ id, threadId, body }) => {
        const g = await getClient(userId)
        if (g.error) return { error: g.error }

        // Get original message for headers
        const original = await safeCall(() => g.gmail.users.messages.get({
          userId: 'me', id, format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Message-ID'],
        }))
        if (original.error) return original

        const headers = original.payload?.headers || []
        const from = headers.find(h => h.name === 'From')?.value || ''
        const subject = headers.find(h => h.name === 'Subject')?.value || ''
        const msgId = headers.find(h => h.name === 'Message-ID')?.value || ''

        const raw = Buffer.from(
          `To: ${from}\r\nSubject: Re: ${subject}\r\nIn-Reply-To: ${msgId}\r\nReferences: ${msgId}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
        ).toString('base64url')

        return safeCall(() => g.gmail.users.messages.send({
          userId: 'me', requestBody: { raw, threadId },
        }))
      },
    }),

    gmail_forward: tool({
      description: 'Reenvía un email de Gmail a otra dirección, incluyendo todos los adjuntos originales.',
      parameters: z.object({
        id: z.string().describe('ID del mensaje a reenviar'),
        to: z.string().describe('Email del destinatario'),
        comment: z.string().optional().describe('Comentario adicional al reenviar'),
      }),
      execute: async (args) => {
        const msgId = args.id || args.messageId || args.message_id
        if (!msgId) return { error: 'Se requiere ID del mensaje.' }

        const g = await getClient(userId)
        if (g.error) return { error: g.error }

        // Get full original message with metadata
        const original = await safeCall(() => g.gmail.users.messages.get({
          userId: 'me', id: msgId, format: 'full',
        }))
        if (original.error) return original

        const headers = original.payload?.headers || []
        const origFrom = headers.find(h => h.name === 'From')?.value || ''
        const origSubject = headers.find(h => h.name === 'Subject')?.value || ''
        const origDate = headers.find(h => h.name === 'Date')?.value || ''

        // Collect attachments
        const attachments = []
        const parts = original.payload?.parts || []
        for (const part of parts) {
          if (part.body?.attachmentId && part.filename) {
            const att = await safeCall(() => g.gmail.users.messages.attachments.get({
              userId: 'me', messageId: msgId, id: part.body.attachmentId,
            }))
            if (!att.error && att.data) {
              attachments.push({
                filename: part.filename,
                mimeType: part.mimeType || 'application/octet-stream',
                data: att.data, // base64url encoded
              })
            }
          }
        }

        // Build MIME multipart message
        const boundary = `boundary_${Date.now()}`
        const comment = args.comment ? args.comment + '\r\n\r\n' : ''
        const fwdHeader = `---------- Forwarded message ----------\r\nFrom: ${origFrom}\r\nDate: ${origDate}\r\nSubject: ${origSubject}\r\n\r\n`

        // Get original body text
        let origBody = ''
        if (original.payload?.body?.data) {
          origBody = Buffer.from(original.payload.body.data, 'base64url').toString('utf-8')
        } else {
          const textPart = parts.find(p => p.mimeType === 'text/plain')
          if (textPart?.body?.data) {
            origBody = Buffer.from(textPart.body.data, 'base64url').toString('utf-8')
          }
        }

        let mimeMessage = `To: ${args.to}\r\n` +
          `Subject: Fwd: ${origSubject}\r\n` +
          `MIME-Version: 1.0\r\n`

        if (attachments.length > 0) {
          mimeMessage += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
            `--${boundary}\r\n` +
            `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
            `${comment}${fwdHeader}${origBody}\r\n`

          for (const att of attachments) {
            // Convert base64url to standard base64
            const b64 = att.data.replace(/-/g, '+').replace(/_/g, '/')
            mimeMessage += `--${boundary}\r\n` +
              `Content-Type: ${att.mimeType}; name="${att.filename}"\r\n` +
              `Content-Disposition: attachment; filename="${att.filename}"\r\n` +
              `Content-Transfer-Encoding: base64\r\n\r\n` +
              `${b64}\r\n`
          }
          mimeMessage += `--${boundary}--`
        } else {
          mimeMessage += `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
            `${comment}${fwdHeader}${origBody}`
        }

        const raw = Buffer.from(mimeMessage).toString('base64url')
        const result = await safeCall(() => g.gmail.users.messages.send({
          userId: 'me', requestBody: { raw },
        }))
        if (result.error) return result
        return { success: true, message: `Email reenviado a ${args.to} con ${attachments.length} adjunto(s).` }
      },
    }),

    gmail_trash: tool({
      description: 'Mueve un email a la papelera.',
      parameters: z.object({
        id: z.string().describe('ID del mensaje (de gmail_search)'),
      }),
      execute: async (args) => {
        const id = args.id || args.messageId || args.message_id
        if (!id) return { error: 'Se requiere ID del mensaje.' }
        const g = await getClient(userId)
        if (g.error) return { error: g.error }
        const result = await safeCall(() => g.gmail.users.messages.trash({ userId: 'me', id }))
        if (result?.error) return result
        return { success: true, message: 'Email movido a la papelera.' }
      },
    }),

    gmail_mark_read: tool({
      description: 'Marca un email como leído.',
      parameters: z.object({
        id: z.string().describe('ID del mensaje (de gmail_search)'),
      }),
      execute: async (args) => {
        const id = args.id || args.messageId || args.message_id
        if (!id) return { error: 'Se requiere ID del mensaje.' }
        const g = await getClient(userId)
        if (g.error) return { error: g.error }
        const result = await safeCall(() => g.gmail.users.messages.modify({
          userId: 'me', id,
          requestBody: { removeLabelIds: ['UNREAD'] },
        }))
        if (result?.error) return result
        return { success: true, message: 'Email marcado como leído.' }
      },
    }),

    gmail_get_attachments: tool({
      description: 'Descarga los adjuntos de un email de Gmail. Devuelve el contenido del archivo para que puedas analizarlo o resumirlo.',
      parameters: z.object({
        id: z.string().describe('ID del mensaje que contiene los adjuntos'),
      }),
      execute: async (args) => {
        const msgId = args.id || args.messageId || args.message_id
        if (!msgId) return { error: 'Se requiere ID del mensaje.' }
        const g = await getClient(userId)
        if (g.error) return { error: g.error }

        // Get full message to find attachment parts
        const msg = await safeCall(() => g.gmail.users.messages.get({
          userId: 'me', id: msgId, format: 'full',
        }))
        if (msg.error) return msg

        const attachments = []
        const parts = msg.payload?.parts || []

        for (const part of parts) {
          if (part.body?.attachmentId && part.filename) {
            const att = await safeCall(() => g.gmail.users.messages.attachments.get({
              userId: 'me', messageId: msgId, id: part.body.attachmentId,
            }))
            if (att.error) continue

            // Save to user_files
            const buf = Buffer.from(att.data, 'base64url')
            const { files: fileRepo } = await import('@bot/db/src/repositories/index.js')
            await fileRepo.upsert({
              userId,
              filename: part.filename,
              content: buf,
              mimeType: part.mimeType || 'application/octet-stream',
            })

            attachments.push({
              filename: part.filename,
              mimeType: part.mimeType,
              sizeBytes: buf.length,
            })
          }
        }

        if (attachments.length === 0) {
          return { message: 'Este email no tiene adjuntos.' }
        }

        return {
          success: true,
          message: `${attachments.length} adjunto(s) descargado(s): ${attachments.map(a => a.filename).join(', ')}. Usa read_file para leerlos.`,
          attachments,
        }
      },
    }),

    // ========== CALENDAR ==========
    calendar_list: tool({
      description: 'Lista eventos del calendario del usuario.',
      parameters: z.object({
        timeMin: z.string().optional().describe('Fecha inicio (ISO 8601)'),
        timeMax: z.string().optional().describe('Fecha fin (ISO 8601)'),
        maxResults: z.number().optional().describe('Máximo resultados (default 10)'),
      }),
      execute: async ({ timeMin, timeMax, maxResults = 10 }) => {
        const g = await getClient(userId)
        if (g.error) return { error: g.error }
        return safeCall(() => g.calendar.events.list({
          calendarId: 'primary',
          timeMin: timeMin || new Date().toISOString(),
          timeMax,
          maxResults,
          singleEvents: true,
          orderBy: 'startTime',
        }))
      },
    }),

    calendar_create: tool({
      description: 'Crea un evento en el calendario. IMPORTANTE: siempre incluye hora en formato ISO 8601 completo (ej: 2026-03-24T08:00:00). Si no se especifica hora de fin, agrega 1 hora al inicio.',
      parameters: z.object({
        summary: z.string().describe('Título del evento'),
        start: z.string().describe('Fecha/hora inicio (ISO 8601 con hora, ej: 2026-03-24T08:00:00)'),
        end: z.string().optional().describe('Fecha/hora fin. Si no se proporciona, se agrega 1 hora al inicio.'),
        description: z.string().optional().describe('Descripción'),
        location: z.string().optional().describe('Ubicación del evento'),
        attendees: z.array(z.string()).optional().describe('Emails de invitados'),
        reminderMinutes: z.number().optional().describe('Recordatorio X minutos antes (ej: 60 para 1h, 30, 15, 10)'),
        recurrence: z.string().optional().describe('Recurrencia en formato RRULE (ej: "RRULE:FREQ=WEEKLY;BYDAY=MO" para todos los lunes)'),
      }),
      execute: async (args) => {
        // Accept alternative param names the model might use
        const summary = args.summary || args.title || 'Evento'
        const startInput = args.start || args.start_time || args.startTime
        const endInput = args.end || args.end_time || args.endTime
        const { description, location, attendees, recurrence } = args
        // Accept multiple reminder formats the model might use
        let reminderMinutes = args.reminderMinutes || args.reminder_minutes
        if (!reminderMinutes && args.reminders?.[0]?.minutes) {
          reminderMinutes = args.reminders[0].minutes
        }
        if (!reminderMinutes && typeof args.reminder === 'number') {
          reminderMinutes = args.reminder
        }

        if (!startInput) return { error: 'Se requiere fecha/hora de inicio del evento.' }
        let start = startInput
        let end = endInput
        try {
        const g = await getClient(userId)
        if (g.error) return { error: g.error }

        const isDateOnly = !start.includes('T')

        // Auto-generate end time if not provided
        if (!end && !isDateOnly) {
          // Add 1 hour to start — parse manually to avoid timezone conversion
          const match = start.match(/T(\d{2}):/)
          if (match) {
            const hour = parseInt(match[1]) + 1
            end = start.replace(/T\d{2}:/, `T${String(hour).padStart(2, '0')}:`)
          } else {
            end = start
          }
        } else if (!end && isDateOnly) {
          const d = new Date(start + 'T00:00:00')
          d.setDate(d.getDate() + 1)
          end = d.toISOString().split('T')[0]
        }

        // Don't normalize — pass as-is with timeZone. Google handles conversion.

        const event = {
          summary,
          start: isDateOnly ? { date: start } : { dateTime: start, timeZone: timezone },
          end: isDateOnly ? { date: end } : { dateTime: end, timeZone: timezone },
        }
        if (description) event.description = description
        if (location) event.location = location
        if (attendees?.length) event.attendees = attendees.map(email => ({ email }))
        if (reminderMinutes != null) {
          event.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: reminderMinutes }] }
        }
        if (recurrence) event.recurrence = [recurrence]

        const result = await safeCall(() => g.calendar.events.insert({
          calendarId: 'primary', requestBody: event,
        }))
        if (result.error) return result
        return {
          success: true,
          message: `Evento "${summary}" creado exitosamente.`,
          eventId: result.id,
          link: result.htmlLink,
          start: result.start?.dateTime || result.start?.date,
          end: result.end?.dateTime || result.end?.date,
        }
        } catch (err) {
          log.error('calendar_create exception', { userId, error: err.message, stack: err.stack?.slice(0, 200) })
          return { error: `Error al crear evento: ${err.message}` }
        }
      },
    }),

    calendar_update: tool({
      description: 'Modifica un evento existente del calendario de Google (mover horario, cambiar título, etc.).',
      parameters: z.object({
        eventId: z.string().describe('ID del evento a modificar'),
        summary: z.string().optional().describe('Nuevo título'),
        start: z.string().optional().describe('Nueva fecha/hora inicio (ISO 8601)'),
        end: z.string().optional().describe('Nueva fecha/hora fin (ISO 8601)'),
        description: z.string().optional().describe('Nueva descripción'),
        location: z.string().optional().describe('Nueva ubicación'),
      }),
      execute: async (args) => {
        const id = args.eventId || args.id || args.event_id
        if (!id) return { error: 'Se requiere eventId. Usa calendar_list primero para obtener el ID del evento.' }
        const g = await getClient(userId)
        if (g.error) return { error: g.error }

        const event = {}
        const title = args.summary || args.title || args.subject
        const start = args.start || args.start_time || args.startTime
        const end = args.end || args.end_time || args.endTime
        if (title) event.summary = title
        if (start) {
          const isDateOnly = !start.includes('T')
          event.start = isDateOnly ? { date: start } : { dateTime: start, timeZone: timezone }
        }
        if (end) {
          const isDateOnly = !end.includes('T')
          event.end = isDateOnly ? { date: end } : { dateTime: end, timeZone: timezone }
        }
        if (args.description) event.description = args.description
        if (args.location) event.location = args.location

        const result = await safeCall(() => g.calendar.events.patch({
          calendarId: 'primary', eventId: id, requestBody: event,
        }))
        if (result?.error) return result
        return { success: true, message: 'Evento actualizado en Google Calendar.', eventId: id }
      },
    }),

    calendar_delete: tool({
      description: 'Elimina un evento del calendario de Google.',
      parameters: z.object({
        eventId: z.string().describe('ID del evento a eliminar'),
      }),
      execute: async (args) => {
        const id = args.eventId || args.id || args.event_id
        if (!id) return { error: 'Se requiere eventId. Usa calendar_list para obtener el ID.' }
        const g = await getClient(userId)
        if (g.error) return { error: g.error }

        // For recurring events, delete the parent event (remove instance suffix)
        // Instance IDs look like: baseId_20260323T160000Z
        // To delete ALL instances, use the base ID
        const baseId = id.includes('_') ? id.split('_')[0] : id

        const result = await safeCall(() => g.calendar.events.delete({
          calendarId: 'primary', eventId: baseId,
        }))
        if (result?.error) return result
        return { success: true, message: 'Evento eliminado de Google Calendar.' }
      },
    }),

    // ========== DRIVE ==========
    drive_list: tool({
      description: 'Lista archivos en Google Drive del usuario.',
      parameters: z.object({
        query: z.string().optional().describe('Búsqueda (ej: "name contains \'reporte\'")'),
        maxResults: z.number().optional().describe('Máximo resultados (default 10)'),
      }),
      execute: async ({ query: q, maxResults = 10 }) => {
        const g = await getClient(userId)
        if (g.error) return { error: g.error }
        return safeCall(() => g.drive.files.list({
          pageSize: maxResults,
          q: q || undefined,
          fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)',
        }))
      },
    }),

    drive_search: tool({
      description: 'Busca archivos en Google Drive por nombre o contenido.',
      parameters: z.object({
        query: z.string().describe('Texto a buscar'),
      }),
      execute: async ({ query: q }) => {
        const g = await getClient(userId)
        if (g.error) return { error: g.error }
        return safeCall(() => g.drive.files.list({
          q: `fullText contains '${q.replace(/'/g, "\\'")}'`,
          pageSize: 10,
          fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)',
        }))
      },
    }),

    drive_download: tool({
      description: 'Descarga un archivo de Google Drive para que puedas analizarlo o resumirlo.',
      parameters: z.object({
        fileId: z.string().describe('ID del archivo (de drive_list o drive_search)'),
        fileName: z.string().optional().describe('Nombre del archivo'),
      }),
      execute: async (args) => {
        const id = args.fileId || args.id || args.file_id
        if (!id) return { error: 'Se requiere fileId.' }
        const g = await getClient(userId)
        if (g.error) return { error: g.error }

        try {
          // Get file metadata first
          const meta = await safeCall(() => g.drive.files.get({
            fileId: id, fields: 'name, mimeType, size',
          }))
          if (meta.error) return meta

          // Google Docs/Sheets/Slides need export, others download directly
          let buf
          const googleTypes = ['application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet', 'application/vnd.google-apps.presentation']
          const exportMime = {
            'application/vnd.google-apps.document': 'application/pdf',
            'application/vnd.google-apps.spreadsheet': 'text/csv',
            'application/vnd.google-apps.presentation': 'application/pdf',
          }

          if (googleTypes.includes(meta.mimeType)) {
            const res = await g.drive.files.export({ fileId: id, mimeType: exportMime[meta.mimeType] }, { responseType: 'arraybuffer' })
            buf = Buffer.from(res.data)
          } else {
            const res = await g.drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' })
            buf = Buffer.from(res.data)
          }

          const filename = args.fileName || meta.name || 'download'
          const { files: fileRepo } = await import('@bot/db/src/repositories/index.js')
          await fileRepo.upsert({
            userId, filename, content: buf,
            mimeType: meta.mimeType || 'application/octet-stream',
          })

          return {
            success: true,
            message: `Archivo "${filename}" descargado (${buf.length} bytes). Usa read_file("${filename}") para leer su contenido.`,
            filename,
            mimeType: meta.mimeType,
            sizeBytes: buf.length,
          }
        } catch (err) {
          return { error: `Error al descargar: ${err.message}` }
        }
      },
    }),

    // ========== TASKS ==========
    tasks_list: tool({
      description: 'Lista las tareas pendientes del usuario.',
      parameters: z.object({
        taskList: z.string().optional().describe('ID de la lista (default: primera)'),
      }),
      execute: async ({ taskList }) => {
        const g = await getClient(userId)
        if (g.error) return { error: g.error }

        if (!taskList) {
          const lists = await safeCall(() => g.tasks.tasklists.list())
          if (lists.error || !lists.items?.length) return lists
          taskList = lists.items[0].id
        }

        return safeCall(() => g.tasks.tasks.list({ tasklist: taskList }))
      },
    }),

    tasks_create: tool({
      description: 'Crea una tarea.',
      parameters: z.object({
        title: z.string().describe('Título de la tarea'),
        notes: z.string().optional().describe('Notas'),
        due: z.string().optional().describe('Fecha límite (ISO 8601)'),
      }),
      execute: async ({ title, notes, due }) => {
        const g = await getClient(userId)
        if (g.error) return { error: g.error }

        const lists = await safeCall(() => g.tasks.tasklists.list())
        if (lists.error || !lists.items?.length) return { error: 'No se encontraron listas de tareas' }

        const task = { title }
        if (notes) task.notes = notes
        if (due) task.due = due

        return safeCall(() => g.tasks.tasks.insert({
          tasklist: lists.items[0].id, requestBody: task,
        }))
      },
    }),

    tasks_complete: tool({
      description: 'Marca una tarea como completada.',
      parameters: z.object({
        taskId: z.string().describe('ID de la tarea'),
        taskList: z.string().optional().describe('ID de la lista'),
      }),
      execute: async ({ taskId, taskList }) => {
        const g = await getClient(userId)
        if (g.error) return { error: g.error }

        if (!taskList) {
          const lists = await safeCall(() => g.tasks.tasklists.list())
          if (lists.error || !lists.items?.length) return lists
          taskList = lists.items[0].id
        }

        return safeCall(() => g.tasks.tasks.patch({
          tasklist: taskList, task: taskId,
          requestBody: { status: 'completed' },
        }))
      },
    }),

    tasks_delete: tool({
      description: 'Elimina una tarea.',
      parameters: z.object({
        taskId: z.string().describe('ID de la tarea'),
        taskList: z.string().optional().describe('ID de la lista'),
      }),
      execute: async ({ taskId, taskList }) => {
        const g = await getClient(userId)
        if (g.error) return { error: g.error }

        if (!taskList) {
          const lists = await safeCall(() => g.tasks.tasklists.list())
          if (lists.error || !lists.items?.length) return lists
          taskList = lists.items[0].id
        }

        return safeCall(() => g.tasks.tasks.delete({
          tasklist: taskList, task: taskId,
        }))
      },
    }),
  }
}

export { create }
