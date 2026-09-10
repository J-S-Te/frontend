import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTRACT_ROLE_DEFINITIONS,
  CONTRACT_SECTION_PERMISSIONS,
  canAccessContractSection,
  contractRole,
  hasContractPermission,
} from './sys004.js'

test('SYS-004 active role catalog includes the dedicated opportunity intake permissions', () => {
  assert.equal(CONTRACT_ROLE_DEFINITIONS.length, 7)
  const adminPermissions = contractRole('admin').permissions
  assert.equal(adminPermissions.includes('approval.manage'), true)
  assert.equal(adminPermissions.includes('approval_rule.manage'), true)
  assert.equal(adminPermissions.includes('opportunity_intake.read'), true)
  assert.equal(adminPermissions.includes('opportunity_intake.process'), true)
})

test('contract role codes have Chinese display names', () => {
  assert.equal(contractRole('admin')?.name, '超级管理员')
  assert.equal(contractRole('sales_director')?.name, '销售总监')
  assert.equal(contractRole('tech_director')?.name, '技术总监')
  assert.equal(contractRole('finance_director')?.name, '财务总监')
  assert.equal(contractRole('sales')?.name, '销售人员')
  assert.equal(contractRole('audit_admin')?.name, '审计管理员')
  assert.equal(contractRole('contract_specialist')?.name, '合同专员')
})

test('contract specialist can only enter the approved-contract signing ledger', () => {
  // contract_specialist 实际持有 contract.signing.manage（见 permission-manifest.yaml），
  // 签署台账由该权限把守，因此夹具必须带上它。
  const specialist = { roles: ['contract_specialist'], permissions: ['contract.approved.read', 'contract.document.download', 'contract.stamped_pdf.upload', 'contract.signing.manage'] }
  assert.equal(canAccessContractSection(specialist, 'signing'), true)
  for (const section of ['dashboard', 'contracts', 'approvals', 'rules', 'reports']) {
    assert.equal(canAccessContractSection(specialist, section), false, section)
  }
})

test('读取已审批合同不足以进入签署台账', () => {
  // 项目侧「合同导入只读」只需要读已审批合同；签署台账涉及盖章件与签署状态，
  // 必须由 contract.signing.manage 单独把守，不能被读权限顺带放开。
  const importer = { roles: ['contract_importer'], permissions: ['contract.approved.read'] }
  assert.equal(canAccessContractSection(importer, 'signing'), false)
  for (const section of ['dashboard', 'customers', 'contracts', 'templates', 'approvals', 'rules', 'reports']) {
    assert.equal(canAccessContractSection(importer, section), false, section)
  }
})

test('all is a wildcard and director routes remain constrained', () => {
  assert.equal(hasContractPermission({ permissions: ['all'] }, 'approval.process'), true)
  const director = { role: { code: 'sales_director' }, permissions: ['dashboard', 'contract.read', 'contract_template.manage'] }
  assert.equal(canAccessContractSection(director, 'contracts'), true)
  assert.equal(canAccessContractSection(director, 'rules'), true)
  assert.equal(canAccessContractSection(director, 'templates'), false)
  assert.equal(canAccessContractSection(director, 'signing'), false)
})

test('route access accepts the roles array returned by the contract session', () => {
  const director = { roles: ['sales_director'], permissions: ['dashboard', 'contract.read'] }
  assert.equal(canAccessContractSection(director, 'dashboard'), true)
  assert.equal(canAccessContractSection(director, 'contracts'), true)
  assert.equal(canAccessContractSection(director, 'templates'), false)

  const admin = { roles: ['admin'], permissions: ['contract.read'] }
  assert.equal(canAccessContractSection(admin, 'contracts'), true)
})

test('sales can track initiated approvals but cannot configure rules', () => {
  const sales = { role: { code: 'sales' }, permissions: ['dashboard', 'contract.create'] }
  assert.equal(canAccessContractSection(sales, 'approvals'), true)
  assert.equal(canAccessContractSection(sales, 'rules'), false)
})

test('contract admin can access every contract module section', () => {
  const admin = { role: { code: 'admin' }, permissions: ['contract.read', 'opportunity_intake.read'] }
  for (const section of Object.keys(CONTRACT_SECTION_PERMISSIONS)) {
    assert.equal(canAccessContractSection(admin, section), true, section)
  }
})

test('opportunity intake queue requires its dedicated backend permission even for a named admin role', () => {
  assert.equal(canAccessContractSection({ role: { code: 'admin' }, permissions: ['contract.read'] }, 'intakes'), false)
  assert.equal(canAccessContractSection({ role: { code: 'audit_admin' }, permissions: ['opportunity_intake.read'] }, 'intakes'), true)
})
