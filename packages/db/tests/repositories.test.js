import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { query, close } from '../src/client.js'
import repos from '../src/repositories.js'

// These tests require a running PostgreSQL with migrations applied.
// Run: docker compose up postgres -d && npm run db:migrate

let testOrgId
let testUserId

before(async () => {
  // Create test org
  const { rows: orgs } = await query(
    `INSERT INTO organizations (name, slug, plan, max_users, messages_limit)
     VALUES ('Test Org', 'test-org-' || gen_random_uuid(), 'equipo', 10, 6000)
     RETURNING id`
  )
  testOrgId = orgs[0].id

  // Create test user (mimics Better Auth user table)
  // In production, Better Auth creates users. For tests, we insert directly.
  const { rows: users } = await query(
    `INSERT INTO users (org_id, name, email, role)
     VALUES ($1, 'Test User', 'test@example.com', 'admin')
     RETURNING id`,
    [testOrgId]
  )
  testUserId = users[0].id
})

after(async () => {
  // Clean up test data
  if (testUserId) await query('DELETE FROM users WHERE id = $1', [testUserId])
  if (testOrgId) await query('DELETE FROM organizations WHERE id = $1', [testOrgId])
  await close()
})

describe('channels', () => {
  let channelId

  it('should create a channel', async () => {
    const channel = await repos.channels.create({
      userId: testUserId,
      platform: 'telegram',
      platformId: '123456789',
      platformMeta: { username: 'testuser' },
    })
    assert.ok(channel.id)
    assert.strictEqual(channel.platform, 'telegram')
    assert.strictEqual(channel.platform_id, '123456789')
    channelId = channel.id
  })

  it('should find by platform', async () => {
    const channel = await repos.channels.findByPlatform('telegram', '123456789')
    assert.ok(channel)
    assert.strictEqual(channel.id, channelId)
  })

  it('should find by user', async () => {
    const channels = await repos.channels.findByUserid(testUserId)
    assert.ok(channels.length >= 1)
  })

  it('should update last active', async () => {
    await repos.channels.updateLastActive(channelId)
    const channel = await repos.channels.findByPlatform('telegram', '123456789')
    assert.ok(channel.last_active)
  })

  it('should disable and enable', async () => {
    await repos.channels.disable(channelId)
    let ch = await repos.channels.findByPlatform('telegram', '123456789')
    assert.strictEqual(ch.enabled, false)

    await repos.channels.enable(channelId)
    ch = await repos.channels.findByPlatform('telegram', '123456789')
    assert.strictEqual(ch.enabled, true)
  })
})

describe('sessions & messages', () => {
  let sessionId

  it('should create a session', async () => {
    const session = await repos.sessions.create(testUserId)
    assert.ok(session.id)
    assert.strictEqual(session.is_active, true)
    sessionId = session.id
  })

  it('should find active session', async () => {
    const session = await repos.sessions.findActive(testUserId)
    assert.ok(session)
    assert.strictEqual(session.id, sessionId)
  })

  it('should create messages', async () => {
    const msg1 = await repos.messages.create({
      sessionId,
      userId: testUserId,
      role: 'user',
      content: 'Hola, qué reuniones tengo hoy?',
    })
    assert.ok(msg1.id)
    assert.strictEqual(msg1.role, 'user')

    const msg2 = await repos.messages.create({
      sessionId,
      userId: testUserId,
      role: 'assistant',
      content: 'Tienes 3 reuniones hoy.',
      model: 'gemini-2.5-flash',
      tokensIn: 150,
      tokensOut: 50,
    })
    assert.ok(msg2.id)
    assert.strictEqual(msg2.model, 'gemini-2.5-flash')
  })

  it('should find messages by session', async () => {
    const messages = await repos.messages.findBySession(sessionId)
    assert.strictEqual(messages.length, 2)
    assert.strictEqual(messages[0].role, 'user')
    assert.strictEqual(messages[1].role, 'assistant')
  })

  it('should increment session count', async () => {
    await repos.sessions.incrementCount(sessionId)
    await repos.sessions.incrementCount(sessionId)
    const session = await repos.sessions.findActive(testUserId)
    assert.strictEqual(session.message_count, 2)
  })

  it('should check rotation (not yet)', async () => {
    const should = await repos.sessions.shouldRotate(sessionId, 30, 7200000)
    assert.strictEqual(should, false)
  })

  it('should deactivate session', async () => {
    await repos.sessions.deactivate(sessionId)
    const session = await repos.sessions.findActive(testUserId)
    assert.strictEqual(session, null)
  })
})

