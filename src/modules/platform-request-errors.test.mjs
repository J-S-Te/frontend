import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequest } from './platform/shared/api/request.js'
import { AuthError, loginWithPassword, getCurrentPrincipal, refreshCurrentSession, changeOwnPassword, logoutCurrentSession } from './platform/auth/api/auth.js'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
class TestError extends Error { constructor(message, options = {}) { super(message); Object.assign(this, options) } }
const request = createRequest({ ErrorClass: TestError, networkMessage: '无法连接服务。', failureMessage: '操作失败。' })
const response = (status, body, type = 'application/json') => ({ status, ok: status >= 200 && status < 300, headers: { get: () => type }, json: async () => body, text: async () => typeof body === 'string' ? body : JSON.stringify(body) })

test('platform validation gives translated fields and retains class/status/code/diagnostic details', async () => {
  const body = { code: 'PLATFORM_VALIDATION_ERROR', message: 'validation error', request_id: 'req-001', details: { issues: [{ field: 'position_id', rule: 'required' }] } }
  globalThis.fetch = async () => response(422, body)
  await assert.rejects(request('/memberships', { method: 'POST', body: '{}' }), error => {
    assert.ok(error instanceof TestError)
    assert.equal(error.status, 422)
    assert.equal(error.code, body.code)
    assert.equal(error.details, body.details)
    assert.equal(error.requestID, 'req-001')
    assert.equal(error.fieldErrors[0].message, '请选择岗位。')
    assert.match(error.message, /请选择岗位/)
    return true
  })
})

test('platform no longer treats malformed JSON or 200 HTML as a completed write', async () => {
  for (const kind of ['html', 'bad-json', 'wrong-envelope', 'null']) {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      if (kind === 'html') return response(200, '<html>login</html>', 'text/html')
      if (kind === 'bad-json') return { ...response(201, null), json: async () => { throw new SyntaxError('private parser info') } }
      return response(201, kind === 'null' ? null : { result: 'not the contract' })
    }
    await assert.rejects(request('/users', { method: 'POST', body: '{}' }), error => error.code === 'INVALID_RESPONSE' && /确认操作结果.*核对/.test(error.message))
    assert.equal(calls, 1, 'writes must not be retried automatically')
  }
})

test('platform keeps authorization callbacks and does not leak proxy error pages', async () => {
  let callback
  const load = createRequest({ ErrorClass: TestError, failureMessage: '读取失败。', onUnauthorized: error => { callback = error } })
  globalThis.fetch = async () => response(401, { code: 'AUTH_UNAUTHENTICATED', message: 'unauthenticated' })
  await assert.rejects(load('/users'), error => error === callback && /重新登录/.test(error.message))
  globalThis.fetch = async () => response(502, '<html>private upstream</html>', 'text/html')
  await assert.rejects(load('/users'), error => error.status === 502 && !error.message.includes('private'))
})

test('204 remains a valid empty result and +json envelopes remain accepted', async () => {
  globalThis.fetch = async () => response(204, null)
  assert.equal(await request('/users/1', { method: 'DELETE' }), undefined)
  globalThis.fetch = async () => response(200, { data: { id: 1 } }, 'application/vnd.api+json')
  assert.deepEqual(await request('/users/1'), { id: 1 })
})

test('auth localizes non-JSON failures and treats successful malformed login as unconfirmed', async () => {
  globalThis.fetch = async () => response(502, '<html>private</html>', 'text/html')
  await assert.rejects(loginWithPassword({ account: 'test-user', password: 'test-password' }), error => error instanceof AuthError && error.status === 502 && !error.message.includes('private'))
  globalThis.fetch = async () => response(200, '<html>private</html>', 'text/html')
  await assert.rejects(loginWithPassword({ account: 'test-user', password: 'test-password' }), error => error instanceof AuthError && error.code === 'INVALID_RESPONSE')
})

const principalData = { tenant: { id: 'fixture-tenant' }, user: { id: 'fixture-user' }, account: { id: 'fixture-account' }, permission_codes: [], roles: [] }
const sessionData = { expires_at: '2027-01-01T00:00:00Z', redirect_url: '/portal', must_change_password: false }

test('auth rejects contradictory or incomplete 2xx JSON without changing the current session generation', async () => {
  let completePrincipal
  globalThis.fetch = () => new Promise(resolve => { completePrincipal = resolve })
  const principal = getCurrentPrincipal()
  for (const body of [{}, [], { code: 'OK' }, { code: 'OK', data: null }, { code: 'OK', data: {} }, { code: 'OK', data: [] }, { code: 'FORBIDDEN', data: sessionData, details: { reason: 'fixture' }, request_id: 'fixture-error' }, { code: 'OK', data: { ...sessionData, expires_at: 'not-a-date' } }]) {
    let calls = 0
    globalThis.fetch = async () => { calls++; return response(200, body) }
    await assert.rejects(loginWithPassword({ account: 'fixture', password: 'fixture' }), error => {
      assert.ok(error instanceof AuthError)
      assert.equal(error.code, 'INVALID_RESPONSE')
      assert.equal(error.status, 200)
      assert.equal(error.request_method, 'POST')
      assert.match(error.message, /确认操作结果.*核对/)
      if (body.code === 'FORBIDDEN') {
        assert.equal(error.responseCode, 'FORBIDDEN')
        assert.equal(error.requestID, 'fixture-error')
        assert.equal(error.details, body.details)
      }
      return true
    })
    assert.equal(calls, 1)
  }
  completePrincipal(response(200, { code: 'OK', data: principalData }))
  assert.equal((await principal).identity_id, 'fixture-user', 'an invalid login must not invalidate the previous account generation')
})

test('auth accepts real session contracts, retains account-switch guard and rejects missing principal data', async () => {
  for (const data of [{}, null, [], { user: { id: 'fixture-user' } }]) {
    globalThis.fetch = async () => response(200, { code: 'OK', data })
    await assert.rejects(getCurrentPrincipal(), error => error.code === 'INVALID_RESPONSE' && error.request_method === 'GET')
  }
  let completePrincipal
  globalThis.fetch = () => new Promise(resolve => { completePrincipal = resolve })
  const principal = getCurrentPrincipal()
  globalThis.fetch = async () => response(200, { code: 'OK', data: sessionData })
  assert.deepEqual((await loginWithPassword({ account: 'fixture', password: 'fixture' })).body.data, sessionData)
  completePrincipal(response(200, { code: 'OK', data: principalData }))
  await assert.rejects(principal, error => error.code === 'AUTH_SESSION_CHANGED')
  assert.deepEqual(await refreshCurrentSession(), sessionData)
  globalThis.fetch = async () => response(200, { code: 'OK', data: {} })
  assert.deepEqual((await changeOwnPassword({ currentPassword: 'fixture', newPassword: 'fixture-new' })).data, {})
  assert.deepEqual(await logoutCurrentSession(), {})
})

test('ErrorState reacts to prop updates and hides diagnostics unless explicitly requested', () => {
  const filename = new URL('./platform/shared/components/ErrorState.vue', import.meta.url)
  const source = readFileSync(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename: filename.pathname })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'friendly-error-state' })
  const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: 'friendly-error-state', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  assert.match(source, /const message = computed/)
  assert.match(source, /diagnostics: \{ type: Boolean, default: false \}/)
})
