import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { RUNTIME_APPLICATIONS, RuntimeEnforcementError, activateRuntimeEnforcement, createRuntimeController, createRuntimeState, getRuntimeEnforcement, memberProgress, runtimeStateName } from './runtime-api.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
const snapshot = (revision = 3, application = 'contract_management', state = 'PENDING_ENFORCEMENT') => ({ application, state, revision, migration_eligible: false, members: [] })
const response = (data, status = 200, code = '') => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => ({ data, code, message: '当前状态已变化' }) })
const controller = (state, overrides = {}) => createRuntimeController(state, { canRead: () => true, canManage: () => true, get: async application => snapshot(3, application), activate: async () => {}, ...overrides })

test('six application API reads are authenticated, uncached and activation only sends expected revision', async () => {
  assert.equal(RUNTIME_APPLICATIONS.length, 6)
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response(snapshot()) }
  assert.equal((await getRuntimeEnforcement('contract_management')).revision, 3)
  await activateRuntimeEnforcement('contract_management', 3)
  assert.deepEqual(calls.map(item => item.url), ['/api/v1/licenses/enforcement/contract_management', '/api/v1/licenses/enforcement/contract_management/activation'])
  assert.deepEqual(JSON.parse(calls[1].options.body), { expected_revision: 3 })
  calls.forEach(({ options }) => { assert.equal(options.credentials, 'include'); assert.equal(options.cache, 'no-store') })
  assert.throws(() => getRuntimeEnforcement('../unregistered'), /支持/)
  assert.throws(() => activateRuntimeEnforcement('settlement', NaN), /修订/)
})
test('unregistered 409 is a visible not-ready condition, not an empty success or automatic enrollment', async () => {
  const state = createRuntimeState(); let activations = 0
  const view = controller(state, { get: async () => { throw new RuntimeEnforcementError('missing', { status: 409, code: 'LICENSE_RUNTIME_NOT_READY' }) }, activate: async () => { activations++ } })
  await view.refresh(); state.confirmed = true; await view.activateSelected()
  assert.equal(state.notRegistered, true); assert.equal(state.snapshot, null); assert.match(state.error, /尚未受控登记/); assert.equal(activations, 0)
})
test('read and manage permissions plus explicit confirmation are independently enforced', async () => {
  const state = createRuntimeState(); let reads = 0; let writes = 0; let allowedRead = false; let allowedManage = false
  const view = controller(state, { canRead: () => allowedRead, canManage: () => allowedManage, get: async () => { reads++; return snapshot() }, activate: async () => { writes++ } })
  await view.refresh(); assert.equal(reads, 0)
  allowedRead = true; await view.refresh(); state.confirmed = true; await view.activateSelected(); assert.equal(writes, 0)
  allowedManage = true; state.confirmed = false; await view.activateSelected(); assert.equal(writes, 0)
  state.confirmed = true; await view.activateSelected(); assert.equal(writes, 1); assert.equal(state.confirmed, false)
})
test('all services ready and acknowledged never synthesize ENFORCED state', async () => {
  const row = { service_id: 'api', ready_at: '2026-10-09T01:00:00Z', issued_revision: 3, ack_revision: 3, ack_at: '2026-10-09T01:00:00Z' }
  assert.deepEqual(memberProgress([row]), { total: 1, ready: 1, acknowledged: 1 })
  const state = createRuntimeState(); await controller(state, { get: async () => ({ ...snapshot(), members: [row] }) }).refresh()
  assert.equal(runtimeStateName(state.snapshot.state), '待激活')
  assert.deepEqual(memberProgress([{ ...row, ack_revision: 2 }, { ready_at: '0001-01-01T00:00:00Z', issued_revision: 0, ack_revision: 0 }]), { total: 2, ready: 1, acknowledged: 0 })
})
test('activation conflict refreshes revision and requires renewed confirmation; no automatic retry', async () => {
  const state = createRuntimeState(); let reads = 0; let writes = 0
  const view = controller(state, { get: async () => snapshot(++reads), activate: async (application, revision) => { writes++; assert.equal(revision, 1); throw new RuntimeEnforcementError('修订冲突', { status: 409 }) } })
  await view.refresh(); state.confirmed = true; await view.activateSelected()
  assert.equal(writes, 1); assert.equal(state.snapshot.revision, 2); assert.equal(state.confirmed, false); assert.match(state.error, /重新读取/)
  await view.activateSelected(); assert.equal(writes, 1)
})
test('read failures preserve last snapshot but prevent stale activation; switch clears previous application', async () => {
  const state = createRuntimeState(); let fail = false; let writes = 0
  const view = controller(state, { get: async application => { if (fail) throw new Error('读取失败'); return snapshot(3, application) }, activate: async () => { writes++ } })
  await view.refresh(); fail = true; await view.refresh(); state.confirmed = true; await view.activateSelected()
  assert.equal(state.snapshot.revision, 3); assert.equal(state.fresh, false); assert.equal(writes, 0)
  await view.select('settlement'); assert.equal(state.snapshot, null); assert.equal(state.confirmed, false); assert.equal(state.application, 'settlement')
})
test('mismatched application/unknown states fail closed and concurrent activation is suppressed', async () => {
  globalThis.fetch = async () => response(snapshot(3, 'settlement'))
  await assert.rejects(getRuntimeEnforcement('contract_management'), /格式异常/)
  const state = createRuntimeState(); let finish; let writes = 0
  const view = controller(state, { activate: async () => { writes++; await new Promise(resolve => { finish = resolve }) } })
  await view.refresh(); state.confirmed = true; const first = view.activateSelected(); state.confirmed = true; await view.activateSelected(); assert.equal(writes, 1); finish(); await first
  state.snapshot = snapshot(3, 'contract_management', 'ENFORCED'); state.confirmed = true; await view.activateSelected(); assert.equal(writes, 1)
})
test('runtime Vue component compiles and does not display OAuth client identifiers', () => {
  const filename = new URL('./RuntimeEnforcementView.vue', import.meta.url); const source = readFileSync(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename: filename.pathname }); assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'runtime-enforcement' }); const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: 'runtime-enforcement', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, []); assert.equal(source.includes('oauth_client_id'), false); assert.match(source, /platform:license:read/); assert.match(source, /platform:license:manage/)
})
