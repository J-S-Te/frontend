<script setup>
import { loginUsername } from "@/modules/shared/loginUsername.mjs"
import OperationToast from '@/modules/shared/components/OperationToast.vue'
import ListState from '@/modules/shared/components/ListState.vue'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'
import { useConfirmDialog } from '@/modules/shared/composables/useConfirmDialog.js'
import ConfirmDialog from '@/modules/shared/components/ConfirmDialog.vue'
import LoadingState from '@/modules/shared/components/LoadingState.vue'
import ErrorState from '@/modules/shared/components/ErrorState.vue'
import { formatCRMError } from '../api/errorMessages.js'
import { computed, defineAsyncComponent, defineComponent, h, onMounted, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, logoutCurrentSession } from '@/modules/platform/auth/api/auth'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { useDictionaryOptions } from '@/modules/platform/dictionaries/composables/useDictionaryOptions.js'
import { subsystemAccessMessage } from '@/modules/shared/authz/sessionCompatibility'
import OwnerSelector from '../components/OwnerSelector.vue'
import OpportunityCatalogDialog from '../components/OpportunityCatalogDialog.vue'
import OpportunityWinConfirmationPanel from '../components/OpportunityWinConfirmationPanel.vue'
import { createWinEvidenceForm, winConfirmationPayload } from '../winConfirmation.js'
import { getOpportunityWinConfirmation } from '../api/winConfirmation.js'
import PresaleApprovalRulesPanel from '../components/PresaleApprovalRulesPanel.vue'
import CustomerCreditPanel from '../components/CustomerCreditPanel.vue'
import CreditApprovalInbox from '../components/CreditApprovalInbox.vue'
import CreditRuleSettingsPanel from '../components/CreditRuleSettingsPanel.vue'
import { formatSignedContractCount } from '../signedContractCount.js'
import {
  checkCustomerDuplicate, commitCustomerImport, createCustomer, createCustomerFollowup, downloadCustomerImportTemplate,
  createPortalInvite, disablePortalAccess, getCurrentPortalInvite, getPortalAccessStatus,
  getCustomer, listCustomerFollowups, listCustomers, previewCustomerImport,
  listCustomerAuditLogs, listCustomerContacts, listCustomerOpportunities, listCustomerProjects,
  listCustomerStakeholders, listCustomerSystems, mergeCustomers, replaceCustomerStakeholders, replaceCustomerSystems,
  requestCustomerExport, restoreCustomer, revokePortalInvite, updateCustomer, voidCustomer,
} from '../api/customer.js'
import { customerAPIParams, customerFiltersFromQuery, customerFiltersToQuery } from '../customerQuery.js'
import { presaleAPIParams, presaleStateFromQuery, presaleStateToQuery } from '../presaleQuery.js'
import { createPresaleMutationRetryState } from '../presaleMutationRetry.js'
import { createRequestScope } from '@/modules/platform/shared/composables/requestScope'
import { closeSubsystemTabOrFallback } from '@/modules/shared/utils/returnToPortal'
// 业务时间统一按北京时间：datetime-local 回填用北京墙钟，提交再按北京墙钟换回瞬间，
// 两端严格互逆，避免浏览器时区把同一个期望开始时间静默改掉。
import { businessWallClockToInstant, instantToBusinessWallClock } from '@/modules/shared/utils/businessTime.js'
import { isSafeOpenTarget } from '@/modules/platform/login-targets/utils/targetUri.js'
import {
  changeOpportunityStage, completeOpportunityTerminalTodo, createOpportunity, createOpportunityFollowup,
  getOpportunity, getOpportunityBoard, getOpportunityExternalStatus, getOpportunityStageHistory, listOpportunities, listOpportunityFollowups,
  listOpportunityCatalogItems,
  createQuotationLaunch, createBidLaunch,
  restoreOpportunity, updateOpportunity, voidOpportunity, changeOpportunityOwner,
  getOpportunityMembers, listOpportunityMemberTerms, replaceOpportunityMembers, listOpportunityStageAlerts,
  markOpportunityStageAlertRead, listOpportunityStageAlertRules, updateOpportunityStageAlertRule,
  listOpportunityPresaleRequests, transferOpportunityToContract,
  getOpportunityAttachmentCapabilities, listOpportunityAttachments, createOpportunityAttachmentUpload,
  uploadOpportunityAttachmentContent, completeOpportunityAttachmentUpload, downloadOpportunityAttachment,
} from '../api/opportunity.js'
import { createIdempotencyKey, getCRMSession, getCRMRuntimeCapabilities } from '../api/client.js'
import { createCreateMutationRetryState } from '../createMutationRetry.js'
import { createContractTransferRetryState } from '../contractTransferRetry.js'
import { createAttachmentUploadRetryState } from '../attachmentUploadRetry.js'
import { createMemberTermLoadState } from '../memberTermLoadState.js'
import { validateOpportunityAttachment } from '../utils/attachmentValidation.js'
import { createPortalInviteRetryState, validatePortalInviteResult } from '../portalInviteRetry.js'
import { createPortalAccessDisableRetryState } from '../portalAccessDisableRetry.js'
import {
  CREDIT_APPLICATION_ROLES,
  CREDIT_APPROVAL_ROLES,
  actionText,
  alertTypeText,
  approvalResultText,
  assignees,
  creditLevelLabel,
  crmRoleNames,
  customerImportTemplateColumns,
  customerRegionSuggestions,
  customerStatusOptions,
  customerStatusText,
  customerTypeSuggestions,
  defaultReportFilters,
  emptyCustomer,
  emptyInformationSystem,
  emptyOpportunity,
  emptyStakeholder,
  fallbackCustomerIndustryOptions,
  filingStatusText,
  formatAmount,
  formatDate,
  formatDateTimeLocal,
  hasCreditApprovalAccess,
  importRowStatusText,
  influenceText,
  isPresaleEligibleOpportunity,
  normalizeReportRows,
  normalizeReportSummary,
  opportunityStageOptions,
  opportunityStatusOptions,
  opportunityStatusText,
  platformUserName,
  portalInviteStatusText,
  presaleEligibilityMessage,
  presaleEligibleOpportunityStages,
  presaleOpportunityLabel,
  presaleOptionText,
  presaleRequestID,
  projectProgressText,
  projectStatusText,
  protectionLevelText,
  pushStatusText,
  reportDateParam,
  requestStatusText,
  safeHTTPSURL,
  stableQuery,
  stageAlertStatusText,
  terminalPendingText,
  timelineEventMeta,
  timelineEventText,
  urgencyText,
  usableOperationName,
  venueText,
  workContentText,
} from '@/modules/customer_opportunity/crmDisplay'
import {
  customerStatusTone, opportunityStageSteps, opportunityStageTone, opportunityStatusTone,
  personInitial, presaleBoardCounts, presaleStatusTone, presaleWorkHours,
} from '../crmSummary.js'
import StageAlertDetailModal from '@/modules/customer_opportunity/components/StageAlertDetailModal.vue'
import { usePresaleReportData } from '@/modules/customer_opportunity/composables/usePresaleReportData'
import { useCustomerEditor } from '../composables/useCustomerEditor.js'
import { useOpportunityEditor } from '../composables/useOpportunityEditor.js'
import { useCustomerImportWizard } from '../composables/useCustomerImportWizard.js'
import { createPresaleReportFilters } from '../composables/usePresaleReportFilters.js'
import { getNotificationUnreadCount, listNotifications, markNotificationRead } from '../api/notification.js'
import { listOwnerDirectory } from '../api/ownerDirectory.js'
import { parseNotificationTarget } from '../navigation.js'
import {
  addProgress, addWorklog, completePresaleRequest, createPresaleRequest, reopenPresaleRequest, getApprovalHistory, getAssignments, getPresaleRequest,
  getPresaleContactPhone,
  getPresaleAvailableActions, getPresaleBoard, getPresaleFilterOptions, getPresaleTimeline,
  cancelPresaleRequest, listPresaleRequests, listWorklogs, replaceAssignments, replaceExecutorAssignments, rejectExecutorAssignment, submitApprovalAction, takeOverExecutingTeamLead,
  listPresaleAlerts, markPresaleAlertRead,
  listPresaleAlertRules, updatePresaleAlertRule, getPresaleReportSummary, getPresaleReportTrend,
  getPresaleReportDistribution, getPresaleReportFilterOptions, requestPresaleReportExport, listPresaleExecutionDepartments, selectPresaleExecutionDepartment,
} from '../api/presale.js'
import AppShell from '@/modules/shared/components/AppShell.vue'
import '@/modules/platform/styles/console.css'
import '../styles/customer-opportunity.css'

const route = useRoute()
const router = useRouter()
const sections = new Set(['customers', 'opportunities', 'presale', 'notifications', 'credit-approvals', 'credit-rules'])
const { options: customerIndustryItems } = useDictionaryOptions('CUSTOMER_INDUSTRY', {
  fallback: fallbackCustomerIndustryOptions.map((value) => ({ value, label: value })),
})
const customerIndustryOptions = computed(() => customerIndustryItems.value.map((item) => item.value))
const activeSection = computed(() => sections.has(route.params.section) ? route.params.section : 'customers')
const sectionTitle = computed(() => ({ customers: '客户管理', opportunities: '商机管理', presale: '售前技术支持', notifications: '个人通知中心', 'credit-approvals': '信用审批待办', 'credit-rules': '信用规则管理' })[activeSection.value])
const mobileMenuOpen = ref(false)
const loading = ref(false)
const currentLoadSequence = ref(0)
const actionLoading = ref(false)
const error = ref('')
// 列表请求自身的失败原因：显示在列表位置（可重试），与操作类提示 error（toast）分开。
// 改造前请求失败只会走 toast，列表区域同时落回「暂无符合条件的客户」，失败与空结果看起来一样。
const listError = ref('')
const notice = ref('')
// 业务编号（客户编号 / 申请编号）只跟随产生它的那条提示：
// 提示文案换成别的操作时编号自动失效，不会串到下一次保存上。
const noticeReferenceByText = ref({})
const noticeReference = computed(() => (error.value ? '' : (noticeReferenceByText.value[notice.value] || '')))
function notifyWithReference(text, reference) {
  notice.value = text
  noticeReferenceByText.value = reference ? { [text]: reference } : {}
}
const customers = ref([])
// 客户列表顶部统计：由 4 个独立的计数查询得出，不使用当前页行数冒充全量。
const customerStats = reactive({ total: null, added: null, won: null, due: null, loading: false, error: '', loadedAt: 0 })
const customerStatsLoadSequence = ref(0)
const customerOwnerKeyword = ref('')
const customerOwnerOptions = ref([])
const customerOwnerOptionsLoading = ref(false)
const customerOwnerOptionsError = ref('')
const customerOwnerOptionsLoadSequence = ref(0)
const opportunities = ref([])
const board = ref([])
const presales = ref([])
const presaleBoard = ref([])
// 售前统计看板与列表分开请求：列表每页只返回一页数据，统计必须使用服务端列总数。
const presaleStatsColumns = ref(null)
const presaleStatsLoadSequence = ref(0)
const presaleColumnLimit = ref(20)
const presaleView = ref('list')
const presaleFilterOptions = ref({ opportunities: [], applicants: [], assignees: [], statuses: [], venues: [], urgencies: [], push_statuses: [], truncated: false })
const presaleFilterOptionsError = ref('')
const presaleFilterOptionsLoadSequence = ref(0)
const selectedCustomer = ref(null)
const customerDetailLoadSequence = ref(0)
const customerTabLoadSequence = ref(0)
const selectedOpportunity = ref(null)
const selectedOpportunityCustomerCredit = ref(null)
const opportunityDetailLoadSequence = ref(0)
// 详情展示不暴露组织 ID，但负责人变更仍需保留服务端返回的组织归属。
const selectedOpportunityOwnerOrgID = ref('')
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
const presaleInspectorPanel = ref('')
const presaleAssignments = ref([])
const presaleApprovalHistory = ref([])
const presaleInspectorLoading = ref(false)
const presaleInspectorError = ref('')
const engineerPickerOpen = ref(false)
const engineerDirectory = ref([])
const engineerDirectoryLoading = ref(false)
const selectedEngineerIDs = ref([])
const selectedEngineerRoles = reactive({})
const engineerQuery = reactive({ keyword: '', department: '' })
const assignmentReason = ref('')
const executionDepartments = ref([])
const selectedExecutionDepartmentID = ref('')
const selectedTeamLeadPersonID = ref('')
const teamLeadCandidates = ref([])
const teamLeadDirectoryLoading = ref(false)
const teamLeadDirectorySequence = ref(0)
const departmentSaving = ref(false)
const takeoverOpen = ref(false)
const takeoverTeamLeadID = ref('')
const takeoverReason = ref('')
const takeoverSaving = ref(false)
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
// 编辑弹窗的联系人回填状态：客户详情端点有意省略联系人，编辑时另取权威列表。
// 加载中/加载失败都不能让 submitCustomer 把空 contacts 提交上去（后端要求恰好一个登记联系人）。
const customerEditContactsLoading = ref(false)
const customerEditContactsError = ref('')
// 联系人读取失败是硬阻断：即使随后手动补录了联系人也不能提交，
// 否则会用不完整的清单整体覆盖服务端联系人（PUT 是全量语义），造成数据丢失。
const customerEditContactsLoadFailed = ref(false)
const customerEditContactsSequence = ref(0)
const customerTabLoading = ref(false)
const customerTabErrors = reactive({})
const customerTabLoaded = reactive({})
const worklogs = ref([])
const customerDialog = ref(false)
const customerEditMode = ref(false)
const opportunityDialog = ref(false)
const opportunityEditMode = ref(false)
const opportunityCatalogDialog = ref(false)
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
// page 是“下一次请求要用的页码/总数草稿”：筛选条件变化时 watcher 会直接把 page.number 复位到 1，
// 但不会立即重新加载。分页条必须显示屏幕上真实渲染的那一次加载结果，否则筛选草稿一改就
// 提前宣称“第 1 页”，而表格里还是上一页的数据。
// renderedPage 是分页条的唯一数据源：只在一次列表请求成功后写入（失败时列表已被清空，
// 同步写成空结果），请求进行中不写，改由分页条的“正在加载…”占位说明当前行数未知，
// 因此任何时刻分页条都不会显示与屏幕行数不符的页码。size 与 number/total 同源记录，
// 避免和下一次请求的草稿 page.size 混用。
const renderedPage = reactive({ number: 1, size: 20, total: 0 })
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

// 客户/商机编辑弹窗的编辑域（阶段 3-CRM）。
// 表单对象、弹窗开关、编辑态与脏检查基线的所有权仍在本页：组合式函数只是按同一引用回填/清空，
// 目录读取也收在里面；子组件异步加载、加载失败重试或重新挂载都不会产生第二份表单。
const customerEditor = useCustomerEditor({
  form: customerForm,
  dialog: customerDialog,
  editMode: customerEditMode,
  setSnapshot: (value) => { customerFormInitial = value },
})
const opportunityEditor = useOpportunityEditor({
  form: opportunityForm,
  dialog: opportunityDialog,
  editMode: opportunityEditMode,
  setSnapshot: (value) => { opportunityFormInitial = value },
  selectedOpportunity,
  selectedOpportunityOwnerOrgID,
  listCustomers,
  listOpportunityCatalogItems,
  formatCRMError,
})
const {
  typeSelections: opportunityTypeSelections, sourceSelections: opportunitySourceSelections,
  typeSelectOptions: opportunityTypeSelectOptions, sourceSelectOptions: opportunitySourceSelectOptions,
  catalogLoading: opportunityCatalogLoading, catalogError: opportunityCatalogError,
  customerOptions: opportunityCustomerOptions, customerOptionsLoading: opportunityCustomerOptionsLoading,
  customerOptionsError: opportunityCustomerOptionsError, customerOptionsTotal: opportunityCustomerOptionsTotal,
  customerKeyword: opportunityCustomerKeyword,
  loadCustomerOptions: loadOpportunityCustomerOptions,
  loadCatalogOptions: loadOpportunityCatalogOptions,
  syncSelections: syncOpportunitySelections,
} = opportunityEditor

// 低频弹窗用动态导入建立加载边界。弹窗里的输入状态在父层，代码块加载/重试只影响渲染：
// 失败时给显式重试入口（替换为新的异步组件实例重新请求），不会触发任何业务提交。
const loadCustomerEditorDialog = () => import('../components/CustomerEditorDialog.vue')
function createCustomerEditorDialog() {
  return defineAsyncComponent({
    loader: loadCustomerEditorDialog,
    loadingComponent: LoadingState,
    delay: 120,
    timeout: 30000,
    errorComponent: defineComponent({
      name: 'CustomerEditorDialogError',
      setup: () => () => h(ErrorState, {
        title: '客户表单加载失败',
        description: '页面资源暂不可用，请重试加载。',
        retryText: '重试加载',
        onRetry: retryCustomerEditorDialog,
      }),
    }),
    // 由错误面板承载受控提示，避免原始模块路径进入页面提示。
    onError: (_error, _retry, fail) => fail(),
  })
}
const customerEditorDialog = shallowRef(createCustomerEditorDialog())
function retryCustomerEditorDialog() { customerEditorDialog.value = createCustomerEditorDialog() }

const loadOpportunityEditorDialog = () => import('../components/OpportunityEditorDialog.vue')
function createOpportunityEditorDialog() {
  return defineAsyncComponent({
    loader: loadOpportunityEditorDialog,
    loadingComponent: LoadingState,
    delay: 120,
    timeout: 30000,
    errorComponent: defineComponent({
      name: 'OpportunityEditorDialogError',
      setup: () => () => h(ErrorState, {
        title: '商机表单加载失败',
        description: '页面资源暂不可用，请重试加载。',
        retryText: '重试加载',
        onRetry: retryOpportunityEditorDialog,
      }),
    }),
    onError: (_error, _retry, fail) => fail(),
  })
}
const opportunityEditorDialog = shallowRef(createOpportunityEditorDialog())
function retryOpportunityEditorDialog() { opportunityEditorDialog.value = createOpportunityEditorDialog() }

const { dialog: confirmDialog, askConfirm, accept: acceptConfirm, cancel: cancelConfirm } = useConfirmDialog()
async function confirmDiscardIfDirty(dirty) {
  if (!dirty) return true
  if (confirmDialog.value) return false
  return await askConfirm({ title: '放弃未保存的修改？', description: '当前修改尚未保存，放弃后这些内容不会保留。', confirmText: '放弃修改', cancelText: '继续编辑', danger: true })
}
async function closeCustomerDialog() {
  if (actionLoading.value) return
  if (!(await confirmDiscardIfDirty(customerFormDirty.value)) || actionLoading.value) return
  customerDialog.value = false
  customerFormInitial = ''
  resetCustomerEditContacts()
}
// 用途：清空编辑弹窗的联系人回填状态，避免把 A 客户的联系人带到 B 客户或下一次新建。
// 参数：无。
// 返回值：无；未完成的联系人请求通过序号失效。
function resetCustomerEditContacts() {
  customerEditContactsSequence.value += 1
  customerEditContactsLoading.value = false
  customerEditContactsError.value = ''
  customerEditContactsLoadFailed.value = false
  customerEditor.clearContacts()
}
async function closeOpportunityDialog() {
  if (actionLoading.value) return
  if (!(await confirmDiscardIfDirty(opportunityFormDirty.value)) || actionLoading.value) return
  opportunityDialog.value = false
  opportunityFormInitial = ''
}
const stageForm = reactive({ target_stage: '', reason: '', contract_ref: '', lost_reason: '', win_evidence: createWinEvidenceForm() })
const terminalForm = reactive({ reason: '', contract_ref: '', lost_reason: '', win_evidence: createWinEvidenceForm() })
const followupForm = reactive({ type: 'PHONE', content: '', followed_at: '', next_follow_at: '' })
const customerFollowupForm = reactive({ type: 'PHONE', content: '', followed_at: '', next_follow_at: '' })
const customerMergeForm = reactive({ target_customer_id: '', reason: '', target: null })
const customerMergeKeyword = ref('')
const customerMergeOptions = ref([])
const customerMergeOptionsLoading = ref(false)
const customerMergeOptionsError = ref('')
const customerMergeOptionsTotal = ref(0)
const customerMergeOptionsLoadSequence = ref(0)
const {
  customerImportDialog, customerImportForm, customerImportPreview, customerImportResult, customerImportScanAvailable,
  customerImportErrorReportRows,
  openCustomerImport, resetCustomerImportPreview, closeCustomerImport, selectCustomerImportFile,
  previewImport, commitImport, downloadImportErrors, downloadCustomerImportExample,
} = useCustomerImportWizard({
  error, notice, actionLoading, resetMessages, showError, loadCurrent, runtimeCapability, createIdempotencyKey,
  previewCustomerImport, commitCustomerImport, downloadCustomerImportTemplate,
})
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
const presaleReopenRequest = ref(null)
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
// 售前请求作用域（R04/R05）：每条读取链独立实例，begin 的 contextKey 含当前申请 ID
// 或查询条件；切换申请/关闭详情时 invalidate，组件卸载由 requestScope 自动失效，
// 迟到响应不再覆盖新上下文，也不会在卸载后回写组件状态。
const presaleDetailScope = createRequestScope()
const presaleActionsScope = createRequestScope()
const presaleTimelineScope = createRequestScope()
const presaleContactPhoneScope = createRequestScope()
const presaleInspectorScope = createRequestScope()
const presaleListScope = createRequestScope()
const presaleFilterOptionsScope = createRequestScope()
const presaleCreateOptionsScope = createRequestScope()
const alerts = ref([])
const alertRules = ref([])
const showAlertConfig = ref(false)
const alertConfigLoading = ref(false)
const alertConfigError = ref('')
const alertRuleSavingType = ref('')
const canConfigurePresaleAlerts = computed(() => (crmSession.value?.permissions || []).includes('presale.alert.config'))
const reportFilters = reactive(defaultReportFilters())
const reportOrganizationOptions = ref([])
const reportFilterOptions = ref({ opportunities: [], assignees: [] })
const reportFilterOptionsLoading = ref(false)
const reportFilterOptionsError = ref('')
const {
  load: loadPresaleReportFilterOptions,
} = createPresaleReportFilters({
  isReportOpen: () => showReport.value,
  reportFilters,
  getReportParams: () => reportParams(),
  reportFilterOptions,
  reportFilterOptionsLoading,
  reportFilterOptionsError,
  reportOrganizationOptions,
  getPresaleReportFilterOptions,
  listOwnerDirectory,
  rememberOwnerDirectory,
  directoryErrorMessage,
})
async function loadReportFilterOptions() {
  return loadPresaleReportFilterOptions()
}
async function onReportPersonChange() {
  reportFilters.opportunity_id = ''
  await loadReportFilterOptions()
}
async function onReportOrganizationChange() {
  reportFilters.person_id = ''
  reportFilters.opportunity_id = ''
  await loadReportFilterOptions()
}
const crmSession = ref(null)
const currentUserLabel = computed(() => loginUsername(crmSession.value))
const currentUserInitial = computed(() => {
  const label = currentUserLabel.value
  return /^[\x00-\x7F]+$/.test(label) ? label.slice(0, 2).toUpperCase() : Array.from(label)[0] || '用'
})
const currentRoleLabel = computed(() => {
  const roles = Array.isArray(crmSession.value?.roles) ? crmSession.value.roles : []
  return [...new Set(roles.map((role) => crmRoleNames[role] || role).filter(Boolean))].join('、') || '未分配角色'
})
// 统计卡数据完全来自服务端计数；尚未加载或加载失败时为 null，模板显示“—”而不是 0。
const customerStatCards = computed(() => ([
  { key: 'total', label: '全部客户', value: customerStats.total, tone: 'info', hint: '当前账号可见范围' },
  { key: 'added', label: '近 30 天新增', value: customerStats.added, tone: 'info', hint: '按创建时间统计' },
  { key: 'won', label: '成交客户', value: customerStats.won, tone: 'success', hint: '存在已签约商机' },
  { key: 'due', label: '待跟进', value: customerStats.due, tone: 'warning', hint: '最近一条跟进已到期' },
]))
const presaleStats = computed(() => {
  // 看板视图已有服务端列总数；列表视图通过独立的 column_limit=1 看板请求取总数。
  const columns = presaleView.value === 'board' ? presaleBoard.value : presaleStatsColumns.value
  const counts = Array.isArray(columns) ? presaleBoardCounts(columns) : null
  return {
    total: counts ? counts.total : (presalePage.total || null),
    pending: counts ? counts.pending : null,
    executing: counts ? counts.executing : null,
    completed: counts ? counts.completed : null,
    // 看板模式没有“当前页”，工时只能按已加载卡片统计，避免显示成 0.0。
    hours: presaleWorkHours(presaleView.value === 'board' ? presaleBoard.value.flatMap((column) => column?.items || []) : presales.value),
  }
})
const presaleStatCards = computed(() => ([
  { key: 'total', label: '可见申请', value: presaleStats.value.total, tone: 'info', hint: '按当前筛选与授权范围' },
  { key: 'pending', label: '待审批', value: presaleStats.value.pending, tone: 'warning', hint: '等待审批节点处理' },
  { key: 'executing', label: '执行中', value: presaleStats.value.executing, tone: 'info', hint: '已指派且正在执行' },
  { key: 'hours', label: presaleView.value === 'board' ? '已加载工时' : '当前页工时', value: presaleStats.value.hours, suffix: ' 小时', tone: 'success', hint: presaleView.value === 'board' ? '看板已加载卡片的累计工时' : '当前页申请累计工时' },
]))
const presaleStatusTabs = computed(() => {
  // 已按状态筛选时，统计看板也只剩该状态，继续显示其余页签的 0 会误导；
  // 此时隐藏计数，只保留页签切换本身。
  const counts = presaleFilters.status ? null : presaleStats.value
  return [
    { value: '', label: '全部', count: counts ? counts.total : null },
    { value: 'PENDING_APPROVAL', label: '待审批', count: counts ? counts.pending : null },
    { value: 'EXECUTING', label: '执行中', count: counts ? counts.executing : null },
    { value: 'COMPLETED', label: '已完成', count: counts ? counts.completed : null },
  ]
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
const canReadCustomers = computed(() => (crmSession.value?.permissions || []).includes('customer.read'))
const canReadCredit = computed(() => (crmSession.value?.permissions || []).includes('customer.credit.read'))
const canApplyCredit = computed(() => (crmSession.value?.permissions || []).includes('customer.credit.apply') && (crmSession.value?.roles || []).some((role) => CREDIT_APPLICATION_ROLES.has(role)) && !(crmSession.value?.roles || []).some((role) => CREDIT_APPROVAL_ROLES.has(role)))
const canApproveCredit = computed(() => hasCreditApprovalAccess(crmSession.value))
const canManageCreditRules = computed(() => (crmSession.value?.permissions || []).includes('customer.credit.rule.manage'))
const canReadNotifications = computed(() => canReadOpportunities.value || canReadPresales.value)
const canConfigureStageAlerts = computed(() => (crmSession.value?.permissions || []).includes('opportunity.alert.config'))
const canManagePresaleApprovalRules = computed(() => (crmSession.value?.permissions || []).includes('presale.approval_rule.manage'))
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
const canCreateOpportunity = computed(() => (crmSession.value?.permissions || []).includes('opportunity.create'))
const canExportCustomers = computed(() => (crmSession.value?.permissions || []).includes('customer.export'))
const canUpdateCustomer = computed(() => (crmSession.value?.permissions || []).includes('customer.update'))
const canMergeCustomer = computed(() => (crmSession.value?.permissions || []).includes('customer.merge'))
const canImportCustomers = computed(() => (crmSession.value?.permissions || []).includes('customer.import'))
const canCreatePresale = computed(() => (crmSession.value?.permissions || []).includes('presale.create'))
const canViewSelectedPresaleContactPhone = computed(() =>
  (crmSession.value?.permissions || []).includes('presale.contact_phone.read') && selectedPresale.value?.can_view_contact_phone === true)
const canTransferOpportunity = computed(() => (crmSession.value?.permissions || []).includes('opportunity.contract.transfer'))
const canUpdateOpportunity = computed(() => (crmSession.value?.permissions || []).includes('opportunity.update'))
const canManageOpportunityTeam = computed(() => (crmSession.value?.permissions || []).includes('opportunity.team.manage'))
const canManageOpportunityCatalog = computed(() => (crmSession.value?.permissions || []).includes('opportunity.catalog.manage'))
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
const customerExportAvailable = computed(() => runtimeCapability('customer_export').available)
const presaleReportExportAvailable = computed(() => runtimeCapability('presale_report_export').available)
const canReadPresaleReports = computed(() => (crmSession.value?.permissions || []).includes('presale.report'))
const presaleRequestSubmissionAvailable = computed(() => runtimeCapability('presale_request_submission').available)
const qbLaunchQuotationAvailable = computed(() => runtimeCapability('qb_launch_quotation').available)
const qbLaunchBidAvailable = computed(() => runtimeCapability('qb_launch_bid').available)
const qbActiveQueryMode = computed(() => runtimeCapability('qb_active_query').mode)
const winConfirmationMode = computed(() => runtimeCapability('win_confirmation_local_evidence').available
  ? 'local_evidence' : 'contract')
const contractTransferAvailable = computed(() => {
  const capability = runtimeCapabilities.value?.contract_transfer
  if (capability) return capability.available === true
  // 旧版服务尚无订阅字段，保留已有转单入口；读取失败仍关闭，服务端始终复核。
  return Object.keys(runtimeCapabilities.value).length > 0 && !runtimeCapabilitiesError.value
})
const opportunityWinConfirmation = ref(null)
const opportunityWinConfirmationError = ref('')
const winConfirmationScope = createRequestScope()

// 用途：读取当前商机的真实赢单依据，切换详情后舍弃迟到响应。
// 参数：无；商机和版本取自当前详情。
// 返回值：异步完成，辅助读取失败不会关闭主档或冒充缺少依据。
async function loadOpportunityWinConfirmation() {
  const id = selectedOpportunity.value?.id
  const ticket = winConfirmationScope.begin(`WIN_CONFIRMATION:${id || ''}`)
  opportunityWinConfirmation.value = null
  opportunityWinConfirmationError.value = ''
  if (!id || !Object.hasOwn(runtimeCapabilities.value, 'win_confirmation_local_evidence')) return
  try {
    const detail = await getOpportunityWinConfirmation(id)
    if (winConfirmationScope.isCurrent(ticket)) opportunityWinConfirmation.value = detail
  } catch (failure) {
    if (winConfirmationScope.isCurrent(ticket)) {
      opportunityWinConfirmationError.value = formatCRMError(failure, { fallback: '赢单依据读取失败，请刷新详情核对。' })
    }
  }
}
watch([() => selectedOpportunity.value?.id, () => selectedOpportunity.value?.version,
  runtimeCapabilities], loadOpportunityWinConfirmation)
watch(() => selectedOpportunity.value?.id, () => {
  stageForm.win_evidence = createWinEvidenceForm()
  terminalForm.win_evidence = createWinEvidenceForm()
})


function resetMessages() { error.value = ''; notice.value = '' }
function showError(value) {
  if (value?.code === 'CRM_PRESALE_OPPORTUNITY_NOT_ELIGIBLE') error.value = presaleEligibilityMessage
  else if (value?.code === 'COMMON_VERSION_CONFLICT') error.value = '数据状态或版本已变化，请刷新详情后重试。'
  else if (value?.code === 'CRM_OPPORTUNITY_NOT_FOUND') error.value = '关联商机不存在、已作废或不再属于当前账号的数据范围，请刷新商机列表后重新选择。'
  else if (value?.code === 'CRM_OPPORTUNITY_MEMBER_INVALID') error.value = '所选团队人员已停用或不再具有本应用授权，请重新从基础平台人员目录选择。'
  else if (value?.code === 'CRM_OPPORTUNITY_CATALOG_INVALID') error.value = '商机类型或来源已失效，请重新选择后提交。'
  else if (value?.code === 'CRM_OWNER_DIRECTORY_UNAVAILABLE') error.value = '基础平台人员目录暂不可用；如已提交变更，请先核对结果，避免重复提交。'
  else if (value?.code === 'CRM_PRESALE_ASSIGNEE_NOT_QUALIFIED') {
    const required = Array.isArray(value?.details?.required_permissions) ? value.details.required_permissions.filter(Boolean) : []
    error.value = required.length
      ? `所选人员尚未具备该指派职责所需权限（${required.join('、')}），请先在基础平台授权后再指派。`
      : '所选人员尚未具备该指派职责所需权限，请先在基础平台授权后再指派。'
  }
  else if (value?.code === 'INTEGRATION_CONTRACT_NOT_CONFIGURED') error.value = '合同归属校验服务尚未配置，合同类终态待办暂不能完成。'
  else error.value = formatCRMError(value, { message: subsystemAccessMessage(value, '操作失败，请稍后重试。') })
}
const portalRegistrationContact = computed(() => {
  const contacts = customerContacts.value.length ? customerContacts.value : (selectedCustomer.value?.contacts || [])
  return contacts.find((item) => item.is_registration) || null
})
async function navigate(section) {
  const allowed = { customers: canReadCustomers.value, opportunities: canReadOpportunities.value, presale: canReadPresales.value, notifications: canReadNotifications.value, 'credit-approvals': canApproveCredit.value, 'credit-rules': canManageCreditRules.value }
  if (!allowed[section]) return
  if (activeSection.value === 'presale' && presaleCreatePage.value && !(await confirmDiscardIfDirty(presaleFormDirty.value))) return
  mobileMenuOpen.value = false
  return router.push({ name: 'customer_opportunity', params: { section } })
}
function navigatePlatform() {
  mobileMenuOpen.value = false
  closeSubsystemTabOrFallback(window, () => router.replace({ name: 'portal' }))
}
// 共享外壳只负责渲染侧栏与顶栏骨架：分组顺序、标题、权限可见性与当前页高亮仍由本页决定。
// visible: false 等价于原来的 v-if="hasPermission(...)"，不会渲染成空按钮。
const navGroups = computed(() => [
  {
    label: '业务中心',
    items: [
      { key: 'customers', label: '客户管理', icon: 'user', active: activeSection.value === 'customers', visible: canReadCustomers.value },
      { key: 'opportunities', label: '商机管理', icon: 'dashboard', active: activeSection.value === 'opportunities', visible: canReadOpportunities.value },
      { key: 'presale', label: '售前技术支持', icon: 'organization', active: activeSection.value === 'presale', visible: canReadPresales.value },
      { key: 'credit-approvals', label: '信用审批待办', icon: 'shield', active: activeSection.value === 'credit-approvals', visible: canApproveCredit.value },
      { key: 'credit-rules', label: '信用规则管理', icon: 'settings', active: activeSection.value === 'credit-rules', visible: canManageCreditRules.value },
    ],
  },
  {
    label: '消息中心',
    items: [
      {
        key: 'notifications',
        label: '个人通知',
        icon: 'bell',
        active: activeSection.value === 'notifications',
        visible: canReadNotifications.value,
        // 未读数沿用原来的口径：为 0 时不渲染角标，超过 99 显示 99+。
        note: notificationUnreadCount.value ? (notificationUnreadCount.value > 99 ? '99+' : notificationUnreadCount.value) : '',
        noteClass: 'crm-nav-badge',
      },
    ],
  },
  {
    label: '平台能力',
    items: [{ key: 'portal', label: '返回子系统门户', icon: 'dashboard', anchor: 'subsystem-portal' }],
  },
])
// handleNavigate 把共享外壳抛出的导航键映射到本页既有入口。
// 参数：key 为 navGroups 里的导航键。返回值：无。
function handleNavigate(key) {
  if (key === 'portal') {
    navigatePlatform()
    return
  }
  navigate(key)
}
const isLoggingOut = ref(false)
async function logoutSystem() {
  if (isLoggingOut.value) return
  isLoggingOut.value = true
  try {
    await logoutCurrentSession()
    await router.replace({ name: 'login', query: { reason: 'session-ended' } })
  } catch (value) {
    if (value instanceof AuthError && value.status === 401) {
      await router.replace({ name: 'login', query: { reason: 'session-ended' } })
      return
    }
    showError(value)
  } finally {
    isLoggingOut.value = false
  }
}
const assignmentDiff = computed(() => {
  const current = new Set((selectedPresale.value?.current_assignees || []).map((item) => item.person_id))
  const target = new Set(selectedEngineerIDs.value)
  const names = new Map(engineerDirectory.value.map((item) => [item.person_id, item.person_name]))
  return { added: [...target].filter((id) => !current.has(id)).map((id) => names.get(id) || '未命名人员'), retained: [...target].filter((id) => current.has(id)).map((id) => names.get(id) || '未命名人员'), removed: [...current].filter((id) => !target.has(id)).map((id) => names.get(id) || '未命名人员') }
})
// 当前指派人员不在本次查询结果中时仍保留可见、可撤销的勾选项，避免筛选造成误移出。
const unavailableCurrentAssignees = computed(() => {
  const visible = new Set(engineerDirectory.value.map((item) => item.person_id))
  return (selectedPresale.value?.current_assignees || []).filter((item) => !visible.has(item.person_id))
})
const ownerDirectoryNames = ref({})
function rememberOwnerDirectory(items) {
  for (const item of items || []) {
    const name = platformUserName(item)
    if (item?.user_id && name !== '未命名用户') ownerDirectoryNames.value[item.user_id] = name
  }
}
function rememberCustomerOwnerNames(items) {
  for (const item of items || []) {
    const ownerID = String(item?.owner_user_id || '').trim()
    const ownerName = String(item?.owner_display_name || '').trim()
    if (ownerID && ownerName) ownerDirectoryNames.value[ownerID] = ownerName
  }
}
function ownerLabel(owner) {
  const userId = typeof owner === 'object' ? owner?.owner_user_id : owner
  const displayName = typeof owner === 'object' ? owner?.owner_display_name : ''
  return String(displayName || '').trim() || ownerDirectoryNames.value[userId] || '负责人账号已失效'
}
function operationUserLabel(item) { return usableOperationName(item?.actor_name, item?.actor_id) || ownerLabel(item?.actor_id) }
function operationSubjectLabel(item) { return usableOperationName(item?.subject_name, item?.subject_id) || ownerLabel(item?.subject_id) }

// 列表或详情里的负责人可能不在已加载的目录分页中；按缺失的用户 ID 精确查询并缓存名字，
// 让“负责人”列只显示基础平台姓名。目录暂不可用时显示通用提示，不向业务用户暴露 ID。
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
        // 目录暂不可用时保持通用提示，不影响列表本身。
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(missing.length, 8) }, worker))
}
const reasonDialog = reactive({ open: false, title: '', label: '', required: false, confirmText: '', reason: '', onSubmit: null })
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
function applicantLabel(item) {
  return String(item?.applicant_name || '').trim() || ownerLabel(item?.applicant_id)
}
function presalePersonOptionLabel(item) {
  return String(item?.label || '').trim() || ownerLabel(item?.value)
}

