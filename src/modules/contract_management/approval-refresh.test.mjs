import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { computed, ref } from 'vue'
import { useApprovalDetail } from './composables/useApprovalDetail.js'
import { createRequestScope } from '../platform/shared/composables/requestScope.js'
import { hasContractPermission } from '../shared/authz/sys004.js'
import { approvalKindLabel } from './utils/contractDisplay.js'
import { formatContractDate } from './utils/contractBusinessTime.js'
import { contractApprovalViewParts } from '../../test/helpers/contractApprovalView.mjs'

// 用途：提供真实接口形状的合成流程详情，区分流程running与任务active。
// 参数：status为流程状态，revision为当前节点版本。
// 返回值：不包含任何真实合同数据的审批详情。
function approvalDetail(status = 'running', revision = 4) {
  return { meta: { id: 'approval', applicant_user_id: 'applicant', kind: 'contract_approval' },
    state: { status, current_node_index: 0, nodes: [{ node: {
      id: 'current-node', name: '合成审批节点', role_code: 'sales_director',
    }, status: 'active', revision }] }, contract: { status: 'pending' }, actions: [] }
}

// 用途：执行真实轮询、归一化、按钮计算和命令函数，仅替换会话与HTTP边界。
// 参数：options为待办记录和流程详情。
// 返回值：可调用的真实状态/方法及发送命令记录。
function harness({ tasks, detail = approvalDetail() } = {}) {
  const calls = []
  const session = ref({ user_id: 'reviewer', roles: ['sales_director'],
    permissions: ['approval.view', 'approval.process'] })
  // 用途：返回合成详情及已受理命令的持久化记录。
  // 参数：无。
  // 返回值：审批详情；仅命令实际发出后追加对应动作。
  const getApproval = async () => ({ ...detail,
    actions: calls.length ? [{ command_id: 'accepted' }] : [] })
  const ui = useApprovalDetail({ getApproval, previewApprovalContract: async () => ({}),
    commandApproval: async (...args) => { calls.push(args); return { command_id: 'accepted' } },
    can: permission => hasContractPermission(session.value, permission), session,
    showToast: () => {}, formatUserError: String, refreshApprovalRealtime: async () => {} })
  ui.selectedApproval.value = { id: 'approval', status: 'active', step: '合成审批节点' }
  ui.approvalDetail.value = detail
  const context = { ...ui, ref, computed, hasContractPermission, session, formatContractDate,
    approvalKindLabel, currentUserLabel: ref('合成审批人'), userDirectory: ref([]),
    activeSection: ref('approvals'), route: { query: {} }, document: { visibilityState: 'visible' },
    approvalRealtimeScope: createRequestScope(), approvalRealtimeBusy: false,
    approvalRealtimePending: false, approvals: ref([]), approvalsKnown: ref(false),
    initiatedApprovals: ref([]), listApprovals: async () => [], getApproval,
    listApprovalTasks: async () => tasks ?? [{ approval_id: 'approval', status: 'active',
      node_name: '合成审批节点', node_id: 'current-node' }],
  }
  const parts = contractApprovalViewParts()
  const actual = vm.runInNewContext(parts.functions + '\n' + parts.bindings
    + '\n;({refreshApprovalRealtime,canActOnApproval,processApproval})', context)
  return { ...ui, ...actual, calls }
}

test('流程running轮询不覆盖本人active任务，节点名称保留，点击仍发送同意而非评论', async () => {
  const ui = harness()
  await ui.refreshApprovalRealtime()
  assert.equal(ui.selectedApproval.value.status, 'active')
  assert.equal(ui.selectedApproval.value.step, '合成审批节点')
  assert.equal(ui.canActOnApproval.value, true)
  await ui.processApproval('approve')
  assert.deepEqual(ui.calls.map(row => row[1]), ['approve'])
  assert.equal(ui.calls[0][2].origin_node_id, 'current-node')
  assert.equal(ui.calls[0][2].origin_node_revision, 4)
})

test('未到达或已不属于当前账号的任务不被running流程重新激活', async () => {
  for (const tasks of [[], [{ approval_id: 'approval', status: 'pending', node_name: '后续节点' }]]) {
    const ui = harness({ tasks })
    await ui.refreshApprovalRealtime()
    assert.equal(ui.selectedApproval.value.status, 'pending')
    assert.equal(ui.canActOnApproval.value, false)
    await ui.processApproval('approve')
    assert.equal(ui.calls.length, 0)
  }
})

test('流程已到终态或历史不可用时，陈旧active待办不能保留审批按钮', async () => {
  for (const status of ['approved', 'rejected', 'withdrawn', 'expired', 'failed']) {
    const ui = harness({ detail: approvalDetail(status) })
    await ui.refreshApprovalRealtime()
    assert.equal(ui.canActOnApproval.value, false)
    await ui.processApproval('approve')
    assert.equal(ui.calls.length, 0)
  }
  const ui = harness({ detail: { ...approvalDetail(), state_unavailable: true } })
  await ui.refreshApprovalRealtime()
  assert.equal(ui.canActOnApproval.value, false)
  await ui.processApproval('approve')
  assert.equal(ui.calls.length, 0)
})
