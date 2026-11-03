import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allocationStatusMeta,
  amountOf,
  buildInvoiceTimelineEvents,
  collectionStatusLabel,
  confirmationState,
  currencyFractionDigits,
  dunningActionStatusLabel,
  dunningCaseStatusLabel,
  dueState,
  formatSettlementAmount,
  invoiceTypeLabel,
  isBusinessOverdue,
  isCurrentMonth,
  issueChannelLabel,
  money,
  receivableInvoiceStatusLabel,
  receiptStatusMeta,
  redFlushStatusLabel,
  invoiceStatusMeta,
} from './utils/settlementDisplay.js'

// 票面/税额精度（SET-05）：金额固定 2 位小数，0.06 的税额不再被显示成“¥0”。
test('金额工具：amountOf 容错解析，money 按币种小数位输出（CNY/USD=2、JPY=0）', () => {
  assert.equal(amountOf('1234.5'), 1234.5)
  assert.equal(amountOf('abc'), 0)
  assert.equal(amountOf(''), 0)
  assert.equal(money(0.06), '¥0.06')
  assert.equal(money(-100.5), '-¥100.50')
  assert.equal(money(null), '¥0.00')
  assert.equal(money(1234567), '¥1,234,567.00')
  assert.equal(money(1234.5, 'JPY'), 'JP¥1,235')
  assert.equal(money(1234.5, 'USD'), 'US$1,234.50')
  // 未登记币种默认 2 位小数，不允许回落到整数。
  assert.equal(currencyFractionDigits('EUR'), 2)
  assert.equal(currencyFractionDigits(''), 2)
})

test('formatSettlementAmount 按数量级简写：亿/万/原值', () => {
  assert.equal(formatSettlementAmount(1.5e8), 'CNY 1.5亿')
  assert.equal(formatSettlementAmount(2.3e4), 'CNY 2.3万')
  // 不足 1 万时与票面金额同口径：2 位小数。
  assert.equal(formatSettlementAmount(999), '¥999.00')
  assert.equal(formatSettlementAmount(999.5), '¥999.50')
  assert.ok(formatSettlementAmount(999).includes('¥'))
})

// 红票明细行与价税合计都用 money 渲染；恢复 2 位小数后，逐行展示值的合计必须等于
// 合计行的展示值（改前逐行取整到元，行合计与合计行在页面上对不上）。
test('红票明细行展示合计与价税合计展示值自洽', () => {
  const parseDisplayed = (text) => Number.parseFloat(String(text).replace(/[^\d.-]/g, ''))
  const redFlushInvoice = {
    amount_incl_tax: '1.00',
    items: [
      { amount_excl_tax: '0.30', tax_amount: '0.03', amount_incl_tax: '0.33' },
      { amount_excl_tax: '0.31', tax_amount: '0.03', amount_incl_tax: '0.34' },
      { amount_excl_tax: '0.30', tax_amount: '0.03', amount_incl_tax: '0.33' },
    ],
  }
  const lineDisplayTotal = redFlushInvoice.items
    .map((item) => parseDisplayed(money(item.amount_incl_tax)))
    .reduce((total, value) => total + value, 0)
  assert.equal(money(redFlushInvoice.amount_incl_tax), '¥1.00')
  assert.equal(lineDisplayTotal.toFixed(2), String(parseDisplayed(money(redFlushInvoice.amount_incl_tax)).toFixed(2)))
  // 税额明细同样保留到分：单行 0.03 不再显示为 0。
  assert.equal(money(redFlushInvoice.items[0].tax_amount), '¥0.03')
})

// dueState 与 isBusinessOverdue 共用北京日历日口径：到期当天剩 0 天（不逾期），次日起逾期。
// 改前是“UTC 零点绝对时刻”比较：北京到期次日 00:00–08:00 看板显示未到期，逾期统计却已算逾期。
test('dueState 按北京日历日给出到期语义；无效日期回落待确认', (t) => {
  // 北京 2026-03-15 12:00（UTC 04:00）。
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-03-15T04:00:00Z') })

  // 到期当天：今天到期、剩 0 天，不逾期（标签沿用既有的“即将到期”，面板筛选按标签匹配）。
  assert.deepEqual(dueState('2026-03-15'), { label: '即将到期', tone: 'warning' })
  // 到期日早于北京今天：逾期。
  assert.deepEqual(dueState('2026-03-05'), { label: '逾期', tone: 'danger' })
  assert.deepEqual(dueState('2026-03-14'), { label: '逾期', tone: 'danger' })
  // 剩余天数按日历日算：+7 天仍在即将到期窗口内，+8 天转为未到期。
  assert.deepEqual(dueState('2026-03-22'), { label: '即将到期', tone: 'warning' })
  assert.deepEqual(dueState('2026-03-23'), { label: '未到期', tone: 'info' })
  // 带时区的瞬间按其北京日期归档：北京 03-16 00:30 的瞬间算作 +1 天。
  assert.equal(dueState('2026-03-15T16:30:00.000Z').label, '即将到期')

  assert.deepEqual(dueState(''), { label: '待确认', tone: 'gray' })
  assert.deepEqual(dueState('not-a-date'), { label: '待确认', tone: 'gray' })
  assert.deepEqual(dueState('2026-02-30'), { label: '待确认', tone: 'gray' })
})

