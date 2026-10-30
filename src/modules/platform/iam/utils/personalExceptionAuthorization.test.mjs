import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPersonalExceptionPayload,
  buildPersonalExceptionView,
  createPersonalExceptionDraft,
  diffPersonalExceptionAssignments,
  formatPersonalExceptionTime,
  hasPersonalExceptionDraftChanges,
  resolvePersonalExceptionDraft,
  roleCodeOf,
  validatePersonalExceptionDraft,
} from './personalExceptionAuthorization.js'

const now = new Date('2026-10-20T00:00:00.000Z')
const from = '2030-01-02T03:04:05.123Z'
const until = '2031-02-03T04:05:06.789Z'
const catalog = {
  sync_status: 'SYNCED',
  policy: { max_effective_roles: 10 },
  roles: [
    { code: 'sales', name: '销售', status: 'ACTIVE', assignable: true },
    { code: 'audit', name: '审计', status: 'ACTIVE', assignable: true },
    { code: 'stopped', name: '停用角色', status: 'DISABLED', assignable: true },
    { code: 'new', name: '新角色', status: 'ACTIVE', assignable: true },
  ],
}
const environments = [{ code: 'prod', name: '生产环境' }, { code: 'test', name: '测试环境' }]
const access = {
  manual_roles_complete: true,
  manual_roles: [
    { code: 'sales', scope_type: 'ENVIRONMENT', environment_code: 'prod', valid_from: from, valid_until: until },
    { code: 'audit', scope_type: 'APPLICATION', valid_from: null, valid_until: null },
  ],
  inherited_roles: [
    { code: 'sales', source_type: 'POSITION', source_id: 'p1', scope_type: 'APPLICATION', valid_from: from, valid_until: until },
    { code: 'sales', source_type: 'ORG_UNIT', source_id: 'o1', scope_type: 'APPLICATION', valid_from: null, valid_until: null },
  ],
}

test('新增环境限时授权完整保留提交目标的环境和时间', () => {
  const result = buildPersonalExceptionPayload({
    snapshot: { access, catalog, environments }, catalog, now,
    operation: { type: 'create', values: {
      roleCode: 'new', scopeType: 'ENVIRONMENT', environmentCode: 'prod',
      validFrom: from, validUntil: until,
    } },
  })
  assert.deepEqual(result.roles.find((role) => role.role_code === 'new'), {
    role_code: 'new', scope_type: 'ENVIRONMENT', environment_code: 'prod',
    valid_from: from, valid_until: until,
  })
})

test('新增应用限时与修改环境限时均不能静默扩大成长期授权', () => {
  for (const operation of [
    { type: 'create', values: {
      roleCode: 'new', scopeType: 'APPLICATION', validFrom: from, validUntil: until,
    } },
    { type: 'update', targetRoleCode: 'sales', values: {
      roleCode: 'sales', scopeType: 'ENVIRONMENT', environmentCode: 'test',
      validFrom: from, validUntil: until,
    } },
  ]) {
    const result = buildPersonalExceptionPayload({
      snapshot: { access, catalog, environments }, operation, catalog, now,
    })
    const target = result.roles.find((role) => role.role_code === operation.values.roleCode)
    assert.equal(target.valid_from, from)
    assert.equal(target.valid_until, until)
    assert.equal(target.environment_code, operation.values.environmentCode ?? null)
    assert.deepEqual(result.roles.find((role) => role.role_code === 'audit'), {
      role_code: 'audit', scope_type: 'APPLICATION', environment_code: null,
      valid_from: null, valid_until: null,
    })
  }
})

test('默认新增草稿为指定时间、立即生效、结束必填；修改草稿保留原始毫秒时间', () => {
  const create = createPersonalExceptionDraft({ mode: 'create' })
  assert.equal(create.validityMode, 'RANGE')
  assert.equal(create.startMode, 'IMMEDIATE')
  assert.equal(create.validUntil, null)
  assert.deepEqual(create.initialRecords, [])

  const edit = createPersonalExceptionDraft({ mode: 'edit', group: { roleCode: 'sales', records: [
    { code: 'sales', scope_type: 'ENVIRONMENT', environment_code: 'prod', valid_from: from, valid_until: until },
  ] } })
  assert.equal(edit.validFrom, from)
  assert.equal(edit.validUntil, until)
  assert.equal(edit.validityMode, 'RANGE')
  assert.equal(edit.startMode, 'SPECIFIC')
  assert.match(edit.validFromInput, /^2030-01-02T/)
})

