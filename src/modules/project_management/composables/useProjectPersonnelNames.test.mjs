import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useProjectPersonnelNames } from './useProjectPersonnelNames.js'

// 用途：等待异步读取链路推进到预期状态（合并读取会经过多个微任务）。
// 参数：condition 为判定函数，timeout 为上限毫秒。
// 返回值：条件满足时 resolve，超时抛错。
async function until(condition, timeout = 500) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error('condition not met in time')
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// 用途：创建人员姓名解析夹具：解析请求按 ID 集合记录，可手动结算。
// 参数：deferred 为 true 时解析请求由用例手动结算。
// 返回值：响应式引用集合、请求记录与组合式返回值。
function fixture(deferred = false) {
  const scope = effectScope()
  const context = ref('tenant-a|user-a|rev1')
  const referenced = ref([])
  const calls = []
  const pending = []
  const state = scope.run(() => useProjectPersonnelNames({
    context,
    readIDs: () => referenced.value,
    resolve: (ids) => {
      calls.push([...ids])
      if (!deferred) return Promise.resolve(Object.fromEntries(ids.map((id) => [id, `姓名-${id}`])))
      return new Promise((resolve, reject) => pending.push({ ids: [...ids], resolve, reject }))
    },
    describe: (cause, fallback) => String(cause?.message || fallback),
  }))
  return { scope, context, referenced, calls, pending, state }
}

test('没有已加载记录引用的人员 ID 时不发请求', async () => {
  const view = fixture()
  try {
    assert.equal(await view.state.load(), true)
    assert.deepEqual(view.calls, [], '无未解析 ID 时不得请求姓名')
    view.referenced.value = ['u-1']
    await view.state.load()
    assert.deepEqual(view.calls, [['u-1']])
    assert.equal(view.state.names.value.get('u-1'), '姓名-u-1')
  } finally { view.scope.stop() }
})

test('按未解析的 ID 集合合并读取，已解析的 ID 不重复请求', async () => {
  const view = fixture()
  try {
    view.referenced.value = ['u-1', 'u-2', 'u-1']
    await view.state.load()
    assert.deepEqual(view.calls, [['u-1', 'u-2']], 'ID 去重后按集合一次读取')
    view.referenced.value = ['u-1', 'u-2', 'u-3']
    await view.state.load()
    assert.deepEqual(view.calls.at(-1), ['u-3'], '只读取尚未解析的 ID')
  } finally { view.scope.stop() }
})

test('并发读取合并为一次请求；刷新重新确认全部引用 ID', async () => {
  const view = fixture()
  try {
    view.referenced.value = ['u-1', 'u-2']
    await view.state.load()
    assert.equal(view.calls.length, 1)
    const first = view.state.load()
    await first
    assert.equal(view.calls.length, 1, '已解析后普通读取不再发请求')
    await view.state.reload()
    assert.deepEqual(view.calls.at(-1), ['u-1', 'u-2'], '刷新必须重新确认全部引用 ID')
    assert.equal(view.calls.length, 2)
  } finally { view.scope.stop() }
})

test('读取期间新到达的 ID 在同一代次内补读，不留永久占位', async () => {
  const view = fixture(true)
  try {
    view.referenced.value = ['u-1']
    const load = view.state.load()
    await until(() => view.pending.length === 1)
    assert.deepEqual(view.calls, [['u-1']])
    view.referenced.value = ['u-1', 'u-2'] // 事件流/监控快照在读取过程中补充了人员 ID
    view.pending[0].resolve({ 'u-1': '姓名一' })
    await until(() => view.pending.length === 2)
    assert.deepEqual(view.calls, [['u-1'], ['u-2']], '读取期间新增的 ID 必须补读')
    view.pending[1].resolve({ 'u-2': '姓名二' })
    assert.equal(await load, true)
    assert.equal(view.state.names.value.get('u-2'), '姓名二')
  } finally { view.scope.stop() }
})

