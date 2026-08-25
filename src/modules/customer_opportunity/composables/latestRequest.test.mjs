import assert from 'node:assert/strict'
import test from 'node:test'
import { createLatestRequestGuard } from './latestRequest.js'

test('latest request guard rejects stale generations', () => {
  const guard = createLatestRequestGuard()
  const first = guard.begin()
  const second = guard.begin()

  assert.equal(guard.isCurrent(first), false)
  assert.equal(guard.isCurrent(second), true)
})

test('invalidating a request also rejects its completion', () => {
  const guard = createLatestRequestGuard()
  const request = guard.begin()
  guard.invalidate()

  assert.equal(guard.isCurrent(request), false)
})
