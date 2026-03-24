import { describe, it } from 'node:test'
import assert from 'node:assert'
import { parse, hasTags } from '../src/tags/parser.js'

describe('tags.parse', () => {
  it('should extract cron tags', () => {
    const text = 'Listo, te aviso. [CREATE_CRON:30m|Revisa email de Juan]'
    const result = parse(text)

    assert.strictEqual(result.crons.length, 1)
    assert.strictEqual(result.crons[0].schedule, '30m')
    assert.strictEqual(result.crons[0].prompt, 'Revisa email de Juan')
    assert.strictEqual(result.crons[0].isOnce, false)
    assert.strictEqual(result.cleaned, 'Listo, te aviso.')
  })

  it('should extract one-time cron tags', () => {
    const text = 'Te recuerdo. [CREATE_CRON_ONCE:9:00|Recordar reunión]'
    const result = parse(text)

    assert.strictEqual(result.crons.length, 1)
    assert.strictEqual(result.crons[0].isOnce, true)
    assert.strictEqual(result.crons[0].schedule, '9:00')
  })

  it('should extract file tags', () => {
    const text = 'Aquí está el reporte. [SEND_FILE:reporte.pdf]'
    const result = parse(text)

    assert.strictEqual(result.files.length, 1)
    assert.strictEqual(result.files[0].filename, 'reporte.pdf')
    assert.strictEqual(result.cleaned, 'Aquí está el reporte.')
  })

  it('should extract button tags', () => {
    const text = 'Elige una opción: [BUTTONS:Ver más|Cancelar|Siguiente]'
    const result = parse(text)

    assert.deepStrictEqual(result.buttons, ['Ver más', 'Cancelar', 'Siguiente'])
    assert.strictEqual(result.cleaned, 'Elige una opción:')
  })

  it('should handle multiple tags', () => {
    const text = 'Hecho. [CREATE_CRON:5m|Check] [SEND_FILE:log.txt] [BUTTONS:OK|Cancel]'
    const result = parse(text)

    assert.strictEqual(result.crons.length, 1)
    assert.strictEqual(result.files.length, 1)
    assert.strictEqual(result.buttons.length, 2)
    assert.strictEqual(result.cleaned, 'Hecho.')
  })

  it('should handle no tags', () => {
    const text = 'Solo una respuesta normal.'
    const result = parse(text)

    assert.strictEqual(result.crons.length, 0)
    assert.strictEqual(result.files.length, 0)
    assert.strictEqual(result.buttons.length, 0)
    assert.strictEqual(result.cleaned, 'Solo una respuesta normal.')
  })

  it('should handle empty input', () => {
    const result = parse('')
    assert.strictEqual(result.cleaned, '')
  })

  it('should handle null input', () => {
    const result = parse(null)
    assert.strictEqual(result.cleaned, '')
  })
})

describe('tags.hasTags', () => {
  it('should detect tags', () => {
    assert.ok(hasTags('[CREATE_CRON:5m|test]'))
    assert.ok(hasTags('[SEND_FILE:x.pdf]'))
    assert.ok(hasTags('[BUTTONS:a|b]'))
  })

  it('should return false for no tags', () => {
    assert.ok(!hasTags('normal text'))
    assert.ok(!hasTags(''))
    assert.ok(!hasTags(null))
  })
})
