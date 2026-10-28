import { createRequest } from '../../shared/api/request.js'
import { formatUserError } from '../../../shared/utils/userError.js'

export const RUNTIME_APPLICATIONS = Object.freeze([
  { code: 'contract_management', name: '合同管理' },
  { code: 'customer_and_opportunity', name: '客户与商机管理' },
  { code: 'project_management', name: '项目服务管理' },
  { code: 'settlement', name: '结算与开票管理' },
  { code: 'data_analysis', name: '数据看板与统计分析' },
  { code: 'customer_portal', name: '客户门户' },
])
const validApplications = new Set(RUNTIME_APPLICATIONS.map(item => item.code))
export class RuntimeEnforcementError extends Error {
  constructor(message, options = {}) { super(message); this.name = 'RuntimeEnforcementError'; this.status = options.status || 0; this.code = options.code || '' }
}
const request = createRequest({ ErrorClass: RuntimeEnforcementError, networkMessage: '运行时授权服务暂时无法连接，请重试。', failureMessage: '运行时授权操作失败。', feature: 'licenses' })
function applicationPath(application) {
  if (!validApplications.has(application)) throw new RuntimeEnforcementError('请选择支持的业务系统。')
  return `/licenses/enforcement/${application}`
}

// 旧版执行快照与激活接口保持不变：P1 只叠加只读概览，不改写这两个契约。
export function validateEnforcementSnapshot(data, application) {
  if (!data || data.application !== application || !['PENDING_ENFORCEMENT', 'APPLYING', 'ENFORCED'].includes(data.state) || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.members)) {
    throw new RuntimeEnforcementError('服务端执行状态格式异常，请重新读取；不能据此发起激活。')
  }
  return data
}
export const getRuntimeEnforcement = application => request(applicationPath(application)).then(data => validateEnforcementSnapshot(data, application))
// activateRuntimeEnforcement 用途：提交明确确认的执行修订与可选许可修订。
// 参数：application 为系统，revision 为执行修订，licenseRevision 为用户看到的许可修订。
// 返回值：返回受理结果；修订非法或请求失败时抛出错误。
export function activateRuntimeEnforcement(application, revision, licenseRevision) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new RuntimeEnforcementError('执行状态修订无效，请先刷新。')
  const body = { expected_revision: revision }
  if (licenseRevision !== undefined) {
    if (!Number.isSafeInteger(licenseRevision) || licenseRevision < 0) throw new RuntimeEnforcementError('许可修订无效，请重新读取。')
    body.expected_license_revision = licenseRevision
  }
  return request(`${applicationPath(application)}/activation`, { method: 'POST', body: JSON.stringify(body) })
}
export const runtimeStateName = state => ({ PENDING_ENFORCEMENT: '待激活', APPLYING: '正在应用', ENFORCED: '已强制执行' })[state] || '未知状态'
export const runtimeTimestampPresent = value => Boolean(value && value !== '0001-01-01T00:00:00Z')
// memberProgress 用途：只统计服务端确认的新鲜 READY 与当前修订 ACK。
// 参数：members 为服务端成员事实；旧协议没有确认标记时按未核验处理。
// 返回值：返回总数、已准备数及已确认数。
export function memberProgress(members = []) {
 return { total: members.length, ready: members.filter(m=>m.ready_fresh===true).length,
  acknowledged:members.filter(m=>m.ack_current===true && m.issued_revision>0 && m.ack_revision===m.issued_revision).length }
}

