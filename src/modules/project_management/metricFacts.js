// 用途：创建一次业务命令的稳定操作号。
// 参数：无。
// 返回值：浏览器原生安全随机UUID。
export function metricOperationKey() { return globalThis.crypto.randomUUID() }

// 用途：根据真实轮次和会话动作判断审核可操作状态。
// 参数：round 为真实审核轮次，session 为当前授权会话。
// 返回值：当前人员有明确审核动作且与编制/提交人独立时为true。
export function canDecideMetricReport(round, session) {
  return round?.decision === 'PENDING' && !!session?.permissions?.includes('project.report.review')
    && !!session.user_id && ![round.prepared_by, round.submitted_by].includes(session.user_id)
}
