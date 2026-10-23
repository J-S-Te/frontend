import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const view = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const ref = (value = '') => ({ value })
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

function contractDetails({ preview, lifecycle = async () => [] }) {
  const refs = {
    termsIdentical: ref(false), selectedContract: ref(null), selectedContractPreviewHTML: ref(), selectedContractPreviewError: ref(),
    selectedContractPreviewLoading: ref(false), selectedContractLifecycle: ref([]), selectedContractLifecycleError: ref(), selectedContractLifecycleLoading: ref(false),
  }
  const code = view.slice(view.indexOf('async function openContract(contract)'), view.indexOf('\nconst lifecycleReasonLabels'))
  const methods = new Function(...Object.keys(refs), 'previewContractDocument', 'listContractLifecycle',
    `let contractDetailSequence = 0; ${code}; return { openContract, closeContract };`)(...Object.values(refs), preview, lifecycle)
  return { ...methods, ...refs }
}

test('external contracts load their persisted DOCX preview without a template id', async () => {
  const requested = []
  const details = contractDetails({ preview: async (id) => { requested.push(id); return { html: '<p>外部正文</p>' } } })
  await details.openContract({ recordId: 'external-1', templateId: '' })
  assert.deepEqual(requested, ['external-1'])
  assert.equal(details.selectedContractPreviewHTML.value, '<p>外部正文</p>')
  assert.equal(details.selectedContractPreviewLoading.value, false)
})

test('old contract preview and lifecycle responses never overwrite a newly selected record', async () => {
  const oldPreview = deferred()
  const oldLifecycle = deferred()
  const details = contractDetails({
    preview: (id) => id === 'old' ? oldPreview.promise : Promise.resolve({ html: '<p>新合同</p>' }),
    lifecycle: (id) => id === 'old' ? oldLifecycle.promise : Promise.resolve(['new event']),
  })
  const old = details.openContract({ recordId: 'old' })
  await details.openContract({ recordId: 'new' })
  oldPreview.resolve({ html: '<p>旧合同</p>' })
  oldLifecycle.resolve(['old event'])
  await old
  assert.equal(details.selectedContractPreviewHTML.value, '<p>新合同</p>')
  assert.deepEqual(details.selectedContractLifecycle.value, ['new event'])
})

test('legacy text-only contracts gracefully retain text when the server reports no DOCX', async () => {
  const details = contractDetails({ preview: async () => { throw Object.assign(new Error('无文档'), { code: 'CON_DOCUMENT_NOT_FOUND' }) } })
  await details.openContract({ recordId: 'legacy', content: '旧正文' })
  assert.equal(details.selectedContractPreviewError.value, '')
  assert.equal(details.selectedContract.value.content, '旧正文')
})

function approvalDetails({ getApproval = async () => ({ contract: { template_id: '' } }), preview }) {
  const refs = {
    selectedApproval: ref(null), approvalDetail: ref(null), approvalContractPreviewHTML: ref(), approvalContractPreviewError: ref(),
    approvalComment: ref(), approvalTargetUser: ref(), approvalTargetNode: ref(), approvalDetailLoading: ref(false), approvalContractPreviewLoading: ref(false),
  }
  const code = view.slice(view.indexOf('async function openApproval(approval)'), view.indexOf('\nasync function executeApprovalCommand'))
  const methods = new Function(...Object.keys(refs), 'getApproval', 'previewApprovalContract', 'showToast',
    `let approvalDetailSequence = 0; ${code}; return { openApproval, closeApproval };`)(...Object.values(refs), getApproval, preview, (message) => { throw new Error(message) })
  return { ...methods, ...refs }
}

test('approvals preview external DOCX and ignore responses after closing the detail', async () => {
  const preview = deferred()
  const requested = []
  const details = approvalDetails({ preview: (id) => { requested.push(id); return preview.promise } })
  const opening = details.openApproval({ id: 'approval-1' })
  await Promise.resolve()
  assert.deepEqual(requested, ['approval-1'])
  details.closeApproval()
  preview.resolve({ html: '<p>不应回填</p>' })
  await opening
  assert.equal(details.approvalContractPreviewHTML.value, '')
  assert.equal(details.approvalDetail.value, null)
})