// P1 只读概览契约：GET /licenses/enforcement/{application}/overview。
// 枚举与字段与 .ai/qa/license-enrollment-compat-20261027/p1-contract.md 严格对齐；
// 任何未知状态或格式偏差都必须失败关闭，不能在页面里“猜测”授权结论。
export const LICENSE_STATUSES = Object.freeze(['VALID', 'NO_LICENSE', 'NOT_PURCHASED', 'NOT_EFFECTIVE', 'EXPIRED', 'INVALID'])
export const RUNTIME_STATUSES = Object.freeze(['RUNNING', 'PARTIAL', 'STOPPED', 'NOT_FOUND', 'UNKNOWN'])
export const REGISTRATION_STATUSES = Object.freeze(['REGISTERED', 'UNREGISTERED', 'UNKNOWN'])
export const ENFORCEMENT_STATUSES = Object.freeze(['PENDING_ENFORCEMENT', 'APPLYING', 'ENFORCED', 'UNREGISTERED', 'UNKNOWN'])
const licenseStatusSet = new Set(LICENSE_STATUSES)
const runtimeStatusSet = new Set(RUNTIME_STATUSES)
const registrationStatusSet = new Set(REGISTRATION_STATUSES)
const enforcementStatusSet = new Set(ENFORCEMENT_STATUSES)
export const RUNTIME_POLL_INTERVAL_MS = 15000
const OVERVIEW_INVALID_MESSAGE = '运行时授权概览数据格式异常，请重新读取；不能据此判断授权或执行状态。'
const RECORD_CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isCount = value => Number.isSafeInteger(value) && value >= 0
const isTimestamp = value => typeof value === 'string' && RFC3339.test(value)
const isNullableTimestamp = value => value === null || isTimestamp(value)
const invalidOverview = () => new RuntimeEnforcementError(OVERVIEW_INVALID_MESSAGE, { code: 'INVALID_OVERVIEW_RESPONSE' })

// validateEnforcementOverview 用途：校验服务端概览及可选激活资格，异常时禁止提交。
// 参数：data 为概览数据，application 为当前选择的系统。
// 返回值：返回有效概览；不符合契约时抛出错误。
export function validateEnforcementOverview(data, application) {
  if (!isRecord(data) || data.application !== application || typeof data.environment !== 'string') throw invalidOverview()
  const { license, runtime, registration, enforcement } = data
  if (!isRecord(license) || !licenseStatusSet.has(license.status) || !isCount(license.revision) || !isCount(license.version) || !isCount(license.not_before) || !isCount(license.expires_at)) throw invalidOverview()
  if (!isRecord(runtime) || !runtimeStatusSet.has(runtime.status) || typeof runtime.available !== 'boolean' || !isTimestamp(runtime.checked_at) || (runtime.message !== undefined && typeof runtime.message !== 'string')) throw invalidOverview()
  if (!isRecord(registration) || !registrationStatusSet.has(registration.status) || !isCount(registration.member_count) || !isCount(registration.catalog_version)) throw invalidOverview()
  if (!isRecord(enforcement) || !enforcementStatusSet.has(enforcement.status) || !isCount(enforcement.revision) || !isCount(enforcement.deployment_revision) || typeof enforcement.snapshot_current !== 'boolean' || !Array.isArray(enforcement.members)) throw invalidOverview()
  for (const member of enforcement.members) {
    if (!isRecord(member) || typeof member.service_id !== 'string' || !member.service_id.trim() || !isCount(member.issued_revision) || !isCount(member.ack_revision) || !isNullableTimestamp(member.ready_at) || !isNullableTimestamp(member.ack_at)) throw invalidOverview()
  }
  if (data.activation !== undefined) validateActivationFacts(data.activation, enforcement.members.length)
  if (!Array.isArray(data.blocking_reasons) || !data.blocking_reasons.every(code => typeof code === 'string' && RECORD_CODE.test(code))) throw invalidOverview()
  if (!Array.isArray(data.allowed_actions) || !data.allowed_actions.every(code => typeof code === 'string' && RECORD_CODE.test(code))) throw invalidOverview()
  if (data.preparation_operation !== null && data.preparation_operation !== undefined) throw invalidOverview()
  if (!isTimestamp(data.checked_at)) throw invalidOverview()
  if (registration.status === 'UNREGISTERED' && enforcement.status !== 'UNREGISTERED') throw invalidOverview()
  return data
}
export const getRuntimeEnforcementOverview = application => request(`${applicationPath(application)}/overview`).then(data => validateEnforcementOverview(data, application))

