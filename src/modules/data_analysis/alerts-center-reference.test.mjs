import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import * as Vue from 'vue'
import { formatDataAnalysisError } from './utils/errors.js'

const source = readFileSync(new URL('./views/AlertsCenterView.vue', import.meta.url), 'utf8')

// 用途：构造可控制完成顺序的隔离网络响应。
// 参数：无。
// 返回值：待完成的 Promise、完成和拒绝函数。
function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

// 用途：运行真实预警脚本及查询监听，仅替换网络、挂载和 DOM 边界。
// 参数：getAlerts 为授权列表读取；id 为通知中的预警标识。
// 返回值：真实状态、路由、挂载与卸载方法及写入计数。
function fixture(getAlerts, id = 'alert-2') {
  let mounted, unmounted
  let writes = 0
  const route = Vue.reactive({ query: id ? { alert_id: id } : {} })
  const context = {
    ...Vue, useRoute: () => route,
    onMounted: (callback) => { mounted = callback },
    onBeforeUnmount: (callback) => { unmounted = callback },
    defineProps: () => ({ permissions: ['alert.view', 'alert.manage'] }),
    getAlerts, getAlertSummary: async () => ({ total: 51, open: 50, closed: 1 }),
    ackAlert: async () => { writes++ }, closeAlert: async () => { writes++ },
    formatDataAnalysisError,
  }
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '')
  const state = vm.runInNewContext(`${script}\n;({
    alerts, page, total, error, loading, load,
    selectedAlert: typeof selectedAlert === 'undefined' ? null : selectedAlert,
    referenceNotice: typeof referenceNotice === 'undefined' ? null : referenceNotice,
    selectedAlertPanel: typeof selectedAlertPanel === 'undefined' ? null : selectedAlertPanel,
    refreshAlerts: typeof refreshAlerts === 'undefined' ? null : refreshAlerts,
  })`, context)
  return { state, route, mount: () => mounted(), unmount: () => unmounted?.(),
    writes: () => writes }
}

// 用途：等待查询监听和加载结果提交。
// 参数：无。
// 返回值：无。
async function settle() {
  await Vue.nextTick()
  await Vue.nextTick()
  await Vue.nextTick()
}

test('通知预警跨页定位真实行并展示关联内容，不受理或关闭', async () => {
  const requests = []
  const h = fixture(async (query) => {
    requests.push(query)
    return { items: query.page === 1
      ? Array.from({ length: 50 }, (_, index) => ({ id: `first-${index}`, status: 'OPEN' }))
      : [{ id: 'alert-2', title: '合同即将到期', target_ref: 'contract-9', status: 'CLOSED' }],
    total: 51, page: query.page, page_size: 50 }
  })
  let focused = 0
  if (h.state.selectedAlertPanel) h.state.selectedAlertPanel.value = { focus: () => { focused++ } }
  await h.mount()
  assert.equal(h.state.selectedAlert?.value?.id, 'alert-2')
  assert.equal(h.state.selectedAlert.value.target_ref, 'contract-9')
  assert.equal(h.state.selectedAlert.value.status, 'CLOSED')
  assert.equal(h.state.page.value, 2)
  assert.equal(h.state.alerts.value[0].id, 'alert-2')
  assert.deepEqual(requests.map((query) => query.page), [1, 2])
  assert.ok(requests.every((query) => query.status === '' && query.severity === ''))
  assert.equal(h.writes(), 0)
  assert.equal(focused, 1)
  h.unmount()
})

test('同页切换预警后旧响应不恢复旧行，移除参数会清理详情', async () => {
  const old = deferred()
  let first = true
  const h = fixture(() => {
    if (first) { first = false; return old.promise }
    return Promise.resolve({ items: [{ id: 'alert-3', title: '新预警', status: 'ACK' }],
      total: 1, page: 1, page_size: 50 })
  })
  const mounting = h.mount()
  h.route.query = { alert_id: 'alert-3' }
  await settle()
  old.resolve({ items: [{ id: 'alert-2', title: '旧预警', status: 'OPEN' }], total: 1 })
  await mounting
  await settle()
  assert.equal(h.state.selectedAlert?.value?.id, 'alert-3')
  assert.equal(h.state.alerts.value[0].id, 'alert-3')
  assert.equal(h.state.loading.value, false)
  h.route.query = {}
  await settle()
  assert.equal(h.state.selectedAlert.value, null)
  assert.equal(h.writes(), 0)
  h.unmount()
})

test('旧通知的迟到错误不能遮盖新通知，重试仍读取当前关联预警', async () => {
  const old = deferred()
  let first = true
  const h = fixture(() => {
    if (first) { first = false; return old.promise }
    return Promise.resolve({ items: [{ id: 'alert-3', status: 'ACK' }], total: 1 })
  })
  const mounting = h.mount()
  h.route.query = { alert_id: 'alert-3' }
  await settle()
  old.reject(Error('old request unavailable'))
  await mounting
  assert.equal(h.state.selectedAlert.value.id, 'alert-3')
  assert.equal(h.state.error.value, null)
  h.unmount()

  let unavailable = true
  const retry = fixture(async (query) => {
    if (unavailable) throw Error('temporary unavailable')
    return { items: query.page === 1
      ? Array.from({ length: 50 }, (_, index) => ({ id: `other-${index}`, status: 'OPEN' }))
      : [{ id: 'alert-2', status: 'CLOSED' }], total: 51 }
  })
  await retry.mount()
  unavailable = false
  assert.equal(typeof retry.state.refreshAlerts, 'function')
  await retry.state.refreshAlerts()
  assert.equal(retry.state.selectedAlert.value.id, 'alert-2')
  assert.equal(retry.state.error.value, null)
  retry.unmount()
})

test('授权分页查找有界，未定位到通知预警时不声称不存在', async () => {
  const requests = []
  const h = fixture(async (query) => {
    requests.push(query)
    return { items: Array.from({ length: 50 }, (_, index) => ({
      id: `other-${query.page}-${index}`, status: 'OPEN',
    })), total: 2000, page: query.page, page_size: 50 }
  })
  await h.mount()
  assert.equal(h.state.selectedAlert?.value, null)
  assert.equal(requests.length, 20)
  assert.match(h.state.referenceNotice?.value || '', /未定位|未找到/)
  assert.match(h.state.referenceNotice.value, /1000|20/)
  assert.doesNotMatch(h.state.referenceNotice.value, /不存在/)
  assert.equal(h.writes(), 0)
  h.unmount()
})

test('通知定位失败保留真实失败提示，卸载后迟到记录不可见', async () => {
  const failed = fixture(async () => { throw Error('network unavailable') })
  await failed.mount()
  assert.ok(failed.state.error.value)
  assert.equal(failed.state.selectedAlert?.value, null)
  failed.unmount()

  const pending = deferred()
  const h = fixture(() => pending.promise)
  const mounting = h.mount()
  h.unmount()
  pending.resolve({ items: [{ id: 'alert-2', status: 'OPEN' }], total: 1 })
  await mounting
  assert.equal(h.state.selectedAlert?.value, null)
  assert.equal(h.state.alerts.value.length, 0)
})
