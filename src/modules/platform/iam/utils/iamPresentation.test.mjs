import assert from 'node:assert/strict'
import test from 'node:test'
import { effectiveAccountStatus } from './iamPresentation.js'

test('effective account status exposes expiry and active lock windows', () => {
  const now = Date.parse('2026-09-02T00:00:00Z')
  assert.equal(effectiveAccountStatus({ status: 'ACTIVE', valid_until: '2026-09-01T23:59:59Z' }, now), 'EXPIRED')
  assert.equal(effectiveAccountStatus({ status: 'ACTIVE', locked_until: '2026-09-02T00:15:00Z' }, now), 'LOCKED')
  assert.equal(effectiveAccountStatus({ status: 'ACTIVE', valid_until: '2026-09-02T00:15:00Z' }, now), 'ACTIVE')
})
