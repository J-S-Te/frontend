import { createRequest } from '../../shared/api/request.js'

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
export function validateEnforcementSnapshot(data, application) {
  if (!data || data.application !== application || !['PENDING_ENFORCEMENT', 'APPLYING', 'ENFORCED'].includes(data.state) || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.members)) {
    throw new RuntimeEnforcementError('服务端执行状态格式异常，请重新读取；不能据此发起激活。')
  }
  return data
}
export const getRuntimeEnforcement = application => request(applicationPath(application)).then(data => validateEnforcementSnapshot(data, application))
export function activateRuntimeEnforcement(application, revision) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new RuntimeEnforcementError('执行状态修订无效，请先刷新。')
  return request(`${applicationPath(application)}/activation`, { method: 'POST', body: JSON.stringify({ expected_revision: revision }) })
}
export const runtimeStateName = state => ({ PENDING_ENFORCEMENT: '待激活', APPLYING: '正在应用', ENFORCED: '已强制执行' })[state] || '未知状态'
export const runtimeTimestampPresent = value => Boolean(value && value !== '0001-01-01T00:00:00Z')
export function memberProgress(members = []) {
  return { total: members.length, ready: members.filter(member => runtimeTimestampPresent(member.ready_at)).length, acknowledged: members.filter(member => Number.isSafeInteger(member.issued_revision) && member.issued_revision > 0 && member.ack_revision === member.issued_revision && runtimeTimestampPresent(member.ack_at)).length }
}
export function createRuntimeState() { return { application: 'contract_management', snapshot: null, fresh: false, loading: false, busy: false, error: '', notRegistered: false, confirmed: false } }
// Keep state injectable so the Vue reactive object and tests share the same
// transitions. Server state, never ready-count arithmetic, decides activation.
export function createRuntimeController(state, options = {}) {
  const canRead = options.canRead || (() => false)
  const canManage = options.canManage || (() => false)
  const get = options.get || getRuntimeEnforcement
  const activate = options.activate || activateRuntimeEnforcement
  let generation = 0
  async function read(application) {
    try {
      const snapshot = validateEnforcementSnapshot(await get(application), application)
      if (application === state.application) { state.snapshot = snapshot; state.notRegistered = false; state.fresh = true }
    } catch (error) {
      if (application !== state.application) return
      state.fresh = false
      if (error.status === 409 && error.code === 'LICENSE_RUNTIME_NOT_READY') { state.snapshot = null; state.notRegistered = true; state.error = '尚未受控登记。请先通过受控部署流程登记服务；此页面不会自动登记或冻结迁移资格。' }
      else { state.error = error.message || '读取运行时执行状态失败，请重试。' }
    }
  }
  async function refresh() {
    if (!canRead() || state.loading || state.busy) return
    const application = state.application; const turn = ++generation
    state.loading = true; state.error = ''; state.confirmed = false; state.fresh = false
    try { await read(application) }
    finally { if (turn === generation) state.loading = false }
  }
  async function select(application) {
    applicationPath(application)
    if (state.busy || state.loading) return
    state.application = application; state.snapshot = null; state.notRegistered = false; state.confirmed = false; state.fresh = false
    await refresh()
  }
  async function activateSelected() {
    const snapshot = state.snapshot
    if (!canRead() || !canManage() || !state.confirmed || !state.fresh || !snapshot || snapshot.application !== state.application || snapshot.state === 'ENFORCED' || state.loading || state.busy || state.notRegistered) return
    const application = state.application
    state.busy = true; state.error = ''; state.confirmed = false
    try { await activate(application, snapshot.revision); await read(application); options.onSuccess?.() }
    catch (error) {
      state.error = error.message || '激活失败，状态已保留；请检查服务端指引后重试。'
      if (error.status === 409) { const conflict = state.error; await read(application); if (!state.error || state.error === conflict) state.error = `${conflict} 已重新读取状态，请核对修订并重新确认。` }
    } finally { state.busy = false }
  }
  return { refresh, select, activateSelected }
}
