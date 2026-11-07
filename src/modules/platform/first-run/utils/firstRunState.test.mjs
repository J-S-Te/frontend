import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FIRST_RUN_HEADER_ANCHOR,
  FIRST_RUN_STORAGE_PREFIX,
  FIRST_RUN_TASKS,
  FIRST_RUN_TOUR_STEPS,
  FIRST_RUN_VERSION,
  createFirstRunRecord,
  ensureFirstRunRecord,
  firstRunChecklistSummary,
  firstRunRecordKeys,
  firstRunScopeOf,
  firstRunStorageKey,
  isFirstRunTaskVisible,
  isFirstRunTourOpen,
  isFirstRunTourTerminal,
  mergeFirstRunRecords,
  normalizeFirstRunRecord,
  readFirstRunRecord,
  resolveNextTourStepIndex,
  resolvePreviousTourStepIndex,
  shouldStartFirstRunTour,
  visibleFirstRunTasks,
  withChecklistReset,
  withFirstRunTaskCompleted,
  withTourFinished,
  withTourRestarted,
  withTourStarted,
  writeFirstRunRecord,
} from './firstRunState.js'

const AT = '2026-11-07T10:00:00.000Z'

// 可观测的假存储：测试“主体不明不读写”时直接断言调用次数。
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  const calls = { getItem: 0, setItem: 0, removeItem: 0 }
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
    removeItem(key) {
      calls.removeItem += 1
      map.delete(key)
    },
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

test('主体不明时 first-run 一律不读不写', () => {
  const storage = fakeStorage()
  assert.equal(firstRunScopeOf(null), '')
  assert.equal(firstRunScopeOf({}), '')
  assert.equal(firstRunScopeOf({ tenant: { id: 't' } }), '')
  assert.equal(firstRunStorageKey(''), '')

  assert.equal(readFirstRunRecord('', storage), null)
  assert.equal(writeFirstRunRecord('', createFirstRunRecord(), storage), false)
  assert.equal(ensureFirstRunRecord('', storage), null)
  assert.equal(storage.calls.getItem, 0)
  assert.equal(storage.calls.setItem, 0)
  assert.equal(storage.map.size, 0)
})

test('存储键包含 tenant 与 user，持久化内容不含 PII', () => {
  const storage = fakeStorage()
  const scope = firstRunScopeOf(principal())
  assert.equal(scope, 'v1|t:tenant-a|u:user-a')

  const key = firstRunStorageKey(scope)
  assert.ok(key.startsWith(FIRST_RUN_STORAGE_PREFIX))
  assert.ok(key.includes('tenant-a'))
  assert.ok(key.includes('user-a'))

  writeFirstRunRecord(scope, createFirstRunRecord(), storage)
  const serialized = storage.map.get(key)
  assert.ok(serialized)
  for (const pii of ['张三', '租户甲', 'zhangsan', 'tenant-a', 'user-a']) {
    assert.equal(serialized.includes(pii), false, `记录里不应出现 ${pii}`)
  }
})

test('记录结构固定为 7 个键与 5 个任务，拒绝额外字段', () => {
  const record = normalizeFirstRunRecord({
    ...createFirstRunRecord(),
    pii: '张三',
    extra: true,
    tasks: { ...createFirstRunRecord().tasks, unknown: true },
  })
  assert.deepEqual(Object.keys(record).sort(), [...firstRunRecordKeys()].sort())
  assert.deepEqual(Object.keys(record.tasks).sort(), FIRST_RUN_TASKS.map((task) => task.key).sort())
  assert.equal(record.pii, undefined)
  assert.equal(record.tasks.unknown, undefined)
  assert.equal(record.v, FIRST_RUN_VERSION)
  assert.equal(record.tour, 'pending')
})

test('版本变更后导览重看一次，清单进度与时间戳保留', () => {
  const storage = fakeStorage()
  const scope = firstRunScopeOf(principal())
  const legacy = {
    v: FIRST_RUN_VERSION - 1,
    tour: 'done',
    step: 3,
    tasks: { ...createFirstRunRecord().tasks, theme: true },
    seenAt: AT,
    doneAt: null,
    resetAt: null,
  }
  storage.setItem(firstRunStorageKey(scope), JSON.stringify(legacy))

  const record = ensureFirstRunRecord(scope, storage)
  assert.equal(record.v, FIRST_RUN_VERSION)
  assert.equal(record.tour, 'pending')
  assert.equal(record.step, 0)
  assert.equal(record.tasks.theme, true)
  assert.equal(record.seenAt, AT)
  // 迁移结果必须写回，下一次读取不再被视为旧版本。
  const reread = readFirstRunRecord(scope, storage)
  assert.equal(reread.v, FIRST_RUN_VERSION)
  assert.equal(reread.tour, 'pending')
})

