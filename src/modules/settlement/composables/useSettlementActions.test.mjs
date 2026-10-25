import assert from 'node:assert/strict'
import test from 'node:test'
import { useSettlementActions } from './useSettlementActions.js'

// 计时器桩：notify 经 window.setTimeout 3.2 秒自动清除。
const scheduled = []
globalThis.window = { setTimeout: (handler, delay) => { scheduled.push({ handler, delay }); return scheduled.length } }

function harness({ refreshed = true } = {}) {
  const loads = []
  const deps = {
    load: async () => { loads.push(true); return refreshed },
    formatSettlementError: (error, options) => `${options.fallback}|${error.code}`,
  }
  return { deps, loads, ...useSettlementActions(deps) }
}

test('notify 写入提示并调度 3.2 秒自动清除', async () => {
  scheduled.length = 0
  const h = harness()
  h.notify('已保存')
  assert.equal(h.message.value, '已保存')
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delay, 3200)
  scheduled[0].handler()
  assert.equal(h.message.value, '')
})

test('act 成功路径：执行回调、刷新列表并提示成功文案', async () => {
  const h = harness({ refreshed: true })
  const calls = []
  await h.act(async () => { calls.push('callback') }, '已提交。')
  assert.deepEqual(calls, ['callback'])
  assert.equal(h.loads.length, 1)
  assert.equal(h.message.value, '已提交。')
  assert.equal(h.saving.value, false)
})

test('act 刷新失败保留成功事实并告诫勿重复提交', async () => {
  const h = harness({ refreshed: false })
  await h.act(async () => {}, '已提交。')
  assert.equal(h.message.value, '已提交。页面刷新失败，请刷新列表核对结果，勿重复提交。')
})

test('act 失败路径走格式化文案，saving 复位；忙时不重入', async () => {
  const h = harness()
  await h.act(async () => { throw Object.assign(new Error('x'), { code: 'E1' }) }, '不应出现')
  assert.equal(h.message.value, '操作失败，请稍后重试。|E1')
  assert.equal(h.saving.value, false)

  h.saving.value = true
  let ran = false
  await h.act(async () => { ran = true }, 'x')
  assert.equal(ran, false, '忙时不得重入')
  h.saving.value = false
})
