import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import { createRenderer } from 'vue'
import { useProjectNotifications } from './useProjectNotifications.js'
import { openNotificationTarget } from '../../shared/utils/notificationNavigation.js'

// 计时器宿主桩：composable 内通过 window 调度自动收起，测试环境显式提供。
const timers = { scheduled: [], cleared: [] }
const apps = []
const renderer = createRenderer({
  createComment: () => ({}), insert: () => {}, remove: () => {}, parentNode: () => null,
  nextSibling: () => null, createElement: () => ({}), createText: () => ({}),
  setText: () => {}, setElementText: () => {}, patchProp: () => {},
})
afterEach(() => { for (const app of apps.splice(0)) app.unmount() })
globalThis.window = {
  setTimeout: (handler, delay) => {
    const id = timers.scheduled.length + 1
    timers.scheduled.push({ id, handler, delay })
    return id
  },
  clearTimeout: (id) => timers.cleared.push(id),
}

// 用途：连接真实通知组合式与跳转函数，隔离远端收件箱和路由写入。
// 参数：选项提供收件箱和详情响应，以及读取、已读或导航错误。
// 返回值：组合式状态与可核对的外部调用记录。
function harness({ unreadCount = { unread_count: 3 }, inboxItems = [], apiError = null,
  detailItems = null, detailError = null, markError = null, navigationError = null } = {}) {
  const calls = { counts: [], inbox: [], details: [], marks: [], toasts: [], navigations: [] }
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
    getNotification: async (deliveryID) => {
      calls.details.push(deliveryID)
      if (detailError) throw detailError
      const detail = (detailItems || inboxItems).find((item) => item.delivery_id === deliveryID)
      return detail ? { ...detail } : null
    },
    markNotificationRead: async (deliveryID) => {
      calls.marks.push(deliveryID)
      if (markError) throw markError
      return {}
    },
    formatUserError: (error, options) => options?.fallback || error.message,
    openTarget: (item) => openNotificationTarget(item, {
      push: async (target) => {
        calls.navigations.push(target)
        if (navigationError) throw navigationError
      },
    }),
    showToast: (message, tone) => calls.toasts.push({ message, tone }),
  }
  let composable
  const app = renderer.createApp({ setup: () => {
    composable = useProjectNotifications(deps)
    return () => null
  } })
  app.mount({})
  apps.push(app)
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

