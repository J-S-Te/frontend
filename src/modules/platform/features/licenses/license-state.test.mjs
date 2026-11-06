import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildApplicationRows, enforcementSummaryFor, enforcementStateOf, licenseStateName, licenseStateOf, licenseSteps, nextActionFor, overallState, runtimeEnforcementInfo, runtimeEnforcementSourceLabel } from './license-state.js'
import { loadApplicationEnforcement, summarizeEnforcement } from './runtime-api.js'

const CHECKED_AT = '2026-10-27T05:54:38Z'
const FAR_FUTURE = 4102444800
const app = (code, status, extra = {}) => ({ code, status, kind: 'FULL', not_before: 100, expires_at: FAR_FUTURE, ...extra })
const licenseRow = (code, status, extra = {}) => ({ code, name: `名称-${code}`, application: app(code, status, extra), state: '旧标签', status, effectiveAt: 100 })
const summary = (overrides = {}) => ({
  available: true,
  registration: 'REGISTERED',
  status: 'PENDING_ENFORCEMENT',
  revision: 7,
  deploymentRevision: 42,
  memberCount: 1,
  ready: 1,
  acknowledged: 0,
  latestReadyAt: '2026-10-27T05:50:00Z',
  latestAckAt: '',
  activationStatus: 'READY',
  waitSeconds: 0,
  blockingReasons: [],
  allowedActions: [],
  checkedAt: CHECKED_AT,
  error: '',
  ...overrides,
})
// status 投影与 GET /licenses/status 的 deployment + 两个附加字段一致。
const statusOf = (overrides = {}) => ({
  initialized: true,
  clock_blocked: false,
  revision: 3,
  current_version: 3,
  highest_version: 3,
  environment: 'production',
  customer_id: 'customer-a',
  instance_id: 'instance-1',
  runtime_enforcement: 'NOT_CONNECTED',
  current: { version: 3, not_before: 100, expires_at: FAR_FUTURE, applications: [] },
  pending: null,
  ...overrides,
})
// GET /licenses/status 的 systems[].enforcement 聚合（契约字段为 snake_case）。
const aggregate = (overrides = {}) => ({
  available: true,
  registration: 'REGISTERED',
  status: 'ENFORCED',
  revision: 5,
  deployment_revision: 9,
  member_count: 2,
  ready_count: 2,
  ack_count: 2,
  latest_ready_at: '2026-10-27T05:50:00Z',
  latest_ack_at: '2026-10-27T05:51:00Z',
  snapshot_current: true,
  ...overrides,
})
// 聚合行：enforcement 为 undefined 表示旧后端没有该字段，null 表示服务端明确没有聚合。
const aggregateRow = (code, status, enforcement, extra = {}) => ({ ...licenseRow(code, status, extra), enforcement, reasonCode: extra.reason_code || '' })

test('许可层面六类状态使用服务端状态码，不做推断', () => {
  assert.equal(licenseStateName('VALID'), '已导入')
  assert.equal(licenseStateName('NOT_EFFECTIVE'), '待生效')
  assert.equal(licenseStateName('EXPIRED'), '已过期')
  assert.equal(licenseStateName('NO_LICENSE'), '未导入')
  assert.equal(licenseStateName('NOT_PURCHASED'), '未导入')
  assert.equal(licenseStateName('CLOCK_ABNORMAL'), '时钟异常')
  assert.equal(licenseStateName('VALIDATION_ERROR'), '校验异常')
  assert.equal(licenseStateName('FUTURE_CODE'), '状态未知')
  assert.equal(licenseStateOf('EXPIRED').tone, 'danger')
  assert.equal(licenseStateOf('VALID').tone, 'success')
  assert.equal(licenseStateOf('NOT_EFFECTIVE').tone, 'info')
})

