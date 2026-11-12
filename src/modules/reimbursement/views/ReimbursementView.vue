<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import AppShell from '../../shared/components/AppShell.vue'
import ConsoleIcon from '../../shared/components/ConsoleIcon.vue'
import LoadingState from '../../shared/components/LoadingState.vue'
import PaginationBar from '../../shared/components/PaginationBar.vue'
import InvoiceControlsPanel from '../components/InvoiceControlsPanel.vue'
import ArchivePackagePanel from '../components/ArchivePackagePanel.vue'
import ApprovalRoundsPanel from '../components/ApprovalRoundsPanel.vue'
import ClaimSyncPanel from '../components/ClaimSyncPanel.vue'
import ReimbursementCostNotice from '../components/ReimbursementCostNotice.vue'
import RecoveryPanel from '../components/RecoveryPanel.vue'
import ExpenseInbox from '../components/ExpenseInbox.vue'
import TravelFields from '../components/TravelFields.vue'
import BusinessObjectSelect from '../components/BusinessObjectSelect.vue'
import BusinessAttachmentSelect from '../components/BusinessAttachmentSelect.vue'
import CitySelect from '../components/CitySelect.vue'
import { resolveDraftContext, draftOrganizations, financeEntityChoices, payeeChoices,
  normalProjectReference, projectReferenceLabel } from '../claimPresentation.js'
import InvoiceContentFields from '../components/InvoiceContentFields.vue'
import InvoiceContentMappings from '../components/InvoiceContentMappings.vue'
import InvoiceClassificationEvidence from '../components/InvoiceClassificationEvidence.vue'
import { invoiceContentForm, invoiceContentInput, returnRateLabel, autoReturnNotice } from '../invoiceClassification.js'
import ArchiveBorrowPanel from '../components/ArchiveBorrowPanel.vue'
import PaymentExceptionPanel from '../components/PaymentExceptionPanel.vue'
import ClaimPreviewPanel from '../components/ClaimPreviewPanel.vue'
import ParseExceptionsPanel from '../components/ParseExceptionsPanel.vue'
import ClaimEvidenceTravelPanel from '../components/ClaimEvidenceTravelPanel.vue'
import BusinessOptionPicker from '../components/BusinessOptionPicker.vue'
import ErrorState from '../../shared/components/ErrorState.vue'
import EmptyState from '../../shared/components/EmptyState.vue'
import { recallTask, rememberTask, savedAtLabel } from '../taskPersistence.js'
import { canSelectProjectReference, editableClaimItem, evidenceIDs,travelInput } from '../claimFields.js'
import { claimStatusLabel as statusLabel, claimStatusTone, failureMessage, failureText } from '../statusLabels.js'
import { pollTask, taskSettled } from '../asyncTask.js'
import { formatUserError } from '../../shared/utils/userError.js'
import InvoiceOriginalViewer from '../components/InvoiceOriginalViewer.vue'
import { approvalNodeLabel, approvalNodesLabel, assignmentPurpose, expenseScopeDescription,
  hasTenantAllCapability, reimbursementRoleLabel } from '../rolePresentation.js'
import { formatBusinessDateTime, todayBusinessDate } from '../../shared/utils/businessTime.js'
import { sourceSHA256 } from '../../shared/utils/sourceIntegrity.js'
import { createCommandRunner, createRequestID, formatMinor, toMinor, timeoutSignal, validateItems } from '../api/client.js'

import { ensureReimbursementSession, logoutReimbursement, reimbursementAPI as api,
  startReimbursementLogin } from '../api/reimbursement.js'
import { policyFields, policyFormFrom, policyPayload } from '../policy.js'
import { returnProjectLocation, validationFields } from '../workspaceState.js'
import { claimTypes, workspaceSection, workspaceQuery, uploadFiles } from '../workspace.js'
import { allocationInput } from '../allocation.js'
import { frontendModules } from '../../registry/compiledModules.js'
import '../reimbursement.css'

const route = useRoute()
const router = useRouter()
const session = ref(null)
const menuOpen = ref(false)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const fieldErrors = ref([])
const validationHint = ref('')
const conflictSnapshot = ref(null)
const returnProject = computed(() => frontendModules.some((module) => module.code === 'project_management') ? returnProjectLocation(route.query) : null)
const notice = ref('')
const sessionExpired = ref(false)
const heading = ref(null)
const detailPanel = ref(null)
const pending = ref(null)
const pendingApprovalAction = ref('')
const runner = createCommandRunner(api)
const dashboard = ref(null)
const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const listFilters = ref({ q:'',status:'',claim_type:'',applicant_subject_id:'',date_from:'',date_to:'',
  invoice_type:'',verification_status:'',review_status:'',route_type:'' })
const selectedInvoiceIDs = ref([])
const selectedClaimIDs = ref([])
const claimPreview=ref(null),previewBusy=ref(false),previewError=ref(''),previewEnabled=ref(false)
let previewSequence=0,previewTimer=null
const invoiceChoices = ref([])
const uploadBatch = ref([])
const batchBusy = ref(false)
const statistics = ref(null)
const selected = ref(null)
// 新建/详情工作区默认收起，列表页保持原型的一屏列表结构；用户点“新建报销”或打开单据后再展开。
const claimFormOpen = ref(false)
const selectedInvoice = ref(null)
const invoiceContentEditor = ref(null)
// 票面总额在展示层统一用元；提交时再换成整数分，避免"元/分"两种单位混着填。
const invoiceTotalYuan = ref('')
const invoiceTotalMinorHint = computed(() => {
  const text = String(invoiceTotalYuan.value || '').trim()
  if (!text) return ''
  try { return `${toMinor(text)} 分` } catch { return '格式待校验' }
})
const invoiceSuggestions = ref([])
const invoiceReviewReason = ref('')
const verificationResult = ref('UNKNOWN')
const verificationReason = ref('')
const verificationEvidence = ref('')
const editorOptions = ref(null)
const policyPublished = ref(false)
const policyRecord = ref(null)
const policyLifecycleReason = ref('')
const replacementPolicyID = ref('')
const reversalRequests = ref([])
const reversalVersion = ref(null)
const payment = ref(null)
const paymentHistory = ref([])
const reversalHistory = ref([])
const paymentHistoryError = ref('')
const paymentHistoryLoading = ref(false)
// 只有真正读成功后，才允许把空列表解释成"尚无记录"。
const paymentHistoryLoaded = ref(false)
const paymentHistoryTotal = ref(0)
const paymentHistoryPage = ref(1)
const paymentHistoryPageSize = 20
let paymentHistorySequence = 0
const archives = ref(null)
const archiveProjects=ref(null)
// 列表/工作台/归档项目/看板/冲正历史的读取失败分别记录，失败不能被渲染成"暂无数据"。
const listError = ref('')
const dashboardError = ref('')
const analyticsError = ref('')
const archiveProjectsError = ref('')
const reversalHistoryError = ref('')
const projectValidation = ref(null)
const projectOptions = ref([])
const projectCursor = ref('')
const projectLoading = ref(false)
const projectError = ref('')
const projectLabels = ref({})
let projectSequence = 0
const evidenceNames = ref({})
const paymentOptions = ref({ source_accounts: [], payee_profiles: [] })
const paymentOptionsError = ref('')
let paymentOptionsSequence = 0
const policyOrganizationChoice = ref('')
const policyOrganizationNames = ref({})
const policyObjectNames = ref({})
const keyword = ref('')
const invoiceRows = ref([])
const originalPreview = ref('')
const originalDownload = ref('')
const originalMedia = ref('')
const selectedSource = ref(null)
const invoiceFacts = ref({})
const exportJob = ref(null)
const exportScopeIDs = ref([])
const parseRun = ref(null)
const documentStatus = ref(null)
const manualInvoiceForm = ref(null)
const candidateDocumentID = ref('')
const candidateFileID = ref('')
const selectedCandidate = ref(null)
const selectedCandidateSource = ref(null)
const parsedCandidates = computed(() => documentStatus.value?.detail?.parse_result?.documents || [])
const documentID = ref('')
// 上传后仍由系统回填文档引用；名称只用于展示"本次上传"，不让用户手抄文档ID。
const uploadedDocument = ref({ id: '', name: '' })
const documentLabel = computed(() => (uploadedDocument.value.id
  && uploadedDocument.value.id === documentID.value ? uploadedDocument.value.name : ''))
// 最近一次解析/导出/原件的本地坐标：刷新后仍能找回任务号，不必重新上传或重跑。
const recentTask = ref({ parse: null, export: null, document: null })
const paymentStatus = ref('APPROVED_PENDING_PAYMENT')
const policyBaseline = ref(null)
let detailSequence = 0
let documentSequence = 0
let queuedUpload = null
const approvalReason = ref('')
const approvalTask = ref(null)
const approvalHistory = ref([])
const historyLoading = ref(false)
const historyError = ref('')
let approvalSequence = 0
let parsePollSequence = 0
let exportPollSequence = 0
const approvalStatus = ref('PENDING')
const transferSubject = ref('')
const reversalID = ref('')
const reversalReason = ref('')
const reversalFact = ref('NO_PAYMENT')
const evidenceFiles = ref('')
const paymentForm = ref({ paid_date: todayBusinessDate(), method: 'BANK',
  source_account_ref: '', transaction_no: '', voucher_file_ids: '' })
// 付款账户与收款档案只来自既有 /claims/{id}/payment-options，不提供手填账户。
const paymentAccounts = ref([])
const paymentPayeeProfiles = ref([])
const paymentOptionError = ref('')
const paymentOptionsLoaded = ref(false)
const claimControlReason = ref('')
const exceptionRows = ref(null)
const exceptionPage = ref(1)
const exceptionTotal = ref(0)
const selectedException = ref(null)
const exceptionForm = ref({ amount: '', currency: 'CNY', paid_date: todayBusinessDate(), method: 'BANK',
  source_account_ref: '', transaction_no: '', payee_profile_id: '', voucher_file_ids: '', reason: '' })
const exceptionReviewForm = ref({ decision: 'CONFIRM_CONFLICT', reason: '', evidence_file_ids: '',
  linked_payment_id: '', linked_reversal_id: '' })
const policyKind = ref('standards')
const policyForm = ref(policyFormFrom('standards'))
const policyID = ref('')
const policyVersion = ref(0)
const draft = ref(blankDraft())
const draftBaseline = ref('')
// 用途：按稳定键序序列化草稿，避免对象键顺序变化被误判为未保存修改。
// 参数：value 为可序列化的草稿对象或数组。
// 返回值：键序稳定的 JSON 字符串。
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
const draftDirty = computed(() => stableStringify(draft.value) !== draftBaseline.value)

// 用途：识别费用行里是否真的有用户输入，避免新建草稿的空白占位行被当成未保存修改。
// 参数：item 为费用编辑行。
// 返回值：存在任一业务输入时为 true。
function itemHasInput(item) {
  if (!item) return false
  if (item.fee_type || item.amount || item.reason || item.exception_reason || item.city_level
    || item.city_code || item.transport_category || item.accommodation_category
    || item.no_invoice_proof_type || item.no_invoice_evidence_text || item.no_invoice_reason
    || item.historical_tail_reason || item.historical_tail_evidence_text) return true
  if ((item.expense_nature || 'ACTUAL') !== 'ACTUAL') return true
  const travel = item.travel_declaration || {}
  if (Object.values(travel).some(Boolean)) return true
  const confirmation = item.travel_confirmation || {}
  if (confirmation.decision || confirmation.reason || confirmation.evidence_text) return true
  return (item.allocations || []).some((row) => row.project_id || row.amount || row.ratio)
    || (item.invoice_usages || []).some((row) => row.invoice_id || row.amount)
}

// 用途：只保留业务输入构造可比较的草稿，空占位行不参与脏数据判断。
// 参数：value 为当前草稿。
// 返回值：用于稳定序列化的草稿子集。
function meaningfulDraft(value) {
  if (!value) return null
  return {
    title: value.title || '', claim_type: value.claim_type || '', remark: value.remark || '',
    org_id: value.org_id || '', route_type: value.route_type || '', currency: value.currency || '',
    finance_entity_id: value.finance_entity_id || '', payee_profile_id: value.payee_profile_id || '',
    items: (value.items || []).filter(itemHasInput),
  }
}

// 用途：判断是否存在真正需要保护的未保存编辑，供离开、刷新和新建前确认。
// 参数：无。
// 返回值：存在未保存业务输入时为 true。
const draftProtected = computed(() => {
  let baseline
  try { baseline = draftBaseline.value ? JSON.parse(draftBaseline.value) : blankDraft() }
  catch { baseline = blankDraft() }
  return stableStringify(meaningfulDraft(draft.value)) !== stableStringify(meaningfulDraft(baseline))
})
let loadSequence = 0
let loadedWorkspace = ''

const sections = [
  ['dashboard', '工作台', 'expense.claim.read'],
  ['invoices', '发票台账', 'expense.invoice.read'],
  ['invoice-upload', '发票上传 / OCR', 'expense.invoice.upload'],
  ['invoice-abnormal', '异常发票池', 'expense.invoice.read'],
  ['claims', '我的报销', 'expense.claim.read'],
  ['submitted', '我发起的', 'expense.claim.read'],
  ['approvals', '待我审批', 'expense.approval.act'],
  ['payments', '付款管理', ['expense.payment.read', 'expense.payment.exception.record',
    'expense.payment.exception.review', 'expense.claim.reopen', 'expense.claim.approved_void']],
  ['archives', '项目归档包', 'expense.archive.read'],
  ['recovery', '异常恢复', ['expense.approval.recover', 'expense.integration.manage']],
  ['policies', '政策配置', ['expense.config.manage', 'expense.policy.publish']],
  ['analytics', '报销看板', 'expense.claim.read'],
  ['messages','站内消息','expense.claim.read'],
]
const workspace = computed(() => String(route.params.section || 'dashboard'))
const section = computed(() => workspaceSection(workspace.value))
const title = computed(() => sections.find(([key]) => key === workspace.value)?.[1] || '工作台')
// 页面描述与原型每个页面标题下方的一句话说明对齐；不承载权限或业务结论。
const sectionDescriptions = {
  dashboard: '查看当前账号的待办、关键指标与常用入口。',
  invoices: '查看已上传票据台账；人工复核、生成费用草稿与异常处理都在受控范围内完成。',
  'invoice-upload': '批量上传发票原件，解析结果仅辅助填写，仍需逐张人工复核。',
  'invoice-abnormal': '集中处理未确认、查验不一致及待关闭风险的票据。',
  claims: '查看本人报销单；新建或编辑草稿后提交审批。',
  submitted: '查看已提交审批的单据及当前节点。',
  approvals: '处理当前待办审批任务；动作、原因与确认在同一详情内完成。',
  payments: '登记付款、查看付款历史与冲正记录。',
  archives: '按项目查看归档包与归档详情；金额为当前已付净额。',
  recovery: '查询失败审批与集成任务，按受控流程恢复。',
  policies: '维护费用标准、审批路由与票据映射等政策版本。',
  analytics: '查看当前范围内的费用、退回率与项目成本统计。',
  messages: '平台统一收件箱，展示审批待办与业务通知。',
}
const sectionIcons = {
  dashboard: 'dashboard', invoices: 'search', 'invoice-upload': 'save', 'invoice-abnormal': 'info',
  claims: 'account', submitted: 'export', approvals: 'shield', payments: 'link', archives: 'organization',
  recovery: 'reset', policies: 'settings', analytics: 'audit', messages: 'bell',
}
// 侧栏分组对齐原型：工作台 / 发票中心 / 报销单 / 付款 / 归档中心 / 配置 / 消息 / 系统。
// 只渲染当前账号至少有一个可见入口的分组；权限判断仍由 sections 的 permission 负责。
const navGroups = computed(() => {
  const groups = [
    { items: [{ key: 'portal', label: '返回门户', icon: 'dashboard' }] },
    { label: '工作台', keys: ['dashboard', 'analytics'] },
    { label: '发票中心', keys: ['invoices', 'invoice-upload', 'invoice-abnormal'] },
    { label: '报销单', keys: ['claims', 'submitted', 'approvals'] },
    { label: '付款', keys: ['payments'] },
    { label: '归档中心', keys: ['archives'] },
    { label: '配置', keys: ['policies'] },
    { label: '消息', keys: ['messages'] },
    { label: '系统', keys: ['recovery'] },
  ]
  return groups.map((group) => ({
    ...group,
    // 有标题的业务分组可折叠；「返回门户」单入口组没有标题，保持不可折叠。
    collapsible: Boolean(group.label),
    items: (group.items || (group.keys || []).map((key) => {
      const entry = sections.find(([name]) => name === key)
      return entry ? { key: entry[0], label: entry[1], permission: entry[2] } : null
    }).filter(Boolean)).filter((item) => item.key === 'portal'
      || can(item.permission)).map((item) => ({
      key: item.key,
      label: item.label,
      icon: item.icon || sectionIcons[item.key] || 'account',
      active: workspace.value === item.key,
    })),
  })).filter((group) => group.items.length)
})
// 原型角色卡：只显示当前真实会话的主体与授权范围，不提供 mock 角色切换。
const sessionInitials = computed(() => {
  const name = String(session.value?.display_name || session.value?.subject_id || '').trim()
  if (!name) return '用'
  return /^[\x00-\x7F]+$/.test(name) ? name.slice(0, 2).toUpperCase() : Array.from(name).slice(0, 1).join('')
})
const editable = computed(() => selected.value
  ? can('expense.claim.update') && selected.value.applicant_subject_id === session.value?.subject_id
    && ['DRAFT', 'RETURNED', 'WITHDRAWN'].includes(selected.value.status)
  : can('expense.claim.create'))
// 用途：解释报销单为什么只读，避免整块 fieldset 静默禁用。
// 参数：无。
// 返回值：一句业务可读原因；可编辑时为空。
const claimReadonlyReason = computed(() => {
  if (!selected.value || editable.value) return ''
  if (!can('expense.claim.update')) return '当前账号没有修改报销单的权限；如需更正，请联系申请人或管理员。'
  if (selected.value.applicant_subject_id !== session.value?.subject_id) return '只有申请人本人可以修改这张单据；当前以查看或审核身份访问。'
  return `单据当前为「${statusLabel(selected.value.status)}」，只有草稿、已退回或已撤回状态可以编辑。`
})
// 用途：解释发票票面为什么只读，区分权限、归属和占用状态。
// 参数：无。
// 返回值：一句业务可读原因；可编辑时为空。
const invoiceReadonlyReason = computed(() => {
  const invoice = selectedInvoice.value
  if (!invoice) return ''
  if (!can('expense.invoice.review')) return '当前账号没有人工复核发票的权限；这里只显示票面与来源。'
  if (invoice.owner_subject_id !== session.value?.subject_id) return '只有票据所有人可以人工复核这张发票；当前以查看身份访问。'
  if (invoice.review_status === 'CONFIRMED') return '这张发票已确认，票面字段只读；重大变化需走独立更正审批。'
  if (!['AVAILABLE', ''].includes(invoice.reservation_state || '')) return '这张发票已被单据占用或消费，票面只读；更正需走独立更正审批。'
  return ''
})
const draftTotal = computed(() => {
  try { return formatMinor(String(draft.value.items.reduce((sum, item) => sum + BigInt(toMinor(item.amount)), 0n))) }
  catch { return '待校验' }
})
const hasModule = computed(() => Boolean(session.value)
  && sections.some(([key, , permission]) => key === workspace.value && can(permission)))
const sessionRolesLabel = computed(() => (session.value?.roles || [])
  .map((role) => reimbursementRoleLabel(typeof role === 'string' ? role : role.code)).filter(Boolean)
  .join('、') || '按当前账号授权范围')
const scopeDescription = computed(() => expenseScopeDescription(session.value))

// 工作台统计卡：tone 只影响色条，不改变服务端指标含义；suffix/hint 只做展示。
const dashboardMetrics = [
  { key: 'my_claims', label: '我的单据', section: 'claims', icon: 'account', tone: 'blue',
    suffix: '单', hint: '本人在当前范围' },
  { key: 'pending_approvals', label: '待审批', section: 'approvals', icon: 'shield', tone: 'orange',
    suffix: '单', hint: '当前可办理' },
  { key: 'pending_payments', label: '待付款', section: 'payments', icon: 'link', tone: 'green',
    suffix: '单', hint: '已通过待支付' },
  { key: 'invoice_review_required', label: '待复核发票', section: 'invoices', icon: 'search', tone: 'purple',
    suffix: '张', hint: '本人票据' },
  { key: 'my_paid_this_month', label: '本月本人已付款', section: 'payments', icon: 'dashboard', tone: 'blue',
    suffix: '笔', hint: '按业务日统计' },
]

// 用途：判断分区是否在当前账号能力内，避免指标把用户带进无权页面。
// 参数：key 为分区键。
// 返回值：当前账号可进入该分区时为 true。
function sectionAllowed(key) {
  const entry = sections.find(([name]) => name === key)
  return Boolean(entry) && can(entry[2])
}

// 列表列定义按分区拆分：审批区展示轮次与节点，单据区展示应付金额，票据区展示票面。
const listTitle = computed(() => ({
  claims: '我的报销', submitted: '我发起的', invoices: '发票台账',
  'invoice-abnormal': '异常发票池', approvals: '待审批任务', payments: '付款记录',
  archives: '归档单据', policies: '政策版本',
}[workspace.value] || '列表'))
const listAmountLabel = computed(() => ({
  invoices: '票面金额', approvals: '审批轮次', policies: '金额 / 标准上限',
}[section.value] || '应付金额'))
const listNodeLabel = computed(() => ({
  invoices: '销售方税号 / 核验', approvals: '审批节点 / 异常', policies: '节点 / 异常',
}[section.value] || '当前节点 / 异常'))
// 付款与归档的每一行都是单据，没有独立审批节点，强行保留列只会出现一列"—"。
const listHasNodeColumn = computed(() => ['invoices', 'approvals', 'claims', 'policies'].includes(section.value))
// 状态页签：普通报销入口保留草稿；「我发起的审批」只列提交后的状态，已作废也要能被找回。
const statusTabs = computed(() => workspace.value === 'submitted'
  ? { '':'全部', IN_APPROVAL:'审批中', RETURNED:'已退回', APPROVED_PENDING_PAYMENT:'待付款',
    PAID:'已付款', VOID:'已作废' }
  : { '':'全部', DRAFT:'草稿', IN_APPROVAL:'审批中', APPROVED_PENDING_PAYMENT:'待付款',
    PAID:'已付款', RETURNED:'已退回' })

// 用途：把整数分展示为带单位的元，缺值时不伪造 0.00。
// 参数：value 为服务端整数分字段。
// 返回值：元金额文本；非法值显示未提供。
function moneyText(value) {
  const text = formatMinor(value)
  return text === '不可用' ? '未提供' : `${text} 元`
}

// 用途：统一列表行的状态码与状态文案，保留原生命周期 > 业务状态 > 复核状态 > 发布标记的优先级。
// 参数：row 为列表接口返回的受控行。
// 返回值：状态码或发布标记。
function listRowStatusCode(row) {
  return row?.lifecycle_status || row?.status || row?.review_status || ''
}

// 用途：给状态胶囊提供稳定 tone，未知码统一回落 gray。
// 参数：row 为列表接口返回的受控行。
// 返回值：success/info/warning/danger/gray。
function listRowTone(row) {
  const code = listRowStatusCode(row)
  if (code) return claimStatusTone(code)
  return row?.published ? 'success' : 'gray'
}

// 用途：列表行状态文案；没有状态码时只把已发布/草稿翻译成已有业务术语。
// 参数：row 为列表接口返回的受控行。
// 返回值：中文状态文本。
function listRowStatusText(row) {
  const code = listRowStatusCode(row)
  if (code) return statusLabel(code)
  return row?.published ? '已发布' : '草稿'
}

// 配置页按原型拆成费用标准 / 审批路由 / 发票映射 / 其他配置四组；
// policyKind 仍是唯一服务端配置类型，不新增接口。
const policyKindGroups = {
  standards: ['standards'],
  route_rules: ['route_rules'],
  invoice_rules: ['invoice_rules'],
  other: ['city_mappings', 'archive_retention_policies', 'historical_tail_policies',
    'assignments', 'finance_entities', 'payment_accounts', 'payee_profiles',
    'employee_profiles', 'scopes'],
}
const policyTabs = [
  { key: 'standards', label: '费用标准' },
  { key: 'route_rules', label: '审批路由规则' },
  { key: 'invoice_rules', label: '发票类型映射' },
  { key: 'other', label: '其他配置' },
]
const activePolicyTab = computed(() => policyTabs.find((tab) => tab.key === policyKind.value)?.key || 'other')

// 用途：切换配置分组时选择该组第一个可维护类型；其他配置保留用户当前选择。
// 参数：key 为分组键。
// 返回值：无。
function selectPolicyTab(key) {
  if (key !== 'other') { policyKind.value = key; return }
  if (!policyKindGroups.other.includes(policyKind.value)) policyKind.value = 'city_mappings'
}

// 用途：解释发票为什么不能勾选生成费用，避免静默禁用的复选框。
// 参数：row 为发票列表行。
// 返回值：一句业务原因；可勾选时为空串。
function invoiceSelectHint(row) {
  if (row.review_status !== 'CONFIRMED') return '这张发票还未人工复核，不能生成费用'
  if (!['AVAILABLE', ''].includes(row.reservation_state || '')) return '这张发票已被其他单据占用或消费，不能重复使用'
  return ''
}

const organizationOptions = computed(() => draftOrganizations(editorOptions.value))
const currentDraftContext = computed(() => resolveDraftContext(editorOptions.value, draft.value.org_id))
const draftEntityOptions = computed(() => financeEntityChoices(editorOptions.value, draft.value.org_id))
const draftPayeeOptions = computed(() => payeeChoices(editorOptions.value))
// 用途：回显地址栏带来的单据与项目参数，让深链来源在页面上可见。
// 参数：无。
// 返回值：仅包含非空字符串参数的标签与值。
const routeContextChips = computed(() => [
  { label: '来源单据', value: route.query.claim_id },
  { label: '来源项目', value: route.query.project_id },
].filter((row) => typeof row.value === 'string' && row.value))
// 用途：汇总当前单据的关键业务参数，供只读核对，
// 而不是再填一遍内部编号。
// 参数：无。
// 返回值：按单据、线路、主体、收款资料排列的非空标签值。
const claimContextChips = computed(() => {
  const claim = selected.value
  if (!claim) return []
  const chips = [
    { label: '单据', value: claim.claim_no || claim.id },
    { label: '状态', value: statusLabel(claim.status) },
    { label: '版本', value: claim.version ? `v${claim.version}` : '' },
    { label: '应付金额',
      value: claim.payable_minor == null ? '' : moneyText(claim.payable_minor) },
    { label: '任职组织', value: currentDraftContext.value.organization_name || '' },
    { label: '业务线路', value: optionLabels[currentDraftContext.value.route_type] || '' },
    { label: '付款主体', value: financeEntityLabel(draft.value.finance_entity_id) },
    { label: '收款资料', value: payeeProfileLabel(draft.value.payee_profile_id) },
  ]
  return chips.filter((row) => row.value)
})
// 用途：把超标单据占比换算成看板环形图百分比。
// 参数：无。
// 返回值：0–100 的数值；当前范围没有单据时为 0。
const overStandardRatio = computed(() => {
  const total = Number(statistics.value?.total_count || 0)
  const over = Number(statistics.value?.over_standard_count || 0)
  return total > 0 ? Math.min(100, Math.max(0, (over * 100) / total)) : 0
})
// 用途：把服务端以基点表示的退回率换算成环形图百分比。
// 参数：无。
// 返回值：0–100 的数值；服务端未提供退回率时为 0。
const returnRateRatio = computed(() => {
  const basisPoints = statistics.value?.return_rate_basis_points
  if (basisPoints === null || basisPoints === undefined) return 0
  return Math.min(100, Math.max(0, Number(basisPoints) / 100))
})
// 用途：生成环形图中心的超标占比文本。
// 参数：无。
// 返回值：一位小数的百分比文本。
const overStandardPercentText = computed(() => `${overStandardRatio.value.toFixed(1)}%`)
// 用途：生成环形图中心的退回率文本，缺数据时不伪造 0%。
// 参数：无。
// 返回值：两位小数的百分比文本；服务端未提供退回率时为短横线。
const returnRatePercentText = computed(() => {
  const basisPoints = statistics.value?.return_rate_basis_points
  return basisPoints === null || basisPoints === undefined ? '—' : `${(Number(basisPoints) / 100).toFixed(2)}%`
})
const applicantName = computed(() => selected.value?.applicant_name ||
  (selected.value?.applicant_subject_id && selected.value.applicant_subject_id !== editorOptions.value?.applicant?.id
    ? '报销人姓名待核对' : editorOptions.value?.applicant?.name || session.value?.display_name || '本人姓名待核对'))
const projectRouteHint = computed(() => !route.query.project_id ? '' : projectOptions.value.some(
  (row) => row.project_id === String(route.query.project_id))
  ? '已找到来源项目，请核对并选择具体项目或服务项。'
  : '来源项目尚未出现在当前可用选项中，请查询并核对当前资格。')
// 编辑既有单据时用草稿选项里的真实组织名称回显，避免出现裸组织ID。
const organizationNames = computed(() => {
  const map = {}
  for (const row of Array.isArray(editorOptions.value?.organizations) ? editorOptions.value.organizations : []) {
    if (row?.id) map[row.id] = row.name || ''
  }
  return map
})

