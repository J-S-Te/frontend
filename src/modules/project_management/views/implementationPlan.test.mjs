import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { ref } from 'vue'
import { formatUserError } from '../../shared/utils/userError.js'
import { attachStructuredContext } from '../../platform/shared/api/requestContext.js'
import { normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin } from '../../shared/authz/sessionCompatibility.js'
import { asRFC3339, toDateTimeLocal, planPersonnelFor, planEquipmentFor, isEmbeddedPenetrationItem } from '../projectDisplay.js'

const view = await readFile(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
const api = (await readFile(new URL('../api/projectManagement.js', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replaceAll('import.meta.env', '({})').replace(/^export /gm, '')

function section(start, end) {
  const offset = view.indexOf(start)
  const limit = view.indexOf(end, offset)
  assert.ok(offset >= 0 && limit > offset, `无法读取组件行为：${start}`)
  return view.slice(offset, limit)
}

function workspace({ status = 200 } = {}) {
  const requests = [], toasts = []
  let refreshes = 0
  const context = {
    ref, FormData, Response, formatUserError, attachStructuredContext,
    normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin,
    selectedServiceItem: ref(null), selectedServiceItems: ref([]),
    planningBlocked: ref(null), signaturePadKey: ref(0), saving: ref(false),
    asRFC3339, toDateTimeLocal, planPersonnelFor, planEquipmentFor, isEmbeddedPenetrationItem,
    loadWorkspace: async () => { refreshes++ },
    // 写成功后的工作区刷新统一走 refreshAfterWrite（保存/刷新分离）。
    refreshAfterWrite: async () => { refreshes++ },
    showToast: (message, tone) => toasts.push({ message, tone }),
    fetch: async (url, options) => {
      requests.push({ url, ...options, payload: JSON.parse(options.body) })
      const body = status === 200 ? { data: { status: '待实施' } }
        : { code: 'PM_RESOURCE_CONFLICT', message: '数据已更新，请刷新后重试' }
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    },
  }
  // 执行真实组件状态、回填和提交函数，保留真实 API 序列化；只替换网络与工作区刷新。
  const initStart = view.indexOf('const operationForm = ref(')
  const init = view.slice(initStart, view.indexOf('\n', initStart))
  vm.runInNewContext([
    api, init,
    section('function fillOperationForm(item)', 'function updatePenetrationPackage('),
    section('async function runOperation(kind)', 'async function revokeSelectedAssignment('),
    'this.form = operationForm; this.fill = fillOperationForm; this.run = runOperation;',
  ].join('\n'), context)
  return { context, requests, toasts, get refreshes() { return refreshes } }
}

function select(w, item = {}) {
  const row = { id: 'SI/1', version: 7, test_mode: 'STANDARD', team_lead_id: 'lead-1', project_manager_id: 'manager-1', engineer_ids: ['engineer-1'], ...item }
  w.context.selectedServiceItem.value = row
  w.context.fill(row)
  w.context.form.value.plannedStart = '2026-10-22T09:00'
  w.context.form.value.plannedEnd = '2026-10-22T18:00'
}

test('现场计划初始为空字符串，可直接提交空文本', async () => {
  const w = workspace()
  assert.equal(w.context.form.value.sitePlan, '')
  select(w)
  await w.context.run('planning')
  assert.equal(w.requests.length, 1)
  assert.equal(w.requests[0].payload.site_plan, '')
})

test('选择服务项时回显该项已保存的现场计划', () => {
  const w = workspace()
  select(w, { implementation_plan: { site_plan: 'A 项已保存的现场步骤' } })
  assert.equal(w.context.form.value.sitePlan, 'A 项已保存的现场步骤')
})

test('从有草稿的服务项切到无计划项时清空现场计划', async () => {
  const w = workspace()
  select(w)
  w.context.form.value.sitePlan = '仅属于 A 的未提交草稿'
  select(w, { id: 'SI-B', version: 3 })
  assert.equal(w.context.form.value.sitePlan, '')
  await w.context.run('planning')
  assert.equal(w.requests[0].url, '/project_management/api/v1/service-items/SI-B/implementation-plan')
  assert.equal(w.requests[0].payload.site_plan, '')
})

test('切到已有计划项时用目标项现场计划覆盖上一项草稿', () => {
  const w = workspace()
  select(w)
  w.context.form.value.sitePlan = 'A 项草稿'
  select(w, { id: 'SI-B', implementation_plan: { site_plan: 'B 项已保存计划' } })
  assert.equal(w.context.form.value.sitePlan, 'B 项已保存计划')
})

test('发布普通实施计划的实际 JSON 包含现场计划及原有版本和人员字段', async () => {
  const w = workspace()
  select(w)
  w.context.form.value.sitePlan = '现场核对\n步骤包含 "引号" 与 <标签>，按原文本保存。'
  await w.context.run('planning')
  assert.equal(w.requests.length, 1)
  const request = w.requests[0]
  assert.equal(request.url, '/project_management/api/v1/service-items/SI%2F1/implementation-plan')
  assert.equal(request.method, 'POST')
  assert.equal(request.credentials, 'include')
  assert.equal(request.payload.site_plan, '现场核对\n步骤包含 "引号" 与 <标签>，按原文本保存。')
  assert.equal(request.payload.expected_version, 7)
  assert.equal(request.payload.planned_start, new Date('2026-10-22T09:00').toISOString())
  assert.deepEqual(request.payload.personnel, [
    { resource_type: 'PERSON', resource_id: 'lead-1', window_start: '', window_end: '', note: '' },
    { resource_type: 'PERSON', resource_id: 'manager-1', window_start: '', window_end: '', note: '' },
    { resource_type: 'PERSON', resource_id: 'engineer-1', window_start: '', window_end: '', note: '' },
  ])
  assert.equal(w.refreshes, 1)
  assert.ok(w.toasts.some((toast) => toast.message === '实施计划已发布'))
})

test('现场计划在既有 5000 字上限内不截断', async () => {
  const w = workspace()
  select(w)
  w.context.form.value.sitePlan = '计'.repeat(5000)
  await w.context.run('planning')
  assert.equal(w.requests[0].payload.site_plan, '计'.repeat(5000))
})

test('补齐现场计划传输仍保留计划前置条件和独立渗透合规拦截', async () => {
  const blocked = workspace()
  select(blocked)
  blocked.context.planningBlocked.value = { reason: '请先完成能力校验' }
  await blocked.context.run('planning')
  assert.equal(blocked.requests.length, 0)
  assert.ok(blocked.toasts.some((toast) => toast.message === '请先完成能力校验'))
  const penetration = workspace()
  select(penetration, { test_mode: 'PENETRATION' })
  penetration.context.form.value.sitePlan = '现场计划不能代替专项合规资料'
  await penetration.context.run('planning')
  assert.equal(penetration.requests.length, 0)
  assert.ok(penetration.toasts.some((toast) => toast.message.includes('请补充渗透测试专项合规要素')))
})

test('旧版本计划被拒绝后刷新工作区，不重试或提示发布成功', async () => {
  const w = workspace({ status: 409 })
  select(w)
  w.context.form.value.sitePlan = '版本冲突时仍属于当前项的草稿'
  await w.context.run('planning')
  assert.equal(w.requests.length, 1)
  assert.equal(w.requests[0].payload.site_plan, '版本冲突时仍属于当前项的草稿')
  assert.equal(w.requests[0].payload.expected_version, 7)
  assert.equal(w.refreshes, 1)
  assert.equal(w.context.saving.value, false)
  assert.ok(w.toasts.some((toast) => toast.tone === 'error'))
  assert.ok(!w.toasts.some((toast) => toast.message === '实施计划已发布'))
})
