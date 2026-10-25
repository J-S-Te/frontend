import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequestScope } from '../platform/shared/composables/requestScope.js'

// 沿用 authorizationRaceGuards.test.mjs 的做法：从真实 SFC 提取售前链路函数，
// 在注入的上下文中执行，验证接线后的行为而非复述实现。
const ref = (value) => ({ value })
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

// —— 审批决定（通过/驳回/取消）：任务 B 保存/刷新分离 ——

function decisionHarness() {
  const pending = deferred()
  const confirmed = []
  const shownErrors = []
  const coreResults = []
  const listResults = []
  const context = {
    presaleMutationContextSequence: ref(0),
    presaleMutationLoadSequence: ref(0),
    presaleMutationLoading: ref(false),
    selectedPresale: ref({ request: { id: 7 } }),
    selectedOpportunity: ref(null),
    opportunityPresalePage: { number: 1 },
    presaleMutationRetries: {
      keyFor: (operation, requestID, payload) => ({ key: `key-${operation}`, payload }),
      confirmSuccess: (operation) => confirmed.push(operation),
    },
    submitApprovalAction: () => pending.promise,
    cancelPresaleRequest: async () => { throw new Error('cancel not used in this test') },
    presaleResult: ref(null),
    notice: ref(''),
    error: ref(''),
    showError: (value) => shownErrors.push(value),
    loadPresaleCore: async () => (coreResults.length ? coreResults.shift() : true),
    refreshPresaleActions: async () => {},
    refreshPresaleTimeline: async () => {},
    loadCurrent: async () => (listResults.length ? listResults.shift() : true),
    loadOpportunityPresales: async () => {},
  }
  return {
    ...functions('./views/CustomerOpportunityView.vue', ['refreshAfterPresaleWrite', 'submitPresaleDecision'], context),
    context, pending, confirmed, shownErrors, coreResults, listResults,
  }
}

test('审批写入成功但详情与列表刷新失败：提示已保存与读取失败，不误报审批失败', async () => {
  const h = decisionHarness()
  h.coreResults.push(false, false) // 详情重读与列表刷新均失败
  h.listResults.push(false)
  const saving = h.submitPresaleDecision('approve', 7, 3, '同意')
  h.pending.resolve({ accepted: true })
  await saving
  assert.equal(h.context.notice.value, '操作完成。', '成功提示不得被刷新失败覆盖')
  assert.match(h.context.error.value, /已保存/)
  assert.match(h.context.error.value, /读取失败/)
  assert.deepEqual(h.shownErrors, [], '刷新失败不得走 showError 误报为审批操作失败')
  assert.deepEqual(h.confirmed, ['approval'], '服务端明确成功后必须清理幂等键')
  assert.equal(h.context.presaleMutationLoading.value, false)
})

test('审批写入失败：仍按操作失败提示，不宣称完成也不触发刷新链', async () => {
  const h = decisionHarness()
  const saving = h.submitPresaleDecision('reject', 7, 3, '不同意')
  h.pending.reject(new Error('服务端拒绝'))
  await saving
  assert.equal(h.shownErrors.length, 1, '写失败必须按操作失败报告')
  assert.equal(h.context.notice.value, '')
  assert.equal(h.context.error.value, '')
  assert.deepEqual(h.confirmed, [], '结果未知/失败时幂等键保留，便于人工复用原键重试')
  assert.equal(h.context.presaleMutationLoading.value, false, 'finally 必须释放进行中标志')
})

// —— 指派记录/审批历史读取：任务 C 请求作用域（此前完全缺少响应归属校验）——

function inspectorHarness() {
  const pending = []
  const context = {
    selectedPresale: ref({ request: { id: 7 } }),
    presaleInspectorLoading: ref(false),
    presaleInspectorPanel: ref(''),
    presaleInspectorError: ref(''),
    presaleAssignments: ref([]),
    presaleApprovalHistory: ref([]),
    presaleInspectorScope: createRequestScope(),
    getAssignments: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    getApprovalHistory: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    resolveOwnerNames: () => {},
    formatCRMError: (value) => value.message,
    subsystemAccessMessage: () => '',
  }
  return { ...functions('./views/CustomerOpportunityView.vue', ['loadPresaleInspector'], context), context, pending }
}

