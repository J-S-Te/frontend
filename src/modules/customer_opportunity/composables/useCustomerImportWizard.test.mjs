import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { useCustomerImportWizard } from './useCustomerImportWizard.js'

// 下载函数依赖浏览器 URL/document/window：以最小桩记录锚点点击与 ObjectURL 生命周期。
const dom = { links: [], created: [], revoked: [] }
URL.createObjectURL = (blob) => { const url = `blob:${dom.created.length}`; dom.created.push({ url, blob }); return url }
URL.revokeObjectURL = (url) => dom.revoked.push(url)
globalThis.document = {
  createElement: () => { const link = { clicked: 0, removed: 0, click() { this.clicked++ }, remove() { this.removed++ } }; dom.links.push(link); return link },
  body: { appendChild() {} },
}
globalThis.window = { setTimeout: (handler) => { handler(); return 1 } }

function harness({ scanAvailable = true, preview = null, commit = null, failure = null, errorsFile = null, templateFile = null } = {}) {
  const calls = { preview: [], commit: [], errors: [], template: 0, resetMessages: 0, showError: [], loadCurrent: 0, keys: 0 }
  const deps = {
    error: ref(''),
    notice: ref(''),
    actionLoading: ref(false),
    resetMessages: () => { calls.resetMessages++ },
    showError: (value) => calls.showError.push(value),
    loadCurrent: async () => { calls.loadCurrent++ },
    runtimeCapability: (code) => ({ available: code === 'customer_import_scan' ? scanAvailable : false }),
    createIdempotencyKey: () => `key-${++calls.keys}`,
    previewCustomerImport: async (payload) => { calls.preview.push(payload); if (failure) throw failure; return preview },
    commitCustomerImport: async (jobNo, body, key) => { calls.commit.push({ jobNo, body, key }); if (failure) throw failure; return commit },
    downloadCustomerImportErrors: async (jobNo) => { calls.errors.push(jobNo); if (failure) throw failure; return errorsFile },
    downloadCustomerImportTemplate: async () => { calls.template++; if (failure) throw failure; return templateFile },
  }
  return { deps, calls, ...useCustomerImportWizard(deps) }
}
const xlsx = (name) => ({ target: { files: [{ name }] } })

test('openCustomerImport：扫描能力不可用时关闭入口并提示；可用时重置三态与表单并打开弹窗', () => {
  const closed = harness({ scanAvailable: false })
  assert.equal(closed.customerImportScanAvailable.value, false)
  closed.openCustomerImport()
  assert.equal(closed.customerImportDialog.value, false)
  assert.equal(closed.deps.error.value, '客户导入代码安全校验当前不可用，入口已安全关闭。')

  const open = harness()
  open.customerImportForm.file = { name: 'stale.xlsx' }; open.customerImportForm.reason = '旧原因'
  open.customerImportPreview.value = { job_no: 'J0' }; open.customerImportResult.value = { job_no: 'J0' }; open.customerImportCommitKey.value = 'stale'
  open.openCustomerImport()
  assert.equal(open.customerImportDialog.value, true)
  assert.deepEqual({ ...open.customerImportForm }, { file: null, reason: '' })
  assert.equal(open.customerImportPreview.value, null)
  assert.equal(open.customerImportResult.value, null)
  assert.equal(open.customerImportCommitKey.value, '')
})

test('selectCustomerImportFile：仅接受 .xlsx（忽略大小写），其他后缀清空并提示；无文件静默', () => {
  const h = harness()
  h.selectCustomerImportFile(xlsx('客户.XLSX'))
  assert.equal(h.customerImportForm.file.name, '客户.XLSX')
  h.selectCustomerImportFile(xlsx('客户.csv'))
  assert.equal(h.customerImportForm.file, null)
  assert.equal(h.deps.error.value, '只接受 .xlsx 文件，请重新选择。')
  h.deps.error.value = ''
  h.selectCustomerImportFile({ target: { files: [] } })
  assert.equal(h.customerImportForm.file, null)
  assert.equal(h.deps.error.value, '')
})