describe('memory', () => {
  it('should set and get memory', async () => {
    await repos.memory.setMemory(testUserId, '# Datos\n- Le gusta el café')
    const mem = await repos.memory.getMemory(testUserId)
    assert.ok(mem)
    assert.ok(mem.content.includes('café'))
  })

  it('should set and get soul', async () => {
    await repos.memory.setSoul(testUserId, 'Habla directo, sin rodeos')
    const soul = await repos.memory.getSoul(testUserId)
    assert.ok(soul)
    assert.ok(soul.content.includes('directo'))
  })

  it('should upsert (update) memory', async () => {
    await repos.memory.setMemory(testUserId, '# Datos\n- Le gusta el té')
    const mem = await repos.memory.getMemory(testUserId)
    assert.ok(mem.content.includes('té'))
    assert.ok(!mem.content.includes('café'))
  })

  it('should create summary', async () => {
    const summary = await repos.memory.createSummary(testUserId, null, 'Resumen de la sesión...')
    assert.ok(summary.id)
  })

  it('should get recent summaries', async () => {
    const summaries = await repos.memory.getRecentSummaries(testUserId)
    assert.strictEqual(summaries.length, 1)
  })
})

describe('crons', () => {
  let cronId

  it('should create cron', async () => {
    const cron = await repos.crons.create({
      userId: testUserId,
      schedule: '*/30 * * * *',
      prompt: 'Revisa mi email',
    })
    assert.ok(cron.id)
    cronId = cron.id
  })

  it('should find by user', async () => {
    const crons = await repos.crons.findByUser(testUserId)
    assert.strictEqual(crons.length, 1)
  })

  it('should deactivate', async () => {
    await repos.crons.deactivate(cronId)
    const crons = await repos.crons.findByUser(testUserId)
    assert.strictEqual(crons.length, 0)
  })
})

describe('watchers', () => {
  let watcherId

  it('should create watcher', async () => {
    const watcher = await repos.watchers.create({
      userId: testUserId,
      type: 'email',
      condition: { from: 'juan@empresa.com' },
      action: 'notify',
      messageTemplate: 'Email de {{from}}: {{subject}}',
    })
    assert.ok(watcher.id)
    watcherId = watcher.id
  })

  it('should find by type', async () => {
    const watchers = await repos.watchers.findByType('email')
    assert.ok(watchers.length >= 1)
  })

  it('should update subscription', async () => {
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await repos.watchers.updateSubscription(watcherId, 'sub_123', expires)
  })

  it('should deactivate', async () => {
    await repos.watchers.deactivate(watcherId)
    const watchers = await repos.watchers.findByUser(testUserId)
    assert.strictEqual(watchers.length, 0)
  })
})

describe('audit', () => {
  it('should log action', async () => {
    await repos.audit.log({
      orgId: testOrgId,
      userId: testUserId,
      action: 'test_action',
      detail: 'Running tests',
      metadata: { test: true },
    })
  })

  it('should find by org', async () => {
    const logs = await repos.audit.findByOrg(testOrgId)
    assert.ok(logs.length >= 1)
    assert.strictEqual(logs[0].action, 'test_action')
  })
})

describe('usage', () => {
  it('should track usage', async () => {
    await repos.usage.track({
      orgId: testOrgId,
      userId: testUserId,
      model: 'gemini-2.5-flash',
      tokensIn: 500,
      tokensOut: 200,
      costUsd: 0.0007,
    })
  })

  it('should get monthly by org', async () => {
    const stats = await repos.usage.getMonthlyByOrg(testOrgId)
    assert.ok(stats.total_requests >= 1)
  })
})