test('未触碰的开始/结束时间保留原始字符串，触碰后才用输入转换', () => {
  const draft = createPersonalExceptionDraft({ mode: 'edit', group: { records: [
    { code: 'sales', valid_from: from, valid_until: until },
  ] } })
  assert.equal(resolvePersonalExceptionDraft(draft).validFrom, from)
  assert.equal(resolvePersonalExceptionDraft(draft).validUntil, until)

  const touched = { ...draft, validFromTouched: true, validFromInput: '2030-02-03T04:05', validUntilTouched: true, validUntilInput: '2031-03-04T05:06' }
  const resolved = resolvePersonalExceptionDraft(touched)
  assert.equal(new Date(resolved.validFrom).getTime(), new Date('2030-02-03T04:05:00').getTime())
  assert.equal(new Date(resolved.validUntil).getTime(), new Date('2031-03-04T05:06:00').getTime())
})

test('列表按角色分组，区分重复、停用、到期和继承来源', () => {
  const view = buildPersonalExceptionView({
    access: {
      manual_roles_complete: true,
      manual_roles: [
        { code: 'sales', scope_type: 'APPLICATION', valid_from: null, valid_until: null },
        { code: 'sales', scope_type: 'ENVIRONMENT', environment_code: 'prod', valid_from: from, valid_until: until },
        { code: 'stopped', scope_type: 'APPLICATION', valid_from: null, valid_until: null },
        { code: 'audit', scope_type: 'APPLICATION', valid_from: '2020-01-01T00:00:00Z', valid_until: '2021-01-01T00:00:00Z' },
      ],
      inherited_roles: [
        { code: 'sales', source_type: 'POSITION', source_id: 'p1' },
        { code: 'sales', source_type: 'ORG_UNIT', source_id: 'o1' },
      ],
    },
    catalog,
    environments,
    now,
  })
  assert.equal(view.complete, true)
  assert.equal(view.counts.manualRecords, 4)
  assert.equal(view.counts.manualRoles, 3)
  assert.equal(view.counts.inheritedRoles, 1)
  assert.equal(view.counts.inheritedSources, 2)
  const sales = view.groups.find((group) => group.roleCode === 'sales')
  assert.equal(sales.records.length, 2)
  assert.equal(sales.duplicate, true)
  assert.equal(sales.status.code, 'ACTIVE')
  const audit = view.groups.find((group) => group.roleCode === 'audit')
  assert.equal(audit.status.code, 'EXPIRED')
  const stopped = view.groups.find((group) => group.roleCode === 'stopped')
  assert.equal(stopped.unavailable, true)
  assert.ok(view.anomalies.some((item) => item.type === 'DUPLICATE' && item.roleCode === 'sales'))
  assert.ok(view.anomalies.some((item) => item.type === 'UNAVAILABLE' && item.roleCode === 'stopped'))
  assert.equal(view.inheritedGroups[0].sources.length, 2)
})

test('缺少 manual_roles 完整性标志时不得进入可写空集合', () => {
  const view = buildPersonalExceptionView({ access: { manual_roles: [] }, catalog, now })
  assert.equal(view.complete, false)
  const draft = createPersonalExceptionDraft({ mode: 'create' })
  const result = validatePersonalExceptionDraft({ draft, snapshot: { access: { manual_roles: [] }, catalog, environments }, catalog, now })
  assert.ok(result.blockers.some((item) => item.includes('完整')))
  assert.throws(() => buildPersonalExceptionPayload({
    snapshot: { access: { manual_roles: [] }, catalog, environments },
    operation: { type: 'create', values: { roleCode: 'sales', scopeType: 'APPLICATION' } },
    catalog,
    now,
  }))
})

