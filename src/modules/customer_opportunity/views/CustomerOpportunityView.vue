<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import OwnerSelector from '../components/OwnerSelector.vue'
import { formatSignedContractCount } from '../signedContractCount.js'
import {
  checkCustomerDuplicate, commitCustomerImport, createCustomer, createCustomerFollowup, downloadCustomerImportErrors,
  createPortalInvite, disablePortalAccess, getCurrentPortalInvite, getPortalAccessStatus,
  getCustomer, listCustomerFollowups, listCustomers, previewCustomerImport,
  listCustomerAuditLogs, listCustomerContacts, listCustomerOpportunities, listCustomerProjects,
  listCustomerStakeholders, listCustomerSystems, mergeCustomers, replaceCustomerStakeholders, replaceCustomerSystems,
  requestCustomerExport, restoreCustomer, revokePortalInvite, updateCustomer, voidCustomer,
} from '../api/customer.js'
import { customerAPIParams, customerFiltersFromQuery, customerFiltersToQuery } from '../customerQuery.js'
import { presaleAPIParams, presaleStateFromQuery, presaleStateToQuery } from '../presaleQuery.js'
import { createPresaleMutationRetryState } from '../presaleMutationRetry.js'
import { closeSubsystemTabOrFallback } from '@/modules/shared/utils/returnToPortal'
import {
  changeOpportunityStage, completeOpportunityTerminalTodo, createOpportunity, createOpportunityFollowup,
  getOpportunity, getOpportunityBoard, getOpportunityExternalStatus, getOpportunityStageHistory, listOpportunities, listOpportunityFollowups,
  createQuotationLaunch, createBidLaunch,
  restoreOpportunity, updateOpportunity, voidOpportunity, changeOpportunityOwner,
  getOpportunityMembers, listOpportunityMemberTerms, replaceOpportunityMembers, listOpportunityStageAlerts,
  markOpportunityStageAlertRead, listOpportunityStageAlertRules, updateOpportunityStageAlertRule,
  listOpportunityPresaleRequests, transferOpportunityToContract,
  getOpportunityAttachmentCapabilities, listOpportunityAttachments, createOpportunityAttachmentUpload,
  completeOpportunityAttachmentUpload, downloadOpportunityAttachment,
} from '../api/opportunity.js'
import { createIdempotencyKey, getCRMSession, getCRMRuntimeCapabilities } from '../api/client.js'
import { createCreateMutationRetryState } from '../createMutationRetry.js'
import { createContractTransferRetryState } from '../contractTransferRetry.js'
import { createAttachmentUploadRetryState } from '../attachmentUploadRetry.js'
import { createMemberTermLoadState } from '../memberTermLoadState.js'
import { createPortalInviteRetryState } from '../portalInviteRetry.js'
import { createPortalAccessDisableRetryState } from '../portalAccessDisableRetry.js'
import { getNotificationUnreadCount, listNotifications, markNotificationRead } from '../api/notification.js'
import { listOwnerDirectory } from '../api/ownerDirectory.js'
import { parseNotificationTarget } from '../navigation.js'
import {
  addProgress, addWorklog, createPresaleRequest, getApprovalHistory, getAssignments, getPresaleRequest,
  getPresaleContactPhone,
  getPresaleAvailableActions, getPresaleBoard, getPresaleFilterOptions, getPresaleTimeline,
  cancelPresaleRequest, getWorklogDelivery, listPresaleRequests, listWorklogs, replaceAssignments, submitApprovalAction,
  retryWorklogDelivery, listPresaleAlerts, markPresaleAlertRead,
  listPresaleAlertRules, updatePresaleAlertRule, getPresaleReportSummary, getPresaleReportTrend,
  getPresaleReportDistribution, requestPresaleReportExport,
  listPresaleEngineers, syncPresaleEngineers,
} from '../api/presale.js'
import '@/modules/platform/styles/console.css'
import '../styles/customer-opportunity.css'

const route = useRoute()
const router = useRouter()
const sections = new Set(['customers', 'opportunities', 'presale', 'notifications'])
const customerIndustryOptions = Object.freeze([
  '金融', '政府', '医疗', '教育', '能源', '制造', '软件', '互联网', '通信',
  '物流', '交通', '建筑', '房地产', '零售', '服务', '其他',
])
const activeSection = computed(() => sections.has(route.params.section) ? route.params.section : 'customers')
const sectionTitle = computed(() => ({ customers: '客户管理', opportunities: '商机管理', presale: '售前技术支持', notifications: '个人通知中心' })[activeSection.value])
const mobileMenuOpen = ref(false)
const loading = ref(false)
const currentLoadSequence = ref(0)
const actionLoading = ref(false)
const error = ref('')
const notice = ref('')
const customers = ref([])
const opportunityCustomerOptions = ref([])
const opportunityCustomerOptionsLoading = ref(false)
const opportunityCustomerOptionsError = ref('')
const opportunityCustomerOptionsTotal = ref(0)
const opportunityCustomerKeyword = ref('')
const opportunityCustomerOptionsLoadSequence = ref(0)
const customerOwnerKeyword = ref('')
const customerOwnerOptions = ref([])
const customerOwnerOptionsLoading = ref(false)
const customerOwnerOptionsError = ref('')
const customerOwnerOptionsLoadSequence = ref(0)
const opportunities = ref([])
const board = ref([])
const presales = ref([])
const presaleBoard = ref([])
const presaleColumnLimit = ref(20)
const presaleView = ref('list')
const presaleFilterOptions = ref({ opportunities: [], applicants: [], assignees: [], statuses: [], venues: [], urgencies: [], push_statuses: [], truncated: false })
const presaleFilterOptionsError = ref('')
const presaleFilterOptionsLoadSequence = ref(0)
const selectedCustomer = ref(null)
const customerDetailLoadSequence = ref(0)
const customerTabLoadSequence = ref(0)
const selectedOpportunity = ref(null)
const selectedPresale = ref(null)
const presaleContactPhone = ref('')
const presaleContactPhoneLoading = ref(false)
const presaleContactPhoneError = ref('')
const presaleContactPhoneLoadSequence = ref(0)
const presaleAvailableActions = ref(null)
const presaleActionsLoading = ref(false)
const presaleActionsError = ref('')
const presaleActionsLoadSequence = ref(0)
const presaleTimeline = ref([])
const presaleTimelineCursor = ref('')
const presaleTimelineLoading = ref(false)
const presaleTimelineError = ref('')
const presaleTimelineLoadSequence = ref(0)
const presaleDetailLoadSequence = ref(0)
const engineerPickerOpen = ref(false)
const engineerDirectory = ref([])
const engineerSyncMeta = ref(null)
const selectedEngineerIDs = ref([])
const engineerQuery = reactive({ keyword: '', department: '', role: '', skill: '' })
const assignmentReason = ref('')
const stageHistory = ref([])
const followups = ref([])
const customerFollowups = ref([])
const customerContacts = ref([])
const customerStakeholders = ref([])
const customerSystems = ref([])
const customerOpportunities = ref([])
const customerProjects = ref([])
const customerProjectsLoading = ref(false)
const customerProjectLoadSequence = ref(0)
const customerProjectsPage = reactive({ number: 1, size: 20, total: 0 })
const customerAuditLogs = ref([])
const currentPortalInvite = ref(null)
const portalAccessStatus = ref(null)
const portalActivationURL = ref('')
const portalInviteCopied = ref(false)
const portalInviteRevokeReason = ref('')
const portalInviteLoading = ref(false)
const portalAccessDisableReason = ref('')
const portalAccessDisableLoading = ref(false)
const customerTab = ref('basic')
const customerTabLoading = ref(false)
const customerTabErrors = reactive({})
const customerTabLoaded = reactive({})
const worklogs = ref([])
const customerDialog = ref(false)
const customerImportDialog = ref(false)
const customerEditMode = ref(false)
const opportunityDialog = ref(false)
const opportunityEditMode = ref(false)
const stageDialog = ref(false)
const terminalDialog = ref(false)
const followupDialog = ref(false)
const customerFollowupDialog = ref(false)
const customerMergeDialog = ref(false)
const customerStakeholderDialog = ref(false)
const customerSystemDialog = ref(false)
const ownerDialog = ref(false)
const teamDialog = ref(false)
const boardMode = ref(false)
const page = reactive({ number: 1, size: 20, total: 0 })
const filters = reactive({ keyword: '', status: '', stage: '', overdue: '' })
const initialPresaleState = presaleStateFromQuery(route.query)
const presaleFilters = reactive(initialPresaleState.filters)
presaleView.value = initialPresaleState.view
presaleColumnLimit.value = initialPresaleState.columnLimit
const presalePage = reactive({ number: initialPresaleState.page, size: initialPresaleState.pageSize, total: 0 })
const customerFilters = reactive(customerFiltersFromQuery(route.query))
const customerForm = reactive(emptyCustomer())
const opportunityForm = reactive(emptyOpportunity())
let customerFormInitial = ''
let opportunityFormInitial = ''
let presaleFormInitial = ''
const customerFormDirty = computed(() => customerFormInitial !== '' && JSON.stringify(customerForm) !== customerFormInitial)
const opportunityFormDirty = computed(() => opportunityFormInitial !== '' && JSON.stringify(opportunityForm) !== opportunityFormInitial)
const presaleFormDirty = computed(() => presaleFormInitial !== '' && JSON.stringify(presaleForm) !== presaleFormInitial)
function confirmDiscardIfDirty(dirty) { return !dirty || window.confirm('当前修改尚未保存，确定放弃吗？') }
function closeCustomerDialog() {
  if (actionLoading.value) return
  if (!confirmDiscardIfDirty(customerFormDirty.value)) return
  customerDialog.value = false
  customerFormInitial = ''
}
function closeOpportunityDialog() {
  if (actionLoading.value) return
  if (!confirmDiscardIfDirty(opportunityFormDirty.value)) return
  opportunityDialog.value = false
  opportunityFormInitial = ''
}
const stageForm = reactive({ target_stage: '', reason: '', contract_ref: '', lost_reason: '' })
const terminalForm = reactive({ reason: '', contract_ref: '', lost_reason: '' })
const followupForm = reactive({ type: 'PHONE', content: '', followed_at: '', next_follow_at: '' })
const customerFollowupForm = reactive({ type: 'PHONE', content: '', followed_at: '', next_follow_at: '' })
const customerMergeForm = reactive({ target_customer_id: '', reason: '', target: null })
const customerMergeKeyword = ref('')
const customerMergeOptions = ref([])
const customerMergeOptionsLoading = ref(false)
const customerMergeOptionsError = ref('')
const customerMergeOptionsTotal = ref(0)
const customerMergeOptionsLoadSequence = ref(0)
const customerImportForm = reactive({ file: null, reason: '' })
const customerImportPreview = ref(null)
const customerImportResult = ref(null)
const customerImportCommitKey = ref('')
const customerStakeholderForm = reactive({ reason: '', items: [] })
const customerSystemForm = reactive({ reason: '', items: [] })
const ownerForm = reactive({ owner_user_id: '', owner_org_id: '', reason: '' })
const teamForm = reactive({ members: [], reason: '' })
const teamDirectoryKeyword = ref('')
const teamDirectoryOptions = ref([])
const teamDirectoryLoading = ref(false)
const teamDirectoryError = ref('')
const teamDirectoryLoadSequence = ref(0)
const teamCandidate = reactive({ user_id: '', role: 'TECHNICAL_SUPPORT' })
const opportunityTeam = ref([])
const opportunityTeamDirectoryAvailable = ref(true)
const opportunityMemberTerms = ref([])
const opportunityMemberTermsLoading = ref(false)
const opportunityMemberTermsError = ref('')
const opportunityMemberTermsPage = reactive({ number: 1, size: 10, total: 0 })
const opportunityMemberTermLoads = createMemberTermLoadState()
const opportunityPresales = ref([])
const opportunityPresaleLoading = ref(false)
const opportunityPresaleError = ref('')
const opportunityPresalePage = reactive({ number: 1, size: 10, total: 0 })
const opportunityPresaleLoadSequence = ref(0)
const opportunityExternalStatus = ref(null)
const opportunityQuoteAmountCheck = ref(null)
const opportunityExternalStatusLoading = ref(false)
const opportunityExternalStatusError = ref('')
const opportunityLaunchLoading = ref('')
const opportunityLaunchError = ref('')
const contractTransferLoading = ref(false)
const opportunityAttachments = ref([])
const opportunityAttachmentCapabilities = ref(null)
const opportunityAttachmentLoading = ref(false)
const opportunityAttachmentError = ref('')
const opportunityAttachmentFile = ref(null)
const presaleCreatePage = ref(false)
const presaleCreateDialog = ref(false)
const presaleForm = reactive({ opportunity_id: '', venue: 'REMOTE', service_address: '', contact_name: '', contact_phone: '', description: '', expected_start: '', expected_end: '', urgency: 'NORMAL' })
const presaleOpportunityKeyword = ref('')
const presaleOpportunityOptions = ref([])
const presaleOpportunityOptionsLoading = ref(false)
const presaleOpportunityOptionsError = ref('')
const presaleOpportunityOptionsTotal = ref(0)
const presaleOpportunityOptionsLoadSequence = ref(0)
const operation = reactive({ progress: '', progress_link: '', progress_pct: '', work_start: '', work_end: '', raw_unit: 'HOUR', raw_value: '', work_site_address: '', work_content: 'SOLUTION_DESIGN', remark: '', worklog_id: '' })
const presaleResult = ref(null)
const progressSubmissionKey = ref('')
const progressSubmissionSignature = ref('')
// 跨系统写入和多步骤上传分别保存稳定幂等状态：网络结果不明确时复用原键，只有服务端
// 明确成功后才清理，避免客户、商机、邀请、合同事件或附件会话被重复创建。
const presaleMutationRetries = createPresaleMutationRetryState(createIdempotencyKey)
const createMutationRetries = createCreateMutationRetryState(createIdempotencyKey)
const contractTransferRetries = createContractTransferRetryState(createIdempotencyKey)
const attachmentUploadRetries = createAttachmentUploadRetryState(createIdempotencyKey)
const portalInviteRetries = createPortalInviteRetryState(createIdempotencyKey)
const portalAccessDisableRetries = createPortalAccessDisableRetryState(createIdempotencyKey)
const presaleMutationLoading = ref(false)
const presaleCreateLoading = ref(false)
const presaleMutationContextSequence = ref(0)
const presaleMutationLoadSequence = ref(0)
const alerts = ref([])
const alertRules = ref([])
const showAlertConfig = ref(false)
const showReport = ref(false)
const reportLoading = ref(false)
const reportSummary = ref(null)
const reportTrend = ref([])
const reportDistribution = ref([])
const reportFilters = reactive(defaultReportFilters())
const reportOrganizationOptions = ref([])
const reportFilterOptionsLoading = ref(false)
const reportFilterOptionsError = ref('')
const crmSession = ref(null)
const crmRoleNames = Object.freeze({
  sales: '销售人员',
  sales_director: '销售总监',
  team_lead: '团队负责人',
  technician: '技术人员',
  implementation_engineer: '实施工程师',
  technical_lead: '技术负责人',
  customer_admin: '客户管理员',
  auditor: '审计员',
})
const currentUserLabel = computed(() => String(crmSession.value?.display_name || crmSession.value?.user_id || '').trim() || '当前用户')
const currentUserInitial = computed(() => {
  const label = currentUserLabel.value
  return /^[\x00-\x7F]+$/.test(label) ? label.slice(0, 2).toUpperCase() : Array.from(label)[0] || '用'
})
const currentRoleLabel = computed(() => {
  const roles = Array.isArray(crmSession.value?.roles) ? crmSession.value.roles : []
  return [...new Set(roles.map((role) => crmRoleNames[role] || role).filter(Boolean))].join('、') || '未分配角色'
})
const runtimeCapabilities = ref({})
const runtimeCapabilitiesError = ref('')
const runtimeCapabilitiesLoading = ref(false)
const notifications = ref([])
const notificationUnreadCount = ref(0)
const notificationUnreadOnly = ref(false)
const stageAlerts = ref([])
const stageAlertUnreadOnly = ref(false)
const selectedStageAlert = ref(null)
const stageAlertRules = ref([])
const showStageAlertRules = ref(false)
const stageRuleForbidden = ref(false)
const canReadOpportunities = computed(() => (crmSession.value?.permissions || []).includes('opportunity.read'))
const canReadPresales = computed(() => (crmSession.value?.permissions || []).includes('presale.read'))
const canReadNotifications = computed(() => canReadOpportunities.value || canReadPresales.value)
const canConfigureStageAlerts = computed(() => (crmSession.value?.permissions || []).includes('opportunity.alert.config'))
const canSyncEngineers = computed(() => (crmSession.value?.permissions || []).includes('presale.engineer.sync'))
const canReadCustomerAudit = computed(() => (crmSession.value?.permissions || []).includes('customer.audit.read'))
const canProvisionPortalAccount = computed(() => (crmSession.value?.permissions || []).includes('portal_account.provision'))
const canRevokePortalAccount = computed(() => (crmSession.value?.permissions || []).includes('portal_account.revoke'))
const canDisablePortalAccount = computed(() => (crmSession.value?.permissions || []).includes('portal_account.disable'))
const canReadPortalInvite = computed(() => canProvisionPortalAccount.value || canRevokePortalAccount.value)
const canReadPortalAccessStatus = computed(() => canProvisionPortalAccount.value || canDisablePortalAccount.value)
const canViewPortalAccess = computed(() => canReadPortalInvite.value || canReadPortalAccessStatus.value)
const portalAccessDisableInProgress = computed(() => ['PROCESSING', 'RETRY_WAIT'].includes(portalAccessStatus.value?.operation_status))
const canGeneratePortalInvite = computed(() => portalAccessStatus.value?.access_status !== 'DISABLED' && !portalAccessDisableInProgress.value)
const canCreateCustomer = computed(() => (crmSession.value?.permissions || []).includes('customer.create'))
const canExportCustomers = computed(() => (crmSession.value?.permissions || []).includes('customer.export'))
const canUpdateCustomer = computed(() => (crmSession.value?.permissions || []).includes('customer.update'))
const canImportCustomers = computed(() => (crmSession.value?.permissions || []).includes('customer.import'))
const canCreatePresale = computed(() => (crmSession.value?.permissions || []).includes('presale.create'))
const canViewSelectedPresaleContactPhone = computed(() =>
  (crmSession.value?.permissions || []).includes('presale.contact_phone.read') && selectedPresale.value?.can_view_contact_phone === true)
const canTransferOpportunity = computed(() => (crmSession.value?.permissions || []).includes('opportunity.contract.transfer'))
const canUpdateOpportunity = computed(() => (crmSession.value?.permissions || []).includes('opportunity.update'))
const canManageOpportunityTeam = computed(() => (crmSession.value?.permissions || []).includes('opportunity.team.manage'))
const canReadOpportunityAttachments = computed(() => (crmSession.value?.permissions || []).includes('opportunity.attachment.read'))
const canUploadOpportunityAttachments = computed(() => (crmSession.value?.permissions || []).includes('opportunity.attachment.upload'))
const canDownloadOpportunityAttachments = computed(() => (crmSession.value?.permissions || []).includes('opportunity.attachment.download'))
const authoritativePresaleActions = computed(() => presaleAvailableActions.value?.actions || [])

// 能力状态缺失或读取失败时默认关闭集成入口，避免把“未知”误判为“可用”后发起跨系统写操作。
function runtimeCapability(code) {
  return runtimeCapabilities.value?.[code] || { available: false, mode: 'FAIL_CLOSED', reason_code: 'CAPABILITY_STATUS_UNAVAILABLE' }
}
async function refreshRuntimeCapabilities() {
  if (runtimeCapabilitiesLoading.value) return
  runtimeCapabilitiesLoading.value = true
  runtimeCapabilitiesError.value = ''
  try {
    const value = await getCRMRuntimeCapabilities()
    runtimeCapabilities.value = value?.capabilities || {}
  } catch {
    runtimeCapabilities.value = {}
    runtimeCapabilitiesError.value = '可选集成能力状态暂时无法读取；相关操作已安全关闭，核心查询不受影响。'
  } finally {
    runtimeCapabilitiesLoading.value = false
  }
}
const portalModuleAvailable = computed(() => runtimeCapability('portal_account_provision').available || runtimeCapability('portal_access_disable').available)
const portalProvisionAvailable = computed(() => runtimeCapability('portal_account_provision').available)
const portalDisableAvailable = computed(() => runtimeCapability('portal_access_disable').available)
const customerImportScanAvailable = computed(() => runtimeCapability('customer_import_scan').available)
const customerExportAvailable = computed(() => runtimeCapability('customer_export').available)
const presaleReportExportAvailable = computed(() => runtimeCapability('presale_report_export').available)
const presaleRequestSubmissionAvailable = computed(() => runtimeCapability('presale_request_submission').available)
const qbLaunchQuotationAvailable = computed(() => runtimeCapability('qb_launch_quotation').available)
const qbLaunchBidAvailable = computed(() => runtimeCapability('qb_launch_bid').available)
const qbActiveQueryMode = computed(() => runtimeCapability('qb_active_query').mode)

function defaultReportFilters() {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { from: start.toISOString().slice(0, 16), to: end.toISOString().slice(0, 16), organization_id: '', person_id: '', opportunity_id: '', dimension: 'PERSON' }
}

function emptyCustomer() {
  return { name: '', unified_credit_code: '', customer_type: '', industry: '', region: '', owner_user_id: '', owner_org_id: '', reason: '', duplicate_override: false, duplicate_override_reason: '', contacts: [{ id: 0, name: '', phone: '', email: '', is_registration: true }] }
}
function emptyStakeholder() {
  return { id: 0, name: '', role_title: '', influence: 'MEDIUM', relationship_summary: '', phone: '', email: '', replace_phone: false, replace_email: false }
}
function emptyInformationSystem() {
  return { name: '', protection_level: 'LEVEL_2', application_scenario: '', filing_no: '', grading_date: '', filing_status: 'NOT_FILED' }
}
function influenceText(value) { return ({ LOW: '低', MEDIUM: '中', HIGH: '高' })[value] || value }
function protectionLevelText(value) { return ({ LEVEL_1: '一级', LEVEL_2: '二级', LEVEL_3: '三级', LEVEL_4: '四级', LEVEL_5: '五级' })[value] || value }
function filingStatusText(value) { return ({ NOT_FILED: '未备案', FILING: '备案中', FILED: '已备案' })[value] || value }
function importRowStatusText(value) { return ({ READY: '可导入', WARNING: '警告（本次跳过）', ERROR: '错误', IMPORTED: '已导入', FAILED: '导入失败' })[value] || value }
function projectStatusText(value) { return ({ PLANNED: '计划中', IN_PROGRESS: '进行中', ON_HOLD: '已暂停', COMPLETED: '已完成', CANCELLED: '已取消' })[value] || value || '—' }
function projectProgressText(value) {
  const progress = Number(value)
  return Number.isFinite(progress) && progress >= 0 && progress <= 100 ? `${progress}%` : '—'
}
function emptyOpportunity() {
  return { name: '', customer_id: '', type: '', source: '', expected_amount: '', expected_sign_date: '', requirement_summary: '', system_count: 0, pain_points: '', competitor_info: '', owner_user_id: '', owner_org_id: '', reason: '' }
}
function resetMessages() { error.value = ''; notice.value = '' }
function showError(value) {
  if (value?.status === 409) error.value = value.code === 'CRM_CUSTOMER_VOID_BLOCKED' ? '客户仍有关联中的商机、售前申请或门户邀请，暂不能作废。' : '数据状态或版本已变化，请刷新详情后重试。'
  else if (value?.code === 'CRM_OPPORTUNITY_MEMBER_INVALID') error.value = '所选团队人员已停用或不再具有本应用授权，请重新从基础平台人员目录选择。'
  else if (value?.code === 'CRM_OWNER_DIRECTORY_UNAVAILABLE') error.value = '基础平台人员目录暂不可用，本次人员变更未保存。'
  else if (value?.code === 'INTEGRATION_CONTRACT_NOT_CONFIGURED') error.value = '合同归属校验服务尚未配置，合同类终态待办暂不能完成。'
  else error.value = value?.message || '操作失败'
}
function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
function portalInviteStatusText(value) {
  return ({ PENDING: '待激活', USED: '已使用', EXPIRED: '已过期', REVOKED: '已撤销' })[value] || value || '尚未生成'
}
const portalRegistrationContact = computed(() => (selectedCustomer.value?.contacts || []).find((item) => item.is_registration) || null)
function navigate(section) {
  if (activeSection.value === 'presale' && presaleCreatePage.value && !confirmDiscardIfDirty(presaleFormDirty.value)) return
  mobileMenuOpen.value = false
  return router.push({ name: 'customer_opportunity', params: { section } })
}
function navigatePlatform() {
  mobileMenuOpen.value = false
  closeSubsystemTabOrFallback(window, () => router.replace({ name: 'portal' }))
}
function assignees(value) { return (value || []).map((item) => item.person_name || item.person_id).join('、') || '未指派' }
// 指派接口采用全量替换语义；以当前指派为基线计算差异，可让已停用或不在本次目录结果中的人员
// 被明确保留或移出，避免一次目录筛选把仍有效的既有指派静默删除。
const assignmentDiff = computed(() => {
  const current = new Set((selectedPresale.value?.current_assignees || []).map((item) => item.person_id))
  const target = new Set(selectedEngineerIDs.value)
  const names = new Map(engineerDirectory.value.map((item) => [item.person_id, `${item.person_name}（${item.person_id}）`]))
  return { added: [...target].filter((id) => !current.has(id)).map((id) => names.get(id) || id), retained: [...target].filter((id) => current.has(id)).map((id) => names.get(id) || id), removed: [...current].filter((id) => !target.has(id)).map((id) => names.get(id) || id) }
})
const unavailableCurrentAssignees = computed(() => {
  const visible = new Set(engineerDirectory.value.map((item) => item.person_id))
  return (selectedPresale.value?.current_assignees || []).filter((item) => !visible.has(item.person_id))
})
function alertText(level) { return level === 'OVERDUE' ? '已超时' : level === 'DUE_SOON' ? '即将超时' : '正常' }
function customerStatusText(value) {
  return ({ ACTIVE: '有效', VOID: '已作废', MERGED: '已合并' })[value] || value || '—'
}
function opportunityStatusText(value) {
  return ({ FOLLOWING: '跟进中', CLOSED: '已关闭', VOID: '已作废' })[value] || value || '—'
}
function terminalPendingText(value) {
  return value === 'CONTRACT' ? '待关联合同' : value === 'LOST_REASON' ? '待补失败原因' : '无'
}
function formatAmount(value) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''))
  if (!Number.isFinite(number)) return '—'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)
}
const customerTypeSuggestions = Object.freeze(['业主', '三方', '集成商', '代理商', '渠道', '其他'])
const customerRegionSuggestions = Object.freeze(['华北', '华东', '华南', '华中', '西南', '西北', '东北', '海外', '其他'])
const customerStatusOptions = Object.freeze([{ value: 'ACTIVE', label: '有效' }, { value: 'VOID', label: '已作废' }, { value: 'MERGED', label: '已合并' }])
const opportunityStatusOptions = Object.freeze([{ value: 'FOLLOWING', label: '跟进中' }, { value: 'CLOSED', label: '已关闭' }, { value: 'VOID', label: '已作废' }])
const opportunityStageOptions = Object.freeze(['初步接触', '需求沟通', '方案制定', '报价', '投标', '已签约', '失败'])
const ownerDirectoryNames = ref({})
function rememberOwnerDirectory(items) {
  for (const item of items || []) {
    if (item?.user_id && item?.display_name) ownerDirectoryNames.value[item.user_id] = item.display_name
  }
}
function ownerLabel(userId) { return ownerDirectoryNames.value[userId] || userId || '—' }

