import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope } from 'vue'
import { usePromptDialog } from './usePromptDialog.js'

test('input cancellation and disposal settle without submitting values', async () => {
  const scope = effectScope()
  const controller = scope.run(() => usePromptDialog())
  const first = controller.askPrompt({ title: '撤回申请', confirmText: '撤回申请' })
  controller.cancel()
  assert.equal(await first, null)
  const second = controller.askPrompt({ title: '登记发票', confirmText: '登记发票' })
  scope.stop()
  assert.equal(await second, null)
  assert.equal(controller.dialog.value, null)
})

test('replacing an input settles the previous request and accepts the new field values', async () => {
  const scope = effectScope()
  const controller = scope.run(() => usePromptDialog())
  const first = controller.askPrompt({ title: '撤回申请', confirmText: '撤回申请' })
  const second = controller.askPrompt({
    title: '登记发票', confirmText: '登记发票',
    fields: [{ name: 'invoice_no', label: '发票号码', required: true }],
  })
  assert.equal(await first, null)
  controller.accept({ invoice_no: '12345678' })
  assert.deepEqual(await second, { invoice_no: '12345678' })
  assert.equal(controller.dialog.value, null)
  scope.stop()
})

test('a vague action label cannot replace a pending prompt', async () => {
  const scope = effectScope()
  const controller = scope.run(() => usePromptDialog())
  const pending = controller.askPrompt({ title: '撤回申请', confirmText: '撤回申请' })
  assert.throws(() => controller.askPrompt({ title: '删除', confirmText: '确认' }), /操作结果/)
  assert.equal(controller.dialog.value.confirmText, '撤回申请')
  controller.accept('填写的原因')
  assert.equal(await pending, '填写的原因')
  scope.stop()
})
