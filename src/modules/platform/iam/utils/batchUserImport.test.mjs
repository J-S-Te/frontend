import assert from 'node:assert/strict'
import test from 'node:test'
import { parseApplicationRoles, restoreRowSelection } from './batchUserImport.js'

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

// 复现 P2：两行 CSV，用户取消了第 2 行的勾选；目录变化触发重新核验后，
// rebuildRows 会把两行都按"合法默认勾选"重建，恢复逻辑必须保留用户的取消动作。
test('重新核验后按行号精确恢复勾选，不把用户取消的行重新勾上', () => {
  const rows = [
    { lineNo: 2, valid: true, selected: true },  // rebuildRows 默认勾选
    { lineNo: 3, valid: true, selected: true },  // 用户此前手动取消，但重建后又变成勾选
  ]
  restoreRowSelection(rows, new Set([2]))
  assert.equal(rows[0].selected, true)
  assert.equal(rows[1].selected, false, '用户取消勾选的合法行不得被重新勾上')
})

test('重新核验后合法但新出现的行默认不勾选，非法行始终不勾选', () => {
  const rows = [
    { lineNo: 4, valid: true, selected: true },   // 不在旧勾选集合中
    { lineNo: 5, valid: false, selected: true },  // 非法行
  ]
  restoreRowSelection(rows, new Set([5]))
  assert.equal(rows[0].selected, false)
  assert.equal(rows[1].selected, false)
})