// 列表或详情里的负责人可能不在已加载的目录分页中；按缺失的用户 ID 精确查询并缓存名字，
// 让“负责人”列优先显示姓名而不是原始用户 ID。目录暂不可用时静默保持 ID 回退。
async function resolveOwnerNames(userIDs) {
  const missing = [...new Set((userIDs || []).filter((id) => id && !ownerDirectoryNames.value[id]))]
  if (!missing.length) return
  let index = 0
  async function worker() {
    while (index < missing.length) {
      const id = missing[index++]
      try {
        const result = await listOwnerDirectory({ user_id: id, page: 1, page_size: 1 })
        rememberOwnerDirectory(result?.items || [])
      } catch {
        // 目录暂不可用时保持 ID 回退，不影响列表本身。
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(missing.length, 8) }, worker))
}
const reasonDialog = reactive({ open: false, title: '', label: '', required: false, confirmText: '确认', reason: '', onSubmit: null })
const reasonDialogError = ref('')
function askReason(options) {
  reasonDialogError.value = ''
  Object.assign(reasonDialog, { open: true, reason: '', ...options })
}
function closeReasonDialog() {
  if (actionLoading.value) return
  reasonDialog.open = false
  reasonDialog.onSubmit = null
  reasonDialogError.value = ''
}
async function confirmReasonDialog() {
  const reason = reasonDialog.reason.trim()
  if (reasonDialog.required && !reason) {
    reasonDialogError.value = `${reasonDialog.label || '原因'}为必填项。`
    return
  }
  const onSubmit = reasonDialog.onSubmit
  reasonDialog.open = false
  reasonDialog.onSubmit = null
  reasonDialogError.value = ''
  if (onSubmit) await onSubmit(reason)
}
function requestStatusText(value) {
  return ({ APPROVAL_STARTING: '审批发起中', PENDING_APPROVAL: '待审批', APPROVED_PENDING_ASSIGNMENT: '审批通过，待指派', EXECUTING: '执行中', COMPLETED: '已完成', REJECTED: '已驳回', CANCELLED: '已取消' })[value] || '未知状态'
}
function venueText(value) { return ({ REMOTE: '远程', ONSITE: '现场' })[value] || '未知场地' }
function urgencyText(value) { return ({ NORMAL: '普通', URGENT: '紧急' })[value] || '未知级别' }
function pushStatusText(value) {
  return ({ PENDING: '待推送', SENDING: '推送中', SUCCESS: '推送成功', RETRY_WAIT: '等待重试', DEAD_LETTER: '推送失败' })[value] || '未知推送状态'
}
function presaleOptionText(group, item) {
  if (group === 'statuses') return requestStatusText(item.value)
  if (group === 'venues') return venueText(item.value)
  if (group === 'urgencies') return urgencyText(item.value)
  if (group === 'push_statuses') return pushStatusText(item.value)
  return item.label || item.value
}
function actionText(value) {
  return ({ APPROVE: '通过审批', REJECT: '驳回审批', ASSIGN: '指派执行人', ADD_PROGRESS: '登记进度', ADD_WORKLOG: '登记工时', CANCEL: '取消申请' })[value] || '未知操作'
}
function timelineEventText(value) {
  return ({ REQUEST_CREATED: '售前申请已创建', STATUS_CHANGED: '任务状态已变更', APPROVAL_DECIDED: '审批已处理', ASSIGNEE_ADDED: '已加入执行人', ASSIGNEE_REMOVED: '已移出执行人', PROGRESS_ADDED: '已登记进度', WORKLOG_ADDED: '已登记工时' })[value] || '流程记录'
}
function approvalResultText(value) {
  return ({ PASS: '通过', APPROVED: '通过', REJECT: '驳回', REJECTED: '驳回' })[value] || '已处理'
}
function workContentText(value) {
  return ({ SOLUTION_DESIGN: '方案设计', TECH_EXCHANGE: '技术交流', POC_DEMO: 'POC 演示', TECH_QA: '技术答疑', OTHER: '其他' })[value] || '其他工作'
}
function safeHTTPSURL(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' ? parsed.href : ''
  } catch { return '' }
}
function alertTypeText(type) { return ({ APPROVAL_NODE_1_OVERDUE: '节点 1 审批超时', APPROVAL_NODE_2_OVERDUE: '节点 2 审批超时', ASSIGNMENT_OVERDUE: '待指派超时', EXECUTION_DUE_SOON: '执行截止提前提醒', EXECUTION_OVERDUE: '执行超期' })[type] || type }
function stageAlertStatusText(status) {
  return ({ PENDING: '待处理', UNREAD: '已触发（未读）', READ: '已触发（已读）', CANCELLED: '已取消' })[status] || status
}
function reportParams() {
  return {
    from: new Date(reportFilters.from).toISOString(), to: new Date(reportFilters.to).toISOString(),
    organization_id: reportFilters.organization_id, person_id: reportFilters.person_id,
    opportunity_id: reportFilters.opportunity_id, dimension: reportFilters.dimension,
  }
}
function reportBarWidth(value) {
  const maximum = Math.max(0, ...reportDistribution.value.map((item) => Number(item.work_hours || 0)))
  return maximum > 0 ? `${Math.max(2, Number(value || 0) / maximum * 100)}%` : '0%'
}
async function openReports() {
  showReport.value = true
  await loadReportFilterOptions()
  await loadReports()
}
async function loadReports() {
  reportLoading.value = true; resetMessages()
  try {
    const params = reportParams()
    const [summary, trend, distribution] = await Promise.all([getPresaleReportSummary(params), getPresaleReportTrend(params), getPresaleReportDistribution(params)])
    reportSummary.value = summary; reportTrend.value = trend || []; reportDistribution.value = distribution || []
  } catch (value) { showError(value) } finally { reportLoading.value = false }
}
async function exportReport() {
  if (!presaleReportExportAvailable.value) {
    error.value = '售前报表异步导出依赖对象存储与导出 Worker，当前环境尚未配置。'
    return
  }
  try {
    const { dimension, ...payload } = reportParams()
    await requestPresaleReportExport({ ...payload, opportunity_id: payload.opportunity_id ? Number(payload.opportunity_id) : 0 })
  } catch (value) {
    if (value?.code === 'CRM_PRESALE_REPORT_EXPORT_UNAVAILABLE') error.value = '异步导出尚未接通对象存储与导出 Worker；服务端已安全关闭该能力。'
    else showError(value)
  }
}
function openNewCustomer() {
  Object.assign(customerForm, emptyCustomer())
  customerEditMode.value = false
  customerFormInitial = JSON.stringify(customerForm)
  customerDialog.value = true
}
function openCustomerImport() {
  if (!customerImportScanAvailable.value) {
    error.value = '客户导入依赖可信文件扫描器，当前环境尚未配置，入口已安全关闭。'
    return
  }
  Object.assign(customerImportForm, { file: null, reason: '' })
  customerImportPreview.value = null; customerImportResult.value = null; customerImportCommitKey.value = ''
  customerImportDialog.value = true
}
function resetCustomerImportPreview() {
  customerImportPreview.value = null; customerImportResult.value = null; customerImportCommitKey.value = ''
  customerImportForm.file = null
}
function closeCustomerImport() {
  resetCustomerImportPreview(); customerImportForm.reason = ''; customerImportDialog.value = false
}
function selectCustomerImportFile(event) {
  const file = event.target.files?.[0] || null
  customerImportForm.file = file?.name?.toLowerCase().endsWith('.xlsx') ? file : null
  if (file && !customerImportForm.file) error.value = '只接受 .xlsx 文件，请重新选择。'
}
function showCustomerImportError(value) {
  if (value?.code === 'CRM_CUSTOMER_IMPORT_SCANNER_UNAVAILABLE') error.value = '客户导入必须先通过服务端病毒扫描；扫描器尚未配置，当前功能未接通。'
  else if (value?.code === 'CRM_CUSTOMER_IMPORT_FILE_REJECTED') error.value = '文件未通过服务端安全扫描，已拒绝预检。'
  else if (value?.code === 'CRM_CUSTOMER_IMPORT_FILE_INVALID') error.value = 'Excel 文件格式、表头或内容不符合导入规范。'
  else if (value?.code === 'CRM_CUSTOMER_IMPORT_JOB_EXPIRED' || value?.code === 'CRM_CUSTOMER_IMPORT_JOB_CONFLICT' || value?.code === 'COMMON_VERSION_CONFLICT' || value?.status === 409) {
    error.value = '导入预检已过期或状态发生变化，请重新上传文件预检。'
    customerImportPreview.value = null
  } else showError(value)
}
async function previewImport() {
  if (!customerImportForm.file || !customerImportForm.reason.trim()) return
  actionLoading.value = true; resetMessages()
  try {
    customerImportPreview.value = await previewCustomerImport({ file: customerImportForm.file, reason: customerImportForm.reason.trim() })
    customerImportResult.value = null
    customerImportCommitKey.value = createIdempotencyKey()
    // 服务端接受文件并生成预检任务后，浏览器不再解析或持久保存工作簿内容。
    customerImportForm.file = null
  } catch (value) { showCustomerImportError(value) } finally { actionLoading.value = false }
}
async function commitImport() {
  const preview = customerImportPreview.value
  if (!preview || Number(preview.importable_rows) <= 0) return
  actionLoading.value = true; resetMessages()
  try {
    if (!customerImportCommitKey.value) customerImportCommitKey.value = createIdempotencyKey()
    customerImportResult.value = await commitCustomerImport(preview.job_no, { version: Number(preview.version) }, customerImportCommitKey.value)
    customerImportPreview.value = { ...preview, version: customerImportResult.value.version, status: customerImportResult.value.status }
    notice.value = `客户导入完成：成功 ${customerImportResult.value.succeeded_rows || 0} 行，失败 ${customerImportResult.value.failed_rows || 0} 行，跳过 ${customerImportResult.value.skipped_rows || 0} 行。`
    await loadCurrent()
  } catch (value) { showCustomerImportError(value) } finally { actionLoading.value = false }
}
async function downloadImportErrors() {
  const jobNo = customerImportResult.value?.job_no || customerImportPreview.value?.job_no
  if (!jobNo) return
  try {
    const { blob, filename } = await downloadCustomerImportErrors(jobNo)
    const objectURL = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectURL; link.download = filename
    document.body.appendChild(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectURL), 0)
  } catch (value) { showCustomerImportError(value) }
}
async function loadOpportunityCustomerOptions() {
  const sequence = ++opportunityCustomerOptionsLoadSequence.value
  opportunityCustomerOptionsLoading.value = true
  opportunityCustomerOptionsError.value = ''
  try {
    const result = await listCustomers({
      keyword: opportunityCustomerKeyword.value.trim(), status: 'ACTIVE',
      page: 1, page_size: 100, sort_by: 'name', sort_order: 'asc',
    })
    if (sequence !== opportunityCustomerOptionsLoadSequence.value || opportunityEditMode.value) return
    opportunityCustomerOptions.value = result?.items || []
    opportunityCustomerOptionsTotal.value = Number(result?.total || 0)
    if (opportunityForm.customer_id && !opportunityCustomerOptions.value.some((item) => String(item.id) === String(opportunityForm.customer_id))) {
      opportunityForm.customer_id = ''
    }
  } catch (value) {
    if (sequence !== opportunityCustomerOptionsLoadSequence.value) return
    opportunityCustomerOptions.value = []
    opportunityCustomerOptionsTotal.value = 0
    opportunityCustomerOptionsError.value = value?.message || '客户列表加载失败，请稍后重试。'
  } finally {
    if (sequence === opportunityCustomerOptionsLoadSequence.value) opportunityCustomerOptionsLoading.value = false
  }
}

function directoryErrorMessage(value) {
  if (value?.status === 403) return '当前账号没有读取平台人员目录的权限。'
  if (value?.code === 'CRM_OWNER_DIRECTORY_UNAVAILABLE' || value?.status === 503) return '基础平台人员目录暂不可用。'
  return value?.message || '平台人员目录加载失败。'
}

function preserveDirectorySelection(previous, loaded, selectedID) {
  const selected = previous.find((item) => item.user_id === selectedID)
  return selected && !loaded.some((item) => item.user_id === selected.user_id) ? [selected, ...loaded] : loaded
}

async function loadCustomerOwnerOptions() {
  const sequence = ++customerOwnerOptionsLoadSequence.value
  customerOwnerOptionsLoading.value = true
  customerOwnerOptionsError.value = ''
  try {
    const result = await listOwnerDirectory({ keyword: customerOwnerKeyword.value.trim(), page: 1, page_size: 50 })
    if (sequence !== customerOwnerOptionsLoadSequence.value) return
    customerOwnerOptions.value = preserveDirectorySelection(customerOwnerOptions.value, result?.items || [], customerFilters.owner_id)
    rememberOwnerDirectory(result?.items)
  } catch (value) {
    if (sequence !== customerOwnerOptionsLoadSequence.value) return
    customerOwnerOptionsError.value = directoryErrorMessage(value)
  } finally {
    if (sequence === customerOwnerOptionsLoadSequence.value) customerOwnerOptionsLoading.value = false
  }
}

async function loadCustomerMergeOptions() {
  const sequence = ++customerMergeOptionsLoadSequence.value
  customerMergeOptionsLoading.value = true
  customerMergeOptionsError.value = ''
  try {
    const result = await listCustomers({
      keyword: customerMergeKeyword.value.trim(), status: 'ACTIVE',
      page: 1, page_size: 100, sort_by: 'name', sort_order: 'asc',
    })
    if (sequence !== customerMergeOptionsLoadSequence.value || !customerMergeDialog.value) return
    customerMergeOptions.value = (result?.items || []).filter((item) => Number(item.id) !== Number(selectedCustomer.value?.id))
    customerMergeOptionsTotal.value = Math.max(0, Number(result?.total || 0) - (result?.items || []).filter((item) => Number(item.id) === Number(selectedCustomer.value?.id)).length)
    if (customerMergeForm.target_customer_id && !customerMergeOptions.value.some((item) => String(item.id) === String(customerMergeForm.target_customer_id))) {
      Object.assign(customerMergeForm, { target_customer_id: '', target: null })
    }
  } catch (value) {
    if (sequence !== customerMergeOptionsLoadSequence.value) return
    customerMergeOptions.value = []; customerMergeOptionsTotal.value = 0
    customerMergeOptionsError.value = value?.message || '可合并客户加载失败，请稍后重试。'
  } finally {
    if (sequence === customerMergeOptionsLoadSequence.value) customerMergeOptionsLoading.value = false
  }
}

async function loadPresaleOpportunityOptions() {
  const sequence = ++presaleOpportunityOptionsLoadSequence.value
  presaleOpportunityOptionsLoading.value = true
  presaleOpportunityOptionsError.value = ''
  try {
    const result = await listOpportunities({ keyword: presaleOpportunityKeyword.value.trim(), page: 1, page_size: 100, sort_by: 'updated_at', sort_order: 'desc' })
    if (sequence !== presaleOpportunityOptionsLoadSequence.value || !presaleCreatePage.value) return
    presaleOpportunityOptions.value = (result?.items || []).filter((item) => item.opp_status !== 'VOID')
    presaleOpportunityOptionsTotal.value = Number(result?.total || 0)
    if (presaleForm.opportunity_id && !presaleOpportunityOptions.value.some((item) => String(item.id) === String(presaleForm.opportunity_id))) {
      presaleForm.opportunity_id = ''
    }
  } catch (value) {
    if (sequence !== presaleOpportunityOptionsLoadSequence.value) return
    presaleOpportunityOptions.value = []; presaleOpportunityOptionsTotal.value = 0
    presaleOpportunityOptionsError.value = value?.message || '可关联商机加载失败，请稍后重试。'
  } finally {
    if (sequence === presaleOpportunityOptionsLoadSequence.value) presaleOpportunityOptionsLoading.value = false
  }
}

async function loadTeamDirectory() {
  const sequence = ++teamDirectoryLoadSequence.value
  teamDirectoryLoading.value = true
  teamDirectoryError.value = ''
  try {
    const result = await listOwnerDirectory({ keyword: teamDirectoryKeyword.value.trim(), page: 1, page_size: 50 })
    if (sequence !== teamDirectoryLoadSequence.value || !teamDialog.value) return
    teamDirectoryOptions.value = result?.items || []
    rememberOwnerDirectory(result?.items)
  } catch (value) {
    if (sequence !== teamDirectoryLoadSequence.value) return
    teamDirectoryOptions.value = []
    teamDirectoryError.value = directoryErrorMessage(value)
  } finally {
    if (sequence === teamDirectoryLoadSequence.value) teamDirectoryLoading.value = false
  }
}

async function loadReportFilterOptions() {
  reportFilterOptionsLoading.value = true
  reportFilterOptionsError.value = ''
  try {
    const [filterOptions, directory] = await Promise.all([
      getPresaleFilterOptions(presaleAPIParams(presaleFilters)),
      listOwnerDirectory({ page: 1, page_size: 50 }),
    ])
    if (!showReport.value) return
    rememberOwnerDirectory(directory?.items)
    presaleFilterOptions.value = {
      opportunities: filterOptions?.opportunities || [], applicants: filterOptions?.applicants || [], assignees: filterOptions?.assignees || [],
      statuses: filterOptions?.statuses || [], venues: filterOptions?.venues || [], urgencies: filterOptions?.urgencies || [],
      push_statuses: filterOptions?.push_statuses || [], truncated: Boolean(filterOptions?.truncated),
    }
    const organizations = new Map()
    for (const user of directory?.items || []) {
      for (const organization of user.organizations || []) organizations.set(organization.organization_id, organization)
    }
    reportOrganizationOptions.value = [...organizations.values()].sort((left, right) => left.organization_name.localeCompare(right.organization_name, 'zh-CN'))
    if (reportFilters.organization_id && !organizations.has(reportFilters.organization_id)) reportFilters.organization_id = ''
    if (reportFilters.person_id && !presaleFilterOptions.value.assignees.some((item) => item.value === reportFilters.person_id)) reportFilters.person_id = ''
    if (reportFilters.opportunity_id && !presaleFilterOptions.value.opportunities.some((item) => String(item.value) === String(reportFilters.opportunity_id))) reportFilters.opportunity_id = ''
  } catch (value) {
    if (showReport.value) reportFilterOptionsError.value = directoryErrorMessage(value)
  } finally {
    reportFilterOptionsLoading.value = false
  }
}
async function openNewOpportunity() {
  Object.assign(opportunityForm, emptyOpportunity())
  opportunityEditMode.value = false
  opportunityCustomerKeyword.value = ''
  opportunityCustomerOptions.value = []
  opportunityCustomerOptionsTotal.value = 0
  opportunityFormInitial = JSON.stringify(opportunityForm)
  opportunityDialog.value = true
  await loadOpportunityCustomerOptions()
}
function editOpportunity() {
  const value = selectedOpportunity.value
  Object.assign(opportunityForm, {
    name: value.name, customer_id: value.customer_id, type: value.type, source: value.source,
    expected_amount: value.expected_amount, expected_sign_date: value.expected_sign_date,
    requirement_summary: value.requirement_summary, system_count: value.system_count || 0,
    pain_points: value.pain_points || '', competitor_info: value.competitor_info || '',
    owner_user_id: value.owner_user_id, owner_org_id: value.owner_org_id || '', reason: '',
  })
  opportunityEditMode.value = true
  opportunityFormInitial = JSON.stringify(opportunityForm)
  opportunityDialog.value = true
}
function editCustomer() {
  const value = selectedCustomer.value
  // 客户详情不返回完整信用代码，联系人也只返回脱敏值；编辑态用空值表示“不提交变更”，
  // submitCustomer 仅把用户重新输入的敏感字段放入更新载荷，由服务端保留其余原密文。
  Object.assign(customerForm, {
    name: value.name, unified_credit_code: '', customer_type: value.customer_type, industry: value.industry,
    region: value.region, owner_user_id: value.owner_user_id, owner_org_id: value.owner_org_id || '', reason: '',
    duplicate_override: false, duplicate_override_reason: '', contacts: (value.contacts || []).map((item) => ({ id: item.id, name: item.name, phone: '', email: '', is_registration: item.is_registration })),
  })
  customerEditMode.value = true
  customerFormInitial = JSON.stringify(customerForm)
  customerDialog.value = true
}
function addCustomerContact() { customerForm.contacts.push({ id: 0, name: '', phone: '', email: '', is_registration: false }) }
function removeCustomerContact(index) {
  if (customerForm.contacts.length <= 1 || index < 0 || index >= customerForm.contacts.length) return
  const [removed] = customerForm.contacts.splice(index, 1)
  if (removed?.is_registration && !customerForm.contacts.some((item) => item.is_registration)) {
    customerForm.contacts[0].is_registration = true
  }
}

async function loadCurrent() {
  // 切换栏目或筛选时旧请求不会被主动取消，因此用递增序号与栏目快照共同判定
  // 响应归属。只有当前栏目最新一次请求可以写入列表和 loading 状态。
  const sequence = ++currentLoadSequence.value
  const section = activeSection.value
  loading.value = true; error.value = ''
  try {
    if (section === 'customers') {
	  await syncCustomerURL()
      const result = await listCustomers(customerAPIParams(customerFilters, page.number, page.size))
      if (sequence !== currentLoadSequence.value || activeSection.value !== section) return
      customers.value = result?.items || []; page.total = Number(result?.total || 0)
      void resolveOwnerNames(customers.value.map((item) => item.owner_user_id))
    } else if (section === 'opportunities') {
      if (boardMode.value) {
        const result = await getOpportunityBoard({ keyword: filters.keyword })
        if (sequence !== currentLoadSequence.value || activeSection.value !== section) return
        board.value = result || []
        void resolveOwnerNames(board.value.flatMap((column) => column?.items || []).map((item) => item?.owner_user_id))
      } else {
        const result = await listOpportunities({ keyword: filters.keyword, status: filters.status, stage: filters.stage, page: page.number, page_size: page.size })
        if (sequence !== currentLoadSequence.value || activeSection.value !== section) return
        opportunities.value = result?.items || []; page.total = Number(result?.total || 0)
        void resolveOwnerNames(opportunities.value.map((item) => item.owner_user_id))
      }
    } else if (section === 'presale') {
      await syncPresaleURL()
      if (sequence !== currentLoadSequence.value || activeSection.value !== section) return
      const params = presaleAPIParams(presaleFilters)
      if (presaleView.value === 'board') {
        presaleBoard.value = []
        const result = await getPresaleBoard({ ...params, column_limit: presaleColumnLimit.value })
        if (sequence !== currentLoadSequence.value || activeSection.value !== section) return
        presaleBoard.value = result?.columns || []
        presaleColumnLimit.value = Number(result?.column_limit || presaleColumnLimit.value)
        presales.value = []; presalePage.total = 0
      } else {
        presales.value = []; presalePage.total = 0
        const result = await listPresaleRequests({ ...params, page: presalePage.number, page_size: presalePage.size })
        if (sequence !== currentLoadSequence.value || activeSection.value !== section) return
        presales.value = result?.items || []
        presalePage.number = Number(result?.page || presalePage.number)
        presalePage.size = Number(result?.page_size || presalePage.size)
        presalePage.total = Number(result?.total || 0)
        presaleBoard.value = []
      }
      void loadPresaleFilterOptions(params)
    } else {
      await loadNotifications()
    }
  } catch (value) {
    if (sequence === currentLoadSequence.value && activeSection.value === section) showError(value)
  } finally {
    if (sequence === currentLoadSequence.value) loading.value = false
  }
}

function stableQuery(value) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))))
}

async function syncPresaleURL() {
  const query = presaleStateToQuery(presaleFilters, presaleView.value, presalePage.number, presalePage.size, presaleColumnLimit.value)
  const current = Object.fromEntries(Object.entries(route.query).map(([key, value]) => [key, Array.isArray(value) ? String(value[0] || '') : String(value || '')]))
  if (stableQuery(current) !== stableQuery(query)) await router.replace({ name: route.name, params: route.params, query })
}

async function loadPresaleFilterOptions(params = presaleAPIParams(presaleFilters)) {
  const sequence = ++presaleFilterOptionsLoadSequence.value
  presaleFilterOptionsError.value = ''
  try {
    const value = await getPresaleFilterOptions(params)
    if (sequence !== presaleFilterOptionsLoadSequence.value || activeSection.value !== 'presale') return
    presaleFilterOptions.value = {
      opportunities: value?.opportunities || [], applicants: value?.applicants || [], assignees: value?.assignees || [],
      statuses: value?.statuses || [], venues: value?.venues || [], urgencies: value?.urgencies || [],
      push_statuses: value?.push_statuses || [], truncated: Boolean(value?.truncated),
    }
  } catch {
    if (sequence !== presaleFilterOptionsLoadSequence.value || activeSection.value !== 'presale') return
    // 筛选项由服务端按当前数据范围裁剪；加载失败必须清空旧选项，不能沿用可能已过期或越界的目录快照。
    presaleFilterOptions.value = { opportunities: [], applicants: [], assignees: [], statuses: [], venues: [], urgencies: [], push_statuses: [], truncated: false }
    presaleFilterOptionsError.value = '可用筛选项暂时无法加载，已清空选项且不会展示未授权人员或商机。'
  }
}

async function applyPresaleFilters() {
  presalePage.number = 1
  await loadCurrent()
}

async function switchPresaleView(view) {
  presaleView.value = view === 'board' ? 'board' : 'list'
  presalePage.number = 1
  await loadCurrent()
}

async function openPresaleCreatePage() {
  if (!canCreatePresale.value || !presaleRequestSubmissionAvailable.value) return
  Object.assign(presaleForm, {
    opportunity_id: '', venue: 'REMOTE', service_address: '', contact_name: '', contact_phone: '',
    description: '', expected_start: '', expected_end: '', urgency: 'NORMAL',
  })
  presaleOpportunityKeyword.value = ''
  presaleOpportunityOptions.value = []
  presaleOpportunityOptionsTotal.value = 0
  presaleOpportunityOptionsError.value = ''
  presaleFormInitial = JSON.stringify(presaleForm)
  presaleCreatePage.value = true
  resetMessages()
  await loadPresaleOpportunityOptions()
}

function closePresaleCreatePage() {
  if (presaleCreateLoading.value) return
  if (!confirmDiscardIfDirty(presaleFormDirty.value)) return
  presaleOpportunityOptionsLoadSequence.value += 1
  presaleCreatePage.value = false
  presaleFormInitial = ''
  resetMessages()
}

async function submitPresaleFromList() {
  const value = await submitPresale({ openDetail: false, refreshList: false })
  if (!value) return
  presaleFormInitial = JSON.stringify(presaleForm)
  closePresaleCreatePage()
  notice.value = '售前申请已提交，已返回申请列表。'
  presalePage.number = 1
  await loadCurrent()
}

async function changePresalePage(nextPage) {
  if (presaleView.value !== 'list' || nextPage < 1) return
  presalePage.number = nextPage
  await loadCurrent()
}

function restorePresaleStateFromURL() {
  const value = presaleStateFromQuery(route.query)
  Object.assign(presaleFilters, value.filters)
  presaleView.value = value.view
  presalePage.number = value.page
  presalePage.size = value.pageSize
  presaleColumnLimit.value = value.columnLimit
}
async function openCustomer(id) {
  // 客户切换时先让旧详情及所有页签请求失效，再清空按客户缓存的数据；后续页签只会
  // 接受同时匹配“请求序号、客户 ID、当前页签”的响应。
  const sequence = ++customerDetailLoadSequence.value
  try {
	  const detail = await getCustomer(id)
	  if (sequence !== customerDetailLoadSequence.value) return
	  selectedCustomer.value = detail; customerTab.value = 'basic'
	  void resolveOwnerNames([detail?.owner_user_id])
	  customerContacts.value = []; customerStakeholders.value = []; customerSystems.value = []; customerOpportunities.value = []; customerProjects.value = []; customerFollowups.value = []; customerAuditLogs.value = []
	  currentPortalInvite.value = null; portalAccessStatus.value = null; portalActivationURL.value = ''; portalInviteCopied.value = false; portalInviteRevokeReason.value = ''; portalInviteLoading.value = false
	  portalAccessDisableReason.value = ''; portalAccessDisableLoading.value = false
	  customerTabLoadSequence.value += 1
	  customerProjectLoadSequence.value += 1
	  customerTabLoading.value = false
	  customerProjectsLoading.value = false
	  Object.assign(customerProjectsPage, { number: 1, size: 20, total: 0 })
	  for (const key of Object.keys(customerTabErrors)) delete customerTabErrors[key]
	  for (const key of Object.keys(customerTabLoaded)) delete customerTabLoaded[key]
	  if (String(route.query.customer_id) !== String(id)) {
	    const query = { ...route.query, customer_id: String(id) }
	    await router.replace({ name: route.name, params: route.params, query })
	  }
  } catch (value) {
	  if (sequence === customerDetailLoadSequence.value) showError(value)
  }
}

function closeCustomerDetail() {
	customerDetailLoadSequence.value += 1
	customerTabLoadSequence.value += 1
	customerProjectLoadSequence.value += 1
	customerTabLoading.value = false
	customerProjectsLoading.value = false
	portalInviteLoading.value = false
	portalAccessDisableLoading.value = false
	portalAccessDisableReason.value = ''
	portalActivationURL.value = ''
	portalInviteCopied.value = false
	selectedCustomer.value = null
	if (route.query.customer_id) {
	  const query = { ...route.query }
	  delete query.customer_id
	  void router.replace({ name: route.name, params: route.params, query })
	}
}

async function syncCustomerURL() {
	const query = customerFiltersToQuery(customerFilters, page.number, page.size)
	if (selectedCustomer.value) query.customer_id = String(selectedCustomer.value.id)
	const current = Object.fromEntries(Object.entries(route.query).map(([key, value]) => [key, Array.isArray(value) ? String(value[0] || '') : String(value || '')]))
	if (JSON.stringify(current) !== JSON.stringify(query)) await router.replace({ name: route.name, params: route.params, query })
}

async function useCustomerQuickFilter(value) {
	if (value === 'KEY') { error.value = '重点客户尚无权威分类字段和维护闭环，当前已禁用，且不会回退到已删除的信用等级口径。'; return }
	customerFilters.quick_filter = customerFilters.quick_filter === value ? '' : value; page.number = 1; await loadCurrent()
}

