import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPositionOrganizationTree,
  flattenPositionOrganizationTree,
  groupPositionsByOrganization,
  groupedPositionCount,
  visiblePositionsForOrganizationNode,
} from './positionGroups.js'

const organizations = [
  { org_unit_id: 'sales', name: '销售中心', code: 'ORG-SALES', sort_order: 20 },
  { org_unit_id: 'headquarters', name: '集团总部', code: 'ORG-HQ', sort_order: 10 },
  { org_unit_id: 'sales-east', parent_id: 'sales', name: '华东销售部', code: 'ORG-EAST', sort_order: 10 },
]

const positions = [
  { position_id: 'p-sales', org_unit_id: 'sales', name: '销售人员', code: 'POS-SALES' },
  { position_id: 'p-director', org_unit_id: 'sales', name: '销售总监', code: 'POS-DIRECTOR' },
  { position_id: 'p-admin', org_unit_id: 'headquarters', name: '超级管理员', code: 'POS-ADMIN' },
  { position_id: 'p-hidden', org_unit_id: 'hidden-org', name: '隐藏岗位', code: 'POS-HIDDEN' },
]

test('岗位按照组织树顺序归类，并在组内按照名称排序', () => {
  const groups = groupPositionsByOrganization(positions, organizations)
  assert.deepEqual(groups.map((group) => group.organization_id), ['headquarters', 'sales', '__UNRESOLVED_ORGANIZATION__'])
  assert.deepEqual(groups[1].positions.map((position) => position.position_id), ['p-sales', 'p-director'])
  assert.equal(groupedPositionCount(groups), 4)
})

test('岗位树与组织单元树保持相同父子层级，并将岗位挂到直属组织', () => {
  const tree = buildPositionOrganizationTree([
    ...positions,
    { position_id: 'p-east', org_unit_id: 'sales-east', name: '华东销售', code: 'POS-EAST' },
  ], organizations)
  assert.deepEqual(tree.slice(0, 2).map((node) => node.organization_id), ['headquarters', 'sales'])
  assert.deepEqual(tree[1].children.map((node) => node.organization_id), ['sales-east'])
  assert.deepEqual(tree[1].positions.map((position) => position.position_id), ['p-sales', 'p-director'])
  assert.deepEqual(tree[1].children[0].positions.map((position) => position.position_id), ['p-east'])
  assert.equal(tree[1].direct_position_count, 2)
  assert.equal(tree[1].descendant_position_count, 3)
  assert.equal(tree[1].children[0].organization_path, '销售中心 / 华东销售部')
})

test('岗位树折叠父组织时隐藏其全部子组织', () => {
  const rows = flattenPositionOrganizationTree(
    buildPositionOrganizationTree(positions, organizations),
    new Set(['sales']),
  )
  assert.deepEqual(rows.map((node) => node.organization_id), [
    'headquarters',
    'sales',
    '__UNRESOLVED_ORGANIZATION__',
  ])
})

test('只有直属岗位的叶子组织也可折叠，折叠后隐藏直属岗位', () => {
  const tree = buildPositionOrganizationTree(positions, organizations)
  const headquarters = flattenPositionOrganizationTree(tree)
    .find((node) => node.organization_id === 'headquarters')

  // 叶子组织没有下级组织，但仍有直属岗位内容，必须显示折叠按钮。
  assert.equal(headquarters.hasChildren, false)
  assert.equal(headquarters.hasExpandableContent, true)

  const collapsedHeadquarters = flattenPositionOrganizationTree(tree, new Set(['headquarters']))
    .find((node) => node.organization_id === 'headquarters')
  assert.deepEqual(visiblePositionsForOrganizationNode(collapsedHeadquarters, new Set(['headquarters'])), [])
})

test('岗位搜索同时匹配岗位和所属组织', () => {
  assert.deepEqual(
    groupPositionsByOrganization(positions, organizations, '销售中心')[0].positions.map((position) => position.position_id),
    ['p-sales', 'p-director'],
  )
  assert.deepEqual(
    groupPositionsByOrganization(positions, organizations, 'POS-ADMIN')[0].positions.map((position) => position.position_id),
    ['p-admin'],
  )
  const tree = buildPositionOrganizationTree([
    ...positions,
    { position_id: 'p-east', org_unit_id: 'sales-east', name: '华东销售', code: 'POS-EAST' },
  ], organizations, '华东销售')
  assert.deepEqual(tree.map((node) => node.organization_id), ['sales'])
  assert.deepEqual(tree[0].children.map((node) => node.organization_id), ['sales-east'])
})

test('不可见组织的岗位保持独立分组', () => {
  const groups = groupPositionsByOrganization(positions, organizations)
  const hidden = groups.find((group) => group.organization_id === '__UNRESOLVED_ORGANIZATION__')
  assert.equal(hidden.organization_name, '组织数据异常')
  assert.equal(hidden.unresolved, true)
  assert.deepEqual(hidden.positions.map((position) => position.position_id), ['p-hidden'])
})
