import assert from 'node:assert/strict'
import test from 'node:test'
import { detailRows, effectiveAccountStatus, effectiveUserStatus, primaryDetailRows, technicalDetailRows } from './iamPresentation.js'

test('effective account status exposes expiry and active lock windows', () => {
  const now = Date.parse('2026-09-02T00:00:00Z')
  assert.equal(effectiveAccountStatus({ status: 'ACTIVE', valid_until: '2026-09-01T23:59:59Z' }, now), 'EXPIRED')
  assert.equal(effectiveAccountStatus({ status: 'ACTIVE', locked_until: '2026-09-02T00:15:00Z' }, now), 'LOCKED')
  assert.equal(effectiveAccountStatus({ status: 'ACTIVE', valid_until: '2026-09-02T00:15:00Z' }, now), 'ACTIVE')
})

test('detail rows separate business fields from technical identifiers', () => {
  const detail = {
    kind: 'account',
    item: {
      account_id: '01ACCOUNT000000000000000001',
      account_name: 'zhangsan',
      user_id: '01USER00000000000000000001',
      account_type: 'HUMAN',
      auth_source: 'LOCAL',
      status: 'ACTIVE',
      version: 3,
    },
  }
  const primary = primaryDetailRows(detail)
  const technical = technicalDetailRows(detail)
  assert.ok(primary.some((row) => row.label === '账号' && row.value === 'zhangsan'))
  assert.ok(!primary.some((row) => /ID$/.test(row.label) || row.label === '版本'))
  assert.ok(technical.some((row) => row.label === '账号 ID'))
  assert.ok(technical.some((row) => row.label === '版本'))
  assert.deepEqual([...primary, ...technical].length, detailRows(detail).length)
})


test('用户详情和账号详情使用实际锁定/过期状态', () => {
  const now = Date.parse('2026-09-02T00:00:00Z')
  assert.equal(effectiveUserStatus({ status: 'ACTIVE', valid_until: '2026-09-01T23:59:59Z' }, now), 'EXPIRED')
  const userRows = detailRows({ kind: 'user', item: { user_id: 'u1', status: 'ACTIVE', valid_until: '2026-09-01T23:59:59Z' } }, now)
  assert.equal(userRows.find((row) => row.label === '状态').value, '已失效')
  const accountRows = detailRows({ kind: 'account', item: { account_id: 'a1', status: 'ACTIVE', locked_until: '2026-09-02T00:15:00Z' } }, now)
  assert.equal(accountRows.find((row) => row.label === '状态').value, '已锁定')
  assert.ok(accountRows.some((row) => row.label === '锁定至'))
})
