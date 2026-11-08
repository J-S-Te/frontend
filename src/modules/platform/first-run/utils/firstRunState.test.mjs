import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FIRST_RUN_GUIDES,
  FIRST_RUN_GUIDE_KEYS,
  FIRST_RUN_HEADER_ANCHOR,
  FIRST_RUN_PORTAL_GUIDE,
  FIRST_RUN_STORAGE_PREFIX,
  FIRST_RUN_SUBSYSTEM_ANCHORS,
  FIRST_RUN_TASKS,
  FIRST_RUN_TOUR_STEPS,
  FIRST_RUN_VERSION,
  createFirstRunRecord,
  ensureFirstRunRecord,
  firstRunChecklistSummary,
  firstRunGuideKeyForRouteName,
  firstRunGuideState,
  firstRunGuideStateKeys,
  firstRunGuideSteps,
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
const LATER = '2026-11-08T10:00:00.000Z'
const LEGACY_SCOPE = 'v1|t:tenant-a|u:user-a'

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
  assert.equal(storage.calls.removeItem, 0)
  assert.equal(storage.map.size, 0)
})

test('v2 存储键包含 tenant 与 user，持久化内容不含 PII', () => {
  const storage = fakeStorage()
  const scope = firstRunScopeOf(principal())
  assert.equal(scope, 'v2|t:tenant-a|u:user-a')

  const key = firstRunStorageKey(scope)
  assert.ok(key.startsWith(FIRST_RUN_STORAGE_PREFIX))
  assert.ok(key.includes('v2|t:tenant-a|u:user-a'))

  writeFirstRunRecord(scope, createFirstRunRecord(), storage)
  const serialized = storage.map.get(key)
  assert.ok(serialized)
  for (const pii of ['张三', '租户甲', 'zhangsan', 'tenant-a', 'user-a', 'account-a']) {
    assert.equal(serialized.includes(pii), false, `记录里不应出现 ${pii}`)
  }
})

test('v2 记录结构：每个 guide 独立 tour/step/seenAt，tasks 只有 5 项', () => {
  const record = normalizeFirstRunRecord({
    ...createFirstRunRecord(),
    pii: '张三',
    extra: true,
    tasks: { ...createFirstRunRecord().tasks, unknown: true },
    guides: { ...createFirstRunRecord().guides, contract: { tour: 'done', step: 2, seenAt: AT, extra: 1 } },
  })
  assert.deepEqual(Object.keys(record).sort(), [...firstRunRecordKeys()].sort())
  assert.deepEqual(Object.keys(record.guides).sort(), [...FIRST_RUN_GUIDE_KEYS].sort())
  for (const guideKey of FIRST_RUN_GUIDE_KEYS) {
    assert.deepEqual(Object.keys(record.guides[guideKey]).sort(), [...firstRunGuideStateKeys()].sort())
  }
  assert.deepEqual(Object.keys(record.tasks).sort(), FIRST_RUN_TASKS.map((task) => task.key).sort())
  assert.equal(record.pii, undefined)
  assert.equal(record.tasks.unknown, undefined)
  assert.equal(record.v, FIRST_RUN_VERSION)
  assert.equal(record.guides.portal.tour, 'pending')
  assert.equal(record.guides.contract.tour, 'done')
  assert.equal(record.guides.contract.step, 2)
  assert.equal(record.guides.contract.extra, undefined)
})

