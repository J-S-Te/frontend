import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse as parseJavaScript } from '@babel/parser'
import * as Vue from 'vue'
import { useInvoiceRequests } from './composables/useInvoiceRequests.js'
import { useReceivablePlans } from './composables/useReceivablePlans.js'

const source = readFileSync(new URL('./views/SettlementView.vue', import.meta.url), 'utf8')
const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
const statements = parseJavaScript(script, { sourceType: 'module' }).program.body
const navigation = await import('./composables/useSettlementTaskNavigation.js')

// 用途：执行正式结算视图中实际声明的任务派生与接线。
// 参数：context 为隔离的响应式业务状态，names 为需调用的视图函数。
// 返回值：真实任务分组及指定函数。
function viewState(context, names = []) {
  const functions = statements.filter(node => node.type === 'FunctionDeclaration'
    && names.includes(node.id.name)).map(node => script.slice(node.start, node.end))
  const groups = statements.find(node => node.type === 'VariableDeclaration'
    && node.declarations.some(item => item.id.name === 'taskGroups'))
  assert.equal(functions.length, names.length, '结算视图须提供真实任务导航接线')
  return new Function(...Object.keys(context), `${functions.join('\n')}
    ${script.slice(groups.start, groups.end)}; return { taskGroups, ${names.join(',')} }`)(
    ...Object.values(context))
}

// 用途：组合真实结算表单控制器与任务导航，仅替换授权分页 HTTP 边界。
// 参数：options 为初始路由、列表和分页响应。
// 返回值：可见表单、导航状态、读取记录和销毁入口。
function harness(options = {}) {
  assert.equal(typeof navigation.useSettlementTaskNavigation, 'function')
  const scope = Vue.effectScope(), writes = [], reads = []
  const route = Vue.reactive({ params: { section: options.section || 'invoices' }, query: options.query || {} })
  const context = {
    computed: Vue.computed, route, active: Vue.computed(() => route.params.section),
    loading: Vue.ref(false), saving: Vue.ref(false), listPages: Vue.ref({}),
    plans: Vue.ref(options.plans || []), invoiceRequests: Vue.ref(options.requests || []),
    allocations: Vue.ref([]), dunningCases: Vue.ref(options.cases || []),
    dunningActions: Vue.ref(options.actions || []), specialReview: Vue.ref(null),
    dunningActionDialog: Vue.ref(null),
    allocationTab: Vue.ref('allocations'),
    can: permission => !(options.denied || []).includes(permission),
    canLoad: () => options.readable !== false,
    canCompleteDunningAction: item => item.status === 'PENDING' && item.recipient_user_id === 'me',
    completeDunningAction: item => { context.dunningAction = item },
  }
  const common = { saving: context.saving, can: context.can, notify() {},
    act: () => assert.fail('导航不应执行结算写操作'), load: async () => true,
    formatSettlementError: error => error.message,
    createInvoiceRequest: value => writes.push(value), approveInvoiceRequest: value => writes.push(value) }
  Object.assign(context, useInvoiceRequests({ ...common, active: context.active,
    invoiceRequests: context.invoiceRequests, taxInvoices: Vue.ref([]), invoiceEligibleReceivables: Vue.ref([]) }))
  Object.assign(context, useReceivablePlans({ ...common, plans: context.plans,
    confirmReceivablePlan: value => writes.push(value) }))
  for (const name of ['listReceivablePlans', 'listInvoiceRequests', 'listReceiptAllocations',
    'listDunningCases']) {
    context[name] = async query => {
      reads.push({ name, ...query })
      return options.read ? options.read(name, query) : []
    }
  }
  const ui = viewState(context, ['settlementTaskSources', 'confirmFinancialPlan', 'reviewSpecialInvoice'])
  const router = { push: async target => {
    route.params.section = target.params.section; route.query = target.query
  }, replace: async target => { route.query = target.query } }
  const nav = scope.run(() => navigation.useSettlementTaskNavigation({ route, router,
    active: context.active, loading: context.loading, saving: context.saving,
    sources: ui.settlementTaskSources() }))
  return { context, route, reads, writes, ...nav, stop: () => scope.stop() }
}

