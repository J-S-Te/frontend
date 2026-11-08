import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useApprovalDetail } from './composables/useApprovalDetail.js'

test('approval command carries the displayed node revision even when return targets another node', async () => {
 const calls = []
 const detail = { meta: { applicant_user_id: 'applicant' }, state: { current_node_index: 1, nodes: [{ node: { id: 'prior' }, revision: 2 }, { node: { id: 'current' }, revision: 7 }] }, actions: [{ command_id: 'accepted' }] }
 const approval = useApprovalDetail({ getApproval: async () => detail, previewApprovalContract: async () => ({}), commandApproval: async (...args) => { calls.push(args); return { command_id: 'accepted' } }, can: () => true, session: ref({ user_id: 'reviewer' }), showToast: () => {}, formatUserError: String, refreshApprovalRealtime: async () => {} })
 approval.selectedApproval.value = { id: 'approval', status: 'active' }
 approval.approvalDetail.value = detail
 approval.approvalComment.value = 'return reason'
 await approval.executeApprovalCommand('return', { target_node_id: 'prior' })
 assert.deepEqual(calls[0], ['approval', 'return', { comment: 'return reason', target_node_id: 'prior', origin_node_id: 'current', origin_node_revision: 7 }])
})

test('status approval completion checks its requested contract status', async () => {
 for (const [action, status] of [['approve', 'in_progress'], ['reject', 'active'], ['withdraw', 'active']]) {
  const messages = []
  const detail = { meta: { applicant_user_id: 'owner', kind: 'status_change', from_status: 'active', target_status: 'in_progress' }, state: { status: action === 'approve' ? 'approved' : 'rejected', current_node_index: 0, nodes: [{ node: { id: 'admin' }, revision: 1 }] }, contract: { status }, actions: [{ command_id: 'accepted' }] }
  const approval = useApprovalDetail({ getApproval: async () => detail, commandApproval: async () => ({ command_id: 'accepted' }), can: () => true, session: ref({ user_id: 'owner' }), showToast: (...args) => messages.push(args), formatUserError: String, refreshApprovalRealtime: async () => {} })
  approval.selectedApproval.value = { id: 'approval', status: 'active' }
  approval.approvalDetail.value = detail
  approval.approvalComment.value = 'reason'
  await approval.executeApprovalCommand(action, {}, { close: true })
  assert.equal(approval.selectedApproval.value, null, `${action} should close only after business state is durable`)
  assert.ok(!messages.some(([message]) => message.includes('仍在处理')))
 }
})
