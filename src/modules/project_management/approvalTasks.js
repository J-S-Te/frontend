const approvalCategories = new Set([
  'ROLLBACK_REQUESTED', 'ROLLBACK_APPROVED', 'ROLLBACK_REJECTED', 'ROLLBACK_WITHDRAWN',
  'REPORT_CORRECTION_REQUESTED', 'REPORT_CORRECTION_APPROVED', 'REPORT_CORRECTION_REJECTED',
])

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
    FIELD_ROLLBACK: '现场回退' }[type] || '未知审批类型'
}

// 用途：展示申请的处理结果，保留已撤回与驳回的区别。
// 参数：status 为服务端返回的申请状态。
// 返回值：申请状态中文名。
export function approvalStatusLabel(status) {
  return { PENDING: '待审批', APPROVED: '已批准', REJECTED: '已驳回',
    WITHDRAWN: '已撤回' }[status] || '状态未知'
}

// 用途：展示现场回退、报告返工和报告更正的技术总监审批职责。
// 参数：task 为服务端返回的申请，审批人标识可以为空。
// 返回值：已知申请类型显示技术总监；未知类型提示核对归属。
export function approvalOwnerLabel(task) {
  return ['REPORT_REWORK', 'REPORT_CORRECTION', 'FIELD_ROLLBACK'].includes(task?.type)
    ? '技术总监' : '审批归属待核对'
}
