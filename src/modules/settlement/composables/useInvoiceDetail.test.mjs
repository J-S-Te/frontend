import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive, ref } from 'vue'
import { useInvoiceDetail } from './useInvoiceDetail.js'

// 原生输入框仅作旧行为对照；新流程必须调用注入的应用内表单。
globalThis.window = { prompt: () => null }

// 用途：建立隔离的结算交互依赖，记录提交与应用内表单请求。
// 参数：测试场景指定可见数据、表单结果及依赖失败。
// 返回值：真实 composable 状态、注入依赖与调用记录。
function harness({ section = 'invoices', query = {}, refreshed = true, failure = null, promptAnswer = null } = {}) {
  const calls = { push: [], upload: [], download: [], redFlush: [], approve: [], reject: [], prompts: [], load: 0, notify: [], act: [] }
  const deps = {
    can: () => true,
    askPrompt: async (options) => { calls.prompts.push(options); return promptAnswer },
    route: reactive({ query }),
    router: { push: (target) => calls.push.push(target) },
    active: ref(section),
    saving: ref(false),
    notify: (value) => calls.notify.push(value),
    act: async (callback, success) => {
      try { await callback(); calls.act.push(success) } catch (cause) { calls.act.push(`fail:${cause.message}`) }
    },
    load: async () => { calls.load++; return refreshed },
    formatSettlementError: (cause, options) => `${options.fallback}|${cause.code}`,
    uploadTaxInvoiceDocument: async (id, file) => { calls.upload.push({ id, file }); if (failure) throw failure },
    downloadTaxInvoiceDocument: async (id, documentID) => { calls.download.push({ id, documentID }); if (failure) throw failure },
    requestTaxInvoiceRedFlush: async (id, body) => { calls.redFlush.push({ id, body }); if (failure) throw failure },
    approveInvoiceRedFlush: async (id, version) => { calls.approve.push({ id, version }); if (failure) throw failure },
    rejectInvoiceRedFlush: async (id, version, reason) => { calls.reject.push({ id, version, reason }); if (failure) throw failure },
  }
  return { deps, calls, ...useInvoiceDetail(deps) }
}
const fileEvent = (file) => ({ target: { files: file ? [file] : [], value: 'C:\\fakepath\\a.pdf' } })

test('invoiceDetailID 仅在开票管理区读取 invoice_id 并转字符串；其他区域或缺参为空串', () => {
  const inInvoices = harness({ query: { invoice_id: 42 } })
  assert.equal(inInvoices.invoiceDetailID.value, '42')
  assert.equal(harness({ query: {} }).invoiceDetailID.value, '')
  const elsewhere = harness({ section: 'receipts', query: { invoice_id: 42 } })
  assert.equal(elsewhere.invoiceDetailID.value, '', '非开票管理区不得解析详情 ID')
  elsewhere.deps.active.value = 'invoices'
  assert.equal(elsewhere.invoiceDetailID.value, '42', '切回开票管理区后随 active 重新求值')
})

test('初始状态与时间线派生：无详情为空事件；详情写入后按 buildInvoiceTimelineEvents 派生', () => {
  const h = harness()
  assert.equal(h.invoiceDetail.value, null)
  assert.equal(h.redFlushOpen.value, false)
  assert.deepEqual(h.redFlushForm.value, { reason_code: 'INVOICE_ERROR', reason_detail: '' })
  assert.deepEqual(h.invoiceTimelineEvents.value, [])
  h.invoiceDetail.value = { id: 'INV-1', request_no: 'R1' }
  assert.deepEqual(h.invoiceTimelineEvents.value, [{ tone: 'info', title: '提交开票申请', detail: '申请号 R1 · 合同 —' }])
})

test('openInvoiceDetail / closeInvoiceDetail 以路由承载详情状态', () => {
  const h = harness()
  h.openInvoiceDetail({ id: 'INV-7' })
  h.closeInvoiceDetail()
  assert.deepEqual(h.calls.push, [
    { name: 'settlement', params: { section: 'invoices' }, query: { invoice_id: 'INV-7' } },
    { name: 'settlement', params: { section: 'invoices' } },
  ])
})

