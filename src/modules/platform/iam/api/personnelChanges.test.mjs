import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { afterEach, test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PersonnelChangeError,
  completePersonnelHandoverItem,
  listPersonnelHandoverItems,
  retryPersonnelHandover,
} from './personnelChanges.js'

// 跨仓契约守卫：交接项端点必须真实存在于平台路由表。
// 历史缺陷模式是"前端拼错路径而模拟响应掩盖问题"，因此这里同时断言路由存在与请求形状。
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

// 前端镜像的构建上下文只含 frontend/，此处读不到兄弟仓库的平台路由源码。
// 跨仓守卫只在能读到源码的环境（完整工作区、CI）生效，否则显式跳过而不是误报失败。
test('handover item routes exist in the platform router', {
  skip: routerSource.length === 0 ? '平台路由源码不在当前构建上下文（仅前端镜像构建）' : false,
}, () => {
  assert.match(routerSource, /handover-items/)
  assert.match(routerSource, /handover-items\/:item_id\/complete/)
})

test('listPersonnelHandoverItems reads the change-scoped handover items', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { items: [{ id: 'item-1', status: 'PENDING' }], total: 1 } })
  }

  const result = await listPersonnelHandoverItems('change-1')

  assert.equal(requested.url, '/api/v1/personnel-changes/change-1/handover-items')
  assert.equal(requested.options.credentials, 'include')
  assert.deepEqual(result, { items: [{ id: 'item-1', status: 'PENDING' }], total: 1 })
})

test('listPersonnelHandoverItems normalizes malformed payloads instead of leaking undefined', async () => {
  globalThis.fetch = async () => jsonResponse({ data: { items: null, total: '3' } })

  const result = await listPersonnelHandoverItems('change-2')

  assert.deepEqual(result, { items: [], total: 3 })
})

test('completePersonnelHandoverItem posts the successor and encodes identifiers', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { id: 'item 1', status: 'COMPLETED' } })
  }

  await completePersonnelHandoverItem('change/1', 'item 1', 'user-2')

  assert.equal(requested.url, '/api/v1/personnel-changes/change%2F1/handover-items/item%201/complete')
  assert.equal(requested.options.method, 'POST')
  assert.equal(requested.options.credentials, 'include')
  assert.deepEqual(JSON.parse(requested.options.body), { target_user_id: 'user-2' })
})

test('handover failures surface as PersonnelChangeError with the platform code', async () => {
  globalThis.fetch = async () => jsonResponse({ code: 'PLATFORM_FORBIDDEN', message: '无权限' }, { ok: false, status: 403 })

  await assert.rejects(
    () => completePersonnelHandoverItem('change-1', 'item-1', 'user-2'),
    (error) => {
      assert.ok(error instanceof PersonnelChangeError)
      assert.equal(error.status, 403)
      return true
    },
  )
})

test('交接重试走受控批次入口，列表保留远端回执状态和模式标记', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return jsonResponse({ data: url.endsWith('/retry') ? { id: 'batch-1', status: 'FROZEN' } : { cross_system_enabled: true, items: [{ id: 'item-1', batch_id: 'batch-1', status: 'PENDING', next_retry_at: '2026-10-22T12:00:00Z' }], total: 1 } })
  }
  const batch = await retryPersonnelHandover('change/1')
  assert.equal(batch.status, 'FROZEN')
  assert.equal(requests[0].url, '/api/v1/personnel-changes/change%2F1/handover/retry')
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(requests[0].options.body, '{}')
  const result = await listPersonnelHandoverItems('change/1')
  assert.equal(result.cross_system_enabled, true)
  assert.equal(result.items[0].status, 'PENDING')
  assert.equal(result.items[0].batch_id, 'batch-1')
})