// 三项事实的展示名称与色调。UNKNOWN 永远不能显示成“已停止”，运行观察不可用
// 也不能被解释为授权结论。
const LICENSE_STATUS_NAMES = Object.freeze({ VALID: '有效', NO_LICENSE: '未导入许可证', NOT_PURCHASED: '未购买', NOT_EFFECTIVE: '尚未生效', EXPIRED: '已到期', INVALID: '校验异常' })
const RUNTIME_STATUS_NAMES = Object.freeze({ RUNNING: '运行中', PARTIAL: '部分运行', STOPPED: '已停止', NOT_FOUND: '未发现', UNKNOWN: '状态未知' })
const REGISTRATION_STATUS_NAMES = Object.freeze({ REGISTERED: '已登记', UNREGISTERED: '未纳管', UNKNOWN: '状态未知' })
const ENFORCEMENT_STATUS_NAMES = Object.freeze({ PENDING_ENFORCEMENT: '待激活', APPLYING: '正在应用', ENFORCED: '已强制执行', UNREGISTERED: '未纳管', UNKNOWN: '状态未知' })
const BLOCKING_REASON_NAMES = Object.freeze({
  LICENSE_MISSING: '缺少商业授权',
  LICENSE_EXPIRED: '商业授权已到期',
  LICENSE_NOT_EFFECTIVE: '商业授权尚未生效',
  LICENSE_STATE_INVALID: '许可证状态异常',
  RUNTIME_NOT_REGISTERED: '运行组件尚未登记',
  LICENSE_NOT_VALID: '当前商业授权不满足激活条件',
  RUNTIME_MEMBERS_MISSING: '尚无登记组件',
  RUNTIME_READY_STALE: '部分组件尚未就绪或准备信号已过期',
})
const ALLOWED_ACTION_NAMES = Object.freeze({ IMPORT_LICENSE: '导入或续期商业授权', OPEN_ACCESS_WIZARD: '检查接入与运行许可接线' })
export const licenseStatusName = status => LICENSE_STATUS_NAMES[status] || '状态未知'
export const runtimeStatusName = status => RUNTIME_STATUS_NAMES[status] || '状态未知'
export const registrationStatusName = status => REGISTRATION_STATUS_NAMES[status] || '状态未知'
export const enforcementStatusName = status => ENFORCEMENT_STATUS_NAMES[status] || '状态未知'
export const blockingReasonName = code => BLOCKING_REASON_NAMES[code] || '其他阻塞原因，请联系授权管理员核对'
export const allowedActionName = action => ALLOWED_ACTION_NAMES[action] || '其他受控操作'
export function runtimeObservationName(runtime) {
  if (!runtime) return '状态未知'
  if (runtime.status === 'UNKNOWN' && !runtime.available) return '未接入观察'
  return runtimeStatusName(runtime.status)
}
export const licenseTone = status => ({ VALID: 'success', NOT_EFFECTIVE: 'info', NO_LICENSE: 'pending', NOT_PURCHASED: 'pending', EXPIRED: 'danger', INVALID: 'danger' })[status] || 'muted'
export const runtimeTone = status => ({ RUNNING: 'success', PARTIAL: 'info', NOT_FOUND: 'pending', STOPPED: 'danger', UNKNOWN: 'muted' })[status] || 'muted'
export const enforcementTone = status => ({ ENFORCED: 'success', APPLYING: 'info', PENDING_ENFORCEMENT: 'pending' })[status] || 'muted'

