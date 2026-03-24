/**
 * Reminder tool — creates crons via tag output.
 * The model uses [CREATE_CRON:...] tags in its response,
 * but this tool provides an explicit interface too.
 */
import { z } from 'zod'
import { tool } from 'ai'

function create(userId) {
  return {
    create_reminder: tool({
      description: 'Crea un recordatorio o tarea programada para el usuario. El formato se incluirá como [CREATE_CRON:horario|mensaje] en la respuesta.',
      parameters: z.object({
        schedule: z.string().describe('Horario: "5m", "30m", "2h", "9:00", "9:00 lun-vie", o cron estándar'),
        message: z.string().describe('Mensaje del recordatorio'),
        once: z.boolean().optional().describe('Si es de una sola vez (default: false)'),
      }),
      execute: async ({ schedule, message, once = false }) => {
        // Return a tag that the post-processor will handle
        const tag = once ? 'CREATE_CRON_ONCE' : 'CREATE_CRON'
        return {
          success: true,
          tag: `[${tag}:${schedule}|${message}]`,
          message: `Recordatorio programado: ${schedule} — "${message}"`,
        }
      },
    }),
  }
}

export { create }
