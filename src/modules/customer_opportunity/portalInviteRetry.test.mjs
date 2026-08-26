import assert from 'node:assert/strict'
import test from 'node:test'

import { createPortalInviteRetryState, validatePortalInviteResult } from './portalInviteRetry.js'

test('validatePortalInviteResult accepts a one-time Portal activation URL', () => {
  const value = validatePortalInviteResult({ activation_url: 'https://portal.example/customer-portal/activate?token=opaque-test-token' })

  assert.equal(value, 'https://portal.example/customer-portal/activate?token=opaque-test-token')
})

test('validatePortalInviteResult rejects an incomplete or non-Portal response', () => {
  assert.equal(validatePortalInviteResult({}), '')
  assert.equal(validatePortalInviteResult({ activation_url: 'https://portal.example/customer-portal/activate' }), '')
  assert.equal(validatePortalInviteResult({ activation_url: 'https://portal.example/other?token=opaque-test-token' }), '')
})

test('portal invite retry key remains available until the activation URL is validated', () => {
  let keyCount = 0
  const state = createPortalInviteRetryState(() => `key-${++keyCount}`)
  const contact = { id: 9, name: '测试联系人', phone: '13800000000', is_registration: true }
  const first = state.keyFor(7, contact)

  assert.equal(validatePortalInviteResult({}), '')
  assert.equal(state.keyFor(7, contact).key, first.key)

  state.confirmSuccess(first.signature, first.key)
  assert.equal(state.keyFor(7, contact).key, 'key-2')
})
