import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createFirstRunStore } from './useFirstRun.js'
import { firstRunStorageKey } from '../utils/firstRunState.js'

const AT = '2026-11-07T10:00:00.000Z'
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function fakeStorage() {
  const map = new Map()
  const calls = { getItem: 0, setItem: 0 }
  return {
    map,
    calls,
    getItem(key) {
      calls.getItem += 1
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      calls.setItem += 1
      map.set(key, String(value))
    },
    removeItem(key) { map.delete(key) },
  }
}

function jsonResponse(data, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => ({ code: 'OK', data }),
    text: async () => '',
  }
}

function principal(overrides = {}) {
  return {
    tenant: { id: 'tenant-a', name: '租户甲' },
    user: { id: 'user-a', name: '张三' },
    account: { id: 'account-a', code: 'zhangsan' },
    permission_codes: [],
    ...overrides,
  }
}

function createStore(options = {}) {
  return createFirstRunStore({
    storage: fakeStorage(),
    now: () => new Date(AT),
    loadUsers: async () => ({ total: 1 }),
    ...options,
  })
}

test('主体不明时不创建记录、不写任务', () => {
  const storage = fakeStorage()
  const store = createFirstRunStore({ storage, now: () => new Date(AT), loadUsers: async () => ({ total: 1 }) })
  assert.equal(store.markPortalReady(null), false)
  assert.equal(store.state.record, null)
  assert.equal(store.markTaskCompleted('theme'), false)
  assert.equal(store.openChecklist(), false)
  assert.equal(storage.map.size, 0)
  assert.equal(storage.calls.setItem, 0)
})

test('门户就绪时创建记录，重复就绪不会重复写盘', () => {
  const storage = fakeStorage()
  const store = createFirstRunStore({ storage, now: () => new Date(AT), loadUsers: async () => ({ total: 1 }) })
  assert.equal(store.markPortalReady(principal()), true)
  assert.equal(store.state.record.tour, 'pending')
  assert.equal(storage.map.size, 1)
  const writes = storage.calls.setItem
  assert.equal(store.markPortalReady(principal()), true)
  assert.equal(storage.calls.setItem, writes, '已就绪时不应再写 localStorage')
})

test('按 tenant+user 隔离：两个主体各自的记录与进度互不影响', () => {
  const storage = fakeStorage()
  const a = createFirstRunStore({ storage, now: () => new Date(AT), loadUsers: async () => ({ total: 1 }) })
  const b = createFirstRunStore({ storage, now: () => new Date(AT), loadUsers: async () => ({ total: 1 }) })
  a.markPortalReady(principal())
  b.markPortalReady(principal({ tenant: { id: 'tenant-b' }, user: { id: 'user-b' } }))
  a.markTaskCompleted('theme')

  assert.equal(a.state.record.tasks.theme, true)
  assert.equal(b.state.record.tasks.theme, false)
  assert.equal(storage.map.size, 2)
  // 重新创建同主体实例，能从各自键恢复。
  const aReloaded = createFirstRunStore({ storage, now: () => new Date(AT), loadUsers: async () => ({ total: 1 }) })
  aReloaded.markPortalReady(principal())
  assert.equal(aReloaded.state.record.tasks.theme, true)
})

test('任务可见性跟随权限：无权限项的事件不会被记为完成', () => {
  const store = createStore()
  store.markPortalReady(principal())
  assert.equal(store.checklistSummary.value.total, 3)
  assert.equal(store.markTaskCompleted('firstAccount'), false)
  assert.equal(store.state.record.tasks.firstAccount, false)

  const authorized = createStore()
  authorized.markPortalReady(principal({ permission_codes: ['platform:user:read', 'platform:audit:view'] }))
  assert.equal(authorized.checklistSummary.value.total, 5)
  assert.equal(authorized.markTaskCompleted('firstAccount'), true)
  assert.equal(authorized.state.record.tasks.firstAccount, true)
})

test('真实事件驱动清单完成，并落盘到当前主体键', () => {
  const storage = fakeStorage()
  const store = createFirstRunStore({ storage, now: () => new Date(AT), loadUsers: async () => ({ total: 1 }) })
  store.markPortalReady(principal())
  assert.equal(store.markTaskCompleted('userPanel'), true)
  assert.equal(store.markTaskCompleted('subsystem'), true)
  assert.equal(store.markTaskCompleted('theme'), true)
  assert.equal(store.checklistSummary.value.done, 3)
  assert.equal(store.checklistSummary.value.complete, true)
  assert.equal(store.state.record.doneAt, AT)

  const reloaded = createFirstRunStore({ storage, now: () => new Date(AT), loadUsers: async () => ({ total: 1 }) })
  reloaded.markPortalReady(principal())
  assert.deepEqual(
    ['userPanel', 'subsystem', 'theme'].filter((key) => reloaded.state.record.tasks[key]),
    ['userPanel', 'subsystem', 'theme'],
  )
})

