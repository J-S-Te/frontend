import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const dialog = await readFile(new URL('./components/QualificationImportDialog.vue', import.meta.url), 'utf8')
const api = await readFile(new URL('./api/projectManagement.js', import.meta.url), 'utf8')
function mount(apiCalls, resourceType = 'PERSON') {
  const script = dialog.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  const events = []
  const state = new Function('computed', 'ref', 'defineProps', 'defineEmits', 'downloadCapabilityImportTemplate', 'previewCapabilitiesImport', 'importCapabilities', 'downloadEquipmentImportTemplate', 'previewEquipmentImport', 'importEquipment', `${script}\nreturn { file, preview, result, selected, busy, error, readyRows, selectedCount, pick, inspect, commit, reset, dateLabel }`)(
    (read) => ({ get value() { return read() } }), (value) => ({ value }), () => ({ codeOptions: [], resourceType }), () => (...args) => events.push(args), apiCalls.download, apiCalls.preview, apiCalls.commit, apiCalls.equipmentDownload, apiCalls.equipmentPreview, apiCalls.equipmentCommit,
  )
  return { ...state, events }
}
const workbook = { name: '人员资质.csv', size: 100 }
test('设备未设置检定日期不显示 Go 零值年份', () => {
  const state = mount({}, 'EQUIPMENT')
  assert.equal(state.dateLabel('0001-01-01T00:00:00Z'), '不限')
  assert.equal(state.dateLabel(''), '不限')
  assert.equal(state.dateLabel('2026-10-08T00:00:00Z'), '2026-10-08')
})
test('导入检测只预检、不写入，默认仅选择有效行', async () => {
  let writes = 0
  const state = mount({ preview: async () => ({ total: 2, valid: 1, invalid: 1, rows: [{ row_no: 2, status: 'READY' }, { row_no: 3, status: 'INVALID', errors: ['人员不唯一'] }] }), commit: () => { writes++ } })
  state.pick({ target: { files: [workbook] } })
  await state.inspect()
  assert.deepEqual(state.selected.value, [2])
  assert.equal(state.selectedCount.value, 1)
  assert.equal(writes, 0)
})
test('设备模式只调用设备预检，有效更新行可选且不直接写入', async () => {
  let previews = 0
  const state = mount({
    preview: () => { throw new Error('must not inspect personnel') },
    equipmentPreview: async (file) => { assert.equal(file, workbook); previews++; return { total: 2, valid: 1, invalid: 1, rows: [{ row_no: 2, status: 'READY', action: 'UPDATE', capability: { usage_scope: 'COMPANY_ONLY' } }, { row_no: 3, status: 'INVALID', errors: ['检定日期无效'] }] } },
    equipmentCommit: () => { throw new Error('preview must not write') },
  }, 'EQUIPMENT')
  state.pick({ target: { files: [workbook] } })
  await state.inspect()
  assert.equal(previews, 1)
  assert.deepEqual(state.selected.value, [2])
  assert.equal(state.result.value, null)
})
test('设备确认只发原文件和有效物理行号，逐行失败仍可展示且阻止再次提交', async () => {
  const commands = []
  const state = mount({ equipmentCommit: async (...args) => { commands.push(args); return { imported: 0, skipped: 1, rows: [{ row_no: 2, status: 'FAILED', message: '设备占用冲突' }] } } }, 'EQUIPMENT')
  state.file.value = workbook
  state.preview.value = { rows: [{ row_no: 2, status: 'READY' }, { row_no: 3, status: 'INVALID' }] }
  state.selected.value = [2, 3]
  await state.commit()
  await state.commit()
  assert.deepEqual(commands, [[workbook, [2]]])
  assert.equal(state.result.value.rows[0].status, 'FAILED')
  assert.equal(state.events[0][0], 'completed')
})
test('设备上传失败、无有效选择、超限文件都不会触发确认写入', async () => {
  let calls = 0
  const state = mount({ equipmentPreview: async () => { throw new Error('文件网关不可用') }, equipmentCommit: () => { calls++ } }, 'EQUIPMENT')
  state.file.value = { name: '设备.csv', size: 2 * 1024 * 1024 + 1 }
  await state.inspect()
  assert.match(state.error.value, /非空 CSV/)
  state.file.value = workbook
  await state.inspect()
  assert.equal(state.error.value, '文件网关不可用')
  await state.commit()
  assert.equal(calls, 0)
  assert.equal(state.result.value, null)
})
test('设备确认在请求尚未结束时阻止重复提交，失败后保留待核对状态', async () => {
  let finish, writes = 0
  const state = mount({ equipmentCommit: () => { writes++; return new Promise((resolve) => { finish = resolve }) } }, 'EQUIPMENT')
  state.file.value = workbook
  state.preview.value = { rows: [{ row_no: 2, status: 'READY' }] }
  state.selected.value = [2]
  const pending = state.commit()
  await state.commit()
  assert.equal(writes, 1)
  finish({ imported: 1, skipped: 0 })
  await pending
  assert.equal(state.result.value, null)
  assert.match(state.error.value, /核对台账/)
  assert.equal(state.events.length, 0)
  assert.equal(state.busy.value, false)
})
test('设备导入路由和入口绑定设备权限并提供中文模板与日期范围', async () => {
  const view = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
  assert.match(api, /request\('\/equipment\/import\/preview', \{ method: 'POST', body: formData \}\)/)
  assert.match(api, /downloadImportTemplate\('\/equipment\/import\/template', '设备能力导入模板.csv'\)/)
  assert.match(view, /equipmentImportOpen && canManageDevice" resource-type="EQUIPMENT"/)
  assert.doesNotMatch(view, /equipmentFileInput|importEquipment\(file\)/)
  assert.match(dialog, /检定开始日期/)
  assert.match(dialog, /COMPANY_ONLY/)
  assert.match(view, /台账刷新失败/)
})
test('确认只提交勾选的合法行，成功后禁止重复提交', async () => {
  const commands = []
  const state = mount({ commit: async (...args) => { commands.push(args); return { imported: 1, skipped: 0, rows: [{ row_no: 2, status: 'IMPORTED' }] } } })
  state.file.value = workbook
  state.preview.value = { rows: [{ row_no: 2, status: 'READY' }, { row_no: 3, status: 'INVALID' }] }
  state.selected.value = [2, 3]
  await state.commit()
  await state.commit()
  assert.equal(commands.length, 1)
  assert.deepEqual(commands[0], [workbook, 'PERSON', [2]])
  assert.equal(state.events[0][0], 'completed')
})
test('空文件、非CSV、超限文件在上传前拒绝，网络失败不进入成功步骤', async () => {
  for (const file of [{ name: 'bad.xlsx', size: 1 }, { name: 'bad.csv', size: 0 }, { name: 'big.csv', size: 2 * 1024 * 1024 + 1 }]) {
    const state = mount({ preview: () => { throw new Error('should not upload') } })
    state.file.value = file
    await state.inspect()
    assert.match(state.error.value, /非空 CSV/)
  }
  const state = mount({ preview: async () => { throw new Error('网关不可用') } })
  state.file.value = workbook
  await state.inspect()
  assert.equal(state.preview.value, null)
  assert.equal(state.error.value, '网关不可用')
  assert.equal(state.busy.value, false)
})
test('预检和确认请求使用原始文件、物理行号且不伪造内部人员ID', () => {
  assert.match(api, /request\('\/capabilities\/import\/preview', \{ method: 'POST', body: formData \}\)/)
  assert.match(api, /formData\.append\('selected_rows', JSON\.stringify\(selectedRows\)\)/)
  assert.match(api, /\/capabilities\/import\/template/)
  assert.doesNotMatch(dialog, /formData\.append\('user_id'|v-html/)
  assert.match(dialog, /无需填写用户 ID/)
})
