import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { useInvoiceRequests } from './useInvoiceRequests.js'
import { todayBusinessDate } from '../../shared/utils/businessTime.js'

// 原生输入框仅作旧行为对照；新流程必须调用注入的应用内表单。
globalThis.window = { prompt: () => null }

// 用途：建立隔离的结算交互依赖，记录提交与应用内表单请求。
// 参数：测试场景指定可见数据、表单结果及依赖失败。
// 返回值：真实 composable 状态、注入依赖与调用记录。
function harness({ requests = [], invoices = [], eligible = [], refreshed = true, failure = null, cancelFailure = null, promptAnswer = null } = {}) {
  const calls = { create: [], approve: [], reject: [], cancel: [], manual: [], recover: [], prompts: [], load: 0, notify: [], act: [] }
  const deps = {
    can: () => true,
    askPrompt: async (options) => { calls.prompts.push(options); return promptAnswer },
    active: ref("invoices"),
    invoiceRequests: ref(requests),
    taxInvoices: ref(invoices),
    invoiceEligibleReceivables: ref(eligible),
    saving: ref(false),
    notify: (value) => calls.notify.push(value),
    act: async (callback, success) => { try { await callback(); calls.act.push(success) } catch (cause) { calls.act.push(`fail:${cause.message}`) } },
    load: async () => { calls.load++; return refreshed },
    formatSettlementError: (cause, options) => `${options.fallback}|${cause.code}`,
    createInvoiceRequest: async (payload) => { calls.create.push(payload); if (failure) throw failure },
    approveInvoiceRequest: async (id, version) => { calls.approve.push({ id, version }); if (failure) throw failure },
    rejectInvoiceRequest: async (id, version, reason) => { calls.reject.push({ id, version, reason }); if (failure) throw failure },
    cancelInvoiceRequest: async (id, body) => { calls.cancel.push({ id, body }); if (cancelFailure) throw cancelFailure },
    registerManualInvoice: async (id, body) => { calls.manual.push({ id, body }); if (failure) throw failure },
    recoverInvoiceFailure: async (id, body) => { calls.recover.push({ id, body }); if (failure) throw failure },
  }
  return { deps, calls, ...useInvoiceRequests(deps) }
}

test('申请 / 已开发票两路筛选：关键字按各自字段匹配（忽略大小写），状态精确匹配；reset 清空', () => {
  const h = harness({
    requests: [
      { id: 'R1', request_no: 'REQ-001', contract_no: 'HT-1', buyer_name: '甲公司', status: 'SUBMITTED' },
      { id: 'R2', request_no: 'REQ-002', contract_no: 'HT-2', buyer_name: '乙公司', status: 'APPROVED' },
    ],
    invoices: [
      { id: 'I1', invoice_no: '00123', invoice_code: 'C-9', contract_no: 'HT-1', buyer_name: '甲公司', status: 'ISSUED' },
      { id: 'I2', invoice_no: '00456', invoice_code: 'C-8', contract_no: 'HT-2', buyer_name: '乙公司', status: 'RED_FLUSHED' },
    ],
  })
  assert.equal(h.invoiceTab.value, 'requests')
  h.invoiceKeyword.value = ' req-001 '
  assert.deepEqual(h.visibleInvoiceRequests.value.map((item) => item.id), ['R1'])
  h.invoiceKeyword.value = 'c-8'
  assert.deepEqual(h.visibleTaxInvoices.value.map((item) => item.id), ['I2'], '已开发票按发票代码可检索')
  assert.deepEqual(h.visibleInvoiceRequests.value, [], '申请列表不含发票代码字段')
  h.invoiceKeyword.value = ''
  h.invoiceStatusFilter.value = 'APPROVED'
  assert.deepEqual(h.visibleInvoiceRequests.value.map((item) => item.id), ['R2'])
  assert.deepEqual(h.visibleTaxInvoices.value, [])
  h.resetInvoiceFilters()
  assert.equal(h.visibleInvoiceRequests.value.length, 2)
  assert.equal(h.visibleTaxInvoices.value.length, 2)
})