test('previewImport：文件与原因缺一不发请求；成功后写预检、清提交结果、生成幂等键并丢弃本地文件引用', async () => {
  const h = harness({ preview: { job_no: 'J1', version: 1, importable_rows: 3 } })
  await h.previewImport()
  h.customerImportForm.file = { name: 'a.xlsx' }
  await h.previewImport()
  h.customerImportForm.file = null; h.customerImportForm.reason = '  批量录入  '
  await h.previewImport()
  assert.equal(h.calls.preview.length, 0, '缺文件或缺原因都不得发预检请求')

  const file = { name: 'a.xlsx' }
  h.customerImportForm.file = file
  h.customerImportResult.value = { job_no: 'OLD' }
  await h.previewImport()
  assert.deepEqual(h.calls.preview, [{ file, reason: '批量录入' }], '原因去空白后提交')
  assert.deepEqual(h.customerImportPreview.value, { job_no: 'J1', version: 1, importable_rows: 3 })
  assert.equal(h.customerImportResult.value, null)
  assert.equal(h.customerImportCommitKey.value, 'key-1')
  assert.equal(h.customerImportForm.file, null, '服务端受理后浏览器不再持有工作簿')
  assert.equal(h.calls.resetMessages, 1)
  assert.equal(h.deps.actionLoading.value, false)
})

test('showCustomerImportError：导入专属错误码映射固定文案；过期/冲突/409 额外清空预检；其余委托 showError', () => {
  const h = harness()
  h.customerImportPreview.value = { job_no: 'J1' }
  h.showCustomerImportError({ code: 'CRM_CUSTOMER_IMPORT_SCANNER_UNAVAILABLE' })
  assert.equal(h.deps.error.value, '客户导入代码安全校验当前不可用，暂不能预检。')
  h.showCustomerImportError({ code: 'CRM_CUSTOMER_IMPORT_FILE_REJECTED' })
  assert.equal(h.deps.error.value, '文件未通过服务端代码安全校验，已拒绝预检。')
  h.showCustomerImportError({ code: 'CRM_CUSTOMER_IMPORT_FILE_INVALID' })
  assert.equal(h.deps.error.value, 'Excel 文件格式、表头或内容不符合导入规范。')
  assert.deepEqual(h.customerImportPreview.value, { job_no: 'J1' }, '文件类错误不清空已有预检')

  for (const cause of [{ code: 'CRM_CUSTOMER_IMPORT_JOB_EXPIRED' }, { code: 'CRM_CUSTOMER_IMPORT_JOB_CONFLICT' }, { code: 'COMMON_VERSION_CONFLICT' }, { status: 409 }]) {
    h.customerImportPreview.value = { job_no: 'J1' }
    h.showCustomerImportError(cause)
    assert.equal(h.deps.error.value, '导入预检已过期或状态发生变化，请重新上传文件预检。')
    assert.equal(h.customerImportPreview.value, null, `${JSON.stringify(cause)} 必须迫使重新预检`)
  }

  const other = new Error('boom')
  h.showCustomerImportError(other)
  assert.deepEqual(h.calls.showError, [other])
})

test('commitImport：无预检或可导入行数为 0 不提交；成功复用预检时生成的幂等键、汇总结果、关闭弹窗并刷新列表', async () => {
  const h = harness({ preview: { job_no: 'J1', version: '2', importable_rows: 0 }, commit: { succeeded_rows: 5, failed_rows: 1 } })
  await h.commitImport()
  h.customerImportPreview.value = { job_no: 'J1', version: '2', importable_rows: 0 }
  await h.commitImport()
  assert.equal(h.calls.commit.length, 0, '可导入行数为 0 不得提交')

  h.customerImportForm.file = { name: 'a.xlsx' }; h.customerImportForm.reason = '批量'
  h.deps.preview = null
  h.customerImportPreview.value = { job_no: 'J1', version: '2', importable_rows: 5 }
  h.customerImportCommitKey.value = 'key-from-preview'
  h.customerImportDialog.value = true
  await h.commitImport()
  assert.deepEqual(h.calls.commit, [{ jobNo: 'J1', body: { version: 2 }, key: 'key-from-preview' }], 'version 转数字，幂等键复用预检时的键')
  assert.equal(h.deps.notice.value, '客户导入完成：成功 5 行，失败 1 行，跳过 0 行。')
  assert.equal(h.customerImportDialog.value, false, '成功后自动关闭弹窗')
  assert.equal(h.customerImportPreview.value, null)
  assert.equal(h.customerImportCommitKey.value, '')
  assert.equal(h.customerImportForm.reason, '')
  assert.equal(h.calls.loadCurrent, 1)
  assert.equal(h.deps.actionLoading.value, false)
})

