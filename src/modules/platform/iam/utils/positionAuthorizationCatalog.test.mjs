import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  positionAuthorizationTargetCatalog,
  positionTemplateRoleChoices,
} from './positionAuthorizationCatalog.js'

test('position target catalog treats platform-native roles as ready without an external catalog request', () => {
  const catalog = positionAuthorizationTargetCatalog({
    application_id: 'platform-app',
    application_code: 'platform',
    roles: [
      {
        role_id: 'platform-security-admin',
        role_code: 'platform-security-admin',
        role_name: '平台安全管理员',
        role_type: 'PLATFORM',
      },
    ],
  })

  assert.equal(catalog.catalog_version, 'built-in')
  assert.equal(catalog.sync_status, 'SYNCED')
  assert.deepEqual(catalog.roles, [{
    role_id: 'platform-security-admin',
    role_code: 'platform-security-admin',
    role_name: '平台安全管理员',
    role_type: 'PLATFORM',
    status: 'ACTIVE',
    assignable: true,
  }])
})

test('position target catalog exposes the application max_effective_roles policy for the role selector', () => {
  const catalog = positionAuthorizationTargetCatalog({
    application_id: 'crm-app',
    application_code: 'customer_and_opportunity',
    max_effective_roles: 10,
    roles: [],
  })

  assert.deepEqual(catalog.policy, { max_effective_roles: 10 })
  assert.equal(positionAuthorizationTargetCatalog({ application_id: 'x', roles: [] }).policy.max_effective_roles, 0)
})

test('position target catalog keeps an explicit subsystem catalog failure state', () => {
  const catalog = positionAuthorizationTargetCatalog({
    application_id: 'contract-app',
    application_code: 'contract_management',
    catalog_version: '2026.07',
    catalog_sync_status: 'FAILED',
    roles: [{ role_id: 'sales-role', role_code: 'sales', status: 'ACTIVE' }],
  })

  assert.equal(catalog.catalog_version, '2026.07')
  assert.equal(catalog.sync_status, 'FAILED')
})

test('position template role selector intersects platform role IDs with ACTIVE assignable application catalog roles', () => {
  const choices = positionTemplateRoleChoices([
    { role_id: 'platform-sales-role', role_code: 'sales', role_name: '旧名称不作为展示来源' },
    { role_id: 'platform-audit-role', role_code: 'audit_admin' },
  ], {
    sync_status: 'SYNCED',
    roles: [
      { code: 'sales', name: '销售人员', status: 'ACTIVE', assignable: true },
      { code: 'audit_admin', name: '审计管理员', status: 'ACTIVE', assignable: false },
      { code: 'disabled', name: '已停用角色', status: 'DISABLED', assignable: true },
    ],
  })

  assert.deepEqual(choices, [{
    code: 'sales',
    name: '销售人员',
    status: 'ACTIVE',
    assignable: true,
    id: 'platform-sales-role',
    role_id: 'platform-sales-role',
    role_code: 'sales',
  }])
})