test('开票失败复核弹窗：打开 / 关闭受 saving 保护；原因 5–1000 字内联校验；成功关弹窗刷新提示，刷新失败另文案；接口失败弹窗保持打开', async () => {
  const h = harness()
  const item = { id: 'R1', version: 4 }
  h.deps.saving.value = true
  h.openReviewFailure(item)
  assert.equal(h.reviewFailureDialog.value, null, '进行中不得打开')
  h.deps.saving.value = false
  h.openReviewFailure(item)
  assert.equal(h.reviewFailureDialog.value.error, '')
  h.deps.saving.value = true
  h.closeReviewFailure()
  assert.notEqual(h.reviewFailureDialog.value, null, '进行中不得关闭')
  h.deps.saving.value = false

  await h.submitReviewFailure('太短')
  assert.equal(h.reviewFailureDialog.value.error, '复核原因应为 5 到 1000 字。')
  await h.submitReviewFailure('x'.repeat(1001))
  assert.equal(h.reviewFailureDialog.value.error, '复核原因应为 5 到 1000 字。')
  assert.equal(h.calls.recover.length, 0)

  await h.submitReviewFailure('  税控返回超时，已人工确认未开出  ')
  assert.deepEqual(h.calls.recover, [{ id: 'R1', body: { version: 4, reason: '税控返回超时，已人工确认未开出' } }])
  assert.equal(h.reviewFailureDialog.value, null)
  assert.equal(h.calls.load, 1)
  assert.deepEqual(h.calls.notify, ['失败已复核，申请已恢复待审核；尚未重新开票。'])
  assert.equal(h.deps.saving.value, false)

  const stale = harness({ refreshed: false })
  stale.openReviewFailure(item)
  await stale.submitReviewFailure('原因足够长了')
  assert.deepEqual(stale.calls.notify, ['失败已复核，尚未重新开票；页面刷新失败，请刷新列表查看。无需重复复核。'])

  const failed = harness({ failure: Object.assign(new Error('x'), { code: 'E_RECOVER' }) })
  failed.openReviewFailure(item)
  await failed.submitReviewFailure('原因足够长了')
  assert.notEqual(failed.reviewFailureDialog.value, null, '失败不得关闭弹窗')
  assert.equal(failed.reviewFailureDialog.value.error, '失败复核未完成。|E_RECOVER')
  assert.equal(failed.calls.load, 0)
  assert.equal(failed.deps.saving.value, false)
  h.closeReviewFailure()
  assert.equal(h.reviewFailureDialog.value, null)
})

test('submitInvoice：未选可开票应收只提示；选中后按应收组装买方 / 单条明细 / 余额锁定提交并关编辑器', async () => {
  const eligible = [{ id: 'A1', contract_snapshot_id: 'SNAP-1', customer_id: 'C1', customer_name: '甲公司' }]
  const h = harness({ eligible })
  h.invoiceComposerOpen.value = true
  await h.submitInvoice()
  assert.deepEqual(h.calls.notify, ['请选择应收单。'])
  assert.equal(h.calls.create.length, 0)

  Object.assign(h.invoiceForm.value, {
    receivable_id: 'A1', buyer_tax_no: '91110000MA', item_name: '测评服务', tax_classification_code: '3040201',
    amount_excl_tax: '10000', tax_rate: '0.06', tax_amount: '600', amount_incl_tax: '10600',
  })
  await h.submitInvoice()
  assert.deepEqual(h.calls.create, [{
    contract_snapshot_id: 'SNAP-1',
    buyer_profile: { customer_id: 'C1', name: '甲公司', tax_no: '91110000MA' },
    invoice_type: 'ELECTRONIC_NORMAL',
    special_reason: '',
    items: [{
      item_name: '测评服务', tax_classification_code: '3040201', specification: '', unit: '项', quantity: '1',
      unit_price_excl_tax: '10000', amount_excl_tax: '10000', tax_rate: '0.06', tax_amount: '600', amount_incl_tax: '10600',
    }],
    allocations: [{ receivable_id: 'A1', reserved_amount: '10600' }],
  }])
  assert.equal(h.invoiceComposerOpen.value, false)
  assert.deepEqual(h.calls.act, ['开票申请已提交并锁定可开票余额。'])
})

test('审核：approveInvoice 装载审核项并打开；驳回必须填原因；批准 / 驳回分别调用对应接口并关闭', async () => {
  const h = harness()
  h.approveInvoice({ id: 'R1', version: 2, request_no: 'REQ-001' })
  assert.equal(h.invoiceReviewOpen.value, true)
  assert.deepEqual(h.invoiceReview.value, { id: 'R1', version: 2, request_no: 'REQ-001', reason: '' })

  await h.submitInvoiceReview('reject')
  assert.deepEqual(h.calls.notify, ['驳回开票申请时必须填写驳回原因。'])
  assert.equal(h.calls.reject.length, 0)
  assert.equal(h.invoiceReviewOpen.value, true)

  await h.submitInvoiceReview('approve')
  assert.deepEqual(h.calls.approve, [{ id: 'R1', version: 2 }])
  assert.equal(h.invoiceReviewOpen.value, false)
  assert.deepEqual(h.calls.act, ['开票申请已批准，已进入配置的开具流程。'])

  h.approveInvoice({ id: 'R2', version: 1, request_no: 'REQ-002' })
  h.invoiceReview.value.reason = '  税号与合同不一致  '
  await h.submitInvoiceReview('reject')
  assert.deepEqual(h.calls.reject, [{ id: 'R2', version: 1, reason: '税号与合同不一致' }])
  assert.equal(h.invoiceReviewOpen.value, false)
  assert.equal(h.calls.act.at(-1), '开票申请已驳回，锁定的可开票余额已释放。')
})

