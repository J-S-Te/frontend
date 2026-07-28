import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTRACT_PERMISSION_DEFINITIONS,
  CONTRACT_ROLE_DEFINITIONS,
  canAccessContractSection,
  effectiveContractPermissions,
  hasContractPermission,
} from './shared/authz/sys004.js'

test('SYS-004 frontend catalog contains six roles and eighteen permissions', () => {
  assert.equal(CONTRACT_ROLE_DEFINITIONS.length, 6)
  assert.equal(CONTRACT_PERMISSION_DEFINITIONS.length, 18)
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
  assert.equal(canAccessContractSection(director, 'templates'), false)
  assert.equal(canAccessContractSection(director, 'signing'), false)
})

test('sales cannot enter approval center even when a custom approval permission is present', () => {
  const sales = { role: { code: 'sales' }, permissions: ['dashboard', 'approval.view', 'approval.process'] }
  assert.equal(canAccessContractSection(sales, 'approvals'), false)
})
