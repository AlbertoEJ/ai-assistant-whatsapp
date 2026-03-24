import { describe, it } from 'node:test'
import assert from 'node:assert'
import { getAllowedTools, isToolAllowed } from '../src/users/permissions.js'

describe('permissions.getAllowedTools', () => {
  it('should return limited tools for free plan', () => {
    const tools = getAllowedTools('free')
    assert.ok(tools.includes('read_file'))
    assert.ok(tools.includes('write_file'))
    assert.ok(!tools.includes('gmail_search'))
    assert.ok(!tools.includes('create_pdf'))
  })

  it('should return integration tools for inicio plan', () => {
    const tools = getAllowedTools('inicio')
    assert.ok(tools.includes('gmail_search'))
    assert.ok(tools.includes('calendar_list'))
    assert.ok(tools.includes('create_pdf'))
    assert.ok(tools.includes('outlook_list'))
  })

  it('should return all tools for empresa plan', () => {
    const tools = getAllowedTools('empresa')
    assert.ok(tools.includes('gmail_search'))
    assert.ok(tools.includes('gmail_reply'))
    assert.ok(tools.includes('drive_search'))
    assert.ok(tools.includes('outlook_reply'))
  })

  it('should use overrides when provided', () => {
    const tools = getAllowedTools('empresa', ['read_file', 'gmail_search'])
    assert.strictEqual(tools.length, 2)
    assert.ok(tools.includes('read_file'))
    assert.ok(tools.includes('gmail_search'))
    assert.ok(!tools.includes('create_pdf'))
  })

  it('should default to free for unknown plan', () => {
    const tools = getAllowedTools('fake')
    assert.ok(tools.includes('read_file'))
    assert.ok(!tools.includes('gmail_search'))
  })
})

describe('permissions.isToolAllowed', () => {
  it('should allow read_file for all plans', () => {
    assert.ok(isToolAllowed('read_file', 'free'))
    assert.ok(isToolAllowed('read_file', 'inicio'))
    assert.ok(isToolAllowed('read_file', 'empresa'))
  })

  it('should deny gmail for free plan', () => {
    assert.ok(!isToolAllowed('gmail_search', 'free'))
  })

  it('should allow gmail for paid plans', () => {
    assert.ok(isToolAllowed('gmail_search', 'inicio'))
    assert.ok(isToolAllowed('gmail_search', 'equipo'))
  })
})
