import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { ref } from 'vue'
import { createRequestScope } from '../../platform/shared/composables/requestScope.js'
import { formatUserError } from '../../shared/utils/userError.js'
import { subsystemAccessMessage } from '../../shared/authz/sessionCompatibility.js'

// 沿用 presaleStability.test.mjs 的做法：从真实 SFC 提取项目计划/现场执行/报告链路函数，
// 在注入的上下文中执行，验证接线后的行为而非复述实现。
function functions(file, names, context) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const bodies = names.map((name) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
    assert.ok(start >= 0, `missing ${name}`)
    return source.slice(start, source.indexOf('\n}', start) + 2)
  })
  return vm.runInNewContext(`${bodies.join('\n')}\n({${names.join(',')}})`, context)
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function until(condition, timeoutMs = 100) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time')
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// —— 任务 B：保存/刷新分离 —— 写入 HTTP 2xx 即已保存，随后的工作区刷新失败
// 只提示“已保存，但最新数据读取失败”，不得误报为操作失败，也不得把整页切成错误区。

function workspaceContext({ listProjects = async () => [] } = {}) {
  const toasts = []
  const context = {
    ref, createRequestScope, formatUserError, subsystemAccessMessage,
    window: { clearTimeout: () => {}, setTimeout: () => 0 },
    toastTimer: 0,
    toastMessage: ref(''), toastType: ref('success'),
    loading: ref(true), loadError: ref('错误'), ruleConfigurationCatalogError: ref(''),
    lastUpdatedAt: ref(null),
    projects: ref([]), serviceItems: ref([]), rules: ref([]), deliveryEvents: ref([]),
    capabilities: ref([]), dashboard: ref({}), session: ref(null), navigation: ref({ sections: [] }),
    detectionCategories: ref([]), automationTriggerOptions: ref([]), slaStatusOptions: ref([]),
    slaOverdueItems: ref([]),
    activeSection: ref('projects'),
    route: { params: { section: 'projects' } },
    router: { replace: async () => {} },
    workspaceScope: createRequestScope(),
    decorateRule: (rule) => rule,
    listProjects, listServiceItems: async () => [], listRules: async () => [], listDeliveryEvents: async () => [],
    listCapabilities: async () => [], getDashboard: async () => ({}), getProjectSession: async () => ({}),
    getProjectNavigation: async () => ({ sections: ['projects'], default_section: 'projects' }),
    listDetectionCategories: async () => [], listRuleConfigurationCatalog: async () => ({ automation_triggers: [], sla_statuses: [] }),
    loadApplicationRoles: () => {}, loadSplitConfig: async () => {}, loadEquipment: async () => {}, loadPersonnelNames: async () => {},
    listSlaOverdue: async () => [],
    showToast: (message, type) => toasts.push({ message, type }),
  }
  return { context, toasts }
}

test('拆解确认写入成功但刷新失败：提示已保存与读取失败，不误报确认失败也不切错误页', async () => {
  let workspaceLoads = 0
  const w = workspaceContext({ listProjects: () => { workspaceLoads++; return Promise.reject(new Error('服务端瞬断')) } })
  Object.assign(w.context, { ...functions('./ProjectManagementView.vue', ['loadWorkspace', 'refreshAfterWrite', 'showToast', 'confirmDecomposition'], w.context) })
  const pending = deferred()
  w.context.confirmServiceItemsRequest = () => pending.promise
  w.context.serviceItems.value = [{ id: 'SI-1', selected: true }]
  w.context.currentDecompositionItems = { value: [{ id: 'SI-1', selected: true }] }
  w.context.saving = ref(false)
  const confirming = w.context.confirmDecomposition()
  pending.resolve([{ id: 'SI-1', status: '待分配' }])
  await confirming
  assert.equal(w.context.serviceItems.value[0].status, '待分配', '写入成功结果不得回退')
  // 单一 Toast 通道：最终停留的提示必须准确传达“已保存、仅读取失败”，
  // 不得残留“确认失败 / 操作未完成”这类误报。
  assert.match(w.context.toastMessage.value, /已保存，但最新数据读取失败/)
  assert.doesNotMatch(w.context.toastMessage.value, /确认失败|操作未完成/, '刷新失败不得报成操作失败')
  assert.equal(w.context.loadError.value, '', '写后刷新失败不得把整页替换成错误区')
  assert.equal(w.context.toastType.value, 'warning')
  assert.equal(w.context.saving.value, false, 'finally 必须释放进行中标志')
  assert.equal(workspaceLoads, 1, '刷新链仍要尝试拉取最新数据')
})

