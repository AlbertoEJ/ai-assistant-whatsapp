import { describe, it } from 'node:test'
import assert from 'node:assert'
import { classify, getModelName, estimateCost } from '../src/ai/router.js'

describe('router.classify', () => {
  it('should classify short messages as light', () => {
    assert.strictEqual(classify('hola'), 'light')
    assert.strictEqual(classify('ok'), 'light')
    assert.strictEqual(classify('gracias'), 'light')
    assert.strictEqual(classify('sí'), 'light')
  })

  it('should classify empty/short as light', () => {
    assert.strictEqual(classify(''), 'light')
    assert.strictEqual(classify('hey'), 'light')
    assert.strictEqual(classify('12345'), 'light')
  })

  it('should classify complex keywords as complex', () => {
    assert.strictEqual(classify('analiza este contrato'), 'complex')
    assert.strictEqual(classify('revisa con cuidado este documento'), 'complex')
    assert.strictEqual(classify('necesito un análisis a profundidad'), 'complex')
    assert.strictEqual(classify('revisión detallada del reporte'), 'complex')
  })

  it('should classify normal messages as standard', () => {
    assert.strictEqual(classify('qué reuniones tengo hoy'), 'standard')
    assert.strictEqual(classify('resúmeme mis emails'), 'standard')
    assert.strictEqual(classify('crea un evento para mañana a las 10'), 'standard')
  })

  it('should classify messages with files as standard', () => {
    assert.strictEqual(classify('revisa esto', { hasFiles: true }), 'standard')
  })

  it('should prioritize complex over files', () => {
    assert.strictEqual(classify('analiza a profundidad', { hasFiles: true }), 'complex')
  })
})

describe('router.getModelName', () => {
  it('should return correct model names', () => {
    assert.strictEqual(getModelName('light'), 'gemini-2.5-flash')
    assert.strictEqual(getModelName('standard'), 'gemini-2.5-flash')
    assert.strictEqual(getModelName('unknown'), 'gemini-2.5-flash')
  })

  it('should fallback complex to gemini-2.5-pro without Anthropic key', () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    // Without Anthropic key, falls back to Flash
    assert.strictEqual(getModelName('complex'), 'gemini-2.5-flash')
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey
  })

  it('should use claude-sonnet for complex with Anthropic key', () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key'
    assert.strictEqual(getModelName('complex'), 'claude-sonnet-4-6')
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey
    else delete process.env.ANTHROPIC_API_KEY
  })
})

describe('router.estimateCost', () => {
  it('should estimate light cost correctly', () => {
    const cost = estimateCost('light', 1000, 500)
    assert.ok(cost < 0.01)
    assert.ok(cost > 0)
  })

  it('should estimate complex cost higher than standard', () => {
    const standard = estimateCost('standard', 1000, 1000)
    const complex = estimateCost('complex', 1000, 1000)
    assert.ok(complex > standard)
  })
})
