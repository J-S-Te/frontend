import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTHORIZATION_REFRESHED_EVENT,
  clearAuthorizationSnapshot,
  principalFingerprint,
} from './authorizationRefresh.js'

test('principalFingerprint ignores role and permission ordering', () => {
  const first = principalFingerprint({
    tenant: { id: 'tenant-1' },
    user: { id: 'user-1' },
    account: { id: 'account-1' },
    roles: [{ code: 'operator' }, { id: 'role-admin' }],
    permission_codes: ['platform:user:read', 'platform:user:update'],
  })
  const second = principalFingerprint({
    tenant: { id: 'tenant-1' },
    user: { id: 'user-1' },
    account: { id: 'account-1' },
    roles: [{ id: 'role-admin' }, { code: 'operator' }],
    permission_codes: ['platform:user:update', 'platform:user:read'],
  })

  assert.equal(first, second)
})

test('principalFingerprint changes when effective permissions change', () => {
  const before = principalFingerprint({ permission_codes: ['platform:user:read'] })
  const after = principalFingerprint({ permission_codes: ['platform:user:update'] })

  assert.notEqual(before, after)
})

test('clearAuthorizationSnapshot broadcasts an explicit null principal', () => {
  const originalWindow = globalThis.window
  let dispatched
  globalThis.window = {
    dispatchEvent(event) { dispatched = event },
  }
  const OriginalCustomEvent = globalThis.CustomEvent
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type
      this.detail = options.detail
    }
  }

  try {
    clearAuthorizationSnapshot()
    assert.equal(dispatched.type, AUTHORIZATION_REFRESHED_EVENT)
    assert.equal(dispatched.detail.principal, null)
  } finally {
    globalThis.window = originalWindow
    globalThis.CustomEvent = OriginalCustomEvent
  }
})
