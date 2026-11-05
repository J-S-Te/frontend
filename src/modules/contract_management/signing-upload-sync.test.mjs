import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@babel/parser'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { ref } from 'vue'
import { createRequestScope } from '../platform/shared/composables/requestScope.js'
import { cloneNormalizedSigningRecord, isNormalizedSigningRecord } from './utils/signingRecord.js'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const script = parseSFC(source).descriptor.scriptSetup.content
const names = [
  'normalizeSigningRecord', 'applySigningRecord', 'openSigningRecord', 'closeSigningRecord',
  'refreshSelectedSigningRecord', 'uploadStampedContract', 'confirmSigningRecord',
  'refreshSigningRealtime',
]
const methods = parse(script, { sourceType: 'module' }).program.body
  .filter((node) => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
  .map((node) => script.slice(node.start, node.end)).join('\n')

// deferred 控制网络边界的响应顺序以复现上传与切换竞争。
// 参数：无。
// 返回值：可手动完成或拒绝的 Promise 及对应控制函数。
function deferred() {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

// record 构造独立的签署详情接口样本。
// 参数：version、sha256 为文件身份；id 为合同内部标识。
// 返回值：包含签署状态与核验字段的原始详情响应。
function record(version = 0, sha256 = '', id = 'contract-a') {
  return {
    contract: { id, contract_number: `HT-${id}`, status: 'approved' },
    status: version ? 'pending_review' : 'in_return',
    document_version: version, document_sha256: sha256,
    returned_document_name: version ? 'synthetic-return.pdf' : '',
    seal_verified: false, signature_verified: false, signed_at: '',
  }
}

// harness 执行真实视图编排，仅替换 HTTP 和无关的合同展示格式化边界。
// 参数：无。
// 返回值：真实视图方法、响应式状态、可控网络边界和提交记录。
function harness() {
  const messages = []
  const confirmations = []
  const uploads = []
  const io = {
    detail: record(),
    read: async () => structuredClone(io.detail),
    upload: async () => ({ version: 1, content_sha256: 'a'.repeat(64) }),
    list: async () => {},
    confirm: async () => {},
  }
  const refs = Object.fromEntries(Object.entries({
    selectedSigningRecord: null, signingOpenedDocument: { version: 0, sha256: '' },
    signingDetailLoading: false, signingOperationBusy: false, stampedUploadBusyID: '',
    signingReplacementReason: '', signingShipmentForm: {}, signingConfirmationForm: {},
    session: {}, activeSection: 'signing', signingRecords: [],
  }).map(([key, value]) => [key, ref(value)]))
  const deps = {
    ...refs, signingDetailScope: createRequestScope(), signingRealtimeScope: createRequestScope(),
    isNormalizedSigningRecord, cloneNormalizedSigningRecord,
    normalizeContract: (value) => ({ ...value, recordId: value.id, id: value.contract_number }),
    formatBusinessDate: (value) => value || '',
    formatUserError: (error) => error.message,
    showToast: (message) => messages.push(message),
    getSigningRecord: (...args) => io.read(...args),
    refreshSigningRecords: (...args) => io.list(...args),
    uploadStampedContractPDF: async (...args) => { uploads.push(args); return io.upload(...args) },
    confirmSigning: async (...args) => { confirmations.push(args); return io.confirm(...args) },
    document: { visibilityState: 'visible' },
  }
  const api = new Function(...Object.keys(deps), `
    let signingDetailTicket = null;
    let signingRealtimeBusy = false;
    ${methods}
    return { ${names.join(', ')} };
  `)(...Object.values(deps))
  return { ...refs, ...api, io, messages, confirmations, uploads }
}

// upload 在真实上传方法上提供合成文件选择事件。
// 参数：h 为视图测试上下文；replacement 指示是否正式更换文件。
// 返回值：真实上传方法的 Promise；不读取或写入真实文件。
function upload(h, replacement = false) {
  return h.uploadStampedContract(h.selectedSigningRecord.value.contract,
    { target: { files: [{ name: 'synthetic.pdf' }], value: 'synthetic.pdf' } },
    { replacement })
}

// review 模拟操作员在核对文件后重新填写人工核验表单。
// 参数：h 为视图测试上下文。
// 返回值：无。
function review(h) {
  h.signingConfirmationForm.value = {
    seal_verified: true, signature_verified: true, signed_at: '2026-11-04',
  }
}

test('first upload can be reviewed and confirmed in the same dialog with its version and hash', async () => {
  const h = harness()
  await h.openSigningRecord(record())
  h.io.detail = record(1, 'a'.repeat(64))
  await upload(h)
  assert.ok(h.selectedSigningRecord.value, 'upload must keep the dialog open')
  review(h)
  await h.confirmSigningRecord()
  assert.deepEqual(h.confirmations, [['contract-a', {
    seal_verified: true, signature_verified: true, signed_at: '2026-11-04',
    document_version: 1, content_sha256: 'a'.repeat(64),
  }]])
})

test('replacement adopts only its upload receipt and clears previous manual verification', async () => {
  const h = harness()
  h.io.detail = { ...record(1, 'a'.repeat(64)), status: 'completed',
    seal_verified: true, signature_verified: true, signed_at: '2026-11-01' }
  await h.openSigningRecord(h.io.detail)
  h.signingReplacementReason.value = '补充签章页'
  const pendingRead = deferred()
  const readStarted = deferred()
  h.io.read = () => { readStarted.resolve(); return pendingRead.promise }
  h.io.upload = async () => ({ version: 2, content_sha256: 'b'.repeat(64) })
  const pendingUpload = upload(h, true)
  await readStarted.promise
  assert.deepEqual(h.signingConfirmationForm.value,
    { seal_verified: false, signature_verified: false, signed_at: '' })
  pendingRead.resolve(record(2, 'b'.repeat(64)))
  await pendingUpload
  assert.equal(h.uploads[0][2].expectedVersion, 1)
  assert.equal(h.uploads[0][2].replacementReason, '补充签章页')
  review(h)
  await h.confirmSigningRecord()
  assert.equal(h.confirmations[0]?.[1].document_version, 2)
  assert.equal(h.confirmations[0]?.[1].content_sha256, 'b'.repeat(64))
})

test('stale confirmed detail after upload cannot restore the old manual verification', async () => {
  const h = harness()
  h.io.detail = { ...record(1, 'a'.repeat(64)), status: 'completed',
    seal_verified: true, signature_verified: true, signed_at: '2026-11-01' }
  await h.openSigningRecord(h.io.detail)
  h.signingReplacementReason.value = '补充签章页'
  h.io.upload = async () => ({ version: 2, content_sha256: 'b'.repeat(64) })
  await upload(h, true)
  h.io.detail = record(2, 'b'.repeat(64))
  await h.refreshSigningRealtime()
  assert.equal(h.selectedSigningRecord.value.document_version, 2)
  assert.deepEqual(h.signingConfirmationForm.value,
    { seal_verified: false, signature_verified: false, signed_at: '' })
})

test('list refresh failure after a successful detail refresh does not lose the uploaded identity', async () => {
  const h = harness()
  await h.openSigningRecord(record())
  h.io.detail = record(1, 'a'.repeat(64))
  h.io.list = async () => { throw new Error('list unavailable') }
  await upload(h)
  review(h)
  await h.confirmSigningRecord()
  assert.equal(h.confirmations.length, 1)
  assert.equal(h.confirmations[0][1].content_sha256, 'a'.repeat(64))
})

test('failed detail refresh blocks stale confirmation and a later successful poll permits review', async () => {
  const h = harness()
  await h.openSigningRecord(record())
  h.io.read = async () => { throw new Error('detail unavailable') }
  await upload(h)
  review(h)
  await h.confirmSigningRecord()
  assert.equal(h.confirmations.length, 0)
  h.io.read = async () => record(1, 'a'.repeat(64))
  await h.refreshSigningRealtime()
  review(h)
  await h.confirmSigningRecord()
  assert.equal(h.confirmations.length, 1)
})

for (const [name, nextVersion, nextHash] of [
  ['newer version', 2, 'b'.repeat(64)],
  ['different hash at the same version', 1, 'b'.repeat(64)],
]) {
  test(`post-upload refresh cannot authorize an unrelated ${name}`, async () => {
    const h = harness()
    await h.openSigningRecord(record())
    h.io.detail = record(nextVersion, nextHash)
    await upload(h)
    review(h)
    await h.confirmSigningRecord()
    assert.equal(h.confirmations.length, 0)
    assert.deepEqual(h.signingOpenedDocument.value, { version: 1, sha256: 'a'.repeat(64) })
  })
}

test('failed upload preserves the original verification identity and entered form', async () => {
  const h = harness()
  h.io.detail = record(1, 'a'.repeat(64))
  await h.openSigningRecord(h.io.detail)
  review(h)
  h.io.upload = async () => { throw new Error('upload unavailable') }
  await upload(h)
  assert.deepEqual(h.signingOpenedDocument.value, { version: 1, sha256: 'a'.repeat(64) })
  assert.equal(h.signingConfirmationForm.value.seal_verified, true)
  assert.ok(h.messages.includes('upload unavailable'))
})

for (const id of ['contract-a', 'contract-b']) {
  test(`late upload cannot change a reopened dialog for ${id}`, async () => {
    const h = harness()
    await h.openSigningRecord(record())
    const pending = deferred()
    h.io.upload = () => pending.promise
    const uploading = upload(h)
    h.closeSigningRecord()
    h.io.detail = record(3, 'c'.repeat(64), id)
    await h.openSigningRecord(h.io.detail)
    review(h)
    pending.resolve({ version: 1, content_sha256: 'a'.repeat(64) })
    await uploading
    assert.equal(h.selectedSigningRecord.value.contract.recordId, id)
    assert.deepEqual(h.signingOpenedDocument.value, { version: 3, sha256: 'c'.repeat(64) })
    assert.equal(h.signingConfirmationForm.value.seal_verified, true)
    assert.equal(h.signingConfirmationForm.value.signed_at, '2026-11-04')
  })
}

test('confirmation cannot submit the previous identity while upload is still in flight', async () => {
  const h = harness()
  h.io.detail = record(1, 'a'.repeat(64))
  await h.openSigningRecord(h.io.detail)
  review(h)
  const pending = deferred()
  h.io.upload = () => pending.promise
  const uploading = upload(h)
  await h.confirmSigningRecord()
  assert.equal(h.confirmations.length, 0)
  pending.reject(new Error('cancel synthetic upload'))
  await uploading
})

test('external realtime replacement never advances the verification identity', async () => {
  const h = harness()
  h.io.detail = record(1, 'a'.repeat(64))
  await h.openSigningRecord(h.io.detail)
  review(h)
  h.io.detail = record(2, 'b'.repeat(64))
  await h.refreshSigningRealtime()
  await h.confirmSigningRecord()
  assert.equal(h.confirmations.length, 0)
  assert.deepEqual(h.signingOpenedDocument.value, { version: 1, sha256: 'a'.repeat(64) })
})

test('backend version conflict keeps the dialog open and is reported without retry', async () => {
  const h = harness()
  h.io.detail = record(1, 'a'.repeat(64))
  await h.openSigningRecord(h.io.detail)
  review(h)
  h.io.confirm = async () => {
    throw Object.assign(new Error('数据版本已变化'), { status: 409, code: 'CON_VERSION_CONFLICT' })
  }
  await h.confirmSigningRecord()
  assert.equal(h.confirmations.length, 1)
  assert.ok(h.selectedSigningRecord.value)
  assert.ok(h.messages.includes('数据版本已变化'))
})
