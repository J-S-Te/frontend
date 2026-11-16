import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, ref } from 'vue'

// 用途：创建栏目读取的可控夹具，观察请求、状态发布和上下文失效。
// 参数：initial 为初始栏目；deferred 为是否手动完成请求。
// 返回值：响应式输入、请求记录与读取器。
async function fixture(initial = 'projects', deferred = false) {
  const { useProjectSectionData } = await import('./useProjectSectionData.js')
  const scope = effectScope()
  const section = ref(initial), context = ref('tenant-a|user-a|rev1'), ready = ref(false)
  const access = ref(true)
  const calls = [], applied = []
  const loaders = Object.fromEntries(['events', 'dashboard', 'catalog'].map(name => [name, () => {
    calls.push(name)
    if (!deferred) return Promise.resolve(name)
    return new Promise((resolve, reject) => applied.push({ name, resolve, reject }))
  }]))
  const published = []
  const reader = scope.run(() => useProjectSectionData({ section, context, ready,
    allowed: () => access.value, loaders, apply: data => published.push(data), reset() {} }))
  return { scope, section, context, ready, access, calls, applied, published, reader }
}

test('核心未就绪不请求，项目列表只取事件与待创建统计，不读规则目录', async () => {
  const view = await fixture()
  try {
    assert.deepEqual(view.calls, [])
    view.ready.value = true
    await view.reader.load()
    assert.deepEqual(view.calls, ['events', 'dashboard'])
    assert.deepEqual(Object.keys(view.published[0]), ['events', 'dashboard'])
  } finally { view.scope.stop() }
})

test('规则栏目只读取所需目录，节点栏目必须读取事件', async () => {
  const view = await fixture('automations')
  try {
    view.ready.value = true
    await view.reader.load()
    assert.deepEqual(view.calls, ['catalog'])
    view.section.value = 'preparation'
    await view.reader.load()
    assert.deepEqual(view.calls, ['catalog', 'events'])
  } finally { view.scope.stop() }
})

test('切换栏目、权限世代或卸载使在途结果失效', async () => {
  const view = await fixture('automations', true)
  view.ready.value = true
  const first = view.reader.load()
  await nextTick()
  view.section.value = 'sla'
  const second = view.reader.load()
  await nextTick()
  view.applied[0].resolve({ version: 'old' })
  await first
  assert.deepEqual(view.published, [])
  view.context.value = 'tenant-a|user-a|rev2'
  view.scope.stop()
  for (const pending of view.applied.slice(1)) pending.resolve({ version: 'late' })
  await second
  assert.deepEqual(view.published, [])
})

test('同次并发读取合并，失败保留可重试错误，重试重新发起', async () => {
  const view = await fixture('sla', true)
  try {
    view.ready.value = true
    const first = view.reader.load(), second = view.reader.load()
    await nextTick()
    assert.equal(view.calls.length, 1)
    view.applied[0].reject(new Error('目录暂不可用'))
    await Promise.all([first, second])
    assert.ok(view.reader.error.value)
    assert.equal(view.reader.loading.value, false)
    const retry = view.reader.load()
    await nextTick()
    view.applied[1].resolve({ automation_triggers: [], sla_statuses: [] })
    await retry
    assert.equal(view.calls.length, 2)
    assert.equal(view.reader.error.value, '')
  } finally { view.scope.stop() }
})


test('权限撤销后不给未授权栏目发布空事实，显示拒绝状态且不发请求', async () => {
  const view = await fixture('sla')
  try {
    view.access.value = false
    view.ready.value = true
    await view.reader.load()
    assert.deepEqual(view.calls, [])
    assert.deepEqual(view.published, [])
    assert.match(view.reader.error.value, /无权/)
  } finally { view.scope.stop() }
})