// 用途：等待真实 Vue 路由监听和异步读取链结束。
// 参数：无。
// 返回值：异步完成，不连接业务服务。
async function flush() { await new Promise(resolve => setImmediate(resolve)); await Vue.nextTick() }

test('结算待办派生保留真实 id、类型和业务分区', () => {
  const context = { computed: Vue.computed, can: () => true, formatSettlementAmount: value => value,
    plans: Vue.ref([]), allocations: Vue.ref([]), dunningCases: Vue.ref([]),
    invoiceRequests: Vue.ref([{ id: 'REQ-7', request_no: 'KP-7', status: 'SUBMITTED', version: 3 }]) }
  const task = viewState(context).taskGroups.value.find(group => group.key === 'invoices').items[0]
  assert.equal(task.id, 'REQ-7')
  assert.equal(task.kind, 'invoices')
  assert.equal(task.section, 'invoices')
})

test('点击开票待办用 request_id 打开原审核表单，特殊状态打开加签且不写业务', async () => {
  const requests = [{ id: 'REQ-7', request_no: 'KP-7', version: 3, status: 'SUBMITTED' },
    { id: 'REQ-8', request_no: 'KP-8', version: 5, status: 'SPECIAL_REVIEW' }]
  const h = harness({ section: 'tasks', requests })
  try {
    await h.openTask({ id: 'REQ-7', kind: 'invoices', section: 'invoices' })
    await flush()
    assert.deepEqual(h.route.query, { request_id: 'REQ-7' })
    assert.equal(h.context.invoiceReviewOpen.value, true)
    assert.equal(h.context.invoiceReview.value.id, 'REQ-7')
    await h.openTask({ id: 'REQ-8', kind: 'invoices', section: 'invoices' })
    await flush()
    assert.equal(h.context.specialReview.value.item.id, 'REQ-8')
    assert.deepEqual(h.writes, [])
  } finally { h.stop() }
})

test('冷进开票申请深链从授权分页定位后页记录，不把第一页未命中当不存在', async () => {
  const first = Array.from({ length: 50 }, (_, index) => ({ id: `other-${index}` }))
  const h = harness({ query: { request_id: 'REQ-99' }, read: (_name, { offset }) =>
    offset === 0 ? first : [{ id: 'REQ-99', request_no: 'KP-99', status: 'SUBMITTED', version: 7 }] })
  try {
    await flush()
    assert.deepEqual(h.reads.map(row => row.offset), [0, 50])
    assert.equal(h.context.invoiceReview.value.id, 'REQ-99')
    assert.equal(h.context.listPages.value[4], 1)
  } finally { h.stop() }
})

test('计划待办打开原确认编辑器，催收提醒按应收 ID 关联真实案件和跟进', async () => {
  const h = harness({ section: 'tasks', plans: [{ id: 'PLAN-7', status: 'PENDING_CONFIRMATION',
    version: 4, planned_amount: '100.00', due_date: '2026-12-01' }],
  cases: [{ id: 'CASE-7', receivable_id: 'AR-7', status: 'ACTIVE' }],
  actions: [{ id: 'ACTION-7', case_id: 'CASE-7', receivable_id: 'AR-7', status: 'PENDING', recipient_user_id: 'me' }] })
  try {
    await h.openTask({ id: 'PLAN-7', kind: 'plans', section: 'receivables' })
    await flush()
    assert.equal(h.context.planEditorOpen.value, true)
    assert.equal(h.context.planEditor.value.id, 'PLAN-7')
    h.route.params.section = 'dunning'; h.route.query = { receivable_id: 'AR-7' }
    await flush()
    assert.equal(h.target.value.item.id, 'CASE-7')
    assert.equal(h.context.dunningAction.id, 'ACTION-7')
    assert.deepEqual(h.writes, [])
  } finally { h.stop() }
})