test('北京到期次日 00:00–08:00 即判逾期（改前的 UTC 零点语义要拖到 08:00）', (t) => {
  // 北京 2026-03-16 00:30，UTC 仍是 03-15T16:30。
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-03-15T16:30:00Z') })
  assert.deepEqual(dueState('2026-03-15'), { label: '逾期', tone: 'danger' })
  // 同一天的到期日 03-16 北京当天到期，不逾期。
  assert.deepEqual(dueState('2026-03-16'), { label: '即将到期', tone: 'warning' })

  // 北京 2026-03-16 00:00 整（跨北京零点的瞬间）。
  t.mock.timers.setTime(Date.parse('2026-03-15T16:00:00Z'))
  assert.equal(dueState('2026-03-15').label, '逾期')
  assert.equal(dueState('2026-03-16').label, '即将到期')
})

test('dueState 与 isBusinessOverdue 在同一时刻对同一 due_date 结论一致', (t) => {
  // 覆盖北京零点前后、跨月与跨年边界：两个函数必须给出同一个逾期结论。
  const clocks = [
    '2026-03-15T04:00:00Z', // 北京 03-15 12:00
    '2026-03-15T15:59:00Z', // 北京 03-15 23:59
    '2026-03-15T16:00:00Z', // 北京 03-16 00:00（UTC 仍是 03-15）
    '2026-03-15T16:30:00Z', // 北京 03-16 00:30
    '2026-03-16T00:00:00Z', // 北京 03-16 08:00
    '2026-03-31T16:30:00Z', // 北京 04-01 00:30（跨月）
    '2026-12-31T16:30:00Z', // 北京 2027-01-01 00:30（跨年）
  ]
  const dueDates = [
    '2026-02-28', '2026-03-14', '2026-03-15', '2026-03-16', '2026-03-22', '2026-03-23',
    '2026-04-01', '2026-12-31', '2027-01-01', '2999-12-31',
  ]
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(clocks[0]) })
  for (const clock of clocks) {
    t.mock.timers.setTime(Date.parse(clock))
    for (const dueDate of dueDates) {
      const overdueByState = dueState(dueDate).label === '逾期'
      assert.equal(
        overdueByState,
        isBusinessOverdue(dueDate),
        `${clock} / due_date=${dueDate}：看板到期状态与逾期统计必须一致`,
      )
      // 瞬间形态（带时区的到期时间戳）与纯日期形态也必须一致。
      const dueInstant = `${dueDate}T12:00:00+08:00`
      assert.equal(
        dueState(dueInstant).label === '逾期',
        isBusinessOverdue(dueInstant),
        `${clock} / due_date=${dueInstant}：瞬间形态同样必须一致`,
      )
    }
  }
})

test('逾期按北京日历日判定：到期当天不算逾期，次日起算（改前 08:00 起即误判）', (t) => {
  // 北京 2026-03-15 12:00：纯日期 due_date 被当作 UTC 零点的旧实现会在这里就判逾期。
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-03-15T04:00:00Z') })
  assert.equal(isBusinessOverdue('2026-03-15'), false, '到期当天不是逾期')
  assert.equal(isBusinessOverdue('2026-03-14'), true, '到期次日（北京日历日）起是逾期')
  assert.equal(isBusinessOverdue('2026-03-16'), false, '未到期')
  assert.equal(isBusinessOverdue(''), false, '缺日期不判逾期')
  assert.equal(isBusinessOverdue('not-a-date'), false, '非法日期不判逾期')

  // 北京 2026-03-16 00:30（UTC 仍是 03-15）：北京已进入次日，到期日 03-15 应算逾期。
  t.mock.timers.setTime(Date.parse('2026-03-15T16:30:00Z'))
  assert.equal(isBusinessOverdue('2026-03-15'), true, '跨北京零点立即进入逾期')
  assert.equal(isBusinessOverdue('2026-03-16'), false)
})

test('isCurrentMonth 按北京自然月判定，纯日期不平移', (t) => {
  // 北京 2026-04-01 00:30（UTC 仍是 03-31）：北京已是 4 月，UTC 日历日还是 3 月。
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-03-31T16:30:00Z') })
  assert.equal(isCurrentMonth('2026-04-01'), true, '纯日期原样归入北京 4 月，不做时区平移')
  assert.equal(isCurrentMonth('2026-03-31'), false, '北京 3 月已不是本月')
  assert.equal(isCurrentMonth('2026-04-30'), true)
  assert.equal(isCurrentMonth(new Date(Date.parse('2026-04-10T02:00:00Z')).toISOString()), true, '瞬间按北京日期归月')
  assert.equal(isCurrentMonth(new Date(Date.parse('2026-03-31T15:59:00Z')).toISOString()), false, '北京 3 月 23:59 属上月')
  assert.equal(isCurrentMonth(''), false)
  assert.equal(isCurrentMonth('not-a-date'), false)
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

test('发票状态元数据：已知状态给标签与色调，作废 / 放弃给终态语义，未知降级为失败且不空白', () => {
  assert.deepEqual(invoiceStatusMeta('SUBMITTED'), { label: '待审核', tone: 'warning' })
  // SET-06：CANCELLED 是已作废终态（释放额度），ABANDONED 是税控尝试被放弃的失败结果。
  assert.deepEqual(invoiceStatusMeta('CANCELLED'), { label: '已作废', tone: 'gray' })
  assert.deepEqual(invoiceStatusMeta('ABANDONED'), { label: '已放弃开具', tone: 'danger' })
  assert.deepEqual(invoiceStatusMeta('ISSUE_UNKNOWN'), { label: '结果待对账', tone: 'warning' })
  // 未知状态（含后续版本新增枚举）降级为失败语义，保留原始代码，绝不渲染空白。
  const unknown = invoiceStatusMeta('NOT_A_STATUS')
  assert.equal(unknown.tone, 'danger')
  assert.match(unknown.label, /NOT_A_STATUS/)
  assert.equal(invoiceStatusMeta('').label, '状态未知')
  assert.equal(invoiceStatusMeta(undefined).tone, 'danger')
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