test('manualIssue：单次表单取消不登记；完整提交只登记原申请并保留北京日期默认值', async () => {
  const item = { id: 'R1', version: 2, status: 'ISSUE_PENDING', issue_channel: 'MANUAL' }
  const cancelled = harness({ requests: [item] })
  await cancelled.manualIssue(item)
  assert.equal(cancelled.calls.manual.length, 0)
  assert.equal(cancelled.calls.prompts.length, 1)
  const options = cancelled.calls.prompts[0]
  assert.equal(options.confirmText, '登记发票')
  assert.deepEqual(options.fields.map(({ name, type, required }) => ({ name, type, required })), [
    { name: 'invoice_code', type: 'text', required: true },
    { name: 'invoice_no', type: 'text', required: true },
    { name: 'issue_date', type: 'date', required: true },
  ])
  assert.equal(options.fields[2].initialValue, todayBusinessDate())

  const completed = harness({ requests: [item], promptAnswer: {
    invoice_code: ' CODE-1 ', invoice_no: ' NO-9 ', issue_date: '2026-10-26',
  } })
  await completed.manualIssue(item)
  assert.deepEqual(completed.calls.manual, [{ id: 'R1', body: {
    invoice_code: 'CODE-1', invoice_no: 'NO-9', issue_date: '2026-10-26', seller_profile: {},
  } }])
  assert.deepEqual(completed.calls.act, ['发票已登记，应收开票金额已同步更新。'])
})

test('manualIssue：等待表单时单飞，版本、状态、权限、忙锁变化和不完整输入均不登记', async () => {
  const item = { id: 'R1', version: 2, status: 'ISSUE_PENDING', issue_channel: 'MANUAL' }
  const answer = { invoice_code: 'CODE', invoice_no: 'NO', issue_date: '2026-10-26' }
  for (const mutate of [
    (h) => { h.deps.invoiceRequests.value[0].version++ },
    (h) => { h.deps.invoiceRequests.value[0].status = 'ISSUED' },
    (h) => { h.deps.invoiceRequests.value = [] },
    (h) => { h.deps.invoiceRequests.value[0].issue_channel = "TAX_ADAPTER" },
    (h) => { h.deps.active.value = "receipts" },
    (h) => { h.deps.can = null },
    (h) => { h.deps.saving.value = true },
  ]) {
    const h = harness({ requests: [{ ...item }] })
    let resolve
    let allowed = true
    h.deps.can = () => allowed
    // composable 注入后由闭包反映实时权限变化。
    const api = useInvoiceRequests({ ...h.deps, can: () => allowed,
      askPrompt: () => new Promise((done) => { resolve = done }),
    })
    const pending = api.manualIssue(h.deps.invoiceRequests.value[0])
    await api.manualIssue(h.deps.invoiceRequests.value[0])
    assert.equal(h.calls.manual.length, 0)
    mutate(h)
    if (h.deps.can === null) allowed = false
    resolve(answer)
    await pending
    assert.equal(h.calls.manual.length, 0, '表单等待期间条件变化必须阻止登记')
  }
  for (const invalid of [
    { ...answer, invoice_code: '  ' }, { ...answer, invoice_no: '' },
    { ...answer, issue_date: '' }, { ...answer, issue_date: '2026-02-30' },
  ]) {
    const h = harness({ requests: [{ ...item }], promptAnswer: invalid })
    await h.manualIssue(h.deps.invoiceRequests.value[0])
    assert.equal(h.calls.manual.length, 0)
  }
  const denied = harness({ requests: [item] })
  const api = useInvoiceRequests({ ...denied.deps, can: () => false })
  await api.manualIssue(item)
  assert.equal(denied.calls.prompts.length, 0)
})

