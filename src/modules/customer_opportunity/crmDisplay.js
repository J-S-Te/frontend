// CRM 页面的展示层纯函数与常量：由 CustomerOpportunityView.vue 批次 3 第一步逐字迁移，
// 行为契约由 crmDisplay.test.mjs 固化；页面通过 import 继续以原绑定名使用。

// 客户行业由业务字典治理（平台控制台“字典管理”维护），取值即业务存储字符串；
// 平台会话过期或字典未配置时回退内置清单，表单不中断。
export const fallbackCustomerIndustryOptions = Object.freeze([
  '金融', '政府', '医疗', '教育', '能源', '制造', '软件', '互联网', '通信',
  '物流', '交通', '建筑', '房地产', '零售', '服务', '其他',
])

export const customerImportTemplateColumns = Object.freeze([
  ['客户名称', '示例科技有限公司'], ['统一社会信用代码', '913100001234567890'], ['客户类型', '企业'], ['行业', '软件'], ['区域', '华东'],
  ['登记联系人姓名', '张三'], ['登记联系人电话', '13800138000'], ['登记联系人邮箱', 'zhangsan@example.com'],
])

export const presaleEligibleOpportunityStages = new Set(['初步接触', '需求沟通', '方案制定', '报价', '投标'])

export const presaleEligibilityMessage = '只能为处于跟进中的初步接触、需求沟通、方案制定、报价或投标阶段商机发起售前支持。商机阶段不会自动调整。'

export const crmRoleNames = Object.freeze({
  sales: '销售人员',
  sales_director: '销售总监',
  crm_super_admin: '客户与商机超级管理员',
  technical_director: '技术总监',
  team_lead: '团队负责人',
  technician: '技术人员',
  // 历史授权/指派记录仍可能带旧编码，但页面统一显示合并后的角色名称。
  implementation_engineer: '技术人员',
  technical_lead: '技术总监',
  customer_admin: '客户管理员',
  auditor: '审计员',
})

export const CREDIT_APPLICATION_ROLES = new Set(['sales'])

export const CREDIT_APPROVAL_ROLES = new Set(['sales_director', 'crm_super_admin'])

export const customerTypeSuggestions = Object.freeze(['业主', '三方', '集成商', '代理商', '渠道', '其他'])

export const customerRegionSuggestions = Object.freeze(['华北', '华东', '华南', '华中', '西南', '西北', '东北', '海外', '其他'])

export const customerStatusOptions = Object.freeze([{ value: 'ACTIVE', label: '有效' }, { value: 'VOID', label: '已作废' }, { value: 'MERGED', label: '已合并' }])

export const opportunityStatusOptions = Object.freeze([{ value: 'FOLLOWING', label: '跟进中' }, { value: 'CLOSED', label: '已关闭' }, { value: 'VOID', label: '已作废' }])

export const opportunityStageOptions = Object.freeze(['初步接触', '需求沟通', '方案制定', '报价', '投标', '已签约', '失败'])

export function isPresaleEligibleOpportunity(opportunity) {
  return opportunity?.opp_status === 'FOLLOWING' && presaleEligibleOpportunityStages.has(opportunity?.current_stage)
}

export const creditLevelLabel = (value) => ({ A: 'A · 优秀', B: 'B · 良好', C: 'C · 关注', D: 'D · 差' })[String(value || 'B').toUpperCase()] || 'B · 良好'

export const hasCreditApprovalAccess = (session) => (session?.permissions || []).includes('customer.credit.approve') || (session?.roles || []).some((role) => CREDIT_APPROVAL_ROLES.has(role))

export function defaultReportFilters() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return { from: formatDateTimeLocal(start), to: formatDateTimeLocal(end), organization_id: '', person_id: '', opportunity_id: '', dimension: 'PERSON' }
}

export function formatDateTimeLocal(value) {
  const pad = (part) => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
}

export function emptyCustomer() {
  return { name: '', unified_credit_code: '', customer_type: '', industry: '', region: '', owner_user_id: '', owner_org_id: '', reason: '', duplicate_override: false, duplicate_override_reason: '', contacts: [{ id: 0, name: '', phone: '', email: '', is_registration: true }] }
}

export function emptyStakeholder() {
  return { id: 0, name: '', role_title: '', influence: 'MEDIUM', relationship_summary: '', phone: '', email: '', replace_phone: false, replace_email: false }
}

export function emptyInformationSystem() {
  return { name: '', protection_level: 'LEVEL_2', application_scenario: '', filing_no: '', grading_date: '', filing_status: 'NOT_FILED' }
}

