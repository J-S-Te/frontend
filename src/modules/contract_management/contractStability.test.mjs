import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { ref } from 'vue'
import { createRequestScope } from '../platform/shared/composables/requestScope.js'
import { formatUserError } from '../shared/utils/userError.js'

// 沿用 presaleStability.test.mjs 的做法：从真实 SFC 提取合同审批/签署链路函数，
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

// —— 任务 B：保存/刷新分离 —— 催办与盖章文件上传 HTTP 200 即已保存，
// 随后的详情/台账刷新失败不得误报为写操作失败。

test('催办写入成功但签署记录刷新失败：提示已保存与刷新失败，不误报催办失败', async () => {
  const pending = deferred()
  const toasts = []
  const context = {
    ref, formatUserError,
    signingOperationBusy: ref(false),
    selectedSigningRecord: ref({ contract: { recordId: 'CT-7' } }),
    recordSigningReminder: () => pending.promise,
    refreshSelectedSigningRecord: async () => { throw new Error('刷新失败') },
    showToast: (message) => toasts.push(String(message)),
  }
  const { sendSigningReminder } = functions('./views/ContractManagementView.vue', ['sendSigningReminder'], context)
  const saving = sendSigningReminder()
  pending.resolve({ id: 'r1' })
  await saving
  assert.match(toasts.at(-1), /催办记录已保存/)
  assert.match(toasts.at(-1), /刷新失败/, '刷新失败必须如实说明，只提示手动刷新')
  assert.doesNotMatch(toasts.at(-1), /保存催办记录失败/, '刷新失败不得报成催办写入失败')
  assert.equal(context.signingOperationBusy.value, false, 'finally 必须释放进行中标志')
})

test('盖章文件上传成功但刷新失败：提示已上传并提醒核对版本，不误报上传失败', async () => {
  const pending = deferred()
  const toasts = []
  const context = {
    ref, formatUserError,
    stampedUploadBusyID: ref(''),
    signingReplacementReason: ref(''),
    signingOpenedDocument: ref({ version: 2, sha256: 'doc-hash' }),
    selectedSigningRecord: ref({ contract: { recordId: 'CT-7' }, document_version: 2 }),
    uploadStampedContractPDF: () => pending.promise,
    refreshSelectedSigningRecord: async () => { throw new Error('刷新失败') },
    refreshSigningRecords: async () => { throw new Error('当前详情打开时不应刷新台账') },
    showToast: (message) => toasts.push(String(message)),
  }
  const { uploadStampedContract } = functions('./views/ContractManagementView.vue', ['uploadStampedContract'], context)
  const event = { target: { files: [{ name: 'stamped.pdf' }], value: 'kept' } }
  const saving = uploadStampedContract({ recordId: 'CT-7' }, event)
  pending.resolve({ document_version: 3 })
  await saving
  assert.match(toasts.at(-1), /盖章文件已上传/)
  assert.match(toasts.at(-1), /刷新失败.*手动刷新/)
  assert.doesNotMatch(toasts.join('\n'), /上传盖章合同失败/, '刷新失败不得报成上传失败')
  assert.equal(context.signingReplacementReason.value, '')
  assert.equal(context.stampedUploadBusyID.value, '')
})

test('盖章文件上传失败：按操作失败提示，不宣称已上传也不触发刷新链', async () => {
  const pending = deferred()
  const toasts = []
  let refreshes = 0
  const context = {
    ref, formatUserError,
    stampedUploadBusyID: ref(''),
    signingReplacementReason: ref('旧原因'),
    signingOpenedDocument: ref({ version: 2, sha256: 'doc-hash' }),
    selectedSigningRecord: ref({ contract: { recordId: 'CT-7' }, document_version: 2 }),
    uploadStampedContractPDF: () => pending.promise,
    refreshSelectedSigningRecord: async () => { refreshes++ },
    refreshSigningRecords: async () => { refreshes++ },
    showToast: (message) => toasts.push(String(message)),
  }
  const { uploadStampedContract } = functions('./views/ContractManagementView.vue', ['uploadStampedContract'], context)
  const event = { target: { files: [{ name: 'stamped.pdf' }], value: '' } }
  const saving = uploadStampedContract({ recordId: 'CT-7' }, event, { replacement: true })
  pending.reject(Object.assign(new Error('服务端拒绝本次写入'), { status: 500 }))
  await saving
  assert.doesNotMatch(toasts.join('\n'), /已上传/, '写失败不得宣称已上传')
  assert.equal(context.signingReplacementReason.value, '旧原因', '写失败必须保留更换原因草稿')
  assert.equal(refreshes, 0, '写失败不得触发保存后的刷新链')
  assert.equal(context.stampedUploadBusyID.value, '')
})

