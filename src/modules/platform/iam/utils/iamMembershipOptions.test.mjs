import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  defaultMembershipOrganizationId,
  membershipOrganizationOptions,
  positionOrgUnitId,
} from './iamMembershipOptions.js'

test('任职组织选项显示各组织可用岗位数量', () => {
  const organizations = [
    { org_unit_id: 'org-default', name: '默认组织' },
    { org_unit_id: 'org-contract', name: '合同管理' },
  ]
  const positions = [
    { position_id: 'position-1', org_unit_id: 'org-default' },
    { position_id: 'position-2', org_unit: { id: 'org-default' } },
  ]

  assert.deepEqual(
    membershipOrganizationOptions(organizations, positions).map(({ org_unit_id, position_count }) => ({ org_unit_id, position_count })),
    [
      { org_unit_id: 'org-default', position_count: 2 },
      { org_unit_id: 'org-contract', position_count: 0 },
    ],
  )
  assert.equal(defaultMembershipOrganizationId(organizations, positions), 'org-default')
  assert.equal(positionOrgUnitId(positions[1]), 'org-default')
})

test('没有任何岗位时不猜测默认组织', () => {
  assert.equal(defaultMembershipOrganizationId([{ org_unit_id: 'org-empty' }], []), '')
})