export function influenceText(value) { return ({ LOW: '低', MEDIUM: '中', HIGH: '高' })[value] || value }

export function protectionLevelText(value) { return ({ LEVEL_1: '一级', LEVEL_2: '二级', LEVEL_3: '三级', LEVEL_4: '四级', LEVEL_5: '五级' })[value] || value }

export function filingStatusText(value) { return ({ NOT_FILED: '未备案', FILING: '备案中', FILED: '已备案' })[value] || value }

export function importRowStatusText(value) { return ({ READY: '可导入', WARNING: '警告（本次跳过）', ERROR: '错误', IMPORTED: '已导入', FAILED: '导入失败' })[value] || value }

export function projectStatusText(value) { return ({ PLANNED: '计划中', IN_PROGRESS: '进行中', ON_HOLD: '已暂停', COMPLETED: '已完成', CANCELLED: '已取消' })[value] || value || '—' }

export function projectProgressText(value) {
  const progress = Number(value)
  return Number.isFinite(progress) && progress >= 0 && progress <= 100 ? `${progress}%` : '—'
}

export function emptyOpportunity() {
  return { name: '', customer_id: '', type: '', source: '', type_ids: [], source_ids: [], expected_amount: '', expected_sign_date: '', requirement_summary: '', system_count: 0, pain_points: '', competitor_info: '', owner_user_id: '', owner_org_id: '', reason: '' }
}

export function mergeCatalogOptions(available, selected) {
  const values = new Map((available || []).map((item) => [Number(item.id), item]))
  for (const item of selected || []) values.set(Number(item.id), item)
  return [...values.values()].sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0) || Number(left.id) - Number(right.id))
}

export function catalogSelectionIDs(structured, legacy, options) {
  if (Array.isArray(structured) && structured.length) return [...new Set(structured.map((item) => Number(item.id)).filter(Boolean))]
  const names = new Set(String(legacy || '').split('、').map((item) => item.trim()).filter(Boolean))
  return options.filter((item) => names.has(item.name)).map((item) => Number(item.id))
}

export function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function portalInviteStatusText(value) {
  return ({ PENDING: '待激活', USED: '已使用', EXPIRED: '已过期', REVOKED: '已撤销' })[value] || value || '尚未生成'
}

export function assignees(value) { return (value || []).map((item) => item.person_name || '未命名执行人').join('、') || '未指派' }
// 指派接口采用全量替换语义；以当前指派为基线计算差异，可让已停用或不在本次目录结果中的人员
// 被明确保留或移出，避免一次目录筛选把仍有效的既有指派静默删除。

export function customerStatusText(value) {
  return ({ ACTIVE: '有效', VOID: '已作废', MERGED: '已合并' })[value] || value || '—'
}

export function opportunityStatusText(value) {
  return ({ FOLLOWING: '跟进中', CLOSED: '已关闭', VOID: '已作废' })[value] || value || '—'
}

export function terminalPendingText(value) {
  return value === 'CONTRACT' ? '待关联合同' : value === 'LOST_REASON' ? '待补失败原因' : '无'
}

export function formatAmount(value) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''))
  if (!Number.isFinite(number)) return '—'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)
}

export function platformUserName(item) {
  return String(item?.display_name || item?.username || item?.account_name || '').trim() || '未命名用户'
}

// 历史数据和旧审批回调可能把内部 user_id 误写进“姓名快照”。这类值不能优先于
// 基础平台目录，否则时间线会在目录已成功解析后仍向业务用户暴露内部 ID。
export function usableOperationName(snapshot, userId) {
  const value = String(snapshot || '').trim()
  return value && value !== String(userId || '').trim() ? value : ''
}

export function requestStatusText(value) {
  return ({ APPROVAL_STARTING: '审批发起中', PENDING_APPROVAL: '待审批', APPROVED_PENDING_ASSIGNMENT: '审批通过，待指派', PENDING_EXECUTION_ASSIGNMENT: '待执行指派', EXECUTING: '执行中', COMPLETED: '已完成', REJECTED: '已驳回', CANCELLED: '已取消' })[value] || '未知状态'
}

export function venueText(value) { return ({ REMOTE: '远程', ONSITE: '现场' })[value] || '未知场地' }

export function urgencyText(value) { return ({ NORMAL: '普通', URGENT: '紧急' })[value] || '未知级别' }

export function presaleOpportunityLabel(item) {
  const name = String(item?.opportunity_name || '').trim()
  const number = String(item?.opportunity_no || '').trim()
  if (name && number) return `${name}（${number}）`
  return name || number || '—'
}
// 看板和列表都应使用服务端返回的申请主键；兼容旧版接口曾返回 request_id 的响应，
// 避免卡片点击时把 undefined 传给详情接口而表现为“点击无反应”。