test('uploadInvoiceDocument：总是清空 input 值；无文件 / 无详情 / 进行中不上传', async () => {
  const h = harness()
  const noFile = fileEvent(null)
  await h.uploadInvoiceDocument(noFile)
  assert.equal(noFile.target.value, '', '选择取消后也要清空 input，允许重选同名文件')
  const noDetail = fileEvent({ name: 'a.pdf' })
  await h.uploadInvoiceDocument(noDetail)
  assert.equal(h.calls.upload.length, 0)
  h.invoiceDetail.value = { id: 'INV-1' }
  h.deps.saving.value = true
  await h.uploadInvoiceDocument(fileEvent({ name: 'a.pdf' }))
  assert.equal(h.calls.upload.length, 0, '进行中必须被单飞 guard 拦截')
  assert.equal(h.deps.saving.value, true)
})

test('uploadInvoiceDocument 成功：按详情 ID 上传、刷新并提示；刷新失败如实说明；接口失败走格式化文案且 saving 复位', async () => {
  const ok = harness({ refreshed: true })
  ok.invoiceDetail.value = { id: 'INV-1' }
  const file = { name: 'a.pdf' }
  await ok.uploadInvoiceDocument(fileEvent(file))
  assert.deepEqual(ok.calls.upload, [{ id: 'INV-1', file }])
  assert.equal(ok.calls.load, 1)
  assert.deepEqual(ok.calls.notify, ['电子发票已通过文件网关归档。'])
  assert.equal(ok.deps.saving.value, false)

  const stale = harness({ refreshed: false })
  stale.invoiceDetail.value = { id: 'INV-1' }
  await stale.uploadInvoiceDocument(fileEvent(file))
  assert.deepEqual(stale.calls.notify, ['电子发票已归档，但页面刷新失败。请刷新列表查看，勿重复上传。'])

  const failed = harness({ failure: Object.assign(new Error('x'), { code: 'E_UP' }) })
  failed.invoiceDetail.value = { id: 'INV-1' }
  await failed.uploadInvoiceDocument(fileEvent(file))
  assert.deepEqual(failed.calls.notify, ['电子发票上传失败。|E_UP'])
  assert.equal(failed.calls.load, 0, '上传失败不触发刷新链')
  assert.equal(failed.deps.saving.value, false)
})

