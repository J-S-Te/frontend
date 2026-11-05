import assert from 'node:assert/strict'
import test from 'node:test'
import { useNativeScopeChange } from './useNativeScopeChange.js'

// 用途：创建真实控制器依赖的权威本地范围状态。
// 参数：无。
// 返回值：带真实来源行及版本的测试状态。
function state() { return { project_id: 'PJ-1', scope_version: 1, project_version: 4, actor_id: 'business', can_request: true, can_approve: false, service_items: [{ source_service_id: 'NATIVE-001', site: '现场', category: '类别', requirement: '旧范围' }], changes: [] } }

test('失败和损坏成功回执保留原操作号及冻结请求，精确重试不使用后改草稿', async () => {
  const calls = []
  let result = { wrong: true }
  const ui = useNativeScopeChange({ projectId: 'PJ-1', uuid: () => 'operation-1', api: {
    read: async () => state(), request: async (...args) => { calls.push(args); return result },
  } })
  await ui.load()
  ui.reason.value = '补充范围'; ui.confirmed.value = true
  await ui.submit()
  assert.equal(ui.pending.value.payload.operation_id, 'operation-1')
  assert.equal(ui.error.value.includes('尚未确认'), true)
  ui.lines.value[0].requirement = '不应混入重试'
  result = { id: 'change-1', project_id: 'PJ-1', operation_id: 'operation-1', requested_by: 'business', status: 'PENDING', version: 1 }
  await ui.retry()
  assert.deepEqual(calls[0], calls[1])
  assert.equal(calls[1][1].service_items[0].requirement, '旧范围')
  assert.equal(ui.pending.value, null)
})

test('服务端撤权、待审批与同人自批关闭动作，未知最终状态不能当成功', async () => {
  let current = state(), called = 0
  const ui = useNativeScopeChange({ projectId: 'PJ-1', uuid: () => 'decision-1', api: {
    read: async () => current, decide: async () => { called++; return { id: 'c1', project_id: 'PJ-1', version: 2, status: 'UNKNOWN' } },
  } })
  current = { ...current, can_request: false, can_approve: true, changes: [{ id: 'c1', requested_by: 'business', status: 'PENDING', version: 1, base_scope_version: 1 }] }
  await ui.load()
  assert.equal(ui.canRequest.value, false)
  assert.equal(ui.canDecide(current.changes[0]), false)
  await ui.decide(current.changes[0], 'APPROVE', '通过')
  assert.equal(called, 0)
  current.actor_id = 'director'; await ui.load()
  await ui.decide(current.changes[0], 'APPROVE', '通过')
  assert.equal(called, 1)
  assert.ok(ui.pending.value)
  assert.match(ui.error.value, /尚未确认/)
})

test('批准只接受当前提案、当前操作号、真实决定人和下一范围版本', async () => {
  let current = { ...state(), actor_id: 'director', can_request: false, can_approve: true, changes: [
    { id: 'c1', requested_by: 'business', status: 'PENDING', version: 1, base_scope_version: 1 },
  ] }
  let receipt = { id: 'c1', project_id: 'PJ-1', status: 'APPROVED', version: 2, decided_by: 'director', decision_operation_id: 'decision-1', applied_scope_version: 9 }
  const changed = []
  const ui = useNativeScopeChange({ projectId: 'PJ-1', uuid: () => 'decision-1', onChanged: (v) => changed.push(v), api: {
    read: async () => current, decide: async () => receipt,
  } })
  await ui.load(); await ui.decide(current.changes[0], 'APPROVE', '通过')
  assert.ok(ui.pending.value); assert.equal(changed.length, 0)
  receipt = { ...receipt, applied_scope_version: 2 }
  current = { ...current, scope_version: 2, project_version: 5, changes: [receipt] }
  await ui.retry(); assert.equal(ui.pending.value, null); assert.equal(changed.length, 1)
})