test('openNotification 进入真实目标后推进已读，已读失败保留可重试条目', async () => {
  const ok = harness({
    unreadCount: { unread_count: 2 },
    inboxItems: [
      { delivery_id: 'd1', read_at: null, category: 'DEVIATION_REPORTED', title: 'a',
        target_url: '/project_management/exceptions?service_item_id=SI-1' },
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
  assert.deepEqual(ok.calls.navigations, ['/project_management/exceptions?service_item_id=SI-1'])
  assert.equal(ok.notificationActionID.value, '')

  const blocked = harness({ markError: new Error('409'), unreadCount: { unread_count: 1 },
    inboxItems: [{ delivery_id: 'd9', read_at: null,
      target_url: '/project_management/reports?service_item_id=SI-9' }] })
  await blocked.loadUnreadNotifications()
  await blocked.openNotification(blocked.notificationItems.value[0])
  assert.deepEqual(blocked.notificationItems.value.map((item) => item.delivery_id), ['d9'])
  assert.equal(blocked.notificationCount.value, 1)
  assert.equal(blocked.calls.toasts.length, 1)
  assert.ok(blocked.calls.toasts[0].message.length > 0)
  assert.equal(blocked.notificationActionID.value, '')
})

test('openNotification 未知类别仍可进入安全目标，不依赖固定分区类别', async () => {
  const h = harness({ inboxItems: [{ delivery_id: 'unknown', read_at: null,
    category: 'NEW_APPROVAL_KIND',
    target_url: '/project_management/methods?service_item_id=SI-2' }] })
  await h.loadUnreadNotifications()
  await h.openNotification(h.notificationItems.value[0])
  assert.deepEqual(h.calls.navigations, ['/project_management/methods?service_item_id=SI-2'])
  assert.deepEqual(h.calls.marks, ['unknown'])
  assert.deepEqual(h.notificationItems.value, [])
})

test('openNotification 接入共享解析，旧服务项与项目引用保留具体业务坐标', async () => {
  for (const [referenceType, category, id, target] of [
    ['SERVICE_ITEM', 'DEVIATION_REPORTED', 'SI-2',
      '/project_management/exceptions?service_item_id=SI-2'],
    ['PROJECT', 'SPLIT_RULE_MISSING', 'PJ-2',
      '/project_management/decomposition?project=PJ-2'],
  ]) {
    const item = { delivery_id: id, source_application: 'project_management',
      reference_type: referenceType, reference_id: id, category, read_at: null }
    const h = harness({ inboxItems: [item] })
    await h.loadUnreadNotifications()
    await h.openNotification(item)
    assert.deepEqual(h.calls.navigations, [target])
    assert.deepEqual(h.calls.marks, [id])
    assert.deepEqual(h.notificationItems.value, [])
  }
})

test('openNotification 只使用重新读取的真实详情，忽略过期摘要目标及引用', async () => {
  const h = harness({ inboxItems: [{ delivery_id: 'stale', read_at: null,
    source_application: 'project_management', category: 'DEVIATION_REPORTED',
    reference_type: 'SERVICE_ITEM', reference_id: 'SI-old',
    target_url: '/project_management/exceptions?service_item_id=SI-old' }],
  detailItems: [{ delivery_id: 'stale', read_at: null,
    source_application: 'project_management', category: 'SPECIAL_METHOD_REVIEWED',
    reference_type: 'SERVICE_ITEM', reference_id: 'SI-current', target_url: '' }] })
  await h.loadUnreadNotifications()
  await h.openNotification(h.notificationItems.value[0])
  assert.deepEqual(h.calls.details, ['stale'])
  assert.deepEqual(h.calls.navigations, ['/project_management/methods?service_item_id=SI-current'])
  assert.deepEqual(h.calls.marks, ['stale'])

  const missing = harness({ inboxItems: [{ delivery_id: 'removed-target', read_at: null,
    target_url: '/project_management/reports?service_item_id=SI-old' }],
  detailItems: [{ delivery_id: 'removed-target', read_at: null, target_url: '' }] })
  await missing.loadUnreadNotifications()
  await missing.openNotification(missing.notificationItems.value[0])
  assert.deepEqual(missing.calls.navigations, [])
  assert.deepEqual(missing.calls.marks, [])
  assert.equal(missing.notificationItems.value.length, 1)
})

test('openNotification 详情403、404及网络失败保留未读，不回退到摘要导航', async () => {
  for (const status of [403, 404, 0]) {
    const item = { delivery_id: 'unavailable', read_at: null,
      target_url: '/project_management/reports?service_item_id=SI-old' }
    const error = Object.assign(new Error('notification unavailable'), { status })
    const h = harness({ inboxItems: [item], detailError: error,
      unreadCount: { unread_count: 1 } })
    await h.loadUnreadNotifications()
    h.notificationOpen.value = true
    await h.openNotification(item)
    assert.deepEqual(h.calls.details, ['unavailable'])
    assert.deepEqual(h.calls.navigations, [])
    assert.deepEqual(h.calls.marks, [])
    assert.deepEqual(h.notificationItems.value, [item])
    assert.equal(h.notificationCount.value, 1)
    assert.equal(h.notificationOpen.value, true)
    assert.equal(h.calls.toasts[0]?.tone, 'error')
    assert.equal(h.notificationActionID.value, '')
  }
})

test('openNotification 详情已读时仍进入真实目标，不重复写已读或递减未读数', async () => {
  const h = harness({ inboxItems: [{ delivery_id: 'already-read', read_at: null,
    target_url: '/project_management/inbox?service_item_id=SI-old' }],
  detailItems: [{ delivery_id: 'already-read', read_at: '2026-11-18T09:00:00Z',
    target_url: '/project_management/reports?service_item_id=SI-current' }],
  unreadCount: { unread_count: 4 } })
  await h.loadUnreadNotifications()
  await h.openNotification(h.notificationItems.value[0])
  assert.deepEqual(h.calls.navigations, ['/project_management/reports?service_item_id=SI-current'])
  assert.deepEqual(h.calls.marks, [])
  assert.equal(h.notificationCount.value, 4)
  assert.deepEqual(h.notificationItems.value, [])
})

test('openNotification 导航成功但已读保存失败时保留真实未读详情并提示', async () => {
  const detail = { delivery_id: 'retry-read', read_at: null, title: '最新审批提醒',
    target_url: '/project_management/reports?service_item_id=SI-current' }
  const h = harness({ inboxItems: [{ delivery_id: 'retry-read', read_at: null, title: '旧摘要',
    target_url: '/project_management/inbox?service_item_id=SI-old' }],
  detailItems: [detail], markError: new Error('write failed'), unreadCount: { unread_count: 1 } })
  await h.loadUnreadNotifications()
  h.notificationOpen.value = true
  await h.openNotification(h.notificationItems.value[0])
  assert.deepEqual(h.calls.navigations, ['/project_management/reports?service_item_id=SI-current'])
  assert.deepEqual(h.calls.marks, ['retry-read'])
  assert.deepEqual(h.notificationItems.value, [detail])
  assert.equal(h.notificationCount.value, 1)
  assert.equal(h.notificationOpen.value, true)
  assert.equal(h.calls.toasts[0]?.tone, 'error')
  assert.match(h.calls.toasts[0]?.message, /已进入.*已读.*失败/)
  assert.equal(h.notificationActionID.value, '')
})

test('openNotification 缺失目标或导航被拒绝时保留未读提醒并明确提示', async () => {
  for (const options of [{}, { navigationError: new Error('无法进入关联页面') }]) {
    const item = { delivery_id: 'pending', read_at: null, category: 'UNMAPPED_KIND',
      ...(options.navigationError ? { target_url: '/project_management/inbox' } : {}) }
    const h = harness({ ...options, inboxItems: [item], unreadCount: { unread_count: 1 } })
    await h.loadUnreadNotifications()
    h.notificationOpen.value = true
    await h.openNotification(item)
    assert.deepEqual(h.calls.marks, [])
    assert.equal(h.notificationItems.value[0].delivery_id, 'pending')
    assert.equal(h.notificationCount.value, 1)
    assert.equal(h.notificationOpen.value, true)
    assert.equal(h.calls.toasts.length, 1)
    assert.equal(h.notificationActionID.value, '')
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