test('运行执行层面只有服务端概览才能判定；缺失或读取失败一律是未知', () => {
  assert.equal(enforcementStateOf(null).label, '状态未知')
  assert.equal(enforcementStateOf(undefined).key, 'UNKNOWN')
  assert.equal(enforcementStateOf(summary({ available: false, error: '概览读取失败' })).key, 'UNKNOWN')
  assert.match(enforcementStateOf(summary({ available: false, error: '概览读取失败' })).note, /读取失败/)
  assert.match(enforcementStateOf(null).note, /尚未读取/)
  assert.equal(enforcementStateOf(summary()).label, '待激活')
  assert.equal(enforcementStateOf(summary({ status: 'APPLYING' })).label, '激活中')
  assert.equal(enforcementStateOf(summary({ status: 'ENFORCED' })).label, '已强制执行')
  assert.equal(enforcementStateOf(summary({ registration: 'UNREGISTERED', status: 'UNREGISTERED' })).label, '未纳管')
  assert.equal(enforcementStateOf(summary({ status: 'UNKNOWN' })).key, 'UNKNOWN')
  assert.doesNotMatch(enforcementStateOf(summary({ registration: 'UNREGISTERED', status: 'UNREGISTERED' })).label, /已强制执行/)
})

test('每个应用一行同时保留许可与执行两层事实，并只有一个主行动', () => {
  const rows = buildApplicationRows(
    [licenseRow('settlement', 'VALID'), licenseRow('contract_management', 'VALID')],
    { settlement: summary({ status: 'ENFORCED' }), contract_management: summary() },
    { canManage: true },
  )
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(row => row.code), ['settlement', 'contract_management'])
  const [enforced, pending] = rows
  assert.equal(enforced.license.label, '已导入')
  assert.equal(enforced.enforcement.label, '已强制执行')
  assert.equal(enforced.action.target, 'runtime')
  assert.equal(pending.enforcement.label, '待激活')
  assert.equal(pending.action.label, '去激活')
  assert.equal(pending.action.target, 'runtime')
  // 每个应用只给一个动作，没有并列按钮。
  assert.equal(typeof pending.action.label, 'string')
  assert.ok(!Array.isArray(pending.action))
})

test('行色调不把“未知/未纳管”渲染成正常，执行计数只在有执行事实时出现', () => {
  const [unknownRow, unregisteredRow, expiredRow, enforcedRow] = buildApplicationRows(
    [licenseRow('data_analysis', 'VALID'), licenseRow('customer_portal', 'VALID'), licenseRow('settlement', 'EXPIRED'), licenseRow('contract_management', 'VALID')],
    {
      data_analysis: summary({ available: false, error: '概览读取失败' }),
      customer_portal: summary({ registration: 'UNREGISTERED', status: 'UNREGISTERED', memberCount: 0, ready: 0, acknowledged: 0 }),
      settlement: summary({ status: 'ENFORCED' }),
      contract_management: summary({ status: 'ENFORCED' }),
    },
    { canManage: true },
  )
  assert.equal(unknownRow.tone, 'neutral', '概览读取失败不得着色成正常')
  assert.equal(unknownRow.showEnforcementCounters, false)
  assert.equal(unregisteredRow.tone, 'neutral', '未纳管不得着色成正常')
  assert.equal(unregisteredRow.showEnforcementCounters, false)
  assert.equal(expiredRow.tone, 'danger', '许可证过期优先报警')
  assert.equal(enforcedRow.tone, 'success')
  assert.equal(enforcedRow.showEnforcementCounters, true)
})

test('只读账号看到的是查看入口，不是激活入口', () => {
  const rows = buildApplicationRows([licenseRow('settlement', 'VALID')], { settlement: summary() }, { canManage: false })
  assert.equal(rows[0].action.label, '查看运行详情')
  assert.match(rows[0].action.hint, /管理权限/)
})