test('任务可见性由平台权限决定：无权限时只显示 3 项', () => {
  const record = createFirstRunRecord()
  const plain = principal()
  assert.equal(visibleFirstRunTasks(plain).length, 3)
  assert.equal(firstRunChecklistSummary(record, plain).total, 3)

  const userRead = principal({ permission_codes: ['platform:user:read'] })
  assert.equal(visibleFirstRunTasks(userRead).length, 4)
  assert.equal(isFirstRunTaskVisible('firstAccount', userRead), true)

  const both = principal({ permission_codes: ['platform:user:read', 'platform:audit:view'] })
  assert.equal(firstRunChecklistSummary(record, both).total, 5)
  // 通配权限与后端语义一致。
  assert.equal(isFirstRunTaskVisible('audit', { permission_codes: ['*'] }), true)
  // 非数组 / 空数组都按无权限处理，不能 fail-open。
  assert.equal(isFirstRunTaskVisible('audit', { permission_codes: null }), false)
})

test('完成任务：不可见任务不写、重复完成幂等、全部可见任务完成才写 doneAt', () => {
  const scope = firstRunScopeOf(principal())
  const storage = fakeStorage()
  let record = ensureFirstRunRecord(scope, storage)
  const plain = principal()

  // 无权限时第 ④ 项不可见，事件不得伪造完成。
  assert.equal(withFirstRunTaskCompleted(record, 'firstAccount', plain, AT), record)

  record = withFirstRunTaskCompleted(record, 'theme', plain, AT)
  assert.equal(record.tasks.theme, true)
  assert.equal(record.doneAt, null)
  assert.equal(withFirstRunTaskCompleted(record, 'theme', plain, AT), record, '重复完成应返回原对象')

  record = withFirstRunTaskCompleted(record, 'userPanel', plain, AT)
  record = withFirstRunTaskCompleted(record, 'subsystem', plain, AT)
  assert.equal(firstRunChecklistSummary(record, plain).complete, true)
  assert.equal(record.doneAt, AT)
})

test('导览锚点顺序与缺锚跳过', () => {
  assert.deepEqual(
    FIRST_RUN_TOUR_STEPS.map((step) => step.anchor),
    ['portal-header', 'subsystem-cards', 'theme-switcher', 'user-panel', 'checklist-entry'],
  )
  assert.equal(FIRST_RUN_HEADER_ANCHOR, 'portal-header')

  // 子系统卡片区缺锚 → 从主题切换继续。
  assert.equal(resolveNextTourStepIndex(1, (anchor) => anchor !== 'subsystem-cards'), 2)
  // 全部缺锚 → -1（由调用方收尾，不会卡在空步骤上）。
  assert.equal(resolveNextTourStepIndex(0, () => false), -1)
  // 回退同样跳过缺锚步骤。
  assert.equal(resolvePreviousTourStepIndex(3, (anchor) => anchor !== 'user-panel'), 2)
  assert.equal(resolvePreviousTourStepIndex(0, () => false), -1)
})

test('自动启动条件：仅门户、就绪、可见、无确认框、未到终态且 header 锚点存在', () => {
  const ready = {
    routeName: 'portal',
    sessionReady: true,
    catalogReady: true,
    pageVisible: true,
    confirmDialogOpen: false,
    record: createFirstRunRecord(),
    headerAnchorAvailable: true,
  }
  assert.equal(shouldStartFirstRunTour(ready), true)
  assert.equal(shouldStartFirstRunTour({ ...ready, routeName: 'settings' }), false)
  assert.equal(shouldStartFirstRunTour({ ...ready, sessionReady: false }), false)
  assert.equal(shouldStartFirstRunTour({ ...ready, catalogReady: false }), false)
  assert.equal(shouldStartFirstRunTour({ ...ready, pageVisible: false }), false)
  assert.equal(shouldStartFirstRunTour({ ...ready, confirmDialogOpen: true }), false)
  assert.equal(shouldStartFirstRunTour({ ...ready, headerAnchorAvailable: false }), false)
  assert.equal(shouldStartFirstRunTour({ ...ready, record: withTourFinished(createFirstRunRecord(), 'done', AT) }), false)
  assert.equal(shouldStartFirstRunTour({ ...ready, record: withTourFinished(createFirstRunRecord(), 'skipped', AT) }), false)
  // running 是“上次被中断”的残留：不自动续播，必须显式重新查看。
  assert.equal(shouldStartFirstRunTour({ ...ready, record: withTourStarted(createFirstRunRecord(), 1) }), false)
  assert.equal(isFirstRunTourOpen(withTourStarted(createFirstRunRecord(), 1)), false)
  assert.equal(isFirstRunTourOpen(createFirstRunRecord()), true)
  assert.equal(isFirstRunTourTerminal(withTourFinished(createFirstRunRecord(), 'done', AT)), true)
})

