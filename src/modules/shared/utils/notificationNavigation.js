import { NavigationFailureType } from 'vue-router'

// 用途：校验通知的站内目标，保留审批记录坐标并拒绝外站和路径控制字符。
// 参数：value 为服务端目标；origin 为当前站点来源，缺省取浏览器地址。
// 返回值：可导航的站内路径；缺失或不安全时返回空串。
export function safeNotificationTarget(value, origin = globalThis.window?.location?.origin) {
  if (typeof value !== 'string' || !value || /[\\\u0000-\u0020\u007f]/.test(value)) return ''
  const local = value.startsWith('/') && !value.startsWith('//')
  if (!local && (!origin || !/^https?:\/\//i.test(value))) return ''
  try {
    const base = origin || 'https://notification.invalid'
    const url = new URL(value, base)
    if (url.origin !== new URL(base).origin) return ''
    if (/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(url.pathname)) return ''
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return '' }
}

const contractApprovalCategories = new Set([
  'PENDING_APPROVAL', 'APPROVAL_REMINDER', 'APPROVAL_ASSIGNED', 'APPROVED', 'REJECTED',
])
const expenseApprovalCategories = new Set([
  'REIMBURSEMENT_APPROVAL_ASSIGNED', 'REIMBURSEMENT_APPROVAL_REMINDER',
])
const projectNotificationSections = {
  DEVIATION_REPORTED: 'exceptions', EXECUTION_TEAM_ASSIGNED: 'planning',
  IMPLEMENTATION_PLANNED: 'preparation', PREPARATION_STARTED: 'implementation',
  DECOMPOSITION_RETURNED: 'decomposition',
}

// 用途：核对项目审批引用，兼容旧偏离提醒原本支持的编码业务编号。
// 参数：value 为业务编号，legacy 为仅限旧 SERVICE_ITEM 偏离提醒的兼容开关。
// 返回值：编号可安全放入查询参数时为 true，空值或控制字符返回 false。
function projectNotificationID(value, legacy = false) {
  return typeof value === 'string' && (legacy
    ? !!value && value.length <= 128 && !/[\\\u0000-\u0020\u007f]/.test(value)
    : /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value))
}

// 用途：核对项目新审批及结果通知引用，历史缺目标时保留精确实例坐标。
// 参数：type/category/id 为通知业务引用，target 为已验证的站内目标。
// 返回值：已知类别的受控路径或拒绝空串；非此类通知返回 null。
function projectWorkflowNotificationTarget(type, category, id, target) {
  const references = {
    SPECIAL_METHOD_REVIEW_REQUESTED: ['SERVICE_ITEM'],
    SPECIAL_METHOD_REVIEWED: ['SPECIAL_METHOD_REVIEW', 'SERVICE_ITEM'],
    DEVIATION_REPORTED: ['DEVIATION', 'SERVICE_ITEM'], DEVIATION_REVIEWED: ['DEVIATION', 'SERVICE_ITEM'],
    NATIVE_SCOPE_CHANGE_REQUESTED: ['NATIVE_SCOPE_CHANGE'],
    NATIVE_SCOPE_CHANGE_APPROVED: ['NATIVE_SCOPE_CHANGE'], NATIVE_SCOPE_CHANGE_REJECTED: ['NATIVE_SCOPE_CHANGE'],
  }
  if (!references[category]) return null
  if (!references[category].includes(type)) return ''
  const legacy = type === 'SERVICE_ITEM' && category.startsWith('DEVIATION_')
  if (type === 'SERVICE_ITEM' && ['DEVIATION_REVIEWED', 'SPECIAL_METHOD_REVIEWED'].includes(category)) {
    const path = category === 'DEVIATION_REVIEWED' ? '/project_management/exceptions'
      : '/project_management/methods'
    if (!projectNotificationID(id, legacy)) return ''
    if (target) {
      const url = new URL(target, 'https://notification.invalid')
      if (url.pathname !== path || url.hash || [...url.searchParams].length !== 1
        || url.searchParams.get('service_item_id') !== id) return ''
    }
    // 旧结果只有服务项坐标，无法证明审批轮次；保留原页面入口，交由用户查看通知正文。
    return path
  }
  let section, key
  if (type === 'SERVICE_ITEM' && category === 'SPECIAL_METHOD_REVIEW_REQUESTED') {
    section = 'methods'; key = 'service_item_id'
  } else if (type === 'SERVICE_ITEM' && category === 'DEVIATION_REPORTED') {
    section = 'exceptions'; key = 'service_item_id'
  } else if (type === 'SPECIAL_METHOD_REVIEW' && category === 'SPECIAL_METHOD_REVIEWED') {
    section = 'methods'; key = 'review_id'
  } else if (type === 'DEVIATION' && ['DEVIATION_REPORTED', 'DEVIATION_REVIEWED'].includes(category)) {
    section = 'exceptions'; key = 'deviation_id'
  } else if (type === 'NATIVE_SCOPE_CHANGE' && ['NATIVE_SCOPE_CHANGE_REQUESTED',
    'NATIVE_SCOPE_CHANGE_APPROVED', 'NATIVE_SCOPE_CHANGE_REJECTED'].includes(category)) {
    section = 'project_detail'; key = 'scope_change_id'
  } else return null
  if (!projectNotificationID(id, legacy)) return ''
  const path = `/project_management/${section}`
  if (!target) return `${path}?${new URLSearchParams({ [key]: id })}`
  const url = new URL(target, 'https://notification.invalid')
  const allowed = key === 'service_item_id' ? ['service_item_id'] : { methods: ['service_item_id', 'review_id'],
    exceptions: ['service_item_id', 'deviation_id'],
    project_detail: ['project', 'scope_change_id'] }[section]
  // 旧范围变更结果只在链接中带项目编号，实际申请编号仍由通知引用提供。
  if (section === 'project_detail' && category !== 'NATIVE_SCOPE_CHANGE_REQUESTED'
    && url.pathname === path && !url.hash && [...url.searchParams].length === 1
    && projectNotificationID(url.searchParams.get('project'))) {
    url.searchParams.set(key, id)
    return `${path}${url.search}`
  }
  if (url.pathname !== path || url.hash || url.searchParams.get(key) !== id) return ''
  for (const [name, value] of url.searchParams) {
    if (!allowed.includes(name) || url.searchParams.getAll(name).length !== 1
      || !projectNotificationID(value, legacy)) return ''
  }
  return target
}

// 用途：把保留了真实业务引用的历史通知转换为现有业务页面坐标。
// 参数：item 为通知详情，target 为已验证的可选站内目标。
// 返回值：兼容后的路径；没有已知引用或目标时返回空串。
function referencedNotificationTarget(item, target) {
  const source = String(item.source_application || '').trim().toLowerCase()
  const type = String(item.reference_type || '').trim().toUpperCase()
  const category = String(item.category || '').trim().toUpperCase()
  const id = String(item.reference_id || '')
  if (source === 'project_management') {
    const controlled = projectWorkflowNotificationTarget(type, category, id, target)
    if (controlled !== null) return controlled
  }
  if (source === 'contract_management') {
    const legacy = target.match(/^\/contract_management\/(contracts|approvals)\/([^/?#]+)$/)
    const record = id || (legacy ? decodeURIComponent(legacy[2]) : '')
    if (record && (legacy || !target)) {
      const approval = type === 'APPROVAL' || legacy?.[1] === 'approvals'
      const section = approval || contractApprovalCategories.has(category) ? 'approvals' : 'contracts'
      return `/contract_management/${section}?${approval ? 'approval_id' : 'contract_id'}=${encodeURIComponent(record)}`
    }
  }
  if (source === 'reimbursement' && expenseApprovalCategories.has(category)
    && (!target || target.startsWith('/reimbursement/claims?'))) {
    const claim = id || new URL(target, 'https://notification.invalid').searchParams.get('claim_id')
    if (claim) return `/reimbursement/approvals?claim_id=${encodeURIComponent(claim)}`
  }
  if (source === 'customer_and_opportunity' && category === 'CREDIT_APPLICATION_PENDING') {
    const customer = id || new URL(target || '/', 'https://notification.invalid')
      .searchParams.get('customer_id')
    if (customer && (!target || target.startsWith('/customer-opportunity/customers?'))) {
      return `/customer-opportunity/credit-approvals?customer_id=${encodeURIComponent(customer)}`
    }
  }
  if (source === 'settlement' && id
    && (!target || target === '/settlement' || target === '/settlement/dunning')) {
    return missingNotificationTarget(source, type, category, id) || target
  }
  return target || missingNotificationTarget(source, type, category, id)
}

// 用途：仅为已知系统和业务引用补齐历史消息未保存的跳转目标。
// 参数：source/type/category 为通知来源及类别，id 为服务端保留的业务标识。
// 返回值：现有业务处理路径；未知引用返回空串。
function missingNotificationTarget(source, type, category, id) {
  if (!id) return ''
  const encoded = encodeURIComponent(id)
  if (source === 'project_management' && type === 'SERVICE_ITEM') {
    const section = projectNotificationSections[category]
      || (category.startsWith('REPORT_') ? 'reports'
        : category.startsWith('SPECIAL_METHOD_') ? 'methods' : 'inbox')
    return `/project_management/${section}?service_item_id=${encoded}`
  }
  if (source === 'project_management' && type === 'PROJECT') {
    if (category === 'SPLIT_RULE_MISSING') {
      return `/project_management/decomposition?project=${encoded}`
    }
    return `/project_management/project_detail?project=${encoded}`
  }
  if (source === 'platform' && type === 'PERSONNEL_CHANGE') {
    return `/settings/personnel?request_id=${encoded}`
  }
  if (source === 'data_analysis' && type === 'ALERT') {
    return `/data_analysis/alerts?alert_id=${encoded}`
  }
  if (source === 'settlement' && type === 'RECEIVABLE') {
    return `/settlement/dunning?receivable_id=${encoded}`
  }
  if (source === 'settlement' && type === 'RECEIVABLE_PLAN') {
    return `/settlement/receivables?plan_id=${encoded}`
  }
  return ''
}

// 用途：优先使用有效通知目标，兼容已知旧格式和缺少目标的真实业务引用。
// 参数：notification 为已授权通知；origin 为当前站点来源。
// 返回值：安全业务路径；非法目标或未知引用返回空串。
export function notificationTarget(notification, origin = globalThis.window?.location?.origin) {
  if (!notification) return ''
  const target = safeNotificationTarget(notification.target_url, origin)
  if (notification.target_url && !target) return ''
  try { return referencedNotificationTarget(notification, target) }
  catch { return '' }
}

// 用途：从已授权的通知直接进入关联业务，导航拒绝时保留可重试错误。
// 参数：notification 为真实通知详情；router 为执行权限守卫的路由实例。
// 返回值：有安全目标且已到达时为 true，无目标为 false；导航失败抛错。
export async function openNotificationTarget(notification, router) {
  const target = notificationTarget(notification)
  if (!target) return false
  const resolved = router.resolve?.(target)
  if (resolved && (!resolved.matched.length
    || resolved.matched.some(record => record.path.includes(':pathMatch')))) {
    throw new Error('关联页面未开放或链接已失效，请从业务待办重新选择。')
  }
  const failure = await router.push(target)
  if (failure && failure.type !== NavigationFailureType.duplicated) {
    throw new Error('无法进入关联页面，请检查访问权限后重试。')
  }
  if (resolved && router.currentRoute?.value.fullPath !== resolved.fullPath) {
    throw new Error('未能进入提醒关联页面，请核对访问权限或重新选择待办。')
  }
  return true
}
