import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const dialog = await readFile(new URL('./components/DetectionCategoryImportDialog.vue', import.meta.url), 'utf8')
const api = await readFile(new URL('./api/projectManagement.js', import.meta.url), 'utf8')
const view = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
function mount(calls = {}) {
  const script = dialog.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  const events = []
  const state = new Function('computed', 'ref', 'defineProps', 'defineEmits', 'downloadDetectionCategoryImportTemplate', 'previewDetectionCategoriesImport', 'importDetectionCategories', `${script}\nreturn { file, preview, result, selected, busy, error, filter, visibleRows, selectedCount, pick, inspect, commit, reset, selectAll }`)(
    (read) => ({ get value() { return read() } }), (value) => ({ value }), () => ({ codeOptions: [] }), () => (...args) => events.push(args), calls.download, calls.preview, calls.commit,
  )
  return { ...state, events }
}
const file = { name: '检测类别.csv', size: 200 }
test('检测类别导入提供空白模板与可替换示例，沿用六列表头和人员编码', () => {
  assert.match(dialog, /下载空白导入模板/)
  assert.match(dialog, /下载填写示例/)
  assert.match(dialog, /示例行替换为实际类别或删除/)
  assert.match(dialog, /NO \/ MARKABLE \/ REQUIRED/)
  assert.match(dialog, /必检能力码/)
  assert.match(api, /example \? '\?example=true' : ''/)
  assert.match(view, /detectionCategoryImportOpen && canManageRules/)
  assert.match(view, /<DetectionCategoryImportDialog[^>]*capabilityCodeOptions\('PERSON'\)/)
  assert.doesNotMatch(view, /detectionCategoryFileInput|await importDetectionCategories\(file\)/)
  assert.match(view, /类别目录刷新失败/)
  assert.doesNotMatch(dialog, /v-html/)
})
test('上传仅调用服务器预检，问题行不可选且支持结果筛选', async () => {
  let writes = 0
  const state = mount({ preview: async (value) => { assert.equal(value, file); return { total: 2, valid: 1, invalid: 1, rows: [{ row_no: 2, action: 'UPDATE', status: 'READY' }, { row_no: 3, status: 'INVALID', errors: ['重复类别'] }] } }, commit: () => { writes++ } })
  state.pick({ target: { files: [file] } })
  await state.inspect()
  assert.deepEqual(state.selected.value, [2])
  assert.equal(writes, 0)
  state.filter.value = 'invalid'
  assert.deepEqual(state.visibleRows.value.map((row) => row.row_no), [3])
  assert.match(dialog, /row.status !== 'READY'/)
})
test('确认重新提交原文件和有效物理行号，逐行结果展示且禁止重复提交', async () => {
  const commands = []
  const state = mount({ commit: async (...args) => { commands.push(args); return { imported: 1, skipped: 0, rows: [{ row_no: 2, status: 'IMPORTED' }] } } })
  state.file.value = file
  state.preview.value = { rows: [{ row_no: 2, status: 'READY' }, { row_no: 3, status: 'INVALID' }] }
  state.selected.value = [2, 3]
  await state.commit(); await state.commit()
  assert.deepEqual(commands, [[file, [2]]])
  assert.equal(state.events[0][0], 'completed')
  assert.equal(state.result.value.rows[0].status, 'IMPORTED')
})
test('空文件、超限和非CSV在上传前拒绝；无有效选择不写入', async () => {
  for (const invalid of [{ name: 'bad.xlsx', size: 20 }, { name: 'empty.csv', size: 0 }, { name: 'large.csv', size: 2 * 1024 * 1024 + 1 }]) {
    const state = mount({ preview: () => assert.fail('must not upload'), commit: () => assert.fail('must not commit') })
    state.file.value = invalid
    await state.inspect(); await state.commit()
    assert.match(state.error.value, /非空 CSV/)
    assert.equal(state.result.value, null)
  }
})
test('预检网络失败和确认响应异常不报成功，可重新上传', async () => {
  const state = mount({ preview: async () => { throw new Error('网关不可用') }, commit: async () => ({ imported: 1, skipped: 0 }) })
  state.file.value = file
  await state.inspect()
  assert.equal(state.preview.value, null)
  assert.equal(state.error.value, '网关不可用')
  state.preview.value = { rows: [{ row_no: 2, status: 'READY' }] }; state.selected.value = [2]
  await state.commit()
  assert.match(state.error.value, /核对类别目录/)
  assert.equal(state.events.length, 0)
  state.reset()
  assert.equal(state.file.value, null)
  assert.deepEqual(state.selected.value, [])
})
test('确认请求处理中重复点击被阻止，逐行失败正常交付结果', async () => {
  let finish, writes = 0
  const state = mount({ commit: () => { writes++; return new Promise((resolve) => { finish = resolve }) } })
  state.file.value = file; state.preview.value = { rows: [{ row_no: 2, status: 'READY' }] }; state.selected.value = [2]
  const pending = state.commit()
  await state.commit()
  assert.equal(writes, 1)
  finish({ imported: 0, skipped: 1, rows: [{ row_no: 2, status: 'FAILED', message: '编码已停用' }] })
  await pending
  assert.equal(state.result.value.rows[0].status, 'FAILED')
  assert.equal(state.events.length, 1)
})