test('过期与待生效不展示成失败或已激活', () => {
  const expiredManager = nextActionFor({ license: licenseStateOf('EXPIRED'), enforcement: enforcementStateOf(null) }, { canManage: true })
  assert.equal(expiredManager.label, '重新导入')
  assert.equal(expiredManager.target, 'import')
  const expiredReader = nextActionFor({ license: licenseStateOf('EXPIRED'), enforcement: enforcementStateOf(null) }, { canManage: false })
  assert.equal(expiredReader.target, 'none')
  assert.match(expiredReader.hint, /授权管理员/)
  const waiting = nextActionFor({ license: licenseStateOf('NOT_EFFECTIVE'), enforcement: enforcementStateOf(null) }, { hasPending: true })
  assert.equal(waiting.label, '等待生效日')
  assert.equal(waiting.target, 'pending')
  assert.doesNotMatch(waiting.label, /失败|已激活/)
  assert.equal(nextActionFor({ license: licenseStateOf('CLOCK_ABNORMAL'), enforcement: enforcementStateOf(null) }).target, 'none')
})

test('未初始化、时钟保护、未导入的总体状态各有唯一主行动', () => {
  const notInitialized = overallState({ status: statusOf({ initialized: false, current: null }), appRows: [] })
  assert.equal(notInitialized.key, 'NOT_INITIALIZED')
  assert.equal(notInitialized.action.target, 'init')

  const blocked = overallState({ status: statusOf({ clock_blocked: true }), appRows: [] })
  assert.equal(blocked.key, 'CLOCK_BLOCKED')
  assert.equal(blocked.tone, 'danger')
  assert.equal(blocked.action.target, 'none')

  const empty = overallState({ status: statusOf({ current: null }), appRows: [], canManage: true })
  assert.equal(empty.key, 'NO_LICENSE')
  assert.equal(empty.action.target, 'import')
  // 只读账号不提供导入入口，改为可执行的指引。
  assert.equal(overallState({ status: statusOf({ current: null }), appRows: [], canManage: false }).action.target, 'none')
  assert.match(overallState({ status: statusOf({ current: null }), appRows: [], canManage: false }).action.label, /管理权限/)
  // 许可证没有覆盖任何系统时不能显示成“待激活”。
  const noSystems = overallState({ status: statusOf(), appRows: [], canManage: true })
  assert.equal(noSystems.key, 'NO_SYSTEMS')
  assert.equal(noSystems.action.target, 'import')
})

test('只有待生效许可证时提示等待生效日，而不是提示导入失败', () => {
  const waitingOnly = overallState({ status: statusOf({ current: null, pending: { version: 4, not_before: 4102444800 } }), appRows: [] })
  assert.equal(waitingOnly.key, 'PENDING_ONLY')
  assert.equal(waitingOnly.action.target, 'pending')
  assert.doesNotMatch(waitingOnly.description, /失败/)
  assert.equal(waitingOnly.tone, 'info')
})

test('导入后总体状态区分待激活、激活中与已强制执行', () => {
  const pending = overallState({ status: statusOf(), appRows: buildApplicationRows([licenseRow('settlement', 'VALID')], { settlement: summary() }, { canManage: true }), canManage: true })
  assert.equal(pending.key, 'PENDING_ACTIVATION')
  assert.equal(pending.action.label, '去激活')
  assert.equal(pending.step, 3)

  const applying = overallState({ status: statusOf(), appRows: buildApplicationRows([licenseRow('settlement', 'VALID')], { settlement: summary({ status: 'APPLYING' }) }), canManage: true })
  assert.equal(applying.key, 'APPLYING')
  assert.equal(applying.action.label, '查看激活进度')

  const enforced = overallState({ status: statusOf(), appRows: buildApplicationRows([licenseRow('settlement', 'VALID')], { settlement: summary({ status: 'ENFORCED' }) }), canManage: true })
  assert.equal(enforced.key, 'ENFORCED')
  assert.equal(enforced.tone, 'success')
  assert.equal(enforced.action.target, 'runtime')
})

