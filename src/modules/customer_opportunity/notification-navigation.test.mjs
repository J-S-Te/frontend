import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { createMemoryHistory, createRouter, NavigationFailureType } from 'vue-router'
import * as navigation from './navigation.js'
import { presaleStateToQuery } from './presaleQuery.js'

const origin = 'https://crm.example'
const source = readFileSync(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')
const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
const statements = parse(script, { sourceType: 'module' }).program.body

// 用途：执行真实售前路由消费函数与监听，保留响应式查询变化。
// 参数：query 为进入售前页的查询参数。
// 返回值：真实路由处理状态、打开记录及卸载入口。
function presaleHarness(query = { request_id: '17' }) {
  const scope = effectScope()
  const calls = [], replacements = []
  const route = reactive({ name: 'customer_opportunity', params: { section: 'presale' }, query })
  const context = {
    route, activeSection: computed(() => route.params.section),
    canReadPresales: ref(true), selectedPresale: ref(null), error: ref(''),
    crmResourceID: navigation.crmResourceID, presaleStateToQuery,
    presaleFilters: {}, presaleView: ref('list'), presalePage: { number: 1, size: 20 },
    presaleColumnLimit: ref(20), stableQuery: value => JSON.stringify(value),
    router: { replace: async value => { replacements.push(value) } },
    openPresale: async id => {
      calls.push(id)
      context.selectedPresale.value = { request: { id } }
    },
    closePresale: () => { context.selectedPresale.value = null }, watch,
  }
  const names = ['presaleQueryForRoute', 'syncPresaleURL', 'openPresaleFromRoute']
  const declarations = statements.filter(node => node.type === 'FunctionDeclaration'
    && names.includes(node.id.name)).map(node => script.slice(node.start, node.end))
  const watchers = statements.filter(node => node.type === 'ExpressionStatement'
    && script.slice(node.start, node.end).startsWith('watch(')
    && script.slice(node.start, node.end).includes('openPresaleFromRoute'))
    .map(node => script.slice(node.start, node.end))
  const ui = scope.run(() => new Function(...Object.keys(context),
    `${declarations.join('\n')}\n${watchers.join('\n')}; return { syncPresaleURL }`)(
    ...Object.values(context)))
  return { ...ui, context, route, calls, replacements, stop: () => scope.stop() }
}

test('售前深链冷进入与同路由切换都打开通知对应申请', async () => {
  const h = presaleHarness()
  try {
    await nextTick()
    assert.deepEqual(h.calls, [17])
    h.route.query.request_id = '29'
    await nextTick()
    assert.deepEqual(h.calls, [17, 29])
    assert.equal(h.context.selectedPresale.value.request.id, 29)
  } finally { h.stop() }
})

test('售前筛选写回 URL 时保留请求坐标，非法或无权限入口不打开详情', async () => {
  const h = presaleHarness()
  try {
    await h.syncPresaleURL()
    assert.equal(h.replacements[0].query.request_id, '17')
    h.route.query.request_id = ['17', '29']
    await nextTick()
    assert.deepEqual(h.calls, [17])
    assert.equal(h.context.selectedPresale.value, null)
    assert.match(h.context.error.value, /无效/)
    h.context.canReadPresales.value = false
    h.route.query.request_id = '31'
    await nextTick()
    assert.deepEqual(h.calls, [17])
  } finally { h.stop() }
})

test('信用审批路由接收明确申请或旧客户坐标，拒绝额外及重复参数', () => {
  assert.deepEqual(navigation.parseNotificationTarget(
    '/customer-opportunity/credit-approvals?customer_id=42', origin), {
    name: 'customer_opportunity', params: { section: 'credit-approvals' },
    query: { customer_id: '42' },
  })
  for (const query of ['application_id=8&application_id=9', 'customer_id=-1',
    'customer_id=42&scope=all', '']) {
    assert.equal(navigation.parseNotificationTarget(
      `/customer-opportunity/credit-approvals?${query}`, origin), null)
  }
})

test('本地信用待审通知转到审批卡片，结果通知继续显示客户信用历史', () => {
  assert.equal(typeof navigation.crmNotificationTarget, 'function')
  const pending = navigation.crmNotificationTarget({ type: 'CREDIT_APPLICATION_PENDING',
    customer_id: 42, target_path: '/customer-opportunity/customers?customer_id=42&tab=credit' }, origin)
  assert.deepEqual(pending, { name: 'customer_opportunity',
    params: { section: 'credit-approvals' }, query: { customer_id: '42' } })
  const explicit = navigation.crmNotificationTarget({ type: 'CREDIT_APPLICATION_PENDING',
    target_path: '/customer-opportunity/credit-approvals?application_id=88' }, origin)
  assert.equal(explicit.query.application_id, '88')
  const result = navigation.crmNotificationTarget({ type: 'CREDIT_APPLICATION_APPROVED',
    target_path: '/customer-opportunity/customers?customer_id=42&tab=credit' }, origin)
  assert.equal(result.params.section, 'customers')
  assert.equal(navigation.crmNotificationTarget({ type: 'CREDIT_APPLICATION_PENDING',
    customer_id: 42, target_path: 'https://external.example/customer-opportunity/customers?customer_id=42&tab=credit' }, origin), null)
})

// 用途：执行真实通知点击与辅助状态同步函数，使用真实内存路由及导航守卫。
// 参数：options 为已读、计数和导航守卫的受控外部边界。
// 返回值：真实路由、可见状态、打开入口及接口调用记录。
async function notificationHarness(options = {}) {
  const calls = { mark: [], count: 0, presale: [] }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/customer-opportunity/:section', name: 'customer_opportunity', component: {} },
    { path: '/forbidden', name: 'forbidden', component: {} },
  ] })
  await router.push({ name: 'customer_opportunity', params: { section: 'notifications' } })
  if (options.guard) router.beforeEach(options.guard)
  const route = {}
  for (const key of ['fullPath', 'params', 'query']) Object.defineProperty(route, key,
    { get: () => router.currentRoute.value[key] })
  const context = { router, route, NavigationFailureType, window: { location: { origin } },
    notificationOpening: ref(false), notificationWarning: ref(''), error: ref(''),
    notificationUnreadCount: ref(3), crmNotificationTarget: navigation.crmNotificationTarget,
    formatCRMError: value => value.message,
    markNotificationRead: async id => { calls.mark.push(id); await options.mark?.(id) },
    getNotificationUnreadCount: async () => {
      calls.count++
      return options.count ? options.count() : { count: 2 }
    },
    openPresaleFromRoute: async () => { calls.presale.push(route.query.request_id) },
    showError: value => { context.error.value = value.message },
  }
  const names = ['openNotification', 'acknowledgeOpenedNotification', 'refreshNotificationCount']
  const declarations = statements.filter(node => node.type === 'FunctionDeclaration'
    && names.includes(node.id.name)).map(node => script.slice(node.start, node.end))
  const ui = new Function(...Object.keys(context), `${declarations.join('\n')};
    return { openNotification }`)(...Object.values(context))
  return { ...ui, context, calls, router }
}