test('uploadInvoiceDocument：超过 10 MiB 或类型不符时只提示，不调用上传接口也不进入保存态', async () => {
  const h = harness()
  h.invoiceDetail.value = { id: 'INV-1' }
  const oversized = { name: 'invoice.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 + 1 }
  await h.uploadInvoiceDocument(fileEvent(oversized))
  assert.equal(h.calls.upload.length, 0, '超限文件不发起上传（不构造 FormData）')
  assert.equal(h.deps.saving.value, false, '本地校验失败不占用保存态')
  assert.match(h.calls.notify[0], /电子发票不能超过 10 MiB/)

  const wrongType = { name: 'invoice.exe', type: '', size: 1024 }
  await h.uploadInvoiceDocument(fileEvent(wrongType))
  assert.equal(h.calls.upload.length, 0, '类型不符不发起上传')
  assert.match(h.calls.notify[1], /电子发票类型不受支持，仅允许 PDF、OFD、XML、PNG、JPG。/)

  const allowed = { name: 'invoice.ofd', type: '', size: 2 * 1024 * 1024 }
  await h.uploadInvoiceDocument(fileEvent(allowed))
  assert.deepEqual(h.calls.upload, [{ id: 'INV-1', file: allowed }], '合规文件仍按原路径上传')
})

test('downloadInvoiceDocument：详情与文档 ID 缺一不请求；失败提示格式化文案', async () => {
  const h = harness()
  await h.downloadInvoiceDocument({ id: 'D1' })
  h.invoiceDetail.value = { id: 'INV-1' }
  await h.downloadInvoiceDocument(null)
  await h.downloadInvoiceDocument({})
  assert.equal(h.calls.download.length, 0)
  await h.downloadInvoiceDocument({ id: 'D1' })
  assert.deepEqual(h.calls.download, [{ id: 'INV-1', documentID: 'D1' }])
  assert.deepEqual(h.calls.notify, [])

  const failed = harness({ failure: Object.assign(new Error('x'), { code: 'E_DL' }) })
  failed.invoiceDetail.value = { id: 'INV-1' }
  await failed.downloadInvoiceDocument({ id: 'D1' })
  assert.deepEqual(failed.calls.notify, ['电子发票下载失败，请稍后重试。|E_DL'])
})

test('submitRedFlush：原因为空白只提示不提交；成功按详情 ID 提交去空白原因、关闭弹窗并带成功文案', async () => {
  const h = harness()
  h.invoiceDetail.value = { id: 'INV-1' }
  h.redFlushOpen.value = true
  h.redFlushForm.value.reason_detail = '   '
  await h.submitRedFlush()
  assert.deepEqual(h.calls.notify, ['发起红冲必须填写具体原因。'])
  assert.equal(h.calls.redFlush.length, 0)
  assert.equal(h.redFlushOpen.value, true)

  h.redFlushForm.value = { reason_code: 'BUYER_INFO_ERROR', reason_detail: '  税号录错  ' }
  await h.submitRedFlush()
  assert.deepEqual(h.calls.redFlush, [{ id: 'INV-1', body: { reason_code: 'BUYER_INFO_ERROR', reason_detail: '税号录错' } }])
  assert.equal(h.redFlushOpen.value, false)
  assert.deepEqual(h.calls.act, ['红冲申请已提交，等待财务复核；原发票仍保持已开具状态。'])
})

test('submitRedFlush 接口失败：弹窗保持打开（关闭位于 await 之后），失败交 act 主干提示', async () => {
  const h = harness({ failure: new Error('服务端拒绝') })
  h.invoiceDetail.value = { id: 'INV-1' }
  h.redFlushOpen.value = true
  h.redFlushForm.value.reason_detail = '原因'
  await h.submitRedFlush()
  assert.equal(h.calls.redFlush.length, 1)
  assert.equal(h.redFlushOpen.value, true)
  assert.deepEqual(h.calls.act, ['fail:服务端拒绝'])
})

test('reviewRedFlush：通过直接复核，驳回单表单必填原因，取消不提交', async () => {
  const h = harness({ promptAnswer: '  金额不符  ' })
  await h.reviewRedFlush(true)
  assert.equal(h.calls.approve.length, 0)
  h.invoiceDetail.value = { id: 'INV-1', red_flush_request: {
    id: 'RF-1', version: 3, status: 'SUBMITTED', can_review: true,
  } }
  await h.reviewRedFlush(true)
  assert.deepEqual(h.calls.approve, [{ id: 'RF-1', version: 3 }])
  assert.equal(h.calls.prompts.length, 0)
  await h.reviewRedFlush(false)
  assert.deepEqual(h.calls.reject, [{ id: 'RF-1', version: 3, reason: '金额不符' }])
  assert.equal(h.calls.prompts[0].confirmText, '驳回红冲申请')
  for (const promptAnswer of [null, '   ']) {
    const cancelled = harness({ promptAnswer })
    cancelled.invoiceDetail.value = h.invoiceDetail.value
    await cancelled.reviewRedFlush(false)
    assert.equal(cancelled.calls.reject.length, 0)
  }
})

test('reviewRedFlush：等待理由时禁止重复，切换发票、版本或权限变化和保存中均不提交', async () => {
  for (const mutation of ['invoice', 'version', 'permission', 'saving', 'section', 'reviewable', 'route']) {
    const h = harness()
    let resolve
    let allowed = true
    const api = useInvoiceDetail({ ...h.deps, can: () => allowed,
      askPrompt: () => new Promise((done) => { resolve = done }),
    })
    api.invoiceDetail.value = { id: 'INV-1', red_flush_request: {
      id: 'RF-1', version: 3, status: 'SUBMITTED', can_review: true,
    } }
    const pending = api.reviewRedFlush(false)
    await api.reviewRedFlush(false)
    if (mutation === 'invoice') api.invoiceDetail.value.id = 'INV-2'
    if (mutation === 'version') api.invoiceDetail.value.red_flush_request.version++
    if (mutation === 'permission') allowed = false
    if (mutation === 'saving') h.deps.saving.value = true
    if (mutation === 'route') h.deps.route.query.invoice_id = 'INV-2'
    if (mutation === 'section') h.deps.active.value = 'receipts'
    if (mutation === 'reviewable') api.invoiceDetail.value.red_flush_request.can_review = false
    resolve('原因已核对')
    await pending
    assert.equal(h.calls.reject.length, 0, mutation)
  }
})