async function loadCustomerProjectPage(nextPage) {
	if (!selectedCustomer.value || nextPage < 1 || customerProjectsLoading.value) return false
	const customerID = selectedCustomer.value.id
	const sequence = ++customerProjectLoadSequence.value
	customerProjectsLoading.value = true
	delete customerTabErrors.projects
	try {
		const result = await listCustomerProjects(customerID, { page: nextPage, page_size: customerProjectsPage.size })
		if (sequence !== customerProjectLoadSequence.value || selectedCustomer.value?.id !== customerID) return false
		customerProjects.value = result?.items || []
		customerProjectsPage.number = Number(result?.page || nextPage)
		customerProjectsPage.size = Number(result?.page_size || customerProjectsPage.size)
		customerProjectsPage.total = Number(result?.total || 0)
		return true
	} catch (value) {
		if (sequence !== customerProjectLoadSequence.value || selectedCustomer.value?.id !== customerID) return false
		customerTabErrors.projects = value?.code === 'CRM_CUSTOMER_PROJECT_HISTORY_NOT_CONFIGURED'
			? '项目快照依赖尚未接入，客户基本详情不受影响。'
			: value?.status === 403 ? '无权查看此页签。' : value?.message || '页签数据加载失败。'
		return false
	} finally {
		if (sequence === customerProjectLoadSequence.value) customerProjectsLoading.value = false
	}
}

async function openCustomerTab(tab) {
	customerTab.value = tab
	if (tab === 'basic' || customerTabLoaded[tab] || !selectedCustomer.value) return
	const customerID = selectedCustomer.value.id
	const sequence = ++customerTabLoadSequence.value
	customerTabLoading.value = true; delete customerTabErrors[tab]
	try {
		// 各页签按需加载并独立缓存，敏感联系人、审计和门户状态不会因为打开基本资料
		// 就被批量预取；切换页签后的迟到响应也不会写回当前视图。
		if (tab === 'contacts') {
			const result = await listCustomerContacts(customerID)
			if (sequence !== customerTabLoadSequence.value || selectedCustomer.value?.id !== customerID || customerTab.value !== tab) return
			customerContacts.value = result || []
		}
		if (tab === 'stakeholders') {
			const result = await listCustomerStakeholders(customerID)
			if (sequence !== customerTabLoadSequence.value || selectedCustomer.value?.id !== customerID || customerTab.value !== tab) return
			customerStakeholders.value = result?.items || []
			if (result?.customer_version) selectedCustomer.value = { ...selectedCustomer.value, version: result.customer_version }
		}
		if (tab === 'systems') {
			const result = await listCustomerSystems(customerID)
			if (sequence !== customerTabLoadSequence.value || selectedCustomer.value?.id !== customerID || customerTab.value !== tab) return
			customerSystems.value = result?.items || []
			if (result?.customer_version) selectedCustomer.value = { ...selectedCustomer.value, version: result.customer_version }
		}
		if (tab === 'opportunities') {
			const result = await listCustomerOpportunities(customerID, { page: 1, page_size: 50 })
			if (sequence !== customerTabLoadSequence.value || selectedCustomer.value?.id !== customerID || customerTab.value !== tab) return
			customerOpportunities.value = result?.items || []
		}
		if (tab === 'projects' && !await loadCustomerProjectPage(1)) return
		if (sequence !== customerTabLoadSequence.value || selectedCustomer.value?.id !== customerID || customerTab.value !== tab) return
		if (tab === 'followups') {
			const result = await listCustomerFollowups(customerID, { page: 1, page_size: 50 })
			if (sequence !== customerTabLoadSequence.value || selectedCustomer.value?.id !== customerID || customerTab.value !== tab) return
			customerFollowups.value = result?.items || []
		}
		if (tab === 'audit') {
			const result = await listCustomerAuditLogs(customerID, { page: 1, page_size: 50 })
			if (sequence !== customerTabLoadSequence.value || selectedCustomer.value?.id !== customerID || customerTab.value !== tab) return
			customerAuditLogs.value = result?.items || []
		}
		if (tab === 'portal') {
			const inviteRequest = canReadPortalInvite.value ? getCurrentPortalInvite(customerID) : Promise.resolve(null)
			const accessRequest = canReadPortalAccessStatus.value ? getPortalAccessStatus(customerID) : Promise.resolve(null)
			const [inviteResult, accessResult] = await Promise.allSettled([inviteRequest, accessRequest])
			if (sequence !== customerTabLoadSequence.value || selectedCustomer.value?.id !== customerID || customerTab.value !== tab) return
			if (inviteResult.status === 'fulfilled') currentPortalInvite.value = inviteResult.value
			else if (inviteResult.reason?.code === 'CRM_PORTAL_INVITE_NOT_FOUND') currentPortalInvite.value = null
			else throw inviteResult.reason
			if (accessResult.status === 'fulfilled') portalAccessStatus.value = accessResult.value
			else throw accessResult.reason
		}
		customerTabLoaded[tab] = true
	} catch (value) {
		if (sequence !== customerTabLoadSequence.value || selectedCustomer.value?.id !== customerID || customerTab.value !== tab) return
		if (tab === 'portal' && value?.code === 'CRM_PORTAL_INVITE_NOT_FOUND') { currentPortalInvite.value = null; customerTabLoaded[tab] = true }
		else if (tab === 'portal' && value?.status === 404) customerTabErrors[tab] = 'Portal 邀请路由未启用；请先由运维配置正式外部身份 Provider 后启用该能力。'
		else if (tab === 'portal' && value?.status === 503) customerTabErrors[tab] = '基础平台外部客户预置、Portal 角色分配或映射服务当前不可用（503）。邀请未确认生成，请保留本页并使用同一请求重试。'
		else if (tab === 'projects' && value?.code === 'CRM_CUSTOMER_PROJECT_HISTORY_NOT_CONFIGURED') customerTabErrors[tab] = '项目快照依赖尚未接入，客户基本详情不受影响。'
		else if (value?.status === 403) customerTabErrors[tab] = '无权查看此页签。'
		else customerTabErrors[tab] = value?.message || '页签数据加载失败。'
	} finally {
		if (sequence === customerTabLoadSequence.value) customerTabLoading.value = false
	}
}

async function generatePortalInvite() {
	if (!selectedCustomer.value || portalInviteLoading.value) return
	const contact = portalRegistrationContact.value
	if (!contact) { customerTabErrors.portal = '客户缺少唯一登记联系人，请先维护联系人。'; return }
	const retry = portalInviteRetries.keyFor(selectedCustomer.value.id, contact)
	portalInviteLoading.value = true; delete customerTabErrors.portal; portalInviteCopied.value = false
	try {
		// 激活链接只在本次响应和页面内存中出现；目录预置、角色绑定或映射任一步未确认
		// 成功都不展示链接，结果不明确的重试继续使用原幂等键。
		const result = await createPortalInvite(selectedCustomer.value.id, retry.key)
		portalInviteRetries.confirmSuccess(retry.signature, retry.key)
		portalActivationURL.value = result?.activation_url || ''
		try { currentPortalInvite.value = await getCurrentPortalInvite(selectedCustomer.value.id) }
		catch { currentPortalInvite.value = result }
		notice.value = 'Portal 邀请已由服务端确认生成。链接仅在当前页面内存中临时显示，请安全发送给登记联系人。'
	} catch (value) {
		if (value?.status === 503) customerTabErrors.portal = '正式外部身份预置、Portal 角色分配或映射 Provider 当前不可用（503）。未展示虚假邀请；本页会复用同一 Idempotency-Key 重试。'
		else if (value?.status === 404) customerTabErrors.portal = 'Portal 邀请路由未启用；请先由运维配置正式外部身份 Provider 后启用该能力。'
		else if (value?.code === 'CRM_PORTAL_INVITE_CONTACT_INVALID') customerTabErrors.portal = '必须存在唯一且联系方式有效的登记联系人。'
		else customerTabErrors.portal = value?.message || 'Portal 邀请生成失败；结果不明确时请在本页直接重试。'
	} finally { portalInviteLoading.value = false }
}

async function copyPortalActivationURL() {
	if (!portalActivationURL.value) return
	try {
		await navigator.clipboard.writeText(portalActivationURL.value)
		portalInviteCopied.value = true
		notice.value = '邀请链接已复制。'
	} catch { customerTabErrors.portal = '浏览器未允许复制，请手工选中链接复制。' }
}

async function revokeCurrentPortalInvite() {
	if (!currentPortalInvite.value || !portalInviteRevokeReason.value.trim() || portalInviteLoading.value) return
	portalInviteLoading.value = true; delete customerTabErrors.portal
	try {
		currentPortalInvite.value = await revokePortalInvite(currentPortalInvite.value.invite_no, {
			reason: portalInviteRevokeReason.value.trim(), version: Number(currentPortalInvite.value.version),
		})
		portalActivationURL.value = ''; portalInviteCopied.value = false; portalInviteRevokeReason.value = ''
		notice.value = 'Portal 邀请已撤销。'
	} catch (value) {
		if (value?.status === 409) customerTabErrors.portal = '邀请状态已变化，请重新打开“门户访问”页签后再操作。'
		else if (value?.status === 503) customerTabErrors.portal = '外部身份回收依赖当前不可用（503），系统未返回撤销成功。'
		else customerTabErrors.portal = value?.message || '撤销失败。'
	} finally { portalInviteLoading.value = false }
}

async function disableCurrentPortalAccess() {
	if (!selectedCustomer.value || portalAccessDisableLoading.value) return
	const reason = portalAccessDisableReason.value.trim()
	if (!reason) return
	if (!window.confirm('确认禁用该客户的门户访问？这会立即退出全部 Portal 会话，并回收基础平台 Portal 角色；撤销邀请是另一项操作。')) return
	const customerID = selectedCustomer.value.id
	const retry = portalAccessDisableRetries.keyFor(customerID, reason)
	portalAccessDisableLoading.value = true
	delete customerTabErrors.portal
	try {
		// 禁用是可恢复执行的跨系统流程：本地映射、Portal 会话和平台角色按持久化状态
		// 推进。503 不代表整体回滚，页面随后读取权威状态并保留同一重试坐标。
		await disablePortalAccess(customerID, { reason }, retry.key)
		portalAccessDisableRetries.confirmSuccess(retry.signature, retry.key)
		portalAccessDisableReason.value = ''
		portalActivationURL.value = ''
		portalInviteCopied.value = false
		portalAccessStatus.value = await getPortalAccessStatus(customerID)
		if (canReadPortalInvite.value) {
			try { currentPortalInvite.value = await getCurrentPortalInvite(customerID) } catch { currentPortalInvite.value = null }
		}
		notice.value = '门户访问已禁用：Portal 映射与会话已关闭，基础平台 Portal 角色已回收。'
	} catch (value) {
		try { portalAccessStatus.value = await getPortalAccessStatus(customerID) } catch { /* 刷新失败时保留上一份权威状态快照。 */ }
		if (value?.status === 503) customerTabErrors.portal = '禁用流程已持久化，但外部回收步骤暂不可用。系统会按状态中的时间自动重试；请勿更换原因，手工重试会复用同一 Idempotency-Key。'
		else if (value?.status === 409) customerTabErrors.portal = '门户访问映射已变化或已有禁用流程，请刷新状态后确认。'
		else customerTabErrors.portal = value?.message || '禁用门户访问失败。'
	} finally { portalAccessDisableLoading.value = false }
}

function retainOnlyLoadedCustomerTab(tab) {
	for (const key of Object.keys(customerTabLoaded)) delete customerTabLoaded[key]
	customerTabLoaded[tab] = true
}

function openStakeholderEditor() {
	// 详情接口只返回脱敏联系方式，因此编辑态不回填掩码；未勾选替换时也不发送字段，
	// 由服务端保留原密文，避免把脱敏展示值误写回客户主档。
	customerStakeholderForm.reason = ''
	customerStakeholderForm.items = customerStakeholders.value.map((item) => ({
		id: item.id, name: item.name, role_title: item.role_title, influence: item.influence,
		relationship_summary: item.relationship_summary, phone: '', email: '', replace_phone: false, replace_email: false,
	}))
	customerStakeholderDialog.value = true
}
function addStakeholder() { customerStakeholderForm.items.push(emptyStakeholder()) }
function removeStakeholder(index) { customerStakeholderForm.items.splice(index, 1) }
async function submitStakeholders() {
	actionLoading.value = true; resetMessages()
	try {
		const items = customerStakeholderForm.items.map((item) => {
			const payload = { id: Number(item.id || 0), name: item.name, role_title: item.role_title, influence: item.influence, relationship_summary: item.relationship_summary }
			if (!item.id || item.replace_phone) payload.phone = item.phone
			if (!item.id || item.replace_email) payload.email = item.email
			return payload
		})
		const result = await replaceCustomerStakeholders(selectedCustomer.value.id, { items, version: Number(selectedCustomer.value.version), reason: customerStakeholderForm.reason })
		selectedCustomer.value = { ...selectedCustomer.value, version: result.customer_version }
		customerStakeholders.value = result.items || []
		retainOnlyLoadedCustomerTab('stakeholders'); customerStakeholderDialog.value = false
		notice.value = '关键干系人已更新。'
	} catch (value) { showError(value) } finally { actionLoading.value = false }
}

function openSystemEditor() {
	customerSystemForm.reason = ''
	customerSystemForm.items = customerSystems.value.map((item) => ({
		name: item.name, protection_level: item.protection_level, application_scenario: item.application_scenario,
		filing_no: item.filing_no, grading_date: item.grading_date || '', filing_status: item.filing_status,
	}))
	customerSystemDialog.value = true
}
function addInformationSystem() { customerSystemForm.items.push(emptyInformationSystem()) }
function removeInformationSystem(index) { customerSystemForm.items.splice(index, 1) }
async function submitSystems() {
	actionLoading.value = true; resetMessages()
	try {
		const items = customerSystemForm.items.map((item) => ({
			name: item.name, protection_level: item.protection_level, application_scenario: item.application_scenario,
			filing_no: item.filing_no, grading_date: item.grading_date || null, filing_status: item.filing_status,
		}))
		const result = await replaceCustomerSystems(selectedCustomer.value.id, { items, version: Number(selectedCustomer.value.version), reason: customerSystemForm.reason })
		selectedCustomer.value = { ...selectedCustomer.value, version: result.customer_version }
		customerSystems.value = result.items || []
		retainOnlyLoadedCustomerTab('systems'); customerSystemDialog.value = false
		notice.value = '信息系统已更新。'
	} catch (value) { showError(value) } finally { actionLoading.value = false }
}

async function exportCustomers() {
	try { await requestCustomerExport({ filters: customerAPIParams(customerFilters, 1, page.size) }) }
	catch (value) {
		if (value?.code === 'CRM_CUSTOMER_EXPORT_NOT_CONFIGURED') error.value = '客户导出依赖受控 XLSX Worker、加密对象存储和短效下载链接，当前已安全关闭。'
		else showError(value)
	}
}
async function openCustomerMerge() {
  Object.assign(customerMergeForm, { target_customer_id: '', reason: '', target: null })
  customerMergeKeyword.value = ''
  customerMergeOptions.value = []
  customerMergeOptionsTotal.value = 0
  customerMergeOptionsError.value = ''
  customerMergeDialog.value = true
  await loadCustomerMergeOptions()
}
async function loadCustomerMergeTarget() {
  resetMessages(); customerMergeForm.target = null
  const id = Number(customerMergeForm.target_customer_id)
  if (!Number.isSafeInteger(id) || id <= 0 || id === selectedCustomer.value?.id) {
    error.value = '请选择不同于源客户的有效目标客户。'; return
  }
  try {
    const target = await getCustomer(id)
    if (target.status !== 'ACTIVE') { error.value = '目标客户必须为有效状态。'; return }
    customerMergeForm.target = target
  } catch (value) { showError(value) }
}
async function submitCustomerMerge() {
  resetMessages()
  if (!customerMergeForm.target || Number(customerMergeForm.target.id) !== Number(customerMergeForm.target_customer_id)) {
    error.value = '请先加载并核对目标客户。'; return
  }
  if (!window.confirm(`确认把“${selectedCustomer.value.name}”合并到“${customerMergeForm.target.name}”？该操作不可在本期反向恢复。`)) return
  actionLoading.value = true
  try {
    const result = await mergeCustomers({
      source_customer_id: Number(selectedCustomer.value.id), target_customer_id: Number(customerMergeForm.target.id),
      source_version: Number(selectedCustomer.value.version), target_version: Number(customerMergeForm.target.version),
      reason: customerMergeForm.reason,
    })
    customerMergeDialog.value = false; selectedCustomer.value = null
    const counts = result.migrated_counts || {}
    notice.value = `客户合并完成：迁移 ${counts.contacts || 0} 个联系人、${counts.followups || 0} 条沟通、${counts.opportunities || 0} 个商机和 ${counts.portal_invites || 0} 条邀请。`
    await loadCurrent()
  } catch (value) {
    if (value?.code === 'CRM_CUSTOMER_MERGE_BLOCKED') {
      const blockers = value.details?.blockers || []
      error.value = `合并已安全阻断：${blockers.map((item) => `${item.message}（${item.count}）`).join('；') || '存在不可原子迁移的关联。'}`
    } else showError(value)
  } finally { actionLoading.value = false }
}
async function openOpportunity(id) {
  try {
    // 主档、阶段、跟进和当前团队组成首屏一致快照；任期、附件、外部状态和售前依赖
    // 随后独立加载，任一可选依赖失败都不应关闭商机基本详情。
    const [detail, history, records, team] = await Promise.all([getOpportunity(id), getOpportunityStageHistory(id, { page: 1, page_size: 50 }), listOpportunityFollowups(id, { page: 1, page_size: 50 }), getOpportunityMembers(id)])
    selectedOpportunity.value = detail; stageHistory.value = history?.items || []; followups.value = records?.items || []; opportunityTeam.value = team?.members || []; opportunityTeamDirectoryAvailable.value = team?.directory_available !== false
    void resolveOwnerNames([detail?.owner_user_id])
    opportunityMemberTerms.value = []; opportunityMemberTermsError.value = ''; opportunityMemberTermsPage.number = 1; opportunityMemberTermsPage.total = 0
    void loadOpportunityMemberTerms(id, 1)
    opportunityExternalStatus.value = null; opportunityQuoteAmountCheck.value = null; opportunityExternalStatusError.value = ''; void loadOpportunityExternalStatus(id)
    opportunityAttachments.value = []; opportunityAttachmentCapabilities.value = null; opportunityAttachmentError.value = ''
    if (canReadOpportunityAttachments.value) void loadOpportunityAttachments(id)
    opportunityPresales.value = []; opportunityPresaleError.value = ''; opportunityPresalePage.number = 1; opportunityPresalePage.total = 0
    void loadOpportunityPresales()
  } catch (value) { showError(value) }
}

async function loadOpportunityMemberTerms(opportunityID = selectedOpportunity.value?.id, page = opportunityMemberTermsPage.number) {
	if (!opportunityID) return
	const loadToken = opportunityMemberTermLoads.begin(opportunityID)
  opportunityMemberTermsLoading.value = true; opportunityMemberTermsError.value = ''
  try {
    const result = await listOpportunityMemberTerms(opportunityID, { page, page_size: opportunityMemberTermsPage.size })
		if (opportunityMemberTermLoads.isCurrent(loadToken, selectedOpportunity.value?.id)) {
      opportunityMemberTerms.value = result?.items || []
      opportunityMemberTermsPage.number = Number(result?.page || page)
      opportunityMemberTermsPage.total = Number(result?.total || 0)
    }
  } catch (value) {
		if (opportunityMemberTermLoads.isCurrent(loadToken, selectedOpportunity.value?.id)) opportunityMemberTermsError.value = value?.status === 403 ? '无权查看团队任期明细。' : '团队任期明细暂时无法加载。'
  } finally {
		if (opportunityMemberTermLoads.isCurrent(loadToken, selectedOpportunity.value?.id)) opportunityMemberTermsLoading.value = false
  }
}

async function loadOpportunityAttachments(opportunityID = selectedOpportunity.value?.id) {
  if (!opportunityID || !canReadOpportunityAttachments.value) return
  opportunityAttachmentLoading.value = true; opportunityAttachmentError.value = ''
  try {
    const [capabilities, values] = await Promise.all([getOpportunityAttachmentCapabilities(opportunityID), listOpportunityAttachments(opportunityID)])
    if (Number(selectedOpportunity.value?.id) === Number(opportunityID)) { opportunityAttachmentCapabilities.value = capabilities; opportunityAttachments.value = values || [] }
  } catch (value) {
    if (Number(selectedOpportunity.value?.id) === Number(opportunityID)) opportunityAttachmentError.value = value?.status === 403 ? '无权查看商机附件。' : '附件状态暂时无法加载。'
  } finally { if (Number(selectedOpportunity.value?.id) === Number(opportunityID)) opportunityAttachmentLoading.value = false }
}

function selectOpportunityAttachment(event) { opportunityAttachmentFile.value = event.target.files?.[0] || null }
async function sha256File(file) { const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('') }
async function uploadOpportunityAttachment() {
  const opportunityID = selectedOpportunity.value?.id; const file = opportunityAttachmentFile.value; const capability = opportunityAttachmentCapabilities.value
  if (!opportunityID || !file || !canUploadOpportunityAttachments.value || !capability?.upload_available || opportunityAttachmentLoading.value) return
  opportunityAttachmentLoading.value = true; opportunityAttachmentError.value = ''
  try {
    // 上传拆为“创建受控会话—直传对象存储—服务端确认”三步，每一步使用稳定状态恢复。
    // 浏览器只接受无凭据、无片段的 HTTPS 地址，确认后文件仍须扫描通过才能下载。
    const payload = { file_name: file.name, size_bytes: file.size, mime_type: file.type, sha256: await sha256File(file) }
    const flow = attachmentUploadRetries.flowFor(opportunityID, payload)
    if (!flow.session) {
      const session = await createOpportunityAttachmentUpload(opportunityID, flow.payload, flow.createKey)
      attachmentUploadRetries.confirmCreate(flow, session)
    }
    if (!flow.uploaded) {
      const target = new URL(flow.session.upload_url)
      if (target.protocol !== 'https:' || target.username || target.password || target.hash) throw new Error('上传地址不安全')
      const uploaded = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': flow.payload.mime_type }, credentials: 'omit', redirect: 'error' })
      if (!uploaded.ok) throw new Error('对象存储上传失败')
      attachmentUploadRetries.markUploaded(flow)
    }
    await completeOpportunityAttachmentUpload(opportunityID, flow.session.attachment.id, { version: flow.session.attachment.version }, flow.completeKey)
    attachmentUploadRetries.confirmComplete(flow)
    opportunityAttachmentFile.value = null; notice.value = '附件已上传并进入安全扫描；扫描通过前不能下载。'
    await loadOpportunityAttachments(opportunityID)
  } catch (value) { opportunityAttachmentError.value = value?.code === 'CRM_OPPORTUNITY_ATTACHMENT_UNAVAILABLE' ? '可信对象存储或病毒扫描尚未配置，上传已安全关闭。' : (value?.message || '附件上传失败。') }
  finally { opportunityAttachmentLoading.value = false }
}
function opportunityAttachmentStatusText(value) { return ({ PENDING_UPLOAD:'等待上传', FINALIZING:'正在校验上传', SCANNING:'安全扫描中', CLEAN:'扫描通过', REJECTED:'检测到风险，已拒绝', SCAN_FAILED:'扫描失败，禁止下载' })[value] || '未知状态' }
async function downloadTrustedOpportunityAttachment(item) {
  if (!canDownloadOpportunityAttachments.value || !opportunityAttachmentCapabilities.value?.download_available || item.scan_status !== 'CLEAN') return
  opportunityAttachmentError.value = ''
  try { const { blob, filename } = await downloadOpportunityAttachment(selectedOpportunity.value.id, item.id, item.file_name); const href = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = href; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(href) }
  catch (value) { opportunityAttachmentError.value = value?.message || '附件下载失败。' }
}

async function loadOpportunityExternalStatus(opportunityID = selectedOpportunity.value?.id) {
  if (!opportunityID) return
  if (Number(selectedOpportunity.value?.id) === Number(opportunityID)) {
    opportunityExternalStatus.value = null
    opportunityQuoteAmountCheck.value = null
  }
  opportunityExternalStatusLoading.value = true; opportunityExternalStatusError.value = ''
  try {
    const result = await getOpportunityExternalStatus(opportunityID)
    if (Number(selectedOpportunity.value?.id) === Number(opportunityID)) {
      opportunityExternalStatus.value = result?.latest || null
      opportunityQuoteAmountCheck.value = result?.quote_amount_check || null
    }
  } catch (value) {
    if (Number(selectedOpportunity.value?.id) === Number(opportunityID)) opportunityExternalStatusError.value = value?.status === 403 ? '无权查看外部状态。' : '外部状态快照暂时无法加载。'
  } finally {
    if (Number(selectedOpportunity.value?.id) === Number(opportunityID)) opportunityExternalStatusLoading.value = false
  }
}

async function launchOpportunityExternal(type) {
  const opportunityID = selectedOpportunity.value?.id
  if (!opportunityID || !canUpdateOpportunity.value || opportunityLaunchLoading.value) return
  if ((type === '报价' && !qbLaunchQuotationAvailable.value) || (type === '投标' && !qbLaunchBidAvailable.value)) {
    opportunityLaunchError.value = '报价/投标短效安全调起尚未配置，已在发起操作前关闭。'
    return
  }
  opportunityLaunchLoading.value = type; opportunityLaunchError.value = ''
  try {
    // 外部入口和短效上下文都由服务端签发；浏览器不从商机表单自行构造身份参数。
    const result = type === '报价' ? await createQuotationLaunch(opportunityID) : await createBidLaunch(opportunityID)
    const target = new URL(result.launch_url)
    target.searchParams.set('context', result.context)
    window.open(target.toString(), '_blank', 'noopener,noreferrer')
  } catch (value) {
    opportunityLaunchError.value = value?.code === 'INTEGRATION_QB_LAUNCH_NOT_CONFIGURED' ? '报价/投标调起尚未配置。' : (value?.message || '报价/投标调起失败。')
  } finally { opportunityLaunchLoading.value = '' }
}

function submitContractTransfer() {
  if (!selectedOpportunity.value || contractTransferLoading.value || !canTransferOpportunity.value) return
  const opportunity = selectedOpportunity.value
  askReason({
    title: '转交合同系统',
    label: '转合同原因',
    required: true,
    confirmText: '确认转交',
    onSubmit: async (reason) => {
      const retry = contractTransferRetries.keyFor(opportunity.id, { version: opportunity.version, reason })
      contractTransferLoading.value = true
      try {
        // 成功仅表示可靠事件已进入投递链，不把异步下游尚未创建的合同提前展示为完成。
        const result = await transferOpportunityToContract(opportunity.id, retry.payload, retry.key)
        contractTransferRetries.confirmSuccess(retry.coordinate, retry.key)
        notice.value = `转合同事件已受理（${result.event_id}），当前为待投递，不代表合同已创建。`
      } catch (value) { showError(value) }
      finally { contractTransferLoading.value = false }
    },
  })
}

// 售前任务查询与商机主详情隔离；售前依赖不可用时，客户与商机主数据仍保持可用。
async function loadOpportunityPresales(targetPage = opportunityPresalePage.number) {
  const opportunityID = selectedOpportunity.value?.id
  if (!opportunityID) return
  const loadSequence = ++opportunityPresaleLoadSequence.value
  opportunityPresaleLoading.value = true; opportunityPresaleError.value = ''
  try {
    const result = await listOpportunityPresaleRequests(opportunityID, { page: targetPage, page_size: opportunityPresalePage.size })
    if (loadSequence !== opportunityPresaleLoadSequence.value || Number(selectedOpportunity.value?.id) !== Number(opportunityID)) return
    opportunityPresales.value = result?.items || []
    opportunityPresalePage.number = Number(result?.page || targetPage)
    opportunityPresalePage.size = Number(result?.page_size || opportunityPresalePage.size)
    opportunityPresalePage.total = Number(result?.total || 0)
  } catch (value) {
    if (loadSequence === opportunityPresaleLoadSequence.value && Number(selectedOpportunity.value?.id) === Number(opportunityID)) {
      opportunityPresales.value = []
      opportunityPresaleError.value = value?.status === 403 ? '当前账号无权查看关联售前任务。' : '关联售前任务暂时无法加载，商机详情不受影响。'
    }
  } finally {
    if (loadSequence === opportunityPresaleLoadSequence.value) opportunityPresaleLoading.value = false
  }
}

async function viewAllOpportunityPresales() {
  opportunityPresalePage.size = 100
  await loadOpportunityPresales(1)
}

async function openOpportunityPresale(item) {
  if (!item?.can_view_detail) return
  await openPresale(item.id)
}

function openOpportunityPresaleCreate() {
  if (!selectedOpportunity.value || !canCreatePresale.value || selectedOpportunity.value.opp_status === 'VOID') return
  resetMessages()
  Object.assign(presaleForm, {
    opportunity_id: String(selectedOpportunity.value.id), venue: 'REMOTE', service_address: '',
    contact_name: '', contact_phone: '', description: '', expected_start: '', expected_end: '', urgency: 'NORMAL',
  })
  presaleCreateDialog.value = true
}

