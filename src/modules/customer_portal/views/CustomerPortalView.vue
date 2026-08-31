<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { subsystemAccessMessage } from '@/modules/shared/authz/sessionCompatibility'
import { closeSubsystemTabOrFallback } from '@/modules/shared/utils/returnToPortal'
import { acknowledgeSecurityEvent, addFeedbackMessage, closeFeedback, createFeedback, createIdempotencyKey, createProjectConversation, createProjectExport, createReportRequest, downloadIssuedReport, downloadProjectExport, getAccountSecurity, getEvaluation, getEvaluationEligibility, getFeedback, getFeedbackNotificationUnreadCount, getPortalCapabilities, getPortalSession, getProject, getProjectConversation, getProjectExport, getReportRequest, getReportNotificationUnreadCount, listAccountSessions, listFeedbackNotifications, listFeedbacks, listProjectActivities, listProjects, listReportNotifications, listReportRequests, listReportRiskAlerts, logoutPortal, readFeedbackNotification, readProjectConversationMessages, readReportNotification, reportRequestFingerprint, revokeAccountSession, sendProjectConversationMessage, submitEvaluation } from '../api/portal.js'
import FilingWizard from '../components/FilingWizard.vue'
import '@/modules/platform/styles/console.css'
import '../styles/customer-portal.css'
import '../styles/project-export.css'

const route = useRoute()
const router = useRouter()
const session = ref(null)
// 依赖型能力默认按不可用处理；只有服务端明确返回 available=true 后才开放写入或下载，
// 避免能力探测失败时把“未知”误当成“可用”。
const unavailableCapability = Object.freeze({ available: false, mode: 'UNAVAILABLE', reason_code: 'CAPABILITY_STATUS_UNAVAILABLE' })
const capabilities = ref({ report_request_submission: unavailableCapability, project_export: unavailableCapability, report_download: unavailableCapability, filing_material_upload: unavailableCapability, filing_export: unavailableCapability, filing_police_submission: unavailableCapability, customer: { project_enabled: true, report_enabled: true, filing_enabled: true, feedback_enabled: true, evaluation_enabled: true } })
let capabilitiesLoaded = false
const projects = ref([])
const reports = ref([])
const reportNotifications = ref([])
const reportNotificationUnreadCount = ref(0)
const reportRiskAlerts = ref([])
const reportProjects = ref([])
const feedbacks = ref([])
const feedbackNotifications = ref([])
const feedbackNotificationUnreadCount = ref(0)
const selectedProject = ref(null)
const selectedReport = ref(null)
const selectedFeedback = ref(null)
const activities = ref([])
const accountSecurity = ref(null)
const accountSessions = ref([])
const loading = ref(false)
const error = ref('')
const notice = ref('')
const mobileMenuOpen = ref(false)
const projectPage = ref(1)
const projectTotal = ref(0)
const reportPage = ref(1)
const reportTotal = ref(0)
const feedbackPage = ref(1)
const feedbackTotal = ref(0)
const feedbackSubmitError = ref('')
const feedbackContactError = ref('')
const dialogFocused = ref(false)
const section = computed(() => ['reports', 'filings', 'feedback', 'security'].includes(route.params.section) ? route.params.section : 'projects')
const sectionTitle = computed(() => ({ projects: '我的项目', reports: '电子报告', filings: '等保备案', feedback: '客户反馈', security: '账号安全' })[section.value] || '客户自助门户')
const accountInitial = computed(() => {
  const label = accountSecurity.value?.account_identifier || '当前客户'
  return label.trim().slice(0, 1).toUpperCase() || '客'
})
const permissions = computed(() => session.value?.permissions || [])
// 内部超级管理员不继承任何客户身份。业务数据必须先经过后续的受控客户上下文，
// 不能用 CustomerID=0 直接查询或把管理员伪装成某个客户。
const isPortalSuperAdmin = computed(() => (session.value?.roles || []).includes('portal_super_admin'))
const canUseFeedback = computed(() => ['feedback.create', 'feedback.read', 'feedback.reply'].some(hasPermission))
const reportForm = reactive({ project_id: '', report_type: '', reason: '', receive_email: '' })
const reportTypeOptions = Object.freeze(['等级保护测评报告', '风险评估报告', '安全验收测评报告', '渗透测试报告', '安全整改报告', '其他'])
const reportCustomType = ref('')
const effectiveReportType = computed(() => reportForm.report_type === '其他' ? reportCustomType.value.trim() : reportForm.report_type)
const reportListLoading = ref(false)
const reportListError = ref('')
const reportProjectsLoading = ref(false)
const reportProjectsError = ref('')
const reportSubmitting = ref(false)
const reportSubmitError = ref('')
const reportDetailLoading = ref(false)
const reportDetailError = ref('')
const reportDownloadLoading = ref(false)
const reportDownloadError = ref('')
let reportLoadGeneration = 0
let reportDetailGeneration = 0
let reportDownloadGeneration = 0
let reportDownloadController = null
let reportRetryFingerprint = ''
let reportRetryKey = ''
const feedbackForm = reactive({ type: 'COMPLAINT', title: '', description: '', project_id: '', expected_contact: '' })
const feedbackReply = ref('')
const feedbackClosing = ref(false)
const feedbackCloseRetryKeys = new Map()
const evaluationEligibility = ref(null)
const evaluation = ref(null)
const projectDetailLoading = ref(false)
const projectDetailError = ref('')
const activityLoading = ref(false)
const activityError = ref('')
const activityPage = ref(1)
const activityPageSize = 20
const activityTotal = ref(0)
const evaluationLoading = ref(false)
const evaluationError = ref('')
let projectRequestGeneration = 0
const projectExportLoading = ref(false)
const projectExportError = ref('')
let projectExportController = null
let projectExportGeneration = 0
const projectExportRetryKeys = new Map()
const projectExportJobs = new Map()
const projectConversation = ref(null)
const projectMessageContent = ref('')
const projectMessageLoading = ref(false)
const projectMessageError = ref('')
const projectMessageOlderLoading = ref(false)
const projectConversationRetryKeys = new Map()
const projectMessageRetryKeys = new Map()
let projectMessageReadGeneration = 0
const evaluationForm = reactive({ professional_score: 0, response_score: 0, report_score: 0, attitude_score: 0, comment: '' })
const scoreDimensions = Object.freeze([['professional_score', '专业能力'], ['response_score', '响应速度'], ['report_score', '报告质量'], ['attitude_score', '服务态度']])
const evaluationReady = computed(() => scoreDimensions.every(([key]) => evaluationForm[key] >= 1 && evaluationForm[key] <= 5))
const evaluationAverage = computed(() => evaluationReady.value ? (scoreDimensions.reduce((sum, [key]) => sum + evaluationForm[key], 0) / 4).toFixed(2) : '—')

