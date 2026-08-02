import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildOrganizationTree,
  filterOrganizationTree,
  flattenOrganizationTree,
  organizationDescendantIds,
} from './organizationTree.js'

const organizations = [
  { org_unit_id: 'sales-east', parent_id: 'sales', name: '华东销售部', sort_order: 20 },
  { org_unit_id: 'tech', parent_id: '', name: '技术中心', sort_order: 20 },
  { org_unit_id: 'sales', parent_id: '', name: '销售中心', sort_order: 10 },
  { org_unit_id: 'sales-north', parent_id: 'sales', name: '华北销售部', sort_order: 10 },
]

test('buildOrganizationTree groups and sorts sibling organizations', () => {
  const tree = buildOrganizationTree(organizations)
  assert.deepEqual(tree.map((item) => item.org_unit_id), ['sales', 'tech'])
  assert.deepEqual(tree[0].children.map((item) => item.org_unit_id), ['sales-north', 'sales-east'])
})

test('flattenOrganizationTree respects collapsed branches', () => {
  const tree = buildOrganizationTree(organizations)
  assert.deepEqual(
    flattenOrganizationTree(tree, new Set(['sales'])).map(({ org_unit_id, depth }) => [org_unit_id, depth]),
    [['sales', 0], ['tech', 0]],
  )
})

test('buildOrganizationTree keeps missing parents and cycles visible', () => {
  const tree = buildOrganizationTree([
    { org_unit_id: 'orphan', parent_id: 'missing', name: '孤立组织' },
    { org_unit_id: 'a', parent_id: 'b', name: 'A' },
    { org_unit_id: 'b', parent_id: 'a', name: 'B' },
  ])
  assert.deepEqual(new Set(tree.map((item) => item.org_unit_id)), new Set(['orphan', 'a', 'b']))
})

test('filterOrganizationTree keeps ancestors of matching organizations', () => {
  const tree = filterOrganizationTree(buildOrganizationTree(organizations), '华北')
  assert.deepEqual(tree.map((item) => item.org_unit_id), ['sales'])
  assert.deepEqual(tree[0].children.map((item) => item.org_unit_id), ['sales-north'])
})

test('organizationDescendantIds returns every nested descendant', () => {
  const tree = buildOrganizationTree([
    ...organizations,
    { org_unit_id: 'sales-north-a', parent_id: 'sales-north', name: '华北销售一组', sort_order: 10 },
  ])
  assert.deepEqual(
    organizationDescendantIds(tree, 'sales'),
    new Set(['sales-east', 'sales-north', 'sales-north-a']),
  )
})