function closeOpportunityPresaleCreate() {
  if (presaleCreateLoading.value) return
  presaleCreateDialog.value = false
  error.value = ''
}

async function refreshPresaleSubmissionCapability() {
  error.value = ''
  await refreshRuntimeCapabilities()
  if (!presaleRequestSubmissionAvailable.value) {
    error.value = '售前投递 Worker 尚未就绪，暂不能提交申请。'
  }
}

async function submitOpportunityPresale() {
  const opportunityID = selectedOpportunity.value?.id
  if (!opportunityID || Number(presaleForm.opportunity_id) !== Number(opportunityID)) {
    error.value = '商机上下文已变化，请关闭申请窗口后重试。'; return
  }
  if (selectedOpportunity.value?.opp_status === 'VOID') {
    error.value = '已作废商机不能发起售前支持。'; return
  }
  const value = await submitPresale({ openDetail: false, refreshList: false })
  if (!value) return
  presaleCreateDialog.value = false
  opportunityPresalePage.number = 1
  await loadOpportunityPresales(1)
}

async function loadNotifications() {
  const [result, unread] = await Promise.all([
    listNotifications({ unread_only: notificationUnreadOnly.value, page: page.number, page_size: page.size }),
    getNotificationUnreadCount(),
  ])
  notifications.value = result?.items || []
  notificationUnreadCount.value = Number(unread?.count || 0)
  page.total = Number(result?.total || 0)
}

async function openNotification(item) {
  try {
    const target = parseNotificationTarget(item.target_path, window.location.origin)
    if (!target) { error.value = '通知中的业务入口无效，已保留当前通知列表。'; return }
    if (item.status === 'UNREAD') await markNotificationRead(item.id)
    await refreshNotificationCount()
    await router.push(target)
    // 路由只承载导航状态；详情仍调用带数据范围校验的真实接口，伪造或过期通知不能借此
    // 绕过商机、售前任务的对象级授权边界。
    if (target.params.section === 'presale') await openPresale(Number(target.query.request_id))
  } catch (value) { showError(value) }
}

function notificationContext(item) {
  const labels = {
    PREVIOUS_OWNER: '原负责人', NEW_OWNER: '新负责人',
    ASSIGNEE_ADDED: '新增执行人', ASSIGNEE_REMOVED: '移出执行人',
  }
  return `${item.request_no || item.opportunity_no || '业务通知'} · ${labels[item.recipient_kind] || '收件人'}`
}

async function openOpportunityFromRoute() {
  if (activeSection.value !== 'opportunities') return
  const raw = Array.isArray(route.query.opportunity_id) ? route.query.opportunity_id[0] : route.query.opportunity_id
  if (raw === undefined || raw === null || raw === '') return
  if (!/^\d+$/.test(String(raw))) {
    error.value = '通知中的商机入口无效，已保留当前列表。'
    return
  }
  const id = Number(raw)
  if (!Number.isSafeInteger(id) || id <= 0) {
    error.value = '通知中的商机入口无效，已保留当前列表。'
    return
  }
  // 查询参数只用于导航，商机可见性和数据范围仍由详情接口判定。
  await openOpportunity(id)
}

async function openCustomerFromRoute() {
  if (activeSection.value !== 'customers') return
  const raw = Array.isArray(route.query.customer_id) ? route.query.customer_id[0] : route.query.customer_id
  if (raw === undefined || raw === null || raw === '') return
  if (!/^\d+$/.test(String(raw))) {
    error.value = '客户详情入口无效，已保留当前列表。'
    return
  }
  const id = Number(raw)
  if (!Number.isSafeInteger(id) || id <= 0) {
    error.value = '客户详情入口无效，已保留当前列表。'
    return
  }
  if (selectedCustomer.value?.id === id) return
  // 查询参数只用于导航，客户可见性和数据范围仍由详情接口判定。
  await openCustomer(id)
}

async function refreshNotificationCount() {
  try {
    const result = await getNotificationUnreadCount()
    notificationUnreadCount.value = Number(result?.count || 0)
  } catch (value) { showError(value) }
}

async function loadStageAlerts() {
  try {
    const result = await listOpportunityStageAlerts({ unread_only: stageAlertUnreadOnly.value, page: 1, page_size: 50 })
    stageAlerts.value = result?.items || []
  } catch (value) { showError(value) }
}

async function openStageAlertOpportunity(item) {
  try {
    if (item.status === 'UNREAD') await markOpportunityStageAlertRead(item.id)
    selectedStageAlert.value = null
    await loadStageAlerts()
    await navigate('opportunities')
    await openOpportunity(item.opportunity_id)
  } catch (value) { showError(value) }
}

async function openStageAlertRuleEditor() {
  if (!canConfigureStageAlerts.value) return
  stageRuleForbidden.value = false
  try {
    const current = await listOpportunityStageAlertRules() || []
    const byStage = new Map(current.map((rule) => [rule.stage, rule]))
    // 仅补齐服务端允许配置的五个推进阶段；缺失项表示尚未配置，不接受由页面任意扩展阶段名。
    stageAlertRules.value = ['初步接触', '需求沟通', '方案制定', '报价', '投标'].map((stage) => byStage.get(stage) || {
      stage, threshold_hours: null, enabled: false, config_version: 0, version: 1, updated_at: null,
    })
    showStageAlertRules.value = true
  } catch (value) {
    if (value?.status === 403) stageRuleForbidden.value = true
    showError(value)
  }
}

