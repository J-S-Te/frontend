<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatUserError } from '../../shared/utils/userError.js'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, logoutCurrentSession } from '@/modules/platform/auth/api/auth'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { useDictionaryOptions } from '@/modules/platform/dictionaries/composables/useDictionaryOptions.js'
import ContractDocumentPreview from '@/modules/contract_management/components/ContractDocumentPreview.vue'
import { validateRecipientPhoneNumber } from '@/modules/contract_management/utils/recipientPhone.js'
import { cloneNormalizedSigningRecord, isNormalizedSigningRecord } from '@/modules/contract_management/utils/signingRecord.js'
import ContractReportsPanel from '@/modules/contract_management/components/ContractReportsPanel.vue'
import {
  commandApproval,
  ContractAuthError,
  createApprovalRule,
  createContract,
  createExternalContract,
  deleteApprovalRule,
  deleteContractTemplate,
  getApproval,
  getContractDashboard,
  getContract,
  getContractSession,
  ensureContractCRMDirectorySession,
  openContractCRMLogin,
  getSigningRecord,
  getOpportunityIntake,
  listApprovals,
  listMyCustomers,
  listMyOpportunities,
  listSigningRecords,
  listApprovalRules,
  listApprovalTasks,
  listContractTemplates,
  listContractDetectionCategories,
  listContracts,
  listContractLifecycle,
  listOpportunityIntakes,
  previewApprovalContract,
  previewContractTemplate,
  recoverApproval,
  previewContractDocument,
  submitContract,
  reviewOpportunityIntake,
  saveSigningShipment,
  markSigningReceived,
  recordSigningReminder,
  confirmSigning,
  updateApprovalRule,
  updateContractDraft,
  updateContractTemplate,
  uploadContractTemplate,
  replaceContractTemplateSource,
  uploadStampedContractPDF,
  downloadContractFile,
} from '@/modules/contract_management/api/contract'
import {
  ensureStableReviewAttempt,
  isOpportunityIntakeIdempotencyConflict,
  isOpportunityIntakeVersionConflict,
  opportunityIntakeStatus,
} from '@/modules/contract_management/utils/opportunityIntakeReview'
import {
  CONTRACT_ROLE_DEFINITIONS,
  canAccessContractSection,
  contractRole,
  hasContractPermission,
} from '@/modules/shared/authz/sys004'
import { buildTemplateValues } from '@/modules/contract_management/utils/currentUserPrefill'
import { canEditContractDraft, hydrateContractDraft, saveContractDraft } from '@/modules/contract_management/utils/contractDraft'
import { normalizePaymentTerms, paymentAmountMinor } from '@/modules/contract_management/utils/paymentTerms'
import { contractSystemLevels, externalContractTypes, isContractDOCXFile, validateContractForm } from '@/modules/contract_management/utils/contractPayload'
import { approvalAmountInput, approvalAmountMinor, copyRuleExpression, ruleExpressionSummary } from '@/modules/contract_management/utils/approvalRule'
import PaymentTermsSummary from '@/modules/contract_management/components/PaymentTermsSummary.vue'
import { isSystemContractNumberField, isContractAmountField, synchronizeContractTemplateValues } from '@/modules/contract_management/utils/systemTemplateFields'
import { closeSubsystemTabOrFallback } from '@/modules/contract_management/utils/returnToPortal'
import '@/modules/contract_management/styles/contract-management.css'

const route = useRoute()
const router = useRouter()
const session = ref(null)
const sessionError = ref('')
const businessDataErrors = ref({})
const crmConnectionRequired = ref(false)
const crmForceLogin = ref(false)
const crmConnectionMessage = ref('')

function recordCRMDirectoryError(error) {
  crmConnectionRequired.value = Boolean(error?.crmLoginRequired)
  crmForceLogin.value = Boolean(error?.crmForceLogin)
  crmConnectionMessage.value = formatUserError(error, { fallback: '无法读取 CRM 目录，请稍后重试。' })
}

async function checkCRMDirectorySession() {
  try {
    await ensureContractCRMDirectorySession()
    crmConnectionRequired.value = false
    crmForceLogin.value = false
    crmConnectionMessage.value = ''
  } catch (error) {
    recordCRMDirectoryError(error)
    throw error
  }
}

function connectCRM() {
  crmConnectionMessage.value = openContractCRMLogin({ force: crmForceLogin.value })
    ? '已打开 CRM 登录标签页。请使用合同当前账号完成登录，然后返回点击“搜索”重试；当前合同表单会保留。'
    : '无法打开 CRM 登录标签页，请允许浏览器弹出窗口后再次点击“连接 CRM”。当前合同表单会保留。'
}

const sectionMeta = {
  dashboard: { title: '工作台', description: '合同全生命周期概览与重点事项提醒' },
  intakes: { title: '签单关联核对', description: '人工核对 CRM 签单上下文与既有合同引用，不创建合同' },
  customers: { title: '客户查询', description: '查询客户主数据与历史合作情况' },
  contracts: { title: '合同台账', description: '统一管理合同版本、状态、金额与关键日期' },
  templates: { title: '合同模板', description: '标准模板、适用范围与版本管理' },
  approvals: { title: '审批中心', description: '集中处理合同审批与状态变更待办' },
  rules: { title: '审批规则', description: '按合同类型与金额配置审批流程' },
  signing: { title: '签署台账', description: '跟踪盖章、签署、归档与到期情况' },
  reports: { title: '统计报表', description: '洞察签约规模、结构与履约趋势' },
}

const adminNavGroupDefinitions = [
  {
    label: '工作概览',
    items: [{ key: 'dashboard', label: '工作台', icon: 'dashboard' }],
  },
  {
    label: '业务办理',
    items: [
      { key: 'intakes', label: '签单关联核对', icon: 'audit' },
      { key: 'contracts', label: '合同台账', icon: 'account' },
      { key: 'approvals', label: '审批中心', icon: 'audit' },
    ],
  },
  {
    label: '查询台账',
    items: [
      { key: 'signing', label: '签署台账', icon: 'shield' },
    ],
  },
  {
    label: '配置管理',
    items: [
      { key: 'templates', label: '合同模板', icon: 'save' },
      { key: 'rules', label: '审批规则', icon: 'organization' },
    ],
  },
  { label: '统计查看', items: [{ key: 'reports', label: '统计报表', icon: 'dashboard' }] },
]

const userNavGroupDefinitions = [
  {
    label: '工作概览',
    items: [{ key: 'dashboard', label: '工作台', icon: 'dashboard' }],
  },
  {
    label: '合同业务',
    items: [
      { key: 'intakes', label: '签单关联核对', icon: 'audit' },
      { key: 'contracts', label: '合同台账', icon: 'account' },
      { key: 'templates', label: '合同模板', icon: 'save' },
      { key: 'signing', label: '签署台账', icon: 'shield' },
    ],
  },
  {
    label: '审批协同',
    items: [
      { key: 'approvals', label: '审批中心', icon: 'audit' },
      { key: 'rules', label: '审批规则', icon: 'organization' },
    ],
  },
  { label: '数据分析', items: [{ key: 'reports', label: '统计报表', icon: 'dashboard' }] },
]

const contracts = ref([])
const signingRecords = ref([])
const stampedUploadBusyID = ref('')
const selectedSigningRecord = ref(null)
const signingOpenedDocument = ref({ version: 0, sha256: '' })
const signingDetailLoading = ref(false)
const signingOperationBusy = ref(false)
const contractDownloadBusy = ref(false)
const signingKeyword = ref('')
const signingMethodFilter = ref('')
const signingStatusFilter = ref('')
const signingTotal = ref(0)
const signingHasMore = ref(false)
const signingSummary = ref(null)
const signingLedgerLoading = ref(false)
const signingLoadingMore = ref(false)
let signingFilterTimer = 0
// C-ii（task-62）：recipient_phone 是后端寄送保存的必填字段（router.go 非空 + ≤20 rune），
// 表单状态必须携带该键，否则保存请求恒被 422 拒绝。
const signingShipmentForm = ref({ courier_number: '', recipient_name: '', recipient_phone: '', recipient_address: '', mailed_at: '' })
const signingConfirmationForm = ref({ seal_verified: false, signature_verified: false, signed_at: '' })
const signingReplacementReason = ref('')
const adminDashboard = ref(null)
const dashboardDetailKey = ref('')
const approvals = ref([])
const initiatedApprovals = ref([])
const approvalTab = ref('tasks')
const rules = ref([])
const contractTemplates = ref([])
const opportunityIntakes = ref([])
const opportunityIntakeFilter = ref('ACCEPTED')
const opportunityIntakeLoading = ref(false)
const opportunityIntakeLoadingMore = ref(false)
const opportunityIntakeError = ref('')
const opportunityIntakeNextCursor = ref('')
const opportunityIntakeHasMore = ref(false)
const selectedOpportunityIntake = ref(null)
const opportunityIntakeDetailLoading = ref(false)
const opportunityIntakeDecision = ref('LINK_CONFIRMED')
const opportunityIntakeReason = ref('')
const opportunityIntakeReviewBusy = ref(false)
const opportunityIntakeReviewAttempt = ref(null)
const opportunityIntakeConflictNotice = ref('')
const opportunityIntakeReviewBlocked = ref(false)
let opportunityIntakeLoadSequence = 0
let opportunityIntakeDetailSequence = 0
const businessDataLoading = ref(false)
const approvalComment = ref('')
const approvalDetail = ref(null)
const approvalDetailLoading = ref(false)
const approvalContractPreviewHTML = ref('')
const approvalContractPreviewLoading = ref(false)
const approvalContractPreviewError = ref('')
const approvalCommandBusy = ref(false)
const approvalTargetUser = ref('')
const approvalTargetNode = ref('')
const termsIdentical = ref(false)
const submittingContract = ref(false)
const ruleDialogOpen = ref(false)
const templateUploadDialogOpen = ref(false)
const templateUploading = ref(false)
const templateUploadForm = ref({ name: '', file: null })
const templateReplacementID = ref('')
const templateUploadError = ref('')
const templateEditDialogOpen = ref(false)
const templateSaving = ref(false)
const templateEditForm = ref({ id: '', name: '', number_format: 'HT-{YYYYMMDD}-{ID8}', fields: [] })
const templatePreviewHTML = ref('')
const templatePreviewing = ref(false)
const templatePreviewError = ref('')
const templatePreviewRef = ref(null)
const ruleSaving = ref(false)
const editingRuleId = ref('')
const contractCreationMode = ref('template')
const externalContractFile = ref(null)
const externalContractFileError = ref('')
const externalContractFileInputKey = ref(0)
const contractCreating = ref(false)
const editingContract = ref(null)
const draftEditLoading = ref(false)
const draftEditError = ref('')
const draftEditConflict = ref(false)
const emptyServiceItem = () => ({ service_type: '', name: '', site: '', batch: '第一批次', category: '', requirement: '', test_mode: 'STANDARD', systems: [] })
const emptyNewContract = () => ({
  opportunity_id: '', opportunity_name: '', customer_id: '', title: '', contract_type: '', amount: '', currency: 'CNY',
  customer_name: '', customer_address: '', customer_contact: '', customer_phone: '',
  start_date: '', end_date: '',
  payment_terms: [],
  service_items: [emptyServiceItem()], template_id: '', template_values: {},
})
const newContract = ref(emptyNewContract())
const paymentPlanError = computed(() => {
  try { normalizePaymentTerms(newContract.value.payment_terms, newContract.value.amount, newContract.value.currency); return '' }
  catch (error) { return formatUserError(error, { fallback: '付款计划未通过校验，请核对金额、分期与日期。' }) }
})
function addPaymentTerm() {
  if (newContract.value.payment_terms.length >= 100) return
  const used = new Set(newContract.value.payment_terms.map((term) => Number(term.installment_no)))
  let next = 1
  while (used.has(next)) next += 1
  newContract.value.payment_terms.push({ installment_no: next, due_date: '', amount: '' })
}

// 合同类型、服务类型与系统等级由业务字典治理（平台控制台“字典管理”维护显示名与排序），
// 字典取值即业务存储字符串；平台会话过期或字典未配置时回退内置清单，表单不中断。
const fallbackContractTypeOptions = ['直签', '三方']
const fallbackServiceTypeOptions = ['等保测评', '商用密码应用安全性评估', '软件测试', '源代码审计', '渗透测试', '漏洞扫描', 'APP安全加固', '上线测试', '安全加固', '网络安全风险评估', '差距分析', '机房检测', '网络安全巡检服务', '安全培训', '安全性测试', '应急响应服务', '网络安全攻防演练', '安全运维', '模块开发', '技术咨询']
const fallbackSystemLevelOptions = ['一级', '二级', '三级', '四级']
const toDictionaryFallback = (values) => values.map((value) => ({ value, label: value }))
const { options: contractTypeItems } = useDictionaryOptions('CONTRACT_TYPE', { fallback: toDictionaryFallback(fallbackContractTypeOptions) })
const { options: serviceTypeItems } = useDictionaryOptions('CONTRACT_SERVICE_TYPE', { fallback: toDictionaryFallback(fallbackServiceTypeOptions) })
const { options: systemLevelItems } = useDictionaryOptions('CONTRACT_SYSTEM_LEVEL', { fallback: toDictionaryFallback(fallbackSystemLevelOptions) })
const contractTypeOptions = computed(() => contractTypeItems.value.map((item) => item.value))
const availableContractTypeOptions = computed(() => isExternalContractMode.value
  ? contractTypeOptions.value.filter((value) => externalContractTypes.includes(value)) : contractTypeOptions.value)
const serviceTypeOptions = computed(() => serviceTypeItems.value.map((item) => item.value))
const systemLevelOptions = computed(() => systemLevelItems.value.map((item) => item.value).filter((value) => contractSystemLevels.includes(value)))
const opportunityLoading = ref(false)
const opportunityError = ref('')
const opportunityKeyword = ref('')
const opportunityOptions = ref([])
const opportunityPage = ref(1)
const opportunityTotal = ref(0)
const opportunityHasMore = ref(false)
const customerPickerOpen = ref(false)
const customerLoading = ref(false)
const customerError = ref('')
const customerKeyword = ref('')
const customerOptions = ref([])
const customerPage = ref(1)
const customerTotal = ref(0)
const customerHasMore = ref(false)
const detectionCategoryOptions = ref([])
const detectionCategoryLoading = ref(false)
const detectionCategoryError = ref('')
let detectionCategoryRequestID = 0
const canAddServiceItem = computed(() => newContract.value.service_items.length < 20 && Boolean(newContract.value.service_items.at(-1)?.service_type))
const isExternalContractMode = computed(() => contractCreationMode.value === 'external')
const canSaveNewContract = computed(() => {
  if (contractCreating.value) return false
  if (draftEditConflict.value) return false
  return isExternalContractMode.value ? Boolean(editingContract.value || externalContractFile.value) : Boolean(selectedContractTemplate.value)
})

const ruleFieldOptions = [
  { value: 'amount_minor', label: '合同金额（元）', kind: 'number' },
  { value: 'service_type', label: '服务类型', kind: 'text' },
  { value: 'customer_credit_level', label: '客户信用等级', kind: 'text' },
  { value: 'contract_type', label: '合同类型', kind: 'text' },
  { value: 'terms_identical', label: '条款一致', kind: 'boolean' },
]
const numericOperators = [
  { value: 'eq', label: '等于' }, { value: 'ne', label: '不等于' },
  { value: 'gt', label: '大于' }, { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' }, { value: 'lte', label: '小于等于' },
]
const textOperators = [
  { value: 'eq', label: '等于' }, { value: 'ne', label: '不等于' }, { value: 'in', label: '包含于（逗号分隔）' },
]

function emptyRuleForm() {
  return {
    name: '',
    priority: 0,
    enabled: true,
    logical: 'and',
    conditions: [{ field: 'amount_minor', operator: 'lte', value: '' }],
    expressionReadonly: false,
    originalExpression: null,
    nodes: [{ id: 'sales-director', name: '销售总监审批', role_code: 'sales_director', countersign: 'any' }],
    version: 0,
  }
}
const ruleForm = ref(emptyRuleForm())

function roleLabel(roleCode) {
  if (!roleCode) return '未分配角色'
  return contractRole(roleCode)?.name || '未识别角色'
}

const currentUserLabel = computed(() => session.value?.display_name || session.value?.user_name || '当前用户')
const currentRoleLabel = computed(() => {
  const roleCodes = Array.isArray(session.value?.roles) && session.value.roles.length
    ? session.value.roles
    : [session.value?.role?.code].filter(Boolean)
  const labels = [...new Set(roleCodes.map(roleLabel))]
  return labels.length ? labels.join('、') : session.value?.role?.name || '未分配角色'
})
const currentUserInitial = computed(() => currentUserLabel.value.slice(0, 1).toUpperCase())
const userDirectory = computed(() => Array.isArray(session.value?.user_directory) ? session.value.user_directory : [])
const approvalTargetUsers = computed(() => {
  const currentIndex = approvalDetail.value?.state?.current_node_index
  const currentNode = Number.isInteger(currentIndex) ? approvalDetail.value?.state?.nodes?.[currentIndex] : null
  const assigned = new Set(currentNode?.node?.assignee_ids || [])
  return userDirectory.value.filter((user) => !assigned.has(user.user_id)
    && (user.roles || []).some((roleCode) => contractRole(roleCode)?.permissions?.includes('approval.process')))
})
const can = (permission) => hasContractPermission(session.value, permission)
const isAdmin = computed(() => {
  const roleCodes = Array.isArray(session.value?.roles) ? session.value.roles : []
  return roleCodes.includes('admin') || session.value?.role?.code === 'admin'
})
const navGroups = computed(() => (isAdmin.value ? adminNavGroupDefinitions : userNavGroupDefinitions)
  .map((group) => ({ ...group, items: group.items.filter((item) => canAccessContractSection(session.value, item.key)) }))
  .filter((group) => group.items.length))
const selectedContractTemplate = computed(() => contractTemplates.value.find((item) => item.id === newContract.value.template_id) || null)
const editableContractTemplateFields = computed(() => (selectedContractTemplate.value?.fields || []).filter((field) => !isSystemContractNumberField(field)))

const keyword = ref('')
const statusFilter = ref('')
const typeFilter = ref('')
const mobileMenuOpen = ref(false)
const selectedContract = ref(null)
const selectedContractPreviewHTML = ref('')
const selectedContractPreviewLoading = ref(false)
const selectedContractPreviewError = ref('')
const selectedContractLifecycle = ref([])
const selectedContractLifecycleLoading = ref(false)
const selectedContractLifecycleError = ref('')
const selectedApproval = ref(null)
const createDialogOpen = ref(false)
const notificationOpen = ref(false)
const toast = ref('')
const isLoggingOut = ref(false)
let toastTimer = 0
let approvalRealtimeTimer = 0
let approvalRealtimeBusy = false
let signingRealtimeTimer = 0
let signingRealtimeBusy = false
let contractDetailSequence = 0
let approvalDetailSequence = 0
let signingDetailSequence = 0
let templatePreviewSequence = 0

const activeSection = computed(() => {
  const section = typeof route.params.section === 'string' ? route.params.section : 'dashboard'
  return sectionMeta[section] ? section : 'dashboard'
})
const businessDataError = computed(() => businessDataErrors.value[activeSection.value] || '')
const pageMeta = computed(() => sectionMeta[activeSection.value])

const filteredContracts = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return contracts.value.filter((contract) => {
    const hitKeyword = !query || [contract.id, contract.name, contract.type, contract.serviceType, contract.owner].join(' ').toLowerCase().includes(query)
    return hitKeyword && (!statusFilter.value || contract.status === statusFilter.value) && (!typeFilter.value || contract.type === typeFilter.value)
  })
})

// 筛选与分页由服务端完成；这里保留 computed 以兼容模板命名，避免再把最近一页
// 当成完整台账做二次筛选。
const filteredSigningRecords = computed(() => signingRecords.value)
const signingStats = computed(() => {
  if (signingSummary.value) {
    return {
      completed: Number(signingSummary.value.completed || 0),
      processing: Number(signingSummary.value.processing || 0),
      monthly: Number(signingSummary.value.monthly || 0),
      expired: Number(signingSummary.value.expired || 0),
    }
  }
  const now = new Date()
  return {
    completed: signingRecords.value.filter((item) => item.status === 'completed').length,
    processing: signingRecords.value.filter((item) => ['pending_shipment', 'in_return', 'pending_review'].includes(item.status) && !isSigningExpired(item)).length,
    monthly: signingRecords.value.filter((item) => {
      const confirmed = item.confirmed_at ? new Date(item.confirmed_at) : null
      return confirmed && confirmed.getFullYear() === now.getFullYear() && confirmed.getMonth() === now.getMonth()
    }).length,
    expired: signingRecords.value.filter(isSigningExpired).length,
  }
})

