import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUserAuthorizationOverview } from './userAuthorizationOverview.js'
import {
  applicationRoleSummary,
  applicationStatusOf,
  authorizationDraftFingerprint,
  authorizationSummary,
  defaultExpandedAuthorizationApplications,
  isAuthorizationDraftDirty,
  roleScopeText,
  roleSourceLabel,
  roleValidityText,
  sortAuthorizationApplications,
  sourceNameOf,
} from './effectiveAuthorizationOverview.js'

test('buildUserAuthorizationOverview preserves application rows, role provenance and effective roles', () => {
  const overview = buildUserAuthorizationOverview([
    {
      application: { code: 'contract_management', name: '合同管理系统' },
      access: {
        authorization_state: 'GRANTED',
        roles: [
          { code: 'sales', source_type: 'USER', grant_origin: 'MANUAL' },
          { code: 'sales_director', source_type: 'POSITION', grant_origin: 'TEMPLATE', source_name: '销售总监' },
        ],
        conflicts: [],
      },
    },
    {
      application: { code: 'platform', name: '基础平台' },
      access: {
        authorization_state: 'GRANTED',
        roles: [{ code: 'platform-user', source_type: 'USER', grant_origin: 'SYSTEM' }],
        conflicts: [],
      },
    },
  ])

  assert.deepEqual(overview.applications.map((row) => [row.application_code, row.authorization_state, row.effective_role_count]), [
    ['contract_management', 'GRANTED', 2],
    ['platform', 'GRANTED', 1],
  ])
  assert.deepEqual(overview.roles.map((role) => [role.application_code, role.code, role.grant_origin]), [
    ['contract_management', 'sales', 'MANUAL'],
    ['contract_management', 'sales_director', 'TEMPLATE'],
    ['platform', 'platform-user', 'SYSTEM'],
  ])
  assert.deepEqual(overview.effective_roles.map((role) => role.code), ['sales', 'sales_director', 'platform-user'])
  assert.deepEqual(overview.conflicts, [])
})

test('same role from multiple sources is one effective role but all sources are retained', () => {
  const overview = buildUserAuthorizationOverview([{
    application: { code: 'contract_management', name: '合同管理系统' },
    access: {
      authorization_state: 'GRANTED',
      roles: [
        { role_id: 'role-1', code: 'admin', name: '合同管理员', source_type: 'USER', grant_origin: 'MANUAL', scope_type: 'TENANT', environment_code: 'prod', valid_from: '2026-01-01T00:00:00Z' },
        { role_id: 'role-1', code: 'admin', name: '合同管理员', source_type: 'POSITION', grant_origin: 'TEMPLATE', source_name: '合同管理岗', scope_type: 'ENVIRONMENT', environment_code: 'dev', valid_until: '2027-01-01T00:00:00Z' },
      ],
      conflicts: [],
    },
  }])

  const row = overview.applications[0]
  assert.equal(row.effective_role_count, 1)
  assert.equal(row.role_groups.length, 1)
  assert.equal(row.role_groups[0].sources.length, 2)
  assert.equal(row.role_groups[0].sources[0].environment_code, 'prod')
  assert.equal(row.role_groups[0].sources[1].environment_code, 'dev')
})

test('same role code in different applications is counted separately', () => {
  const overview = buildUserAuthorizationOverview([
    { application: { code: 'a' }, access: { authorization_state: 'GRANTED', roles: [{ code: 'admin' }], conflicts: [] } },
    { application: { code: 'b' }, access: { authorization_state: 'GRANTED', roles: [{ code: 'admin' }], conflicts: [] } },
  ])
  assert.equal(overview.applications[0].effective_role_count, 1)
  assert.equal(overview.applications[1].effective_role_count, 1)
  assert.equal(authorizationSummary(overview.applications).effectiveRoles, 2)
})

test('conflict, read failure and unknown state never enter effective statistics', () => {
  const overview = buildUserAuthorizationOverview([
    { application: { code: 'conflict' }, access: { authorization_state: 'CONFLICT', roles: [{ code: 'admin' }], conflicts: ['角色来源过多'] } },
    { application: { code: 'failed' }, error: '网络错误' },
    { application: { code: 'unknown' }, access: { roles: [{ code: 'admin' }], conflicts: [] } },
    { application: { code: 'none' }, access: { authorization_state: 'UNAUTHORIZED', roles: [], conflicts: [] } },
  ])
  assert.deepEqual(overview.applications.map((row) => row.effective_role_count), [0, 0, 0, 0])
  assert.equal(overview.effective_roles.length, 0)
  assert.equal(overview.applications[1].read_status, 'ERROR')
  assert.equal(applicationStatusOf(overview.applications[0]).label, '授权冲突')
  assert.equal(applicationStatusOf(overview.applications[1]).label, '读取失败')
  assert.equal(applicationStatusOf(overview.applications[2]).label, '状态待确认')
})

