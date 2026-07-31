import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTRACT_PERMISSION_DEFINITIONS,
  CONTRACT_ROLE_DEFINITIONS,
  CONTRACT_SECTION_PERMISSIONS,
  canAccessContractSection,
  contractRole,
  effectiveContractPermissions,
  hasContractPermission,
} from './sys004.js'

test('SYS-004 frontend catalog contains six roles and twenty permissions', () => {
  assert.equal(CONTRACT_ROLE_DEFINITIONS.length, 6)
  assert.equal(CONTRACT_PERMISSION_DEFINITIONS.length, 20)
  assert.equal(CONTRACT_PERMISSION_DEFINITIONS.some(({ code }) => code === 'approval.manage'), true)
  assert.equal(CONTRACT_PERMISSION_DEFINITIONS.some(({ code }) => code === 'approval_rule.manage'), true)
})

test('contract role codes have Chinese display names', () => {
  assert.equal(contractRole('admin')?.name, '超级管理员')
  assert.equal(contractRole('sales_director')?.name, '销售总监')
  assert.equal(contractRole('tech_director')?.name, '技术总监')
  assert.equal(contractRole('finance_director')?.name, '财务总监')
  assert.equal(contractRole('sales')?.name, '销售人员')
  assert.equal(contractRole('audit_admin')?.name, '审计管理员')
})

test('effective permissions are the sorted union of role and custom permissions', () => {
  assert.deepEqual(effectiveContractPermissions('sales', ['contract_template.manage', 'contract.read']), [
    'contract.create',
    'contract.edit',
    'contract.read',
    'contract_template.manage',
    'contract_template.read',
    'customer.create',
    'customer.edit',
    'customer.read',
    'dashboard',
  ])
})

test('all is a wildcard and director routes remain constrained', () => {
  assert.equal(hasContractPermission({ permissions: ['all'] }, 'approval.process'), true)
  const director = { role: { code: 'sales_director' }, permissions: ['dashboard', 'contract.read', 'contract_template.manage'] }
  assert.equal(canAccessContractSection(director, 'contracts'), true)
  assert.equal(canAccessContractSection(director, 'rules'), true)
  assert.equal(canAccessContractSection(director, 'templates'), false)
  assert.equal(canAccessContractSection(director, 'signing'), false)
})

test('sales can track initiated approvals but cannot configure rules', () => {
  const sales = { role: { code: 'sales' }, permissions: ['dashboard', 'contract.create'] }
  assert.equal(canAccessContractSection(sales, 'approvals'), true)
  assert.equal(canAccessContractSection(sales, 'rules'), false)
})

test('contract admin can access every contract module section', () => {
  const admin = { role: { code: 'admin' }, permissions: ['contract.read'] }
  for (const section of Object.keys(CONTRACT_SECTION_PERMISSIONS)) {
    assert.equal(canAccessContractSection(admin, section), true, section)
  }
})
