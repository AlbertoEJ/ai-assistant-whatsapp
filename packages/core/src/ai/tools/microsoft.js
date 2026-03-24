/**
 * Microsoft 365 tools.
 * Uses integrations/microsoft.js for authenticated Graph API calls.
 * Timezone from user's DB record, never hardcoded.
 */
import { z } from 'zod'
import { tool } from 'ai'
import { graphRequest, getToken } from '../../integrations/microsoft.js'
import { createLogger } from '@bot/shared/src/logger.js'

const log = createLogger('tools-microsoft')

function create(userId, { timezone = 'UTC' } = {}) {
  return {
    // ========== OUTLOOK ==========
    outlook_list: tool({
      description: 'Lista emails recientes de Outlook. Puede buscar en cualquier carpeta.',
      parameters: z.object({
        top: z.number().optional().describe('Cantidad de emails (default 10)'),
        filter: z.string().optional().describe('Filtro OData (ej: "isRead eq false")'),
        folder: z.string().optional().describe('Carpeta: inbox, sentitems, drafts, deleteditems, junkemail, archive (default: todas)'),
      }),
      execute: async ({ top = 10, filter, folder }) => {
        const base = folder
          ? `/me/mailFolders/${folder}/messages`
          : '/me/messages'
        let path = `${base}?$top=${top}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview,isRead`
        if (filter) path += `&$filter=${encodeURIComponent(filter)}`
        return graphRequest(userId, path)
      },
    }),

    outlook_search: tool({
      description: 'Busca emails en Outlook por texto (asunto, cuerpo, remitente).',
      parameters: z.object({
        query: z.string().describe('Texto a buscar (ej: "Last War", "factura", "from:juan")'),
        top: z.number().optional().describe('Máximo resultados (default 10)'),
      }),
      execute: async ({ query: q, top = 10 }) => {
        const result = await graphRequest(userId, `/me/messages?$search="${encodeURIComponent(q)}"&$top=${top}&$select=id,subject,from,receivedDateTime,bodyPreview`)
        if (result?.error) return result
        return {
          messages: (result.value || []).map(m => ({
            id: m.id,
            subject: m.subject,
            from: m.from?.emailAddress?.address,
            date: m.receivedDateTime,
            preview: m.bodyPreview?.slice(0, 100),
          })),
          count: result.value?.length || 0,
        }
      },
    }),

    outlook_read: tool({
      description: 'Lee un email específico de Outlook.',
      parameters: z.object({
        id: z.string().describe('ID del mensaje (de outlook_list)'),
      }),
      execute: async (args) => {
        const id = args.id || args.messageId || args.message_id
        if (!id) return { error: 'Se requiere ID del mensaje.' }
        return graphRequest(userId, `/me/messages/${encodeURIComponent(id)}`)
      },
    }),

    outlook_send: tool({
      description: 'Envía un email desde Outlook. Puede incluir archivos adjuntos previamente descargados (usa el nombre exacto del archivo).',
      parameters: z.object({
        to: z.string().describe('Email del destinatario'),
        subject: z.string().describe('Asunto'),
        body: z.string().describe('Cuerpo del email'),
        attachments: z.array(z.string()).optional().describe('Lista de nombres de archivos previamente descargados para adjuntar'),
      }),
      execute: async ({ to, subject, body, attachments: fileNames }) => {
        // Load attachment files if specified
        const graphAttachments = []
        if (fileNames?.length > 0) {
          const { files: fileRepo } = await import('@bot/db/src/repositories/index.js')
          for (const name of fileNames) {
            const file = await fileRepo.get(userId, name)
            if (file?.content) {
              graphAttachments.push({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: file.filename,
                contentType: file.mime_type || 'application/octet-stream',
                contentBytes: file.content.toString('base64'),
              })
            }
          }
        }

        const message = {
          subject,
          body: { contentType: 'Text', content: body },
          toRecipients: [{ emailAddress: { address: to } }],
        }
        if (graphAttachments.length > 0) {
          message.attachments = graphAttachments
        }

        const result = await graphRequest(userId, '/me/sendMail', {
          method: 'POST',
          body: { message },
        })
        if (result?.error) return result
        return { success: true, message: `Email enviado a ${to}${graphAttachments.length > 0 ? ` con ${graphAttachments.length} adjunto(s)` : ''}.` }
      },
    }),

    outlook_reply: tool({
      description: 'Responde a un email en Outlook.',
      parameters: z.object({
        id: z.string().describe('ID del mensaje al que responder'),
        comment: z.string().describe('Texto de la respuesta'),
      }),
      execute: async (args) => {
        const id = args.id || args.messageId || args.message_id
        if (!id) return { error: 'Se requiere ID del mensaje.' }
        const result = await graphRequest(userId, `/me/messages/${encodeURIComponent(id)}/reply`, {
          method: 'POST',
          body: { comment: args.comment },
        })
        if (result?.error) return result
        return { success: true, message: 'Respuesta enviada.' }
      },
    }),

    outlook_trash: tool({
      description: 'Mueve un email a la papelera.',
      parameters: z.object({
        id: z.string().describe('ID del mensaje'),
      }),
      execute: async (args) => {
        const id = args.id || args.messageId || args.message_id
        if (!id) return { error: 'Se requiere ID del mensaje.' }
        const result = await graphRequest(userId, `/me/messages/${encodeURIComponent(id)}/move`, {
          method: 'POST',
          body: { destinationId: 'deleteditems' },
        })
        if (result?.error) return result
        return { success: true, message: 'Email movido a la papelera.' }
      },
    }),

    outlook_mark_read: tool({
      description: 'Marca un email como leído.',
      parameters: z.object({
        id: z.string().describe('ID del mensaje'),
      }),
      execute: async (args) => {
        const id = args.id || args.messageId || args.message_id
        if (!id) return { error: 'Se requiere ID del mensaje.' }
        const result = await graphRequest(userId, `/me/messages/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { isRead: true },
        })
        if (result?.error) return result
        return { success: true, message: 'Email marcado como leído.' }
      },
    }),

    outlook_get_attachments: tool({
      description: 'Descarga los adjuntos de un email de Outlook. Los guarda como archivos para que puedas enviarlos al usuario o analizarlos.',
      parameters: z.object({
        id: z.string().describe('ID del mensaje que contiene los adjuntos'),
      }),
      execute: async (args) => {
        const msgId = args.id || args.messageId || args.message_id
        if (!msgId) return { error: 'Se requiere ID del mensaje.' }

        const atts = await graphRequest(userId, `/me/messages/${encodeURIComponent(msgId)}/attachments`)
        if (atts.error) return atts

        const downloaded = []
        const { files: fileRepo } = await import('@bot/db/src/repositories/index.js')

        for (const att of (atts.value || [])) {
          if (att.contentBytes && att.name) {
            const buf = Buffer.from(att.contentBytes, 'base64')
            await fileRepo.upsert({
              userId,
              filename: att.name,
              content: buf,
              mimeType: att.contentType || 'application/octet-stream',
            })
            downloaded.push({
              filename: att.name,
              mimeType: att.contentType,
              sizeBytes: buf.length,
            })
          }
        }

        if (downloaded.length === 0) return { message: 'Este email no tiene adjuntos descargables.' }

        return {
          success: true,
          message: `${downloaded.length} adjunto(s) descargado(s): ${downloaded.map(a => a.filename).join(', ')}. Usa [SEND_FILE:nombre] para enviarlos al usuario.`,
          attachments: downloaded,
        }
      },
    }),

    outlook_forward: tool({
      description: 'Reenvía un email de Outlook a otra dirección, incluyendo los adjuntos originales.',
      parameters: z.object({
        id: z.string().describe('ID del mensaje a reenviar'),
        to: z.string().describe('Email del destinatario'),
        comment: z.string().optional().describe('Comentario adicional'),
      }),
      execute: async (args) => {
        const msgId = args.id || args.messageId || args.message_id
        if (!msgId) return { error: 'Se requiere ID del mensaje.' }

        // 1. Create forward draft
        const draft = await graphRequest(userId, `/me/messages/${encodeURIComponent(msgId)}/createForward`, {
          method: 'POST',
          body: args.comment ? { comment: args.comment } : undefined,
        })
        if (draft?.error) return draft
        if (!draft?.id) return { error: 'No se pudo crear el borrador de reenvío.' }

        // 2. Check if draft has attachments — if not, copy from original
        const draftAtts = await graphRequest(userId, `/me/messages/${encodeURIComponent(draft.id)}/attachments`)
        const origAtts = await graphRequest(userId, `/me/messages/${encodeURIComponent(msgId)}/attachments`)

        if ((!draftAtts?.value || draftAtts.value.length === 0) && origAtts?.value?.length > 0) {
          // Manually copy attachments from original to draft
          for (const att of origAtts.value) {
            if (att.contentBytes && att.name) {
              await graphRequest(userId, `/me/messages/${encodeURIComponent(draft.id)}/attachments`, {
                method: 'POST',
                body: {
                  '@odata.type': '#microsoft.graph.fileAttachment',
                  name: att.name,
                  contentType: att.contentType || 'application/octet-stream',
                  contentBytes: att.contentBytes,
                },
              })
            }
          }
        }

        // 3. Add recipients to the draft
        const updated = await graphRequest(userId, `/me/messages/${encodeURIComponent(draft.id)}`, {
          method: 'PATCH',
          body: {
            toRecipients: [{ emailAddress: { address: args.to, name: args.to } }],
          },
        })
        if (updated?.error) return updated

        // 4. Send the draft
        const sent = await graphRequest(userId, `/me/messages/${encodeURIComponent(draft.id)}/send`, {
          method: 'POST',
        })
        if (sent?.error) return sent
        return { success: true, message: `Email reenviado a ${args.to} con todos los adjuntos originales.` }
      },
    }),

    // ========== CALENDAR ==========
    ms_calendar_list: tool({
      description: 'Lista eventos del calendario de Outlook.',
      parameters: z.object({
        startDateTime: z.string().optional().describe('Fecha inicio (ISO 8601)'),
        endDateTime: z.string().optional().describe('Fecha fin (ISO 8601)'),
        top: z.number().optional().describe('Máximo resultados (default 10)'),
      }),
      execute: async ({ startDateTime, endDateTime, top = 10 }) => {
        if (startDateTime && endDateTime) {
          return graphRequest(userId,
            `/me/calendarView?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}&$top=${top}&$orderby=start/dateTime`)
        }
        return graphRequest(userId, `/me/events?$top=${top}&$orderby=start/dateTime`)
      },
    }),

    ms_calendar_create: tool({
      description: 'Crea un evento en el calendario de Outlook. IMPORTANTE: siempre incluye hora en formato ISO 8601 (ej: 2026-03-24T08:00:00).',
      parameters: z.object({
        subject: z.string().describe('Título del evento'),
        start: z.string().describe('Fecha/hora inicio (ISO 8601 con hora, ej: 2026-03-24T08:00:00)'),
        end: z.string().optional().describe('Fecha/hora fin. Si no se proporciona, se agrega 1 hora al inicio.'),
        body: z.string().optional().describe('Descripción'),
        location: z.string().optional().describe('Ubicación del evento'),
        attendees: z.array(z.string()).optional().describe('Emails de invitados'),
        reminderMinutes: z.number().optional().describe('Recordatorio X minutos antes (ej: 60, 30, 15)'),
      }),
      execute: async (args) => {
        // Accept alternative param names
        const subject = args.subject || args.summary || args.title || 'Evento'
        let start = args.start || args.start_time || args.startTime
        let end = args.end || args.end_time || args.endTime
        const { body: desc, location, attendees } = args
        let reminderMinutes = args.reminderMinutes || args.reminder_minutes
        if (!reminderMinutes && args.reminders?.[0]?.minutes) reminderMinutes = args.reminders[0].minutes

        if (!start) return { error: 'Se requiere fecha/hora de inicio.' }

        // Auto-generate end if not provided
        if (!end) {
          const match = start.match(/T(\d{2}):/)
          if (match) {
            const hour = parseInt(match[1]) + 1
            end = start.replace(/T\d{2}:/, `T${String(hour).padStart(2, '0')}:`)
          } else {
            end = start
          }
        }

        const event = {
          subject,
          start: { dateTime: start, timeZone: timezone },
          end: { dateTime: end, timeZone: timezone },
        }
        if (desc) event.body = { contentType: 'Text', content: desc }
        if (location) event.location = { displayName: location }
        if (attendees?.length) {
          event.attendees = attendees.map(email => ({
            emailAddress: { address: email }, type: 'required',
          }))
        }
        if (reminderMinutes != null) {
          event.isReminderOn = true
          event.reminderMinutesBeforeStart = reminderMinutes
        }

        const result = await graphRequest(userId, '/me/events', { method: 'POST', body: event })
        if (result.error) return result
        return {
          success: true,
          message: `Evento "${subject}" creado exitosamente en Outlook.`,
          eventId: result.id,
          start: result.start?.dateTime,
          end: result.end?.dateTime,
        }
      },
    }),

    ms_calendar_update: tool({
      description: 'Modifica un evento existente del calendario de Outlook (mover horario, cambiar título, etc.).',
      parameters: z.object({
        eventId: z.string().describe('ID del evento a modificar'),
        subject: z.string().optional().describe('Nuevo título'),
        start: z.string().optional().describe('Nueva fecha/hora inicio (ISO 8601)'),
        end: z.string().optional().describe('Nueva fecha/hora fin (ISO 8601)'),
        body: z.string().optional().describe('Nueva descripción'),
        location: z.string().optional().describe('Nueva ubicación'),
      }),
      execute: async (args) => {
        const id = args.eventId || args.id || args.event_id
        if (!id) return { error: 'Se requiere eventId. Usa ms_calendar_list para obtener el ID.' }
        const event = {}
        const title = args.subject || args.title || args.summary
        const start = args.start || args.start_time || args.startTime
        const end = args.end || args.end_time || args.endTime
        if (title) event.subject = title
        if (start) event.start = { dateTime: start, timeZone: timezone }
        if (end) event.end = { dateTime: end, timeZone: timezone }
        if (args.body || args.description) event.body = { contentType: 'Text', content: args.body || args.description }
        if (args.location) event.location = { displayName: args.location }
        const result = await graphRequest(userId, `/me/events/${encodeURIComponent(id)}`, {
          method: 'PATCH', body: event,
        })
        if (result.error) return result
        return { success: true, message: 'Evento actualizado en Outlook.' }
      },
    }),

    ms_calendar_delete: tool({
      description: 'Elimina un evento del calendario de Outlook.',
      parameters: z.object({
        eventId: z.string().describe('ID del evento a eliminar'),
      }),
      execute: async (args) => {
        const id = args.eventId || args.id || args.event_id
        if (!id) return { error: 'Se requiere eventId. Usa ms_calendar_list para obtener el ID.' }
        const result = await graphRequest(userId, `/me/events/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })
        if (result.error) return result
        return { success: true, message: 'Evento eliminado de Outlook.' }
      },
    }),

    // ========== ONEDRIVE ==========
    onedrive_list: tool({
      description: 'Lista archivos y carpetas en OneDrive. Usa path para navegar por nombre o folderId para navegar por ID. Para subcarpetas usa path completo (ej: "Malta/INE").',
      parameters: z.object({
        path: z.string().optional().describe('Ruta completa de la carpeta (ej: "Malta", "Malta/INE", "Documentos/Trabajo"). Default: raíz'),
        folderId: z.string().optional().describe('ID de la carpeta (alternativa a path, obtenido de una llamada anterior)'),
      }),
      execute: async (args) => {
        const folderId = args.folderId || args.id || args.folder_id
        const folderPath = args.path || args.folderPath

        let endpoint
        if (folderId) {
          endpoint = `/me/drive/items/${folderId}/children`
        } else if (folderPath) {
          endpoint = `/me/drive/root:/${folderPath}:/children`
        } else {
          endpoint = '/me/drive/root/children'
        }

        const result = await graphRequest(userId, `${endpoint}?$select=id,name,size,lastModifiedDateTime,file,folder&$top=50`)
        if (result?.error) return result

        const items = (result.value || []).map(item => ({
          id: item.id,
          name: item.name,
          type: item.folder ? 'folder' : 'file',
          mimeType: item.file?.mimeType || null,
          size: item.size,
          modified: item.lastModifiedDateTime,
        }))

        return { success: true, items, count: items.length }
      },
    }),

    onedrive_search: tool({
      description: 'Busca archivos en OneDrive por nombre.',
      parameters: z.object({
        query: z.string().describe('Texto a buscar en nombres de archivo'),
      }),
      execute: async ({ query: q }) => {
        const result = await graphRequest(userId, `/me/drive/root/search(q='${q.replace(/'/g, "''")}')?$select=id,name,size,lastModifiedDateTime,file,folder,parentReference&$top=20`)
        if (result?.error) return result

        const items = (result.value || []).map(item => ({
          id: item.id,
          name: item.name,
          type: item.folder ? 'folder' : 'file',
          mimeType: item.file?.mimeType || null,
          size: item.size,
          path: item.parentReference?.path?.replace('/drive/root:', '') || '/',
          modified: item.lastModifiedDateTime,
        }))

        return { success: true, items, count: items.length }
      },
    }),

    onedrive_download: tool({
      description: 'Descarga un archivo de OneDrive para enviarlo al usuario o analizarlo.',
      parameters: z.object({
        itemId: z.string().describe('ID del archivo (de onedrive_list)'),
        fileName: z.string().optional().describe('Nombre del archivo'),
      }),
      execute: async (args) => {
        const itemId = args.itemId || args.id || args.item_id
        if (!itemId) return { error: 'Se requiere ID del archivo.' }

        log.info('OneDrive download', { userId, itemId: itemId.slice(0, 30) })

        try {
          // Get download URL via Graph API (more reliable than /content redirect)
          const meta = await graphRequest(userId, `/me/drive/items/${encodeURIComponent(itemId)}?$select=name,size,file,@microsoft.graph.downloadUrl`)
          if (meta?.error) return meta

          log.info('OneDrive meta', { userId, name: meta.name, hasDownloadUrl: !!meta['@microsoft.graph.downloadUrl'] })

          // Use the direct download URL (no auth needed, it's a pre-signed URL)
          const downloadUrl = meta['@microsoft.graph.downloadUrl']
          if (!downloadUrl) {
            // Fallback: use /content endpoint with auth
            const auth = await getToken(userId)
            if (auth.error) return { error: auth.error }
            var res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}/content`, {
              headers: { 'Authorization': `Bearer ${auth.token}` },
              redirect: 'follow',
            })
          } else {
            var res = await fetch(downloadUrl)
          }

          if (!res.ok) return { error: `Error al descargar (${res.status})` }

          const buf = Buffer.from(await res.arrayBuffer())
          const filename = args.fileName || meta.name || 'download'
          const mimeType = meta.file?.mimeType || 'application/octet-stream'

          const { files: fileRepo } = await import('@bot/db/src/repositories/index.js')
          await fileRepo.upsert({ userId, filename, content: buf, mimeType })

          return {
            success: true,
            message: `Archivo "${filename}" descargado (${buf.length} bytes). Usa [SEND_FILE:${filename}] para enviarlo al usuario.`,
            filename,
            mimeType,
            sizeBytes: buf.length,
          }
        } catch (err) {
          log.error('OneDrive download failed', { userId, itemId, error: err.message })
          return { error: `Error al descargar: ${err.message}` }
        }
      },
    }),

    // ========== TASKS ==========
    ms_tasks_list: tool({
      description: 'Lista tareas pendientes de Microsoft To Do.',
      parameters: z.object({
        listId: z.string().optional().describe('ID de la lista (default: primera)'),
      }),
      execute: async ({ listId }) => {
        if (listId) return graphRequest(userId, `/me/todo/lists/${encodeURIComponent(listId)}/tasks`)
        const lists = await graphRequest(userId, '/me/todo/lists')
        if (lists.error || !lists.value?.length) return lists
        return graphRequest(userId, `/me/todo/lists/${lists.value[0].id}/tasks`)
      },
    }),

    ms_tasks_create: tool({
      description: 'Crea una tarea en Microsoft To Do.',
      parameters: z.object({
        title: z.string().describe('Título de la tarea'),
        body: z.string().optional().describe('Notas'),
        dueDateTime: z.string().optional().describe('Fecha límite (ISO 8601)'),
      }),
      execute: async ({ title, body: notes, dueDateTime }) => {
        const lists = await graphRequest(userId, '/me/todo/lists')
        if (lists.error || !lists.value?.length) return { error: 'No se encontraron listas de tareas' }

        const task = { title }
        if (notes) task.body = { content: notes, contentType: 'text' }
        if (dueDateTime) task.dueDateTime = { dateTime: dueDateTime, timeZone: timezone }

        return graphRequest(userId, `/me/todo/lists/${lists.value[0].id}/tasks`, {
          method: 'POST', body: task,
        })
      },
    }),

    ms_tasks_complete: tool({
      description: 'Marca una tarea como completada.',
      parameters: z.object({
        taskId: z.string().describe('ID de la tarea'),
        listId: z.string().optional().describe('ID de la lista'),
      }),
      execute: async ({ taskId, listId }) => {
        if (!listId) {
          const lists = await graphRequest(userId, '/me/todo/lists')
          if (lists.error || !lists.value?.length) return lists
          listId = lists.value[0].id
        }
        return graphRequest(userId, `/me/todo/lists/${listId}/tasks/${encodeURIComponent(taskId)}`, {
          method: 'PATCH', body: { status: 'completed' },
        })
      },
    }),

    ms_tasks_delete: tool({
      description: 'Elimina una tarea.',
      parameters: z.object({
        taskId: z.string().describe('ID de la tarea'),
        listId: z.string().optional().describe('ID de la lista'),
      }),
      execute: async ({ taskId, listId }) => {
        if (!listId) {
          const lists = await graphRequest(userId, '/me/todo/lists')
          if (lists.error || !lists.value?.length) return lists
          listId = lists.value[0].id
        }
        return graphRequest(userId, `/me/todo/lists/${listId}/tasks/${encodeURIComponent(taskId)}`, {
          method: 'DELETE',
        })
      },
    }),
  }
}

export { create }