test('导览：header 锚点缺失不启动、缺锚步骤跳过、终态不再自动出现', () => {
  const store = createStore()
  store.markPortalReady(principal())
  assert.equal(store.beginTour({ hasAnchor: () => false }), false)
  assert.equal(store.state.tourVisible, false)

  assert.equal(store.beginTour({ hasAnchor: (anchor) => anchor === 'portal-header' }), true)
  assert.equal(store.state.tourIndex, 0)
  assert.equal(store.state.record.tour, 'running')
  assert.equal(store.state.record.step, 0)

  // 子系统卡片、主题切换、用户面板都缺锚 → 直接跳到清单入口。
  store.advanceTour({ hasAnchor: (anchor) => anchor === 'checklist-entry' })
  assert.equal(store.state.tourIndex, 4)
  // 清单入口之后没有步骤 → 以 done 收尾。
  store.advanceTour({ hasAnchor: (anchor) => anchor === 'checklist-entry' })
  assert.equal(store.state.tourVisible, false)
  assert.equal(store.state.record.tour, 'done')
  assert.equal(store.state.record.seenAt, AT)

  // 终态：再次就绪也不会自动出现，直到显式重新查看。
  assert.equal(store.beginTour({ hasAnchor: () => true }), false)
  assert.equal(store.restartTour(), true)
  assert.equal(store.state.record.tour, 'pending')
  assert.equal(store.beginTour({ hasAnchor: () => true }), true)
  store.finishTour('skipped')
  assert.equal(store.state.record.tour, 'skipped')
  assert.equal(store.beginTour({ hasAnchor: () => true }), false)
})

test('导览中途离开门户落为 skipped，不自动续播；重新查看仍可重开', () => {
  const store = createStore()
  store.markPortalReady(principal())
  store.beginTour({ hasAnchor: () => true })
  store.advanceTour({ hasAnchor: () => true })
  assert.equal(store.state.tourIndex, 1)

  store.markPortalUnready()
  assert.equal(store.state.tourVisible, false)
  assert.equal(store.state.record.tour, 'skipped', '中断必须落为终态，不能留下 running')
  assert.equal(store.state.record.step, 1)
  assert.ok(store.state.record.seenAt)

  // 再回到门户也不会自动续播；只有显式“重新查看”才能重开。
  store.markPortalReady()
  assert.equal(store.beginTour({ hasAnchor: () => true }), false)
  assert.equal(store.restartTour(), true)
  assert.equal(store.state.record.tour, 'pending')
  assert.equal(store.beginTour({ hasAnchor: () => true }), true)
  assert.equal(store.state.tourIndex, 0)
})

test('第 ④ 项探测使用只读 GET /api/v1/users?page=1&page_size=1，total>=1 即完成', async () => {
  let requested = ''
  globalThis.fetch = async (url) => {
    requested = String(url)
    // 后端 /users 的 total 已排除初始化超管：只有 1 个业务账号也算完成。
    return jsonResponse({ items: [{ id: 'u-2' }], total: 1, page: 1, page_size: 1 })
  }
  const store = createFirstRunStore({ storage: fakeStorage(), now: () => new Date(AT) })
  store.markPortalReady(principal({ permission_codes: ['platform:user:read'] }))
  store.openChecklist()
  assert.equal(await store.probeFirstAccount(), true)
  assert.equal(requested, '/api/v1/users?page=1&page_size=1')
  assert.equal(store.state.probeStatus, 'complete')
  assert.equal(store.state.record.tasks.firstAccount, true)

  // 只读：列表以外的 IAM 数据没有被操作，完成的只是清单状态。
  assert.equal(store.state.record.tour, 'pending')
})

