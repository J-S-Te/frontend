import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref } from 'vue'

// 用途：创建可控的能力响应，用于验证授权切换与迟到请求。
// 参数：无。
// 返回值：待完成Promise及其完成函数。
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('无模式读取权限不查能力，权限撤销后迟到响应不能重新开放原生入口', async () => {
  const { useProjectCreationCapabilities } = await import('./useProjectCreationCapabilities.js')
  const allowed = ref(false), session = ref(null), pending = deferred()
  let calls = 0
  const scope = effectScope()
  const ui = scope.run(() => useProjectCreationCapabilities({
    allowed, session, loader: () => { calls++; return pending.promise },
  }))
  assert.equal(calls, 0)
  allowed.value = true; session.value = { user_id: 'U1' }
  await nextTick()
  assert.equal(calls, 1)
  allowed.value = false
  await nextTick()
  pending.resolve({ native_enabled: true })
  await pending.promise; await nextTick()
  assert.equal(ui.nativeEnabled.value, false)
  assert.equal(ui.error.value, '')
  scope.stop()
})

test('能力异常只关闭新入口，刷新可恢复；仅严格true开放入口', async () => {
  const { useProjectCreationCapabilities } = await import('./useProjectCreationCapabilities.js')
  const allowed = ref(true), session = ref({ user_id: 'U1' })
  let result = new Error('能力读取失败')
  const scope = effectScope()
  const ui = scope.run(() => useProjectCreationCapabilities({
    allowed, session, loader: async () => { if (result instanceof Error) throw result; return result },
  }))
  await nextTick(); await nextTick()
  assert.equal(ui.nativeEnabled.value, false)
  assert.ok(ui.error.value.includes('能力读取失败'))
  result = { native_enabled: 'false' }
  await ui.refresh()
  assert.equal(ui.nativeEnabled.value, false)
  result = { native_enabled: true }
  await ui.refresh()
  assert.equal(ui.nativeEnabled.value, true)
  assert.equal(ui.error.value, '')
  scope.stop()
})
