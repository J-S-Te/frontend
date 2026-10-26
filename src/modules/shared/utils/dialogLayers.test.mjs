import test from 'node:test'
import assert from 'node:assert/strict'
import { registerDialogLayer, removeDialogLayer, isTopDialogLayer } from './dialogLayers.js'

test('嵌套弹窗仅顶层处理键盘；关闭任意一层不清除其他层的标记', () => {
  globalThis.document = { body: { dataset: {} } }
  const first = { style: {} }, second = { style: {} }
  registerDialogLayer(first)
  registerDialogLayer(second)
  assert.equal(isTopDialogLayer(first), false)
  assert.equal(isTopDialogLayer(second), true)
  assert.ok(Number(second.style.zIndex) > Number(first.style.zIndex))
  assert.equal(removeDialogLayer(first), false)
  assert.equal(document.body.dataset.confirmDialogOpen, 'true')
  assert.equal(removeDialogLayer(second), true)
  assert.equal(document.body.dataset.confirmDialogOpen, undefined)
  assert.equal(removeDialogLayer(second), false)
  delete globalThis.document
})

test('上层关闭后下层恢复键盘处理；无 DOM 时可清理', () => {
  globalThis.document = { body: { dataset: {} } }
  const first = { style: {} }, second = { style: {} }
  registerDialogLayer(first)
  registerDialogLayer(second)
  assert.equal(removeDialogLayer(second), true)
  assert.equal(isTopDialogLayer(first), true)
  delete globalThis.document
  assert.equal(removeDialogLayer(first), true)
})