test('探测不到业务账号或探测失败都保持未完成，失败可重试', async () => {
  let response = { total: 0 }
  const store = createFirstRunStore({
    storage: fakeStorage(),
    now: () => new Date(AT),
    loadUsers: async () => response,
  })
  store.markPortalReady(principal({ permission_codes: ['platform:user:read'] }))
  store.openChecklist()
  assert.equal(await store.probeFirstAccount(), false)
  assert.equal(store.state.probeStatus, 'incomplete')
  assert.equal(store.state.record.tasks.firstAccount, false)

  // 探测失败：状态为 error、进度不变，仍可再试。
  let attempts = 0
  const failing = createFirstRunStore({
    storage: fakeStorage(),
    now: () => new Date(AT),
    loadUsers: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('network down')
      return { total: 3 }
    },
  })
  failing.markPortalReady(principal({ permission_codes: ['platform:user:read'] }))
  failing.openChecklist()
  assert.equal(await failing.probeFirstAccount(), false)
  assert.equal(failing.state.probeStatus, 'error')
  assert.equal(failing.state.record.tasks.firstAccount, false)
  assert.ok(failing.state.probeMessage)

  assert.equal(await failing.probeFirstAccount(), true)
  assert.equal(failing.state.probeStatus, 'complete')
  assert.equal(failing.state.record.tasks.firstAccount, true)

  // 无权限时根本不发请求。
  let calls = 0
  const hidden = createFirstRunStore({
    storage: fakeStorage(),
    now: () => new Date(AT),
    loadUsers: async () => { calls += 1; return { total: 3 } },
  })
  hidden.markPortalReady(principal())
  assert.equal(await hidden.probeFirstAccount(), false)
  assert.equal(calls, 0)
})

test('主体确定即创建记录，目录未就绪只影响导览调度', () => {
  const storage = fakeStorage()
  const store = createFirstRunStore({
    storage,
    now: () => new Date(AT),
    loadUsers: async () => ({ total: 0 }),
    listenStorage: false,
  })
  store.setCatalogReady(false)
  assert.equal(store.markPortalReady(principal()), true)
  assert.equal(store.state.record.tour, 'pending')
  assert.equal(store.state.portalReady, true, '主体确定即创建记录')
  assert.equal(store.state.catalogReady, false, '目录未就绪不阻塞清单')
  assert.equal(storage.map.size, 1)
  // 目录 settled 后才允许 GuideHost 调度导览。
  assert.equal(store.setCatalogReady(true), true)
  assert.equal(store.state.catalogReady, true)
})

test('探测按 scope + generation 隔离：切主体后迟到响应被丢弃', async () => {
  const storage = fakeStorage()
  let resolveFirstProbe
  const firstProbe = new Promise((resolve) => { resolveFirstProbe = resolve })
  let calls = 0
  const store = createFirstRunStore({
    storage,
    now: () => new Date(AT),
    listenStorage: false,
    loadUsers: () => {
      calls += 1
      return calls === 1 ? firstProbe : Promise.resolve({ total: 1 })
    },
  })
  store.markPortalReady(principal({ permission_codes: ['platform:user:read'] }))
  const pendingA = store.probeFirstAccount()

  // 切换到同租户另一个用户：旧请求还在途。
  store.markPortalReady(principal({ user: { id: 'user-b' }, permission_codes: ['platform:user:read'] }))
  assert.equal(await store.probeFirstAccount(), true)
  assert.equal(store.state.scope, 'v1|t:tenant-a|u:user-b')

  resolveFirstProbe({ total: 1 })
  assert.equal(await pendingA, false, '旧主体响应必须被丢弃')
  assert.equal(store.state.record.tasks.firstAccount, true, '只应写入当前主体 B')

  // A 的落盘记录保持未完成，B 的迟到响应没有跨作用域污染。
  const recordA = JSON.parse(storage.map.get(firstRunStorageKey('v1|t:tenant-a|u:user-a')))
  assert.equal(recordA.tasks.firstAccount, false)
})

test('重置清单递增 generation：在途探测不会把完成写回来', async () => {
  let resolveProbe
  const pendingProbe = new Promise((resolve) => { resolveProbe = resolve })
  const store = createFirstRunStore({
    storage: fakeStorage(),
    now: () => new Date(AT),
    listenStorage: false,
    loadUsers: () => pendingProbe,
  })
  store.markPortalReady(principal({ permission_codes: ['platform:user:read'] }))
  const pending = store.probeFirstAccount()
  assert.equal(store.state.probeStatus, 'checking')

  assert.equal(store.resetChecklist(), true)
  resolveProbe({ total: 1 })
  assert.equal(await pending, false)
  assert.equal(store.state.probeStatus, 'idle')
  assert.equal(store.state.record.tasks.firstAccount, false)
})