const replacementCandidates = computed(() => rows.value.filter((row) => row.id !== policyID.value
  && !row.published && (!row.lifecycle_status || row.lifecycle_status === 'DRAFT')))
const policyLifecycleStatus = computed(() => policyRecord.value?.lifecycle_status
  || (policyPublished.value ? 'ACTIVE' : 'DRAFT'))
const currentPolicyFields = computed(() => policyFields(policyKind.value))
const policyChanges = computed(() => currentPolicyFields.value.map((field) => ({
  label: field.label, before: field.type==='content-mappings' ? mappingSummary(policyBaseline.value?.[field.key]) : policyBaseline.value?.[field.key] ?? '未设置',
  after: field.type==='content-mappings' ? mappingSummary(policyForm.value[field.key]) : policyForm.value[field.key] ?? '未设置',
})).filter((row) => String(row.before) !== String(row.after)))
const candidateFields = {
  invoice_number: '发票号码', invoice_code: '发票代码', invoice_date: '开票日期',
  gross_minor: '票面总额', amount_minor: '不含税金额', tax_minor: '税额',
  buyer_tax_id: '购买方税号', seller_tax_id: '销售方税号', buyer_name: '购买方', seller_name: '销售方',
}
// 解析候选里的金额字段是整数分；展示时一律补上等值元，避免和人工录入的元混用。
const candidateMoneyFields = new Set(['gross_minor', 'amount_minor', 'tax_minor'])

// 用途：把解析候选值渲染为业务可读文本，金额同时给出分和元。
// 参数：field 为候选字段名，value 为服务端候选值对象。
// 返回值：候选值文本；金额字段形如「10000 分（100.00 元）」。
function candidateValue(field, value) {
  const raw = value?.value ?? value?.raw_value ?? ''
  const text = String(raw).trim()
  if (!text) return '缺失'
  if (!candidateMoneyFields.has(field) || !/^-?\d+$/.test(text)) return text
  return `${text} 分（${formatMinor(text)} 元）`
}
const groupLabels = {
  SINGLE_CANDIDATE: '单票候选，仍待人工复核',
  OFD_MULTIPLE_DOCUMENTS: '包含多个文档，需人工拆分',
  AMBIGUOUS_MERGE_OR_CONTINUATION: '合并或接续关系不确定，需人工判断',
  MULTIPAGE_SINGLE_CANDIDATE_REQUIRES_REVIEW: '多页单票候选，需人工复核',
}
const optionLabels = {
  TECHNICAL: '技术线', SALES: '销售线', PER_NIGHT: '每晚', PER_PERSON_DAY: '每人每天',
  PER_OCCURRENCE: '每次', PER_KM: '每公里', PROJECT_EXPENSE_OWNER: '项目经理受控替代（不决定首次审批）',
  PROJECT_MANAGER: '项目经理（费用负责人）', SALES_DIRECTOR: '项目销售总监受控替代（不决定首次审批）',
  TECHNICAL_DIRECTOR: '项目技术总监受控替代（不决定首次审批）',
  FINANCE_DIRECTOR: '财务负责人（首次与转交）', ACCOUNTANT: '会计（首次与转交）',
  BUSINESS_REVIEW: '旧业务节点受控替代（不决定首次审批）',
  NORMAL:'常规复核',PRIORITY_REVIEW:'优先财务人工复核',TRAVEL:'差旅',DAILY:'日常',PROJECT_EXECUTION:'项目执行',
}

// 用途：将内容规则变更显示为可读业务摘要，保留嵌套编辑差异。
// 参数：rows为基线或当前规则表单数组。
// 返回值：规则、条件、费用及优先级的文字摘要。
function mappingSummary(rows) {
  return (rows || []).map(row=>`${row.id || '新规则'}：税码 ${row.tax_code_prefixes || '无'}；关键词 ${row.keywords || '无'} → ${row.fee_type || '待填'} / ${row.default_claim_type || '不指定'}，优先级 ${row.priority}`).join('；') || '未配置内容规则'
}

// 用途：检查会话中的精确动作能力，不推导财务范围。
// 参数：permission 为后端权限目录编码。
// 返回值：是否拥有该能力。
function can(permission) {
  const codes = Array.isArray(permission) ? permission : [permission]
  return codes.some((code) => session.value?.permissions?.includes(code) === true)
}

// 用途：从当前组织已发布标准提供编码选项，不引入与制度无关的固定分类。
// 参数：field为标准字段，feeType为可选费用类型。
// 返回值：去重后的可用值；保留人工输入并由服务器最终匹配。
function standardChoices(field,feeType='') {
  return [...new Set((editorOptions.value?.standards || [])
    .filter(row=>row.org_id===draft.value.org_id && (!feeType || row.fee_type===feeType))
    .map(row=>row[field]).filter(Boolean))]
}

// 用途：创建仅在当前页面内存保存的草稿表单。
// 参数：无。
// 返回值：空白报销单编辑字段。
function blankDraft() {
  return { title: '', claim_type: 'TRAVEL', remark:'', org_id: '', route_type: '', finance_entity_id: '',
    payee_profile_id: '', currency: 'CNY', items: [] }
}

// 用途：用浏览器确认框保护未保存草稿；无交互环境不阻塞。
// 参数：message 为业务可读的放弃提醒。
// 返回值：允许继续时为 true。
function confirmDiscard(message) {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true
  return window.confirm(message)
}

// 用途：在丢掉当前草稿前征得确认，覆盖切换分区、打开其他单据和新建。
// 参数：无。
// 返回值：可以继续时为 true；用户取消时保持原表单。
function discardDraft() {
  if (!draftProtected.value) return true
  return confirmDiscard('当前草稿有尚未保存的修改，离开后这些修改会丢失。确定离开吗？')
}

// 用途：在现有统一路由中切换工作区。
// 参数：key 为导航区域。
// 返回值：无；有未保存草稿时先确认，取消则不跳转。
function navigate(key) {
  if (key !== workspace.value && !discardDraft()) return
  router.push(key === 'portal' ? { name: 'portal' } : { name: 'reimbursement', params: { section: key } })
}

// 用途：新建报销前保护当前草稿，并先进入报销分区。
// 参数：无。
// 返回值：无；用户取消或命令未确认时保持原页面。
async function startNewClaim() {
  if (!discardDraft()) return
  if (workspace.value !== 'claims') await router.push({ name: 'reimbursement', params: { section: 'claims' } })
  await newDraft(true)
}

// 用途：把API或本地校验错误统一成一句可展示原因，并附请求号便于追查。
// 参数：cause 为错误对象，method 为缺省请求方法。
// 返回值：中文原因；后台诊断码只翻译成原因和下一步，不直接展示机器码。
function errorText(cause, method = 'POST') {
  const requestId = typeof cause?.requestID === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(cause.requestID)
    ? cause.requestID : ''
  return `${failureText(cause?.code) || formatUserError(cause, { method: cause?.method || method })}`
    + `${requestId ? `（请求号：${requestId}）` : ''}`
}

// 用途：把读取失败落在它自己的数据区，失败不再被渲染成"暂无数据"。
// 参数：area 为数据区（dashboard/analytics/archives/其它视为列表），cause 为错误。
// 返回值：无；会话过期时仍走全局恢复入口。
function areaError(area, cause) {
  const message = errorText(cause, 'GET')
  if (area === 'dashboard') dashboardError.value = message
  else if (area === 'analytics') analyticsError.value = message
  else if (area === 'archives') archiveProjectsError.value = message
  else listError.value = message
  if (cause?.status === 401) showError(cause)
}

// 用途：显示真实错误并保留表单与命令结果未知状态。
// 参数：cause 为API或本地校验错误。
// 返回值：无；更新页面反馈。
function showError(cause) {
  fieldErrors.value = validationFields(cause?.details)
  validationHint.value = ''
  if (fieldErrors.value.length) void focusValidation(fieldErrors.value[0].field)
  // 统一走平台错误文案：业务中文原因优先；后台诊断码只翻译为原因和下一步，不直接展示。
  error.value = errorText(cause)
  pending.value = runner.pending()
  if (cause?.status === 401) {
    sessionExpired.value = true
    notice.value = '会话已过期；恢复登录前请勿关闭尚有未确认命令的页面。'
  }
}

// 用途：切换分区时清掉上一个分区的详情对象。
// 参数：无。
// 返回值：无；避免残留面板带着旧单据渲染成"尚无记录"的假空态。
function clearForeignDetail() {
  approvalTask.value = null; approvalHistory.value = []; historyError.value = ''
  selectedInvoice.value = null; invoiceRows.value = []; selectedSource.value = null
  exceptionRows.value = null; selectedException.value = null; exceptionPage.value = 1
}

// 用途：进入付款/归档分区时补齐当前单据的分区数据。
// 参数：无。
// 返回值：无；"当前单据尚无付款记录"只会在真实请求成功后出现。
async function refreshSelectedSection() {
  const claimID = selected.value?.id
  const ticket = detailSequence
  if (!claimID) return
  if (section.value === 'payments') {
    payment.value = null
    paymentHistory.value = []; reversalHistory.value = []; reversalHistoryError.value = ''
    paymentHistoryError.value = ''; paymentHistoryTotal.value = 0
    paymentHistoryPage.value = 1; paymentHistoryLoaded.value = false
    await loadPaymentAccountOptions()
    if (ticket !== detailSequence || selected.value?.id !== claimID
      || !can('expense.payment.read')) return
    const paymentID = selected.value.active_payment_id
    if (paymentID) {
      try {
        const value = await api.request(`/payments/${encodeURIComponent(paymentID)}`)
        if (ticket !== detailSequence || selected.value?.id !== claimID) return
        payment.value = value
      } catch (cause) { if (ticket === detailSequence) showError(cause) }
    }
    await loadPaymentHistory(1)
    return
  }
  if (section.value === 'archives') {
    archives.value = null
    if (can('expense.archive.read')) await loadArchives()
  }
}

// 用途：只按当前已授权页面加载业务数据，防止跨页迟到结果覆盖。
// 参数：无。
// 返回值：无；错误显式呈现在对应数据区，不用空列表代替失败。
async function load() {
  const ticket = ++loadSequence
  const current = section.value
  const changedWorkspace = workspace.value !== loadedWorkspace
  loadedWorkspace = workspace.value
  loading.value = true
  selectedClaimIDs.value=[]
  error.value = ''
  sessionExpired.value = false
  conflictSnapshot.value = null
  validationHint.value = ''
  listError.value = ''; dashboardError.value = ''; analyticsError.value = ''
  archiveProjectsError.value = ''
  if (changedWorkspace) {
    notice.value = ''; fieldErrors.value = []; clearForeignDetail()
    if (workspace.value !== 'claims') claimFormOpen.value = false
  }
  try {
    const activeSession = await ensureReimbursementSession()
    if (ticket !== loadSequence || !activeSession) return
    session.value = activeSession
    const entry = sections.find(([key]) => key === workspace.value)
    if (!entry || !can(entry[2])) {
      rows.value = []
      const first = sections.find(([, , permission]) => can(permission))
      if (first) { await router.replace({ name: 'reimbursement', params: { section: first[0] } }); return }
      showError(new Error('当前账号没有该区域的访问能力'))
      return
    }
    if (current === 'claims' && (can('expense.claim.create') || can('expense.claim.update'))) {
      const options = await api.request('/claim-options')
      if (ticket !== loadSequence) return
      editorOptions.value = options
      if (!selected.value) {
        applyDraftContext(draft.value.org_id)
        // 首次进入时的任职/主体/收款档案是服务端默认上下文，不是用户输入；
        // 记录为基线，避免从列表打开详情时被误判成未保存修改。
        if (!draftBaseline.value) draftBaseline.value = stableStringify(draft.value)
      }
      // 没有可用在职组织/费用档案时不请求项目资格服务：
      // 该账号本来没有报销主体，强查项目只会得到一个业务上无意义的依赖错误。
      if (currentDraftContext.value.ready) await searchProjects()
      else { projectOptions.value = []; projectError.value = '' }
    }
    if (current === 'dashboard') {
      const result = await api.request('/dashboard')
      if (ticket === loadSequence) dashboard.value = result
      return
    }
    if (current === 'analytics') {
      const result = await api.request(`/statistics?${workspaceQuery(workspace.value,listFilters.value,1,20,'')}`)
      if (ticket === loadSequence) statistics.value = result
      return
    }
    if (workspace.value === 'invoice-upload') { rows.value=[]; total.value=0; return }
    if(current==='archives') {
      // 项目归档聚合失败不影响下面的单据列表，两块失败各自显示原因。
      try {
        archiveProjects.value=await api.request(`/archive-projects?${workspaceQuery('archives',listFilters.value,page.value,pageSize.value,route.query.project_id || '')}`)
      } catch (cause) {
        if (ticket === loadSequence) { archiveProjects.value = null; areaError('archives', cause) }
      }
      if(ticket!==loadSequence)return
    }
    if (['recovery','messages'].includes(current)) { rows.value = []; total.value = 0; return }
    let path = '/claims'
    if (current === 'invoices') path = '/invoices'
    if (current === 'approvals') path = '/approval-tasks'
    if (current === 'policies') path = `/configurations/${policyKind.value}`
    const query = new URLSearchParams(workspaceQuery(workspace.value,listFilters.value,
      page.value,pageSize.value,route.query.project_id || ''))
    if (current === 'approvals' && approvalStatus.value) query.set('status', approvalStatus.value)
    if (current === 'payments' && paymentStatus.value) query.set('status', paymentStatus.value)
    if (route.query.project_id) query.set('project_id', String(route.query.project_id))
    const result = await api.request(`${path}?${query}`)
    if (ticket !== loadSequence) return
    if (!Array.isArray(result.items) || !Number.isFinite(result.total)) throw new Error('服务端分页响应不完整')
    rows.value = result.items
    total.value = result.total
    if (current === 'claims' && route.query.claim_id && selected.value?.id !== String(route.query.claim_id)) await openClaim(String(route.query.claim_id))
    if (current === 'policies' && policyRecord.value) {
      const latest = result.items.find((row) => row.id === policyID.value)
      if (latest) { policyRecord.value = { ...policyRecord.value, ...latest }; policyVersion.value = latest.version }
    }
    // 从别的分区切进付款/归档时，当前单据的分区数据必须重新读取。
    if (changedWorkspace && selected.value?.id) await refreshSelectedSection()
  } catch (cause) {
    if (ticket !== loadSequence) return
    areaError(current === 'dashboard' ? 'dashboard' : current === 'analytics' ? 'analytics' : 'list', cause)
  }
  finally { if (ticket === loadSequence) loading.value = false }
}

// 用途：执行可追踪的写命令，并在成功后读取真实状态。
// 参数：key 为动作、path 为API、payload 为业务字段、method 为HTTP方法。
// 返回值：原始业务结果；失败返回null并保留用户输入。
async function mutate(key, path, payload, method = 'POST') {
  if (saving.value) return null
  saving.value = true
  error.value = ''; notice.value = ''; fieldErrors.value = []
  conflictSnapshot.value = null; validationHint.value = ''
  try {
    const result = await runner.execute(key, path, payload, method)
    pending.value = runner.pending()
    notice.value = autoReturnNotice(result) || '服务器已受理，页面将读取最新状态。'
    return result
  } catch (cause) {
    showError(cause)
    if (cause.status === 409) await refreshConflict(path)
    return null
  }
  finally { saving.value = false }
}


// 用途：把失败命令路径映射到可按权限重新读取的权威资源。
// 参数：path 为失败命令的固定API路径。
// 返回值：资源名称与读取函数；无对应读取端点时返回null。
function conflictTarget(path) {
  if (/^\/exports(?:\/|$)/.test(path || '')) {
    return { label: '导出范围', load: async () => {
      const ids = [...new Set(exportScopeIDs.value.map(String))].filter(Boolean).slice(0, 100)
      if (!ids.length) return null
      const results = await Promise.allSettled(ids.map((id) => api.request(`/claims/${encodeURIComponent(id)}`)))
      const claims = results.filter((row) => row.status === 'fulfilled' && row.value).map((row) => row.value)
      return claims.length ? { claims, missing: ids.length - claims.length } : null
    },
    describe: (value) => `导出范围 ${value.claims.length} 张单据：${value.claims
      .map((claim) => `${claim.claim_no || claim.id}@v${claim.version}（${statusLabel(claim.status)}）`)
      .join('、')}${value.missing ? `，另有 ${value.missing} 张未读取到` : ''}` }
  }
  const rules = [
    [/^\/claims\/([^/]+)/, '报销单', (id) => api.request(`/claims/${id}`)],
    [/^\/invoices\/([^/]+)/, '发票', (id) => api.request(`/invoices/${id}`)],
    [/^\/approval-tasks\/([^/]+)/, '审批任务', (id) => api.request(`/approval-tasks/${id}`)],
    [/^\/payment-exceptions\/([^/]+)/, '付款异常', (id) => api.request(`/payment-exceptions/${id}`)],
    [/^\/payments\/([^/]+)/, '付款记录', (id) => api.request(`/payments/${id}`)],
    [/^\/invoice-documents\/([^/]+)/, '发票原件', (id) => api.request(`/invoice-documents/${id}`)],
  ]
  for (const [pattern, label, load] of rules) {
    const match = pattern.exec(path || '')
    if (match && match[1] !== 'upload-sessions') return { label, load: () => load(encodeURIComponent(match[1])) }
  }
  const config = /^\/configurations\/([^/]+)(?:\/([^/]+))?/.exec(path || '')
  if (config) {
    const kind = config[1]
    return { label: '配置版本', load: async () => {
      const result = await api.request(`/configurations/${encodeURIComponent(kind)}`)
      const id = config[2] || policyID.value
      return (result?.items || []).find((row) => row.id === id) || null
    } }
  }
  if (/^\/reversal-requests\//.test(path || '')) {
    return { label: '冲正申请', load: async () => {
      if (!selected.value?.id) return null
      const claim = await api.request(`/claims/${encodeURIComponent(selected.value.id)}`)
      await loadReversals()
      const row = reversalRequests.value.find((item) => item.id === reversalID.value)
      return row || claim
    } }
  }
  return null
}

// 用途：把冲突资源整理为可核对的单行摘要。
// 参数：label 为资源名称，value 为最新权威对象。
// 返回值：包含版本、状态及标识的中文说明。
function conflictSummary(label, value) {
  if (!value || typeof value !== 'object') return `${label}：已更新，请刷新后核对。`
  const parts = []
  const version = value.version ?? value.content_version
  if (version !== undefined && version !== null) parts.push(`版本 ${version}`)
  if (value.status) parts.push(`状态 ${statusLabel(value.status)}`)
  const identity = value.title || value.claim_no || value.invoice_number
    || value.code || value.id
  if (identity) parts.push(`标识 ${identity}`)
  return `${label}：${parts.join(' · ') || '已更新，请刷新后核对'}`
}

// 用途：读取冲突对象最新状态供核对，保留尚未保存表单及原版本。
// 参数：path 为失败命令固定API路径。
// 返回值：无；刷新失败单独提示，不掩盖原始业务错误。
async function refreshConflict(path) {
  const target = conflictTarget(path)
  if (!target) {
    conflictSnapshot.value = { text: '服务器状态已变化，请刷新当前列表后重新操作。' }
    return
  }
  conflictSnapshot.value = { text: `${target.label}：正在读取服务器最新状态…` }
  try {
    const value = await target.load()
    conflictSnapshot.value = value
      ? { text: `${target.describe ? target.describe(value) : conflictSummary(target.label, value)}；当前编辑仍保留，请核对后重新操作。` }
      : { text: `${target.label}：未找到可核对的最新记录，请刷新列表后重试。` }
    if (value) notice.value = '已读取服务器最新状态，当前编辑仍保留。请核对差异后重新打开最新版本再修改。'
  } catch {
    conflictSnapshot.value = { text: `${target.label}：最新状态读取失败，请稍后刷新核对。` }
    notice.value = '读取最新状态暂时失败；当前输入保留，请稍后刷新核对。'
  }
}

// 用途：按字段名查找已标注的表单锚点。
// 参数：name 为服务端字段坐标。
// 返回值：匹配字段的控件或容器；无匹配时为null。
function fieldElement(name) {
  return [...document.querySelectorAll('[data-field]')]
    .find((element) => element.dataset.field === name) || null
}

// 用途：滚动到校验目标并把键盘焦点落在可聚焦控件上。
// 参数：element 为字段控件或费用行容器。
// 返回值：无。
function revealElement(element) {
  if (!element) return
  element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (typeof element.focus === 'function'
    && element.matches('input,select,textarea,button,a[href],[tabindex]')) element.focus()
}

// 用途：定位服务器指出的具体费用行或字段，避免用户逐项查找。
// 参数：field 为服务端items[index].field、items.index.field或顶层字段坐标。
// 返回值：无；坐标与控件键不一致时按别名逐级回退，仍无锚点则给出可见提示。
const fieldCoordinateAliases = {
  amount_minor: ['requested_minor'],
  requested_amount: ['requested_minor'],
  requested_amount_minor: ['requested_minor'],
  payable_amount: ['payable_minor'],
  payee_profile: ['payee_profile_id'],
  payee_tax_id: ['payee_profile_id'],
  tax_id: ['payee_profile_id'],
  invoice_seller_name: ['seller_name'],
  invoice_buyer_name: ['buyer_name'],
}
async function focusValidation(field) {
  const name = String(field || '').trim()
  if (!name) return
  await nextTick()
  validationHint.value = ''
  if (typeof document === 'undefined') return
  const item = /^items(?:\[(\d+)\]|\.(\d+))(?:\.(.+))?$/.exec(name)
  if (item) {
    const index = Number(item[1] ?? item[2])
    const row = document.querySelector(`[data-expense-index="${index}"]`)
    if (row) {
      const sub = item[3] || ''
      const subControl = sub
        ? [...row.querySelectorAll('[data-field]')].find((element) => element.dataset.field === sub)
        : null
      revealElement(subControl?.matches('input,select,textarea,button,[tabindex]') ? subControl : row)
      return
    }
  }
  const leaf = name.split('.').pop()
  const candidates = [...new Set([
    name,
    `draft.${name}`,
    leaf,
    `draft.${leaf}`,
    ...(fieldCoordinateAliases[leaf] || []),
    ...(fieldCoordinateAliases[name.replace(/^draft\./, '')] || []),
  ].filter(Boolean))]
  for (const candidate of candidates) {
    const direct = fieldElement(candidate)
    if (direct) { revealElement(direct); return }
  }
  validationHint.value = `字段坐标 ${name} 暂未对应到页面输入框，请展开对应区域核对后重试。`
}

// 用途：判断字段错误是否指向当前控件，供 aria-invalid 显示可见标红。
// 参数：field 为页面字段名，index 为可选的费用行序号。
// 返回值：该控件命中任一服务端或客户端字段错误时为 true。
function invalidField(field, index = null) {
  return fieldErrors.value.some((row) => {
    const name = String(row.field || '')
    if (index !== null) {
      const match = /^items(?:\[(\d+)\]|\.(\d+))(?:\.(.+))?$/.exec(name)
      if (!match || Number(match[1] ?? match[2]) !== index) return false
      const sub = match[3] || ''
      return !sub || sub === field || (fieldCoordinateAliases[sub] || []).includes(field)
    }
    const leaf = name.split('.').pop()
    return leaf === field || (fieldCoordinateAliases[leaf] || []).includes(field)
  })
}

// 用途：查询尚未确认的原命令结果，避免重新登记付款。
// 参数：无。
// 返回值：无；保留未提交或不可用时的原命令。
async function resolvePending() {
  if (saving.value) return
  saving.value = true
  try {
    const operation = pending.value?.key
    const result = await runner.resolve()
    pending.value = runner.pending()
    if (await applyRecoveredResult(operation, result) === false) return
    notice.value = autoReturnNotice(result) || `原命令已确认：${result.id || result.claim_id || '已提交'}；请刷新查看最新状态。`
    await load()
  } catch (cause) { showError(cause) }
  finally { saving.value = false }
}

// 用途：查询后重放保存的原始命令，明确复用原命令ID和内容。
// 参数：无。
// 返回值：无；成功后刷新真实业务状态。
async function retryPending() {
  if (saving.value) return
  saving.value = true
  try {
    const operation = pending.value?.key
    const result = await runner.retry()
    pending.value = runner.pending()
    if (await applyRecoveredResult(operation, result) === false) return
    notice.value = autoReturnNotice(result) || '原命令结果已确认，请刷新查看最新详情。'
    await load()
  } catch (cause) { showError(cause) }
  finally { saving.value = false }
}

// 用途：将原命令回执恢复到当前业务对象，不另造命令或丢失草稿ID。
// 参数：operation 为原动作，result 为服务器冻结结果。
// 返回值：无；上传会话恢复时继续使用同一文件和同一会话。
async function applyRecoveredResult(operation, result) {
  if (operation === 'claim.create' || operation === 'claim.update') await openClaim(result.id)
  if (operation === 'payment.record') payment.value = result
  if (operation === 'claim.reopen' || operation === 'claim.approved_void') await openClaim(result.id)
  if (operation === 'payment.exception.record' || operation === 'payment.exception.review') {
    await openPaymentException(result.id); await loadPaymentExceptions()
  }
  if (operation === 'export.create') exportJob.value = result
  if (operation === 'invoice.reparse') parseRun.value = result
  if (operation === 'invoice.create') { manualInvoiceForm.value = null; await openInvoice(result.id) }
  if (operation === 'config.save' || operation === 'config.publish') selectPolicy(result)
  if (operation === 'config.retire' || operation === 'config.replace') applyLifecycleResult(result)
  if (operation === 'document.complete') applyUploadCompletion(result, queuedUpload?.purpose, result.file_id, queuedUpload?.voucherDestination)
  if (operation === 'document.upload') {
    documentID.value = result.document_id
    if (!queuedUpload) {
      showError(new Error('原上传会话已确认，但当前页面未保留原文件，请读取原件状态核对后继续。'))
      return false
    }
    return !!(await uploadContent(result, queuedUpload.file, queuedUpload.purpose))
  }
}

// 用途：新建费用项，并把URL项目参数仅作为未授权选择提示。
// 参数：无。
// 返回值：无；新增内存表单项。
function addItem() {
  draft.value.items.push({ id: createRequestID(), fee_type: '', occurred_date: todayBusinessDate(),

    amount: '', expense_nature:'ACTUAL',reason: '', exception_reason: '', travel_exception: false,
    city_level: '', city_code: '', transport_category: '', accommodation_category: '',
    no_invoice_proof_type: '', no_invoice_evidence_text: '', grade: '', units: 1, no_invoice_reason: '',
    historical_tail_reason: '', historical_tail_evidence_text: '',
    travel_confirmation: { decision: '', reason: '', evidence_text: '' },
    allocation_mode: 'AMOUNT',
    allocations: [{ project_id: '', service_item_id: '', amount: '', ratio:'' }], invoice_usages: [] })
}

// 用途：默认读取本人报告阶段项目或按业务名搜索，旧结果不覆盖新查询。
// 参数：next为是否读取服务器给出的下一页游标。
// 返回值：无；只展示当前资格与正常阶段均有效的引用，失败保留明确提示。
async function searchProjects(next = false) {
  const ticket = ++projectSequence
  const more = next === true
  projectLoading.value = true; projectError.value = ''
  try {
    const query = new URLSearchParams({ keyword: keyword.value.trim(), page_size: '20' })
    if (more && projectCursor.value) query.set('cursor', projectCursor.value)
    const result = await api.request(`/project-options?${query}`)
    if (ticket !== projectSequence) return
    if (!Array.isArray(result.items)) throw new Error('项目选项响应不完整')
    const choices = result.items.filter(normalProjectReference)
    projectOptions.value = choices
    projectCursor.value = typeof result.next_cursor === 'string' ? result.next_cursor : ''
    for (const row of choices) {
      projectLabels.value[`${row.project_id}/${row.service_item_id || ''}`] = projectReferenceLabel(row)
    }
  } catch {
    if (ticket === projectSequence) {
      projectOptions.value = []; projectCursor.value = ''
      projectError.value = '本人可用项目读取失败，请重新查询；不能据历史标签判断当前资格。'
    }
  } finally { if (ticket === projectSequence) projectLoading.value = false }
}

// 用途：为翻页后仍关联的项目保留业务标签，不将缓存名称当作当前资格。
// 参数：allocation为草稿当前项目和服务项引用。
// 返回值：已核对的业务名称或明确的待核对提示，不显示内部编号。
function selectedProjectLabel(allocation) {
  return projectLabels.value[`${allocation.project_id}/${allocation.service_item_id || ''}`]
    || '已关联项目（等待当前资格核对）'
}

// 用途：根据真实任职及唯一有效费用档案设置组织线路，并选择唯一可用主体和本人收款资料。
// 参数：orgID为用户选择的真实任职组织，留空采用服务端默认上下文。
// 返回值：上下文是否明确；歧义时显示说明且不猜默认线路。
function applyDraftContext(orgID = '') {
  const context = resolveDraftContext(editorOptions.value, orgID)
  if (!context.ready) { notice.value = context.message; draft.value.route_type = ''; return false }
  draft.value.org_id = context.org_id
  draft.value.route_type = context.route_type
  const entities = financeEntityChoices(editorOptions.value, context.org_id)
  if (!entities.some((row) => row.id === draft.value.finance_entity_id)) {
    draft.value.finance_entity_id = entities.length === 1 ? entities[0].id : ''
  }
  const profiles = payeeChoices(editorOptions.value)
  if (!profiles.some((row) => row.id === draft.value.payee_profile_id)) {
    draft.value.payee_profile_id = profiles.length === 1 ? profiles[0].id : ''
  }
  return true
}

