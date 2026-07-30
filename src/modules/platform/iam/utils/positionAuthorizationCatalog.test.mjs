import assert from 'node:assert/strict'
import { test } from 'node:test'
import { positionTemplateRoleChoices } from './positionAuthorizationCatalog.js'

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
