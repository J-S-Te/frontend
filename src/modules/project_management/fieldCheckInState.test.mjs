import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveFieldCheckInState } from './fieldCheckInState.js'

test('刷新后从当前服务项的服务端证据显示已有签到，不能冒充本次提交成功', () => {
  const state = resolveFieldCheckInState({ itemID: 'SI-1', ownerKey: 'tenant:user', snapshot: {
    itemID: 'SI-1', evidence: [{ type: 'FIELD_CHECKED_IN', capturedAt: '2026-11-18T08:00:00Z', summary: '定位误差 18 米' }] } })
  assert.equal(state.phase, 'recorded')
  assert.match(state.message, /已有.*签到/)
  assert.doesNotMatch(state.message, /本次.*成功/)
  assert.equal(state.capturedAt, '2026-11-18T08:00:00Z')
})

test('其他服务项或读取失败的旧证据不能当作当前签到结果', () => {
  const snapshot = { itemID: 'SI-2', evidence: [{ type: 'FIELD_CHECKED_IN' }] }
  assert.equal(resolveFieldCheckInState({ itemID: 'SI-1', ownerKey: 'tenant:user', snapshot }), null)
  assert.equal(resolveFieldCheckInState({ itemID: 'SI-2', ownerKey: 'tenant:user', snapshot, error: '读取失败' }), null)
})

test('本次待同步或失败优先展示，即使服务项有历史签到也不能被覆盖', () => {
  const input = { itemID: 'SI-1', ownerKey: 'tenant:user', snapshot: { itemID: 'SI-1', evidence: [{ type: 'FIELD_CHECKED_IN' }] } }
  assert.equal(resolveFieldCheckInState({ ...input, pending: { itemID: 'SI-1', ownerKey: 'tenant:user', payload: {}, capturedAt: '2026-11-18T08:00:00Z' } }).phase, 'pending')
  assert.equal(resolveFieldCheckInState({ ...input, state: { itemID: 'SI-1', ownerKey: 'tenant:user', phase: 'error', message: '本次失败' } }).phase, 'error')
})