test('storage 事件按任务 OR、导览终态单调合并；写前先重读最新记录', () => {
  const storage = fakeStorage()
  const options = { storage, now: () => new Date(AT), loadUsers: async () => ({ total: 0 }), listenStorage: false }
  const tabA = createFirstRunStore(options)
  const tabB = createFirstRunStore(options)
  tabA.markPortalReady(principal())
  tabB.markPortalReady(principal())
  const key = firstRunStorageKey('v1|t:tenant-a|u:user-a')

  tabA.markTaskCompleted('theme')
  assert.equal(tabB.handleStorageEvent({ key }), true)
  assert.equal(tabB.state.record.tasks.theme, true, '另一标签页的任务应合并进来')

  // B 写自己的任务时必须保留 A 刚写入的 theme（写前合并最新记录）。
  tabB.markTaskCompleted('userPanel')
  const stored = JSON.parse(storage.map.get(key))
  assert.equal(stored.tasks.theme, true)
  assert.equal(stored.tasks.userPanel, true)

  // A 完成导览后，B 里的 running 不能被当成“更新”覆盖 done。
  tabB.beginTour({ hasAnchor: () => true })
  assert.equal(tabB.state.record.tour, 'running')
  tabA.beginTour({ hasAnchor: () => true })
  tabA.finishTour('done')
  assert.equal(tabB.handleStorageEvent({ key }), true)
  assert.equal(tabB.state.record.tour, 'done')
  assert.equal(tabB.state.record.seenAt, AT)

  // 另一标签页重置清单，本地旧任务不能复活。
  tabA.resetChecklist()
  tabB.handleStorageEvent({ key })
  assert.equal(tabB.state.record.tasks.theme, false)
  assert.equal(tabB.state.record.tasks.userPanel, false)
})

test('审计日志：仅已有记录且有 audit:view 才写第 ⑤ 项', () => {
  // 从未访问门户：没有记录，访问 /audit 也不创建。
  const emptyStorage = fakeStorage()
  const fresh = createFirstRunStore({ storage: emptyStorage, now: () => new Date(AT), loadUsers: async () => ({ total: 1 }) })
  fresh.bindPrincipal(principal({ permission_codes: ['platform:audit:view'] }))
  assert.equal(fresh.observeRoute({ path: '/audit' }), false)
  assert.equal(emptyStorage.map.size, 0)

  // 已有记录 + 有权限：路由命中即完成。
  const storage = fakeStorage()
  const visited = createFirstRunStore({ storage, now: () => new Date(AT), loadUsers: async () => ({ total: 1 }) })
  visited.markPortalReady(principal({ permission_codes: ['platform:audit:view'] }))
  assert.equal(visited.observeRoute({ path: '/settings/iam' }), false)
  assert.equal(visited.state.record.tasks.audit, false)
  assert.equal(visited.observeRoute({ path: '/audit' }), true)
  assert.equal(visited.state.record.tasks.audit, true)

  // 有记录但无权限：不写。
  const noPermission = createFirstRunStore({ storage, now: () => new Date(AT), loadUsers: async () => ({ total: 1 }) })
  noPermission.bindPrincipal(principal())
  assert.equal(noPermission.observeRoute({ path: '/audit' }), false)

  // 直接刷新在 /audit：principal 绑定后补记，不新建记录。
  const deepLink = createFirstRunStore({ storage, now: () => new Date(AT), loadUsers: async () => ({ total: 1 }) })
  deepLink.observeRoute({ path: '/audit' })
  deepLink.bindPrincipal(principal({ permission_codes: ['platform:audit:view'] }))
  assert.equal(deepLink.state.record.tasks.audit, true)
})

test('重新查看导览与重置清单：都只改自己的那部分状态', () => {
  const store = createStore()
  store.markPortalReady(principal())
  store.beginTour({ hasAnchor: () => true })
  store.finishTour('skipped')
  store.markTaskCompleted('theme')

  assert.equal(store.restartTour(), true)
  assert.equal(store.state.record.tour, 'pending')
  assert.equal(store.state.record.tasks.theme, true, '重看导览不清清单')

  assert.equal(store.resetChecklist(), true)
  assert.equal(store.state.record.tasks.theme, false)
  assert.equal(store.state.record.resetAt, AT)
  assert.equal(store.state.record.tour, 'pending', '重置清单不动导览')
})

test('落盘内容不包含主体姓名、账号名等 PII', () => {
  const storage = fakeStorage()
  const store = createFirstRunStore({ storage, now: () => new Date(AT), loadUsers: async () => ({ total: 1 }) })
  store.markPortalReady(principal())
  store.markTaskCompleted('theme')
  const serialized = [...storage.map.values()].join('\n')
  for (const pii of ['张三', '租户甲', 'zhangsan', 'account-a']) {
    assert.equal(serialized.includes(pii), false, `存储中不应出现 ${pii}`)
  }
})