async function openReports() {
  showReport.value = true
  reportError.value = ''
  await loadReportFilterOptions()
  await loadReports()
}

const {
  showReport, reportLoading, reportSummary, reportError, reportTrend, reportDistribution,
  reportParams, reportBarWidth, loadReports, exportReport,
} = usePresaleReportData({
  reportFilters, resetMessages, showError, notice, error, formatCRMError, presaleReportExportAvailable,
  getPresaleReportSummary, getPresaleReportTrend, getPresaleReportDistribution, requestPresaleReportExport,
  loadReportFilterOptions,
})

// 新建/编辑入口保持原名称：编辑态由父层当前选中的客户/商机回填，子组件不自行取数。
function openNewCustomer() {
  resetCustomerEditContacts()
  return customerEditor.openNew()
}
// 用途：弹窗内追加联系人行；补录后“暂无联系人”提示不再成立。
// 参数：无。
// 返回值：无；读取失败（hard block）时不动提示，避免掩盖真实故障。
function addCustomerContact() {
  if (customerEditContactsLoading.value) return
  if (!customerForm.contacts.length && !customerEditContactsLoadFailed.value) customerEditContactsError.value = ''
  customerEditor.addContact()
}
// 用途：打开编辑弹窗，并用服务端权威联系人列表回填提交用的 customerForm.contacts。
// 参数：无；以当前选中客户为目标。
// 返回值：无；联系人加载失败或客户没有联系人时保持弹窗打开但阻止保存。
async function editCustomer() {
  const customer = selectedCustomer.value
  if (!customer || actionLoading.value) return
  const sequence = ++customerEditContactsSequence.value
  customerEditContactsLoading.value = true
  customerEditContactsError.value = ''
  customerEditContactsLoadFailed.value = false
  // 客户详情端点有意省略敏感联系人（见 openCustomerTab 的 portal 注释），
  // 直接沿用详情里的 contacts 会退化成空数组，保存必然被后端
  // "contacts: required,min=1 + 恰好一个 is_registration" 校验拒绝。
  // 因此编辑入口先打开弹窗，再立即用 listCustomerContacts 回填。
  customerEditor.openEdit(customer)
  try {
    const contacts = await listCustomerContacts(customer.id)
    if (sequence !== customerEditContactsSequence.value || !customerDialog.value
      || String(selectedCustomer.value?.id) !== String(customer.id)) return
    customerEditor.fillContacts(contacts || [])
    if (!customerForm.contacts.length) {
      customerEditContactsError.value = '该客户暂无联系人，请先添加并设置注册联系人。'
    }
  } catch (value) {
    if (sequence !== customerEditContactsSequence.value || !customerDialog.value
      || String(selectedCustomer.value?.id) !== String(customer.id)) return
    // 读取失败时清空联系人，避免把详情里的旧值当成当前数据提交。
    customerEditContactsLoadFailed.value = true
    customerEditor.fillContacts([])
    customerEditContactsError.value = `联系人加载失败：${formatCRMError(value, { fallback: '请稍后重试，未保存前不要提交。' })}`
  } finally {
    if (sequence === customerEditContactsSequence.value) customerEditContactsLoading.value = false
  }
}

// 列表行内“编辑”：先走详情对象级权限校验，再打开既有编辑弹窗；
// 校验失败时 openCustomer 已给出原因，不继续打开空表单。
async function editCustomerFromList(item) {
  if (actionLoading.value || !item?.id) return
  await openCustomer(item.id)
  if (String(selectedCustomer.value?.id) === String(item.id)) await editCustomer()
}
// 审批节点展示：服务端结果码只有通过/驳回/其他三种，图标与色块由展示层决定。
function approvalNodeTone(result) {
  const value = String(result || '').toUpperCase()
  if (value === 'PASS' || value === 'APPROVED') return 'is-approved'
  if (value === 'REJECT' || value === 'REJECTED') return 'is-rejected'
  return 'is-pending'
}
function approvalNodeIcon(result) {
  const tone = approvalNodeTone(result)
  return tone === 'is-approved' ? '✓' : tone === 'is-rejected' ? '✕' : '…'
}
function directoryErrorMessage(value) {
  if (value?.status === 403) return '当前账号没有读取平台人员目录的权限。'
  if (value?.code === 'CRM_OWNER_DIRECTORY_UNAVAILABLE' || value?.status === 503) return '基础平台人员目录暂不可用。'
  return formatCRMError(value, { fallback: '平台人员目录加载失败。' })
}

function preserveDirectorySelection(previous, loaded, selectedID) {
  const selected = previous.find((item) => item.user_id === selectedID)
  return selected && !loaded.some((item) => item.user_id === selected.user_id) ? [selected, ...loaded] : loaded
}

// 客户统计的 4 个计数查询共用同一套列表口径（含服务端权限映射），
// 只取 total，不下载列表行；任一请求失败时整组置空并显示“—”，不混用旧值。
async function loadCustomerStats() {
  const sequence = ++customerStatsLoadSequence.value
  customerStats.loading = true
  customerStats.error = ''
  try {
    const base = { page: 1, page_size: 1, sort_by: 'updated_at', sort_order: 'desc' }
    const [all, added, won, due] = await Promise.all([
      listCustomers(base),
      listCustomers({ ...base, quick_filter: 'NEW' }),
      listCustomers({ ...base, quick_filter: 'WON' }),
      listCustomers({ ...base, quick_filter: 'FOLLOWUP_DUE' }),
    ])
    if (sequence !== customerStatsLoadSequence.value) return
    const total = (result) => {
      const value = Number(result?.total)
      return Number.isFinite(value) && value >= 0 ? value : null
    }
    Object.assign(customerStats, { total: total(all), added: total(added), won: total(won), due: total(due), loadedAt: Date.now() })
  } catch {
    if (sequence !== customerStatsLoadSequence.value) return
    Object.assign(customerStats, { total: null, added: null, won: null, due: null, loadedAt: 0, error: '客户统计暂不可用' })
  } finally {
    if (sequence === customerStatsLoadSequence.value) customerStats.loading = false
  }
}
// 统计不是列表主请求：失败不能阻断列表；60 秒内复用上次结果，列表写后刷新也会自然更新。
function maybeLoadCustomerStats() {
  if (customerStats.loading) return
  if (customerStats.loadedAt && Date.now() - customerStats.loadedAt < 60000) return
  void loadCustomerStats()
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
    customerMergeOptionsError.value = formatCRMError(value, { fallback: '可合并客户加载失败，请稍后重试。' })
  } finally {
    if (sequence === customerMergeOptionsLoadSequence.value) customerMergeOptionsLoading.value = false
  }
}