test('旧 v1 记录自动迁移为 portal guide + tasks，并清理旧键', () => {
  const storage = fakeStorage()
  const scope = firstRunScopeOf(principal())
  const legacyKey = `${FIRST_RUN_STORAGE_PREFIX}|${LEGACY_SCOPE}`
  const legacy = {
    v: 1,
    tour: 'done',
    step: 3,
    tasks: { ...createFirstRunRecord().tasks, theme: true },
    seenAt: AT,
    doneAt: null,
    resetAt: null,
  }
  storage.setItem(legacyKey, JSON.stringify(legacy))
  // 迁移前只读也应识别旧键（不写盘）。
  const readOnly = readFirstRunRecord(scope, storage)
  assert.equal(readOnly.v, FIRST_RUN_VERSION)
  assert.equal(readOnly.guides.portal.tour, 'done')
  assert.equal(readOnly.guides.portal.step, 3)
  assert.equal(readOnly.guides.portal.seenAt, AT)
  assert.equal(storage.map.has(legacyKey), true, '只读不应删除旧键')

  const record = ensureFirstRunRecord(scope, storage)
  assert.equal(record.v, FIRST_RUN_VERSION)
  assert.equal(record.guides.portal.tour, 'done', '迁移保留门户终态，升级不强制重看门户')
  assert.equal(record.guides.portal.step, 3)
  assert.equal(record.guides.portal.seenAt, AT)
  assert.equal(record.tasks.theme, true)
  for (const guideKey of FIRST_RUN_GUIDE_KEYS.filter((key) => key !== FIRST_RUN_PORTAL_GUIDE)) {
    assert.equal(record.guides[guideKey].tour, 'pending', `${guideKey} 迁移后应从 pending 开始`)
  }
  // 迁移结果写回 v2 键并清理旧 v1 键。
  assert.equal(storage.map.has(legacyKey), false)
  assert.ok(storage.map.has(firstRunStorageKey(scope)))
  const reread = readFirstRunRecord(scope, storage)
  assert.equal(reread.v, FIRST_RUN_VERSION)
  assert.equal(reread.guides.portal.tour, 'done')
})

test('未来版本号变更时所有 guide 重看一次，清单进度保留', () => {
  const record = normalizeFirstRunRecord({
    v: FIRST_RUN_VERSION + 1,
    guides: {
      portal: { tour: 'done', step: 4, seenAt: AT },
      contract: { tour: 'skipped', step: 2, seenAt: AT },
    },
    tasks: { ...createFirstRunRecord().tasks, theme: true },
    doneAt: null,
    resetAt: null,
  })
  assert.equal(record.v, FIRST_RUN_VERSION)
  for (const guideKey of FIRST_RUN_GUIDE_KEYS) {
    assert.equal(record.guides[guideKey].tour, 'pending', `${guideKey} 应因版本变更回到 pending`)
  }
  assert.equal(record.tasks.theme, true)
})

test('guide 由 route.name 映射：门户/平台控制台/六个子系统', () => {
  const expected = {
    portal: 'portal',
    settings: 'platform',
    audit: 'platform',
    contract_management: 'contract',
    project_management: 'project',
    settlement: 'settlement',
    customer_opportunity: 'customer_opportunity',
    customer_portal: 'customer_portal',
    data_analysis: 'data_analysis',
  }
  for (const [routeName, guideKey] of Object.entries(expected)) {
    assert.equal(firstRunGuideKeyForRouteName(routeName), guideKey, routeName)
  }
  // 未登记路由（登录、错误页、CRM 辅助标签页）不触发导览。
  for (const routeName of ['login', 'forbidden', 'subsystem_access_error', 'customer_opportunity_tab_close', '']) {
    assert.equal(firstRunGuideKeyForRouteName(routeName), '')
  }
})

test('门户保留 5 步；每个子系统 guide 为 3 步且锚点统一', () => {
  assert.deepEqual(
    FIRST_RUN_TOUR_STEPS.map((step) => step.anchor),
    ['portal-header', 'subsystem-cards', 'theme-switcher', 'user-panel', 'checklist-entry'],
  )
  assert.equal(FIRST_RUN_HEADER_ANCHOR, 'portal-header')
  assert.deepEqual(
    FIRST_RUN_GUIDES.portal.steps.map((step) => step.anchor),
    ['portal-header', 'subsystem-cards', 'theme-switcher', 'user-panel', 'checklist-entry'],
  )
  const subsystemGuides = FIRST_RUN_GUIDE_KEYS.filter((key) => key !== FIRST_RUN_PORTAL_GUIDE)
  assert.deepEqual(subsystemGuides, [
    'platform', 'contract', 'project', 'settlement', 'customer_opportunity', 'customer_portal', 'data_analysis',
  ])
  for (const guideKey of subsystemGuides) {
    const steps = firstRunGuideSteps(guideKey)
    assert.equal(steps.length, 3, guideKey)
    assert.deepEqual(steps.map((step) => step.anchor), [
      FIRST_RUN_SUBSYSTEM_ANCHORS.nav,
      FIRST_RUN_SUBSYSTEM_ANCHORS.title,
      FIRST_RUN_SUBSYSTEM_ANCHORS.portal,
    ], guideKey)
    assert.ok(steps[0].title.includes(FIRST_RUN_GUIDES[guideKey].systemName), guideKey)
    assert.ok(steps[0].description.includes(FIRST_RUN_GUIDES[guideKey].systemName), guideKey)
  }
})