function groupCurrencyTotals(items) {
  const grouped = new Map()
  for (const item of items || []) {
    const currency = /^[A-Z]{3}$/.test(item?.currency || '') ? item.currency : 'CNY'
    const current = grouped.get(currency) || { currency, amountMinor: 0, contracts: 0 }
    current.amountMinor += Number(item?.amount_minor || 0)
    current.contracts += 1
    grouped.set(currency, current)
  }
  return [...grouped.values()].sort((left, right) => left.currency.localeCompare(right.currency))
}
const personalCurrencyTotals = computed(() => groupCurrencyTotals(contracts.value.map((item) => ({ currency: item.currency, amount_minor: Math.round(item.amount * 100) }))))
const dashboardCurrencyTotals = computed(() => {
  const totals = adminDashboard.value?.currency_totals
  if (Array.isArray(totals) && totals.length) {
    return totals.map((item) => ({ currency: item.currency || 'CNY', amountMinor: Number(item.amount_minor || 0), contracts: Number(item.contracts || 0) }))
  }
  return groupCurrencyTotals(adminDashboardContracts.value.map((item) => ({ currency: item.currency, amount_minor: Math.round(item.amount * 100) })))
})
const dashboardTotalAmountLabel = computed(() => formatCurrencyTotals(dashboardCurrencyTotals.value))
const personalTotalAmountLabel = computed(() => formatCurrencyTotals(personalCurrencyTotals.value))
const activeContractCount = computed(() => contracts.value.filter((item) => ['已批准', '已生效', '履约中', '待付款'].includes(item.status)).length)
const adminDashboardContracts = computed(() => (adminDashboard.value?.contracts || []).map(normalizeContract))
const reportContracts = computed(() => adminDashboardContracts.value.length ? adminDashboardContracts.value : contracts.value)
const dashboardDetailMeta = computed(() => ({
  total_amount: { title: '当前企业合同总额', value: dashboardTotalAmountLabel.value },
  total_count: { title: '当前企业合同份数', value: `${adminDashboard.value?.total_contracts || 0} 份` },
  approval: { title: '当前处于审批流程中的合同', value: `${adminDashboard.value?.approval_contracts || 0} 份` },
  active: { title: '已生效未到期的合同', value: `${adminDashboard.value?.active_contracts || 0} 份` },
  expired: { title: '已超期的合同', value: `${adminDashboard.value?.expired_contracts || 0} 份` },
}[dashboardDetailKey.value] || { title: '', value: '' }))
const dashboardDetailContracts = computed(() => {
  if (['total_amount', 'total_count'].includes(dashboardDetailKey.value)) return adminDashboardContracts.value
  if (dashboardDetailKey.value === 'approval') return adminDashboardContracts.value.filter((item) => item.inApproval)
  if (dashboardDetailKey.value === 'active') return adminDashboardContracts.value.filter((item) => item.activeUnexpired)
  if (dashboardDetailKey.value === 'expired') return adminDashboardContracts.value.filter((item) => item.expired)
  return []
})

function navigate(section) {
  if (!canAccessContractSection(session.value, section)) {
    showToast('当前角色无权访问该功能。')
    return
  }
  router.push({ name: 'contract_management', params: { section } })
  mobileMenuOpen.value = false
}

function navigatePlatform(name) {
  router.push({ name })
}

function returnToUnifiedPortal() {
  mobileMenuOpen.value = false
  closeSubsystemTabOrFallback(window, () => router.replace({ name: 'portal' }))
}
async function logoutSystem() {
  if (isLoggingOut.value) return
  isLoggingOut.value = true
  try {
    await logoutCurrentSession()
    await router.replace({ name: 'login', query: { reason: 'session-ended' } })
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) {
      await router.replace({ name: 'login', query: { reason: 'session-ended' } })
      return
    }
    showToast(formatUserError(error, { fallback: '退出系统失败，请稍后重试。' }))
  } finally {
    isLoggingOut.value = false
  }
}

async function resetFilters() {
  keyword.value = ''
  statusFilter.value = ''
  typeFilter.value = ''
  // 合同台账由服务端按 keyword 过滤；只清空输入会把上次搜索子集当成完整列表。
  await loadBusinessData()
}

function showToast(message) {
  toast.value = formatUserError(message, { fallback: '操作未完成，请核对页面信息；仍失败时请联系管理员。' })
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = '' }, 2600)
}

function openDashboardDetail(key) {
  dashboardDetailKey.value = key
}

function openDashboardContract(contract) {
  dashboardDetailKey.value = ''
  openContract(contracts.value.find((item) => item.recordId === contract.recordId) || contract)
}

function openReportContract(contract) {
  openContract(contracts.value.find((item) => item.recordId === contract.recordId) || contract)
}

function exportContracts() {
  const rows = filteredContracts.value.map((item) => [item.id, item.name, item.type, item.serviceType, item.amount, item.owner, item.status])
  const csv = [['合同编号', '合同名称', '合同类型', '服务类型', '金额', '负责人姓名', '状态'], ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n')
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = '合同台账.csv'
  anchor.click()
  URL.revokeObjectURL(url)
  showToast(`已导出 ${rows.length} 条合同记录`)
}

const statusLabels = {
  draft: '草稿',
  pending: '审批中',
  approved: '已批准',
  active: '已生效',
  in_progress: '履约中',
  pending_pay: '待付款',
  completed: '已完成',
  terminated: '已终止',
  archived: '已归档',
}

const approvalStatusLabels = {
  running: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  withdrawn: '已撤回',
  expired: '已过期',
  failed: '已失败',
}

const approvalNodeStatusLabels = {
  pending: '待处理',
  active: '处理中',
  approved: '已通过',
  rejected: '已驳回',
  skipped: '已跳过',
}

const approvalKindLabels = {
  contract_approval: '合同提交审批',
  status_change: '合同状态变更',
}

const approvalActionLabels = {
  approve: '同意',
  reject: '驳回',
  add_sign: '加签',
  transfer: '转交',
  return: '退回',
  withdraw: '撤回',
  urge: '催办',
  comment: '发表评论',
}

function approvalStatusLabel(status) {
  return approvalStatusLabels[status] || approvalNodeStatusLabels[status] || status || '—'
}

function approvalKindLabel(kind) {
  return approvalKindLabels[kind] || '合同审批'
}

function approvalNotificationTitle(approval) {
  return `${approval.type || '合同审批'}已流转至${approval.step || '当前节点'}`
}

function approvalActionLabel(action) {
  return approvalActionLabels[action] || '审批处理'
}

function contractStatusLabel(status) {
  return statusLabels[status] || status || '—'
}

function approvalStatusTone(status) {
  if (status === 'approved') return 'success'
  if (['rejected', 'failed'].includes(status)) return 'danger'
  if (['running', 'active'].includes(status)) return 'info'
  if (['pending', 'expired', 'withdrawn'].includes(status)) return 'warning'
  return 'neutral'
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-CN').format(date)
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date)
}

function normalizeContract(item) {
  return {
    recordId: item.id,
    id: item.contract_number || '审批通过后生成',
    name: item.title || '未命名合同',
    type: item.contract_type || '—',
    serviceType: item.service_type || '—',
    amount: Number(item.amount_minor || 0) / 100,
    currency: item.currency || 'CNY',
    paymentTerms: Array.isArray(item.payment_terms) ? item.payment_terms : [],
    owner: displayNameFor(item.owner_user_id, item.owner_display_name),
    customerName: item.customer_name || '—',
    createdAt: formatDate(item.created_at),
    updatedAt: formatDate(item.updated_at),
    startDate: formatDate(item.start_date),
    endDate: formatDate(item.end_date),
    endAt: item.end_date || '',
    status: contractStatusLabel(item.status),
    rawStatus: String(item.status || '').toUpperCase(),
    version: item.version,
    content: item.content || '',
    templateId: item.template_id || '',
    customerCreditLevel: item.customer_credit_level || '未填写',
    inApproval: Boolean(item.in_approval),
    activeUnexpired: Boolean(item.active_unexpired),
    expired: Boolean(item.expired),
    canEditDraft: canEditContractDraft(item),
  }
}

function normalizeSigningRecord(item) {
  return { ...item, contract: normalizeContract(item.contract || {}) }
}

function isSigningExpired(record) {
  if (record.status === 'completed' || !record.contract?.endAt) return false
  const end = new Date(record.contract.endAt)
  return !Number.isNaN(end.getTime()) && end.getTime() < Date.now()
}

function signingDisplayStatus(record) {
  if (isSigningExpired(record)) return { key: 'expired', label: '已失效', tone: 'danger' }
  return {
    pending_shipment: { key: 'pending_shipment', label: '待寄出', tone: 'warning' },
    in_return: { key: 'in_return', label: '回传中', tone: 'info' },
    pending_review: { key: 'pending_review', label: '待核验', tone: 'warning' },
    completed: { key: 'completed', label: '已完成', tone: 'success' },
  }[record.status] || { key: record.status, label: record.status || '—', tone: 'neutral' }
}

function signingProgress(record) {
  if (record.status === 'completed') return 100
  if (record.status === 'pending_review') return 80
  if (record.customer_received_at) return 60
  if (record.status === 'in_return') return 40
  return 20
}

async function openContract(contract) {
  const sequence = ++contractDetailSequence
  const isCurrent = () => sequence === contractDetailSequence && selectedContract.value?.recordId === contract.recordId
  termsIdentical.value = false
  selectedContract.value = contract
  selectedContractPreviewHTML.value = ''
  selectedContractPreviewError.value = ''
  selectedContractLifecycle.value = []
  selectedContractLifecycleError.value = ''
  selectedContractLifecycleLoading.value = true
  const requests = [listContractLifecycle(contract.recordId)
    .then((events) => { if (isCurrent()) selectedContractLifecycle.value = events })
    .catch((error) => { if (isCurrent()) selectedContractLifecycleError.value = formatUserError(error, { fallback: '读取合同流转明细失败' }) })
    .finally(() => { if (isCurrent()) selectedContractLifecycleLoading.value = false })]
  // 模板合同和外部 DOCX 上传均使用已持久化的文档。
  selectedContractPreviewLoading.value = true
  requests.push(previewContractDocument(contract.recordId)
    .then((result) => { if (isCurrent()) selectedContractPreviewHTML.value = result?.html || '' })
    .catch((error) => {
      if (isCurrent() && error?.code !== 'CON_DOCUMENT_NOT_FOUND') selectedContractPreviewError.value = formatUserError(error, { fallback: '读取格式化合同失败' })
    })
    .finally(() => { if (isCurrent()) selectedContractPreviewLoading.value = false }))
  await Promise.all(requests)
}

function closeContract() {
  contractDetailSequence += 1
  selectedContract.value = null
  selectedContractPreviewHTML.value = ''
  selectedContractPreviewError.value = ''
  selectedContractLifecycle.value = []
  selectedContractLifecycleError.value = ''
}

const lifecycleReasonLabels = {
  'contract draft edited': '编辑合同草稿',
  'contract created': '创建合同',
  'submitted for approval': '提交合同审批',
  'all approval nodes passed': '全部审批节点已通过',
  'approval completed; contract activated': '审批完成，合同生效',
  'contract end date passed; automatically archived': '合同到期，系统自动归档',
}

function lifecycleReason(reason) {
  return lifecycleReasonLabels[reason] || reason || '无备注'
}

async function downloadApprovedContract(contract, format) {
  if (contractDownloadBusy.value) return
  contractDownloadBusy.value = true
  let url = ''
  try {
    const { blob, filename } = await downloadContractFile(contract.recordId, format)
    url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
  } catch (error) { showToast(formatUserError(error, { fallback: '合同文件下载失败，请稍后重试。' })) }
  finally {
    if (url) window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    contractDownloadBusy.value = false
  }
}

async function refreshSigningRecords({ append = false, limit = 50 } = {}) {
  if (append && !signingHasMore.value) return
  if (append) signingLoadingMore.value = true
  else signingLedgerLoading.value = true
  try {
    const page = await listSigningRecords({
      limit,
      offset: append ? signingRecords.value.length : 0,
      keyword: signingKeyword.value.trim(),
      status: signingStatusFilter.value,
      method: signingMethodFilter.value,
    })
    const items = (page.items || []).map(normalizeSigningRecord)
    signingRecords.value = append ? [...signingRecords.value, ...items] : items
    signingTotal.value = Number(page.total || items.length)
    signingHasMore.value = Boolean(page.has_more)
    signingSummary.value = page.stats && typeof page.stats === 'object' ? page.stats : null
  } finally {
    signingLedgerLoading.value = false
    signingLoadingMore.value = false
  }
}

watch([signingKeyword, signingMethodFilter, signingStatusFilter], () => {
  if (!session.value) return
  window.clearTimeout(signingFilterTimer)
  signingFilterTimer = window.setTimeout(() => {
    refreshSigningRecords().catch((error) => showToast(formatUserError(error, { fallback: '加载签署台账失败' })))
  }, 250)
})

function applySigningRecord(record, { preserveForms = false } = {}) {
  // 列表已是归一化记录，详情/实时刷新是接口原始记录：只归一化一次，已归一化的
  // 记录直接复制，避免把 contract.id（合同编号）误写成 recordId。
  selectedSigningRecord.value = isNormalizedSigningRecord(record)
    ? cloneNormalizedSigningRecord(record)
    : normalizeSigningRecord(record)
  const selected = selectedSigningRecord.value
  // 实时同步用于保持生命周期数据最新，但绝不能
  // 覆盖操作人员尚未提交的寄送或核验输入。
  if (preserveForms) return
  signingShipmentForm.value = {
    courier_number: selected.courier_number || '',
    recipient_name: selected.recipient_name || '',
    // 回显语义（task-43 后读接口返回掩码 138****5678）：掩码绝不回填到输入框——
    // 回填会让"未修改直接保存"把掩码当成新号码写回后端。输入保持为空由操作员
    // 重新输入完整手机号，已保存的掩码只在表单下方作为提示展示（允许覆盖重填）。
    recipient_phone: '',
    recipient_address: selected.recipient_address || '',
    mailed_at: selected.mailed_at ? String(selected.mailed_at).slice(0, 10) : '',
  }
  signingConfirmationForm.value = {
    seal_verified: Boolean(selected.seal_verified),
    signature_verified: Boolean(selected.signature_verified),
    signed_at: selected.signed_at ? String(selected.signed_at).slice(0, 10) : '',
  }
}

async function openSigningRecord(record) {
  // 打开 A 后再打开 B，A 的慢响应不得覆盖 B，也不得改变后续寄送/签收/核验目标。
  // 列表记录已归一化，详情接口返回原始记录；入口只归一化一次，二次归一化会把
  // 合同编号写进 recordId，导致详情按编号 404、弹窗永久停在加载态。
  const opened = isNormalizedSigningRecord(record) ? record : normalizeSigningRecord(record)
  const contractID = opened.contract.recordId
  if (!contractID) {
    showToast('签署记录缺少合同标识，请刷新签署台账后重试')
    return
  }
  const sequence = ++signingDetailSequence
  // 是否仍是本次打开只由请求序号决定：选中记录在详情回填后可能换对象，
  // 用 recordId 参与判断会让“归一化前后标识不同”变成永久加载。
  const isCurrent = () => sequence === signingDetailSequence
  signingDetailLoading.value = true
  signingReplacementReason.value = ''
  applySigningRecord(opened)
  signingOpenedDocument.value = { version: Number(opened.document_version) || 0, sha256: String(opened.document_sha256 || '') }
  try {
    const detail = await getSigningRecord(contractID)
    if (!isCurrent()) return
    if (!detail || typeof detail !== 'object' || !detail.contract) {
      showToast('签署详情返回格式异常，请关闭后重试')
      return
    }
    // 详情必须对应本次打开的合同；不一致时保留列表数据并明确提示，绝不把另一份
    // 合同写进当前弹窗。
    if (String(detail.contract.id || '') !== String(contractID)) {
      showToast('签署详情与当前合同不一致，请关闭后重新打开')
      return
    }
    applySigningRecord(detail)
    if (!signingOpenedDocument.value.version) signingOpenedDocument.value = { version: Number(detail.document_version) || 0, sha256: String(detail.document_sha256 || '') }
  } catch (error) {
    if (isCurrent()) showToast(formatUserError(error, { fallback: '读取签署详情失败' }))
  } finally {
    if (isCurrent()) signingDetailLoading.value = false
  }
}

function closeSigningRecord() {
  // 使在途详情请求失效，关闭后旧响应不得重新打开弹窗。
  signingDetailSequence += 1
  selectedSigningRecord.value = null
  signingDetailLoading.value = false
  signingReplacementReason.value = ''
}

async function refreshSelectedSigningRecord() {
  const contractID = selectedSigningRecord.value?.contract.recordId
  if (!contractID) return
  const sequence = signingDetailSequence
  const detail = await getSigningRecord(contractID)
  if (sequence !== signingDetailSequence || selectedSigningRecord.value?.contract.recordId !== contractID) return
  // 详情必须与当前合同一致，不能把另一份合同写进已打开的弹窗。
  if (String(detail?.contract?.id || '') !== String(contractID)) return
  applySigningRecord(detail)
  await refreshSigningRecords()
}

async function submitSigningShipment() {
  const contractID = selectedSigningRecord.value?.contract.recordId
  if (!contractID) return
  // C-ii（task-62）：提交前先本地校验收件人手机号（非空、≤20 rune、数字格式），
  // 让后端必填校验的失败在表单旁即时反馈，而不是落到 422 的通用文案。
  const phoneError = validateRecipientPhoneNumber(signingShipmentForm.value.recipient_phone)
  if (phoneError) {
    showToast(phoneError)
    return
  }
  signingOperationBusy.value = true
  try {
    await saveSigningShipment(contractID, signingShipmentForm.value)
    if (selectedSigningRecord.value?.contract.recordId === contractID) closeSigningRecord()
    showToast('寄出信息已登记，合同进入回传跟踪')
    try {
      await refreshSigningRecords()
    } catch {
      showToast('寄出信息已登记，但签署列表刷新失败，请手动刷新')
    }
  } catch (error) {
    showToast(formatUserError(error, { fallback: '保存寄出信息失败' }))
  } finally {
    signingOperationBusy.value = false
  }
}

async function confirmCustomerReceived() {
  const contractID = selectedSigningRecord.value?.contract.recordId
  if (!contractID) return
  signingOperationBusy.value = true
  try {
    await markSigningReceived(contractID)
    if (selectedSigningRecord.value?.contract.recordId === contractID) closeSigningRecord()
    showToast('已记录客户签收')
    try {
      await refreshSigningRecords()
    } catch {
      showToast('客户签收已确认，但签署列表刷新失败，请手动刷新')
    }
  } catch (error) {
    showToast(formatUserError(error, { fallback: '记录客户签收失败' }))
  } finally {
    signingOperationBusy.value = false
  }
}

async function sendSigningReminder() {
  const contractID = selectedSigningRecord.value?.contract.recordId
  if (!contractID) return
  signingOperationBusy.value = true
  try {
    await recordSigningReminder(contractID)
    await refreshSelectedSigningRecord()
    showToast('催办记录已保存')
  } catch (error) {
    showToast(formatUserError(error, { fallback: '保存催办记录失败' }))
  } finally {
    signingOperationBusy.value = false
  }
}

async function confirmSigningRecord() {
  const record = selectedSigningRecord.value
  const contractID = record?.contract.recordId
  if (!contractID) return
  // 确认必须绑定当前打开并核验的文件版本；版本在等待期间被替换时服务端返回 409。
  if (!record.document_version || !record.document_sha256) {
    showToast('请先重新打开当前回传文件，确认文件版本后再提交核验。')
    return
  }
  if (Number(record.document_version) !== Number(signingOpenedDocument.value.version) || String(record.document_sha256 || '') !== signingOpenedDocument.value.sha256) {
    showToast('回传文件版本已变化，请重新打开并核验当前文件后再提交。')
    return
  }
  signingOperationBusy.value = true
  try {
    await confirmSigning(contractID, {
      ...signingConfirmationForm.value,
      document_version: record.document_version,
      content_sha256: record.document_sha256,
    })
    if (selectedSigningRecord.value?.contract.recordId === contractID) closeSigningRecord()
    showToast('回传合同已核验，签署流程完成')
    try {
      await refreshSigningRecords()
    } catch {
      showToast('合同核验已完成，但签署列表刷新失败，请手动刷新')
    }
  } catch (error) {
    showToast(formatUserError(error, { fallback: '完成核验失败' }))
  } finally {
    signingOperationBusy.value = false
  }
}

