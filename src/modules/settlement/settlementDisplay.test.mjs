import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allocationStatusMeta,
  amountOf,
  buildInvoiceTimelineEvents,
  collectionStatusLabel,
  confirmationState,
  dunningActionStatusLabel,
  dunningCaseStatusLabel,
  dueState,
  formatSettlementAmount,
  invoiceTypeLabel,
  isCurrentMonth,
  issueChannelLabel,
  money,
  receivableInvoiceStatusLabel,
  receiptStatusMeta,
  redFlushStatusLabel,
  invoiceStatusMeta,
} from './utils/settlementDisplay.js'

test('金额工具：amountOf 容错解析，money 输出人民币整数格式', () => {
  assert.equal(amountOf('1234.5'), 1234.5)
  assert.equal(amountOf('abc'), 0)
  assert.equal(amountOf(''), 0)
  assert.equal(money(1234567), '¥1,234,567')
  assert.equal(money(null), '¥0')
})

test('formatSettlementAmount 按数量级简写：亿/万/原值', () => {
  assert.equal(formatSettlementAmount(1.5e8), 'CNY 1.5亿')
  assert.equal(formatSettlementAmount(2.3e4), 'CNY 2.3万')
  assert.equal(formatSettlementAmount(999), '¥999')
  assert.ok(formatSettlementAmount(999).includes('¥'))
})

test('dueState 按剩余天数给出到期语义；无效日期回落待确认', () => {
  const past = dueState(new Date(Date.now() - 10 * 86400000).toISOString())
  assert.equal(past.label, '逾期')
  assert.equal(past.tone, 'danger')
  const soon = dueState(new Date(Date.now() + 3 * 86400000).toISOString())
  assert.equal(soon.label, '即将到期')
  assert.equal(soon.tone, 'warning')
  assert.deepEqual(dueState(''), { label: '待确认', tone: 'gray' })
  assert.deepEqual(dueState('not-a-date'), { label: '待确认', tone: 'gray' })
})

test('isCurrentMonth 仅当同月同月内日期为真', () => {
  const now = new Date()
  assert.equal(isCurrentMonth(now.toISOString()), true)
  assert.equal(isCurrentMonth(new Date(now.getFullYear(), now.getMonth() + 2, 15).toISOString()), false)
  assert.equal(isCurrentMonth(''), false)
})

test('催收与确认状态文案映射', () => {
  assert.equal(dunningActionStatusLabel('PENDING'), '待跟进')
  assert.equal(dunningActionStatusLabel('COMPLETED'), '已完成')
  assert.equal(dunningActionStatusLabel('X'), 'X')
  assert.equal(dunningCaseStatusLabel('ACTIVE'), '跟进中')
  assert.equal(dunningCaseStatusLabel('CLOSED'), '已关闭')
  assert.deepEqual(confirmationState('CONFIRMED'), { label: '已确认', tone: 'success' })
  assert.deepEqual(confirmationState('OTHER'), { label: '待确认', tone: 'warning' })
})

test('发票状态元数据：已知状态给标签与色调，未知回落灰色', () => {
  assert.deepEqual(invoiceStatusMeta('SUBMITTED'), { label: '待审核', tone: 'warning' })
  const unknown = invoiceStatusMeta('NOT_A_STATUS')
  assert.equal(unknown.tone, 'gray')
  assert.ok(unknown.label.length > 0)
  assert.equal(collectionStatusLabel('UNPAID'), '未回款')
  assert.equal(collectionStatusLabel('X'), '未知')
  assert.equal(receivableInvoiceStatusLabel('PARTIALLY_INVOICED'), '部分开票')
  assert.equal(invoiceTypeLabel('ELECTRONIC_SPECIAL'), '电子专用发票')
  assert.equal(issueChannelLabel('TAX_ADAPTER'), '税控直连')
  assert.equal(issueChannelLabel('OTHER'), '其他渠道')
  assert.equal(redFlushStatusLabel('RED_FLUSHED'), '已红冲')
  assert.equal(redFlushStatusLabel('X'), '未知')
})

test('核销单与分配状态元数据', () => {
  assert.deepEqual(receiptStatusMeta({ status: 'AVAILABLE' }), { label: '待核销', tone: 'purple' })
  assert.equal(receiptStatusMeta({ status: 'Z' }).tone, 'gray')
  assert.deepEqual(allocationStatusMeta('CONFIRMED'), { label: '已核销', tone: 'success' })
  assert.equal(allocationStatusMeta('REVERSED').label, '已冲销')
})

test('发票详情时间线：按申请号 / 开票日期 / 红冲申请拼装事件，色调与文案随状态变化', () => {
  assert.deepEqual(buildInvoiceTimelineEvents(null), [])
  assert.deepEqual(buildInvoiceTimelineEvents({}), [])
  assert.deepEqual(buildInvoiceTimelineEvents({ request_no: 'R1' }), [
    { tone: 'info', title: '提交开票申请', detail: '申请号 R1 · 合同 —' },
  ])

  const manual = buildInvoiceTimelineEvents({
    request_no: 'R1', contract_no: 'C1', issue_date: '2026-10-01', issued_by_channel: 'MANUAL',
  })
  assert.equal(manual.length, 2)
  assert.equal(manual[0].detail, '申请号 R1 · 合同 C1')
  assert.deepEqual(manual[1], { tone: 'success', title: '开票完成', timestamp: '2026-10-01', detail: '人工登记发票并回填台账' })
  assert.equal(
    buildInvoiceTimelineEvents({ issue_date: '2026-10-01', issued_by_channel: 'TAX_ADAPTER' })[0].detail,
    '税控回执已写入台账',
  )

  const rejected = buildInvoiceTimelineEvents({
    red_flush_request: { status: 'REJECTED', created_at: 't1', updated_at: 't2', review_reason: '金额不符', reason_code: 'INVOICE_ERROR' },
  })
  assert.deepEqual(rejected, [{ tone: 'danger', title: '红冲申请 · 已驳回', timestamp: 't1', detail: '复核意见：金额不符' }])

  const pending = buildInvoiceTimelineEvents({
    red_flush_request: { status: 'SUBMITTED', updated_at: 't2', reason_code: 'INVOICE_ERROR', reason_detail: '税号错误' },
  })
  assert.deepEqual(pending, [{ tone: 'warning', title: '红冲申请 · 待财务复核', timestamp: 't2', detail: '原因：INVOICE_ERROR · 税号错误' }])

  const completed = buildInvoiceTimelineEvents({ red_flush_request: { status: 'COMPLETED', reason_code: 'X' } })
  assert.equal(completed[0].tone, 'success')
  assert.equal(completed[0].timestamp, '', 'created_at/updated_at 均缺失时时间戳为空串')
  assert.equal(completed[0].detail, '原因：X', '无 reason_detail 时不追加分隔符')
  assert.equal(buildInvoiceTimelineEvents({ red_flush_request: { status: 'FAILED', reason_code: 'X' } })[0].tone, 'danger')
})
