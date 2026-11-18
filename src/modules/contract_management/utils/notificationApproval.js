// 用途：提取通知中的单值审批坐标，防止重复参数被误当作业务标识。
// 参数：query 为路由查询参数。
// 返回值：已校验的合同和审批筛选；非法坐标抛出可理解错误。
export function notificationApprovalFilters(query) {
  const result = {}
  for (const key of ['approval_id', 'contract_id']) {
    const value = query[key]
    if (value === undefined || value === '') continue
    if (typeof value !== 'string' || value.length > 128 || /[\u0000-\u0020]/.test(value)) {
      throw new Error('通知中的合同或审批标识无效，请从审批中心重新选择。')
    }
    result[key] = value
  }
  return result
}

// 用途：重新读取通知关联的授权审批，兼容只有合同标识的历史提醒。
// 参数：query 为通知坐标；依赖包含本人待办、授权审批接口和请求有效性判断。
// 返回值：唯一审批及候选集合；多流程不猜选，失效请求返回 null。
export async function resolveNotificationApproval(query, {
  canProcess, listApprovalTasks, listApprovals, isCurrent = () => true,
}) {
  const filters = notificationApprovalFilters(query)
  if (!Object.keys(filters).length) return null
  const params = { limit: 200, ...filters }
  const matches = (row) => (!filters.approval_id || row.approval_id === filters.approval_id)
    && (!filters.contract_id || row.contract_id === filters.contract_id)
  const tasks = canProcess ? (await listApprovalTasks(params)).filter(matches) : []
  if (!isCurrent()) return null
  const summaries = tasks.length && filters.approval_id
    ? [] : (await listApprovals(params)).filter(matches)
  if (!isCurrent()) return null
  const byID = new Map()
  for (const row of [...summaries, ...tasks]) {
    byID.set(row.approval_id, { ...byID.get(row.approval_id), ...row })
  }
  const candidates = [...byID.values()]
  const approval = candidates.length === 1 ? candidates[0]
    : !candidates.length && filters.approval_id
      ? { approval_id: filters.approval_id, contract_id: filters.contract_id, status: 'pending' } : null
  return { approval, tasks, summaries: summaries.map(row => byID.get(row.approval_id)) }
}
