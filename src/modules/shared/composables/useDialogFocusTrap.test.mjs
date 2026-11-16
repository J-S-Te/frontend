import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useDialogFocusTrap } from './useDialogFocusTrap.js'

test('作用域在 DOM 就绪前销毁，不得迟到夺取焦点或遗留键盘监听', async () => {
  const original = globalThis.document
  const listeners = new Set()
  let focusCount = 0
  globalThis.document = { activeElement: null, body: { dataset: {} },
    addEventListener: (_name, listener) => listeners.add(listener),
    removeEventListener: (_name, listener) => listeners.delete(listener) }
  const scope = effectScope()
  try {
    scope.run(() => useDialogFocusTrap({ active: ref(true), container: ref({
      querySelectorAll: () => [{ offsetParent: {}, focus: () => { focusCount += 1 } }],
    }) }))
    scope.stop()
    await nextTick()
    assert.equal(focusCount, 0)
    assert.equal(listeners.size, 0)
  } finally { scope.stop(); globalThis.document = original }
})
