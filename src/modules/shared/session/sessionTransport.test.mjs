import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionTransport, sessionTargetForRoute } from './sessionTransport.js'

test('each independently authenticated route uses its own cookie endpoint', () => {
  for (const [name, prefix] of [['Platform', '/api/v1/auth/me'], ['Contract', '/contract_management/auth/session'],
    ['Project', '/project_management/auth/session'], ['Settlement', '/settlement/auth/session'],
    ['CRM', '/customer-opportunity/auth/session'], ['Portal', '/customer-portal/auth/session'],
    ['DataAnalysis', '/data_analysis/auth/session']]) {
    assert.equal(sessionTargetForRoute({ [`requires${name}Session`]: true }, {}).stateURL, prefix)
  }
  assert.equal(sessionTargetForRoute({}, {}), null)
  assert.throws(() => sessionTargetForRoute({ requiresPlatformSession: true, requiresCRMSession: true }, {}))
})

test('transport uses same-origin HttpOnly cookies and explicit CSRF without exposing binding tokens', async () => {
  const calls = []
  const transport = createSessionTransport({ origin: 'https://test.example', fetchImpl: async (...args) => {
    calls.push(args)
    return new Response(JSON.stringify({ data: { session_context: { session_id: 'bound' } } }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } })
  const target = sessionTargetForRoute({ requiresCRMSession: true }, {})
  assert.equal((await transport.read(target)).session_id, 'bound')
  await transport.activity(target)
  assert.equal(calls[1][1].method, 'POST')
  assert.equal(calls[1][1].credentials, 'include')
  assert.equal(calls[1][1].headers['X-CSRF-Token'], '1')
  assert.equal(calls[1][1].headers.Authorization, undefined)
  await assert.rejects(transport.read({ ...target, stateURL: 'https://evil.example/auth/session' }), { status: 503 })
  assert.equal(calls.length, 2)
})

test('confirmed unauthorized responses remain distinguishable from transient or malformed responses', async () => {
  const target = sessionTargetForRoute({ requiresProjectSession: true }, {})
  for (const status of [401, 503]) {
    const transport = createSessionTransport({ origin: 'https://test.example',
      fetchImpl: async () => new Response('', { status }) })
    await assert.rejects(transport.read(target), { status })
  }
  const html = createSessionTransport({ origin: 'https://test.example',
    fetchImpl: async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }) })
  await assert.rejects(html.read(target), { status: 503 })
})
