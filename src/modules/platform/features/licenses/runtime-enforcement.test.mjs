import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import {
  RUNTIME_APPLICATIONS,
  RUNTIME_POLL_INTERVAL_MS,
  RuntimeEnforcementError,
  activateRuntimeEnforcement,
  allowedActionName,
  blockingReasonName,
  createRuntimeController,
  createRuntimeState,
  enforcementStatusName,
  getRuntimeEnforcement,
  getRuntimeEnforcementOverview,
  licenseStatusName,
  memberProgress,
  overviewActivationReady,
  overviewActivationVisible,
  overviewBlockingReasons,
  overviewImportSuggested,
  overviewIsRegistered,
  overviewIsUnregistered,
  registrationStatusName,
  runtimeObservationName,
  runtimeStateName,
  runtimeStatusName,
  validateEnforcementOverview,
} from './runtime-api.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

const CHECKED_AT = '2026-10-27T05:54:38Z'
const READY_MEMBER = Object.freeze({ ready_fresh:true, ack_current:true, service_id: 'contract-api', ready_at: '2026-10-27T05:50:00Z', issued_revision: 7, ack_revision: 7, ack_at: '2026-10-27T05:51:00Z' })
const snapshot = (revision = 3, application = 'contract_management', state = 'PENDING_ENFORCEMENT') => ({ application, state, revision, migration_eligible: false, members: [] })
// P1 overview 样例：默认未登记 + 商业授权有效 + 运行观察未接入。
const overview = (overrides = {}) => ({
  application: 'contract_management',
  environment: 'prod',
  license: { status: 'VALID', revision: 3, version: 1, not_before: 0, expires_at: 4102444800 },
  runtime: { status: 'UNKNOWN', available: false, message: '尚未接入运行观察', checked_at: CHECKED_AT },
  registration: { status: 'UNREGISTERED', member_count: 0, catalog_version: 0 },
  enforcement: { status: 'UNREGISTERED', revision: 0, deployment_revision: 0, snapshot_current: false, members: [] },
  preparation_operation: null,
  blocking_reasons: ['RUNTIME_NOT_REGISTERED'],
  allowed_actions: [],
  checked_at: CHECKED_AT,
  ...overrides,
})
const registeredOverview = (overrides = {}) => overview({
  registration: { status: 'REGISTERED', member_count: 1, catalog_version: 1 },
  enforcement: { status: 'PENDING_ENFORCEMENT', revision: 7, deployment_revision: 42, snapshot_current: true, members: [READY_MEMBER] },
  activation:{can_activate:true,status:'READY',total_count:1,ready_count:1,acknowledged_count:1,waiting_service_ids:[],waiting_since:null,wait_seconds:0,blocking_reasons:[]},
  blocking_reasons: [],
  ...overrides,
})
const response = (data, status = 200, code = '') => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => ({ data, code, message: '当前状态已变化' }) })
const controller = (state, overrides = {}) => createRuntimeController(state, { canRead: () => true, canManage: () => true, getOverview: async application => registeredOverview({ application }), activate: async () => {}, ...overrides })
const sourceOfView = () => readFileSync(new URL('./RuntimeEnforcementView.vue', import.meta.url), 'utf8')

function fakeTimers() {
  const intervals = []
  return {
    intervals,
    setInterval(handler, ms) { const entry = { handler, ms }; intervals.push(entry); return entry },
    clearInterval(entry) { const index = intervals.indexOf(entry); if (index >= 0) intervals.splice(index, 1) },
    async tick() { for (const entry of [...intervals]) await entry.handler() },
  }
}
function fakeDocument(visibilityState = 'visible') {
  const listeners = new Set()
  return {
    visibilityState,
    get listenerCount() { return listeners.size },
    addEventListener(type, handler) { if (type === 'visibilitychange') listeners.add(handler) },
    removeEventListener(type, handler) { if (type === 'visibilitychange') listeners.delete(handler) },
    dispatch() { for (const handler of [...listeners]) handler() },
  }
}

