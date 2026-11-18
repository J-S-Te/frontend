import test from 'node:test'
import assert from 'node:assert/strict'
import { implementationPlanReady, projectAllowsWorkflowNode } from './workflowNode.js'
import * as workflow from './workflowNode.js'
import { readFileSync } from 'node:fs'
import { computed, effectScope, nextTick, ref, watch } from 'vue'

const viewSource = readFileSync(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const assignedItem = {
  id: 'ready', project_id: 'P-QUEUE', status: '待分配', team_lead_id: 'lead',
  project_manager_id: 'manager', engineer_ids: ['engineer'], conflict_status: 'PASSED',
}

// 用途：执行真实页面的分配队列计算和选择清理，隔离外部请求。
// 参数：rows 为服务项快照，projectStatus 为父项目阶段，后两项为执行及团队分配权限。
// 返回值：可刷新的快照、真实队列与选择状态及测试清理作用域。
function allocationQueueState(rows, projectStatus = '待分配', executionAllowed = true, teamAllowed = true) {
  const scope = effectScope()
  const state = {
    projects: ref([{ id: 'P-QUEUE', status: projectStatus }]), serviceItems: ref(rows),
    canExecutionAssign: ref(executionAllowed), canAssignTeam: ref(teamAllowed),
    selectedServiceItemIDs: ref(rows.map(row => row.id)),
    activeSection: ref('allocation'), loading: ref(false),
    sectionExtrasLoading: ref(false), workspaceReady: ref(true),
  }
  const context = { ...workflow, ...state, computed, watch }
  const start = viewSource.indexOf('const projectByID = computed(')
  const code = viewSource.slice(start, viewSource.indexOf('\nconst selectedServiceItems', start))
  const otherQueues = ['inboxItems', 'assignmentItems'].map(name => {
    const index = viewSource.indexOf(`const ${name} = computed(`)
    return viewSource.slice(index, viewSource.indexOf('\n', index))
  }).join('\n')
  const queues = scope.run(() => new Function(...Object.keys(context),
    `${code}\n${otherQueues}\nreturn { pending: allocationItems, inbox: inboxItems, assignments: assignmentItems }`)(
    ...Object.values(context)))
  const selectionStart = viewSource.indexOf('watch([activeSection, activeNodeItems, loading,')
  const selection = viewSource.slice(selectionStart, viewSource.indexOf('// 会话权限', selectionStart))
  const selectionContext = { ...context, activeNodeItems: queues.pending }
  scope.run(() => new Function(...Object.keys(selectionContext), selection)(
    ...Object.values(selectionContext)))
  return { ...state, ...queues, scope }
}

test('回退到拆解的项目只属于拆解节点，不得泄漏到任何后续工作区', () => {
  assert.equal(projectAllowsWorkflowNode('待拆解确认', 'decomposition'), true)
  for (const node of ['allocation', 'inbox', 'assignments', 'methods', 'planning', 'preparation', 'implementation', 'exceptions', 'reports']) {
    assert.equal(projectAllowsWorkflowNode('待拆解确认', node), false, `待拆解确认项目不应出现在 ${node}`)
  }
})

test('各业务节点只接受与自身阶段相符的项目状态', () => {
  assert.equal(projectAllowsWorkflowNode('待分配', 'planning'), true)
  assert.equal(projectAllowsWorkflowNode('待实施', 'preparation'), true)
  assert.equal(projectAllowsWorkflowNode('实施准备中', 'implementation'), true)
  assert.equal(projectAllowsWorkflowNode('异常处理中', 'exceptions'), true)
  assert.equal(projectAllowsWorkflowNode('报告编制', 'reports'), true)
  assert.equal(projectAllowsWorkflowNode('报告编制', 'implementation'), false)
  assert.equal(projectAllowsWorkflowNode('实施中', 'planning'), false)
})

test('实施计划只接收已完成责任分配、能力校验和特殊方法复核的服务项', () => {
  const ready = { status: '待分配', team_lead_id: 'lead', project_manager_id: 'manager', engineer_ids: ['engineer'], conflict_status: 'PASSED', special: '否', tech_review_status: 'NONE' }
  assert.equal(implementationPlanReady(ready), true)
  assert.equal(implementationPlanReady({ ...ready, team_lead_id: '' }), false)
  assert.equal(implementationPlanReady({ ...ready, project_manager_id: '' }), false)
  assert.equal(implementationPlanReady({ ...ready, engineer_ids: [] }), false)
  assert.equal(implementationPlanReady({ ...ready, conflict_status: 'UNCHECKED' }), false)
  assert.equal(implementationPlanReady({ ...ready, special: '是', tech_review_status: 'PENDING' }), false)
  assert.equal(implementationPlanReady({ ...ready, special: '是', tech_review_status: 'APPROVED' }), true)
})

test('分配完成依据责任链和能力通过，特殊方法复核仍独立等待', () => {
  assert.deepEqual(workflow.allocationState?.(assignedItem), {
    complete: true, label: '已完成分配', progress: 100,
  })
  const pendingReview = { ...assignedItem, special: '是', tech_review_status: 'PENDING' }
  assert.equal(workflow.isAllocationPending?.(pendingReview, true), false)
  assert.equal(implementationPlanReady(pendingReview), false)
})

test('待分配阶段区分人员缺项、能力冲突与未校验，不以已填写经理作为完成', () => {
  for (const [changes, label, progress] of [
    [{ team_lead_id: '' }, '待分配团队负责人', 0],
    [{ project_manager_id: '' }, '待分配执行团队', 50],
    [{ engineer_ids: [] }, '待分配执行团队', 50],
    [{ conflict_status: 'CONFLICT' }, '能力冲突', 75],
    [{ conflict_status: 'UNCHECKED' }, '待能力校验', 75],
  ]) {
    const item = { ...assignedItem, ...changes }
    assert.deepEqual(workflow.allocationState?.(item), { complete: false, label, progress })
    assert.equal(workflow.isAllocationPending?.(item, true), true)
  }
})

test('分配队列按现有权限保留待办，不把后续业务阶段拉回分配', () => {
  const teamOnly = { ...assignedItem, project_manager_id: '', engineer_ids: [] }
  assert.equal(workflow.isAllocationPending?.(teamOnly, false), false)
  assert.equal(workflow.isAllocationPending?.(teamOnly, true), true)
  assert.equal(workflow.isAllocationPending?.({ ...teamOnly, team_lead_id: '' }, false), true)
  assert.equal(workflow.isAllocationPending?.(assignedItem, true), false)
  assert.equal(workflow.isAllocationPending?.({ ...teamOnly, status: '待实施' }, true), false)
  assert.equal(workflow.isAllocationPending?.({ ...teamOnly, team_lead_id: '' }, true, false), false)
  assert.equal(workflow.isAllocationPending?.(teamOnly, true, false), true)
  assert.equal(workflow.isAllocationPending?.(teamOnly, false, false), false)
})

test('真实队列在权威刷新后移出完成项并同步清选，保留能力冲突及业务状态', async () => {
  const pending = { ...assignedItem, id: 'pending', project_manager_id: '', engineer_ids: [] }
  const conflict = { ...assignedItem, id: 'conflict', conflict_status: 'CONFLICT' }
  const state = allocationQueueState([pending, conflict, assignedItem])
  try {
    assert.deepEqual(state.pending.value.map(item => item.id), ['pending', 'conflict'])
    state.serviceItems.value = [{ ...assignedItem, id: 'pending' }, conflict, assignedItem]
    await nextTick()
    assert.deepEqual(state.pending.value.map(item => item.id), ['conflict'])
    assert.deepEqual(state.selectedServiceItemIDs.value, ['conflict'])
    assert.equal(state.serviceItems.value[0].status, '待分配')
  } finally { state.scope.stop() }
})

test('已退回拆解的父项目仍整体退出分配队列', () => {
  const state = allocationQueueState([{ ...assignedItem, team_lead_id: '' }], '待拆解确认')
  try { assert.deepEqual(state.pending.value, []) }
  finally { state.scope.stop() }
})

test('团队分配待办完成不应清空收件箱和能力处理节点的阶段候选', () => {
  const item = { ...assignedItem, project_manager_id: '', engineer_ids: [], conflict_status: 'UNCHECKED' }
  const state = allocationQueueState([item], '待分配', false, true)
  try {
    assert.deepEqual(state.pending.value, [])
    assert.deepEqual(state.inbox.value.map(row => row.id), ['ready'])
    assert.deepEqual(state.assignments.value.map(row => row.id), ['ready'])
  } finally { state.scope.stop() }
})
