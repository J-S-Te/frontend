import assert from 'node:assert/strict'
import test from 'node:test'
import { crmRoleNames } from './crmDisplay.js'

// 页面展示契约：CustomerOpportunityView.vue 用 crmRoleNames[role] || role 生成角色名，
// 因此后端新增角色码必须在映射表内，未知角色码保持原样回落。
const roleLabel = (role) => crmRoleNames[role] || role

test('客户全量查看员映射为中文名', () => {
  assert.equal(crmRoleNames.customer_all_viewer, '客户全量查看员')
  assert.equal(roleLabel('customer_all_viewer'), '客户全量查看员')
})

test('历史授权编码继续合并到当前角色名', () => {
  assert.equal(roleLabel('implementation_engineer'), '技术人员')
  assert.equal(roleLabel('technical_lead'), '技术总监')
})

test('未知角色码回落到原编码', () => {
  assert.equal(crmRoleNames.unknown_crm_role, undefined)
  assert.equal(roleLabel('unknown_crm_role'), 'unknown_crm_role')
})
