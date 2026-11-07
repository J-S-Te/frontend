// Test-only browser fixture: no backend, credentials or license signing keys.
// Not imported by the production app. Every fetch is intercepted locally.
import { createApp, ref, h } from 'vue'
import RuntimeEnforcementView from './RuntimeEnforcementView.vue'
import { dispatchAuthorizationRefreshed } from '../../auth/utils/authorizationRefresh.js'

const cases = ['pending', 'conflict', 'missing', 'read-only', 'no-permission', 'network', 'enforced']
const scenario = ref(cases.includes(new URL(location.href).searchParams.get('scenario')) ? new URL(location.href).searchParams.get('scenario') : 'pending')
const generation = ref(0)
const calls = ref([])
let revision = 7
let activationState = 'PENDING_ENFORCEMENT'
function reset() {
  revision = 7; activationState = 'PENDING_ENFORCEMENT'; calls.value = []
  dispatchAuthorizationRefreshed({ user: { id: 'isolated-component-fixture' }, permission_codes: scenario.value === 'no-permission' ? [] : scenario.value === 'read-only' ? ['platform:license:read'] : ['platform:license:read', 'platform:license:manage'] })
  generation.value++
}
function json(data, status = 200, code = 'OK') { return new Response(JSON.stringify({ code, data, message: status === 409 ? '状态已变化，请重新确认。' : 'fixture' }), { status, headers: { 'Content-Type': 'application/json' } }) }
window.fetch = async (url, options = {}) => {
  const method = options.method || 'GET'
  const path = String(url)
  calls.value = [...calls.value, { method, path, body: options.body ? JSON.parse(options.body) : null }]
  if (!path.startsWith('/api/v1/licenses/enforcement/')) throw new Error('Fixture forbids external or unrelated API traffic')
  if (scenario.value === 'network') throw new Error('Isolated simulated network outage')
  if (scenario.value === 'missing') return json(null, 409, 'LICENSE_RUNTIME_NOT_READY')
  if (method === 'POST') {
    if (scenario.value === 'conflict') { revision++; return json(null, 409, 'LICENSE_VERSION_CONFLICT') }
    activationState = 'APPLYING'
    return json({ accepted: true })
  }
  const application = path.split('/').at(-1)
  return json({ application, state: scenario.value === 'enforced' ? 'ENFORCED' : activationState, revision, deployment_revision: 42, migration_eligible: true, updated_at: '2026-10-09T01:00:00Z', members: [{ service_id: `${application}-api`, environment: 'prod', coverage_digest: `sha256:${'a'.repeat(64)}`, image_digest: `sha256:${'b'.repeat(64)}`, ready_at: '2026-10-09T01:00:00Z', issued_revision: 7, ack_revision: 7, ack_at: '2026-10-09T01:00:00Z' }] })
}
reset()
createApp({ setup() { return () => h('main', { style: 'font:16px system-ui;max-width:1200px;margin:24px auto;padding:16px' }, [
  h('h1', '商业许可组件契约验收（模拟，不是端到端）'),
  h('p', '隔离合成权限与 API 数据；无服务端、无业务写入、不证明激活或商业验签成功。'),
  h('label', ['模拟场景 ', h('select', { value: scenario.value, onChange: event => { scenario.value = event.target.value; reset() } }, cases.map(value => h('option', { value }, value)))]),
  h(RuntimeEnforcementView, { key: generation.value }),
  h('h2', '隔离模拟请求记录'), h('pre', { id: 'fixture-requests' }, JSON.stringify(calls.value, null, 2)),
]) } }).mount('#app')