export const overviewIsRegistered = overview => Boolean(overview) && overview.registration.status === 'REGISTERED'
export const overviewIsUnregistered = overview => Boolean(overview) && overview.registration.status === 'UNREGISTERED'
// 只有已登记且非 ENFORCED 才显示原激活区域；UNREGISTERED/ENFORCED 一律不显示。
export const overviewActivationVisible = overview => overviewIsRegistered(overview) && overview.enforcement.status !== 'ENFORCED'
// 可提交激活还需要服务端处于可推进状态；UNKNOWN 等状态只展示事实，不允许提交。
// overviewActivationReady 用途：只接受后端明确给出的初次激活资格。
// 参数：overview 为最近一次概览。
// 返回值：返回是否可发起激活；等待中只允许核对进度。
export const overviewActivationReady = overview => overviewIsRegistered(overview) && overview.license.status === 'VALID' && overview.enforcement.status === 'PENDING_ENFORCEMENT' && overview.activation?.can_activate === true && overview.activation.status === 'READY'
export const overviewImportSuggested = overview => Boolean(overview) && overview.allowed_actions.includes('IMPORT_LICENSE')
export const overviewBlockingReasons = (overview = null) => (overview?.blocking_reasons || []).map(code => ({ code, name: blockingReasonName(code) }))
export const overviewAllowedActions = (overview = null) => (overview?.allowed_actions || []).map(code => ({ code, name: allowedActionName(code) }))

// 兼容旧控制器注入入口（options.get 旧执行快照）：仅用于既有测试与过渡调用方。
// 概览页面自身始终使用 getRuntimeEnforcementOverview；此处把旧快照换算成概览的
// 登记与执行事实，许可证与运行观察按失败关闭呈现，绝不伪造“有效/已强制执行”。
const LEGACY_CHECKED_AT = '1970-01-01T00:00:00Z'
function legacySnapshotOverview(snapshot, application) {
  validateEnforcementSnapshot(snapshot, application)
  const members = snapshot.members.flatMap(member => {
    if (!isRecord(member) || typeof member.service_id !== 'string' || !member.service_id.trim()) return []
    return [{
      service_id: member.service_id,
      ready_at: isTimestamp(member.ready_at) ? member.ready_at : null,
      issued_revision: isCount(member.issued_revision) ? member.issued_revision : 0,
      ack_revision: isCount(member.ack_revision) ? member.ack_revision : 0,
      ack_at: isTimestamp(member.ack_at) ? member.ack_at : null,
    }]
  })
  return {
    application,
    environment: '',
    license: { status: 'INVALID', revision: 0, version: 0, not_before: 0, expires_at: 0 },
    runtime: { status: 'UNKNOWN', available: false, message: '尚未接入运行观察', checked_at: isTimestamp(snapshot.updated_at) ? snapshot.updated_at : LEGACY_CHECKED_AT },
    registration: { status: 'REGISTERED', member_count: members.length, catalog_version: 0 },
    enforcement: { status: snapshot.state, revision: snapshot.revision, deployment_revision: isCount(snapshot.deployment_revision) ? snapshot.deployment_revision : 0, snapshot_current: true, members },
    preparation_operation: null,
    blocking_reasons: ['LICENSE_STATE_INVALID'],
    allowed_actions: ['IMPORT_LICENSE'],
    checked_at: isTimestamp(snapshot.updated_at) ? snapshot.updated_at : LEGACY_CHECKED_AT,
  }
}

// validateActivationFacts 用途：校验新增激活投影，异常字段不能用于发起写操作。
// 参数：facts 为激活事实，memberCount 为成员数。
// 返回值：无；不合法时抛出概览错误。
function validateActivationFacts(facts, memberCount) {
 if (!isRecord(facts) || typeof facts.can_activate !== 'boolean' || !['NOT_READY','READY','APPLYING','STALLED','ENFORCED','UNAVAILABLE'].includes(facts.status) ||
  !isCount(facts.total_count) || facts.total_count!==memberCount || !isCount(facts.ready_count) || !isCount(facts.acknowledged_count) || facts.ready_count>memberCount || facts.acknowledged_count>memberCount ||
  !Array.isArray(facts.waiting_service_ids) || !facts.waiting_service_ids.every(id=>typeof id==='string'&&id) || !isNullableTimestamp(facts.waiting_since) || !isCount(facts.wait_seconds) ||
  !Array.isArray(facts.blocking_reasons) || !facts.blocking_reasons.every(code=>typeof code==='string'&&RECORD_CODE.test(code))) throw invalidOverview()
 if (facts.can_activate && (facts.status!=='READY' || memberCount===0 || facts.ready_count!==memberCount || facts.blocking_reasons.length)) throw invalidOverview()
}

