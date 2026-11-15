import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as Vue from 'vue'

const source = readFileSync(new URL('./components/MetricFactsPanel.vue', import.meta.url), 'utf8')

// controlledResult 创建允许独立控制完成顺序的来源响应。
// 参数：无。
// 返回值：Promise及其完成控制器。
function controlledResult() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

// panelHarness 执行真实新增指标加载脚本，隔离HTTP及浏览器挂载。
// 参数：getMetricFacts为可控请求实现。
// 返回值：真实响应式状态、props和生命周期入口。
function panelHarness(getMetricFacts) {
  let mount, unmount
  const props = Vue.reactive({ section: 'finance', tenantId: 'tenant-a', userId: 'u1' })
  const context = { ...Vue, defineProps: () => props, defineExpose: () => {}, getMetricFacts,
    onMounted: callback => { mount = callback }, onBeforeUnmount: callback => { unmount = callback },
    formatDataAnalysisError: failure => failure.message, Intl, Date }
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  const state = vm.runInNewContext(`${script};({summary,error,loading,refresh,period})`, context)
  return { props, state, mount: () => mount(), unmount: () => unmount() }
}

test('新增指标在身份、月份切换和卸载后拒绝迟到结果', async () => {
  const first = controlledResult(), second = controlledResult(), third = controlledResult()
  let calls = 0
  const h = panelHarness(() => [first, second, third][calls++].promise)
  h.mount()
  assert.equal(calls, 1)
  h.props.userId = 'u2'
  await Vue.nextTick()
  assert.equal(calls, 2)
  first.resolve({ available: true, basis: '旧身份金额' })
  await Vue.nextTick(); await Vue.nextTick()
  assert.equal(h.state.summary.value, null)
  second.resolve({ available: true, basis: '当前身份金额' })
  await Vue.nextTick(); await Vue.nextTick()
  assert.equal(h.state.summary.value.basis, '当前身份金额')
  h.state.period.value = '2026-10'
  await Vue.nextTick()
  assert.equal(h.state.summary.value, null)
  h.unmount()
  third.resolve({ available: true, basis: '卸载后的响应' })
  await Vue.nextTick(); await Vue.nextTick()
  assert.equal(h.state.summary.value, null)
})