// 用途：把付款主体引用回显为业务名称，缺少选项时明确标注，
// 而不是显示内部ID。
// 参数：id 为草稿或单据当前保存的付款主体引用。
// 返回值：可展示名称；空引用返回空串。
function financeEntityLabel(id) {
  if (!id) return ''
  const rows = Array.isArray(editorOptions.value?.finance_entities)
    ? editorOptions.value.finance_entities : []
  return rows.find((row) => row.id === id)?.name || '已保存（当前选项未包含）'
}

// 用途：把本人收款资料引用回显为业务名称，
// 不暴露账户引用或内部编号。
// 参数：id 为草稿或单据当前保存的收款资料引用。
// 返回值：可展示名称；空引用返回空串。
function payeeProfileLabel(id) {
  if (!id) return ''
  const rows = Array.isArray(editorOptions.value?.payee_profiles)
    ? editorOptions.value.payee_profiles : []
  return rows.find((row) => row.id === id)?.name || '已保存（当前选项未包含）'
}

// 用途：保留原单据已保存但当前选项未包含的主体与收款资料，
// 避免静默清空。
// 参数：claim 为刚读取的权威单据。
// 返回值：需要提示时的中文说明；无需保留返回空串。
function restoreSavedChoices(claim) {
  const kept = []
  if (claim.finance_entity_id && !draft.value.finance_entity_id) {
    draft.value.finance_entity_id = claim.finance_entity_id
    kept.push('付款主体')
  }
  if (claim.payee_profile_id && !draft.value.payee_profile_id) {
    draft.value.payee_profile_id = claim.payee_profile_id
    kept.push('收款资料')
  }
  if (!kept.length) return ''
  return `已保留原单据的${kept.join('与')}（当前选项未包含），提交前请核对。`
}

// 用途：把地址栏可识别的筛选参数回填到筛选表单，保证深链参数可见。
// 参数：无。
// 返回值：无；只接受字符串参数，不猜测数组或对象。
function hydrateFiltersFromRoute() {
  const keys = ['q','status','claim_type','date_from','date_to','invoice_type',
    'verification_status','review_status','route_type']
  const query = route.query || {}
  for (const key of keys) {
    const value = query[key]
    if (typeof value === 'string' && value) listFilters.value[key] = value
  }
}

// 用途：读取当前付款单据的受控账户选项，失败不允许手填引用绕过。
// 参数：claimID为服务器返回的当前报销单引用。
// 返回值：无；只更新当前单据的选项，不改变付款事实。
async function loadPaymentOptions(claimID) {
  const ticket = ++paymentOptionsSequence
  paymentOptions.value = { source_accounts: [], payee_profiles: [] }; paymentOptionsError.value = ''
  try {
    const value = await api.request(`/claims/${encodeURIComponent(claimID)}/payment-options`)
    if (ticket !== paymentOptionsSequence) return
    if (!Array.isArray(value.source_accounts)) throw new Error('invalid options')
    paymentOptions.value = value
  } catch {
    if (ticket === paymentOptionsSequence) paymentOptionsError.value = '付款账户读取失败，请重新读取单据后核对。'
  }
}

// 用途：追加当前政策可见的组织并保留数组协议与业务名称。
// 参数：row为按已选人员范围查询到的真实组织选项。
// 返回值：无；取消选择不删除已有组织关联。
function addPolicyOrganization(row) {
  if (!row?.id) return
  policyForm.value.org_ids = [...new Set([...(policyForm.value.org_ids || []), row.id])]
  policyOrganizationNames.value[row.id] = row.name
}

// 用途：保存政策对象的业务名称，人员切换后清除旧人员所属组织关联。
// 参数：field为业务字段，row为选择器返回的真实对象或清空事件。
// 返回值：无；内部ID仍仅用于DTO，不作为展示名称。
function rememberPolicyObject(field, row) {
  policyObjectNames.value[field.key] = row?.name || row?.project_name || ''
  if (field.type === 'person') {
    if ('org_id' in policyForm.value) policyForm.value.org_id = ''
    if ('org_ids' in policyForm.value) policyForm.value.org_ids = []
  }
}

// 用途：按业务对象字段指定固定选项来源，调用方不能输入外部地址。
// 参数：field为政策业务字段定义。
// 返回值：当前字段使用的固定站内选项路径。
function policyObjectSource(field) {
  return { person: '/personnel-options', organization: '/organization-options',
    project: '/project-options', 'finance-entity': '/configuration-options' }[field.type] || ''
}

// 用途：限定政策姓名、组织及主体选项的显式查询用途，不传入无关表单信息。
// 参数：field为当前政策字段。
// 返回值：固定用途或已选人员标识等受控查询条件。
function policyObjectParams(field) {
  if (field.type === 'person') return { purpose: 'policy' }
  if (field.type === 'organization') return policyForm.value.subject_id ? { subject_id: policyForm.value.subject_id } : {}
  return field.type === 'finance-entity' ? { kind: 'finance_entities' } : {}
}

// 用途：从报销付款入口跳转项目管理侧维护项目费用参与人。
// 参数：option 为已查询到的授权项目选项。
// 返回值：无；路由只提供入口，参与资格仍由项目管理侧校验。
function openProjectExpenseParticipants(option) {
  if (!option?.project_id) return
  router.push({ name: 'project_management', params: { section: 'project_detail' }, query: { project: option.project_id } })
}

// 用途：应用筛选并重置分页，避免保留上一查询的末页。
// 参数：无。
// 返回值：无；真实服务端错误保留输入并显示。
async function applyFilters() { page.value=1; await load() }

// 用途：清除手工筛选，固定业务子入口约束仍由查询构造保留。
// 参数：无。
// 返回值：无；重新读取第一页。
async function resetFilters() {
  Object.keys(listFilters.value).forEach(key=>{listFilters.value[key]=''})
  await applyFilters()
}

// 用途：从项目归档聚合定位该项目的当前可见报销单。
// 参数：projectID为服务端返回的授权项目坐标。
// 返回值：无；路由查询不替代服务端范围核验。
function openArchiveProject(projectID) {
  if (!discardDraft()) return
  selected.value=null;archives.value=null
  router.push({name:'reimbursement',params:{section:'archives'},query:{project_id:projectID}})
}

// 用途：切换金额与比例输入时清除另一套输入，不保留冲突权威值。
// 参数：item 为费用项；mode为用户选择模式。
// 返回值：无；历史服务端金额仅用于回显，保存前重新派生。
function changeAllocationMode(item, mode) {
  item.allocation_mode=mode
  item.allocations.forEach(row=>{row.amount='';row.ratio=''})
}

// 用途：显示比例派生金额供用户核对，失败时保持待校验。
// 参数：item为费用项，index为当前分摊行。
// 返回值：元金额文本或未满足完整比例的提示。
function ratioAmount(item,index) {
  try {return formatMinor(allocationInput(item).allocations[index].amount_minor)}
  catch {return '比例待校验'}
}

// 用途：把精确金额转换为相对条形宽度，零数据不显示虚构趋势。
// 参数：row为统计分组，group为同口径分组集合。
// 返回值：0至100的显示宽度，不参与财务计算。
function statisticWidth(row,group) {
  const maximum=(group || []).reduce((max,item)=>BigInt(item.amount_minor)>max?BigInt(item.amount_minor):max,0n)
  return maximum>0n?Number(BigInt(row.amount_minor)*100n/maximum):0
}

// 用途：读取本人已确认票据供可视选择，仍由保存/提交重新核验资格。
// 参数：无。
// 返回值：无；加载失败不把旧选项当最新资格。
async function loadInvoiceChoices() {
  try {
    const value=await api.request('/invoices?review_status=CONFIRMED&page=1&page_size=100')
    invoiceChoices.value=value.items || []
    if (value.total>100) notice.value='已加载前100张，请在发票台账筛选后勾选生成草稿。'
  } catch(cause) {showError(cause)}
}

// 用途：把所选确认票据生成待编辑费用，保留项目/标准/审批的正式校验。
// 参数：无。
// 返回值：无；缺映射或票据不可用时保留选择，不生成假成功。
async function createDraftFromInvoices() {
  try {
    if (!selectedInvoiceIDs.value.length) throw new Error('请先勾选已确认的本人票据')
    if (draftDirty.value && selected.value) throw new Error('请先保存当前草稿，避免覆盖未保存费用')
    const suggestions=await api.request('/invoice-expense-suggestions',{
      method:'POST',body:JSON.stringify({invoice_ids:selectedInvoiceIDs.value})})
    if (!Array.isArray(suggestions) || !suggestions.length) throw new Error('费用建议响应不完整')
    invoiceSuggestions.value=suggestions
    if (suggestions.some(row=>row.classification_status==='NEEDS_REVIEW' || !row.fee_type)) {
      throw new Error('所选票据需要人工归类，请先核对下方命中依据；也可新建草稿人工选择费用类别')
    }
    await newDraft()
    if (!selected.value) return
    draft.value.title='发票费用报销'
    draft.value.items=[]
    for(const suggestion of suggestions) {
      addItem()
      Object.assign(draft.value.items.at(-1),{fee_type:suggestion.fee_type,occurred_date:suggestion.occurred_date,
        amount:formatMinor(suggestion.requested_minor),invoice_usages:[{invoice_id:suggestion.invoice_id,
          amount:formatMinor(suggestion.requested_minor)}]})
    }
    navigate('claims')
    notice.value='费用已预填，请确认组织、付款资料、项目分摊及费用标准后保存；尚未提交审批。'
    if(suggestions.some(row=>row.deduction_review_required))notice.value+=' 所选票种包含优先抵扣资料复核提示，须交财务人工确认，不代表已可抵扣。'
  } catch(cause) {showError(cause)}
}

// 用途：将项目选项的服务项和项目ID一起绑定，避免任意URL绑定。
// 参数：allocation 为分摊行，event 为选择事件。
// 返回值：无；更新选中引用。
function selectProject(allocation, event) {
  if (event.target.value === 'retained') return
  const option = event.target.value === '' ? null : projectOptions.value[Number(event.target.value)]
  if (option && !normalProjectReference(option)) {
    showError(new Error('当前引用尚未达到报告阶段或缺少有效费用资格，请重新选择'))
    return
  }
  allocation.project_id = option?.project_id || ''
  allocation.service_item_id = option?.service_item_id || ''
}

// 用途：查找当前分摊的权威项目状态和行程事实，仅用于展示。
// 参数：allocation 为项目与可选服务项引用。
// 返回值：本次搜索返回的引用；未加载时为空，不推断授权或行程。
function referenceFor(allocation) {
  return projectOptions.value.find((reference) => reference.project_id === allocation.project_id
    && (reference.service_item_id || '') === (allocation.service_item_id || '')) || null
}

// 用途：维持项目选择控件与已保存引用的一致显示。
// 参数：allocation 为当前分摊引用。
// 返回值：匹配选项序号；尚未加载或已清空时返回空值。
function selectedProjectOption(allocation) {
  const index = projectOptions.value.findIndex((option) => option.project_id === allocation.project_id
    && (option.service_item_id || '') === (allocation.service_item_id || ''))
  return index < 0 ? allocation.project_id ? 'retained' : '' : index
}

// 用途：展示当前费用已分摊合计，供保存前核对。
// 参数：item 为正在编辑的费用项。
// 返回值：元金额文本；非法输入显示待校验。
function allocationTotal(item) {
  try { return formatMinor(String(allocationInput(item).allocations.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n))) }
  catch { return '待校验' }
}

// 用途：读取发票当前权威可用量，避免把票面总额当剩余可用量。
// 参数：id 为待核对发票ID。
// 返回值：无；缺少剩余字段时明确显示不可用。
async function checkInvoice(id) {
  try { invoiceFacts.value = { ...invoiceFacts.value, [id]: await api.request(`/invoices/${encodeURIComponent(id)}`) } }
  catch (cause) { showError(cause) }
}

// 用途：汇总同一票据在当前草稿全部费用项中的使用金额。
// 参数：id 为票据ID。
// 返回值：精确元金额文本；非法输入显示待校验。
function draftInvoiceUsage(id) {
  try {
    const usages = draft.value.items.flatMap((item) => item.invoice_usages).filter((row) => row.invoice_id === id)
    return formatMinor(String(usages.reduce((sum, row) => sum + BigInt(toMinor(row.amount)), 0n)))
  } catch { return '待校验' }
}

// 用途：构造只包含可编辑字段的完整草稿请求。
// 参数：无。
// 返回值：精确金额的草稿DTO；校验失败抛错。
function claimPayload() {
  const value = draft.value
  if (editorOptions.value) {
    const context = resolveDraftContext(editorOptions.value, value.org_id)
    if (!context.ready) throw new Error(context.message)
    value.route_type = context.route_type
  }
  const items = value.items.map((item, index) => {
    try { return editableClaimItem(item) } catch (cause) {
      const leaf = /金额/.test(cause.message) ? 'requested_minor'
        : /证据|文件/.test(cause.message) ? 'no_invoice_evidence_file_ids'
          : /差旅/.test(cause.message) ? 'travel_confirmation' : ''
      throw Object.assign(cause, { details: [{
        field: `items[${index}]${leaf ? `.${leaf}` : ''}`, message: cause.message,
      }] })
    }
  })

  validateItems(items)
  return { title: value.title, claim_type:value.claim_type, remark:value.remark,
    org_id: value.org_id, route_type: value.route_type,
    currency: 'CNY', finance_entity_id: value.finance_entity_id, payee_profile_id: value.payee_profile_id,
    items, expected_version: selected.value?.version || 0 }
}

// 用途：创建服务端草稿或更新已有草稿，成功后保留服务端ID和版本。
// 参数：无。
// 返回值：无；写失败保持现有输入。
async function saveDraft() {
  try {
    const payload = claimPayload()
    const result = await mutate(selected.value ? 'claim.update' : 'claim.create', selected.value ? `/claims/${selected.value.id}` : '/claims',
      payload, selected.value ? 'PATCH' : 'POST')
    if (result) { await openClaim(result.id, true); await load() }
  } catch (cause) { showError(cause) }
}

// 用途：把刚打开的详情滚动到视口，避免用户以为点击没有反应。
// 参数：无。
// 返回值：无；仅操作当前详情容器。
async function revealDetail() {
  await nextTick()
  if (typeof detailPanel.value?.scrollIntoView === 'function') {
    detailPanel.value.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
}

// 用途：从详情返回列表，并清理已确认放弃的草稿与深链参数。
// 参数：kind 为 claim、invoice 或 approval，决定要关闭的详情。
// 返回值：无；有未保存草稿时先确认。
async function backToList(kind = 'claim') {
  if (!discardDraft()) return
  if (kind === 'invoice') {
    selectedInvoice.value = null; invoiceRows.value = []; selectedSource.value = null
  } else if (kind === 'approval') {
    approvalTask.value = null; approvalHistory.value = []; historyError.value = ''
  } else {
    selected.value = null; claimFormOpen.value = false
    draft.value = blankDraft(); draftBaseline.value = ''
  }
  const query = { ...route.query }
  delete query.claim_id
  router.replace({ name: 'reimbursement', params: { section: workspace.value }, query })
  await nextTick()
  heading.value?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  heading.value?.focus?.()
}

// 用途：读取单据详情并建立可编辑副本，不把只读字段回传。
// 参数：id 为服务器单据ID，force 表示保存成功后跳过重复放弃确认。
// 返回值：无；详情读取失败保持表单。
async function openClaim(id, force = false) {
  if (!force && selected.value?.id !== String(id) && !discardDraft()) return
  const ticket = ++detailSequence
  try {
    const result = await api.request(`/claims/${encodeURIComponent(id)}`)
    if (ticket !== detailSequence) return
    selected.value = result
    claimFormOpen.value = true
    exceptionRows.value = null; selectedException.value = null; exceptionPage.value = 1
    exceptionForm.value.payee_profile_id = result.payee_profile_id || ''
    projectValidation.value = null
    draft.value = { ...result, items: (result.items || []).map((item) => ({ ...item,
      amount: formatMinor(item.requested_minor),
      historical_tail_reason: item.historical_tail_reason || '',
      historical_tail_evidence_text: (item.historical_tail_evidence_file_ids || []).join(','),
      no_invoice_evidence_text: (item.no_invoice_evidence_file_ids || []).join(','),
      travel_confirmation: { decision: item.travel_confirmation?.decision || '',
        reason: item.travel_confirmation?.reason || '',
        evidence_text: (item.travel_confirmation?.evidence_file_ids || []).join(',') },
      allocations: item.allocations.map((row) => ({ ...row, amount: formatMinor(row.amount_minor),
        ratio: row.ratio_basis_points ? String(row.ratio_basis_points / 100) : '' })),
      invoice_usages: (item.invoice_usages || []).map((row) => ({ ...row, amount: formatMinor(row.used_minor) })),
    })) }
    if (section.value === 'claims' && editable.value && editorOptions.value) {
      applyDraftContext(draft.value.org_id)
      const kept = restoreSavedChoices(result)
      if (kept) notice.value = kept
    }
    if (section.value === 'claims' && editable.value && currentDraftContext.value.ready) await searchProjects()
    if (ticket !== detailSequence) return
    draftBaseline.value = stableStringify(draft.value)
    payment.value = null; archives.value = null
    reversalHistoryError.value = ''
    paymentHistory.value = []; reversalHistory.value = []; paymentHistoryError.value = ''
    paymentHistoryTotal.value = 0; paymentHistoryPage.value = 1; paymentHistoryLoaded.value = false
    // 付款与归档分区按当前分区补齐数据，避免残留面板显示成"尚无付款记录"。
    await refreshSelectedSection()
    if (ticket !== detailSequence) return
    if (route.query.claim_id !== String(id)) {
      router.replace({ name: 'reimbursement', params: { section: workspace.value },
        query: { ...route.query, claim_id: String(id) } })

    }
    await revealDetail()
  } catch (cause) { showError(cause) }
}

// 用途：在提交前核对已保存版本的全部项目引用，不以预检代替正式提交校验。
// 参数：无。
// 返回值：无；依赖故障保留草稿和明确原因。
async function validateProjects() {
  if (!selected.value) return
  try {
    projectValidation.value = await api.request('/project-references/validate', { method: 'POST',
      body: JSON.stringify({ claim_id: selected.value.id, draft_version: selected.value.version,
        expected_version: selected.value.version, command_id: createRequestID() }) })

  } catch (cause) { showError(cause) }
}

// 用途：提交、撤回或作废当前单据，始终绑定当前版本。
// 参数：action 为固定业务命令。
// 返回值：无；成功后重新读取单据。
async function claimAction(action) {
  if (action === 'submit' && draftDirty.value) {
    showError(new Error('当前修改尚未保存，请先保存草稿再提交'))
    return
  }
  const result = await mutate(`claim.${action}`, `/claims/${selected.value.id}/${action}`,
    { expected_version: selected.value.version })
  if (result) { await openClaim(selected.value.id); await load() }
}

// 用途：按任务轮次及任务版本执行审批动作。
// 参数：task 为当前待办，action 为服务端允许的动作。
// 返回值：无；成功后刷新待办。
async function approve(task, action) {
  if (action === 'TRANSFER' && approvalTask.value?.id !== task.id) {
    await openApproval(task.id)
    notice.value = '已读取当前待办，请选择该任务允许的转交人员后再次确认。'
    return
  }
  if (action === 'TRANSFER' && !transferSubject.value) {
    showError(new Error('请选择当前任务允许的转交人员'))
    return
  }
  const result = await mutate('approval.action', `/approval-tasks/${task.id}/actions`,
    { expected_version: task.claim_version, round: task.round, task_version: task.version,
      action, reason: approvalReason.value, target_subject_id: transferSubject.value })
  if (result) {
    pendingApprovalAction.value = ''
    notice.value = autoReturnNotice(result)
      || `审批动作「${approvalActionLabel(action)}」已提交，任务列表已刷新。`
    await load()
    if (approvalTask.value?.id === task.id) await openApproval(task.id)
  }
}

// 用途：把审批动作编码转换为业务按钮文案。
// 参数：action 为服务端允许的动作。
// 返回值：中文动作名；未知动作显示待确认。
function approvalActionLabel(action) {
  return { APPROVE: '同意', RETURN: '退回', TRANSFER: '转交', ADDSIGN: '加签' }[action] || '该动作'
}

// 用途：在详情内先校验原因和目标，再进入二次确认，不直接执行审批。
// 参数：action 为服务端允许的动作。
// 返回值：无；缺少原因或目标时给出可见提示。
function requestApprovalAction(action) {
  if (!approvalTask.value) return
  if (action === 'RETURN' && !approvalReason.value.trim()) {
    showError(new Error('退回前请填写审批说明，说明将写入审批历史')); return
  }
  if (['TRANSFER', 'ADDSIGN'].includes(action) && !transferSubject.value.trim()) {
    showError(new Error('转交或加签前请填写目标主体')); return
  }
  pendingApprovalAction.value = action
}

// 用途：二次确认后提交审批动作，避免误点直接改变单据状态。
// 参数：无。
// 返回值：无；提交后刷新任务与历史。
async function confirmApprovalAction() {
  const action = pendingApprovalAction.value
  if (!action || !approvalTask.value) return
  await approve(approvalTask.value, action)
}

// 用途：取消二次确认，保持当前原因和目标。
// 参数：无。
// 返回值：无。
function cancelApprovalAction() {
  pendingApprovalAction.value = ''
}

// 用途：读取服务端按任务范围裁剪的固定审批快照。
// 参数：id 为当前待办ID。
// 返回值：无；不额外请求整单或发票原件。
async function openApproval(id) {
  const ticket = ++approvalSequence
  approvalHistory.value = []; historyError.value = ''
  try {
    const task = await api.request(`/approval-tasks/${encodeURIComponent(id)}`)
    if (ticket !== approvalSequence) return
    if (approvalTask.value?.id !== task.id) transferSubject.value = ''
    approvalTask.value = task
    pendingApprovalAction.value = ''
    approvalReason.value = ''
    transferSubject.value = ''
    await loadApprovalHistory()
    await revealDetail()
  } catch (cause) { if (ticket === approvalSequence) showError(cause) }
}

// 用途：读取授权任务每跳历史，保留当时原新受理人与资格证据。
// 参数：无。
// 返回值：无；查询失败保持独立错误态，不用当前受理人补造历史。
async function loadApprovalHistory() {
  if (!approvalTask.value) return
  const ticket = approvalSequence
  const id = approvalTask.value.id
  historyLoading.value = true; historyError.value = ''
  try {
    const result = await api.request(`/approval-tasks/${encodeURIComponent(id)}/history`)
    if (ticket !== approvalSequence) return
    if (!Array.isArray(result.items)) throw new Error('审批历史响应不完整')
    approvalHistory.value = result.items
  } catch (cause) {
    if (ticket === approvalSequence) historyError.value = cause.message || '审批历史暂不可用'
  } finally { if (ticket === approvalSequence) historyLoading.value = false }
}

// 用途：读取当前单据可用受控付款账户与收款档案，付款表单只按业务名称选择。
// 参数：无。
// 返回值：无；失败保留原因，不退回手填账户。
async function loadPaymentAccountOptions() {
  paymentAccounts.value = []; paymentPayeeProfiles.value = []
  paymentOptionError.value = ''; paymentOptionsLoaded.value = false
  const claimID = selected.value?.id
  if (!claimID || !can('expense.payment.record')) { paymentOptionsLoaded.value = true; return }
  await loadPaymentOptions(claimID)
  if (selected.value?.id !== claimID) return
  paymentAccounts.value = paymentOptions.value.source_accounts
  paymentPayeeProfiles.value = paymentOptions.value.payee_profiles || []
  paymentOptionError.value = paymentOptionsError.value
  paymentOptionsLoaded.value = true
}

// 用途：把当前收款档案显示为业务信息，避免只留一个内部编号。
// 参数：无。
// 返回值：收款档案说明；未返回名称时说明以批准快照为准。
const paymentPayeeLabel = computed(() => {
  const id = selected.value?.payee_profile_id
  if (!id) return '按批准快照中的收款档案付款'
  const profile = paymentPayeeProfiles.value.find((row) => row.id === id)
  return profile ? `${profile.name || '已审核收款档案'} · 账户引用 ${profile.account_ref || '未返回'} · v${profile.version ?? '未返回'}`
    : '按批准快照中的收款档案付款（当前选项未返回账户引用）'
})

// 用途：登记当前批准单据全额付款事实。
// 参数：无。
// 返回值：无；成功展示服务器付款记录，不伪称银行已执行转账。
async function registerPayment() {
  if (!selected.value) return
  if (!paymentForm.value.source_account_ref) { showError(new Error('请选择受控付款账户后再登记付款')); return }
  const result = await mutate('payment.record', `/claims/${selected.value.id}/payments`,
    { ...paymentForm.value, expected_version: selected.value.version,
      amount_minor: selected.value.payable_minor, currency: selected.value.currency,
      payee_profile_id: selected.value.payee_profile_id,
      voucher_file_ids: splitIDs(paymentForm.value.voucher_file_ids) })
  if (result) { await openClaim(selected.value.id); payment.value = result; await load() }
}

// 用途：按服务端允许动作重开或作废无有效付款的待付款义务。
// 参数：action 为reopen或approved-void固定动作。
// 返回值：无；绑定原单版本与原因，成功后读取真实状态。
async function controlledClaimAction(action) {
  const allowed = { reopen: ['REOPEN', 'expense.claim.reopen'],
    'approved-void': ['APPROVED_VOID', 'expense.claim.approved_void'] }[action]
  if (!allowed || !can(allowed[1]) || !selected.value?.allowed_actions?.includes(allowed[0])) {
    showError(new Error('当前单据未授予该财务控制动作')); return
  }
  if (!claimControlReason.value.trim()) { showError(new Error('请填写重开或作废原因')); return }
  const operation = action === 'reopen' ? 'claim.reopen' : 'claim.approved_void'
  const result = await mutate(operation, `/claims/${selected.value.id}/${action}`,
    { expected_version: selected.value.version, reason: claimControlReason.value.trim() })
  if (result) { await openClaim(result.id); await load() }
}

// 用途：读取当前单据独立付款异常事实，不代替正常付款列表。
// 参数：无。
// 返回值：无；失败保持已读内容和可见错误。
async function loadPaymentExceptions() {
  if (!selected.value) return
  try {
    const query = new URLSearchParams({ page: String(exceptionPage.value), page_size: '20' })
    const result = await api.request(`/claims/${selected.value.id}/payment-exceptions?${query}`)
    if (!Array.isArray(result.items)) throw new Error('付款异常列表响应不完整')
    exceptionRows.value = result.items; exceptionTotal.value = result.total
  } catch (cause) { showError(cause) }
}

// 用途：读取不可变异常事实及当前核实游标和单据版本。
// 参数：id 为已授权异常记录ID。
// 返回值：无；核实动作始终使用该次详情的两个版本。
async function openPaymentException(id) {
  try { selectedException.value = await api.request(`/payment-exceptions/${encodeURIComponent(id)}`) }
  catch (cause) { showError(cause) }
}

// 用途：记录真实外部付款异常，金额独立于批准额且不产生付款效果。
// 参数：无。
// 返回值：无；非法输入保留事实表单，成功后只读取异常状态。
async function recordPaymentException() {
  if (!selected.value || !can('expense.payment.exception.record')) return
  try {
    const form = exceptionForm.value
    const vouchers = boundedEvidence(form.voucher_file_ids)
    const amount = toMinor(form.amount)
    if (BigInt(amount) <= 0n || !form.reason.trim()) throw new Error('请核对实际正向付款金额并填写异常原因')
    const { amount: _amount, ...fields } = form
    const result = await mutate('payment.exception.record', `/claims/${selected.value.id}/payment-exceptions`,
      { ...fields, expected_version: selected.value.version, amount_minor: amount, voucher_file_ids: vouchers })
    if (result) { await openPaymentException(result.id); await loadPaymentExceptions() }
  } catch (cause) { showError(cause) }
}

// 用途：核实异常事实或关联已有合法账本，不在此创建付款或冲正。
// 参数：无。
// 返回值：无；绑定异常游标和单据版本，成功后读取追加核实记录。
async function reviewPaymentException() {
  const current = selectedException.value
  if (!current?.allowed_actions?.includes('REVIEW_EXCEPTION') || !can('expense.payment.exception.review')) {
    showError(new Error('当前异常未授予独立核实动作')); return
  }
  try {
    const form = exceptionReviewForm.value
    if (!form.reason.trim()) throw new Error('请填写独立核实依据')
    const payload = { decision: form.decision, reason: form.reason.trim(),
      evidence_file_ids: boundedEvidence(form.evidence_file_ids),
      expected_version: current.version, expected_claim_version: current.claim_version }
    if (form.decision === 'RESOLVE_WITH_PAYMENT' || form.decision === 'RESOLVE_WITH_REVERSAL') {
      if (!form.linked_payment_id.trim()) throw new Error('请选择已合法登记的付款记录')
      payload.linked_payment_id = form.linked_payment_id.trim()
    }
    if (form.decision === 'RESOLVE_WITH_REVERSAL') {
      if (!form.linked_reversal_id.trim()) throw new Error('请选择已批准的全额冲正记录')
      payload.linked_reversal_id = form.linked_reversal_id.trim()
    }
    const result = await mutate('payment.exception.review', `/payment-exceptions/${current.id}/reviews`, payload)
    if (result) { await openPaymentException(current.id); await loadPaymentExceptions() }
  } catch (cause) { showError(cause) }
}

// 用途：按用户选择读取付款异常下一页，不扩大当前单据范围。
// 参数：nextPage 为目标页码。
// 返回值：无；更新分页并读取真实列表。
function changeExceptionPage(nextPage) {
  exceptionPage.value = nextPage
  void loadPaymentExceptions()
}

// 用途：使用固定付款凭证用途上传异常事实或核实证据。
// 参数：event 为文件选择事件，destination 为异常事实或核实表单目标。
// 返回值：上传处理Promise；权限及文件归属由服务端重新校验。
function uploadExceptionEvidence(event, destination) {
  return uploadInvoice(event, 'reimbursement.payment.voucher', destination)
}

// 用途：按费用项和证据类别上传尾款或差旅佐证，不进入发票解析。
// 参数：itemID 为费用项ID，event 为文件事件，kind 为尾款或差旅证据类别。
// 返回值：真实上传Promise；文件用途固定且业务提交时再次校验。
function uploadClaimEvidence(itemID, event, kind) {
  return uploadInvoice(event, 'reimbursement.claim.evidence', `${kind}:${itemID}`)
}

// 用途：将已完成费用证据回填原费用项，保留有界文件引用。
// 参数：destination 为类别和费用项标识，fileID 为服务器文件ID。
// 返回值：无；当前费用项已变化或证据超界时抛错，不伪造绑定。
function attachClaimEvidence(destination, fileID) {
  const [kind, ...parts] = destination.split(':')
  const item = draft.value.items.find((row) => row.id === parts.join(':'))
  if (!item) throw new Error(`证据已上传（${fileID}），原费用项已变化，请重新读取后关联`)
  if (kind === 'claimTail') {
    item.historical_tail_evidence_text = evidenceIDs(`${item.historical_tail_evidence_text},${fileID}`).join(',')
  } else if (kind === 'claimNoInvoice') {
    item.no_invoice_evidence_text = evidenceIDs(`${item.no_invoice_evidence_text},${fileID}`).join(',')
  } else if (kind === 'claimTravel') {
    item.travel_confirmation.evidence_text = evidenceIDs(`${item.travel_confirmation.evidence_text},${fileID}`).join(',')
  } else throw new Error('费用证据类别无效')
}

// 用途：按整单当前数据范围领取费用证据票据并下载原件。
// 参数：fileID为已关联证明，claimID为当前详情或审批快照绑定的单据标识。
// 返回值：无；授权或内容失败时明确报错。
async function downloadClaimEvidence(fileID, claimID=selected.value?.id) {
  if (!claimID) return
  try {
    const permit = await api.request(`/claims/${encodeURIComponent(claimID)}/evidence/${encodeURIComponent(fileID)}/download-ticket`,
      { method: 'POST', body: '{}' })
    const target = new URL(permit.download_url, window.location.origin)
    if (target.origin !== window.location.origin || !target.pathname.startsWith('/file-gateway/')) {
      throw new Error('费用证据地址不受信任')
    }
    const response = await fetch(target.href, { credentials: 'include', cache: 'no-store',
      headers: { Authorization: `DownloadTicket ${permit.ticket}` }, signal: timeoutSignal(30000) })
    if (!response.ok) throw new Error('费用证据读取失败')
    const blob = await response.blob()
    if (blob.size > 20 * 1024 * 1024) throw new Error('费用证据超过20MiB边界')
    const url = URL.createObjectURL(blob)
    const extension = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }[blob.type] || 'bin'
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `claim-evidence.${extension}`; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (cause) { showError(cause) }
}

// 用途：校验财务证据引用数量，避免无证据或超界请求。
// 参数：value 为逗号分隔的已上传文件ID。
// 返回值：1至20个唯一文件ID；缺失或超限时抛错。
function boundedEvidence(value) {
  const ids = splitIDs(value)
  if (!ids.length || ids.length > 20) throw new Error('请提供1至20份已上传凭证或核实证据')
  return ids
}

// 用途：把显式文件ID输入转换为去重列表，文件权限由服务端重新校验。
// 参数：value 为逗号分隔文件ID。
// 返回值：非空文件ID列表。
function splitIDs(value) { return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))] }

