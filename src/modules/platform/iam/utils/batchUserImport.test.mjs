import assert from 'node:assert/strict'
import test from 'node:test'
import { parseApplicationRoles } from './batchUserImport.js'

test('CSV 应用角色支持中文应用名、中文角色名和全角分隔符', () => {
  assert.deepEqual(parseApplicationRoles('合同管理系统：销售人员|客户管理系统：客户经理'), {
    roles: [
      { applicationName: '合同管理系统', roleName: '销售人员' },
      { applicationName: '客户管理系统', roleName: '客户经理' },
    ],
    errors: [],
  })
})

test('CSV 应用角色兼容英文冒号、中文分号和旧编码模板', () => {
  assert.deepEqual(parseApplicationRoles('合同管理系统:销售总监；客户管理系统：客户经理'), {
    roles: [
      { applicationName: '合同管理系统', roleName: '销售总监' },
      { applicationName: '客户管理系统', roleName: '客户经理' },
    ],
    errors: [],
  })
  assert.deepEqual(parseApplicationRoles('contract_management:sales|customer_management:director'), {
    roles: [
      { applicationCode: 'contract_management', roleCode: 'sales' },
      { applicationCode: 'customer_management', roleCode: 'director' },
    ],
    errors: [],
  })
})

test('CSV 应用角色拒绝格式错误和重复授权', () => {
  const result = parseApplicationRoles('合同管理系统：销售人员|错误内容|合同管理系统：销售人员')
  assert.equal(result.roles.length, 1)
  assert.equal(result.errors.length, 2)
})
