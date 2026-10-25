import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { ref } from 'vue'
import { createRequestScope } from '../platform/shared/composables/requestScope.js'
import { formatSettlementError } from './utils/errors.js'

// 沿用 presaleStability.test.mjs 的做法：从真实 SFC 提取结算读取与写编排函数，
// 在注入的上下文中执行，验证接线后的行为而非复述实现。
function functions(file, names, context) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const bodies = names.map((name) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
    assert.ok(start >= 0, `missing ${name}`)
    return source.slice(start, source.indexOf('\n}', start) + 2)
  })
  return vm.runInNewContext(`${bodies.join('\n')}\n({${names.join(',')}})`, context)
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function until(condition, timeoutMs = 100) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time')
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// —— 任务 B：保存/刷新分离（回归锁定）—— act 编排下写入 HTTP 2xx 即已保存，
// 随后的 load() 刷新失败必须如实说明，不得误报为操作失败。

function actHarness() {
  const notices = []
  const loads = { calls: 0, result: true }
  const context = {
    ref, formatSettlementError,
    saving: ref(false),
    load: async () => { loads.calls++; return loads.result },
    notify: (value) => notices.push(String(value)),
  }
  return { ...functions('./composables/useSettlementActions.js', ['act'], context), context, notices, loads }
}

test('核销写入成功但页面刷新失败：提示成功与刷新失败，不误报操作失败', async () => {
  const h = actHarness()
  h.loads.result = false
  await h.act(async () => {}, '核销分配已确认。')
  assert.match(h.notices.at(-1), /核销分配已确认。页面刷新失败，请刷新列表核对结果，勿重复提交/)
  assert.doesNotMatch(h.notices.at(-1), /操作失败/, '刷新失败不得报成操作失败')
  assert.equal(h.loads.calls, 1, '刷新链仍要尝试拉取最新数据')
  assert.equal(h.context.saving.value, false, 'finally 必须释放进行中标志')
})

test('核销写入失败：按操作失败提示，不触发刷新链也不宣称成功', async () => {
  const h = actHarness()
  await h.act(async () => { throw new Error('服务端保存失败') }, '核销分配已确认。')
  assert.equal(h.loads.calls, 0, '写失败不得触发保存后的刷新链')
  assert.doesNotMatch(h.notices.at(-1), /已确认/)
  assert.doesNotMatch(h.notices.at(-1), /页面刷新失败/)
  assert.equal(h.context.saving.value, false)
})

// —— 任务 C：请求作用域 —— 旧 section 的迟到响应不得覆盖新 section 的数据，
// 旧请求也不得关闭新请求的 loading；组件卸载后所有票据失效。

function loadHarness() {
  const context = {
    ref, createRequestScope, formatSettlementError,
    settlementScope: createRequestScope(),
    active: ref('receivables'),
    loading: ref(false),
    error: ref(''),
    dunningRecipientsLoading: ref(false),
    listPages: ref({}),
    pagedLists: [],
  }
  context.loadTargets = () => context.targets
  return context
}

test('菜单快速切换后：旧 section 的迟到响应不得覆盖新 section 数据，也不关闭新请求加载态', async () => {
  const first = deferred()
  const second = deferred()
  const targetOld = ref([{ id: 'KEEP-OLD' }])
  const targetNew = ref([])
  const context = loadHarness()
  let loaded = 0
  const { load } = functions('./views/SettlementView.vue', ['load'], context)
  context.targets = [[() => { loaded++; return first.promise }, targetOld, [{ id: 'KEEP-OLD' }]]]
  const slow = load()
  await until(() => loaded === 1)
  context.active.value = 'invoices'
  context.targets = [[() => { loaded++; return second.promise }, targetNew, []]]
  const fast = load()
  await until(() => loaded === 2)
  first.resolve([{ id: 'STALE' }])
  await slow
  assert.deepEqual(targetOld.value, [{ id: 'KEEP-OLD' }], '旧 section 的迟到响应不得覆盖数据')
  assert.equal(context.loading.value, true, '旧请求不得关闭新请求的加载态')
  assert.equal(context.error.value, '')
  second.resolve([{ id: 'FRESH' }])
  await fast
  assert.deepEqual(targetNew.value, [{ id: 'FRESH' }])
  assert.equal(context.loading.value, false)
})

test('组件卸载（作用域销毁）后：迟到的 load 响应不得回写任何数据', async () => {
  const pending = deferred()
  const target = ref([{ id: 'KEEP' }])
  const context = loadHarness()
  let loaded = 0
  const { load } = functions('./views/SettlementView.vue', ['load'], context)
  context.targets = [[() => { loaded++; return pending.promise }, target, [{ id: 'KEEP' }]]]
  const running = load()
  await until(() => loaded === 1)
  context.settlementScope.invalidate() // 模拟 requestScope onScopeDispose（组件卸载）
  pending.resolve([{ id: 'LATE' }])
  const result = await running
  assert.equal(result, false, '卸载后的迟到响应必须整体丢弃')
  assert.deepEqual(target.value, [{ id: 'KEEP' }])
})

// —— 任务 D：写操作进行中单飞 guard —— 结算表单按钮依赖 :disabled="saving"，
// 函数级 guard 兜底防止快速双击/回车隐式提交造成重复核销、重复开票。

test('act 在写操作进行中再次触发时直接返回，不重复提交', async () => {
  let writes = 0
  const context = {
    ref, formatSettlementError,
    saving: ref(true), // 模拟上一次写操作仍在进行
    load: async () => true,
    notify: () => assert.fail('进行中重复触发不得给出任何提示或提交'),
  }
  const { act } = functions('./composables/useSettlementActions.js', ['act'], context)
  await act(async () => { writes++ }, '核销分配已确认。')
  assert.equal(writes, 0, '写操作进行中必须被单飞 guard 拦截')
})
