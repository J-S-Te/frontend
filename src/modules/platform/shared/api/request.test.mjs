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

test('平台真实请求管道保留顶层字段坐标，不只把字段提示拼成一句话', async () => {
  const request = buildRequest()
  const fields = [{ field: 'display_name', rule: 'required' }]
  globalThis.fetch = async () => jsonResponse({ code: 'PLATFORM_VALIDATION_ERROR',
    message: '请求参数不合法', field_errors: fields }, { ok: false, status: 422 })
  await assert.rejects(request('/employees', { method: 'POST' }), error => {
    assert.match(error.message, /姓名/)
    assert.equal(error.fieldErrors[0].field, 'display_name')
    assert.deepEqual(error.details, fields)
    return true
  })
})

test('平台写入通用内部错误保留结果未知标记，确定业务拒绝不标记未知', async () => {
  const request = buildRequest()
  globalThis.fetch = async () => jsonResponse({ code: 'PLATFORM_INTERNAL_ERROR',
    message: '服务处理失败' }, { ok: false, status: 500 })
  await assert.rejects(request('/employees', { method: 'POST' }), error => {
    assert.equal(error.outcomeUnknown, true)
    assert.match(error.message, /核对.*重复提交/)
    return true
  })
  const reason = '审批流程缺少可用审批人，本次未提交。请联系管理员补充审批人员后重试。'
  globalThis.fetch = async () => jsonResponse({ code: 'APPROVAL_SETUP_MISSING',
    message: reason }, { ok: false, status: 503 })
  await assert.rejects(request('/employees', { method: 'POST' }), error => {
    assert.notEqual(error.outcomeUnknown, true)
    assert.equal(error.message, reason)
    return true
  })
})
