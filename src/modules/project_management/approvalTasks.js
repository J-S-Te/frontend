const approvalCategories = new Set([
  'ROLLBACK_REQUESTED', 'ROLLBACK_APPROVED', 'ROLLBACK_REJECTED', 'ROLLBACK_WITHDRAWN',
  'REPORT_CORRECTION_REQUESTED', 'REPORT_CORRECTION_APPROVED', 'REPORT_CORRECTION_REJECTED',
])

// 用途：生成待办原处理页目标，并核对服务端目标未漂移到其他申请。
// 参数：task 为授权待办，origin 为当前来源；未提供来源时仅接受站内路径。
// 返回值：受控业务页路径；类型、业务坐标或目标不一致时返回空串。
export function approvalTaskTarget(task, origin = globalThis.window?.location?.origin) {
  const validID = (value) => typeof value === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
  if (!validID(task?.id)) return ''
  let section = 'approvals'
  let query = { request_id: task.id }
  if (task.type === 'SPECIAL_METHOD_REVIEW') {
    if (!validID(task.service_item_id)) return ''
    section = 'methods'; query = { service_item_id: task.service_item_id }
    if (task.id !== task.service_item_id) query.review_id = task.id
  } else if (task.type === 'FIELD_DEVIATION') {
    if (!validID(task.service_item_id)) return ''
    section = 'exceptions'; query = { service_item_id: task.service_item_id, deviation_id: task.id }
  } else if (task.type === 'NATIVE_SCOPE_CHANGE') {
    if (!validID(task.project_id)) return ''
    section = 'project_detail'; query = { project: task.project_id, scope_change_id: task.id }
  } else if (!['REPORT_REWORK', 'REPORT_CORRECTION', 'FIELD_ROLLBACK'].includes(task.type)) return ''
  const path = `/project_management/${section}`
  const params = new URLSearchParams(query)
  if (task.target_url) {
    try {
      const base = origin || 'https://notification.invalid'
      const url = new URL(task.target_url, base)
      if (url.origin !== base || url.username || url.password || url.hash || url.pathname !== path
        || [...url.searchParams].length !== [...params].length
        || [...params].some(([key, value]) => url.searchParams.get(key) !== value)) return ''
    } catch { return '' }
  }
  return `${path}?${params}`
}

// 用途：将可信项目审批提醒转换为受控详情路径，拒绝跨源或引用不一致的目标。
// 参数：item 为站内信元数据，代码字段兼容大小写与首尾空白；origin 为当前页面来源。
// 返回值：可交给路由的审批详情路径；来源、引用或目标不合法时返回空串。
export function projectApprovalTarget(item, origin) {
  const source = String(item?.source_application || '').trim().toUpperCase()
  const referenceType = String(item?.reference_type || '').trim().toUpperCase()
  const category = String(item?.category || '').trim().toUpperCase()
  if (source !== 'PROJECT_MANAGEMENT' || referenceType !== 'PROJECT_APPROVAL'
    || !approvalCategories.has(category)) return ''
  const id = String(item.reference_id || '')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id)) return ''
  try {
    const url = new URL(item.target_url, origin)
    const keys = [...url.searchParams.keys()]
    if (url.origin !== origin || url.username || url.password || url.hash
      || url.pathname !== '/project_management/approvals' || keys.length !== 1
      || keys[0] !== 'request_id' || url.searchParams.get('request_id') !== id) return ''
    return `/project_management/approvals?${new URLSearchParams({ request_id: id })}`
  } catch { return '' }
}

// 用途：展示审批申请的业务类型。
// 参数：type 为服务端返回的审批类型。
// 返回值：类型中文名；未知类型显示不可识别提示。
export function approvalTypeLabel(type) {
  return { REPORT_REWORK: '报告返工', REPORT_CORRECTION: '报告更正',
    FIELD_ROLLBACK: '现场回退', SPECIAL_METHOD_REVIEW: '特殊方法复核',
    FIELD_DEVIATION: '现场偏离评审', NATIVE_SCOPE_CHANGE: '原生委托范围变更' }[type] || '未知审批类型'
}

// 用途：展示申请的处理结果，保留已撤回与驳回的区别。
// 参数：status 为服务端返回的申请状态。
// 返回值：申请状态中文名。
export function approvalStatusLabel(status) {
  return { PENDING: '待审批', APPROVED: '已批准', REJECTED: '已驳回',
    WITHDRAWN: '已撤回' }[status] || '状态未知'
}

// 用途：展示各类申请原业务流程的审批职责。
// 参数：task 为服务端返回的申请，审批人标识可以为空。
// 返回值：原业务审批归属说明；未知类型提示核对归属。
export function approvalOwnerLabel(task) {
  if (['REPORT_REWORK', 'REPORT_CORRECTION', 'FIELD_ROLLBACK', 'SPECIAL_METHOD_REVIEW']
    .includes(task?.type)) return '技术总监'
  return { FIELD_DEVIATION: '具备偏离评审权限的人员',
    NATIVE_SCOPE_CHANGE: '技术总监 / 项目管理员' }[task?.type] || '审批归属待核对'
}
