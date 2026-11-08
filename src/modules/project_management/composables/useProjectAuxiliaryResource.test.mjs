import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useProjectAuxiliaryResource } from './useProjectAuxiliaryResource.js'

// 用途：创建辅助数据读取夹具，观察请求次数、发布结果与错误/加载态。
// 参数：deferred 为 true 时请求由用例手动结算。
// 返回值：响应式上下文、请求记录与读取器。
function fixture(deferred = false) {
  const scope = effectScope()
  const context = ref('tenant-a|user-a|rev1')
  const calls = []
  const pending = []
  const published = []
  const resets = []
  let confirmedValue = 0
  const reader = scope.run(() => useProjectAuxiliaryResource({
    context,
    loader: () => {
      calls.push(calls.length + 1)
      if (!deferred) return Promise.resolve({ version: calls.length })
      return new Promise((resolve, reject) => pending.push({ resolve, reject }))
    },
    apply: (data) => published.push(data),
    reset: () => resets.push(resets.length),
  }))
  return { scope, context, calls, pending, published, resets, reader }
}

test('未进入使用区域不读取：只有显式 ensure/load 才发请求', async () => {
  const view = fixture()
  try {
    await nextTick()
    assert.deepEqual(view.calls, [], '创建组合式不得预先读取辅助数据')
    assert.equal(view.reader.confirmed.value, false)
    await view.reader.ensure()
    assert.deepEqual(view.calls, [1])
    assert.equal(view.reader.confirmed.value, true, '成功后才视为已确认')
  } finally { view.scope.stop() }
})

test('同一作用域并发合并为一次请求；已确认后 ensure 复用，force 才重读', async () => {
  const view = fixture(true)
  try {
    const first = view.reader.ensure()
    const second = view.reader.ensure()
    await nextTick()
    assert.equal(view.calls.length, 1, '并发入口必须复用同一个读取')
    view.pending[0].resolve({ version: 1 })
    await Promise.all([first, second])
    assert.deepEqual(view.published, [{ version: 1 }])
    assert.equal(await view.reader.ensure(), true)
    assert.equal(view.calls.length, 1, '已确认的当前上下文数据不再重复请求')
    const retried = view.reader.retry()
    await nextTick()
    assert.equal(view.calls.length, 2, '显式重试必须强制重读')
    view.pending[1].resolve({ version: 2 })
    await retried
  } finally { view.scope.stop() }
})

test('失败不缓存：保留可重试错误，下一次 ensure 重新发起并恢复', async () => {
  const view = fixture(true)
  try {
    const first = view.reader.ensure()
    await nextTick()
    view.pending[0].reject(new Error('目录暂不可用'))
    assert.equal(await first, false)
    assert.match(view.reader.error.value, /目录暂不可用/)
    assert.equal(view.reader.loading.value, false)
    assert.equal(view.reader.confirmed.value, false, '失败不得标记为已确认')
    const retry = view.reader.ensure()
    await nextTick()
    assert.equal(view.calls.length, 2, '失败后再次使用必须重新请求')
    view.pending[1].resolve({ version: 2 })
    assert.equal(await retry, true)
    assert.equal(view.reader.error.value, '')
  } finally { view.scope.stop() }
})

test('租户/用户/授权代次变化：旧请求不得回写，旧数据必须清空', async () => {
  const view = fixture(true)
  try {
    const stale = view.reader.ensure()
    await nextTick()
    view.context.value = 'tenant-a|user-b|rev2'
    assert.equal(view.reader.loading.value, false, '失效代次不得保持加载态')
    assert.equal(view.reader.confirmed.value, false)
    assert.equal(view.resets.length, 1, '隔离键变化必须清空本资源数据')
    view.pending[0].resolve({ version: 'old' })
    assert.equal(await stale, false)
    assert.deepEqual(view.published, [], '旧身份的迟到响应不得发布')
    assert.equal(view.reader.loading.value, false)
  } finally { view.scope.stop() }
})

test('组件销毁后迟到响应与失败都不得回写', async () => {
  const view = fixture(true)
  const pendingRead = view.reader.ensure()
  await nextTick()
  view.scope.stop()
  view.pending[0].reject(new Error('late failure'))
  assert.equal(await pendingRead, false)
  assert.deepEqual(view.published, [])
  assert.equal(view.reader.error.value, '')
  assert.equal(view.reader.loading.value, false)
})

test('维护成功后 invalidate 使数据失效但保留展示，下一次 ensure 重新读取', async () => {
  const view = fixture(false)
  try {
    await view.reader.ensure()
    assert.equal(view.reader.confirmed.value, true)
    view.reader.invalidate()
    assert.equal(view.reader.confirmed.value, false, '维护成功后必须失效')
    assert.deepEqual(view.published, [{ version: 1 }], '保留已展示数据由 apply/reset 决定')
    await view.reader.ensure()
    assert.equal(view.calls.length, 2, '失效后下一次使用重新确认')
  } finally { view.scope.stop() }
})