test('报告更正申请写入失败：保留草稿原因并按操作失败提示，不触发刷新链', async () => {
  const w = workspaceContext()
  Object.assign(w.context, { ...functions('./ProjectManagementView.vue', ['loadWorkspace', 'refreshAfterWrite', 'showToast', 'submitReportCorrection'], w.context) })
  const pending = deferred()
  w.context.requestReportCorrection = () => pending.promise
  w.context.saving = ref(false)
  w.context.selectedServiceItem = ref({ id: 'SI-9', status: '现场实施完成', report_status: 'ISSUED', version: 4 })
  w.context.canSubmitReportCorrection = { value: true }
  w.context.operationForm = ref({ reportCorrectionReason: '报告金额行与合同不一致' })
  let workspaceLoads = 0
  w.context.loadWorkspace = async () => { workspaceLoads++ }
  const submitting = w.context.submitReportCorrection()
  pending.reject(Object.assign(new Error('服务端保存失败'), { status: 500 }))
  await submitting
  assert.equal(w.context.operationForm.value.reportCorrectionReason, '报告金额行与合同不一致', '写失败必须保留草稿')
  assert.equal(w.context.toastType.value, 'error', '写失败必须按操作失败提示')
  assert.doesNotMatch(w.context.toastMessage.value, /已保存/, '写失败不得宣称已保存')
  assert.equal(workspaceLoads, 0, '写失败不得触发保存后的刷新链')
  assert.equal(w.context.saving.value, false)
})

// —— 任务 C：请求作用域 —— 迟到响应不得污染新上下文，旧请求 finally 不得关闭新请求的加载态。

test('工作区双请求：先发请求迟到时不得覆盖新请求的数据', async () => {
  const w = workspaceContext()
  Object.assign(w.context, { ...functions('./ProjectManagementView.vue', ['loadWorkspace'], w.context) })
  const first = deferred()
  let calls = 0
  w.context.listProjects = () => { calls++; return calls === 1 ? first.promise : Promise.resolve([{ id: 'PJ-NEW' }]) }
  const slow = w.context.loadWorkspace()
  const fast = w.context.loadWorkspace()
  await until(() => calls === 2)
  first.resolve([{ id: 'PJ-OLD' }])
  await slow
  await fast
  assert.deepEqual(w.context.projects.value, [{ id: 'PJ-NEW' }], '旧工作区响应不得污染新工作区')
  assert.equal(w.context.loading.value, false, '只有当前票据能结束 loading')
})