for (const [label, mapping] of [['部分', { 'u-1': '姓名一' }], ['空', {}]]) {
  test(`${label}成功响应遗漏姓名时本轮结束，下一轮仍可重新查询`, async () => {
    const view = fixture(true)
    try {
      view.referenced.value = ['u-1', 'u-2']
      const load = view.state.load()
      await until(() => view.pending.length === 1)
      view.pending[0].resolve(mapping)
      await until(() => view.pending.length > 1 || !view.state.loading.value)
      // 让旧实现的意外补读有界结束，避免回归测试也陷入无穷请求。
      if (view.pending.length > 1) view.pending[1].reject(new Error('不应重复请求遗漏姓名'))
      assert.equal(await load, true, '成功但缺失姓名应正常结束')
      assert.deepEqual(view.calls, [['u-1', 'u-2']], '本轮每个ID只请求一次')
      assert.equal(view.state.loading.value, false)
      assert.equal(view.state.error.value, '')
      assert.equal(view.state.names.value.has('u-2'), false, '不为缺失姓名伪造结果')

      const retry = view.state.retry()
      await until(() => view.pending.length === 2)
      const missing = ['u-1', 'u-2'].filter((id) => !mapping[id])
      assert.deepEqual(view.calls[1], missing, '不跨轮缓存缺失结果')
      view.pending[1].resolve(Object.fromEntries(missing.map((id) => [id, `姓名-${id}`])))
      assert.equal(await retry, true)
      assert.equal(view.state.names.value.has('u-2'), true)
    } finally { view.scope.stop() }
  })
}

test('并发读取共用本轮，遗漏ID不重复补查，真正新增ID仍补读', async () => {
  const view = fixture(true)
  try {
    view.referenced.value = ['u-1', 'u-missing']
    const first = view.state.load()
    const concurrent = view.state.load()
    await until(() => view.pending.length === 1)
    view.referenced.value = ['u-1', 'u-missing', 'u-3']
    view.pending[0].resolve({ 'u-1': '姓名一' })
    await until(() => view.pending.length === 2)
    view.pending[1].resolve({ 'u-3': '姓名三' })
    await until(() => view.pending.length > 2 || !view.state.loading.value)
    if (view.pending.length > 2) view.pending[2].reject(new Error('重复补查遗漏ID'))
    assert.deepEqual(await Promise.all([first, concurrent]), [true, true])
    assert.deepEqual(view.calls, [['u-1', 'u-missing'], ['u-3']])
    assert.equal(view.state.names.value.get('u-3'), '姓名三')
    assert.equal(view.state.names.value.has('u-missing'), false)
    assert.equal(view.state.loading.value, false)
  } finally { view.scope.stop() }
})

test('解析失败保留可重试错误且不缓存；重试成功后清空错误', async () => {
  const view = fixture(true)
  try {
    view.referenced.value = ['u-1']
    const failing = view.state.load()
    await nextTick()
    view.pending[0].reject(new Error('目录未开通'))
    assert.equal(await failing, false)
    assert.match(view.state.error.value, /目录未开通/)
    assert.equal(view.state.loading.value, false)
    assert.equal(view.state.names.value.has('u-1'), false, '失败不得写入姓名')
    const retry = view.state.retry()
    await nextTick()
    assert.equal(view.calls.length, 2, '重试必须重新请求')
    view.pending[1].resolve({ 'u-1': '姓名一' })
    assert.equal(await retry, true)
    assert.equal(view.state.error.value, '')
    assert.equal(view.state.names.value.get('u-1'), '姓名一')
  } finally { view.scope.stop() }
})

test('姓名由其他目录补齐后，残留的解析失败提示会被清除且不再请求', async () => {
  const view = fixture(true)
  try {
    view.referenced.value = ['u-1']
    const failing = view.state.load()
    await nextTick()
    view.pending[0].reject(new Error('批量解析不可用'))
    await failing
    assert.match(view.state.error.value, /批量解析不可用/)
    view.state.remember({ 'u-1': '姓名来自人员目录' })
    assert.equal(await view.state.retry(), true)
    assert.equal(view.calls.length, 1, '已无未解析 ID 时不得重复请求')
    assert.equal(view.state.error.value, '')
  } finally { view.scope.stop() }
})

test('换用户/租户后清空姓名，旧请求不得回写', async () => {
  const view = fixture(true)
  try {
    view.referenced.value = ['u-1']
    const stale = view.state.load()
    await nextTick()
    assert.equal(view.state.loading.value, true)
    view.context.value = 'tenant-b|user-b|rev2'
    assert.equal(view.state.loading.value, false)
    assert.equal(view.state.names.value.size, 0, '身份变化必须清空旧姓名')
    view.pending[0].resolve({ 'u-1': '旧姓名' })
    assert.equal(await stale, false)
    assert.equal(view.state.names.value.size, 0, '旧身份的迟到响应不得发布')
  } finally { view.scope.stop() }
})

test('组件销毁后迟到响应不得回写姓名、错误或加载态', async () => {
  const view = fixture(true)
  view.referenced.value = ['u-1']
  const pendingRead = view.state.load()
  await nextTick()
  view.scope.stop()
  view.pending[0].reject(new Error('late failure'))
  assert.equal(await pendingRead, false)
  assert.equal(view.state.error.value, '')
  assert.equal(view.state.loading.value, false)
})
