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
