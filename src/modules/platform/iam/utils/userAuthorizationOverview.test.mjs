import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUserAuthorizationOverview } from './userAuthorizationOverview.js'

test('buildUserAuthorizationOverview preserves role provenance and annotates every application', () => {
  const overview = buildUserAuthorizationOverview([
    {
      application: { code: 'contract_management', name: '合同管理系统' },
      access: {
        roles: [
          { code: 'sales', source_type: 'USER', grant_origin: 'MANUAL' },
          { code: 'sales_director', source_type: 'POSITION', grant_origin: 'TEMPLATE', source_name: '销售总监' },
        ],
        conflicts: ['有效角色数量超过应用策略限制'],
      },
    },
    {
      application: { code: 'platform', name: '基础平台' },
      access: { roles: [{ code: 'platform-user', source_type: 'USER', grant_origin: 'SYSTEM' }], conflicts: [] },
    },
  ])

  assert.deepEqual(overview.roles.map((role) => [role.application_code, role.code, role.grant_origin]), [
    ['contract_management', 'sales', 'MANUAL'],
    ['contract_management', 'sales_director', 'TEMPLATE'],
    ['platform', 'platform-user', 'SYSTEM'],
  ])
  assert.deepEqual(overview.effective_roles.map((role) => role.code), ['sales', 'sales_director', 'platform-user'])
  assert.deepEqual(overview.conflicts, ['合同管理系统（contract_management）：有效角色数量超过应用策略限制'])
})

test('buildUserAuthorizationOverview ignores applications without access and removes duplicate conflict text', () => {
  const overview = buildUserAuthorizationOverview([
    { application: { code: 'empty', name: '未授权应用' }, access: null },
    { application: { code: 'demo' }, access: { roles: [], conflicts: ['角色冲突', '角色冲突', ''] } },
  ])

  assert.deepEqual(overview.roles, [])
  assert.deepEqual(overview.conflicts, ['demo：角色冲突'])
})

test('buildUserAuthorizationOverview keeps conflict sources visible but excludes them from effective roles', () => {
  const overview = buildUserAuthorizationOverview([
    {
      application: { code: 'contract_management', name: '合同管理系统' },
      access: {
        authorization_state: 'CONFLICT',
        roles: [
          { code: 'sales', source_type: 'USER', grant_origin: 'MANUAL' },
          { code: 'sales_director', source_type: 'POSITION', grant_origin: 'TEMPLATE' },
        ],
        conflicts: ['sales', 'sales_director'],
      },
    },
  ])

  assert.equal(overview.roles.length, 2)
  assert.equal(overview.roles.every((role) => role.effective === false), true)
  assert.deepEqual(overview.effective_roles, [])
})
