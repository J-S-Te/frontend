import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequest } from './request.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

class TestError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'TestError'
    this.status = options.status || 0
    this.code = options.code || ''
  }
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => '',
  }
}

function buildRequest() {
  return createRequest({
    ErrorClass: TestError,
    networkMessage: '无法连接测试服务。',
    failureMessage: '测试请求失败。',
    subsystem: 'platform',
    feature: 'request-csrf',
  })
}

test('非 GET 请求统一携带 CSRF 标记头，且保留既有 Accept/Cache-Control/Content-Type', async () => {
  const request = buildRequest()
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ code: 'OK', data: { ok: true } })
  }

  await request('/write', { method: 'POST', body: JSON.stringify({ a: 1 }) })
  // 小写 method 与 PUT/PATCH/DELETE 同样是写请求。
  await request('/write-lower', { method: 'patch', body: JSON.stringify({ a: 1 }) })
  await request('/write-delete', { method: 'DELETE' })

  for (const call of calls) {
    assert.equal(call.options.headers['X-CSRF-Token'], '1')
    assert.equal(call.options.headers.Accept, 'application/json')
    assert.equal(call.options.headers['Cache-Control'], 'no-cache')
  }
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
})

test('GET 请求（含缺省 method）不携带 CSRF 标记头', async () => {
  const request = buildRequest()
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ code: 'OK', data: { ok: true } })
  }

  await request('/read')
  await request('/read-explicit', { method: 'GET' })

  for (const call of calls) {
    assert.equal(Object.hasOwn(call.options.headers, 'X-CSRF-Token'), false)
    assert.equal(call.options.headers.Accept, 'application/json')
  }
})

test('调用方显式传入的同名或自定义请求头不被统一管道覆盖', async () => {
  const request = buildRequest()
  let captured
  globalThis.fetch = async (url, options) => {
    captured = { url, options }
    return jsonResponse({ code: 'OK', data: { ok: true } })
  }

  await request('/write', {
    method: 'POST',
    body: JSON.stringify({ a: 1 }),
    headers: { 'X-CSRF-Token': 'token-from-caller', 'Idempotency-Key': 'idem-1', Accept: 'application/vnd.test+json' },
  })

  assert.equal(captured.options.headers['X-CSRF-Token'], 'token-from-caller')
  assert.equal(captured.options.headers['Idempotency-Key'], 'idem-1')
  assert.equal(captured.options.headers.Accept, 'application/vnd.test+json')
  assert.equal(captured.options.headers['Content-Type'], 'application/json')
})