async function loadPresaleOpportunityOptions() {
  const sequence = ++presaleOpportunityOptionsLoadSequence.value
  const ticket = presaleCreateOptionsScope.begin(`PRESALE_CREATE_OPTIONS:${presaleOpportunityKeyword.value.trim()}`)
  presaleOpportunityOptionsLoading.value = true
  presaleOpportunityOptionsError.value = ''
  try {
    const result = await listOpportunities({ keyword: presaleOpportunityKeyword.value.trim(), page: 1, page_size: 100, sort_by: 'updated_at', sort_order: 'desc' })
    if (sequence !== presaleOpportunityOptionsLoadSequence.value || !presaleCreatePage.value || !presaleCreateOptionsScope.isCurrent(ticket)) return
    presaleOpportunityOptions.value = (result?.items || []).filter(isPresaleEligibleOpportunity)
    presaleOpportunityOptionsTotal.value = presaleOpportunityOptions.value.length
    if (presaleForm.opportunity_id && !presaleOpportunityOptions.value.some((item) => String(item.id) === String(presaleForm.opportunity_id))) {
      presaleForm.opportunity_id = ''
    }
  } catch (value) {
    if (sequence !== presaleOpportunityOptionsLoadSequence.value || !presaleCreateOptionsScope.isCurrent(ticket)) return
    presaleOpportunityOptions.value = []; presaleOpportunityOptionsTotal.value = 0
    presaleOpportunityOptionsError.value = formatCRMError(value, { fallback: '可关联商机加载失败，请稍后重试。' })
  } finally {
    if (sequence === presaleOpportunityOptionsLoadSequence.value && presaleCreateOptionsScope.isCurrent(ticket)) presaleOpportunityOptionsLoading.value = false
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

function openNewOpportunity() { return opportunityEditor.openNew() }
function editOpportunity() { return opportunityEditor.openEdit(selectedOpportunity.value) }
// 关联客户下拉的关键字沿用原 v-model.trim 语义：输入即去首尾空白后再查询。
function setOpportunityCustomerKeyword(value) {
  opportunityCustomerKeyword.value = typeof value === 'string' ? value.trim() : ''
}

// reportError=false 供写操作成功后的刷新链使用：读取失败只向调用方返回 false，
// 由调用方给出“已保存，最新数据读取失败”类准确提示，不误报为操作失败。
async function loadCurrent({ reportError = true } = {}) {
  // 切换栏目或筛选时旧请求不会被主动取消，因此用递增序号与栏目快照共同判定
  // 响应归属。只有当前栏目最新一次请求可以写入列表和 loading 状态。
  const sequence = ++currentLoadSequence.value
  const section = activeSection.value
  loading.value = true; error.value = ''; listError.value = ''
  let loaded = false
  try {
    if (section === 'customers') {
	  maybeLoadCustomerStats()
	  // 客户可见范围由服务端按当前身份重新计算。开始新查询时先清空旧结果，
	  // 请求失败后也不能回显上一账号或上一授权修订下的客户列表。
	  // 分页条不在这里预写页码/总数：请求进行中由 loading 显示“正在加载…”，
	  // 否则会在翻到第 3 页或点“查询”时先闪一下“第 1 页，共 0 条”。
	  customers.value = []
	  page.total = 0
	  await syncCustomerURL()
      const result = await listCustomers(customerAPIParams(customerFilters, page.number, page.size))
      if (sequence !== currentLoadSequence.value || activeSection.value !== section) return
      customers.value = result?.items || []; rememberCustomerOwnerNames(customers.value); page.total = Number(result?.total || 0)
      Object.assign(renderedPage, { number: page.number, size: page.size, total: page.total })
      void resolveOwnerNames(customers.value.map((item) => item.owner_user_id))
    } else if (section === 'opportunities') {
      // 商机与客户、通知共用同一个 page 对象：进入商机区先清掉上一个栏目留下的总数。
      // 与客户分支一致，同时清空旧列表，避免请求失败时把上一筛选/上一页的商机当成本次结果回显。
      page.total = 0
      if (boardMode.value) {
        const result = await getOpportunityBoard({ keyword: filters.keyword })
        if (sequence !== currentLoadSequence.value || activeSection.value !== section) return
        board.value = result || []
        void resolveOwnerNames(board.value.flatMap((column) => column?.items || []).map((item) => item?.owner_user_id))
      } else {
        opportunities.value = []
        const result = await listOpportunities({ keyword: filters.keyword, status: filters.status, stage: filters.stage, page: page.number, page_size: page.size })
        if (sequence !== currentLoadSequence.value || activeSection.value !== section) return
        opportunities.value = result?.items || []; page.total = Number(result?.total || 0)
        Object.assign(renderedPage, { number: page.number, size: page.size, total: page.total })
        void resolveOwnerNames(opportunities.value.map((item) => item.owner_user_id))
      }
    } else if (section === 'presale') {
      await syncPresaleURL()
      if (sequence !== currentLoadSequence.value || activeSection.value !== section) return
      const params = presaleAPIParams(presaleFilters)
      // 请求作用域票据绑定当前视图/分页/筛选：翻页、改筛选或重查后，旧列表响应整体失效。
      const listTicket = presaleListScope.begin(`PRESALE_LIST:${presaleView.value}:${presalePage.number}:${presalePage.size}:${stableQuery(params)}`)
      if (presaleView.value === 'board') {
        presaleBoard.value = []
        const result = await getPresaleBoard({ ...params, column_limit: presaleColumnLimit.value })
        if (sequence !== currentLoadSequence.value || activeSection.value !== section || !presaleListScope.isCurrent(listTicket)) return
        presaleBoard.value = result?.columns || []
        presaleStatsColumns.value = result?.columns || null
        presaleColumnLimit.value = Number(result?.column_limit || presaleColumnLimit.value)
        presales.value = []; presalePage.total = 0
      } else {
        presales.value = []; presalePage.total = 0
        const result = await listPresaleRequests({ ...params, page: presalePage.number, page_size: presalePage.size })
        if (sequence !== currentLoadSequence.value || activeSection.value !== section || !presaleListScope.isCurrent(listTicket)) return
        presales.value = result?.items || []
        void resolveOwnerNames(presales.value.flatMap((item) => [item.applicant_id, ...(item.current_assignees || []).map((assignee) => assignee.person_id)]))
        presalePage.number = Number(result?.page || presalePage.number)
        presalePage.size = Number(result?.page_size || presalePage.size)
        presalePage.total = Number(result?.total || 0)
        presaleBoard.value = []
        void loadPresaleStats(params)
      }
      void loadPresaleFilterOptions(params)
    } else if (section === 'credit-approvals' || section === 'credit-rules') {
      // CreditApprovalInbox 自行管理分页查询，仅在当前区域可见时加载。
    } else if (section === 'notifications') {
      await loadNotifications()
    }
    loaded = true
  } catch (value) {
    // 列表在请求开始时就已清空，读取失败时屏幕上没有这些行：分页条必须同步成空结果，
    // 否则会残留上一次成功加载的“第 N 页，共 M 条”。这里发生在请求结束之后，不产生闪烁。
    if (sequence === currentLoadSequence.value && activeSection.value === section
      && (section === 'customers' || (section === 'opportunities' && !boardMode.value))) {
      Object.assign(renderedPage, { number: 1, size: page.size, total: 0 })
    }
    if (sequence === currentLoadSequence.value && activeSection.value === section) {
      // 失败必须落在列表位置上（ErrorState + 重试），不能回落成空状态。
      if (reportError) showError(value)
      listError.value = reportError ? error.value : formatCRMError(value, { message: subsystemAccessMessage(value, '列表读取失败，请稍后重试。') })
    }
  } finally {
    if (sequence === currentLoadSequence.value) loading.value = false
  }
  return loaded
}

// 三态闸门的展示条件：加载中 / 请求失败 / 没有记录时由 ListState 接管，
// 数据区只在三种情况都不成立时渲染，避免「失败」和「空」共用同一段文案。
const customersListState = computed(() => loading.value || Boolean(listError.value) || !customers.value.length)
const opportunitiesListState = computed(() => loading.value || Boolean(listError.value) || !opportunities.value.length)
const presaleListState = computed(() => loading.value || Boolean(listError.value) || !presales.value.length)
const notificationsListState = computed(() => loading.value || Boolean(listError.value) || !notifications.value.length)
// 看板同样是「列表」：加载中 / 失败 / 空都要先过闸门。看板模式下 listError 不是列表分支的
// 私有状态——请求失败时必须显示错误 + 重试，不能把空列渲染成「暂无任务」让用户以为真的没有任务。
const opportunityBoardState = computed(() => loading.value || Boolean(listError.value) || !board.value.length)
const presaleBoardState = computed(() => loading.value || Boolean(listError.value) || !presaleBoard.value.length)

// 空状态里的「重置筛选」：回到第 1 页并按当前栏目重新请求；
// 客户列表保留用户选定的表格 / 卡片视图，不因为重置筛选被切回表格。
function resetCustomerFilters() {
  Object.assign(customerFilters, { ...customerFiltersFromQuery({}), view: customerFilters.view })
  page.number = 1
  void loadCurrent()
}
function resetOpportunityFilters() {
  Object.assign(filters, { keyword: '', status: '', stage: '', overdue: '' })
  page.number = 1
  void loadCurrent()
}
function resetPresaleFilters() {
  Object.assign(presaleFilters, presaleStateFromQuery({}).filters)
  presalePage.number = 1
  void loadCurrent()
}

// 页签读取失败后的重试：项目历史走自己的分页加载，其余页签重新进入即可重发请求。
function retryCustomerTab() {
  const tab = customerTab.value
  delete customerTabErrors[tab]
  if (tab === 'projects') void loadCustomerProjectPage(customerProjectsPage.number)
  else void openCustomerTab(tab)
}

async function syncPresaleURL() {
  const query = presaleStateToQuery(presaleFilters, presaleView.value, presalePage.number, presalePage.size, presaleColumnLimit.value)
  const current = Object.fromEntries(Object.entries(route.query).map(([key, value]) => [key, Array.isArray(value) ? String(value[0] || '') : String(value || '')]))
  if (stableQuery(current) !== stableQuery(query)) await router.replace({ name: route.name, params: route.params, query })
}

async function loadPresaleFilterOptions(params = presaleAPIParams(presaleFilters)) {
  const sequence = ++presaleFilterOptionsLoadSequence.value
  const ticket = presaleFilterOptionsScope.begin(`PRESALE_FILTER_OPTIONS:${stableQuery(params)}`)
  presaleFilterOptionsError.value = ''
  try {
    const value = await getPresaleFilterOptions(params)
    if (sequence !== presaleFilterOptionsLoadSequence.value || activeSection.value !== 'presale' || !presaleFilterOptionsScope.isCurrent(ticket)) return
    presaleFilterOptions.value = {
      opportunities: value?.opportunities || [], applicants: value?.applicants || [], assignees: value?.assignees || [],
      statuses: value?.statuses || [], venues: value?.venues || [], urgencies: value?.urgencies || [],
      push_statuses: value?.push_statuses || [], truncated: Boolean(value?.truncated),
    }
  } catch {
    if (sequence !== presaleFilterOptionsLoadSequence.value || activeSection.value !== 'presale' || !presaleFilterOptionsScope.isCurrent(ticket)) return
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
// 列表视图下只取每列 1 条卡片来计算统计，服务端仍返回未截断的列总数。
async function loadPresaleStats(params) {
  const sequence = ++presaleStatsLoadSequence.value
  try {
    const result = await getPresaleBoard({ ...params, column_limit: 1 })
    if (sequence !== presaleStatsLoadSequence.value || activeSection.value !== 'presale') return
    presaleStatsColumns.value = result?.columns || []
  } catch {
    if (sequence !== presaleStatsLoadSequence.value || activeSection.value !== 'presale') return
    // 统计失败不影响列表展示；统计卡显示“—”，不伪造 0。
    presaleStatsColumns.value = null
  }
}
function usePresaleStatusFilter(value) {
  if (presaleFilters.status === value) return
  presaleFilters.status = value
  presalePage.number = 1
  void loadCurrent()
}

async function openPresaleCreatePage() {
  if (!canCreatePresale.value || !presaleRequestSubmissionAvailable.value) return
  presaleReopenRequest.value = null
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

async function closePresaleCreatePage() {
  if (presaleCreateLoading.value) return
  if (!(await confirmDiscardIfDirty(presaleFormDirty.value)) || presaleCreateLoading.value) return
  presaleOpportunityOptionsLoadSequence.value += 1
  presaleCreateOptionsScope.invalidate()
  presaleCreatePage.value = false
  presaleReopenRequest.value = null
  presaleFormInitial = ''
  resetMessages()
}

async function submitPresaleFromList() {
  const value = await submitPresale({ openDetail: false, refreshList: false })
  if (!value) return
  presaleFormInitial = JSON.stringify(presaleForm)
  await closePresaleCreatePage()
  notifyWithReference('售前申请已提交，已返回申请列表。', value?.request_no || '')
  presalePage.number = 1
  // 任务 B：受理已成功；列表刷新失败只提示读取失败，不误报为提交失败。
  if (!(await loadCurrent({ reportError: false }))) {
    error.value = '售前申请已提交，但最新列表读取失败，请刷新列表核对结果。'
  }
}

async function changePresalePage(nextPage) {
  if (presaleView.value !== 'list' || nextPage < 1) return
  presalePage.number = nextPage
  await loadCurrent()
}

// 客户列表与商机列表共用服务端 page.number/page.size；翻页必须在允许区间内，
// 避免越界页把空结果当成“没有数据”。
async function changeCustomerPage(nextPage) {
  if (activeSection.value !== 'customers' || nextPage < 1 || loading.value) return
  page.number = nextPage
  await loadCurrent()
}

async function changeOpportunityPage(nextPage) {
  if (activeSection.value !== 'opportunities' || boardMode.value || nextPage < 1 || loading.value) return
  page.number = nextPage
  await loadCurrent()
}

// 切换每页条数时原页码大概率越界，统一回到第 1 页再请求；
// 两个列表共用服务端 page 对象，但只允许操作各自可见区的分页条。
async function changeCustomerPageSize(size) {
  if (activeSection.value !== 'customers' || loading.value) return
  const next = Math.trunc(Number(size) || 0)
  if (next <= 0 || next === page.size) return
  page.size = next
  page.number = 1
  await loadCurrent()
}

async function changeOpportunityPageSize(size) {
  if (activeSection.value !== 'opportunities' || boardMode.value || loading.value) return
  const next = Math.trunc(Number(size) || 0)
  if (next <= 0 || next === page.size) return
  page.size = next
  page.number = 1
  await loadCurrent()
}

// 任一筛选条件变化都回到第一页：否则沿用旧页码会落在新结果集之外。
// view 只是列表/卡片展示方式，不参与查询，切换时保留当前页。
watch(() => {
  const queryFilters = { ...customerFilters }
  delete queryFilters.view
  return JSON.stringify(queryFilters)
}, () => { page.number = 1 })

watch(() => JSON.stringify(filters), () => { page.number = 1 })

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
  // 切换客户时立即隐藏上一份详情；新详情必须通过服务端对象级权限校验后才展示。
  if (String(selectedCustomer.value?.id || '') !== String(id)) selectedCustomer.value = null
  try {
	  const detail = await getCustomer(id)
	  if (sequence !== customerDetailLoadSequence.value) return
	  selectedCustomer.value = detail; rememberCustomerOwnerNames([detail]); customerTab.value = 'basic'
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
	  if (sequence !== customerDetailLoadSequence.value) return
	  if (value?.status === 403 || value?.status === 404) {
	    closeCustomerDetail()
	    error.value = value.status === 403 ? '当前账号无权查看该客户，详情已关闭。' : '客户不存在或已不在当前账号的可见范围内，详情已关闭。'
	    return
	  }
	  showError(value)
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
			: value?.status === 403 ? '无权查看此页签。' : formatCRMError(value, { fallback: '页签数据加载失败。' })
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
			void resolveOwnerNames(customerAuditLogs.value.map((item) => item.actor_id))
		}
		if (tab === 'portal') {
			// 客户详情端点有意省略敏感联系人。
			// 进入门户时加载联系人，避免因尚未打开联系人页签，
			// 而将注册联系人错误地显示为未配置，
			// 并禁用邀请操作。
			if (!customerTabLoaded.contacts) {
				const contacts = await listCustomerContacts(customerID)
				if (sequence !== customerTabLoadSequence.value || selectedCustomer.value?.id !== customerID || customerTab.value !== tab) return
				customerContacts.value = contacts || []
				customerTabLoaded.contacts = true
			}
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
		else customerTabErrors[tab] = formatCRMError(value, { fallback: '页签数据加载失败。' })
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
		const activationURL = validatePortalInviteResult(result)
		if (!activationURL) {
			// 不能把“任务已完成但响应缺少 Bearer 链接”当作可交付成功。保留同一
			// 幂等键，待接口恢复后重放同一 Saga，避免重发操作撤销当前有效邀请。
			try { currentPortalInvite.value = await getCurrentPortalInvite(selectedCustomer.value.id) } catch { /* 状态查询失败不覆盖本次协议异常。 */ }
			customerTabErrors.portal = '邀请流程可能已完成，但服务端响应未携带可交付的一次性链接。请勿刷新或重发邀请；本页会复用同一请求重试。'
			return
		}
		portalActivationURL.value = activationURL
		portalInviteRetries.confirmSuccess(retry.signature, retry.key)
		try { currentPortalInvite.value = await getCurrentPortalInvite(selectedCustomer.value.id) }
		catch { currentPortalInvite.value = result }
		notice.value = 'Portal 邀请已由服务端确认生成。链接仅在当前页面内存中临时显示，请安全发送给登记联系人。'
	} catch (value) {
		if (value?.status === 503) customerTabErrors.portal = '正式外部身份预置、Portal 角色分配或映射 Provider 当前不可用（503）。未展示虚假邀请；本页会复用同一 Idempotency-Key 重试。'
		else if (value?.status === 404) customerTabErrors.portal = 'Portal 邀请路由未启用；请先由运维配置正式外部身份 Provider 后启用该能力。'
		else if (value?.code === 'CRM_PORTAL_INVITE_CONTACT_INVALID') customerTabErrors.portal = '必须存在唯一且联系方式有效的登记联系人。'
		else customerTabErrors.portal = formatCRMError(value, { fallback: 'Portal 邀请生成失败；结果不明确时请在本页直接重试。' })
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
		else customerTabErrors.portal = formatCRMError(value, { fallback: '撤销失败。' })
	} finally { portalInviteLoading.value = false }
}

// 用途：确认禁用当前客户门户，复核确认期间的客户、权限与原因后执行。
// 参数：无。
// 返回值：无；取消或上下文变化不执行，失败显示可重试状态。
async function disableCurrentPortalAccess() {
	if (!selectedCustomer.value || portalAccessDisableLoading.value ||
		!canDisablePortalAccount.value || !portalDisableAvailable.value) return
	const customer = selectedCustomer.value
	const customerID = customer.id
	const reason = portalAccessDisableReason.value.trim()
	if (!reason) return
	const confirmed = await askConfirm({
		title: '禁用门户访问',
		description: '确认禁用该客户的门户访问？这会立即退出全部 Portal 会话，并回收基础平台 Portal 角色；撤销邀请是另一项操作。',
		confirmText: '禁用门户访问', danger: true,
	})
	if (!confirmed || selectedCustomer.value !== customer || customer.id !== customerID ||
		portalAccessDisableLoading.value || !canDisablePortalAccount.value ||
		!portalDisableAvailable.value || portalAccessDisableReason.value.trim() !== reason) return
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
		else customerTabErrors.portal = formatCRMError(value, { fallback: '禁用门户访问失败。' })
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
	try {
		const result = await requestCustomerExport({ filters: customerAPIParams(customerFilters, 1, page.size) })
		const blob = result.blob
		const url = URL.createObjectURL(blob)
		const anchor = document.createElement('a')
		anchor.href = url; anchor.download = result.filename || 'customers.csv'; anchor.click()
		URL.revokeObjectURL(url)
		notice.value = '客户导出已完成，文件仅在本次响应中生成。'
	}
	catch (value) {
		showError(value)
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
// 用途：确认合并已核对的两个客户，阻止弹窗等待期间变更目标或版本后误提交。
// 参数：无。
// 返回值：无；取消或上下文变化不提交，失败显示业务阻断原因。
async function submitCustomerMerge() {
  if (!selectedCustomer.value || !customerMergeDialog.value ||
    actionLoading.value || !canMergeCustomer.value) return
  resetMessages()
  if (!customerMergeForm.target || Number(customerMergeForm.target.id) !== Number(customerMergeForm.target_customer_id)) {
    error.value = '请先加载并核对目标客户。'; return
  }
  const source = selectedCustomer.value
  const target = customerMergeForm.target
  const payload = {
    source_customer_id: Number(source.id), target_customer_id: Number(target.id),
    source_version: Number(source.version), target_version: Number(target.version),
    reason: customerMergeForm.reason,
  }
  const confirmed = await askConfirm({
    title: '合并客户',
    description: `确认把“${source.name}”合并到“${target.name}”？该操作不可在本期反向恢复。`,
    confirmText: '合并客户', cancelText: '保留独立客户', danger: true,
  })
  if (!confirmed || !customerMergeDialog.value || actionLoading.value || !canMergeCustomer.value ||
    selectedCustomer.value !== source || customerMergeForm.target !== target ||
    Number(source.id) !== payload.source_customer_id ||
    Number(source.version) !== payload.source_version ||
    Number(target.id) !== payload.target_customer_id ||
    Number(target.version) !== payload.target_version ||
    Number(customerMergeForm.target_customer_id) !== payload.target_customer_id ||
    customerMergeForm.reason !== payload.reason) return
  actionLoading.value = true
  try {
    const result = await mergeCustomers(payload)
    customerMergeDialog.value = false; selectedCustomer.value = null
    const counts = result.migrated_counts || {}
    notice.value = `客户合并完成：迁移 ${counts.contacts || 0} 个联系人、${counts.followups || 0} 条沟通、${counts.opportunities || 0} 个商机和 ${counts.portal_invites || 0} 条邀请。`
    customerStats.loadedAt = 0
    await loadCurrent()
  } catch (value) {
    if (value?.code === 'CRM_CUSTOMER_MERGE_BLOCKED') {
      const blockers = value.details?.blockers || []
      error.value = `合并已安全阻断：${blockers.map((item) => `${item.message}（${item.count}）`).join('；') || '存在不可原子迁移的关联。'}`
    } else showError(value)
  } finally { actionLoading.value = false }
}
async function openOpportunity(id) {
  const loadSequence = ++opportunityDetailLoadSequence.value
  selectedOpportunity.value = null
  selectedOpportunityCustomerCredit.value = null
  selectedOpportunityOwnerOrgID.value = ''
  stageHistory.value = []
  followups.value = []
  opportunityTeam.value = []
  opportunityTeamDirectoryAvailable.value = true
  opportunityMemberTerms.value = []
  opportunityMemberTermsError.value = ''
  opportunityMemberTermsPage.number = 1
  opportunityMemberTermsPage.total = 0
  opportunityMemberTermsLoading.value = false
  opportunityExternalStatus.value = null
  opportunityQuoteAmountCheck.value = null
  opportunityExternalStatusError.value = ''
  opportunityPresales.value = []
  opportunityPresaleError.value = ''
  opportunityPresalePage.number = 1
  opportunityPresalePage.total = 0
  opportunityAttachments.value = []
  opportunityAttachmentCapabilities.value = null
  opportunityAttachmentError.value = ''
  opportunityAttachmentLoading.value = false
  try {
    // 主档、阶段、跟进和当前团队组成首屏一致快照；任期、附件、外部状态和售前依赖
    // 随后独立加载，任一可选依赖失败都不应关闭商机基本详情。
    const [detail, history, records, team] = await Promise.all([getOpportunity(id), getOpportunityStageHistory(id, { page: 1, page_size: 50 }), listOpportunityFollowups(id, { page: 1, page_size: 50 }), getOpportunityMembers(id)])
    if (loadSequence !== opportunityDetailLoadSequence.value) return
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
      const message = '商机详情返回异常，请返回列表重试。'
      error.value = message
      throw new Error(message)
    }
    selectedOpportunityOwnerOrgID.value = detail?.owner_org_id || ''
    selectedOpportunity.value = { ...detail, owner_org_id: '基础平台组织' }; stageHistory.value = history?.items || []; followups.value = records?.items || []; opportunityTeam.value = team?.members || []; opportunityTeamDirectoryAvailable.value = team?.directory_available !== false
    // 信用信息只是签约前的风险提示，读取失败不能阻断商机详情或阶段推进。
    void getCustomer(detail.customer_id).then((customer) => {
      if (loadSequence === opportunityDetailLoadSequence.value && Number(customer?.id) === Number(detail.customer_id)) selectedOpportunityCustomerCredit.value = customer
    }).catch(() => {})
    void resolveOwnerNames([detail?.owner_user_id])
    opportunityMemberTerms.value = []; opportunityMemberTermsError.value = ''; opportunityMemberTermsPage.number = 1; opportunityMemberTermsPage.total = 0
    void loadOpportunityMemberTerms(id, 1)
    opportunityExternalStatus.value = null; opportunityQuoteAmountCheck.value = null; opportunityExternalStatusError.value = ''; void loadOpportunityExternalStatus(id)
    opportunityAttachments.value = []; opportunityAttachmentCapabilities.value = null; opportunityAttachmentError.value = ''
    if (canReadOpportunityAttachments.value) void loadOpportunityAttachments(id)
    opportunityPresales.value = []; opportunityPresaleError.value = ''; opportunityPresalePage.number = 1; opportunityPresalePage.total = 0
    void loadOpportunityPresales()
  } catch (value) {
    if (loadSequence !== opportunityDetailLoadSequence.value) return
    if (!error.value) showError(value)
  }
}

async function loadOpportunityMemberTerms(opportunityID = selectedOpportunity.value?.id, page = opportunityMemberTermsPage.number) {
	if (!opportunityID) return
	const loadToken = opportunityMemberTermLoads.begin(opportunityID)
  opportunityMemberTermsLoading.value = true; opportunityMemberTermsError.value = ''
  try {
    const result = await listOpportunityMemberTerms(opportunityID, { page, page_size: opportunityMemberTermsPage.size })
		if (opportunityMemberTermLoads.isCurrent(loadToken, selectedOpportunity.value?.id)) {
      opportunityMemberTerms.value = result?.items || []
      void resolveOwnerNames((result?.items || []).flatMap((item) => [item.user_id, item.started_by, item.ended_by]))
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

// 用途：按服务端能力校验所选附件，不合规时提示并放弃本次选择。
// 参数：file 为待校验文件。
// 返回值：通过（或尚未拿到能力）时为 true；不合规时写入错误并返回 false。
function acceptOpportunityAttachment(file) {
  const capability = opportunityAttachmentCapabilities.value
  if (!file || !capability?.upload_available) return true
  const verdict = validateOpportunityAttachment(file, capability)
  if (verdict.ok) return true
  opportunityAttachmentError.value = verdict.message
  return false
}
function selectOpportunityAttachment(event) {
  const file = event.target.files?.[0] || null
  if (!acceptOpportunityAttachment(file)) { event.target.value = ''; opportunityAttachmentFile.value = null; return }
  opportunityAttachmentError.value = ''
  opportunityAttachmentFile.value = file
}
async function sha256File(file) { const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('') }
async function uploadOpportunityAttachment() {
  const opportunityID = selectedOpportunity.value?.id; const file = opportunityAttachmentFile.value; const capability = opportunityAttachmentCapabilities.value
  if (!opportunityID || !file || !canUploadOpportunityAttachments.value || !capability?.upload_available || opportunityAttachmentLoading.value) return
  // 上传前按服务端返回的 max_size_bytes / allowed_mime_types 校验：不通过直接提示，
  // 不创建上传会话、不计算摘要、不发起任何网络请求。
  const verdict = validateOpportunityAttachment(file, capability)
  if (!verdict.ok) { opportunityAttachmentError.value = verdict.message; return }
  opportunityAttachmentLoading.value = true; opportunityAttachmentError.value = ''
  try {
    // 上传拆为“创建受控会话—直传对象存储—服务端确认”三步，每一步使用稳定状态恢复。
    // 浏览器只接受无凭据、无片段的 HTTPS 地址，确认后文件仍须文件校验通过才能下载。
    const payload = { file_name: file.name, size_bytes: file.size, mime_type: file.type, sha256: await sha256File(file) }
    const flow = attachmentUploadRetries.flowFor(opportunityID, payload)
    if (!flow.session) {
      const session = await createOpportunityAttachmentUpload(opportunityID, flow.payload, flow.createKey)
      attachmentUploadRetries.confirmCreate(flow, session)
    }
    if (!flow.uploaded) {
      if (flow.session.upload_mode === 'INTERNAL') {
        await uploadOpportunityAttachmentContent(opportunityID, flow.session.attachment.id, file)
      } else {
        const target = new URL(flow.session.upload_url)
        if (target.protocol !== 'https:' || target.username || target.password || target.hash) throw new Error('上传地址不安全')
        const uploaded = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': flow.payload.mime_type }, credentials: 'omit', redirect: 'error' })
        if (!uploaded.ok) throw new Error('对象存储上传失败')
      }
      attachmentUploadRetries.markUploaded(flow)
    }
    await completeOpportunityAttachmentUpload(opportunityID, flow.session.attachment.id, { version: flow.session.attachment.version }, flow.completeKey)
    attachmentUploadRetries.confirmComplete(flow)
    opportunityAttachmentFile.value = null; notice.value = '附件已上传并完成静态文件校验；文件校验通过前不能下载。'
    await loadOpportunityAttachments(opportunityID)
  } catch (value) { opportunityAttachmentError.value = value?.code === 'CRM_OPPORTUNITY_ATTACHMENT_UNAVAILABLE' ? '可信文件存储或安全校验尚未配置，上传已安全关闭。' : (formatCRMError(value, { fallback: '附件上传失败。' })) }
  finally { opportunityAttachmentLoading.value = false }
}
function opportunityAttachmentStatusText(value) { return ({ PENDING_UPLOAD:'等待上传', FINALIZING:'正在校验上传', SCANNING:'文件校验中', CLEAN:'文件校验通过', REJECTED:'检测到风险，已拒绝', SCAN_FAILED:'文件校验失败，禁止下载' })[value] || '未知状态' }
async function downloadTrustedOpportunityAttachment(item) {
  if (!canDownloadOpportunityAttachments.value || !opportunityAttachmentCapabilities.value?.download_available || (item.file_status !== 'READY' && item.scan_status !== 'CLEAN')) return
  opportunityAttachmentError.value = ''
  try { const { blob, filename } = await downloadOpportunityAttachment(selectedOpportunity.value.id, item.id, item.file_name); const href = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = href; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(href) }
  catch (value) { opportunityAttachmentError.value = formatCRMError(value, { fallback: '附件下载失败。' }) }
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
    // SEC-X2：launch_url 由服务端签发，但打开前仍须过 scheme 白名单（复用
    // login-targets 的 isValidTargetUri + 同源 http(s) 收敛），拦截 javascript:/data: 等
    // 会以本页面源执行的伪 URL；拒绝时给出明确业务错误而不是静默失败。
    if (!isSafeOpenTarget(target.toString(), window.location.origin)) {
      opportunityLaunchError.value = '调起地址未通过安全校验，已阻止打开。'
      return
    }
    window.open(target.toString(), '_blank', 'noopener,noreferrer')
  } catch (value) {
    opportunityLaunchError.value = value?.code === 'INTEGRATION_QB_LAUNCH_NOT_CONFIGURED' ? '报价/投标调起尚未配置。' : (formatCRMError(value, { fallback: '报价/投标调起失败。' }))
  } finally { opportunityLaunchLoading.value = '' }
}

// 用途：确认将当前商机转交合同系统，成功仅表示进入可靠投递链。
// 参数：无。
// 返回值：无；提交失败展示错误，不把已受理写成合同已创建。
function submitContractTransfer() {
  if (!selectedOpportunity.value || contractTransferLoading.value || !canTransferOpportunity.value) return
  if (!contractTransferAvailable.value) {
    showError(new Error('当前未订阅转合同联动，未创建转交任务。'))
    return
  }
  const opportunity = selectedOpportunity.value
  askReason({
    title: '转交合同系统',
    label: '转合同原因',
    required: true,
    confirmText: '转交合同系统',
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
  if (!selectedOpportunity.value || !canCreatePresale.value) return
  if (!isPresaleEligibleOpportunity(selectedOpportunity.value)) {
    error.value = presaleEligibilityMessage
    return
  }
  resetMessages()
  Object.assign(presaleForm, {
    opportunity_id: String(selectedOpportunity.value.id), venue: 'REMOTE', service_address: '',
    contact_name: '', contact_phone: '', description: '', expected_start: '', expected_end: '', urgency: 'NORMAL',
  })
  presaleCreateDialog.value = true
}

async function reopenPresaleApproval() {
  const request = selectedPresale.value?.request
  if (!request || !canCreatePresale.value || !presaleRequestSubmissionAvailable.value) return
  resetMessages()
  presaleReopenRequest.value = { id: request.id, version: request.version, request_no: request.request_no }
  Object.assign(presaleForm, {
    opportunity_id: String(request.opportunity_id || ''), venue: request.venue || 'REMOTE', service_address: request.service_address || '',
    contact_name: request.contact_name || '', contact_phone: '', description: request.description || '',
    expected_start: instantToBusinessWallClock(request.expected_start),
    expected_end: instantToBusinessWallClock(request.expected_end), urgency: request.urgency || 'NORMAL',
  })
  selectedPresale.value = null
  presaleCreatePage.value = true
  presaleOpportunityKeyword.value = ''
  presaleOpportunityOptions.value = []
  presaleOpportunityOptionsTotal.value = 0
  presaleOpportunityOptionsError.value = ''
  presaleFormInitial = JSON.stringify(presaleForm)
  await loadPresaleOpportunityOptions()
  if (!presaleForm.opportunity_id) error.value = presaleEligibilityMessage
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
    error.value = '售前内部流程当前不可用，暂不能提交申请。'
  }
}

async function submitOpportunityPresale() {
  const opportunityID = selectedOpportunity.value?.id
  if (!opportunityID || Number(presaleForm.opportunity_id) !== Number(opportunityID)) {
    error.value = '商机上下文已变化，请关闭申请窗口后重试。'; return
  }
  if (!isPresaleEligibleOpportunity(selectedOpportunity.value)) {
    error.value = presaleEligibilityMessage; return
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
  const events = {
    PRESALE_APPROVAL_PENDING: '审批待处理',
    PRESALE_APPROVAL_APPROVED: '审批通过',
    PRESALE_APPROVAL_REJECTED: '审批驳回',
    PRESALE_EXECUTOR_ASSIGNMENT_PENDING: '执行指派待处理',
    PRESALE_EXECUTION_ASSIGNMENT_REJECTED: '团队负责人拒绝执行指派',
    PRESALE_TEAM_LEAD_INVALID: '团队负责人失效',
    PRESALE_ASSIGNEE_ADDED: '人员指派',
    PRESALE_ASSIGNEE_REMOVED: '人员移除',
    OPPORTUNITY_OWNER_CHANGED: '负责人变更',
    CREDIT_RULE_CHANGED: '信用规则调整',
    CREDIT_RULE_CAP_REACHED: '信用规则命中边界',
    CREDIT_APPLICATION_PENDING: '信用调整待审批',
    CREDIT_APPLICATION_APPROVED: '信用调整已通过',
    CREDIT_APPLICATION_REJECTED: '信用调整已驳回',
    CREDIT_APPLICATION_INVALIDATED: '信用调整已失效',
  }
  const reference = item.request_no || item.opportunity_no || (item.customer_id ? `客户 #${item.customer_id}` : '业务通知')
  return `${events[item.type] || '业务事件'} · ${reference} · ${labels[item.recipient_kind] || '收件人'}`
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
  const requestedTab = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab
  if (selectedCustomer.value?.id === id) {
    if (requestedTab === 'credit') await openCustomerTab('credit')
    return
  }
  // 查询参数只用于导航，客户可见性和数据范围仍由详情接口判定。
  await openCustomer(id)
  if (requestedTab === 'credit') await openCustomerTab('credit')
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
  Object.assign(ownerForm, { owner_user_id: selectedOpportunity.value.owner_user_id, owner_org_id: selectedOpportunityOwnerOrgID.value, reason: '' })
  ownerDialog.value = true
}
function teamDirectoryUser(member) {
  const userID = typeof member === 'string' ? member : member?.user_id
  return teamDirectoryOptions.value.find((item) => item.user_id === userID) || (typeof member === 'object' ? member : null)
}
function teamMemberName(member) {
  return platformUserName(teamDirectoryUser(member))
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
    selectedOpportunityOwnerOrgID.value = ownerForm.owner_org_id
    selectedOpportunity.value = { ...(await changeOpportunityOwner(selectedOpportunity.value.id, { ...ownerForm, version: selectedOpportunity.value.version })), owner_org_id: '基础平台组织' }
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
async function loadPresaleCore(id, { clearResult = true, reportError = true } = {}) {
  const sequence = ++presaleDetailLoadSequence.value
  const ticket = presaleDetailScope.begin(`PRESALE_REQUEST:${id}`)
  try {
    const [detail, logs] = await Promise.all([getPresaleRequest(id), listWorklogs(id)])
    if (sequence !== presaleDetailLoadSequence.value || !presaleDetailScope.isCurrent(ticket)) return false
    selectedPresale.value = detail; worklogs.value = logs || []; operation.worklog_id = logs?.[0]?.id ? String(logs[0].id) : ''
    if (clearResult) presaleResult.value = null
    return true
  } catch (value) {
    if (reportError && sequence === presaleDetailLoadSequence.value && presaleDetailScope.isCurrent(ticket)) showError(value)
    return false
  }
}
async function refreshPresaleActions(id) {
  const sequence = ++presaleActionsLoadSequence.value
  const ticket = presaleActionsScope.begin(`PRESALE_REQUEST:${id}`)
  presaleActionsLoading.value = true; presaleActionsError.value = ''
  try {
    const value = await getPresaleAvailableActions(id)
    if (sequence !== presaleActionsLoadSequence.value || !presaleActionsScope.isCurrent(ticket) || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    presaleAvailableActions.value = value
  } catch {
    if (sequence !== presaleActionsLoadSequence.value || !presaleActionsScope.isCurrent(ticket) || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    // 权威动作接口失败时关闭全部写按钮，不回退使用详情中可能已经过期的动作快照。
    // 失败时关闭全部写操作控件，明确不使用 detail.available_actions 兜底。（测试锚点：detail.available_actions is intentionally not used as a fallback）
    presaleAvailableActions.value = null
    presaleActionsError.value = '可用操作暂时无法加载，已安全关闭操作入口。'
  } finally {
    if (sequence === presaleActionsLoadSequence.value && presaleActionsScope.isCurrent(ticket)) presaleActionsLoading.value = false
  }
}
async function refreshPresaleTimeline(id) {
  const sequence = ++presaleTimelineLoadSequence.value
  const ticket = presaleTimelineScope.begin(`PRESALE_REQUEST:${id}`)
  presaleTimeline.value = []; presaleTimelineCursor.value = ''; presaleTimelineError.value = ''; presaleTimelineLoading.value = true
  try {
    const value = await getPresaleTimeline(id, { limit: 20 })
    if (sequence !== presaleTimelineLoadSequence.value || !presaleTimelineScope.isCurrent(ticket) || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    presaleTimeline.value = value?.items || []
    void resolveOwnerNames(presaleTimeline.value.flatMap((item) => [item.actor_id, item.subject_id]))
    presaleTimelineCursor.value = value?.next_cursor || ''
  } catch {
    if (sequence !== presaleTimelineLoadSequence.value || !presaleTimelineScope.isCurrent(ticket) || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    presaleTimelineError.value = '流程时间线暂时无法加载，任务详情和操作区不受影响。'
  } finally {
    if (sequence === presaleTimelineLoadSequence.value && presaleTimelineScope.isCurrent(ticket)) presaleTimelineLoading.value = false
  }
}
async function loadMorePresaleTimeline() {
  const id = selectedPresale.value?.request?.id
  const cursor = presaleTimelineCursor.value
  if (!id || !cursor || presaleTimelineLoading.value) return
  const sequence = ++presaleTimelineLoadSequence.value
  const ticket = presaleTimelineScope.begin(`PRESALE_REQUEST:${id}`)
  presaleTimelineLoading.value = true; presaleTimelineError.value = ''
  try {
    const value = await getPresaleTimeline(id, { cursor, limit: 20 })
    if (sequence !== presaleTimelineLoadSequence.value || !presaleTimelineScope.isCurrent(ticket) || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    // 稳定游标的分页边界仍可能重复返回末条事件，按事件 ID 去重后再追加，保持时间线只读且无重复。
    const known = new Set(presaleTimeline.value.map((item) => item.event_id))
    presaleTimeline.value = [...presaleTimeline.value, ...(value?.items || []).filter((item) => !known.has(item.event_id))]
    void resolveOwnerNames((value?.items || []).flatMap((item) => [item.actor_id, item.subject_id]))
    presaleTimelineCursor.value = value?.next_cursor || ''
  } catch {
    if (sequence !== presaleTimelineLoadSequence.value || !presaleTimelineScope.isCurrent(ticket) || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    presaleTimelineError.value = '更多流程记录加载失败，可稍后重试。'
  } finally {
    if (sequence === presaleTimelineLoadSequence.value && presaleTimelineScope.isCurrent(ticket)) presaleTimelineLoading.value = false
  }
}
// 切换/关闭申请时统一作废详情链在途请求：详情、可用动作、时间线、联系电话和
// 指派/审批历史读写的迟到响应都不能进入新上下文（R04）；组件卸载由 requestScope 兜底（R05）。
function invalidatePresaleDetailRequests() {
  presaleDetailScope.invalidate()
  presaleActionsScope.invalidate()
  presaleTimelineScope.invalidate()
  presaleContactPhoneScope.invalidate()
  presaleInspectorScope.invalidate()
}
async function openPresale(id, { clearResult = true, reportError = true } = {}) {
  // 切换任务前统一作废详情、动作、时间线和敏感电话请求；迟到响应不能覆盖新任务，
  // 已解密的联系电话也只在当前详情生命周期内保留。
  invalidatePresaleDetailRequests()
  presaleMutationContextSequence.value++
  presaleMutationLoadSequence.value++
  presaleMutationLoading.value = false
  presaleDetailLoadSequence.value++
  presaleActionsLoadSequence.value++; presaleTimelineLoadSequence.value++
  presaleContactPhoneLoadSequence.value++; presaleContactPhone.value = ''; presaleContactPhoneError.value = ''; presaleContactPhoneLoading.value = false
  selectedPresale.value = null; worklogs.value = []
  presaleAvailableActions.value = null; presaleActionsError.value = ''
  presaleTimeline.value = []; presaleTimelineCursor.value = ''; presaleTimelineError.value = ''
  presaleInspectorPanel.value = ''; presaleAssignments.value = []; presaleApprovalHistory.value = []
  presaleInspectorLoading.value = false; presaleInspectorError.value = ''
  progressSubmissionKey.value = ''; progressSubmissionSignature.value = ''
  selectedExecutionDepartmentID.value = ''; selectedTeamLeadPersonID.value = ''
  teamLeadCandidates.value = []; teamLeadDirectoryLoading.value = false; teamLeadDirectorySequence.value += 1
  const loaded = await loadPresaleCore(id, { clearResult, reportError })
  if (!loaded) return false
  void refreshPresaleActions(id)
  void refreshPresaleTimeline(id)
  return true
}
function closePresale() {
  invalidatePresaleDetailRequests()
  presaleMutationContextSequence.value++
  presaleMutationLoadSequence.value++
  presaleMutationLoading.value = false
  presaleDetailLoadSequence.value++; presaleActionsLoadSequence.value++; presaleTimelineLoadSequence.value++
  presaleContactPhoneLoadSequence.value++; presaleContactPhone.value = ''; presaleContactPhoneError.value = ''; presaleContactPhoneLoading.value = false
  selectedPresale.value = null; presaleAvailableActions.value = null; presaleTimeline.value = []
  presaleInspectorPanel.value = ''; presaleAssignments.value = []; presaleApprovalHistory.value = []
  presaleInspectorLoading.value = false; presaleInspectorError.value = ''
  progressSubmissionKey.value = ''; progressSubmissionSignature.value = ''
  selectedExecutionDepartmentID.value = ''; selectedTeamLeadPersonID.value = ''
  teamLeadCandidates.value = []; teamLeadDirectoryLoading.value = false; teamLeadDirectorySequence.value += 1
}
async function loadPresaleInspector(panel) {
  const id = selectedPresale.value?.request?.id
  if (!id || presaleInspectorLoading.value) return
  // 指派记录/审批历史此前缺少响应归属校验：切换或关闭申请后，在途响应仍会把旧申请的
  // 数据回写进新详情。票据绑定当前申请 ID，openPresale/closePresale 已整体失效旧票据。
  const ticket = presaleInspectorScope.begin(`PRESALE_REQUEST:${id}:${panel}`)
  presaleInspectorPanel.value = panel
  presaleInspectorLoading.value = true
  presaleInspectorError.value = ''
  try {
    if (panel === 'assignments') {
      const result = (await getAssignments(id)) || []
      if (!presaleInspectorScope.isCurrent(ticket)) return
      presaleAssignments.value = result
      void resolveOwnerNames(presaleAssignments.value.flatMap((item) => [item.assignee_id, item.assigned_by]))
    } else {
      const result = (await getApprovalHistory(id)) || []
      if (!presaleInspectorScope.isCurrent(ticket)) return
      presaleApprovalHistory.value = result
      void resolveOwnerNames(presaleApprovalHistory.value.map((item) => item.approver_id))
    }
  } catch (value) {
    if (!presaleInspectorScope.isCurrent(ticket)) return
    presaleInspectorError.value = formatCRMError(value, { message: subsystemAccessMessage(value, panel === 'assignments' ? '指派记录暂时无法加载，请稍后重试。' : '审批历史暂时无法加载，请稍后重试。') })
  } finally {
    if (presaleInspectorScope.isCurrent(ticket)) presaleInspectorLoading.value = false
  }
}
async function viewPresaleContactPhone() {
  const id = selectedPresale.value?.request?.id
  if (!id || !canViewSelectedPresaleContactPhone.value || presaleContactPhoneLoading.value) return
  const sequence = ++presaleContactPhoneLoadSequence.value
  const ticket = presaleContactPhoneScope.begin(`PRESALE_REQUEST:${id}`)
  presaleContactPhone.value = ''; presaleContactPhoneError.value = ''; presaleContactPhoneLoading.value = true
  try {
    const value = await getPresaleContactPhone(id)
    if (sequence !== presaleContactPhoneLoadSequence.value || !presaleContactPhoneScope.isCurrent(ticket) || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    presaleContactPhone.value = value?.contact_phone || ''
    if (!presaleContactPhone.value) presaleContactPhoneError.value = '联系电话暂时无法查看。'
  } catch {
    if (sequence === presaleContactPhoneLoadSequence.value && presaleContactPhoneScope.isCurrent(ticket) && Number(selectedPresale.value?.request?.id) === Number(id)) {
      presaleContactPhoneError.value = '联系电话查看失败，未展示敏感信息。'
    }
  } finally {
    if (sequence === presaleContactPhoneLoadSequence.value && presaleContactPhoneScope.isCurrent(ticket)) presaleContactPhoneLoading.value = false
  }
}
async function loadEngineerDirectory() {
  if (engineerDirectoryLoading.value) return
  engineerDirectoryLoading.value = true
  try {
    const value = await listOwnerDirectory({ keyword: engineerQuery.keyword, assignment_duty: 'EXECUTOR', page: 1, page_size: 50 })
    engineerDirectory.value = (value?.items || []).map((item) => ({
      person_id: item.user_id,
      person_name: platformUserName(item),
      department: (item.organizations || []).map((org) => org.organization_name).filter(Boolean).join('、'),
      role: 'technician',
      valid_flag: true,
    })).filter((item) => !engineerQuery.department || item.department.includes(engineerQuery.department))
  }
  catch (value) { engineerDirectory.value = []; showError(value) }
  finally { engineerDirectoryLoading.value = false }
}
async function openEngineerPicker() {
  selectedEngineerIDs.value = (selectedPresale.value?.current_assignees || []).map((item) => item.person_id)
  Object.keys(selectedEngineerRoles).forEach((key) => delete selectedEngineerRoles[key])
  ;(selectedPresale.value?.current_assignees || []).forEach((item) => {
    selectedEngineerRoles[item.person_id] = ['team_lead', 'project_manager', 'technician'].includes(item.role) ? item.role : 'technician'
  })
  assignmentReason.value = ''; engineerPickerOpen.value = true; await loadEngineerDirectory()
}
function canActOnConfiguredAssignment(action) {
  const request = selectedPresale.value?.request
  const roles = crmSession.value?.roles || []
  if (!['APPROVED_PENDING_ASSIGNMENT', 'EXECUTING'].includes(request?.status) || request?.assignment_action !== action) return false
  if (roles.includes('crm_super_admin')) return true
  const roleAliases = {
    technical_director: ['technical_director', 'technical_lead'],
    technical_lead: ['technical_director', 'technical_lead'],
  }
  const acceptedRoles = roleAliases[request.assignment_role_code] || [request.assignment_role_code]
  return acceptedRoles.some((role) => roles.includes(role))
}
function selectedAssignmentActions() {
  const request = selectedPresale.value?.request
  if (Array.isArray(request?.assignment_actions) && request.assignment_actions.length) return request.assignment_actions
  return request?.assignment_action ? [request.assignment_action] : []
}
function canTakeoverExecutingTeamLead() {
  const request = selectedPresale.value?.request
  const roles = crmSession.value?.roles || []
  const hasTeamLead = Boolean(request?.team_lead_person_id) || (selectedPresale.value?.current_assignees || []).some((item) => item.role === 'team_lead')
  return request?.status === 'EXECUTING' && hasTeamLead && authoritativePresaleActions.value.includes('ASSIGN') && (roles.includes('technical_director') || roles.includes('crm_super_admin'))
}
function openTakeoverDialog() {
  const request = selectedPresale.value?.request
  if (!request || !canTakeoverExecutingTeamLead()) return
  selectedExecutionDepartmentID.value = request.execution_department_id || ''
  takeoverTeamLeadID.value = ''
  takeoverReason.value = ''
  takeoverOpen.value = true
  if (selectedExecutionDepartmentID.value) void loadTeamLeadCandidates()
}
// 任务 B（保存/刷新分离）：售前写操作 HTTP 200 即已保存；其后详情/可用动作/列表刷新
// 失败只说明展示未更新，统一给出“已保存，最新数据读取失败”的准确提示——不回退写操作
// 结果，也不把读取失败误报为操作失败。读失败经 reportError=false 静默上抛，避免内层
// showError 用通用失败文案覆盖成功提示。
async function refreshAfterPresaleWrite(id, savedMessage = '操作已保存，但最新数据读取失败，请刷新详情核对结果。') {
  let refreshed = true
  try {
    const loaded = await loadPresaleCore(id, { clearResult: false, reportError: false })
    if (loaded) await Promise.all([refreshPresaleActions(id), refreshPresaleTimeline(id)])
    else refreshed = false
    if (!(await loadCurrent({ reportError: false }))) refreshed = false
    if (selectedOpportunity.value) await loadOpportunityPresales(opportunityPresalePage.number)
  } catch {
    refreshed = false
  }
  if (!refreshed) error.value = savedMessage
}
async function submitTakeover() {
  const id = selectedPresale.value?.request?.id
  const version = Number(selectedPresale.value?.request?.version)
  if (!id || !Number.isInteger(version) || !takeoverTeamLeadID.value || takeoverSaving.value) return
  const reason = String(takeoverReason.value || '').trim()
  if (!reason) { error.value = '请填写接管原因。'; return }
  takeoverSaving.value = true
  const mutationContext = presaleMutationContextSequence.value
  const mutationToken = ++presaleMutationLoadSequence.value
  const isCurrentMutation = () => mutationContext === presaleMutationContextSequence.value && Number(selectedPresale.value?.request?.id) === Number(id)
  try {
    const retry = presaleMutationRetries.keyFor('executing_takeover', id, { team_lead_person_id: takeoverTeamLeadID.value, reason, version })
    const result = await takeOverExecutingTeamLead(id, retry.payload, retry.key)
    presaleMutationRetries.confirmSuccess('executing_takeover', id, retry.key)
    if (!isCurrentMutation()) return
    presaleResult.value = result
    takeoverOpen.value = false
    notice.value = '已完成执行中负责人接管。'
    // 写入已成功；其后刷新失败由 refreshAfterPresaleWrite 给出准确提示，不落入下方“操作失败”。
    await refreshAfterPresaleWrite(id)
  } catch (value) {
    if (mutationToken === presaleMutationLoadSequence.value) showError(value)
  } finally {
    if (mutationToken === presaleMutationLoadSequence.value) takeoverSaving.value = false
  }
}
function canConfigureTwoLevelAssignment() {
  const request = selectedPresale.value?.request
  return request?.status === 'APPROVED_PENDING_ASSIGNMENT' &&
    authoritativePresaleActions.value.includes('ASSIGN') &&
    selectedAssignmentActions().includes('TEAM_LEAD_ASSIGNMENT')
}
function canAssignPresaleExecutors() {
  const request = selectedPresale.value?.request
  return ['PENDING_EXECUTION_ASSIGNMENT', 'EXECUTING'].includes(request?.status) &&
    authoritativePresaleActions.value.includes('ASSIGN') &&
    selectedAssignmentActions().includes('EXECUTOR_ASSIGNMENT')
}
function canRejectPresaleExecutionAssignment() {
  return selectedPresale.value?.request?.status === 'PENDING_EXECUTION_ASSIGNMENT' && canAssignPresaleExecutors()
}
function canSelectExecutionDepartment() {
  return canConfigureTwoLevelAssignment() || canActOnConfiguredAssignment('DEPARTMENT_ASSIGNMENT')
}
async function loadExecutionDepartments() { try { const result = await listPresaleExecutionDepartments(); executionDepartments.value = result?.data || result || [] } catch (value) { showError(value) } }
function onExecutionDepartmentChange() {
  selectedTeamLeadPersonID.value = ''
  teamLeadCandidates.value = []
  teamLeadDirectorySequence.value += 1
  teamLeadDirectoryLoading.value = false
  if (canConfigureTwoLevelAssignment()) void loadTeamLeadCandidates()
}
async function loadTeamLeadCandidates() {
  const organizationID = selectedExecutionDepartmentID.value
  const sequence = ++teamLeadDirectorySequence.value
  if (!organizationID) {
    teamLeadCandidates.value = []
    teamLeadDirectoryLoading.value = false
    return
  }
  teamLeadDirectoryLoading.value = true
  try {
    const candidates = []
    const seen = new Set()
    let page = 1
    while (page <= 10) {
      const result = await listOwnerDirectory({ assignment_duty: 'TEAM_LEAD', page, page_size: 50 })
      if (sequence !== teamLeadDirectorySequence.value || organizationID !== selectedExecutionDepartmentID.value) return
      const items = Array.isArray(result?.items) ? result.items : []
      for (const item of items) {
        const userID = String(item?.user_id || '').trim()
        if (!userID || seen.has(userID)) continue
        const organizations = Array.isArray(item?.organizations) ? item.organizations : []
        if (!organizations.some((organization) => organization.organization_id === organizationID)) continue
        seen.add(userID)
        candidates.push({
          person_id: userID,
          person_name: platformUserName(item),
          department: organizations.map((organization) => organization.organization_name).filter(Boolean).join('、'),
        })
      }
      const total = Number(result?.total || 0)
      if (items.length < 50 || (total > 0 && page * 50 >= total)) break
      page += 1
    }
    candidates.sort((left, right) => left.person_name.localeCompare(right.person_name, 'zh-CN'))
    teamLeadCandidates.value = candidates
  } catch (value) {
    if (sequence === teamLeadDirectorySequence.value) { teamLeadCandidates.value = []; showError(value) }
  } finally {
    if (sequence === teamLeadDirectorySequence.value) teamLeadDirectoryLoading.value = false
  }
}
async function saveExecutionDepartment() {
  const id = selectedPresale.value?.request?.id
  // 任务 D：保存进行中禁止重复提交（按钮禁用之外的第二道防线）。
  if (!id || !selectedExecutionDepartmentID.value || departmentSaving.value) return
  const twoLevel = canConfigureTwoLevelAssignment()
  if (twoLevel && !selectedTeamLeadPersonID.value) {
    error.value = '请选择团队负责人后再保存。'
    return
  }
  const requestVersion = Number(selectedPresale.value?.request?.version)
  const availableActionsVersion = Number(presaleAvailableActions.value?.version)
  const version = Number.isInteger(requestVersion) ? requestVersion : availableActionsVersion
  if (!Number.isInteger(version) || version <= 0) {
    error.value = '保存失败：当前审批动作版本异常，请先刷新售前详情。'
    return
  }
  departmentSaving.value = true
  try {
    const retry = presaleMutationRetries.keyFor('department', id, {
      department_id: selectedExecutionDepartmentID.value,
      team_lead_person_id: twoLevel ? selectedTeamLeadPersonID.value : '',
      version,
    })
    await selectPresaleExecutionDepartment(id, retry.payload, retry.key)
    presaleMutationRetries.confirmSuccess('department', id, retry.key)
    selectedTeamLeadPersonID.value = ''
    teamLeadCandidates.value = []
    // 任务 B：部门保存已成功（HTTP 200）；其后详情刷新失败只提示读取失败，不误报为保存失败。
    const loaded = await openPresale(id, { clearResult: false, reportError: false })
    if (!loaded) error.value = '已保存，但最新数据读取失败，请刷新详情核对结果。'
  } catch (value) {
    showError(value)
  } finally { departmentSaving.value = false }
}
async function submitPresaleExecutionRejection(reason) {
  const id = selectedPresale.value?.request?.id
  const version = Number(selectedPresale.value?.request?.version)
  if (!id || !Number.isInteger(version)) return
  const mutationContext = presaleMutationContextSequence.value
  const mutationToken = ++presaleMutationLoadSequence.value
  presaleMutationLoading.value = true
  const isCurrentMutation = () => mutationContext === presaleMutationContextSequence.value && Number(selectedPresale.value?.request?.id) === Number(id)
  try {
    const retry = presaleMutationRetries.keyFor('executor_rejection', id, { reason, version })
    const result = await rejectExecutorAssignment(id, retry.payload, retry.key)
    presaleMutationRetries.confirmSuccess('executor_rejection', id, retry.key)
    if (!isCurrentMutation()) return
    presaleResult.value = result
    notice.value = '已拒绝执行指派，申请已退回待指派。'
    // 写入已成功；其后刷新失败由 refreshAfterPresaleWrite 给出准确提示，不落入下方“操作失败”。
    await refreshAfterPresaleWrite(id)
  } catch (value) {
    if (mutationToken === presaleMutationLoadSequence.value) showError(value)
  } finally {
    if (mutationToken === presaleMutationLoadSequence.value) presaleMutationLoading.value = false
  }
}
function assignmentTargets() {
  const byID = new Map(engineerDirectory.value.map((item) => [item.person_id, item]))
  const current = new Map((selectedPresale.value?.current_assignees || []).map((item) => [item.person_id, item]))
  return selectedEngineerIDs.value.map((personID) => {
    const person = byID.get(personID) || current.get(personID)
    return { person_id: personID, person_name: person?.person_name || '未命名用户', department: person?.department || '', role: selectedEngineerRoles[personID] || 'technician' }
  })
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
  if (!canConfigurePresaleAlerts.value || alertConfigLoading.value) return
  showAlertConfig.value = true
  alertConfigLoading.value = true
  alertConfigError.value = ''
  alertRules.value = []
  try {
    const rules = await listPresaleAlertRules()
    if (!Array.isArray(rules) || !rules.length) throw new Error('预警规则目录为空，请确认 CRM 服务已更新后重新加载。')
    alertRules.value = rules
  } catch (value) {
    alertConfigError.value = formatCRMError(value, { fallback: '预警规则加载失败，请重试。' })
  } finally { alertConfigLoading.value = false }
}
async function saveAlertRule(rule) {
  if (!canConfigurePresaleAlerts.value || alertRuleSavingType.value) return
  const threshold = Number(rule.threshold_hours)
  if (rule.threshold_hours === '' || rule.threshold_hours == null || !Number.isInteger(threshold) || threshold < 0 || threshold > 8760) {
    alertConfigError.value = '阈值必须为 0–8760 之间的整数小时。'
    return
  }
  alertRuleSavingType.value = rule.type
  alertConfigError.value = ''
  try {
    await updatePresaleAlertRule(rule.type, { threshold_hours: threshold, enabled: rule.enabled, version: rule.version ?? rule.config_version })
    await openAlertConfig()
    notice.value = '预警规则已更新，新版本只影响后续扫描。'
  } catch (value) {
    alertConfigError.value = value?.status === 409 ? '规则已被其他管理员修改，请重新加载后再保存。' : formatCRMError(value, { fallback: '预警规则保存失败，请重试。' })
  } finally { alertRuleSavingType.value = '' }
}
async function submitCustomer() {
  // 提交中再次提交（重复点击/原生表单重复触发）必须被挡住：这里仍是唯一写入入口。
  if (actionLoading.value) return
  if (customerEditMode.value) {
    // 联系人来自异步回填：加载中、加载失败或确实没有联系人时都不能发空数组，
    // 否则后端 dto 的 contacts binding required,min=1 与“恰好一个登记联系人”会直接 400。
    if (customerEditContactsLoading.value) { resetMessages(); error.value = '客户联系人正在加载，请稍后保存。'; return }
    if (customerEditContactsLoadFailed.value) {
      resetMessages()
      error.value = customerEditContactsError.value || '客户联系人加载失败，请重试后再保存。'
      return
    }
    if (!customerForm.contacts.length) {
      resetMessages()
      error.value = '该客户暂无联系人，请先添加并设置注册联系人。'
      return
    }
    const registrations = customerForm.contacts.filter((item) => item.is_registration)
    if (registrations.length !== 1) {
      resetMessages()
      error.value = registrations.length ? '只能设置一个门户登记联系人。' : '请设置一个门户登记联系人后再保存。'
      return
    }
  }
  actionLoading.value = true; resetMessages()
  try {
    let createRetry = null
    if (!customerEditMode.value) {
      // customerForm 是 Vue 响应式代理，不能直接交给 structuredClone；
      // 先取原始对象并逐项展开联系人，避免新增客户在浏览器端提交前直接失败。
      const rawCustomerForm = toRaw(customerForm)
      const createPayload = {
        ...rawCustomerForm,
        contacts: rawCustomerForm.contacts.map((item) => ({ ...toRaw(item) })),
      }
      delete createPayload.reason
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
      const created = await createCustomer(createRetry.payload, createRetry.key)
      createMutationRetries.confirmSuccess('customer', createRetry.key)
      // 客户编号是这次保存真正的产出：刷新列表后翻页可能找不到刚建的那一行，
      // 所以必须留在本次提示里，用户可以直接复制。
      notifyWithReference('客户创建成功。', created?.customer_no || '')
    }
    customerDialog.value = false; customerStats.loadedAt = 0; await loadCurrent()
  } catch (value) { showError(value) } finally { actionLoading.value = false }
}
// 用途：为客户作废或恢复收集原因并提交版本受控的状态变更。
// 参数：action 为作废或恢复动作。
// 返回值：无；失败展示业务错误。
function changeCustomerStatus(action) {
  if (!selectedCustomer.value) return
  const customer = selectedCustomer.value
  const voiding = action === 'void'
  askReason({
    title: voiding ? '作废客户' : '恢复客户',
    label: voiding ? '作废原因' : '恢复原因',
    required: true,
    confirmText: voiding ? '作废客户' : '恢复客户',
    onSubmit: async (reason) => {
      try {
        selectedCustomer.value = voiding
          ? await voidCustomer(customer.id, { version: customer.version, reason })
          : await restoreCustomer(customer.id, { version: customer.version, reason })
        notice.value = voiding ? '客户已作废。' : '客户已恢复。'
        customerStats.loadedAt = 0
        await loadCurrent()
      } catch (value) { showError(value) }
    },
  })
}
async function submitOpportunity() {
  if (actionLoading.value) return
  syncOpportunitySelections()
  if (opportunityCatalogLoading.value || opportunityCatalogError.value) {
    error.value = opportunityCatalogError.value || '商机基础数据正在加载，请稍后提交。'
    return
  }
  if (!opportunityTypeSelections.value.length || !opportunitySourceSelections.value.length) {
    error.value = !opportunityTypeSelections.value.length && !opportunitySourceSelections.value.length
      ? '请至少选择一个商机类型和一个来源。'
      : !opportunityTypeSelections.value.length ? '请至少选择一个商机类型。' : '请至少选择一个来源。'
    return
  }
  actionLoading.value = true; resetMessages()
  try {
    if (opportunityEditMode.value) {
      // 普通更新 DTO 不接受客户归属和负责人字段；负责人变更必须走独立接口，
      // 以执行人员目录校验、对象权限检查、乐观锁和审计记录。
      const { customer_id, owner_user_id, owner_org_id, ...payload } = opportunityForm
      const updatedOpportunity = await updateOpportunity(selectedOpportunity.value.id, { ...payload, system_count: Number(payload.system_count || 0), version: selectedOpportunity.value.version })
      selectedOpportunityOwnerOrgID.value = updatedOpportunity?.owner_org_id || selectedOpportunityOwnerOrgID.value
      selectedOpportunity.value = { ...updatedOpportunity, owner_org_id: '基础平台组织' }
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
// 用途：为商机作废或恢复收集原因并提交版本受控的状态变更。
// 参数：action 为作废或恢复动作。
// 返回值：无；失败展示业务错误。
function changeOpportunityStatus(action) {
  if (!selectedOpportunity.value) return
  const opportunity = selectedOpportunity.value
  const voiding = action === 'void'
  askReason({
    title: voiding ? '作废商机' : '恢复商机',
    label: voiding ? '商机作废原因' : '商机恢复原因',
    required: true,
    confirmText: voiding ? '作废商机' : '恢复商机',
    onSubmit: async (reason) => {
      try {
        const statusResult = voiding
          ? await voidOpportunity(opportunity.id, { version: opportunity.version, reason })
          : await restoreOpportunity(opportunity.id, { version: opportunity.version, reason })
        selectedOpportunity.value = { ...statusResult, owner_org_id: '基础平台组织' }
        notice.value = voiding ? '商机已作废。' : '商机已恢复。'
        await loadCurrent()
      } catch (value) { showError(value) }
    },
  })
}
// 用途：按当前能力模式提交阶段与互斥的合同引用或人工赢单依据。
// 参数：无；使用当前商机、版本与编辑表单。
// 返回值：异步完成，失败保留表单并显示原错误。
async function submitStage() {
  if (!selectedOpportunity.value) return
  if (!stageForm.target_stage) {
    resetMessages()
    error.value = '请选择目标阶段。'
    return
  }
  try {
    const payload = { target_stage: stageForm.target_stage, reason: stageForm.reason, version: selectedOpportunity.value.version }
    if (stageForm.target_stage === '已签约') {
      Object.assign(payload, winConfirmationPayload(winConfirmationMode.value, stageForm))
    }
    if (stageForm.lost_reason) payload.lost_reason = stageForm.lost_reason
    selectedOpportunity.value = { ...(await changeOpportunityStage(selectedOpportunity.value.id, payload)), owner_org_id: '基础平台组织' }
    stageDialog.value = false; notice.value = '阶段已生效并写入历史。'; await openOpportunity(selectedOpportunity.value.id); await loadCurrent()
  } catch (value) { showError(value) }
}
// 用途：补全当前合同、人工赢单依据或丢单原因待办。
// 参数：无；使用当前商机的待办类型、版本和补全表单。
// 返回值：异步完成，校验失败不提交其他来源的残留字段。
async function submitTerminal() {
  if (!selectedOpportunity.value) return
  try {
    const payload = { version: selectedOpportunity.value.version, reason: terminalForm.reason }
    if (['CONTRACT', 'WIN_EVIDENCE'].includes(selectedOpportunity.value.terminal_pending_type)) {
      Object.assign(payload, winConfirmationPayload(winConfirmationMode.value, terminalForm))
    }
    if (selectedOpportunity.value.terminal_pending_type === 'LOST_REASON') payload.lost_reason = terminalForm.lost_reason
    selectedOpportunity.value = { ...(await completeOpportunityTerminalTodo(selectedOpportunity.value.id, payload)), owner_org_id: '基础平台组织' }
    terminalDialog.value = false; notice.value = '终态待办已补全。'; await openOpportunity(selectedOpportunity.value.id); await loadCurrent()
  } catch (value) { showError(value) }
}
// 跟进/沟通时间与工时起止都是只有“提交”没有“回填”的 datetime-local：
// 值本身没有时区信息，必须按北京墙钟解释再换算成瞬间（与售前申请、报表时间边界同一口径），
// 否则浏览器时区不是 UTC 时提交的时刻会被静默平移。非法墙钟换算出 Invalid Date，
// 仍由 toISOString() 抛错进入外层 catch，与原实现一致地走统一错误提示。
function followupInstant(wallClock) { return new Date(businessWallClockToInstant(wallClock)).toISOString() }
async function submitFollowup() {
  try {
    const payload = { type: followupForm.type, content: followupForm.content, followed_at: followupInstant(followupForm.followed_at) }
    if (followupForm.next_follow_at) payload.next_follow_at = followupInstant(followupForm.next_follow_at)
    await createOpportunityFollowup(selectedOpportunity.value.id, payload); followupDialog.value = false; notice.value = '跟进记录已添加。'; await openOpportunity(selectedOpportunity.value.id)
  } catch (value) { showError(value) }
}
async function submitCustomerFollowup() {
  try {
    const payload = { type: customerFollowupForm.type, content: customerFollowupForm.content, followed_at: followupInstant(customerFollowupForm.followed_at) }
    if (customerFollowupForm.next_follow_at) payload.next_follow_at = followupInstant(customerFollowupForm.next_follow_at)
    await createCustomerFollowup(selectedCustomer.value.id, payload); customerFollowupDialog.value = false; notice.value = '客户沟通记录已添加。'; await openCustomer(selectedCustomer.value.id); await loadCurrent()
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
    error.value = '售前内部流程当前不可用，不会受理新的售前申请。'
    return null
  }
  if (!presaleForm.description.trim()) { error.value = '需求说明不能为空，请填写售前支持需求与背景。'; return null }
  if (presaleForm.venue === 'ONSITE' && !presaleForm.service_address.trim()) { error.value = '现场支持必须填写服务地址。'; return null }
  const opportunityID = Number(presaleForm.opportunity_id)
  if (!Number.isSafeInteger(opportunityID) || opportunityID <= 0) { error.value = '请选择有效的关联商机。'; return null }
  // datetime-local 里的取值按北京墙钟解释再换算成瞬间，与回填的 instantToBusinessWallClock 严格互逆；
  // 非法墙钟返回空串，交给下面原有的校验提示，不会静默改成别的时刻。
  const expectedStart = new Date(businessWallClockToInstant(presaleForm.expected_start))
  const expectedEnd = new Date(businessWallClockToInstant(presaleForm.expected_end))
  if (Number.isNaN(expectedStart.getTime()) || Number.isNaN(expectedEnd.getTime())) { error.value = '请填写有效的预计开始和结束时间。'; return null }
  if (expectedEnd <= expectedStart) { error.value = '预计结束时间必须晚于预计开始时间。'; return null }
  presaleCreateLoading.value = true
  try {
    if (presaleReopenRequest.value) {
      const reopened = await reopenPresaleRequest(presaleReopenRequest.value.id, presaleReopenRequest.value.version, {
        venue: presaleForm.venue,
        service_address: presaleForm.service_address,
        contact_name: presaleForm.contact_name,
        contact_phone: presaleForm.contact_phone,
        description: presaleForm.description,
        expected_start: expectedStart.toISOString(),
        expected_end: expectedEnd.toISOString(),
        urgency: presaleForm.urgency,
      })
      notifyWithReference(`申请 ${presaleReopenRequest.value.request_no} 已重新发起审批，申请 ID 保持不变。`, presaleReopenRequest.value.request_no)
      presaleReopenRequest.value = null
      presaleCreatePage.value = false
      // 任务 B：重开已成功（HTTP 200）；其后列表/详情刷新失败只提示读取失败，不误报为提交失败。
      if (refreshList && !(await loadCurrent({ reportError: false }))) {
        error.value = '申请已重新发起，但最新数据读取失败，请刷新列表核对结果。'
      }
      if (openDetail && !(await openPresale(reopened.id, { reportError: false }))) {
        error.value = '申请已重新发起，但详情读取失败，请从申请列表查看进度。'
      }
      return reopened
    }
    // 内部流程可能已提交但响应在网络中丢失；同一规范化命令复用幂等键，
    // 直到服务端明确成功才清除，避免重复创建申请。
    // 载荷只带瞬间（UTC），不再把浏览器本地解释的墙钟交给重试键规范化。
    const retry = presaleMutationRetries.keyFor('create', opportunityID, {
      ...presaleForm,
      opportunity_id: opportunityID,
      expected_start: expectedStart.toISOString(),
      expected_end: expectedEnd.toISOString(),
    })
    const value = await createPresaleRequest(retry.payload, retry.key)
    presaleMutationRetries.confirmSuccess('create', opportunityID, retry.key)
    notifyWithReference('售前申请已提交；商机阶段保持不变。', value?.request_no || '')
    // 任务 B：受理已成功（HTTP 200）；其后列表/详情刷新失败只提示读取失败，不误报为提交失败。
    if (refreshList && !(await loadCurrent({ reportError: false }))) {
      error.value = '售前申请已提交，但最新数据读取失败，请刷新列表核对结果。'
    }
    if (openDetail && !(await openPresale(value.id, { reportError: false }))) {
      error.value = '售前申请已提交，但详情读取失败，请从申请列表查看进度。'
    }
    return value
  } catch (value) { showError(value); return null }
  finally { presaleCreateLoading.value = false }
}
// 用途：生成售前申请审批或取消操作的原因表单说明。
// 参数：action 为通过、驳回或取消动作。
// 返回值：返回对应的标题、原因要求和明确动作按钮文案。
function presaleDecisionSpec(action) {
  return {
    approve: { title: '通过售前申请', label: '审批意见', required: false, confirmText: '通过售前申请' },
    reject: { title: '驳回售前申请', label: '驳回原因', required: true, confirmText: '驳回售前申请' },
    cancel: { title: '取消售前申请', label: '取消原因', required: true, confirmText: '取消售前申请' },
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
// 用途：验证当前可用操作后打开拒绝执行指派原因表单。
// 参数：无。
// 返回值：无；未获授权时提示并刷新可用操作。
function openPresaleExecutionRejection() {
  const detail = selectedPresale.value
  if (!detail?.request?.id || presaleMutationLoading.value) return
  const id = detail.request.id
  const version = Number(presaleAvailableActions.value?.version)
  if (!canRejectPresaleExecutionAssignment() || !Number.isInteger(version)) {
    error.value = '服务端未授权该操作或操作状态已变化，请刷新可用操作。'
    void refreshPresaleActions(id)
    return
  }
  askReason({
    title: '拒绝执行指派',
    label: '拒绝原因',
    required: true,
    confirmText: '拒绝执行指派',
    onSubmit: async (reason) => { await submitPresaleExecutionRejection(reason) },
  })
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
    // 任务 B：审批决定已保存；其后刷新失败由 refreshAfterPresaleWrite 给出准确提示。
    await refreshAfterPresaleWrite(id)
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
    if (action === 'assignments') { await loadPresaleInspector('assignments'); return }
    if (action === 'history') { await loadPresaleInspector('history'); return }
    if (action === 'assign') {
      const targets = assignmentTargets()
      if (!targets.length || targets.length !== selectedEngineerIDs.value.length) { error.value = '请选择有效的内部执行人员。'; return }
      const executorFlow = canAssignPresaleExecutors() && selectedAssignmentActions().includes('EXECUTOR_ASSIGNMENT')
      const operationName = executorFlow ? 'executor_assignment' : 'assignment'
      const retry = presaleMutationRetries.keyFor(operationName, id, { assignees: targets, change_reason: assignmentReason.value, version })
      const result = executorFlow
        ? await replaceExecutorAssignments(id, retry.payload, retry.key)
        : await replaceAssignments(id, retry.payload, retry.key)
      presaleMutationRetries.confirmSuccess(operationName, id, retry.key)
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
      // 工时起止同样是 datetime-local 墙钟：按北京墙钟解释，避免浏览器本地时区平移工时。
      const workStart = new Date(businessWallClockToInstant(operation.work_start))
      const workEnd = new Date(businessWallClockToInstant(operation.work_end))
      if (Number.isNaN(workStart.getTime()) || Number.isNaN(workEnd.getTime())) { error.value = '请填写有效的开始和结束时间。'; return }
      if (!(workEnd > workStart)) { error.value = '结束时间必须晚于开始时间。'; return }
      if (!String(operation.raw_value || '').trim() || !String(operation.work_site_address || '').trim()) { error.value = '请填写工时数值和工作地点。'; return }
      const retry = presaleMutationRetries.keyFor('worklog', id, { work_start: workStart.toISOString(), work_end: workEnd.toISOString(), raw_unit: operation.raw_unit, raw_value: operation.raw_value, work_site_address: operation.work_site_address, work_content: operation.work_content, remark: operation.remark, version })
      presaleMutationRetries.markAttempted('worklog', id, retry.key)
      const result = await addWorklog(id, retry.payload, retry.key)
      presaleMutationRetries.confirmSuccess('worklog', id, retry.key)
      if (!isCurrentMutation()) return
      presaleResult.value = result
    }
    notice.value = '操作完成。'
    if (refreshActions.has(action)) {
      // 任务 B：指派/进度/工时写入已成功；其后刷新失败由 refreshAfterPresaleWrite 给出准确提示。
      await refreshAfterPresaleWrite(id)
    }
  } catch (value) {
    if (!mutationToken || isCurrentMutation()) showError(value)
  } finally {
    if (mutationToken && mutationToken === presaleMutationLoadSequence.value) presaleMutationLoading.value = false
  }
}

// 用途：验证售前申请当前状态后打开结束进度原因表单。
// 参数：无。
// 返回值：无；未获授权时提示并刷新可用操作。
function runPresaleComplete() {
  const detail = selectedPresale.value
  if (!detail?.request?.id || presaleMutationLoading.value) return
  const id = detail.request.id
  const authoritative = presaleAvailableActions.value
  const version = Number(authoritative?.version)
  if (!authoritative || !Number.isInteger(version) || !authoritativePresaleActions.value.includes('COMPLETE')) {
    error.value = '服务端未授权该操作或操作状态已变化，请刷新可用操作。'
    void refreshPresaleActions(id)
    return
  }
  askReason({ title: '结束进度', label: '结束说明', required: false, confirmText: '结束售前进度', onSubmit: (reason) => submitPresaleComplete(id, version, reason) })
}

async function submitPresaleComplete(id, version, reason) {
  const mutationContext = presaleMutationContextSequence.value
  const mutationToken = ++presaleMutationLoadSequence.value
  presaleMutationLoading.value = true
  try {
    const result = await completePresaleRequest(id, { reason, version })
    if (mutationContext !== presaleMutationContextSequence.value || Number(selectedPresale.value?.request?.id) !== Number(id)) return
    presaleResult.value = result
    notice.value = '售前支持流程已完成。'
    // 任务 B：结束进度已保存；其后刷新失败由 refreshAfterPresaleWrite 给出准确提示。
    await refreshAfterPresaleWrite(id)
  } catch (value) {
    if (mutationToken === presaleMutationLoadSequence.value) showError(value)
  } finally {
    if (mutationToken === presaleMutationLoadSequence.value) presaleMutationLoading.value = false
  }
}

watch(activeSection, () => {
  closeCustomerDetail(); selectedOpportunity.value = null; closePresale(); page.number = 1
  presaleStatsColumns.value = null
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
  if (!['customers', 'opportunities', 'presale', 'notifications', 'credit-approvals', 'credit-rules'].some((section) => section === activeSection.value && ({ customers: canReadCustomers.value, opportunities: canReadOpportunities.value, presale: canReadPresales.value, notifications: canReadNotifications.value, 'credit-approvals': canApproveCredit.value, 'credit-rules': canManageCreditRules.value })[section])) {
    const fallback = canReadPresales.value ? 'presale' : canReadOpportunities.value ? 'opportunities' : canReadCustomers.value ? 'customers' : canApproveCredit.value ? 'credit-approvals' : canManageCreditRules.value ? 'credit-rules' : 'notifications'
    await router.replace({ name: 'customer_opportunity', params: { section: fallback } })
  }
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
  <AppShell
    v-model:menu-open="mobileMenuOpen"
    page-class="crm-shell"
    sidebar-class="crm-sidebar"
    brand-class="crm-brand"
    nav-class="crm-nav"
    main-class="crm-main"
    topbar-class="crm-topbar"
    content-class="crm-content"
    sidebar-user-class="subsystem-sidebar-user"
    brand-name="客户与商机管理"
    brand-subtitle="CRM 协同工作台"
    nav-label="客户与商机功能"
    :nav-groups="navGroups"
    :user-name="currentUserLabel"
    :user-role="currentRoleLabel"
    :avatar-text="currentUserInitial"
    :logout-disabled="isLoggingOut"
    logout-label="退出应用系统"
    topbar-avatar
    @navigate="handleNavigate"
    @logout="logoutSystem"
  >
    <template #sidebar-note>
      <ConsoleIcon name="shield" /><span>统一身份认证已生效，菜单与操作由服务端权限控制。</span>
    </template>

    <template #breadcrumb>
      <span>客户与商机管理</span><ConsoleIcon name="chevron" /><strong>{{ sectionTitle }}</strong>
    </template>

    <template #topbar-actions>
      <button v-if="canReadNotifications" class="console-icon-button" type="button" aria-label="打开个人通知" @click="navigate('notifications')"><ConsoleIcon name="bell" /><i v-if="notificationUnreadCount"></i></button>
    </template>

    <template #page-head>
      <header class="console-page-head crm-page-head"><div><h1>{{ activeSection === 'presale' && presaleCreatePage ? '新建售前申请' : sectionTitle }}</h1><p>{{ activeSection === 'presale' && presaleCreatePage ? '填写售前支持需求，提交后进入两级审批流程' : activeSection === 'notifications' ? '包含当前用户的商机、售前与信用等级业务通知，不受 SELF / ORG / ALL 数据范围扩展' : activeSection === 'credit-approvals' ? '仅展示当前账号可审批的信用等级调整申请' : activeSection === 'credit-rules' ? '规则仅作用于后续回款事实，不会追溯重算历史记录' : '可见数据与可执行动作均由服务端权限和状态控制' }}</p></div><div v-if="activeSection === 'presale'" class="crm-actions"><template v-if="presaleCreatePage"><button type="button" :disabled="presaleCreateLoading" @click="closePresaleCreatePage">← 返回申请列表</button></template><template v-else><button v-if="canCreatePresale && presaleRequestSubmissionAvailable" class="primary" type="button" @click="openPresaleCreatePage">新建申请</button><button v-if="canReadPresaleReports" @click="openReports">投入报表</button><button @click="loadAlerts">未读预警 {{ alerts.length }}</button><button v-if="canConfigurePresaleAlerts" @click="openAlertConfig">预警规则</button></template></div><div v-if="activeSection === 'customers'" class="crm-actions"><button v-if="canCreateCustomer" class="primary" type="button" @click="openNewCustomer">新建</button><button v-if="canImportCustomers" type="button" :disabled="!customerImportScanAvailable" :title="customerImportScanAvailable ? '' : '导入代码安全校验未启用'" @click="openCustomerImport">Excel 导入</button><button v-if="canExportCustomers" type="button" :disabled="!customerExportAvailable" :title="customerExportAvailable ? '' : '导出能力未启用'" @click="exportCustomers">导出</button></div><div v-if="activeSection === 'opportunities'" class="crm-actions"><button v-if="canCreateOpportunity" class="primary" type="button" @click="openNewOpportunity">新增商机</button><button v-if="canManageOpportunityCatalog" @click="opportunityCatalogDialog = true">基础数据配置</button><button @click="loadStageAlerts">刷新阶段告警</button><button v-if="canConfigureStageAlerts" @click="openStageAlertRuleEditor">阶段告警规则</button></div></header>
    </template>

      <OperationToast :message="error || notice" :tone="error ? 'error' : 'success'" :reference="noticeReference" /><p v-if="runtimeCapabilitiesError" class="crm-alert warning" role="status">{{ runtimeCapabilitiesError }}</p>
      <div v-if="activeSection === 'customers'" class="crm-stat-cards" aria-label="客户统计">
        <article v-for="card in customerStatCards" :key="card.key" class="crm-stat-card" :data-tone="card.tone">
          <span class="crm-stat-label">{{ card.label }}</span>
          <strong class="crm-stat-value">{{ card.value === null || card.value === undefined ? '—' : card.value }}{{ card.suffix || '' }}</strong>
          <small class="crm-stat-hint">{{ card.hint }}</small>
        </article>
      </div>
      <p v-if="activeSection === 'customers' && customerStats.error" class="crm-note crm-stat-error">{{ customerStats.error }}，客户列表仍可正常使用。</p>
      <div v-if="activeSection === 'presale' && !presaleCreatePage" class="crm-stat-cards" aria-label="售前申请统计">
        <article v-for="card in presaleStatCards" :key="card.key" class="crm-stat-card" :data-tone="card.tone">
          <span class="crm-stat-label">{{ card.label }}</span>
          <strong class="crm-stat-value">{{ card.value === null || card.value === undefined ? '—' : card.value }}{{ card.suffix || '' }}</strong>
          <small class="crm-stat-hint">{{ card.hint }}</small>
        </article>
      </div>
      <section v-if="activeSection === 'customers'" class="crm-toolbar crm-customer-filters">
        <label>客户号 / 名称<input v-model.trim="customerFilters.keyword" @keyup.enter="loadCurrent" maxlength="100"></label>
        <label>类型<input v-model.trim="customerFilters.type" list="customer-type-options" placeholder="业主 / 三方 等" maxlength="64"></label><datalist id="customer-type-options"><option v-for="item in customerTypeSuggestions" :key="item" :value="item"></option></datalist><label>行业<select v-model="customerFilters.industry"><option value="">全部行业</option><option v-for="item in customerIndustryOptions" :key="item" :value="item">{{ item }}</option></select></label><label>区域<input v-model.trim="customerFilters.region" list="customer-region-options" placeholder="华北 / 华南 等" maxlength="64"></label><datalist id="customer-region-options"><option v-for="item in customerRegionSuggestions" :key="item" :value="item"></option></datalist>
        <label>信用等级<select v-model="customerFilters.credit_level"><option value="">全部等级</option><option value="A">A · 优秀</option><option value="B">B · 良好</option><option value="C">C · 关注</option><option value="D">D · 差</option></select></label><label>查找负责人<input v-model.trim="customerOwnerKeyword" type="search" placeholder="输入姓名" @keyup.enter.prevent="loadCustomerOwnerOptions" maxlength="100"></label>
        <label v-if="!customerOwnerOptionsError">负责人<select v-model="customerFilters.owner_id" :disabled="customerOwnerOptionsLoading"><option value="">全部负责人</option><option v-for="user in customerOwnerOptions" :key="user.user_id" :value="user.user_id">{{ platformUserName(user) }}</option></select></label>
        <p v-else class="crm-note">基础平台负责人目录暂不可用，当前不能按负责人筛选。</p>
        <label>状态<select v-model="customerFilters.status"><option value="">全部状态</option><option v-for="item in customerStatusOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><label>创建开始<input v-model="customerFilters.created_from" type="date"></label><label>创建结束<input v-model="customerFilters.created_to" type="date"></label><label>最近跟进开始<input v-model="customerFilters.last_followup_from" type="date"></label><label>最近跟进结束<input v-model="customerFilters.last_followup_to" type="date"></label><label>排序<select v-model="customerFilters.sort_by"><option value="updated_at">更新时间</option><option value="created_at">创建时间</option><option value="name">客户名称</option><option value="last_followup_at">最近跟进</option><option value="opportunity_amount_sum">商机金额汇总</option></select></label><label>顺序<select v-model="customerFilters.sort_order"><option value="desc">降序</option><option value="asc">升序</option></select></label>
        <button type="button" :disabled="customerOwnerOptionsLoading" @click="loadCustomerOwnerOptions">{{ customerOwnerOptionsLoading ? '查找中…' : '查找负责人' }}</button><button @click="page.number = 1; loadCurrent()">查询</button><button @click="customerFilters.view = customerFilters.view === 'table' ? 'cards' : 'table'; syncCustomerURL()">{{ customerFilters.view === 'table' ? '卡片视图' : '列表视图' }}</button>
      </section>
      <p v-if="activeSection === 'customers' && customerOwnerOptionsError" class="crm-alert error" role="alert">{{ customerOwnerOptionsError }} 请在基础平台人员目录恢复后重试负责人筛选。</p>
      <section v-else-if="activeSection === 'opportunities' && canReadOpportunities" class="crm-toolbar"><label>关键词<input v-model.trim="filters.keyword" @keyup.enter="loadCurrent" maxlength="100"></label><label v-if="!boardMode">状态<select v-model="filters.status"><option value="">全部状态</option><option v-for="item in opportunityStatusOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><label v-if="!boardMode">阶段<select v-model="filters.stage"><option value="">全部阶段</option><option v-for="item in opportunityStageOptions" :key="item" :value="item">{{ item }}</option></select></label><button @click="loadCurrent">查询</button><button @click="boardMode = !boardMode; loadCurrent()">{{ boardMode ? '列表视图' : '阶段看板' }}</button></section>
      <form v-else-if="activeSection === 'presale' && !presaleCreatePage" class="crm-toolbar crm-presale-filters" @submit.prevent="applyPresaleFilters"><label>申请编号<input v-model.trim="presaleFilters.request_no" maxlength="32"></label><label>商机<select v-model="presaleFilters.opportunity_id"><option value="">全部可见商机</option><option v-for="item in presaleFilterOptions.opportunities" :key="item.value" :value="String(item.value)">{{ item.label }}</option></select></label><label>申请人<select v-model="presaleFilters.applicant_id"><option value="">全部可见申请人</option><option v-for="item in presaleFilterOptions.applicants" :key="item.value" :value="item.value">{{ presalePersonOptionLabel(item) }}</option></select></label><label>执行人<select v-model="presaleFilters.assignee_id"><option value="">全部可见执行人</option><option v-for="item in presaleFilterOptions.assignees" :key="item.value" :value="item.value">{{ presalePersonOptionLabel(item) }}</option></select></label><label>状态<select v-model="presaleFilters.status"><option value="">全部可见状态</option><option v-for="item in presaleFilterOptions.statuses" :key="item.value" :value="item.value">{{ presaleOptionText('statuses', item) }}</option></select></label><label>场地<select v-model="presaleFilters.venue"><option value="">全部可见场地</option><option v-for="item in presaleFilterOptions.venues" :key="item.value" :value="item.value">{{ presaleOptionText('venues', item) }}</option></select></label><label>紧急度<select v-model="presaleFilters.urgency"><option value="">全部可见级别</option><option v-for="item in presaleFilterOptions.urgencies" :key="item.value" :value="item.value">{{ presaleOptionText('urgencies', item) }}</option></select></label><label>申请开始<input v-model="presaleFilters.created_from" type="datetime-local"></label><label>申请结束（不含）<input v-model="presaleFilters.created_to" type="datetime-local"></label><label>期望开始<input v-model="presaleFilters.expected_from" type="datetime-local"></label><label>期望结束（不含）<input v-model="presaleFilters.expected_to" type="datetime-local"></label><label>是否超时<select v-model="presaleFilters.overdue"><option value="">全部</option><option value="true">已超时</option><option value="false">未超时</option></select></label><label>排序<select v-model="presaleFilters.sort_by"><option value="created_at">申请时间</option><option value="updated_at">更新时间</option><option value="expected_end">期望结束</option><option value="request_no">申请编号</option></select></label><label>顺序<select v-model="presaleFilters.sort_order"><option value="desc">降序</option><option value="asc">升序</option></select></label><button class="primary">查询</button><button type="button" @click="switchPresaleView(presaleView === 'list' ? 'board' : 'list')">{{ presaleView === 'list' ? '状态看板' : '列表视图' }}</button></form>
      <div v-if="activeSection === 'presale' && !presaleCreatePage" class="crm-presale-viewbar">
        <div class="crm-tabs" role="group" aria-label="按售前申请状态筛选">
          <button v-for="tab in presaleStatusTabs" :key="tab.value || 'all'" type="button" :class="{ active: presaleFilters.status === tab.value }" :aria-pressed="presaleFilters.status === tab.value" @click="usePresaleStatusFilter(tab.value)">
            {{ tab.label }}<span v-if="tab.count !== null && tab.count !== undefined" class="crm-tab-count">{{ tab.count }}</span>
          </button>
        </div>
        <p class="crm-note">状态页签只收窄当前筛选，不会扩大服务端授权范围；看板/列表切换仍由上方按钮控制。</p>
      </div>
      <PresaleApprovalRulesPanel v-if="activeSection === 'presale' && !presaleCreatePage && canManagePresaleApprovalRules" :is-admin="canManagePresaleApprovalRules" />
      <p v-if="activeSection === 'presale' && presaleFilterOptionsError" class="crm-alert error" role="alert">{{ presaleFilterOptionsError }}</p><p v-else-if="activeSection === 'presale' && presaleFilterOptions.truncated" class="crm-note">筛选选项已按服务端上限截断；输入已有条件可继续缩小结果。</p>

      <section v-if="activeSection === 'customers'" class="crm-quick-filters" aria-label="客户快捷筛选"><button :class="{ active: customerFilters.quick_filter === 'NEW' }" @click="useCustomerQuickFilter('NEW')">新增客户（近 30 天）</button><button :class="{ active: customerFilters.quick_filter === 'WON' }" @click="useCustomerQuickFilter('WON')">成交客户</button><button :class="{ active: customerFilters.quick_filter === 'FOLLOWUP_DUE' }" @click="useCustomerQuickFilter('FOLLOWUP_DUE')">待跟进</button></section>

      <section v-if="activeSection === 'notifications'" class="crm-panel crm-inbox"><div class="crm-panel-heading"><div><h2>我的业务通知</h2><p class="crm-note">包含当前用户的商机、售前与信用等级通知；点击后标为已读，并通过真实详情接口再次校验对象权限。</p></div><label class="check"><input v-model="notificationUnreadOnly" type="checkbox">仅看未读</label></div><ListState v-if="notificationsListState" :loading="loading" :error="listError" error-title="业务通知加载失败" :empty-title="notificationUnreadOnly ? '暂无未读个人通知' : '暂无个人通知'" @retry="loadCurrent"><template #empty-action><button v-if="notificationUnreadOnly" type="button" class="crm-state-action" @click="notificationUnreadOnly = false">查看全部通知</button></template></ListState><div v-else class="crm-inbox-list"><button v-for="item in notifications" :key="item.id" :class="['crm-inbox-item', { unread: item.status === 'UNREAD' }]" @click="openNotification(item)"><span class="crm-status">{{ item.status === 'UNREAD' ? '未读' : '已读' }}</span><strong>{{ item.title }}</strong><span>{{ item.body }}</span><small>{{ notificationContext(item) }} · {{ formatDate(item.created_at) }}</small></button></div></section>
      <CreditApprovalInbox v-if="activeSection === 'credit-approvals'" :permissions="crmSession?.permissions || []" :roles="crmSession?.roles || []" />
      <CreditRuleSettingsPanel v-if="activeSection === 'credit-rules'" @notice="notice = $event" @error="error = $event" />

      <section v-if="activeSection === 'customers'" class="crm-panel table-panel"><ListState v-if="customersListState" :loading="loading" :error="listError" error-title="客户列表加载失败" empty-title="暂无符合条件的客户" @retry="loadCurrent"><template #empty-action><button type="button" class="crm-state-action" @click="resetCustomerFilters">重置筛选</button></template></ListState><table v-else-if="customerFilters.view === 'table'" class="crm-data-table"><thead><tr><th scope="col">客户编号</th><th scope="col">客户名称</th><th scope="col">信用等级</th><th scope="col">类型</th><th scope="col">行业 / 区域</th><th scope="col">负责人</th><th scope="col">状态</th><th scope="col" title="包含客户沟通记录和关联商机跟进记录">最近跟进（含商机）</th><th scope="col">商机金额汇总</th><th scope="col">操作</th></tr></thead><tbody><tr v-for="item in customers" :key="item.id" @click="openCustomer(item.id)"><td>{{ item.customer_no }}</td><td>{{ item.name }}</td><td><span class="crm-credit-level crm-credit-level--inline" :class="`is-${String(item.credit_level || 'B').toLowerCase()}`">{{ creditLevelLabel(item.credit_level) }}</span></td><td>{{ item.customer_type }}</td><td>{{ item.industry }} / {{ item.region }}</td><td>{{ ownerLabel(item) }}</td><td><span class="crm-badge" :class="customerStatusTone(item.status)">{{ customerStatusText(item.status) }}</span></td><td>{{ formatDate(item.last_followup_at) }}</td><td>{{ formatAmount(item.opportunity_amount_sum) }}</td><td class="crm-table-actions"><button type="button" class="crm-table-link" @click.stop="openCustomer(item.id)">查看</button><button type="button" class="crm-table-link" @click.stop="editCustomerFromList(item)">编辑</button></td></tr></tbody></table><div v-else class="crm-customer-cards" :data-quick-filter="customerFilters.quick_filter"><button v-for="item in customers" :key="item.id" :data-status="item.status" @click="openCustomer(item.id)"><strong>{{ item.name }} <span class="crm-credit-level crm-credit-level--inline" :class="`is-${String(item.credit_level || 'B').toLowerCase()}`">{{ creditLevelLabel(item.credit_level) }}</span></strong><span>{{ item.customer_no }} · {{ customerStatusText(item.status) }}</span><span>{{ item.customer_type }} · {{ item.industry }} / {{ item.region }}</span><span>负责人：{{ ownerLabel(item) }}</span><span>最近跟进（含商机）：{{ formatDate(item.last_followup_at) }}</span><span>商机金额汇总：{{ formatAmount(item.opportunity_amount_sum) }}</span></button></div><PaginationBar class="crm-pagination" label="客户列表分页" :page="renderedPage.number" :total="renderedPage.total" :page-size-options="[20, 50, 100]" :page-size="renderedPage.size" :loading="loading" @change="changeCustomerPage" @change-page-size="changeCustomerPageSize" /></section>
      <section v-if="activeSection === 'opportunities' && !boardMode" class="crm-panel table-panel"><ListState v-if="opportunitiesListState" :loading="loading" :error="listError" error-title="商机列表加载失败" empty-title="暂无符合条件的商机" @retry="loadCurrent"><template #empty-action><button type="button" class="crm-state-action" @click="resetOpportunityFilters">重置筛选</button></template></ListState><table v-else class="crm-data-table"><thead><tr><th scope="col">商机编号</th><th scope="col">名称</th><th scope="col">客户</th><th scope="col">预计金额</th><th scope="col">预计签单</th><th scope="col">阶段</th><th scope="col">状态</th><th scope="col">负责人</th><th scope="col">已签约合同</th><th scope="col">终态待办</th></tr></thead><tbody><tr v-for="item in opportunities" :key="item.id" @click="openOpportunity(item.id)"><td>{{ item.opportunity_no }}</td><td>{{ item.name }}</td><td>{{ item.customer_name || `客户 #${item.customer_id}` }}</td><td>{{ formatAmount(item.expected_amount) }}</td><td>{{ formatDate(item.expected_sign_date) }}</td><td><span class="crm-badge" :class="opportunityStageTone(item.current_stage)">{{ item.current_stage }}</span></td><td><span class="crm-badge" :class="opportunityStatusTone(item.opp_status)">{{ opportunityStatusText(item.opp_status) }}</span></td><td>{{ ownerLabel(item.owner_user_id) }}</td><td>{{ formatSignedContractCount(item.signed_contract_count) }}</td><td><span v-if="item.terminal_pending_type && item.terminal_pending_type !== 'NONE'" class="crm-badge crm-badge--warning">{{ terminalPendingText(item.terminal_pending_type) }}</span><span v-else class="crm-note">—</span></td></tr></tbody></table><PaginationBar class="crm-pagination" label="商机列表分页" :page="renderedPage.number" :total="renderedPage.total" :page-size-options="[20, 50, 100]" :page-size="renderedPage.size" :loading="loading" @change="changeOpportunityPage" @change-page-size="changeOpportunityPageSize" /></section>
      <section v-if="activeSection === 'opportunities' && boardMode" :class="opportunityBoardState ? 'crm-panel table-panel' : ''"><ListState v-if="opportunityBoardState" :loading="loading" :error="listError" error-title="商机阶段看板加载失败" empty-title="暂无符合条件的商机" @retry="loadCurrent"><template #empty-action><button type="button" class="crm-state-action" @click="resetOpportunityFilters">重置筛选</button></template></ListState><div v-else class="crm-board crm-opportunity-board">
          <article v-for="column in board" :key="column.stage" class="crm-board-column" :class="{ 'is-terminal': column.stage === '已签约' || column.stage === '失败', 'is-won': column.stage === '已签约', 'is-lost': column.stage === '失败' }" :data-stage="column.stage">
            <h2><span class="crm-board-dot" aria-hidden="true"></span>{{ column.stage }}<small>{{ column.items?.length || 0 }}</small></h2>
            <button v-for="item in column.items" :key="item.id" class="crm-board-card" @click="openOpportunity(item.id)">
              <span class="crm-board-card-head"><strong>{{ item.name }}</strong></span>
              <span class="crm-board-customer">{{ item.customer_name || ('客户 #' + item.customer_id) }}</span>
              <span class="crm-board-card-row"><strong class="crm-board-amount">{{ formatAmount(item.expected_amount) }}</strong><span>{{ item.expected_sign_date ? '预计 ' + formatDate(item.expected_sign_date) : '预计签单待定' }}</span></span>
              <span class="crm-board-owner"><span class="crm-avatar crm-avatar--sm" aria-hidden="true">{{ personInitial(ownerLabel(item.owner_user_id)) }}</span><span>{{ ownerLabel(item.owner_user_id) }}</span></span>
              <span v-if="item.current_stage === '已签约'" class="crm-terminal win">已签约 · 合同 {{ item.contract_ref || '待关联' }}</span>
              <span v-else-if="item.current_stage === '失败'" class="crm-terminal lose">失败 · {{ item.lost_reason || '待补原因' }}</span>
              <span v-else-if="item.signed_contract_count" class="crm-board-meta">历史已签约合同 {{ formatSignedContractCount(item.signed_contract_count) }}</span>
            </button>
          </article>
        </div></section>
      <section v-if="activeSection === 'opportunities'" class="crm-panel crm-stage-alerts"><div class="crm-panel-heading"><div><h2>阶段超时告警</h2><p class="crm-note">服务端个人列表当前返回已触发的未读/已读告警；待处理和已取消状态不会进入个人查询结果。</p></div><label class="check"><input v-model="stageAlertUnreadOnly" type="checkbox">仅看未读</label></div><p v-if="stageRuleForbidden" class="crm-alert error" role="alert">无阶段告警规则配置权限（403）；告警查询仍按现有权限执行。</p><div v-if="stageAlerts.length" class="crm-stage-alert-grid"><button v-for="item in stageAlerts" :key="item.id" @click="selectedStageAlert = item"><strong>{{ item.opportunity_no }}</strong><span>{{ item.stage }} · {{ stageAlertStatusText(item.status) }}</span><small>应提醒 {{ formatDate(item.due_at) }}</small></button></div><div v-else class="crm-empty compact">暂无{{ stageAlertUnreadOnly ? '未读' : '' }}阶段超时告警</div><p class="crm-status-legend"><span>待处理：Worker 尚未投递</span><span>已触发：站内告警已生成</span><span>已取消：阶段、终态、作废或负责人变化后失效</span></p></section>
      <section v-if="activeSection === 'presale' && alerts.length" class="crm-panel crm-alert-list"><h2>未读预警</h2><p class="crm-note">个人预警仅合并当前登录用户的内部人员身份，不随 SELF/ORG/ALL 数据范围扩大。</p><button v-for="item in alerts" :key="item.id" @click="readAlert(item)"><strong>{{ alertTypeText(item.alert_type) }}</strong><span>{{ item.request_no }} · 起算 {{ formatDate(item.basis_at) }} · 阈值 {{ formatDate(item.due_at) }}</span></button></section>
      <section v-if="activeSection === 'presale' && !presaleCreatePage"><section v-if="presaleView === 'list'" class="crm-panel table-panel"><h2>售前申请列表</h2><p class="crm-note">列表范围由角色决定；点击记录查看详情、工时和服务端允许的动作。</p><ListState v-if="presaleListState" :loading="loading" :error="listError" error-title="售前申请加载失败" empty-title="暂无可见申请" @retry="loadCurrent"><template #empty-action><button type="button" class="crm-state-action" @click="resetPresaleFilters">重置筛选</button></template></ListState><table v-else class="crm-data-table"><thead><tr><th scope="col">申请编号</th><th scope="col">商机</th><th scope="col">申请人</th><th scope="col">状态</th><th scope="col">场地 / 紧急度</th><th scope="col">执行人</th><th scope="col">累计工时</th><th scope="col">期望结束</th><th scope="col">超时</th></tr></thead><tbody><tr v-for="item in presales" :key="presaleRequestID(item)" @click="openPresale(presaleRequestID(item))"><td>{{ item.request_no }}</td><td>{{ presaleOpportunityLabel(item) }}</td><td>{{ applicantLabel(item) }}</td><td><span class="crm-badge" :class="presaleStatusTone(item.status)">{{ requestStatusText(item.status) }}</span></td><td><span class="crm-tag">{{ venueText(item.venue) }}</span><span class="crm-tag" :class="{ 'is-urgent': item.urgency === 'URGENT' }">{{ urgencyText(item.urgency) }}</span></td><td>{{ assignees(item.current_assignees) }}</td><td>{{ item.total_work_hours }} 小时</td><td>{{ formatDate(item.expected_end) }}</td><td><span class="crm-badge" :class="item.overdue ? 'crm-badge--danger' : 'crm-badge--gray'">{{ item.overdue ? '已超时' : '未超时' }}</span></td></tr></tbody></table><PaginationBar class="crm-pagination" label="售前申请列表分页" :page="presalePage.number" :total="presalePage.total" :page-size="presalePage.size" :loading="loading" @change="changePresalePage" /></section><section v-else class="crm-panel crm-presale-board-panel"><div class="crm-panel-heading"><div><h2>售前状态看板</h2><p class="crm-note">只读看板，不支持拖拽改状态。每列最多显示服务端返回的 {{ presaleColumnLimit }} 条，列总数不受截断影响。</p></div></div><ListState v-if="presaleBoardState" :loading="loading" :error="listError" error-title="售前状态看板加载失败" empty-title="暂无可见申请" @retry="loadCurrent"><template #empty-action><button type="button" class="crm-state-action" @click="resetPresaleFilters">重置筛选</button></template></ListState><div v-else class="crm-board crm-presale-board"><article v-for="column in presaleBoard" :key="column.status" class="crm-board-column" :data-status="column.status"><h2><span class="crm-board-dot" aria-hidden="true"></span>{{ requestStatusText(column.status) }}<small>{{ column.total }}</small></h2><button v-for="item in column.items" :key="presaleRequestID(item)" type="button" class="crm-board-card" :aria-label="`打开售前申请 ${item.request_no}`" :disabled="!presaleRequestID(item)" @click="openPresale(presaleRequestID(item))"><span class="crm-board-card-head"><strong>{{ item.request_no }}</strong><span class="crm-badge" :class="presaleStatusTone(item.status)">{{ requestStatusText(item.status) }}</span></span><span class="crm-board-customer"><span>{{ presaleOpportunityLabel(item) }}</span></span><span class="crm-board-card-row"><span>{{ applicantLabel(item) }} · {{ urgencyText(item.urgency) }}</span><span>{{ item.overdue ? '已超时' : '未超时' }}</span></span><span class="crm-board-owner"><span>{{ assignees(item.current_assignees) }}</span></span><span class="crm-board-meta">{{ item.total_work_hours }} 小时</span></button><p v-if="Number(column.total) > (column.items?.length || 0)" class="crm-note">另有 {{ Number(column.total) - (column.items?.length || 0) }} 条未在本列展示</p><p v-else-if="!column.items?.length" class="crm-empty compact">暂无任务</p></article></div></section></section>
      <section v-if="activeSection === 'presale' && presaleCreatePage" class="crm-presale-create-page">
        <div class="crm-presale-create-steps">
          <p class="crm-presale-create-steps__label">填写步骤</p>
          <ol aria-label="申请填写步骤">
            <li><b>1</b><span>关联商机</span></li>
            <li><b>2</b><span>支持信息</span></li>
            <li><b>3</b><span>时间安排</span></li>
          </ol>
        </div>
        <div class="crm-presale-create-notice" role="status">
          <strong>提交前说明</strong>
          <span>仅可选择跟进中的初步接触、需求沟通、方案制定、报价或投标阶段商机；申请不会自动调整商机阶段，现场支持必须填写服务地址。</span>
        </div>
        <form id="presale-create-form" class="crm-panel crm-presale-create-form" @submit.prevent="submitPresaleFromList">
          <section class="crm-presale-create-section" aria-labelledby="presale-create-opportunity-heading">
            <header><b>01</b><div><h2 id="presale-create-opportunity-heading">关联商机</h2><p>选择本次售前支持对应的商机。</p></div></header>
            <div class="crm-business-picker">
              <label>查找商机<input v-model.trim="presaleOpportunityKeyword" type="search" placeholder="输入商机编号或名称" @keyup.enter.prevent="loadPresaleOpportunityOptions" maxlength="100"></label>
              <button type="button" :disabled="presaleOpportunityOptionsLoading" @click="loadPresaleOpportunityOptions">{{ presaleOpportunityOptionsLoading ? '查询中…' : '查询商机' }}</button>
              <label>关联商机 *<select v-model="presaleForm.opportunity_id" required :disabled="presaleOpportunityOptionsLoading || !presaleOpportunityOptions.length"><option value="" disabled>请选择商机</option><option v-for="opportunity in presaleOpportunityOptions" :key="opportunity.id" :value="String(opportunity.id)">{{ opportunity.name }}（{{ opportunity.opportunity_no }}）</option></select></label>
              <small v-if="presaleOpportunityOptionsError" class="crm-alert error" role="alert">{{ presaleOpportunityOptionsError }}</small><small v-else-if="!presaleOpportunityOptionsLoading && !presaleOpportunityOptions.length" class="crm-note">暂无符合售前发起条件的商机。</small>
            </div>
          </section>
          <section class="crm-presale-create-section" aria-labelledby="presale-create-support-heading">
            <header><b>02</b><div><h2 id="presale-create-support-heading">支持信息</h2><p>说明支持方式、对接人和具体需求。</p></div></header>
            <div class="crm-presale-create-fields">
              <label>支持方式 *<select v-model="presaleForm.venue" required><option value="REMOTE">远程</option><option value="ONSITE">现场</option></select></label>
              <label>紧急程度 *<select v-model="presaleForm.urgency" required><option value="NORMAL">普通</option><option value="URGENT">紧急</option></select></label>
              <label v-if="presaleForm.venue === 'ONSITE'" class="full">服务地址 *<input v-model.trim="presaleForm.service_address" required maxlength="500" placeholder="客户现场详细地址"></label>
              <label>联系人 *<input v-model.trim="presaleForm.contact_name" required maxlength="100" placeholder="客户对接人姓名 / 部门"></label>
              <label>联系电话 *<input v-model.trim="presaleForm.contact_phone" required maxlength="64" placeholder="客户对接人联系电话"></label>
              <label>需求说明 *<textarea v-model.trim="presaleForm.description" required rows="4" placeholder="请描述客户背景、期望支持内容和交付目标" maxlength="10000"></textarea></label>
            </div>
          </section>
          <section class="crm-presale-create-section" aria-labelledby="presale-create-schedule-heading">
            <header><b>03</b><div><h2 id="presale-create-schedule-heading">时间安排</h2><p>填写客户期望的支持时间范围。</p></div></header>
            <div class="crm-presale-create-fields">
              <label>预计开始 *<input v-model="presaleForm.expected_start" type="datetime-local" required></label>
              <label>预计结束 *<input v-model="presaleForm.expected_end" type="datetime-local" required></label>
            </div>
          </section>
          <footer class="crm-presale-create-actions"><p><span aria-hidden="true">*</span> 为必填项，提交后进入审批流程。</p><div class="crm-actions"><button type="button" :disabled="presaleCreateLoading" @click="closePresaleCreatePage">取消</button><button class="primary" type="submit" :disabled="presaleCreateLoading || !presaleForm.opportunity_id">{{ presaleCreateLoading ? '提交中…' : '提交申请' }}</button></div></footer>
        </form>
      </section>

    <template #overlay>
    <div v-if="showAlertConfig" class="console-modal-backdrop" role="presentation" @click.self="showAlertConfig = false">
      <section class="console-detail-modal crm-alert-rules-dialog" role="dialog" aria-modal="true" aria-label="售前预警规则">
        <header>
          <div><p class="console-modal-eyebrow">售前技术支持</p><h2>售前预警规则</h2></div>
          <button class="console-modal-close" type="button" aria-label="关闭售前预警规则" @click="showAlertConfig = false"><ConsoleIcon name="close" /></button>
        </header>
        <div class="crm-alert-rules-dialog__body">
          <p class="console-card-hint">单位为小时。每次保存都会生成新版本，并且只影响后续扫描。</p>
          <p v-if="alertConfigLoading" role="status">正在加载预警规则…</p>
          <div v-if="alertConfigError" role="alert"><p>{{ alertConfigError }}</p><button type="button" :disabled="alertConfigLoading || !!alertRuleSavingType" @click="openAlertConfig">重新加载</button></div>
          <div v-if="!alertConfigLoading" class="console-setting-list">
            <article v-for="rule in alertRules" :key="rule.type" class="console-setting-row crm-alert-rule">
              <div class="crm-alert-rule__identity"><strong>{{ alertTypeText(rule.type) }}</strong><p v-if="rule.configured === false">未配置 · 保存后生效，默认未启用</p><p v-else>版本 {{ rule.config_version }} · 更新于 {{ formatDate(rule.updated_at) }}</p></div>
              <label class="console-form-item crm-alert-rule__threshold"><span>阈值（小时）</span><input v-model.number="rule.threshold_hours" :disabled="!!alertRuleSavingType" class="console-number-input" type="number" min="0" max="8760" step="1"></label>
              <div class="crm-alert-rule__switch"><span>启用规则</span><button :disabled="!!alertRuleSavingType" :class="['console-switch', { on: rule.enabled }]" type="button" :aria-pressed="rule.enabled" :aria-label="`${alertTypeText(rule.type)}${rule.enabled ? '已启用' : '已停用'}`" @click="rule.enabled = !rule.enabled"><i></i></button></div>
              <button class="console-button primary small" :disabled="!!alertRuleSavingType || alertConfigLoading" type="button" @click="saveAlertRule(rule)">{{ alertRuleSavingType === rule.type ? '保存中…' : '保存预警规则' }}</button>
            </article>
          </div>
        </div>
        <footer><button class="console-button ghost" type="button" @click="showAlertConfig = false">关闭</button></footer>
      </section>
    </div>
    <div v-if="showStageAlertRules" class="console-modal-backdrop" role="presentation" @click.self="showStageAlertRules = false">
      <section class="console-detail-modal crm-stage-rule-dialog" role="dialog" aria-modal="true" aria-label="商机阶段超时规则">
        <header><div><p class="console-modal-eyebrow">商机推进 · 预警配置</p><h2>商机阶段超时规则</h2></div><button class="console-modal-close" type="button" aria-label="关闭商机阶段超时规则" @click="showStageAlertRules = false"><ConsoleIcon name="close" /></button></header>
        <div class="crm-stage-rule-dialog__body"><section class="crm-stage-rule-dialog__intro"><span class="crm-stage-rule-dialog__intro-icon" aria-hidden="true">时</span><div><strong>配置各阶段的超时提醒阈值</strong><p>仅前五个推进阶段可配置，单位为小时。保存后仅影响后续扫描，已有告警不会被重写。</p></div></section><div class="crm-stage-rule-list"><article v-for="(rule, index) in stageAlertRules" :key="rule.stage" class="crm-stage-rule-card" :class="{ 'is-disabled': !rule.enabled }"><div class="crm-stage-rule-card__order">{{ String(index + 1).padStart(2, '0') }}</div><div class="crm-stage-rule-card__identity"><strong>{{ rule.stage }}</strong><span>{{ rule.enabled ? '规则已启用' : '规则已停用' }}</span></div><label class="console-form-item crm-stage-rule-card__threshold"><span>超时阈值（小时）</span><div><input v-model.number="rule.threshold_hours" class="console-number-input" type="number" min="1" max="8760"><small>1–8760 小时</small></div></label><div class="crm-stage-rule-card__switch"><span>启用规则</span><button :class="['console-switch', { on: rule.enabled }]" type="button" :aria-pressed="rule.enabled" :aria-label="`${rule.stage}${rule.enabled ? '已启用' : '已停用'}`" @click="rule.enabled = !rule.enabled"><i></i></button></div><div class="crm-stage-rule-card__meta"><span>配置版本 {{ rule.config_version }}</span><span>数据版本 {{ rule.version }}</span><span>{{ formatDate(rule.updated_at) }}</span></div><button class="console-button primary small crm-stage-rule-card__save" type="button" @click="saveStageAlertRule(rule)">保存阶段规则</button></article></div></div>
        <footer><p>规则变更即时生效，超时告警由后台任务按规则扫描生成。</p><button class="console-button ghost" type="button" @click="showStageAlertRules = false">关闭</button></footer>
      </section>
    </div>
    <StageAlertDetailModal
      v-if="selectedStageAlert"
      :alert="selectedStageAlert"
      @close="selectedStageAlert = null"
      @open="openStageAlertOpportunity(selectedStageAlert)"
    />
    <div v-if="showReport" class="console-modal-backdrop" role="presentation" @click.self="showReport = false">
      <article class="console-detail-modal crm-report-dialog" role="dialog" aria-modal="true" aria-label="售前投入报表">
        <header>
          <div><p class="console-modal-eyebrow">售前技术支持</p><h2>售前投入报表</h2></div>
          <button class="console-modal-close" type="button" aria-label="关闭售前投入报表" @click="showReport = false"><ConsoleIcon name="close" /></button>
        </header>
        <div class="crm-report-dialog__body"><p v-if="reportError" class="crm-alert error" role="alert">{{ reportError }}</p>
          <section class="crm-report-intro" aria-label="报表说明"><div><p>投入洞察</p><h3>按工时记录，掌握售前资源投入</h3><span>时间按当前浏览器时区输入，服务端以 UTC 半开区间统计；趋势按 UTC 日期归集。</span></div><strong><small>统计口径</small>标准小时</strong></section>
          <form class="console-form-grid crm-report-filters" @submit.prevent="loadReports">
            <div class="crm-report-filters__heading"><div><strong>筛选范围</strong><span>组织、人员和商机选项仅展示当前授权范围内的数据。</span></div><button class="console-button ghost" type="button" :disabled="reportLoading || reportFilterOptionsLoading" @click="loadReportFilterOptions">刷新选项</button></div>
            <label class="console-form-item"><span>开始时间 *</span><input v-model="reportFilters.from" type="datetime-local" required></label>
            <label class="console-form-item"><span>结束时间 *</span><input v-model="reportFilters.to" type="datetime-local" required></label>
            <label class="console-form-item"><span>归属组织</span><select v-model="reportFilters.organization_id" :disabled="reportFilterOptionsLoading" @change="onReportOrganizationChange"><option value="">全部可见组织</option><option v-for="organization in reportOrganizationOptions" :key="organization.organization_id" :value="organization.organization_id">{{ organization.organization_name }}</option></select></label>
            <label class="console-form-item"><span>参与人员</span><select v-model="reportFilters.person_id" :disabled="reportFilterOptionsLoading" @change="onReportPersonChange"><option value="">全部可见人员</option><option v-for="item in reportFilterOptions.assignees" :key="item.value" :value="item.value">{{ presalePersonOptionLabel(item) }}</option></select></label>
            <label class="console-form-item"><span>关联商机</span><select v-model="reportFilters.opportunity_id" :disabled="reportFilterOptionsLoading" @change="loadReportFilterOptions"><option value="">全部可见商机</option><option v-for="item in reportFilterOptions.opportunities" :key="item.value" :value="String(item.value)">{{ item.label }}</option></select></label>
            <label class="console-form-item"><span>分布维度</span><select v-model="reportFilters.dimension"><option value="PERSON">人员</option><option value="DEPARTMENT">部门</option><option value="OPPORTUNITY">商机</option></select></label>
            <div class="crm-report-filter-actions"><button class="console-button primary" type="submit" :disabled="reportLoading">{{ reportLoading ? '加载中…' : '查询' }}</button><button class="console-button ghost" type="button" @click="exportReport">导出</button></div>
          </form>
          <p v-if="reportFilterOptionsError" class="crm-alert error" role="alert">{{ reportFilterOptionsError }} 请关闭报表后重试；不会退回为手填 ID。</p>
          <template v-if="reportSummary"><div class="crm-kpis"><div class="crm-kpi crm-kpi--primary"><span>投入小时</span><strong>{{ reportSummary.work_hours }}</strong><small>已登记的有效工时</small></div><div class="crm-kpi crm-kpi--violet"><span>参与人数</span><strong>{{ reportSummary.participant_count }}</strong><small>有工时记录的执行人员</small></div><div class="crm-kpi crm-kpi--amber"><span>自动完成任务</span><strong>{{ reportSummary.auto_completed_task_count }}</strong><small>按自动完成规则归集</small></div><div class="crm-kpi crm-kpi--green"><span>商机覆盖率</span><strong>{{ reportSummary.opportunity_coverage_rate_percent }}%</strong><small>{{ reportSummary.covered_opportunity_count }} / {{ reportSummary.active_opportunity_count }} 个活跃商机</small></div></div>
          <div class="crm-report-insights"><section class="crm-report-chart"><div class="crm-report-section-title"><div><span>结构分析</span><h3>投入分布</h3></div><small>{{ ({ PERSON: '按人员', DEPARTMENT: '按部门', OPPORTUNITY: '按商机' })[reportFilters.dimension] }}查看</small></div><div v-for="item in reportDistribution" :key="item.dimension_id" class="crm-report-bar"><span>{{ item.dimension_name }}</span><i :style="{ width: reportBarWidth(item.work_hours) }"></i><strong>{{ item.work_hours }} 小时</strong></div><p v-if="!reportDistribution.length" class="crm-note">当前筛选没有投入记录。</p></section>
          <section class="crm-report-table-section"><div class="crm-report-section-title"><div><span>时间趋势</span><h3>趋势数值表（UTC 日）</h3></div><small>按日连续补齐</small></div><div class="console-table-card"><div class="console-table-scroll"><table class="console-data-table crm-report-table"><thead><tr><th scope="col">日期</th><th scope="col">工时</th><th scope="col">参与人数</th><th scope="col">工时记录</th></tr></thead><tbody><tr v-for="item in reportTrend" :key="item.date"><td>{{ item.date }}</td><td>{{ item.work_hours }}</td><td>{{ item.participant_count }}</td><td>{{ item.worklog_count }}</td></tr></tbody></table></div></div></section></div>
          <section class="crm-report-table-section crm-report-table-section--distribution"><div class="crm-report-section-title"><div><span>明细核对</span><h3>分布数值表</h3></div><small>与上方分布图口径一致</small></div><div class="console-table-card"><div class="console-table-scroll"><table class="console-data-table crm-report-table"><thead><tr><th scope="col">维度</th><th scope="col">部门</th><th scope="col">工时</th><th scope="col">人数</th><th scope="col">任务</th><th scope="col">工时记录</th></tr></thead><tbody><tr v-for="item in reportDistribution" :key="`row-${item.dimension_id}`"><td>{{ item.dimension_name }}</td><td>{{ item.department || '—' }}</td><td>{{ item.work_hours }}</td><td>{{ item.participant_count }}</td><td>{{ item.request_count }}</td><td>{{ item.worklog_count }}</td></tr></tbody></table></div></div></section></template>
        </div>
        <footer><button class="console-button ghost" type="button" @click="showReport = false">关闭</button></footer>
      </article>
    </div>

    <component
      :is="customerEditorDialog"
      v-if="customerDialog"
      :form="customerForm"
      :edit-mode="customerEditMode"
      :busy="actionLoading"
      :contacts-loading="customerEditContactsLoading"
      :contacts-error="customerEditContactsError"
      :nested="!!selectedCustomer"
      :session="crmSession"
      :customer-type-suggestions="customerTypeSuggestions"
      :industry-options="customerIndustryOptions"
      :region-suggestions="customerRegionSuggestions"
      @submit="submitCustomer"
      @close="closeCustomerDialog"
      @add-contact="addCustomerContact"
      @remove-contact="customerEditor.removeContact"
    />
    <div v-if="customerImportDialog" class="crm-modal" role="dialog" aria-modal="true"><form class="crm-import-wizard" @submit.prevent="previewImport"><h2>客户 Excel 导入</h2><p class="crm-note">第一步：上传 .xlsx 后由服务端先执行文件格式和内容结构校验，再进行固定表头和逐行预检。浏览器不会读取 Excel 内容，也不会保存文件或敏感字段。</p><template v-if="!customerImportPreview"><section class="crm-import-template" aria-labelledby="customer-import-template-title"><h3 id="customer-import-template-title">填写示例</h3><p class="crm-note">下载模板后，请将示例行替换为真实客户数据，无需填写任何人员或组织 ID。新客户自动归当前导入人，所属组织由系统确认；如需交接给其他人员，请在导入后使用“变更负责人”。</p><div class="crm-import-template-scroll" data-table-scroll><table><thead><tr><th scope="col" v-for="column in customerImportTemplateColumns" :key="column[0]">{{ column[0] }}</th></tr></thead><tbody><tr><td v-for="column in customerImportTemplateColumns" :key="column[0]">{{ column[1] }}</td></tr></tbody></table></div><button type="button" @click="downloadCustomerImportExample">下载 .xlsx 示例文件</button></section><label>Excel 文件<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required @change="selectCustomerImportFile"></label><label>导入原因<textarea v-model.trim="customerImportForm.reason" required maxlength="500"></textarea></label><div class="crm-actions"><button type="button" @click="closeCustomerImport">取消</button><button class="primary" :disabled="actionLoading || !customerImportForm.file || !customerImportForm.reason">{{ actionLoading ? '服务端校验与预检中…' : '上传并预检' }}</button></div></template><template v-else><h3>第二步：服务端预检结果</h3><dl class="crm-import-summary"><dt>任务号</dt><dd>{{ customerImportPreview.job_no }}</dd><dt>状态</dt><dd>{{ customerImportPreview.status }}</dd><dt>总行数</dt><dd>{{ customerImportPreview.total_rows }}</dd><dt>可导入</dt><dd>{{ customerImportPreview.importable_rows }}</dd><dt>警告</dt><dd>{{ customerImportPreview.warning_rows }}</dd><dt>错误</dt><dd>{{ customerImportPreview.error_rows }}</dd><dt>预检过期时间</dt><dd>{{ formatDate(customerImportPreview.expires_at) }}</dd></dl><p class="crm-note">警告行和错误行本次均跳过；只有状态为“可导入”的行会提交。下表的信用代码、电话和邮箱均为服务端返回的脱敏值。</p><table v-if="customerImportPreview.rows?.length"><thead><tr><th scope="col">行号</th><th scope="col">状态</th><th scope="col">客户</th><th scope="col">信用代码（脱敏）</th><th scope="col">负责人 / 所属组织</th><th scope="col">联系人</th><th scope="col">联系方式（脱敏）</th><th scope="col">问题</th></tr></thead><tbody><tr v-for="row in customerImportPreview.rows" :key="row.row_no"><td>{{ row.row_no }}</td><td>{{ importRowStatusText(row.status) }}</td><td>{{ row.name || '—' }}<br>{{ row.customer_type || '—' }} · {{ row.industry || '—' }} · {{ row.region || '—' }}</td><td>{{ row.unified_credit_code || '—' }}</td><td>{{ row.owner_display_name || '当前导入人' }}<br>{{ row.owner_org_name || '未确认组织' }}</td><td>{{ row.contact_name || '—' }}</td><td>{{ row.contact_phone || '—' }}<br>{{ row.contact_email || '—' }}</td><td><span v-if="!row.issues?.length">—</span><ul v-else><li v-for="issue in row.issues" :key="`${issue.column}-${issue.code}`">{{ issue.column }} · {{ issue.code }} · {{ issue.message }}</li></ul></td></tr></tbody></table><template v-if="!customerImportResult"><div class="crm-actions"><button type="button" @click="resetCustomerImportPreview">重新上传</button><button type="button" :disabled="!customerImportErrorReportRows.length" aria-label="下载客户导入预检错误报告 CSV" @click="downloadImportErrors">下载错误报告 CSV</button><button type="button" class="primary" :disabled="actionLoading || Number(customerImportPreview.importable_rows) === 0" @click="commitImport">{{ actionLoading ? '提交中…' : '第三步：确认导入可导入行' }}</button></div></template><template v-else><h3>第三步：导入结果</h3><dl class="crm-import-summary"><dt>状态</dt><dd>{{ customerImportResult.status }}</dd><dt>总行数</dt><dd>{{ customerImportResult.total_rows }}</dd><dt>成功</dt><dd>{{ customerImportResult.succeeded_rows }}</dd><dt>失败</dt><dd>{{ customerImportResult.failed_rows }}</dd><dt>跳过</dt><dd>{{ customerImportResult.skipped_rows }}</dd><dt>完成时间</dt><dd>{{ formatDate(customerImportResult.completed_at) }}</dd></dl><table v-if="customerImportResult.rows?.length"><thead><tr><th scope="col">行号</th><th scope="col">结果</th><th scope="col">客户编号</th><th scope="col">错误码</th><th scope="col">说明</th></tr></thead><tbody><tr v-for="row in customerImportResult.rows" :key="row.row_no"><td>{{ row.row_no }}</td><td>{{ importRowStatusText(row.status) }}</td><td>{{ row.customer_no || '—' }}</td><td>{{ row.error_code || '—' }}</td><td>{{ row.message || '—' }}</td></tr></tbody></table><div class="crm-actions"><button type="button" :disabled="!customerImportErrorReportRows.length" aria-label="下载客户导入结果错误报告 CSV" @click="downloadImportErrors">下载错误报告 CSV</button><button type="button" class="primary" @click="closeCustomerImport">关闭结果</button></div></template></template></form></div>
    <component
      :is="opportunityEditorDialog"
      v-if="opportunityDialog"
      :form="opportunityForm"
      :edit-mode="opportunityEditMode"
      :busy="actionLoading"
      :nested="!!selectedOpportunity"
      :customer-keyword="opportunityCustomerKeyword"
      :customer-options="opportunityCustomerOptions"
      :customer-options-loading="opportunityCustomerOptionsLoading"
      :customer-options-error="opportunityCustomerOptionsError"
      :customer-options-total="opportunityCustomerOptionsTotal"
      :catalog-loading="opportunityCatalogLoading"
      :catalog-error="opportunityCatalogError"
      :type-options="opportunityTypeSelectOptions"
      :source-options="opportunitySourceSelectOptions"
      :type-selections="opportunityTypeSelections"
      :source-selections="opportunitySourceSelections"
      :owner-label="ownerLabel(opportunityForm.owner_user_id)"
      @submit="submitOpportunity"
      @close="closeOpportunityDialog"
      @update:customer-keyword="setOpportunityCustomerKeyword"
      @search-customer="loadOpportunityCustomerOptions"
      @toggle-type="opportunityEditor.toggleType"
      @toggle-source="opportunityEditor.toggleSource"
    />
    <OpportunityCatalogDialog v-if="opportunityCatalogDialog" @close="opportunityCatalogDialog = false" @changed="loadOpportunityCatalogOptions" @notice="notice = $event" @error="error = $event" />
    <div v-if="selectedCustomer" class="crm-modal">
<article class="crm-detail crm-customer-detail">
<header class="crm-detail-head">
  <div class="crm-detail-head-copy">
    <p class="crm-eyebrow">客户详情</p>
    <h2>{{ selectedCustomer.name }}</h2>
    <p class="crm-detail-sub">{{ selectedCustomer.customer_no }} · {{ selectedCustomer.customer_type }} · {{ selectedCustomer.industry }} / {{ selectedCustomer.region }}</p>
  </div>
  <div class="crm-detail-head-actions">
    <span class="crm-badge" :class="customerStatusTone(selectedCustomer.status)">{{ customerStatusText(selectedCustomer.status) }}</span>
    <span class="crm-badge crm-badge--info">{{ creditLevelLabel(selectedCustomer.credit_level) }}</span>
    <button type="button" @click="closeCustomerDetail">关闭</button>
  </div>
</header>
<div class="crm-overview-card" aria-label="客户概览">
  <div class="crm-overview-item"><span>负责人</span><strong>{{ ownerLabel(selectedCustomer) }}</strong></div>
  <div class="crm-overview-item"><span>客户类型</span><strong>{{ selectedCustomer.customer_type }}</strong></div>
  <div class="crm-overview-item"><span>行业 / 区域</span><strong>{{ selectedCustomer.industry }} / {{ selectedCustomer.region }}</strong></div>
  <div class="crm-overview-item"><span>最近更新</span><strong>{{ formatDate(selectedCustomer.updated_at) }}</strong></div>
  <div class="crm-overview-item"><span>门户访问</span><strong v-if="canViewPortalAccess"><button type="button" class="crm-link-button" @click="openCustomerTab('portal')">查看门户状态</button></strong><strong v-else>当前权限不可查看</strong></div>
</div>
<nav class="crm-customer-tabs" aria-label="客户详情页签">
<button :class="{ active: customerTab === 'basic' }" @click="openCustomerTab('basic')">基本信息</button>
<button v-if="canReadCredit" :class="{ active: customerTab === 'credit' }" @click="openCustomerTab('credit')">信用等级&nbsp;</button>
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
<p v-if="customerTabErrors[customerTab]" class="crm-alert error" role="alert">{{ customerTabErrors[customerTab] }} <button type="button" @click="retryCustomerTab">重试</button></p>
<section v-if="customerTab === 'basic'" class="crm-detail-card">
<h3>基础信息</h3>
<dl class="crm-detail-grid">
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
<dd>{{ ownerLabel(selectedCustomer) }}</dd>
<dt>信用等级</dt>
<dd><span class="crm-badge crm-badge--info">{{ creditLevelLabel(selectedCustomer.credit_level) }}</span></dd>
<dt>版本</dt>
<dd>{{ selectedCustomer.version }}</dd>
</dl></section>
<CustomerCreditPanel v-if="customerTab === 'credit' && canReadCredit" :customer="selectedCustomer" :can-apply="canApplyCredit" :permissions="crmSession?.permissions || []" @notice="notice = $event" @error="error = $event" />
<section v-if="customerTab === 'portal'" class="crm-portal-access" aria-labelledby="portal-access-heading">
<div class="crm-subsection-heading"><div><h3 id="portal-access-heading">门户访问</h3><p class="crm-note">客户通过统一身份平台 OIDC 登录。CRM 不创建、展示或传递固定密码。</p></div></div>
<dl>
<dt>登记联系人</dt><dd>{{ canReadPortalInvite ? (currentPortalInvite?.contact_summary || portalRegistrationContact?.name || '未配置') : '当前权限不可查看邀请信息' }}</dd>
<dt>平台身份</dt><dd>{{ canReadPortalInvite ? (currentPortalInvite?.identity_summary || '尚未预置或状态不可用') : '当前权限不可查看邀请信息' }}</dd>
<dt>登录账号</dt><dd>{{ canReadPortalInvite ? (currentPortalInvite?.login_account || '尚未预置') : '当前权限不可查看邀请信息' }}</dd>
<dt>访问状态</dt><dd>{{ canReadPortalAccessStatus ? (({ NOT_PROVISIONED: '未开通', PENDING: '待激活', ACTIVE: '可访问', USED: '可访问', DISABLED: '已禁用' })[portalAccessStatus?.access_status] || portalAccessStatus?.access_status || '未知') : '当前权限不可查看' }}</dd>
<dt>邀请状态</dt><dd>{{ canReadPortalInvite ? portalInviteStatusText(currentPortalInvite?.status) : '当前权限不可查看' }}</dd>
<template v-if="portalAccessStatus?.operation_no"><dt>禁用操作</dt><dd>{{ portalAccessStatus.operation_no }} · {{ portalAccessStatus.operation_status }} / {{ portalAccessStatus.operation_stage }}</dd><dt v-if="portalAccessStatus.last_error_code">恢复状态</dt><dd v-if="portalAccessStatus.last_error_code">{{ formatCRMError({ code: portalAccessStatus.last_error_code, message: portalAccessStatus.last_error_summary }, { fallback: '门户访问变更尚未完成，请稍后查询处理状态；仍失败时请联系管理员。' }) }}<span v-if="portalAccessStatus.next_retry_at"> · 下次自动重试 {{ formatDate(portalAccessStatus.next_retry_at) }}</span></dd></template>
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
<div v-else class="crm-person-list">
<article v-for="contact in customerContacts" :key="contact.id" class="crm-person-card">
<span class="crm-avatar" aria-hidden="true">{{ personInitial(contact.name) }}</span>
<div class="crm-person-main">
<strong>{{ contact.name }}<span v-if="contact.is_registration" class="crm-tag">门户登记</span></strong>
<small>{{ contact.is_registration ? '门户登记联系人' : '普通联系人' }}</small>
</div>
<div class="crm-person-meta"><span>{{ contact.phone || '—' }}</span><span>{{ contact.email || '—' }}</span></div>
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
<div v-else class="crm-person-list">
<article v-for="item in customerStakeholders" :key="item.id" class="crm-person-card">
<span class="crm-avatar crm-avatar--violet" aria-hidden="true">{{ personInitial(item.name) }}</span>
<div class="crm-person-main">
<strong>{{ item.name }}<span class="crm-tag">{{ item.role_title }}</span></strong>
<small>影响力：{{ influenceText(item.influence) }}</small>
</div>
<div class="crm-person-meta"><span>{{ item.relationship_summary || '—' }}</span><span>{{ item.phone || '—' }} · {{ item.email || '—' }}</span></div>
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
<th scope="col">系统名称</th>
<th scope="col">等保等级</th>
<th scope="col">应用场景</th>
<th scope="col">备案编号</th>
<th scope="col">定级日期</th>
<th scope="col">备案状态</th>
</tr>
</thead>
<tbody>
<tr v-for="item in customerSystems" :key="item.id">
<td>{{ item.name }}</td>
<td>{{ protectionLevelText(item.protection_level) }}</td>
<td>{{ item.application_scenario || '—' }}</td>
<td>{{ item.filing_no || '—' }}</td>
<td>{{ item.grading_date || '—' }}</td>
<td><span class="crm-badge" :class="item.filing_status === 'FILED' ? 'crm-badge--success' : item.filing_status === 'FILING' ? 'crm-badge--warning' : 'crm-badge--gray'">{{ filingStatusText(item.filing_status) }}</span></td>
</tr>
</tbody>
</table>
</section>
<section v-if="customerTab === 'opportunities' && !customerTabErrors.opportunities">
<p v-if="!customerOpportunities.length">暂无商机历史</p>
<table v-else class="crm-light-table">
<thead>
<tr>
<th scope="col">商机编号</th>
<th scope="col">名称</th>
<th scope="col">金额</th>
<th scope="col">阶段 / 状态</th>
</tr>
</thead>
<tbody>
<tr v-for="item in customerOpportunities" :key="item.id" tabindex="0" role="button" @click="openOpportunity(item.id)" @keydown.enter.prevent="openOpportunity(item.id)" @keydown.space.prevent="openOpportunity(item.id)">
<td>{{ item.opportunity_no }}</td>
<td>{{ item.name }}</td>
<td>{{ formatAmount(item.expected_amount) }}</td>
<td><span class="crm-badge" :class="opportunityStageTone(item.current_stage)">{{ item.current_stage }}</span> <span class="crm-badge" :class="opportunityStatusTone(item.opp_status)">{{ opportunityStatusText(item.opp_status) }}</span></td>
</tr>
</tbody>
</table>
</section>
<section v-if="customerTab === 'projects' && !customerTabErrors.projects">
<p class="crm-note">以下为 Portal 已持久化的项目同步快照，不代表项目上游实时状态；请结合源更新时间和本地同步时间判断新鲜度。</p>
<ListState v-if="customerProjectsLoading || !customerProjects.length" :loading="customerProjectsLoading" empty-title="暂无项目快照" compact />
<table v-else>
<thead>
<tr>
<th scope="col">项目</th>
<th scope="col">合同号</th>
<th scope="col">阶段 / 状态</th>
<th scope="col">进度</th>
<th scope="col">预计结束</th>
<th scope="col">延期</th>
<th scope="col">快照新鲜度</th>
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
<td><span class="crm-badge crm-badge--info">{{ item.current_stage || '—' }}</span> <span class="crm-badge crm-badge--gray">{{ projectStatusText(item.status) }}</span></td>
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
<PaginationBar class="crm-pagination" label="客户项目历史分页" :page="customerProjectsPage.number" :total="customerProjectsPage.total" :page-size="customerProjectsPage.size" :loading="customerProjectsLoading" @change="loadCustomerProjectPage" />
</section>
<section v-if="customerTab === 'followups' && !customerTabErrors.followups">
<p v-if="!customerFollowups.length">暂无沟通记录</p>
<div v-else class="crm-follow-timeline">
<article v-for="item in customerFollowups" :key="item.id" class="crm-follow-record">
<span class="crm-follow-dot" aria-hidden="true"></span>
<div class="crm-follow-main">
<header><strong>{{ item.type }}</strong><time>{{ formatDate(item.followed_at) }}</time></header>
<p>{{ item.content }}</p>
</div>
</article>
</div>
</section>
<section v-if="customerTab === 'audit' && !customerTabErrors.audit">
<p v-if="!customerAuditLogs.length">暂无操作日志</p>
<div v-else class="crm-follow-timeline crm-audit-timeline">
<article v-for="item in customerAuditLogs" :key="item.id" class="crm-follow-record">
<span class="crm-follow-dot" aria-hidden="true"></span>
<div class="crm-follow-main">
<header><strong>{{ item.operation }}</strong><time>{{ formatDate(item.occurred_at) }}</time></header>
<p>操作人：{{ ownerLabel(item.actor_id) }} · 结果：{{ item.result }}</p>
<p class="crm-note">{{ item.reason || '—' }}</p>
</div>
</article>
</div>
</section>
<div class="crm-actions crm-detail-actions">
<button @click="closeCustomerDetail">关闭</button>
<button v-if="selectedCustomer.status === 'ACTIVE'" @click="customerFollowupDialog = true">添加沟通</button>
<button v-if="selectedCustomer.status === 'ACTIVE'" @click="editCustomer">编辑</button>
<button v-if="canMergeCustomer && selectedCustomer.status === 'ACTIVE'" @click="openCustomerMerge">合并客户</button>
<button v-if="selectedCustomer.status === 'ACTIVE'" class="danger" @click="changeCustomerStatus('void')">作废</button>
<button v-else-if="selectedCustomer.status === 'VOID'" class="primary" @click="changeCustomerStatus('restore')">恢复</button>
</div>
</article>
</div>
    <div v-if="customerMergeDialog && selectedCustomer" class="crm-modal nested"><form @submit.prevent="submitCustomerMerge"><h2>客户合并向导</h2><p class="crm-note">源客户：{{ selectedCustomer.name }}（{{ selectedCustomer.customer_no }}，版本 {{ selectedCustomer.version }}）。目标客户作为存续主档；提交后源客户进入 MERGED，本期不支持反合并。</p><section class="crm-business-picker"><label>查找目标客户<input v-model.trim="customerMergeKeyword" type="search" placeholder="客户编号或名称" @keyup.enter.prevent="loadCustomerMergeOptions" maxlength="100"></label><button type="button" :disabled="customerMergeOptionsLoading" @click="loadCustomerMergeOptions">{{ customerMergeOptionsLoading ? '查询中…' : '查询客户' }}</button><label>目标客户<select v-model="customerMergeForm.target_customer_id" required :disabled="customerMergeOptionsLoading || !customerMergeOptions.length" @change="loadCustomerMergeTarget"><option value="" disabled>请选择存续客户</option><option v-for="customer in customerMergeOptions" :key="customer.id" :value="String(customer.id)">{{ customer.name }}（{{ customer.customer_no }}）· {{ customer.industry }} / {{ customer.region }}</option></select></label><small v-if="customerMergeOptionsError" class="crm-alert error" role="alert">{{ customerMergeOptionsError }}</small><small v-else-if="!customerMergeOptionsLoading && !customerMergeOptions.length" class="crm-note">没有其他可作为存续主档的有效客户。</small><small v-else-if="customerMergeOptionsTotal > customerMergeOptions.length" class="crm-note">当前显示前 {{ customerMergeOptions.length }} 条，请输入关键词缩小范围。</small></section><dl v-if="customerMergeForm.target" class="crm-merge-compare"><dt>目标名称</dt><dd>{{ customerMergeForm.target.name }}</dd><dt>目标编号</dt><dd>{{ customerMergeForm.target.customer_no }}</dd><dt>行业 / 区域</dt><dd>{{ customerMergeForm.target.industry }} / {{ customerMergeForm.target.region }}</dd><dt>负责人</dt><dd>{{ ownerLabel(customerMergeForm.target) }}</dd><dt>目标版本</dt><dd>{{ customerMergeForm.target.version }}</dd></dl><p class="crm-note">服务端会迁移已确认的 CRM 联系人、沟通、无合同商机和邀请。存在 Portal 身份映射、待补偿的外部开通任务或已关联合同商机时会安全阻断，不会返回假成功。</p><label>合并原因<textarea v-model.trim="customerMergeForm.reason" required maxlength="500"></textarea></label><div class="crm-actions"><button type="button" @click="customerMergeDialog = false">取消</button><button class="danger" :disabled="actionLoading || !customerMergeForm.target">{{ actionLoading ? '合并中…' : '合并客户' }}</button></div></form></div>
    <div v-if="customerStakeholderDialog && selectedCustomer" class="crm-modal nested"><form class="crm-collection-editor" @submit.prevent="submitStakeholders"><h2>维护关键干系人</h2><p class="crm-note">这是全量清单；删除一项后保存会移除该干系人。现有电话/邮箱默认保留密文，勾选替换后才发送新值。</p><fieldset v-for="(item, index) in customerStakeholderForm.items" :key="item.id || `new-${index}`"><legend>干系人 {{ index + 1 }}</legend><label>姓名<input v-model.trim="item.name" required maxlength="100"></label><label>角色 / 职务<input v-model.trim="item.role_title" required maxlength="100"></label><label>影响力<select v-model="item.influence" required><option value="LOW">低</option><option value="MEDIUM">中</option><option value="HIGH">高</option></select></label><label>关系描述<textarea v-model.trim="item.relationship_summary" maxlength="500"></textarea></label><template v-if="item.id"><label class="check"><input v-model="item.replace_phone" type="checkbox">替换或清空电话（当前页面只显示脱敏值）</label><label v-if="item.replace_phone">新电话；留空表示清空<input v-model.trim="item.phone" maxlength="64"></label><label class="check"><input v-model="item.replace_email" type="checkbox">替换或清空邮箱（当前页面只显示脱敏值）</label><label v-if="item.replace_email">新邮箱；留空表示清空<input v-model.trim="item.email" type="email" maxlength="200"></label></template><template v-else><label>电话<input v-model.trim="item.phone" maxlength="64"></label><label>邮箱<input v-model.trim="item.email" type="email" maxlength="200"></label></template><button type="button" class="danger" @click="removeStakeholder(index)">移除</button></fieldset><button type="button" @click="addStakeholder">添加干系人</button><label>变更原因<textarea v-model.trim="customerStakeholderForm.reason" required maxlength="500"></textarea></label><div class="crm-actions"><button type="button" @click="customerStakeholderDialog = false">取消</button><button class="primary" :disabled="actionLoading">{{ actionLoading ? '保存中…' : '保存干系人清单' }}</button></div></form></div>
    <div v-if="customerSystemDialog && selectedCustomer" class="crm-modal nested"><form class="crm-collection-editor" @submit.prevent="submitSystems"><h2>维护信息系统</h2><p class="crm-note">这是全量清单；保护等级是网络安全等级保护定级，不是客户信用等级。</p><fieldset v-for="(item, index) in customerSystemForm.items" :key="index"><legend>信息系统 {{ index + 1 }}</legend><label>系统名称<input v-model.trim="item.name" required maxlength="200"></label><label>等保等级<select v-model="item.protection_level" required><option value="LEVEL_1">一级</option><option value="LEVEL_2">二级</option><option value="LEVEL_3">三级</option><option value="LEVEL_4">四级</option><option value="LEVEL_5">五级</option></select></label><label>应用场景<textarea v-model.trim="item.application_scenario" maxlength="500"></textarea></label><label>备案编号<input v-model.trim="item.filing_no" maxlength="100"></label><label>定级日期<input v-model="item.grading_date" type="date"></label><label>备案状态<select v-model="item.filing_status" required><option value="NOT_FILED">未备案</option><option value="FILING">备案中</option><option value="FILED">已备案</option></select></label><button type="button" class="danger" @click="removeInformationSystem(index)">移除</button></fieldset><button type="button" @click="addInformationSystem">添加信息系统</button><label>变更原因<textarea v-model.trim="customerSystemForm.reason" required maxlength="500"></textarea></label><div class="crm-actions"><button type="button" @click="customerSystemDialog = false">取消</button><button class="primary" :disabled="actionLoading">{{ actionLoading ? '保存中…' : '保存信息系统清单' }}</button></div></form></div>
    <div v-if="selectedOpportunity" class="crm-modal"><article class="crm-detail crm-opportunity-detail">
<header class="crm-opportunity-detail-head">
  <div class="crm-detail-head-copy">
    <p class="crm-eyebrow">商机详情</p>
    <h2>{{ selectedOpportunity.name }}</h2>
    <p class="crm-detail-sub">{{ selectedOpportunity.opportunity_no }} · {{ selectedOpportunity.customer_name || ('客户 #' + selectedOpportunity.customer_id) }}</p>
  </div>
  <div class="crm-detail-head-actions">
    <span class="crm-badge" :class="opportunityStageTone(selectedOpportunity.current_stage)">{{ selectedOpportunity.current_stage }}</span>
    <span class="crm-badge" :class="opportunityStatusTone(selectedOpportunity.opp_status)">{{ opportunityStatusText(selectedOpportunity.opp_status) }}</span>
    <button type="button" @click="selectedOpportunity = null">关闭</button>
  </div>
</header>
<div class="crm-opportunity-main">
<section class="crm-detail-card crm-stage-progress-card" aria-label="商机阶段进度">
  <div class="crm-stage-progress-head">
    <h3>商机阶段（7 段漏斗 · 含终态）</h3>
    <button type="button" class="primary" @click="stageDialog = true">调整阶段</button>
  </div>
  <div class="crm-stage-progress">
    <div v-for="step in opportunityStageSteps(selectedOpportunity.current_stage)" :key="step.label" class="crm-progress-step" :class="[step.state, step.state === 'current' && step.terminal ? 'is-' + step.terminal : '']">
      <span class="crm-progress-index" aria-hidden="true">{{ step.state === 'done' ? '✓' : step.index }}</span>
      <span class="crm-progress-label">{{ step.label }}</span>
    </div>
  </div>
</section>
<section class="crm-detail-card">
<h3>商机信息</h3>
<dl class="crm-detail-grid"><dt>商机编号</dt><dd>{{ selectedOpportunity.opportunity_no }}</dd><dt>负责人</dt><dd>{{ ownerLabel(selectedOpportunity.owner_user_id) }} / {{ selectedOpportunity.owner_org_id || '未填写组织' }}</dd><dt>当前阶段</dt><dd>{{ selectedOpportunity.current_stage }}</dd><dt>累计已签约合同</dt><dd>{{ formatSignedContractCount(selectedOpportunity.signed_contract_count) }}</dd><dt>状态</dt><dd>{{ opportunityStatusText(selectedOpportunity.opp_status) }}</dd><dt>终态待办</dt><dd>{{ selectedOpportunity.terminal_pending_type === 'CONTRACT' ? '待关联合同' : selectedOpportunity.terminal_pending_type === 'LOST_REASON' ? '待补失败原因' : selectedOpportunity.terminal_pending_type === 'WIN_EVIDENCE' ? '待补赢单依据' : '无' }}</dd><dt>需求摘要</dt><dd>{{ selectedOpportunity.requirement_summary }}</dd><dt>系统数量</dt><dd>{{ selectedOpportunity.system_count || 0 }}</dd><dt>客户痛点</dt><dd>{{ selectedOpportunity.pain_points || '—' }}</dd><dt>竞争信息</dt><dd>{{ selectedOpportunity.competitor_info || '—' }}</dd><dt>版本</dt><dd>{{ selectedOpportunity.version }}</dd></dl></section><section class="crm-opportunity-presale" aria-labelledby="opportunity-presale-heading"><div class="crm-panel-heading"><div><h3 id="opportunity-presale-heading">关联售前任务</h3><p class="crm-note">售前状态独立流转，不会自动修改商机阶段。</p></div><button v-if="canCreatePresale && selectedOpportunity.opp_status !== 'VOID'" type="button" class="console-button primary" aria-haspopup="dialog" :disabled="presaleCreateLoading" :title="presaleRequestSubmissionAvailable ? '为当前商机创建售前支持申请' : '售前内部流程恢复后即可提交'" @click="openOpportunityPresaleCreate">发起售前支持</button></div><ListState v-if="opportunityPresaleLoading || opportunityPresaleError || !opportunityPresales.length" :loading="opportunityPresaleLoading" :error="opportunityPresaleError" error-title="关联售前任务加载失败" empty-title="暂无关联售前任务" compact @retry="loadOpportunityPresales()" /><div v-else class="table-panel"><table class="crm-data-table"><thead><tr><th scope="col">任务号 / 申请时间</th><th scope="col">状态 / 紧急度</th><th scope="col">场地</th><th scope="col">当前执行人</th><th scope="col">最新进度</th><th scope="col">累计小时</th><th scope="col">期望结束</th><th scope="col">超时</th><th scope="col">详情</th></tr></thead><tbody><tr v-for="item in opportunityPresales" :key="item.id"><td>{{ item.request_no }}<br><small>{{ formatDate(item.created_at) }}</small></td><td>{{ requestStatusText(item.status) }} / {{ urgencyText(item.urgency) }}</td><td>{{ venueText(item.venue) }}</td><td>{{ assignees(item.current_assignees) }}</td><td>{{ item.latest_progress || '—' }}</td><td>{{ item.total_work_hours }} 小时</td><td>{{ formatDate(item.expected_end) }}</td><td>{{ item.overdue ? '已超时' : '否' }}</td><td><button v-if="item.can_view_detail" type="button" @click="openOpportunityPresale(item)">查看详情</button><span v-else>仅摘要</span></td></tr></tbody></table><div class="crm-actions"><PaginationBar label="关联售前任务分页" :page="opportunityPresalePage.number" :total="opportunityPresalePage.total" :page-size="opportunityPresalePage.size" :loading="opportunityPresaleLoading" @change="page => loadOpportunityPresales(page)" /><button v-if="opportunityPresalePage.total > opportunityPresalePage.size && opportunityPresalePage.size < 100" type="button" @click="viewAllOpportunityPresales">查看全部（最多 100 条）</button></div></div></section><h3>跟进记录</h3><p v-if="!followups.length">暂无记录</p><ol><li v-for="item in followups" :key="item.id"><strong>{{ item.type }}</strong> · {{ formatDate(item.followed_at) }}<br>{{ item.content }}</li></ol><h3>阶段历史</h3><ol><li v-for="item in stageHistory" :key="item.id">{{ item.from_stage }} → {{ item.to_stage }} · {{ formatDate(item.changed_at) }} · {{ item.reason }}</li></ol></div><div class="crm-opportunity-actions crm-actions"><button @click="selectedOpportunity = null">关闭</button><template v-if="selectedOpportunity.opp_status !== 'VOID'"><button @click="editOpportunity">编辑</button><button @click="openOwnerEditor">变更负责人</button><button v-if="canManageOpportunityTeam && opportunityTeamDirectoryAvailable" @click="openTeamEditor">维护团队</button><button @click="followupDialog = true">添加跟进</button><button class="primary" @click="stageDialog = true">调整阶段</button><button class="danger" @click="changeOpportunityStatus('void')">作废</button><button v-if="selectedOpportunity.terminal_pending_type && selectedOpportunity.terminal_pending_type !== 'NONE'" class="primary" @click="terminalDialog = true">补全终态待办</button></template><button v-else class="primary" @click="changeOpportunityStatus('restore')">恢复</button></div>
      <div v-if="selectedOpportunity" class="crm-opportunity-side-rail" aria-label="商机补充信息">
    <aside class="crm-opportunity-attachment-panel crm-opportunity-team-panel" aria-label="商机团队">
<h3>商机团队</h3><p class="crm-note">人员用户名与有效组织实时取自基础平台权威目录。</p><p v-if="!opportunityTeamDirectoryAvailable" class="crm-alert warning" role="status">基础平台人员目录暂不可用；团队维护已安全关闭。</p><p v-if="!opportunityTeam.length">当前无辅助团队成员</p><ul class="crm-team-summary"><li v-for="member in opportunityTeam" :key="member.user_id"><strong>{{ platformUserName(member) }}</strong> · {{ teamRoleText(member.role) }}<br><small>{{ teamMemberOrganizations(member) }}</small><em v-if="member.directory_status === 'NOT_AVAILABLE'">已停用或不再具有本应用授权</em></li></ul>
    </aside>
    <!-- 三个 .crm-opportunity-attachment-panel 共享 .crm-opportunity-side-rail 宿主，
         一对渐隐伪元素只能对齐一个矩形；这里只标记真正含宽表格、会横向滚动的任期明细。 -->
    <aside v-if="selectedOpportunity" class="crm-opportunity-attachment-panel" data-table-scroll aria-label="商机团队任期明细">
      <h3>团队任期明细</h3>
      <p class="crm-note">每次加入、移出、重新加入和角色变化独立记录；“迁移快照”仅代表账本启用时观察到的状态，加入和移出时间未知，不推测更早历史。</p>
      <ListState v-if="opportunityMemberTermsLoading || opportunityMemberTermsError || !opportunityMemberTerms.length" :loading="opportunityMemberTermsLoading" :error="opportunityMemberTermsError" error-title="团队任期明细加载失败" empty-title="暂无任期明细" compact @retry="loadOpportunityMemberTerms()" />
      <template v-else>
        <table><thead><tr><th scope="col">成员</th><th scope="col">角色</th><th scope="col">开始 / 快照</th><th scope="col">结束</th><th scope="col">操作人</th><th scope="col">来源</th></tr></thead><tbody><tr v-for="term in opportunityMemberTerms" :key="term.id"><td>{{ ownerLabel(term.user_id) }}</td><td>{{ teamRoleText(term.role) }}</td><td>{{ term.source_kind === 'LEGACY_SNAPSHOT' ? `快照于 ${formatDate(term.snapshot_at)}` : formatDate(term.started_at) }}</td><td>{{ term.source_kind === 'LEGACY_SNAPSHOT' ? (term.ended_at ? formatDate(term.ended_at) : (term.active_at_snapshot ? '尚在团队' : '迁移前未知')) : formatDate(term.ended_at) }}</td><td>{{ term.source_kind === 'LEGACY_SNAPSHOT' ? '迁移程序观察' : ownerLabel(term.started_by) }}<template v-if="term.ended_by"> → {{ ownerLabel(term.ended_by) }}</template></td><td>{{ term.source_kind === 'LEGACY_SNAPSHOT' ? (term.active_at_snapshot ? '迁移快照（当时在组）' : '迁移快照（当时已移出）') : '完整记录' }}</td></tr></tbody></table>
        <PaginationBar class="crm-pagination" label="团队任期明细分页" :page="opportunityMemberTermsPage.number" :total="opportunityMemberTermsPage.total" :page-size="opportunityMemberTermsPage.size" :loading="opportunityMemberTermsLoading" @change="page => loadOpportunityMemberTerms(undefined, page)" />
      </template>
    </aside>
    <aside v-if="selectedOpportunity && canReadOpportunityAttachments" class="crm-opportunity-attachment-panel" aria-label="商机可信附件">
      <h3>可信附件</h3>
      <p v-if="opportunityAttachmentLoading">正在加载附件状态…</p>
      <p v-if="opportunityAttachmentError" class="crm-alert error" role="alert">{{ opportunityAttachmentError }}</p>
      <p v-if="opportunityAttachmentCapabilities && !opportunityAttachmentCapabilities.upload_available" class="crm-note">当前未配置可信文件存储或安全校验，上传已安全关闭；系统不会把文件内容写入 CRM 数据库。</p>
      <ul v-if="opportunityAttachments.length" class="crm-attachment-list">
        <li v-for="item in opportunityAttachments" :key="item.id"><span><strong>{{ item.file_name }}</strong><br>{{ opportunityAttachmentStatusText(item.scan_status) }} · {{ item.size_bytes }} 字节</span><button type="button" :disabled="!canDownloadOpportunityAttachments || !opportunityAttachmentCapabilities?.download_available || (item.file_status !== 'READY' && item.scan_status !== 'CLEAN')" @click="downloadTrustedOpportunityAttachment(item)">下载</button></li>
      </ul>
      <p v-else-if="!opportunityAttachmentLoading" class="crm-note">暂无附件。</p>
      <div v-if="canUploadOpportunityAttachments" class="crm-attachment-upload">
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :disabled="!opportunityAttachmentCapabilities?.upload_available || opportunityAttachmentLoading" @change="selectOpportunityAttachment">
        <button type="button" :disabled="!opportunityAttachmentFile || !opportunityAttachmentCapabilities?.upload_available || opportunityAttachmentLoading" @click="uploadOpportunityAttachment">上传并校验</button>
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
      <OpportunityWinConfirmationPanel v-if="opportunityWinConfirmation?.confirmation" readonly :confirmation-detail="opportunityWinConfirmation" />
      <p v-if="opportunityWinConfirmationError" class="crm-alert warning" role="alert">{{ opportunityWinConfirmationError }} <button @click="loadOpportunityWinConfirmation">重试读取依据</button></p>
      <button
        v-if="canTransferOpportunity && contractTransferAvailable && selectedOpportunity.current_stage === '已签约' && selectedOpportunity.opp_status === 'CLOSED' && selectedOpportunity.contract_ref && selectedOpportunity.terminal_pending_type === 'NONE'"
        type="button"
        class="primary"
        :disabled="contractTransferLoading"
        @click="submitContractTransfer"
      >{{ contractTransferLoading ? '正在受理…' : '转交合同系统' }}</button>
      <p v-else-if="canTransferOpportunity && selectedOpportunity.current_stage === '已签约' && !contractTransferAvailable" class="crm-note">转合同能力未启用或尚未就绪，未产生转交任务。</p>
      <p v-else-if="canTransferOpportunity && winConfirmationMode === 'contract' && selectedOpportunity.current_stage === '已签约' && !selectedOpportunity.contract_ref" class="crm-note">请先补全并验证合同，再转交合同系统。</p>
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
          <p class="console-form-item full crm-note">当前商机处于“{{ selectedOpportunity.current_stage }}”阶段。售前申请不会自动调整商机阶段；如销售推进需要，请单独调整阶段并留痕。</p>
          <div v-if="!presaleRequestSubmissionAvailable" class="crm-alert warning crm-opportunity-presale-create-status" role="status">
            <span>售前内部流程暂时不可用，可以先填写申请后重试。</span>
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
          <label class="console-form-item full"><span>需求说明 *</span><textarea v-model.trim="presaleForm.description" rows="5" required placeholder="请描述支持背景、目标和交付预期" maxlength="10000"></textarea><small>需求说明必须填写内容，不限制字数；提交后进入售前审批流程。</small></label>
        </form>
        <footer>
          <button class="console-button ghost" type="button" :disabled="presaleCreateLoading" @click="closeOpportunityPresaleCreate">取消</button>
          <button class="console-button primary" type="submit" form="opportunity-presale-create-form" :disabled="presaleCreateLoading || !presaleRequestSubmissionAvailable">{{ presaleCreateLoading ? '提交中…' : '提交申请' }}</button>
        </footer>
      </article>
    </div>
    <div v-if="ownerDialog" class="crm-modal nested"><form @submit.prevent="submitOwner"><h2>变更商机负责人</h2><OwnerSelector v-model:user-id="ownerForm.owner_user_id" v-model:organization-id="ownerForm.owner_org_id" :default-user-id="crmSession?.user_id || ''" :default-organization-id="crmSession?.primary_org_id || ''" /><label>变更原因<textarea v-model.trim="ownerForm.reason" required maxlength="500"></textarea></label><div class="crm-actions"><button type="button" @click="ownerDialog = false">取消</button><button class="primary">变更负责人</button></div></form></div>
    <div v-if="teamDialog" class="crm-modal nested">
      <form class="crm-detail" @submit.prevent="submitTeam">
        <h2>维护商机团队</h2>
        <p class="crm-note">从基础平台当前有效、且已获得本应用授权的真实人员中选择；提交时服务端会再次校验人员状态。</p>
        <section class="crm-business-picker">
          <label>查找内部人员<input v-model.trim="teamDirectoryKeyword" type="search" placeholder="输入姓名关键字" @keyup.enter.prevent="loadTeamDirectory" maxlength="100"></label>
          <button type="button" :disabled="teamDirectoryLoading" @click="loadTeamDirectory">{{ teamDirectoryLoading ? '查询中…' : '查询人员' }}</button>
          <label>选择成员<select v-model="teamCandidate.user_id" :disabled="teamDirectoryLoading || !teamDirectoryOptions.length"><option value="">请选择人员</option><option v-for="user in teamDirectoryOptions" :key="user.user_id" :value="user.user_id" :disabled="teamForm.members.some((item) => item.user_id === user.user_id)">{{ platformUserName(user) }} · {{ teamMemberOrganizations(user) }}</option></select></label>
          <label>团队职责<select v-model="teamCandidate.role"><option value="SALES_SUPPORT">销售支持</option><option value="TECHNICAL_SUPPORT">技术支持</option><option value="BUSINESS_SUPPORT">商务支持</option><option value="OTHER">其他</option></select></label>
          <button type="button" :disabled="!teamCandidate.user_id || teamForm.members.length >= 50" @click="addTeamMember">添加成员</button>
          <small v-if="teamDirectoryError" class="crm-alert error" role="alert">{{ teamDirectoryError }} 不会退回为手填账号 ID。</small>
        </section>
        <p v-if="!teamForm.members.length" class="crm-empty compact">当前团队为空；直接提交可移除全部现有成员。</p>
        <section v-else class="crm-team-editor">
          <div v-for="(member, index) in teamForm.members" :key="member.user_id">
            <span><strong>{{ teamMemberName(member) }}</strong><small>{{ teamMemberOrganizations(member) }}</small><em v-if="member.directory_status === 'NOT_AVAILABLE'">该人员已停用或不再具有本应用授权，请移出后再提交。</em></span>
            <select v-model="member.role" :aria-label="`${teamMemberName(member)}的团队职责`"><option value="SALES_SUPPORT">销售支持</option><option value="TECHNICAL_SUPPORT">技术支持</option><option value="BUSINESS_SUPPORT">商务支持</option><option value="OTHER">其他</option></select>
            <button type="button" class="danger" @click="removeTeamMember(index)">移除</button>
          </div>
        </section>
        <label>变更原因<textarea v-model.trim="teamForm.reason" required maxlength="500"></textarea></label>
        <div class="crm-actions"><button type="button" @click="teamDialog = false">取消</button><button class="primary" :disabled="teamDirectoryLoading || Boolean(teamDirectoryError)">替换当前团队</button></div>
      </form>
    </div>
    <div v-if="stageDialog" class="crm-modal nested"><form @submit.prevent="submitStage"><h2>调整阶段</h2><p class="crm-note">提交后立即生效，不发起审批。</p><div class="crm-stage-picker">
  <span class="crm-form-label">目标阶段 <span class="req-star">*</span></span>
  <div class="crm-stage-pills" role="group" aria-label="目标阶段">
    <button v-for="stage in opportunityStageOptions" :key="stage" type="button" class="crm-stage-pill" :class="{ active: stageForm.target_stage === stage, 'is-win': stage === '已签约', 'is-lose': stage === '失败' }" :aria-pressed="stageForm.target_stage === stage" @click="stageForm.target_stage = stage">{{ stage }}</button>
  </div>
  <label class="crm-visually-hidden">目标阶段<select v-model="stageForm.target_stage" required><option value="初步接触">初步接触</option><option value="需求沟通">需求沟通</option><option value="方案制定">方案制定</option><option value="报价">报价</option><option value="投标">投标</option><option value="已签约">已签约</option><option value="失败">失败</option></select></label>
</div><p v-if="stageForm.target_stage === '已签约' && ['C', 'D'].includes(selectedOpportunityCustomerCredit?.credit_level)" class="crm-alert warning" role="status">信用风险提示：该客户当前为 {{ selectedOpportunityCustomerCredit.credit_level }} 级（{{ selectedOpportunityCustomerCredit.credit_level === 'D' ? '差' : '关注' }}），请确认商务条款与回款安排；该提示不阻断签约。</p><p v-if="stageForm.target_stage === '已签约' && opportunityQuoteAmountCheck?.status === 'MISMATCH' && opportunityQuoteAmountCheck.opportunity_version === selectedOpportunity?.version" class="crm-alert warning" role="status">签单前金额提示：预计金额 {{ opportunityQuoteAmountCheck.expected_amount }} 与已通过报价 {{ opportunityQuoteAmountCheck.approved_quote_amount }} 不一致；仍可继续签单。</p><p v-else-if="stageForm.target_stage === '已签约' && opportunityQuoteAmountCheck?.status === 'APPROVED_QUOTE_AMOUNT_MISSING' && opportunityQuoteAmountCheck.opportunity_version === selectedOpportunity?.version" class="crm-note">已通过报价缺少金额，当前无法判断一致性；仍可继续签单。</p><label>原因<textarea v-model="stageForm.reason" required maxlength="500"></textarea></label><OpportunityWinConfirmationPanel v-if="stageForm.target_stage === '已签约'" :mode="winConfirmationMode" v-model="stageForm.win_evidence" v-model:contract-ref="stageForm.contract_ref" /><label v-if="stageForm.target_stage === '失败'">失败原因<input v-model="stageForm.lost_reason" required maxlength="64"></label><div class="crm-actions"><button type="button" @click="stageDialog = false">取消</button><button class="primary" :disabled="!stageForm.target_stage">变更阶段</button></div></form></div>
    <div v-if="terminalDialog" class="crm-modal nested"><form @submit.prevent="submitTerminal"><h2>补全终态待办</h2><OpportunityWinConfirmationPanel v-if="['CONTRACT', 'WIN_EVIDENCE'].includes(selectedOpportunity.terminal_pending_type)" :mode="winConfirmationMode" v-model="terminalForm.win_evidence" v-model:contract-ref="terminalForm.contract_ref" /><label v-else>失败原因<input v-model="terminalForm.lost_reason" required maxlength="64"></label><label>补全原因<textarea v-model="terminalForm.reason" required maxlength="500"></textarea></label><div class="crm-actions"><button type="button" @click="terminalDialog = false">取消</button><button class="primary">{{ selectedOpportunity.terminal_pending_type === 'LOST_REASON' ? '保存丢单原因' : '保存赢单依据' }}</button></div></form></div>
    <div v-if="followupDialog" class="crm-modal nested"><form @submit.prevent="submitFollowup"><h2>添加跟进</h2><label>类型<select v-model="followupForm.type"><option value="PHONE">电话</option><option value="VISIT">拜访</option><option value="EMAIL">邮件</option><option value="OTHER">其他</option></select></label><label>内容<textarea v-model="followupForm.content" required maxlength="10000"></textarea></label><label>跟进时间<input v-model="followupForm.followed_at" type="datetime-local" required></label><label>下次跟进<input v-model="followupForm.next_follow_at" type="datetime-local"></label><div class="crm-actions"><button type="button" @click="followupDialog = false">取消</button><button class="primary">保存跟进记录</button></div></form></div>
    <div v-if="customerFollowupDialog" class="crm-modal nested"><form @submit.prevent="submitCustomerFollowup"><h2>添加客户沟通</h2><label>类型<select v-model="customerFollowupForm.type"><option value="PHONE">电话</option><option value="VISIT">拜访</option><option value="EMAIL">邮件</option><option value="OTHER">其他</option></select></label><label>内容<textarea v-model="customerFollowupForm.content" required maxlength="10000"></textarea></label><label>沟通时间<input v-model="customerFollowupForm.followed_at" type="datetime-local" required></label><label>下次跟进<input v-model="customerFollowupForm.next_follow_at" type="datetime-local"></label><div class="crm-actions"><button type="button" @click="customerFollowupDialog = false">取消</button><button class="primary">保存沟通记录</button></div></form></div>
    <div v-if="takeoverOpen && selectedPresale" class="crm-modal nested">
      <form class="crm-detail crm-takeover-picker" @submit.prevent="submitTakeover">
        <header><p>执行中负责人接管</p><h2>更换团队负责人</h2><span>申请保持执行中，当前执行人、工时和进展不会被清空。</span></header>
        <label class="console-form-item"><span>新团队负责人 *</span><select v-model="takeoverTeamLeadID" required :disabled="teamLeadDirectoryLoading"><option value="">{{ teamLeadDirectoryLoading ? '加载团队负责人…' : '选择团队负责人' }}</option><option v-for="item in teamLeadCandidates" :key="item.person_id" :value="item.person_id">{{ item.person_name }}（{{ item.department || '未标注部门' }}）</option></select></label>
        <label class="console-form-item"><span>接管原因 *</span><textarea v-model.trim="takeoverReason" required maxlength="1000" rows="3"></textarea></label>
        <div class="crm-actions"><button type="button" @click="takeoverOpen = false">取消</button><button class="primary" :disabled="takeoverSaving || !takeoverTeamLeadID">{{ takeoverSaving ? '提交中…' : '接管负责人' }}</button></div>
      </form>
    </div>
    <div v-if="engineerPickerOpen && selectedPresale" class="crm-modal nested"><form class="crm-detail crm-engineer-picker" @submit.prevent="runPresale('assign')"><header class="crm-engineer-picker__header"><div><p>售前协作 · 人员指派</p><h2>从基础平台选择执行人员</h2><span>人员来自基础平台当前有效且已获得本应用授权的用户目录</span></div><strong><b>{{ selectedEngineerIDs.length }}</b><small>已选择</small></strong></header><section class="crm-engineer-picker__filter"><div><strong>筛选人员</strong><span>按姓名或部门快速定位，可多选执行人员。</span></div><section class="crm-toolbar crm-engineer-picker__toolbar"><label>姓名<input v-model.trim="engineerQuery.keyword" placeholder="输入姓名关键字" maxlength="100"></label><label>部门<input v-model.trim="engineerQuery.department" placeholder="输入部门名称" maxlength="128"></label><button type="button" :disabled="engineerDirectoryLoading" @click="loadEngineerDirectory">{{ engineerDirectoryLoading ? '读取中…' : '查询人员' }}</button><button type="button" class="ghost" :disabled="engineerDirectoryLoading" @click="loadEngineerDirectory">{{ engineerDirectoryLoading ? '刷新中…' : '刷新目录' }}</button></section></section><section class="crm-engineer-picker__directory"><header><div><strong>可指派人员</strong><span>{{ engineerDirectoryLoading ? '正在同步基础平台目录…' : `本次查询共 ${engineerDirectory.length} 人` }}</span></div><span class="crm-engineer-picker__selection">已勾选 {{ selectedEngineerIDs.length }} 人</span></header><p v-if="engineerDirectoryLoading" class="crm-note" role="status">当前已选择人员会被保留，请稍候。</p><div v-else-if="engineerDirectory.length" class="crm-engineer-list" aria-label="基础平台人员列表"><label v-for="person in engineerDirectory" :key="person.person_id" class="check crm-engineer" :class="{ selected: selectedEngineerIDs.includes(person.person_id) }"><input v-model="selectedEngineerIDs" type="checkbox" :value="person.person_id"><span class="crm-engineer__avatar" aria-hidden="true">{{ (person.person_name || '人').slice(0, 1) }}</span><span class="crm-engineer__identity"><strong>{{ person.person_name }}</strong><small>{{ person.department || '未标注部门' }}</small></span><select class="crm-engineer__role" :value="selectedEngineerRoles[person.person_id] || 'technician'" aria-label="执行角色" @mousedown.stop @click.stop @change.stop="selectedEngineerRoles[person.person_id] = $event.target.value"><option value="technician">技术工程师</option><option value="project_manager">项目经理</option><option value="team_lead">团队负责人</option></select><em>{{ selectedEngineerIDs.includes(person.person_id) ? '已选择' : '选择' }}</em></label></div><p v-else class="crm-empty">当前筛选没有可指派人员。</p></section><section v-if="unavailableCurrentAssignees.length" class="crm-engineer-picker__legacy"><div><strong>保留现有执行人</strong><span>以下人员不在当前筛选结果中，取消勾选后才会被移出。</span></div><label v-for="person in unavailableCurrentAssignees" :key="person.person_id" class="check"><input v-model="selectedEngineerIDs" type="checkbox" :value="person.person_id">{{ person.person_name || '未命名用户' }}</label></section><section class="crm-engineer-picker__changes"><div class="crm-engineer-picker__section-heading"><strong>本次变更预览</strong><span>提交后立即更新当前执行人。</span></div><dl class="crm-assignment-diff crm-engineer-picker__diff"><div class="is-added"><dt>新增</dt><dd>{{ assignmentDiff.added.join('、') || '无' }}</dd></div><div class="is-retained"><dt>保留</dt><dd>{{ assignmentDiff.retained.join('、') || '无' }}</dd></div><div class="is-removed"><dt>移出</dt><dd>{{ assignmentDiff.removed.join('、') || '无' }}</dd></div></dl></section><label class="crm-engineer-picker__reason"><span>改派原因（选填）</span><textarea v-model.trim="assignmentReason" maxlength="500" placeholder="如需说明本次人员调整，可在此填写"></textarea></label><div class="crm-actions crm-engineer-picker__footer"><button type="button" @click="engineerPickerOpen = false">取消</button><button class="primary">替换执行人（{{ selectedEngineerIDs.length }} 人）</button></div></form></div>
    <div v-if="selectedPresale" class="console-modal-backdrop" :class="{ nested: !!selectedOpportunity }" role="presentation" @click.self="closePresale">
      <article class="console-detail-modal crm-presale-console-detail" role="dialog" aria-modal="true" aria-label="售前申请详情">
        <header>
          <div class="crm-presale-detail-heading"><p class="console-modal-eyebrow">售前申请详情</p><div><h2 :title="selectedPresale.opportunity_name || selectedPresale.request.request_no">{{ selectedPresale.opportunity_name || selectedPresale.request.request_no }}</h2><span class="crm-presale-status-badge" :data-status="selectedPresale.request.status">{{ requestStatusText(selectedPresale.request.status) }}</span></div><small>申请编号 {{ selectedPresale.request.request_no }} · 关联商机 {{ selectedPresale.request.opportunity_no }} · {{ selectedPresale.overdue ? '当前已逾期' : '当前未逾期' }}</small></div>
          <button class="console-modal-close" type="button" aria-label="关闭售前申请详情" @click="closePresale"><ConsoleIcon name="close" /></button>
        </header>
        <div class="console-detail-grid crm-presale-summary">
          <div><span>状态</span><strong>{{ requestStatusText(selectedPresale.request.status) }}</strong></div>
          <div><span>关联商机</span><strong>{{ selectedPresale.request.opportunity_no }}</strong></div>
          <div><span>被支持单位</span><strong>{{ selectedPresale.customer_name || '—' }}</strong></div>
          <div class="crm-presale-phone"><span>联系方式</span><strong>{{ selectedPresale.request.contact_name || '—' }} · {{ presaleContactPhone || selectedPresale.request.contact_phone || '—' }}</strong><div class="crm-presale-phone__actions"><button v-if="canViewSelectedPresaleContactPhone && !presaleContactPhone" class="console-button ghost small" type="button" :disabled="presaleContactPhoneLoading" @click="viewPresaleContactPhone">{{ presaleContactPhoneLoading ? '查看中…' : '查看明文' }}</button><button v-if="presaleContactPhone" class="console-button ghost small" type="button" @click="presaleContactPhone = ''">隐藏</button></div><small v-if="canViewSelectedPresaleContactPhone" class="crm-note">查看明文会写入敏感信息访问审计，关闭详情后立即清除。</small><small v-if="presaleContactPhoneError" class="crm-alert error" role="alert">{{ presaleContactPhoneError }}</small></div>
          <div><span>当前执行人</span><strong>{{ assignees(selectedPresale.current_assignees) }}</strong></div>
          <div v-if="selectedPresale.request.team_lead_person_id"><span>团队负责人</span><strong>{{ selectedPresale.request.team_lead_name || ownerLabel(selectedPresale.request.team_lead_person_id) }}</strong></div>
          <div><span>累计工时</span><strong>{{ selectedPresale.total_work_hours }} 小时</strong></div>
          <div class="crm-presale-summary__support"><span>支持内容</span><strong>{{ selectedPresale.request.description || '—' }}</strong></div>
          <div><span>是否逾期</span><strong>{{ selectedPresale.overdue ? '是' : '否' }}</strong></div>
        </div>
        <div class="crm-presale-detail-workspace">
          <div class="crm-presale-detail-primary">
        <section class="console-detail-section crm-presale-actions" aria-labelledby="presale-actions-heading">
          <h3 id="presale-actions-heading">可用操作</h3>
          <p v-if="presaleActionsLoading">正在向服务端确认可用操作…</p>
          <p v-else-if="presaleActionsError" class="crm-alert error" role="alert">{{ presaleActionsError }} <button class="console-button ghost small" type="button" @click="refreshPresaleActions(selectedPresale.request.id)">重试</button></p>
          <p v-else>{{ authoritativePresaleActions.map(actionText).join('、') || '当前仅可查看' }}。多人任务在所有当前执行人各有至少一笔有效工时后自动完成。</p>
          <p v-if="selectedPresale.request.status === 'PENDING_APPROVAL'">审批操作在客户与商机系统内按流程节点和当前登录审批人实时校验；浏览器不会接收或提交内部任务 ID。</p>
          <div v-if="canSelectExecutionDepartment()" class="crm-presale-action-buttons"><select v-model="selectedExecutionDepartmentID" @focus="loadExecutionDepartments" @change="onExecutionDepartmentChange"><option value="">选择执行部门</option><option v-for="item in executionDepartments" :key="item.id" :value="item.id">{{ item.name }}</option></select><select v-if="canConfigureTwoLevelAssignment()" v-model="selectedTeamLeadPersonID" :disabled="teamLeadDirectoryLoading || !selectedExecutionDepartmentID"><option value="">{{ teamLeadDirectoryLoading ? '加载团队负责人…' : '选择团队负责人' }}</option><option v-for="item in teamLeadCandidates" :key="item.person_id" :value="item.person_id">{{ item.person_name }}（{{ item.department || '未标注部门' }}）</option></select><button class="console-button primary small" type="button" :disabled="departmentSaving || !selectedExecutionDepartmentID || (canConfigureTwoLevelAssignment() && !selectedTeamLeadPersonID)" @click="saveExecutionDepartment">{{ departmentSaving ? '保存中…' : canConfigureTwoLevelAssignment() ? '保存部门与负责人' : '保存部门' }}</button></div><div class="crm-presale-action-buttons"><button class="console-button ghost small" type="button" :disabled="presaleInspectorLoading" @click="runPresale('assignments')">{{ presaleInspectorLoading && presaleInspectorPanel === 'assignments' ? '加载指派中…' : '查看指派' }}</button><button class="console-button ghost small" type="button" :disabled="presaleInspectorLoading" @click="runPresale('history')">{{ presaleInspectorLoading && presaleInspectorPanel === 'history' ? '加载审批历史…' : '审批历史' }}</button><button v-if="authoritativePresaleActions.includes('APPROVE')" class="console-button primary small" type="button" :disabled="presaleMutationLoading" @click="runPresaleDecision('approve')">通过售前申请</button><button v-if="authoritativePresaleActions.includes('REJECT')" class="console-button danger small" type="button" :disabled="presaleMutationLoading" @click="runPresaleDecision('reject')">驳回售前申请</button><button v-if="authoritativePresaleActions.includes('CANCEL')" class="console-button danger small" type="button" @click="runPresaleDecision('cancel')">取消售前申请</button><button v-if="canAssignPresaleExecutors() || canActOnConfiguredAssignment('PERSON_ASSIGNMENT')" class="console-button ghost small" type="button" @click="openEngineerPicker">从基础平台选择执行人</button><button v-if="canRejectPresaleExecutionAssignment()" class="console-button danger small" type="button" :disabled="presaleMutationLoading" @click="openPresaleExecutionRejection">拒绝执行指派</button><button v-if="canTakeoverExecutingTeamLead()" class="console-button ghost small" type="button" :disabled="presaleMutationLoading" @click="openTakeoverDialog">接管负责人</button><button v-if="['REJECTED', 'CANCELLED'].includes(selectedPresale.request.status) && canCreatePresale && presaleRequestSubmissionAvailable" class="console-button primary small" type="button" @click="reopenPresaleApproval">重新发起审批</button></div>
        </section>
        <section v-if="presaleInspectorPanel" class="console-detail-section crm-presale-inspector" aria-live="polite">
          <div class="crm-subsection-heading"><div><h3>{{ presaleInspectorPanel === 'assignments' ? '指派记录' : '审批历史' }}</h3><p>{{ presaleInspectorPanel === 'assignments' ? '展示当前及历史执行人、指派时间和变更原因。' : '展示每个审批节点的结果、审批人和审批意见。' }}</p></div><button class="console-button ghost small" type="button" :disabled="presaleInspectorLoading" @click="loadPresaleInspector(presaleInspectorPanel)">刷新</button></div>
          <p v-if="presaleInspectorLoading" class="crm-note" role="status">正在加载，请稍候…</p>
          <p v-else-if="presaleInspectorError" class="crm-alert error" role="alert">{{ presaleInspectorError }} <button class="console-button ghost small" type="button" @click="loadPresaleInspector(presaleInspectorPanel)">重试</button></p>
          <template v-else-if="presaleInspectorPanel === 'assignments'"><div v-if="presaleAssignments.length" class="crm-presale-record-list"><article v-for="item in presaleAssignments" :key="item.id" class="crm-presale-record"><div><strong>{{ item.assignee_name_snapshot || ownerLabel(item.assignee_id) }}</strong><span>{{ item.assignee_role || '执行人员' }} · {{ item.is_current ? '当前指派' : '历史指派' }}</span></div><dl><div><dt>开始</dt><dd>{{ formatDate(item.assigned_at) }}</dd></div><div><dt>结束</dt><dd>{{ item.ended_at ? formatDate(item.ended_at) : '—' }}</dd></div><div><dt>变更原因</dt><dd>{{ item.change_reason || '—' }}</dd></div></dl></article></div><p v-else class="crm-empty compact">暂无指派记录</p></template>
          <template v-else><div v-if="presaleApprovalHistory.length" class="crm-approval-node-list"><article v-for="item in presaleApprovalHistory" :key="item.id" class="crm-approval-node" :class="approvalNodeTone(item.result)"><span class="crm-approval-check" aria-hidden="true">{{ approvalNodeIcon(item.result) }}</span><div class="crm-approval-info"><div class="crm-approval-title">节点 {{ item.node }} · {{ approvalResultText(item.result) }}</div><div class="crm-approval-meta">{{ item.approver_name_snapshot || ownerLabel(item.approver_id) }} · {{ formatDate(item.approved_at) }}</div><p>{{ item.comment || '未填写审批意见' }}</p></div></article></div><p v-else class="crm-empty compact">暂无审批历史</p></template>
        </section>
        <section v-if="authoritativePresaleActions.includes('ADD_PROGRESS')" class="console-detail-section crm-presale-entry-card">
          <h3>登记进度</h3><p>补充本次工作的最新进展，参考链接仅允许 HTTPS。</p>
          <form class="console-form-grid" @submit.prevent="runPresale('progress')"><label class="console-form-item full"><span>进度说明 *</span><textarea v-model.trim="operation.progress" minlength="1" maxlength="2000" required rows="3"></textarea></label><label class="console-form-item"><span>参考链接（仅 HTTPS）</span><input v-model.trim="operation.progress_link" type="url" placeholder="https://" maxlength="1000"></label><label class="console-form-item"><span>进度百分比</span><input v-model="operation.progress_pct" type="number" min="0" max="100"></label><div class="crm-presale-form-actions"><button class="console-button primary" type="submit" :disabled="presaleMutationLoading">登记进度</button><button v-if="authoritativePresaleActions.includes('COMPLETE')" class="console-button danger" type="button" :disabled="presaleMutationLoading" @click="runPresaleComplete">结束进度</button></div></form>
        </section>
        <details v-if="authoritativePresaleActions.includes('ADD_WORKLOG')" class="console-detail-section crm-presale-entry-card crm-presale-worklog-form">
          <summary>登记工时</summary>
          <form class="console-form-grid" @submit.prevent="runPresale('worklog')"><label class="console-form-item"><span>开始 *</span><input v-model="operation.work_start" type="datetime-local" required></label><label class="console-form-item"><span>结束 *</span><input v-model="operation.work_end" type="datetime-local" required></label><label class="console-form-item"><span>单位</span><select v-model="operation.raw_unit"><option value="HOUR">小时</option><option value="PERSON_DAY">人天（1 人天 = 8 小时）</option></select></label><label class="console-form-item"><span>数值 *</span><input v-model.trim="operation.raw_value" required inputmode="decimal" pattern="(?:0|[1-9][0-9]{0,7})(?:\\.[0-9]{1,2})?" maxlength="1000"></label><label class="console-form-item full"><span>工作地点 *</span><input v-model.trim="operation.work_site_address" required maxlength="500"></label><label class="console-form-item"><span>工作内容</span><select v-model="operation.work_content"><option value="SOLUTION_DESIGN">方案设计</option><option value="TECH_EXCHANGE">技术交流</option><option value="POC_DEMO">POC 演示</option><option value="TECH_QA">技术答疑</option><option value="OTHER">其他</option></select></label><label class="console-form-item"><span>备注</span><input v-model.trim="operation.remark" maxlength="1000"></label><div class="crm-presale-form-actions"><button class="console-button primary" type="submit" :disabled="presaleMutationLoading">{{ presaleMutationLoading ? '提交中…' : '提交工时' }}</button></div></form>
        </details>
          </div>
          <aside class="crm-presale-detail-activity" aria-label="流程与工时记录">
        <section class="console-detail-section crm-presale-timeline" aria-labelledby="presale-timeline-heading"><div class="crm-subsection-heading"><div><h3 id="presale-timeline-heading">流程时间线</h3><p>按服务端稳定游标倒序展示，关键动作以步骤条呈现。</p></div><button class="console-button ghost small" type="button" :disabled="presaleTimelineLoading" @click="refreshPresaleTimeline(selectedPresale.request.id)">刷新</button></div><p v-if="presaleTimelineLoading && !presaleTimeline.length">正在加载流程记录…</p><p v-if="presaleTimelineError" class="crm-alert error" role="alert">{{ presaleTimelineError }}</p><ol v-if="presaleTimeline.length" class="crm-timeline-list" tabindex="0" aria-label="售前流程步骤，区域内可滚动"><li v-for="item in presaleTimeline" :key="item.event_id" :class="`crm-timeline-step is-${timelineEventMeta(item.type).tone}`"><div class="crm-timeline-rail" aria-hidden="true"><span>{{ timelineEventMeta(item.type).icon }}</span></div><time :datetime="item.occurred_at"><strong>{{ formatDate(item.occurred_at) }}</strong><small>{{ timelineEventMeta(item.type).stage }}节点</small></time><article class="crm-timeline-card"><header><span class="crm-timeline-stage">{{ timelineEventMeta(item.type).stage }}</span><h4>{{ timelineEventText(item.type) }}</h4></header><div class="crm-timeline-meta"><span v-if="item.actor_name || item.actor_id">操作人：{{ operationUserLabel(item) }}</span><span v-if="item.type === 'STATUS_CHANGED'">{{ requestStatusText(item.from_status) }} <b>→</b> {{ requestStatusText(item.to_status) }}</span><span v-if="item.type === 'APPROVAL_DECIDED'">审批结果：{{ approvalResultText(item.result) }}</span><span v-if="item.type === 'ASSIGNEE_ADDED' || item.type === 'ASSIGNEE_REMOVED'">执行人：{{ operationSubjectLabel(item) }}</span><span v-if="item.progress_pct !== null && item.progress_pct !== undefined" class="crm-timeline-progress">进度 {{ item.progress_pct }}%</span><span v-if="item.work_hours" class="crm-timeline-hours">{{ workContentText(item.work_content) }} · {{ item.work_hours }} 小时</span></div><p v-if="item.content" class="crm-timeline-content">{{ item.content }}</p><a v-if="safeHTTPSURL(item.link_url)" :href="safeHTTPSURL(item.link_url)" target="_blank" rel="noopener noreferrer">打开参考链接 <span aria-hidden="true">↗</span></a></article></li></ol><p v-else-if="!presaleTimelineLoading && !presaleTimelineError" class="crm-empty compact">暂无流程记录</p><button v-if="presaleTimelineCursor" class="console-button ghost small" type="button" :disabled="presaleTimelineLoading" @click="loadMorePresaleTimeline">{{ presaleTimelineLoading ? '加载中…' : '加载更多' }}</button></section>
        <section class="console-detail-section crm-presale-worklogs"><h3>工时记录</h3><p v-if="!worklogs.length">暂无工时。</p><div v-else class="crm-table-wrap"><table class="crm-data-table"><thead><tr><th scope="col">人员</th><th scope="col">起止时间</th><th scope="col">工时</th><th scope="col">地点</th><th scope="col">工作内容</th><th scope="col">推送</th></tr></thead><tbody><tr v-for="item in worklogs" :key="item.id"><td>{{ item.person_name || '未命名用户' }}</td><td>{{ formatDate(item.work_start) }} ~ {{ formatDate(item.work_end) }}</td><td>{{ item.work_hours }} 小时</td><td>{{ item.work_site_address || '—' }}</td><td>{{ workContentText(item.work_content) }}</td><td><span class="crm-badge" :class="item.push_status === 'SUCCESS' ? 'crm-badge--success' : item.push_status === 'DEAD_LETTER' ? 'crm-badge--danger' : ['PENDING', 'SENDING', 'RETRY_WAIT'].includes(item.push_status) ? 'crm-badge--warning' : 'crm-badge--gray'">{{ pushStatusText(item.push_status) }}</span></td></tr></tbody></table></div></section>
          </aside>
        </div>
        <footer><button class="console-button ghost" type="button" @click="closePresale">关闭</button></footer>
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
    <ConfirmDialog
      :open="Boolean(confirmDialog)"
      v-bind="confirmDialog || {}"
      @confirm="acceptConfirm"
      @cancel="cancelConfirm"
    />
    </template>
  </AppShell>
</template>