test('overview request is authenticated, uncached and strictly validated', async () => {
  assert.equal(RUNTIME_APPLICATIONS.length, 6)
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return response(overview()) }
  const data = await getRuntimeEnforcementOverview('contract_management')
  assert.equal(data.registration.status, 'UNREGISTERED')
  assert.deepEqual(requests.map(item => item.url), ['/api/v1/licenses/enforcement/contract_management/overview'])
  for (const { options } of requests) { assert.equal(options.credentials, 'include'); assert.equal(options.cache, 'no-store') }
  assert.throws(() => getRuntimeEnforcementOverview('../unregistered'), /支持/)
})

test('overview validation fails closed on malformed, unknown or inconsistent facts', () => {
  const valid = overview()
  assert.equal(validateEnforcementOverview(valid, 'contract_management'), valid)
  const withoutMessage = { ...valid.runtime }
  delete withoutMessage.message
  assert.doesNotThrow(() => validateEnforcementOverview({ ...valid, runtime: withoutMessage }, 'contract_management'), 'runtime.message 允许省略（Go omitempty）')
  const malformed = [
    { ...valid, application: 'settlement' },
    { ...valid, environment: 7 },
    { ...valid, license: { ...valid.license, status: 'PENDING' } },
    { ...valid, license: { ...valid.license, revision: -1 } },
    { ...valid, runtime: { ...valid.runtime, status: 'DOWN' } },
    { ...valid, runtime: { ...valid.runtime, available: 'false' } },
    { ...valid, runtime: { ...valid.runtime, checked_at: 'now' } },
    { ...valid, registration: { ...valid.registration, status: 'PARTIAL' } },
    { ...valid, registration: { ...valid.registration, member_count: 1.5 } },
    { ...valid, enforcement: { ...valid.enforcement, status: 'ACTIVE' } },
    { ...valid, enforcement: { ...valid.enforcement, snapshot_current: 'yes' } },
    { ...valid, enforcement: { ...valid.enforcement, members: 'none' } },
    { ...valid, enforcement: { ...valid.enforcement, members: [{ ...READY_MEMBER, service_id: ' ' }] } },
    { ...valid, enforcement: { ...valid.enforcement, members: [{ ...READY_MEMBER, ready_at: 'yesterday' }] } },
    { ...valid, blocking_reasons: ['license_missing'] },
    { ...valid, allowed_actions: 'IMPORT_LICENSE' },
    { ...valid, preparation_operation: { id: 'prepare' } },
    { ...valid, checked_at: '' },
    { ...valid, registration: { status: 'UNREGISTERED', member_count: 0, catalog_version: 0 }, enforcement: { ...valid.enforcement, status: 'ENFORCED' } },
  ]
  for (const payload of malformed) assert.throws(() => validateEnforcementOverview(payload, 'contract_management'), /格式异常/)
  assert.throws(() => validateEnforcementOverview(null, 'contract_management'), /格式异常/)
})

