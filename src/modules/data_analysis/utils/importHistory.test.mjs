import test from 'node:test'
import assert from 'node:assert/strict'
import { historyAmount, historyAvailability } from './importHistory.js'

test('history displays exact minor units without implicit unsafe rounding', () => {
  assert.equal(historyAmount(12345), '123.45')
  assert.equal(historyAmount(-1), '-0.01')
  assert.equal(historyAmount(9007199254740991), '90071992547409.91')
  assert.match(historyAmount(9007199254740992), /核对权威台账/)
})
test('missing or failed history never becomes a successful empty zero', () => {
  assert.match(historyAvailability({sync_status: 'UNKNOWN', periods: []}), /未知/)
  assert.match(historyAvailability({sync_status: 'FAILED', synced_at: '2020-01-01', stale: true}), /陈旧/)
  assert.match(historyAvailability({sync_status: 'SUCCESS', synced_at: '2026-10-29', stale: false}), /成功发布/)
})