test('权限不足或申请已处理不打开审核，超过定位上限明确未完成定位', async () => {
  const denied = harness({ query: { request_id: 'REQ-7' }, readable: false })
  try {
    await flush()
    assert.equal(denied.context.invoiceReviewOpen.value, false)
    assert.deepEqual(denied.reads, [])
    assert.match(denied.targetMessage.value, /权限/)
  } finally { denied.stop() }
  const closed = harness({ query: { request_id: 'REQ-7' },
    requests: [{ id: 'REQ-7', status: 'APPROVED' }] })
  try {
    await flush()
    assert.equal(closed.context.invoiceReviewOpen.value, false)
    assert.match(closed.targetMessage.value, /已处理|不能/)
  } finally { closed.stop() }
  const bounded = harness({ query: { request_id: 'REQ-7' },
    read: () => Array.from({ length: 50 }, (_, index) => ({ id: `other-${index}` })) })
  try {
    await flush()
    assert.equal(bounded.reads.length, 20)
    assert.match(bounded.targetMessage.value, /尚未|继续/)
    assert.equal(bounded.target.value, null)
  } finally { bounded.stop() }
})

test('旧深链读取迟到不覆盖新目标或重新打开旧表单', async () => {
  let finishOld, count = 0
  const h = harness({ query: { request_id: 'REQ-A' }, read: () => ++count === 1
    ? new Promise(resolve => { finishOld = resolve })
    : [{ id: 'REQ-B', status: 'SUBMITTED', version: 3 }] })
  try {
    h.route.query.request_id = 'REQ-B'
    await flush()
    finishOld([{ id: 'REQ-A', status: 'SUBMITTED', version: 1 }])
    await flush()
    assert.equal(h.target.value.item.id, 'REQ-B')
    assert.equal(h.context.invoiceReview.value.id, 'REQ-B')
    assert.equal(h.context.invoiceRequests.value[0].id, 'REQ-B')
  } finally { h.stop() }
})

test('卸载后的迟到分页响应不回填列表或打开业务表单', async () => {
  let complete
  const h = harness({ query: { request_id: 'REQ-7' },
    read: () => new Promise(resolve => { complete = resolve }) })
  h.stop()
  complete([{ id: 'REQ-7', status: 'SUBMITTED', version: 1 }])
  await flush()
  assert.equal(h.target.value, null)
  assert.equal(h.context.invoiceReviewOpen.value, false)
  assert.deepEqual(h.context.invoiceRequests.value, [])
})

test('重复或冲突单据坐标不读取申请，旧 invoice_id 仍仅用于已开发票', async () => {
  for (const query of [{ request_id: ['A', 'B'] }, { request_id: 'A', invoice_id: 'TAX-1' }]) {
    const h = harness({ query })
    try {
      await flush()
      assert.deepEqual(h.reads, [])
      assert.equal(h.context.invoiceReviewOpen.value, false)
      assert.match(h.targetMessage.value, /无效/)
    } finally { h.stop() }
  }
  const invoice = harness({ query: { invoice_id: 'TAX-1' } })
  try {
    await flush()
    assert.deepEqual(invoice.reads, [])
    assert.equal(invoice.target.value, null)
    assert.equal(invoice.targetMessage.value, '')
  } finally { invoice.stop() }
})

test('同一申请写入失败后解除忙锁不重置仍在编辑的审批意见', async () => {
  const h = harness({ query: { request_id: 'REQ-7' },
    requests: [{ id: 'REQ-7', request_no: 'KP-7', status: 'SUBMITTED', version: 3 }] })
  try {
    await flush()
    h.context.invoiceReview.value.reason = '保留待补充的审批依据'
    h.context.saving.value = true
    await Vue.nextTick()
    h.context.saving.value = false
    await flush()
    assert.equal(h.context.invoiceReview.value.reason, '保留待补充的审批依据')
  } finally { h.stop() }
})