// activationConfirmationKey 用途：把用户确认绑定到应用、环境、许可与执行修订。
// 参数：overview 为服务端概览。
// 返回值：返回稳定指纹；没有概览时返回空值。
function activationConfirmationKey(overview) {
  if (!overview) return ''
  return JSON.stringify([
    overview.application, overview.environment, overview.license, overview.registration,
    overview.enforcement.revision, overview.enforcement.members.map(member => member.service_id).sort(),
  ])
}

// runtimeAccessEnvironment 用途：把受控环境别名转换为接入向导支持的环境码。
// 参数：environment 为服务端环境。
// 返回值：返回已知环境码；未知值返回空字符串，不猜测目标。
export function runtimeAccessEnvironment(environment) {
  const normalized = String(environment || '').trim().toLowerCase()
  const code = ({ production: 'prod', development: 'dev', testing: 'test' })[normalized] || normalized
  return ['dev', 'test', 'staging', 'prod'].includes(code) ? code : ''
}

// 与 Vue 响应式对象和测试共用同一套状态：overview 是主状态，旧快照不再由本页面读取。
export function createRuntimeState() { return { application: 'contract_management', overview: null, fresh: false, loading: false, busy: false, error: '', confirmed: false } }
// createRuntimeController 用途：管理概览刷新、确认绑定、轮询和单次激活。
// 参数：state 为页面状态，options 为权限、接口、计时器等依赖。
// 返回值：返回读取、选择、激活、失效与释放方法。
export function createRuntimeController(state, options = {}) {
  const canRead = options.canRead || (() => false)
  const canManage = options.canManage || (() => false)
  const legacyGet = typeof options.get === 'function' ? options.get : null
  const getOverview = options.getOverview || (legacyGet ? async application => legacySnapshotOverview(await legacyGet(application), application) : getRuntimeEnforcementOverview)
  const activate = options.activate || activateRuntimeEnforcement
  const pollIntervalMs = Number.isSafeInteger(options.pollIntervalMs) && options.pollIntervalMs > 0 ? options.pollIntervalMs : RUNTIME_POLL_INTERVAL_MS
  const doc = options.document === undefined ? (typeof document === 'undefined' ? null : document) : options.document
  const setIntervalFn = options.setInterval || ((handler, ms) => globalThis.setInterval(handler, ms))
  const clearIntervalFn = options.clearInterval || (id => globalThis.clearInterval(id))
  let generation = 0
  let readFailure = false
  let pollTimer = null
  let pollingActive = false
  let visibilityBound = false
  let disposed = false
  const pageHidden = () => Boolean(doc && doc.visibilityState === 'hidden')
  function clearPollTimer() { if (pollTimer !== null) { clearIntervalFn(pollTimer); pollTimer = null } }
  function ensurePollTimer() {
    if (disposed || !pollingActive || pollTimer !== null || pageHidden()) return
    pollTimer = setIntervalFn(poll, pollIntervalMs)
  }
  // onVisibilityChange 用途：隐藏时撤销旧确认，恢复可见时立即重新核对事实。
  // 参数：无。
  // 返回值：无。
  function onVisibilityChange() {
    if (!pollingActive || disposed) return
    if (pageHidden()) {
      clearPollTimer()
      state.confirmed = false
      state.fresh = false
      generation += 1
      state.loading = false
    } else {
      ensurePollTimer()
      if (!state.busy && canRead()) void readNow()
    }
  }
  function bindVisibility() {
    if (visibilityBound || !doc || typeof doc.addEventListener !== 'function') return
    doc.addEventListener('visibilitychange', onVisibilityChange)
    visibilityBound = true
  }
  function unbindVisibility() {
    if (!visibilityBound || !doc || typeof doc.removeEventListener !== 'function') return
    doc.removeEventListener('visibilitychange', onVisibilityChange)
    visibilityBound = false
  }
  function stale(application, turn) { return turn !== generation || application !== state.application }
  // read 用途：读取事实并在确认材料变化时撤销旧确认。
  // 参数：application 为系统，turn 为当前读取世代。
  // 返回值：异步完成读取；错误写入页面状态。
  async function read(application, turn) {
    try {
      const overview = validateEnforcementOverview(await getOverview(application), application)
      if (stale(application, turn)) return
      if (activationConfirmationKey(state.overview)!==activationConfirmationKey(overview) || !overviewActivationReady(overview)) state.confirmed=false
      state.overview = overview
      state.fresh = !pageHidden()
      if (readFailure) { state.error = ''; readFailure = false }
    } catch (error) {
      if (stale(application, turn)) return
      state.fresh = false
      state.error = formatUserError(error, { fallback: '读取运行时授权概览失败，请重试。' })
      readFailure = true
    } finally {
      if (!stale(application, turn)) state.loading = false
    }
  }
  async function readNow() {
    if (disposed) return
    const application = state.application
    const turn = ++generation
    state.loading = true
    await read(application, turn)
  }
  async function refresh() {
    if (!canRead() || state.busy || state.loading || disposed) return
    state.confirmed = false
    state.error = ''
    readFailure = false
    await readNow()
  }
  async function select(application) {
    applicationPath(application)
    if (state.busy || disposed) return
    state.application = application
    state.overview = null
    state.fresh = false
    state.confirmed = false
    state.error = ''
    readFailure = false
    state.loading = false
    await readNow()
  }
  // activateSelected 用途：按已确认的许可与执行双修订提交一次激活。
  // 参数：无。
  // 返回值：异步完成；错误留在状态中，不自动重试写请求。
  async function activateSelected() {
    const overview = state.overview
    if (!canRead() || !canManage() || !state.confirmed || !state.fresh || !overview || overview.application !== state.application || !overviewActivationReady(overview) || state.loading || state.busy) { state.confirmed=false; return }
    const application = state.application
    const revision = overview.enforcement.revision
    state.busy = true
    state.confirmed = false
    state.error = ''
    readFailure = false
    try {
      await activate(application, revision, overview.license.revision)
      await readNow()
      options.onSuccess?.()
    } catch (error) {
      const conflict = formatUserError(error, { fallback: '暂时无法确认激活结果，请先刷新概览后核对，不要重复提交。' })
      state.error = conflict
      if (error.status === 409) {
        await readNow()
        if (!state.error || state.error === conflict) state.error = `${conflict} 已重新读取概览，请核对修订并重新确认。`
      }
    } finally { state.busy = false }
  }
  // poll 用途：可见页面后台刷新，同一份确认材料保留勾选，变化时由读取撤销。
  // 参数：无。
  // 返回值：无。
  function poll() {
    if (disposed || !pollingActive || pageHidden() || !canRead() || state.loading || state.busy) return
    // 后台轮询仅在确认材料未变时保留勾选，不清除非读取类错误。
    void readNow()
  }
  // invalidate 用途：许可证导入或初始化后立即撤销旧确认并读取新事实。
  // 参数：无。
  // 返回值：返回刷新任务；执行中则只撤销旧确认。
  function invalidate() {
    state.confirmed = false
    state.fresh = false
    generation += 1
    state.loading = false
    if (!state.busy && canRead() && !disposed) return readNow()
  }
  function startPolling() {
    if (disposed) return
    pollingActive = true
    bindVisibility()
    ensurePollTimer()
  }
  function stopPolling() { pollingActive = false; clearPollTimer() }
  function dispose() { if (disposed) return; disposed = true; stopPolling(); unbindVisibility(); generation += 1 }
  return { refresh, select, activateSelected, invalidate, startPolling, stopPolling, dispose }
}
