// 仅供测试的浏览器样例：不含后端、凭据或许可证签名密钥。
// 生产应用不导入此文件，所有 fetch 请求均在本地拦截。
import { createApp, ref, h } from 'vue'
import RuntimeEnforcementView from './RuntimeEnforcementView.vue'
import { dispatchAuthorizationRefreshed } from '../../auth/utils/authorizationRefresh.js'

const cases = ['pending', 'applying', 'enforced', 'unregistered', 'expired', 'conflict', 'read-only', 'no-permission', 'network', 'access']
const scenario = ref(cases.includes(new URL(location.href).searchParams.get('scenario')) ? new URL(location.href).searchParams.get('scenario') : 'pending')
const generation = ref(0)
const calls = ref([])
const CHECKED_AT = '2026-10-27T05:54:38Z'
let revision = 7
let activationState = 'PENDING_ENFORCEMENT'
function json(data, status = 200, code = 'OK') { return new Response(JSON.stringify({ code, data, message: status === 409 ? '状态已变化，请重新确认。' : 'fixture' }), { status, headers: { 'Content-Type': 'application/json' } }) }
// 概览样例与 P1 契约字段一致：UNKNOWN 运行观察、未登记、许可证无效都必须作为事实显示。
// overview 用途：为浏览器验证生成合成概览，不连接业务系统。
// 参数：application 为所选系统编码。
// 返回值：返回当前测试场景的模拟事实。
function overview(application) {
  const registered = !['unregistered', 'access'].includes(scenario.value)
  const license = scenario.value === 'expired'
    ? { status: 'EXPIRED', revision: 3, version: 1, not_before: 0, expires_at: 1 }
    : { status: 'VALID', revision: 3, version: 1, not_before: 0, expires_at: 4102444800 }
  const enrollmentState = scenario.value === 'enforced' ? 'ENFORCED' : activationState
  const members = registered ? [{ service_id: `${application}-api`, ready_at: CHECKED_AT, ready_fresh: true, ack_current: true, issued_revision: revision, ack_revision: revision, ack_at: CHECKED_AT }] : []
  const blockingReasons = []
  if (license.status === 'EXPIRED') blockingReasons.push('LICENSE_EXPIRED')
  if (!registered) blockingReasons.push('RUNTIME_NOT_REGISTERED')
  return {
    application,
    environment: 'production',
    license,
    runtime: registered
      ? { status: 'RUNNING', available: true, message: '隔离模拟的运行观察', checked_at: CHECKED_AT }
      : { status: 'UNKNOWN', available: false, message: '尚未接入运行观察', checked_at: CHECKED_AT },
    registration: registered
      ? { status: 'REGISTERED', member_count: members.length, catalog_version: 1 }
      : { status: 'UNREGISTERED', member_count: 0, catalog_version: 0 },
    enforcement: {
      status: registered ? enrollmentState : 'UNREGISTERED',
      revision: registered ? revision : 0,
      deployment_revision: 42,
      snapshot_current: registered,
      members,
    },
    activation: {
      can_activate: registered && license.status === 'VALID' && enrollmentState === 'PENDING_ENFORCEMENT',
      status: !registered || license.status !== 'VALID' ? 'NOT_READY' : enrollmentState === 'PENDING_ENFORCEMENT' ? 'READY' : enrollmentState,
      total_count: members.length, ready_count: members.length, acknowledged_count: members.length,
      waiting_service_ids: [], waiting_since: null, wait_seconds: 0,
      blocking_reasons: !registered ? ['RUNTIME_NOT_REGISTERED'] : license.status !== 'VALID' ? ['LICENSE_NOT_VALID'] : [],
    },
    preparation_operation: null,
    blocking_reasons: blockingReasons,
    allowed_actions: scenario.value === 'access' ? ['OPEN_ACCESS_WIZARD'] : license.status === 'VALID' ? [] : ['IMPORT_LICENSE'],
    checked_at: CHECKED_AT,
  }
}
// reset 用途：切换测试场景并重置模拟身份与请求记录。
// 参数：无。
// 返回值：无。
function reset() {
  revision = 7
  activationState = scenario.value === 'applying' ? 'APPLYING' : 'PENDING_ENFORCEMENT'
  calls.value = []
  dispatchAuthorizationRefreshed({ user: { id: 'isolated-component-fixture' }, permission_codes: scenario.value === 'no-permission' ? [] : scenario.value === 'read-only' ? ['platform:license:read'] : ['platform:license:read', 'platform:license:manage', ...(scenario.value === 'access' ? ['platform:application:read'] : [])] })
  generation.value++
}
window.fetch = async (url, options = {}) => {
  const method = options.method || 'GET'
  const path = String(url)
  calls.value = [...calls.value, { method, path, body: options.body ? JSON.parse(options.body) : null }]
  if (path === '/api/v1/subsystem-capabilities') return json({ supported_application_codes: ['contract_management'], targets: [] })
  if (path.startsWith('/api/v1/subsystem-access/operations?') && method === 'GET') return json(null, 404, 'NOT_FOUND')
  if (!path.startsWith('/api/v1/licenses/enforcement/')) throw new Error('Fixture forbids external or unrelated API traffic')
  if (scenario.value === 'network') throw new Error('Isolated simulated network outage')
  // 路径形如 /api/v1/licenses/enforcement/{application}/overview 或 /activation。
  const application = path.split('/')[5]
  if (method === 'POST') {
    if (scenario.value === 'conflict') { revision++; return json(null, 409, 'LICENSE_VERSION_CONFLICT') }
    activationState = 'APPLYING'
    return json({ accepted: true })
  }
  if (path.endsWith('/overview')) return json(overview(application))
  return json(null, 404, 'LICENSE_RUNTIME_OVERVIEW_NOT_FOUND')
}
reset()
createApp({ setup() { return () => h('main', { style: 'font:16px system-ui;max-width:1200px;margin:24px auto;padding:16px' }, [
  h('h1', '商业许可组件契约验收（模拟，不是端到端）'),
  h('p', '隔离合成权限与 P1 overview 数据；无服务端、无业务写入、不证明激活或商业验签成功。'),
  h('label', ['模拟场景 ', h('select', { value: scenario.value, onChange: event => { scenario.value = event.target.value; reset() } }, cases.map(value => h('option', { value }, value)))]),
  h(RuntimeEnforcementView, { key: generation.value }),
  h('h2', '隔离模拟请求记录'), h('pre', { id: 'fixture-requests', style: 'overflow:auto;max-width:100%' }, JSON.stringify(calls.value, null, 2)),
]) } }).mount('#app')
