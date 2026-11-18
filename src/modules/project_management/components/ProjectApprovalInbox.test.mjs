import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mountSFC } from '../../../test/helpers/mountSFC.mjs'

test('统一审批组件从申请列表进入精确详情，并把审批意见交给真实版本守卫', async () => {
  const filename = fileURLToPath(new URL('./ProjectApprovalInbox.vue', import.meta.url))
  assert.ok(existsSync(filename), '应提供可交互的统一审批待办组件')
  const api = fileURLToPath(new URL('../api/projectManagement.js', import.meta.url))
  const writes = [], opens = [], changes = []
  const task = { id: 'req-1', project_id: 'P-1', service_item_id: 'SI-1',
    type: 'REPORT_REWORK', status: 'PENDING', can_decide: true, version: 5,
    requester_user_id: 'manager', approver_user_id: 'lead', reason: '补充现场测评' }
  const mounted = await mountSFC(filename, { [api]: {
    listApprovalTasks: async () => ({ items: [task], total: 1 }),
    decideRollback: async (...args) => writes.push(args), decideReportCorrection: async () => {},
  } }, { requestId: 'req-1', context: 'tenant-a:lead', userId: 'lead',
    onOpenRequest: value => opens.push(value), onChanged: () => changes.push(true) })
  try {
    const state = mounted.state
    await state.load()
    state.openRequest(task)
    assert.deepEqual(opens, ['req-1'])
    assert.equal(writes.length, 0)
    state.comment.value = '同意补测'
    await state.submitDecision('APPROVED')
    assert.deepEqual(writes, [['SI-1', 'req-1',
      { decision: 'APPROVED', comment: '同意补测', expected_version: 5 }]])
    assert.equal(changes.length, 1)
    assert.equal(state.comment.value, '')
  } finally { mounted.unmount() }
})
