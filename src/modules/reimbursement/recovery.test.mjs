import test from 'node:test'
import assert from 'node:assert/strict'
import { recoveryCommand } from './recovery.js'

test('审批恢复绑定任务和单据两个版本并保留原因', () => {
  const command = recoveryCommand('approvals', { id: 'task', claim_version: 7,
    version: 3, round: 2 }, '  原审批人离职  ', 'manager-new')
  assert.equal(command.path, '/approval-tasks/task/recover')
  assert.deepEqual(command.payload, { expected_version: 7, task_version: 3, round: 2,
    target_subject_id: 'manager-new', reason: '原审批人离职', action: 'RECOVER' })
  assert.throws(() => recoveryCommand('outboxes', { id: 'x', version: 1 }, '', ''), /原因/)
})
