import assert from 'node:assert/strict'
import test from 'node:test'
import { useConfirmAction } from './useConfirmAction.js'

test('openConfirm applies caller defaults without inventing behavior', async () => {
  const { dialog, openConfirm } = useConfirmAction()
  assert.equal(dialog.value, null)
  openConfirm({ title: '删除', onConfirm: async () => true })
  // 与原 IAM 实现一致：description/onCancel 无默认值（调用方按需传入）。
  assert.equal(dialog.value.title, '删除')
  assert.equal(dialog.value.description, undefined)
  assert.equal(dialog.value.confirmText, '确认')
  assert.equal(dialog.value.cancelText, '取消')
  assert.equal(dialog.value.danger, false)
  assert.equal(dialog.value.busy, false)
  assert.equal(typeof dialog.value.onConfirm, 'function')
  assert.equal(dialog.value.onCancel, undefined)
})

test('runConfirm closes after truthy completion and keeps dialog on false', async () => {
  const { dialog, openConfirm, runConfirm } = useConfirmAction()
  let calls = 0
  openConfirm({ title: 'x', onConfirm: async () => { calls += 1; return false } })
  await runConfirm()
  assert.equal(calls, 1)
  assert.notEqual(dialog.value, null, 'onConfirm 返回 false 必须保留弹窗')
  assert.equal(dialog.value.busy, false)
  openConfirm({ title: 'x', onConfirm: async () => true })
  await runConfirm()
  assert.equal(dialog.value, null)
})

test('runConfirm keeps dialog open when callback throws and resets busy', async () => {
  const { dialog, openConfirm, runConfirm } = useConfirmAction()
  openConfirm({ title: 'x', onConfirm: async () => { throw new Error('boom') } })
  await assert.doesNotReject(runConfirm)
  assert.notEqual(dialog.value, null)
  assert.equal(dialog.value.busy, false)
})

test('closeConfirm is blocked while busy and fires onCancel once when idle', async () => {
  const { dialog, openConfirm, closeConfirm, runConfirm } = useConfirmAction()
  let cancels = 0
  let release
  openConfirm({ title: 'x', onConfirm: () => new Promise((resolve) => { release = resolve }), onCancel: () => { cancels += 1 } })
  const running = runConfirm()
  assert.equal(dialog.value.busy, true)
  closeConfirm()
  assert.notEqual(dialog.value, null, 'busy 期间不得关闭')
  release(true)
  await running
  assert.equal(dialog.value, null, '完成后自动关闭，不经 onCancel')
  assert.equal(cancels, 0)
  openConfirm({ title: 'y', onConfirm: async () => true, onCancel: () => { cancels += 1 } })
  closeConfirm()
  assert.equal(dialog.value, null)
  assert.equal(cancels, 1, '空闲关闭时触发 onCancel')
})

test('replacing dialog identity guards stale completions', async () => {
  const { dialog, openConfirm, runConfirm } = useConfirmAction()
  let release
  openConfirm({ title: 'first', onConfirm: () => new Promise((resolve) => { release = resolve }) })
  const first = runConfirm()
  openConfirm({ title: 'second', onConfirm: async () => true })
  release(true)
  await first
  assert.equal(dialog.value.title, 'second', '旧回调完成不得关闭新弹窗')
})
