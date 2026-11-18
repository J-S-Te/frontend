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

// 用途：根据真实责任链和能力校验结果展示分配子阶段，不改业务状态。
// 参数：item 为当前已授权服务项快照。
// 返回值：是否完成分配、阶段文案和进度；特殊方法复核独立处理。
export function allocationState(item) {
  if (!item?.team_lead_id) {
    return { complete: false, label: '待分配团队负责人', progress: 0 }
  }
  if (!item.project_manager_id || !(item.engineer_ids || []).length) {
    return { complete: false, label: '待分配执行团队', progress: 50 }
  }
  if (item.conflict_status === 'CONFLICT') {
    return { complete: false, label: '能力冲突', progress: 75 }
  }
  if (item.conflict_status !== 'PASSED') {
    return { complete: false, label: '待能力校验', progress: 75 }
  }
  return { complete: true, label: '已完成分配', progress: 100 }
}

// 用途：按当前权限筛出仍需办理的分配步骤，完成项自动退出队列。
// 参数：item 为服务项，executionAllowed/teamAllowed 分别为执行及团队分配权限。
// 返回值：当前账号仍能处理该项分配时为真；后续业务阶段一律为假。
export function isAllocationPending(item, executionAllowed = true, teamAllowed = true) {
  if (item?.status !== '待分配') return false
  if (!item.team_lead_id) return teamAllowed
  return executionAllowed && !allocationState(item).complete
}

// 与后端 CheckImplementationPlanPrecondition 保持同一业务门槛；团队负责人是形成
// 完整责任链的必要前置，不能只凭“待分配”状态提前出现在实施计划。
export function implementationPlanReady(item) {
  return item?.status === '待分配'
    && Boolean(item.team_lead_id && item.project_manager_id && (item.engineer_ids || []).length)
    && item.conflict_status === 'PASSED'
    && (item.special !== '是' || item.tech_review_status === 'APPROVED')
}