test('legacy enforcement snapshot and activation APIs stay compatible', async () => {
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

test('legacy injected snapshot getter remains readable for existing controller callers', async () => {
  const state = createRuntimeState()
  let writes = 0
  const view = createRuntimeController(state, {
    canRead: () => true,
    canManage: () => true,
    get: async application => snapshot(3, application),
    activate: async () => { writes++; throw Object.assign(new Error('socket private_value'), { code: 'NETWORK_ERROR', request_method: 'POST' }) },
  })
  await view.refresh()
  assert.equal(state.overview.enforcement.status, 'PENDING_ENFORCEMENT')
  assert.equal(state.overview.registration.status, 'REGISTERED')
  assert.equal(state.error, '')
  state.confirmed = true
  await view.activateSelected()
  assert.equal(state.error, '')
  assert.doesNotMatch(state.error, /socket|private_value/)
  assert.equal(state.confirmed, false)
  await view.activateSelected()
  assert.equal(writes, 0, '旧快照缺少激活资格，不能发起写操作')
})

test('unregistered overview stays visible as three facts and never auto-enrolls', async () => {
  const state = createRuntimeState()
  let activations = 0
  const view = controller(state, { getOverview: async application => overview({ application }), activate: async () => { activations++ } })
  await view.refresh()
  assert.equal(state.loading, false)
  assert.equal(state.error, '')
  assert.equal(state.fresh, true)
  assert.equal(state.overview.registration.status, 'UNREGISTERED')
  assert.equal(overviewIsUnregistered(state.overview), true)
  assert.equal(overviewActivationVisible(state.overview), false)
  assert.equal(overviewActivationReady(state.overview), false)
  assert.deepEqual(overviewBlockingReasons(state.overview), [{ code: 'RUNTIME_NOT_REGISTERED', name: '运行组件尚未登记' }])
  state.confirmed = true
  await view.activateSelected()
  assert.equal(activations, 0, '未登记时不得提交激活或自动纳管')
  const source = sourceOfView()
  assert.match(source, /未纳管/)
  assert.doesNotMatch(source, /state\.snapshot/)
  assert.doesNotMatch(source, /state\.notRegistered/)
})

test('unknown runtime observation is not interpreted as stopped', async () => {
  const state = createRuntimeState()
  await controller(state, { getOverview: async application => overview({ application }) }).refresh()
  assert.equal(state.overview.runtime.status, 'UNKNOWN')
  assert.equal(state.overview.runtime.available, false)
  assert.equal(runtimeObservationName(state.overview.runtime), '未接入观察')
  assert.doesNotMatch(runtimeObservationName(state.overview.runtime), /停止/)
  assert.equal(runtimeStatusName('RUNNING'), '运行中')
  assert.equal(runtimeStatusName('STOPPED'), '已停止')
  assert.match(sourceOfView(), /未知不等于已停止/)
})

test('invalid license facts expose blocking reasons and import action without implying enforcement', async () => {
  const expired = overview({
    license: { status: 'EXPIRED', revision: 4, version: 2, not_before: 100, expires_at: 200 },
    blocking_reasons: ['LICENSE_EXPIRED', 'RUNTIME_NOT_REGISTERED'],
    allowed_actions: ['IMPORT_LICENSE'],
  })
  const state = createRuntimeState()
  await controller(state, { getOverview: async () => expired }).refresh()
  assert.equal(licenseStatusName(state.overview.license.status), '已到期')
  assert.equal(overviewImportSuggested(state.overview), true)
  assert.deepEqual(overviewBlockingReasons(state.overview), [
    { code: 'LICENSE_EXPIRED', name: '商业授权已到期' },
    { code: 'RUNTIME_NOT_REGISTERED', name: '运行组件尚未登记' },
  ])
  assert.equal(blockingReasonName('LICENSE_MISSING'), '缺少商业授权')
  assert.equal(blockingReasonName('LICENSE_NOT_EFFECTIVE'), '商业授权尚未生效')
  assert.equal(blockingReasonName('UNKNOWN_CODE'), '其他阻塞原因，请联系授权管理员核对')
  assert.equal(allowedActionName('IMPORT_LICENSE'), '导入或续期商业授权')
  assert.equal(licenseStatusName('NO_LICENSE'), '未导入许可证')
  assert.equal(overviewActivationVisible(state.overview), false)
  assert.equal(overviewIsRegistered(state.overview), false)
  const source = sourceOfView()
  assert.match(source, /运行中不代表已授权/)
  assert.match(source, /许可证有效也不代表已强制执行/)
})

test('registered non-enforced systems expose activation with the enforcement revision; ENFORCED does not', async () => {
  const pending = registeredOverview()
  assert.equal(overviewActivationVisible(pending), true)
  assert.equal(overviewActivationReady(pending), true)
  const applying = registeredOverview({ enforcement: { ...registeredOverview().enforcement, status: 'APPLYING' } })
  assert.equal(overviewActivationVisible(applying), true)
  assert.equal(overviewActivationReady(applying), false, 'APPLYING只核对进度，不重复发起激活')
  const unknown = registeredOverview({ enforcement: { ...registeredOverview().enforcement, status: 'UNKNOWN' } })
  assert.equal(overviewActivationVisible(unknown), true, '已登记且非 ENFORCED 仍显示激活区域')
  assert.equal(overviewActivationReady(unknown), false, '执行状态未知时不允许提交激活')
  const enforced = registeredOverview({ enforcement: { ...registeredOverview().enforcement, status: 'ENFORCED' } })
  assert.equal(overviewActivationVisible(enforced), false)
  assert.equal(overviewActivationReady(enforced), false)
  assert.equal(runtimeStateName('ENFORCED'), '已强制执行')
  assert.equal(enforcementStatusName('UNREGISTERED'), '未纳管')
  assert.equal(registrationStatusName('REGISTERED'), '已登记')

  let sent = null
  const state = createRuntimeState()
  const view = controller(state, { getOverview: async () => pending, activate: async (application, revision) => { sent = { application, revision } } })
  await view.refresh()
  state.confirmed = true
  await view.activateSelected()
  assert.deepEqual(sent, { application: 'contract_management', revision: 7 })

  let writes = 0
  for (const payload of [enforced, unknown]) {
    const blockedState = createRuntimeState()
    const blockedView = controller(blockedState, { getOverview: async () => payload, activate: async () => { writes++ } })
    await blockedView.refresh()
    blockedState.confirmed = true
    await blockedView.activateSelected()
  }
  assert.equal(writes, 0)
})

test('late overview responses are discarded after switching system or unmounting', async () => {
  const state = createRuntimeState()
  let resolveOld
  const getOverview = application => application === 'contract_management'
    ? new Promise(resolve => { resolveOld = resolve })
    : Promise.resolve(overview({ application }))
  const view = controller(state, { getOverview })
  const initial = view.refresh()
  assert.equal(state.loading, true)
  const switching = view.select('settlement')
  assert.equal(state.application, 'settlement')
  assert.equal(state.overview, null, '切换系统立即清空上一系统事实')
  resolveOld(overview({ license: { status: 'EXPIRED', revision: 4, version: 2, not_before: 100, expires_at: 200 } }))
  await initial
  await switching
  assert.equal(state.overview.application, 'settlement')
  assert.equal(state.overview.license.status, 'VALID', '上一系统的迟到响应不得覆盖当前系统事实')
  assert.equal(state.error, '')

  const unmounted = createRuntimeState()
  let resolveLate
  const unmountedView = controller(unmounted, { getOverview: async () => new Promise(resolve => { resolveLate = resolve }) })
  const pendingRead = unmountedView.refresh()
  unmountedView.dispose()
  resolveLate(overview())
  await pendingRead
  assert.equal(unmounted.overview, null, '卸载后的迟到响应不得写入状态')
  assert.equal(unmounted.error, '')
  assert.equal(unmounted.fresh, false)
})

test('overview polls every 15 seconds only while visible, preserving confirmation, and stops on unmount', async () => {
  const state = createRuntimeState()
  const timers = fakeTimers()
  const doc = fakeDocument()
  let reads = 0
  const view = controller(state, {
    document: doc,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    getOverview: async application => { reads++; return registeredOverview({ application }) },
  })
  view.startPolling()
  assert.equal(RUNTIME_POLL_INTERVAL_MS, 15000)
  assert.equal(timers.intervals.length, 1)
  assert.equal(timers.intervals[0].ms, 15000, '页面可见时每 15 秒轮询')
  assert.equal(doc.listenerCount, 1)
  await timers.tick()
  assert.equal(reads, 1)
  assert.equal(state.overview.application, 'contract_management')
  state.confirmed = true
  await timers.tick()
  assert.equal(reads, 2)
  assert.equal(state.confirmed, true, '相同确认材料的轮询保留勾选')

  doc.visibilityState = 'hidden'
  doc.dispatch()
  assert.equal(timers.intervals.length, 0, '页面隐藏时暂停轮询')
  await timers.tick()
  assert.equal(reads, 2)
  doc.visibilityState = 'visible'
  doc.dispatch()
  assert.equal(timers.intervals.length, 1, '页面恢复可见后继续轮询')
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(reads, 3, '恢复可见立即读取，不等下个定时器')
  assert.equal(state.confirmed,false)
  view.dispose()
  assert.equal(timers.intervals.length, 0)
  assert.equal(doc.listenerCount, 0)

  const hiddenState = createRuntimeState()
  const hiddenTimers = fakeTimers()
  const hiddenDoc = fakeDocument('hidden')
  let hiddenReads = 0
  const hiddenView = controller(hiddenState, {
    document: hiddenDoc,
    setInterval: hiddenTimers.setInterval,
    clearInterval: hiddenTimers.clearInterval,
    getOverview: async () => { hiddenReads++; return overview() },
  })
  hiddenView.startPolling()
  assert.equal(hiddenTimers.intervals.length, 0, '隐藏页面开始时不得建立轮询')
  hiddenDoc.visibilityState = 'visible'
  hiddenDoc.dispatch()
  assert.equal(hiddenTimers.intervals.length, 1)
  await hiddenTimers.tick()
  assert.equal(hiddenReads, 1)
  hiddenView.dispose()
})

test('read and manage permissions plus explicit confirmation are independently enforced', async () => {
  const state = createRuntimeState()
  let reads = 0
  let writes = 0
  let allowedRead = false
  let allowedManage = false
  const view = controller(state, {
    canRead: () => allowedRead,
    canManage: () => allowedManage,
    getOverview: async application => { reads++; return registeredOverview({ application }) },
    activate: async () => { writes++ },
  })
  await view.refresh()
  assert.equal(reads, 0, '无查看权限不得请求概览')
  allowedRead = true
  await view.refresh()
  assert.equal(reads, 1)
  state.confirmed = true
  await view.activateSelected()
  assert.equal(writes, 0, '无管理权限不得提交激活')
  allowedManage = true
  state.confirmed = false
  await view.activateSelected()
  assert.equal(writes, 0, '必须显式确认')
  state.confirmed = true
  await view.activateSelected()
  assert.equal(writes, 1)
  assert.equal(state.confirmed, false)
})

test('activation conflict refreshes the overview revision and requires renewed confirmation', async () => {
  const state = createRuntimeState()
  let reads = 0
  let writes = 0
  const view = controller(state, {
    getOverview: async application => { reads++; return registeredOverview({ application, enforcement: { ...registeredOverview().enforcement, revision: reads } }) },
    activate: async (application, revision) => {
      writes++
      assert.equal(revision, 1)
      throw new RuntimeEnforcementError('修订冲突', { status: 409 })
    },
  })
  await view.refresh()
  assert.equal(state.overview.enforcement.revision, 1)
  state.confirmed = true
  await view.activateSelected()
  assert.equal(writes, 1)
  assert.equal(state.overview.enforcement.revision, 2)
  assert.equal(state.confirmed, false)
  assert.match(state.error, /重新读取概览/)
  await view.activateSelected()
  assert.equal(writes, 1, '冲突后不得自动重试')
})

test('read failures keep the last facts but block stale activation and switching clears them', async () => {
  const state = createRuntimeState()
  let fail = false
  let writes = 0
  const view = controller(state, {
    getOverview: async application => { if (fail) throw new Error('读取失败'); return registeredOverview({ application }) },
    activate: async () => { writes++ },
  })
  await view.refresh()
  assert.equal(state.fresh, true)
  fail = true
  await view.refresh()
  assert.equal(state.overview.registration.status, 'REGISTERED', '保留最后一次成功读取的事实')
  assert.equal(state.fresh, false)
  assert.match(state.error, /读取失败/)
  state.confirmed = true
  await view.activateSelected()
  assert.equal(writes, 0, '旧事实不得用于发起激活')
  await view.select('settlement')
  assert.equal(state.application, 'settlement')
  assert.equal(state.overview, null, '切换系统立即清空上一系统事实')
  assert.equal(state.fresh, false)
  assert.equal(state.confirmed, false)
})

test('concurrent activation is suppressed and full component readiness counters stay diagnostic', async () => {
  const state = createRuntimeState()
  let finish
  let writes = 0
  const view = controller(state, {
    getOverview: async application => registeredOverview({ application }),
    activate: async () => { writes++; await new Promise(resolve => { finish = resolve }) },
  })
  await view.refresh()
  state.confirmed = true
  const first = view.activateSelected()
  state.confirmed = true
  await view.activateSelected()
  assert.equal(writes, 1, '并发激活只允许一次提交')
  finish()
  await first
  assert.equal(state.busy, false)
  assert.deepEqual(memberProgress([READY_MEMBER]), { total: 1, ready: 1, acknowledged: 1 })
  assert.deepEqual(memberProgress([{ ...READY_MEMBER, ack_revision: 6 }, { ready_at: null, issued_revision: 0, ack_revision: 0 }]), { total: 2, ready: 1, acknowledged: 0 })
})

test('runtime Vue component compiles and continuously renders the three facts with disclaimers', () => {
  const filename = new URL('./RuntimeEnforcementView.vue', import.meta.url)
  const source = readFileSync(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename: filename.pathname })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'runtime-enforcement' })
  const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: 'runtime-enforcement', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  assert.equal(source.includes('oauth_client_id'), false)
  assert.match(source, /platform:license:read/)
  assert.match(source, /platform:license:manage/)
  assert.match(source, /系统运行/)
  assert.match(source, /商业授权/)
  assert.match(source, /运行时授权执行/)
  assert.match(source, /运行中不代表已授权/)
  assert.match(source, /许可证有效也不代表已强制执行/)
  assert.match(source, /未纳管/)
  assert.match(source, /未知不等于已停止/)
  assert.match(source, /controller\.refresh/)
  assert.match(source, /controller\.startPolling/)
  assert.match(source, /controller\.dispose/)
  assert.match(source, /v-if="activationVisible"/)
  assert.doesNotMatch(source, /state\.snapshot/)
  assert.doesNotMatch(source, /state\.notRegistered/)
  assert.doesNotMatch(source, /v-if="initialized"/)
})