test('校验结束时间、环境和已有同角色', () => {
  const base = createPersonalExceptionDraft({ mode: 'create' })
  const missingEnd = validatePersonalExceptionDraft({ draft: { ...base, roleCode: 'sales', scopeType: 'APPLICATION' }, snapshot: { access, catalog, environments }, catalog, now })
  assert.equal(missingEnd.fieldErrors.validUntil, '指定有效期时必须填写结束时间。')

  const past = validatePersonalExceptionDraft({
    draft: { ...base, roleCode: 'sales', scopeType: 'APPLICATION', validUntil: '2020-01-01T00:00:00Z' },
    snapshot: { access, catalog, environments }, catalog, now,
  })
  assert.equal(past.fieldErrors.validUntil, '结束时间必须晚于当前时间。')

  const env = validatePersonalExceptionDraft({
    draft: { ...base, roleCode: 'sales', scopeType: 'ENVIRONMENT', environmentCode: 'nope', validUntil: until },
    snapshot: { access, catalog, environments }, catalog, now,
  })
  assert.equal(env.fieldErrors.environmentCode, '所选环境不在当前有效环境列表中。')

  const existing = validatePersonalExceptionDraft({
    draft: { ...base, roleCode: 'sales', scopeType: 'APPLICATION', validUntil: until },
    snapshot: { access, catalog, environments }, catalog, now,
  })
  assert.equal(existing.fieldErrors.roleCode, '该角色已有个人例外授权，请修改已有授权或统一调整历史记录。')
})

test('同角色继承只提示，不阻断合法个人例外', () => {
  const draft = createPersonalExceptionDraft({ mode: 'create' })
  const result = validatePersonalExceptionDraft({
    draft: { ...draft, roleCode: 'sales', scopeType: 'APPLICATION', validUntil: until },
    snapshot: { access: { ...access, manual_roles: [] }, catalog, environments }, catalog, now,
  })
  assert.ok(result.warnings.some((item) => item.includes('继承')))
  assert.equal(result.blockers.length, 0)
})

test('新增只改目标角色，其他记录原始时间与范围完全保留', () => {
  const draft = createPersonalExceptionDraft({ mode: 'create' })
  const values = { roleCode: 'new', scopeType: 'APPLICATION', environmentCode: null, validFrom: null, validUntil: until }
  const payload = buildPersonalExceptionPayload({
    snapshot: { access, catalog, environments },
    operation: { type: 'create', values },
    catalog,
    now,
  })
  const sales = payload.roles.find((role) => role.role_code === 'sales')
  assert.deepEqual(sales, { role_code: 'sales', scope_type: 'ENVIRONMENT', environment_code: 'prod', valid_from: from, valid_until: until })
  assert.equal(payload.roles.filter((role) => role.role_code === 'audit').length, 1)
  assert.deepEqual(payload.changes.added.map(roleCodeOf), ['new'])
})

test('修改只替换目标角色，其他角色不变', () => {
  const group = { records: access.manual_roles.filter((role) => role.code === 'sales') }
  const payload = buildPersonalExceptionPayload({
    snapshot: { access, catalog, environments },
    operation: {
      type: 'update', targetRoleCode: 'sales',
      values: { roleCode: 'sales', scopeType: 'APPLICATION', validFrom: null, validUntil: until },
    },
    catalog, now,
  })
  assert.equal(payload.roles.find((role) => role.role_code === 'sales').scope_type, 'APPLICATION')
  assert.equal(payload.roles.find((role) => role.role_code === 'audit').scope_type, 'APPLICATION')
})

test('同角色多条必须统一调整或整组撤销；不能单条覆盖', () => {
  const duplicateAccess = {
    ...access,
    manual_roles: [
      ...access.manual_roles,
      { code: 'sales', scope_type: 'APPLICATION', valid_from: null, valid_until: null },
    ],
  }
  assert.throws(() => buildPersonalExceptionPayload({
    snapshot: { access: duplicateAccess, catalog, environments },
    operation: { type: 'update', targetRoleCode: 'sales', values: { roleCode: 'sales', scopeType: 'APPLICATION', validUntil: until } },
    catalog, now,
  }), (error) => error.blockers.some((item) => item.includes('统一调整')))

  const normalized = buildPersonalExceptionPayload({
    snapshot: { access: duplicateAccess, catalog, environments },
    operation: { type: 'normalizeRole', targetRoleCode: 'sales', values: { roleCode: 'sales', scopeType: 'APPLICATION', validUntil: until } },
    catalog, now,
  })
  assert.equal(normalized.roles.filter((role) => role.role_code === 'sales').length, 1)

  const revoked = buildPersonalExceptionPayload({
    snapshot: { access: duplicateAccess, catalog, environments },
    operation: { type: 'revokeRole', targetRoleCode: 'sales' },
    catalog, now,
  })
  assert.equal(revoked.roles.some((role) => role.role_code === 'sales'), false)
})

