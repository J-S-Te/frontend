import test from 'node:test'
import assert from 'node:assert/strict'

test('超级管理员仅更名展示，全租户能力只认服务端明确marker而非角色名称', async () => {
  const { reimbursementRoleLabel, hasTenantAllCapability, expenseScopeDescription } = await import('./rolePresentation.js')
  assert.equal(reimbursementRoleLabel('reimbursement_admin'), '超级管理员')
  const ordinary = { tenant_id: 'tenant', roles: ['reimbursement_admin'], permissions: ['expense.config.manage'] }
  assert.equal(hasTenantAllCapability(ordinary), false)
  assert.match(expenseScopeDescription(ordinary), /未配置.*拒绝/)
  assert.equal(hasTenantAllCapability({ tenant_id: 'tenant', permissions: ['expense.scope.tenant_all'] }), true)
  assert.match(expenseScopeDescription({ tenant_id: 'tenant', permissions: ['expense.scope.tenant_all'] }), /本租户/)
})

test('岗位名称与项目经理、技术总监和销售总监一致，不显示团队负责人替代', async () => {
  const { approvalNodeLabel, approvalNodesLabel } = await import('./rolePresentation.js')
  assert.match(approvalNodeLabel('PROJECT_EXPENSE_OWNER'), /项目经理/)
  assert.match(approvalNodeLabel('TECHNICAL_DIRECTOR'), /项目技术总监/)
  assert.match(approvalNodeLabel('SALES_DIRECTOR'), /项目销售总监/)
  assert.equal(approvalNodesLabel('ACCOUNTANT / FINANCE_DIRECTOR'), '会计审核 / 财务负责人')
  assert.doesNotMatch(approvalNodesLabel('ACCOUNTANT / FINANCE_DIRECTOR'), /ACCOUNTANT|FINANCE_DIRECTOR/)
})
