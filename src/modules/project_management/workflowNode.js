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

// 用途：按责任链、能力校验和特殊方法复核判断服务项是否可制定实施计划。
// 参数：item 为当前已授权的服务项快照。
// 返回值：服务项在计划发布前且满足实施计划前置条件时为真。
export function implementationPlanReady(item) {
  return String(item?.status ?? '').trim() === '待分配'
    && allocationState(item).complete
    && (item.special !== '是' || item.tech_review_status === 'APPROVED')
}

// 用途：分流实施准备中的服务项，优先使用服务端完整历史得出的准备状态。
// 参数：item 为服务项，event 为旧版接口上的最近节点事件。
// 返回值：true 表示已确认准备，false 表示已退回待准备，null 表示来源未知。
export function serviceItemPreparationConfirmed(item, event) {
  if (typeof item.preparation_confirmed === 'boolean') return item.preparation_confirmed
  if (event?.type === 'PREPARATION_STARTED') return true
  if (event?.type === 'FIELD_RETURNED_TO_PREPARATION'
    || (event?.type === 'ROLLBACK_APPROVED' && event.payload?.kind === 'FIELD_TO_PREPARATION')) return false
  return null
}
