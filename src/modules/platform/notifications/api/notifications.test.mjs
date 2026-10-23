import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { afterEach, test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getNotificationSettings, retryFailedNotificationDeliveries, updateNotificationSettings } from './notifications.js'

// 跨仓契约守卫：前端使用的通知路由必须真实存在于平台路由表，
// 避免只断言模拟响应而漏掉路径拼写错误（历史缺陷：retry-failed）。
const WORKSPACE_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../../..')
const PLATFORM_ROUTER = path.join(WORKSPACE_ROOT, 'platform/internal/transport/http/router.go')
const routerSource = existsSync(PLATFORM_ROUTER) ? readFileSync(PLATFORM_ROUTER, 'utf8') : ''

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

test('retryFailedNotificationDeliveries posts to the authoritative retry route with limit in query', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { Claimed: 3, Delivered: 2, Failed: 1 } })
  }

  const result = await retryFailedNotificationDeliveries(50)

  assert.equal(requested.url, '/api/v1/notifications/deliveries/retry?limit=50')
  assert.equal(requested.options.method, 'POST')
  assert.equal(requested.options.credentials, 'include')
  // 后端 RetryResult 默认按 Go 字段名序列化，前端必须归一化后交给页面展示。
  assert.deepEqual(result, { claimed: 3, delivered: 2, failed: 1 })
})

test('retryFailedNotificationDeliveries defaults to 20 and rejects a non-positive limit', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { claimed: 0, delivered: 0, failed: 0 } })
  }

  await retryFailedNotificationDeliveries()
  assert.equal(requested.url, '/api/v1/notifications/deliveries/retry?limit=20')

  await assert.rejects(() => retryFailedNotificationDeliveries(0), /limit/i)
})

test('notification retry route exists in the platform router (cross-repo drift guard)', { skip: !routerSource }, () => {
  const registered = new Set([...routerSource.matchAll(/"\/notifications\/deliveries\/([a-z-]+)"/g)].map((m) => m[1]))
  assert.ok(registered.has('retry'), '平台路由缺少 /notifications/deliveries/retry：' + [...registered].join(', '))
  // 明确否定历史拼写，防止再次写回不被后端注册的路径。
  assert.equal(registered.has('retry-failed'), false)
})
