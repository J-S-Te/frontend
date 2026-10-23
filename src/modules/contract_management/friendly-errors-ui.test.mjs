import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { formatUserError } from '../shared/utils/userError.js'

const view = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const ref = value => ({ value })

test('合同模板上传已保存而目录刷新失败时，不误报上传失败或保持可重复提交弹窗', async () => {
  const state = {
    isAdmin: ref(true), templateUploadForm: ref({ name: '测试合同', file: { size: 128 } }),
    templateUploading: ref(false), templateUploadError: ref(''), templateReplacementID: ref(''),
    templateUploadDialogOpen: ref(true), contractTemplates: ref([]), newContract: ref({ template_id: '' }),
  }
  const messages = [], writes = []
  const code = view.slice(view.indexOf('async function submitTemplateUpload()'), view.indexOf('\nfunction editTemplate('))
  const run = new Function(...Object.keys(state), 'formatUserError', 'showToast', 'isContractDOCXFile', 'uploadContractTemplate', 'replaceContractTemplateSource', 'listContractTemplates', 'selectContractTemplate',
    `${code}; return submitTemplateUpload;`)(...Object.values(state), formatUserError, message => messages.push(message), () => true, async input => writes.push(input), () => assert.fail('new upload must not replace'), async () => { throw new Error('SQLSTATE HY000: SELECT * FROM contract_template') }, () => {})
  await run()
  assert.equal(writes.length, 1)
  assert.equal(state.templateUploadDialogOpen.value, false)
  assert.equal(state.templateUploading.value, false)
  assert.equal(state.templateUploadError.value, '')
  assert.match(messages.at(-1), /模板文件已保存.*未刷新/)
  assert.doesNotMatch(messages.at(-1), /上传.*失败|SQLSTATE|SELECT|contract_template/)
})

test('合同模板更新后刷新失败保留成功事实，真实写入失败仍保留编辑弹窗', async () => {
  const code = view.slice(view.indexOf('async function saveTemplate()'), view.indexOf('\nasync function removeTemplate('))
  for (const writeFails of [false, true]) {
    const state = { templateSaving: ref(false), templateEditForm: ref({ id: 'tpl-1', name: '测试', number_format: 'HT-{ID8}', fields: [] }), contractTemplates: ref([]), templateEditDialogOpen: ref(true) }
    const messages = [], calls = []
    const run = new Function(...Object.keys(state), 'formatUserError', 'showToast', 'updateContractTemplate', 'listContractTemplates', `${code}; return saveTemplate;`)(...Object.values(state), formatUserError, text => messages.push(text), async () => { calls.push('write'); if (writeFails) throw new Error('当前模板已停用，不能修改。') }, async () => { calls.push('refresh'); throw new Error('Failed to fetch') })
    await run()
    assert.equal(state.templateSaving.value, false)
    assert.deepEqual(calls, writeFails ? ['write'] : ['write', 'refresh'])
    assert.equal(state.templateEditDialogOpen.value, writeFails)
    assert.match(messages.at(-1), writeFails ? /模板已停用/ : /模板已更新.*未刷新/)
    assert.doesNotMatch(messages.at(-1), /Failed to fetch/)
  }
})

test('合同错误横幅与操作提示不再直接使用未知原始异常', () => {
  assert.match(view, /templateUploadError\.value = formatUserError\(error/)
  assert.match(view, /sessionError\.value = formatUserError\(error/)
  assert.match(view, /function showToast\(message\) \{\s*toast\.value = formatUserError\(message/)
  assert.match(view, /await downloadContractFile\(contract\.recordId, format\)/)
  assert.match(view, /:disabled="contractDownloadBusy" @click="downloadApprovedContract/)
  assert.doesNotMatch(view, /window\.location\.assign\(approvedContractDownloadURL/)
})
