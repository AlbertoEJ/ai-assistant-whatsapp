import { describe, it } from 'node:test'
import assert from 'node:assert'

import { splitMessage, buildInlineKeyboard } from '../src/formatter.js'

describe('splitMessage', () => {
  it('should return single part for short messages', () => {
    const parts = splitMessage('Hola mundo')
    assert.strictEqual(parts.length, 1)
    assert.strictEqual(parts[0], 'Hola mundo')
  })

  it('should split at newlines', () => {
    const text = 'A'.repeat(3000) + '\n' + 'B'.repeat(2000)
    const parts = splitMessage(text)
    assert.ok(parts.length >= 2)
    assert.ok(parts[0].length <= 4000)
    assert.ok(parts[1].length <= 4000)
  })

  it('should handle text without newlines', () => {
    const text = 'A'.repeat(8000)
    const parts = splitMessage(text)
    assert.ok(parts.length >= 2)
    assert.ok(parts.every(p => p.length <= 4000))
  })

  it('should handle empty string', () => {
    const parts = splitMessage('')
    assert.strictEqual(parts.length, 1)
    assert.strictEqual(parts[0], '')
  })

  it('should handle exactly max length', () => {
    const text = 'A'.repeat(4000)
    const parts = splitMessage(text)
    assert.strictEqual(parts.length, 1)
  })
})

describe('buildInlineKeyboard', () => {
  it('should build rows of 2 buttons', () => {
    const kb = buildInlineKeyboard(['A', 'B', 'C', 'D'])
    assert.strictEqual(kb.inline_keyboard.length, 2)
    assert.strictEqual(kb.inline_keyboard[0].length, 2)
    assert.strictEqual(kb.inline_keyboard[1].length, 2)
  })

  it('should handle odd number of buttons', () => {
    const kb = buildInlineKeyboard(['A', 'B', 'C'])
    assert.strictEqual(kb.inline_keyboard.length, 2)
    assert.strictEqual(kb.inline_keyboard[0].length, 2)
    assert.strictEqual(kb.inline_keyboard[1].length, 1)
  })

  it('should prefix callback data with btn:', () => {
    const kb = buildInlineKeyboard(['Opción 1'])
    assert.strictEqual(kb.inline_keyboard[0][0].callback_data, 'btn:Opción 1')
  })

  it('should truncate long callback data to 60 chars', () => {
    const longText = 'A'.repeat(100)
    const kb = buildInlineKeyboard([longText])
    assert.ok(kb.inline_keyboard[0][0].callback_data.length <= 64) // btn: + 60
  })

  it('should handle single button', () => {
    const kb = buildInlineKeyboard(['Solo'])
    assert.strictEqual(kb.inline_keyboard.length, 1)
    assert.strictEqual(kb.inline_keyboard[0][0].text, 'Solo')
  })
})
