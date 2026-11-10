// 用途：构造只携带业务坐标的报销单深链，由目标应用会话重新授权。
// 参数：claimID 为单据标识，projectID 为可选来源项目坐标。
// 返回值：具名内部路由，不包含任意返回URL或认证材料。
export function claimLocation(claimID, projectID = '') {
  return { name: 'reimbursement', params: { section: 'claims' }, query: {
    ...(claimID ? { claim_id: String(claimID) } : {}),
    ...(projectID ? { project_id: String(projectID) } : {}),
  } }
}

// 用途：仅接受单个来源项目标识构造受路由守卫控制的返回链接。
// 参数：query 为报销页面路由查询。
// 返回值：内部项目路由；缺少或畸形项目坐标时返回null。
export function returnProjectLocation(query) {
  const project = query?.project_id
  if (typeof project !== 'string' || !project.trim() || project.length > 128) return null
  return { name: 'project_management', params: { section: 'project_detail' }, query: { project } }
}

// 用途：校验服务端字段错误列表，保留费用行的准确字段坐标。
// 参数：details 为服务端field_errors数组。
// 返回值：有界可展示字段错误，不展开未知对象。
export function validationFields(details) {
  if (!Array.isArray(details)) return []
  return details.filter((row) => typeof row?.field === 'string' && typeof row?.message === 'string')
    .slice(0, 100).map((row) => ({ field: row.field, message: row.message }))
}
