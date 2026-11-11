// 用途：把界面北京业务时刻转换为UTC存储时刻，避免依赖浏览器所在地。
// 参数：day 为北京业务日，clock 为HH:mm。
// 返回值：RFC3339 UTC；非法时刻抛出可读错误。
export function metricInstant(day, clock) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(clock)) throw new Error('请填写完整北京业务日期和时刻')
  const value = new Date(`${day}T${clock}:00+08:00`)
  if (!Number.isFinite(value.getTime())) throw new Error('日期或时刻无效')
  return value.toISOString()
}

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

// 用途：仅显示明确容量的实际利用率，未知与零分母保持空值。
// 参数：actual 为确认分钟，capacity 为明确容量分钟。
// 返回值：百分比或null，不猜固定工作时长。
export function metricUtilization(actual, capacity) {
  if (!Number.isSafeInteger(actual) || actual < 0 || !Number.isSafeInteger(capacity) || capacity <= 0) return null
  return actual / capacity * 100
}
