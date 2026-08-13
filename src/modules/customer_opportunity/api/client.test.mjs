import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCRMLoginURL, getCRMSession, request } from './client.js'

test('CRM login URL preserves the complete same-origin return path', () => {
  assert.equal(
    buildCRMLoginURL({ pathname: '/customer-opportunity/customers', search: '?page=2', hash: '#detail' }),
    '/customer-opportunity/auth/login?return_to=%2Fcustomer-opportunity%2Fcustomers%3Fpage%3D2%23detail',
  )
})

test('CRM auth session carries the unified authorization context fields', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => new Response(JSON.stringify({ data: {
    sub: 'identity-1', identity_id: 'identity-1', person_id: 'person-1',
    data_scopes: [{ scope_type: 'ORG', scope_id: 'org-1' }],
    authorization_revision: 12, catalog_version: 'crm-2026.08',
  } }), { status: 200, headers: { 'content-type': 'application/json' } })

  const session = await getCRMSession()
  assert.equal(session.identity_id, 'identity-1')
  assert.equal(session.person_id, 'person-1')
  assert.equal(session.authorization_revision, 12)
  assert.equal(session.catalog_version, 'crm-2026.08')
  assert.deepEqual(session.data_scopes, [{ scope_type: 'ORG', scope_id: 'org-1' }])
})

test('CRM does not turn invalid OIDC claims into an automatic login loop', async (t) => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  let redirect = ''
  t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow })
  globalThis.window = { location: { pathname: '/customer-opportunity', search: '', hash: '', replace: (value) => { redirect = value } } }
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'CRM_OIDC_INVALID_CLAIMS', message: 'OIDC authorization claims are invalid' }), { status: 401, headers: { 'content-type': 'application/json' } })

  await assert.rejects(request('/auth/me'), (error) => error.status === 401 && error.code === 'CRM_OIDC_INVALID_CLAIMS')
  assert.equal(redirect, '')
})