// —— 任务 C：请求作用域 —— 迟到响应不得污染新上下文，旧请求 finally 不得关闭新请求的加载态。

test('签署台账筛选切换后：旧筛选迟到响应不覆盖新筛选数据，也不关闭新请求加载态', async () => {
  const pending = []
  const context = {
    ref, createRequestScope,
    signingLedgerScope: createRequestScope(),
    signingKeyword: ref(''), signingStatusFilter: ref(''), signingMethodFilter: ref(''),
    signingRecords: ref([{ contract: { recordId: 'KEEP' } }]), signingTotal: ref(1), signingSummary: ref(null),
    signingHasMore: ref(false), signingLedgerLoading: ref(false), signingLoadingMore: ref(false),
    listSigningRecords: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    normalizeSigningRecord: (item) => item,
  }
  const { refreshSigningRecords } = functions('./composables/useSigningLedger.js', ['refreshSigningRecords'], context)
  const slow = refreshSigningRecords()
  await until(() => pending.length === 1)
  context.signingKeyword.value = '新筛选'
  const fast = refreshSigningRecords()
  await until(() => pending.length === 2)
  pending[0].resolve({ items: [{ contract: { recordId: 'OLD' } }], total: 1, has_more: false, stats: null })
  await slow
  assert.deepEqual(context.signingRecords.value, [{ contract: { recordId: 'KEEP' } }], '旧筛选的迟到响应不得覆盖台账')
  assert.equal(context.signingLedgerLoading.value, true, '旧请求 finally 不得关闭新请求的加载态')
  pending[1].resolve({ items: [{ contract: { recordId: 'NEW' } }], total: 1, has_more: false, stats: null })
  await fast
  assert.deepEqual(context.signingRecords.value, [{ contract: { recordId: 'NEW' } }])
  assert.equal(context.signingLedgerLoading.value, false)
  assert.equal(context.signingTotal.value, 1)
})

test('关闭签署详情后：在途详情响应不得回填弹窗也不得误报', async () => {
  const pending = []
  const applied = []
  const context = {
    ref, createRequestScope, formatUserError,
    signingDetailScope: createRequestScope(),
    signingDetailTicket: null,
    selectedSigningRecord: ref(null),
    signingDetailLoading: ref(false),
    signingReplacementReason: ref(''),
    signingOpenedDocument: ref({ version: 0, sha256: '' }),
    applySigningRecord: (record) => applied.push(record),
    isNormalizedSigningRecord: () => true,
    normalizeSigningRecord: (record) => record,
    getSigningRecord: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    showToast: () => assert.fail('关闭后的迟到响应不得触发任何提示'),
  }
  const { openSigningRecord, closeSigningRecord } = functions('./views/ContractManagementView.vue', ['openSigningRecord', 'closeSigningRecord'], context)
  const opening = openSigningRecord({ contract: { recordId: 'CT-9' } })
  await until(() => pending.length === 1)
  closeSigningRecord()
  pending[0].resolve({ contract: { id: 'CT-9' }, document_version: 2 })
  await opening
  // 打开时的乐观回填只发生一次（列表记录），关闭后的详情迟到响应不得再次回填。
  assert.equal(applied.length, 1)
  assert.equal(applied[0].contract.recordId, 'CT-9')
  assert.equal(context.selectedSigningRecord.value, null, '关闭后的详情响应不得重新打开弹窗')
  assert.equal(context.signingDetailLoading.value, false)
})

