import assert from 'node:assert/strict'
import test from 'node:test'

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

test('Portal session carries unified identity, scope and revision fields', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => jsonResponse({ data: {
    sub: 'portal-identity', person_id: 'portal-person', data_scopes: [{ scope_type: 'SELF' }],
    authorization_revision: 9, catalog_version: 'portal-v9', permissions: ['project.read'],
  } }, 200)
  const api = await import(`./portal.js?session=${Date.now()}`)
  const session = await api.getPortalSession({ force: true })
  assert.equal(session.identity_id, 'portal-identity')
  assert.equal(session.person_id, 'portal-person')
  assert.equal(session.authorization_revision, 9)
  assert.equal(session.catalog_version, 'portal-v9')
  assert.deepEqual(session.data_scopes, [{ scope_type: 'SELF' }])
})

test('Portal NOT_PROVISIONED is preserved and never starts another OIDC login', async (t) => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  let redirect = ''
  t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow })
  globalThis.window = { location: { pathname: '/customer-portal', search: '', hash: '', replace: (value) => { redirect = value } } }
  globalThis.fetch = async () => jsonResponse({ code: 'PORTAL_IDENTITY_NOT_PROVISIONED', message: 'portal identity is not provisioned', request_id: 'req-portal' }, 403)
  const api = await import(`./portal.js?not-provisioned=${Date.now()}`)

  await assert.rejects(api.ensurePortalSession(), (error) => error.code === 'PORTAL_IDENTITY_NOT_PROVISIONED' && error.requestID === 'req-portal')
  assert.equal(redirect, '')
})

test('Portal invalid claims are not collapsed into generic unauthenticated redirect', async (t) => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  let redirect = ''
  t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow })
  globalThis.window = { location: { pathname: '/customer-portal', search: '', hash: '', replace: (value) => { redirect = value } } }
  globalThis.fetch = async () => jsonResponse({ code: 'PORTAL_OIDC_INVALID_CLAIMS', message: 'OIDC claims are not valid for this application' }, 401)
  const api = await import(`./portal.js?invalid-claims=${Date.now()}`)

  await assert.rejects(api.ensurePortalSession(), (error) => error.code === 'PORTAL_OIDC_INVALID_CLAIMS')
  assert.equal(redirect, '')
})

test('Portal plain 401 triggers OIDC login instead of silently returning null', async (t) => {
  // 修复前：ensurePortalSession 对 401 仅返回 null，不发起跳转 → 用户点击
  // 客户自助门户卡片后路由守卫静默中止，页面空白。
  // 修复后：真正未鉴权（无 OIDC_CLAIMS_INVALID / IDENTITY_NOT_PROVISIONED
  // 等特殊码）必须调用 beginLogin() 跳转 Keycloak。
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  let redirect = ''
  t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow })
  globalThis.window = { location: { pathname: '/customer-portal/projects', search: '', hash: '', replace: (value) => { redirect = value } } }
  globalThis.fetch = async () => jsonResponse({ code: 'SESSION_EXPIRED', message: 'session expired' }, 401)
  const api = await import(`./portal.js?plain401=${Date.now()}`)

  const result = await api.ensurePortalSession()
  assert.equal(result, null, 'should resolve to null after triggering login')
  assert.match(redirect, /\/auth\/login/, 'should redirect to portal OIDC login')
  assert.match(redirect, /return_to=/, 'should preserve current path for post-login return')
})