test('没有逐应用概览时绝不宣称已强制执行或待激活', () => {
  const unknown = overallState({ status: statusOf(), appRows: buildApplicationRows([licenseRow('settlement', 'VALID')], {}), canManage: true })
  assert.equal(unknown.key, 'IN_PROGRESS')
  assert.notEqual(unknown.key, 'ENFORCED')
  assert.match(unknown.description, /状态未知 1/)
  assert.match(unknown.action.hint, /运行执行状态/)

  const expired = overallState({ status: statusOf(), appRows: buildApplicationRows([licenseRow('settlement', 'EXPIRED')], {}), canManage: true })
  assert.equal(expired.key, 'EXPIRED')
  assert.equal(expired.action.label, '导入续期许可证')

  const waiting = overallState({ status: statusOf(), appRows: buildApplicationRows([licenseRow('settlement', 'NOT_EFFECTIVE')], {}), canManage: true })
  assert.equal(waiting.key, 'PENDING_EFFECTIVE')
  assert.equal(waiting.tone, 'info')
})

test('步骤条按 导入 → 生效 → 激活 → 强制执行 递进，只标记一个当前步骤', () => {
  const steps = licenseSteps({ status: statusOf(), appRows: buildApplicationRows([licenseRow('settlement', 'VALID')], { settlement: summary() }), canManage: true })
  assert.deepEqual(steps.map(step => step.key), ['import', 'effective', 'activate', 'enforced'])
  assert.deepEqual(steps.map(step => step.state), ['done', 'done', 'current', 'todo'])

  const done = licenseSteps({ status: statusOf(), appRows: buildApplicationRows([licenseRow('settlement', 'VALID')], { settlement: summary({ status: 'ENFORCED' }) }) })
  assert.deepEqual(done.map(step => step.state), ['done', 'done', 'done', 'done'])
  assert.equal(done.filter(step => step.state === 'current').length, 0)

  const fresh = licenseSteps({ status: statusOf({ current: null }), appRows: [] })
  assert.equal(fresh[0].state, 'current')
  assert.equal(fresh.filter(step => step.state === 'current').length, 1)
})

test('概览汇总给出修订、准备与确认计数以及最近确认时间', () => {
  const members = [
    { service_id: 'a', ready_at: '2026-10-27T05:50:00Z', ready_fresh: true, ack_current: true, issued_revision: 7, ack_revision: 7, ack_at: '2026-10-27T05:51:00Z' },
    { service_id: 'b', ready_at: null, ready_fresh: false, ack_current: false, issued_revision: 7, ack_revision: 0, ack_at: '0001-01-01T00:00:00Z' },
  ]
  const result = summarizeEnforcement({
    application: 'settlement',
    environment: 'prod',
    license: { status: 'VALID', revision: 3, version: 1, not_before: 0, expires_at: FAR_FUTURE },
    runtime: { status: 'UNKNOWN', available: false, checked_at: CHECKED_AT },
    registration: { status: 'REGISTERED', member_count: 2, catalog_version: 1 },
    enforcement: { status: 'APPLYING', revision: 7, deployment_revision: 42, snapshot_current: true, members },
    activation: { can_activate: false, status: 'APPLYING', total_count: 2, ready_count: 1, acknowledged_count: 1, waiting_service_ids: ['b'], waiting_since: null, wait_seconds: 30, blocking_reasons: [] },
    blocking_reasons: ['RUNTIME_ACK_STALE'],
    allowed_actions: [],
    checked_at: CHECKED_AT,
  })
  assert.equal(result.available, true)
  assert.equal(result.status, 'APPLYING')
  assert.equal(result.revision, 7)
  assert.equal(result.deploymentRevision, 42)
  assert.equal(result.memberCount, 2)
  assert.equal(result.ready, 1)
  assert.equal(result.acknowledged, 1)
  assert.equal(result.latestReadyAt, '2026-10-27T05:50:00Z')
  assert.equal(result.latestAckAt, '2026-10-27T05:51:00Z', 'Go 零值时间不算确认时间')
  assert.deepEqual(result.blockingReasons, ['RUNTIME_ACK_STALE'])
  assert.equal(result.checkedAt, CHECKED_AT)
})

