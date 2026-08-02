import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filteredMembershipsFromGroups,
  groupMembershipsByOrganization,
} from './membershipGroups.js'

const organizations = [
  { org_unit_id: 'sales', name: '销售部', code: 'ORG-SALES', sort_order: 20 },
  { org_unit_id: 'headquarters', name: '总部', code: 'ORG-HQ', sort_order: 10 },
  { org_unit_id: 'sales-east', parent_id: 'sales', name: '华东销售部', code: 'ORG-EAST', sort_order: 10 },
]

const memberships = [
  { membership_id: 'm-2', user: { id: 'u-2', name: '李四' }, org_unit: { id: 'sales', name: '销售部' }, position: { id: 'p-2', name: '销售人员' }, membership_type: 'SECONDARY' },
  { membership_id: 'm-1', user: { id: 'u-1', name: '张三' }, org_unit: { id: 'headquarters', name: '总部' }, position: { id: 'p-1', name: '管理员' }, membership_type: 'PRIMARY' },
  { membership_id: 'm-3', user: { id: 'u-3', name: '王五' }, org_unit: { id: 'sales-east', name: '华东销售部' }, position: { id: 'p-3', name: '销售总监' }, membership_type: 'PRIMARY' },
]

test('任职关系按照组织树顺序和稳定组织 ID 分组', () => {
  const groups = groupMembershipsByOrganization(memberships, organizations)
  assert.deepEqual(groups.map((group) => group.organization_id), ['headquarters', 'sales', 'sales-east'])
  assert.deepEqual(groups.map((group) => group.memberships.length), [1, 1, 1])
})

test('同名组织不会合并为同一个任职分组', () => {
  const groups = groupMembershipsByOrganization([
    { membership_id: 'm-a', user: { name: '甲' }, org_unit: { id: 'org-a', name: '研发部' }, position: { name: '工程师' } },
    { membership_id: 'm-b', user: { name: '乙' }, org_unit: { id: 'org-b', name: '研发部' }, position: { name: '工程师' } },
  ])
  assert.equal(groups.length, 2)
  assert.deepEqual(new Set(groups.map((group) => group.organization_id)), new Set(['org-a', 'org-b']))
})

test('搜索同时匹配用户、组织和岗位且导出结果不受折叠状态影响', () => {
  assert.deepEqual(filteredMembershipsFromGroups(groupMembershipsByOrganization(memberships, organizations, '张三')).map((item) => item.membership_id), ['m-1'])
  assert.deepEqual(filteredMembershipsFromGroups(groupMembershipsByOrganization(memberships, organizations, '销售部')).map((item) => item.membership_id), ['m-2', 'm-3'])
  assert.deepEqual(filteredMembershipsFromGroups(groupMembershipsByOrganization(memberships, organizations, '销售总监')).map((item) => item.membership_id), ['m-3'])
})

test('组织目录不可见时仍按响应中的组织 ID 分组，缺少 ID 时进入异常组', () => {
  const groups = groupMembershipsByOrganization([
    { membership_id: 'm-hidden', user: { name: '甲' }, org_unit: { id: 'hidden', name: '隐藏组织' }, position: { name: '岗位' } },
    { membership_id: 'm-invalid', user: { name: '乙' }, org_unit: { name: '' }, position: { name: '岗位' } },
  ], organizations)
  assert.equal(groups.find((group) => group.organization_id === 'hidden').organization_name, '隐藏组织')
  assert.equal(groups.find((group) => group.unresolved).memberships[0].membership_id, 'm-invalid')
})