// SET-06 作废（释放额度）：只在状态允许时进入，原因 5–1000 字，成功后以刷新结果为准，失败保留弹窗。
test('作废弹窗：状态不允许 / 保存中不打开；打开后 5–1000 字原因校验；不做乐观更新', async () => {
  const h = harness({ requests: [{ id: 'R1', version: 4, status: 'ISSUE_FAILED' }] })
  h.deps.saving.value = true
  h.openCancelInvoice({ id: 'R1', version: 4, status: 'ISSUE_FAILED' })
  assert.equal(h.cancelDialog.value, null, '进行中不得打开作废弹窗')
  h.deps.saving.value = false
  // 结果未知 / 已开票等状态即使被调用也不得进入：放行作废等于放行重复开票。
  for (const status of ['ISSUE_UNKNOWN', 'ISSUED', 'SUBMITTED', 'REJECTED', '']) {
    h.openCancelInvoice({ id: 'R1', version: 4, status })
    assert.equal(h.cancelDialog.value, null, status)
  }
  assert.match(h.calls.notify.at(-1), /只有待开具或开具失败的申请可以作废/)
  assert.equal(h.calls.cancel.length, 0)

  h.openCancelInvoice({ id: 'R1', version: 4, status: 'ISSUE_FAILED' })
  assert.equal(h.cancelDialog.value.error, '')
  h.deps.saving.value = true
  h.closeCancelInvoice()
  assert.notEqual(h.cancelDialog.value, null, '进行中不得关闭')
  h.deps.saving.value = false

  await h.submitCancelInvoice('太短')
  assert.equal(h.cancelDialog.value.error, '作废原因应为 5 到 1000 字。')
  await h.submitCancelInvoice('x'.repeat(1001))
  assert.equal(h.cancelDialog.value.error, '作废原因应为 5 到 1000 字。')
  assert.equal(h.calls.cancel.length, 0)

  h.calls.notify.length = 0
  const before = JSON.parse(JSON.stringify(h.deps.invoiceRequests.value))
  await h.submitCancelInvoice('  税控命令已死信，开票尝试从未被受理  ')
  assert.deepEqual(h.calls.cancel, [{ id: 'R1', body: { version: 4, reason: '税控命令已死信，开票尝试从未被受理' } }])
  assert.equal(h.cancelDialog.value, null)
  assert.equal(h.calls.load, 1, '成功后必须刷新，不以本地推断改状态')
  assert.deepEqual(h.deps.invoiceRequests.value, before, '不得乐观更新列表状态')
  assert.deepEqual(h.calls.notify, ['开票申请已作废，未开票的额度预留已释放；请核对可开票余额。'])
  assert.equal(h.deps.saving.value, false)

  const stale = harness({ refreshed: false })
  stale.openCancelInvoice({ id: 'R1', version: 4, status: 'ISSUE_PENDING' })
  await stale.submitCancelInvoice('原因足够长了')
  assert.deepEqual(stale.calls.notify, ['开票申请已作废，但页面刷新失败，请刷新列表核对状态与可用额度；无需重复提交。'])

  h.closeCancelInvoice()
  assert.equal(h.cancelDialog.value, null)
})

test('作废失败：403 / 409 / 连接中断给出明确提示并保留弹窗，不刷新不报成功', async () => {
  const cases = [
    [403, /当前账号无权作废该开票申请/],
    [409, /作废被拒绝.*额度未释放.*禁止重复提交/],
    [0, /连接中断.*勿重复提交/],
  ]
  for (const [status, expected] of cases) {
    const failure = Object.assign(new Error('rejected'), { status, code: status === 409 ? 'SETTLEMENT_CONFLICT' : 'SETTLEMENT_FORBIDDEN' })
    const h = harness({ cancelFailure: failure })
    h.openCancelInvoice({ id: 'R1', version: 3, status: 'ISSUE_FAILED' })
    await h.submitCancelInvoice('核对税控回执后作废')
    assert.notEqual(h.cancelDialog.value, null, '失败不得关闭弹窗')
    assert.match(h.cancelDialog.value.error, expected, String(status))
    assert.equal(h.calls.load, 0, '失败不得刷新或宣称成功')
    assert.deepEqual(h.calls.notify, [], '失败不得提示成功')
    assert.equal(h.deps.saving.value, false)
  }
  // 其余错误（例如原因格式、申请人回避等 400）走统一错误翻译。
  const other = harness({ cancelFailure: Object.assign(new Error('x'), { status: 400, code: 'E_CANCEL' }) })
  other.openCancelInvoice({ id: 'R1', version: 3, status: 'ISSUE_FAILED' })
  await other.submitCancelInvoice('核对税控回执后作废')
  assert.match(other.cancelDialog.value.error, /作废未完成，额度未释放。\|E_CANCEL/)
})