test('每个 guide 的 tour/step 独立：完成合同不影响平台控制台与门户', () => {
  let record = createFirstRunRecord()
  record = withTourStarted(record, 1, 'contract')
  assert.equal(firstRunGuideState(record, 'contract').tour, 'running')
  assert.equal(firstRunGuideState(record, 'contract').step, 1)
  assert.equal(firstRunGuideState(record, 'platform').tour, 'pending')
  assert.equal(firstRunGuideState(record, 'portal').tour, 'pending')

  record = withTourFinished(record, 'done', AT, 'contract')
  assert.equal(record.guides.contract.tour, 'done')
  assert.equal(record.guides.contract.seenAt, AT)
  assert.equal(record.guides.platform.tour, 'pending')
  assert.equal(record.guides.portal.tour, 'pending')

  record = withTourStarted(record, 2, 'platform')
  assert.equal(record.guides.platform.tour, 'running')
  assert.equal(firstRunGuideState(record, 'contract').tour, 'done', '平台导览不能覆盖合同终态')

  // 重看合同不影响平台控制台。
  record = withTourRestarted(record, 'contract')
  assert.equal(record.guides.contract.tour, 'pending')
  assert.equal(record.guides.contract.step, 0)
  assert.equal(record.guides.contract.seenAt, AT, '重看保留首次终态时间')
  assert.equal(record.guides.platform.tour, 'running')
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
  assert.equal(isFirstRunTaskVisible('audit', { permission_codes: ['*'] }), true)
  assert.equal(isFirstRunTaskVisible('audit', { permission_codes: null }), false)
})