test('切换审批后：旧审批详情迟到响应不得覆盖新审批，也不得请求旧审批的正文预览', async () => {
  const details = []
  const previews = []
  const context = {
    ref, createRequestScope, formatUserError,
    approvalDetailScope: createRequestScope(),
    approvalDetailTicket: null,
    selectedApproval: ref(null),
    approvalDetail: ref(null),
    approvalDetailLoading: ref(false),
    approvalContractPreviewHTML: ref(''),
    approvalContractPreviewPDF: ref(null),
    approvalContractPreviewError: ref(''),
    approvalContractPreviewLoading: ref(false),
    approvalComment: ref(''), approvalTargetUser: ref(''), approvalTargetNode: ref(''),
    getApproval: () => new Promise((resolve, reject) => details.push({ resolve, reject })),
    previewApprovalContract: () => new Promise((resolve, reject) => previews.push({ resolve, reject })),
    showToast: () => assert.fail('被取代的旧请求不得触发任何提示'),
  }
  const { openApproval } = functions('./composables/useApprovalDetail.js', ['openApproval'], context)
  const first = openApproval({ id: 'A' })
  await until(() => details.length === 1)
  const second = openApproval({ id: 'B' })
  await until(() => details.length === 2)
  details[1].resolve({ meta: { id: 'B' }, contract: { title: 'B' } })
  await until(() => previews.length === 1) // B 已推进到正文预览读取
  details[0].resolve({ meta: { id: 'A' }, contract: { title: 'A' } })
  await first
  assert.equal(context.approvalDetail.value?.meta?.id, 'B', '旧审批详情不得覆盖新审批')
  assert.equal(previews.length, 1, '旧审批被取代后不得继续请求正文预览')
  assert.equal(context.approvalContractPreviewLoading.value, true, '旧请求 finally 不得关闭新请求的预览加载态')
  previews[0].resolve({ html: '<p>B 正文</p>' })
  await second
  assert.equal(context.approvalContractPreviewHTML.value, '<p>B 正文</p>')
  assert.equal(context.approvalDetailLoading.value, false)
})

// —— 任务 D：写操作进行中单飞 guard —— 按钮禁用依赖 DOM 重渲染，函数级 guard 兜底防双击重复提交。

test('审批命令进行中再次触发时直接返回，不重复提交命令', async () => {
  let commands = 0
  const context = {
    ref,
    approvalCommandBusy: ref(true), // 模拟上一次审批命令仍在进行
    approvalDetail: ref({}),
    session: ref({ user_id: 'u1' }),
    selectedApproval: ref({ id: 'a1', status: 'active' }),
    approvalComment: ref('同意'),
    can: () => true,
    commandApproval: () => { commands++; return Promise.resolve({}) },
    showToast: () => assert.fail('进行中重复触发不得给出任何提示或提交'),
    formatUserError,
  }
  const { executeApprovalCommand } = functions('./composables/useApprovalDetail.js', ['executeApprovalCommand'], context)
  await executeApprovalCommand('approve')
  assert.equal(commands, 0, '写操作进行中必须被单飞 guard 拦截')
})

test('寄出登记进行中再次触发时直接返回，不重复保存寄出信息', async () => {
  let saves = 0
  const context = {
    ref,
    signingOperationBusy: ref(true), // 模拟上一次寄出登记仍在进行
    selectedSigningRecord: ref({ contract: { recordId: 'CT-7' } }),
    saveSigningShipment: () => { saves++; return Promise.resolve({}) },
    validateRecipientPhoneNumber: () => '',
    showToast: () => assert.fail('进行中重复触发不得给出任何提示或提交'),
    formatUserError,
  }
  const { submitSigningShipment } = functions('./views/ContractManagementView.vue', ['submitSigningShipment'], context)
  await submitSigningShipment()
  assert.equal(saves, 0, '写操作进行中必须被单飞 guard 拦截')
})