test('逐应用概览读取失败只影响该应用，不抛出也不伪造成功', async () => {
  const requested = []
  const result = await loadApplicationEnforcement(['settlement', 'contract_management'], {
    fetchOverview: async application => {
      requested.push(application)
      if (application === 'contract_management') throw Object.assign(new Error('概览读取超时'), { status: 504, code: 'TIMEOUT' })
      return {
        application,
        environment: 'prod',
        license: { status: 'VALID', revision: 3, version: 1, not_before: 0, expires_at: FAR_FUTURE },
        runtime: { status: 'RUNNING', available: true, checked_at: CHECKED_AT },
        registration: { status: 'REGISTERED', member_count: 1, catalog_version: 1 },
        enforcement: { status: 'ENFORCED', revision: 9, deployment_revision: 42, snapshot_current: true, members: [{ service_id: 'api', ready_at: CHECKED_AT, ready_fresh: true, ack_current: true, issued_revision: 9, ack_revision: 9, ack_at: CHECKED_AT }] },
        preparation_operation: null,
        blocking_reasons: [],
        allowed_actions: [],
        checked_at: CHECKED_AT,
      }
    },
  })
  assert.deepEqual(requested.sort(), ['contract_management', 'settlement'])
  assert.equal(result.settlement.available, true)
  assert.equal(result.settlement.status, 'ENFORCED')
  assert.equal(result.contract_management.available, false)
  assert.equal(result.contract_management.status, 'UNKNOWN')
  assert.ok(result.contract_management.error)
  assert.equal(enforcementStateOf(result.contract_management).key, 'UNKNOWN')
})

// ---- 聚合 enforcement：systems[].enforcement 优先，逐应用概览只做旧后端回退 ----

test('聚合 enforcement 优先于逐应用概览，不再依赖 N+1 结果', () => {
  const [row] = buildApplicationRows(
    [aggregateRow('settlement', 'VALID', aggregate())],
    { settlement: summary({ status: 'PENDING_ENFORCEMENT', revision: 1, memberCount: 1 }) },
    { canManage: true },
  )
  assert.equal(row.enforcement.label, '已强制执行', '聚合说已执行时不能被逐应用概览的待激活覆盖')
  assert.equal(row.summary.revision, 5)
  assert.equal(row.summary.deploymentRevision, 9)
  assert.equal(row.summary.memberCount, 2)
  assert.equal(row.summary.ready, 2)
  assert.equal(row.summary.acknowledged, 2)
  assert.equal(row.summary.latestAckAt, '2026-10-27T05:51:00Z')
  assert.equal(row.showEnforcementCounters, true)
  assert.equal(row.action.target, 'runtime')
  // enforcementSummaryFor 自身也不该看逐应用概览。
  assert.equal(enforcementSummaryFor(aggregateRow('settlement', 'VALID', aggregate()), { settlement: summary() }).status, 'ENFORCED')
})

test('只有字段整个缺失（旧后端）时才回退到逐应用概览', () => {
  const legacy = [licenseRow('settlement', 'VALID')]
  assert.equal(legacy[0].enforcement, undefined, '缺少聚合字段时必须是 undefined，不能补成 null')
  const [fallback] = buildApplicationRows(legacy, { settlement: summary({ status: 'APPLYING' }) })
  assert.equal(fallback.enforcement.label, '激活中')
  assert.equal(fallback.summary.revision, 7)
  // 概览也没读到：只能状态未知。
  const [unknown] = buildApplicationRows(legacy, {})
  assert.equal(unknown.enforcement.key, 'UNKNOWN')
  assert.equal(unknown.showEnforcementCounters, false)
})