async function uploadStampedContract(contract, event, { replacement = false } = {}) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (replacement && !signingReplacementReason.value.trim()) {
    showToast('正式更换盖章文件必须填写原因。')
    return
  }
  if (replacement && Number(selectedSigningRecord.value?.document_version) !== Number(signingOpenedDocument.value.version)) {
    showToast('回传文件版本已变化，请重新打开当前文件后再更换。')
    return
  }
  stampedUploadBusyID.value = contract.recordId
  try {
    await uploadStampedContractPDF(contract.recordId, file, {
      expectedVersion: selectedSigningRecord.value?.contract.recordId === contract.recordId
        ? selectedSigningRecord.value?.document_version || 0
        : 0,
      replacementReason: replacement ? signingReplacementReason.value.trim() : '',
    })
    if (replacement) signingReplacementReason.value = ''
    if (selectedSigningRecord.value?.contract.recordId === contract.recordId) await refreshSelectedSigningRecord()
    else await refreshSigningRecords()
    showToast(replacement ? '新版本盖章文件已上传，需重新核验签署' : '回传合同 PDF 已上传，等待人工核验')
  } catch (error) {
    showToast(formatUserError(error, { fallback: '上传盖章合同失败' }))
  } finally {
    stampedUploadBusyID.value = ''
  }
}

function normalizeApproval(item) {
  return {
    id: item.approval_id,
    contractId: item.contract_id,
    step: item.node_name || item.node_id || (Number.isInteger(item.current_node_index) ? `第 ${item.current_node_index + 1} 节点` : '—'),
    type: approvalKindLabel(item.kind),
    status: item.status || '—',
    submittedAt: formatDate(item.created_at),
  }
}

function setInitiatedApprovals(items) {
  const normalized = items.map(normalizeApproval)
  const materializedIDs = new Set(normalized.map((item) => item.id))
  const initializing = initiatedApprovals.value.filter((item) => item.initializing && !materializedIDs.has(item.id))
  initiatedApprovals.value = [...initializing, ...normalized]
}

function initializingApproval(started, contractItem) {
  return {
    id: started.approval_id,
    contractId: contractItem.recordId,
    step: '流程初始化中',
    type: '合同审批',
    status: 'pending',
    submittedAt: '刚刚',
    initializing: true,
  }
}

async function waitForInitiatedApproval(approvalID) {
  const delays = [0, 200, 400, 800, 1200]
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
    try {
      const items = await listApprovals({ limit: 200 })
      setInitiatedApprovals(items)
      if (items.some((item) => item.approval_id === approvalID)) return true
    } catch {
      // 提交已被工作流受理，查询失败时保留初始化占位，避免用户误以为未提交。
    }
  }
  return false
}

function approvalCommandIsDurable(detail, commandID, action) {
  if (!detail?.actions?.some((item) => item.command_id === commandID)) return false
  if (action === 'approve' && detail.state?.status === 'approved') return detail.contract?.status === 'active'
  if (['reject', 'withdraw'].includes(action)) return detail.contract?.status === 'draft'
  return true
}

async function waitForApprovalCommand(commandID, action, approvalID) {
  const delays = [0, 150, 300, 500, 800, 1200, 1800]
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
    try {
      const detail = await getApproval(approvalID)
      if (selectedApproval.value?.id === approvalID) approvalDetail.value = detail
      if (approvalCommandIsDurable(detail, commandID, action)) return true
    } catch {
      // Temporal 已受理命令时继续等待数据库活动提交，最终以服务端快照为准。
    }
  }
  return false
}

async function refreshApprovalRealtime() {
  if (approvalRealtimeBusy || !session.value || activeSection.value !== 'approvals' || document.visibilityState !== 'visible') return
  approvalRealtimeBusy = true
  try {
    const initiatedRequest = listApprovals({ limit: 200 })
    const taskRequest = can('approval.process') ? listApprovalTasks({ limit: 200 }) : Promise.resolve([])
    const detailRequest = selectedApproval.value && !selectedApproval.value.initializing && !approvalCommandBusy.value
      ? getApproval(selectedApproval.value.id)
      : Promise.resolve(null)
    const [initiatedResult, taskResult, detailResult] = await Promise.allSettled([initiatedRequest, taskRequest, detailRequest])
    if (initiatedResult.status === 'fulfilled') setInitiatedApprovals(initiatedResult.value)
    if (taskResult.status === 'fulfilled') {
      approvals.value = taskResult.value.map(normalizeApproval)
      if (selectedApproval.value && can('approval.process')) {
        const currentTask = approvals.value.find((item) => item.id === selectedApproval.value.id)
        if (currentTask) selectedApproval.value = { ...selectedApproval.value, ...currentTask }
        else if (['active', 'pending'].includes(selectedApproval.value.status)) selectedApproval.value = { ...selectedApproval.value, status: 'pending' }
      }
    }
    if (detailResult.status === 'fulfilled' && detailResult.value && selectedApproval.value?.id === detailResult.value.meta?.id) {
      approvalDetail.value = detailResult.value
      if (Number.isInteger(detailResult.value.state?.current_node_index)) {
        selectedApproval.value = { ...selectedApproval.value, step: `第 ${detailResult.value.state.current_node_index + 1} 节点` }
      }
    }
  } finally {
    approvalRealtimeBusy = false
  }
}

function stopApprovalRealtime() {
  window.clearTimeout(approvalRealtimeTimer)
  approvalRealtimeTimer = 0
}

function scheduleApprovalRealtime({ immediate = false } = {}) {
  stopApprovalRealtime()
  if (!session.value || activeSection.value !== 'approvals' || document.visibilityState !== 'visible') return
  approvalRealtimeTimer = window.setTimeout(async () => {
    await refreshApprovalRealtime()
    scheduleApprovalRealtime()
  }, immediate ? 0 : 1000)
}

function handleApprovalVisibilityChange() {
  scheduleApprovalRealtime({ immediate: document.visibilityState === 'visible' })
  scheduleSigningRealtime({ immediate: document.visibilityState === 'visible' })
}

async function refreshSigningRealtime() {
  if (signingRealtimeBusy || !session.value || activeSection.value !== 'signing' || document.visibilityState !== 'visible') return
  signingRealtimeBusy = true
  try {
    const detailContractID = selectedSigningRecord.value?.contract.recordId || ''
    const detailSequence = signingDetailSequence
    // 实时刷新保持当前已加载条数，避免把用户“加载更多”的结果重置回第一页。
    const listRequest = refreshSigningRecords({ limit: Math.max(50, signingRecords.value.length) })
    const detailRequest = detailContractID && !signingOperationBusy.value
      ? getSigningRecord(detailContractID)
      : Promise.resolve(null)
    const [listResult, detailResult] = await Promise.allSettled([listRequest, detailRequest])
    if (listResult.status === 'rejected') showToast(formatUserError(listResult.reason, { fallback: '刷新签署台账失败' }))
    if (detailResult.status === 'fulfilled' && detailResult.value && detailSequence === signingDetailSequence &&
      selectedSigningRecord.value?.contract.recordId === detailContractID && detailResult.value.contract?.id === detailContractID) {
      applySigningRecord(detailResult.value, { preserveForms: true })
    }
  } finally {
    signingRealtimeBusy = false
  }
}

function stopSigningRealtime() {
  window.clearTimeout(signingRealtimeTimer)
  signingRealtimeTimer = 0
}

function scheduleSigningRealtime({ immediate = false } = {}) {
  stopSigningRealtime()
  if (!session.value || activeSection.value !== 'signing' || document.visibilityState !== 'visible') return
  signingRealtimeTimer = window.setTimeout(async () => {
    await refreshSigningRealtime()
    scheduleSigningRealtime()
  }, immediate ? 0 : 1000)
}

function displayNameFor(userId, displayName) {
  if (userId && userId === session.value?.user_id) return currentUserLabel.value
  const directoryEntry = userDirectory.value.find((item) => item.user_id === userId)
  if (directoryEntry?.display_name) return directoryEntry.display_name
  if (displayName) return displayName
  return '未知用户'
}

function conditionField(field) {
  return ruleFieldOptions.find((item) => item.value === field) || ruleFieldOptions[0]
}

function conditionOperators(field) {
  const kind = conditionField(field).kind
  if (kind === 'number') return numericOperators
  if (kind === 'boolean') return textOperators.slice(0, 2)
  return textOperators
}

function conditionLabel(condition) {
  const field = conditionField(condition.field)
  const operator = conditionOperators(condition.field).find((item) => item.value === condition.operator)?.label || condition.operator
  let value = condition.value
  if (condition.field === 'amount_minor') value = `${Number(value || 0) / 100} 元`
  if (condition.field === 'terms_identical') value = value ? '是' : '否'
  if (Array.isArray(value)) value = value.join('、')
  return `${field.label} ${operator} ${value}`
}

function ruleConditionSummary(rule) {
  return ruleExpressionSummary(rule.expression, conditionLabel)
}

async function loadBusinessData() {
  // 各区域按权限独立加载并用 allSettled 汇总，单个非关键接口失败不会清空已经
  // 成功的数据。权限仍由后端逐接口执行，这里的条件只避免发起无意义请求。
  businessDataLoading.value = true
  businessDataErrors.value = {}
  const requests = []
  const addRequest = (label, sections, promise) => {
    requests.push({ label, sections, promise })
  }
  if (can('approval.view') || can('approval.process') || can('contract.create')) {
    addRequest('我发起的审批', ['dashboard', 'approvals'], listApprovals({ limit: 200 }).then(setInitiatedApprovals))
  }
  if (can('contract.read')) {
    addRequest('合同统计', ['dashboard', 'reports'], getContractDashboard().then((summary) => { adminDashboard.value = summary }))
  } else {
    adminDashboard.value = null
  }
  if (can('contract.read')) {
    addRequest('合同台账', ['dashboard', 'contracts', 'signing', 'reports'], listContracts({ limit: 200, keyword: keyword.value.trim() }).then((items) => { contracts.value = items.map(normalizeContract) }))
  }
  if (can('contract.approved.read')) {
    addRequest('签署台账', ['signing'], refreshSigningRecords())
  }
  if (can('approval.process')) {
    addRequest('审批待办', ['dashboard', 'approvals'], listApprovalTasks({ limit: 200 }).then((items) => { approvals.value = items.map(normalizeApproval) }))
  }
  if (can('approval.view') || can('approval_rule.manage')) {
    addRequest('审批规则', ['rules'], listApprovalRules().then((items) => { rules.value = items }))
  }
  if (can('contract.create') || isAdmin.value) {
    addRequest('合同模板', ['templates', 'contracts'], listContractTemplates().then((items) => { contractTemplates.value = items }))
  }
  if (can('opportunity_intake.read')) {
    addRequest('签单关联核对', ['intakes'], loadOpportunityIntakes())
  }
  const results = await Promise.allSettled(requests.map((request) => request.promise))
  const failures = results.filter((result) => result.status === 'rejected')
  // API 客户端已在第一次 401 时发起单次 OIDC 跳转。页面不再把多个并发 401
  // 拼成重复的“登录状态无效”提示，避免跳转前出现误导性错误横幅。
  if (failures.some((result) => result.reason instanceof ContractAuthError || result.reason?.status === 401)) {
    businessDataLoading.value = false
    return
  }
  const nextErrors = {}
  results.forEach((result, index) => {
    if (result.status !== 'rejected') return
    const request = requests[index]
    for (const section of request.sections) {
      const message = `${request.label}加载失败，请刷新重试。`
      nextErrors[section] = nextErrors[section] ? `${nextErrors[section]}；${message}` : message
    }
  })
  businessDataErrors.value = nextErrors
  businessDataLoading.value = false
}

async function loadOpportunityIntakes({ append = false } = {}) {
  if (append && (!opportunityIntakeHasMore.value || !opportunityIntakeNextCursor.value)) return
  // 筛选切换和“加载更多”可能交错返回；只有最新序号可提交游标和列表，防止
  // 旧筛选结果污染当前队列或把游标倒退。
  const sequence = ++opportunityIntakeLoadSequence
  if (append) opportunityIntakeLoadingMore.value = true
  else {
    opportunityIntakeLoading.value = true
    opportunityIntakeLoadingMore.value = false
  }
  opportunityIntakeError.value = ''
  try {
    const params = { page_size: 50 }
    if (opportunityIntakeFilter.value) params.status = opportunityIntakeFilter.value
    if (append && opportunityIntakeNextCursor.value) params.cursor = opportunityIntakeNextCursor.value
    const page = await listOpportunityIntakes(params)
    if (sequence === opportunityIntakeLoadSequence) {
      opportunityIntakes.value = append ? [...opportunityIntakes.value, ...page.items] : page.items
      opportunityIntakeNextCursor.value = page.next_cursor
      opportunityIntakeHasMore.value = page.has_more
    }
  } catch (error) {
    if (sequence === opportunityIntakeLoadSequence) opportunityIntakeError.value = formatUserError(error, { fallback: '读取签单关联核对队列失败' })
  } finally {
    if (sequence === opportunityIntakeLoadSequence) {
      opportunityIntakeLoading.value = false
      opportunityIntakeLoadingMore.value = false
    }
  }
}

function changeOpportunityIntakeFilter() {
  opportunityIntakeLoadSequence += 1
  opportunityIntakes.value = []
  opportunityIntakeNextCursor.value = ''
  opportunityIntakeHasMore.value = false
  loadOpportunityIntakes()
}

async function openOpportunityIntake(item) {
  // 用户快速切换核对项时，详情请求不能互相覆盖；序号和 intake_id 必须同时匹配。
  const sequence = ++opportunityIntakeDetailSequence
  selectedOpportunityIntake.value = item
  opportunityIntakeDetailLoading.value = true
  opportunityIntakeConflictNotice.value = ''
  opportunityIntakeReviewAttempt.value = null
  opportunityIntakeReviewBlocked.value = false
  opportunityIntakeDecision.value = 'LINK_CONFIRMED'
  opportunityIntakeReason.value = ''
  try {
    const detail = await getOpportunityIntake(item.intake_id)
    if (sequence === opportunityIntakeDetailSequence && selectedOpportunityIntake.value?.intake_id === item.intake_id) {
      selectedOpportunityIntake.value = detail
    }
  } catch (error) {
    if (sequence === opportunityIntakeDetailSequence) showToast(formatUserError(error, { fallback: '读取签单关联详情失败' }))
  } finally {
    if (sequence === opportunityIntakeDetailSequence) opportunityIntakeDetailLoading.value = false
  }
}

function closeOpportunityIntake() {
  if (opportunityIntakeReviewBusy.value) return
  opportunityIntakeDetailSequence += 1
  selectedOpportunityIntake.value = null
  opportunityIntakeReason.value = ''
  opportunityIntakeReviewAttempt.value = null
  opportunityIntakeConflictNotice.value = ''
  opportunityIntakeReviewBlocked.value = false
}

async function refreshSelectedOpportunityIntake() {
  const intakeId = selectedOpportunityIntake.value?.intake_id
  if (!intakeId) return
  selectedOpportunityIntake.value = await getOpportunityIntake(intakeId)
}

async function submitOpportunityIntakeReview() {
  const item = selectedOpportunityIntake.value
  const reason = opportunityIntakeReason.value.trim()
  if (!item || item.status !== 'ACCEPTED' || !can('opportunity_intake.process')) return
  if (!reason) {
    showToast('请填写可审计的核对说明。')
    return
  }
  const command = {
    intakeId: item.intake_id,
    decision: opportunityIntakeDecision.value,
    reason,
    version: item.version,
  }
  try {
    opportunityIntakeReviewAttempt.value = ensureStableReviewAttempt(opportunityIntakeReviewAttempt.value, command)
  } catch (error) {
    showToast(formatUserError(error, { fallback: '无法生成安全的幂等键' }))
    return
  }
  opportunityIntakeReviewBusy.value = true
  opportunityIntakeConflictNotice.value = ''
  let completed = false
  try {
    const reviewed = await reviewOpportunityIntake(item.intake_id, {
      decision: command.decision,
      reason: command.reason,
      version: command.version,
    }, opportunityIntakeReviewAttempt.value.key)
    selectedOpportunityIntake.value = reviewed
    const visibleAfterReview = !opportunityIntakeFilter.value || opportunityIntakeFilter.value === reviewed.status
    opportunityIntakes.value = visibleAfterReview
      ? opportunityIntakes.value.map((entry) => entry.intake_id === reviewed.intake_id ? reviewed : entry)
      : opportunityIntakes.value.filter((entry) => entry.intake_id !== reviewed.intake_id)
    opportunityIntakeReviewAttempt.value = null
    completed = true
    showToast(opportunityIntakeStatus(reviewed.status).label)
  } catch (error) {
    // 409 是服务端已经明确拒绝的命令，可以刷新版本并在下一次提交时创建新键。
    // 网络或 5xx 的结果可能不确定，保留本页面 attempt，重试仍使用原键。
    if (isOpportunityIntakeIdempotencyConflict(error)) {
      opportunityIntakeReviewAttempt.value = null
      opportunityIntakeReviewBlocked.value = true
      opportunityIntakeConflictNotice.value = '本页面的幂等键与其他处理命令冲突，已停止提交。请关闭详情后重新打开并再次核对。'
    } else if (isOpportunityIntakeVersionConflict(error)) {
      opportunityIntakeReviewAttempt.value = null
      try {
        await refreshSelectedOpportunityIntake()
        opportunityIntakeConflictNotice.value = error.code === 'CON_VERSION_CONFLICT'
          ? '数据版本已变化，本次核对未提交。已刷新最新状态，请重新确认。'
          : '该记录已被其他操作处理。已刷新最新状态，不能重复核对。'
      } catch (refreshError) {
        opportunityIntakeConflictNotice.value = formatUserError(refreshError, { fallback: '数据已变化，但刷新最新状态失败。请关闭后重新打开。' })
      }
    } else if (!error?.status || error.status >= 500) {
      showToast(`${formatUserError(error, { fallback: '核对提交失败' })}；可直接重试，页面将复用同一幂等键。`)
    } else {
      showToast(formatUserError(error, { fallback: '核对提交被拒绝，请核对权限和输入。' }))
    }
  } finally {
    opportunityIntakeReviewBusy.value = false
    if (completed) closeOpportunityIntake()
  }
}

function selectTemplateFile(event) {
  templateUploadForm.value.file = event.target.files?.[0] || null
  templateUploadError.value = ''
}

function openTemplateUpload() {
  if (!isAdmin.value) {
    showToast('只有超级管理员可以上传合同模板。')
    return
  }
  templateUploadForm.value = { name: '', file: null }
  templateReplacementID.value = ''
  templateUploadError.value = ''
  templateUploadDialogOpen.value = true
}

function openTemplateReplacement(item) {
  if (!isAdmin.value) {
    showToast('只有超级管理员可以替换合同模板。')
    return
  }
  if (!window.confirm(`替换“${item.name}”的 DOCX 模板文件？同名字段配置会保留，新字段需要重新核对；已生成合同的固化正文不变。`)) return
  templateReplacementID.value = item.id
  templateUploadForm.value = { name: item.name, file: null }
  templateUploadError.value = ''
  templateUploadDialogOpen.value = true
}

async function submitTemplateUpload() {
  if (!isAdmin.value) {
    showToast('只有超级管理员可以上传合同模板。')
    return
  }
  if (!templateUploadForm.value.file) {
    showToast('请选择 DOCX 模板文件。')
    return
  }
  const file = templateUploadForm.value.file
  if (!isContractDOCXFile(file) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    templateUploadError.value = '请选择不超过 10MB 的有效 DOCX 模板文件。'
    return
  }
  templateUploadError.value = ''
  templateUploading.value = true
  try {
    // accept 仅改善文件选择体验；DOCX 类型、大小、压缩包结构和占位符仍必须由后端
    // 按不可信文件重新校验，页面只在服务端确认后刷新模板目录。
    if (templateReplacementID.value) {
      await replaceContractTemplateSource(templateReplacementID.value, file)
    } else await uploadContractTemplate({
      name: templateUploadForm.value.name.trim(),
      file: templateUploadForm.value.file,
    })
    templateUploadDialogOpen.value = false
    try {
      contractTemplates.value = await listContractTemplates()
      if (newContract.value.template_id === templateReplacementID.value) selectContractTemplate()
    } catch (error) {
      showToast(`合同模板文件已保存，但模板列表未刷新。${formatUserError(error, { fallback: '请刷新模板列表核对结果，勿重复上传。' })}`)
      return
    }
    showToast(templateReplacementID.value ? '合同模板文件替换成功，请核对新增字段配置' : '合同模板上传成功')
  } catch (error) {
    templateUploadError.value = formatUserError(error, { fallback: '上传合同模板失败' })
    showToast(templateUploadError.value)
  } finally {
    templateUploading.value = false
  }
}

function editTemplate(item) {
  templateEditForm.value = {
    id: item.id,
    name: item.name,
    number_format: item.number_format || 'HT-{YYYYMMDD}-{ID8}',
    fields: (item.fields || []).map((field) => ({
      name: field.name,
      label: field.label,
      default: field.default || '',
      locked: Boolean(field.locked),
    })),
  }
  templateEditDialogOpen.value = true
}

