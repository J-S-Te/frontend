import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Settlement view exposes the first-phase financial workflow without mock records', async () => {
  const source = await readFile(new URL('./views/SettlementView.vue', import.meta.url), 'utf8')
  // 发票详情域（含红冲申请/复核文案）已迁入 useInvoiceDetail.js，相关文案断言按归属指向 composable 源。
  const invoiceDetail = await readFile(new URL('./composables/useInvoiceDetail.js', import.meta.url), 'utf8')
  const dunningPanel = await readFile(new URL('./components/DunningCenterPanel.vue', import.meta.url), 'utf8')
  const receivablesPanel = await readFile(new URL('./components/SettlementReceivablesPanel.vue', import.meta.url), 'utf8')
  const receiptsPanel = await readFile(new URL('./components/SettlementReceiptsPanel.vue', import.meta.url), 'utf8')
  const invoiceDetailPanel = await readFile(new URL('./components/SettlementInvoiceDetailPanel.vue', import.meta.url), 'utf8')
  const invoiceListPanel = await readFile(new URL('./components/SettlementInvoiceListPanel.vue', import.meta.url), 'utf8')
  for (const section of ['dashboard', 'receivables', 'invoices', 'receipts', 'allocations', 'dunning', 'tasks']) assert.match(source, new RegExp(`'${section}'`))
  assert.match(source, /confirmReceivablePlan/)
  assert.match(source, /createReceiptAllocation/)
  assert.match(source, /registerManualInvoice/)
  // 开票管理区模板已提取为 SettlementInvoiceListPanel.vue（golden 逐字节锁定），动作权限与人工渠道分支断言随之指向组件源。
  assert.match(invoiceListPanel, /item\.issue_channel === 'MANUAL'/)
  assert.match(receiptsPanel, /can\('settlement\.receipt\.record'\)/)
  assert.match(source, /<SettlementReceiptsPanel[\s\S]{0,600}:can="can"/)
  assert.match(invoiceListPanel, /can\('settlement\.invoice\.approve'\)/)
  assert.match(invoiceListPanel, /can\('settlement\.invoice\.issue'\)/)
  assert.match(source, /<SettlementInvoiceListPanel[\s\S]{0,900}v-model:invoice-tab="invoiceTab"/)
  assert.match(source, /submitPlanConfirmation/)
  assert.match(source, /submitInvoiceReview/)
  assert.match(receiptsPanel, /回款匹配建议/)
  assert.match(source, /uploadInvoiceDocument/)
  assert.match(source, /submitRedFlush/)
  assert.match(source, /reviewRedFlush/)
  assert.match(invoiceDetail, /待财务复核/)
  assert.match(source, /useInvoiceDetail\(\{/)
  assert.match(source, /match_confidence: match\.score/)
  // 开票详情区模板已提取为 SettlementInvoiceDetailPanel.vue（golden 逐字节锁定），详情文案与明细来源断言随之指向组件源。
  assert.match(invoiceDetailPanel, /原发票在收到有效税控回执前仍保持已开具状态/)
  assert.match(invoiceDetailPanel, /items_source/)
  assert.match(invoiceDetailPanel, /request_items/)
  assert.match(invoiceDetailPanel, /申请依据/)
  assert.match(source, /<SettlementInvoiceDetailPanel[\s\S]{0,600}v-model:red-flush-open="redFlushOpen"/)
  assert.match(source, /receiptCustomers/)
  // 应收区模板已提取为 SettlementReceivablesPanel.vue（golden 逐字节锁定），状态文案函数的使用断言随之指向组件源。
  assert.match(receivablesPanel, /collectionStatusLabel/)
  assert.match(receivablesPanel, /receivableInvoiceStatusLabel/)
  assert.match(source, /<SettlementReceivablesPanel[\s\S]{0,600}v-model:plan-editor-open="planEditorOpen"/)
  assert.match(source, /exportAgingReceivables/)
  assert.doesNotMatch(source, /正式账龄报表与受控导出需接入/)
  assert.match(source, /logoutCurrentSession/)
  assert.match(source, /closeSubsystemTabOrFallback/)
  assert.match(source, /getSettlementSession/)
  assert.match(source, /sessionDisplayName/)
  assert.match(source, /统一认证已接入/)
  assert.doesNotMatch(source, />平台管理员</)
  assert.doesNotMatch(source, />超级管理员</)
  assert.match(source, /reason: "session-ended"/)
  assert.match(source, /:disabled="isLoggingOut"/)
  assert.match(source, /modules\/platform\/styles\/console\.css/)
  assert.match(source, /console-page settlement-shell/)
  assert.match(source, /console-sidebar settlement-sidebar/)
  assert.match(source, /console-topbar settlement-topbar/)
  assert.match(source, /console-content settlement-content/)
  assert.match(source, /navigationGroups/)
  assert.match(source, /dashboardKpis/)
  assert.match(source, /workItems/)
  // 回归锁定：催收页账龄区间报表必须绑定真实计算属性 agingRows。
  // 历史缺陷：定义改名 agingRows 后本表仍用旧名 agingBuckets，绑定悬空导致 tbody 长期空渲染。
  // 催收区模板已提取为 DunningCenterPanel.vue（golden 逐字节锁定），表格绑定断言随之指向组件源；视图经 :aging-rows 传入。
  assert.match(dunningPanel, /\(item, index\) in agingRows/)
  assert.doesNotMatch(dunningPanel, /agingBuckets/)
  assert.doesNotMatch(source, /agingBuckets/)
  assert.match(source, /<DunningCenterPanel[\s\S]{0,600}:aging-rows="agingRows"/)
  assert.match(source, /getDunningOverview/)
  assert.match(source, /completeDunningAction/)
  assert.match(source, /dunningOverview/)
  assert.match(source, /getAgingSummary/)
  assert.match(source, /agingRows/)
  assert.match(source, /getDunningCoverage/)
  assert.match(dunningPanel, /策略覆盖巡检/)
  assert.match(source, /settlementScope\.begin\(/)
  assert.match(source, /settlementScope\.isCurrent\(ticket\)/)
  assert.doesNotMatch(source, /示例客户|mockReceivable|演示数据/)
})

test('Settlement view ships Phase A/B/C UI optimization helpers and components', async () => {
  const view = await readFile(new URL('./views/SettlementView.vue', import.meta.url), 'utf8')
  const css = await readFile(new URL('./styles/settlement.css', import.meta.url), 'utf8')
  const invoiceDetailPanel = await readFile(new URL('./components/SettlementInvoiceDetailPanel.vue', import.meta.url), 'utf8')
  const timeline = await readFile(
    new URL('./components/SettlementTimeline.vue', import.meta.url),
    'utf8',
  )
  // 阶段 B：KPI 金额缩写与本月筛选。
  assert.match(view, /formatSettlementAmount/)
  assert.match(view, /isCurrentMonth/)
  assert.match(view, /currentMonthReceipts/)
  assert.match(view, /本月回款 · 服务端按币种汇总/)
  assert.match(view, /dashboardCurrencyTotals/)
  // 阶段 B.1：dashboardKpis 与 dunningKpis 均使用金额缩写函数。
  assert.match(view, /dashboardCurrencyTotals\(\s*\n?\s*"open_receivable"/)
  assert.match(view, /currency_totals/)
  // 阶段 C：SettlementTimeline 组件与发票时间线接线。
  // 阶段 C 的时间线接线已随开票详情区迁入 SettlementInvoiceDetailPanel.vue。
  assert.match(invoiceDetailPanel, /import SettlementTimeline/)
  assert.match(invoiceDetailPanel, /<SettlementTimeline :events="invoiceTimelineEvents"/)
  assert.match(timeline, /settlement-timeline-event/)
  assert.match(timeline, /tone-(success|warning|danger|info|purple)/)
  // 阶段 C.6：将“我的待办”区域重构为分组任务列表。
  assert.match(view, /taskGroups/)
  // 「我的待办」区模板已提取为 SettlementTasksPanel.vue（golden 逐字节锁定），任务项类名断言随之指向组件源。
  const tasksPanel = await readFile(new URL('./components/SettlementTasksPanel.vue', import.meta.url), 'utf8')
  assert.match(tasksPanel, /settlement-task-item/)
  assert.match(view, /<SettlementTasksPanel[\s\S]{0,200}:task-groups="taskGroups"/)
  // 阶段 A：CSS 变量与交互细节状态。
  assert.match(css, /var\(--green, #16a34a\)/)
  assert.match(css, /var\(--orange, #d97706\)/)
  assert.match(css, /var\(--red, #dc2626\)/)
  assert.match(css, /var\(--purple-text, #6d28d9\)/)
  assert.match(css, /animation: settlement-fade-in \.25s ease-out/)
  assert.match(css, /\.settlement-panel table tbody tr:hover/)
  assert.match(css, /translateY\(-2px\)/)
  assert.match(css, /translateY\(-1px\)/)
})

// DEF-01/02/03 回归：人工计划/受控调整与开票申请在提交前必须给出应用级字段反馈；
// 仅依赖原生 required 时浏览器气泡会抢先阻断提交，页面表现为“点击无反应”。
// 字段定义与文案由 utils/formFeedback.test.mjs 锁定；此处锁定组件接线：
// novalidate → 纯函数校验 → aria-invalid 红框 + 字段错误文案 + 聚焦首个错误 → 通过后才写入或 emit。
test('结算人工计划与开票申请提交前给出应用级必填反馈并聚焦首个错误字段', async () => {
  const rolePanel = await readFile(new URL('./components/SettlementRolePanel.vue', import.meta.url), 'utf8')
  const invoicePanel = await readFile(new URL('./components/SettlementInvoiceListPanel.vue', import.meta.url), 'utf8')
  const handler = (source, name) => {
    const start = source.indexOf('async function ' + name + '(')
    assert.ok(start >= 0, name)
    return source.slice(start, source.indexOf('\n}', start) + 2)
  }
  for (const [name, source] of [['SettlementRolePanel', rolePanel], ['SettlementInvoiceListPanel', invoicePanel]]) {
    assert.match(source, /novalidate/, name + ': 原生 required 气泡必须关闭')
    assert.ok(source.includes('formFeedback.js'), name + ': 校验逻辑来自纯函数模块')
    assert.match(source, /:aria-invalid=/, name + ': 字段标红语义')
    assert.ok(source.includes('settlement-field-error'), name + ': 字段级错误文案')
    assert.match(source, /required/, name + ': 保留 required 语义属性')
    assert.ok(source.includes('firstInvalidField'), name + ': 首个错误定位')
    assert.ok(source.includes('.focus()'), name + ': 聚焦第一个错误字段')
  }
  // 创建计划：合同、期次、收款日、金额、原因五个字段都有错误映射；校验先于写入。
  for (const key of ['contract_snapshot_id', 'installment_no', 'due_date', 'planned_amount', 'reason']) {
    assert.ok(rolePanel.includes('planErrors.' + key), 'planErrors.' + key)
  }
  const createHandler = handler(rolePanel, 'submitPlanCreate')
  assert.ok(createHandler.includes('validateForm(PLAN_CREATE_FIELDS'), '创建计划提交前校验')
  assert.ok(createHandler.indexOf('validateForm(') < createHandler.indexOf("save('/receivable-plans'"), '校验先于写入')
  assert.match(createHandler, /return false/, '校验失败必须返回且不写入')
  assert.ok(rolePanel.includes('@submit.prevent="submitPlanCreate"'), '创建计划提交入口走校验包装')
  assert.ok(rolePanel.includes('@submit.prevent="submitPlanAdjust"'), '提交调整提交入口走校验包装')
  // 提交调整：计划、收款日、金额、原因四个字段都有错误映射；校验先于写入。
  for (const key of ['id', 'due_date', 'planned_amount', 'reason']) {
    assert.ok(rolePanel.includes('adjustErrors.' + key), 'adjustErrors.' + key)
  }
  const adjustHandler = handler(rolePanel, 'submitPlanAdjust')
  assert.ok(adjustHandler.includes('validateForm(PLAN_ADJUST_FIELDS'), '提交调整前校验')
  assert.ok(adjustHandler.indexOf('validateForm(') < adjustHandler.indexOf('/adjust'), '校验先于写入')
  // 合同候选为空的可诊断说明（DEF-04 可达性），不放宽数据范围。
  assert.ok(rolePanel.includes('仅显示本人负责且财务已生效的合同'), '合同候选空态说明')
  assert.ok(rolePanel.includes('合同→结算同步与责任人归属'), '合同候选空态排查指引')
  // 开票申请：应收/税号/项目名称/税收分类编码/不含税金额/税率/税额/价税合计八项。
  for (const key of ['receivable_id', 'buyer_tax_no', 'item_name', 'tax_classification_code', 'amount_excl_tax', 'tax_rate', 'tax_amount', 'amount_incl_tax']) {
    assert.ok(invoicePanel.includes('invoiceErrors.' + key), 'invoiceErrors.' + key)
  }
  const invoiceHandler = handler(invoicePanel, 'submitInvoiceForm')
  assert.ok(invoiceHandler.includes('validateForm(INVOICE_REQUEST_FIELDS'), '开票申请提交前校验')
  assert.ok(invoiceHandler.indexOf('validateForm(') < invoiceHandler.indexOf("emit('submit-invoice')"), '校验先于 emit')
  assert.ok(invoiceHandler.indexOf('return') < invoiceHandler.indexOf("emit('submit-invoice')"), '校验失败必须返回且不 emit')
  assert.doesNotMatch(invoicePanel, /@submit\.prevent="\$emit\('submit-invoice'\)"/, '提交入口不允许绕过校验直接 emit')
})

// 行为级证据：在 vm 隔离环境执行组件内真实提交处理函数（聚焦函数用桩替换 nextTick/DOM），
// 证明 DEF-01/02/03 的核心要求——校验不通过不写入/不 emit，修正后才走原写入链路。
test('校验失败时人工计划与开票申请都不进入写入链路，修正后放行', async () => {
  const vm = await import('node:vm')
  const feedback = await import('./utils/formFeedback.js')
  const rolePanelSource = await readFile(new URL('./components/SettlementRolePanel.vue', import.meta.url), 'utf8')
  const invoicePanelSource = await readFile(new URL('./components/SettlementInvoiceListPanel.vue', import.meta.url), 'utf8')
  const extract = (source, name) => {
    const start = source.indexOf('async function ' + name + '(')
    assert.ok(start >= 0, name)
    return source.slice(start, source.indexOf('\n}', start) + 2)
  }
  const planFunctions = extract(rolePanelSource, 'focusFirstInvalid') + '\n' + extract(rolePanelSource, 'submitPlanCreate')
  const writes = []
  const planContext = {
    saving: { value: false },
    plan: { value: { contract_snapshot_id: '', installment_no: 1, due_date: '', planned_amount: '', reason: '' } },
    planErrors: { value: {} },
    planForm: { value: null },
    PLAN_CREATE_FIELDS: feedback.PLAN_CREATE_FIELDS,
    validateForm: feedback.validateForm,
    firstInvalidField: feedback.firstInvalidField,
    nextTick: async () => {},
    save: async (...args) => { writes.push(args); return true },
  }
  const { submitPlanCreate } = vm.runInNewContext(planFunctions + '\n({ submitPlanCreate })', planContext)
  assert.equal(await submitPlanCreate(), false, '缺合同/收款日/金额/原因时不得写入')
  assert.deepEqual(writes, [], '校验失败不得调用 save')
  assert.equal(planContext.planErrors.value.contract_snapshot_id, '请选择合同。')
  assert.equal(planContext.planErrors.value.due_date, '请选择收款日。')
  assert.equal(planContext.planErrors.value.planned_amount, '请填写金额。')
  assert.equal(planContext.planErrors.value.reason, '请填写原因。')
  planContext.plan.value = { contract_snapshot_id: 'CS-1', installment_no: 1, due_date: '2026-11-30', planned_amount: '100000', reason: '测试计划' }
  assert.equal(await submitPlanCreate(), true, '合法表单必须继续原写入链路')
  assert.equal(writes.length, 1, '校验通过后只调用一次 save')
  assert.equal(writes[0][0], '/receivable-plans')
  assert.deepEqual(planContext.planErrors.value, {})

  const invoiceFunctions = extract(invoicePanelSource, 'submitInvoiceForm')
  const events = []
  const invoiceContext = {
    props: {
      invoiceForm: { receivable_id: '', buyer_tax_no: '', item_name: '服务费', tax_classification_code: '', amount_excl_tax: '', tax_rate: '0.06', tax_amount: '', amount_incl_tax: '' },
    },
    invoiceErrors: { value: {} },
    invoiceFormElement: { value: null },
    INVOICE_REQUEST_FIELDS: feedback.INVOICE_REQUEST_FIELDS,
    validateForm: feedback.validateForm,
    firstInvalidField: feedback.firstInvalidField,
    nextTick: async () => {},
    emit: (event) => events.push(event),
  }
  const { submitInvoiceForm } = vm.runInNewContext(invoiceFunctions + '\n({ submitInvoiceForm })', invoiceContext)
  await submitInvoiceForm()
  assert.deepEqual(events, [], '必填缺失时不得 emit submit-invoice')
  assert.equal(invoiceContext.invoiceErrors.value.receivable_id, '请选择可开票应收。')
  assert.equal(invoiceContext.invoiceErrors.value.amount_incl_tax, '请填写价税合计。')
  invoiceContext.props.invoiceForm = { receivable_id: 'AR-1', buyer_tax_no: '91110000MA', item_name: '测评服务', tax_classification_code: '3040201', amount_excl_tax: '10000', tax_rate: '0.06', tax_amount: '600', amount_incl_tax: '10600' }
  await submitInvoiceForm()
  assert.deepEqual(events, ['submit-invoice'], '合法表单必须 emit submit-invoice')
  assert.deepEqual(invoiceContext.invoiceErrors.value, {})
})