test('backend-confirmed grant without ordinary role details is not treated as unauthorized', () => {
  const overview = buildUserAuthorizationOverview([{
    application: { code: 'contract_management' },
    access: { authorization_state: 'GRANTED', roles: [], conflicts: [] },
  }])
  const row = overview.applications[0]
  assert.equal(applicationStatusOf(row).key, 'GRANTED')
  assert.equal(applicationRoleSummary(row), '后端确认已授权，未返回角色明细')
})

test('partial failure keeps the failed application row and marks the summary incomplete', () => {
  const overview = buildUserAuthorizationOverview([
    { application: { code: 'a', name: '应用 A' }, access: { authorization_state: 'GRANTED', roles: [{ code: 'admin' }], conflicts: [] } },
    { application: { code: 'b', name: '应用 B' }, error: '读取失败' },
  ])
  const summary = authorizationSummary(overview.applications)
  assert.equal(overview.applications.length, 2)
  assert.equal(summary.incomplete, true)
  assert.equal(summary.grantedApplications, 1)
  assert.match(summary.text, /1 个应用有授权/)
  assert.match(summary.text, /1 个应用读取失败/)
  assert.equal(summary.contextText, '基于已读取 1 个应用')
})

test('applications sort conflict, failure, unknown, granted, unauthorized with stable order', () => {
  const rows = [
    { application_code: 'granted', authorization_state: 'GRANTED', read_status: 'SUCCESS', application_order: 4 },
    { application_code: 'unauthorized', authorization_state: 'UNAUTHORIZED', read_status: 'SUCCESS', application_order: 5 },
    { application_code: 'failed', authorization_state: 'UNKNOWN', read_status: 'ERROR', application_order: 2 },
    { application_code: 'unknown', authorization_state: 'UNKNOWN', read_status: 'SUCCESS', application_order: 3 },
    { application_code: 'conflict', authorization_state: 'CONFLICT', read_status: 'SUCCESS', application_order: 1 },
  ]
  assert.deepEqual(sortAuthorizationApplications(rows).map((row) => row.application_code), [
    'conflict', 'failed', 'unknown', 'granted', 'unauthorized',
  ])
})

test('role summary truncates after two names and conflict rows expose their own conflict', () => {
  const conflict = buildUserAuthorizationOverview([{
    application: { code: 'contract_management', name: '合同管理系统' },
    access: { authorization_state: 'CONFLICT', roles: [{ code: 'admin', name: '管理员' }], conflicts: ['角色来源过多'] },
  }]).applications[0]
  assert.equal(applicationRoleSummary(conflict), '存在角色冲突')
  assert.deepEqual(defaultExpandedAuthorizationApplications([conflict, { application_code: 'ok', authorization_state: 'GRANTED' }]), ['contract_management'])

  const granted = buildUserAuthorizationOverview([{
    application: { code: 'project_management' },
    access: { authorization_state: 'GRANTED', roles: [
      { code: 'pm', name: '项目经理' },
      { code: 'member', name: '项目成员' },
      { code: 'viewer', name: '只读成员' },
    ], conflicts: [] },
  }]).applications[0]
  assert.equal(applicationRoleSummary(granted), '项目经理、项目成员 另 1 个')
})

test('source name does not leak source id into the primary label', () => {
  assert.equal(sourceNameOf({ source_id: 'source-1' }), '接口未提供')
  assert.equal(sourceNameOf({ source_name: '合同管理岗', source_id: 'source-1' }), '合同管理岗')
})

test('role source labels, scope and validity do not infer missing fields', () => {
  assert.equal(roleSourceLabel({ source_type: 'USER', grant_origin: 'MANUAL' }), '个人例外')
  assert.equal(roleSourceLabel({ source_type: 'ORG_UNIT' }), '组织继承')
  assert.equal(roleSourceLabel({ source_type: 'POSITION' }), '岗位模板')
  assert.equal(roleSourceLabel({ source_type: 'USER', grant_origin: 'SYSTEM' }), '系统来源')
  assert.equal(roleSourceLabel({ source_type: 'CUSTOM' }), '其他来源')
  assert.equal(roleScopeText({ scope_type: 'ENVIRONMENT', environment_code: 'prod' }), '指定环境：prod')
  assert.equal(roleScopeText({}), '接口未提供')
  assert.equal(roleValidityText({}), '接口未提供')
  assert.equal(roleValidityText({ valid_from: null, valid_until: null }), '长期有效')
  assert.match(roleValidityText({ valid_from: '2026-01-01T00:00:00Z' }), /2026/)
})

test('authorization draft dirty guard ignores role order but detects edits', () => {
  const draft = { role_codes: ['b', 'a'], scope_type: 'APPLICATION', environment_code: '', validity_mode: 'PERMANENT', valid_from: '', valid_until: '', apply_to_existing: false }
  const baseline = authorizationDraftFingerprint(draft)
  assert.equal(isAuthorizationDraftDirty(baseline, { ...draft, role_codes: ['a', 'b'] }), false)
  assert.equal(isAuthorizationDraftDirty(baseline, { ...draft, role_codes: ['a'] }), true)
  assert.equal(isAuthorizationDraftDirty('', draft), false)
})
