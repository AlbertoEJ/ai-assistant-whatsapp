/**
 * Document generation tools — PDF (via Puppeteer HTML->PDF) and Excel.
 * Files stored in user_files on disk.
 */
import { z } from 'zod'
import { tool } from 'ai'
import * as repos from '@bot/db/src/repositories/index.js'
import { createLogger } from '@bot/shared/src/logger.js'

const fileRepo = repos.files

const log = createLogger('tools-documents')

/** Lazy-loaded browser instance (reused across PDF generations). */
let browserInstance = null

async function getBrowser() {
  if (browserInstance) return browserInstance

  const puppeteer = (await import('puppeteer-core')).default
  const chromium = (await import('chromium')).default

  browserInstance = await puppeteer.launch({
    executablePath: chromium.path,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  // Clean up on process exit
  process.on('exit', () => { browserInstance?.close().catch(() => {}) })

  log.info('Chromium browser launched')
  return browserInstance
}

function create(userId) {
  return {
    create_pdf: tool({
      description: 'Genera un documento PDF a partir de HTML. Puedes usar cualquier HTML con CSS inline para crear documentos con estilo, colores, tablas, imágenes, headers, etc. El HTML se renderiza exactamente como en un navegador.',
      parameters: z.object({
        filename: z.string().optional().describe('Nombre del archivo (sin extensión)'),
        html: z.string().describe('Contenido HTML completo del documento. Usa CSS inline o tags <style> para dar formato, colores, fuentes, etc.'),
      }),
      execute: async ({ filename, html }) => {
        try {
          if (!html) return { error: 'Se requiere contenido HTML para generar el PDF.' }

          const safeName = (filename || 'documento').replace(/[^a-zA-Z0-9_\-. ]/g, '_')
          const name = safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`

          // Wrap HTML in a base template if it doesn't have <html>
          const fullHtml = html.includes('<html') ? html : `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; color: #333; line-height: 1.6; }
                h1 { color: #1a1a2e; border-bottom: 2px solid #e94560; padding-bottom: 10px; }
                h2 { color: #16213e; }
                table { border-collapse: collapse; width: 100%; margin: 16px 0; }
                th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
                th { background: #16213e; color: white; }
                tr:nth-child(even) { background: #f8f9fa; }
              </style>
            </head>
            <body>${html}</body>
            </html>`

          const browser = await getBrowser()
          const page = await browser.newPage()

          await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 10000 })

          const pdfBuffer = await page.pdf({
            format: 'Letter',
            margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
            printBackground: true,
          })

          await page.close()

          await fileRepo.upsert({
            userId,
            filename: name,
            content: Buffer.from(pdfBuffer),
            mimeType: 'application/pdf',
          })

          log.info('PDF created', { userId, filename: name, size: pdfBuffer.length })

          return {
            success: true,
            filename: name,
            sizeBytes: pdfBuffer.length,
            message: `PDF creado: ${name}. [SEND_FILE:${name}]`,
          }
        } catch (err) {
          log.error('PDF creation failed', { userId, error: err.message })
          return { error: `Error al crear PDF: ${err.message.slice(0, 200)}` }
        }
      },
    }),

    create_excel: tool({
      description: 'Genera un archivo Excel con los datos proporcionados.',
      parameters: z.object({
        filename: z.string().optional().describe('Nombre del archivo (sin extensión)'),
        sheetName: z.string().describe('Nombre de la hoja'),
        headers: z.array(z.string()).describe('Encabezados de las columnas'),
        rows: z.array(z.array(z.string())).describe('Filas de datos'),
      }),
      execute: async ({ filename, sheetName, headers, rows }) => {
        try {
          const ExcelJS = (await import('exceljs')).default

          const workbook = new ExcelJS.Workbook()
          const sheet = workbook.addWorksheet(sheetName || 'Datos')

          sheet.addRow(headers)
          const headerRow = sheet.getRow(1)
          headerRow.font = { bold: true, color: { argb: 'FFFFFF' } }
          headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '16213E' } }

          for (const row of rows) {
            sheet.addRow(row)
          }

          // Auto-width columns
          sheet.columns.forEach(col => {
            col.width = Math.max(12, ...col.values.filter(Boolean).map(v => String(v).length + 2))
          })

          const buf = await workbook.xlsx.writeBuffer()
          const safeName = (filename || 'datos').replace(/[^a-zA-Z0-9_\-. ]/g, '_')
          const name = safeName.endsWith('.xlsx') ? safeName : `${safeName}.xlsx`

          await fileRepo.upsert({
            userId,
            filename: name,
            content: Buffer.from(buf),
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          })

          log.info('Excel created', { userId, filename: name, size: buf.length })

          return {
            success: true,
            filename: name,
            sizeBytes: buf.length,
            message: `Excel creado: ${name}. [SEND_FILE:${name}]`,
          }
        } catch (err) {
          log.error('Excel creation failed', { userId, error: err.message })
          return { error: `Error al crear Excel: ${err.message.slice(0, 200)}` }
        }
      },
    }),
  }
}

export { create }