async function saveTemplate() {
  templateSaving.value = true
  try {
    await updateContractTemplate(templateEditForm.value.id, {
      name: templateEditForm.value.name.trim(),
      number_format: templateEditForm.value.number_format.trim(),
      fields: templateEditForm.value.fields.map((field) => ({
        name: field.name,
        label: field.label.trim(),
        default: field.default.trim(),
        locked: Boolean(field.locked),
      })),
    })
    templateEditDialogOpen.value = false
    try { contractTemplates.value = await listContractTemplates() }
    catch (error) {
      showToast(`合同模板已更新，但模板列表未刷新。${formatUserError(error, { fallback: '请刷新列表核对结果，勿重复保存。' })}`)
      return
    }
    showToast('合同模板已更新')
  } catch (error) {
    showToast(formatUserError(error, { fallback: '更新合同模板失败' }))
  } finally {
    templateSaving.value = false
  }
}

async function removeTemplate(item) {
  if (!window.confirm(`确定删除合同模板“${item.name}”吗？已生成的合同不受影响。`)) return
  try {
    await deleteContractTemplate(item.id)
    contractTemplates.value = contractTemplates.value.filter((template) => template.id !== item.id)
    if (newContract.value.template_id === item.id) {
      newContract.value.template_id = ''
      selectContractTemplate()
    }
    showToast('合同模板已删除')
    try { contractTemplates.value = await listContractTemplates() }
    catch (error) { showToast(`合同模板已删除，但模板列表未刷新。${formatUserError(error, { fallback: '请刷新列表核对结果。' })}`) }
  } catch (error) {
    showToast(formatUserError(error, { fallback: '删除合同模板失败' }))
  }
}

function openNewContract() {
  termsIdentical.value = false
  editingContract.value = null
  draftEditError.value = ''
  draftEditConflict.value = false
  newContract.value = emptyNewContract()
  contractCreationMode.value = 'template'
  externalContractFile.value = null
  externalContractFileError.value = ''
  externalContractFileInputKey.value += 1
  templatePreviewHTML.value = ''
  templatePreviewError.value = ''
  createDialogOpen.value = true
}

async function editContractDraft(contract) {
  if (draftEditLoading.value || contractCreating.value) return
  draftEditLoading.value = true
  try {
    const raw = await getContract(contract.recordId || contract.id)
    const form = hydrateContractDraft(raw)
    editingContract.value = raw
    newContract.value = form
    draftEditError.value = ''
    draftEditConflict.value = false
    contractCreationMode.value = raw.template_id ? 'template' : 'external'
    externalContractFile.value = null
    externalContractFileError.value = ''
    templatePreviewHTML.value = ''
    templatePreviewError.value = ''
    closeContract()
    createDialogOpen.value = true
    if (!raw.template_id) void loadDetectionCategoryOptions()
    else if (!selectedContractTemplate.value) draftEditError.value = '原合同模板已不可用，不能重新生成正文，请联系管理员恢复原模板。'
  } catch (error) {
    showToast(formatUserError(error, { fallback: '读取草稿失败' }))
  } finally {
    draftEditLoading.value = false
  }
}

function closeDraftEditor() {
  if (contractCreating.value) return
  createDialogOpen.value = false
  editingContract.value = null
  draftEditError.value = ''
  draftEditConflict.value = false
}

function selectContractCreationMode(mode) {
  if (editingContract.value) return
  detectionCategoryRequestID += 1
  contractCreationMode.value = mode
  templatePreviewHTML.value = ''
  templatePreviewError.value = ''
  if (mode === 'template') {
    externalContractFile.value = null
    externalContractFileError.value = ''
    externalContractFileInputKey.value += 1
    return
  }
  newContract.value.template_id = ''
  newContract.value.template_values = {}
  for (const serviceItem of newContract.value.service_items) {
    if (!serviceItem.batch.trim()) serviceItem.batch = '第一批次'
  }
  void loadDetectionCategoryOptions()
}

async function loadDetectionCategoryOptions() {
  const requestID = ++detectionCategoryRequestID
  detectionCategoryLoading.value = true
  detectionCategoryError.value = ''
  try {
    const options = await listContractDetectionCategories()
    if (requestID !== detectionCategoryRequestID) return
    detectionCategoryOptions.value = options
    if (!options.length) detectionCategoryError.value = '项目管理尚未配置可用的检测类别。'
  } catch (error) {
    if (requestID !== detectionCategoryRequestID) return
    detectionCategoryOptions.value = []
    detectionCategoryError.value = formatUserError(error, { fallback: '读取检测类别目录失败，请稍后重试。' })
  } finally {
    if (requestID === detectionCategoryRequestID) detectionCategoryLoading.value = false
  }
}

async function loadCustomerOptions({ reset = true } = {}) {
  if (customerLoading.value) return
  const page = reset ? 1 : customerPage.value + 1
  customerPickerOpen.value = true
  customerError.value = ''
  customerLoading.value = true
  try {
    await checkCRMDirectorySession()
    const result = await listMyCustomers({ keyword: customerKeyword.value, page, page_size: 50 })
    customerPage.value = result.page
    customerTotal.value = result.total
    customerHasMore.value = result.has_more
    customerOptions.value = reset ? result.items : [...customerOptions.value, ...result.items]
  } catch (error) {
    recordCRMDirectoryError(error)
    customerError.value = formatUserError(error, { fallback: '读取可关联客户失败，请稍后重试。' })
  } finally {
    customerLoading.value = false
  }
}

async function openCustomerPicker() {
  customerKeyword.value = ''
  customerOptions.value = []
  await loadCustomerOptions()
}

async function searchCustomerOptions() {
  customerOptions.value = []
  await loadCustomerOptions()
}

async function loadMoreCustomerOptions() {
  if (!customerHasMore.value || customerLoading.value) return
  await loadCustomerOptions({ reset: false })
}

function selectCustomer(item) {
  const customerID = String(item.id || item.customer_id || '')
  if (newContract.value.opportunity_id && String(newContract.value.customer_id) !== customerID) {
    newContract.value.opportunity_id = ''
    newContract.value.opportunity_name = ''
  }
  newContract.value.customer_id = customerID
  newContract.value.customer_name = item.name || item.customer_name || ''
  customerPickerOpen.value = false
}

function clearCustomer() {
  newContract.value.customer_id = ''
  newContract.value.customer_name = ''
  newContract.value.opportunity_id = ''
  newContract.value.opportunity_name = ''
}

function selectExternalContractFile(event) {
  const file = event.target.files?.[0] || null
  externalContractFile.value = null
  externalContractFileError.value = ''
  if (!file) return
  if (!isContractDOCXFile(file)) {
    externalContractFileError.value = '仅支持有效的 DOCX 文件。'
    event.target.value = ''
    return
  }
  if (file.size <= 0) {
    externalContractFileError.value = 'DOCX 文件不能为空。'
    event.target.value = ''
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    externalContractFileError.value = 'DOCX 文件不能超过 10MB。'
    event.target.value = ''
    return
  }
  externalContractFile.value = file
}

async function loadOpportunityOptions({ reset = true } = {}) {
  if (opportunityLoading.value) return
  const page = reset ? 1 : opportunityPage.value + 1
  opportunityError.value = ''
  opportunityLoading.value = true
  try {
    await checkCRMDirectorySession()
    const result = await listMyOpportunities({ keyword: opportunityKeyword.value, page, page_size: 50 })
    opportunityPage.value = result.page
    opportunityTotal.value = result.total
    opportunityHasMore.value = result.has_more
    const matchingItems = !isExternalContractMode.value || !newContract.value.customer_id
      ? result.items
      : result.items.filter((item) => String(item.customer_id || item.customer?.id || '') === String(newContract.value.customer_id))
    opportunityOptions.value = reset ? matchingItems : [...opportunityOptions.value, ...matchingItems]
  } catch (error) {
    recordCRMDirectoryError(error)
    opportunityError.value = formatUserError(error, { fallback: '读取可关联商机失败，请稍后重试。' })
  } finally {
    opportunityLoading.value = false
  }
}

// 表单展开时自动加载可关联商机，用户直接在下拉框里选择，无需先打开弹层再搜索。
async function selectOpportunityById(event) {
  const id = String(event?.target?.value || '')
  if (!id) {
    clearOpportunity()
    return
  }
  const item = opportunityOptions.value.find((option) => String(option.id || option.opportunity_id || '') === id)
  if (item) selectOpportunity(item)
}

watch([selectedContractTemplate, isExternalContractMode], async ([template, external]) => {
  if ((!template && !external) || opportunityOptions.value.length) return
  opportunityKeyword.value = external ? newContract.value.customer_name : ''
  await loadOpportunityOptions()
})

watch(() => newContract.value.customer_id, async () => {
  if (!isExternalContractMode.value) return
  opportunityKeyword.value = newContract.value.customer_name
  await loadOpportunityOptions()
})

function selectOpportunity(item) {
  newContract.value.opportunity_id = String(item.id || item.opportunity_id || '')
  newContract.value.opportunity_name = item.name || item.title || item.opportunity_name || '未命名商机'
  newContract.value.customer_id = String(item.customer_id || item.customer?.id || '')
  newContract.value.customer_name = item.customer_name || item.customer?.name || ''
  if (!newContract.value.amount && item.expected_amount) newContract.value.amount = item.expected_amount
}

function clearOpportunity() {
  newContract.value.opportunity_id = ''
  newContract.value.opportunity_name = ''
}

function addServiceItem() {
  if (!canAddServiceItem.value) return
  newContract.value.service_items.push(emptyServiceItem())
}

function removeServiceItem(index) {
  if (newContract.value.service_items.length === 1) {
    newContract.value.service_items[0] = emptyServiceItem()
    return
  }
  newContract.value.service_items.splice(index, 1)
}

function canAddSystemRow(serviceItem) {
  const last = serviceItem.systems.at(-1)
  return serviceItem.systems.length < 15 && (!last || Boolean(last.name.trim() && last.level))
}

function addSystemRow(serviceItem) {
  if (!canAddSystemRow(serviceItem)) return
  serviceItem.systems.push({ name: '', level: '' })
}

function removeSystemRow(serviceItem, index) {
  serviceItem.systems.splice(index, 1)
}

function selectContractTemplate() {
  newContract.value.template_values = buildTemplateValues(
    selectedContractTemplate.value?.fields,
    session.value,
  )
  templatePreviewHTML.value = ''
  templatePreviewError.value = ''
}

function syncManagedTemplateValues() {
  newContract.value.template_values = synchronizeContractTemplateValues(
    selectedContractTemplate.value?.fields, newContract.value.template_values, newContract.value.amount,
  )
}

watch(() => [newContract.value.amount, newContract.value.template_id], syncManagedTemplateValues)
watch(newContract, () => {
  // 表单变化立即让在途预览失效，旧响应不得回填到新表单。
  templatePreviewSequence += 1
  templatePreviewing.value = false
  templatePreviewHTML.value = ''
}, { deep: true })