// 看板和列表都应使用服务端返回的申请主键；兼容旧版接口曾返回 request_id 的响应，
// 避免卡片点击时把 undefined 传给详情接口而表现为“点击无反应”。
export function presaleRequestID(item) {
  return item?.id ?? item?.request_id ?? item?.request?.id ?? ''
}

export function pushStatusText(value) {
  return ({ PENDING: '历史待处理', SENDING: '历史处理中', SUCCESS: '已记录', RETRY_WAIT: '历史待重试', DEAD_LETTER: '历史异常' })[value] || '未知状态'
}

export function presaleOptionText(group, item) {
  if (group === 'statuses') return requestStatusText(item.value)
  if (group === 'venues') return venueText(item.value)
  if (group === 'urgencies') return urgencyText(item.value)
  if (group === 'push_statuses') return pushStatusText(item.value)
  return item.label || item.value
}

export function actionText(value) {
  return ({ APPROVE: '通过审批', REJECT: '驳回审批', ASSIGN: '指派执行人', ADD_PROGRESS: '登记进度', ADD_WORKLOG: '登记工时', COMPLETE: '结束进度', CANCEL: '取消申请' })[value] || '未知操作'
}

export function timelineEventText(value) {
  return ({ REQUEST_CREATED: '售前申请已创建', STATUS_CHANGED: '任务状态已变更', APPROVAL_DECIDED: '审批已处理', ASSIGNEE_ADDED: '已加入执行人', ASSIGNEE_REMOVED: '已移出执行人', PROGRESS_ADDED: '已登记进度', WORKLOG_ADDED: '已登记工时' })[value] || '流程记录'
}

export function timelineEventMeta(value) {
  return ({
    REQUEST_CREATED: { icon: '建', stage: '发起', tone: 'created' },
    STATUS_CHANGED: { icon: '流', stage: '流转', tone: 'status' },
    APPROVAL_DECIDED: { icon: '审', stage: '审批', tone: 'approval' },
    ASSIGNEE_ADDED: { icon: '人', stage: '指派', tone: 'assignment' },
    ASSIGNEE_REMOVED: { icon: '人', stage: '调整', tone: 'assignment' },
    PROGRESS_ADDED: { icon: '进', stage: '进度', tone: 'progress' },
    WORKLOG_ADDED: { icon: '时', stage: '工时', tone: 'worklog' },
  })[value] || { icon: '记', stage: '记录', tone: 'default' }
}

export function approvalResultText(value) {
  return ({ PASS: '通过', APPROVED: '通过', REJECT: '驳回', REJECTED: '驳回' })[value] || '已处理'
}

export function workContentText(value) {
  return ({ SOLUTION_DESIGN: '方案设计', TECH_EXCHANGE: '技术交流', POC_DEMO: 'POC 演示', TECH_QA: '技术答疑', OTHER: '其他' })[value] || '其他工作'
}

export function safeHTTPSURL(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' ? parsed.href : ''
  } catch { return '' }
}

export function alertTypeText(type) { return ({ APPROVAL_NODE_1_OVERDUE: '节点 1 审批超时', APPROVAL_NODE_2_OVERDUE: '节点 2 审批超时', ASSIGNMENT_OVERDUE: '待指派超时', EXECUTION_ASSIGNMENT_OVERDUE: '待团队负责人指派超时', EXECUTION_DUE_SOON: '执行截止提前提醒', EXECUTION_OVERDUE: '执行超期' })[type] || type }

export function stageAlertStatusText(status) {
  return ({ PENDING: '待处理', UNREAD: '已触发（未读）', READ: '已触发（已读）', CANCELLED: '已取消' })[status] || status
}

export function reportDateParam(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('请输入有效的报表时间范围。')
  return date.toISOString()
}

export function normalizeReportSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return {
    work_hours: value.work_hours ?? '0.00',
    participant_count: value.participant_count ?? 0,
    auto_completed_task_count: value.auto_completed_task_count ?? 0,
    opportunity_coverage_rate_percent: value.opportunity_coverage_rate_percent ?? '0.00',
    covered_opportunity_count: value.covered_opportunity_count ?? 0,
    active_opportunity_count: value.active_opportunity_count ?? 0,
  }
}

export function normalizeReportRows(value) {
  if (Array.isArray(value)) return value
  // 兼容网关/旧接口将数组包在 items 或 data 中的响应，避免渲染阶段对非数组调用 map/length 导致白页。
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.data)) return value.data
  return []
}

export function stableQuery(value) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))))
}
