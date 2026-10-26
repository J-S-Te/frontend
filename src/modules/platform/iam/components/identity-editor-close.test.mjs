import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createFormSnapshot, hasUnsavedChanges } from '../../../shared/utils/unsavedChanges.js'

const source = readFileSync(new URL('./IamSettingsModule.vue', import.meta.url), 'utf8')
function closeHarness({ dirty = false, saving = false } = {}) {
  const form = { account_name: dirty ? 'edited-account' : '' }
  const state = { editor: { value: { kind: 'account' } }, saving: { value: saving }, form,
    editorInitialSnapshot: { value: createFormSnapshot({ account_name: '' }) }, hasUnsavedChanges,
    openConfirm: dialog => { state.confirm = dialog } }
  const start = source.indexOf('function closeEditorNow()')
  const end = source.indexOf('// 输入校验', start)
  state.close = vm.runInNewContext(`${source.slice(start, end)}; closeEditor`, state)
  return state
}
test('未编辑时取消直接关闭，编辑后保留表单并要求确认', () => {
  const clean = closeHarness(); clean.close(); assert.equal(clean.editor.value, null)
  const dirty = closeHarness({ dirty: true }); dirty.close()
  assert.equal(dirty.editor.value.kind, 'account')
  assert.equal(dirty.confirm.cancelText, '继续编辑')
  dirty.confirm.onConfirm()
  assert.equal(dirty.editor.value, null)
})
test('保存进行中不能关闭或弹出丢弃确认', () => {
  const state = closeHarness({ dirty: true, saving: true }); state.close()
  assert.equal(state.editor.value.kind, 'account'); assert.equal(state.confirm, undefined)
})
test('丢弃确认必须位于身份编辑弹窗之后，避免相同层级被覆盖', () => {
  assert.ok(source.indexOf('v-if="confirmDialog"') > source.indexOf('<IdentityEditorModal'))
})
test('二次确认出现时暂停编辑器焦点限制，确认框拥有独立焦点容器', () => {
  assert.match(source, /active: computed\(\(\) => Boolean\(editor\.value\) && !confirmDialog\.value\)/)
  assert.match(source, /container: confirmElement/)
  assert.match(source, /ref="confirmElement"/)
})

test('确认框 Escape 不冒泡到编辑器并重新触发丢弃确认', () => {
  const confirmation = source.slice(source.indexOf('v-if="confirmDialog"'))
  assert.match(confirmation, /@keydown\.esc\.stop="closeConfirm"/)
  assert.ok(!confirmation.includes('@keydown.esc="closeConfirm"'))
})