function navigate(value) { router.push({ name: 'customer_portal', params: { section: value } }) }
function returnToUnifiedPortal() {
  mobileMenuOpen.value = false
  closeSubsystemTabOrFallback(window, () => router.replace({ name: 'portal' }))
}
const anyDialogOpen = computed(() => !!(selectedProject.value || selectedReport.value || reportDetailLoading.value || reportDetailError.value || selectedFeedback.value))
function onDialogKeydown(event) {
  if (event.key !== 'Escape') return
  if (selectedProject.value) closeProject()
  else if (selectedReport.value || reportDetailLoading.value || reportDetailError.value) closeReport()
  else if (selectedFeedback.value) selectedFeedback.value = null
}
function formatDate(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date) }
function formatDay(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(date) }
function fail(value) { error.value = subsystemAccessMessage(value) }
function feedbackType(value) { return ({ OBJECTION: '异议', COMPLAINT: '投诉', SUGGESTION: '建议' })[value] || value }
function feedbackStatus(value) { return ({ SUBMITTED: '已提交', ACCEPTED: '已受理', PROCESSING: '处理中', NEED_CUSTOMER_INFO: '待客户补充', RESOLVED: '已解决', CLOSED: '已关闭', REJECTED: '无效反馈' })[value] || value }
function projectStatus(value) { return ({ NOT_STARTED: '未开始', IN_PROGRESS: '进行中', COMPLETED: '已完成', SUSPENDED: '已暂停', CANCELLED: '已取消' })[value] || value || '—' }
function milestoneStatus(value) { return ({ PENDING: '待开始', IN_PROGRESS: '进行中', COMPLETED: '已完成', DELAYED: '已延期' })[value] || value || '—' }
function reportStatus(value) { return ({ SUBMITTED: '已提交', APPROVING: '审批中', APPROVED_PROCESSING: '审批通过，报告处理中', INGEST_PENDING: '文件安全处理中', ISSUED: '已发放', REJECTED: '审批拒绝', PROCESSING_FAILED: '处理失败' })[value] || value || '—' }
function reportEventType(value) { return ({ REPORT_SUBMITTED: '提交报告申请', APPROVAL_STARTED: '进入审批', APPROVAL_APPROVED: '审批通过', APPROVAL_REJECTED: '审批拒绝', REPORT_INGEST_QUEUED: '文件安全处理已入队', REPORT_ISSUED: '报告已发放', PROCESSING_FAILED: '报告处理失败', STATUS_CHANGED: '状态更新' })[value] || value || '状态更新' }
function slaText(item) { return item.first_responded_at ? `首次响应：${formatDate(item.first_responded_at)}` : `首次响应截止：${formatDate(item.first_response_due_at)}` }
function securityEventLabel(value) { return ({ LOGIN_SUCCEEDED: 'Portal 登录成功', LOGIN_FAILED: 'Portal 登录失败', SUBJECT_MISMATCH: '登录账号与邀请不匹配', AUTHORIZATION_INVALIDATED: '账号权限已失效', SESSION_REVOKED: 'Portal 会话已撤销' })[value] || '账号安全事件' }
function hasPermission(value) { return permissions.value.includes(value) }
function capabilityAvailable(value) { return capabilities.value?.[value]?.available === true }
function capabilityReason(value) {
  const code = capabilities.value?.[value]?.reason_code
  return ({
    CAPABILITY_STATUS_UNAVAILABLE: '运行能力状态暂时无法确认，操作已安全关闭。',
    PORTAL_REPORT_DELIVERY_WORKER_UNAVAILABLE: '报告投递服务当前无存活执行实例，新申请已安全关闭。',
    PORTAL_PROJECT_EXPORT_WORKER_UNAVAILABLE: '项目 PDF 生成服务当前无存活执行实例，导出已安全关闭。',
    REPORT_SECURITY_PROVIDERS_NOT_CONFIGURED: '可信文件读取、解密、水印或风险策略尚未完整配置，报告下载已安全关闭。',
  })[code] || '当前运行环境尚未启用此能力。'
}
function customerServiceDisabled(key) {
  return capabilities.value?.customer?.[key] === false
}
function serviceUnavailableText(serviceKey, permissionText) {
  return customerServiceDisabled(serviceKey) ? `该服务尚未对当前客户开通，如需开通请联系您的服务人员。` : permissionText
}
function childError(value) { fail(value) }
function childNotice(value) { notice.value = value }