test('activation confirmation is revoked when the execution or license revision changes', async () => {
 const state=createRuntimeState()
 let next=registeredOverview({activation:{can_activate:true,status:'READY',total_count:1,ready_count:1,acknowledged_count:1,waiting_service_ids:[],waiting_since:null,wait_seconds:0,blocking_reasons:[]}})
 const timers=fakeTimers()
 const c=controller(state,{getOverview:async()=>next,setInterval:timers.setInterval,clearInterval:timers.clearInterval})
 try {
  await c.refresh();state.confirmed=true;c.startPolling()
  next={...next,enforcement:{...next.enforcement,revision:8}}
  await timers.tick();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(state.confirmed,false)
 } finally { c.dispose() }
})

test('expired authorization and stale runtime cannot be submitted as activation-ready', () => {
 const ready={can_activate:false,status:'NOT_READY',total_count:1,ready_count:0,acknowledged_count:0,waiting_service_ids:['contract-api'],waiting_since:null,wait_seconds:0,blocking_reasons:['LICENSE_NOT_VALID','RUNTIME_READY_STALE']}
 assert.equal(overviewActivationReady(registeredOverview({license:{status:'EXPIRED'},activation:ready})),false)
 assert.deepEqual(memberProgress([{...READY_MEMBER,ready_fresh:false,ack_current:false}]),{total:1,ready:0,acknowledged:0})
})

