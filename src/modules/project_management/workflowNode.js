const workflowProjectStatuses = Object.freeze({
  decomposition: new Set(['待拆解确认', '补充协议处理中']),
  allocation: new Set(['待分配']),
  inbox: new Set(['待分配']),
  assignments: new Set(['待分配']),
  methods: new Set(['待分配']),
  planning: new Set(['待分配']),
  preparation: new Set(['待实施', '实施准备中']),
  implementation: new Set(['实施准备中', '实施中']),
  exceptions: new Set(['异常处理中']),
  reports: new Set(['现场实施完成', '报告编制', '已完成']),
})

// 工作区必须先通过项目的服务端派生状态门禁，再判断单个服务项。这样任一服务项
// 退回拆解导致项目降级后，项目内残留的较晚状态服务项也不会继续泄漏到后续节点。
export function projectAllowsWorkflowNode(projectStatus, node) {
  return workflowProjectStatuses[node]?.has(String(projectStatus || '').trim()) || false
}

// 与后端 CheckImplementationPlanPrecondition 保持同一业务门槛；团队负责人是形成
// 完整责任链的必要前置，不能只凭“待分配”状态提前出现在实施计划。
export function implementationPlanReady(item) {
  return item?.status === '待分配'
    && Boolean(item.team_lead_id && item.project_manager_id && (item.engineer_ids || []).length)
    && item.conflict_status === 'PASSED'
    && (item.special !== '是' || item.tech_review_status === 'APPROVED')
}