async function load() {
  loading.value = true; error.value = ''; notice.value = ''
  try {
    session.value ||= await getPortalSession()
    if (isPortalSuperAdmin.value) {
      // 管理员主会话只展示管理入口，避免页面初始化请求把空客户范围带入客户侧 API。
      return
    }
    if (!capabilitiesLoaded) {
      capabilitiesLoaded = true
      // 能力状态不可确认时继续保持失败关闭。
      try { capabilities.value = await getPortalCapabilities() } catch { /* Keep dependency-backed actions closed. */ }
    }
    if (section.value === 'projects' && hasPermission('project.read')) {
      const value = await listProjects({ page: 1, page_size: 20 })
      projects.value = value?.items || []
      projectPage.value = 1
      projectTotal.value = Number(value?.total || projects.value.length)
    }
    else if (section.value === 'reports') { loading.value = false; await loadReportWorkspace(); return }
    else if (section.value === 'feedback' && hasPermission('feedback.read')) {
      const [value, notifications, unreadCount] = await Promise.all([
        listFeedbacks({ page: 1, page_size: 20 }),
        listFeedbackNotifications({ unread_only: true, page: 1, page_size: 20 }).catch(() => ({ items: [] })),
        getFeedbackNotificationUnreadCount().catch(() => ({ count: 0 })),
      ])
      feedbacks.value = value?.items || []
      feedbackNotifications.value = notifications?.items || []
      feedbackNotificationUnreadCount.value = Number(unreadCount?.count || 0)
      feedbackPage.value = 1
      feedbackTotal.value = Number(value?.total || feedbacks.value.length)
      if (hasPermission('project.read') && !projects.value.length) {
        try { const pv = await listProjects({ page: 1, page_size: 100 }); projects.value = pv?.items || [] } catch { /* keep empty */ }
      }
    }
    else if (section.value === 'security' && hasPermission('account.security.manage')) { const [security, sessions] = await Promise.all([getAccountSecurity(), listAccountSessions()]); accountSecurity.value = security; accountSessions.value = sessions?.items || [] }
    else if (section.value === 'filings' && hasPermission('filing.read') && hasPermission('project.read') && !projects.value.length) {
      // 供备案新建时选择关联项目；读取失败不影响备案主流程。
      try { const value = await listProjects({ page: 1, page_size: 100 }); projects.value = value?.items || [] } catch { /* keep empty */ }
    }
  } catch (value) { fail(value) } finally { loading.value = false }
}
async function openFeedbackNotification(item) {
  try { if (item.status === 'UNREAD') { await readFeedbackNotification(item.id); feedbackNotificationUnreadCount.value = Math.max(0, feedbackNotificationUnreadCount.value - 1) }; feedbackNotifications.value = feedbackNotifications.value.filter((value) => value.id !== item.id); openFeedback({ id: item.feedback_id }) } catch (value) { fail(value) }
}
async function loadMoreProjects() {
  if (!hasPermission('project.read') || projectPage.value * 20 >= projectTotal.value) return
  const next = projectPage.value + 1
  try {
    const value = await listProjects({ page: next, page_size: 20 })
    projects.value = [...projects.value, ...(value?.items || [])]
    projectPage.value = next
    projectTotal.value = Number(value?.total || projects.value.length)
  } catch (value) { fail(value) }
}
async function loadMoreReports() {
  if (!hasPermission('report.read') || reportPage.value * 20 >= reportTotal.value) return
  const next = reportPage.value + 1
  reportListLoading.value = true
  try {
    const value = await listReportRequests({ page: next, page_size: 20 })
    reports.value = [...reports.value, ...(value?.items || [])]
    reportPage.value = next
    reportTotal.value = Number(value?.total || reports.value.length)
  } catch (value) { reportListError.value = value?.message || '更多报告记录暂时无法加载' }
  finally { reportListLoading.value = false }
}
async function loadMoreFeedbacks() {
  if (!hasPermission('feedback.read') || feedbackPage.value * 20 >= feedbackTotal.value) return
  const next = feedbackPage.value + 1
  try {
    const value = await listFeedbacks({ page: next, page_size: 20 })
    feedbacks.value = [...feedbacks.value, ...(value?.items || [])]
    feedbackPage.value = next
    feedbackTotal.value = Number(value?.total || feedbacks.value.length)
  } catch (value) { fail(value) }
}
async function loadReportWorkspace() {
  // 报告列表、通知、风险提醒和可申请项目彼此独立加载；代际号同时隔离栏目切换和
  // 重复刷新产生的迟到响应，局部依赖失败不会抹掉其他已经成功的区域。
  const generation = ++reportLoadGeneration
  selectedReport.value = null
  reportDetailGeneration++
  reportListError.value = ''
  reportProjectsError.value = ''
  reports.value = []
  reportNotifications.value = []
  reportRiskAlerts.value = []
  reportProjects.value = []
  const requests = []
  if (hasPermission('report.read')) {
    reportListLoading.value = true
    requests.push(listReportRequests({ page: 1, page_size: 20 }).then((value) => {
      if (generation === reportLoadGeneration && section.value === 'reports') {
        reports.value = value?.items || []
        reportPage.value = 1
        reportTotal.value = Number(value?.total || reports.value.length)
      }
    }).catch((value) => {
      if (generation === reportLoadGeneration && section.value === 'reports') reportListError.value = value?.message || '报告申请记录暂时无法加载'
    }).finally(() => {
      if (generation === reportLoadGeneration && section.value === 'reports') reportListLoading.value = false
    }))
    requests.push(Promise.all([
      listReportNotifications({ unread_only: true, page: 1, page_size: 20 }),
      getReportNotificationUnreadCount(),
    ]).then(([items, count]) => {
      if (generation === reportLoadGeneration && section.value === 'reports') {
        reportNotifications.value = items?.items || []
        reportNotificationUnreadCount.value = Number(count?.count || 0)
      }
    }).catch(() => {
      // 通知依赖不可用不应隐藏报告申请主列表。
      if (generation === reportLoadGeneration && section.value === 'reports') {
        reportNotifications.value = []
        reportNotificationUnreadCount.value = 0
      }
    }))
    requests.push(listReportRiskAlerts({ open_only: true, page: 1, page_size: 20 }).then((value) => {
      if (generation === reportLoadGeneration && section.value === 'reports') reportRiskAlerts.value = value?.items || []
    }).catch(() => {
      // 风险提醒展示与申请、下载历史解耦；即使提醒接口失败，冻结授权仍由服务端强制执行。
      if (generation === reportLoadGeneration && section.value === 'reports') reportRiskAlerts.value = []
    }))
  }
  if (hasPermission('report.request') && hasPermission('project.read')) {
    reportProjectsLoading.value = true
    requests.push(listProjects({ page: 1, page_size: 100 }).then((value) => {
      if (generation === reportLoadGeneration && section.value === 'reports') reportProjects.value = value?.items || []
    }).catch((value) => {
      if (generation === reportLoadGeneration && section.value === 'reports') reportProjectsError.value = value?.message || '可申请项目暂时无法加载'
    }).finally(() => {
      if (generation === reportLoadGeneration && section.value === 'reports') reportProjectsLoading.value = false
    }))
  }
  await Promise.all(requests)
}
async function loadProjectActivities(projectId, page, generation = projectRequestGeneration) {
  activityLoading.value = true
  activityError.value = ''
  try {
    const value = await listProjectActivities(projectId, { page, page_size: activityPageSize })
    if (generation !== projectRequestGeneration) return
    activities.value = value?.items || []
    activityPage.value = value?.page || page
    activityTotal.value = value?.total || 0
  } catch (value) {
    if (generation === projectRequestGeneration) activityError.value = value?.message || '项目动态暂时无法加载'
  } finally {
    if (generation === projectRequestGeneration) activityLoading.value = false
  }
}
async function loadProjectEvaluation(projectId, generation = projectRequestGeneration) {
  evaluationEligibility.value = null
  evaluation.value = null
  evaluationError.value = ''
  if (!hasPermission('evaluation.read') && !hasPermission('evaluation.create')) return
  evaluationLoading.value = true
  try {
    const eligibility = await getEvaluationEligibility(projectId)
    if (generation !== projectRequestGeneration) return
    evaluationEligibility.value = eligibility
    if (eligibility?.evaluation_id && hasPermission('evaluation.read')) {
      const detail = await getEvaluation(eligibility.evaluation_id)
      if (generation === projectRequestGeneration) evaluation.value = detail
    }
  } catch (value) {
    if (generation === projectRequestGeneration) evaluationError.value = value?.message || '服务评价暂时无法加载'
  } finally {
    if (generation === projectRequestGeneration) evaluationLoading.value = false
  }
}
async function openProject(item) {
  // 先用列表快照即时打开详情，再并行读取正文、动态和评价。三条请求共享同一代际，
  // 快速切换项目时旧项目的任何响应都不能覆盖当前弹窗。
  const generation = ++projectRequestGeneration
  selectedProject.value = { snapshot: item, milestones: [], team: [] }
  projectDetailLoading.value = true
  projectDetailError.value = ''
  activities.value = []
  activityPage.value = 1
  activityTotal.value = 0
  projectConversation.value = null
  projectMessageContent.value = ''
  projectMessageError.value = ''
  Object.assign(evaluationForm, { professional_score: 0, response_score: 0, report_score: 0, attitude_score: 0, comment: '' })
  void loadProjectActivities(item.project_id, 1, generation)
  void loadProjectEvaluation(item.project_id, generation)
  try {
    const detail = await getProject(item.project_id)
    if (generation === projectRequestGeneration) selectedProject.value = detail
  } catch (value) {
    if (generation === projectRequestGeneration) projectDetailError.value = value?.message || '项目详情暂时无法加载'
  } finally {
    if (generation === projectRequestGeneration) projectDetailLoading.value = false
  }
}
async function openProjectConversation() {
  const projectId = selectedProject.value?.snapshot?.project_id
  if (!projectId || !selectedProject.value?.snapshot?.manager_message_available || !hasPermission('project.message.read') || projectMessageLoading.value) return
  projectMessageLoading.value = true; projectMessageError.value = ''
  try {
    try {
      projectConversation.value = await getProjectConversation(projectId, { page_size: 100 })
      await nextTick()
      await acknowledgeVisibleManagerMessages(projectConversation.value)
    }
    catch (value) {
      if (value?.status !== 404 || !hasPermission('project.message.send')) throw value
      const retryKey = projectConversationRetryKeys.get(projectId) || createIdempotencyKey()
      projectConversationRetryKeys.set(projectId, retryKey)
      const created = await createProjectConversation(projectId, retryKey)
      projectConversationRetryKeys.delete(projectId)
      projectConversation.value = { conversation: created, messages: { items: [], page_size: 100, total: 0, has_more: false, next_before: '' } }
    }
  } catch (value) { projectMessageError.value = value?.message || '项目站内会话暂时无法加载' }
  finally { projectMessageLoading.value = false }
}
async function acknowledgeVisibleManagerMessages(detail) {
  const conversationId = detail?.conversation?.id
  // 只确认当前页面实际渲染的经理消息。服务端逐条保存回执，因此不会用高水位游标
  // 跨过尚未加载的历史页并误标已读。
  const managerMessageCursors = (detail?.messages?.items || []).filter((item) => item.sender_type === 'MANAGER' && item.cursor).map((item) => item.cursor)
  if (!conversationId || managerMessageCursors.length === 0) return
  const generation = ++projectMessageReadGeneration
  try {
    const state = await readProjectConversationMessages(conversationId, managerMessageCursors)
    if (generation === projectMessageReadGeneration && projectConversation.value?.conversation?.id === conversationId) {
      projectConversation.value = { ...projectConversation.value, read_state: state }
    }
  } catch (value) {
    if (generation === projectMessageReadGeneration) projectMessageError.value = value?.message || '消息已显示，但已读状态同步失败'
  }
}
async function loadOlderProjectMessages() {
  const projectId = selectedProject.value?.snapshot?.project_id
  const messages = projectConversation.value?.messages
  if (!projectId || !messages?.has_more || !messages?.next_before || projectMessageOlderLoading.value) return
  projectMessageOlderLoading.value = true; projectMessageError.value = ''
  try {
    const older = await getProjectConversation(projectId, { before: messages.next_before, page_size: Number(messages.page_size || 100) })
    const currentID = projectConversation.value?.conversation?.id
    if (older?.conversation?.id !== currentID) throw new Error('项目经理已变更，请重新打开会话')
    projectConversation.value = { ...older, messages: { ...older.messages, total: messages.total, items: [...(older.messages?.items || []), ...(messages.items || [])] } }
    await nextTick()
    await acknowledgeVisibleManagerMessages(older)
  } catch (value) { projectMessageError.value = value?.message || '更早消息暂时无法加载' }
  finally { projectMessageOlderLoading.value = false }
}
async function sendManagerMessage() {
  const conversationId = projectConversation.value?.conversation?.id
  const content = projectMessageContent.value.trim()
  if (!conversationId || !content || !hasPermission('project.message.send') || projectMessageLoading.value) return
  projectMessageLoading.value = true; projectMessageError.value = ''
  const fingerprint = `${conversationId}\u0000${content}`
  const retryKey = projectMessageRetryKeys.get(fingerprint) || createIdempotencyKey()
  projectMessageRetryKeys.set(fingerprint, retryKey)
  try {
    projectConversation.value = await sendProjectConversationMessage(conversationId, content, retryKey)
    projectMessageRetryKeys.delete(fingerprint); projectMessageContent.value = ''
  } catch (value) { projectMessageError.value = value?.message || '消息发送失败，请使用原内容重试' }
  finally { projectMessageLoading.value = false }
}
function changeActivityPage(page) {
  const projectId = selectedProject.value?.snapshot?.project_id
  if (!projectId || page < 1 || page > Math.ceil(activityTotal.value / activityPageSize)) return
  void loadProjectActivities(projectId, page)
}
async function exportProjectPDF() {
  const projectId = selectedProject.value?.snapshot?.project_id
  if (!projectId || !hasPermission('project.export') || !capabilityAvailable('project_export') || projectExportLoading.value) return
  const generation = ++projectExportGeneration
  const controller = new AbortController()
  projectExportLoading.value = true; projectExportError.value = ''
  projectExportController?.abort(); projectExportController = controller
  try {
    // 创建任务和轮询共用同一个中止信号；同一项目保留已创建任务及幂等键，网络失败后
    // 继续查询原任务，而不是重复生成 PDF。切换项目时由代际号阻止旧文件触发下载。
    let job = projectExportJobs.get(projectId)
    if (!job) {
      const retryKey = projectExportRetryKeys.get(projectId) || createIdempotencyKey()
      projectExportRetryKeys.set(projectId, retryKey)
      job = await createProjectExport(projectId, retryKey, { signal: controller.signal })
      if (generation !== projectExportGeneration || selectedProject.value?.snapshot?.project_id !== projectId) return
      projectExportJobs.set(projectId, job)
      projectExportRetryKeys.delete(projectId)
    }
    let state = job
    for (let attempt = 0; attempt < 30 && ['PENDING', 'GENERATING'].includes(state?.status); attempt++) {
      await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 1000); controller.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true }) })
      state = await getProjectExport(job.export_id, { signal: controller.signal })
      if (generation !== projectExportGeneration || selectedProject.value?.snapshot?.project_id !== projectId) return
    }
    if (state?.status !== 'READY') {
      if (state?.status === 'FAILED') projectExportJobs.delete(projectId)
      throw new Error(state?.failure_code ? `项目 PDF 生成失败（${state.failure_code}）` : '项目 PDF 尚未生成，请稍后重试。')
    }
    const file = await downloadProjectExport(job.export_id, { signal: controller.signal })
    if (generation !== projectExportGeneration || selectedProject.value?.snapshot?.project_id !== projectId) return
    const url = URL.createObjectURL(file.blob); const anchor = document.createElement('a')
    try { anchor.href = url; anchor.download = file.fileName; anchor.click() } finally { URL.revokeObjectURL(url) }
    projectExportJobs.delete(projectId)
  } catch (value) {
    if (value?.name !== 'AbortError' && generation === projectExportGeneration && selectedProject.value?.snapshot?.project_id === projectId) projectExportError.value = value?.message || '项目 PDF 导出失败'
  } finally {
    if (generation === projectExportGeneration) { projectExportLoading.value = false; projectExportController = null }
  }
}
async function submitProjectEvaluation() {
  if (!evaluationReady.value || !selectedProject.value) return
  error.value = ''; notice.value = ''
  try {
    evaluation.value = await submitEvaluation({ project_id: selectedProject.value.snapshot.project_id, ...evaluationForm })
    evaluationEligibility.value = { project_id: selectedProject.value.snapshot.project_id, eligible: false, reason_code: 'ALREADY_EVALUATED', evaluation_id: evaluation.value.id }
    const total = scoreDimensions.reduce((sum, [key]) => sum + Number(evaluationForm[key] || 0), 0)
    notice.value = total <= 8 ? '服务评价已提交；低分事项已转交服务团队跟进处理。' : '服务评价已提交，感谢您的反馈。'
  } catch (value) { fail(value) }
}
function closeProject() { projectRequestGeneration++; projectExportGeneration++; projectExportController?.abort(); projectExportController = null; projectExportLoading.value = false; projectExportError.value = ''; projectConversation.value = null; projectMessageContent.value = ''; projectMessageError.value = ''; projectMessageOlderLoading.value = false; selectedProject.value = null; evaluationEligibility.value = null; evaluation.value = null }
async function openReport(item) {
  if (!hasPermission('report.read')) return
  cancelReportDownload()
  const generation = ++reportDetailGeneration
  selectedReport.value = { ...item, events: [] }
  reportDetailError.value = ''
  reportDetailLoading.value = true
  try {
    const value = await getReportRequest(item.id)
    if (generation === reportDetailGeneration) selectedReport.value = value
  } catch (value) {
    if (generation === reportDetailGeneration) {
      selectedReport.value = null
      reportDetailError.value = value?.message || '报告详情暂时无法加载'
    }
  } finally {
    if (generation === reportDetailGeneration) reportDetailLoading.value = false
  }
}
async function openReportNotification(item) {
  if (!hasPermission('report.read')) return
  try {
    if (item.status === 'UNREAD') await readReportNotification(item.id)
    reportNotifications.value = reportNotifications.value.filter((current) => current.id !== item.id)
    reportNotificationUnreadCount.value = Math.max(0, reportNotificationUnreadCount.value - (item.status === 'UNREAD' ? 1 : 0))
    await openReport({ id: item.request_id, request_no: item.request_no })
  } catch (value) {
    reportListError.value = value?.message || '报告通知暂时无法打开'
  }
}
function cancelReportDownload() {
  reportDownloadGeneration++
  reportDownloadController?.abort()
  reportDownloadController = null
  reportDownloadLoading.value = false
  reportDownloadError.value = ''
}
function closeReport() { cancelReportDownload(); reportDetailGeneration++; selectedReport.value = null; reportDetailError.value = ''; reportDetailLoading.value = false }
function reportDownloadFailure(value) {
  const messages = {
    PORTAL_REPORT_GRANT_NOT_FOUND: '下载授权无效，请重新申请授权后下载。',
    PORTAL_REPORT_LINK_EXPIRED: '下载授权已过期，请重新申请授权。',
    PORTAL_REPORT_GRANT_REVOKED: '下载授权已撤销，请重新申请授权。',
    PORTAL_REPORT_GRANT_FROZEN: '下载授权因风险检查被冻结，请联系服务人员复核。',
    PORTAL_REPORT_FILE_UNAVAILABLE: '报告文件暂时不可用，请稍后重试。',
    PORTAL_REPORT_DOWNLOAD_UNAVAILABLE: '安全下载服务暂时不可用，请稍后重试。',
    PORTAL_REPORT_DOWNLOAD_INTEGRITY_FAILED: '报告完整性校验未通过，已停止下载，请联系服务人员。',
    PORTAL_REPORT_DOWNLOAD_CONTENT_TYPE_INVALID: '下载内容类型异常，已停止下载。',
    PORTAL_REPORT_GRANT_REPLAY: '本次授权无法重放，请重新点击下载生成新授权。',
    PORTAL_REPORT_NOT_ISSUED: '报告尚未发放，暂时不能下载。',
  }
  if (messages[value?.code]) return messages[value.code]
  if (value?.status === 403) return '当前账号没有报告下载权限。'
  if (value?.status === 404) return '报告或下载授权不存在，请刷新后重试。'
  if (value?.status === 410) return '下载授权已过期或撤销，请重新申请授权。'
  if (value?.status === 423) return '下载授权已冻结，请联系服务人员复核。'
  if (value?.status === 503) return '安全下载服务暂时不可用，请稍后重试。'
  return value?.message || '报告下载失败，请重新点击下载。'
}
async function downloadReportFile() {
  const report = selectedReport.value
  if (!capabilityAvailable('report_download') || !report || report.status !== 'ISSUED' || !hasPermission('report.read') || !hasPermission('report.download') || reportDownloadLoading.value) return
  const generation = ++reportDownloadGeneration
  const reportID = report.id
  reportDownloadController?.abort()
  const controller = new AbortController()
  reportDownloadController = controller
  reportDownloadLoading.value = true
  reportDownloadError.value = ''
  let objectURL = ''
  try {
    // 每次主动点击都创建一份新的短效授权。失败授权不会自动重放，因为服务端不会保存
    // 可恢复的明文下载令牌；关闭详情或再次点击会中止旧请求并使其响应失效。
    const result = await downloadIssuedReport(reportID, { idempotencyKey: createIdempotencyKey(), signal: controller.signal })
    if (generation !== reportDownloadGeneration || selectedReport.value?.id !== reportID || section.value !== 'reports') return
    objectURL = URL.createObjectURL(result.blob)
    const link = document.createElement('a')
    link.href = objectURL
    link.download = result.filename
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()
  } catch (value) {
    if (value?.name !== 'AbortError' && generation === reportDownloadGeneration && selectedReport.value?.id === reportID && section.value === 'reports') {
      reportDownloadError.value = reportDownloadFailure(value)
    }
  } finally {
    if (objectURL) URL.revokeObjectURL(objectURL)
    if (generation === reportDownloadGeneration) {
      reportDownloadController = null
      reportDownloadLoading.value = false
    }
  }
}
async function submitReport() {
  if (!hasPermission('report.request') || !capabilityAvailable('report_request_submission') || reportSubmitting.value) return
  reportSubmitError.value = ''; notice.value = ''
  const fingerprint = reportRequestFingerprint({ ...reportForm, report_type: effectiveReportType.value })
  // 内容相同的失败提交复用原幂等键；任一规范化字段变化都代表新的业务申请，必须换键。
  if (fingerprint !== reportRetryFingerprint) {
    reportRetryFingerprint = fingerprint
    reportRetryKey = createIdempotencyKey()
  }
  reportSubmitting.value = true
  try {
    const payload = { ...reportForm, report_type: effectiveReportType.value }
    await createReportRequest(payload, reportRetryKey)
    Object.assign(reportForm, { project_id: '', report_type: '', reason: '', receive_email: '' })
    reportCustomType.value = ''
    reportRetryFingerprint = ''; reportRetryKey = ''
    notice.value = '报告申请已提交。'
    await loadReportWorkspace()
  } catch (value) {
    reportSubmitError.value = value?.status === 409 || value?.code === 'PORTAL_REPORT_IDEMPOTENCY_CONFLICT'
      ? '提交发生冲突：该重试标识已用于另一份申请，请检查表单内容后重新提交。'
      : value?.message || '报告申请提交失败，可直接重试；相同内容将复用本次提交标识。'
  } finally { reportSubmitting.value = false }
}
function validContact(value) {
  const contact = String(value || '').trim()
  if (!contact) return true
  return /^1[3-9]\d{9}$/.test(contact) || /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(contact)
}
async function submitFeedback() {
  if (!hasPermission('feedback.create')) return
  feedbackSubmitError.value = ''; feedbackContactError.value = ''
  if (!validContact(feedbackForm.expected_contact)) { feedbackContactError.value = '请输入正确的手机号或邮箱，或留空。'; return }
  try {
    await createFeedback({ ...feedbackForm })
    Object.assign(feedbackForm, { type: 'COMPLAINT', title: '', description: '', project_id: '', expected_contact: '' })
    notice.value = '反馈已提交，我们将在 24 小时内首次响应。'
    if (hasPermission('feedback.read')) await load()
  } catch (value) { feedbackSubmitError.value = value?.message || '反馈提交失败，请稍后重试。' }
}
async function openFeedback(item) { if (!hasPermission('feedback.read')) return; try { selectedFeedback.value = await getFeedback(item.id) } catch (value) { fail(value) } }
async function replyFeedback() { if (!hasPermission('feedback.reply') || !feedbackReply.value.trim() || !selectedFeedback.value) return; try { selectedFeedback.value = await addFeedbackMessage(selectedFeedback.value.feedback.id, feedbackReply.value); feedbackReply.value = ''; notice.value = '补充内容已提交。' } catch (value) { fail(value) } }
async function confirmCloseFeedback() {
  if (!hasPermission('feedback.reply') || !selectedFeedback.value || feedbackClosing.value) return
  const feedbackID = selectedFeedback.value.feedback.id
  let idempotencyKey = feedbackCloseRetryKeys.get(feedbackID)
  if (!idempotencyKey) {
    idempotencyKey = createIdempotencyKey()
    feedbackCloseRetryKeys.set(feedbackID, idempotencyKey)
  }
  error.value = ''; notice.value = ''; feedbackClosing.value = true
  try {
    selectedFeedback.value = await closeFeedback(feedbackID, idempotencyKey)
    feedbackCloseRetryKeys.delete(feedbackID)
    notice.value = '反馈已关闭。'
    if (hasPermission('feedback.read')) await load()
  } catch (value) {
    fail(value)
  } finally {
    feedbackClosing.value = false
  }
}
async function revokeSession(item) { if (!hasPermission('account.security.manage')) return; error.value = ''; notice.value = ''; try { await revokeAccountSession(item.id); if (item.current) { await logoutPortal(); return }; notice.value = '会话已撤销。'; const value = await listAccountSessions(); accountSessions.value = value?.items || [] } catch (value) { fail(value) } }
async function acknowledgeEvent(item) { if (!hasPermission('account.security.manage')) return; error.value = ''; notice.value = ''; try { await acknowledgeSecurityEvent(item.id); notice.value = '安全事件已确认。'; accountSecurity.value = await getAccountSecurity() } catch (value) { fail(value) } }