test('信用待审通知已读写入失败仍进入真实审批卡片，不伪造已读成功', async () => {
  const h = await notificationHarness({ mark: async () => {
    throw Object.assign(new Error('已读服务暂不可用'), { status: 503 })
  } })
  const item = { id: 81, status: 'UNREAD', type: 'CREDIT_APPLICATION_PENDING', customer_id: 42,
    target_path: '/customer-opportunity/customers?customer_id=42&tab=credit' }
  await h.openNotification(item)
  assert.equal(h.router.currentRoute.value.fullPath,
    '/customer-opportunity/credit-approvals?customer_id=42')
  assert.equal(item.status, 'UNREAD')
  assert.match(h.context.notificationWarning.value, /已读.*未确认|已读.*无法/)
  assert.equal(h.context.notificationOpening.value, false)
})

test('售前通知未读计数失败仍导航，保留原计数并给出独立提示', async () => {
  const h = await notificationHarness({ count: async () => {
    throw Object.assign(new Error('计数服务暂不可用'), { status: 503 })
  } })
  await h.openNotification({ id: 82, status: 'READ', type: 'PRESALE_APPROVAL_PENDING',
    target_path: '/customer-opportunity/presale?request_id=17' })
  assert.equal(h.router.currentRoute.value.fullPath, '/customer-opportunity/presale?request_id=17')
  assert.equal(h.context.notificationUnreadCount.value, 3)
  assert.match(h.context.notificationWarning.value, /未读.*无法|数量.*无法/)
})

test('通知导航被守卫拒绝或重定向时保留可重试提示', async () => {
  for (const guard of [() => false,
    to => to.name === 'forbidden' ? undefined : { name: 'forbidden' }]) {
    const h = await notificationHarness({ guard })
    await h.openNotification({ id: 83, status: 'READ', type: 'PRESALE_APPROVAL_PENDING',
      target_path: '/customer-opportunity/presale?request_id=17' })
    assert.match(`${h.context.error.value}${h.context.notificationWarning.value}`, /无法进入|未能进入/)
    assert.deepEqual(h.calls.presale, [])
    assert.equal(h.context.notificationOpening.value, false)
  }
})

test('通知点击单飞保护，且同一售前地址关闭详情后可再次打开', async () => {
  let finish
  const h = await notificationHarness({ mark: () => new Promise(resolve => { finish = resolve }) })
  const item = { id: 84, status: 'UNREAD', type: 'PRESALE_APPROVAL_PENDING',
    target_path: '/customer-opportunity/presale?request_id=17' }
  const first = h.openNotification(item)
  const duplicate = h.openNotification(item)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.calls.mark, [84])
  finish()
  await Promise.all([first, duplicate])
  await h.openNotification(item)
  assert.deepEqual(h.calls.presale, ['17'])
})

test('没有有效目标的正文通知保留内容，不发已读或计数请求', async () => {
  const h = await notificationHarness()
  const item = { id: 85, status: 'UNREAD', body: '仍需阅读的业务正文', target_path: '' }
  await h.openNotification(item)
  assert.equal(h.router.currentRoute.value.params.section, 'notifications')
  assert.equal(item.body, '仍需阅读的业务正文')
  assert.equal(item.status, 'UNREAD')
  assert.deepEqual(h.calls.mark, [])
  assert.equal(h.calls.count, 0)
  assert.match(h.context.error.value, /入口无效/)
})