test('activation request transmits the license revision bound to the confirmed overview', async () => {
 const requests=[]
 globalThis.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return response({applying:true})}
 await activateRuntimeEnforcement('contract_management',7,42)
 assert.equal(requests[0].expected_license_revision,42)
})

test('license-only changes and import invalidation revoke prior activation confirmation', async () => {
  const state = createRuntimeState()
  let next = registeredOverview()
  const timers = fakeTimers()
  const view = controller(state, { getOverview: async () => next, setInterval: timers.setInterval, clearInterval: timers.clearInterval })
  try {
    await view.refresh()
    view.startPolling()
    state.confirmed = true
    next = { ...next, license: { ...next.license, revision: 4 } }
    await timers.tick()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(state.confirmed, false)
    state.confirmed = true
    await view.invalidate()
    assert.equal(state.confirmed, false)
    assert.equal(state.fresh, true)
  } finally { view.dispose() }
})

test('initial activation does not require ACK of the revision that will only be issued after activation', () => {
  const value = registeredOverview()
  value.enforcement.members = [{ ...READY_MEMBER, ack_current: false, issued_revision: 0, ack_revision: 0 }]
  value.activation.acknowledged_count = 0
  assert.equal(overviewActivationReady(validateEnforcementOverview(value, value.application)), true)
})

test('APPLYING is read-only progress even if a stale checkbox is programmatically set', async () => {
  const state = createRuntimeState()
  let writes = 0
  const value = registeredOverview()
  value.enforcement.status = 'APPLYING'
  value.activation = { ...value.activation, can_activate: false, status: 'APPLYING' }
  const view = controller(state, { getOverview: async () => value, activate: async () => { writes++ } })
  await view.refresh()
  state.confirmed = true
  await view.activateSelected()
  assert.equal(writes, 0)
  assert.equal(state.confirmed, false)
})
