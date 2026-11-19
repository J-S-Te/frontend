import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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

test('三类新待办向原业务页传递完整坐标且不能调用旧统一审批写入', async () => {
  const filename = fileURLToPath(new URL('./ProjectApprovalInbox.vue', import.meta.url))
  const api = fileURLToPath(new URL('../api/projectManagement.js', import.meta.url))
  for (const type of ['SPECIAL_METHOD_REVIEW', 'FIELD_DEVIATION', 'NATIVE_SCOPE_CHANGE']) {
    const task = { id: 'new-1', project_id: 'PJ-1', service_item_id: 'SI-1', type,
      status: 'PENDING', can_decide: true, version: 1, requester_user_id: 'other' }
    const opens = [], writes = []
    const mounted = await mountSFC(filename, { [api]: {
      listApprovalTasks: async () => ({ items: [task], total: 1 }),
      decideRollback: async () => writes.push(true), decideReportCorrection: async () => writes.push(true),
    } }, { requestId: 'new-1', context: 'tenant:director', userId: 'director',
      onOpenRequest: value => opens.push(value) })
    try {
      await mounted.state.load()
      mounted.state.openRequest(task)
      assert.deepEqual(opens, [task])
      mounted.state.comment.value = '同意'
      await mounted.state.submitDecision('APPROVED')
      assert.deepEqual(writes, [])
    } finally { mounted.unmount() }
  }
})

test('审批后台重读期间禁用决定按钮，同时保留审批意见输入', () => {
  const template = readFileSync(new URL('./ProjectApprovalInbox.vue', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  for (const decision of ['APPROVED', 'REJECTED']) {
    assert.ok(template.includes(`:disabled="saving || refreshing || !comment.trim()" @click="submitDecision('${decision}')"`))
  }
  assert.match(template, /<textarea v-model="comment"/)
})