test('跳过 / 完成都是终态：只写一次 seenAt，重置导览才回到 pending', () => {
  let record = withTourStarted(createFirstRunRecord(), 2)
  assert.equal(record.tour, 'running')
  assert.equal(record.step, 2)

  record = withTourFinished(record, 'skipped', AT)
  assert.equal(record.tour, 'skipped')
  assert.equal(record.seenAt, AT)

  const later = '2026-11-08T10:00:00.000Z'
  record = withTourFinished(record, 'done', later)
  assert.equal(record.tour, 'done')
  assert.equal(record.seenAt, AT, 'seenAt 是首次进入终态时间，不应被覆盖')

  record = withTourRestarted(record)
  assert.equal(record.tour, 'pending')
  assert.equal(record.step, 0)
  assert.equal(record.seenAt, AT)
})

test('多标签合并：任务 OR、导览终态单调、重置更晚的一侧优先', () => {
  const base = createFirstRunRecord()
  const tabA = withFirstRunTaskCompleted(base, 'theme', principal(), AT)
  const tabB = withFirstRunTaskCompleted(base, 'userPanel', principal(), AT)
  const mergedTasks = mergeFirstRunRecords(tabA, tabB)
  assert.equal(mergedTasks.tasks.theme, true)
  assert.equal(mergedTasks.tasks.userPanel, true)
  assert.equal(mergedTasks.tour, 'pending')

  // done 不会被 running / skipped 覆盖。
  const done = withTourFinished(base, 'done', AT)
  const running = withTourStarted(base, 2)
  const mergedTour = mergeFirstRunRecords(done, running)
  assert.equal(mergedTour.tour, 'done')
  assert.equal(mergedTour.seenAt, AT)
  assert.equal(mergeFirstRunRecords(running, done).tour, 'done')

  // skipped 也不会被 running 覆盖。
  const skipped = withTourFinished(base, 'skipped', AT)
  assert.equal(mergeFirstRunRecords(skipped, running).tour, 'skipped')

  // 两侧都 running：步骤取更靠后的一个，不倒退。
  const stepOne = withTourStarted(base, 1)
  const stepThree = withTourStarted(base, 3)
  assert.equal(mergeFirstRunRecords(stepOne, stepThree).step, 3)

  // 一个标签页重置清单（更晚 resetAt）后，旧标签页的任务不能复活。
  const resetLater = withChecklistReset(
    withFirstRunTaskCompleted(base, 'theme', principal(), AT),
    '2026-11-09T10:00:00.000Z',
  )
  const mergedReset = mergeFirstRunRecords(
    withFirstRunTaskCompleted(base, 'theme', principal(), AT),
    resetLater,
  )
  assert.equal(mergedReset.tasks.theme, false)
  assert.equal(mergedReset.resetAt, '2026-11-09T10:00:00.000Z')
})

test('重置清单只清任务进度，不动导览终态', () => {
  const storage = fakeStorage()
  const scope = firstRunScopeOf(principal())
  let record = ensureFirstRunRecord(scope, storage)
  record = withTourFinished(withTourStarted(record, 0), 'done', AT)
  record = withFirstRunTaskCompleted(record, 'theme', principal(), AT)
  record = withChecklistReset(record, '2026-11-09T10:00:00.000Z')

  assert.equal(record.tasks.theme, false)
  assert.equal(record.doneAt, null)
  assert.equal(record.resetAt, '2026-11-09T10:00:00.000Z')
  assert.equal(record.tour, 'done')
  assert.equal(record.seenAt, AT)
})

test('非法存储内容按新记录收口，不抛错', () => {
  const storage = fakeStorage({ 'basic-platform.first-run|v1|t:tenant-a|u:user-a': '{not-json' })
  const scope = firstRunScopeOf(principal())
  assert.equal(readFirstRunRecord(scope, storage), null)
  const record = ensureFirstRunRecord(scope, storage)
  assert.equal(record.tour, 'pending')
  assert.equal(record.v, FIRST_RUN_VERSION)
})