// 用途：申请独立冲正审批，原付款事实不在页面直接改写。
// 参数：无。
// 返回值：无；展示真实申请ID。
async function requestReversal() {
  const id = payment.value?.id || selected.value?.active_payment_id
  if (!id) { showError(new Error('请选择已有付款记录的单据')); return }
  const result = await mutate('reversal.request', `/payments/${id}/reversal-requests`,
    { expected_version: selected.value.version, reason: reversalReason.value, fact_kind: reversalFact.value,
      evidence_file_ids: splitIDs(evidenceFiles.value), terminate_obligation: false })
  if (result) { reversalID.value = result.id; reversalVersion.value = result.version; notice.value = `冲正申请已受理：${result.id}`; await loadPaymentHistory() }
}

// 用途：批准或拒绝独立冲正申请。
// 参数：approve 为审批结论。
// 返回值：无；成功后刷新单据状态。
async function decideReversal(approve) {
  const result = await mutate('reversal.decide', `/reversal-requests/${encodeURIComponent(reversalID.value)}/decisions`,
    { expected_version: reversalVersion.value, approve, reason: reversalReason.value })
  if (result) { await loadPaymentHistory(); await load() }
}

// 用途：加载当前单据冲正申请及其独立版本。
// 参数：无。
// 返回值：无；错误保留先前选择。
async function loadReversals() {
  try {
    const result = await api.request(`/claims/${selected.value.id}/reversal-requests?page_size=20`)
    reversalRequests.value = result.items
  } catch (cause) { showError(cause) }
}

// 用途：选中服务端真实冲正申请，后续决定绑定申请版本。
// 参数：event 为申请选择事件。
// 返回值：无；更新申请ID和版本。
function selectReversal(event) {
  const row = reversalRequests.value.find((item) => item.id === event.target.value)
  reversalID.value = row?.id || ''; reversalVersion.value = row?.version ?? null
}

// 用途：加载当前单据付款与冲正历史，避免只看 active_payment_id 单条记录。
// 参数：nextPage 为付款历史页码，默认停留在当前页。
// 返回值：无；两段历史分别容错，失败时保留可核对的部分并提示原因。
async function loadPaymentHistory(nextPage = paymentHistoryPage.value) {
  if (!selected.value?.id || !can('expense.payment.read')) return
  const ticket = ++paymentHistorySequence
  paymentHistoryPage.value = Math.max(1, Number(nextPage) || 1)
  paymentHistoryLoading.value = true
  paymentHistoryError.value = ''; reversalHistoryError.value = ''
  paymentHistoryLoaded.value = false
  const claimID = selected.value.id
  const base = `/claims/${encodeURIComponent(claimID)}`
  const [payments, reversals] = await Promise.allSettled([
    api.request(`${base}/payments?page=${paymentHistoryPage.value}&page_size=${paymentHistoryPageSize}`),
    api.request(`${base}/reversal-requests?page=1&page_size=20`),
  ])
  if (ticket !== paymentHistorySequence || selected.value?.id !== claimID) return
  paymentHistoryLoading.value = false
  if (payments.status === 'fulfilled' && Array.isArray(payments.value?.items)) {
    paymentHistory.value = payments.value.items
    paymentHistoryTotal.value = Number(payments.value?.total) || payments.value.items.length
    paymentHistoryLoaded.value = true
  } else {
    paymentHistory.value = []
    paymentHistoryError.value = '付款历史读取失败，请稍后重试；当前有效付款仍以页面单条记录为准。'
  }
  if (reversals.status === 'fulfilled' && Array.isArray(reversals.value?.items)) {
    reversalHistory.value = reversals.value.items
  } else {
    // 冲正历史失败不能安静地空白，否则"没有冲正"和"没读出来"看起来一样。
    reversalHistory.value = []
    reversalHistoryError.value = '冲正申请读取失败，请稍后重试；这里不显示未经确认的冲正记录。'
  }
}

// 用途：把付款状态与可能的冲正关联字段合并为可读说明。
// 参数：record 为付款历史记录。
// 返回值：付款状态及冲正关联文本，缺失关联时不虚构。
function paymentHistoryStatus(record) {
  const parts = [statusLabel(record.status)]
  const reversalStatus = record.reversal_status || record.reversal_request_status
  if (reversalStatus) parts.push(`冲正：${statusLabel(reversalStatus)}`)
  const reversalID = record.reversal_request_id || record.reversal_id
  if (reversalID) parts.push(`关联 ${reversalID}`)
  const originalID = record.reversal_of_payment_id || record.original_payment_id
  if (originalID) parts.push(`冲正原付款 ${originalID}`)
  if (record.reversed_by_payment_id) parts.push(`已被冲正 ${record.reversed_by_payment_id}`)
  return parts.filter(Boolean).join(' · ')
}

// 用途：从解析异常定位本人原件与实际Job，不把运行标识当任务标识。
// 参数：row为服务端本人异常记录。
// 返回值：无；人工补录与重解析仍使用原件当前版本及能力校验。
async function openParseException(row) {
  if(saving.value || runner.pending())return
  const ticket=++detailSequence
  documentID.value=row.document_id;parseRun.value=null
  try {
    const doc=await readDocument()
    if(!doc || ticket!==detailSequence || !row.parse_job_id)return
    const job=await api.request(`/parse-runs/${encodeURIComponent(row.parse_job_id)}`)
    if(ticket===detailSequence && documentID.value===row.document_id)parseRun.value=job
  }catch(cause){if(ticket===detailSequence)showError(cause)}
}

// 用途：读取发票详情，与受控原件入口并列展示人工复核字段。
// 参数：id 为发票ID。
// 返回值：无；复核失败保留字段。
async function openInvoice(id) {
  const ticket = ++detailSequence
  try {
    const result = await api.request(`/invoices/${encodeURIComponent(id)}`)
    if (ticket !== detailSequence) return
    invoiceContentEditor.value = invoiceContentForm(result.content)
    invoiceTotalYuan.value = formatMinor(result.total_minor) === '不可用' ? '' : formatMinor(result.total_minor)
    selectedInvoice.value = result; invoiceRows.value = []; originalPreview.value = ''; selectedSource.value = null
    if (originalDownload.value) URL.revokeObjectURL(originalDownload.value)
    originalDownload.value = ''
    await revealDetail()
  }
  catch (cause) { showError(cause) }
}

// 用途：人工确认提取字段，明确区别于外部税务查验。
// 参数：无。
// 返回值：无；成功后读取权威复核状态。
async function confirmInvoice() {
  const invoice = selectedInvoice.value
  let content, totalMinor
  try {
    content=invoiceContentInput(invoiceContentEditor.value)
    // 票面总额输入框是元；这里换算成整数分提交，未填写时沿用服务端当前票面。
    totalMinor = String(invoiceTotalYuan.value || '').trim() ? toMinor(invoiceTotalYuan.value) : invoice.total_minor
  }
  catch (cause) { showError(cause); return }
  const result = await mutate('invoice.confirm', `/invoices/${invoice.id}/confirm`,
    { expected_version: invoice.version, reason: invoiceReviewReason.value,
      invoice_type: invoice.invoice_type, invoice_number: invoice.invoice_number,
      invoice_code: invoice.invoice_code, invoice_date: invoice.invoice_date,
      seller_tax_id: invoice.seller_tax_id, buyer_tax_id: invoice.buyer_tax_id,
      total_minor: totalMinor, file_ids: invoice.file_ids, content,travel_facts:travelInput(invoice.travel_facts,true) })
  if (result) { await openInvoice(invoice.id); await load() }
}

// 用途：保存带证据人工核验，明确区别于外部税务查验。
// 参数：无。
// 返回值：无；仅展示服务端真实核验状态。
async function verifyInvoice() {
  const result = await mutate('invoice.verify', `/invoices/${selectedInvoice.value.id}/verify`,
    { expected_version: selectedInvoice.value.version, verification_method: 'MANUAL',
      verification_result: verificationResult.value, reason: verificationReason.value,
      evidence_file_ids: splitIDs(verificationEvidence.value) })
  if (result) { await openInvoice(selectedInvoice.value.id); await load() }
}

// 用途：创建真实文件上传会话；结果未知时保留文件以恢复原会话。
// 参数：event 为文件选择事件，purpose 为文件用途，voucherDestination 为凭证表单目标。
// 返回值：无；失败保留当前文件和服务器文档标识。
async function uploadInvoice(event, purpose = 'reimbursement.invoice.original', voucherDestination = 'payment') {
  const file = event.target.files?.[0]
  if (!file || saving.value || runner.pending()) return
  let media
  try {media=uploadFiles([file],purpose)[0].media_type}
  catch(cause) {showError(cause);return null}
  error.value = ''; queuedUpload = { file, purpose, voucherDestination }; saving.value = true
  try {
    const sha256 = await sourceSHA256(file)
    saving.value = false
    const result = await mutate('document.upload', '/invoice-documents/upload-sessions',
      { purpose, original_name: file.name, media_type: media,
        size_bytes: file.size, sha256, idempotency_key: createRequestID(), expected_version: 0 })

    if (result) return await uploadContent(result, file, purpose)
  } catch (cause) { showError(cause) }
  finally { saving.value = false }
}

// 用途：复用原会话传送内容或恢复远端就绪状态，始终取得本地完成回执。
// 参数：permit 为上传会话，file 为同一原件，purpose 为用途。
// 返回值：带原上传文档ID的完成回执；网络中断后保留文档ID供完成查询。
async function uploadContent(permit, file, purpose) {
  if (!['CREATED', 'READY'].includes(permit.status) || !permit.document_id || !permit.file_id) {
    throw new Error('上传状态或原件引用不可用，请查询原上传会话后继续。')

  }
  documentID.value = permit.document_id
  uploadedDocument.value = { id: permit.document_id, name: file?.name || '' }
  saving.value = true
  try {
    if (permit.status === 'CREATED') {
      const target = new URL(permit.upload_url, window.location.origin)
      if (!file || !permit.ticket || target.origin !== window.location.origin ||
        !target.pathname.startsWith('/file-gateway/')) {
        throw new Error('上传会话返回非平台文件网关地址或缺少原文件票据，已拒绝传送文件')
      }
      const response = await fetch(target.href, { method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream', Authorization: `UploadTicket ${permit.ticket}` },
        body: file, signal: timeoutSignal(120000) })
      if (!response.ok) throw new Error('文件上传未确认成功，请查询文档状态后确认完成')
    }

    saving.value = false
    const completed = await mutate('document.complete', `/invoice-documents/${encodeURIComponent(permit.document_id)}/complete`,
      { expected_version: 0 })
    if (completed) applyUploadCompletion(completed, purpose, permit.file_id, queuedUpload?.voucherDestination)
    return completed ? { ...completed, document_id: permit.document_id } : null
  } finally { saving.value = false }
}

// 用途：串行上传有界原件批次，逐份保留真实结果及未知命令恢复入口。
// 参数：event为文件选择或拖放事件。
// 返回值：无；某份结果未知时停止后续上传，不重建会话。
async function uploadInvoiceBatch(event) {
  if(batchBusy.value || saving.value || runner.pending()) return
  try {
    const files=uploadFiles(event.dataTransfer?.files || event.target?.files,'reimbursement.invoice.original')
    uploadBatch.value=files.map(({file})=>({name:file.name,status:'WAITING',document_id:''}))
    batchBusy.value=true
    for(let i=0;i<files.length;i+=1) {
      const row=uploadBatch.value[i];row.status='UPLOADING'
      const result=await uploadInvoice({target:{files:[files[i].file]}})
      row.status=result ? 'READY' : runner.pending() ? 'UNKNOWN' : 'FAILED'
      row.document_id=result?.document_id || result?.id || ''
      if(runner.pending()) break
    }
  } catch(cause) {showError(cause)}
  finally {batchBusy.value=false}
}

// 用途：记住最近一次的解析/导出/原件任务，刷新页面后仍能找回任务号。
// 参数：kind 为任务种类，value 为任务坐标。
// 返回值：无；本地存储不可用时只保留当前页面的内存记忆。
function rememberTaskRun(kind, value) {
  if (!value) return
  rememberTask(kind, value)
  recentTask.value = { ...recentTask.value, [kind]: { ...value, saved_at: Date.now() } }
}

// 用途：把解析任务与原件坐标一起记下来，供刷新后继续查询。
// 参数：job 为解析任务；id 为原件标识，缺省取当前文档ID。
// 返回值：无。
function rememberParseTask(job, id = documentID.value) {
  if (!job?.id) return
  rememberTaskRun('parse', { task_id: String(job.id), document_id: String(id || ''), status: String(job.status || '') })
}

// 用途：把导出任务与原导出范围一起记下来，供刷新后继续查询或重试。
// 参数：job 为导出任务。
// 返回值：无。
function rememberExportTask(job) {
  if (!job?.id) return
  rememberTaskRun('export', { task_id: String(job.id), claim_ids: [...exportScopeIDs.value].map(String),
    status: String(job.status || '') })
}

// 用途：继续查询上次的解析任务，避免刷新等同于重新上传。
// 参数：无。
// 返回值：无；失败显示真实原因并保留任务号。
async function resumeParseTask() {
  const saved = recentTask.value.parse
  if (!saved?.task_id) return
  if (saved.document_id) documentID.value = saved.document_id
  try {
    parseRun.value = await api.request(`/parse-runs/${encodeURIComponent(saved.task_id)}`)
    if (documentID.value) documentStatus.value = await api.request(`/invoice-documents/${encodeURIComponent(documentID.value)}`)
    rememberParseTask(parseRun.value)
    notice.value = '已找回上次解析任务，请核对任务状态与候选。'
  } catch (cause) { showError(cause) }
}

// 用途：继续查询上次导出任务，并恢复原导出范围以便失败重试。
// 参数：无。
// 返回值：无；失败显示真实原因。
async function resumeExportTask() {
  const saved = recentTask.value.export
  if (!saved?.task_id) return
  exportScopeIDs.value = (saved.claim_ids || []).map(String)
  try {
    exportJob.value = await api.request(`/exports/${encodeURIComponent(saved.task_id)}`)
    rememberExportTask(exportJob.value)
    notice.value = '已找回上次导出任务，请核对任务状态。'
  } catch (cause) { showError(cause) }
}

// 用途：读取最近上传的原件，找回文档ID后继续解析或人工录入。
// 参数：无。
// 返回值：无；失败显示真实原因。
async function resumeRecentDocument() {
  const saved = recentTask.value.document
  if (!saved?.document_id) return
  documentID.value = saved.document_id
  const doc = await readDocument()
  if (doc) notice.value = '已读取最近上传的原件；可继续发起解析或人工录入。'
}

// 用途：展示网关已确认的文档或凭证结果，不把解析任务当成人工复核。
// 参数：result 为完成回执，purpose 为用途，fileID 为凭证引用，destination 为目标表单。
// 返回值：无；更新后续解析或付款凭证引用。
function applyUploadCompletion(result, purpose, fileID, destination = 'payment') {
  const uploadedFileID = fileID || result.file_id
  if (uploadedFileID && queuedUpload?.file?.name) evidenceNames.value[uploadedFileID] = queuedUpload.file.name
  const resumedBatch = uploadBatch.value.find((row) => row.status === 'UNKNOWN' &&
    row.name === queuedUpload?.file?.name)
  if (resumedBatch && purpose === 'reimbursement.invoice.original') {
    resumedBatch.status = 'READY'
    resumedBatch.document_id = result.document_id || result.id || documentID.value
  }
  queuedUpload = null
  if (purpose === 'reimbursement.claim.evidence') {
    attachClaimEvidence(destination, fileID || result.file_id)
    notice.value = '费用证据已上传；不会解析为发票，保存及提交时仍需服务端校验。'
  } else if (purpose === 'reimbursement.payment.voucher' && destination === 'reversal') {
    evidenceFiles.value = [...splitIDs(evidenceFiles.value), uploadedFileID].join(',')
  } else if (purpose === 'reimbursement.payment.voucher') {
    const form = destination === 'exceptionFact' ? exceptionForm.value
      : destination === 'exceptionReview' ? exceptionReviewForm.value : paymentForm.value
    const key = destination === 'exceptionReview' ? 'evidence_file_ids' : 'voucher_file_ids'
    form[key] = [...splitIDs(form[key]), fileID || result.file_id].join(',')
    notice.value = '付款凭证已上传并由服务器确认。'
  } else if (purpose === 'reimbursement.invoice.original' && destination === 'verification') {
    verificationEvidence.value = [...splitIDs(verificationEvidence.value), uploadedFileID].join(',')
  } else if (purpose === 'reimbursement.invoice.original') {
    parseRun.value = result.parse_run || (result.parse_run_id ? { id: result.parse_run_id } : null)
    // 记住原件与解析任务：刷新后仍能靠"最近上传的原件"找回文档ID。
    const id = result.document_id || documentID.value
    if (id) rememberTaskRun('document', { document_id: String(id) })
    if (parseRun.value?.id) rememberParseTask(parseRun.value, id)
    notice.value = '文件已确认就绪，解析状态请单独查询；提取字段仍需人工复核。'
  }
}

// 用途：先读取原件当前版本再冻结重解析命令，未知结果复用原请求。
// 参数：无。
// 返回值：无；保留解析任务ID供显式查询。
async function parseDocument() {
  const path = `/invoice-documents/${encodeURIComponent(documentID.value)}/parse`
  const original = runner.pending()
  if (original) {
    if (original.key === 'invoice.reparse' && original.path === path) await retryPending()
    else showError(new Error('请先查询原命令结果，再发起其他解析'))
    return
  }
  const doc = await readDocument()
  if (!doc) return
  if (!Number.isSafeInteger(doc.version) || doc.version < 1) {
    showError(new Error('原件当前版本不完整，不能发起重解析')); return
  }
  const result = await mutate('invoice.reparse', path, { expected_version: doc.version })
  if (result) {
    parseRun.value = result
    rememberParseTask(result)
    if (result.document_version) documentStatus.value.version = result.document_version
    if (result.status) await autoRefreshParse()
  }
}

// 用途：解析任务创建后自动短轮询，完成后提示人工复核，失败时保留重试入口。
// 参数：无。
// 返回值：无；过期响应不覆盖新任务。
async function autoRefreshParse() {
  const ticket = ++parsePollSequence
  const jobID = parseRun.value?.id
  if (!jobID) return
  try {
    const final = await pollTask(async () => {
      const job = await api.request(`/parse-runs/${encodeURIComponent(jobID)}`)
      if (!job || typeof job.status !== 'string') return job
      if (ticket === parsePollSequence) parseRun.value = job
      return job
    }, {
      attempts: 5,
      delay: 2000,
      shouldContinue: () => ticket === parsePollSequence,
      onValue: (job) => {
        if (ticket !== parsePollSequence || !taskSettled(job?.status)) return
        notice.value = job.status === 'DONE'
          ? '解析任务已完成，请核对候选并人工复核；识别结果不代表已验真。'
          : `解析任务未完成：${failureMessage(job.last_error)}`
      },
    })
    if (final?.status && !taskSettled(final.status) && ticket === parsePollSequence) {
      notice.value = '解析任务仍在处理中；可稍后点击查询解析状态，或重新发起解析。'
    }
  } catch (cause) {
    if (ticket === parsePollSequence) showError(cause)
  }
}

// 用途：查询真实解析任务状态，不自动宣称解析或查验成功。
// 参数：无。
// 返回值：无；更新任务与可用发票引用。
async function refreshParse() {
  try {
    parseRun.value = await api.request(`/parse-runs/${encodeURIComponent(parseRun.value.id)}`)
    rememberParseTask(parseRun.value)
    // 只查询任务时可能还没有文档ID，此时不去拼一个空文档地址。
    if (documentID.value) documentStatus.value = await api.request(`/invoice-documents/${encodeURIComponent(documentID.value)}`)
    await load()
  }
  catch (cause) { showError(cause) }
}

// 用途：查询本人原件就绪状态和字段缺失原因。
// 参数：无。
// 返回值：文档事实；失败保留原件ID。
async function readDocument() {
  const ticket=++documentSequence,id=documentID.value
  try {
    const doc=await api.request(`/invoice-documents/${encodeURIComponent(id)}`)
    if(ticket!==documentSequence || id!==documentID.value)return null
    documentStatus.value=doc
    return doc
  }catch(cause){if(ticket===documentSequence)showError(cause);return null}
}

// 用途：从授权且就绪的票据原件准备人工复核或拆分多票录入。
// 参数：candidate 为可选解析候选，只辅助填充可编辑票面字段。
// 返回值：无；缺总额保持空白，分组不确定仍要求人工确认。
async function prepareManualInvoice(candidate = null) {
  if (runner.pending()) { showError(new Error('请先确认原命令结果')); return }
  const original = documentStatus.value
  const index = candidate ? parsedCandidates.value.indexOf(candidate) : -1
  if (candidate && index < 0) { showError(new Error('解析候选已改变，请重新选择')); return }
  const source = candidate && original?.parse_run_id ? Object.freeze({
    document_id: original.id || original.document_id, file_id: original.file_id,
    run_id: original.parse_run_id, candidate_index: index,
  }) : null
  const doc = await readDocument()
  if (!doc || !doc.file_id) return
  if (!['READY', 'PARSED', 'REVIEW_REQUIRED'].includes(doc.status)
    || doc.detail?.purpose !== 'reimbursement.invoice.original') {
    showError(new Error('仅可从当前已授权且就绪的票据原件人工录入')); return
  }
  if (source && (source.document_id !== (doc.id || doc.document_id) || source.file_id !== doc.file_id)) {
    showError(new Error('原件已改变，请重新核对并选择候选')); return
  }
  selectedCandidateSource.value = source
  candidateDocumentID.value = doc.id || doc.document_id || documentID.value
  candidateFileID.value = doc.file_id
  selectedCandidate.value = candidate
  let content
  try { content=invoiceContentForm({ lines: candidate?.detail_lines || [] }) }
  catch (cause) { showError(cause); return }
  manualInvoiceForm.value = {
    invoice_type: candidate?.invoice_type || '', invoice_code: candidate?.invoice_code || '',
    invoice_number: candidate?.invoice_number || '', invoice_date: candidate?.invoice_date || '',
    seller_tax_id: candidate?.seller_tax_id || '', buyer_tax_id: candidate?.buyer_tax_id || '',
    content,
    amount: candidate?.gross_minor && /^[1-9]\d*$/.test(candidate.gross_minor)
      ? formatMinor(candidate.gross_minor) : '',
  }
}

// 用途：从同一已授权原件逐张创建待复核票据，不把识别候选视为验真。
// 参数：无。
// 返回值：无；缺金额或原件失效时保留输入，成功后仍需独立确认票面。
async function createManualInvoice() {
  if (!manualInvoiceForm.value) return
  try {
    const form = manualInvoiceForm.value
    const amount = toMinor(form.amount)
    if (BigInt(amount) <= 0n) throw new Error('请人工核对并填写大于零的票面总额')
    const doc = await api.request(`/invoice-documents/${encodeURIComponent(candidateDocumentID.value)}`)
    if (doc.file_id !== candidateFileID.value || !['READY', 'PARSED', 'REVIEW_REQUIRED'].includes(doc.status)
      || doc.detail?.purpose !== 'reimbursement.invoice.original') throw new Error('原件状态已改变，请重新读取')
    const { amount: _amount, travel_facts:_travel, ...fields } = form
    fields.travel_facts=travelInput(form.travel_facts,true)
    fields.content=invoiceContentInput(form.content)
    const result = await mutate('invoice.create', '/invoices', { ...fields,
      expected_version: 0, file_ids: [doc.file_id], total_minor: amount,
      reason: '对照原件人工拆分并保留候选来源',
      source_selections: selectedCandidateSource.value ? [{ ...selectedCandidateSource.value }] : [] })
    if (result) {
      manualInvoiceForm.value = null
      await openInvoice(result.id); await load()
      notice.value = '已创建待复核票据，请对照原件确认；同一原件可继续拆分录入其他票据。'
    }
  } catch (cause) { showError(cause) }
}

// 用途：按权限获取发票原件下载授权并校验同源目标。
// 参数：无。
// 返回值：无；仅打开真实受控地址。
async function invoiceSources() {
  try {
    const result = await api.request(`/invoices/${selectedInvoice.value.id}/sources`)
    const sources = result.items || (result.file_ids || []).map((file_id) => ({ file_id }))
    invoiceRows.value = sources.map((source) => ({ ...source, sources: (source.sources || []).flat() }))
  } catch (cause) { showError(cause) }
}