async function previewNewContract() {
  if (!selectedContractTemplate.value) {
    templatePreviewError.value = '请先选择合同模板。'
    return
  }
  syncManagedTemplateValues()
  // 让由本次同步触发的深度 watch 先冲刷，否则它会立即让刚发起的预览失效。
  await nextTick()
  const missingField = (selectedContractTemplate.value.fields || []).find((field) => !isSystemContractNumberField(field) && !String(newContract.value.template_values[field.name] ?? '').trim() && !field.default)
  if (missingField) {
    templatePreviewError.value = `请先填写“${missingField.label}”。`
    return
  }
  const sequence = ++templatePreviewSequence
  const templateID = selectedContractTemplate.value.id
  const values = { ...newContract.value.template_values }
  templatePreviewError.value = ''
  templatePreviewHTML.value = ''
  templatePreviewing.value = true
  try {
    // 预览由后端使用同一套模板替换规则生成，避免浏览器自行拼接 DOCX 内容而与最终
    // 合同分叉；组件只渲染服务端返回的受控 HTML。
    const result = await previewContractTemplate(templateID, values)
    if (sequence !== templatePreviewSequence || selectedContractTemplate.value?.id !== templateID) return
    templatePreviewHTML.value = result?.html || ''
    if (!templatePreviewHTML.value) {
      templatePreviewError.value = '模板没有可预览的正文内容。'
      return
    }
    await nextTick()
    templatePreviewRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (error) {
    if (sequence !== templatePreviewSequence) return
    templatePreviewError.value = formatUserError(error, { fallback: '生成合同预览失败' })
    showToast(templatePreviewError.value)
  } finally {
    if (sequence === templatePreviewSequence) templatePreviewing.value = false
  }
}

function contractDateValue(value) {
  return value ? `${value}T00:00:00Z` : null
}

function buildNewContractPayload(form = newContract.value, { editing = Boolean(editingContract.value) } = {}) {
  validateContractForm(form, { external: isExternalContractMode.value })
  if (form.payment_terms.length && !form.customer_id) throw new Error('请为付款计划选择 CRM 客户。')
  return {
    opportunity_id: form.opportunity_id,
    opportunity_name: form.opportunity_name,
    crm_customer_id: Number(form.customer_id || 0),
    title: form.title.trim(),
    contract_type: form.contract_type,
    service_type: form.service_items[0]?.service_type || '',
    amount_minor: paymentAmountMinor(form.amount),
    currency: form.currency.trim().toUpperCase(),
    payment_terms: normalizePaymentTerms(form.payment_terms, form.amount, form.currency),
    customer_name: form.customer_name.trim(),
    customer_address: form.customer_address.trim(),
    customer_contact: form.customer_contact.trim(),
    customer_phone: form.customer_phone.trim(),
    start_date: contractDateValue(form.start_date),
    end_date: contractDateValue(form.end_date),
    service_items: form.service_items.map((serviceItem) => ({
      ...(editing && serviceItem.source_id ? { source_id: serviceItem.source_id } : {}),
      service_type: serviceItem.service_type,
      name: serviceItem.name.trim(),
      site: serviceItem.site.trim(),
      batch: serviceItem.batch.trim(),
      category: serviceItem.category.trim(),
      requirement: serviceItem.requirement.trim(),
      test_mode: serviceItem.test_mode,
      systems: serviceItem.systems.map((system) => ({ name: system.name.trim(), level: system.level })),
    })),
    content: '',
  }
}

function validateExternalContract(form = newContract.value, file = externalContractFile.value, { editing = Boolean(editingContract.value) } = {}) {
  if (!editing && !file) throw new Error(externalContractFileError.value || '请选择不超过 10MB 的 DOCX 文件。')
  if (!form.customer_id) throw new Error('请选择 CRM 客户。')
  if (detectionCategoryLoading.value) throw new Error('检测类别目录正在加载，请稍后再试。')
  if (detectionCategoryError.value) throw new Error(detectionCategoryError.value)
  const allowedCategories = new Set(detectionCategoryOptions.value.map((item) => String(item.category || '').trim()))
  const invalidIndex = form.service_items.findIndex((item) => !item.service_type || !item.site.trim() || !item.batch.trim() || !allowedCategories.has(item.category.trim()) || !item.test_mode)
  if (invalidIndex >= 0) throw new Error(`请补全服务项 ${invalidIndex + 1} 的服务类型、实施场所、实施批次、检测类别和检测方式。`)
  if (form.start_date && form.end_date && form.start_date > form.end_date) {
    throw new Error('合同开始日期不能晚于结束日期。')
  }
}

async function refreshSelectedCRMAccess(form = newContract.value) {
  await checkCRMDirectorySession()
  const customerID = String(form.customer_id || '')
  const customers = await listMyCustomers({ keyword: form.customer_name, page: 1, page_size: 100 })
  if (!customers.items.some((item) => String(item.id || item.customer_id || '') === customerID)) {
    throw new Error('所选 CRM 客户已失效或不在当前权限范围内，请重新选择。')
  }
  if (!form.opportunity_id) return
  const opportunityID = String(form.opportunity_id)
  const opportunities = await listMyOpportunities({ keyword: form.opportunity_name, page: 1, page_size: 100 })
  const selected = opportunities.items.find((item) => String(item.id || item.opportunity_id || '') === opportunityID)
  const selectedCustomerID = String(selected?.customer_id || selected?.customer?.id || '')
  if (!selected || selectedCustomerID !== customerID) {
    throw new Error('所选 CRM 商机已失效、不在当前权限范围内或不属于所选客户，请重新选择。')
  }
}

async function submitNewContract(event) {
  if (contractCreating.value || draftEditConflict.value) return
  contractCreating.value = true
  draftEditError.value = ''
  const wasEditing = Boolean(editingContract.value)
  let draftSaved = false
  try {
    syncManagedTemplateValues()
    // 保存前固定完整输入快照：后续 CRM 校验等待期间用户更换文件/模板/客户，
    // 也不得把新正文与新字段拼进旧请求，或反过来。
    const formSnapshot = JSON.parse(JSON.stringify(newContract.value))
    const templateSnapshot = selectedContractTemplate.value
    const fileSnapshot = externalContractFile.value
    const editingSnapshot = editingContract.value
    const externalSnapshot = isExternalContractMode.value
    const payload = buildNewContractPayload(formSnapshot, { editing: Boolean(editingSnapshot) })
    const shouldRefreshCRM = () => payload.payment_terms.length || payload.crm_customer_id && !payload.opportunity_id
    if (editingSnapshot) {
      if (externalSnapshot) {
        validateExternalContract(formSnapshot, fileSnapshot, { editing: true })
        await refreshSelectedCRMAccess(formSnapshot)
      } else {
        if (!templateSnapshot) throw new Error('请先选择可用合同模板。')
        if (shouldRefreshCRM()) await refreshSelectedCRMAccess(formSnapshot)
        payload.template_id = templateSnapshot.id
        payload.template_values = { ...formSnapshot.template_values }
      }
      const submit = event?.submitter?.dataset?.action === 'approval'
      const result = await saveContractDraft({
        contractId: editingSnapshot.id, version: editingSnapshot.version, payload,
        updateDraft: updateContractDraft, submit,
        submitApproval: (id, revision) => submitContract(id, { ...revision, terms_identical: termsIdentical.value }),
        onSaved: (saved) => {
          if (editingContract.value?.id === editingSnapshot.id) editingContract.value = saved
          draftSaved = true
        },
      })
      createDialogOpen.value = false
      editingContract.value = null
      if (result.approval) {
        const pendingApproval = initializingApproval(result.approval, normalizeContract(result.saved))
        initiatedApprovals.value = [pendingApproval, ...initiatedApprovals.value.filter((item) => item.id !== pendingApproval.id)]
        approvalTab.value = 'initiated'
        termsIdentical.value = false
        await waitForInitiatedApproval(result.approval.approval_id)
      }
      await loadBusinessData()
      showToast(submit ? '修改已保存，合同已发起审批' : '合同草稿修改已保存')
      return
    }
    if (externalSnapshot) {
      validateExternalContract(formSnapshot, fileSnapshot, { editing: false })
      // 提交前重新经过 CRM 浏览器鉴权，既给用户即时反馈，也刷新 CRM 的服务端授权快照；
      // 合同后端随后仍会使用机器接口再次校验，不能把此前端检查当作安全边界。
      await refreshSelectedCRMAccess(formSnapshot)
      await createExternalContract(fileSnapshot, payload)
    } else {
      if (!templateSnapshot) throw new Error('请先选择合同模板。')
      if (shouldRefreshCRM()) await refreshSelectedCRMAccess(formSnapshot)
      await createContract({
        ...payload,
        template_id: templateSnapshot.id,
        template_values: { ...formSnapshot.template_values },
      })
    }
    createDialogOpen.value = false
    newContract.value = emptyNewContract()
    externalContractFile.value = null
    externalContractFileError.value = ''
    externalContractFileInputKey.value += 1
    templatePreviewHTML.value = ''
    await loadBusinessData()
    // 合同创建只负责写入合同系统。CRM 的合同转交由商机签单流程通过
    // /opportunities/:id/contract-transfer 发起，不能在这里调用不存在的
    // /contract-drafts 回传接口，也不能把合同创建 ID 当作转交事件 ID。
    showToast(externalSnapshot ? '外部合同草稿已创建' : '合同草稿已创建')
  } catch (error) {
    if (error?.crmLoginRequired) recordCRMDirectoryError(error)
    if (editingContract.value) {
      draftEditConflict.value = (error?.status === 409 && error?.code !== 'CRM_IDENTITY_MISMATCH') || error?.requiresReload === true
      draftEditError.value = `${draftSaved ? '草稿修改已保存，但审批提交未完成。' : ''}${formatUserError(error, { fallback: '保存或提交失败' })}${draftEditConflict.value ? '。请重新载入最新草稿后再编辑，未自动覆盖当前修改。' : ''}`
    } else {
      draftEditError.value = formatUserError(error, { fallback: '创建合同失败，请检查表单后重试。' })
    }
    showToast(draftEditError.value || formatUserError(error, { fallback: wasEditing ? '编辑或提交失败，请检查最新合同状态' : '创建合同失败' }))
  } finally {
    contractCreating.value = false
  }
}

async function openApproval(approval) {
  const sequence = ++approvalDetailSequence
  const isCurrent = () => sequence === approvalDetailSequence && selectedApproval.value?.id === approval.id
  // 审批状态与格式化正文分别读取：正文预览失败只降级为原始合同内容，不会把审批
  // 详情误判为不可用，也不会改变服务端的待办状态。
  selectedApproval.value = approval
  approvalDetail.value = null
  approvalContractPreviewHTML.value = ''
  approvalContractPreviewError.value = ''
  approvalComment.value = ''
  approvalTargetUser.value = ''
  approvalTargetNode.value = ''
  approvalDetailLoading.value = true
  try {
    const detail = await getApproval(approval.id)
    if (!isCurrent()) return
    approvalDetail.value = detail
    approvalDetailLoading.value = false
    if (approvalDetail.value?.contract) {
      approvalContractPreviewLoading.value = true
      try {
        const result = await previewApprovalContract(approval.id)
        if (!isCurrent()) return
        approvalContractPreviewHTML.value = result?.html || ''
        if (!approvalContractPreviewHTML.value) approvalContractPreviewError.value = '该合同没有可预览的正文内容。'
      } catch (error) {
        if (isCurrent() && error?.code !== 'CON_DOCUMENT_NOT_FOUND') approvalContractPreviewError.value = formatUserError(error, { fallback: '读取格式化合同失败' })
      } finally {
        if (isCurrent()) approvalContractPreviewLoading.value = false
      }
    }
  } catch (error) {
    if (isCurrent()) showToast(formatUserError(error, { fallback: '读取审批详情失败' }))
  } finally {
    if (isCurrent()) approvalDetailLoading.value = false
  }
}

function closeApproval() {
  approvalDetailSequence += 1
  selectedApproval.value = null
  approvalDetail.value = null
  approvalContractPreviewHTML.value = ''
  approvalContractPreviewError.value = ''
  approvalContractPreviewLoading.value = false
}

async function executeApprovalCommand(action, payload = {}, { close = false } = {}) {
  if (approvalDetail.value?.state_unavailable) {
    showToast('审批工作流历史已不可查询，当前仅可查看提交快照', 'warning')
    return
  }
  // 本地判断用于收窄按钮入口并校验必填原因；待办归属、当前节点、角色和状态版本仍由
  // 命令接口按当前登录主体重新验证，不能把已打开的详情快照当作授权凭据。
  const isApplicant = approvalDetail.value?.meta?.applicant_user_id === session.value?.user_id
  const requiresActiveTask = ['approve', 'reject', 'sign', 'transfer', 'return'].includes(action)
  const allowed = requiresActiveTask
    ? can('approval.process') && selectedApproval.value?.status === 'active'
    : action === 'comments'
      ? can('approval.view') || can('approval.process') || isApplicant
      : action === 'urge'
        ? can('approval.manage') || isApplicant
        : action === 'withdraw' && isApplicant
  if (!allowed) {
    showToast(requiresActiveTask && selectedApproval.value?.status === 'pending'
      ? '该审批尚未流转到当前节点，暂时只能查看。'
      : '当前用户无权执行此审批操作。')
    return
  }
  if (['reject', 'sign', 'transfer', 'return', 'withdraw'].includes(action) && !approvalComment.value.trim()) {
    showToast('该操作必须填写审批意见或原因。')
    return
  }
  const target = selectedApproval.value
  if (!target) return
  approvalCommandBusy.value = true
  try {
    const accepted = await commandApproval(target.id, action, { comment: approvalComment.value.trim(), ...payload })
    const durable = await waitForApprovalCommand(accepted.command_id, action, target.id)
    if (close && durable) closeApproval()
    await refreshApprovalRealtime()
    const labels = { approve: '审批已通过', reject: '审批已驳回', comments: '评论已提交', urge: '催办已发送', sign: '加签请求已提交', transfer: '转交请求已提交', return: '退回请求已提交', withdraw: '审批已撤回' }
    showToast(durable ? (labels[action] || '操作已完成') : '操作已受理，流程仍在处理，状态将自动更新')
    approvalComment.value = ''
  } catch (error) {
    showToast(formatUserError(error, { fallback: '处理审批失败' }))
  } finally {
    approvalCommandBusy.value = false
  }
}

function processApproval(action) {
  return executeApprovalCommand(action, {}, { close: true })
}

// 工作流已停止但审批仍为 running 时的管理端收口入口；服务端会再次确认工作流
// 状态和持久化运行状态，运行中的审批不会被误收口。
async function repairApprovalState() {
  const target = selectedApproval.value
  if (!target) return
  approvalCommandBusy.value = true
  try {
    await recoverApproval(target.id)
    await refreshApprovalRealtime()
    showToast('审批状态已按持久化运行状态收口')
  } catch (error) {
    showToast(formatUserError(error, { fallback: '修复审批状态失败' }))
  } finally {
    approvalCommandBusy.value = false
  }
}

async function submitSelectedContract() {
  if (!selectedContract.value?.canEditDraft || selectedContract.value.status !== '草稿') return
  submittingContract.value = true
  try {
    const submittedContract = selectedContract.value
    const started = await submitContract(submittedContract.recordId, { terms_identical: termsIdentical.value, expected_version: submittedContract.version })
    const pendingApproval = initializingApproval(started, submittedContract)
    initiatedApprovals.value = [pendingApproval, ...initiatedApprovals.value.filter((item) => item.id !== pendingApproval.id)]
    approvalTab.value = 'initiated'
    selectedContract.value = null
    termsIdentical.value = false
    const materialized = await waitForInitiatedApproval(started.approval_id)
    await loadBusinessData()
    showToast(materialized ? '合同已提交审批，可在“我发起的”查看进度' : '合同已提交审批，流程正在初始化，可在“我发起的”查看')
  } catch (error) {
    showToast(formatUserError(error, { fallback: '提交审批失败' }))
  } finally {
    submittingContract.value = false
  }
}

function openNewRule() {
  editingRuleId.value = ''
  ruleForm.value = emptyRuleForm()
  ruleDialogOpen.value = true
}

function editRule(rule) {
  // 编辑表单携带服务端版本；保存、启停和删除都由后端以该版本检测并发修改，页面不能
  // 通过重新组装规则对象绕过乐观锁。
  const expressionReadonly = Boolean(rule.expression?.groups?.length)
  let conditions
  let originalExpression
  try {
    originalExpression = copyRuleExpression(rule.expression)
    conditions = expressionReadonly ? [] : (rule.expression?.conditions || []).map((condition) => ({
      ...condition,
      value: condition.field === 'amount_minor' ? approvalAmountInput(condition.value) : Array.isArray(condition.value) ? condition.value.join(',') : condition.value,
    }))
  } catch (error) {
    showToast(formatUserError(error, { fallback: '审批规则条件未通过校验，请检查金额与条件。' }))
    return
  }
  editingRuleId.value = rule.id
  ruleForm.value = {
    name: rule.name,
    priority: rule.priority,
    enabled: rule.enabled,
    logical: rule.expression?.logical || 'and',
    conditions,
    expressionReadonly,
    originalExpression,
    nodes: (rule.nodes || []).map((node) => ({ ...node, countersign: 'any' })),
    version: rule.version,
  }
  if (!expressionReadonly && !ruleForm.value.conditions.length) ruleForm.value.conditions.push({ field: 'amount_minor', operator: 'lte', value: '' })
  ruleDialogOpen.value = true
}

function addRuleCondition() {
  ruleForm.value.conditions.push({ field: 'amount_minor', operator: 'lte', value: '' })
}

function addRuleNode() {
  const index = ruleForm.value.nodes.length + 1
  ruleForm.value.nodes.push({ id: `node-${Date.now()}-${index}`, name: '', role_code: '', countersign: 'any' })
}

function normalizeRuleCondition(condition) {
  const kind = conditionField(condition.field).kind
  let value = condition.value
  if (kind === 'number') value = approvalAmountMinor(value)
  if (kind === 'boolean') value = value === true || value === 'true'
  if (condition.operator === 'in') value = String(value).split(',').map((item) => item.trim()).filter(Boolean)
  return { field: condition.field, operator: condition.operator, value }
}

function rulePayload(form) {
  if (!Number.isSafeInteger(Number(form.priority))) throw new Error('规则优先级必须是有效整数。')
  return {
    name: form.name.trim(),
    priority: Number(form.priority),
    enabled: Boolean(form.enabled),
    expression: form.expressionReadonly ? copyRuleExpression(form.originalExpression)
      : { logical: form.logical, conditions: form.conditions.map(normalizeRuleCondition) },
    nodes: form.nodes.map((node) => ({
      id: node.id.trim(), name: node.name.trim(), role_code: node.role_code.trim(),
      countersign: 'any', assignee_ids: [],
      ...(node.timeout !== undefined ? { timeout: node.timeout } : {}),
    })),
    ...(form.version ? { version: form.version } : {}),
  }
}

async function saveRule() {
  ruleSaving.value = true
  try {
    const payload = rulePayload(ruleForm.value)
    if (editingRuleId.value) await updateApprovalRule(editingRuleId.value, payload)
    else await createApprovalRule(payload)
    ruleDialogOpen.value = false
    await loadBusinessData()
    showToast(editingRuleId.value ? '审批规则已更新' : '审批规则已创建')
  } catch (error) {
    showToast(formatUserError(error, { fallback: '保存审批规则失败' }))
  } finally {
    ruleSaving.value = false
  }
}

async function toggleRule(rule) {
  try {
    await updateApprovalRule(rule.id, { ...rule, enabled: !rule.enabled })
    await loadBusinessData()
    showToast(rule.enabled ? '审批规则已停用' : '审批规则已启用')
  } catch (error) {
    showToast(formatUserError(error, { fallback: '更新审批规则失败' }))
  }
}

async function removeRule(rule) {
  if (!window.confirm(`确定删除审批规则“${rule.name}”吗？`)) return
  try {
    await deleteApprovalRule(rule.id, rule.version)
    await loadBusinessData()
    showToast('审批规则已删除')
  } catch (error) {
    showToast(formatUserError(error, { fallback: '删除审批规则失败' }))
  }
}

function statusTone(status) {
  if (['已生效', '已完成', '已签署', '已归档', '成交'].includes(status)) return 'success'
  if (['审批中', '执行中', '履约中', '在跟'].includes(status)) return 'info'
  if (['待签署', '待付款', '待对方签署', '待我方盖章'].includes(status)) return 'warning'
  return 'neutral'
}

function formatAmount(amount, currency = 'CNY') {
  const code = /^[A-Z]{3}$/.test(currency || '') ? currency : 'CNY'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: code, currencyDisplay: 'code', maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(Number(amount) || 0)
}

function formatMinorAmount(amountMinor, currency = 'CNY') {
  return formatAmount(Number(amountMinor || 0) / 100, currency)
}

function formatCurrencyTotals(totals) {
  if (!totals?.length) return formatAmount(0)
  return totals.map((item) => formatAmount(item.amountMinor / 100, item.currency)).join(' / ')
}

function formatContractAmount(contract) {
  const currency = /^[A-Z]{3}$/.test(contract?.currency || '') ? contract.currency : 'CNY'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(contract?.amount || 0)
}

watch(activeSection, () => {
  resetFilters()
  notificationOpen.value = false
  document.title = `${pageMeta.value.title} · 机构合同管理系统`
  scheduleApprovalRealtime({ immediate: true })
  scheduleSigningRealtime({ immediate: true })
}, { immediate: true })

onMounted(async () => {
  try {
    session.value = await getContractSession()
    await loadBusinessData()
    document.addEventListener('visibilitychange', handleApprovalVisibilityChange)
    scheduleApprovalRealtime({ immediate: true })
    scheduleSigningRealtime({ immediate: true })
  } catch (error) {
    if (error instanceof ContractAuthError || error?.status === 401) return
    sessionError.value = formatUserError(error, { fallback: '读取合同系统登录状态失败。' })
  }
})

onBeforeUnmount(() => {
  window.clearTimeout(toastTimer)
  window.clearTimeout(signingFilterTimer)
  stopApprovalRealtime()
  stopSigningRealtime()
  document.removeEventListener('visibilitychange', handleApprovalVisibilityChange)
})
</script>

<template>
  <div class="contract-app">
    <button v-if="mobileMenuOpen" class="contract-menu-mask" type="button" aria-label="关闭导航" @click="mobileMenuOpen = false"></button>
    <aside class="contract-sidebar" :class="{ open: mobileMenuOpen }">
      <div class="contract-brand">
        <span class="contract-brand-mark"><ConsoleIcon name="logo" /></span>
        <span><strong>机构合同管理</strong><small>CONTRACT HUB</small></span>
        <button class="contract-mobile-close" type="button" aria-label="关闭菜单" @click="mobileMenuOpen = false"><ConsoleIcon name="close" /></button>
      </div>
      <nav class="contract-nav" aria-label="合同管理导航">
        <section v-for="group in navGroups" :key="group.label">
          <p>{{ group.label }}</p>
          <button v-for="item in group.items" :key="item.key" type="button" :class="{ active: activeSection === item.key }" @click="navigate(item.key)">
            <ConsoleIcon :name="item.icon" /><span>{{ item.label }}</span><i v-if="item.badge">{{ item.badge }}</i>
          </button>
        </section>
        <section>
          <p>平台能力</p>
          <button v-if="can('all')" type="button" @click="navigatePlatform('settings')"><ConsoleIcon name="settings" /><span>系统设置</span><em>平台</em></button>
          <button type="button" @click="returnToUnifiedPortal"><ConsoleIcon name="dashboard" /><span>返回子系统门户</span></button>
        </section>
      </nav>
      <div class="contract-sidebar-user"><span class="contract-avatar">{{ currentUserInitial }}</span><span><strong>{{ currentUserLabel }}</strong><small>{{ currentRoleLabel }}</small></span><button type="button" :disabled="isLoggingOut" aria-label="退出应用系统" @click="logoutSystem"><ConsoleIcon name="logout" /></button></div>
    </aside>

    <main class="contract-main">
      <header class="contract-topbar">
        <button class="contract-menu-button" type="button" aria-label="打开菜单" @click="mobileMenuOpen = true"><ConsoleIcon name="menu" /></button>
        <div class="contract-breadcrumb"><span>合同管理系统</span><ConsoleIcon name="chevron" /><strong>{{ pageMeta.title }}</strong></div>
        <label class="contract-global-search"><ConsoleIcon name="search" /><input v-model="keyword" type="search" maxlength="100" autocomplete="off" placeholder="搜索合同编号 / 名称 / 类型…" @change="loadBusinessData" /></label>
        <div class="contract-topbar-actions">
          <button class="contract-icon-button" type="button" aria-label="通知" @click="notificationOpen = !notificationOpen"><ConsoleIcon name="bell" /><i></i></button>
          <span class="contract-topbar-avatar">{{ currentUserInitial }}</span>
        </div>
        <div v-if="notificationOpen" class="contract-notification-panel">
          <header><strong>通知中心</strong><span>{{ approvals.length }} 项待办</span></header>
          <template v-if="can('approval.process') && approvals.length">
            <button v-for="approval in approvals.slice(0, 5)" :key="approval.id" type="button" @click="openApproval(approval)"><i class="warning"></i><span><strong>{{ approvalNotificationTitle(approval) }}</strong><small>事件：流程流转 · 当前节点：{{ approval.step }} · 状态：{{ approvalStatusLabel(approval.status) }}</small><small>点击查看并处理</small></span></button>
            <button v-if="approvals.length > 5" type="button" @click="navigate('approvals')"><i class="info"></i><span><strong>查看全部待处理事件</strong><small>还有 {{ approvals.length - 5 }} 项审批待办</small></span></button>
          </template>
          <p v-else class="contract-notification-empty">当前没有待处理流程事件。</p>
        </div>
      </header>

      <section class="contract-content">
        <p v-if="sessionError" class="contract-session-error" role="alert">{{ sessionError }}</p>
        <p v-if="businessDataError" class="contract-session-error" role="alert">{{ businessDataError }}</p>
        <p v-if="businessDataLoading" class="contract-session-error">正在加载合同数据…</p>
        <header class="contract-page-head">
          <div><h1>{{ pageMeta.title }}</h1><p>{{ pageMeta.description }}</p></div>
          <div class="contract-page-actions">
            <button v-if="['contracts', 'reports'].includes(activeSection)" class="contract-button secondary" type="button" @click="exportContracts"><ConsoleIcon name="export" />导出</button>
            <button v-if="activeSection === 'rules' && can('approval_rule.manage')" class="contract-button primary" type="button" @click="openNewRule">＋ 新增规则</button>
            <button v-if="activeSection === 'templates' && isAdmin" class="contract-button primary" type="button" @click="openTemplateUpload">＋ 上传模板</button>
            <button v-if="['dashboard', 'contracts'].includes(activeSection) && can('contract.create')" class="contract-button primary" type="button" @click="openNewContract">＋ 新建合同</button>
          </div>
        </header>

        <template v-if="activeSection === 'dashboard'">
          <section class="contract-welcome"><div><span>已安全登录</span><h2>您好，{{ currentUserLabel }}</h2><p>当前角色：<b>{{ currentRoleLabel }}</b>。您可以使用当前角色已授权的合同功能。</p></div><button v-if="can('approval.process')" type="button" @click="navigate('approvals')">查看我的审批流程 <ConsoleIcon name="chevron" /></button></section>
          <section v-if="isAdmin" class="contract-stat-grid contract-admin-stat-grid">
            <button class="blue" type="button" @click="openDashboardDetail('total_amount')"><span class="contract-stat-icon"><ConsoleIcon name="account" /></span><p>当前企业合同总额</p><strong>{{ dashboardTotalAmountLabel }}</strong><em>点击查看全部合同</em></button>
            <button class="purple" type="button" @click="openDashboardDetail('total_count')"><span class="contract-stat-icon"><ConsoleIcon name="save" /></span><p>当前企业合同份数</p><strong>{{ adminDashboard?.total_contracts || 0 }}<small>份</small></strong><em>点击查看全部合同</em></button>
            <button class="orange" type="button" @click="openDashboardDetail('approval')"><span class="contract-stat-icon"><ConsoleIcon name="audit" /></span><p>当前处于审批流程中的合同</p><strong>{{ adminDashboard?.approval_contracts || 0 }}<small>份</small></strong><em>点击查看审批中合同</em></button>
            <button class="green" type="button" @click="openDashboardDetail('active')"><span class="contract-stat-icon"><ConsoleIcon name="shield" /></span><p>已生效未到期的合同</p><strong>{{ adminDashboard?.active_contracts || 0 }}<small>份</small></strong><em>点击查看有效合同</em></button>
            <button class="red" type="button" @click="openDashboardDetail('expired')"><span class="contract-stat-icon"><ConsoleIcon name="info" /></span><p>已超期的合同</p><strong>{{ adminDashboard?.expired_contracts || 0 }}<small>份</small></strong><em>点击查看超期合同</em></button>
          </section>
          <section v-else class="contract-stat-grid">
            <article class="blue"><span class="contract-stat-icon"><ConsoleIcon name="account" /></span><p>本人合同总额</p><strong>{{ personalTotalAmountLabel }}</strong><em>按当前可查合同汇总</em></article>
            <article class="purple"><span class="contract-stat-icon"><ConsoleIcon name="save" /></span><p>本人合同</p><strong>{{ contracts.length }}<small>份</small></strong><em>当前可见范围</em></article>
            <article v-if="can('approval.process')" class="orange"><span class="contract-stat-icon"><ConsoleIcon name="audit" /></span><p>分配给我</p><strong>{{ approvals.length }}<small>项</small></strong><em>含待流转节点</em></article>
            <article class="green"><span class="contract-stat-icon"><ConsoleIcon name="shield" /></span><p>生效及履约</p><strong>{{ activeContractCount }}<small>份</small></strong><em>按当前状态统计</em></article>
          </section>
        </template>

        <template v-else-if="activeSection === 'intakes'">
          <div class="contract-info-banner"><ConsoleIcon name="info" /><span>这里仅核对 CRM 已投递的签单上下文是否正确关联到既有合同引用。核对不会创建合同、修改合同状态或启动审批。</span></div>
          <div class="contract-filter-bar">
            <label><span>核对状态</span><select v-model="opportunityIntakeFilter" @change="changeOpportunityIntakeFilter"><option value="">全部状态</option><option value="ACCEPTED">待核对</option><option value="LINK_CONFIRMED">关联已确认</option><option value="LINK_EXCEPTION">关联异常</option></select></label>
            <button class="contract-button primary small" type="button" :disabled="opportunityIntakeLoading" @click="loadOpportunityIntakes"><ConsoleIcon name="reset" />{{ opportunityIntakeLoading ? '正在刷新…' : '刷新队列' }}</button>
          </div>
          <p v-if="opportunityIntakeError" class="contract-session-error" role="alert">{{ opportunityIntakeError }}</p>
          <div class="contract-table-card"><div class="contract-table-scroll"><table class="contract-data-table contract-intake-table"><thead><tr><th>商机编号</th><th>客户 ID</th><th>既有合同引用</th><th>预计金额</th><th>签单发生时间</th><th>状态</th><th>版本</th><th>操作</th></tr></thead><tbody><tr v-for="item in opportunityIntakes" :key="item.intake_id"><td><strong>{{ item.opportunity_no }}</strong><small>{{ item.opportunity_id }}</small></td><td>{{ item.customer_id }}</td><td>{{ item.contract_ref }}</td><td class="amount">{{ formatAmount(Number(item.expected_amount || 0)) }}</td><td>{{ formatDateTime(item.occurred_at) }}</td><td><span class="contract-badge" :class="opportunityIntakeStatus(item.status).tone"><i></i>{{ opportunityIntakeStatus(item.status).label }}</span></td><td>V{{ item.version }}</td><td><button class="contract-text-button" type="button" @click="openOpportunityIntake(item)">{{ item.status === 'ACCEPTED' && can('opportunity_intake.process') ? '查看并核对' : '查看详情' }}</button></td></tr><tr v-if="!opportunityIntakeLoading && !opportunityIntakes.length"><td colspan="8" class="contract-empty">当前筛选条件下没有签单关联核对记录</td></tr></tbody></table></div><footer class="contract-table-footer"><span>已加载 {{ opportunityIntakes.length }} 条</span><button v-if="opportunityIntakeHasMore" class="contract-button secondary small" type="button" :disabled="opportunityIntakeLoadingMore" @click="loadOpportunityIntakes({ append: true })">{{ opportunityIntakeLoadingMore ? '正在加载…' : '加载更多' }}</button><span v-else-if="opportunityIntakes.length">已加载全部当前结果</span></footer></div>
        </template>

        <template v-else-if="activeSection === 'customers'">
          <div class="contract-card contract-empty-state"><ConsoleIcon name="user" /><h3>暂无客户数据</h3><p>当前没有可查看的客户记录。</p></div>
        </template>

        <template v-else-if="activeSection === 'contracts'">
          <div class="contract-filter-bar"><label class="contract-search-field"><ConsoleIcon name="search" /><input v-model="keyword" type="search" maxlength="100" autocomplete="off" placeholder="合同编号 / 名称 / 类型" @change="loadBusinessData" /></label><button class="contract-button ghost small" type="button" @click="resetFilters"><ConsoleIcon name="reset" />重置</button><button class="contract-button primary small" type="button" @click="loadBusinessData"><ConsoleIcon name="reset" />刷新</button></div>
          <div class="contract-table-card"><div class="contract-table-scroll"><table class="contract-data-table contract-ledger-table"><thead><tr><th>合同编号 / 名称</th><th>合同类型</th><th>服务类型</th><th>合同金额</th><th>负责人姓名</th><th>创建日期</th><th>到期日期</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="contract in filteredContracts" :key="contract.recordId"><td><button class="contract-entity-link" type="button" @click="openContract(contract)"><strong>{{ contract.name }}</strong><small>{{ contract.id }}</small></button></td><td>{{ contract.type }}</td><td>{{ contract.serviceType }}</td><td class="amount">{{ formatContractAmount(contract) }}</td><td>{{ contract.owner }}</td><td>{{ contract.createdAt }}</td><td>{{ contract.endDate }}</td><td><span class="contract-badge" :class="statusTone(contract.status)"><i></i>{{ contract.status }}</span></td><td><button class="contract-text-button" type="button" @click="openContract(contract)">详情</button></td></tr><tr v-if="!filteredContracts.length"><td colspan="9" class="contract-empty">当前没有可查看的合同</td></tr></tbody></table></div><footer class="contract-table-footer"><span>共 {{ filteredContracts.length }} 条合同记录</span></footer></div>
        </template>

        <template v-else-if="activeSection === 'templates'">
          <section v-if="contractTemplates.length" class="contract-template-grid">
            <article v-for="(item, index) in contractTemplates" :key="item.id">
              <div class="contract-template-cover" :class="['', 'purple', 'green', 'orange'][index % 4]"><span><ConsoleIcon name="save" /></span><i>DOCX</i></div>
              <div class="contract-template-copy"><span class="contract-badge success"><i></i>可用</span><h3>{{ item.name }}</h3><p>{{ item.original_filename }}</p><p>编号格式：{{ item.number_format || 'HT-{YYYYMMDD}-{ID8}' }}</p><div><span>{{ item.fields?.length || 0 }} 个填写字段 · {{ item.fields?.filter((field) => field.locked).length || 0 }} 个管理员配置</span><span>{{ formatDate(item.created_at) }}</span></div></div>
              <footer v-if="isAdmin" class="contract-template-actions"><button type="button" @click="editTemplate(item)">编辑</button><button type="button" @click="openTemplateReplacement(item)">替换模板文件</button><button class="danger" type="button" @click="removeTemplate(item)">删除</button></footer>
            </article>
          </section>
          <div v-else class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>暂无合同模板</h3><p>{{ isAdmin ? '点击右上角“上传模板”添加第一个 DOCX 模板。' : '超级管理员尚未上传合同模板。' }}</p></div>
        </template>

        <template v-else-if="activeSection === 'approvals'">
          <div class="contract-tabs" role="tablist" aria-label="审批列表">
            <button :class="{ active: approvalTab === 'tasks' }" type="button" role="tab" :aria-selected="approvalTab === 'tasks'" @click="approvalTab = 'tasks'">分配给我 <i>{{ approvals.length }}</i></button>
            <button :class="{ active: approvalTab === 'initiated' }" type="button" role="tab" :aria-selected="approvalTab === 'initiated'" @click="approvalTab = 'initiated'">我发起的 {{ initiatedApprovals.length }}</button>
            <button type="button" @click="loadBusinessData">刷新</button>
          </div>
          <section v-if="approvalTab === 'tasks'" class="contract-approval-list" role="tabpanel"><article v-for="approval in approvals" :key="approval.id"><header><span class="contract-badge" :class="approvalStatusTone(approval.status)"><i></i>{{ approvalStatusLabel(approval.status) }}</span><small>{{ approval.submittedAt }}</small></header><div><span class="contract-approval-icon"><ConsoleIcon name="audit" /></span><section><div><span class="contract-badge neutral">{{ approval.type }}</span><h3>合同审批</h3></div><p>任务创建于 {{ approval.submittedAt }}</p></section></div><footer><span><i></i>当前节点：{{ approval.step }}</span><button v-if="can('approval.process')" class="contract-button primary small" type="button" @click="openApproval(approval)">查看并处理</button></footer></article><div v-if="!approvals.length" class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>当前没有活动待办</h3><p>当有合同流转到您处理时，待办会显示在这里。</p></div></section>
          <section v-else class="contract-approval-list" role="tabpanel"><article v-for="approval in initiatedApprovals" :key="approval.id"><header><span class="contract-badge" :class="approvalStatusTone(approval.status)"><i></i>{{ approvalStatusLabel(approval.status) }}</span><small>{{ approval.submittedAt }}</small></header><div><span class="contract-approval-icon"><ConsoleIcon name="audit" /></span><section><div><span class="contract-badge neutral">{{ approval.type }}</span><h3>合同审批</h3></div><p>发起于 {{ approval.submittedAt }}</p></section></div><footer><span><i></i>流程位置：{{ approval.step }}</span><button class="contract-button secondary small" type="button" :disabled="approval.initializing" @click="openApproval(approval)">{{ approval.initializing ? '正在初始化' : '查看进度' }}</button></footer></article><div v-if="!initiatedApprovals.length" class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>尚未发起审批</h3><p>在合同台账打开草稿并点击“提交审批”。</p></div></section>
        </template>

        <template v-else-if="activeSection === 'rules'">
          <div class="contract-info-banner"><ConsoleIcon name="info" /><span>审批流程按合同类型、金额与组织范围自动匹配。规则变更仅对新发起的流程生效。</span></div>
          <section class="contract-rule-list"><article v-for="rule in rules" :key="rule.id"><header><span class="contract-rule-icon"><ConsoleIcon name="organization" /></span><div><h3>{{ rule.name }}</h3><p>{{ ruleConditionSummary(rule) }}</p><p>优先级 {{ rule.priority }}</p></div><span class="contract-badge" :class="rule.enabled ? 'success' : 'neutral'"><i></i>{{ rule.enabled ? '已启用' : '已停用' }}</span><div v-if="can('approval_rule.manage')" class="contract-rule-actions"><button class="contract-text-button" type="button" @click="editRule(rule)">编辑</button><button class="contract-text-button" type="button" @click="toggleRule(rule)">{{ rule.enabled ? '停用' : '启用' }}</button><button class="contract-text-button danger" type="button" @click="removeRule(rule)">删除</button></div></header><div class="contract-stepper"><template v-for="(node, index) in rule.nodes || []" :key="node.id"><span><b>{{ index + 1 }}</b><small>{{ node.name }} · {{ roleLabel(node.role_code) }}</small></span><i v-if="index < rule.nodes.length - 1"></i></template></div></article><div v-if="!rules.length" class="contract-card contract-empty-state"><ConsoleIcon name="organization" /><h3>暂无审批规则</h3><p>{{ can('approval_rule.manage') ? '点击“新增规则”配置第一条审批规则；未匹配时使用默认审批流程。' : '当前企业尚未配置审批规则。' }}</p></div></section>
        </template>

        <template v-else-if="activeSection === 'signing'">
          <div class="contract-info-banner"><ConsoleIcon name="info" /><span>审批通过的合同在此进入纸质签署流程。登记寄出、客户签收、催办和回传文件；回传 PDF 需由合同专员核验印章、签名与签署日期。</span></div>
          <section class="contract-sign-stats contract-sign-stats-four">
            <article><span class="success"><ConsoleIcon name="shield" /></span><div><p>已完成签署</p><strong>{{ signingStats.completed }}</strong></div></article>
            <article><span class="info"><ConsoleIcon name="reset" /></span><div><p>签署进行中</p><strong>{{ signingStats.processing }}</strong></div></article>
            <article><span class="success"><ConsoleIcon name="save" /></span><div><p>本月完成</p><strong>{{ signingStats.monthly }}</strong></div></article>
            <article><span class="warning"><ConsoleIcon name="info" /></span><div><p>已失效</p><strong>{{ signingStats.expired }}</strong></div></article>
          </section>
          <div class="contract-filter-bar">
            <label class="contract-search-field"><ConsoleIcon name="search" /><input v-model="signingKeyword" type="search" maxlength="100" autocomplete="off" placeholder="合同编号 / 名称 / 客户 / 快递单号" /></label>
            <label><select v-model="signingMethodFilter"><option value="">全部签署方式</option><option value="paper">纸质签署</option></select></label>
            <label><select v-model="signingStatusFilter"><option value="">全部状态</option><option value="pending_shipment">待寄出</option><option value="in_return">回传中</option><option value="pending_review">待核验</option><option value="completed">已完成</option><option value="expired">已失效</option></select></label>
            <button class="contract-button primary small" type="button" @click="refreshSigningRecords"><ConsoleIcon name="reset" />刷新</button>
          </div>
          <div class="contract-table-card"><div class="contract-table-scroll"><table class="contract-data-table contract-signing-table"><thead><tr><th>合同编号 / 名称</th><th>签署方</th><th>签署方式</th><th>签署进度</th><th>当前状态</th><th>签署日期</th><th>到期日期</th><th>操作</th></tr></thead><tbody><tr v-for="record in filteredSigningRecords" :key="record.contract.recordId"><td><button class="contract-entity-link" type="button" @click="openSigningRecord(record)"><strong>{{ record.contract.name }}</strong><small>{{ record.contract.id }}</small></button></td><td>{{ record.contract.customerName }}</td><td>纸质签署</td><td><div class="contract-progress"><i><b :style="{ width: `${signingProgress(record)}%` }"></b></i><span>{{ signingProgress(record) }}%</span></div></td><td><span class="contract-badge" :class="signingDisplayStatus(record).tone"><i></i>{{ signingDisplayStatus(record).label }}</span></td><td>{{ formatDate(record.signed_at) }}</td><td>{{ record.contract.endDate }}</td><td><button class="contract-text-button" type="button" @click="openSigningRecord(record)">{{ record.status === 'pending_shipment' ? '登记寄出' : record.status === 'completed' ? '查看详情' : '回传跟踪' }}</button></td></tr><tr v-if="!filteredSigningRecords.length"><td colspan="8" class="contract-empty">当前没有符合条件的签署记录</td></tr></tbody></table></div><footer class="contract-table-footer"><span v-if="signingLedgerLoading">正在加载签署记录…</span><span v-else>共 {{ signingTotal }} 条签署记录，已加载 {{ signingRecords.length }} 条</span><button v-if="signingHasMore" class="contract-button secondary small" type="button" :disabled="signingLoadingMore" @click="refreshSigningRecords({ append: true })">{{ signingLoadingMore ? '加载中…' : '加载更多' }}</button></footer></div>
        </template>

        <template v-else-if="activeSection === 'reports'">
          <ContractReportsPanel :contracts="reportContracts" :enterprise-scope="isAdmin" :summary="adminDashboard" :detail-limited="Boolean(adminDashboard?.contract_detail_limited)" @open-contract="openReportContract" />
        </template>
      </section>
    </main>

    <div v-if="selectedSigningRecord" class="contract-modal-mask" @click.self="closeSigningRecord">
      <article class="contract-detail-modal contract-signing-modal">
        <header><div><span class="contract-badge" :class="signingDisplayStatus(selectedSigningRecord).tone"><i></i>{{ signingDisplayStatus(selectedSigningRecord).label }}</span><h2>{{ selectedSigningRecord.contract.name }}</h2><p>{{ selectedSigningRecord.contract.id }} · 纸质签署</p></div><button type="button" aria-label="关闭" @click="closeSigningRecord"><ConsoleIcon name="close" /></button></header>
        <div v-if="signingDetailLoading" class="contract-modal-loading">正在读取签署详情…</div>
        <template v-else>
          <div class="contract-detail-highlight"><div><span>签署方</span><strong>{{ selectedSigningRecord.contract.customerName }}</strong></div><div><span>负责人</span><strong>{{ selectedSigningRecord.contract.owner }}</strong></div><div><span>到期日期</span><strong>{{ selectedSigningRecord.contract.endDate }}</strong></div></div>
          <section><div class="contract-section-title"><h3>合同文件</h3><div class="contract-inline-actions"><button v-if="can('contract.document.download')" class="contract-text-button" type="button" :disabled="contractDownloadBusy" @click="downloadApprovedContract(selectedSigningRecord.contract, 'docx')">下载 DOCX</button><button v-if="can('contract.document.download')" class="contract-text-button" type="button" :disabled="contractDownloadBusy" @click="downloadApprovedContract(selectedSigningRecord.contract, 'pdf')">下载 PDF</button><button v-if="selectedSigningRecord.returned_document_name && can('contract.document.download')" class="contract-text-button" type="button" :disabled="contractDownloadBusy" @click="downloadApprovedContract(selectedSigningRecord.contract, 'stamped-pdf')">下载回传 PDF</button></div></div></section>
          <section v-if="selectedSigningRecord.status === 'pending_shipment'"><h3>寄出登记</h3><form class="contract-form-grid" @submit.prevent="submitSigningShipment"><label><span>快递单号</span><input v-model.trim="signingShipmentForm.courier_number" required maxlength="80" /></label><label><span>收件人</span><input v-model.trim="signingShipmentForm.recipient_name" required maxlength="100" /></label><label class="contract-form-wide"><span>收件电话</span><input v-model.trim="signingShipmentForm.recipient_phone" required type="tel" inputmode="tel" maxlength="20" placeholder="请输入收件人手机号（必填）" /><small v-if="selectedSigningRecord.recipient_phone">已保存记录仅显示掩码 {{ selectedSigningRecord.recipient_phone }}；保存时请重新输入完整手机号，掩码不会被提交。</small></label><label class="contract-form-wide"><span>收件地址</span><input v-model.trim="signingShipmentForm.recipient_address" required maxlength="300" /></label><label><span>邮寄日期</span><input v-model="signingShipmentForm.mailed_at" required type="date" min="1000-01-01" max="9999-12-31" /></label><button v-if="can('contract.signing.manage')" class="contract-button primary contract-signing-submit" type="submit" :disabled="signingOperationBusy">{{ signingOperationBusy ? '正在保存…' : '确认寄出并开始跟踪' }}</button></form></section>
          <template v-else>
            <section><h3>回传进度</h3><div class="contract-detail-timeline contract-signing-timeline"><div class="done"><i>1</i><span><strong>合同寄出</strong><small>{{ formatDate(selectedSigningRecord.mailed_at) }}<br />{{ selectedSigningRecord.courier_number }}</small></span></div><div :class="selectedSigningRecord.customer_received_at ? 'done' : 'active'"><i>2</i><span><strong>客户签收</strong><small>{{ selectedSigningRecord.customer_received_at ? formatDateTime(selectedSigningRecord.customer_received_at) : '等待确认' }}</small></span></div><div :class="selectedSigningRecord.returned_at ? 'done' : selectedSigningRecord.customer_received_at ? 'active' : ''"><i>3</i><span><strong>合同回传</strong><small>{{ selectedSigningRecord.returned_at ? formatDateTime(selectedSigningRecord.returned_at) : '等待回传 PDF' }}</small></span></div><div :class="selectedSigningRecord.status === 'completed' ? 'done' : selectedSigningRecord.status === 'pending_review' ? 'active' : ''"><i>4</i><span><strong>人工核验</strong><small>{{ selectedSigningRecord.confirmed_at ? formatDateTime(selectedSigningRecord.confirmed_at) : '核验印章与签名' }}</small></span></div></div></section>
            <section><h3>寄送与催办记录</h3><dl><div><dt>快递单号</dt><dd>{{ selectedSigningRecord.courier_number || '—' }}</dd></div><div><dt>邮寄日期</dt><dd>{{ formatDate(selectedSigningRecord.mailed_at) }}</dd></div><div><dt>收件人</dt><dd>{{ selectedSigningRecord.recipient_name || '—' }}</dd></div><div><dt>收件电话</dt><dd>{{ selectedSigningRecord.recipient_phone || '—' }}</dd></div><div><dt>收件地址</dt><dd>{{ selectedSigningRecord.recipient_address || '—' }}</dd></div><div><dt>催办次数</dt><dd>{{ selectedSigningRecord.reminder_count || 0 }} 次</dd></div><div><dt>最近催办</dt><dd>{{ formatDateTime(selectedSigningRecord.last_reminded_at) }}</dd></div></dl><div v-if="selectedSigningRecord.status === 'in_return' && can('contract.signing.manage')" class="contract-signing-operations"><button v-if="!selectedSigningRecord.customer_received_at" class="contract-button secondary" type="button" :disabled="signingOperationBusy" @click="confirmCustomerReceived">确认客户已签收</button><button class="contract-button secondary" type="button" :disabled="signingOperationBusy" @click="sendSigningReminder">记录催办</button><label v-if="can('contract.stamped_pdf.upload')" class="contract-button primary">{{ stampedUploadBusyID ? '上传中…' : '上传回传 PDF' }}<input type="file" accept="application/pdf,.pdf" :disabled="Boolean(stampedUploadBusyID)" hidden @change="uploadStampedContract(selectedSigningRecord.contract, $event)" /></label></div></section>
            <section v-if="selectedSigningRecord.status === 'pending_review'"><h3>回传合同人工核验</h3><p class="contract-approval-summary">系统不自动判定合同内容。请合同专员打开回传 PDF，核对客户印章、签名及实际签署日期后确认。</p><form class="contract-signing-review" @submit.prevent="confirmSigningRecord"><label class="contract-check-label"><input v-model="signingConfirmationForm.seal_verified" type="checkbox" /><span>已核验客户印章完整有效</span></label><label class="contract-check-label"><input v-model="signingConfirmationForm.signature_verified" type="checkbox" /><span>已核验签名完整有效</span></label><label><span>实际签署日期</span><input v-model="signingConfirmationForm.signed_at" required type="date" min="1000-01-01" max="9999-12-31" /></label><button v-if="can('contract.signing.manage')" class="contract-button primary" type="submit" :disabled="signingOperationBusy || !signingConfirmationForm.seal_verified || !signingConfirmationForm.signature_verified || !signingConfirmationForm.signed_at">{{ signingOperationBusy ? '正在确认…' : '确认核验并完成签署' }}</button></form></section>
            <section v-else-if="selectedSigningRecord.status === 'completed'"><h3>签署结果</h3><dl><div><dt>签署日期</dt><dd>{{ formatDate(selectedSigningRecord.signed_at) }}</dd></div><div><dt>完成核验时间</dt><dd>{{ formatDateTime(selectedSigningRecord.confirmed_at) }}</dd></div><div><dt>客户印章</dt><dd>{{ selectedSigningRecord.seal_verified ? '已核验' : '未核验' }}</dd></div><div><dt>客户签名</dt><dd>{{ selectedSigningRecord.signature_verified ? '已核验' : '未核验' }}</dd></div></dl></section>
          <section v-if="selectedSigningRecord.status === 'completed' && selectedSigningRecord.contract.rawStatus !== 'ARCHIVED' && can('contract.stamped_pdf.upload')"><h3>正式文件更换</h3><p class="contract-approval-summary">已确认签署的合同需更换盖章文件时，必须填写原因；新版本会重新进入人工核验，旧版本与历史确认记录保留。已归档合同不允许直接更换。</p><label><span>更换原因</span><input v-model.trim="signingReplacementReason" maxlength="500" placeholder="例如：客户盖章页缺失，补充重签" /></label><label class="contract-button secondary" :class="{ disabled: Boolean(stampedUploadBusyID) || !signingReplacementReason.trim() }">{{ stampedUploadBusyID ? '上传中…' : '选择新版 PDF' }}<input type="file" accept="application/pdf,.pdf" :disabled="Boolean(stampedUploadBusyID) || !signingReplacementReason.trim()" hidden @change="uploadStampedContract(selectedSigningRecord.contract, $event, { replacement: true })" /></label></section>
          </template>
        </template>
        <footer><button class="contract-button secondary" type="button" @click="closeSigningRecord">关闭</button></footer>
      </article>
    </div>

    <div v-if="selectedOpportunityIntake" class="contract-modal-mask" @click.self="closeOpportunityIntake">
      <article class="contract-detail-modal contract-intake-modal"><header><div><span class="contract-badge" :class="opportunityIntakeStatus(selectedOpportunityIntake.status).tone"><i></i>{{ opportunityIntakeStatus(selectedOpportunityIntake.status).label }}</span><h2>{{ selectedOpportunityIntake.opportunity_no }}</h2><p>接收记录 {{ selectedOpportunityIntake.intake_id }} · V{{ selectedOpportunityIntake.version }}</p></div><button type="button" aria-label="关闭" @click="closeOpportunityIntake"><ConsoleIcon name="close" /></button></header>
        <div v-if="opportunityIntakeDetailLoading" class="contract-modal-loading">正在读取签单关联详情…</div>
        <template v-else>
          <div class="contract-detail-highlight"><div><span>预计金额</span><strong>{{ formatAmount(Number(selectedOpportunityIntake.expected_amount || 0)) }}</strong></div><div><span>客户 ID</span><strong>{{ selectedOpportunityIntake.customer_id }}</strong></div><div><span>既有合同引用</span><strong>{{ selectedOpportunityIntake.contract_ref }}</strong></div></div>
          <section><h3>签单上下文</h3><dl><div><dt>商机 ID</dt><dd>{{ selectedOpportunityIntake.opportunity_id }}</dd></div><div><dt>签单事件版本</dt><dd>V{{ selectedOpportunityIntake.event_version }}</dd></div><div><dt>事件 ID</dt><dd>{{ selectedOpportunityIntake.event_id }}</dd></div><div><dt>签单发生时间</dt><dd>{{ formatDateTime(selectedOpportunityIntake.occurred_at) }}</dd></div><div><dt>合同系统接收时间</dt><dd>{{ formatDateTime(selectedOpportunityIntake.accepted_at) }}</dd></div><div><dt>当前数据版本</dt><dd>V{{ selectedOpportunityIntake.version }}</dd></div></dl></section>
          <p v-if="opportunityIntakeConflictNotice" class="contract-session-error" role="alert">{{ opportunityIntakeConflictNotice }}</p>
          <section v-if="selectedOpportunityIntake.status === 'ACCEPTED' && can('opportunity_intake.process')"><h3>人工核对结论</h3><p class="contract-intake-boundary">请先在权威系统中核对客户、商机和既有合同引用。选择“关联已确认”会保存不可变核对证据并建立既有合同与 CRM 客户、商机的权威关联；选择“关联异常”只保存异常证据。两种结论都不会创建合同、修改合同状态或启动审批。</p><form class="contract-intake-review" @submit.prevent="submitOpportunityIntakeReview"><label><span>核对结论</span><select v-model="opportunityIntakeDecision" :disabled="opportunityIntakeReviewBusy || opportunityIntakeReviewBlocked"><option value="LINK_CONFIRMED">关联已确认</option><option value="LINK_EXCEPTION">关联异常</option></select></label><label><span>核对说明</span><textarea v-model="opportunityIntakeReason" required maxlength="500" :disabled="opportunityIntakeReviewBusy || opportunityIntakeReviewBlocked" placeholder="请填写核对依据或异常原因（最多 500 字）"></textarea><small>{{ opportunityIntakeReason.trim().length }} / 500</small></label><button class="contract-button primary" type="submit" :disabled="opportunityIntakeReviewBusy || opportunityIntakeReviewBlocked || !opportunityIntakeReason.trim()">{{ opportunityIntakeReviewBusy ? '正在保存核对结论…' : opportunityIntakeReviewBlocked ? '已停止提交，请关闭后重试' : '确认提交核对结论' }}</button></form></section>
          <section v-else-if="selectedOpportunityIntake.status !== 'ACCEPTED'"><h3>处理记录</h3><dl><div><dt>核对人</dt><dd>{{ selectedOpportunityIntake.reviewer_display_name || selectedOpportunityIntake.reviewed_by || '—' }}</dd></div><div><dt>核对时间</dt><dd>{{ formatDateTime(selectedOpportunityIntake.reviewed_at) }}</dd></div><div class="contract-intake-reason"><dt>核对说明</dt><dd>{{ selectedOpportunityIntake.review_reason || '—' }}</dd></div></dl></section>
          <section v-else><p class="contract-intake-boundary">当前账号只有查看权限，不能提交核对结论。</p></section>
        </template>
        <footer><button class="contract-button secondary" type="button" :disabled="opportunityIntakeReviewBusy" @click="closeOpportunityIntake">关闭</button></footer>
      </article>
    </div>

    <div v-if="selectedContract" class="contract-modal-mask" @click.self="closeContract">
      <article class="contract-detail-modal contract-document-modal">
        <header><div><span class="contract-badge" :class="statusTone(selectedContract.status)"><i></i>{{ selectedContract.status }}</span><h2>{{ selectedContract.name }}</h2><p>{{ selectedContract.id }}</p></div><button type="button" aria-label="关闭" @click="closeContract"><ConsoleIcon name="close" /></button></header>
        <PaymentTermsSummary :terms="selectedContract.paymentTerms" :currency="selectedContract.currency" />
        <div class="contract-detail-highlight"><div><span>合同金额</span><strong>{{ formatContractAmount(selectedContract) }}</strong></div><div><span>更新日期</span><strong>{{ selectedContract.updatedAt }}</strong></div><div><span>负责人姓名</span><strong>{{ selectedContract.owner }}</strong></div></div>
        <section><h3>基本信息</h3><dl><div><dt>合同类型</dt><dd>{{ selectedContract.type }}</dd></div><div><dt>服务类型</dt><dd>{{ selectedContract.serviceType }}</dd></div><div><dt>创建日期</dt><dd>{{ selectedContract.createdAt }}</dd></div><div><dt>到期日期</dt><dd>{{ selectedContract.endDate }}</dd></div></dl></section>
        <section><h3>合同内容</h3><div v-if="selectedContractPreviewLoading" class="contract-modal-loading">正在读取格式化合同…</div><p v-else-if="selectedContractPreviewError" class="contract-session-error">{{ selectedContractPreviewError }}</p><ContractDocumentPreview v-else-if="selectedContractPreviewHTML" class="contract-saved-document-preview" title="合同正文预览" :html="selectedContractPreviewHTML" /><p v-else class="contract-approval-summary">{{ selectedContract.content || '未填写合同内容' }}</p><label v-if="selectedContract.status === '草稿' && selectedContract.canEditDraft" class="contract-check-label"><input v-model="termsIdentical" type="checkbox" /><span>本合同条款与关联历史合同一致（参与审批规则匹配）</span></label></section>
        <section><h3>流转明细</h3><div v-if="selectedContractLifecycleLoading" class="contract-modal-loading">正在读取流转明细…</div><p v-else-if="selectedContractLifecycleError" class="contract-session-error">{{ selectedContractLifecycleError }}</p><div v-else-if="selectedContractLifecycle.length" class="contract-action-log"><div v-for="event in selectedContractLifecycle" :key="event.id"><strong>{{ contractStatusLabel(event.from_status) }} → {{ contractStatusLabel(event.to_status) }}</strong><span>{{ event.actor_user_id === 'SYSTEM' ? '系统' : displayNameFor(event.actor_user_id) }}</span><p>{{ lifecycleReason(event.reason) }} · {{ formatDateTime(event.occurred_at) }}</p></div></div><p v-else class="contract-approval-summary">暂无流转记录</p></section>
        <footer><button class="contract-button secondary" type="button" @click="closeContract">关闭</button><button v-if="selectedContract.canEditDraft" class="contract-button secondary" type="button" :disabled="draftEditLoading || submittingContract" @click="editContractDraft(selectedContract)">{{ draftEditLoading ? '正在读取…' : '返回上一步编辑' }}</button><button v-if="selectedContract.status === '草稿' && selectedContract.canEditDraft" class="contract-button primary" type="button" :disabled="submittingContract" @click="submitSelectedContract">{{ submittingContract ? '正在提交…' : '提交审批' }}</button></footer>
      </article>
    </div>

    <div v-if="dashboardDetailKey" class="contract-modal-mask" @click.self="dashboardDetailKey = ''"><article class="contract-detail-modal contract-dashboard-detail-modal"><header><div><span class="contract-badge info">企业合同统计</span><h2>{{ dashboardDetailMeta.title }}</h2><p>{{ dashboardDetailMeta.value }} · 数据范围为当前企业</p></div><button type="button" aria-label="关闭" @click="dashboardDetailKey = ''"><ConsoleIcon name="close" /></button></header><section><p v-if="adminDashboard?.contract_detail_limited" class="contract-info-banner"><ConsoleIcon name="info" />明细仅展示最近更新的 200 份合同，卡片统计值为企业全部合同的精确结果。</p><div class="contract-table-scroll"><table class="contract-data-table contract-dashboard-detail-table"><thead><tr><th>合同编号 / 名称</th><th>金额</th><th>负责人</th><th>到期日期</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="contract in dashboardDetailContracts" :key="contract.recordId"><td><strong>{{ contract.name }}</strong><span class="block mono">{{ contract.id }}</span></td><td class="amount">{{ formatContractAmount(contract) }}</td><td>{{ contract.owner }}</td><td>{{ contract.endDate }}</td><td><span class="contract-badge" :class="statusTone(contract.status)"><i></i>{{ contract.status }}</span></td><td><button class="contract-text-button" type="button" @click="openDashboardContract(contract)">查看详情</button></td></tr><tr v-if="!dashboardDetailContracts.length"><td colspan="6" class="contract-empty">当前分类暂无合同</td></tr></tbody></table></div></section><footer><button class="contract-button secondary" type="button" @click="dashboardDetailKey = ''">关闭</button></footer></article></div>

    <div v-if="selectedApproval" class="contract-modal-mask" @click.self="closeApproval"><article class="contract-detail-modal contract-approval-modal"><header><div><span class="contract-badge" :class="approvalStatusTone(approvalDetail?.state?.status || selectedApproval.status)"><i></i>{{ approvalStatusLabel(approvalDetail?.state?.status || selectedApproval.status) }}</span><h2>{{ approvalDetail?.contract?.title || '合同审批' }}</h2><p>{{ selectedApproval.type }} · {{ selectedApproval.submittedAt }}</p></div><button type="button" aria-label="关闭" @click="closeApproval"><ConsoleIcon name="close" /></button></header><div v-if="approvalDetailLoading" class="contract-modal-loading">正在加载审批内容与流程记录…</div><template v-else-if="approvalDetail"><p v-if="approvalDetail.snapshot_available === false" class="contract-info-banner"><ConsoleIcon name="info" />该审批创建于历史版本，未保存提交快照；以下展示当前合同，可能与审批时内容不一致。</p><p v-if="approvalDetail.state_unavailable" class="contract-info-banner"><ConsoleIcon name="info" />审批工作流历史已不可查询；以下展示提交时的不可变快照，流程操作已停用。</p><PaymentTermsSummary :terms="approvalDetail.contract.payment_terms || []" :currency="approvalDetail.contract.currency" /><div class="contract-detail-highlight"><div><span>合同金额</span><strong>{{ formatMinorAmount(approvalDetail.contract.amount_minor, approvalDetail.contract.currency) }}</strong></div><div><span>申请人姓名</span><strong>{{ displayNameFor(approvalDetail.meta.applicant_user_id, approvalDetail.meta.applicant_display_name) }}</strong></div><div><span>当前节点</span><strong>{{ selectedApproval.step }}</strong></div></div><section><h3>审批事项</h3><dl><div><dt>合同编号</dt><dd>{{ approvalDetail.contract.contract_number }}</dd></div><div><dt>合同类型</dt><dd>{{ approvalDetail.contract.contract_type }}</dd></div><div><dt>服务类型</dt><dd>{{ approvalDetail.contract.service_type }}</dd></div><div><dt>审批流程</dt><dd>{{ approvalDetail.meta.rule_id ? '已匹配配置流程' : '系统默认流程' }}</dd></div><div><dt>状态变更</dt><dd>{{ contractStatusLabel(approvalDetail.meta.from_status) }} → {{ contractStatusLabel(approvalDetail.meta.target_status) }}</dd></div><div><dt>申请原因</dt><dd>{{ approvalDetail.meta.reason || '合同提交审批' }}</dd></div></dl></section><section><h3>合同正文</h3><div v-if="approvalContractPreviewLoading" class="contract-modal-loading">正在读取格式化合同…</div><p v-else-if="approvalContractPreviewError" class="contract-session-error">{{ approvalContractPreviewError }}</p><ContractDocumentPreview v-else-if="approvalContractPreviewHTML" class="contract-saved-document-preview" title="审批合同预览" :html="approvalContractPreviewHTML" /><p v-else class="contract-approval-summary">{{ approvalDetail.contract.content || '未填写合同内容' }}</p></section><section><h3>审批流程</h3><div class="contract-detail-timeline"><div v-for="(runtime, index) in approvalDetail.state.nodes || []" :key="runtime.node.id" :class="{ done: runtime.status === 'approved', active: runtime.status === 'active' }"><i>{{ index + 1 }}</i><span><strong>{{ runtime.node.name }}</strong><small>{{ roleLabel(runtime.node.role_code) }} · {{ approvalStatusLabel(runtime.status) }}</small></span></div></div></section><section v-if="approvalDetail.actions?.length"><h3>处理记录</h3><div class="contract-action-log"><div v-for="action in approvalDetail.actions" :key="action.id"><strong>{{ approvalActionLabel(action.action) }}</strong><span>{{ displayNameFor(action.actor_user_id, action.actor_display_name) }}</span><p>{{ action.comment || '无备注' }} · {{ formatDate(action.occurred_at) }}</p></div></div></section><section><label class="contract-comment-label">审批意见 / 评论<textarea v-model="approvalComment" maxlength="2000" placeholder="驳回、加签、转交、退回和撤回时必须填写原因"></textarea></label><div v-if="can('approval.process')" class="contract-advanced-actions"><label><span>加签 / 转交用户</span><select v-model="approvalTargetUser"><option value="">{{ approvalTargetUsers.length ? '请选择具有合同审批权限的人员' : '没有其他可用审批人员' }}</option><option v-for="user in approvalTargetUsers" :key="user.user_id" :value="user.user_id">{{ user.display_name }}</option></select></label><button class="contract-button secondary small" type="button" :disabled="!approvalTargetUser || approvalCommandBusy" @click="executeApprovalCommand('sign', { target_user_ids: [approvalTargetUser], countersign: 'all' })">加签</button><button class="contract-button secondary small" type="button" :disabled="!approvalTargetUser || approvalCommandBusy" @click="executeApprovalCommand('transfer', { target_user_ids: [approvalTargetUser] })">转交</button><label><span>退回至</span><select v-model="approvalTargetNode"><option value="">请选择已通过节点</option><option v-for="runtime in (approvalDetail.state.nodes || []).filter((item) => item.status === 'approved')" :key="runtime.node.id" :value="runtime.node.id">{{ runtime.node.name }}</option></select></label><button class="contract-button secondary small" type="button" :disabled="!approvalTargetNode || approvalCommandBusy" @click="executeApprovalCommand('return', { target_node_id: approvalTargetNode })">退回</button></div></section></template><footer><button v-if="can('approval.process')" class="contract-button danger" type="button" :disabled="approvalCommandBusy" @click="processApproval('reject')">驳回</button><button class="contract-button secondary" type="button" :disabled="approvalCommandBusy || !approvalComment.trim()" @click="executeApprovalCommand('comments')">发表评论</button><button v-if="can('approval.manage')" class="contract-button secondary" type="button" :disabled="approvalCommandBusy" @click="repairApprovalState">修复审批状态</button><button v-if="can('approval.manage') || approvalDetail?.meta?.applicant_user_id === session?.user_id" class="contract-button secondary" type="button" :disabled="approvalCommandBusy" @click="executeApprovalCommand('urge')">催办</button><button v-if="approvalDetail?.meta?.applicant_user_id === session?.user_id" class="contract-button secondary" type="button" :disabled="approvalCommandBusy" @click="executeApprovalCommand('withdraw', {}, { close: true })">撤回</button><button v-if="can('approval.process')" class="contract-button primary" type="button" :disabled="approvalCommandBusy" @click="processApproval('approve')"><ConsoleIcon name="save" />同意</button></footer></article></div>

    <div v-if="ruleDialogOpen" class="contract-modal-mask" @click.self="ruleDialogOpen = false"><form class="contract-detail-modal contract-rule-modal" @submit.prevent="saveRule"><header><div><span class="contract-badge info">规则引擎</span><h2>{{ editingRuleId ? '编辑审批规则' : '新增审批规则' }}</h2><p>按优先级从高到低匹配，命中第一条规则后固化到审批实例。</p></div><button type="button" aria-label="关闭" @click="ruleDialogOpen = false"><ConsoleIcon name="close" /></button></header><section><div class="contract-form-grid"><label><span>规则名称</span><input v-model="ruleForm.name" required maxlength="128" autocomplete="off" placeholder="例如：标准服务简化审批" /></label><label><span>优先级</span><input v-model.number="ruleForm.priority" required type="number" min="0" max="9999" step="1" /></label><label><span>条件关系</span><select v-model="ruleForm.logical" :disabled="ruleForm.expressionReadonly"><option value="and">全部满足（AND）</option><option value="or">任一满足（OR）</option></select></label><label class="contract-check-label"><input v-model="ruleForm.enabled" type="checkbox" /><span>保存后立即启用</span></label></div></section><section v-if="ruleForm.expressionReadonly"><h3>触发条件（只读）</h3><p class="contract-info-banner">此规则包含嵌套条件组，当前表单完整保留原条件，不修改或展开为平铺条件；可修改规则基本信息和审批节点。</p><p>{{ ruleConditionSummary({ expression: ruleForm.originalExpression }) }}</p></section><section v-else><div class="contract-section-title"><h3>触发条件</h3><button class="contract-text-button" type="button" @click="addRuleCondition">＋ 添加条件</button></div><div class="contract-rule-editor-list"><div v-for="(condition, index) in ruleForm.conditions" :key="index"><select v-model="condition.field" @change="condition.operator = conditionOperators(condition.field)[0].value; condition.value = conditionField(condition.field).kind === 'boolean' ? true : ''"><option v-for="field in ruleFieldOptions" :key="field.value" :value="field.value">{{ field.label }}</option></select><select v-model="condition.operator"><option v-for="operator in conditionOperators(condition.field)" :key="operator.value" :value="operator.value">{{ operator.label }}</option></select><select v-if="conditionField(condition.field).kind === 'boolean'" v-model="condition.value"><option :value="true">是</option><option :value="false">否</option></select><input v-else v-model="condition.value" required maxlength="1000" :type="conditionField(condition.field).kind === 'number' ? 'number' : 'text'" :step="conditionField(condition.field).kind === 'number' ? '0.01' : undefined" :placeholder="condition.operator === 'in' ? '多个值用逗号分隔' : '条件值'" /><button type="button" aria-label="删除条件" :disabled="ruleForm.conditions.length === 1" @click="ruleForm.conditions.splice(index, 1)">×</button></div></div></section><section><div class="contract-section-title"><h3>审批节点</h3><button class="contract-text-button" type="button" @click="addRuleNode">＋ 添加节点</button></div><div class="contract-rule-editor-list nodes"><div v-for="(node, index) in ruleForm.nodes" :key="index"><input v-model="node.name" required maxlength="128" autocomplete="off" placeholder="节点名称" /><select v-model="node.role_code" required><option value="">请选择审批角色</option><option v-if="node.role_code && !contractRole(node.role_code)" :value="node.role_code">未识别角色</option><option v-for="role in CONTRACT_ROLE_DEFINITIONS" :key="role.code" :value="role.code">{{ role.name }}</option></select><select v-model="node.countersign" disabled><option value="any">或签（任一）</option></select><button type="button" aria-label="删除节点" :disabled="ruleForm.nodes.length === 1" @click="ruleForm.nodes.splice(index, 1)">×</button></div></div></section><footer><button class="contract-button secondary" type="button" @click="ruleDialogOpen = false">取消</button><button class="contract-button primary" type="submit" :disabled="ruleSaving">{{ ruleSaving ? '正在保存…' : '保存规则' }}</button></footer></form></div>

    <div v-if="createDialogOpen" class="contract-modal-mask" @click.self="closeDraftEditor">
      <form class="contract-detail-modal contract-create-modal" @submit.prevent="submitNewContract($event)">
        <header><div><span class="contract-badge info">合同草稿</span><h2>{{ editingContract ? '编辑合同草稿' : '新建合同' }}</h2><p>{{ editingContract ? '修改现有草稿；创建人、合同来源及数据范围保持不变' : '可使用标准模板生成，也可上传不依赖模板的外部合同 DOCX' }}</p></div><button type="button" aria-label="关闭" :disabled="contractCreating" @click="closeDraftEditor"><ConsoleIcon name="close" /></button></header>
        <section>
          <div class="contract-form-grid">
            <p class="contract-form-wide contract-form-required-hint">带 <strong>*</strong> 的为必填项；输入框按字段类型限制长度、格式和数值范围。</p>
            <p v-if="editingContract && isExternalContractMode" class="contract-info-banner contract-form-wide">编辑结构化信息时保留原外部 DOCX，不替换合同文件；正文金额等条款如需改变，应创建与新文件一致的合同。</p>
            <p v-if="draftEditError" class="contract-session-error contract-form-wide" role="alert">{{ draftEditError }} <button v-if="draftEditConflict" type="button" :disabled="contractCreating || draftEditLoading" @click="editContractDraft(editingContract)">重新载入草稿（放弃未保存修改）</button></p>
            <div v-if="crmConnectionRequired" class="contract-session-error contract-form-wide" role="status"><p>{{ crmConnectionMessage }}</p><button class="contract-button secondary" type="button" @click="connectCRM">连接 CRM</button></div>
            <div v-if="!editingContract" class="contract-form-wide contract-creation-mode" role="radiogroup" aria-label="合同创建方式"><button type="button" :class="{ active: contractCreationMode === 'template' }" role="radio" :aria-checked="contractCreationMode === 'template'" @click="selectContractCreationMode('template')"><strong>使用合同模板</strong><span>选择标准模板并填写模板字段</span></button><button type="button" :class="{ active: contractCreationMode === 'external' }" role="radio" :aria-checked="contractCreationMode === 'external'" @click="selectContractCreationMode('external')"><strong>上传外部合同</strong><span>上传未签署 DOCX，并补全结构化字段</span></button></div>
            <label v-if="contractCreationMode === 'template'" class="contract-form-wide contract-template-first"><span>第一步：选择合同模板</span><select v-model="newContract.template_id" :disabled="Boolean(editingContract)" required @change="selectContractTemplate"><option value="" disabled>请选择用于新建合同的模板</option><option v-for="item in contractTemplates" :key="item.id" :value="item.id">{{ item.name }}（{{ item.fields?.length || 0 }} 个字段）</option></select><small>模板将生成合同正文，合同编号在审批通过后自动生成。</small></label>
            <label v-else-if="!editingContract" class="contract-form-wide contract-external-file"><span>第一步：上传外部合同 DOCX</span><input :key="externalContractFileInputKey" required type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" @change="selectExternalContractFile" /><small v-if="externalContractFile">已选择：{{ externalContractFile.name }}（{{ (externalContractFile.size / 1024 / 1024).toFixed(2) }}MB）</small><small v-else>仅支持未签署 DOCX，文件不能为空且不超过 10MB；服务端将继续校验文件结构和安全边界。</small><small v-if="externalContractFileError" class="contract-field-error" role="alert">{{ externalContractFileError }}</small></label>
            <template v-if="selectedContractTemplate || isExternalContractMode">
              <label v-if="isExternalContractMode || newContract.payment_terms.length || newContract.customer_id" :class="{ 'is-required': isExternalContractMode || newContract.payment_terms.length > 0 }"><span>CRM 客户</span><div class="contract-opportunity-control"><button type="button" @click="openCustomerPicker">{{ newContract.customer_name || '点击选择权限范围内的客户' }}</button><button v-if="newContract.customer_id" type="button" aria-label="清除 CRM 客户" @click="clearCustomer">×</button></div><small>外部合同及付款计划须关联 CRM 客户，不能只输入客户名称</small></label>
              <label><span>关联商机（选填）</span><div class="contract-opportunity-control"><select v-model="newContract.opportunity_id" :disabled="isExternalContractMode && !newContract.customer_id" @change="selectOpportunityById"><option value="">{{ opportunityLoading ? '正在读取商机…' : (opportunityOptions.length ? '不关联商机' : (isExternalContractMode && !newContract.customer_id ? '请先选择 CRM 客户' : '暂无可关联商机')) }}</option><option v-for="item in opportunityOptions" :key="item.id || item.opportunity_id" :value="String(item.id || item.opportunity_id || '')">{{ item.name || item.title || item.opportunity_name || '未命名商机' }}（{{ item.opportunity_no || item.code || '—' }}）</option></select><button v-if="newContract.opportunity_id" type="button" aria-label="清除关联商机" @click="clearOpportunity">×</button></div><small>合同编号将在审批通过后自动生成</small></label>
              <label><span>合同名称</span><input v-model="newContract.title" required maxlength="255" autocomplete="off" placeholder="请输入合同名称" /></label>
              <label><span>合同负责人</span><input :value="editingContract ? editingContract.owner_display_name : currentUserLabel" readonly aria-readonly="true" /><small>{{ editingContract ? '保留原合同创建人，不随编辑人变更' : '已根据当前登录用户自动填入' }}</small></label>
              <label><span>合同类型</span><select v-model="newContract.contract_type" required><option value="" disabled>请选择合同类型</option><option v-for="item in availableContractTypeOptions" :key="item" :value="item">{{ item }}</option></select></label>
              <div class="contract-form-wide contract-service-items"><div class="contract-section-title"><div><h3>服务项</h3><p>外部合同的场所、批次和检测类别必须完整，合同生效后将用于项目拆解；最多 20 个服务项。</p></div><button class="contract-text-button" type="button" :disabled="!canAddServiceItem" @click="addServiceItem">＋ 增加服务项</button></div><p v-if="isExternalContractMode && detectionCategoryLoading" class="contract-service-directory-state">正在读取项目管理检测类别…</p><p v-else-if="isExternalContractMode && detectionCategoryError" class="contract-field-error" role="alert">{{ detectionCategoryError }} <button type="button" @click="loadDetectionCategoryOptions">重新加载</button></p><article v-for="(serviceItem, serviceIndex) in newContract.service_items" :key="serviceIndex" class="contract-service-item"><header><strong>服务项 {{ serviceIndex + 1 }}</strong><button type="button" :aria-label="`删除服务项 ${serviceIndex + 1}`" @click="removeServiceItem(serviceIndex)">×</button></header><label><span>服务类型</span><select v-model="serviceItem.service_type" required><option value="" disabled>请选择服务类型</option><option v-for="item in serviceTypeOptions" :key="item" :value="item">{{ item }}</option></select></label><label><span>服务名称</span><input v-model="serviceItem.name" maxlength="255" placeholder="默认使用服务类型" /></label><label><span>实施场所</span><input v-model="serviceItem.site" :required="isExternalContractMode" maxlength="255" placeholder="例如：上海总部" /></label><label><span>实施批次</span><input v-model="serviceItem.batch" :required="isExternalContractMode" maxlength="120" placeholder="默认：第一批次" /></label><label><span>检测类别</span><select v-if="isExternalContractMode" v-model="serviceItem.category" required :disabled="detectionCategoryLoading || !detectionCategoryOptions.length"><option value="" disabled>{{ detectionCategoryLoading ? '正在加载检测类别' : (detectionCategoryError ? '目录加载失败，请点击上方重新加载' : '请选择检测类别') }}</option><option v-for="item in detectionCategoryOptions" :key="item.category" :value="item.category">{{ item.category }}</option></select><input v-else v-model="serviceItem.category" maxlength="120" placeholder="默认使用服务类型" /></label><label><span>检测方式</span><select v-model="serviceItem.test_mode" required><option value="STANDARD">常规检测</option><option value="PENETRATION">渗透测试</option></select></label><label><span>体系 / 能力要求</span><input v-model="serviceItem.requirement" maxlength="1000" placeholder="例如：等保三级" /></label><section class="contract-system-information"><div class="contract-section-title"><div><h3>系统信息（选填）</h3><p>每个系统将形成可独立实施的服务来源，最多 15 个。</p></div><button class="contract-text-button" type="button" :disabled="!canAddSystemRow(serviceItem)" @click="addSystemRow(serviceItem)">＋ 增加系统信息</button></div><p v-if="!serviceItem.systems.length" class="contract-service-empty">尚未增加系统信息</p><div v-for="(system, systemIndex) in serviceItem.systems" :key="systemIndex" class="contract-system-row"><label><span>系统名称</span><input v-model="system.name" required maxlength="255" placeholder="请输入系统名称" /></label><label><span>系统等级</span><select v-model="system.level" required><option value="">请选择系统等级</option><option v-for="level in systemLevelOptions" :key="level" :value="level">{{ level }}</option></select></label><button type="button" aria-label="删除系统信息" @click="removeSystemRow(serviceItem, systemIndex)">×</button></div></section></article></div>
              <label><span>合同金额</span><input v-model="newContract.amount" :readonly="Boolean(editingContract && isExternalContractMode)" required type="number" :min="isExternalContractMode ? 0.01 : 0" max="90071992547409.91" step="0.01" placeholder="0.00" /><small v-if="editingContract && isExternalContractMode">原 DOCX 保持不变，金额不能单独修改</small></label>
              <label><span>币种</span><input v-model="newContract.currency" :readonly="Boolean(editingContract && isExternalContractMode)" required maxlength="3" pattern="[A-Za-z]{3}" autocomplete="off" /></label>
              <section class="contract-form-wide contract-payment-plan">
                <div class="contract-section-title"><div><h3>付款计划</h3><p>分期使用合同币种，合计须等于合同金额；审批开始后冻结。旧合同未维护的分期不会自动补造。</p></div><button class="contract-text-button" type="button" :disabled="newContract.payment_terms.length >= 100" @click="addPaymentTerm">＋ 增加分期</button></div>
                <p v-if="!newContract.payment_terms.length">尚未维护付款计划。保存后可在草稿中补齐；没有分期的合同不会生成结算应收计划。</p>
                <div v-for="(term, index) in newContract.payment_terms" :key="index" class="contract-payment-term-row">
                  <label><span>分期号</span><input v-model.number="term.installment_no" required type="number" min="1" max="100" step="1" /></label>
                  <label><span>到期日</span><input v-model="term.due_date" required type="date" min="1000-01-01" max="9999-12-31" /></label>
                  <label><span>金额（{{ newContract.currency }}）</span><input v-model="term.amount" required type="text" inputmode="decimal" maxlength="20" pattern="[0-9]{1,15}([.][0-9]{1,2})?" placeholder="0.00" /></label>
                  <button class="contract-text-button" type="button" :aria-label="`删除第${term.installment_no}期`" @click="newContract.payment_terms.splice(index, 1)">删除</button>
                </div>
                <p v-if="paymentPlanError" class="contract-field-error" role="alert">{{ paymentPlanError }}</p>
              </section>
              <label><span>开始日期（选填）</span><input v-model="newContract.start_date" type="date" min="0001-01-01" max="9999-12-31" /></label>
              <label><span>结束日期（选填）</span><input v-model="newContract.end_date" type="date" :min="newContract.start_date || '0001-01-01'" max="9999-12-31" /></label>
              <label><span>客户名称</span><input v-model="newContract.customer_name" required maxlength="255" :readonly="isExternalContractMode" :aria-readonly="isExternalContractMode ? 'true' : undefined" :placeholder="isExternalContractMode ? '请从 CRM 客户目录选择' : '请输入客户名称'" /></label>
              <label><span>客户地址</span><input v-model="newContract.customer_address" maxlength="500" placeholder="请输入客户地址" /></label>
              <label><span>客户联系人</span><input v-model="newContract.customer_contact" maxlength="128" placeholder="请输入客户联系人" /></label>
              <label><span>客户联系电话</span><input v-model="newContract.customer_phone" type="tel" inputmode="tel" maxlength="64" placeholder="请输入客户联系电话" /></label>
            </template>
          </div>
          <div v-if="selectedContractTemplate" class="contract-generated-form">
            <div class="contract-section-title"><div><h3>填写模板字段</h3><p>{{ selectedContractTemplate.original_filename }} · 姓名、账号、邮箱等当前用户已有信息会自动填入空白字段</p></div><button class="contract-button secondary small" type="button" :disabled="templatePreviewing" @click="previewNewContract">{{ templatePreviewing ? '正在生成预览…' : '预览合同' }}</button></div>
            <p v-if="selectedContractTemplate.fields?.some(isSystemContractNumberField)" class="contract-info-banner">正文合同编号由系统在审批通过后自动生成，不允许手工填写。</p>
            <div class="contract-template-field-grid"><label v-for="field in editableContractTemplateFields" :key="field.name" :title="field.locked && !isAdmin ? '此项已由管理员预设' : undefined"><span>{{ field.label }}</span><input v-model="newContract.template_values[field.name]" required maxlength="2000" autocomplete="off" :readonly="isContractAmountField(field) || (field.locked && !isAdmin)" :class="{ 'is-admin-configured': field.locked && !isAdmin }" :title="field.locked && !isAdmin ? '此项已由管理员预设' : undefined" :placeholder="field.default ? `默认：${field.default}` : `请输入${field.label}`" /><small v-if="isContractAmountField(field)">自动使用上方合同金额；金额大写由服务端生成。</small><small v-else-if="field.locked && !isAdmin">此项已由管理员预设</small></label></div>
            <p v-if="templatePreviewError" class="contract-template-preview-error" role="alert">{{ templatePreviewError }}</p>
          </div>
          <p v-else-if="contractCreationMode === 'template'" class="contract-info-banner"><ConsoleIcon name="info" />请先选择合同模板，再填写合同、服务项和系统信息。</p>
          <ContractDocumentPreview v-if="templatePreviewHTML" ref="templatePreviewRef" closable :html="templatePreviewHTML" @close="templatePreviewHTML = ''" />
        </section>
        <footer><button class="contract-button secondary" type="button" :disabled="contractCreating" @click="closeDraftEditor">取消</button><button class="contract-button primary" type="submit" :disabled="!canSaveNewContract"><ConsoleIcon name="save" />{{ contractCreating ? '正在保存…' : (editingContract ? '保存为草稿' : (isExternalContractMode ? '上传并保存合同' : '生成并保存合同')) }}</button><button v-if="editingContract" class="contract-button primary" type="submit" data-action="approval" :disabled="!canSaveNewContract || !can('contract.create')">保存并发起审批</button></footer>
      </form>
    </div>

    <div v-if="customerPickerOpen" class="contract-modal-mask contract-opportunity-mask" @click.self="customerPickerOpen = false"><article class="contract-detail-modal contract-opportunity-modal"><header><div><span class="contract-badge info">客户主数据</span><h2>选择 CRM 客户</h2><p>仅显示当前账号权限范围内的有效客户</p></div><button type="button" aria-label="关闭" @click="customerPickerOpen = false"><ConsoleIcon name="close" /></button></header><section><div v-if="crmConnectionRequired" class="contract-session-error contract-form-wide" role="status"><p>{{ crmConnectionMessage }}</p><button class="contract-button secondary" type="button" @click="connectCRM">连接 CRM</button></div><div class="contract-opportunity-search"><label><span>搜索客户</span><input v-model="customerKeyword" type="search" maxlength="100" autocomplete="off" placeholder="客户名称 / 客户编号" @keydown.enter.prevent="searchCustomerOptions" /></label><button class="contract-button secondary" type="button" :disabled="customerLoading" @click="searchCustomerOptions">搜索</button></div><p v-if="customerLoading" class="contract-modal-loading">正在读取客户…</p><p v-else-if="customerError" class="contract-session-error">{{ customerError }}</p><div v-else class="contract-opportunity-list"><button v-for="item in customerOptions" :key="item.id || item.customer_id" type="button" @click="selectCustomer(item)"><strong>{{ item.name || item.customer_name }}</strong><span>{{ item.customer_no || '—' }} · {{ item.industry || '行业未填写' }} / {{ item.region || '区域未填写' }}</span></button><p v-if="!customerOptions.length" class="contract-empty">没有匹配的有效客户，请调整关键词后重试</p><button v-if="customerHasMore" class="contract-button secondary contract-opportunity-load-more" type="button" :disabled="customerLoading" @click="loadMoreCustomerOptions">加载更多（已显示 {{ customerOptions.length }} / {{ customerTotal }}）</button></div></section><footer><button class="contract-button secondary" type="button" @click="customerPickerOpen = false">取消</button></footer></article></div>


<div v-if="templateUploadDialogOpen" class="contract-modal-mask" @click.self="templateUploadDialogOpen = false"><form class="contract-detail-modal contract-template-upload-modal" @submit.prevent="submitTemplateUpload"><header><div><span class="contract-badge info">超级管理员</span><h2>{{ templateReplacementID ? '替换模板文件' : '上传合同模板' }}</h2><p><span v-if="templateReplacementID">保留模板标识和同名字段配置，已生成合同正文不变。请核对替换后的新字段。</span>上传不超过 10MB 的 DOCX，模板中使用 <code v-pre>{{field_name:字段名称}}</code> 标记填写项。</p></div><button type="button" aria-label="关闭" @click="templateUploadDialogOpen = false"><ConsoleIcon name="close" /></button></header><section><div class="contract-form-grid"><label><span>模板名称</span><input v-model="templateUploadForm.name" :readonly="Boolean(templateReplacementID)" required maxlength="160" placeholder="例如：标准服务合同" /></label><label><span>DOCX 文件</span><input required type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" @change="selectTemplateFile" /></label></div><p v-if="templateUploadError" class="contract-template-preview-error" role="alert">{{ templateUploadError }}</p></section><footer><button class="contract-button secondary" type="button" :disabled="templateUploading" @click="templateUploadDialogOpen = false">取消</button><button class="contract-button primary" type="submit" :disabled="templateUploading">{{ templateUploading ? '正在上传…' : (templateReplacementID ? '确认替换' : '上传模板') }}</button></footer></form></div>

    <div v-if="templateEditDialogOpen" class="contract-modal-mask" @click.self="templateEditDialogOpen = false"><form class="contract-detail-modal contract-template-edit-modal" @submit.prevent="saveTemplate"><header><div><span class="contract-badge info">超级管理员</span><h2>编辑合同模板</h2><p>可编辑合同编号格式，并将需要统一控制的合同信息设为管理员预设。</p></div><button type="button" aria-label="关闭" @click="templateEditDialogOpen = false"><ConsoleIcon name="close" /></button></header><section><div class="contract-template-base-fields"><label class="contract-template-name-field"><span>模板名称</span><input v-model="templateEditForm.name" required maxlength="160" /></label><label class="contract-template-name-field"><span>合同编号格式</span><input v-model="templateEditForm.number_format" required maxlength="160" placeholder="HT-{YYYYMMDD}-{ID8}" /><small>支持 {YYYYMMDD}、{YYYY}、{MM}、{DD}、{ID8}；必须包含 {ID8}</small></label></div><div class="contract-template-editor-list"><div v-for="field in templateEditForm.fields" :key="field.name" class="contract-template-editor-row"><label><span>显示名称</span><input v-model="field.label" required maxlength="160" /></label><label><span>{{ field.locked ? '管理员预设值' : '默认值（可选）' }}</span><input v-model="field.default" :required="field.locked" maxlength="1000" :placeholder="field.locked ? '请输入固定值' : '新建合同时仍可修改'" /></label><label class="contract-check-label"><input v-model="field.locked" type="checkbox" /><span>由管理员预设</span></label></div><p v-if="!templateEditForm.fields.length" class="contract-session-error">该 DOCX 中没有可配置字段。</p></div></section><footer><button class="contract-button secondary" type="button" :disabled="templateSaving" @click="templateEditDialogOpen = false">取消</button><button class="contract-button primary" type="submit" :disabled="templateSaving">{{ templateSaving ? '正在保存…' : '保存模板' }}</button></footer></form></div>

    <Transition name="contract-toast"><div v-if="toast" class="contract-toast"><ConsoleIcon name="save" />{{ toast }}</div></Transition>
  </div>
</template>
