import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert'
import { accumulate, hasPending, clear } from '../src/buffer.js'

afterEach(() => {
  clear('test-user')
})

describe('accumulate', () => {
  it('should accumulate a single message', async () => {
    const result = await accumulate('test-user', { text: 'hola' })
    assert.ok(result)
    assert.deepStrictEqual(result.texts, ['hola'])
    assert.deepStrictEqual(result.files, [])
  })

  it('should accumulate multiple rapid messages', async () => {
    // First message starts the buffer and will receive all accumulated data
    const promise = accumulate('test-user', { text: 'msg 1' })

    // Second message within the window
    accumulate('test-user', { text: 'msg 2' })

    const result = await promise
    assert.ok(result)
    assert.ok(result.texts.includes('msg 1'))
    assert.ok(result.texts.includes('msg 2'))
  })

  it('should include files', async () => {
    const result = await accumulate('test-user', {
      text: 'mira esto',
      files: [{ name: 'foto.jpg', type: 'image' }],
    })
    assert.ok(result)
    assert.strictEqual(result.files.length, 1)
    assert.strictEqual(result.files[0].name, 'foto.jpg')
  })

  it('should report pending status', () => {
    // Start buffer but don't await
    accumulate('test-user', { text: 'pending' })
    assert.ok(hasPending('test-user'))
    assert.ok(!hasPending('other-user'))
  })

  it('should clear buffer', () => {
    accumulate('test-user', { text: 'will be cleared' })
    clear('test-user')
    assert.ok(!hasPending('test-user'))
  })
})
