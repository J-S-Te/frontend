import test from 'node:test'
import assert from 'node:assert/strict'
import * as module from './notificationApproval.js'

test('合同审批通知按精确审批标识重新读取本人待办，保留真实可操作状态', async () => {
  const queries = []
  const result = await module.resolveNotificationApproval({ approval_id: 'approval' }, {
    canProcess: true,
    listApprovalTasks: async (params) => { queries.push(params); return [
      { approval_id: 'approval', contract_id: 'contract', status: 'active' }] },
    listApprovals: async () => { throw new Error('不需要读取发起列表') },
  })
  assert.equal(result?.approval?.status, 'active')
  assert.deepEqual(queries, [{ limit: 200, approval_id: 'approval' }])
})

test('合同历史通知按合同过滤后再选择审批，多个流程要求选择，不能猜记录', async () => {
  let query
  const result = await module.resolveNotificationApproval({ contract_id: 'contract' }, {
    canProcess: true,
    listApprovalTasks: async (params) => { query = params; return [
      { approval_id: 'a', contract_id: 'contract', status: 'active' },
      { approval_id: 'b', contract_id: 'contract', status: 'pending' }] },
    listApprovals: async () => [],
  })
  assert.deepEqual(query, { limit: 200, contract_id: 'contract' })
  assert.equal(result?.approval, null)
  assert.equal(result?.tasks.length, 2)
})

test('已处理的合同审批只读打开详情，迟到的旧通知查询不替换新记录', async () => {
  const detail = await module.resolveNotificationApproval({ approval_id: 'done' }, {
    canProcess: false, listApprovals: async () => [],
  })
  assert.equal(detail?.approval?.approval_id, 'done')
  assert.notEqual(detail?.approval?.status, 'active')
  const stale = await module.resolveNotificationApproval({ contract_id: 'old' }, {
    canProcess: true, listApprovalTasks: async () => [], listApprovals: async () => [],
    isCurrent: () => false,
  })
  assert.equal(stale, null)
})

test('旧合同结果提醒不能被同一合同后来新增的唯一当前待办劫持', async () => {
  const result = await module.resolveNotificationApproval({ contract_id: 'contract' }, {
    canProcess: true,
    listApprovalTasks: async () => [{ approval_id: 'new', contract_id: 'contract', status: 'active' }],
    listApprovals: async () => [
      { approval_id: 'old', contract_id: 'contract', status: 'approved' },
      { approval_id: 'new', contract_id: 'contract', status: 'running' },
    ],
  })
  assert.equal(result.approval, null)
  assert.equal(result.summaries.length, 2)
})

test('合同历史摘要与当前任务重叠时保留本人active节点及可处理状态', async () => {
  const result=await module.resolveNotificationApproval({contract_id:'contract'},{
    canProcess:true,
    listApprovalTasks:async()=>[{approval_id:'a',contract_id:'contract',status:'active',node_id:'node'}],
    listApprovals:async()=>[{approval_id:'a',contract_id:'contract',status:'running'}],
  })
  assert.equal(result.approval.status,'active')
  assert.equal(result.approval.node_id,'node')
  assert.equal(result.summaries[0].status,'active')
})