test('完成任务：不可见任务不写、重复完成幂等、全部可见任务完成才写 doneAt', () => {
  const scope = firstRunScopeOf(principal())
  const storage = fakeStorage()
  let record = ensureFirstRunRecord(scope, storage)
  const plain = principal()

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

test('缺锚跳过按 guide 各自的步骤集计算', () => {
  // 门户：子系统卡片区缺锚 → 从主题切换继续。
  assert.equal(resolveNextTourStepIndex(1, (anchor) => anchor !== 'subsystem-cards'), 2)
  assert.equal(resolveNextTourStepIndex(0, () => false), -1)
  assert.equal(resolvePreviousTourStepIndex(3, (anchor) => anchor !== 'user-panel'), 2)

  // 合同 3 步：标题缺锚 → 从返回门户继续；返回门户也缺 → -1（收尾 done）。
  const contractSteps = firstRunGuideSteps('contract')
  assert.equal(resolveNextTourStepIndex(1, (anchor) => anchor !== 'subsystem-title', contractSteps), 2)
  assert.equal(resolveNextTourStepIndex(1, () => false, contractSteps), -1)
  assert.equal(resolvePreviousTourStepIndex(2, (anchor) => anchor !== 'subsystem-portal', contractSteps), 1)
  // 平台控制台使用同一套子系统锚点。
  assert.equal(resolveNextTourStepIndex(0, (anchor) => anchor === 'subsystem-nav', firstRunGuideSteps('platform')), 0)
})

test('自动启动条件：门户需要目录就绪；子系统/平台控制台只需会话与首步锚点', () => {
  const base = {
    routeName: 'portal',
    sessionReady: true,
    catalogReady: true,
    pageVisible: true,
    confirmDialogOpen: false,
    record: createFirstRunRecord(),
    firstAnchorAvailable: true,
  }
  assert.equal(shouldStartFirstRunTour(base), true)
  assert.equal(shouldStartFirstRunTour({ ...base, sessionReady: false }), false)
  assert.equal(shouldStartFirstRunTour({ ...base, catalogReady: false }), false, '门户仍要求目录 settled')
  assert.equal(shouldStartFirstRunTour({ ...base, pageVisible: false }), false)
  assert.equal(shouldStartFirstRunTour({ ...base, confirmDialogOpen: true }), false)
  assert.equal(shouldStartFirstRunTour({ ...base, firstAnchorAvailable: false }), false)
  // 兼容旧参数名 headerAnchorAvailable；显式 firstAnchorAvailable 优先。
  assert.equal(shouldStartFirstRunTour({ ...base, firstAnchorAvailable: undefined, headerAnchorAvailable: false }), false)
  assert.equal(shouldStartFirstRunTour({ ...base, record: withTourFinished(createFirstRunRecord(), 'done', AT) }), false)

  // 子系统：catalogReady 不参与；只看该 guide 是否 pending 与 nav 锚点。
  const contractBase = { ...base, routeName: 'contract_management', catalogReady: false }
  assert.equal(shouldStartFirstRunTour(contractBase), true)
  assert.equal(shouldStartFirstRunTour({ ...contractBase, firstAnchorAvailable: false }), false, 'nav 缺失不启动')
  assert.equal(shouldStartFirstRunTour({ ...contractBase, record: withTourFinished(createFirstRunRecord(), 'done', AT, 'contract') }), false)
  // 合同的终态不影响平台控制台。
  assert.equal(shouldStartFirstRunTour({
    ...base,
    routeName: 'settings',
    catalogReady: false,
    record: withTourFinished(createFirstRunRecord(), 'done', AT, 'contract'),
  }), true)
  // 平台控制台指南同样受 nav 锚点约束。
  assert.equal(shouldStartFirstRunTour({
    ...base,
    routeName: 'audit',
    catalogReady: false,
    firstAnchorAvailable: false,
  }), false)

  // running 是“上次被中断”的残留：不自动续播；只有 pending 才自动启动。
  assert.equal(shouldStartFirstRunTour({ ...contractBase, record: withTourStarted(createFirstRunRecord(), 1, 'contract') }), false)
  assert.equal(isFirstRunTourOpen(withTourStarted(createFirstRunRecord(), 1), 'portal'), false)
  assert.equal(isFirstRunTourOpen(createFirstRunRecord(), 'contract'), true)
  assert.equal(isFirstRunTourTerminal(withTourFinished(createFirstRunRecord(), 'done', AT), 'portal'), true)
})

test('跳过 / 完成都是终态：只写一次 seenAt，重看只回到指定 guide 的 pending', () => {
  let record = withTourStarted(createFirstRunRecord(), 2, 'project')
  assert.equal(firstRunGuideState(record, 'project').tour, 'running')
  assert.equal(firstRunGuideState(record, 'project').step, 2)

  record = withTourFinished(record, 'skipped', AT, 'project')
  assert.equal(firstRunGuideState(record, 'project').tour, 'skipped')
  assert.equal(firstRunGuideState(record, 'project').seenAt, AT)

  record = withTourFinished(record, 'done', LATER, 'project')
  assert.equal(firstRunGuideState(record, 'project').tour, 'done')
  assert.equal(firstRunGuideState(record, 'project').seenAt, AT, 'seenAt 是首次进入终态时间，不应被覆盖')

  record = withTourRestarted(record, 'project')
  assert.equal(firstRunGuideState(record, 'project').tour, 'pending')
  assert.equal(firstRunGuideState(record, 'project').step, 0)
  assert.equal(firstRunGuideState(record, 'project').seenAt, AT)
  assert.equal(firstRunGuideState(record, 'portal').tour, 'pending')
})

test('多标签合并：任务 OR、每个 guide 终态单调、重置更晚的一侧优先', () => {
  const base = createFirstRunRecord()
  const tabA = withFirstRunTaskCompleted(base, 'theme', principal(), AT)
  const tabB = withFirstRunTaskCompleted(base, 'userPanel', principal(), AT)
  const mergedTasks = mergeFirstRunRecords(tabA, tabB)
  assert.equal(mergedTasks.tasks.theme, true)
  assert.equal(mergedTasks.tasks.userPanel, true)
  assert.equal(mergedTasks.guides.portal.tour, 'pending')

  // 合同：done 不会被 running / skipped 覆盖。
  const contractDone = withTourFinished(withTourStarted(base, 2, 'contract'), 'done', AT, 'contract')
  const contractRunning = withTourStarted(base, 1, 'contract')
  const mergedContract = mergeFirstRunRecords(contractDone, contractRunning)
  assert.equal(mergedContract.guides.contract.tour, 'done')
  assert.equal(mergedContract.guides.contract.seenAt, AT)
  assert.equal(mergeFirstRunRecords(contractRunning, contractDone).guides.contract.tour, 'done')
  const contractSkipped = withTourFinished(base, 'skipped', AT, 'contract')
  assert.equal(mergeFirstRunRecords(contractSkipped, contractRunning).guides.contract.tour, 'skipped')

  // 平台控制台与合同互不影响。
  const withContract = mergeFirstRunRecords(base, contractDone)
  assert.equal(withContract.guides.platform.tour, 'pending')
  const withPlatform = withTourStarted(base, 1, 'platform')
  const mergedIndependent = mergeFirstRunRecords(withContract, withPlatform)
  assert.equal(mergedIndependent.guides.contract.tour, 'done')
  assert.equal(mergedIndependent.guides.platform.tour, 'running')
  assert.equal(mergedIndependent.guides.platform.step, 1)

  // 两侧都 running：步骤取更靠后的一个，不倒退。
  const contractStepOne = withTourStarted(base, 1, 'contract')
  const contractStepTwo = withTourStarted(base, 2, 'contract')
  assert.equal(mergeFirstRunRecords(contractStepOne, contractStepTwo).guides.contract.step, 2)

  // 一个标签页重置清单（更晚 resetAt）后，旧标签页的任务不能复活。
  const resetLater = withChecklistReset(
    withFirstRunTaskCompleted(base, 'theme', principal(), AT),
    LATER,
  )
  const mergedReset = mergeFirstRunRecords(
    withFirstRunTaskCompleted(base, 'theme', principal(), AT),
    resetLater,
  )
  assert.equal(mergedReset.tasks.theme, false)
  assert.equal(mergedReset.resetAt, LATER)
})

test('重置清单只清任务进度，不动任何 guide 终态', () => {
  const storage = fakeStorage()
  const scope = firstRunScopeOf(principal())
  let record = ensureFirstRunRecord(scope, storage)
  record = withTourFinished(withTourStarted(record, 0), 'done', AT)
  record = withTourFinished(withTourStarted(record, 1, 'contract'), 'skipped', AT, 'contract')
  record = withFirstRunTaskCompleted(record, 'theme', principal(), AT)
  record = withChecklistReset(record, LATER)

  assert.equal(record.tasks.theme, false)
  assert.equal(record.doneAt, null)
  assert.equal(record.resetAt, LATER)
  assert.equal(record.guides.portal.tour, 'done')
  assert.equal(record.guides.contract.tour, 'skipped')
})

test('非法存储内容按新记录收口，不抛错', () => {
  const storage = fakeStorage({ [`${FIRST_RUN_STORAGE_PREFIX}|v2|t:tenant-a|u:user-a`]: '{not-json' })
  const scope = firstRunScopeOf(principal())
  assert.equal(readFirstRunRecord(scope, storage), null)
  const record = ensureFirstRunRecord(scope, storage)
  assert.equal(record.v, FIRST_RUN_VERSION)
  assert.equal(record.guides.portal.tour, 'pending')
  for (const guideKey of FIRST_RUN_GUIDE_KEYS) {
    assert.equal(record.guides[guideKey].tour, 'pending')
  }
})
