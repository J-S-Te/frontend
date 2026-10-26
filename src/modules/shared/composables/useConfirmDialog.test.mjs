import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope } from 'vue'
import { useConfirmDialog } from './useConfirmDialog.js'
import { acquireBodyScrollLock, releaseBodyScrollLock, resetBodyScrollLockForTest } from '../utils/bodyScrollLock.js'

test('stacked dialogs keep the scroll lock until the last one closes', () => {
  globalThis.document = { body: { style: { overflow: '' }, dataset: {} } }
  resetBodyScrollLockForTest()
  acquireBodyScrollLock() // 第一个弹窗打开
  acquireBodyScrollLock() // 第二个弹窗叠加
  assert.equal(document.body.style.overflow, 'hidden')
  releaseBodyScrollLock() // 先关第一个：仍有一个弹窗在展示
  assert.equal(document.body.style.overflow, 'hidden', '仍有弹窗时不得恢复滚动')
  releaseBodyScrollLock() // 最后一个关闭
  assert.equal(document.body.style.overflow, '', '归零后恢复滚动')
  // 记录的原始值被恢复；多余 release 不产生负计数副作用。
  releaseBodyScrollLock()
  assert.equal(document.body.style.overflow, '')
  delete globalThis.document
})

test('acquire preserves a pre-existing inline overflow style', () => {
  globalThis.document = { body: { style: { overflow: 'scroll' }, dataset: {} } }
  resetBodyScrollLockForTest()
  acquireBodyScrollLock()
  assert.equal(document.body.style.overflow, 'hidden')
  releaseBodyScrollLock()
  assert.equal(document.body.style.overflow, 'scroll', '恢复为进入前的原始值而非空串')
  delete globalThis.document
})

test('host scope disposal settles a pending askConfirm as cancelled', async () => {
  const scope = effectScope()
  let controller
  scope.run(() => {
    controller = useConfirmDialog()
  })
  const pending = controller.askConfirm({ title: '删除' })
  assert.ok(controller.dialog.value, '确认弹窗状态已挂起')
  scope.stop() // 模拟宿主组件销毁
  assert.equal(await pending, false, '未决确认必须以取消收场而不是永挂')
  assert.equal(controller.dialog.value, null)
})

test('scope disposal without a pending request is a no-op', () => {
  const scope = effectScope()
  let controller
  scope.run(() => {
    controller = useConfirmDialog()
  })
  scope.stop()
  assert.equal(controller.dialog.value, null)
})