// 用途：按当前权限领取原件票据并通过请求头读取文件，不把票据放入地址。
// 参数：source 为服务器返回的具体来源，包含文件和独立解析运行引用。
// 返回值：无；PDF提供受控预览，OFD和其他原件提供下载。
async function readInvoiceOriginal(source) {
  selectedSource.value = source
  const fileID = source.file_id
  try {
    const permit = await api.request(`/invoices/${selectedInvoice.value.id}/files/${encodeURIComponent(fileID)}/download-ticket`,
      { method: 'POST', body: '{}' })
    const target = new URL(permit.download_url, window.location.origin)
    if (target.origin !== window.location.origin || !target.pathname.startsWith('/file-gateway/')) {
      throw new Error('原件下载地址不受信任')
    }
    const response = await fetch(target.href, { credentials: 'include', cache: 'no-store',
      headers: { Authorization: `DownloadTicket ${permit.ticket}` }, signal: timeoutSignal(30000) })
    if (!response.ok) throw new Error('受控原件读取失败')
    const blob = await response.blob()
    if (blob.size > 20 * 1024 * 1024) throw new Error('原件超过20MiB预览边界')
    if (originalDownload.value) URL.revokeObjectURL(originalDownload.value)
    originalDownload.value = URL.createObjectURL(blob)
    originalMedia.value = response.headers.get('content-type')?.split(';')[0] || ''
    originalPreview.value = originalMedia.value === 'application/pdf' ? originalDownload.value : ''
  } catch (cause) { showError(cause) }
}

// 用途：为有完整票据范围的审批人加载原件列表，受限任务不请求其他分摊影像。
// 参数：invoiceID为当前冻结审批快照中的用票坐标。
// 返回值：无；当前权限不足由服务端拒绝，不使用快照当下载凭据。
async function previewApprovalInvoice(invoiceID) {
  try {
    selectedInvoice.value=await api.request(`/invoices/${encodeURIComponent(invoiceID)}`)
    await invoiceSources()
  } catch(cause) {showError(cause)}
}

// 用途：读取选中报销单的归档完整性与版本。
// 参数：无。
// 返回值：无；缺失或未完成状态按服务端原样展示。
async function loadArchives() {
  try { archives.value = await api.request(`/claims/${selected.value.id}/archives`) }
  catch (cause) { showError(cause) }
}

// 用途：按原单据触发归档重试，不重新登记付款。
// 参数：无。
// 返回值：无；仅展示真实异步任务回执。
async function retryArchive() {
  const result = await mutate('archive.retry', `/claims/${selected.value.id}/archive-retries`,
    { expected_version: selected.value.version })
  if (result) { notice.value = '归档重试已受理，请查询实际完整性状态。'; await loadArchives() }
}

// 用途：创建当前权限范围内的单据导出任务。
// 参数：claimIDs为显式选择的单据，未传时沿用当前详情或既有范围。
// 返回值：无；受理不代表文件已生成。
async function createExport(claimIDs = null) {
  const scope = Array.isArray(claimIDs) ? claimIDs : selected.value ? [selected.value.id] : []
  exportScopeIDs.value = scope.map(String)
  const result = await mutate('export.create', '/exports',
    { expected_version: selected.value?.version || 0, claim_ids: scope,
      ...(route.query.project_id ? { project_id: String(route.query.project_id) } : {}) })
  if (result) {
    exportJob.value = result
    rememberExportTask(result)
    if (result.status) await autoRefreshExport()
  }
}

// 用途：导出任务创建后自动短轮询，完成后提示下载，失败时保留重试入口。
// 参数：无。
// 返回值：无；过期响应不覆盖新任务。
async function autoRefreshExport() {
  const ticket = ++exportPollSequence
  const jobID = exportJob.value?.id
  if (!jobID) return
  try {
    const final = await pollTask(async () => {
      const job = await api.request(`/exports/${encodeURIComponent(jobID)}`)
      if (!job || typeof job.status !== 'string') return job
      if (ticket === exportPollSequence) exportJob.value = job
      return job
    }, {
      attempts: 5,
      delay: 2000,
      shouldContinue: () => ticket === exportPollSequence,
      onValue: (job) => {
        if (ticket !== exportPollSequence || !taskSettled(job?.status)) return
        notice.value = job.status === 'DONE'
          ? '导出任务已完成，可下载受控文件。'
          : `导出任务未完成：${failureMessage(job.last_error)}`
      },
    })
    if (final?.status && !taskSettled(final.status) && ticket === exportPollSequence) {
      notice.value = '导出任务仍在处理中；可稍后点击查询导出状态。'
    }
  } catch (cause) {
    if (ticket === exportPollSequence) showError(cause)
  }
}

// 用途：沿用原导出范围重试，避免失败后让用户重新勾选。
// 参数：无。
// 返回值：无；原范围丢失时给出可见提示。
async function retryExport() {
  const scope = [...exportScopeIDs.value]
  if (!scope.length) { showError(new Error('原导出范围已丢失，请重新勾选当前页单据')); return }
  await createExport(scope)
}

// 用途：仅为本页明确勾选的可见单据创建导出，不以空选择扩大范围。
// 参数：无。
// 返回值：无；过期选择或空选择阻断，最终由服务端重验授权。
async function exportSelectedClaims() {
  const ids=[...new Set(selectedClaimIDs.value)]
  if(!ids.length || ids.length>100 || ids.some(id=>!rows.value.some(row=>row.id===id))) {
    showError(new Error('请选择当前页1至100张可见单据'));return
  }
  await createExport(ids)
}

// 用途：按当前草稿和版本只读预览正式标准与审批规则，不提交或保存。
// 参数：无。
// 返回值：无；旧版本或迟到预览不覆盖当前编辑，错误单独显示。
async function refreshClaimPreview() {
  await nextTick()
  if(!selected.value?.id || !editable.value || runner.pending())return
  clearTimeout(previewTimer)
  const ticket=++previewSequence;previewEnabled.value=true
  previewBusy.value=true;previewError.value='';claimPreview.value=null
  try {
    const payload={...claimPayload(),claim_id:selected.value.id}
    const value=await api.request(`/claims/${encodeURIComponent(selected.value.id)}/preview`,{
      method:'POST',body:JSON.stringify(payload)})
    if(value.claim_id!==payload.claim_id || value.expected_version!==payload.expected_version || value.preview_only!==true) {
      throw new Error('预览响应与当前草稿或版本不一致，请重新预览')
    }
    if(ticket===previewSequence)claimPreview.value=value
  }catch(cause){if(ticket===previewSequence)previewError.value=cause.outcomeUnknown
    ? '预览暂不可用；本操作未保存或提交单据，请重新预览。' : cause.message}
  finally{if(ticket===previewSequence)previewBusy.value=false}
}

// 用途：编辑后使旧预览立即失效，并合并短时间连续编辑的只读请求。
// 参数：无。
// 返回值：无；未启用预览时不向外部服务发请求。
function invalidateClaimPreview() {
  ++previewSequence;claimPreview.value=null;previewBusy.value=false
  clearTimeout(previewTimer)
  if(previewEnabled.value && editable.value && selected.value?.id) {
    previewTimer=setTimeout(()=>{void refreshClaimPreview()},600)
  }
}

// 用途：查询真实导出任务状态，只有服务端给出受控地址才能下载。
// 参数：无。
// 返回值：无；失败保留原任务ID。
async function refreshExport() {
  try {
    exportJob.value = await api.request(`/exports/${encodeURIComponent(exportJob.value.id)}`)
    rememberExportTask(exportJob.value)
  }
  catch (cause) { showError(cause) }
}

// 用途：创建新的政策草稿版本，避免修改已发布历史版本。
// 参数：无。
// 返回值：无；字段校验或API错误保留编辑内容。
async function savePolicy() {
  try {
    const payload = policyPayload(policyKind.value, policyForm.value)
    payload.id = policyID.value || createRequestID()
    const result = await mutate('config.save', `/configurations/${policyKind.value}`,
      { ...payload, expected_version: policyVersion.value, kind: policyKind.value })
    if (result) { selectPolicy(result); await load() }
  } catch (cause) { showError(cause) }
}

// 用途：发布已保存政策版本，历史版本保持只读。
// 参数：无。
// 返回值：无；成功后重新读取发布状态。
async function publishPolicy() {
  const result = await mutate('config.publish', `/configurations/${policyKind.value}/${policyID.value}/publish`,
    { expected_version: policyVersion.value, kind: policyKind.value })
  if (result) await load()
}