test('enforcement 为 null 或 available:false 时显示状态未知，不回退也不伪造', () => {
  const [nullRow, offRow, brokenRow] = buildApplicationRows(
    [
      aggregateRow('settlement', 'VALID', null),
      aggregateRow('contract_management', 'VALID', aggregate({ available: false })),
      aggregateRow('data_analysis', 'VALID', 'unexpected'),
    ],
    {
      settlement: summary({ status: 'ENFORCED' }),
      contract_management: summary({ status: 'ENFORCED' }),
      data_analysis: summary({ status: 'ENFORCED' }),
    },
    { canManage: true },
  )
  for (const row of [nullRow, offRow, brokenRow]) {
    assert.equal(row.enforcement.key, 'UNKNOWN')
    assert.equal(row.enforcement.label, '状态未知')
    assert.equal(row.enforcement.tone, 'neutral')
    assert.equal(row.showEnforcementCounters, false)
    assert.equal(row.summary.memberCount, 0)
    assert.equal(row.tone, 'neutral', '未知不得着色成正常')
    assert.doesNotMatch(row.enforcement.label, /已强制执行|待激活|未纳管/)
  }
  assert.match(nullRow.enforcement.note, /未提供/)
  assert.match(offRow.enforcement.note, /不可用/)
  // 全部未知时总体结论也不能变成已强制执行。
  const overall = overallState({ status: statusOf(), appRows: [nullRow, offRow, brokenRow], canManage: true })
  assert.equal(overall.key, 'IN_PROGRESS')
  assert.match(overall.description, /状态未知 3/)
})

test('聚合字段缺项按未知处理，不猜执行状态', () => {
  const [row] = buildApplicationRows(
    [aggregateRow('settlement', 'VALID', { available: true, registration: 'REGISTERED' })],
    {},
    { canManage: true },
  )
  assert.equal(row.enforcement.key, 'UNKNOWN')
  assert.equal(row.summary.status, 'UNKNOWN')
  assert.equal(row.summary.memberCount, 0)
  assert.equal(row.showEnforcementCounters, false)
  // 非法枚举同样收敛成未知。
  const [bad] = buildApplicationRows([aggregateRow('settlement', 'VALID', aggregate({ status: 'SOMETHING_NEW' }))], {}, { canManage: true })
  assert.equal(bad.enforcement.key, 'UNKNOWN')
})

test('runtime_enforcement 只认契约枚举，旧值 NOT_CONNECTED 按不可用处理', () => {
  assert.equal(runtimeEnforcementInfo('AVAILABLE').key, 'AVAILABLE')
  assert.equal(runtimeEnforcementInfo('AVAILABLE').notice, '', '聚合可用时不得再提示“未接入”')
  assert.doesNotMatch(runtimeEnforcementInfo('AVAILABLE').notice, /未接入|未提供/)
  assert.equal(runtimeEnforcementInfo('UNAVAILABLE').key, 'UNAVAILABLE')
  assert.match(runtimeEnforcementInfo('UNAVAILABLE').notice, /后端未提供运行执行聚合/)
  assert.match(runtimeEnforcementInfo('UNAVAILABLE').notice, /逐应用概览/)
  // 兼容：旧后端仍返回 NOT_CONNECTED，行为与 UNAVAILABLE 完全一致。
  assert.deepEqual(runtimeEnforcementInfo('NOT_CONNECTED'), runtimeEnforcementInfo('UNAVAILABLE'))
  // 字段缺失或未知取值都不能宣称聚合可用。
  assert.equal(runtimeEnforcementInfo(undefined).key, 'UNKNOWN')
  assert.ok(runtimeEnforcementInfo(undefined).notice)
  assert.equal(runtimeEnforcementInfo('AVAILABLE_MAYBE').key, 'UNKNOWN')
})

// ---- reason_code：只让主行动更具体，不改变状态分类与颜色 ----

const reasonRow = (code, status, reasonCode, options) => buildApplicationRows(
  [{ ...licenseRow(code, status), reasonCode }],
  {},
  options,
)[0]