test('监控读取切换筛选后：旧筛选迟到响应不回写快照，也不关闭新请求的加载态', async () => {
  const pending = []
  const context = {
    ref, createRequestScope, formatUserError,
    activeSection: ref('monitoring'),
    monitoringLoading: ref(false), monitoringError: ref('旧错误'), monitoringSnapshot: ref({ items: [], total: 0 }),
    monitorPage: ref(1), monitorPageSize: ref(20), keyword: ref(''), teamFilter: ref(''),
    monitorCategory: ref(''), monitorProjectManager: ref(''), monitorSLAOnly: ref(false),
    monitorConflictOnly: ref(false), monitorDueFrom: ref(''), monitorDueTo: ref(''),
    monitoringTotalPages: null,
    monitoringScope: createRequestScope(),
    monitoringParams: () => ({
      page: context.monitorPage.value, page_size: context.monitorPageSize.value, keyword: context.keyword.value,
      category: context.monitorCategory.value, status: context.monitorCategory.value,
      sla: context.monitorSLAOnly.value, conflict: context.monitorConflictOnly.value,
    }),
    getProjectMonitoring: (params) => new Promise((resolve) => pending.push({ params, resolve })),
    loadPersonnelNames: () => {},
  }
  context.monitoringTotalPages = {
    get value() {
      return Math.max(1, Math.ceil((context.monitoringSnapshot.value.total || 0) / context.monitorPageSize.value))
    },
  }
  const { loadMonitoring } = functions('./ProjectManagementView.vue', ['loadMonitoring'], context)
  const slow = loadMonitoring()
  await until(() => pending.length === 1)
  context.monitorCategory.value = '软件产品' // 触发新查询条件
  const fresh = loadMonitoring()
  await until(() => pending.length === 2)
  pending[0].resolve({ items: [{ project_id: 'STALE' }], total: 0, server_time: 'stale' })
  await slow
  assert.deepEqual(context.monitoringSnapshot.value.items, [], '旧筛选的迟到响应不得覆盖新快照')
  assert.equal(context.monitoringError.value, '旧错误', '旧请求失败/成功都不得改写当前错误态')
  assert.equal(context.monitoringLoading.value, true, '旧请求 finally 不得关闭新请求的加载态')
  pending[1].resolve({ items: [{ project_id: 'FRESH' }], total: 1, server_time: 'now' })
  await fresh
  assert.deepEqual(context.monitoringSnapshot.value.items, [{ project_id: 'FRESH' }])
  assert.equal(context.monitoringError.value, '')
  assert.equal(context.monitoringLoading.value, false)
})

test('设备占用读取切换服务项后：旧服务项迟到响应不得回写', async () => {
  const pending = []
  const context = {
    ref, createRequestScope,
    selectedServiceItem: ref({ id: 'ITEM-A' }),
    equipmentReservations: ref([{ resource_id: 'EQ-OLD' }]),
    reservationScope: createRequestScope(),
    listEquipmentReservations: (itemID) => new Promise((resolve, reject) => pending.push({ itemID, resolve, reject })),
  }
  const { loadEquipmentReservations } = functions('./ProjectManagementView.vue', ['loadEquipmentReservations'], context)
  const slow = loadEquipmentReservations({ id: 'ITEM-A' })
  await until(() => pending.length === 1)
  context.selectedServiceItem.value = { id: 'ITEM-B' }
  const fresh = loadEquipmentReservations({ id: 'ITEM-B' })
  await until(() => pending.length === 2)
  pending[0].resolve([{ resource_id: 'EQ-FROM-A' }])
  await slow
  assert.deepEqual(context.equipmentReservations.value, [{ resource_id: 'EQ-OLD' }], '旧服务项的占用响应不得污染新服务项')
  pending[1].resolve([{ resource_id: 'EQ-FROM-B' }])
  await fresh
  assert.deepEqual(context.equipmentReservations.value, [{ resource_id: 'EQ-FROM-B' }])
})

// —— 任务 D：写操作进行中单飞 guard —— 按钮禁用依赖 DOM 重渲染，函数级 guard 兜底防双击重复提交。

test('runOperation 在写操作进行中再次触发时直接返回，不重复提交', async () => {
  let planCalls = 0
  const context = {
    ref,
    saving: ref(true), // 模拟上一次写操作仍在进行
    selectedServiceItem: ref({ id: 'SI-1', version: 3, test_mode: 'STANDARD' }),
    selectedServiceItems: ref([]),
    operationForm: ref({ plannedStart: '2026-10-26T09:00', plannedEnd: '2026-10-26T18:00', personnel: [{ resourceID: 'p-1' }] }),
    planningBlocked: ref(null),
    showToast: () => assert.fail('进行中重复触发不得给出任何提示或提交'),
    planImplementation: () => { planCalls++ },
    asRFC3339: (value) => value,
    selectedIDs: (value) => String(value || '').split(',').filter(Boolean),
    formatUserError,
  }
  const { runOperation } = functions('./ProjectManagementView.vue', ['runOperation'], context)
  await runOperation('planning')
  assert.equal(planCalls, 0, '写操作进行中必须被单飞 guard 拦截')
})
