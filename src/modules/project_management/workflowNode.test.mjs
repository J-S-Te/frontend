import test from 'node:test'
import assert from 'node:assert/strict'
import { implementationPlanReady, projectAllowsWorkflowNode } from './workflowNode.js'

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