test('切换或关闭申请后，在途指派记录响应不得回写新详情', async () => {
  const h = inspectorHarness()
  const loading = h.loadPresaleInspector('assignments')
  // openPresale/closePresale 会整体失效详情链票据；此处直接模拟该切换。
  h.context.presaleInspectorScope.invalidate()
  h.context.selectedPresale.value = { request: { id: 9 } }
  h.pending[0].resolve([{ assignee_id: 'old-request-user' }])
  await loading
  assert.deepEqual(h.context.presaleAssignments.value, [], '旧申请的迟到响应不得污染新详情')
  assert.equal(h.context.presaleInspectorError.value, '')
})

test('当前申请的指派记录正常回写并结束加载状态', async () => {
  const h = inspectorHarness()
  const loading = h.loadPresaleInspector('assignments')
  h.pending[0].resolve([{ assignee_id: 'user-1' }])
  await loading
  assert.deepEqual(h.context.presaleAssignments.value, [{ assignee_id: 'user-1' }])
  assert.equal(h.context.presaleInspectorLoading.value, false)
})

// —— 审批规则面板：任务 B 保存/重读分离 + 任务 C 规则读取作用域 ——

function rulesHarness() {
  const pending = deferred()
  const reloads = []
  const resetCalls = []
  const context = {
    canEdit: ref(true),
    saving: ref(false),
    deletingRuleId: ref(''),
    error: ref(''),
    editing: ref('r1'),
    activeRuleId: ref('r1'),
    loading: ref(false),
    rules: ref([{ id: 'stale' }]),
    rulesScope: createRequestScope(),
    form: { name: '规则A', priority: 1, enabled: true, nodes: [{ id: 'n1', name: '审批', type: 'APPROVAL', role_code: 'sales_director' }], version: 2 },
    validateRule: () => '',
    reset: () => resetCalls.push(1),
    formatCRMError: (value) => String(value?.message || '规则错误'),
    updatePresaleApprovalRule: () => pending.promise,
    createPresaleApprovalRule: async () => { throw new Error('create not used in this test') },
    deletePresaleApprovalRule: async () => { throw new Error('delete not used in this test') },
    listPresaleApprovalRules: () => new Promise((resolve, reject) => reloads.push({ resolve, reject })),
  }
  return {
    ...functions('./components/PresaleApprovalRulesPanel.vue', ['load', 'save'], context),
    context, pending, reloads, resetCalls,
  }
}

test('规则保存成功后列表重读失败：提示已保存与读取失败，不误报规则保存失败', async () => {
  const h = rulesHarness()
  const saving = h.save()
  h.pending.resolve({ id: 'r1' })
  await until(() => h.reloads.length === 1) // 等保存流程推进到保存后的重读
  h.reloads[0].reject(new Error('保存后重读失败'))
  await saving
  assert.equal(h.context.saving.value, false)
  assert.deepEqual(h.resetCalls, [1], '保存成功后仍清空编辑器')
  assert.match(h.context.error.value, /规则已保存/)
  assert.match(h.context.error.value, /读取失败/)
  assert.doesNotMatch(h.context.error.value, /保存失败/, '重读失败不得报成保存失败')
})

test('规则读取被新请求或卸载取代后，迟到响应不回写列表也不报错', async () => {
  const h = rulesHarness()
  const loading = h.load()
  h.context.rulesScope.invalidate() // 模拟组件卸载（requestScope onScopeDispose）或已发起新读取
  h.reloads[0].reject(new Error('late response'))
  await loading
  assert.deepEqual(h.context.rules.value, [{ id: 'stale' }], '迟到响应不得覆盖现有规则列表')
  assert.equal(h.context.error.value, '')
})
