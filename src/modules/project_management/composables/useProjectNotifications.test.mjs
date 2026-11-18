import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import { useProjectNotifications } from './useProjectNotifications.js'
import { createRenderer } from 'vue'

const mountedApps = []
afterEach(() => { for (const app of mountedApps.splice(0)) app.unmount() })

// 计时器宿主桩：composable 内通过 window 调度自动收起，测试环境显式提供。
const timers = { scheduled: [], cleared: [] }
globalThis.window = {
  location: { origin: 'http://localhost:8081' },
  setTimeout: (handler, delay) => {
    const id = timers.scheduled.length + 1
    timers.scheduled.push({ id, handler, delay })
    return id
  },
  clearTimeout: (id) => timers.cleared.push(id),
}

// 用途：运行真实通知协调逻辑，仅替换远程接口和导航边界。
// 参数：各项配置控制通知返回、失败或延迟边界。
// 返回值：通知状态与可观测的导航、提示和远程调用记录。
function harness({ unreadCount = { unread_count: 3 }, inboxItems = [], apiError = null,
  markError = null, markRead = null, getContext = () => 'user-a' } = {}) {
  const calls = { counts: [], inbox: [], marks: [], toasts: [], navigations: [], targets: [] }
  const deps = {
    getUnreadCount: async () => {
      calls.counts.push(true)
      if (apiError) throw apiError
      return unreadCount
    },
    listNotificationInbox: async (args) => {
      calls.inbox.push(args)
      if (apiError) throw apiError
      return { items: inboxItems }
    },
    markNotificationRead: async (deliveryID) => {
      calls.marks.push(deliveryID)
      if (markError) throw markError
      if (markRead) return markRead(deliveryID)
      return {}
    },
    formatUserError: (error, options) => options?.fallback || error.message,
    navigate: (section) => calls.navigations.push(section),
    navigateTarget: (target) => calls.targets.push(target),
    showToast: (message, tone) => calls.toasts.push({ message, tone }),
    getContext,
  }
  let composable
  const renderer = createRenderer({ createComment: () => ({}), insert: () => {}, remove: () => {},
    parentNode: () => null, nextSibling: () => null, createElement: () => ({}),
    createText: () => ({}), setText: () => {}, setElementText: () => {}, patchProp: () => {} })
  const app = renderer.createApp({ setup: () => {
    composable = useProjectNotifications(deps)
    return () => null
  } })
  app.mount({})
  mountedApps.push(app)
  return { deps, calls, ...composable }
}

test('refreshNotificationCount 成功回填未读数，失败时静默归零不阻断工作区', async () => {
  const ok = harness()
  await ok.refreshNotificationCount()
  assert.equal(ok.notificationCount.value, 3)
  assert.deepEqual(ok.calls.navigations, [])

  const failed = harness({ apiError: new Error('gateway down') })
  await failed.refreshNotificationCount()
  assert.equal(failed.notificationCount.value, 0)
  assert.equal(failed.notificationError.value, '')
})

test('通知已读等待期间切换账号或卸载，不把旧通知导航带到新上下文', async () => {
  const item = { delivery_id: 'approval-1', source_application: 'project_management',
    category: 'ROLLBACK_REQUESTED', reference_type: 'project_approval', reference_id: 'req-1',
    target_url: '/project_management/approvals?request_id=req-1' }
  for (const change of ['identity', 'dispose']) {
    let identity = 'user-a', finish
    const h = harness({ getContext: () => identity,
      markRead: () => new Promise(resolve => { finish = resolve }) })
    const pending = h.openNotification(item)
    if (change === 'identity') identity = 'user-b'
    else h.disposeNotifications()
    finish(); await pending
    assert.deepEqual(h.calls.targets, [], change)
    assert.deepEqual(h.calls.navigations, [], change)
  }
})

test('审批通知点击直达具体申请，已读失败保留提醒且仍能进入审批', async () => {
  const item = { delivery_id: 'approval-1', source_application: 'project_management',
    category: 'REPORT_CORRECTION_REQUESTED', reference_type: 'PROJECT_APPROVAL',
    reference_id: 'request-1', target_url: '/project_management/approvals?request_id=request-1' }
  for (const markError of [null, new Error('read unavailable')]) {
    const h = harness({ markError })
    h.notificationItems.value = [item]; h.notificationCount.value = 1
    await h.openNotification(item)
    assert.deepEqual(h.calls.targets, ['/project_management/approvals?request_id=request-1'])
    assert.equal(h.calls.navigations.length, 0)
    assert.equal(h.notificationCount.value, markError ? 1 : 0)
    if (markError) assert.match(h.calls.toasts[0].message, /已读/)
  }
})

