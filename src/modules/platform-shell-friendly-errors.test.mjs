import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { formatUserError } from './shared/utils/userError.js'
import { createRuntimeController, createRuntimeState } from './platform/features/licenses/runtime-api.js'
import { onboardEmployee } from './platform/iam/api/iam.js'

const ref = value => ({ value })
const sources = Object.fromEntries([
  'views/PlatformConsoleView.vue', 'views/SubsystemPortalView.vue',
  'auth/views/LoginView.vue', 'auth/views/ForcePasswordChangeView.vue',
  'features/licenses/CommercialLicenseView.vue',
].map(name => [name, readFileSync(new URL(`./platform/${name}`, import.meta.url), 'utf8')]))

test('platform shell, public authentication and license components compile after error-boundary integration', () => {
  for (const [name, source] of Object.entries(sources)) {
    const { descriptor, errors } = parse(source, { filename: name })
    assert.deepEqual(errors, [], name)
    const script = compileScript(descriptor, { id: name })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: name, id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors, [], name)
  }
})

test('actual console and portal toast functions filter unexpected raw errors and retain readable success notices', () => {
  const window = { clearTimeout: () => {}, setTimeout: () => 1 }
  const consoleSource = sources['views/PlatformConsoleView.vue']
  const consoleCode = consoleSource.slice(consoleSource.indexOf('function showToast('), consoleSource.indexOf('\nasync function loadPlatformSettings('))
  const toastMessage = ref('')
  const consoleToast = new Function('formatUserError', 'toastMessage', 'window', `let toastTimer; ${consoleCode}; return showToast`)(formatUserError, toastMessage, window)
  const portalSource = sources['views/SubsystemPortalView.vue']
  const portalCode = portalSource.slice(portalSource.indexOf('function showToast('), portalSource.indexOf('\nasync function loadPortalCatalog('))
  const toast = ref({})
  const portalToast = new Function('formatUserError', 'toast', 'window', `let toastTimer; ${portalCode}; return showToast`)(formatUserError, toast, window)
  for (const invoke of [message => { consoleToast(message); return toastMessage.value }, message => { portalToast(message, 'deny'); return toast.value.message }]) {
    assert.equal(invoke('平台基础设置已保存。'), '平台基础设置已保存。')
    assert.doesNotMatch(invoke('加载失败：Unknown column private_value in field list'), /Unknown|private_value|field list/)
    assert.doesNotMatch(invoke('请执行 docker compose restart api'), /docker|restart/)
  }
  assert.equal(toast.value.type, 'deny')
})

test('license import messages retain conflict guidance but suppress local file or server implementation errors', () => {
  const source = sources['features/licenses/CommercialLicenseView.vue']
  const code = source.slice(source.indexOf('function message('), source.indexOf('\nasync function loadEvents('))
  const message = new Function('formatUserError', `${code}; return message`)(formatUserError)
  assert.match(message({ status: 409, code: 'LICENSE_VERSION_CONFLICT' }), /刷新并重新预览/)
  assert.equal(message(new Error('请选择或粘贴供应商签发的许可证。')), '请选择或粘贴供应商签发的许可证。')
  assert.doesNotMatch(message(new Error('读取失败：Table internal_license does not exist')), /Table|internal_license/)
})

test('runtime authorization controller keeps failures readable without bypassing confirmation or retrying activation', async () => {
  const state = createRuntimeState()
  let writes = 0
  const controller = createRuntimeController(state, {
    canRead: () => true, canManage: () => true,
    getOverview: async application => ({
      application, environment: 'prod',
      license: { status: 'VALID', revision: 3, version: 1, not_before: 0, expires_at: 4102444800 },
      runtime: { status: 'UNKNOWN', available: false, checked_at: '2026-10-27T00:00:00Z' },
      registration: { status: 'REGISTERED', member_count: 1, catalog_version: 1 },
      enforcement: { status: 'PENDING_ENFORCEMENT', revision: 3, deployment_revision: 3, snapshot_current: false,
        members: [{ service_id: 'contract-api', ready_at: null, ack_at: null, issued_revision: 0, ack_revision: 0 }] },
      activation: { can_activate: true, status: 'READY', total_count: 1, ready_count: 1, acknowledged_count: 0,
        waiting_service_ids: ['contract-api'], waiting_since: null, wait_seconds: 0, blocking_reasons: [] },
      preparation_operation: null, blocking_reasons: [], allowed_actions: [], checked_at: '2026-10-27T00:00:00Z',
    }),
    activate: async () => { writes++; throw Object.assign(new Error('socket private_value'), { code: 'NETWORK_ERROR', request_method: 'POST' }) },
  })
  await controller.refresh()
  state.confirmed = true
  await controller.activateSelected()
  assert.match(state.error, /确认操作结果.*核对.*避免重复提交/)
  assert.doesNotMatch(state.error, /socket|private_value/)
  assert.equal(state.confirmed, false)
  await controller.activateSelected()
  assert.equal(writes, 1)
})

test('missing employee identity is an unconfirmed write, never evidence that an employee was created', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  try {
    globalThis.fetch = async url => {
      calls.push(url)
      return new Response(JSON.stringify(url.endsWith('/employees') ? { code: 'NOT_FOUND' } : { code: 'OK', data: {} }), { status: url.endsWith('/employees') ? 404 : 201, headers: { 'Content-Type': 'application/json' } })
    }
    await assert.rejects(onboardEmployee({ user: { display_name: '隔离示例' }, membership: { org_unit_id: 'fixture', position_id: 'fixture' } }), error => {
      assert.equal(error.code, 'INVALID_RESPONSE')
      assert.equal(error.partialCompletion, undefined)
      assert.doesNotMatch(error.message, /已创建/)
      assert.match(formatUserError(error), /核对.*避免重复提交/)
      return true
    })
    assert.deepEqual(calls, ['/api/v1/employees', '/api/v1/users'])
  } finally { globalThis.fetch = originalFetch }
})