test('显式清理停用角色后才可提交其他变更', () => {
  const withStopped = {
    ...access,
    manual_roles: [...access.manual_roles, { code: 'stopped', scope_type: 'APPLICATION', valid_from: null, valid_until: null }],
  }
  assert.throws(() => buildPersonalExceptionPayload({
    snapshot: { access: withStopped, catalog, environments },
    operation: { type: 'create', values: { roleCode: 'new', scopeType: 'APPLICATION', validUntil: until } },
    catalog, now,
  }), (error) => error.blockers.some((item) => item.includes('停用')))

  const cleaned = buildPersonalExceptionPayload({
    snapshot: { access: withStopped, catalog, environments },
    operation: { type: 'cleanup', cleanupRoleCodes: ['stopped'] },
    catalog, now,
  })
  assert.equal(cleaned.roles.some((role) => role.role_code === 'stopped'), false)
})

test('空个人例外但有继承时区分空态和继承来源', () => {
  const view = buildPersonalExceptionView({
    access: { manual_roles_complete: true, manual_roles: [], inherited_roles: [{ code: 'sales', source_type: 'POSITION', source_id: 'p1' }] },
    catalog, now,
  })
  assert.equal(view.hasManualRoles, false)
  assert.equal(view.counts.manualRecords, 0)
  assert.equal(view.counts.inheritedSources, 1)
  assert.equal(view.inheritedGroups[0].roleCode, 'sales')
})

test('已到期记录在保存前被阻断，不能原样带入新集合', () => {
  const expiredAccess = {
    ...access,
    manual_roles: [{ code: 'sales', scope_type: 'APPLICATION', valid_from: '2020-01-01T00:00:00Z', valid_until: '2021-01-01T00:00:00Z' }],
  }
  assert.throws(() => buildPersonalExceptionPayload({
    snapshot: { access: expiredAccess, catalog, environments },
    operation: { type: 'create', values: { roleCode: 'new', scopeType: 'APPLICATION', validUntil: until } },
    catalog, now,
  }), (error) => error.blockers.some((item) => item.includes('已到期')))

  const validation = validatePersonalExceptionDraft({
    draft: { ...createPersonalExceptionDraft({ mode: 'create' }), roleCode: 'new', scopeType: 'APPLICATION', validUntil: until },
    snapshot: { access: expiredAccess, catalog, environments }, catalog, now,
  })
  assert.ok(validation.blockers.some((item) => item.includes('已到期')))
})

test('差异摘要按角色区分新增、调整、移除和未变化', () => {
  const before = access.manual_roles
  const after = [
    before[0],
    { code: 'audit', scope_type: 'ENVIRONMENT', environment_code: 'test', valid_from: null, valid_until: null },
    { code: 'new', scope_type: 'APPLICATION', valid_from: null, valid_until: null },
  ]
  const diff = diffPersonalExceptionAssignments(before, after)
  assert.deepEqual(diff.added.map(roleCodeOf), ['new'])
  assert.deepEqual(diff.updated.map(roleCodeOf), ['audit'])
  assert.deepEqual(diff.removed, [])
})

test('草稿脏检查包含清理项和解析后的时间', () => {
  const initial = createPersonalExceptionDraft({ mode: 'create' })
  assert.equal(hasPersonalExceptionDraftChanges(initial, initial), false)
  assert.equal(hasPersonalExceptionDraftChanges(initial, { ...initial, cleanupRoleCodes: ['stopped'] }), true)
  assert.equal(hasPersonalExceptionDraftChanges(initial, { ...initial, roleCode: 'sales' }), true)
  assert.match(formatPersonalExceptionTime('2030-01-02T03:04:05Z'), /2030/)
})