// 用途：下载前重新查询权限与结果，验证内容摘要后保存CSV。
// 参数：无。
// 返回值：无；未完成、缺内容或摘要不一致均不给成功下载。
async function downloadExport() {
  try {
    const job = await api.request(`/exports/${encodeURIComponent(exportJob.value.id)}`)
    exportJob.value = job
    const result = job.result?.result
    if (job.status !== 'DONE' || typeof result?.content !== 'string' || !result.sha256) {
      throw new Error('导出尚未完成或受控结果不完整，请先查询任务状态')
    }
    const bytes = new TextEncoder().encode(result.content)
    const hash = await sourceSHA256(new Blob([bytes]))
    if (hash !== result.sha256) throw new Error('导出内容摘要不一致，已停止下载')
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'reimbursement.csv'; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (cause) { showError(cause) }
}

// 用途：展示生命周期回执，同时保留旧版本不可变业务内容。
// 参数：result 为退休或替换的权威回执。
// 返回值：无；更新旧行版本与退休状态。
function applyLifecycleResult(result) {
  policyRecord.value = { ...policyRecord.value, ...result }
  policyVersion.value = result.version
  policyPublished.value = true
}

// 用途：核对退休或替换的显式发布权限、活动版本与原因。
// 参数：无。
// 返回值：无；缺少能力、有效旧版本或理由时抛错。
function validatePolicyLifecycle() {
  if (!can('expense.policy.publish')) throw new Error('当前账号没有政策发布和退休能力')
  if (!policyID.value || policyLifecycleStatus.value !== 'ACTIVE') throw new Error('请选择当前有效的已发布政策')
  if (!policyLifecycleReason.value.trim()) throw new Error('请填写停止使用或替换政策的原因')
}

// 用途：退休旧政策以停止新增使用，历史内容和批准快照仍可审阅。
// 参数：无。
// 返回值：无；结果未知时保留原命令与原原因。
async function retirePolicy() {
  try {
    validatePolicyLifecycle()
    const result = await mutate('config.retire', `/configurations/${policyKind.value}/${policyID.value}/retire`,
      { expected_version: policyVersion.value, reason: policyLifecycleReason.value.trim() })
    if (result) {
      applyLifecycleResult(result); await load()
      notice.value = '旧政策已退休，停止新增使用；历史版本与已批准快照保留。'
    }
  } catch (cause) { showError(cause) }
}

// 用途：在同一事务中退休旧政策并发布已保存的新草稿。
// 参数：无。
// 返回值：无；绑定新旧行版本，失败不通过分步发布制造中间状态。
async function replacePolicy() {
  try {
    validatePolicyLifecycle()
    const replacement = replacementCandidates.value.find((row) => row.id === replacementPolicyID.value)
    if (!replacement) throw new Error('请选择当前列表内同类的已保存政策草稿')
    const result = await mutate('config.replace', `/configurations/${policyKind.value}/${policyID.value}/replace`,
      { expected_version: policyVersion.value, reason: policyLifecycleReason.value.trim(),
        replacement_id: replacement.id, replacement_expected_version: replacement.version })
    if (result) {
      applyLifecycleResult(result); await load()
      notice.value = '旧政策已退休，新草稿已原子发布；请在列表查看新版本。'
    }
  } catch (cause) { showError(cause) }
}

// 用途：选择政策记录供查看或派生新版本，明确保留发布状态。
// 参数：row 为服务器配置记录。
// 返回值：无；更新版本和只读文本。
function selectPolicy(row) {
  policyRecord.value = { ...row }
  policyObjectNames.value = { subject_id: row.subject_name || '', org_id: row.org_name || '',
    project_id: row.project_name || '', finance_entity_id: row.finance_entity_name || '' }
  policyOrganizationNames.value = {}; policyOrganizationChoice.value = ''
  policyID.value = row.id; policyVersion.value = row.version || 0
  policyLifecycleReason.value = ''; replacementPolicyID.value = ''
  policyForm.value = policyFormFrom(policyKind.value, row)
  policyBaseline.value = { ...policyForm.value }
  policyPublished.value = row.published === true
}

// 用途：从只读历史政策派生新草稿，保留原文供差异核对。
// 参数：无。
// 返回值：无；移除历史标识和发布状态，不覆盖原版本。
function clonePolicy() {
  policyID.value = ''; policyVersion.value = 0; policyPublished.value = false; policyRecord.value = null
}

// 用途：清空当前已确认详情并开始新草稿，未知命令时拒绝切换。
// 参数：无。
// 返回值：无；初始化空白编辑表单。
async function newDraft(skipConfirm = false) {
  if (runner.pending()) { showError(new Error('请先确认原命令结果')); return }
  if (!skipConfirm && !discardDraft()) return
  claimFormOpen.value = true
  selected.value = null; draft.value = blankDraft()
  draftBaseline.value = stableStringify(draft.value)
  try {
    editorOptions.value = await api.request('/claim-options')
    if (!applyDraftContext()) { addItem(); return }
    await searchProjects()
    await createDraft()
  } catch (cause) { showError(cause) }
}

// 用途：先创建空服务器草稿，后续费用编辑始终使用真实ID和版本。
// 参数：无。
// 返回值：无；无可选组织时不发出创建请求。
async function createDraft() {
  if (!applyDraftContext(draft.value.org_id)) { showError(new Error(notice.value)); return }
  if (!confirmDiscard('创建服务器草稿会先保存空单据，当前未保存的费用明细不会一并保存。继续创建吗？')) return
  const result = await mutate('claim.create', '/claims', { expected_version: 0,
    title: draft.value.title || '未命名报销', org_id: draft.value.org_id,
    route_type: draft.value.route_type, finance_entity_id: draft.value.finance_entity_id,
    payee_profile_id: draft.value.payee_profile_id, currency: 'CNY', items: [] })
  if (result) { await openClaim(result.id, true); if (!draft.value.items.length) addItem() }

}


// 用途：安全退出应用，失败保留反馈。
// 参数：无。
// 返回值：无；成功返回门户。
async function logout() {
  if (runner.pending()) { showError(new Error('请先确认原命令结果再退出')); return }
  if (!discardDraft()) return
  try { await logoutReimbursement() } catch (cause) { showError(cause) } }

watch(draft,invalidateClaimPreview,{deep:true})
watch(() => selected.value?.id,()=>{previewEnabled.value=false;invalidateClaimPreview()})
watch(() => route.params.section, async () => {
  page.value = 1
  // 状态页签属于当前入口：从「我的报销单」带过来的草稿筛选不能进入审批轨迹。
  if (!Object.hasOwn(statusTabs.value, listFilters.value.status)) listFilters.value.status = ''
  await load()
  await nextTick()
  heading.value?.focus()
})
watch(() => route.query.claim_id, (id) => {
  if (id && section.value === 'claims' && selected.value?.id !== String(id)) void openClaim(String(id))
})
watch(()=>route.query.project_id,()=>{page.value=1;void load()})
watch(approvalStatus, () => { page.value = 1; void load() })
watch(paymentStatus, () => { page.value = 1; void load() })
watch(policyKind, () => {
  policyID.value = ''; policyVersion.value = 0; policyPublished.value = false; policyRecord.value = null
  policyBaseline.value = null; policyForm.value = policyFormFrom(policyKind.value)
  page.value = 1; void load()
})
// 用途：结果未知时提示保留当前页面，防止丢失原命令。
// 参数：event 为浏览器离开事件。
// 返回值：无；存在未确认命令时请求浏览器确认。
function protectPending(event) {
  if (!runner.pending() && !draftProtected.value) return
  event.preventDefault(); event.returnValue = ''
}
onBeforeRouteLeave(() => {
  if (runner.pending()) {
    showError(new Error('请先查询原命令结果，再离开报销工作区'))
    return false
  }
  return discardDraft()
})
onMounted(() => {
  // 刷新页面后先恢复最近任务坐标，用户可以继续查询而不用重新上传或重跑。
  recentTask.value = { parse: recallTask('parse'), export: recallTask('export'), document: recallTask('document') }
  hydrateFiltersFromRoute()
  addItem(); void load(); window.addEventListener('beforeunload', protectPending)
})
onBeforeUnmount(() => {
  ++previewSequence;++documentSequence;++detailSequence;++projectSequence;++paymentOptionsSequence;++paymentHistorySequence;++parsePollSequence;++exportPollSequence
  clearTimeout(previewTimer)

  ++loadSequence; window.removeEventListener('beforeunload', protectPending)
  if (originalDownload.value) URL.revokeObjectURL(originalDownload.value)
})
</script>

<template>
  <AppShell
    v-model:menu-open="menuOpen"
    brand-name="报销管理系统"
    brand-subtitle="费用与票据工作区"
    content-class="expense-canvas"
    :nav-groups="navGroups"
    :crumb="title"
    :user-name="session?.display_name || session?.subject_id || ''"
    :user-role="sessionRolesLabel"
    @navigate="navigate"
    @logout="logout"
  >
    <template #topbar-actions>
      <button type="button" class="expense-button" :disabled="loading || saving" @click="load">
        刷新
      </button>
    </template>
    <header class="expense-head">
      <div class="expense-head__copy">
        <h1
          ref="heading"
          tabindex="-1"
        >
          {{ title }}
        </h1>
        <p>
          {{ sectionDescriptions[workspace] || '按当前主体与数据范围读取；金额以人民币元展示。' }}
        </p>
      </div>
      <div class="expense-head__actions">
        <button type="button"
          v-if="workspace === 'invoices' && can('expense.invoice.upload')"
          class="expense-button primary"
          @click="navigate('invoice-upload')"
        >
          上传发票
        </button>
        <button type="button"
          v-if="workspace === 'invoices' && sectionAllowed('invoice-abnormal')"
          class="expense-button"
          @click="navigate('invoice-abnormal')"
        >
          异常发票池
        </button>
        <button type="button"
          v-if="workspace === 'invoice-upload'"
          class="expense-button"
          @click="navigate('invoices')"
        >
          返回台账
        </button>
        <button type="button"
          v-if="['dashboard', 'claims'].includes(workspace) && can('expense.claim.create')"
          class="expense-button primary"
          @click="startNewClaim"
        >
          新建报销
        </button>
      </div>
    </header>
    <div v-if="error" class="expense-alert danger" role="alert">
      {{ error }}
      <button type="button" v-if="sessionExpired" @click="startReimbursementLogin()">
        恢复登录
      </button>
    </div>
    <div v-if="notice" class="expense-alert" role="status">
      {{ notice }}
    </div>
    <div v-if="pending" class="expense-alert warning" role="alert">
      操作结果未知。原命令：
      <code>
        {{ pending.command_id }}
      </code>
      <button type="button" class="expense-button" :disabled="saving" @click="resolvePending">
        查询原命令结果
      </button>
      <button type="button" class="expense-button" :disabled="saving" @click="retryPending">
        查询后重试原命令
      </button>
      <p>
        未确认前请保留本页；重试同一操作复用该命令及原始内容。
      </p>
    </div>
    <LoadingState v-if="loading" />
    <template v-if="hasModule">
      <p class="expense-alert" role="note">
        {{ scopeDescription }}
      </p>
      <p v-if="returnProject"><RouterLink :to="returnProject">返回来源项目</RouterLink></p>
      <div v-if="routeContextChips.length" class="expense-context" role="group" aria-label="地址参数回显">
        <span class="expense-context__title">地址参数</span>
        <span v-for="chip in routeContextChips" :key="chip.label" class="expense-context__chip">
          <small>{{ chip.label }}</small><b>{{ chip.value }}</b>
        </span>
      </div>
      <section
        v-if="section === 'archives' && can('expense.claim.read')"
        class="expense-panel"
      >
        <header class="expense-card-head">
          <h2 class="expense-card-title">项目费用参与人</h2>
          <span class="expense-card-extra">资格由项目工作区维护</span>
        </header>
        <p>
          项目费用参与资格由项目工作区按项目范围维护；报销侧只提供查询与跳转入口。
        </p>
        <div class="expense-actions">
          <input v-model="keyword" maxlength="128" placeholder="输入项目关键词" aria-label="项目关键词">
          <button type="button" class="expense-button" @click="searchProjects">
            查询项目选项
          </button>
        </div>
        <p v-if="!projectOptions.length">
          暂无已查询项目选项。
        </p>
        <ul v-else>
          <li v-for="option in projectOptions" :key="option.project_id">
            {{ option.project_id }} / {{ option.project_name || '名称待确认' }}
            <button type="button" class="expense-button" @click="openProjectExpenseParticipants(option)">
              维护费用参与人
            </button>
          </li>
        </ul>
      </section>
      <div v-if="fieldErrors.length" role="alert">
        <button type="button" v-for="field in fieldErrors" :key="field.field" class="expense-button" @click="focusValidation(field.field)">
          {{ field.message }}
        </button>
        <span v-if="validationHint">{{ validationHint }}</span>
      </div>
      <p v-if="conflictSnapshot" role="status">
        {{ conflictSnapshot.text }}
      </p>
      <RecoveryPanel v-if="section === 'recovery'" :permissions="session?.permissions || []" />
      <ExpenseInbox v-if="section === 'messages'" />
      <ArchiveBorrowPanel v-if="section === 'archives'" :archives="archives" />
      <section v-if="section === 'dashboard'" class="expense-dashboard">
        <article class="expense-role-card">
          <div class="expense-role-card__info">
            <span class="expense-role-card__avatar" aria-hidden="true">{{ sessionInitials }}</span>
            <div class="expense-role-card__copy">
              <strong class="expense-role-card__name">{{ session?.display_name || session?.subject_id || '当前账号' }}</strong>
              <span class="expense-role-card__meta">角色：{{ sessionRolesLabel }}</span>
              <span class="expense-role-card__meta">{{ scopeDescription }}</span>
            </div>
          </div>
          <p class="expense-role-card__summary">
            当前可办理 <strong>{{ dashboard?.pending_approvals ?? '—' }}</strong> 条审批待办
          </p>
        </article>
        <!-- 读取失败必须显示原因和重试，不能落成"没有待办"。 -->
        <ErrorState v-if="dashboardError" :error="dashboardError" title="工作台加载失败" @retry="load" />
        <template v-else>
          <div class="expense-metrics expense-metrics--tiles" role="group" aria-label="工作台指标">
            <template v-for="metric in dashboardMetrics" :key="metric.key">
              <button v-if="sectionAllowed(metric.section)" type="button"
                class="expense-metric expense-metric-link"
                :data-tone="metric.tone"
                @click="navigate(metric.section)"
              >
                <span class="expense-metric__icon" aria-hidden="true">
                  <ConsoleIcon :name="metric.icon" />
                </span>
                <span class="expense-metric__body">
                  <span class="expense-metric__label">{{ metric.label }}</span>
                  <strong class="expense-metric__value">
                    {{ dashboard?.[metric.key] ?? '不可用' }}<span v-if="dashboard?.[metric.key] != null" class="expense-metric__suffix">{{ metric.suffix }}</span>
                  </strong>
                  <span class="expense-metric__hint">{{ metric.hint }}</span>
                </span>
              </button>
              <span v-else class="expense-metric" :data-tone="metric.tone">
                <span class="expense-metric__icon" aria-hidden="true">
                  <ConsoleIcon :name="metric.icon" />
                </span>
                <span class="expense-metric__body">
                  <span class="expense-metric__label">{{ metric.label }}</span>
                  <strong class="expense-metric__value">
                    {{ dashboard?.[metric.key] ?? '不可用' }}<span v-if="dashboard?.[metric.key] != null" class="expense-metric__suffix">{{ metric.suffix }}</span>
                  </strong>
                  <span class="expense-metric__hint">{{ metric.hint }}</span>
                </span>
              </span>
            </template>
          </div>
          <div class="expense-split">
            <section class="expense-panel expense-panel--flush">
              <header class="expense-card-head">
                <h2 class="expense-card-title">我的待办</h2>
                <span class="expense-card-extra">共 {{ dashboard?.pending_approvals ?? 0 }} 条</span>
              </header>
              <div v-if="dashboard?.pending_tasks?.length" class="expense-table">
                <table class="expense-table-body expense-table-body--fit">
                  <thead>
                    <tr><th scope="col">单号</th><th scope="col">当前节点</th><th scope="col">创建时间</th><th scope="col">操作</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="task in dashboard.pending_tasks" :key="task.id">
                      <td><strong>{{ task.claim_no || task.claim_id }}</strong></td>
                      <td><span class="expense-badge info">{{ approvalNodeLabel(task.node_code) }}</span></td>
                      <td>{{ formatBusinessDateTime(task.created_at) }}</td>
                      <td><button type="button" class="expense-button" @click="navigate('approvals')">查看审批</button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else-if="dashboard" class="expense-meta">当前没有可办理的审批待办。</p>
            </section>
            <aside class="expense-split__side">
              <section class="expense-panel">
                <header class="expense-card-head">
                  <h2 class="expense-card-title">快捷操作</h2>
                </header>
                <div class="expense-quick-actions">
                  <button v-if="can('expense.claim.create')" type="button" class="expense-button" @click="startNewClaim"><ConsoleIcon name="account" />新建报销</button>
                  <button v-if="can('expense.invoice.upload')" type="button" class="expense-button" @click="navigate('invoice-upload')"><ConsoleIcon name="save" />上传发票</button>
                  <button type="button" class="expense-button" @click="navigate('claims')"><ConsoleIcon name="audit" />我的报销</button>
                  <button v-if="sectionAllowed('approvals')" type="button" class="expense-button" @click="navigate('approvals')"><ConsoleIcon name="shield" />待我审批</button>
                </div>
              </section>
            </aside>
          </div>
        </template>
      </section>
      <!-- 刷新后找回：保留任务与原件位置，用户不必重新上传。 -->
      <section v-if="workspace === 'invoice-upload' && (recentTask.parse || recentTask.document)" class="expense-panel" aria-label="找回上次上传与解析">
        <header class="expense-card-head">
          <h2 class="expense-card-title">找回上次上传与解析</h2>
          <span class="expense-card-extra">任务与原件坐标保存在本机</span>
        </header>
        <p>刷新页面后任务号和文档号仍保留在本机；继续查询不会重新上传，也不会重复发起解析。</p>
        <div class="expense-actions">
          <button v-if="recentTask.document" type="button" class="expense-button" @click="resumeRecentDocument">
            读取最近上传的原件（{{ savedAtLabel(recentTask.document.saved_at) }}）
          </button>
          <button v-if="recentTask.parse" type="button" class="expense-button" @click="resumeParseTask">
            继续查询上次解析任务
          </button>
        </div>
      </section>
      <section v-if="workspace === 'invoice-upload' && can('expense.invoice.upload')" class="expense-upload-page">
        <section class="expense-panel">
          <header class="expense-card-head">
            <h2 class="expense-card-title"><span class="expense-step">1</span>选择发票文件</h2>
            <span class="expense-card-extra">1–20 个文件 · 单个 ≤ 20MiB</span>
          </header>
          <label class="expense-upload-zone"
            @dragover.prevent
            @drop.prevent="uploadInvoiceBatch"
          >
            <input
              type="file"
              accept=".pdf,.ofd,.png,.jpg,.jpeg"
              multiple
              :disabled="saving || batchBusy || !!pending"
              @change="uploadInvoiceBatch"
            >
            <span class="expense-upload-zone__icon" aria-hidden="true">
              <ConsoleIcon name="save" />
            </span>
            <span class="expense-upload-zone__title">拖拽发票到此处，或点击选择文件</span>
            <span class="expense-upload-zone__help">支持 PDF / OFD / PNG / JPEG。PDF/OFD 可解析候选；图片请人工录入，人工核验不代表税务自动验真。</span>
          </label>
          <ul v-if="uploadBatch.length" class="expense-todo-list" aria-live="polite">
            <li v-for="(file,index) in uploadBatch" :key="index" class="expense-todo">
              <span class="expense-todo__main">
                <b>{{ file.name }}</b>
                <small>{{ {WAITING:'等待',UPLOADING:'上传中',READY:'已就绪',UNKNOWN:'结果待确认',FAILED:'失败'}[file.status] }}</small>
              </span>
              <button type="button" v-if="file.document_id" class="expense-button" @click="documentID=file.document_id; readDocument()">读取此原件</button>
            </li>
          </ul>
        </section>
        <section class="expense-panel">
          <header class="expense-card-head">
            <h2 class="expense-card-title"><span class="expense-step">2</span>解析与原件</h2>
            <span class="expense-card-extra">解析结果仅辅助填写</span>
          </header>
          <div class="expense-option-field">
            <span>原件文档（上传后自动回填；也可按文件名选择已上传原件）</span>
            <BusinessOptionPicker
              v-model="documentID"
              path="/invoice-document-options"
              purpose="reimbursement.invoice.original"
              object-label="原件文档"
              :current-label="documentLabel"
              :disabled="saving || batchBusy || !!pending"
              aria-label="选择原件文档"
            />
            <small v-if="documentLabel">本次上传：{{ documentLabel }}</small>
          </div>
          <div class="expense-actions">
            <button type="button" class="expense-button primary" :disabled="saving || !documentID" @click="parseDocument">
              发起解析
            </button>
            <button type="button" class="expense-button" :disabled="!documentID" @click="readDocument">
              查询原件状态
            </button>
            <button type="button"
              class="expense-button"
              :disabled="saving || !!pending || !documentID"
              @click="prepareManualInvoice()"
            >
              人工复核 / 拆分多票
            </button>
            <button type="button" v-if="parseRun" class="expense-button" @click="refreshParse">
              查询解析状态
            </button>
          </div>
          <div v-if="parseRun" class="expense-item" role="status">
            <h3>解析任务 {{ parseRun.id }}</h3>
            <p>
              <span class="expense-badge" :class="claimStatusTone(parseRun.status)">{{ statusLabel(parseRun.status) }}</span>
              · 已尝试 {{ parseRun.attempt ?? 0 }} 次
              <template v-if="documentStatus">
                · 文档状态：{{ statusLabel(documentStatus.status) }}
              </template>
            </p>
            <ul v-if="documentStatus?.detail?.parse_issues?.length">
              <li v-for="issue in documentStatus.detail.parse_issues" :key="issue">{{ issue }}</li>
            </ul>
            <p v-if="parseRun.last_error" role="alert">
              处理失败：{{ failureMessage(parseRun.last_error) }}
            </p>
            <button v-if="parseRun.last_error || parseRun.status === 'FAILED'" type="button"
              class="expense-button" :disabled="saving || !!pending || !documentID" @click="parseDocument">
              重新发起解析
            </button>
          </div>
          <p class="expense-meta">解析仅提取字段；人工复核、外部税务查验分别显示。</p>
        </section>
      </section>
      <ParseExceptionsPanel v-if="workspace==='invoice-abnormal' && can('expense.invoice.read')"
        @open="openParseException" />
      <section v-if="workspace==='invoice-abnormal' && parseRun" class="expense-panel" aria-label="当前原件解析任务">
        <h3>当前原件解析任务</h3>
        <p>当前原件 · {{ statusLabel(parseRun.status) }}
          · 已尝试 {{ parseRun.attempt ?? 0 }} 次</p>
        <p v-if="parseRun.last_error" role="alert">处理失败：{{ failureMessage(parseRun.last_error) }}</p>
        <button type="button" class="expense-button" @click="refreshParse">刷新任务与原件</button>
        <button v-if="parseRun.last_error || parseRun.status === 'FAILED'" type="button"
          class="expense-button" :disabled="saving || !!pending || !documentID" @click="parseDocument">
          重新发起解析
        </button>
      </section>
      <section v-if="workspace === 'invoice-upload' && documentStatus" class="expense-panel">
        <header class="expense-card-head">
          <h2 class="expense-card-title"><span class="expense-step">3</span>识别结果与人工录入</h2>
          <span class="expense-card-extra">当前原件共 {{ parsedCandidates.length }} 组候选</span>
        </header>
        <p>
          以下结果仅辅助填写。金额缺失、票据分组不确定或字段冲突时，请逐张对照原件；创建后仍须独立人工复核，不能视为已验真。
        </p>
        <div class="expense-table">
          <table class="expense-table-body">
            <thead>
              <tr>
                <th scope="col">
                  候选号码
                </th>
                <th scope="col">
                  日期
                </th>
                <th scope="col">
                  票面总额
                </th>
                <th scope="col">
                  分组 / 缺失原因
                </th>
                <th scope="col">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(candidate, index) in parsedCandidates" :key="index">
                <td>
                  {{ candidate.invoice_number || '待人工识别' }}
                </td>
                <td>
                  {{ candidate.invoice_date || '待核对' }}
                </td>
                <td>
                  {{ candidate.gross_minor && /^[1-9]\d*$/.test(candidate.gross_minor) ? `${formatMinor(candidate.gross_minor)} 元` : '缺失，需人工填写' }}
                </td>
                <td>
                  {{ groupLabels[candidate.group_kind] || '分组未确认，需人工判断' }}
                  <ul>
                    <li v-for="issue in candidate.issues || []" :key="issue">
                      {{ issue }}
                    </li>
                  </ul>
                </td>
                <td>
                  <button type="button"
                    class="expense-button"
                    :disabled="saving || !!pending"
                    @click="prepareManualInvoice(candidate)"
                  >
                    辅助填写人工复核
                  </button>
                </td>
              </tr>
              <tr v-if="!parsedCandidates.length">
                <td colspan="5">
                  暂无可用识别候选，可从当前已就绪原件人工录入；不能把缺金额当成零元票据。
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <button type="button"
          v-if="can('expense.invoice.upload')"
          class="expense-button"
          :disabled="saving || !!pending"
          @click="prepareManualInvoice()"
        >
          从此原件新建 / 继续拆分另一张票
        </button>
        <fieldset v-if="manualInvoiceForm" :disabled="saving || !!pending" class="expense-item">
          <h3>
            人工票面录入（待复核）
          </h3>
          <p>
            绑定原件 {{ candidateDocumentID }} · {{ candidateFileID }}。此处没有任意文件URL或其他原件输入。
          </p>
          <div class="expense-grid">
            <label>
              票种
              <input v-model="manualInvoiceForm.invoice_type">
            </label>
            <label>
              发票代码
              <input v-model="manualInvoiceForm.invoice_code">
            </label>
            <label>
              发票号码
              <input v-model="manualInvoiceForm.invoice_number">
            </label>
            <label>
              开票日期
              <input v-model="manualInvoiceForm.invoice_date" type="date">
            </label>
            <label>
              票面总额（元，人工核对后填写）
              <input v-model="manualInvoiceForm.amount" inputmode="decimal" placeholder="缺失时保持空白">
            </label>
            <label>
              销售方税号
              <input v-model="manualInvoiceForm.seller_tax_id">
            </label>
            <label>
              购买方税号
              <input v-model="manualInvoiceForm.buyer_tax_id">
            </label>
          </div>
          <InvoiceContentFields v-model:value="manualInvoiceForm.content" />
          <details v-if="selectedCandidate?.field_candidates">
            <summary>
              原始字段候选与来源（仅供辅助）
            </summary>
            <div class="expense-table">
              <table class="expense-table-body">
                <thead>
                  <tr>
                    <th scope="col">
                      字段
                    </th>
                    <th scope="col">
                      候选值
                    </th>
                    <th scope="col">
                      来源
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <template
                    v-for="(values, field) in selectedCandidate.field_candidates"
                    :key="field"
                  >
                    <tr v-for="(value, index) in values" :key="index">
                      <td>
                        {{ candidateFields[field] || field }}
                      </td>
                      <td>
                        {{ candidateValue(field, value) }}
                      </td>
                      <td>
                        <span v-for="(source, si) in value.sources || []" :key="si">
                          {{ source.page ? `第${source.page}页` : source.xml_path || source.region || '未定位' }}（{{ source.x ?? '—' }},{{ source.y ?? '—' }}）
                        </span>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </details>
          <button type="button"
            class="expense-button primary"
            :disabled="!manualInvoiceForm.amount"
            @click="createManualInvoice"
          >
            创建这张待复核票据
          </button>
        </fieldset>
      </section>
      <section v-if="section === 'payments'" class="expense-panel">
        <label>
          单据状态
          <select v-model="paymentStatus">
            <option value="APPROVED_PENDING_PAYMENT">
              待付款
            </option>
            <option value="PAID">
              已付款（可申请冲正）
            </option>
            <option value="">
              全部可见单据
            </option>
          </select>
        </label>
      </section>
      <section v-if="section === 'approvals'" class="expense-panel">
        <nav class="expense-status-tabs" aria-label="审批线路">
          <button type="button" v-for="(label,key) in {ALL:'全部线路',TECHNICAL:'技术线',SALES:'销售线'}" :key="key"
            class="expense-button" :aria-pressed="listFilters.route_type === (key==='ALL'?'':key)"
            @click="listFilters.route_type=key==='ALL'?'':key;applyFilters()">{{ label }}</button>
        </nav>
        <p>超期提示从当前任务最近激活或变更起满48小时计算；不改变审批权限。</p>
        <label>
          任务范围
          <select v-model="approvalStatus">
            <option value="PENDING">
              当前待办
            </option>
            <option value="APPROVED">
              已同意
            </option>
            <option value="RETURNED">
              已退回
            </option>
            <option value="">
              全部历史
            </option>
          </select>
        </label>
        <p>审批动作、原因与二次确认在下方任务详情内完成；列表只用于定位待办。</p>

      </section>
      <section v-if="section === 'policies'" class="expense-policies">
        <section class="expense-panel">
          <header class="expense-card-head">
            <h2 class="expense-card-title">政策配置</h2>
            <span class="expense-card-extra">已发布版本不可覆盖</span>
          </header>
          <div class="expense-tabs" role="group" aria-label="政策配置分组">
            <button v-for="tab in policyTabs" :key="tab.key" type="button" class="expense-button"
              :aria-pressed="activePolicyTab === tab.key" @click="selectPolicyTab(tab.key)">{{ tab.label }}</button>
          </div>
          <label v-if="activePolicyTab === 'other'">
            其他配置类型
            <select v-model="policyKind" :disabled="saving || !!pending">
              <option value="standards">费用标准</option>
              <option value="city_mappings">城市代码与人工映射</option>
              <option value="archive_retention_policies">组织档案保留政策</option>
              <option value="historical_tail_policies">历史尾款政策（默认关闭）</option>
              <option value="route_rules">审批路由</option>
              <option value="assignments">财务岗位 / 受控替代人</option>
              <option value="finance_entities">付款主体</option>
              <option value="payment_accounts">付款账户</option>
              <option value="payee_profiles">收款档案</option>
              <option value="employee_profiles">员工费用职级</option>
              <option value="invoice_rules">票种身份与查验规则</option>
              <option value="scopes">显式数据范围</option>
            </select>
          </label>
          <p>
            选择记录查看实际字段；保存创建草稿，发布前请核对差异。已发布版本不可覆盖。
          </p>
        </section>
        <article v-if="policyRecord" class="expense-panel">
          <header class="expense-card-head">
            <h2 class="expense-card-title">所选版本 {{ policyRecord.id }}</h2>
            <span class="expense-badge" :class="claimStatusTone(policyLifecycleStatus)">{{ statusLabel(policyLifecycleStatus) }}</span>
          </header>
          <p>
            内容版本 {{ policyRecord.content_version ?? policyRecord.version }} · 当前操作版本 {{ policyVersion }}
          </p>
          <template v-if="policyLifecycleStatus === 'RETIRED'">
            <p>
              已停止新增使用；原内容和历史批准快照保留，仍可审阅。
            </p>
            <p>
              退休时间：{{ formatBusinessDateTime(policyRecord.retired_at) || '未记录' }} · 操作主体：{{ policyRecord.retirement_actor_subject_id || '未记录' }}
            </p>
            <p>
              退休原因：{{ policyRecord.retirement_reason || policyLifecycleReason || '请刷新列表读取' }}
            </p>
            <p v-if="policyRecord.replaced_by_id">
              替换版本：{{ policyRecord.replaced_by_id }}
            </p>
          </template>
        </article>
        <section class="expense-panel">
          <header class="expense-card-head">
            <h2 class="expense-card-title">版本表单</h2>
            <span class="expense-card-extra">{{ activePolicyTab === 'other' ? '其他配置' : policyTabs.find(tab => tab.key === activePolicyTab)?.label }}</span>
          </header>
          <fieldset
            :disabled="policyPublished || saving || !!pending || !can('expense.config.manage')"
          >
            <div class="expense-grid">
            <div v-for="field in currentPolicyFields.filter(row => row.type !== 'content-mappings')" :key="field.key">
              <BusinessObjectSelect v-if="['person', 'organization', 'project', 'finance-entity'].includes(field.type)"
                v-model="policyForm[field.key]" :label="field.label" :source="policyObjectSource(field)"
                :extra-params="policyObjectParams(field)" :value-key="field.type === 'project' ? 'project_id' : 'id'"
                :label-key="field.type === 'project' ? 'project_name' : ''" :selected-label="policyObjectNames[field.key] || ''"
                :required-search="field.type === 'person'" :disabled="policyPublished || saving || !!pending || !can('expense.config.manage')"
                @select="rememberPolicyObject(field, $event)" />
              <template v-else-if="field.type === 'organizations'">
                <BusinessObjectSelect v-model="policyOrganizationChoice" :label="field.label" source="/organization-options"
                  :extra-params="policyForm.subject_id ? { subject_id: policyForm.subject_id } : {}"
                  :disabled="policyPublished || saving || !!pending || !can('expense.config.manage')" @select="addPolicyOrganization" />
                <ul><li v-for="org in policyForm[field.key]" :key="org">
                  {{ policyOrganizationNames[org] || '已关联组织（名称待核对）' }}
                  <button type="button" class="expense-button"
                    @click="policyForm[field.key] = policyForm[field.key].filter(value => value !== org)">移除</button>
                </li></ul>
              </template>
              <CitySelect v-else-if="field.type === 'city'" v-model="policyForm[field.key]" :label="field.label"
                :disabled="policyPublished || saving || !!pending || !can('expense.config.manage')" />
              <label v-else>{{ field.label }}{{ field.required ? ' *' : '' }}
                <input v-if="field.type === 'boolean'" v-model="policyForm[field.key]" type="checkbox" :data-field="field.key">
                <select v-else-if="field.type === 'select'" v-model="policyForm[field.key]" :data-field="field.key">
                  <option value="">请选择</option>
                  <option v-for="option in field.options" :key="option" :value="option">{{ optionLabels[option] || option }}</option>
                </select>
                <input v-else v-model="policyForm[field.key]" :data-field="field.key"
                  :type="field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'"
                  :inputmode="field.type === 'money' ? 'decimal' : undefined">
              </label>
            </div>

          </div>
          <InvoiceContentMappings v-if="policyKind === 'invoice_rules'" v-model:value="policyForm.content_mappings" />
        </fieldset>
        <p v-if="policyKind === 'route_rules'">
          费用负责人来自项目经理；技术负责人、销售负责人分别来自项目技术总监和项目销售总监权威引用。
          本表只保存兼容线路规则，不分配或覆盖业务首次审批人员；节点及触发条件由服务端生成。
        </p>
        <p v-if="policyKind === 'assignments'">
          {{ assignmentPurpose(policyForm.role) }} 项目经理替代须绑定精确项目，其他替代按已授权组织/项目范围校验。
        </p>
        <p v-if="policyKind === 'scopes'">
          普通财务、审计和档案人员默认按已发布组织列表授权；未配置范围时拒绝相关读取和操作。
          tenant_all必须显式勾选并按授权流程发布，不能从岗位、角色名称或平台应用授权推断。
          超级管理员的本租户全量范围只认服务端expense.scope.tenant_all能力，仍受职责分离限制。
        </p>
        <p v-if="policyKind === 'historical_tail_policies'">
          仅指定组织和项目生效；费用日不得晚于费用截止日，政策有效期按提交业务日核对。
          启用、发布和最终审批分别校验，配置页面不会自动放行已终止项目。
        </p>
        <details v-if="policyChanges.length" open>
          <summary>
            发布前字段差异（{{ policyChanges.length }}项）
          </summary>
          <div class="expense-table">
            <table class="expense-table-body">
              <thead>
                <tr>
                  <th scope="col">
                    字段
                  </th>
                  <th scope="col">
                    原版本
                  </th>
                  <th scope="col">
                    当前草稿
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="change in policyChanges" :key="change.label">
                  <td>
                    {{ change.label }}
                  </td>
                  <td>
                    {{ change.before }}
                  </td>
                  <td>
                    {{ change.after }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
        <div class="expense-actions">
          <button type="button"
            v-if="can('expense.config.manage')"
            class="expense-button"
            :disabled="saving || !!pending || policyPublished"
            @click="savePolicy"
          >
            保存政策草稿
          </button>
          <button type="button"
            v-if="policyID && can('expense.config.manage')"
            class="expense-button"
            @click="clonePolicy"
          >
            基于此版本新建草稿
          </button>
          <button type="button"
            v-if="can('expense.policy.publish')"
            class="expense-button primary"
            :disabled="saving || !policyID || !!pending || policyLifecycleStatus !== 'DRAFT'"
            @click="publishPolicy"
          >
            发布所选版本
          </button>
          </div>
        </section>
        <section v-if="can('expense.policy.publish') && policyLifecycleStatus === 'ACTIVE' && policyID" class="expense-panel">
          <header class="expense-card-head">
            <h2 class="expense-card-title">停止使用或替换有效政策</h2>
            <span class="expense-card-extra">退休不可恢复</span>
          </header>
          <fieldset :disabled="saving || !!pending">
          <p>
            退休不可恢复，只停止新单据使用。若已有替换草稿，请用原子替换，旧版本退休与新版本发布一起生效。
          </p>
          <label>
            退休或替换原因 *
            <textarea v-model="policyLifecycleReason" maxlength="1000" />
          </label>
          <button type="button"
            class="expense-button"
            :disabled="!policyLifecycleReason.trim()"
            @click="retirePolicy"
          >
            退休当前版本（不可恢复）
          </button>
          <label>
            替换用已保存草稿
            <select v-model="replacementPolicyID">
              <option value="">
                选择同类草稿
              </option>
              <option
                v-for="replacement in replacementCandidates"
                :key="replacement.id"
                :value="replacement.id"
              >
                {{ replacement.name || replacement.fee_type || optionLabels[replacement.role] || '同类政策草稿' }} · v{{ replacement.version }}
              </option>
            </select>
          </label>
          <p v-if="!replacementCandidates.length">
            当前页没有同类草稿。可翻页查找，或先保存新草稿后再选择旧版本进行替换。
          </p>
          <button type="button"
            class="expense-button primary"
            :disabled="!replacementPolicyID || !policyLifecycleReason.trim()"
            @click="replacePolicy"
          >
            原子替换并发布草稿
          </button>
          </fieldset>
        </section>
      </section>
      <section v-if="['claims','invoices','approvals','payments','archives','analytics'].includes(section) && workspace !== 'invoice-upload'
        && !(section === 'claims' && (selected || claimFormOpen))" class="expense-list-tools">
        <p v-if="workspace === 'invoice-abnormal'" class="expense-alert">
          集中处理未确认、查验不一致及待关闭风险；进入详情查看真实来源和处理记录。
        </p>
        <div v-if="section === 'claims'" class="expense-tabs" role="group" aria-label="报销状态">
          <button type="button" v-for="(label,key) in statusTabs" :key="key" class="expense-button" :aria-pressed="listFilters.status===key"
            @click="listFilters.status=key;applyFilters()">{{ label }}</button>
        </div>
        <form class="expense-searchbar" @submit.prevent="applyFilters">
          <label>单号 / 标题 / 发票号码<input v-model="listFilters.q" maxlength="128"></label>
          <label v-if="section !== 'invoices'">报销类型<select v-model="listFilters.claim_type">
            <option value="">全部类型</option><option v-for="(label,key) in claimTypes" :key="key" :value="key">{{ label }}</option>
          </select></label>
          <label>开始日期<input v-model="listFilters.date_from" type="date"></label>
          <label>结束日期<input v-model="listFilters.date_to" type="date"></label>
          <BusinessObjectSelect v-if="section !== 'invoices'" v-model="listFilters.applicant_subject_id"
            label="报销人" source="/personnel-options" :extra-params="{ purpose: 'applicant' }"
            :required-search="true" :disabled="saving || !!pending" />
          <template v-if="section === 'invoices'">
            <label>票种<input v-model="listFilters.invoice_type" maxlength="64"></label>
            <label>核验状态<select v-model="listFilters.verification_status"><option value="">全部</option>
              <option value="NOT_CHECKED">未核验</option><option value="MANUAL_REVIEWED">已人工核验</option>
              <option value="MISMATCH">不一致</option><option value="VERIFIED">正式外部验真通过</option></select></label>
            <label>票面复核<select v-model="listFilters.review_status"><option value="">全部</option>
              <option value="PENDING">待复核</option><option value="CONFIRMED">已确认</option></select></label>
          </template>
          <div class="expense-searchbar__actions">
            <button type="submit" class="expense-button primary" :disabled="loading">查询</button>
            <button type="button" class="expense-button" @click="resetFilters">重置</button>
          </div>
        </form>
        <p class="expense-meta">日期按北京时间业务日查询。仅筛选当前账号可见对象，不授予额外数据权限。</p>
      </section>
      <InvoiceClassificationEvidence v-if="['invoices','claims'].includes(section)" :rows="invoiceSuggestions" />
      <section v-if="section === 'analytics'" class="expense-analytics">
        <!-- 看板读取失败要显示原因和重试，不能让面板整块消失。 -->
        <ErrorState v-if="analyticsError" :error="analyticsError" title="看板加载失败" @retry="load" />
        <EmptyState v-else-if="!statistics" title="看板数据尚未读取"
          description="点击「刷新」读取当前范围内的已付款统计。" />
        <template v-else>
          <section class="expense-panel">
            <header class="expense-card-head">
              <h2 class="expense-card-title">个人与项目费用看板</h2>
              <span class="expense-card-extra">{{ statistics.date_from }} 至 {{ statistics.date_to }}</span>
            </header>
            <p>范围按单据创建月归属的当前已付净额统计，已全额冲正的历史付款不重复计入。</p>
            <div class="expense-metrics expense-metrics--tiles" role="group" aria-label="报销看板指标">
              <article class="expense-metric" data-tone="blue">
                <span class="expense-metric__body"><span class="expense-metric__label">单据总数</span><strong class="expense-metric__value">{{ statistics.total_count }}<span class="expense-metric__suffix">单</span></strong></span>
              </article>
              <article class="expense-metric" data-tone="orange">
                <span class="expense-metric__body"><span class="expense-metric__label">超标单据</span><strong class="expense-metric__value">{{ statistics.over_standard_count }}<span class="expense-metric__suffix">单</span></strong></span>
              </article>
              <article class="expense-metric" data-tone="purple">
                <span class="expense-metric__body"><span class="expense-metric__label">差旅异常</span><strong class="expense-metric__value">{{ statistics.exception_count }}<span class="expense-metric__suffix">单</span></strong></span>
              </article>
              <article class="expense-metric" data-tone="blue">
                <span class="expense-metric__body"><span class="expense-metric__label">已提交单据</span><strong class="expense-metric__value">{{ statistics.submitted_count ?? '未提供' }}</strong></span>
              </article>
              <article class="expense-metric" data-tone="red">
                <span class="expense-metric__body"><span class="expense-metric__label">实际退回单据</span><strong class="expense-metric__value">{{ statistics.returned_count ?? '未提供' }}</strong></span>
              </article>
              <article class="expense-metric" data-tone="red">
                <span class="expense-metric__body"><span class="expense-metric__label">实际退回率</span><strong class="expense-metric__value">{{ returnRateLabel(statistics.return_rate_basis_points) }}</strong></span>
              </article>
              <article class="expense-metric" data-tone="orange">
                <span class="expense-metric__body"><span class="expense-metric__label">超标占比</span><strong class="expense-metric__value">{{ statistics.total_count ? (statistics.over_standard_count*100/statistics.total_count).toFixed(1) : '0.0' }}<span class="expense-metric__suffix">%</span></strong></span>
              </article>
            </div>
            <p class="expense-meta">退回率按当前筛选范围内有真实提交事实的去重单据计算；同单多轮退回只计一次，撤回与作废不计退回，差旅异常单独统计。</p>
          </section>
          <section class="expense-panel">
            <header class="expense-card-head">
              <h2 class="expense-card-title">比例概览</h2>
            </header>
            <div class="expense-donut-grid">
              <article class="expense-item expense-donut-card expense-donut-card--ink">
                <h3>超标占比</h3>
                <div class="expense-donut" role="img"
                  :aria-label="`超标占比 ${overStandardPercentText}`"
                  :style="{ '--donut-value': overStandardRatio }"
                >
                  <span class="expense-donut__value">{{ overStandardPercentText }}</span>
                </div>
                <p class="expense-donut__note">
                  超标 {{ statistics.over_standard_count }} 单 / 共 {{ statistics.total_count }} 单
                </p>
              </article>
              <article class="expense-item expense-donut-card expense-donut-card--light">
                <h3>退回率</h3>
                <div class="expense-donut" role="img"
                  :aria-label="`退回率 ${returnRatePercentText}`"
                  :style="{ '--donut-value': returnRateRatio }"
                >
                  <span class="expense-donut__value">{{ returnRatePercentText }}</span>
                </div>
                <p class="expense-donut__note">
                  按有真实提交事实的去重单据计算
                </p>
              </article>
            </div>
          </section>
          <section v-for="group in [{key:'monthly',field:'month',title:'月度趋势'},{key:'by_type',field:'claim_type',title:'类型分布'},{key:'by_project',field:'project_id',title:'项目成本'}]" :key="group.key" class="expense-panel">
            <header class="expense-card-head">
              <h2 class="expense-card-title">{{ group.title }}</h2>
            </header>
            <p v-if="!statistics[group.key]?.length">当前范围没有数据。</p>
            <div v-for="row in statistics[group.key]" :key="row[group.field]" class="expense-chart-row">
              <span>{{ group.key==='by_type' ? claimTypes[row.claim_type] || '历史未分类' : row[group.field] }}</span>
              <meter min="0" max="100" :value="statisticWidth(row,statistics[group.key])" :aria-label="`${row[group.field]}金额占最大分组比例`" />
              <span>{{ formatMinor(row.amount_minor) }} 元 · {{ row.count }} 单</span>
            </div>
          </section>
        </template>
      </section>
      <section v-if="section === 'archives'" class="expense-panel expense-panel--flush">
        <header class="expense-card-head">
          <h2 class="expense-card-title">项目归档包</h2>
          <span class="expense-card-extra">按实际封存日期筛选；同一单据多个档案版本不重复累计金额</span>
        </header>
        <!-- 归档聚合失败显示原因与重试，不再整块消失。 -->
        <ErrorState v-if="archiveProjectsError" :error="archiveProjectsError" title="项目归档包加载失败" @retry="load" />
        <div v-else-if="archiveProjects" class="expense-table">
          <table class="expense-table-body">
            <thead><tr><th scope="col">项目</th><th scope="col">报销单数</th><th class="expense-num" scope="col">当前净额</th><th scope="col">最近封存</th><th scope="col">操作</th></tr></thead>
            <tbody>
              <tr v-for="project in archiveProjects.items" :key="project.project_id">
                <td>{{ project.project_id }}</td>
                <td>{{ project.claim_count }}</td>
                <td class="expense-num">{{ formatMinor(project.amount_minor) }} 元</td>
                <td>{{ formatBusinessDateTime(project.last_archived_at) }}</td>
                <td><button type="button" class="expense-button" @click="openArchiveProject(project.project_id)">查看项目档案</button></td>
              </tr>
              <tr v-if="!archiveProjects.items.length"><td colspan="5">当前范围没有已封存项目档案。</td></tr>
            </tbody>
          </table>
        </div>
        <p v-else class="expense-meta">当前范围没有已封存项目档案。</p>
      </section>
      <section v-if="section !== 'dashboard' && !['invoice-upload','analytics','recovery','messages'].includes(workspace)
        && !(section === 'claims' && (selected || claimFormOpen))" class="expense-panel expense-panel--flush">
        <header class="expense-card-head">
          <h2 class="expense-card-title">{{ listTitle }}</h2>
          <div class="expense-card-extra">
            <span>共 {{ total }} 条</span>
            <button v-if="workspace === 'invoices' && can('expense.invoice.upload')" type="button" class="expense-button" @click="navigate('invoice-upload')">上传发票</button>
            <button v-if="workspace === 'invoices' && sectionAllowed('invoice-abnormal')" type="button" class="expense-button" @click="navigate('invoice-abnormal')">异常发票池</button>
          </div>
        </header>
        <div v-if="section === 'invoices' && can('expense.claim.create') && selectedInvoiceIDs.length" class="expense-bulkbar">
          <span>已选择 {{ selectedInvoiceIDs.length }} 张</span>
          <button type="button" class="expense-button primary" :disabled="saving || !!pending" @click="createDraftFromInvoices">从已确认发票生成费用草稿</button>
        </div>
        <p v-if="section === 'invoices' && can('expense.claim.create')" class="expense-panel__note">
          只有「已人工复核」且未被其他单据占用的本人票据可以勾选生成费用；其余票据请先复核票面。
        </p>
        <!-- 失败落在列表位置并带重试；空列表才说"暂无记录"。 -->
        <ErrorState v-if="listError" :error="listError" title="列表加载失败" class="expense-panel__state" @retry="load" />
        <EmptyState v-else-if="!loading && !rows.length" title="当前权限范围内暂无记录"
          description="调整筛选条件，或确认当前账号的数据范围后再试。" class="expense-panel__state" />
        <div v-else class="expense-table">
          <table class="expense-table-body">
            <thead>
              <tr>
                <th v-if="section === 'invoices' && can('expense.claim.create')" scope="col">选择</th>
                <th v-if="['claims','payments','archives'].includes(section) && can('expense.archive.export')" scope="col">导出选择</th>
                <th scope="col">
                  编号 / 标题
                </th>
                <th scope="col">
                  状态 / 版本
                </th>
                <th scope="col">
                  {{ listAmountLabel }}
                </th>
                <th scope="col">{{ section === 'invoices' ? '类型 / 开票日期' : section === 'approvals' ? '类型 / 受理人' : '类型 / 报销人' }}</th>
                <th v-if="listHasNodeColumn" scope="col">{{ listNodeLabel }}</th>
                <th scope="col">创建时间</th><th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id">
                <td v-if="['claims','payments','archives'].includes(section) && can('expense.archive.export')">
                  <input v-model="selectedClaimIDs" type="checkbox" :value="row.id" :disabled="saving || !!pending" :aria-label="`选择导出 ${row.claim_no || row.id}`"></td>
                <td v-if="section === 'invoices' && can('expense.claim.create')">
                  <input v-model="selectedInvoiceIDs" type="checkbox" :value="row.id"
                    :disabled="row.review_status !== 'CONFIRMED' || !['AVAILABLE',''].includes(row.reservation_state || '')"
                    :title="invoiceSelectHint(row) || undefined"
                    :aria-label="`选择发票${row.invoice_number || row.id}`">
                </td>
                <td>
                  {{ row.claim_no || row.invoice_number || row.claim_id || row.id }}
                  <small>
                    {{ row.title || row.fee_type || row.node_code || row.name }}
                  </small>
                </td>
                <td>
                  <span class="expense-badge" :class="listRowTone(row)">{{ listRowStatusText(row) }}</span>
                  <small>
                    版本 {{ row.version }}
                  </small>
                </td>
                <td class="expense-num">
                  {{ section === 'invoices' ? moneyText(row.total_minor) : section === 'approvals' ? `第 ${row.round} 轮` : moneyText(row.payable_minor || row.limit_minor) }}
                </td>
                <td>{{ section === 'invoices' ? `${row.invoice_type || '待确认'} / ${row.invoice_date || '日期待确认'}` : `${claimTypes[row.claim_type] || '历史未分类'} / ${row.applicant_subject_id || row.assignee_subject_id || '本任务范围未提供'}` }}</td>
                <td v-if="section === 'invoices'">{{ row.seller_tax_id || '税号待核对' }} · <span class="expense-badge" :class="claimStatusTone(row.verification_status)">{{ statusLabel(row.verification_status) }}</span></td>
                <td v-else-if="listHasNodeColumn">{{ row.current_approval_node || row.node_code ? approvalNodesLabel(row.current_approval_node || row.node_code) : '—' }}
                  <span v-if="section==='approvals' && row.urgency==='OVERDUE'" class="expense-flag danger">待办超48小时</span>
                  <span v-if="row.has_over_standard" class="expense-flag">超标</span>
                  <span v-if="row.has_exception" class="expense-flag danger">异常</span>
                </td>
                <td>{{ formatBusinessDateTime(row.created_at) }}
                  <small v-if="section==='approvals' && row.pending_since">当前待办起点 {{ formatBusinessDateTime(row.pending_since) }}</small></td>
                <td class="expense-actions">
                  <button type="button"
                    v-if="section === 'invoices'"
                    class="expense-button"
                    @click="openInvoice(row.id)"
                  >
                    复核详情
                  </button>
                  <button type="button" v-else-if="section === 'approvals'" class="expense-button" @click="openApproval(row.id)">
                    查看任务与办理
                  </button>
                  <button type="button"
                    v-else-if="section === 'policies'"
                    class="expense-button"
                    :disabled="saving || !!pending"
                    @click="selectPolicy(row)"
                  >
                    查看版本
                  </button>
                  <button type="button" v-else class="expense-button" @click="openClaim(row.id)">
                    查看详情
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer v-if="!listError" class="expense-panel__foot">
          <button type="button" v-if="['claims','payments','archives'].includes(section) && can('expense.archive.export')" class="expense-button"
            :disabled="!selectedClaimIDs.length || saving || !!pending" @click="exportSelectedClaims">导出所选 {{ selectedClaimIDs.length }} 张</button>
          <PaginationBar label="报销列表分页" :page="page" :total="total" :page-size="pageSize"
            :page-size-options="[10, 20, 50, 100]" :loading="loading"
            @change="nextPage => { page = nextPage; load() }"
            @change-page-size="nextSize => { pageSize = nextSize; applyFilters() }" />
        </footer>
      </section>
      <div v-if="approvalTask && section === 'approvals'" class="expense-split">
        <div class="expense-split__main">
          <ApprovalRoundsPanel :claim-id="approvalTask.claim_id" />
          <section ref="detailPanel" class="expense-panel">
            <header class="expense-detail-head">
              <div>
                <h2>
                  第 {{ approvalTask.round }} 轮 · {{ approvalNodeLabel(approvalTask.node_role || approvalTask.node_code) }}
                </h2>
                <p class="expense-detail-meta">
                  固定快照版本 {{ approvalTask.snapshot?.version }} · 状态 {{ statusLabel(approvalTask.status) }}
                  · 待办人 {{ approvalTask.assignee || '以服务端当前受理人为准' }}
                </p>
              </div>
              <button type="button" class="expense-button" @click="backToList('approval')">
                返回待办列表
              </button>
            </header>
        <p v-if="approvalTask.snapshot?.scope_limited">
          仅展示本任务覆盖项目；完整票据和其他项目分摊不在本任务范围。
        </p>
        <template v-if="!approvalTask.snapshot?.scope_limited && can('expense.invoice.read')">
          <h3>审批关联票据影像</h3>
          <div class="expense-actions" v-for="item in approvalTask.snapshot?.items || []" :key="item.id">
            <button type="button" v-for="usage in item.invoice_usages || []" :key="usage.invoice_id" class="expense-button" @click="previewApprovalInvoice(usage.invoice_id)">读取票据 {{ usage.invoice_id }} 原件</button>
          </div>
          <button type="button" v-for="source in invoiceRows" :key="source.id || source.file_id" class="expense-button" @click="readInvoiceOriginal(source)">{{ source.filename || source.file_id }} 查看影像</button>
          <InvoiceOriginalViewer :preview="originalPreview" :download="originalDownload" :media="originalMedia" title="审批受控票据原件" alt="审批受控发票影像" />
        </template>
        <div class="expense-table">
          <table class="expense-table-body">
            <thead>
              <tr>
                <th scope="col">
                  费用类型
                </th>
                <th scope="col">
                  发生日
                </th>
                <th scope="col">
                  范围内金额
                </th>
                <th scope="col">
                  项目分摊
                </th>
                <th scope="col">
                  追加原因
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in approvalTask.snapshot?.items || []" :key="item.id">
                <td>
                  {{ item.fee_type }}
                  <strong v-if="item.expense_nature==='PREPAYMENT'" class="expense-flag warning">预付费用</strong>
                  <p v-if="item.finance_review_required">财务重点复核：{{ item.review_hints?.join('、') }}</p>
                  <template v-if="!approvalTask.snapshot?.scope_limited">
                    <p v-if="item.reason">用途与说明：{{ item.reason }}</p>
                    <button type="button" v-for="file in item.no_invoice_evidence_file_ids || []" :key="file" class="expense-button"
                      @click="downloadClaimEvidence(file,approvalTask.claim_id)">查看独立证明 {{ file }}</button>
                  </template>
                </td>
                <td>
                  {{ item.occurred_date }}
                </td>
                <td>
                  {{ formatMinor(item.requested_minor) }} 元
                </td>
                <td>
                  <p v-for="part in item.allocations" :key="part.project_id + part.service_item_id">
                    <RouterLink v-if="returnProject" :to="{ ...returnProject, query: { project: part.project_id } }">{{ part.project_id }}</RouterLink><span v-else>{{ part.project_id }}</span> / {{ part.service_item_id || '项目级' }}：{{ formatMinor(part.amount_minor) }} 元
                  </p>
                </td>
                <td>
                  {{ item.over_standard ? '超标准 ' : '' }}{{ item.travel_exception ? '差旅异常' : '' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section
        v-if="approvalTask && section === 'approvals'"
        class="expense-panel"
        aria-label="审批转交历史"
      >
        <header class="expense-actions">
          <h2>
            审批与每跳转交历史
          </h2>
          <button type="button" class="expense-button" :disabled="historyLoading" @click="loadApprovalHistory">
            {{ historyLoading ? '读取中…' : '刷新历史' }}
          </button>
        </header>
        <p v-if="historyError" class="expense-alert danger" role="alert">
          {{ historyError }}
        </p>
        <p v-if="!historyLoading && !historyError && !approvalHistory.length">
          本任务暂无可见动作记录。
        </p>
        <ol class="expense-history">
          <li v-for="entry in approvalHistory" :key="entry.id">
            <header>
              <strong>
                {{ { TRANSFER: '转交', APPROVE: '同意', RETURN: '退回', ADDSIGN: '加签' }[entry.action] || '动作已记录' }}
              </strong>
              <time>
                {{ formatBusinessDateTime(entry.created_at) }}
              </time>
            </header>
            <p>
              第 {{ entry.round }} 轮 · {{ approvalNodeLabel(entry.node_role || entry.node_code) }} · 操作人 {{ entry.actor_subject_id }}
            </p>
            <p v-if="entry.action === 'TRANSFER'">
              <strong>
                {{ entry.from_subject_id || '历史原主体未记录' }}
              </strong>
              →
              <strong>
                {{ entry.to_subject_id || '历史目标主体未记录' }}
              </strong>
            </p>
            <p>
              理由：{{ entry.reason || '未填写' }}
            </p>
            <p v-if="entry.qualification_evidence_status === 'LEGACY_NOT_RECORDED'">
              旧记录未保存当时资格证据；不能据当前受理人补造。
            </p>
            <details v-else-if="entry.qualification_evidence">
              <summary>
                当时资格复核依据
              </summary>
              <dl class="expense-grid">
                <div>
                  <dt>
                    核验目标主体
                  </dt>
                  <dd>
                    {{ entry.qualification_evidence.target_subject_id }}
                  </dd>
                </div>
                <div>
                  <dt>
                    所需能力
                  </dt>
                  <dd>
                    {{ entry.qualification_evidence.required_permission }}
                  </dd>
                </div>
                <div>
                  <dt>
                    核验时间
                  </dt>
                  <dd>
                    {{ formatBusinessDateTime(entry.qualification_evidence.verified_at) }}
                  </dd>
                </div>
                <div>
                  <dt>
                    资格来源
                  </dt>
                  <dd>
                    {{ entry.qualification_evidence.source }}
                  </dd>
                </div>
                <div>
                  <dt>
                    当时任务版本
                  </dt>
                  <dd>
                    {{ entry.task_version_before ?? entry.qualification_evidence.task_version }} → {{ entry.task_version_after ?? '未记录' }}
                  </dd>
                </div>
              </dl>
            </details>
            <details v-if="entry.assignment_evidence?.length">
              <summary>
                当时责任映射
              </summary>
              <ul>
                <li v-for="assignment in entry.assignment_evidence" :key="assignment.id">
                  {{ approvalNodeLabel(assignment.role) }} · {{ assignment.subject_id }} · 组织 {{ assignment.org_id }} · v{{ assignment.version }}
                </li>
              </ul>
            </details>
          </li>
        </ol>
          </section>
        </div>
        <aside class="expense-split__side">
          <section class="expense-panel" aria-label="办理当前审批任务">
            <header class="expense-card-head">
              <h2 class="expense-card-title">办理当前审批任务</h2>
              <span class="expense-badge warning">待办</span>
            </header>
            <label>
              审批说明（退回、转交、加签时必须填写）
              <textarea v-model="approvalReason" maxlength="2000" data-field="approval_reason" />
            </label>
            <label>
              转交 / 加签目标主体
              <BusinessObjectSelect :key="approvalTask.id" v-model="transferSubject"
                label="转交或加签人员" source="/personnel-options"
                :extra-params="{ purpose: 'transfer', resource_id: approvalTask.id }"
                :required-search="true" :disabled="saving || !!pending" data-field="transfer_subject" />
            </label>
            <div class="expense-actions">
              <button v-for="action in approvalTask.allowed_actions || []" :key="action" type="button"
                class="expense-button" :class="{ primary: action === 'APPROVE', danger: action === 'RETURN' }"
                :disabled="saving || !!pending" @click="requestApprovalAction(action)">
                {{ approvalActionLabel(action) }}
              </button>
            </div>
            <p v-if="!(approvalTask.allowed_actions || []).length">
              当前任务没有可执行动作；请核对任务状态、轮次和受理人。
            </p>
            <div v-if="pendingApprovalAction" class="expense-alert warning" role="alertdialog" aria-label="确认审批动作">
              <p>
                确认对第 {{ approvalTask.round }} 轮「{{ approvalNodeLabel(approvalTask.node_role || approvalTask.node_code) }}」执行「{{ approvalActionLabel(pendingApprovalAction) }}」？
              </p>
              <p v-if="pendingApprovalAction === 'RETURN'">退回原因：{{ approvalReason.trim() || '未填写' }}</p>
              <p v-if="['TRANSFER', 'ADDSIGN'].includes(pendingApprovalAction)">目标主体：{{ transferSubject.trim() }}</p>
              <div class="expense-actions">
                <button type="button" class="expense-button primary" :disabled="saving || !!pending" @click="confirmApprovalAction">
                  确认{{ approvalActionLabel(pendingApprovalAction) }}
                </button>
                <button type="button" class="expense-button" @click="cancelApprovalAction">
                  取消
                </button>
              </div>
            </div>
          </section>
        </aside>
      </div>
      <section
        v-if="section === 'claims' && (selected || claimFormOpen)"
        class="expense-claim-workspace"
      >
        <header class="expense-detail-head">
          <div>
            <h2>
              {{ selected ? `单据 ${selected.claim_no || selected.id}` : '新建草稿' }}
              <span v-if="selected" class="expense-badge" :class="claimStatusTone(selected.status)">{{ statusLabel(selected.status) }}</span>
            </h2>
            <p class="expense-detail-meta">
              {{ selected ? `版本 ${selected.version} · 应付金额 ${formatMinor(selected.payable_minor)} 元` : '保存后生成服务器草稿，提交前请完成全部校验。' }}
            </p>
          </div>
          <button v-if="selected" type="button" class="expense-button" @click="backToList('claim')">
            返回列表
          </button>
        </header>
        <div class="expense-split">
          <section ref="detailPanel" class="expense-panel">
        <p v-if="selected" class="expense-meta">
          状态 {{ statusLabel(selected.status) }} · 版本 {{ selected.version }} · 应付金额 {{ formatMinor(selected.payable_minor) }} 元
          <template v-if="selected.status !== 'DRAFT' && selected.status !== 'WITHDRAWN'">
            · 第 {{ selected.current_round || selected.round || 1 }} 轮
            <template v-if="selected.current_approval_node"> · 当前节点 {{ approvalNodesLabel(selected.current_approval_node) }}</template>
          </template>
        </p>
        <div v-if="claimContextChips.length" class="expense-context" role="group" aria-label="当前单据参数">
          <span class="expense-context__title">当前参数</span>
          <span v-for="chip in claimContextChips" :key="chip.label" class="expense-context__chip">
            <small>{{ chip.label }}</small><b>{{ chip.value }}</b>
          </span>
        </div>
        <ApprovalRoundsPanel
          v-if="selected && selected.status !== 'DRAFT' && selected.status !== 'WITHDRAWN'"
          :key="`claim-rounds-${selected.id}`"
          :claim-id="selected.id"
        />
        <p v-if="selected?.invoice_date_warnings?.length" class="expense-alert warning">存在发票时效风险：{{ selected.invoice_date_warnings.map(row=>`${row.invoice_id}已开具${row.age_days}天`).join('；') }}。已冻结到当前审批快照。</p>
        <p v-if="claimReadonlyReason && editable" class="expense-alert warning">
          {{ claimReadonlyReason }}
        </p>
        <template v-if="selected && !editable">
          <h3><span class="expense-step">1</span>单据摘要</h3>
          <div class="expense-item">
            <div class="expense-summary-list">
              <div class="expense-summary-list__item"><span class="expense-summary-list__k">单据状态</span><span class="expense-summary-list__v">{{ statusLabel(selected.status) }}</span></div>
              <div class="expense-summary-list__item"><span class="expense-summary-list__k">报销类型</span><span class="expense-summary-list__v">{{ claimTypes[selected.claim_type] || '历史未分类' }}</span></div>
              <div class="expense-summary-list__item"><span class="expense-summary-list__k">报销人</span><span class="expense-summary-list__v">{{ applicantName }}</span></div>
              <div class="expense-summary-list__item"><span class="expense-summary-list__k">应付金额</span><span class="expense-summary-list__v">{{ moneyText(selected.payable_minor) }}</span></div>
              <div class="expense-summary-list__item"><span class="expense-summary-list__k">版本</span><span class="expense-summary-list__v">{{ selected.version }}</span></div>
              <div class="expense-summary-list__item"><span class="expense-summary-list__k">当前轮次</span><span class="expense-summary-list__v">{{ selected.current_round || selected.round || '—' }}</span></div>
              <div class="expense-summary-list__item"><span class="expense-summary-list__k">当前节点</span><span class="expense-summary-list__v">{{ selected.current_approval_node ? approvalNodesLabel(selected.current_approval_node) : '—' }}</span></div>
              <div class="expense-summary-list__item"><span class="expense-summary-list__k">创建时间</span><span class="expense-summary-list__v">{{ formatBusinessDateTime(selected.created_at) }}</span></div>
            </div>
          </div>
          <h3><span class="expense-step">2</span>费用明细</h3>
          <div class="expense-table">
            <table class="expense-table-body">
              <thead><tr><th scope="col">费用类型</th><th scope="col">发生日</th><th class="expense-num" scope="col">金额</th><th scope="col">说明</th></tr></thead>
              <tbody>
                <tr v-for="item in draft.items" :key="item.id">
                  <td>{{ item.fee_type || '未分类' }}</td>
                  <td>{{ item.occurred_date || '—' }}</td>
                  <td class="expense-num">{{ moneyText(item.requested_minor) }}</td>
                  <td>{{ item.reason || '—' }}</td>
                </tr>
                <tr v-if="!draft.items.length"><td colspan="4">当前单据没有可见费用项。</td></tr>
              </tbody>
            </table>
          </div>
        </template>
        <template v-else>
        <h3><span class="expense-step">1</span>基础信息</h3>
        <p v-if="!currentDraftContext.ready" role="status">{{ currentDraftContext.message }}</p>

        <fieldset :disabled="!editable || saving || !!pending">
          <div class="expense-grid">
            <label>
              标题
              <input v-model="draft.title" maxlength="200" data-field="title" :aria-invalid="invalidField('title')">
            </label>
            <label>报销类型<select v-model="draft.claim_type" data-field="claim_type" :aria-invalid="invalidField('claim_type')">
              <option v-if="!draft.claim_type" value="">历史未分类，请确认后选择</option>
              <option v-for="(label,key) in claimTypes" :key="key" :value="key">{{ label }}</option>
            </select></label>
            <label>备注<textarea v-model="draft.remark" maxlength="2000" /></label>
            <label>报销单号<input :value="selected?.claim_no || '保存后自动生成'" readonly></label>
            <label>报销人<input :value="applicantName" readonly></label>
            <label>所属部门<input :value="currentDraftContext.organization_name || '任职部门待确认'" readonly></label>
            <BusinessObjectSelect v-if="organizationOptions.length > 1" v-model="draft.org_id"
              label="当前任职选择" data-field="org_id" :aria-invalid="invalidField('org_id')" :options="organizationOptions" :disabled="saving || !!pending"
              @select="applyDraftContext($event?.id || '')" />
            <label v-if="currentDraftContext.ready">业务线路
              <input :value="optionLabels[currentDraftContext.route_type]" readonly>

            </label>
            <BusinessObjectSelect v-model="draft.finance_entity_id" data-field="finance_entity_id" :aria-invalid="invalidField('finance_entity_id')" label="付款主体" :options="draftEntityOptions"
              :disabled="saving || !!pending || !currentDraftContext.ready" />
            <BusinessObjectSelect v-model="draft.payee_profile_id" data-field="payee_profile_id" :aria-invalid="invalidField('payee_profile_id')" label="本人已审核收款资料" :options="draftPayeeOptions"
              :disabled="saving || !!pending || !currentDraftContext.ready" />
          </div>
          <div class="expense-actions">
            <input v-model="keyword" aria-label="项目关键词" placeholder="搜索有费用资格的项目">
            <button class="expense-button" :disabled="projectLoading" @click="searchProjects()">搜索本人项目</button>
            <button v-if="projectCursor" class="expense-button" :disabled="projectLoading"
              @click="searchProjects(true)">下一页项目</button>

          </div>
          <p v-if="projectLoading" role="status">正在读取本人报告阶段可用项目…</p>
          <p v-if="projectError" role="alert">{{ projectError }}</p>
          <h3><span class="expense-step">2</span>关联本人项目</h3>
          <p>项目须已进入报告编制或已完成；仅展示当前本人范围及有效费用参与资格。</p>
          <p v-if="route.query.project_id">
            {{ projectRouteHint }} 地址参数不代表费用资格。
          </p>
          <ClaimPreviewPanel :value="claimPreview" :busy="previewBusy" :error="previewError"
            :enabled="previewEnabled" :disabled="!selected || !editable || saving || !!pending" @refresh="refreshClaimPreview" />
          <h3><span class="expense-step">3</span>费用明细与票据</h3>
          <article v-for="(item, index) in draft.items" :key="item.id" class="expense-item" :data-expense-index="index" tabindex="-1">

            <h3>
              费用 {{ index + 1 }}
            </h3>
            <InvoiceClassificationEvidence :rows="item.classification_evidence || []" saved />
            <TravelFields v-model:value="item.travel_declaration" :disabled="!editable" />
            <div class="expense-form-grid">
              <label>费用性质<select v-model="item.expense_nature" data-field="expense_nature" :aria-invalid="invalidField('expense_nature', index)"><option value="ACTUAL">实际发生费用</option><option value="PREPAYMENT">预付费用（须政策允许及财务复核）</option></select></label>
              <p v-if="item.expense_nature==='PREPAYMENT'">预付需说明用途并上传独立证明；没有有效预付政策时服务端拒绝提交，不产生借款或自动核销。</p>
              <CitySelect v-model="item.city_code" label="费用城市" :disabled="saving || !!pending || !editable" data-field="city_code" :aria-invalid="invalidField('city_code', index)" />
              <label>交通分类<input v-model="item.transport_category" :list="`transport-${item.id}`" placeholder="选择已发布标准编码或输入" data-field="transport_category" :aria-invalid="invalidField('transport_category', index)">
                <datalist :id="`transport-${item.id}`"><option v-for="value in standardChoices('transport_category',item.fee_type)" :key="value" :value="value" /></datalist></label>
              <label>住宿分类<input v-model="item.accommodation_category" :list="`accommodation-${item.id}`" placeholder="选择已发布标准编码或输入" data-field="accommodation_category" :aria-invalid="invalidField('accommodation_category', index)">
                <datalist :id="`accommodation-${item.id}`"><option v-for="value in standardChoices('accommodation_category',item.fee_type)" :key="value" :value="value" /></datalist></label>
              <label>无票证明类型<select v-model="item.no_invoice_proof_type" data-field="no_invoice_proof_type" :aria-invalid="invalidField('no_invoice_proof_type', index)"><option value="">未选择</option><option value="PAYMENT_PROOF">支付证明</option><option value="SERVICE_CONFIRMATION">服务确认</option><option value="OTHER">其他证明</option></select></label>
              <label>无票／预付独立证明（PDF / PNG / JPEG）<input type="file" accept=".pdf,.png,.jpg,.jpeg"
                @change="uploadInvoice($event,'reimbursement.claim.evidence',`claimNoInvoice:${item.id}`)"></label>
              <div class="expense-option-field">
                <span>独立证明文件（上传后自动关联；也可按文件名补选，仍由服务器校验）</span>
                <BusinessOptionPicker
                  :model-value="splitIDs(item.no_invoice_evidence_text)"
                  path="/invoice-document-options"
                  purpose="reimbursement.claim.evidence"
                  value-key="file_id"
                  object-label="独立证明文件"
                  multiple
                  :disabled="!editable || saving || !!pending"
                  aria-label="选择无票或预付独立证明文件"
                  data-field="no_invoice_evidence_file_ids"
                  :aria-invalid="invalidField('no_invoice_evidence_file_ids', index)"
                  @update:model-value="ids => { item.no_invoice_evidence_text = ids.slice(0, 20).join(',') }"
                />
              </div>
            </div>
            <div class="expense-grid">
              <label>
                费用类型
                <select v-model="item.fee_type" data-field="fee_type" :aria-invalid="invalidField('fee_type', index)">
                  <option value="">
                    选择费用类型
                  </option>
                  <option v-for="fee in editorOptions?.fee_types || []" :key="fee" :value="fee">
                    {{ fee }}
                  </option>
                </select>
              </label>
              <label>
                发生日期
                <input v-model="item.occurred_date" type="date" data-field="occurred_date" :aria-invalid="invalidField('occurred_date', index)">
              </label>
              <label>
                申请金额（元）
                <input v-model="item.amount" inputmode="decimal" data-field="requested_minor" :aria-invalid="invalidField('requested_minor', index)">
              </label>
              <label>
                标准单位数
                <input v-model.number="item.units" type="number" min="1" data-field="units" :aria-invalid="invalidField('units', index)">
              </label>
              <label>
                城市等级
                <input v-model="item.city_level" :list="`city-level-${item.id}`" data-field="city_level" :aria-invalid="invalidField('city_level', index)">
                <datalist :id="`city-level-${item.id}`"><option v-for="value in standardChoices('city_level',item.fee_type)" :key="value" :value="value" /></datalist>
              </label>
              <label>
                费用职级
                <input
                  :value="currentDraftContext.ready ? editorOptions?.employee_profiles?.find((profile) => profile.id === currentDraftContext.employee_profile_id)?.grade || '待配置' : '档案待明确'"
                  readonly
                >
              </label>
            </div>
            <label>
              个人说明
              <textarea v-model="item.reason" data-field="reason" :aria-invalid="invalidField('reason', index)" />
            </label>
            <label>
              超标说明
              <input v-model="item.exception_reason" data-field="exception_reason" :aria-invalid="invalidField('exception_reason', index)">
            </label>
            <label>
              <input v-model="item.travel_exception" type="checkbox" data-field="travel_exception" :aria-invalid="invalidField('travel_exception', index)">
              差旅异常
            </label>
            <label>
              无票原因（受政策限制）
              <input v-model="item.no_invoice_reason" data-field="no_invoice_reason" :aria-invalid="invalidField('no_invoice_reason', index)">
            </label>
            <h4>
              项目分摊 · 已分摊 {{ allocationTotal(item) }} 元 / 申请 {{ item.amount || '待填写' }} 元
            </h4>
            <label>分摊方式<select :value="item.allocation_mode || 'AMOUNT'" @change="changeAllocationMode(item,$event.target.value)">
              <option value="AMOUNT">按金额</option><option value="RATIO">按比例</option></select></label>
            <p v-if="item.allocation_mode === 'RATIO'">比例合计100%，最多两位小数；按最大余数分配尾分，同余数按项目/服务项排序。金额仅供核对，保存时服务器重新计算。</p>
            <div v-for="(allocation, ai) in item.allocations" :key="ai" class="expense-actions" data-field="allocations" :aria-invalid="invalidField('allocations', index)">
              <select
                aria-label="项目服务项"
                :value="selectedProjectOption(allocation)"
                @change="selectProject(allocation, $event)"
              >
                <option value="">选择项目 / 服务项</option>
                <option v-if="selectedProjectOption(allocation) === 'retained'" value="retained" disabled>
                  {{ selectedProjectLabel(allocation) }}
                </option>
                <option
                  v-for="(option, oi) in projectOptions"
                  :key="`${option.project_id}/${option.service_item_id}`"
                  :value="oi"
                  :disabled="!normalProjectReference(option)"
                >
                  {{ projectReferenceLabel(option) }}
                </option>
              </select>
              <input
                v-if="item.allocation_mode !== 'RATIO'"
                v-model="allocation.amount"
                aria-label="分摊金额元"
                inputmode="decimal"
                placeholder="分摊金额（元）"
              >
              <template v-else><label>比例 %<input v-model="allocation.ratio" inputmode="decimal" aria-label="分摊比例" /></label>
                <span>派生 {{ ratioAmount(item,ai) }} 元</span></template>
              <button type="button" class="expense-button" @click="item.allocations.splice(ai, 1)">
                删除分摊
              </button>
            </div>
            <button type="button"
              class="expense-button"
              @click="item.allocations.push({ project_id: '', service_item_id: '', amount: '',ratio:'' })"
            >
              增加项目分摊
            </button>
            <h4>
              票据用量
            </h4>
            <button type="button" class="expense-button" @click="loadInvoiceChoices">查询本人已确认发票</button>
            <div v-for="(usage, ui) in item.invoice_usages" :key="ui" class="expense-actions" data-field="invoice_usages" :aria-invalid="invalidField('invoice_usages', index)">
              <select v-model="usage.invoice_id" aria-label="选择已复核发票">
                <option value="">选择已复核发票</option>
                <option v-if="usage.invoice_id && !invoiceChoices.some(row=>row.id===usage.invoice_id)" :value="usage.invoice_id">当前引用 {{ usage.invoice_id }}</option>
                <option v-for="invoice in invoiceChoices" :key="invoice.id" :value="invoice.id">{{ invoice.invoice_number || invoice.id }} · {{ invoice.invoice_type }} · {{ formatMinor(invoice.total_minor) }}元</option>
              </select>
              <input
                v-model="usage.amount"
                aria-label="票据使用金额元"
                inputmode="decimal"
                placeholder="使用金额（元）"
              >
              <button type="button" class="expense-button" @click="checkInvoice(usage.invoice_id)">
                核对票据余额
              </button>
              <span>
                服务器剩余 {{ formatMinor(invoiceFacts[usage.invoice_id]?.remaining_minor) }} 元；本草稿合计 {{ draftInvoiceUsage(usage.invoice_id) }} 元
              </span>
              <button type="button" class="expense-button" @click="item.invoice_usages.splice(ui, 1)">
                删除用量
              </button>
            </div>
            <ClaimEvidenceTravelPanel
              :item-number="index + 1"
              :names="evidenceNames"
              :item="item"
              :references="item.allocations.map(referenceFor)"
              :standard-hints="(editorOptions?.standards || []).filter((standard) => standard.org_id === draft.org_id && standard.fee_type === item.fee_type)"
              :tail-policies="(editorOptions?.historical_tail_policies || []).filter((policy) => policy.org_id === draft.org_id && item.allocations.some((part) => part.project_id === policy.project_id))"
              :disabled="!editable || saving || !!pending"
              :can-download="!!selected?.id && !selected?.scope_limited"
              @upload="(event, kind) => uploadClaimEvidence(item.id, event, kind)"
              @download="downloadClaimEvidence"
            />
            <div class="expense-actions">
              <button type="button"
                class="expense-button"
                @click="item.invoice_usages.push({ invoice_id: '', amount: '' })"
              >
                增加票据
              </button>
              <button type="button" class="expense-button" @click="draft.items.splice(index, 1)">
                删除费用
              </button>
            </div>
          </article>
          <button type="button" class="expense-button" @click="addItem">
            添加费用
          </button>
        </fieldset>
        </template>

        <footer class="expense-panel__foot expense-claim-footer">
          <button type="button"
            v-if="!selected"
            class="expense-button primary"
            :disabled="saving || !!pending || !draft.org_id"
            @click="createDraft"
          >
            创建服务器草稿
          </button>
          <button type="button"
            v-if="selected && can('expense.project.reference')"
            class="expense-button"
            :disabled="saving || !!pending"
            @click="validateProjects"
          >
            校验已保存项目资格
          </button>
          <strong>
            分摊前费用合计 {{ draftTotal }} 元
          </strong>
          <button type="button"
            class="expense-button primary"
            :disabled="!editable || saving || !!pending"
            @click="saveDraft"
          >
            保存草稿
          </button>
          <button type="button"
            v-if="selected?.allowed_actions?.includes('SUBMIT')"
            class="expense-button"
            :disabled="saving || !!pending"
            @click="claimAction('submit')"
          >
            提交已保存版本
          </button>
          <button type="button"
            v-if="selected?.allowed_actions?.includes('WITHDRAW')"
            class="expense-button"
            :disabled="saving || !!pending"
            @click="claimAction('withdraw')"
          >
            撤回
          </button>
          <button type="button"
            v-if="selected?.allowed_actions?.includes('VOID')"
            class="expense-button"
            :disabled="saving || !!pending"
            @click="claimAction('void')"
          >
            作废
          </button>
        </footer>
        <div v-if="projectValidation" class="expense-alert">
          <p>
            项目引用已返回权威校验结果。正式提交仍会按当前草稿版本重新校验。
          </p>
          <p
            v-for="reference in projectValidation.items || projectValidation.references || []"
            :key="reference.project_id + reference.service_item_id"
          >
            {{ reference.project_name || reference.project_id }} / {{ reference.service_item_id || '项目级' }}：{{ reference.eligible ? '当前可关联' : '不可关联' }} {{ reference.reason_codes?.join('、') }}
          </p>
        </div>
        <p v-if="selected && draftDirty" class="expense-alert warning">
          当前编辑尚未保存，保存后才能提交。
        </p>
        <p>
          提交使用最后保存的服务器版本。修改表单后请先保存。非项目费用首发关闭。
        </p>
          </section>
          <aside class="expense-split__side">
            <section class="expense-panel">
              <header class="expense-card-head">
                <h2 class="expense-card-title">本次报销</h2>
                <span class="expense-card-extra">{{ draft.items.length }} 条费用</span>
              </header>
              <div class="expense-summary-list">
                <div class="expense-summary-list__item">
                  <span class="expense-summary-list__k">单据状态</span>
                  <span class="expense-summary-list__v">{{ selected ? statusLabel(selected.status) : '新建草稿' }}</span>
                </div>
                <div class="expense-summary-list__item">
                  <span class="expense-summary-list__k">分摊前合计</span>
                  <span class="expense-summary-list__v">{{ draftTotal }} 元</span>
                </div>
                <div class="expense-summary-list__item">
                  <span class="expense-summary-list__k">当前轮次</span>
                  <span class="expense-summary-list__v">{{ selected?.current_round || selected?.round || '—' }}</span>
                </div>
                <div class="expense-summary-list__item">
                  <span class="expense-summary-list__k">当前节点</span>
                  <span class="expense-summary-list__v">{{ selected?.current_approval_node ? approvalNodesLabel(selected.current_approval_node) : '—' }}</span>
                </div>
              </div>
              <p class="expense-meta">保存后仍以服务端重新计算、标准匹配与项目资格校验为准。</p>
            </section>
            <section v-if="claimReadonlyReason" class="expense-panel">
              <header class="expense-card-head">
                <h2 class="expense-card-title">只读原因</h2>
              </header>
              <p>{{ claimReadonlyReason }}</p>
            </section>
            <section v-if="selected?.invoice_date_warnings?.length" class="expense-panel">
              <header class="expense-card-head">
                <h2 class="expense-card-title">关键提醒</h2>
              </header>
              <p class="expense-alert warning">存在发票时效风险：{{ selected.invoice_date_warnings.map(row=>`${row.invoice_id}已开具${row.age_days}天`).join('；') }}。已冻结到当前审批快照。</p>
            </section>
          </aside>
        </div>
      </section>
      <section v-if="selected && ['payments', 'archives'].includes(section)" ref="detailPanel" class="expense-panel">
        <header class="expense-detail-head">
          <div>
            <h2>
              {{ selected.claim_no || selected.title }}
              <span class="expense-badge" :class="claimStatusTone(selected.status)">{{ statusLabel(selected.status) }}</span>
            </h2>
            <p class="expense-detail-meta">
              版本 {{ selected.version }} · 应付 {{ formatMinor(selected.payable_minor) }} {{ selected.currency }}
              <template v-if="selected.status !== 'DRAFT' && selected.status !== 'WITHDRAWN'">
                · 第 {{ selected.current_round || selected.round || 1 }} 轮
                <template v-if="selected.current_approval_node"> · 当前节点 {{ approvalNodesLabel(selected.current_approval_node) }}</template>
              </template>
            </p>
          </div>
          <button type="button" class="expense-button" @click="backToList('claim')">
            返回列表
          </button>
        </header>
        <ApprovalRoundsPanel :key="`payment-rounds-${selected.id}`" :claim-id="selected.id" />
        <ArchivePackagePanel v-if="section === 'archives' && can('expense.archive.export')" :key="selected.id" :archives="archives" />
        <ReimbursementCostNotice :claim="selected" :settlement-enabled="frontendModules.some(module => module.code === 'settlement')" />
        <ClaimSyncPanel :key="selected.id" :claim="selected" :permissions="session?.permissions || []" />
        <template v-if="section === 'payments'">
          <fieldset
            v-if="selected.allowed_actions?.includes('REOPEN') || selected.allowed_actions?.includes('APPROVED_VOID')"
            :disabled="saving || !!pending"
            class="expense-item"
          >
            <h3>
              待付款义务控制
            </h3>
            <p>
              仅无有效付款的待付款单可操作。重开交回申请人重新确认；作废停止该义务，保留原批准快照。
            </p>
            <label>
              财务原因
              <textarea v-model="claimControlReason" maxlength="2000" data-field="control_reason" />
            </label>
            <div class="expense-actions">
              <button type="button"
                v-if="selected.allowed_actions?.includes('REOPEN') && can('expense.claim.reopen')"
                class="expense-button"
                :disabled="!claimControlReason.trim()"
                @click="controlledClaimAction('reopen')"
              >
                重开并交回申请人
              </button>
              <button type="button"
                v-if="selected.allowed_actions?.includes('APPROVED_VOID') && can('expense.claim.approved_void')"
                class="expense-button"
                :disabled="!claimControlReason.trim()"
                @click="controlledClaimAction('approved-void')"
              >
                作废已批准待付款义务
              </button>
            </div>
          </fieldset>
          <fieldset

            v-if="can('expense.payment.record')"
            :disabled="saving || !!pending || selected.status !== 'APPROVED_PENDING_PAYMENT'"
          >
            <h3>
              全额付款事实登记
            </h3>
            <p>
              请核对银行或现金支付事实后登记。本操作不执行银行转账。
            </p>
            <div class="expense-grid">
              <label>
                实际付款日期
                <input v-model="paymentForm.paid_date" type="date" data-field="paid_date">
              </label>
              <label>
                付款方式
                <select v-model="paymentForm.method" data-field="method">
                  <option value="BANK">
                    银行转账
                  </option>
                  <option value="CASH">
                    现金
                  </option>
                </select>
              </label>
              <div class="expense-option-field">
                <span>付款账户（受控账户，按名称选择）</span>
                <select
                  v-model="paymentForm.source_account_ref"
                  data-field="source_account_ref"
                  aria-label="付款账户"
                >
                  <option value="">
                    选择受控付款账户
                  </option>
                  <option
                    v-if="paymentForm.source_account_ref && !paymentAccounts.some(row => row.account_ref === paymentForm.source_account_ref)"
                    :value="paymentForm.source_account_ref"
                  >
                    已保存账户 {{ paymentForm.source_account_ref }}
                  </option>
                  <option v-for="account in paymentAccounts" :key="account.id" :value="account.account_ref">
                    {{ account.name }} · {{ account.account_ref }}
                  </option>
                </select>
                <small v-if="paymentOptionError">付款账户读取失败：{{ paymentOptionError }}</small>
                <small v-else-if="paymentOptionsLoaded && !paymentAccounts.length">当前付款主体没有可用受控账户，请联系财务管理员维护付款账户目录。</small>
              </div>
              <label>
                流水号
                <input v-model="paymentForm.transaction_no" data-field="transaction_no">
              </label>
              <label>
                上传付款凭证
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  :disabled="saving || !!pending"
                  @change="uploadInvoice($event, 'reimbursement.payment.voucher')"
                >
              </label>
              <div class="expense-option-field">
                <span>付款凭证文件（按文件名选择，可多选）</span>
                <BusinessOptionPicker
                  :model-value="splitIDs(paymentForm.voucher_file_ids)"
                  path="/invoice-document-options"
                  purpose="reimbursement.payment.voucher"
                  value-key="file_id"
                  object-label="付款凭证"
                  multiple
                  :disabled="saving || !!pending"
                  aria-label="选择付款凭证文件"
                  data-field="voucher_file_ids"
                  @update:model-value="ids => { paymentForm.voucher_file_ids = ids.slice(0, 20).join(',') }"
                />
              </div>
            </div>
            <p>收款档案：{{ paymentPayeeLabel }}</p>
            <button type="button"
              class="expense-button primary"
              :disabled="saving || !!pending || selected.status !== 'APPROVED_PENDING_PAYMENT'
                || !paymentForm.source_account_ref"
              @click="registerPayment"
            >
              登记全额 {{ formatMinor(selected.payable_minor) }} 元
            </button>
          </fieldset>
          <p v-else class="expense-alert warning">
            你没有登记付款的权限；这里只显示付款记录供核对。付款由出纳登记，且登记人必须与会计审核人不同。
          </p>
          <p v-if="can('expense.payment.record') && selected.status !== 'APPROVED_PENDING_PAYMENT'" class="expense-alert warning">
            只有「待付款」状态的单据可以登记付款；当前状态为「{{ statusLabel(selected.status) }}」，付款字段只读。
          </p>
          <dl v-if="payment" class="expense-grid">
            <div>
              <dt>
                付款记录
              </dt>
              <dd>
                {{ payment.id }}
              </dd>
            </div>
            <div>
              <dt>
                已登记金额
              </dt>
              <dd>
                {{ formatMinor(payment.amount_minor) }} {{ payment.currency }}
              </dd>
            </div>
            <div>
              <dt>
                实际付款日
              </dt>
              <dd>
                {{ payment.paid_date }}
              </dd>
            </div>
            <div>
              <dt>
                流水号
              </dt>
              <dd>
                {{ payment.transaction_no }}
              </dd>
            </div>
          </dl>
          <section class="expense-item">
            <h3>
              付款历史
            </h3>
            <button type="button" class="expense-button" :disabled="paymentHistoryLoading" @click="loadPaymentHistory(1)">
              {{ paymentHistoryLoading ? '读取中…' : '刷新历史' }}
            </button>
            <!-- 没读成功就不能说"尚无付款记录"：读取中、失败、未读取、真为空四种状态分开说。 -->
            <p v-if="paymentHistoryLoading">
              付款历史读取中…
            </p>
            <p v-else-if="paymentHistoryError" class="expense-alert danger" role="alert">
              {{ paymentHistoryError }}
            </p>
            <p v-else-if="!paymentHistoryLoaded">
              付款历史尚未读取；请点击「刷新历史」查询本单付款记录。
            </p>
            <p v-else-if="!paymentHistory.length">
              当前单据尚无付款记录。
            </p>
            <template v-else>
              <p>
                共 {{ paymentHistoryTotal }} 条，第 {{ paymentHistoryPage }} 页。
              </p>
              <div class="expense-table"><table class="expense-table-body">
              <thead>
                <tr>
                  <th scope="col">付款单号</th>
                  <th scope="col">金额</th>
                  <th scope="col">货币</th>
                  <th scope="col">实际付款日</th>
                  <th scope="col">方式</th>
                  <th scope="col">流水号</th>
                  <th scope="col">状态 / 关联</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="record in paymentHistory" :key="record.id">
                  <td>{{ record.id }}</td>
                  <td>{{ formatMinor(record.amount_minor) }}</td>
                  <td>{{ record.currency }}</td>
                  <td>{{ record.paid_date }}</td>
                  <td>{{ record.method === 'BANK' ? '银行转账' : record.method === 'CASH' ? '现金' : record.method }}</td>
                  <td>{{ record.transaction_no }}</td>
                  <td>{{ paymentHistoryStatus(record) }}</td>
                </tr>
              </tbody>
            </table></div>
              <PaginationBar label="付款历史分页" :page="paymentHistoryPage" :total="paymentHistoryTotal"
                :page-size="paymentHistoryPageSize" :loading="paymentHistoryLoading"
                @change="loadPaymentHistory" />
            </template>
            <p v-if="reversalHistoryError" class="expense-alert danger" role="alert">
              {{ reversalHistoryError }}
            </p>
            <template v-if="reversalHistory.length">
              <h4>
                冲正申请
              </h4>
              <div class="expense-table"><table class="expense-table-body">
                <thead>
                  <tr>
                    <th scope="col">申请</th>
                    <th scope="col">事实类型</th>
                    <th scope="col">状态</th>
                    <th scope="col">版本</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in reversalHistory" :key="item.id">
                    <td>{{ item.id }}</td>
                    <td>{{ item.fact_kind === 'NO_PAYMENT' ? '实际未付款' : item.fact_kind === 'FULL_REFUND' ? '全额退款' : item.fact_kind }}</td>
                    <td>{{ statusLabel(item.status) }}</td>
                    <td>v{{ item.version }}</td>
                  </tr>
                </tbody>
              </table></div>
            </template>
          </section>
          <fieldset v-if="can('expense.payment.reversal.request')" :disabled="saving || !!pending">
            <h3>
              独立冲正申请
            </h3>
            <label>
              事实类型
              <select v-model="reversalFact" data-field="fact_kind">
                <option value="NO_PAYMENT">
                  实际未付款
                </option>
                <option value="FULL_REFUND">
                  全额退款
                </option>
              </select>
            </label>
            <label>
              事实与原因
              <textarea v-model="reversalReason" data-field="reason" />
            </label>
            <div class="expense-option-field">
              <span>冲正证据文件（按文件名选择，1至20份）</span>
              <BusinessOptionPicker
                :model-value="splitIDs(evidenceFiles)"
                path="/invoice-document-options"
                purpose="reimbursement.payment.voucher"
                value-key="file_id"
                object-label="冲正证据文件"
                multiple
                :disabled="saving || !!pending"
                aria-label="选择冲正证据文件"
                @update:model-value="ids => { evidenceFiles = ids.slice(0, 20).join(',') }"
              />
            </div>
            <button type="button"
              class="expense-button"
              :disabled="saving || !!pending"
              @click="requestReversal"
            >
              申请冲正
            </button>
          </fieldset>
          <p v-else class="expense-alert warning">
            {{ can('expense.payment.reversal.approve')
              ? '冲正由出纳发起；你可以在下方独立批准或拒绝待处理的冲正申请。'
              : '你没有发起或批准冲正的权限；这里只显示冲正记录供核对。' }}
          </p>

          <div v-if="can('expense.payment.reversal.approve')" class="expense-actions">
            <button type="button" class="expense-button" @click="loadReversals">
              读取冲正待办
            </button>
            <select aria-label="冲正申请" @change="selectReversal">
              <option value="">
                请选择申请及版本
              </option>
              <option v-for="request in reversalRequests" :key="request.id" :value="request.id">
                {{ request.id }} · {{ statusLabel(request.status) }} · v{{ request.version }}
              </option>
            </select>
            <button type="button"
              class="expense-button"
              :disabled="saving || !reversalID || reversalVersion === null || !!pending"
              @click="decideReversal(true)"
            >
              批准冲正
            </button>
            <button type="button"
              class="expense-button"
              :disabled="saving || !reversalID || reversalVersion === null || !!pending"
              @click="decideReversal(false)"
            >
              拒绝冲正
            </button>
          </div>
        </template>
        <template v-else>
          <button type="button" class="expense-button" @click="loadArchives">
            读取归档版本和完整性
          </button>
          <button type="button"
            v-if="can('expense.archive.retry')"
            class="expense-button"
            :disabled="saving || !!pending"
            @click="retryArchive"
          >
            重试归档任务
          </button>
          <article v-for="archive in archives?.items || []" :key="archive.id" class="expense-item">
            <h3>
              归档版本 {{ archive.package_version }} · {{ statusLabel(archive.status) }}
            </h3>
            <p>
              清单摘要：{{ archive.manifest_hash || '尚未封存' }}
            </p>
            <p>
              批准快照：{{ archive.manifest?.approval_content_hash ? '已绑定' : '待生成' }} · 原件 {{ archive.manifest?.files?.length ?? '待确认' }} 份 · 审批轨迹 {{ archive.manifest?.history?.approval_actions?.length ?? '待确认' }} 条
            </p>
            <ul>
              <li v-for="file in archive.manifest?.files || []" :key="file.file_id">
                原件 {{ file.file_id }} · SHA256 {{ file.sha256 }}
              </li>
            </ul>
          </article>
          <p v-if="archives && !archives.items?.length">
            当前单据尚无归档清单。
          </p>
        </template>
      </section>
      <PaymentExceptionPanel
        v-if="selected && section === 'payments' && can(['expense.payment.read', 'expense.payment.exception.record', 'expense.payment.exception.review'])"
        :claim="selected"
        :rows="exceptionRows"
        :page="exceptionPage"
        :total="exceptionTotal"
        :selected="selectedException"
        :form="exceptionForm"
        :review-form="exceptionReviewForm"
        :evidence-names="evidenceNames"
        :can-record="can('expense.payment.exception.record')"
        :can-review="can('expense.payment.exception.review')"
        :saving="saving"
        :pending="!!pending"
        @read="loadPaymentExceptions"
        @select="openPaymentException"
        @record="recordPaymentException"
        @review="reviewPaymentException"
        @upload="uploadExceptionEvidence"
        @page="changeExceptionPage"
      />
      <section v-if="['archives','claims','payments'].includes(section) && can('expense.archive.export')" class="expense-panel">
        <h2>
          受控导出任务
        </h2>
        <button type="button" class="expense-button" :disabled="saving || !!pending" @click="createExport">
          创建导出任务
        </button>
        <template v-if="exportJob">
          <button type="button" class="expense-button" @click="refreshExport">
            查询导出状态
          </button>
          <button type="button"
            v-if="exportJob.status === 'DONE' && exportJob.result?.result?.content !== undefined"
            class="expense-button"
            @click="downloadExport"
          >
            下载导出文件
          </button>
          <p>
            任务 {{ exportJob.id }} · {{ statusLabel(exportJob.status) }} · 已尝试 {{ exportJob.attempt ?? 0 }} 次
          </p>
          <p v-if="exportJob.last_error" role="alert">
            处理失败：{{ failureMessage(exportJob.last_error) }}
          </p>
          <button v-if="exportJob.status === 'FAILED'" type="button" class="expense-button"
            :disabled="saving || !!pending" @click="retryExport">
            重试导出
          </button>
          <p v-if="exportJob.result?.result">
            结果：{{ exportJob.result.result.filename }} · {{ exportJob.result.result.claim_ids?.length }} 张单据 · 摘要 {{ exportJob.result.result.sha256 }}
          </p>
        </template>
        <!-- 刷新后找回：任务号与导出范围都在本地，不需要重新勾选。 -->
        <div v-else-if="recentTask.export" role="status">
          <p>
            上次导出任务 {{ recentTask.export.task_id }} · {{ savedAtLabel(recentTask.export.saved_at) }}提交
          </p>
          <button type="button" class="expense-button" :disabled="saving || !!pending" @click="resumeExportTask">
            继续查询上次导出
          </button>
        </div>
      </section>
      <InvoiceControlsPanel v-if="selectedInvoice && section === 'invoices' && session" :key="selectedInvoice.id" :invoice="selectedInvoice" :session="session" @changed="openInvoice(selectedInvoice.id)" />
      <section v-if="selectedInvoice && section === 'invoices'" ref="detailPanel" class="expense-panel">
        <header class="expense-detail-head">
          <div>
            <h2>
              人工复核 · {{ selectedInvoice.id }}
              <span class="expense-badge" :class="claimStatusTone(selectedInvoice.review_status)">{{ statusLabel(selectedInvoice.review_status) }}</span>
            </h2>
            <p class="expense-detail-meta">
              外部查验：<span class="expense-badge" :class="claimStatusTone(selectedInvoice.verification_status)">{{ statusLabel(selectedInvoice.verification_status) }}</span>
              · 占用：<span class="expense-badge" :class="claimStatusTone(selectedInvoice.reservation_state)">{{ statusLabel(selectedInvoice.reservation_state) }}</span>
            </p>
          </div>
          <button type="button" class="expense-button" @click="backToList('invoice')">
            返回发票列表
          </button>
        </header>
        <aside v-if="selectedInvoice.suspected_duplicates?.length" class="expense-alert warning" role="alert">
          <strong>疑似重复：存在同日、同金额、同销售方的不同票据，请对照原件核验。</strong>
          <p v-for="invoice in selectedInvoice.suspected_duplicates" :key="invoice.invoice_id">{{ invoice.invoice_number }} · {{ invoice.invoice_date }} · {{ formatMinor(invoice.total_minor) }}元</p>
          <p v-if="selectedInvoice.suspected_duplicates_more">当前范围还有匹配票据，请进一步查询台账。</p>
        </aside>
        <InvoiceContentFields v-model:value="invoiceContentEditor" :disabled="!can('expense.invoice.review') || selectedInvoice.owner_subject_id!==session?.subject_id || selectedInvoice.reservation_state!=='AVAILABLE' || saving || !!pending" />
        <p v-if="selectedInvoice.reservation_state!=='AVAILABLE'">已占用或消费的商品服务明细只读，须通过独立更正及申请人重新确认。</p>
        <TravelFields v-model:value="selectedInvoice.travel_facts" invoice :disabled="!can('expense.invoice.review') || selectedInvoice.review_status==='CONFIRMED'" />
        <p v-if="selectedInvoice.review_status==='CONFIRMED'">已确认票面行程只读；重大变化请使用独立更正审批，不重新覆盖原事实。</p>
        <div class="expense-grid">
          <aside>
            <h3>
              来源原件
            </h3>
            <button type="button" class="expense-button" @click="invoiceSources">
              获取受控原件
            </button>
            <p v-if="!invoiceRows.length">
              OFD请下载原件对照；缺字段请人工补录，不能视为已验真。
            </p>
            <button type="button"
              v-for="source in invoiceRows"
              :key="source.id || source.file_id"
              class="expense-button"
              @click="readInvoiceOriginal(source)"
            >
              {{ source.filename || source.file_id }} 下载
            </button>
            <div v-if="selectedSource">
              <p>
                来源：{{ selectedSource.original_name || selectedSource.file_id }} · {{ selectedSource.parse_status ? statusLabel(selectedSource.parse_status) : '解析状态待查询' }}
              </p>
              <p>
                解析器 {{ selectedSource.parser_version || '不可用' }} · 规则 {{ selectedSource.rules_version || '不可用' }}
              </p>
              <p>
                来源性质：{{ { PARSED: '独立解析来源，仍需人工复核', MANUAL_LINK: '人工关联原件', LEGACY_UNVERIFIED: '遗留未核实来源' }[selectedSource.source_kind] || '来源性质待确认' }}
              </p>
              <p v-if="selectedSource.run_id">
                运行 {{ selectedSource.run_id }} · 候选 {{ selectedSource.candidate_index }}
              </p>
              <p v-if="selectedSource.sources_hash">
                来源摘要 {{ selectedSource.sources_hash }}
              </p>
              <ul>
                <li v-for="issue in selectedSource.issues || []" :key="issue">
                  {{ issue }}
                </li>
              </ul>
              <details v-if="selectedSource.sources?.length">
                <summary>
                  字段来源与坐标（展示前50行）
                </summary>
                <div class="expense-table">
                  <table class="expense-table-body">
                    <thead>
                      <tr>
                        <th scope="col">
                          页码 / XML路径
                        </th>
                        <th scope="col">
                          坐标
                        </th>
                        <th scope="col">
                          源文字
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(source, index) in selectedSource.sources.slice(0, 50)"
                        :key="index"
                      >
                        <td>
                          {{ source.page || source.xml_path || '—' }}
                        </td>
                        <td>
                          {{ source.x ?? '—' }}, {{ source.y ?? '—' }}
                        </td>
                        <td>
                          {{ source.text || '—' }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
            <InvoiceOriginalViewer :preview="originalPreview" :download="originalDownload" :media="originalMedia" title="发票原件对照" alt="受控发票原件" transformable :report-error="showError" />
            <a
              v-if="originalDownload"
              :href="originalDownload"
              :download="`invoice-original.${({'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg'})[originalMedia] || 'ofd'}`"
              class="expense-button"
            >
              下载当前原件
            </a>
          </aside>
          <p v-if="invoiceReadonlyReason" class="expense-alert warning">
            {{ invoiceReadonlyReason }}
          </p>
          <fieldset :disabled="saving || !!pending || !can('expense.invoice.review')
            || selectedInvoice.owner_subject_id !== session?.subject_id
            || !['AVAILABLE', ''].includes(selectedInvoice.reservation_state || '')
            || selectedInvoice.review_status === 'CONFIRMED'">
            <label>
              发票类型
              <input v-model="selectedInvoice.invoice_type">
            </label>
            <label>
              发票代码
              <input v-model="selectedInvoice.invoice_code">
            </label>
            <label>
              发票号码
              <input v-model="selectedInvoice.invoice_number">
            </label>
            <label>
              开票日期
              <input v-model="selectedInvoice.invoice_date" type="date">
            </label>
            <label>
              销售方税号
              <input v-model="selectedInvoice.seller_tax_id">
            </label>
            <label>
              购买方税号
              <input v-model="selectedInvoice.buyer_tax_id">
            </label>
            <label>
              票面总额（元）
              <input v-model="invoiceTotalYuan" inputmode="decimal" placeholder="对照原件填写，最多两位小数">
              <small v-if="invoiceTotalMinorHint">提交时记为 {{ invoiceTotalMinorHint }}</small>
            </label>
            <label>
              人工复核或校正原因
              <textarea v-model="invoiceReviewReason" />
            </label>
            <button type="button" class="expense-button primary" @click="confirmInvoice">
              确认人工复核字段
            </button>
          </fieldset>
        </div>
        <fieldset v-if="can('expense.invoice.verify')" :disabled="saving || !!pending">
          <h3>
            独立人工核验记录
          </h3>
          <p>
            人工核验只记录人工依据，不能代替正式外部税务查验。
          </p>
          <label>
            核验结论
            <select v-model="verificationResult">
              <option value="PASS">
                人工对照一致
              </option>
              <option value="MISMATCH">
                存在不一致
              </option>
              <option value="UNKNOWN">
                无法确认
              </option>
            </select>
          </label>
          <label>
            核验依据
            <textarea v-model="verificationReason" />
          </label>
          <div class="expense-option-field">
            <span>核验证据原件（按文件名选择，1至20份）</span>
            <BusinessOptionPicker
              :model-value="splitIDs(verificationEvidence)"
              path="/invoice-document-options"
              purpose="reimbursement.invoice.original"
              value-key="file_id"
              object-label="核验证据原件"
              multiple
              :disabled="saving || !!pending"
              aria-label="选择核验证据原件"
              @update:model-value="ids => { verificationEvidence = ids.slice(0, 20).join(',') }"
            />
          </div>
          <button type="button" class="expense-button" @click="verifyInvoice">

            保存人工核验记录
          </button>
        </fieldset>
      </section>
    </template>
  </AppShell>
</template>