watch(section, () => {
  // 离开报告栏目立即中止文件流，并让列表、详情的在途响应全部过期。
  cancelReportDownload()
  reportLoadGeneration++
  reportDetailGeneration++
  selectedReport.value = null
  error.value = ''
  notice.value = ''
  void load()
})
watch(anyDialogOpen, async (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
  if (open) {
    window.addEventListener('keydown', onDialogKeydown)
    await nextTick()
    document.querySelector('.portal-dialog article')?.focus()
  } else {
    window.removeEventListener('keydown', onDialogKeydown)
  }
})
onMounted(load)
onBeforeUnmount(() => {
  cancelReportDownload()
  projectExportController?.abort()
  window.removeEventListener('keydown', onDialogKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="console-page portal-shell">
    <button v-if="mobileMenuOpen" class="console-menu-mask portal-menu-mask" type="button" aria-label="关闭导航" @click="mobileMenuOpen = false"></button>
    <aside class="console-sidebar portal-sidebar" :class="{ open: mobileMenuOpen }">
      <div class="console-brand portal-brand">
        <span class="console-brand-mark"><ConsoleIcon name="logo" /></span>
        <span class="console-brand-copy"><strong>{{ isPortalSuperAdmin ? '客户门户管理' : '客户自助门户' }}</strong><small>统一身份平台安全登录</small></span>
        <button class="console-close-menu" type="button" aria-label="关闭导航菜单" @click="mobileMenuOpen = false"><ConsoleIcon name="close" /></button>
      </div>
      <nav class="console-nav portal-nav" aria-label="客户门户功能">
        <template v-if="!isPortalSuperAdmin"><p class="console-nav-label">业务中心</p>
        <button v-if="hasPermission('project.read')" class="console-nav-item" type="button" :class="{ active: section === 'projects' }" @click="navigate('projects')"><ConsoleIcon name="dashboard" /><span>我的项目</span></button>
        <button v-if="hasPermission('report.read') || hasPermission('report.request')" class="console-nav-item" type="button" :class="{ active: section === 'reports' }" @click="navigate('reports')"><ConsoleIcon name="download" /><span>电子报告</span></button>
        <button v-if="hasPermission('filing.read')" class="console-nav-item" type="button" :class="{ active: section === 'filings' }" @click="navigate('filings')"><ConsoleIcon name="shield" /><span>等保备案</span></button>
        <button v-if="canUseFeedback" class="console-nav-item" type="button" :class="{ active: section === 'feedback' }" @click="navigate('feedback')"><ConsoleIcon name="bell" /><span>客户反馈</span></button></template>
        <p class="console-nav-label">账号</p>
        <button v-if="hasPermission('account.security.manage')" class="console-nav-item" type="button" :class="{ active: section === 'security' }" @click="navigate('security')"><ConsoleIcon name="account" /><span>账号安全</span></button>
        <p class="console-nav-label">平台能力</p>
        <button class="console-nav-item" type="button" @click="returnToUnifiedPortal"><ConsoleIcon name="dashboard" /><span>返回子系统门户</span></button>
      </nav>
      <div class="console-sidebar-note"><ConsoleIcon name="shield" /><span>统一身份认证已生效，菜单与操作由服务端权限控制。</span></div>
      <div class="console-sidebar-user">
        <span class="console-avatar" aria-hidden="true">{{ accountInitial }}</span>
        <span class="console-user-copy"><strong :title="accountSecurity?.account_identifier || '当前客户'">{{ accountSecurity?.account_identifier || '当前客户' }}</strong><small>Portal 会话</small></span>
        <button class="console-logout" type="button" aria-label="结束门户会话" title="结束门户会话" @click="logoutPortal"><ConsoleIcon name="logout" /></button>
      </div>
    </aside>
    <main class="console-main portal-main">
      <header class="console-topbar portal-topbar">
        <button class="console-menu-button" type="button" aria-label="打开导航菜单" @click="mobileMenuOpen = true"><ConsoleIcon name="menu" /></button>
        <div class="console-crumb"><span>{{ isPortalSuperAdmin ? '客户门户管理' : '客户自助门户' }}</span><ConsoleIcon name="chevron" /><strong>{{ isPortalSuperAdmin ? '管理入口' : sectionTitle }}</strong></div>
        <div class="console-topbar-actions">
          <span class="console-topbar-avatar" aria-hidden="true">{{ accountInitial }}</span>
        </div>
      </header>
      <section class="console-content portal-content">
      <template v-if="isPortalSuperAdmin"><div class="portal-title"><h1>客户门户管理</h1><p>当前为内部超级管理员会话，未绑定任何客户身份。</p></div><section class="portal-card"><h2>安全访问规则</h2><p>客户项目、报告、备案和反馈始终按客户边界隔离。管理员需要在受控的客户上下文中查看或处理具体客户数据，系统会记录操作人、目标客户、原因和审计记录。</p><p class="portal-info">当前可通过“客户与商机管理 → 客户详情 → 门户访问”完成客户开通、邀请、撤销和禁用。客户侧自助页面不会以管理员身份直接加载，避免误操作或跨客户数据泄露。</p></section></template><template v-else>
      <p class="portal-info" role="status">登录、会话、项目查询、报告申请和等保备案草稿均已接入门户服务；客户反馈与账号安全也使用 Portal 服务端会话。项目快照和已发放报告支持短效受控 PDF 下载；备案材料已接受控上传与扫描状态，正式 Provider 未配置时失败关闭，备案 PDF 和公安提交仍未接通。</p><p v-if="error" class="portal-error" role="alert">{{ error }}</p><p v-if="notice" class="portal-success" role="status">{{ notice }}</p><p v-if="loading">正在加载…</p>
      <section v-if="section === 'feedback' && canUseFeedback && feedbackNotifications.length" class="portal-card feedback-notifications"><h2>反馈通知（{{ feedbackNotificationUnreadCount }} 条未读）</h2><button v-for="item in feedbackNotifications" :key="item.id" type="button" class="feedback-row" @click="openFeedbackNotification(item)"><span><strong>{{ item.title }}</strong><small>{{ item.body }}</small><small>{{ formatDate(item.created_at) }}</small></span><em>查看反馈</em></button></section>
      <template v-else-if="section === 'projects' && hasPermission('project.read')"><div class="portal-title"><h1>我的项目</h1><p>项目数据以最近一次同步快照为准</p></div><section v-if="projects.length" class="project-list"><button v-for="item in projects" :key="item.project_id" type="button" @click="openProject(item)"><div><h2>{{ item.project_name || '未命名项目' }}</h2><p>{{ item.contract_no || '无合同编号' }} · {{ item.current_stage || '阶段未同步' }}</p></div><strong>{{ item.progress_pct ?? 0 }}%</strong><progress :value="item.progress_pct ?? 0" max="100"></progress><small>数据更新：{{ formatDate(item.source_updated_at) }}<template v-if="item.delayed"> · 已延期</template></small></button></section><nav v-if="projects.length && projects.length < projectTotal" class="project-pagination" aria-label="项目加载更多"><button type="button" :disabled="loading" @click="loadMoreProjects">加载更多项目</button><span>已显示 {{ projects.length }} / {{ projectTotal }} 个</span></nav><div v-else class="portal-empty">暂无可查看的项目</div></template>
      <div v-else-if="section === 'projects'" class="portal-empty">{{ serviceUnavailableText('project_enabled', '当前账号没有项目读取权限。如需开通，请联系您的服务人员。') }}</div>
      <template v-else-if="section === 'reports' && (hasPermission('report.read') || hasPermission('report.request'))"><div class="portal-title"><h1>电子报告</h1><p>申请审批与状态变更均由 Portal 服务端可靠跟踪</p></div><section v-if="hasPermission('report.read') && reportRiskAlerts.length" class="portal-card" aria-live="polite"><h2>下载安全提醒</h2><div v-for="item in reportRiskAlerts" :key="item.alert_id" class="report-row"><span><strong>{{ item.request_no || `报告 #${item.request_id}` }} 的下载授权已冻结</strong><small>{{ item.report_type }} · {{ formatDate(item.detected_at) }}</small><small>风险编号：{{ item.risk_code }}；服务人员复核前请勿反复尝试。</small><small>如需协助，请通过「客户反馈」提交或联系您的服务人员。</small><button type="button" class="secondary small" @click="navigate('feedback')">去反馈</button></span></div></section><section v-if="hasPermission('report.read') && reportNotifications.length" class="portal-card"><h2>报告通知（{{ reportNotificationUnreadCount }} 条未读）</h2><button v-for="item in reportNotifications" :key="item.id" class="report-row" type="button" @click="openReportNotification(item)"><span><strong>{{ item.request_no }} 已发放</strong><small>{{ item.report_type }} · {{ formatDate(item.created_at) }}</small></span><em>查看报告</em></button></section><div class="portal-columns"><form v-if="hasPermission('report.request')" class="portal-card" @submit.prevent="submitReport"><h2>申请报告</h2><p v-if="reportProjectsError" class="portal-error" role="alert">{{ reportProjectsError }}</p><label>项目<select v-model="reportForm.project_id" :disabled="reportProjectsLoading || !hasPermission('project.read')" required><option value="">{{ reportProjectsLoading ? '正在加载项目…' : '请选择当前客户项目' }}</option><option v-for="item in reportProjects" :key="item.project_id" :value="item.project_id">{{ item.project_name || '未命名项目' }}（{{ item.contract_no || item.project_id }}）</option></select></label><p v-if="!hasPermission('project.read')" class="portal-warning">缺少 project.read，无法读取当前客户项目，报告申请已暂停。</p><p v-else-if="!reportProjectsLoading && !reportProjects.length && !reportProjectsError" class="portal-warning">暂无可申请报告的项目。</p><label>报告类型<select v-model="reportForm.report_type" required><option value="">请选择报告类型</option><option v-for="type in reportTypeOptions" :key="type" :value="type">{{ type }}</option></select></label><label v-if="reportForm.report_type === '其他'">自定义报告类型<input v-model.trim="reportCustomType" maxlength="64" required></label><label>申请原因<textarea v-model.trim="reportForm.reason" maxlength="2000" required></textarea></label><label>接收邮箱<input v-model.trim="reportForm.receive_email" type="email" required placeholder="用于接收报告发放通知"></label><p v-if="!capabilityAvailable('report_request_submission')" class="portal-warning">{{ capabilityReason('report_request_submission') }}</p><p v-if="reportSubmitError" class="portal-error" role="alert">{{ reportSubmitError }}</p><button :disabled="reportSubmitting || reportProjectsLoading || !hasPermission('project.read') || !reportProjects.length || !capabilityAvailable('report_request_submission')">{{ reportSubmitting ? '正在提交…' : '提交申请' }}</button></form><section v-else class="portal-card"><h2>申请报告</h2><p class="portal-empty">当前账号没有报告申请权限。</p></section><section class="portal-card"><h2>申请记录</h2><p v-if="!hasPermission('report.read')" class="portal-empty">当前账号没有报告读取权限。</p><p v-else-if="reportListError" class="portal-error" role="alert">{{ reportListError }}</p><p v-else-if="reportListLoading">正在加载申请记录…</p><template v-else><button v-for="item in reports" :key="item.id" class="report-row" type="button" @click="openReport(item)"><span><strong>{{ item.request_no || `申请 #${item.id}` }}</strong><small>{{ item.report_type }} · {{ reportStatus(item.status) }}</small><small>提交于 {{ formatDate(item.submitted_at) }}</small></span><em>查看详情</em></button><p v-if="!reports.length" class="project-empty">暂无报告申请</p><nav v-else-if="reports.length < reportTotal" class="project-pagination" aria-label="报告申请加载更多"><button type="button" :disabled="reportListLoading" @click="loadMoreReports">加载更多申请</button><span>已显示 {{ reports.length }} / {{ reportTotal }} 条</span></nav></template></section></div></template>
      <div v-else-if="section === 'reports'" class="portal-empty">{{ serviceUnavailableText('report_enabled', '当前账号没有报告读取或申请权限。如需开通，请联系您的服务人员。') }}</div>
      <FilingWizard v-else-if="section === 'filings' && hasPermission('filing.read')" :permissions="permissions" :capabilities="capabilities" :projects="projects" @error="childError" @notice="childNotice" />
      <div v-else-if="section === 'filings'" class="portal-empty">{{ serviceUnavailableText('filing_enabled', '当前账号没有备案读取权限。如需开通，请联系您的服务人员。') }}</div>
      <template v-else-if="section === 'feedback' && canUseFeedback"><div class="portal-title"><h1>客户反馈</h1><p>异议、投诉或建议均会生成唯一编号，首次人工响应目标为 24 小时</p></div><div class="portal-columns"><form v-if="hasPermission('feedback.create')" class="portal-card" @submit.prevent="submitFeedback"><h2>提交反馈</h2><label>反馈类型<select v-model="feedbackForm.type"><option value="OBJECTION">异议</option><option value="COMPLAINT">投诉</option><option value="SUGGESTION">建议</option></select></label><label>标题<input v-model.trim="feedbackForm.title" maxlength="200" required></label><label>详细描述<textarea v-model.trim="feedbackForm.description" maxlength="5000" required></textarea></label><label>关联项目（可选）<select v-model="feedbackForm.project_id"><option value="">不关联项目</option><option v-for="item in projects" :key="item.project_id" :value="item.project_id">{{ item.project_name || '未命名项目' }}（{{ item.contract_no || item.project_id }}）</option></select></label><label>期望联系方式（手机或邮箱，加密保存）<input v-model.trim="feedbackForm.expected_contact" maxlength="200"></label><p v-if="feedbackContactError" class="portal-error" role="alert">{{ feedbackContactError }}</p><p v-if="feedbackSubmitError" class="portal-error" role="alert">{{ feedbackSubmitError }}</p><button>提交反馈</button><small>附件需待可信上传与病毒扫描接通后开放。</small></form><section v-else class="portal-card"><h2>提交反馈</h2><p class="portal-empty">当前账号没有反馈提交权限。</p></section><section class="portal-card"><h2>我的反馈</h2><template v-if="hasPermission('feedback.read')"><button v-for="item in feedbacks" :key="item.id" class="feedback-row" type="button" @click="openFeedback(item)"><span><strong>{{ item.feedback_no }} · {{ feedbackType(item.type) }}</strong><small>{{ item.title }}</small><small>{{ slaText(item) }}</small></span><em>{{ feedbackStatus(item.status) }}</em></button><nav v-if="feedbacks.length && feedbacks.length < feedbackTotal" class="project-pagination" aria-label="反馈加载更多"><button type="button" :disabled="loading" @click="loadMoreFeedbacks">加载更多反馈</button><span>已显示 {{ feedbacks.length }} / {{ feedbackTotal }} 条</span></nav><p v-if="!feedbacks.length">暂无反馈</p></template><p v-else class="portal-empty">当前账号没有反馈读取权限。</p></section></div></template>
      <div v-else-if="section === 'feedback'" class="portal-empty">{{ serviceUnavailableText('feedback_enabled', '当前账号没有反馈相关权限。如需开通，请联系您的服务人员。') }}</div>
      <template v-else-if="section === 'security' && hasPermission('account.security.manage')"><div class="portal-title"><h1>账号安全</h1><p>密码、MFA 与账号恢复由统一身份平台负责</p></div><section class="security-summary portal-card"><div><small>统一身份账号</small><strong>{{ accountSecurity?.account_identifier || '—' }}</strong></div><div><small>最近登录</small><strong>{{ formatDate(accountSecurity?.last_portal_login_at) }}</strong><span>{{ accountSecurity?.last_ip_masked || '地址未知' }} · {{ accountSecurity?.last_device || '设备未知' }}</span></div></section><div class="portal-security-columns"><section class="portal-card"><h2>Portal 活跃会话</h2><div v-for="item in accountSessions" :key="item.id" class="security-row"><span><strong>{{ item.device || '未知设备' }}<em v-if="item.current">当前会话</em></strong><small>{{ item.ip_masked || '地址未知' }} · 最近活动 {{ formatDate(item.last_seen_at) }}</small></span><button @click="revokeSession(item)">{{ item.current ? '退出当前会话' : '撤销' }}</button></div><p v-if="!accountSessions.length">暂无活跃会话</p></section><section class="portal-card"><h2>近期安全事件</h2><div v-for="item in accountSecurity?.events || []" :key="item.id" class="security-row"><span><strong>{{ securityEventLabel(item.type) }}<em :class="`risk-${item.risk_level?.toLowerCase()}`">{{ item.risk_level }}</em></strong><small>{{ formatDate(item.occurred_at) }} · {{ item.ip_masked || '地址未知' }}</small></span><button v-if="!item.acknowledged_at && item.risk_level !== 'LOW'" @click="acknowledgeEvent(item)">确认</button></div><p v-if="!accountSecurity?.events?.length">暂无安全事件</p></section></div></template>
      <div v-else-if="section === 'security'" class="portal-empty">当前账号没有账户安全管理权限。如需开通，请联系您的服务人员。</div></template>
      </section>
    </main>
    <div v-if="selectedReport || reportDetailLoading || reportDetailError" class="portal-dialog" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title"><article class="report-detail" tabindex="-1"><button class="close" aria-label="关闭" @click="closeReport">×</button><h2 id="report-dialog-title">{{ selectedReport?.request_no || '报告申请详情' }}</h2><p v-if="reportDetailError" class="portal-error" role="alert">{{ reportDetailError }}</p><p v-if="reportDetailLoading">正在加载报告详情…</p><template v-else-if="selectedReport"><dl class="report-summary"><div><dt>当前状态</dt><dd>{{ reportStatus(selectedReport.status) }}</dd></div><div><dt>报告类型</dt><dd>{{ selectedReport.report_type || '—' }}</dd></div><div><dt>关联项目</dt><dd>{{ selectedReport.project_id || '—' }}</dd></div><div><dt>提交时间</dt><dd>{{ formatDate(selectedReport.submitted_at) }}</dd></div><div><dt>审批时间</dt><dd>{{ formatDate(selectedReport.approved_at) }}</dd></div><div><dt>发放时间</dt><dd>{{ formatDate(selectedReport.issued_at) }}</dd></div></dl><section><h3>申请原因</h3><p>{{ selectedReport.reason || '—' }}</p></section><section v-if="selectedReport.approval_result"><h3>审批结果</h3><p>{{ selectedReport.approval_result }}</p></section><section><h3>状态时间线</h3><ol v-if="selectedReport.events?.length" class="report-timeline"><li v-for="item in selectedReport.events" :key="item.sequence"><span>{{ item.sequence }}</span><div><strong>{{ reportEventType(item.event_type) }}</strong><small>{{ formatDate(item.occurred_at) }}</small><p><template v-if="item.from_status">{{ reportStatus(item.from_status) }} → </template>{{ reportStatus(item.to_status) }}</p></div></li></ol><p v-else class="project-empty">暂无状态事件</p></section><section class="report-download"><h3>报告下载</h3><p v-if="selectedReport.status !== 'ISSUED'">报告发放后才可申请短效下载授权。</p><p v-else-if="!hasPermission('report.download')">报告已发放，但当前账号没有报告下载权限。</p><template v-else><p>每次点击都会创建新的短效授权；下载凭据不会写入链接或浏览器存储。</p><p v-if="!capabilityAvailable('report_download')" class="portal-warning">{{ capabilityReason('report_download') }}</p><p v-if="reportDownloadError" class="portal-error" role="alert">{{ reportDownloadError }}</p><button type="button" :disabled="reportDownloadLoading || !capabilityAvailable('report_download')" @click="downloadReportFile">{{ reportDownloadLoading ? '正在安全下载…' : '下载 PDF 报告' }}</button></template></section></template></article></div>
    <div v-if="selectedProject" class="portal-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title"><article class="project-detail" tabindex="-1"><button class="close" aria-label="关闭" @click="closeProject">×</button><h2 id="project-dialog-title">{{ selectedProject.snapshot?.project_name || '项目详情' }}</h2><p v-if="projectDetailError" class="portal-error" role="alert">{{ projectDetailError }}</p><p v-if="projectDetailLoading">正在加载项目详情…</p><template v-else><section class="project-overview" aria-label="项目概览"><div><small>总体进度</small><strong>{{ selectedProject.snapshot?.progress_pct ?? 0 }}%</strong><progress :value="selectedProject.snapshot?.progress_pct ?? 0" max="100"></progress></div><dl><div><dt>项目状态</dt><dd>{{ projectStatus(selectedProject.snapshot?.status) }}</dd></div><div><dt>当前阶段</dt><dd>{{ selectedProject.snapshot?.current_stage || '—' }}</dd></div><div><dt>预计结束</dt><dd>{{ formatDay(selectedProject.snapshot?.expected_end_date) }}</dd></div><div><dt>延期状态</dt><dd :class="{ 'project-delayed': selectedProject.snapshot?.delayed }">{{ selectedProject.snapshot?.delayed ? '已延期' : '未标记延期' }}</dd></div><div><dt>源数据更新</dt><dd>{{ formatDate(selectedProject.snapshot?.source_updated_at) }}</dd></div><div><dt>Portal 同步</dt><dd>{{ formatDate(selectedProject.snapshot?.synced_at) }}</dd></div></dl><p v-if="selectedProject.snapshot?.manager_name || selectedProject.snapshot?.manager_contact_masked"><strong>项目经理：</strong>{{ selectedProject.snapshot?.manager_name || '—' }}<span v-if="selectedProject.snapshot?.manager_contact_masked"> · {{ selectedProject.snapshot.manager_contact_masked }}</span></p><p v-else class="project-empty">暂无项目经理信息</p></section><section><h3>五阶段里程碑</h3><ol v-if="selectedProject.milestones?.length" class="project-milestones"><li v-for="item in selectedProject.milestones" :key="`${item.stage_code}-${item.sort_no}`"><strong>{{ item.stage_name || item.stage_code || '未命名阶段' }}</strong><span>{{ milestoneStatus(item.status) }}</span><small>计划：{{ formatDate(item.planned_at) }} · 完成：{{ formatDate(item.completed_at) }}</small></li></ol><p v-else class="project-empty">暂无里程碑数据</p></section><section><h3>项目团队</h3><div v-if="selectedProject.team?.length" class="project-team"><div v-for="item in selectedProject.team" :key="`${item.name}-${item.role}`"><strong>{{ item.name || '—' }}</strong><span>{{ item.role || '角色未同步' }}</span><small>{{ item.contact_masked || '联系方式未提供' }}</small></div></div><p v-else class="project-empty">暂无团队信息</p></section></template><section><h3>项目动态</h3><p v-if="activityError" class="portal-error" role="alert">{{ activityError }}</p><p v-if="activityLoading">正在加载项目动态…</p><div v-else-if="activities.length" class="project-activities"><p v-for="item in activities" :key="`${item.occurred_at}-${item.type}-${item.content}`"><small>{{ formatDate(item.occurred_at) }} · {{ item.type || '项目动态' }}</small><span>{{ item.content || '无动态内容' }}</span></p></div><p v-else class="project-empty">暂无项目动态</p><nav v-if="activityTotal > activityPageSize" class="project-pagination" aria-label="项目动态分页"><button type="button" :disabled="activityPage <= 1 || activityLoading" @click="changeActivityPage(activityPage - 1)">上一页</button><span>第 {{ activityPage }} / {{ Math.ceil(activityTotal / activityPageSize) }} 页，共 {{ activityTotal }} 条</span><button type="button" :disabled="activityPage >= Math.ceil(activityTotal / activityPageSize) || activityLoading" @click="changeActivityPage(activityPage + 1)">下一页</button></nav></section><section class="evaluation-panel"><h3>服务评价</h3><p v-if="!hasPermission('evaluation.read') && !hasPermission('evaluation.create')" class="project-empty">{{ serviceUnavailableText('evaluation_enabled', '当前账号没有评价读取或提交权限。') }}</p><p v-else-if="evaluationLoading">正在加载服务评价…</p><p v-else-if="evaluationError" class="portal-warning" role="status">{{ evaluationError }}，项目详情不受影响。</p><div v-else-if="evaluation" class="evaluation-readonly"><p><strong>综合评分 {{ evaluation.average_score }}</strong>（{{ evaluation.total_score }}/20）</p><dl><template v-for="[key, label] in scoreDimensions" :key="key"><dt>{{ label }}</dt><dd>{{ evaluation[key] }}/5</dd></template></dl><p v-if="evaluation.comment">评语：{{ evaluation.comment }}</p><small>提交于 {{ formatDate(evaluation.submitted_at) }}；提交后不可修改。</small></div><form v-else-if="evaluationEligibility?.eligible && hasPermission('evaluation.create')" aria-label="服务评分" @submit.prevent="submitProjectEvaluation"><p class="portal-info">项目已完成，欢迎您对本次服务进行评价；提交后不可修改，低分事项将由服务团队跟进。</p><fieldset v-for="[key, label] in scoreDimensions" :key="key"><legend>{{ label }}</legend><label v-for="score in 5" :key="score"><input v-model.number="evaluationForm[key]" type="radio" :name="key" :value="score" required><span>{{ score }} 分</span></label></fieldset><label>评语（可选）<textarea v-model.trim="evaluationForm.comment" maxlength="2000"></textarea></label><p>综合评分：{{ evaluationAverage }}/5</p><button :disabled="!evaluationReady">提交评价</button><small>评价提交后不可修改，请确认四项分值。</small></form><p v-else-if="evaluationEligibility?.eligible" class="project-empty">项目可评价，但当前账号没有评价提交权限。</p><p v-else-if="evaluationEligibility?.reason_code === 'PROJECT_NOT_COMPLETED'" class="portal-warning">项目完成后才可评价。</p><p v-else-if="evaluationEligibility">该项目已评价；只有原提交账号可以查看评价原文。</p></section><section class="project-actions"><h3>项目操作</h3><p v-if="!selectedProject.snapshot?.manager_message_available" class="portal-warning">项目来源尚未提供可验证的经理 Portal 接收账号，站内联系已关闭；姓名和脱敏联系方式不代表可投递身份。</p><button v-else-if="hasPermission('project.message.read')" type="button" :disabled="projectMessageLoading" @click="openProjectConversation">{{ projectMessageLoading ? '正在加载站内会话…' : '站内联系项目经理' }}</button><p v-if="projectMessageError" class="portal-error" role="alert">{{ projectMessageError }}</p><section v-if="projectConversation" class="project-conversation"><h3>与 {{ projectConversation.conversation?.manager_name || '项目经理' }} 的站内会话</h3><button v-if="projectConversation.messages?.has_more && projectConversation.messages?.next_before" type="button" :disabled="projectMessageOlderLoading" @click="loadOlderProjectMessages">{{ projectMessageOlderLoading ? '正在加载…' : '加载更早消息' }}</button><div v-for="item in projectConversation.messages?.items || []" :key="item.cursor" class="project-message"><strong>{{ item.sender_type === 'CUSTOMER' ? '我' : '项目经理' }}</strong><p>{{ item.content }}</p><small>{{ formatDate(item.accepted_at) }}</small></div><form v-if="hasPermission('project.message.send')" @submit.prevent="sendManagerMessage"><label>消息（纯文本，最多 2000 字）<textarea v-model="projectMessageContent" maxlength="2000" required></textarea></label><button :disabled="projectMessageLoading">发送站内消息</button></form></section><p v-if="!capabilityAvailable('project_export')" class="portal-warning">{{ capabilityReason('project_export') }}</p><p v-if="projectExportError" class="portal-error" role="alert">{{ projectExportError }}</p><button v-if="hasPermission('project.export')" type="button" :disabled="projectExportLoading || !capabilityAvailable('project_export')" @click="exportProjectPDF">{{ projectExportLoading ? '正在生成项目 PDF…' : '导出项目进度 PDF' }}</button></section></article></div>
    <div v-if="selectedFeedback && hasPermission('feedback.read')" class="portal-dialog" role="dialog" aria-modal="true"><article tabindex="-1"><button class="close" aria-label="关闭" @click="selectedFeedback = null">×</button><h2>{{ selectedFeedback.feedback.feedback_no }} · {{ selectedFeedback.feedback.title }}</h2><p>{{ feedbackStatus(selectedFeedback.feedback.status) }} · {{ slaText(selectedFeedback.feedback) }}</p><p>{{ selectedFeedback.feedback.description }}</p><p v-if="selectedFeedback.feedback.expected_contact_masked">联系方式：{{ selectedFeedback.feedback.expected_contact_masked }}</p><h3>处理时间线</h3><div v-for="item in selectedFeedback.status_logs" :key="`${item.occurred_at}-${item.to_status}`" class="feedback-message"><strong>{{ feedbackStatus(item.to_status) }}</strong><small>{{ formatDate(item.occurred_at) }} · {{ item.reason }}</small></div><h3>沟通记录</h3><div v-for="item in selectedFeedback.messages" :key="item.created_at" class="feedback-message"><strong>{{ item.sender_type === 'CUSTOMER' ? '我' : '服务人员' }}</strong><p>{{ item.content }}</p><small>{{ formatDate(item.created_at) }}</small></div><form v-if="hasPermission('feedback.reply') && !['CLOSED','REJECTED'].includes(selectedFeedback.feedback.status)" @submit.prevent="replyFeedback"><label>补充说明<textarea v-model.trim="feedbackReply" maxlength="5000" required></textarea></label><button>提交补充</button></form><button v-if="hasPermission('feedback.reply') && selectedFeedback.feedback.status === 'RESOLVED'" :disabled="feedbackClosing" @click="confirmCloseFeedback">{{ feedbackClosing ? '正在关闭…' : '确认关闭' }}</button></article></div>

  </div>
</template>