async function saveStageAlertRule(rule) {
  if (!Number.isInteger(Number(rule.threshold_hours)) || Number(rule.threshold_hours) < 1 || Number(rule.threshold_hours) > 8760) {
    error.value = '阶段告警阈值必须是 1 至 8760 的整数小时。'
    return
  }
  try {
    await updateOpportunityStageAlertRule(rule.stage, {
      threshold_hours: Number(rule.threshold_hours), enabled: Boolean(rule.enabled), version: Number(rule.version),
    })
    await openStageAlertRuleEditor()
    notice.value = '阶段超时规则已更新；新的配置版本仅影响后续扫描。'
  } catch (value) {
    if (value?.status === 403) { stageRuleForbidden.value = true; showStageAlertRules.value = false }
    showError(value)
  }
}
function openOwnerEditor() {
  Object.assign(ownerForm, { owner_user_id: selectedOpportunity.value.owner_user_id, owner_org_id: selectedOpportunity.value.owner_org_id || '', reason: '' })
  ownerDialog.value = true
}
function teamDirectoryUser(member) {
  const userID = typeof member === 'string' ? member : member?.user_id
  return teamDirectoryOptions.value.find((item) => item.user_id === userID) || (typeof member === 'object' ? member : null)
}
function teamMemberName(member) {
  return teamDirectoryUser(member)?.display_name || (typeof member === 'string' ? member : member?.user_id) || '未知人员'
}
function teamMemberOrganizations(member) {
  const organizations = teamDirectoryUser(member)?.organizations || []
  return organizations.map((item) => `${item.organization_name}${item.is_primary ? '（主组织）' : ''}`).join('、') || '未返回有效组织'
}
function teamRoleText(role) {
  return ({ SALES_SUPPORT: '销售支持', TECHNICAL_SUPPORT: '技术支持', BUSINESS_SUPPORT: '商务支持', OTHER: '其他' })[role] || role
}
async function openTeamEditor() {
  teamForm.members = opportunityTeam.value.map((item) => ({ ...item, organizations: item.organizations || [] }))
  teamForm.reason = ''
  teamDirectoryKeyword.value = ''
  teamDirectoryOptions.value = []
  teamDirectoryError.value = ''
  Object.assign(teamCandidate, { user_id: '', role: 'TECHNICAL_SUPPORT' })
  teamDialog.value = true
  await loadTeamDirectory()
}
function addTeamMember() {
  const userID = teamCandidate.user_id
  if (!userID || teamForm.members.some((item) => item.user_id === userID)) return
  const user = teamDirectoryOptions.value.find((item) => item.user_id === userID)
  if (!user) return
  teamForm.members.push({ ...user, role: teamCandidate.role, directory_status: 'ACTIVE' })
  teamCandidate.user_id = ''
}
function removeTeamMember(index) {
  if (index >= 0 && index < teamForm.members.length) teamForm.members.splice(index, 1)
}
async function submitOwner() {
  try {
    selectedOpportunity.value = await changeOpportunityOwner(selectedOpportunity.value.id, { ...ownerForm, version: selectedOpportunity.value.version })
    ownerDialog.value = false; notice.value = '负责人已变更，事务通知事件已生成。'; await openOpportunity(selectedOpportunity.value.id); await loadCurrent()
  } catch (value) { showError(value) }
}
async function submitTeam() {
  try {
    const members = teamForm.members.map((item) => ({ user_id: item.user_id, role: item.role }))
    const team = await replaceOpportunityMembers(selectedOpportunity.value.id, { members, reason: teamForm.reason, version: selectedOpportunity.value.version })
    selectedOpportunity.value.version = team.version; opportunityTeam.value = team.members || []; opportunityTeamDirectoryAvailable.value = team.directory_available !== false
    teamDialog.value = false; notice.value = '当前商机团队已替换，历史变更已写审计。'; await openOpportunity(selectedOpportunity.value.id); await loadCurrent()
  } catch (value) { showError(value) }
}
async function loadPresaleCore(id, { clearResult = true } = {}) {
  const sequence = ++presaleDetailLoadSequence.value
  try {
    const [detail, logs] = await Promise.all([getPresaleRequest(id), listWorklogs(id)])
    if (sequence !== presaleDetailLoadSequence.value) return false
    selectedPresale.value = detail; worklogs.value = logs || []; operation.worklog_id = logs?.[0]?.id ? String(logs[0].id) : ''
    if (clearResult) presaleResult.value = null
    return true
  } catch (value) {
    if (sequence === presaleDetailLoadSequence.value) showError(value)
    return false
  }
}
async function refreshPresaleActions(id) {
  const sequence = ++presaleActionsLoadSequence.value
  presaleActionsLoading.value = true; presaleActionsError.value = ''
  try {
    const value = await getPresaleAvailableActions(id)
    if (sequence !== presaleActionsLoadSequence.value || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    presaleAvailableActions.value = value
  } catch {
    if (sequence !== presaleActionsLoadSequence.value || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    // 权威动作接口失败时关闭全部写按钮，不回退使用详情中可能已经过期的动作快照。
    // Failure closes all mutating controls; detail.available_actions is intentionally not used as a fallback.
    presaleAvailableActions.value = null
    presaleActionsError.value = '可用操作暂时无法加载，已安全关闭操作入口。'
  } finally {
    if (sequence === presaleActionsLoadSequence.value) presaleActionsLoading.value = false
  }
}
async function refreshPresaleTimeline(id) {
  const sequence = ++presaleTimelineLoadSequence.value
  presaleTimeline.value = []; presaleTimelineCursor.value = ''; presaleTimelineError.value = ''; presaleTimelineLoading.value = true
  try {
    const value = await getPresaleTimeline(id, { limit: 20 })
    if (sequence !== presaleTimelineLoadSequence.value || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    presaleTimeline.value = value?.items || []
    presaleTimelineCursor.value = value?.next_cursor || ''
  } catch {
    if (sequence !== presaleTimelineLoadSequence.value || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    presaleTimelineError.value = '流程时间线暂时无法加载，任务详情和操作区不受影响。'
  } finally {
    if (sequence === presaleTimelineLoadSequence.value) presaleTimelineLoading.value = false
  }
}
async function loadMorePresaleTimeline() {
  const id = selectedPresale.value?.request?.id
  const cursor = presaleTimelineCursor.value
  if (!id || !cursor || presaleTimelineLoading.value) return
  const sequence = ++presaleTimelineLoadSequence.value
  presaleTimelineLoading.value = true; presaleTimelineError.value = ''
  try {
    const value = await getPresaleTimeline(id, { cursor, limit: 20 })
    if (sequence !== presaleTimelineLoadSequence.value || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    // 稳定游标的分页边界仍可能重复返回末条事件，按事件 ID 去重后再追加，保持时间线只读且无重复。
    const known = new Set(presaleTimeline.value.map((item) => item.event_id))
    presaleTimeline.value = [...presaleTimeline.value, ...(value?.items || []).filter((item) => !known.has(item.event_id))]
    presaleTimelineCursor.value = value?.next_cursor || ''
  } catch {
    if (sequence !== presaleTimelineLoadSequence.value || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    presaleTimelineError.value = '更多流程记录加载失败，可稍后重试。'
  } finally {
    if (sequence === presaleTimelineLoadSequence.value) presaleTimelineLoading.value = false
  }
}
async function openPresale(id, { clearResult = true } = {}) {
  // 切换任务前统一作废详情、动作、时间线和敏感电话请求；迟到响应不能覆盖新任务，
  // 已解密的联系电话也只在当前详情生命周期内保留。
  presaleMutationContextSequence.value++
  presaleMutationLoadSequence.value++
  presaleMutationLoading.value = false
  presaleDetailLoadSequence.value++
  presaleActionsLoadSequence.value++; presaleTimelineLoadSequence.value++
  presaleContactPhoneLoadSequence.value++; presaleContactPhone.value = ''; presaleContactPhoneError.value = ''; presaleContactPhoneLoading.value = false
  selectedPresale.value = null; worklogs.value = []
  presaleAvailableActions.value = null; presaleActionsError.value = ''
  presaleTimeline.value = []; presaleTimelineCursor.value = ''; presaleTimelineError.value = ''
  progressSubmissionKey.value = ''; progressSubmissionSignature.value = ''
  const loaded = await loadPresaleCore(id, { clearResult })
  if (!loaded) return
  void refreshPresaleActions(id)
  void refreshPresaleTimeline(id)
}
function closePresale() {
  presaleMutationContextSequence.value++
  presaleMutationLoadSequence.value++
  presaleMutationLoading.value = false
  presaleDetailLoadSequence.value++; presaleActionsLoadSequence.value++; presaleTimelineLoadSequence.value++
  presaleContactPhoneLoadSequence.value++; presaleContactPhone.value = ''; presaleContactPhoneError.value = ''; presaleContactPhoneLoading.value = false
  selectedPresale.value = null; presaleAvailableActions.value = null; presaleTimeline.value = []
  progressSubmissionKey.value = ''; progressSubmissionSignature.value = ''
}
async function viewPresaleContactPhone() {
  const id = selectedPresale.value?.request?.id
  if (!id || !canViewSelectedPresaleContactPhone.value || presaleContactPhoneLoading.value) return
  const sequence = ++presaleContactPhoneLoadSequence.value
  presaleContactPhone.value = ''; presaleContactPhoneError.value = ''; presaleContactPhoneLoading.value = true
  try {
    const value = await getPresaleContactPhone(id)
    if (sequence !== presaleContactPhoneLoadSequence.value || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    presaleContactPhone.value = value?.contact_phone || ''
    if (!presaleContactPhone.value) presaleContactPhoneError.value = '联系电话暂时无法查看。'
  } catch {
    if (sequence === presaleContactPhoneLoadSequence.value && Number(selectedPresale.value?.request?.id) === Number(id)) {
      presaleContactPhoneError.value = '联系电话查看失败，未展示敏感信息。'
    }
  } finally {
    if (sequence === presaleContactPhoneLoadSequence.value) presaleContactPhoneLoading.value = false
  }
}
async function loadEngineerDirectory() {
  try { const value = await listPresaleEngineers({ ...engineerQuery, page: 1, page_size: 100 }); engineerDirectory.value = value?.items || []; engineerSyncMeta.value = value || null }
  catch (value) { showError(value) }
}
async function openEngineerPicker() {
  selectedEngineerIDs.value = (selectedPresale.value?.current_assignees || []).map((item) => item.person_id)
  assignmentReason.value = ''; engineerPickerOpen.value = true; await loadEngineerDirectory()
}
async function requestEngineerSync() {
  if (!canSyncEngineers.value) { error.value = '当前账号没有人员池同步权限。'; return }
  try { const job = await syncPresaleEngineers(); notice.value = `人员同步任务 ${job.job_no} 已入队，当前状态 ${job.status}。旧缓存会保留至任务成功。` }
  catch (value) { showError(value) }
}
function assignmentTargets() {
  const byID = new Map(engineerDirectory.value.map((item) => [item.person_id, item]))
  const current = new Map((selectedPresale.value?.current_assignees || []).map((item) => [item.person_id, item]))
  return selectedEngineerIDs.value.map((personID) => ({ person_id: personID, role: byID.get(personID)?.role || current.get(personID)?.role })).filter((item) => item.role)
}
async function loadAlerts() {
  try { const result = await listPresaleAlerts({ unread_only: true, page: 1, page_size: 20 }); alerts.value = result?.items || [] }
  catch (value) { showError(value) }
}
async function readAlert(item) {
  try { await markPresaleAlertRead(item.id); await loadAlerts(); await openPresale(item.request_id) }
  catch (value) { showError(value) }
}
async function openAlertConfig() {
  try { alertRules.value = await listPresaleAlertRules() || []; showAlertConfig.value = true }
  catch (value) { showError(value) }
}
async function saveAlertRule(rule) {
  try { await updatePresaleAlertRule(rule.type, { threshold_hours: Number(rule.threshold_hours), enabled: rule.enabled, version: rule.config_version }); await openAlertConfig(); notice.value = '预警规则已更新，新版本只影响后续扫描。' }
  catch (value) { showError(value) }
}
async function submitCustomer() {
  actionLoading.value = true; resetMessages()
  try {
    let createRetry = null
    if (!customerEditMode.value) {
      const createPayload = structuredClone(customerForm)
      createPayload.contacts.forEach(({ id }, index) => { delete createPayload.contacts[index].id })
      createRetry = createMutationRetries.keyFor('customer', createPayload)
    }
    // 已发送但结果不明确的创建命令必须带原键重放到创建接口；若再次执行提示性的查重，
    // 它会把上次可能已成功创建的记录当成重复项，反而阻断可靠重放。
    if (customerEditMode.value || !createRetry.attempted) {
      const duplicate = await checkCustomerDuplicate({ name: customerForm.name, unified_credit_code: customerForm.unified_credit_code })
      const candidates = (Array.isArray(duplicate) ? duplicate : []).filter((item) => item.id !== selectedCustomer.value?.id)
      if (candidates.length && !customerForm.duplicate_override) { error.value = `发现 ${candidates.length} 条疑似重复客户，请确认覆盖并填写原因。`; return }
    }
    if (customerEditMode.value) {
      const payload = {
        name: customerForm.name, customer_type: customerForm.customer_type, industry: customerForm.industry, region: customerForm.region,
        owner_user_id: customerForm.owner_user_id, owner_org_id: customerForm.owner_org_id, reason: customerForm.reason,
        duplicate_override: customerForm.duplicate_override, duplicate_override_reason: customerForm.duplicate_override_reason,
        version: selectedCustomer.value.version,
        contacts: customerForm.contacts.map((item) => {
          const contact = { id: item.id, name: item.name, is_registration: item.is_registration }
          if (item.phone) contact.phone = item.phone
          if (item.email) contact.email = item.email
          return contact
        }),
      }
      if (customerForm.unified_credit_code) payload.unified_credit_code = customerForm.unified_credit_code
      selectedCustomer.value = await updateCustomer(selectedCustomer.value.id, payload)
      notice.value = '客户资料已更新。'
    } else {
      createMutationRetries.markAttempted('customer', createRetry.key)
      await createCustomer(createRetry.payload, createRetry.key)
      createMutationRetries.confirmSuccess('customer', createRetry.key)
      notice.value = '客户创建成功。'
    }
    customerDialog.value = false; await loadCurrent()
  } catch (value) { showError(value) } finally { actionLoading.value = false }
}
function changeCustomerStatus(action) {
  if (!selectedCustomer.value) return
  const customer = selectedCustomer.value
  const voiding = action === 'void'
  askReason({
    title: voiding ? '作废客户' : '恢复客户',
    label: voiding ? '作废原因' : '恢复原因',
    required: true,
    confirmText: voiding ? '确认作废' : '确认恢复',
    onSubmit: async (reason) => {
      try {
        selectedCustomer.value = voiding
          ? await voidCustomer(customer.id, { version: customer.version, reason })
          : await restoreCustomer(customer.id, { version: customer.version, reason })
        notice.value = voiding ? '客户已作废。' : '客户已恢复。'
        await loadCurrent()
      } catch (value) { showError(value) }
    },
  })
}
async function submitOpportunity() {
  actionLoading.value = true; resetMessages()
  try {
    if (opportunityEditMode.value) {
      // 普通更新 DTO 不接受客户归属和负责人字段；负责人变更必须走独立接口，
      // 以执行人员目录校验、对象权限检查、乐观锁和审计记录。
      const { customer_id, owner_user_id, owner_org_id, ...payload } = opportunityForm
      selectedOpportunity.value = await updateOpportunity(selectedOpportunity.value.id, { ...payload, system_count: Number(payload.system_count || 0), version: selectedOpportunity.value.version })
      notice.value = '商机主档已更新。'
    } else {
      const { reason, ...payload } = opportunityForm
      const retry = createMutationRetries.keyFor('opportunity', { ...payload, customer_id: Number(payload.customer_id), system_count: Number(payload.system_count || 0) })
      await createOpportunity(retry.payload, retry.key)
      createMutationRetries.confirmSuccess('opportunity', retry.key)
      notice.value = '商机创建成功。'
    }
    opportunityDialog.value = false; await loadCurrent()
  }
  catch (value) { showError(value) } finally { actionLoading.value = false }
}
function changeOpportunityStatus(action) {
  if (!selectedOpportunity.value) return
  const opportunity = selectedOpportunity.value
  const voiding = action === 'void'
  askReason({
    title: voiding ? '作废商机' : '恢复商机',
    label: voiding ? '商机作废原因' : '商机恢复原因',
    required: true,
    confirmText: voiding ? '确认作废' : '确认恢复',
    onSubmit: async (reason) => {
      try {
        selectedOpportunity.value = voiding
          ? await voidOpportunity(opportunity.id, { version: opportunity.version, reason })
          : await restoreOpportunity(opportunity.id, { version: opportunity.version, reason })
        notice.value = voiding ? '商机已作废。' : '商机已恢复。'
        await loadCurrent()
      } catch (value) { showError(value) }
    },
  })
}
async function submitStage() {
  if (!selectedOpportunity.value) return
  try {
    const payload = { target_stage: stageForm.target_stage, reason: stageForm.reason, version: selectedOpportunity.value.version }
    if (stageForm.contract_ref) payload.contract_ref = stageForm.contract_ref
    if (stageForm.lost_reason) payload.lost_reason = stageForm.lost_reason
    selectedOpportunity.value = await changeOpportunityStage(selectedOpportunity.value.id, payload)
    stageDialog.value = false; notice.value = '阶段已生效并写入历史。'; await openOpportunity(selectedOpportunity.value.id); await loadCurrent()
  } catch (value) { showError(value) }
}
async function submitTerminal() {
  try {
    const payload = { version: selectedOpportunity.value.version, reason: terminalForm.reason }
    if (selectedOpportunity.value.terminal_pending_type === 'CONTRACT') payload.contract_ref = terminalForm.contract_ref
    if (selectedOpportunity.value.terminal_pending_type === 'LOST_REASON') payload.lost_reason = terminalForm.lost_reason
    selectedOpportunity.value = await completeOpportunityTerminalTodo(selectedOpportunity.value.id, payload)
    terminalDialog.value = false; notice.value = '终态待办已补全。'; await openOpportunity(selectedOpportunity.value.id); await loadCurrent()
  } catch (value) { showError(value) }
}
async function submitFollowup() {
  try {
    const payload = { type: followupForm.type, content: followupForm.content, followed_at: new Date(followupForm.followed_at).toISOString() }
    if (followupForm.next_follow_at) payload.next_follow_at = new Date(followupForm.next_follow_at).toISOString()
    await createOpportunityFollowup(selectedOpportunity.value.id, payload); followupDialog.value = false; notice.value = '跟进记录已添加。'; await openOpportunity(selectedOpportunity.value.id)
  } catch (value) { showError(value) }
}
async function submitCustomerFollowup() {
  try {
    const payload = { type: customerFollowupForm.type, content: customerFollowupForm.content, followed_at: new Date(customerFollowupForm.followed_at).toISOString() }
    if (customerFollowupForm.next_follow_at) payload.next_follow_at = new Date(customerFollowupForm.next_follow_at).toISOString()
    await createCustomerFollowup(selectedCustomer.value.id, payload); customerFollowupDialog.value = false; notice.value = '客户沟通记录已添加。'; await openCustomer(selectedCustomer.value.id)
  } catch (value) { showError(value) }
}
async function submitPresale({ openDetail = true, refreshList = true } = {}) {
  if (presaleCreateLoading.value) return null
  resetMessages()
  if (!canCreatePresale.value) {
    error.value = '当前账号没有发起售前申请的权限。'
    return null
  }
  if (!presaleRequestSubmissionAvailable.value) {
    error.value = '售前投递 Worker 没有新鲜运行证据，当前不会受理新的售前申请。'
    return null
  }
  if (presaleForm.venue === 'ONSITE' && !presaleForm.service_address.trim()) { error.value = '现场支持必须填写服务地址。'; return null }
  const opportunityID = Number(presaleForm.opportunity_id)
  if (!Number.isSafeInteger(opportunityID) || opportunityID <= 0) { error.value = '请选择有效的关联商机。'; return null }
  const expectedStart = new Date(presaleForm.expected_start)
  const expectedEnd = new Date(presaleForm.expected_end)
  if (Number.isNaN(expectedStart.getTime()) || Number.isNaN(expectedEnd.getTime())) { error.value = '请填写有效的预计开始和结束时间。'; return null }
  if (expectedEnd <= expectedStart) { error.value = '预计结束时间必须晚于预计开始时间。'; return null }
  presaleCreateLoading.value = true
  try {
    // 售前投递可能已入队但响应在网络中丢失；规范化后的同一命令复用幂等键，
    // 直到服务端明确成功才清除，避免重复启动审批流程。
    const retry = presaleMutationRetries.keyFor('create', opportunityID, {
      ...presaleForm,
      opportunity_id: opportunityID,
      expected_start: presaleForm.expected_start,
      expected_end: presaleForm.expected_end,
    })
    const value = await createPresaleRequest(retry.payload, retry.key)
    presaleMutationRetries.confirmSuccess('create', opportunityID, retry.key)
    notice.value = '售前申请已提交；商机阶段保持不变。'
    if (refreshList) await loadCurrent()
    if (openDetail) await openPresale(value.id)
    return value
  } catch (value) { showError(value); return null }
  finally { presaleCreateLoading.value = false }
}
function presaleDecisionSpec(action) {
  return {
    approve: { title: '通过审批', label: '审批意见', required: false, confirmText: '确认通过' },
    reject: { title: '驳回审批', label: '驳回原因', required: true, confirmText: '确认驳回' },
    cancel: { title: '取消申请', label: '取消原因', required: true, confirmText: '确认取消' },
  }[action]
}
function runPresaleDecision(action) {
  const detail = selectedPresale.value
  if (!detail?.request?.id || presaleMutationLoading.value) return
  const id = detail.request.id
  const authoritative = presaleAvailableActions.value
  const version = Number(authoritative?.version)
  const required = ({ approve: 'APPROVE', reject: 'REJECT', cancel: 'CANCEL' })[action]
  if (!authoritative || !Number.isInteger(version) || !authoritativePresaleActions.value.includes(required)) {
    error.value = '服务端未授权该操作或操作状态已变化，请刷新可用操作。'
    void refreshPresaleActions(id)
    return
  }
  askReason({ ...presaleDecisionSpec(action), onSubmit: async (comment) => { await submitPresaleDecision(action, id, version, comment) } })
}
async function submitPresaleDecision(action, id, version, comment) {
  const mutationContext = presaleMutationContextSequence.value
  const mutationToken = ++presaleMutationLoadSequence.value
  presaleMutationLoading.value = true
  const isCurrentMutation = () => mutationContext === presaleMutationContextSequence.value && Number(selectedPresale.value?.request?.id) === Number(id)
  try {
    if (action === 'approve' || action === 'reject') {
      const approvalAction = action === 'approve' ? 'PASS' : 'REJECT'
      const retry = presaleMutationRetries.keyFor('approval', id, { action: approvalAction, comment, version })
      await submitApprovalAction(id, retry.payload, retry.key)
      presaleMutationRetries.confirmSuccess('approval', id, retry.key)
      if (!isCurrentMutation()) return
      presaleResult.value = { accepted: true, action: approvalAction }
    } else {
      const retry = presaleMutationRetries.keyFor('cancel', id, { reason: comment, version })
      const result = await cancelPresaleRequest(id, retry.payload, retry.key)
      presaleMutationRetries.confirmSuccess('cancel', id, retry.key)
      if (!isCurrentMutation()) return
      presaleResult.value = result
    }
    notice.value = '操作完成。'
    const loaded = await loadPresaleCore(id, { clearResult: false })
    if (loaded) await Promise.all([refreshPresaleActions(id), refreshPresaleTimeline(id)])
    await loadCurrent()
    if (selectedOpportunity.value) await loadOpportunityPresales(opportunityPresalePage.number)
  } catch (value) {
    if (mutationToken === presaleMutationLoadSequence.value) showError(value)
  } finally {
    if (mutationToken === presaleMutationLoadSequence.value) presaleMutationLoading.value = false
  }
}
async function runPresale(action) {
  const detail = selectedPresale.value
  if (!detail?.request?.id) return
  const id = detail.request.id
  // 可用动作和版本均来自服务端详情，是状态机的权威快照；前端权限只控制展示，
  // 不能在缺少该快照时猜测允许写操作。
  const authoritative = presaleAvailableActions.value
  const version = Number(authoritative?.version)
  const mutationActions = new Set(['assign', 'progress', 'worklog'])
  const refreshActions = new Set([...mutationActions, 'retry'])
  if (mutationActions.has(action) && presaleMutationLoading.value) return
  if (mutationActions.has(action) && (!authoritative || !Number.isInteger(version) || !authoritativePresaleActions.value.includes(({ assign: 'ASSIGN', progress: 'ADD_PROGRESS', worklog: 'ADD_WORKLOG' })[action]))) {
    error.value = '服务端未授权该操作或操作状态已变化，请刷新可用操作。'
    await refreshPresaleActions(id)
    return
  }
  const mutationContext = presaleMutationContextSequence.value
  const mutationToken = mutationActions.has(action) ? ++presaleMutationLoadSequence.value : 0
  if (mutationToken) presaleMutationLoading.value = true
  // 操作期间用户可能关闭详情或切换申请。请求仍可在服务端完成，但旧响应不得
  // 覆盖新详情；幂等状态仍按真实成功结果清理。
  const isCurrentMutation = () => mutationContext === presaleMutationContextSequence.value && Number(selectedPresale.value?.request?.id) === Number(id)
  try {
    if (action === 'assignments') presaleResult.value = await getAssignments(id)
    if (action === 'history') presaleResult.value = await getApprovalHistory(id)
    if (action === 'assign') {
      if (!assignmentReason.value.trim()) { error.value = '改派原因必填。'; return }
      const targets = assignmentTargets()
      if (!targets.length || targets.length !== selectedEngineerIDs.value.length) { error.value = '请选择有效的 PMS 技术人员。'; return }
      const retry = presaleMutationRetries.keyFor('assignment', id, { assignees: targets, change_reason: assignmentReason.value, version })
      const result = await replaceAssignments(id, retry.payload, retry.key)
      presaleMutationRetries.confirmSuccess('assignment', id, retry.key)
      if (!isCurrentMutation()) return
      presaleResult.value = result
      engineerPickerOpen.value = false
    }
    if (action === 'progress') {
      const link = operation.progress_link.trim()
      if (link && !safeHTTPSURL(link)) { error.value = '进度链接只允许使用 HTTPS。'; return }
      const progressPayload = { content: operation.progress, link_url: link, progress_pct: operation.progress_pct === '' ? null : Number(operation.progress_pct), version }
      const progressSignature = JSON.stringify(progressPayload)
      if (!progressSubmissionKey.value || progressSubmissionSignature.value !== progressSignature) {
        progressSubmissionKey.value = createIdempotencyKey()
        progressSubmissionSignature.value = progressSignature
      }
      const submissionKey = progressSubmissionKey.value
      const result = await addProgress(id, progressPayload, submissionKey)
      if (!isCurrentMutation()) return
      presaleResult.value = result
      if (progressSubmissionKey.value === submissionKey) {
        progressSubmissionKey.value = ''; progressSubmissionSignature.value = ''
      }
    }
    if (action === 'worklog') {
      const retry = presaleMutationRetries.keyFor('worklog', id, { work_start: new Date(operation.work_start).toISOString(), work_end: new Date(operation.work_end).toISOString(), raw_unit: operation.raw_unit, raw_value: operation.raw_value, work_site_address: operation.work_site_address, work_content: operation.work_content, remark: operation.remark, version })
      presaleMutationRetries.markAttempted('worklog', id, retry.key)
      const result = await addWorklog(id, retry.payload, retry.key)
      presaleMutationRetries.confirmSuccess('worklog', id, retry.key)
      if (!isCurrentMutation()) return
      presaleResult.value = result
    }
    if (action === 'delivery') presaleResult.value = await getWorklogDelivery(Number(operation.worklog_id))
    if (action === 'retry') presaleResult.value = await retryWorklogDelivery(Number(operation.worklog_id))
    notice.value = '操作完成。'
    if (refreshActions.has(action)) {
      const loaded = await loadPresaleCore(id, { clearResult: false })
      if (loaded) await Promise.all([refreshPresaleActions(id), refreshPresaleTimeline(id)])
      await loadCurrent()
      if (selectedOpportunity.value) await loadOpportunityPresales(opportunityPresalePage.number)
    }
  } catch (value) {
    if (!mutationToken || isCurrentMutation()) showError(value)
  } finally {
    if (mutationToken && mutationToken === presaleMutationLoadSequence.value) presaleMutationLoading.value = false
  }
}

watch(activeSection, () => {
  closeCustomerDetail(); selectedOpportunity.value = null; closePresale(); page.number = 1
  presaleCreatePage.value = false; presaleCreateDialog.value = false
  if (activeSection.value === 'presale') restorePresaleStateFromURL()
  if (activeSection.value === 'customers' && !customerOwnerOptions.value.length && !customerOwnerOptionsLoading.value) void loadCustomerOwnerOptions()
  loadCurrent()
})
watch(() => route.fullPath, () => {
  if (activeSection.value !== 'presale') return
  const current = Object.fromEntries(Object.entries(route.query).map(([key, value]) => [key, Array.isArray(value) ? String(value[0] || '') : String(value || '')]))
  const expected = presaleStateToQuery(presaleFilters, presaleView.value, presalePage.number, presalePage.size, presaleColumnLimit.value)
  // 组件主动 replace 也会触发 watcher；稳定比较用于打断“状态写 URL—URL 再写状态”循环。
  if (stableQuery(current) === stableQuery(expected)) return
  restorePresaleStateFromURL()
  loadCurrent()
})
watch(() => [activeSection.value, route.query.opportunity_id], openOpportunityFromRoute, { immediate: true })
watch(() => [activeSection.value, route.query.customer_id], openCustomerFromRoute, { immediate: true })
watch(notificationUnreadOnly, () => { page.number = 1; if (activeSection.value === 'notifications') loadCurrent() })
watch(stageAlertUnreadOnly, loadStageAlerts)
onMounted(async () => {
  try { crmSession.value = await getCRMSession() } catch (value) { showError(value) }
  await refreshRuntimeCapabilities()
  const permissionTasks = [
    ...(canReadOpportunities.value ? [loadStageAlerts()] : []),
    ...(canReadNotifications.value ? [refreshNotificationCount()] : []),
    ...(activeSection.value === 'customers' ? [loadCustomerOwnerOptions()] : []),
  ]
  await Promise.all([loadCurrent(), loadAlerts(), ...permissionTasks])
})
</script>

<template>
  <div class="console-page crm-shell">
    <button v-if="mobileMenuOpen" class="console-menu-mask crm-menu-mask" type="button" aria-label="关闭导航" @click="mobileMenuOpen = false"></button>
    <aside class="console-sidebar crm-sidebar" :class="{ open: mobileMenuOpen }">
      <div class="console-brand crm-brand">
        <span class="console-brand-mark"><ConsoleIcon name="logo" /></span>
        <span class="console-brand-copy"><strong>客户与商机管理</strong><small>CRM 协同工作台</small></span>
        <button class="console-close-menu" type="button" aria-label="关闭导航菜单" @click="mobileMenuOpen = false"><ConsoleIcon name="close" /></button>
      </div>
      <nav class="console-nav crm-nav" aria-label="客户与商机功能">
        <p class="console-nav-label">业务中心</p>
        <button class="console-nav-item" type="button" :class="{ active: activeSection === 'customers' }" @click="navigate('customers')"><ConsoleIcon name="user" /><span>客户管理</span></button>
        <button class="console-nav-item" type="button" :class="{ active: activeSection === 'opportunities' }" @click="navigate('opportunities')"><ConsoleIcon name="dashboard" /><span>商机管理</span></button>
        <button class="console-nav-item" type="button" :class="{ active: activeSection === 'presale' }" @click="navigate('presale')"><ConsoleIcon name="organization" /><span>售前技术支持</span></button>
        <p class="console-nav-label">消息中心</p>
        <button v-if="canReadNotifications" class="console-nav-item" type="button" :class="{ active: activeSection === 'notifications' }" @click="navigate('notifications')"><ConsoleIcon name="bell" /><span>个人通知</span><span v-if="notificationUnreadCount" class="crm-nav-badge">{{ notificationUnreadCount > 99 ? '99+' : notificationUnreadCount }}</span></button>
        <p class="console-nav-label">平台能力</p>
        <button class="console-nav-item" type="button" @click="navigatePlatform"><ConsoleIcon name="logout" /><span>返回统一门户</span><span class="console-nav-note">平台</span></button>
      </nav>
      <div class="console-sidebar-note"><ConsoleIcon name="shield" /><span>统一身份认证已生效，菜单与操作由服务端权限控制。</span></div>
      <div class="console-sidebar-user">
        <span class="console-avatar" aria-hidden="true">{{ currentUserInitial }}</span>
        <span class="console-user-copy"><strong :title="currentUserLabel">{{ currentUserLabel }}</strong><small :title="currentRoleLabel">{{ currentRoleLabel }}</small></span>
        <button class="console-logout" type="button" aria-label="返回统一门户" @click="navigatePlatform"><ConsoleIcon name="logout" /></button>
      </div>
    </aside>
    <main class="console-main crm-main">
      <header class="console-topbar crm-topbar">
        <button class="console-menu-button" type="button" aria-label="打开导航菜单" @click="mobileMenuOpen = true"><ConsoleIcon name="menu" /></button>
        <div class="console-crumb"><span>客户与商机管理</span><ConsoleIcon name="chevron" /><strong>{{ sectionTitle }}</strong></div>
        <div class="console-topbar-actions">
          <button v-if="canReadNotifications" class="console-icon-button" type="button" aria-label="打开个人通知" @click="navigate('notifications')"><ConsoleIcon name="bell" /><i v-if="notificationUnreadCount"></i></button>
          <span class="console-topbar-avatar">{{ currentUserInitial }}</span>
        </div>
      </header>
      <section class="console-content crm-content">
        <header class="console-page-head crm-page-head"><div><h1>{{ activeSection === 'presale' && presaleCreatePage ? '新建售前申请' : sectionTitle }}</h1><p>{{ activeSection === 'presale' && presaleCreatePage ? '填写售前支持需求，提交后进入两级审批流程' : activeSection === 'notifications' ? '通知收件人固定为当前登录用户，不受 SELF / ORG / ALL 数据范围扩展' : '可见数据与可执行动作均由服务端权限和状态控制' }}</p></div><div v-if="activeSection === 'presale'" class="crm-actions"><template v-if="presaleCreatePage"><button type="button" :disabled="presaleCreateLoading" @click="closePresaleCreatePage">← 返回申请列表</button><button class="primary" type="submit" form="presale-create-form" :disabled="presaleCreateLoading">{{ presaleCreateLoading ? '提交中…' : '提交申请' }}</button></template><template v-else><button v-if="canCreatePresale && presaleRequestSubmissionAvailable" class="primary" type="button" @click="openPresaleCreatePage">新建申请</button><button @click="openReports">投入报表</button><button @click="loadAlerts">未读预警 {{ alerts.length }}</button><button @click="openAlertConfig">预警规则</button></template></div><div v-if="activeSection === 'opportunities'" class="crm-actions"><button @click="loadStageAlerts">刷新阶段告警</button><button v-if="canConfigureStageAlerts" @click="openStageAlertRuleEditor">阶段告警规则</button></div></header>
      <p v-if="error" class="crm-alert error" role="alert">{{ error }}</p><p v-if="notice" class="crm-alert success" role="status">{{ notice }}</p><p v-if="runtimeCapabilitiesError" class="crm-alert warning" role="status">{{ runtimeCapabilitiesError }}</p>
      <section v-if="activeSection === 'customers'" class="crm-toolbar crm-customer-filters">
        <label>客户号 / 名称<input v-model.trim="customerFilters.keyword" @keyup.enter="loadCurrent"></label>
        <label>类型<input v-model.trim="customerFilters.type" list="customer-type-options" placeholder="业主 / 三方 等"></label><datalist id="customer-type-options"><option v-for="item in customerTypeSuggestions" :key="item" :value="item"></option></datalist><label>行业<select v-model="customerFilters.industry"><option value="">全部行业</option><option v-for="item in customerIndustryOptions" :key="item" :value="item">{{ item }}</option></select></label><label>区域<input v-model.trim="customerFilters.region" list="customer-region-options" placeholder="华北 / 华南 等"></label><datalist id="customer-region-options"><option v-for="item in customerRegionSuggestions" :key="item" :value="item"></option></datalist>
        <label>查找负责人<input v-model.trim="customerOwnerKeyword" type="search" placeholder="输入姓名" @keyup.enter.prevent="loadCustomerOwnerOptions"></label>
        <label v-if="!customerOwnerOptionsError">负责人<select v-model="customerFilters.owner_id" :disabled="customerOwnerOptionsLoading"><option value="">全部负责人</option><option v-for="user in customerOwnerOptions" :key="user.user_id" :value="user.user_id">{{ user.display_name }}</option></select></label>
        <label v-else>负责人 ID<input v-model.trim="customerFilters.owner_id" type="text" placeholder="输入负责人用户 ID（OIDC sub）"></label>
        <label>状态<select v-model="customerFilters.status"><option value="">全部状态</option><option v-for="item in customerStatusOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><label>创建开始<input v-model="customerFilters.created_from" type="date"></label><label>创建结束<input v-model="customerFilters.created_to" type="date"></label><label>最近跟进开始<input v-model="customerFilters.last_followup_from" type="date"></label><label>最近跟进结束<input v-model="customerFilters.last_followup_to" type="date"></label><label>排序<select v-model="customerFilters.sort_by"><option value="updated_at">更新时间</option><option value="created_at">创建时间</option><option value="name">客户名称</option><option value="last_followup_at">最近跟进</option><option value="opportunity_amount_sum">商机金额汇总</option></select></label><label>顺序<select v-model="customerFilters.sort_order"><option value="desc">降序</option><option value="asc">升序</option></select></label>
        <button type="button" :disabled="customerOwnerOptionsLoading" @click="loadCustomerOwnerOptions">{{ customerOwnerOptionsLoading ? '查找中…' : '查找负责人' }}</button><button @click="page.number = 1; loadCurrent()">查询</button><button @click="customerFilters.view = customerFilters.view === 'table' ? 'cards' : 'table'; syncCustomerURL()">{{ customerFilters.view === 'table' ? '卡片视图' : '列表视图' }}</button><button v-if="canCreateCustomer" class="primary" @click="openNewCustomer">新建</button><button v-if="canImportCustomers" :disabled="!customerImportScanAvailable" :title="customerImportScanAvailable ? '' : '可信文件扫描器未配置'" @click="openCustomerImport">Excel 导入</button><button v-if="canExportCustomers" :disabled="!customerExportAvailable" :title="customerExportAvailable ? '' : '客户导出 Provider 未配置'" @click="exportCustomers">导出</button>
      </section>
      <p v-if="activeSection === 'customers' && customerOwnerOptionsError" class="crm-alert error" role="alert">{{ customerOwnerOptionsError }} 负责人筛选已回退为手动输入用户 ID。</p>
      <section v-else-if="activeSection === 'opportunities'" class="crm-toolbar"><label>关键词<input v-model.trim="filters.keyword" @keyup.enter="loadCurrent"></label><label v-if="!boardMode">状态<select v-model="filters.status"><option value="">全部状态</option><option v-for="item in opportunityStatusOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><label v-if="!boardMode">阶段<select v-model="filters.stage"><option value="">全部阶段</option><option v-for="item in opportunityStageOptions" :key="item" :value="item">{{ item }}</option></select></label><button @click="loadCurrent">查询</button><button @click="boardMode = !boardMode; loadCurrent()">{{ boardMode ? '列表视图' : '阶段看板' }}</button><button class="primary" @click="openNewOpportunity">新建</button></section>
      <form v-else-if="activeSection === 'presale' && !presaleCreatePage" class="crm-toolbar crm-presale-filters" @submit.prevent="applyPresaleFilters"><label>申请编号<input v-model.trim="presaleFilters.request_no" maxlength="32"></label><label>商机<select v-model="presaleFilters.opportunity_id"><option value="">全部可见商机</option><option v-for="item in presaleFilterOptions.opportunities" :key="item.value" :value="String(item.value)">{{ item.label }}</option></select></label><label>申请人<select v-model="presaleFilters.applicant_id"><option value="">全部可见申请人</option><option v-for="item in presaleFilterOptions.applicants" :key="item.value" :value="item.value">{{ item.label || item.value }}</option></select></label><label>执行人<select v-model="presaleFilters.assignee_id"><option value="">全部可见执行人</option><option v-for="item in presaleFilterOptions.assignees" :key="item.value" :value="item.value">{{ item.label || item.value }}</option></select></label><label>状态<select v-model="presaleFilters.status"><option value="">全部可见状态</option><option v-for="item in presaleFilterOptions.statuses" :key="item.value" :value="item.value">{{ presaleOptionText('statuses', item) }}</option></select></label><label>场地<select v-model="presaleFilters.venue"><option value="">全部可见场地</option><option v-for="item in presaleFilterOptions.venues" :key="item.value" :value="item.value">{{ presaleOptionText('venues', item) }}</option></select></label><label>紧急度<select v-model="presaleFilters.urgency"><option value="">全部可见级别</option><option v-for="item in presaleFilterOptions.urgencies" :key="item.value" :value="item.value">{{ presaleOptionText('urgencies', item) }}</option></select></label><label>申请开始<input v-model="presaleFilters.created_from" type="datetime-local"></label><label>申请结束（不含）<input v-model="presaleFilters.created_to" type="datetime-local"></label><label>期望开始<input v-model="presaleFilters.expected_from" type="datetime-local"></label><label>期望结束（不含）<input v-model="presaleFilters.expected_to" type="datetime-local"></label><label>是否超时<select v-model="presaleFilters.overdue"><option value="">全部</option><option value="true">已超时</option><option value="false">未超时</option></select></label><label>推送状态<select v-model="presaleFilters.push_status"><option value="">全部可见状态</option><option v-for="item in presaleFilterOptions.push_statuses" :key="item.value" :value="item.value">{{ presaleOptionText('push_statuses', item) }}</option></select></label><label>排序<select v-model="presaleFilters.sort_by"><option value="created_at">申请时间</option><option value="updated_at">更新时间</option><option value="expected_end">期望结束</option><option value="request_no">申请编号</option></select></label><label>顺序<select v-model="presaleFilters.sort_order"><option value="desc">降序</option><option value="asc">升序</option></select></label><button class="primary">查询</button><button type="button" @click="switchPresaleView(presaleView === 'list' ? 'board' : 'list')">{{ presaleView === 'list' ? '状态看板' : '列表视图' }}</button></form>
      <p v-if="activeSection === 'presale' && presaleFilterOptionsError" class="crm-alert error" role="alert">{{ presaleFilterOptionsError }}</p><p v-else-if="activeSection === 'presale' && presaleFilterOptions.truncated" class="crm-note">筛选选项已按服务端上限截断；输入已有条件可继续缩小结果。</p>

      <section v-if="activeSection === 'customers'" class="crm-quick-filters" aria-label="客户快捷筛选"><button <button :class="{ active: customerFilters.quick_filter === 'NEW' }" @click="useCustomerQuickFilter('NEW')">新增客户（近 30 天）</button><button :class="{ active: customerFilters.quick_filter === 'WON' }" @click="useCustomerQuickFilter('WON')">成交客户</button><button :class="{ active: customerFilters.quick_filter === 'FOLLOWUP_DUE' }" @click="useCustomerQuickFilter('FOLLOWUP_DUE')">待跟进</button></section>

      <section v-if="activeSection === 'notifications'" class="crm-panel crm-inbox"><div class="crm-panel-heading"><div><h2>我的业务通知</h2><p class="crm-note">只包含发给当前用户的商机负责人和售前执行人通知；点击后标为已读，并通过真实详情接口再次校验数据范围。</p></div><label class="check"><input v-model="notificationUnreadOnly" type="checkbox">仅看未读</label></div><p v-if="loading">正在加载…</p><div v-else-if="notifications.length" class="crm-inbox-list"><button v-for="item in notifications" :key="item.id" :class="['crm-inbox-item', { unread: item.status === 'UNREAD' }]" @click="openNotification(item)"><span class="crm-status">{{ item.status === 'UNREAD' ? '未读' : '已读' }}</span><strong>{{ item.title }}</strong><span>{{ item.body }}</span><small>{{ notificationContext(item) }} · {{ formatDate(item.created_at) }}</small></button></div><div v-else class="crm-empty">暂无{{ notificationUnreadOnly ? '未读' : '' }}个人通知</div></section>

      <section v-if="activeSection === 'customers'" class="crm-panel table-panel"><p v-if="loading">正在加载…</p><table v-else-if="customers.length && customerFilters.view === 'table'"><thead><tr><th>客户编号</th><th>客户名称</th><th>类型</th><th>行业 / 区域</th><th>负责人</th><th>状态</th><th>最近跟进</th><th>商机金额汇总</th></tr></thead><tbody><tr v-for="item in customers" :key="item.id" @click="openCustomer(item.id)"><td>{{ item.customer_no }}</td><td>{{ item.name }}</td><td>{{ item.customer_type }}</td><td>{{ item.industry }} / {{ item.region }}</td><td>{{ ownerLabel(item.owner_user_id) }}</td><td>{{ customerStatusText(item.status) }}</td><td>{{ formatDate(item.last_followup_at) }}</td><td>{{ formatAmount(item.opportunity_amount_sum) }}</td></tr></tbody></table><div v-else-if="customers.length" class="crm-customer-cards" :data-quick-filter="customerFilters.quick_filter"><button v-for="item in customers" :key="item.id" :data-status="item.status" @click="openCustomer(item.id)"><strong>{{ item.name }}</strong><span>{{ item.customer_no }} · {{ customerStatusText(item.status) }}</span><span>{{ item.customer_type }} · {{ item.industry }} / {{ item.region }}</span><span>负责人：{{ ownerLabel(item.owner_user_id) }}</span><span>最近跟进：{{ formatDate(item.last_followup_at) }}</span><span>商机金额汇总：{{ formatAmount(item.opportunity_amount_sum) }}</span></button></div><div v-else class="crm-empty">暂无符合条件的客户</div></section>
      <section v-if="activeSection === 'opportunities' && !boardMode" class="crm-panel table-panel"><p v-if="loading">正在加载…</p><table v-else-if="opportunities.length"><thead><tr><th>商机编号</th><th>名称</th><th>客户</th><th>预计金额</th><th>阶段</th><th>状态</th><th>已签约合同</th><th>终态待办</th></tr></thead><tbody><tr v-for="item in opportunities" :key="item.id" @click="openOpportunity(item.id)"><td>{{ item.opportunity_no }}</td><td>{{ item.name }}</td><td>客户 #{{ item.customer_id }}</td><td>{{ formatAmount(item.expected_amount) }}</td><td>{{ item.current_stage }}</td><td>{{ opportunityStatusText(item.opp_status) }}</td><td>{{ formatSignedContractCount(item.signed_contract_count) }}</td><td>{{ terminalPendingText(item.terminal_pending_type) }}</td></tr></tbody></table><div v-else class="crm-empty">暂无符合条件的商机</div></section>
      <section v-if="activeSection === 'opportunities' && boardMode" class="crm-board crm-opportunity-board"><article v-for="column in board" :key="column.stage" class="crm-board-column" :data-stage="column.stage"><h2>{{ column.stage }} <small>{{ column.items?.length || 0 }}</small></h2><button v-for="item in column.items" :key="item.id" class="crm-board-card" @click="openOpportunity(item.id)"><strong>{{ item.name }}</strong><span>{{ item.opportunity_no }}</span><span>{{ formatAmount(item.expected_amount) }}</span><span>已签约合同 {{ formatSignedContractCount(item.signed_contract_count) }}</span></button></article></section>
      <section v-if="activeSection === 'opportunities'" class="crm-panel crm-stage-alerts"><div class="crm-panel-heading"><div><h2>阶段超时告警</h2><p class="crm-note">服务端个人列表当前返回已触发的未读/已读告警；待处理和已取消状态不会进入个人查询结果。</p></div><label class="check"><input v-model="stageAlertUnreadOnly" type="checkbox">仅看未读</label></div><p v-if="stageRuleForbidden" class="crm-alert error" role="alert">无阶段告警规则配置权限（403）；告警查询仍按现有权限执行。</p><div v-if="stageAlerts.length" class="crm-stage-alert-grid"><button v-for="item in stageAlerts" :key="item.id" @click="selectedStageAlert = item"><strong>{{ item.opportunity_no }}</strong><span>{{ item.stage }} · {{ stageAlertStatusText(item.status) }}</span><small>应提醒 {{ formatDate(item.due_at) }}</small></button></div><div v-else class="crm-empty compact">暂无{{ stageAlertUnreadOnly ? '未读' : '' }}阶段超时告警</div><p class="crm-status-legend"><span>待处理：Worker 尚未投递</span><span>已触发：站内告警已生成</span><span>已取消：阶段、终态、作废或负责人变化后失效</span></p></section>
      <section v-if="activeSection === 'presale' && alerts.length" class="crm-panel crm-alert-list"><h2>未读预警</h2><p class="crm-note">个人预警仅合并当前登录用户和身份令牌中非空的 PMS 人员绑定，不随 SELF/ORG/ALL 数据范围扩大。</p><button v-for="item in alerts" :key="item.id" @click="readAlert(item)"><strong>{{ alertTypeText(item.alert_type) }}</strong><span>{{ item.request_no }} · 起算 {{ formatDate(item.basis_at) }} · 阈值 {{ formatDate(item.due_at) }}</span></button></section>
      <section v-if="activeSection === 'presale' && !presaleCreatePage"><section v-if="presaleView === 'list'" class="crm-panel table-panel"><h2>售前申请列表</h2><p class="crm-note">列表范围由角色决定；点击记录查看详情、工时和服务端允许的动作。</p><table v-if="presales.length"><thead><tr><th>申请编号</th><th>商机</th><th>申请人</th><th>状态</th><th>场地 / 紧急度</th><th>执行人</th><th>累计工时</th><th>PMS 异常</th><th>期望结束</th><th>超时</th></tr></thead><tbody><tr v-for="item in presales" :key="item.id" @click="openPresale(item.id)"><td>{{ item.request_no }}</td><td>{{ item.opportunity_no }}</td><td>{{ item.applicant_name || item.applicant_id }}</td><td>{{ requestStatusText(item.status) }}</td><td>{{ venueText(item.venue) }} / {{ urgencyText(item.urgency) }}</td><td>{{ assignees(item.current_assignees) }}</td><td>{{ item.total_work_hours }} 小时</td><td>{{ item.push_exception_count }}</td><td>{{ formatDate(item.expected_end) }}</td><td>{{ item.overdue ? '已超时' : '否' }}</td></tr></tbody></table><div v-else class="crm-empty">暂无可见申请</div><div class="crm-actions"><button type="button" :disabled="presalePage.number <= 1 || loading" @click="changePresalePage(presalePage.number - 1)">上一页</button><span>第 {{ presalePage.number }} 页，共 {{ presalePage.total }} 条</span><button type="button" :disabled="presalePage.number * presalePage.size >= presalePage.total || loading" @click="changePresalePage(presalePage.number + 1)">下一页</button></div></section><section v-else class="crm-panel crm-presale-board-panel"><div class="crm-panel-heading"><div><h2>售前状态看板</h2><p class="crm-note">只读看板，不支持拖拽改状态。每列最多显示服务端返回的 {{ presaleColumnLimit }} 条，列总数不受截断影响。</p></div></div><div class="crm-board crm-presale-board"><article v-for="column in presaleBoard" :key="column.status" class="crm-board-column" :data-status="column.status"><h2>{{ requestStatusText(column.status) }} <small>{{ column.total }}</small></h2><button v-for="item in column.items" :key="item.id" type="button" class="crm-board-card" @click="openPresale(item.id)"><strong>{{ item.request_no }}</strong><span>{{ item.opportunity_no }}</span><span>{{ item.applicant_name || item.applicant_id }} · {{ urgencyText(item.urgency) }}</span><span>{{ assignees(item.current_assignees) }}</span><span>{{ item.total_work_hours }} 小时 · {{ item.overdue ? '已超时' : '未超时' }}</span></button><p v-if="Number(column.total) > (column.items?.length || 0)" class="crm-note">另有 {{ Number(column.total) - (column.items?.length || 0) }} 条未在本列展示</p><p v-else-if="!column.items?.length" class="crm-empty compact">暂无任务</p></article></div></section></section>
      <section v-if="activeSection === 'presale' && presaleCreatePage" class="crm-presale-create-page">
        <p class="crm-alert warning" role="status">请从当前账号可见的商机中选择；提交后进入两级审批流。现场支持必须填写服务地址。</p>
        <form id="presale-create-form" class="crm-panel crm-presale-create-form" @submit.prevent="submitPresaleFromList">
          <h2>售前技术支持申请</h2>
          <section class="crm-business-picker">
            <label>查找商机<input v-model.trim="presaleOpportunityKeyword" type="search" placeholder="商机编号或名称" @keyup.enter.prevent="loadPresaleOpportunityOptions"></label>
            <button type="button" :disabled="presaleOpportunityOptionsLoading" @click="loadPresaleOpportunityOptions">{{ presaleOpportunityOptionsLoading ? '查询中…' : '查询商机' }}</button>
            <label>关联商机<select v-model="presaleForm.opportunity_id" required :disabled="presaleOpportunityOptionsLoading || !presaleOpportunityOptions.length"><option value="" disabled>请选择商机</option><option v-for="opportunity in presaleOpportunityOptions" :key="opportunity.id" :value="String(opportunity.id)">{{ opportunity.name }}（{{ opportunity.opportunity_no }}）</option></select></label>
            <small v-if="presaleOpportunityOptionsError" class="crm-alert error" role="alert">{{ presaleOpportunityOptionsError }}</small><small v-else-if="!presaleOpportunityOptionsLoading && !presaleOpportunityOptions.length" class="crm-note">暂无可关联商机。</small><small v-else-if="presaleOpportunityOptionsTotal > presaleOpportunityOptions.length" class="crm-note">当前显示前 {{ presaleOpportunityOptions.length }} 条，请按编号或名称缩小范围。</small>
          </section>
          <div class="crm-presale-form-row"><label>支持方式<select v-model="presaleForm.venue"><option value="REMOTE">远程</option><option value="ONSITE">现场</option></select></label><label>紧急程度<select v-model="presaleForm.urgency"><option value="NORMAL">普通</option><option value="URGENT">紧急</option></select></label></div><label v-if="presaleForm.venue === 'ONSITE'">服务地址<input v-model.trim="presaleForm.service_address" required maxlength="500" placeholder="客户现场详细地址"></label><div class="crm-presale-form-row"><label>联系人<input v-model.trim="presaleForm.contact_name" required maxlength="100" placeholder="客户对接人姓名 / 部门"></label><label>联系电话<input v-model.trim="presaleForm.contact_phone" required maxlength="64" placeholder="客户对接人联系电话"></label></div><label>需求说明<textarea v-model.trim="presaleForm.description" minlength="10" maxlength="2000" required placeholder="请描述售前支持需求与背景"></textarea></label><div class="crm-presale-form-row"><label>预计开始<input v-model="presaleForm.expected_start" type="datetime-local" required></label><label>预计结束<input v-model="presaleForm.expected_end" type="datetime-local" required></label></div><div class="crm-actions"><button type="button" :disabled="presaleCreateLoading" @click="closePresaleCreatePage">取消</button><button class="primary" :disabled="presaleCreateLoading || !presaleForm.opportunity_id">{{ presaleCreateLoading ? '提交中…' : '提交申请' }}</button></div>
        </form>
      </section>
      </section>
    </main>
    <div v-if="showAlertConfig" class="console-modal-backdrop" role="presentation" @click.self="showAlertConfig = false">
      <section class="console-detail-modal crm-alert-rules-dialog" role="dialog" aria-modal="true" aria-label="售前预警规则">
        <header>
          <div><p class="console-modal-eyebrow">售前技术支持</p><h2>售前预警规则</h2></div>
          <button class="console-modal-close" type="button" aria-label="关闭售前预警规则" @click="showAlertConfig = false"><ConsoleIcon name="close" /></button>
        </header>
        <div class="crm-alert-rules-dialog__body">
          <p class="console-card-hint">单位为小时。每次保存都会生成新版本，并且只影响后续扫描。</p>
          <div class="console-setting-list">
            <article v-for="rule in alertRules" :key="rule.type" class="console-setting-row crm-alert-rule">
              <div class="crm-alert-rule__identity"><strong>{{ alertTypeText(rule.type) }}</strong><p>版本 {{ rule.config_version }} · 更新于 {{ formatDate(rule.updated_at) }}</p></div>
              <label class="console-form-item crm-alert-rule__threshold"><span>阈值（小时）</span><input v-model.number="rule.threshold_hours" class="console-number-input" type="number" min="0" max="8760"></label>
              <div class="crm-alert-rule__switch"><span>启用规则</span><button :class="['console-switch', { on: rule.enabled }]" type="button" :aria-pressed="rule.enabled" :aria-label="`${alertTypeText(rule.type)}${rule.enabled ? '已启用' : '已停用'}`" @click="rule.enabled = !rule.enabled"><i></i></button></div>
              <button class="console-button primary small" type="button" @click="saveAlertRule(rule)">保存</button>
            </article>
          </div>
        </div>
        <footer><button class="console-button ghost" type="button" @click="showAlertConfig = false">关闭</button></footer>
      </section>
    </div>
    <div v-if="showStageAlertRules" class="crm-modal"><article class="crm-detail"><h2>商机阶段超时规则</h2><p class="crm-note">仅前五个推进阶段可配置，单位为小时。保存时提交数据版本用于并发控制；配置版本进入后续告警的幂等标识。</p><div v-for="rule in stageAlertRules" :key="rule.stage" class="crm-alert-rule"><strong>{{ rule.stage }}</strong><label>阈值（小时）<input v-model.number="rule.threshold_hours" type="number" min="1" max="8760"></label><label class="check"><input v-model="rule.enabled" type="checkbox">启用</label><span>配置版本 {{ rule.config_version }} · 数据版本 {{ rule.version }} · {{ formatDate(rule.updated_at) }}</span><button class="primary" @click="saveStageAlertRule(rule)">保存</button></div><div class="crm-actions"><button @click="showStageAlertRules = false">关闭</button></div></article></div>
    <div v-if="selectedStageAlert" class="crm-modal"><article><h2>阶段超时告警详情</h2><dl><dt>商机编号</dt><dd>{{ selectedStageAlert.opportunity_no }}</dd><dt>阶段</dt><dd>{{ selectedStageAlert.stage }}</dd><dt>状态</dt><dd>{{ stageAlertStatusText(selectedStageAlert.status) }}</dd><dt>阶段起算</dt><dd>{{ formatDate(selectedStageAlert.basis_at) }}</dd><dt>应提醒时间</dt><dd>{{ formatDate(selectedStageAlert.due_at) }}</dd><dt>阈值版本</dt><dd>{{ selectedStageAlert.threshold_version }}</dd><dt>触发时间</dt><dd>{{ formatDate(selectedStageAlert.sent_at) }}</dd><dt>已读时间</dt><dd>{{ formatDate(selectedStageAlert.read_at) }}</dd></dl><div class="crm-actions"><button @click="selectedStageAlert = null">关闭</button><button class="primary" @click="openStageAlertOpportunity(selectedStageAlert)">{{ selectedStageAlert.status === 'UNREAD' ? '标为已读并打开商机' : '打开商机' }}</button></div></article></div>
    <div v-if="showReport" class="console-modal-backdrop" role="presentation" @click.self="showReport = false">
      <article class="console-detail-modal crm-report-dialog" role="dialog" aria-modal="true" aria-label="售前投入报表">
        <header>
          <div><p class="console-modal-eyebrow">售前技术支持</p><h2>售前投入报表</h2></div>
          <button class="console-modal-close" type="button" aria-label="关闭售前投入报表" @click="showReport = false"><ConsoleIcon name="close" /></button>
        </header>
        <div class="crm-report-dialog__body">
          <p class="console-card-hint">全部工时为标准小时；时间筛选发送 RFC3339 并由服务端统一换算为 UTC 半开区间。成功率字段单位为百分比。</p>
          <form class="console-form-grid crm-report-filters" @submit.prevent="loadReports">
            <label class="console-form-item"><span>开始时间 *</span><input v-model="reportFilters.from" type="datetime-local" required></label>
            <label class="console-form-item"><span>结束时间 *</span><input v-model="reportFilters.to" type="datetime-local" required></label>
            <label class="console-form-item"><span>归属组织</span><select v-model="reportFilters.organization_id" :disabled="reportFilterOptionsLoading"><option value="">全部可见组织</option><option v-for="organization in reportOrganizationOptions" :key="organization.organization_id" :value="organization.organization_id">{{ organization.organization_name }}</option></select></label>
            <label class="console-form-item"><span>参与人员</span><select v-model="reportFilters.person_id" :disabled="reportFilterOptionsLoading"><option value="">全部可见人员</option><option v-for="item in presaleFilterOptions.assignees" :key="item.value" :value="item.value">{{ item.label || item.value }}</option></select></label>
            <label class="console-form-item"><span>关联商机</span><select v-model="reportFilters.opportunity_id" :disabled="reportFilterOptionsLoading"><option value="">全部可见商机</option><option v-for="item in presaleFilterOptions.opportunities" :key="item.value" :value="String(item.value)">{{ item.label }}</option></select></label>
            <label class="console-form-item"><span>分布维度</span><select v-model="reportFilters.dimension"><option value="PERSON">人员</option><option value="DEPARTMENT">部门</option><option value="OPPORTUNITY">商机</option></select></label>
            <div class="crm-report-filter-actions"><button class="console-button primary" type="submit" :disabled="reportLoading">{{ reportLoading ? '加载中…' : '查询' }}</button><button class="console-button ghost" type="button" @click="exportReport">导出</button></div>
          </form>
          <p v-if="reportFilterOptionsError" class="crm-alert error" role="alert">{{ reportFilterOptionsError }} 请关闭报表后重试；不会退回为手填 ID。</p>
          <div v-if="reportSummary" class="crm-kpis"><div><span>投入小时</span><strong>{{ reportSummary.work_hours }}</strong></div><div><span>参与人数</span><strong>{{ reportSummary.participant_count }}</strong></div><div><span>自动完成任务</span><strong>{{ reportSummary.auto_completed_task_count }}</strong></div><div><span>商机覆盖率</span><strong>{{ reportSummary.opportunity_coverage_rate_percent }}%</strong><small>{{ reportSummary.covered_opportunity_count }} / {{ reportSummary.active_opportunity_count }}</small></div><div><span>PMS 最终成功率</span><strong>{{ reportSummary.pms_success_rate_percent }}%</strong><small>{{ reportSummary.pms_success_count }} / {{ reportSummary.pms_outbox_worklog_count }}</small></div></div>
          <section class="crm-report-chart"><h3>投入分布</h3><div v-for="item in reportDistribution" :key="item.dimension_id" class="crm-report-bar"><span>{{ item.dimension_name }}</span><i :style="{ width: reportBarWidth(item.work_hours) }"></i><strong>{{ item.work_hours }} 小时</strong></div><p v-if="!reportDistribution.length" class="crm-note">当前筛选没有投入记录。</p></section>
          <section class="crm-report-table-section"><h3>趋势数值表（UTC 日）</h3><div class="console-table-card"><div class="console-table-scroll"><table class="console-data-table crm-report-table"><thead><tr><th>日期</th><th>工时</th><th>参与人数</th><th>工时记录</th></tr></thead><tbody><tr v-for="item in reportTrend" :key="item.date"><td>{{ item.date }}</td><td>{{ item.work_hours }}</td><td>{{ item.participant_count }}</td><td>{{ item.worklog_count }}</td></tr></tbody></table></div></div></section>
          <section class="crm-report-table-section"><h3>分布数值表</h3><div class="console-table-card"><div class="console-table-scroll"><table class="console-data-table crm-report-table"><thead><tr><th>维度</th><th>部门</th><th>工时</th><th>人数</th><th>任务</th><th>工时记录</th></tr></thead><tbody><tr v-for="item in reportDistribution" :key="`row-${item.dimension_id}`"><td>{{ item.dimension_name }}</td><td>{{ item.department || '—' }}</td><td>{{ item.work_hours }}</td><td>{{ item.participant_count }}</td><td>{{ item.request_count }}</td><td>{{ item.worklog_count }}</td></tr></tbody></table></div></div></section>
        </div>
        <footer><button class="console-button ghost" type="button" @click="showReport = false">关闭</button></footer>
      </article>
    </div>

    <div v-if="customerDialog" class="console-modal-backdrop" :class="{ nested: !!selectedCustomer }" role="presentation" @click.self="closeCustomerDialog">
      <form class="console-detail-modal crm-customer-dialog" role="dialog" aria-modal="true" :aria-label="customerEditMode ? '编辑客户' : '新建客户'" @submit.prevent="submitCustomer">
        <header>
          <div>
            <p class="console-modal-eyebrow">客户档案</p>
            <h2>{{ customerEditMode ? '编辑客户' : '新建客户' }}</h2>
          </div>
          <button class="console-modal-close" type="button" aria-label="关闭" @click="closeCustomerDialog"><ConsoleIcon name="close" /></button>
        </header>
        <div class="console-form-grid crm-customer-dialog__body">
          <label class="console-form-item"><span>客户名称 *</span><input v-model="customerForm.name" required autocomplete="off" placeholder="请输入客户名称"></label>
          <label class="console-form-item"><span>统一社会信用代码</span><input v-model="customerForm.unified_credit_code" :placeholder="customerEditMode ? '留空表示保持原值' : '选填'" autocomplete="off"></label>
          <label class="console-form-item"><span>客户类型 *</span><input v-model="customerForm.customer_type" required autocomplete="off" placeholder="例如 业主 / 三方"></label>
          <label class="console-form-item"><span>行业 *</span><select v-model="customerForm.industry" required><option value="" disabled>请选择行业</option><option v-if="customerForm.industry && !customerIndustryOptions.includes(customerForm.industry)" :value="customerForm.industry">{{ customerForm.industry }}（历史值）</option><option v-for="industry in customerIndustryOptions" :key="industry" :value="industry">{{ industry }}</option></select></label>
          <label class="console-form-item"><span>区域 *</span><input v-model="customerForm.region" required autocomplete="off" placeholder="例如 华南"></label>
          <div v-if="customerEditMode" class="console-form-item full"><OwnerSelector v-model:user-id="customerForm.owner_user_id" v-model:organization-id="customerForm.owner_org_id" :default-user-id="crmSession?.user_id || ''" :default-organization-id="crmSession?.primary_org_id || ''" /></div>
          <section v-for="(contact, index) in customerForm.contacts" :key="contact.id || index" class="crm-customer-contacts">
            <div class="crm-customer-contact-heading">
              <h3>联系人 {{ index + 1 }}</h3>
              <button class="console-button danger small" type="button" :disabled="customerForm.contacts.length <= 1" :title="customerForm.contacts.length <= 1 ? '至少保留一个联系人' : '删除此联系人'" @click="removeCustomerContact(index)">删除联系人</button>
            </div>
            <div class="console-form-grid">
              <label class="console-form-item"><span>姓名 *</span><input v-model="contact.name" required autocomplete="off"></label>
              <label class="console-form-item"><span>电话 *</span><input v-model="contact.phone" :required="!contact.id" :placeholder="contact.id ? '留空表示保持原值' : ''" autocomplete="off"></label>
              <label class="console-form-item"><span>邮箱</span><input v-model="contact.email" type="email" :placeholder="contact.id ? '留空表示保持原值' : ''" autocomplete="off"></label>
              <label class="console-form-item crm-check-item"><span>门户登记联系人</span><input v-model="contact.is_registration" type="checkbox"></label>
            </div>
          </section>
          <button class="console-button ghost" type="button" @click="addCustomerContact">添加联系人</button>
          <label class="console-form-item full"><span>{{ customerEditMode ? '更新原因' : '创建原因' }} *</span><textarea v-model="customerForm.reason" required maxlength="500" rows="3" placeholder="说明本次创建/更新客户的原因"></textarea></label>
          <label class="console-form-item full crm-check-item"><span>授权覆盖名称查重</span><input v-model="customerForm.duplicate_override" type="checkbox"></label>
          <label v-if="customerForm.duplicate_override" class="console-form-item full"><span>覆盖原因 *</span><textarea v-model="customerForm.duplicate_override_reason" required maxlength="500" rows="2" placeholder="说明为什么允许与疑似重复客户并存"></textarea></label>
        </div>
        <footer>
          <button class="console-button ghost" type="button" :disabled="actionLoading" @click="closeCustomerDialog">取消</button>
          <button class="console-button primary" type="submit" :disabled="actionLoading">{{ actionLoading ? '保存中…' : '保存' }}</button>
        </footer>
      </form>
    </div>
    <div v-if="customerImportDialog" class="crm-modal" role="dialog" aria-modal="true"><form class="crm-import-wizard" @submit.prevent="previewImport"><h2>客户 Excel 导入</h2><p class="crm-note">第一步：上传 .xlsx 后由服务端先执行病毒扫描，再进行固定表头和逐行预检。浏览器不会读取 Excel 内容，也不会保存文件或敏感字段。</p><template v-if="!customerImportPreview"><label>Excel 文件<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required @change="selectCustomerImportFile"></label><label>导入原因<textarea v-model.trim="customerImportForm.reason" required maxlength="500"></textarea></label><div class="crm-actions"><button type="button" @click="closeCustomerImport">取消</button><button class="primary" :disabled="actionLoading || !customerImportForm.file || !customerImportForm.reason">{{ actionLoading ? '服务端扫描与预检中…' : '上传并预检' }}</button></div></template><template v-else><h3>第二步：服务端预检结果</h3><dl class="crm-import-summary"><dt>任务号</dt><dd>{{ customerImportPreview.job_no }}</dd><dt>状态</dt><dd>{{ customerImportPreview.status }}</dd><dt>总行数</dt><dd>{{ customerImportPreview.total_rows }}</dd><dt>可导入</dt><dd>{{ customerImportPreview.importable_rows }}</dd><dt>警告</dt><dd>{{ customerImportPreview.warning_rows }}</dd><dt>错误</dt><dd>{{ customerImportPreview.error_rows }}</dd><dt>预检过期时间</dt><dd>{{ formatDate(customerImportPreview.expires_at) }}</dd></dl><p class="crm-note">警告行和错误行本次均跳过；只有状态为“可导入”的行会提交。下表的信用代码、电话和邮箱均为服务端返回的脱敏值。</p><table v-if="customerImportPreview.rows?.length"><thead><tr><th>行号</th><th>状态</th><th>客户</th><th>信用代码（脱敏）</th><th>联系人</th><th>联系方式（脱敏）</th><th>问题</th></tr></thead><tbody><tr v-for="row in customerImportPreview.rows" :key="row.row_no"><td>{{ row.row_no }}</td><td>{{ importRowStatusText(row.status) }}</td><td>{{ row.name || '—' }}<br>{{ row.customer_type || '—' }} · {{ row.industry || '—' }} · {{ row.region || '—' }}</td><td>{{ row.unified_credit_code || '—' }}</td><td>{{ row.contact_name || '—' }}</td><td>{{ row.contact_phone || '—' }}<br>{{ row.contact_email || '—' }}</td><td><span v-if="!row.issues?.length">—</span><ul v-else><li v-for="issue in row.issues" :key="`${issue.column}-${issue.code}`">{{ issue.column }} · {{ issue.code }} · {{ issue.message }}</li></ul></td></tr></tbody></table><template v-if="!customerImportResult"><div class="crm-actions"><button type="button" @click="resetCustomerImportPreview">重新上传</button><button type="button" @click="downloadImportErrors">下载错误报告 CSV</button><button type="button" class="primary" :disabled="actionLoading || Number(customerImportPreview.importable_rows) === 0" @click="commitImport">{{ actionLoading ? '提交中…' : '第三步：确认导入可导入行' }}</button></div></template><template v-else><h3>第三步：导入结果</h3><dl class="crm-import-summary"><dt>状态</dt><dd>{{ customerImportResult.status }}</dd><dt>总行数</dt><dd>{{ customerImportResult.total_rows }}</dd><dt>成功</dt><dd>{{ customerImportResult.succeeded_rows }}</dd><dt>失败</dt><dd>{{ customerImportResult.failed_rows }}</dd><dt>跳过</dt><dd>{{ customerImportResult.skipped_rows }}</dd><dt>完成时间</dt><dd>{{ formatDate(customerImportResult.completed_at) }}</dd></dl><table v-if="customerImportResult.rows?.length"><thead><tr><th>行号</th><th>结果</th><th>客户编号</th><th>错误码</th><th>说明</th></tr></thead><tbody><tr v-for="row in customerImportResult.rows" :key="row.row_no"><td>{{ row.row_no }}</td><td>{{ importRowStatusText(row.status) }}</td><td>{{ row.customer_no || '—' }}</td><td>{{ row.error_code || '—' }}</td><td>{{ row.message || '—' }}</td></tr></tbody></table><div class="crm-actions"><button type="button" @click="downloadImportErrors">下载错误报告 CSV</button><button type="button" class="primary" @click="closeCustomerImport">完成</button></div></template></template></form></div>
    <div v-if="opportunityDialog" class="console-modal-backdrop" :class="{ nested: !!selectedOpportunity }" role="presentation" @click.self="closeOpportunityDialog">
      <form class="console-detail-modal crm-opportunity-dialog" role="dialog" aria-modal="true" :aria-label="opportunityEditMode ? '编辑商机' : '新建商机'" @submit.prevent="submitOpportunity">
        <header>
          <div><p class="console-modal-eyebrow">商机档案</p><h2>{{ opportunityEditMode ? '编辑商机' : '新建商机' }}</h2></div>
          <button class="console-modal-close" type="button" aria-label="关闭商机表单" @click="closeOpportunityDialog"><ConsoleIcon name="close" /></button>
        </header>
        <div class="console-form-grid crm-opportunity-dialog__body">
          <label class="console-form-item"><span>商机名称 *</span><input v-model="opportunityForm.name" required autocomplete="off" placeholder="请输入商机名称"></label>
          <label v-if="opportunityEditMode" class="console-form-item"><span>关联客户</span><input :value="opportunityForm.customer_id" readonly disabled></label>
          <div v-else class="console-form-item full crm-opportunity-customer-picker">
            <span>关联客户 *</span>
            <div class="crm-opportunity-customer-search"><input v-model.trim="opportunityCustomerKeyword" type="search" autocomplete="off" placeholder="按客户号或名称查询" @keyup.enter.prevent="loadOpportunityCustomerOptions"><button class="console-button ghost" type="button" :disabled="opportunityCustomerOptionsLoading" @click="loadOpportunityCustomerOptions">{{ opportunityCustomerOptionsLoading ? '查询中…' : '查询客户' }}</button></div>
            <select v-model="opportunityForm.customer_id" required :disabled="opportunityCustomerOptionsLoading || !opportunityCustomerOptions.length"><option value="" disabled>{{ opportunityCustomerOptionsLoading ? '正在加载客户…' : '请选择客户' }}</option><option v-for="customer in opportunityCustomerOptions" :key="customer.id" :value="String(customer.id)">{{ customer.name }}（{{ customer.customer_no }}）· {{ customer.industry }} / {{ customer.region }}</option></select>
            <small v-if="opportunityCustomerOptionsError" class="crm-alert error" role="alert">{{ opportunityCustomerOptionsError }}</small><small v-else-if="!opportunityCustomerOptionsLoading && !opportunityCustomerOptions.length" class="crm-note">暂无符合条件的有效客户，请先在客户管理中创建客户。</small><small v-else-if="opportunityCustomerOptionsTotal > opportunityCustomerOptions.length" class="crm-note">当前显示前 {{ opportunityCustomerOptions.length }} 条，请输入关键词缩小范围。</small>
          </div>
          <label class="console-form-item"><span>商机类型 *</span><input v-model="opportunityForm.type" required autocomplete="off" placeholder="请输入商机类型"></label>
          <label class="console-form-item"><span>来源 *</span><input v-model="opportunityForm.source" required autocomplete="off" placeholder="请输入商机来源"></label>
          <label class="console-form-item"><span>预计金额 *</span><input v-model="opportunityForm.expected_amount" required inputmode="decimal" autocomplete="off" placeholder="请输入预计金额"></label>
          <label class="console-form-item"><span>预计签单日期 *</span><input v-model="opportunityForm.expected_sign_date" type="date" required></label>
          <label class="console-form-item full"><span>需求摘要 *</span><textarea v-model="opportunityForm.requirement_summary" required rows="3" placeholder="请概述客户需求和项目范围"></textarea></label>
          <label class="console-form-item"><span>系统数量</span><input v-model.number="opportunityForm.system_count" type="number" min="0" placeholder="0"></label>
          <label class="console-form-item full"><span>客户痛点</span><textarea v-model="opportunityForm.pain_points" rows="3" placeholder="选填"></textarea></label>
          <label class="console-form-item full"><span>竞争信息</span><textarea v-model="opportunityForm.competitor_info" rows="3" placeholder="选填"></textarea></label>
          <fieldset v-if="opportunityEditMode" class="crm-owner-selector crm-opportunity-owner" disabled><legend>负责人</legend><div class="console-form-grid"><label class="console-form-item"><span>负责人用户</span><input :value="opportunityForm.owner_user_id" readonly></label><label class="console-form-item"><span>负责人组织</span><input :value="opportunityForm.owner_org_id" readonly></label></div><p class="crm-note">商机主档编辑不变更负责人，请使用详情中的“变更负责人”。</p></fieldset>
          <label v-if="opportunityEditMode" class="console-form-item full"><span>更新原因 *</span><textarea v-model="opportunityForm.reason" required maxlength="500" rows="3" placeholder="请说明本次更新原因"></textarea></label>
        </div>
        <footer><button class="console-button ghost" type="button" :disabled="actionLoading" @click="closeOpportunityDialog">取消</button><button class="console-button primary" type="submit" :disabled="actionLoading">{{ actionLoading ? '提交中…' : opportunityEditMode ? '保存' : '创建' }}</button></footer>
      </form>
    </div>
    <div v-if="selectedCustomer" class="crm-modal">
<article class="crm-detail">
<h2>{{ selectedCustomer.name }}</h2>
<nav class="crm-customer-tabs" aria-label="客户详情页签">
<button :class="{ active: customerTab === 'basic' }" @click="openCustomerTab('basic')">基本信息</button>
<button :class="{ active: customerTab === 'contacts' }" @click="openCustomerTab('contacts')">联系人</button>
<button :class="{ active: customerTab === 'stakeholders' }" @click="openCustomerTab('stakeholders')">关键干系人</button>
<button :class="{ active: customerTab === 'systems' }" @click="openCustomerTab('systems')">信息系统</button>
<button :class="{ active: customerTab === 'opportunities' }" @click="openCustomerTab('opportunities')">商机历史</button>
<button :class="{ active: customerTab === 'projects' }" @click="openCustomerTab('projects')">项目历史</button>
<button :class="{ active: customerTab === 'followups' }" @click="openCustomerTab('followups')">沟通记录</button>
<button v-if="canViewPortalAccess" :class="{ active: customerTab === 'portal' }" :title="portalModuleAvailable ? '' : '开通和禁用动作当前不可用，历史状态仍可查看'" @click="openCustomerTab('portal')">门户访问{{ portalModuleAvailable ? '' : '（操作已关闭）' }}</button>
<button v-if="canReadCustomerAudit" :class="{ active: customerTab === 'audit' }" @click="openCustomerTab('audit')">操作日志</button>
</nav>
<p v-if="customerTabLoading">正在加载页签…</p>
<p v-if="customerTabErrors[customerTab]" class="crm-alert error" role="alert">{{ customerTabErrors[customerTab] }}</p>
<dl v-if="customerTab === 'basic'">
<dt>客户编号</dt>
<dd>{{ selectedCustomer.customer_no }}</dd>
<dt>状态</dt>
<dd>{{ customerStatusText(selectedCustomer.status) }}</dd>
<template v-if="selectedCustomer.status === 'MERGED'">
<dt>存续客户 ID</dt>
<dd>客户 #{{ selectedCustomer.merged_into_id }}</dd>
<dt>合并日期</dt>
<dd>{{ selectedCustomer.end_date || '—' }}</dd>
</template>
<dt>类型</dt>
<dd>{{ selectedCustomer.customer_type }}</dd>
<dt>行业 / 区域</dt>
<dd>{{ selectedCustomer.industry }} / {{ selectedCustomer.region }}</dd>
<dt>负责人</dt>
<dd>{{ ownerLabel(selectedCustomer.owner_user_id) }}</dd>
<dt>版本</dt>
<dd>{{ selectedCustomer.version }}</dd>
</dl>
<section v-if="customerTab === 'portal'" class="crm-portal-access" aria-labelledby="portal-access-heading">
<div class="crm-subsection-heading"><div><h3 id="portal-access-heading">门户访问</h3><p class="crm-note">客户通过统一身份平台 OIDC 登录。CRM 不创建、展示或传递固定密码。</p></div></div>
<dl>
<dt>登记联系人</dt><dd>{{ canReadPortalInvite ? (currentPortalInvite?.contact_summary || portalRegistrationContact?.name || '未配置') : '当前权限不可查看邀请信息' }}</dd>
<dt>平台身份</dt><dd>{{ canReadPortalInvite ? (currentPortalInvite?.identity_summary || '尚未预置或状态不可用') : '当前权限不可查看邀请信息' }}</dd>
<dt>登录账号</dt><dd>{{ canReadPortalInvite ? (currentPortalInvite?.login_account || '尚未预置') : '当前权限不可查看邀请信息' }}</dd>
<dt>访问状态</dt><dd>{{ canReadPortalAccessStatus ? (({ NOT_PROVISIONED: '未开通', PENDING: '待激活', ACTIVE: '可访问', USED: '可访问', DISABLED: '已禁用' })[portalAccessStatus?.access_status] || portalAccessStatus?.access_status || '未知') : '当前权限不可查看' }}</dd>
<dt>邀请状态</dt><dd>{{ canReadPortalInvite ? portalInviteStatusText(currentPortalInvite?.status) : '当前权限不可查看' }}</dd>
<template v-if="portalAccessStatus?.operation_no"><dt>禁用操作</dt><dd>{{ portalAccessStatus.operation_no }} · {{ portalAccessStatus.operation_status }} / {{ portalAccessStatus.operation_stage }}</dd><dt v-if="portalAccessStatus.last_error_code">恢复状态</dt><dd v-if="portalAccessStatus.last_error_code">{{ portalAccessStatus.last_error_code }} · {{ portalAccessStatus.last_error_summary }}<span v-if="portalAccessStatus.next_retry_at"> · 下次自动重试 {{ formatDate(portalAccessStatus.next_retry_at) }}</span></dd></template>
<template v-if="currentPortalInvite"><dt>邀请编号</dt><dd>{{ currentPortalInvite.invite_no }}</dd><dt>过期时间</dt><dd>{{ formatDate(currentPortalInvite.expires_at) }}</dd><dt>使用时间</dt><dd>{{ formatDate(currentPortalInvite.used_at) }}</dd><dt>撤销时间</dt><dd>{{ formatDate(currentPortalInvite.revoked_at) }}</dd></template>
</dl>
<div v-if="portalActivationURL" class="crm-portal-invite-link">
<label>本次生成的一次性邀请链接<input :value="portalActivationURL" readonly autocomplete="off" @focus="$event.target.select()"></label>
<p class="crm-note">链接只在本页面生命周期内显示；关闭或刷新后不会从服务端重新取回。点击链接后通过统一身份平台登录。</p>
<button type="button" :disabled="portalInviteCopied" @click="copyPortalActivationURL">{{ portalInviteCopied ? '已复制' : '复制一次' }}</button>
</div>
<p v-else class="crm-note">服务端不会在状态查询中返回历史明文链接；需要新链接时请重发邀请。</p>
<div class="crm-actions">
<button v-if="canProvisionPortalAccount && selectedCustomer.status === 'ACTIVE' && canGeneratePortalInvite" type="button" class="primary" :disabled="!portalProvisionAvailable || portalInviteLoading || !portalRegistrationContact" @click="generatePortalInvite">{{ portalInviteLoading ? '处理中…' : currentPortalInvite?.status === 'PENDING' ? '重发邀请' : '预置并生成邀请' }}</button>
</div>
<form v-if="canRevokePortalAccount && currentPortalInvite?.status === 'PENDING'" class="crm-inline-form" @submit.prevent="revokeCurrentPortalInvite"><label>撤销原因<textarea v-model.trim="portalInviteRevokeReason" required maxlength="500"></textarea></label><button class="danger" :disabled="portalInviteLoading || !portalInviteRevokeReason.trim()">撤销邀请</button></form>
<form v-if="canDisablePortalAccount && portalAccessStatus?.access_status !== 'NOT_PROVISIONED' && portalAccessStatus?.access_status !== 'DISABLED'" class="crm-inline-form crm-danger-zone" @submit.prevent="disableCurrentPortalAccess"><h4>禁用门户访问（高风险）</h4><p class="crm-note">这不是“撤销邀请”：提交后会退出该身份的全部 Portal 会话、禁用客户映射并回收基础平台 Portal 角色。</p><label>禁用原因<textarea v-model.trim="portalAccessDisableReason" required maxlength="500"></textarea></label><button class="danger" :disabled="!portalDisableAvailable || portalAccessDisableLoading || !portalAccessDisableReason.trim()">{{ portalAccessDisableLoading ? '禁用中…' : '禁用门户访问' }}</button></form>
<p v-if="portalAccessStatus?.operation_status === 'DEAD_LETTER'" class="crm-alert error" role="alert">自动恢复已达到上限，请由运维按操作号对账后人工恢复；页面不会假报成功。</p>
</section>
<section v-if="customerTab === 'contacts' && !customerTabErrors.contacts">
<p v-if="!customerContacts.length">暂无联系人</p>
<div v-else class="crm-profile-list">
<article v-for="contact in customerContacts" :key="contact.id">
<strong>{{ contact.name }}</strong>
<span>{{ contact.phone || '—' }} · {{ contact.email || '—' }}</span>
<span>{{ contact.is_registration ? '门户登记联系人' : '普通联系人' }}</span>
</article>
</div>
</section>
<section v-if="customerTab === 'stakeholders' && !customerTabErrors.stakeholders">
<div class="crm-subsection-heading">
<div>
<h3>关键干系人</h3>
<p class="crm-note">电话和邮箱由服务端脱敏后展示。</p>
</div>
<button v-if="canUpdateCustomer && selectedCustomer.status === 'ACTIVE'" @click="openStakeholderEditor">维护干系人</button>
</div>
<p v-if="!customerStakeholders.length">暂无关键干系人</p>
<div v-else class="crm-profile-list">
<article v-for="item in customerStakeholders" :key="item.id">
<strong>{{ item.name }}</strong>
<span>{{ item.role_title }} · 影响力：{{ influenceText(item.influence) }}</span>
<span>{{ item.relationship_summary || '—' }}</span>
<span>{{ item.phone || '—' }} · {{ item.email || '—' }}</span>
</article>
</div>
</section>
<section v-if="customerTab === 'systems' && !customerTabErrors.systems">
<div class="crm-subsection-heading">
<div>
<h3>信息系统</h3>
<p class="crm-note">保护等级指网络安全等级保护定级，与客户信用评级无关。</p>
</div>
<button v-if="canUpdateCustomer && selectedCustomer.status === 'ACTIVE'" @click="openSystemEditor">维护信息系统</button>
</div>
<p v-if="!customerSystems.length">暂无信息系统</p>
<table v-else>
<thead>
<tr>
<th>系统名称</th>
<th>等保等级</th>
<th>应用场景</th>
<th>备案编号</th>
<th>定级日期</th>
<th>备案状态</th>
</tr>
</thead>
<tbody>
<tr v-for="item in customerSystems" :key="item.id">
<td>{{ item.name }}</td>
<td>{{ protectionLevelText(item.protection_level) }}</td>
<td>{{ item.application_scenario || '—' }}</td>
<td>{{ item.filing_no || '—' }}</td>
<td>{{ item.grading_date || '—' }}</td>
<td>{{ filingStatusText(item.filing_status) }}</td>
</tr>
</tbody>
</table>
</section>
<section v-if="customerTab === 'opportunities' && !customerTabErrors.opportunities">
<p v-if="!customerOpportunities.length">暂无商机历史</p>
<table v-else class="crm-light-table">
<thead>
<tr>
<th>商机编号</th>
<th>名称</th>
<th>金额</th>
<th>阶段 / 状态</th>
</tr>
</thead>
<tbody>
<tr v-for="item in customerOpportunities" :key="item.id">
<td>{{ item.opportunity_no }}</td>
<td>{{ item.name }}</td>
<td>{{ formatAmount(item.expected_amount) }}</td>
<td>{{ item.current_stage }} / {{ opportunityStatusText(item.opp_status) }}</td>
</tr>
</tbody>
</table>
</section>
<section v-if="customerTab === 'projects' && !customerTabErrors.projects">
<p class="crm-note">以下为 Portal 已持久化的项目同步快照，不代表项目上游实时状态；请结合源更新时间和本地同步时间判断新鲜度。</p>
<p v-if="customerProjectsLoading && !customerProjects.length" class="crm-note">正在加载项目历史…</p>
<p v-else-if="!customerProjects.length">暂无项目快照</p>
<table v-else>
<thead>
<tr>
<th>项目</th>
<th>合同号</th>
<th>阶段 / 状态</th>
<th>进度</th>
<th>预计结束</th>
<th>延期</th>
<th>快照新鲜度</th>
</tr>
</thead>
<tbody>
<tr v-for="item in customerProjects" :key="item.project_id">
<td>
<strong>{{ item.project_name }}</strong>
<br>
<small>{{ item.project_id }}</small>
</td>
<td>{{ item.contract_no || '—' }}</td>
<td>{{ item.current_stage || '—' }} / {{ projectStatusText(item.status) }}</td>
<td>{{ projectProgressText(item.progress_pct) }}</td>
<td>{{ formatDate(item.expected_end_date) }}</td>
<td>{{ item.delayed ? '已延期' : '否' }}</td>
<td>
<span :class="item.stale ? 'crm-project-stale' : ''">{{ !item.sync_last_success_at ? '同步链路尚无完整成功记录' : item.stale ? '同步链路可能已过期' : '同步链路有效期内' }}</span>
<br>
<small>源数据变更：{{ formatDate(item.source_updated_at) }}<br>本行写入：{{ formatDate(item.synced_at) }}<br>最近成功同步：{{ item.sync_last_success_at ? formatDate(item.sync_last_success_at) : '从未完整成功同步' }}<template v-if="item.staleness_seconds !== null && item.staleness_seconds !== undefined"><br>距最近成功：{{ item.staleness_seconds }} 秒</template></small>
</td>
</tr>
</tbody>
</table>
<div v-if="customerProjects.length" class="crm-actions">
<button type="button" :disabled="customerProjectsPage.number <= 1 || customerProjectsLoading" @click="loadCustomerProjectPage(customerProjectsPage.number - 1)">上一页</button>
<span>第 {{ customerProjectsPage.number }} 页，共 {{ customerProjectsPage.total }} 条</span>
<button type="button" :disabled="customerProjectsPage.number * customerProjectsPage.size >= customerProjectsPage.total || customerProjectsLoading" @click="loadCustomerProjectPage(customerProjectsPage.number + 1)">下一页</button>
</div>
</section>
<section v-if="customerTab === 'followups' && !customerTabErrors.followups">
<p v-if="!customerFollowups.length">暂无沟通记录</p>
<div v-else class="crm-profile-list">
<article v-for="item in customerFollowups" :key="item.id">
<strong>{{ item.type }} · {{ formatDate(item.followed_at) }}</strong>
<span>{{ item.content }}</span>
</article>
</div>
</section>
<section v-if="customerTab === 'audit' && !customerTabErrors.audit">
<p v-if="!customerAuditLogs.length">暂无操作日志</p>
<div v-else class="crm-profile-list">
<article v-for="item in customerAuditLogs" :key="item.id">
<strong>{{ item.operation }} · {{ formatDate(item.occurred_at) }}</strong>
<span>操作人：{{ ownerLabel(item.actor_id) }} · 结果：{{ item.result }}</span>
<span>{{ item.reason || '—' }}</span>
</article>
</div>
</section>
<div class="crm-actions">
<button @click="closeCustomerDetail">关闭</button>
<button v-if="selectedCustomer.status === 'ACTIVE'" @click="customerFollowupDialog = true">添加沟通</button>
<button v-if="selectedCustomer.status === 'ACTIVE'" @click="editCustomer">编辑</button>
<button v-if="selectedCustomer.status === 'ACTIVE'" @click="openCustomerMerge">合并客户</button>
<button v-if="selectedCustomer.status === 'ACTIVE'" class="danger" @click="changeCustomerStatus('void')">作废</button>
<button v-else-if="selectedCustomer.status === 'VOID'" class="primary" @click="changeCustomerStatus('restore')">恢复</button>
</div>
</article>
</div>
    <div v-if="customerMergeDialog && selectedCustomer" class="crm-modal nested"><form @submit.prevent="submitCustomerMerge"><h2>客户合并向导</h2><p class="crm-note">源客户：{{ selectedCustomer.name }}（{{ selectedCustomer.customer_no }}，版本 {{ selectedCustomer.version }}）。目标客户作为存续主档；提交后源客户进入 MERGED，本期不支持反合并。</p><section class="crm-business-picker"><label>查找目标客户<input v-model.trim="customerMergeKeyword" type="search" placeholder="客户编号或名称" @keyup.enter.prevent="loadCustomerMergeOptions"></label><button type="button" :disabled="customerMergeOptionsLoading" @click="loadCustomerMergeOptions">{{ customerMergeOptionsLoading ? '查询中…' : '查询客户' }}</button><label>目标客户<select v-model="customerMergeForm.target_customer_id" required :disabled="customerMergeOptionsLoading || !customerMergeOptions.length" @change="loadCustomerMergeTarget"><option value="" disabled>请选择存续客户</option><option v-for="customer in customerMergeOptions" :key="customer.id" :value="String(customer.id)">{{ customer.name }}（{{ customer.customer_no }}）· {{ customer.industry }} / {{ customer.region }}</option></select></label><small v-if="customerMergeOptionsError" class="crm-alert error" role="alert">{{ customerMergeOptionsError }}</small><small v-else-if="!customerMergeOptionsLoading && !customerMergeOptions.length" class="crm-note">没有其他可作为存续主档的有效客户。</small><small v-else-if="customerMergeOptionsTotal > customerMergeOptions.length" class="crm-note">当前显示前 {{ customerMergeOptions.length }} 条，请输入关键词缩小范围。</small></section><dl v-if="customerMergeForm.target" class="crm-merge-compare"><dt>目标名称</dt><dd>{{ customerMergeForm.target.name }}</dd><dt>目标编号</dt><dd>{{ customerMergeForm.target.customer_no }}</dd><dt>行业 / 区域</dt><dd>{{ customerMergeForm.target.industry }} / {{ customerMergeForm.target.region }}</dd><dt>负责人</dt><dd>{{ ownerLabel(customerMergeForm.target.owner_user_id) }}</dd><dt>目标版本</dt><dd>{{ customerMergeForm.target.version }}</dd></dl><p class="crm-note">服务端会迁移已确认的 CRM 联系人、沟通、无合同商机和邀请。存在 Portal 身份映射、待补偿的外部开通任务或已关联合同商机时会安全阻断，不会返回假成功。</p><label>合并原因<textarea v-model.trim="customerMergeForm.reason" required maxlength="500"></textarea></label><div class="crm-actions"><button type="button" @click="customerMergeDialog = false">取消</button><button class="danger" :disabled="actionLoading || !customerMergeForm.target">{{ actionLoading ? '合并中…' : '确认合并' }}</button></div></form></div>
    <div v-if="customerStakeholderDialog && selectedCustomer" class="crm-modal nested"><form class="crm-collection-editor" @submit.prevent="submitStakeholders"><h2>维护关键干系人</h2><p class="crm-note">这是全量清单；删除一项后保存会移除该干系人。现有电话/邮箱默认保留密文，勾选替换后才发送新值。</p><fieldset v-for="(item, index) in customerStakeholderForm.items" :key="item.id || `new-${index}`"><legend>干系人 {{ index + 1 }}</legend><label>姓名<input v-model.trim="item.name" required maxlength="100"></label><label>角色 / 职务<input v-model.trim="item.role_title" required maxlength="100"></label><label>影响力<select v-model="item.influence" required><option value="LOW">低</option><option value="MEDIUM">中</option><option value="HIGH">高</option></select></label><label>关系描述<textarea v-model.trim="item.relationship_summary" maxlength="500"></textarea></label><template v-if="item.id"><label class="check"><input v-model="item.replace_phone" type="checkbox">替换或清空电话（当前页面只显示脱敏值）</label><label v-if="item.replace_phone">新电话；留空表示清空<input v-model.trim="item.phone" maxlength="64"></label><label class="check"><input v-model="item.replace_email" type="checkbox">替换或清空邮箱（当前页面只显示脱敏值）</label><label v-if="item.replace_email">新邮箱；留空表示清空<input v-model.trim="item.email" type="email" maxlength="200"></label></template><template v-else><label>电话<input v-model.trim="item.phone" maxlength="64"></label><label>邮箱<input v-model.trim="item.email" type="email" maxlength="200"></label></template><button type="button" class="danger" @click="removeStakeholder(index)">移除</button></fieldset><button type="button" @click="addStakeholder">添加干系人</button><label>变更原因<textarea v-model.trim="customerStakeholderForm.reason" required maxlength="500"></textarea></label><div class="crm-actions"><button type="button" @click="customerStakeholderDialog = false">取消</button><button class="primary" :disabled="actionLoading">{{ actionLoading ? '保存中…' : '保存全量清单' }}</button></div></form></div>
    <div v-if="customerSystemDialog && selectedCustomer" class="crm-modal nested"><form class="crm-collection-editor" @submit.prevent="submitSystems"><h2>维护信息系统</h2><p class="crm-note">这是全量清单；保护等级是网络安全等级保护定级，不是客户信用等级。</p><fieldset v-for="(item, index) in customerSystemForm.items" :key="index"><legend>信息系统 {{ index + 1 }}</legend><label>系统名称<input v-model.trim="item.name" required maxlength="200"></label><label>等保等级<select v-model="item.protection_level" required><option value="LEVEL_1">一级</option><option value="LEVEL_2">二级</option><option value="LEVEL_3">三级</option><option value="LEVEL_4">四级</option><option value="LEVEL_5">五级</option></select></label><label>应用场景<textarea v-model.trim="item.application_scenario" maxlength="500"></textarea></label><label>备案编号<input v-model.trim="item.filing_no" maxlength="100"></label><label>定级日期<input v-model="item.grading_date" type="date"></label><label>备案状态<select v-model="item.filing_status" required><option value="NOT_FILED">未备案</option><option value="FILING">备案中</option><option value="FILED">已备案</option></select></label><button type="button" class="danger" @click="removeInformationSystem(index)">移除</button></fieldset><button type="button" @click="addInformationSystem">添加信息系统</button><label>变更原因<textarea v-model.trim="customerSystemForm.reason" required maxlength="500"></textarea></label><div class="crm-actions"><button type="button" @click="customerSystemDialog = false">取消</button><button class="primary" :disabled="actionLoading">{{ actionLoading ? '保存中…' : '保存全量清单' }}</button></div></form></div>
    <div v-if="selectedOpportunity" class="crm-modal"><article class="crm-detail crm-opportunity-detail"><h2>{{ selectedOpportunity.name }}</h2><div class="crm-opportunity-main"><dl><dt>商机编号</dt><dd>{{ selectedOpportunity.opportunity_no }}</dd><dt>负责人</dt><dd>{{ ownerLabel(selectedOpportunity.owner_user_id) }} / {{ selectedOpportunity.owner_org_id || '未填写组织' }}</dd><dt>当前阶段</dt><dd>{{ selectedOpportunity.current_stage }}</dd><dt>累计已签约合同</dt><dd>{{ formatSignedContractCount(selectedOpportunity.signed_contract_count) }}</dd><dt>状态</dt><dd>{{ opportunityStatusText(selectedOpportunity.opp_status) }}</dd><dt>终态待办</dt><dd>{{ selectedOpportunity.terminal_pending_type === 'CONTRACT' ? '待关联合同' : selectedOpportunity.terminal_pending_type === 'LOST_REASON' ? '待补失败原因' : '无' }}</dd><dt>需求摘要</dt><dd>{{ selectedOpportunity.requirement_summary }}</dd><dt>系统数量</dt><dd>{{ selectedOpportunity.system_count || 0 }}</dd><dt>客户痛点</dt><dd>{{ selectedOpportunity.pain_points || '—' }}</dd><dt>竞争信息</dt><dd>{{ selectedOpportunity.competitor_info || '—' }}</dd><dt>版本</dt><dd>{{ selectedOpportunity.version }}</dd></dl><section class="crm-opportunity-presale" aria-labelledby="opportunity-presale-heading"><div class="crm-panel-heading"><div><h3 id="opportunity-presale-heading">关联售前任务</h3><p class="crm-note">售前状态独立流转，不会自动修改商机阶段。</p></div><button v-if="canCreatePresale && selectedOpportunity.opp_status !== 'VOID'" type="button" class="console-button primary" aria-haspopup="dialog" :disabled="presaleCreateLoading" :title="presaleRequestSubmissionAvailable ? '为当前商机创建售前支持申请' : '可填写申请；售前投递 Worker 就绪后才能提交'" @click="openOpportunityPresaleCreate">发起售前支持</button></div><p v-if="opportunityPresaleLoading">正在加载关联售前任务…</p><div v-else-if="opportunityPresaleError" class="crm-alert error" role="alert">{{ opportunityPresaleError }} <button type="button" @click="loadOpportunityPresales()">重试</button></div><div v-else-if="!opportunityPresales.length" class="crm-empty compact">暂无关联售前任务</div><div v-else class="table-panel"><table><thead><tr><th>任务号 / 申请时间</th><th>状态 / 紧急度</th><th>场地</th><th>当前执行人</th><th>最新进度</th><th>累计小时</th><th>期望结束</th><th>超时</th><th>详情</th></tr></thead><tbody><tr v-for="item in opportunityPresales" :key="item.id"><td>{{ item.request_no }}<br><small>{{ formatDate(item.created_at) }}</small></td><td>{{ requestStatusText(item.status) }} / {{ urgencyText(item.urgency) }}</td><td>{{ venueText(item.venue) }}</td><td>{{ assignees(item.current_assignees) }}</td><td>{{ item.latest_progress || '—' }}</td><td>{{ item.total_work_hours }} 小时</td><td>{{ formatDate(item.expected_end) }}</td><td>{{ item.overdue ? '已超时' : '否' }}</td><td><button v-if="item.can_view_detail" type="button" @click="openOpportunityPresale(item)">查看详情</button><span v-else>仅摘要</span></td></tr></tbody></table><div class="crm-actions"><button type="button" :disabled="opportunityPresalePage.number <= 1 || opportunityPresaleLoading" @click="loadOpportunityPresales(opportunityPresalePage.number - 1)">上一页</button><span>第 {{ opportunityPresalePage.number }} 页，共 {{ opportunityPresalePage.total }} 条</span><button type="button" :disabled="opportunityPresalePage.number * opportunityPresalePage.size >= opportunityPresalePage.total || opportunityPresaleLoading" @click="loadOpportunityPresales(opportunityPresalePage.number + 1)">下一页</button><button v-if="opportunityPresalePage.total > opportunityPresalePage.size && opportunityPresalePage.size < 100" type="button" @click="viewAllOpportunityPresales">查看全部（最多 100 条）</button></div></div></section><h3>跟进记录</h3><p v-if="!followups.length">暂无记录</p><ol><li v-for="item in followups" :key="item.id"><strong>{{ item.type }}</strong> · {{ formatDate(item.followed_at) }}<br>{{ item.content }}</li></ol><h3>阶段历史</h3><ol><li v-for="item in stageHistory" :key="item.id">{{ item.from_stage }} → {{ item.to_stage }} · {{ formatDate(item.changed_at) }} · {{ item.reason }}</li></ol></div><div class="crm-opportunity-actions crm-actions"><button @click="selectedOpportunity = null">关闭</button><template v-if="selectedOpportunity.opp_status !== 'VOID'"><button @click="editOpportunity">编辑</button><button @click="openOwnerEditor">变更负责人</button><button v-if="canManageOpportunityTeam && opportunityTeamDirectoryAvailable" @click="openTeamEditor">维护团队</button><button @click="followupDialog = true">添加跟进</button><button class="primary" @click="stageDialog = true">调整阶段</button><button class="danger" @click="changeOpportunityStatus('void')">作废</button><button v-if="selectedOpportunity.terminal_pending_type && selectedOpportunity.terminal_pending_type !== 'NONE'" class="primary" @click="terminalDialog = true">补全终态待办</button></template><button v-else class="primary" @click="changeOpportunityStatus('restore')">恢复</button></div>
      <div v-if="selectedOpportunity" class="crm-opportunity-side-rail" aria-label="商机补充信息">
    <aside class="crm-opportunity-attachment-panel crm-opportunity-team-panel" aria-label="商机团队">
<h3>商机团队</h3><p class="crm-note">人员姓名与有效组织实时取自基础平台权威目录，平台用户 ID 仅作为稳定标识。</p><p v-if="!opportunityTeamDirectoryAvailable" class="crm-alert warning" role="status">基础平台人员目录暂不可用，当前仅展示稳定用户 ID；团队维护已安全关闭。</p><p v-if="!opportunityTeam.length">当前无辅助团队成员</p><ul class="crm-team-summary"><li v-for="member in opportunityTeam" :key="member.user_id"><strong>{{ member.display_name || member.user_id }}</strong>（{{ member.user_id }}） · {{ teamRoleText(member.role) }}<br><small>{{ teamMemberOrganizations(member) }}</small><em v-if="member.directory_status === 'NOT_AVAILABLE'">已停用或不再具有本应用授权</em></li></ul>
    </aside>
    <aside v-if="selectedOpportunity" class="crm-opportunity-attachment-panel" aria-label="商机团队任期明细">
      <h3>团队任期明细</h3>
      <p class="crm-note">每次加入、移出、重新加入和角色变化独立记录；“迁移快照”仅代表账本启用时观察到的状态，加入和移出时间未知，不推测更早历史。</p>
      <p v-if="opportunityMemberTermsLoading">正在加载任期明细…</p>
      <p v-else-if="opportunityMemberTermsError" class="crm-alert error" role="alert">{{ opportunityMemberTermsError }} <button type="button" @click="loadOpportunityMemberTerms()">重试</button></p>
      <p v-else-if="!opportunityMemberTerms.length">暂无任期明细</p>
      <template v-else>
        <table><thead><tr><th>成员</th><th>角色</th><th>开始 / 快照</th><th>结束</th><th>操作人</th><th>来源</th></tr></thead><tbody><tr v-for="term in opportunityMemberTerms" :key="term.id"><td>{{ ownerLabel(term.user_id) }}</td><td>{{ teamRoleText(term.role) }}</td><td>{{ term.source_kind === 'LEGACY_SNAPSHOT' ? `快照于 ${formatDate(term.snapshot_at)}` : formatDate(term.started_at) }}</td><td>{{ term.source_kind === 'LEGACY_SNAPSHOT' ? (term.ended_at ? formatDate(term.ended_at) : (term.active_at_snapshot ? '尚在团队' : '迁移前未知')) : formatDate(term.ended_at) }}</td><td>{{ term.source_kind === 'LEGACY_SNAPSHOT' ? '迁移程序观察' : term.started_by }}<template v-if="term.ended_by"> → {{ term.ended_by }}</template></td><td>{{ term.source_kind === 'LEGACY_SNAPSHOT' ? (term.active_at_snapshot ? '迁移快照（当时在组）' : '迁移快照（当时已移出）') : '完整记录' }}</td></tr></tbody></table>
        <div class="crm-actions"><button type="button" :disabled="opportunityMemberTermsPage.number <= 1 || opportunityMemberTermsLoading" @click="loadOpportunityMemberTerms(undefined, opportunityMemberTermsPage.number - 1)">上一页</button><span>第 {{ opportunityMemberTermsPage.number }} 页，共 {{ opportunityMemberTermsPage.total }} 条</span><button type="button" :disabled="opportunityMemberTermsPage.number * opportunityMemberTermsPage.size >= opportunityMemberTermsPage.total || opportunityMemberTermsLoading" @click="loadOpportunityMemberTerms(undefined, opportunityMemberTermsPage.number + 1)">下一页</button></div>
      </template>
    </aside>
    <aside v-if="selectedOpportunity && canReadOpportunityAttachments" class="crm-opportunity-attachment-panel" aria-label="商机可信附件">
      <h3>可信附件</h3>
      <p v-if="opportunityAttachmentLoading">正在加载附件状态…</p>
      <p v-if="opportunityAttachmentError" class="crm-alert error" role="alert">{{ opportunityAttachmentError }}</p>
      <p v-if="opportunityAttachmentCapabilities && !opportunityAttachmentCapabilities.upload_available" class="crm-note">当前未配置可信对象存储或病毒扫描，上传已安全关闭；系统不会把文件内容写入 CRM 数据库。</p>
      <ul v-if="opportunityAttachments.length" class="crm-attachment-list">
        <li v-for="item in opportunityAttachments" :key="item.id"><span><strong>{{ item.file_name }}</strong><br>{{ opportunityAttachmentStatusText(item.scan_status) }} · {{ item.size_bytes }} 字节</span><button type="button" :disabled="!canDownloadOpportunityAttachments || !opportunityAttachmentCapabilities?.download_available || item.scan_status !== 'CLEAN'" @click="downloadTrustedOpportunityAttachment(item)">下载</button></li>
      </ul>
      <p v-else-if="!opportunityAttachmentLoading" class="crm-note">暂无附件。</p>
      <div v-if="canUploadOpportunityAttachments" class="crm-attachment-upload">
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :disabled="!opportunityAttachmentCapabilities?.upload_available || opportunityAttachmentLoading" @change="selectOpportunityAttachment">
        <button type="button" :disabled="!opportunityAttachmentFile || !opportunityAttachmentCapabilities?.upload_available || opportunityAttachmentLoading" @click="uploadOpportunityAttachment">上传并扫描</button>
      </div>
    </aside>
    <aside class="crm-opportunity-external-panel" aria-label="外部报价投标状态">
      <h3>外部报价 / 投标</h3>
      <p v-if="opportunityExternalStatusLoading">正在加载外部状态…</p>
      <p v-else-if="opportunityExternalStatusError" class="crm-alert error" role="alert">{{ opportunityExternalStatusError }} <button type="button" @click="loadOpportunityExternalStatus()">重试</button></p>
      <dl v-else-if="opportunityExternalStatus">
        <dt>类型 / 单号</dt><dd>{{ opportunityExternalStatus.type }} / {{ opportunityExternalStatus.source_id }}</dd>
        <dt>状态</dt><dd>{{ opportunityExternalStatus.status }}</dd>
        <dt>来源金额</dt><dd>{{ opportunityExternalStatus.source_amount || '—' }}</dd>
        <dt>状态时间</dt><dd>{{ formatDate(opportunityExternalStatus.changed_at) }}</dd>
      </dl>
      <p v-else class="crm-note">暂无可信回调快照。报价和投标业务仍由来源系统负责。</p><p v-if="qbActiveQueryMode === 'CALLBACK_ONLY'" class="crm-note">当前为回调快照模式，未启用报价/投标主动查询；状态不会被伪装成实时查询结果。</p>
      <p v-if="opportunityQuoteAmountCheck?.status === 'MISMATCH' && opportunityQuoteAmountCheck.opportunity_version === selectedOpportunity.version" class="crm-alert warning" role="status">
        金额提示：商机预计金额 {{ opportunityQuoteAmountCheck.expected_amount }} 与最新仍有效的已通过报价
        {{ opportunityQuoteAmountCheck.approved_quote_amount }} 不一致（{{ opportunityQuoteAmountCheck.approved_quote_source_id }}）。
        本提示不阻断保存、签单或转合同。
      </p>
      <p v-else-if="opportunityQuoteAmountCheck?.status === 'APPROVED_QUOTE_AMOUNT_MISSING' && opportunityQuoteAmountCheck.opportunity_version === selectedOpportunity.version" class="crm-note">
        最新仍有效的已通过报价未携带金额，暂无法执行金额一致性判断；不会阻断业务操作。
      </p>
      <div v-if="canUpdateOpportunity && selectedOpportunity.opp_status !== 'VOID'" class="crm-actions">
        <button type="button" :disabled="!qbLaunchQuotationAvailable || Boolean(opportunityLaunchLoading)" :title="qbLaunchQuotationAvailable ? '' : '报价短效安全调起未配置'" @click="launchOpportunityExternal('报价')">{{ opportunityLaunchLoading === '报价' ? '正在生成…' : '生成报价' }}</button>
        <button type="button" :disabled="!qbLaunchBidAvailable || Boolean(opportunityLaunchLoading)" :title="qbLaunchBidAvailable ? '' : '投标短效安全调起未配置'" @click="launchOpportunityExternal('投标')">{{ opportunityLaunchLoading === '投标' ? '正在生成…' : '发起投标' }}</button>
      </div>
      <p v-if="opportunityLaunchError" class="crm-alert error" role="alert">{{ opportunityLaunchError }}</p>
      <button
        v-if="canTransferOpportunity && selectedOpportunity.current_stage === '已签约' && selectedOpportunity.opp_status === 'CLOSED' && selectedOpportunity.contract_ref && selectedOpportunity.terminal_pending_type === 'NONE'"
        type="button"
        class="primary"
        :disabled="contractTransferLoading"
        @click="submitContractTransfer"
      >{{ contractTransferLoading ? '正在受理…' : '转交合同系统' }}</button>
      <p v-else-if="canTransferOpportunity && selectedOpportunity.current_stage === '已签约' && !selectedOpportunity.contract_ref" class="crm-note">请先补全并验证合同，再转交合同系统。</p>
    </aside>
  </div>
  </article></div>
    <div v-if="presaleCreateDialog && selectedOpportunity" class="console-modal-backdrop crm-opportunity-presale-create-backdrop" role="presentation" @click.self="closeOpportunityPresaleCreate">
      <article class="console-detail-modal crm-opportunity-presale-create-dialog" role="dialog" aria-modal="true" aria-labelledby="opportunity-presale-create-heading">
        <header>
          <div><p class="console-modal-eyebrow">售前技术支持</p><h2 id="opportunity-presale-create-heading">发起售前支持</h2></div>
          <button class="console-modal-close" type="button" aria-label="关闭售前支持申请" :disabled="presaleCreateLoading" @click="closeOpportunityPresaleCreate"><ConsoleIcon name="close" /></button>
        </header>
        <div class="console-detail-grid crm-opportunity-presale-create-context">
          <div><span>关联商机</span><strong>{{ selectedOpportunity.opportunity_no }}</strong></div>
          <div><span>商机名称</span><strong>{{ selectedOpportunity.name }}</strong></div>
          <div><span>当前阶段</span><strong>{{ selectedOpportunity.current_stage }}</strong></div>
          <div><span>负责人</span><strong>{{ ownerLabel(selectedOpportunity.owner_user_id) }}</strong></div>
        </div>
        <form id="opportunity-presale-create-form" class="console-form-grid crm-opportunity-presale-create-body" @submit.prevent="submitOpportunityPresale">
          <div v-if="!presaleRequestSubmissionAvailable" class="crm-alert warning crm-opportunity-presale-create-status" role="status">
            <span>售前投递 Worker 尚未就绪。可以先填写申请，但当前不会向服务端提交。</span>
            <button class="console-button ghost small" type="button" :disabled="runtimeCapabilitiesLoading" @click="refreshPresaleSubmissionCapability">{{ runtimeCapabilitiesLoading ? '检测中…' : '重新检测' }}</button>
          </div>
          <p v-if="error" class="crm-alert error crm-opportunity-presale-create-status" role="alert">{{ error }}</p>
          <label class="console-form-item"><span>支持方式 *</span><select v-model="presaleForm.venue" required><option value="REMOTE">远程支持</option><option value="ONSITE">现场支持</option></select></label>
          <label class="console-form-item"><span>紧急程度 *</span><select v-model="presaleForm.urgency" required><option value="NORMAL">普通</option><option value="URGENT">紧急</option></select></label>
          <label v-if="presaleForm.venue === 'ONSITE'" class="console-form-item full"><span>服务地址 *</span><input v-model.trim="presaleForm.service_address" required maxlength="500" autocomplete="street-address" placeholder="请输入客户现场详细地址"></label>
          <label class="console-form-item"><span>联系人 *</span><input v-model.trim="presaleForm.contact_name" required maxlength="100" autocomplete="name" placeholder="请输入客户对接人"></label>
          <label class="console-form-item"><span>联系电话 *</span><input v-model.trim="presaleForm.contact_phone" required maxlength="64" autocomplete="tel" inputmode="tel" placeholder="请输入联系电话"></label>
          <label class="console-form-item"><span>预计开始 *</span><input v-model="presaleForm.expected_start" type="datetime-local" required></label>
          <label class="console-form-item"><span>预计结束 *</span><input v-model="presaleForm.expected_end" type="datetime-local" required></label>
          <label class="console-form-item full"><span>需求说明 *</span><textarea v-model.trim="presaleForm.description" rows="5" minlength="10" maxlength="2000" required placeholder="请描述支持背景、目标和交付预期"></textarea><small>10–2000 字；提交后进入售前审批流程，不会自动修改商机阶段。</small></label>
        </form>
        <footer>
          <button class="console-button ghost" type="button" :disabled="presaleCreateLoading" @click="closeOpportunityPresaleCreate">取消</button>
          <button class="console-button primary" type="submit" form="opportunity-presale-create-form" :disabled="presaleCreateLoading || !presaleRequestSubmissionAvailable">{{ presaleCreateLoading ? '提交中…' : '提交申请' }}</button>
        </footer>
      </article>
    </div>
    <div v-if="ownerDialog" class="crm-modal nested"><form @submit.prevent="submitOwner"><h2>变更商机负责人</h2><OwnerSelector v-model:user-id="ownerForm.owner_user_id" v-model:organization-id="ownerForm.owner_org_id" :default-user-id="crmSession?.user_id || ''" :default-organization-id="crmSession?.primary_org_id || ''" /><label>变更原因<textarea v-model.trim="ownerForm.reason" required></textarea></label><div class="crm-actions"><button type="button" @click="ownerDialog = false">取消</button><button class="primary">确认变更</button></div></form></div>
    <div v-if="teamDialog" class="crm-modal nested">
      <form class="crm-detail" @submit.prevent="submitTeam">
        <h2>维护商机团队</h2>
        <p class="crm-note">从基础平台当前有效、且已获得本应用授权的真实人员中选择；提交时服务端会再次校验人员状态。</p>
        <section class="crm-business-picker">
          <label>查找内部人员<input v-model.trim="teamDirectoryKeyword" type="search" placeholder="输入姓名关键字" @keyup.enter.prevent="loadTeamDirectory"></label>
          <button type="button" :disabled="teamDirectoryLoading" @click="loadTeamDirectory">{{ teamDirectoryLoading ? '查询中…' : '查询人员' }}</button>
          <label>选择成员<select v-model="teamCandidate.user_id" :disabled="teamDirectoryLoading || !teamDirectoryOptions.length"><option value="">请选择人员</option><option v-for="user in teamDirectoryOptions" :key="user.user_id" :value="user.user_id" :disabled="teamForm.members.some((item) => item.user_id === user.user_id)">{{ user.display_name }}（{{ user.user_id }}） · {{ teamMemberOrganizations(user) }}</option></select></label>
          <label>团队职责<select v-model="teamCandidate.role"><option value="SALES_SUPPORT">销售支持</option><option value="TECHNICAL_SUPPORT">技术支持</option><option value="BUSINESS_SUPPORT">商务支持</option><option value="OTHER">其他</option></select></label>
          <button type="button" :disabled="!teamCandidate.user_id || teamForm.members.length >= 50" @click="addTeamMember">添加成员</button>
          <small v-if="teamDirectoryError" class="crm-alert error" role="alert">{{ teamDirectoryError }} 不会退回为手填账号 ID。</small>
        </section>
        <p v-if="!teamForm.members.length" class="crm-empty compact">当前团队为空；直接提交可移除全部现有成员。</p>
        <section v-else class="crm-team-editor">
          <div v-for="(member, index) in teamForm.members" :key="member.user_id">
            <span><strong>{{ teamMemberName(member) }}</strong><small>{{ member.user_id }} · {{ teamMemberOrganizations(member) }}</small><em v-if="member.directory_status === 'NOT_AVAILABLE'">该人员已停用或不再具有本应用授权，请移出后再提交。</em></span>
            <select v-model="member.role" :aria-label="`${teamMemberName(member)}的团队职责`"><option value="SALES_SUPPORT">销售支持</option><option value="TECHNICAL_SUPPORT">技术支持</option><option value="BUSINESS_SUPPORT">商务支持</option><option value="OTHER">其他</option></select>
            <button type="button" class="danger" @click="removeTeamMember(index)">移除</button>
          </div>
        </section>
        <label>变更原因<textarea v-model.trim="teamForm.reason" required maxlength="500"></textarea></label>
        <div class="crm-actions"><button type="button" @click="teamDialog = false">取消</button><button class="primary" :disabled="teamDirectoryLoading || Boolean(teamDirectoryError)">替换当前团队</button></div>
      </form>
    </div>
    <div v-if="stageDialog" class="crm-modal nested"><form @submit.prevent="submitStage"><h2>调整阶段</h2><p class="crm-note">提交后立即生效，不发起审批。</p><label>目标阶段<select v-model="stageForm.target_stage" required><option value="初步接触">初步接触</option><option value="需求沟通">需求沟通</option><option value="方案制定">方案制定</option><option value="报价">报价</option><option value="投标">投标</option><option value="已签约">已签约</option><option value="失败">失败</option></select></label><p v-if="stageForm.target_stage === '已签约' && opportunityQuoteAmountCheck?.status === 'MISMATCH' && opportunityQuoteAmountCheck.opportunity_version === selectedOpportunity?.version" class="crm-alert warning" role="status">签单前金额提示：预计金额 {{ opportunityQuoteAmountCheck.expected_amount }} 与已通过报价 {{ opportunityQuoteAmountCheck.approved_quote_amount }} 不一致；仍可继续签单。</p><p v-else-if="stageForm.target_stage === '已签约' && opportunityQuoteAmountCheck?.status === 'APPROVED_QUOTE_AMOUNT_MISSING' && opportunityQuoteAmountCheck.opportunity_version === selectedOpportunity?.version" class="crm-note">已通过报价缺少金额，当前无法判断一致性；仍可继续签单。</p><label>原因<textarea v-model="stageForm.reason" required></textarea></label><label v-if="stageForm.target_stage === '已签约'">合同编号<input v-model.trim="stageForm.contract_ref" required placeholder="请输入合同管理系统中的合同编号"><small>合同系统当前只提供按编号精确归属校验，尚未提供可安全列举的合同选择接口。</small></label><label v-if="stageForm.target_stage === '失败'">失败原因<input v-model="stageForm.lost_reason" required></label><div class="crm-actions"><button type="button" @click="stageDialog = false">取消</button><button class="primary">确认</button></div></form></div>
    <div v-if="terminalDialog" class="crm-modal nested"><form @submit.prevent="submitTerminal"><h2>补全终态待办</h2><label v-if="selectedOpportunity.terminal_pending_type === 'CONTRACT'">合同编号<input v-model.trim="terminalForm.contract_ref" required placeholder="请输入合同管理系统中的合同编号"><small>提交时会向合同系统精确校验该编号是否属于当前客户。</small></label><label v-else>失败原因<input v-model="terminalForm.lost_reason" required></label><label>补全原因<textarea v-model="terminalForm.reason" required></textarea></label><div class="crm-actions"><button type="button" @click="terminalDialog = false">取消</button><button class="primary">提交</button></div></form></div>
    <div v-if="followupDialog" class="crm-modal nested"><form @submit.prevent="submitFollowup"><h2>添加跟进</h2><label>类型<select v-model="followupForm.type"><option value="PHONE">电话</option><option value="VISIT">拜访</option><option value="EMAIL">邮件</option><option value="OTHER">其他</option></select></label><label>内容<textarea v-model="followupForm.content" required></textarea></label><label>跟进时间<input v-model="followupForm.followed_at" type="datetime-local" required></label><label>下次跟进<input v-model="followupForm.next_follow_at" type="datetime-local"></label><div class="crm-actions"><button type="button" @click="followupDialog = false">取消</button><button class="primary">保存</button></div></form></div>
    <div v-if="customerFollowupDialog" class="crm-modal nested"><form @submit.prevent="submitCustomerFollowup"><h2>添加客户沟通</h2><label>类型<select v-model="customerFollowupForm.type"><option value="PHONE">电话</option><option value="VISIT">拜访</option><option value="EMAIL">邮件</option><option value="OTHER">其他</option></select></label><label>内容<textarea v-model="customerFollowupForm.content" required></textarea></label><label>沟通时间<input v-model="customerFollowupForm.followed_at" type="datetime-local" required></label><label>下次跟进<input v-model="customerFollowupForm.next_follow_at" type="datetime-local"></label><div class="crm-actions"><button type="button" @click="customerFollowupDialog = false">取消</button><button class="primary">保存</button></div></form></div>
    <div v-if="engineerPickerOpen && selectedPresale" class="crm-modal nested"><form class="crm-detail" @submit.prevent="runPresale('assign')"><h2>从 PMS 人员池选择执行人</h2><p class="crm-note">仅展示 PMS 当前有效人员；完整同步失败时旧缓存会保留至任务成功。历史上已指派但停用的人员只能保留或移出，不能重新加入。</p><section class="crm-toolbar"><label>姓名 / 工号<input v-model.trim="engineerQuery.keyword"></label><label>部门<input v-model.trim="engineerQuery.department"></label><label>角色<select v-model="engineerQuery.role"><option value="">全部角色</option><option value="technical_director">技术总监</option><option value="team_lead">团队负责人</option><option value="project_manager">项目经理</option><option value="implementation_engineer">实施工程师</option></select></label><label>技能<input v-model.trim="engineerQuery.skill"></label><button type="button" @click="loadEngineerDirectory">查询</button><button v-if="canSyncEngineers" type="button" @click="requestEngineerSync">异步同步 PMS</button></section><p v-if="engineerSyncMeta" class="crm-note">最近尝试：{{ formatDate(engineerSyncMeta.last_attempt_at) }}；最近成功：{{ formatDate(engineerSyncMeta.last_successful_sync_at) }}；下次同步：{{ formatDate(engineerSyncMeta.next_sync_at) }}</p><div v-if="engineerDirectory.length" class="crm-engineer-list"><label v-for="person in engineerDirectory" :key="person.person_id" class="check crm-engineer"><input v-model="selectedEngineerIDs" type="checkbox" :value="person.person_id"><span><strong>{{ person.person_name }}</strong>（{{ person.person_id }}） · {{ person.department }} · {{ person.role }} · {{ person.valid_flag ? '有效' : '停用' }}<br>技能：{{ person.skill_tags?.join('、') || '—' }}；源更新时间：{{ formatDate(person.source_updated_at) }}；本地同步：{{ formatDate(person.synced_at) }}</span></label></div><p v-else class="crm-empty">当前筛选没有可指派人员。</p><section v-if="unavailableCurrentAssignees.length" class="crm-alert warning"><strong>当前指派但已停用或不在有效池</strong><label v-for="person in unavailableCurrentAssignees" :key="person.person_id" class="check"><input v-model="selectedEngineerIDs" type="checkbox" :value="person.person_id">保留 {{ person.person_name || person.person_id }}（取消勾选即移出）</label></section><dl class="crm-assignment-diff"><dt>新增</dt><dd>{{ assignmentDiff.added.join('、') || '无' }}</dd><dt>保留</dt><dd>{{ assignmentDiff.retained.join('、') || '无' }}</dd><dt>移出</dt><dd>{{ assignmentDiff.removed.join('、') || '无' }}</dd></dl><label>改派原因<textarea v-model.trim="assignmentReason" required maxlength="500"></textarea></label><div class="crm-actions"><button type="button" @click="engineerPickerOpen = false">取消</button><button class="primary">确认替换指派</button></div></form></div>
    <div v-if="selectedPresale" class="console-modal-backdrop" :class="{ nested: !!selectedOpportunity }" role="presentation" @click.self="closePresale">
      <article class="console-detail-modal crm-presale-console-detail" role="dialog" aria-modal="true" aria-label="售前申请详情">
        <header>
          <div><p class="console-modal-eyebrow">售前申请详情</p><h2>{{ selectedPresale.request.request_no }}</h2></div>
          <button class="console-modal-close" type="button" aria-label="关闭售前申请详情" @click="closePresale"><ConsoleIcon name="close" /></button>
        </header>
        <div class="console-detail-grid crm-presale-summary">
          <div><span>状态</span><strong>{{ requestStatusText(selectedPresale.request.status) }}</strong></div>
          <div><span>关联商机</span><strong>{{ selectedPresale.request.opportunity_no }}</strong></div>
          <div><span>联系人</span><strong>{{ selectedPresale.request.contact_name || '—' }}</strong></div>
          <div class="crm-presale-phone"><span>联系电话</span><strong>{{ presaleContactPhone || selectedPresale.request.contact_phone || '—' }}</strong><div class="crm-presale-phone__actions"><button v-if="canViewSelectedPresaleContactPhone && !presaleContactPhone" class="console-button ghost small" type="button" :disabled="presaleContactPhoneLoading" @click="viewPresaleContactPhone">{{ presaleContactPhoneLoading ? '查看中…' : '查看明文' }}</button><button v-if="presaleContactPhone" class="console-button ghost small" type="button" @click="presaleContactPhone = ''">隐藏</button></div><small v-if="canViewSelectedPresaleContactPhone" class="crm-note">查看明文会写入敏感信息访问审计，关闭详情后立即清除。</small><small v-if="presaleContactPhoneError" class="crm-alert error" role="alert">{{ presaleContactPhoneError }}</small></div>
          <div><span>当前执行人</span><strong>{{ assignees(selectedPresale.current_assignees) }}</strong></div>
          <div><span>累计工时</span><strong>{{ selectedPresale.total_work_hours }} 小时</strong></div>
          <div><span>是否逾期</span><strong>{{ selectedPresale.overdue ? '是' : '否' }}</strong></div>
        </div>
        <section class="console-detail-section crm-presale-actions" aria-labelledby="presale-actions-heading">
          <h3 id="presale-actions-heading">可用操作</h3>
          <p v-if="presaleActionsLoading">正在向服务端确认可用操作…</p>
          <p v-else-if="presaleActionsError" class="crm-alert error" role="alert">{{ presaleActionsError }} <button class="console-button ghost small" type="button" @click="refreshPresaleActions(selectedPresale.request.id)">重试</button></p>
          <p v-else>{{ authoritativePresaleActions.map(actionText).join('、') || '当前仅可查看' }}。多人任务在所有当前执行人各有至少一笔有效工时后自动完成。</p>
          <p v-if="selectedPresale.request.status === 'PENDING_APPROVAL'">审批操作会由服务端按实例、节点和当前登录审批人实时解析权威待办；浏览器不会接收或提交内部任务 ID。正式审批引擎未配置或查询失败时，可用操作会安全关闭。</p>
          <div class="crm-presale-action-buttons"><button class="console-button ghost small" type="button" @click="runPresale('assignments')">查看指派</button><button class="console-button ghost small" type="button" @click="runPresale('history')">审批历史</button><button v-if="authoritativePresaleActions.includes('APPROVE')" class="console-button primary small" type="button" :disabled="presaleMutationLoading" @click="runPresaleDecision('approve')">通过审批</button><button v-if="authoritativePresaleActions.includes('REJECT')" class="console-button danger small" type="button" :disabled="presaleMutationLoading" @click="runPresaleDecision('reject')">驳回审批</button><button v-if="authoritativePresaleActions.includes('CANCEL')" class="console-button danger small" type="button" @click="runPresaleDecision('cancel')">取消申请</button><button v-if="authoritativePresaleActions.includes('ASSIGN')" class="console-button ghost small" type="button" @click="openEngineerPicker">选择或改派执行人</button></div>
        </section>
        <section v-if="authoritativePresaleActions.includes('ADD_PROGRESS')" class="console-detail-section crm-presale-entry-card">
          <h3>登记进度</h3><p>补充本次工作的最新进展，参考链接仅允许 HTTPS。</p>
          <form class="console-form-grid" @submit.prevent="runPresale('progress')"><label class="console-form-item full"><span>进度说明 *</span><textarea v-model.trim="operation.progress" minlength="1" maxlength="2000" required rows="3"></textarea></label><label class="console-form-item"><span>参考链接（仅 HTTPS）</span><input v-model.trim="operation.progress_link" type="url" placeholder="https://"></label><label class="console-form-item"><span>进度百分比</span><input v-model="operation.progress_pct" type="number" min="0" max="100"></label><div class="crm-presale-form-actions"><button class="console-button primary" type="submit" :disabled="presaleMutationLoading">登记进度</button></div></form>
        </section>
        <details v-if="authoritativePresaleActions.includes('ADD_WORKLOG')" class="console-detail-section crm-presale-entry-card crm-presale-worklog-form">
          <summary>登记工时</summary>
          <form class="console-form-grid" @submit.prevent="runPresale('worklog')"><label class="console-form-item"><span>开始</span><input v-model="operation.work_start" type="datetime-local"></label><label class="console-form-item"><span>结束</span><input v-model="operation.work_end" type="datetime-local"></label><label class="console-form-item"><span>单位</span><select v-model="operation.raw_unit"><option value="HOUR">小时</option><option value="PERSON_DAY">人天（1 人天 = 8 小时）</option></select></label><label class="console-form-item"><span>数值</span><input v-model="operation.raw_value"></label><label class="console-form-item full"><span>工作地点</span><input v-model="operation.work_site_address"></label><label class="console-form-item"><span>工作内容</span><select v-model="operation.work_content"><option value="SOLUTION_DESIGN">方案设计</option><option value="TECH_EXCHANGE">技术交流</option><option value="POC_DEMO">POC 演示</option><option value="TECH_QA">技术答疑</option><option value="OTHER">其他</option></select></label><label class="console-form-item"><span>备注</span><input v-model="operation.remark"></label><div class="crm-presale-form-actions"><button class="console-button primary" type="submit" :disabled="presaleMutationLoading">{{ presaleMutationLoading ? '提交中…' : '提交工时' }}</button></div></form>
        </details>
        <section class="console-detail-section crm-presale-timeline" aria-labelledby="presale-timeline-heading"><div class="crm-subsection-heading"><div><h3 id="presale-timeline-heading">流程时间线</h3><p>按服务端稳定游标倒序加载，流程记录只读。</p></div><button class="console-button ghost small" type="button" :disabled="presaleTimelineLoading" @click="refreshPresaleTimeline(selectedPresale.request.id)">刷新</button></div><p v-if="presaleTimelineLoading && !presaleTimeline.length">正在加载流程记录…</p><p v-if="presaleTimelineError" class="crm-alert error" role="alert">{{ presaleTimelineError }}</p><ol v-if="presaleTimeline.length" class="crm-timeline-list"><li v-for="item in presaleTimeline" :key="item.event_id"><time :datetime="item.occurred_at">{{ formatDate(item.occurred_at) }}</time><div><strong>{{ timelineEventText(item.type) }}</strong><span v-if="item.actor_name || item.actor_id">操作人：{{ item.actor_name || item.actor_id }}</span><span v-if="item.type === 'STATUS_CHANGED'">{{ requestStatusText(item.from_status) }} → {{ requestStatusText(item.to_status) }}</span><span v-if="item.type === 'APPROVAL_DECIDED'">审批结果：{{ approvalResultText(item.result) }}</span><span v-if="item.type === 'ASSIGNEE_ADDED' || item.type === 'ASSIGNEE_REMOVED'">执行人：{{ item.subject_name || item.subject_id }}</span><p v-if="item.content">{{ item.content }}</p><span v-if="item.progress_pct !== null && item.progress_pct !== undefined">进度：{{ item.progress_pct }}%</span><a v-if="safeHTTPSURL(item.link_url)" :href="safeHTTPSURL(item.link_url)" target="_blank" rel="noopener noreferrer">打开安全链接</a><span v-if="item.work_hours">{{ workContentText(item.work_content) }} · {{ item.work_hours }} 小时</span></div></li></ol><p v-else-if="!presaleTimelineLoading && !presaleTimelineError" class="crm-empty compact">暂无流程记录</p><button v-if="presaleTimelineCursor" class="console-button ghost small" type="button" :disabled="presaleTimelineLoading" @click="loadMorePresaleTimeline">{{ presaleTimelineLoading ? '加载中…' : '加载更多' }}</button></section>
        <section class="console-detail-section crm-presale-worklogs"><h3>工时记录</h3><p v-if="!worklogs.length">暂无工时。</p><div v-for="item in worklogs" :key="item.id" class="crm-worklog"><span>{{ item.person_name || item.person_id }} · {{ item.work_hours }} 小时 · {{ pushStatusText(item.push_status) }}</span><button class="console-button ghost small" type="button" @click="operation.worklog_id = String(item.id); runPresale('delivery')">投递状态</button></div></section>
        <footer><button class="console-button ghost" type="button" @click="closePresale">关闭</button><button v-if="operation.worklog_id" class="console-button primary" type="button" @click="runPresale('retry')">重试所选工时投递</button></footer>
      </article>
    </div>
    <div v-if="reasonDialog.open" class="crm-modal nested" role="dialog" aria-modal="true" aria-labelledby="reason-dialog-title">
      <form @submit.prevent="confirmReasonDialog">
        <h2 id="reason-dialog-title">{{ reasonDialog.title }}</h2>
        <p class="crm-note">{{ reasonDialog.required ? '此操作需要填写原因并保存审计记录。' : '可填写审批意见，留空直接提交。' }}</p>
        <label>原因 / 意见<textarea v-model="reasonDialog.reason" :required="reasonDialog.required" maxlength="500" rows="3" :placeholder="reasonDialog.required ? '请输入原因' : '可选'"></textarea></label>
        <p v-if="reasonDialogError" class="crm-alert error" role="alert">{{ reasonDialogError }}</p>
        <div class="crm-actions"><button type="button" :disabled="actionLoading" @click="closeReasonDialog">取消</button><button class="primary" type="submit" :disabled="actionLoading">{{ reasonDialog.confirmText }}</button></div>
      </form>
    </div>
  </div>
</template>
