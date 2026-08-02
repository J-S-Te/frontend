import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authorizationPositionGroupLabel,
  authorizationPositionOptionLabel,
  groupAuthorizationPositions,
  organizationSelectOptions,
  positionsForOrganization,
} from './selectionCatalog.js'

test('organization select options preserve tree order and show hierarchy indentation', () => {
  const options = organizationSelectOptions([
    { org_unit_id: 'child-b', parent_id: 'root', name: '研发二部', code: 'RD-2', sort_order: 20 },
    { org_unit_id: 'root', parent_id: '', name: '集团总部', code: 'ROOT', sort_order: 10 },
    { org_unit_id: 'child-a', parent_id: 'root', name: '研发一部', code: 'RD-1', sort_order: 10 },
  ])

  assert.deepEqual(options.map((item) => item.option_id), ['root', 'child-a', 'child-b'])
  assert.equal(options[0].option_label, '集团总部 · ROOT')
  assert.equal(options[1].option_label, '　└ 研发一部 · RD-1')
})

test('positions are filtered by organization and sorted by Chinese name, code and ID', () => {
  const positions = positionsForOrganization([
    { position_id: 'p3', org_unit_id: 'org-1', name: '销售人员', code: 'B' },
    { position_id: 'p1', org_unit_id: 'org-1', name: '财务总监', code: 'A' },
    { position_id: 'p2', org_unit_id: 'org-2', name: '技术总监', code: 'A' },
  ], 'org-1')

  assert.deepEqual(positions.map((item) => item.position_id), ['p1', 'p3'])
})

test('authorization positions are grouped by stable organization ID and keep duplicate names separate', () => {
  const groups = groupAuthorizationPositions([
    { position_id: 'p2', position_name: '销售人员', org_unit_id: 'org-b', org_unit_name: '销售部', org_unit_code: 'SALE-B', org_unit_path: '/opaque-root/org-b/', org_unit_depth: 2 },
    { position_id: 'p1', position_name: '销售总监', org_unit_id: 'org-a', org_unit_name: '销售部', org_unit_code: 'SALE-A', org_unit_path: '/opaque-root/org-a/', org_unit_depth: 2 },
    { position_id: 'p3', position_name: '财务总监' },
  ])

  assert.equal(groups.length, 3)
  assert.deepEqual(groups.filter((group) => group.organization_name === '销售部').map((group) => group.organization_id), ['org-a', 'org-b'])
  assert.equal(groups.find((group) => !group.organization_id).organization_name, '组织信息未提供')
  assert.equal(authorizationPositionGroupLabel(groups.find((group) => group.organization_id === 'org-a')), '　└ 销售部 · SALE-A（1）')
  assert.doesNotMatch(authorizationPositionGroupLabel(groups.find((group) => group.organization_id === 'org-a')), /opaque-root/)
  assert.equal(authorizationPositionOptionLabel({ position_name: '销售人员', position_code: 'SALE' }), '销售人员 · SALE')
})