test('reason_code 给出更具体的主行动，但不改变状态分类与颜色', () => {
  // 时钟异常：管理员得到恢复入口，只读账号只看指引。
  const clockAdmin = reasonRow('settlement', 'CLOCK_ABNORMAL', 'CLOCK_ABNORMAL', { canManage: true })
  assert.equal(clockAdmin.license.label, licenseStateOf('CLOCK_ABNORMAL').label)
  assert.equal(clockAdmin.license.tone, licenseStateOf('CLOCK_ABNORMAL').tone)
  assert.equal(clockAdmin.action.label, '恢复时钟')
  assert.equal(clockAdmin.action.target, 'clock')
  assert.match(clockAdmin.action.hint, /恢复凭据/)
  const clockReader = reasonRow('settlement', 'CLOCK_ABNORMAL', 'CLOCK_ABNORMAL', { canManage: false })
  assert.equal(clockReader.action.target, 'none')
  assert.match(clockReader.action.label, /联系授权管理员/)
  // 旧后端没有 reason_code 时，时钟保护的管理员入口仍然在。
  const clockLegacy = reasonRow('settlement', 'CLOCK_ABNORMAL', '', { canManage: true })
  assert.equal(clockLegacy.action.target, 'clock')

  // 状态校验失败：不可点，指向管理员核查。
  const invalid = reasonRow('customer_portal', 'VALIDATION_ERROR', 'STATE_INVALID', { canManage: true })
  assert.equal(invalid.license.label, licenseStateOf('VALIDATION_ERROR').label)
  assert.equal(invalid.action.target, 'none')
  assert.match(invalid.action.label, /联系授权管理员/)
  assert.match(invalid.action.hint, /完整性校验/)

  // 已过期：管理员可重新导入，只读账号得到续期指引。
  const expiredAdmin = reasonRow('settlement', 'EXPIRED', 'EXPIRED', { canManage: true })
  assert.equal(expiredAdmin.action.label, '重新导入')
  assert.equal(expiredAdmin.action.target, 'import')
  const expiredReader = reasonRow('settlement', 'EXPIRED', 'EXPIRED', { canManage: false })
  assert.equal(expiredReader.action.target, 'none')
  assert.match(expiredReader.action.hint, /授权管理员/)

  // 待生效：等待生效日，可跳到待生效卡片。
  const waiting = reasonRow('settlement', 'NOT_EFFECTIVE', 'NOT_EFFECTIVE', { canManage: true, hasPending: true })
  assert.equal(waiting.action.label, '等待生效日')
  assert.equal(waiting.action.target, 'pending')
})

test('reason_code 与许可状态不同族时不采纳，避免页面自相矛盾', () => {
  const row = reasonRow('settlement', 'VALID', 'EXPIRED', { canManage: true })
  assert.equal(row.license.label, '已导入')
  assert.equal(row.action.target, 'runtime')
  assert.doesNotMatch(row.action.label, /重新导入/)
  // 未知原因码不产生任何指引。
  const unknownReason = reasonRow('settlement', 'VALID', 'SOMETHING_ELSE', { canManage: true })
  assert.equal(unknownReason.action.target, 'runtime')
})

test('时钟保护时总体状态把主行动交给恢复入口或联系管理员', () => {
  const manager = overallState({ status: statusOf({ clock_blocked: true }), appRows: [], canManage: true })
  assert.equal(manager.key, 'CLOCK_BLOCKED')
  assert.equal(manager.tone, 'danger', '分类与颜色语义不变')
  assert.equal(manager.label, '时钟保护中')
  assert.equal(manager.action.target, 'clock')
  assert.equal(manager.action.label, '恢复时钟')
  const reader = overallState({ status: statusOf({ clock_blocked: true }), appRows: [], canManage: false })
  assert.equal(reader.action.target, 'none')
  assert.match(reader.action.label, /联系授权管理员/)
})

test('聚合来源只把已知枚举翻成中文短语，未知值不猜', () => {
  assert.equal(runtimeEnforcementSourceLabel('per_application_coordination'), '逐应用协调')
  assert.equal(runtimeEnforcementSourceLabel(''), '')
  assert.equal(runtimeEnforcementSourceLabel(undefined), '')
  assert.equal(runtimeEnforcementSourceLabel('SOMETHING_NEW'), '', '未知来源不拼进界面')
})
