import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { getNotificationSettings, updateNotificationSettings } from './notifications.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => '',
  }
}

test('getNotificationSettings reads the tenant reminder settings', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { inbox_enabled: true, email_enabled: false, reminder_frequency: 'IMMEDIATE', version: 3 } })
  }

  const result = await getNotificationSettings()

  assert.deepEqual(result, { inbox_enabled: true, email_enabled: false, reminder_frequency: 'IMMEDIATE', version: 3 })
  assert.equal(requested.url, '/api/v1/settings/notifications')
  // GET 由 fetch 默认方法承载（request 层不显式传 method）。
  assert.equal(requested.options.method, undefined)
  assert.equal(requested.options.credentials, 'include')
  assert.equal(requested.options.body, undefined)
})

test('updateNotificationSettings keeps email fail-closed and bumps optimistic version', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { inbox_enabled: false, email_enabled: false, reminder_frequency: 'WEEKLY', version: 4 } })
  }

  const result = await updateNotificationSettings({ inboxEnabled: false, reminderFrequency: 'WEEKLY', version: 3 })

  assert.deepEqual(result, { inbox_enabled: false, email_enabled: false, reminder_frequency: 'WEEKLY', version: 4 })
  assert.equal(requested.url, '/api/v1/settings/notifications')
  assert.equal(requested.options.method, 'PUT')
  assert.equal(requested.options.credentials, 'include')
  const body = JSON.parse(requested.options.body)
  assert.equal(body.inbox_enabled, false)
  // 邮件通道无提供方：兼容字段必须始终 fail-closed，前端不得提交 true。
  assert.equal(body.email_enabled, false)
  assert.equal(body.reminder_frequency, 'WEEKLY')
  assert.equal(body.version, 3)
})
