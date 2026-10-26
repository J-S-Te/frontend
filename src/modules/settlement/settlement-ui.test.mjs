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
  assert.match(receiptsPanel, /can\('settlement\.invoice\.request'\)/)
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
