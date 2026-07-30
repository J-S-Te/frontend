import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEmployeeOnboardingPayload,
  defaultEmployeeOnboardingForm,
  positionOptionsForOrganization,
} from './employeeOnboarding.js'

test('employee onboarding defaults to a one-day local account and an inheriting primary membership', () => {
  const form = defaultEmployeeOnboardingForm(new Date('2026-07-30T08:00:00.000Z'))

  assert.equal(form.create_account, true)
  assert.equal(form.create_membership, true)
  assert.equal(form.validity_mode, 'TEMPORARY')
  assert.equal(form.membership_type, 'PRIMARY')
  assert.equal(form.inherit_authorization, true)
  assert.match(form.valid_until, /^2026-07-31T/)
})

test('employee onboarding payload keeps optional account and membership absent when switched off', () => {
  const payload = buildEmployeeOnboardingPayload({
    display_name: '张三',
    email: ' zhangsan@example.com ',
    mobile: ' 13800000000 ',
    status: 'ACTIVE',
    create_account: false,
    create_membership: false,
  })

  assert.deepEqual(payload, {
    user: {
      display_name: '张三',
      email: 'zhangsan@example.com',
      mobile: '13800000000',
      status: 'ACTIVE',
    },
    account: null,
    membership: null,
  })
})

test('employee onboarding payload mirrors account and membership dates for the atomic API contract', () => {
  const payload = buildEmployeeOnboardingPayload({
    display_name: '李四',
    email: '',
    mobile: '',
    status: 'ACTIVE',
    create_account: true,
    account_name: 'li.si',
    initial_password: 'Temporary-Password-1',
    validity_mode: 'PERMANENT',
    create_membership: true,
    org_unit_id: 'org-1',
    position_id: 'position-1',
    membership_type: 'SECONDARY',
    membership_validity_mode: 'SHORT_TERM',
    effective_from: '2026-08-01',
    effective_to: '2026-08-31',
    inherit_authorization: true,
  })

  assert.deepEqual(payload.account, {
    account_name: 'li.si',
    initial_password: 'Temporary-Password-1',
    valid_until: null,
  })
  assert.deepEqual(payload.membership, {
    org_unit_id: 'org-1',
    position_id: 'position-1',
    membership_type: 'SECONDARY',
    effective_from: '2026-08-01',
    effective_to: '2026-08-31',
    inherit_authorization: true,
  })
})

test('position filtering keeps the organization and selected position aligned', () => {
  assert.deepEqual(
    positionOptionsForOrganization([
      { position_id: 'p1', org_unit_id: 'org-a' },
      { position_id: 'p2', org_unit_id: 'org-b' },
    ], 'org-a').map((item) => item.position_id),
    ['p1'],
  )
})
