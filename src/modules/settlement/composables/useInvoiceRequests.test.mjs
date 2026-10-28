import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { useInvoiceRequests } from './useInvoiceRequests.js'

// manualIssue 三次 window.prompt（逐字迁移的遗留）：桩按顺序返回答案并记录默认值。
const prompt = { answers: [], defaults: [] }
globalThis.window = { prompt: (_message, fallback) => { prompt.defaults.push(fallback); return prompt.answers.shift() } }

function harness({ requests = [], invoices = [], eligible = [], refreshed = true, failure = null } = {}) {
  const calls = { create: [], approve: [], reject: [], manual: [], recover: [], load: 0, notify: [], act: [] }
  const deps = {
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

test('manualIssue：三步 prompt 任一取消即放弃；全部填写后按申请 ID 登记并带空 seller_profile；日期 prompt 默认今天', async () => {
  const h = harness()
  prompt.answers = ['', 'x', 'y']
  await h.manualIssue({ id: 'R1' })
  prompt.answers = ['CODE', null, 'y']
  await h.manualIssue({ id: 'R1' })
  prompt.answers = ['CODE', 'NO', '']
  await h.manualIssue({ id: 'R1' })
  assert.equal(h.calls.manual.length, 0, '任一步取消或留空都不得登记')

  prompt.defaults.length = 0
  prompt.answers = ['CODE-1', 'NO-9', '2026-10-26']
  await h.manualIssue({ id: 'R1' })
  assert.deepEqual(h.calls.manual, [{ id: 'R1', body: { invoice_code: 'CODE-1', invoice_no: 'NO-9', issue_date: '2026-10-26', seller_profile: {} } }])
  assert.equal(prompt.defaults.at(-1), new Date().toISOString().slice(0, 10), '开票日期默认今天')
  assert.deepEqual(h.calls.act, ['发票已登记，应收开票金额已同步更新。'])
})