test('loadUnreadNotifications 拉取未读列表并二次过滤已读；失败时清空列表并显式报错', async () => {
  const ok = harness({
    unreadCount: { unread_count: 2 },
    inboxItems: [
      { delivery_id: 'd1', read_at: null, title: 't1' },
      { delivery_id: 'd2', read_at: '2026-10-25T00:00:00Z', title: 't2' },
    ],
  })
  await ok.loadUnreadNotifications()
  assert.equal(ok.notificationLoading.value, false)
  assert.deepEqual(ok.notificationItems.value.map((item) => item.delivery_id), ['d1'])
  assert.equal(ok.notificationCount.value, 2)
  assert.equal(ok.notificationError.value, '')

  const failed = harness({ apiError: new Error('boom') })
  await failed.loadUnreadNotifications()
  assert.deepEqual(failed.notificationItems.value, [])
  assert.ok(failed.notificationError.value.length > 0, 'failure must surface the error text')
  assert.equal(failed.notificationLoading.value, false)
})

test('openNotification 已读推进后移除条目、递减计数、关闭弹层并跳转分区；失败保留列表并提示', async () => {
  const ok = harness({
    unreadCount: { unread_count: 2 },
    inboxItems: [
      { delivery_id: 'd1', read_at: null, category: 'DEVIATION_REPORTED', title: 'a' },
      { delivery_id: 'd2', read_at: null, category: 'SPLIT_RULE_MISSING', title: 'b' },
    ],
  })
  await ok.loadUnreadNotifications()
  ok.notificationOpen.value = true
  ok.notificationCount.value = 2
  await ok.openNotification(ok.notificationItems.value[0])
  assert.deepEqual(ok.calls.marks, ['d1'])
  assert.deepEqual(ok.notificationItems.value.map((item) => item.delivery_id), ['d2'])
  assert.equal(ok.notificationCount.value, 1)
  assert.equal(ok.notificationOpen.value, false)
  assert.deepEqual(ok.calls.navigations, ['exceptions'])
  assert.equal(ok.notificationActionID.value, '')

  const blocked = harness({ markError: new Error('409') })
  blocked.notificationItems.value = [{ delivery_id: 'd9', read_at: null }]
  blocked.notificationCount.value = 1
  await blocked.openNotification(blocked.notificationItems.value[0])
  assert.deepEqual(blocked.notificationItems.value.map((item) => item.delivery_id), ['d9'])
  assert.equal(blocked.notificationCount.value, 1)
  assert.equal(blocked.calls.toasts.length, 1)
  assert.ok(blocked.calls.toasts[0].message.length > 0)
  assert.equal(blocked.notificationActionID.value, '')
})

test('openNotification 的分区映射覆盖拆解缺口与团队指派，未知分区不跳转', async () => {
  const cases = [
    { delivery_id: 'x1', category: 'SPLIT_RULE_MISSING', expected: 'decomposition' },
    { delivery_id: 'x2', category: 'TEAM_ASSIGNED', expected: 'inbox' },
    { delivery_id: 'x3', category: 'EXECUTION_TEAM_ASSIGNED', expected: 'inbox' },
    { delivery_id: 'x4', category: 'SOMETHING_ELSE', expected: null },
  ]
  for (const item of cases) {
    const h = harness()
    await h.openNotification(item)
    assert.deepEqual(h.calls.navigations, item.expected ? [item.expected] : [], item.delivery_id)
  }
})

test('toggleNotifications 打开即装载并调度 5 秒自动收起；再次切换立即关闭；卸载清理定时器', async () => {
  timers.scheduled.length = 0
  timers.cleared.length = 0
  const h = harness({ inboxItems: [{ delivery_id: 'd1', read_at: null }] })
  h.toggleNotifications()
  assert.equal(h.notificationOpen.value, true)
  assert.deepEqual(h.calls.inbox, [{ page: 1, pageSize: 20, unreadOnly: true }])
  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].delay, 5000)

  h.toggleNotifications()
  assert.equal(h.notificationOpen.value, false)
  assert.ok(timers.cleared.includes(timers.scheduled[0].id), 'close must clear the pending auto-close timer')

  // 打开前的防御性清钟与关闭/卸载清理都走 clearTimeout：待收起定时器最终必被清理。
  h.toggleNotifications()
  h.disposeNotifications()
  assert.ok(timers.cleared.includes(timers.scheduled.at(-1).id), 'pending auto-close timer must be cleared on dispose')
})