test('commitImport：幂等键缺失时现场生成；提交失败按导入文案映射且不关闭弹窗、不刷新', async () => {
  const generated = harness({ commit: {} })
  generated.customerImportPreview.value = { job_no: 'J2', version: 1, importable_rows: 1 }
  await generated.commitImport()
  assert.equal(generated.calls.commit[0].key, 'key-1')

  const failed = harness({ failure: { code: 'CRM_CUSTOMER_IMPORT_JOB_EXPIRED' } })
  failed.customerImportDialog.value = true
  failed.customerImportPreview.value = { job_no: 'J3', version: 1, importable_rows: 1 }
  await failed.commitImport()
  assert.equal(failed.deps.error.value, '导入预检已过期或状态发生变化，请重新上传文件预检。')
  assert.equal(failed.customerImportPreview.value, null)
  assert.equal(failed.customerImportDialog.value, true, '失败不得关闭弹窗')
  assert.equal(failed.calls.loadCurrent, 0)
  assert.equal(failed.deps.actionLoading.value, false)
})

test('downloadImportErrors：无任务号不请求；优先提交结果的 job_no，其次预检的；触发锚点下载并回收 ObjectURL', async () => {
  dom.links.length = 0; dom.created.length = 0; dom.revoked.length = 0
  const blob = { size: 3 }
  const h = harness({ errorsFile: { blob, filename: 'errors.xlsx' } })
  await h.downloadImportErrors()
  assert.equal(h.calls.errors.length, 0)

  h.customerImportPreview.value = { job_no: 'PREVIEW' }
  await h.downloadImportErrors()
  h.customerImportResult.value = { job_no: 'RESULT' }
  await h.downloadImportErrors()
  assert.deepEqual(h.calls.errors, ['PREVIEW', 'RESULT'])
  assert.equal(dom.links.length, 2)
  assert.equal(dom.links[1].href, 'blob:1')
  assert.equal(dom.links[1].download, 'errors.xlsx')
  assert.equal(dom.links[1].clicked, 1)
  assert.equal(dom.links[1].removed, 1)
  assert.deepEqual(dom.revoked, ['blob:0', 'blob:1'])
  assert.equal(dom.created[0].blob, blob)
})

test('downloadCustomerImportExample：下载模板；下载类失败走导入错误映射', async () => {
  dom.links.length = 0
  const ok = harness({ templateFile: { blob: {}, filename: 'template.xlsx' } })
  await ok.downloadCustomerImportExample()
  assert.equal(ok.calls.template, 1)
  assert.equal(dom.links.at(-1).download, 'template.xlsx')
  assert.equal(dom.links.at(-1).clicked, 1)

  const failed = harness({ failure: { code: 'CRM_CUSTOMER_IMPORT_SCANNER_UNAVAILABLE' } })
  await failed.downloadCustomerImportExample()
  assert.equal(failed.deps.error.value, '客户导入代码安全校验当前不可用，暂不能预检。')
  failed.customerImportPreview.value = { job_no: 'J' }
  await failed.downloadImportErrors()
  assert.equal(failed.calls.errors.length, 1)
  assert.equal(failed.deps.error.value, '客户导入代码安全校验当前不可用，暂不能预检。')
})

test('closeCustomerImport 清空预检/结果/幂等键/文件与原因并关闭弹窗', () => {
  const h = harness()
  h.customerImportDialog.value = true
  h.customerImportForm.file = { name: 'a.xlsx' }; h.customerImportForm.reason = '原因'
  h.customerImportPreview.value = { job_no: 'J' }; h.customerImportResult.value = { job_no: 'J' }; h.customerImportCommitKey.value = 'k'
  h.closeCustomerImport()
  assert.equal(h.customerImportDialog.value, false)
  assert.deepEqual({ ...h.customerImportForm }, { file: null, reason: '' })
  assert.equal(h.customerImportPreview.value, null)
  assert.equal(h.customerImportResult.value, null)
  assert.equal(h.customerImportCommitKey.value, '')
})
