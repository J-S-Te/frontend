<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import AppShell from '../../shared/components/AppShell.vue'
import LoadingState from '../../shared/components/LoadingState.vue'
import InvoiceControlsPanel from '../components/InvoiceControlsPanel.vue'
import ArchivePackagePanel from '../components/ArchivePackagePanel.vue'
import ApprovalRoundsPanel from '../components/ApprovalRoundsPanel.vue'
import ClaimSyncPanel from '../components/ClaimSyncPanel.vue'
import RecoveryPanel from '../components/RecoveryPanel.vue'
import ExpenseInbox from '../components/ExpenseInbox.vue'
import TravelFields from '../components/TravelFields.vue'
import InvoiceContentFields from '../components/InvoiceContentFields.vue'
import InvoiceContentMappings from '../components/InvoiceContentMappings.vue'
import InvoiceClassificationEvidence from '../components/InvoiceClassificationEvidence.vue'
import { invoiceContentForm, invoiceContentInput, returnRateLabel, autoReturnNotice } from '../invoiceClassification.js'
import ArchiveBorrowPanel from '../components/ArchiveBorrowPanel.vue'
import PaymentExceptionPanel from '../components/PaymentExceptionPanel.vue'
import ClaimPreviewPanel from '../components/ClaimPreviewPanel.vue'
import ParseExceptionsPanel from '../components/ParseExceptionsPanel.vue'
import ClaimEvidenceTravelPanel from '../components/ClaimEvidenceTravelPanel.vue'
import { canSelectProjectReference, editableClaimItem, evidenceIDs,travelInput } from '../claimFields.js'
import { approvalNodeLabel, assignmentPurpose, expenseScopeDescription, hasTenantAllCapability,
  reimbursementRoleLabel } from '../rolePresentation.js'
import { formatBusinessDateTime, todayBusinessDate } from '../../shared/utils/businessTime.js'
import { createCommandRunner, createRequestID, formatMinor, toMinor, validateItems } from '../api/client.js'
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
const conflictSnapshot = ref(null)
const returnProject = computed(() => frontendModules.some((module) => module.code === 'project_management') ? returnProjectLocation(route.query) : null)
const notice = ref('')
const pending = ref(null)
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
const selectedInvoice = ref(null)
const invoiceContentEditor = ref(null)
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
const archives = ref(null)
const archiveProjects=ref(null)
const projectValidation = ref(null)
const projectOptions = ref([])
const keyword = ref('')
const invoiceRows = ref([])
const originalPreview = ref('')
const originalDownload = ref('')
const originalMedia = ref('')
const previewZoom=ref(1)
const previewRotation=ref(0)
const selectedSource = ref(null)
const invoiceFacts = ref({})
const exportJob = ref(null)
const parseRun = ref(null)
const documentStatus = ref(null)
const manualInvoiceForm = ref(null)
const candidateDocumentID = ref('')
const candidateFileID = ref('')
const selectedCandidate = ref(null)
const selectedCandidateSource = ref(null)
const parsedCandidates = computed(() => documentStatus.value?.detail?.parse_result?.documents || [])
const documentID = ref('')
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
const approvalStatus = ref('PENDING')
const transferSubject = ref('')
const reversalID = ref('')
const reversalReason = ref('')
const reversalFact = ref('NO_PAYMENT')
const evidenceFiles = ref('')
const paymentForm = ref({ paid_date: todayBusinessDate(), method: 'BANK',
  source_account_ref: '', transaction_no: '', voucher_file_ids: '' })
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
const draftDirty = computed(() => JSON.stringify(draft.value) !== draftBaseline.value)
let loadSequence = 0

const sections = [
  ['dashboard', '报销工作台', 'expense.claim.read'],
  ['invoices', '发票中心', 'expense.invoice.read'],
  ['invoice-upload', '发票上传与人工录入', 'expense.invoice.upload'],
  ['invoice-abnormal', '异常发票池', 'expense.invoice.read'],
  ['claims', '我的报销单', 'expense.claim.read'],
  ['submitted', '我发起的审批', 'expense.claim.read'],
  ['approvals', '审批中心', 'expense.approval.act'],
  ['payments', '付款中心', ['expense.payment.read', 'expense.payment.exception.record',
    'expense.payment.exception.review', 'expense.claim.reopen', 'expense.claim.approved_void']],
  ['archives', '归档中心', 'expense.archive.read'],
  ['recovery', '异常恢复', ['expense.approval.recover', 'expense.integration.manage']],
  ['policies', '政策配置', ['expense.config.manage', 'expense.policy.publish']],
  ['analytics', '报销看板', 'expense.claim.read'],
  ['messages','站内消息','expense.claim.read'],
]
const workspace = computed(() => String(route.params.section || 'dashboard'))
const section = computed(() => workspaceSection(workspace.value))
const title = computed(() => sections.find(([key]) => key === workspace.value)?.[1] || '报销工作台')
const navGroups = computed(() => [{ items: [{ key: 'portal', label: '返回门户', icon: 'dashboard' }] },
  { label: '报销管理', items: sections.filter(([, , permission]) => can(permission))
    .map(([key, label]) => ({ key, label, active: workspace.value === key, icon: 'account' })) }])
const editable = computed(() => selected.value
  ? can('expense.claim.update') && selected.value.applicant_subject_id === session.value?.subject_id
    && ['DRAFT', 'RETURNED', 'WITHDRAWN'].includes(selected.value.status)
  : can('expense.claim.create'))
const draftTotal = computed(() => {
  try { return formatMinor(String(draft.value.items.reduce((sum, item) => sum + BigInt(toMinor(item.amount)), 0n))) }
  catch { return '待校验' }
})
const hasModule = computed(() => Boolean(session.value)
  && sections.some(([key, , permission]) => key === workspace.value && can(permission)))
const sessionRolesLabel = computed(() => (session.value?.roles || [])
  .map((role) => reimbursementRoleLabel(typeof role === 'string' ? role : role.code)).filter(Boolean)
  .join('、') || '按服务端能力与范围校验')
const scopeDescription = computed(() => expenseScopeDescription(session.value))

const organizationOptions = computed(() => editorOptions.value?.org_ids
  || [...new Set((editorOptions.value?.employee_profiles || []).map((profile) => profile.org_id))])
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
  gross_minor: '票面总额（分）', amount_minor: '不含税金额（分）', tax_minor: '税额（分）',
  buyer_tax_id: '购买方税号', seller_tax_id: '销售方税号', buyer_name: '购买方', seller_name: '销售方',
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

// 用途：将稳定状态编码展示为准确中文，不把人工复核称为验真。
// 参数：value 为服务器状态编码。
// 返回值：中文状态；未知值保留原文以兼容后续枚举。
function statusLabel(value) {
  return ({ ACTIVE: '有效政策', RETIRED: '已退休', DRAFT: '草稿', RETURNED: '已退回', WITHDRAWN: '已撤回', IN_APPROVAL: '审批中',
    APPROVED_PENDING_PAYMENT: '待付款', PAID: '已付款', VOIDED: '已作废', VOID: '已作废', VERIFIED_CONFLICT: '已核实存在冲突', DISMISSED: '已排除', RESOLVED: '已关联合法账本解除冲突',
    PENDING: '待处理', APPROVED: '已同意', CONFIRMED: '已人工复核', AVAILABLE: '可申报',
    RESERVED: '已占用', CONSUMED: '已消费', DONE: '处理完成', SEALED: '已封存', FAILED: '处理失败',
    NOT_CHECKED: '未查验', UNVERIFIED: '未查验', MANUAL_REVIEWED: '已人工核验', MISMATCH: '内容不一致',
  })[value] || value || '待确认'
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
  return { title: '', claim_type: 'TRAVEL', remark:'', org_id: '', route_type: 'TECHNICAL', finance_entity_id: '',
    payee_profile_id: '', currency: 'CNY', items: [] }
}

// 用途：在现有统一路由中切换工作区。
// 参数：key 为导航区域。
// 返回值：无；触发路由切换。
function navigate(key) {
  router.push(key === 'portal' ? { name: 'portal' } : { name: 'reimbursement', params: { section: key } })
}

// 用途：显示真实错误并保留表单与命令结果未知状态。
// 参数：cause 为API或本地校验错误。
// 返回值：无；更新页面反馈。
function showError(cause) {
  fieldErrors.value = validationFields(cause.details)
  if (fieldErrors.value.length) void focusValidation(fieldErrors.value[0].field)
  error.value = `${cause.message || '操作失败'}${cause.code ? `（${cause.code}）` : ''}${cause.requestID ? ` 请求号：${cause.requestID}` : ''}`
  pending.value = runner.pending()
  if (cause.status === 401) notice.value = '会话已过期；恢复登录前请勿关闭尚有未确认命令的页面。'
}

// 用途：只按当前已授权页面加载业务数据，防止跨页迟到结果覆盖。
// 参数：无。
// 返回值：无；错误显式呈现，不用空列表代替失败。
async function load() {
  const ticket = ++loadSequence
  const current = section.value
  loading.value = true
  selectedClaimIDs.value=[]
  error.value = ''
  try {
    const activeSession = await ensureReimbursementSession()
    if (ticket !== loadSequence || !activeSession) return
    session.value = activeSession
    const entry = sections.find(([key]) => key === workspace.value)
    if (!entry || !can(entry[2])) {
      rows.value = []
      const first = sections.find(([, , permission]) => can(permission))
      if (first) { await router.replace({ name: 'reimbursement', params: { section: first[0] } }); return }
      throw new Error('当前账号没有该区域的访问能力')
    }
    if (current === 'claims' && (can('expense.claim.create') || can('expense.claim.update'))) {
      editorOptions.value = await api.request('/claim-options')
      if (ticket !== loadSequence) return
    }
    if (current === 'dashboard') {
      const result = await api.request('/dashboard')
      if (ticket === loadSequence) dashboard.value = result
      return
    }
    if (current === 'analytics') {
      statistics.value = await api.request(`/statistics?${workspaceQuery(workspace.value,listFilters.value,1,20,'')}`)
      return
    }
    if (workspace.value === 'invoice-upload') { rows.value=[]; total.value=0; return }
    if(current==='archives') {
      archiveProjects.value=await api.request(`/archive-projects?${workspaceQuery('archives',listFilters.value,page.value,pageSize.value,route.query.project_id || '')}`)
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
  } catch (cause) { if (ticket === loadSequence) showError(cause) }
  finally { if (ticket === loadSequence) loading.value = false }
}

// 用途：执行可追踪的写命令，并在成功后读取真实状态。
// 参数：key 为动作、path 为API、payload 为业务字段、method 为HTTP方法。
// 返回值：原始业务结果；失败返回null并保留用户输入。
async function mutate(key, path, payload, method = 'POST') {
  if (saving.value) return null
  saving.value = true
  error.value = ''; notice.value = ''
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


// 用途：读取冲突对象最新状态供核对，保留尚未保存表单及原版本。
// 参数：path 为失败命令固定API路径。
// 返回值：无；刷新失败单独提示，不掩盖原始业务错误。
async function refreshConflict(path) {
  const match = path.match(/^\/(claims|invoices|approval-tasks)\/([^/]+)/)
  if (!match) return
  try {
    conflictSnapshot.value = { kind: match[1], value: await api.request(`/${match[1]}/${match[2]}`) }
    notice.value = '已读取服务器最新状态，当前编辑仍保留。请核对差异后重新打开最新版本再修改。'
  } catch { notice.value = '读取最新状态暂时失败；当前输入保留，请稍后刷新核对。' }
}

// 用途：定位服务器指出的具体费用行，避免用户逐项查找。
// 参数：field 为服务端items[index].field坐标。
// 返回值：无；仅对当前表单内固定费用行执行聚焦。
async function focusValidation(field) {
  const match = /^items\[(\d+)\]/.exec(field || '')
  if (!match) return
  await nextTick()
  const element = document.querySelector(`[data-expense-index="${Number(match[1])}"]`)
  element?.scrollIntoView({ block: 'center', behavior: 'smooth' }); element?.focus()
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
    await applyRecoveredResult(operation, result)
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
    await applyRecoveredResult(operation, result)
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
    if (queuedUpload) await uploadContent(result, queuedUpload.file, queuedUpload.purpose)
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

// 用途：从API加载可选项目与服务项，选择前仍由服务端判断资格。
// 参数：无。
// 返回值：无；更新有资格的项目引用选项。
async function searchProjects() {
  try {
    const result = await api.request(`/project-options?${new URLSearchParams({ keyword: keyword.value, page_size: '50' })}`)
    if (!Array.isArray(result.items)) throw new Error('项目选项响应不完整')
    projectOptions.value = result.items
  } catch (cause) { showError(cause) }
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
    draft.value.claim_type=suggestions[0].default_claim_type || 'TRAVEL'
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
  const option = event.target.value === '' ? null : projectOptions.value[Number(event.target.value)]
  if (option && !canSelectProjectReference(option)) {
    showError(new Error('当前引用不可选择；历史尾款也必须具有当前参与资格及终止事实'))
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
  return index < 0 ? '' : index
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
  const items = value.items.map(editableClaimItem)
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
    if (result) { await openClaim(result.id); await load() }
  } catch (cause) { showError(cause) }
}

// 用途：读取单据详情并建立可编辑副本，不把只读字段回传。
// 参数：id 为服务器单据ID。
// 返回值：无；详情读取失败保持表单。
async function openClaim(id) {
  const ticket = ++detailSequence
  try {
    const result = await api.request(`/claims/${encodeURIComponent(id)}`)
    if (ticket !== detailSequence) return
    selected.value = result
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
    draftBaseline.value = JSON.stringify(draft.value)
    payment.value = null; archives.value = null
    if (section.value === 'payments' && result.active_payment_id && can('expense.payment.read')) {
      payment.value = await api.request(`/payments/${encodeURIComponent(result.active_payment_id)}`)
    }
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
  const result = await mutate('approval.action', `/approval-tasks/${task.id}/actions`,
    { expected_version: task.claim_version, round: task.round, task_version: task.version,
      action, reason: approvalReason.value, target_subject_id: transferSubject.value })
  if (result) { await load(); if (approvalTask.value?.id === task.id) await loadApprovalHistory() }
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
    approvalTask.value = task
    await loadApprovalHistory()
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

// 用途：登记当前批准单据全额付款事实。
// 参数：无。
// 返回值：无；成功展示服务器付款记录，不伪称银行已执行转账。
async function registerPayment() {
  if (!selected.value) return
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
      headers: { Authorization: `DownloadTicket ${permit.ticket}` }, signal: AbortSignal.timeout(30000) })
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
function splitIDs(value) { return [...new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))] }

// 用途：申请独立冲正审批，原付款事实不在页面直接改写。
// 参数：无。
// 返回值：无；展示真实申请ID。
async function requestReversal() {
  const id = payment.value?.id || selected.value?.active_payment_id
  if (!id) { showError(new Error('请选择已有付款记录的单据')); return }
  const result = await mutate('reversal.request', `/payments/${id}/reversal-requests`,
    { expected_version: selected.value.version, reason: reversalReason.value, fact_kind: reversalFact.value,
      evidence_file_ids: splitIDs(evidenceFiles.value), terminate_obligation: false })
  if (result) { reversalID.value = result.id; reversalVersion.value = result.version; notice.value = `冲正申请已受理：${result.id}` }
}

// 用途：批准或拒绝独立冲正申请。
// 参数：approve 为审批结论。
// 返回值：无；成功后刷新单据状态。
async function decideReversal(approve) {
  const result = await mutate('reversal.decide', `/reversal-requests/${encodeURIComponent(reversalID.value)}/decisions`,
    { expected_version: reversalVersion.value, approve, reason: reversalReason.value })
  if (result) await load()
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
    selectedInvoice.value = result; invoiceRows.value = []; originalPreview.value = ''; selectedSource.value = null
    if (originalDownload.value) URL.revokeObjectURL(originalDownload.value)
    originalDownload.value = ''
  }
  catch (cause) { showError(cause) }
}

// 用途：人工确认提取字段，明确区别于外部税务查验。
// 参数：无。
// 返回值：无；成功后读取权威复核状态。
async function confirmInvoice() {
  const invoice = selectedInvoice.value
  let content
  try { content=invoiceContentInput(invoiceContentEditor.value) }
  catch (cause) { showError(cause); return }
  const result = await mutate('invoice.confirm', `/invoices/${invoice.id}/confirm`,
    { expected_version: invoice.version, reason: invoiceReviewReason.value,
      invoice_type: invoice.invoice_type, invoice_number: invoice.invoice_number,
      invoice_code: invoice.invoice_code, invoice_date: invoice.invoice_date,
      seller_tax_id: invoice.seller_tax_id, buyer_tax_id: invoice.buyer_tax_id,
      total_minor: invoice.total_minor, file_ids: invoice.file_ids, content,travel_facts:travelInput(invoice.travel_facts,true) })
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
    const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const sha256 = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
    saving.value = false
    const result = await mutate('document.upload', '/invoice-documents/upload-sessions',
      { purpose, original_name: file.name, media_type: media,
        size_bytes: file.size, sha256, idempotency_key: createRequestID(), expected_version: 0 })
    if (result) return await uploadContent(result, file, purpose)
  } catch (cause) { showError(cause) }
  finally { saving.value = false }
}

// 用途：使用指定上传会话传送原内容并确认网关完成事实。
// 参数：permit 为上传会话，file 为同一原件，purpose 为用途。
// 返回值：带原上传文档ID的完成回执；网络中断后保留文档ID供完成查询。
async function uploadContent(permit, file, purpose) {
  documentID.value = permit.document_id
  const target = new URL(permit.upload_url, window.location.origin)
  if (target.origin !== window.location.origin || !target.pathname.startsWith('/file-gateway/')) {
    throw new Error('上传会话返回非平台文件网关地址，已拒绝传送文件')
  }
  saving.value = true
  try {
    const response = await fetch(target.href, { method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `UploadTicket ${permit.ticket}` },
      body: file, signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error('文件上传未确认成功，请查询文档状态后确认完成')
    saving.value = false
    const completed = await mutate('document.complete', `/invoice-documents/${permit.document_id}/complete`,
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

// 用途：展示网关已确认的文档或凭证结果，不把解析任务当成人工复核。
// 参数：result 为完成回执，purpose 为用途，fileID 为凭证引用，destination 为目标表单。
// 返回值：无；更新后续解析或付款凭证引用。
function applyUploadCompletion(result, purpose, fileID, destination = 'payment') {
  queuedUpload = null
  if (purpose === 'reimbursement.claim.evidence') {
    attachClaimEvidence(destination, fileID || result.file_id)
    notice.value = '费用证据已上传；不会解析为发票，保存及提交时仍需服务端校验。'
  } else if (purpose === 'reimbursement.payment.voucher') {
    const form = destination === 'exceptionFact' ? exceptionForm.value
      : destination === 'exceptionReview' ? exceptionReviewForm.value : paymentForm.value
    const key = destination === 'exceptionReview' ? 'evidence_file_ids' : 'voucher_file_ids'
    form[key] = [...splitIDs(form[key]), fileID || result.file_id].join(',')
    notice.value = '付款凭证已上传并由服务器确认。'
  } else if (purpose === 'reimbursement.invoice.original') {
    parseRun.value = result.parse_run || (result.parse_run_id ? { id: result.parse_run_id } : null)
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
    if (result.document_version) documentStatus.value.version = result.document_version
  }
}

// 用途：查询真实解析任务状态，不自动宣称解析或查验成功。
// 参数：无。
// 返回值：无；更新任务与可用发票引用。
async function refreshParse() {
  try {
    parseRun.value = await api.request(`/parse-runs/${encodeURIComponent(parseRun.value.id)}`)
    documentStatus.value = await api.request(`/invoice-documents/${encodeURIComponent(documentID.value)}`)
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
      headers: { Authorization: `DownloadTicket ${permit.ticket}` }, signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error('受控原件读取失败')
    const blob = await response.blob()
    if (blob.size > 20 * 1024 * 1024) throw new Error('原件超过20MiB预览边界')
    if (originalDownload.value) URL.revokeObjectURL(originalDownload.value)
    originalDownload.value = URL.createObjectURL(blob)
    originalMedia.value = response.headers.get('content-type')?.split(';')[0] || ''
    originalPreview.value = originalMedia.value === 'application/pdf' ? originalDownload.value : ''
    previewZoom.value=1;previewRotation.value=0
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

// 用途：在用户操作下把当前原件查看区全屏，不生成新文件权限。
// 参数：无。
// 返回值：无；浏览器不支持时显示可理解提示。
async function fullscreenOriginal() {
  try {
    const element=document.querySelector('[data-invoice-preview]')
    if(!element?.requestFullscreen)throw new Error('此浏览器不支持全屏，请下载原件查看')
    await element.requestFullscreen()
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
  const result = await mutate('export.create', '/exports',
    { expected_version: selected.value?.version || 0, claim_ids: Array.isArray(claimIDs) ? claimIDs : selected.value ? [selected.value.id] : [],
      ...(route.query.project_id ? { project_id: String(route.query.project_id) } : {}) })
  if (result) exportJob.value = result
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
  try { exportJob.value = await api.request(`/exports/${encodeURIComponent(exportJob.value.id)}`) }
  catch (cause) { showError(cause) }
}

// 用途：创建新的政策草稿版本，避免修改已发布历史版本。
// 参数：无。
// 返回值：无；字段校验或API错误保留编辑内容。
async function savePolicy() {
  try {
    const payload = policyPayload(policyKind.value, policyForm.value)
    if (policyID.value) payload.id = policyID.value
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
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
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
  try {
    policyID.value = ''; policyVersion.value = 0; policyPublished.value = false; policyRecord.value = null
  } catch (cause) { showError(cause) }
}

// 用途：清空当前已确认详情并开始新草稿，未知命令时拒绝切换。
// 参数：无。
// 返回值：无；初始化空白编辑表单。
async function newDraft() {
  if (runner.pending()) { showError(new Error('请先确认原命令结果')); return }
  selected.value = null; draft.value = blankDraft()
  try {
    editorOptions.value = await api.request('/claim-options')
    const orgs = editorOptions.value.org_ids || [...new Set((editorOptions.value.employee_profiles || []).map((profile) => profile.org_id))]
    if (orgs.length === 1) draft.value.org_id = orgs[0]
    if (!draft.value.org_id) { notice.value = '请先选择费用组织，再创建服务器草稿。'; addItem(); return }
    await createDraft()
  } catch (cause) { showError(cause) }
}

// 用途：先创建空服务器草稿，后续费用编辑始终使用真实ID和版本。
// 参数：无。
// 返回值：无；无可选组织时不发出创建请求。
async function createDraft() {
  if (!draft.value.org_id) { showError(new Error('请选择已授权费用组织')); return }
  const profile = editorOptions.value?.employee_profiles?.find(
    (value) => value.org_id === draft.value.org_id)
  if (['TECHNICAL', 'SALES'].includes(profile?.route_type)) {
    draft.value.route_type = profile.route_type
  }
  const result = await mutate('claim.create', '/claims', { expected_version: 0,
    title: draft.value.title || '未命名报销', org_id: draft.value.org_id,
    route_type: draft.value.route_type, currency: 'CNY', items: [] })
  if (result) { await openClaim(result.id); if (!draft.value.items.length) addItem() }
}


// 用途：安全退出应用，失败保留反馈。
// 参数：无。
// 返回值：无；成功返回门户。
async function logout() {
  if (runner.pending()) { showError(new Error('请先确认原命令结果再退出')); return }
  try { await logoutReimbursement() } catch (cause) { showError(cause) } }

watch(draft,invalidateClaimPreview,{deep:true})
watch(() => selected.value?.id,()=>{previewEnabled.value=false;invalidateClaimPreview()})
watch(() => route.params.section, () => { page.value = 1; void load() })
watch(() => route.query.claim_id, (id) => { if (id && section.value === 'claims') void openClaim(String(id)) })
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
  if (!runner.pending()) return
  event.preventDefault(); event.returnValue = ''
}
onBeforeRouteLeave(() => {
  if (!runner.pending()) return true
  showError(new Error('请先查询原命令结果，再离开报销工作区'))
  return false
})
onMounted(() => { addItem(); void load(); window.addEventListener('beforeunload', protectPending) })
onBeforeUnmount(() => {
  ++previewSequence;++documentSequence;++detailSequence;clearTimeout(previewTimer)
  ++loadSequence; window.removeEventListener('beforeunload', protectPending)
  if (originalDownload.value) URL.revokeObjectURL(originalDownload.value)
})
</script>

<template>
  <AppShell
    v-model:menu-open="menuOpen"
    brand-name="报销管理"
    brand-subtitle="费用与票据工作区"
    :nav-groups="navGroups"
    :crumb="title"
    :user-name="session?.display_name || session?.subject_id || ''"
    :user-role="sessionRolesLabel"
    @navigate="navigate"
    @logout="logout"
  >
    <template #topbar-actions>
      <button class="expense-button" :disabled="loading || saving" @click="load">
        刷新
      </button>
    </template>
    <header class="expense-head">
      <div>
        <p class="expense-kicker">
          REIMBURSEMENT
        </p>
        <h1>
          {{ title }}
        </h1>
        <p>
          按当前主体与数据范围读取；金额以人民币元展示。
        </p>
      </div>
      <button
        v-if="can('expense.claim.create')"
        class="expense-button primary"
        @click="navigate('claims'); newDraft()"
      >
        新建报销
      </button>
    </header>
    <div v-if="error" class="expense-alert danger" role="alert">
      {{ error }}
      <button v-if="notice.includes('会话已过期')" @click="startReimbursementLogin()">
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
      <button class="expense-button" :disabled="saving" @click="resolvePending">
        查询原命令结果
      </button>
      <button class="expense-button" :disabled="saving" @click="retryPending">
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
      <div v-if="fieldErrors.length" role="alert"><button v-for="field in fieldErrors" :key="field.field" class="expense-button" @click="focusValidation(field.field)">{{ field.message }}</button></div>
      <p v-if="conflictSnapshot" role="status">服务器最新版本 {{ conflictSnapshot.value.version }} · 状态 {{ statusLabel(conflictSnapshot.value.status) }} · 标题 {{ conflictSnapshot.value.title || conflictSnapshot.value.invoice_number }}</p>
      <RecoveryPanel v-if="section === 'recovery'" :permissions="session?.permissions || []" />
      <ExpenseInbox v-if="section === 'messages'" />
      <ArchiveBorrowPanel v-if="section === 'archives'" :archives="archives" />
      <section v-if="section === 'dashboard'" class="expense-panel">
        <h2>
          我的工作区
        </h2>
        <p>
          <span
            v-for="(label, key) in { my_claims: '我的单据', pending_approvals: '待审批', pending_payments: '待付款', invoice_review_required: '待复核发票', my_paid_this_month:'本月本人已付款' }"
            :key="key"
            class="expense-metric"
          >
            {{ label }}：{{ dashboard?.[key] ?? '不可用' }}
          </span>
        </p>
        <h3>我的待办</h3>
        <ul v-if="dashboard?.pending_tasks?.length">
          <li v-for="task in dashboard.pending_tasks" :key="task.id">
            {{ task.claim_no || task.claim_id }} · {{ approvalNodeLabel(task.node_code) }}
            <button class="expense-button" @click="navigate('approvals')">进入审批中心</button>
          </li>
        </ul>
        <p v-else>当前没有可办理的审批待办。</p>
        <div class="expense-actions">
          <button
            v-for="entry in sections.slice(1).filter((row) => can(row[2]))"
            :key="entry[0]"
            class="expense-button"
            @click="navigate(entry[0])"
          >
            {{ entry[1] }}
          </button>
        </div>
      </section>
      <section v-if="section === 'invoices' && workspace !== 'invoice-abnormal' && can('expense.invoice.upload')" class="expense-panel" @dragover.prevent @drop.prevent="uploadInvoiceBatch">
        <h2>
          上传与人工核验
        </h2>
        <label>
          发票原件
          <input
            type="file"
            accept=".pdf,.ofd,.png,.jpg,.jpeg"
            multiple
            :disabled="saving || batchBusy || !!pending"
            @change="uploadInvoiceBatch"
          >
        </label>
        <p>可拖入1至20张原件，每份不超过20MiB。PDF/OFD可解析候选；图片请人工录入。人工核验不代表税务自动验真。</p>
        <ul v-if="uploadBatch.length" aria-live="polite"><li v-for="(file,index) in uploadBatch" :key="index">
          {{ file.name }} · {{ {WAITING:'等待',UPLOADING:'上传中',READY:'已就绪',UNKNOWN:'结果待确认',FAILED:'失败'}[file.status] }}
          <button v-if="file.document_id" class="expense-button" @click="documentID=file.document_id; readDocument()">读取此原件</button>
        </li></ul>
        <label>
          文档ID
          <input v-model="documentID" placeholder="上传后的文档ID">
        </label>
        <div class="expense-actions">
          <button class="expense-button" :disabled="saving || !documentID" @click="parseDocument">
            发起解析
          </button>
          <button class="expense-button" :disabled="!documentID" @click="readDocument">
            查询原件状态
          </button>
          <button
            class="expense-button"
            :disabled="saving || !!pending || !documentID"
            @click="prepareManualInvoice()"
          >
            人工复核 / 拆分多票
          </button>
          <button v-if="parseRun" class="expense-button" @click="refreshParse">
            查询解析状态
          </button>
        </div>
        <div v-if="parseRun" role="status">
          <p>
            解析任务 {{ parseRun.id }} · {{ statusLabel(parseRun.status) }} · 已尝试 {{ parseRun.attempt ?? 0 }} 次
          </p>
          <p v-if="documentStatus">
            文档状态：{{ documentStatus.status }}
          </p>
          <ul>
            <li v-for="issue in documentStatus?.detail?.parse_issues || []" :key="issue">
              {{ issue }}
            </li>
          </ul>
          <p v-if="parseRun.last_error">
            处理失败原因：{{ parseRun.last_error }}
          </p>
        </div>
        <p>
          解析仅提取字段；人工复核、外部税务查验分别显示。
        </p>
      </section>
      <ParseExceptionsPanel v-if="workspace==='invoice-abnormal' && can('expense.invoice.read')"
        @open="openParseException" />
      <section v-if="workspace==='invoice-abnormal' && parseRun" class="expense-panel" aria-label="当前原件解析任务">
        <h3>当前原件解析任务</h3>
        <p>文档 {{ documentID }} · 任务 {{ parseRun.id }} · {{ statusLabel(parseRun.status) }}
          · 已尝试 {{ parseRun.attempt ?? 0 }} 次</p>
        <p v-if="parseRun.last_error" role="alert">{{ parseRun.last_error }}</p>
        <button class="expense-button" @click="refreshParse">刷新任务与原件</button>
      </section>
      <section v-if="section === 'invoices' && documentStatus" class="expense-panel">
        <h2>
          原件候选与人工拆分
        </h2>
        <p>
          以下结果仅辅助填写。金额缺失、票据分组不确定或字段冲突时，请逐张对照原件；创建后仍须独立人工复核，不能视为已验真。
        </p>
        <p>
          原件 {{ documentStatus.id || documentStatus.document_id }} · 文件 {{ documentStatus.file_id }} · 候选 {{ parsedCandidates.length }} 组
        </p>
        <div class="expense-table">
          <table>
            <thead>
              <tr>
                <th>
                  候选号码
                </th>
                <th>
                  日期
                </th>
                <th>
                  票面总额
                </th>
                <th>
                  分组 / 缺失原因
                </th>
                <th>
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
                  <button
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
        <button
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
              <table>
                <thead>
                  <tr>
                    <th>
                      字段
                    </th>
                    <th>
                      候选值
                    </th>
                    <th>
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
                        {{ value.value || value.raw_value || '缺失' }}
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
          <button
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
          <button v-for="(label,key) in {ALL:'全部线路',TECHNICAL:'技术线',SALES:'销售线'}" :key="key"
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
        <label>
          审批说明
          <textarea v-model="approvalReason" />
        </label>
        <label>
          转交主体
          <input v-model="transferSubject" placeholder="仅用于允许转交的任务">
        </label>
      </section>
      <section v-if="section === 'policies'" class="expense-panel">
        <h2>
          政策版本
        </h2>
        <label>
          配置类型
          <select v-model="policyKind" :disabled="saving || !!pending">
            <option value="standards">
              费用标准
            </option>
            <option value="city_mappings">城市代码与人工映射</option>
            <option value="archive_retention_policies">组织档案保留政策</option>
            <option value="historical_tail_policies">
              历史尾款政策（默认关闭）
            </option>
            <option value="route_rules">
              审批路由
            </option>
            <option value="assignments">
              财务岗位 / 受控替代人
            </option>
            <option value="finance_entities">
              付款主体
            </option>
            <option value="payee_profiles">
              收款档案
            </option>
            <option value="employee_profiles">
              员工费用职级
            </option>
            <option value="invoice_rules">
              票种身份与查验规则
            </option>
            <option value="scopes">
              显式数据范围
            </option>
          </select>
        </label>
        <p>
          选择记录查看实际字段；保存创建草稿，发布前请核对差异。已发布版本不可覆盖。
        </p>
        <article v-if="policyRecord" class="expense-item">
          <h3>
            所选版本 {{ policyRecord.id }} · {{ statusLabel(policyLifecycleStatus) }}
          </h3>
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
        <fieldset
          :disabled="policyPublished || saving || !!pending || !can('expense.config.manage')"
        >
          <div class="expense-grid">
            <label v-for="field in currentPolicyFields.filter(row=>row.type!=='content-mappings')" :key="field.key">
              {{ field.label }}{{ field.required ? ' *' : '' }}
              <input
                v-if="field.type === 'boolean'"
                v-model="policyForm[field.key]"
                type="checkbox"
              >
              <select v-else-if="field.type === 'select'" v-model="policyForm[field.key]">
                <option value="">
                  请选择
                </option>
                <option v-for="option in field.options" :key="option" :value="option">
                  {{ optionLabels[option] || option }}
                </option>
              </select>
              <input
                v-else
                v-model="policyForm[field.key]"
                :type="field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'"
                :inputmode="field.type === 'money' ? 'decimal' : undefined"
              >
            </label>
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
            <table>
              <thead>
                <tr>
                  <th>
                    字段
                  </th>
                  <th>
                    原版本
                  </th>
                  <th>
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
          <button
            v-if="can('expense.config.manage')"
            class="expense-button"
            :disabled="saving || !!pending || policyPublished"
            @click="savePolicy"
          >
            保存政策草稿
          </button>
          <button
            v-if="policyID && can('expense.config.manage')"
            class="expense-button"
            @click="clonePolicy"
          >
            基于此版本新建草稿
          </button>
          <button
            v-if="can('expense.policy.publish')"
            class="expense-button primary"
            :disabled="saving || !policyID || !!pending || policyLifecycleStatus !== 'DRAFT'"
            @click="publishPolicy"
          >
            发布所选版本
          </button>
        </div>
        <fieldset
          v-if="can('expense.policy.publish') && policyLifecycleStatus === 'ACTIVE' && policyID"
          :disabled="saving || !!pending"
          class="expense-item"
        >
          <h3>
            停止使用或替换有效政策
          </h3>
          <p>
            退休不可恢复，只停止新单据使用。若已有替换草稿，请用原子替换，旧版本退休与新版本发布一起生效。
          </p>
          <label>
            退休或替换原因 *
            <textarea v-model="policyLifecycleReason" maxlength="1000" />
          </label>
          <button
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
                {{ replacement.name || replacement.fee_type || replacement.role || replacement.id }} · {{ replacement.id }} · v{{ replacement.version }}
              </option>
            </select>
          </label>
          <p v-if="!replacementCandidates.length">
            当前页没有同类草稿。可翻页查找，或先保存新草稿后再选择旧版本进行替换。
          </p>
          <button
            class="expense-button primary"
            :disabled="!replacementPolicyID || !policyLifecycleReason.trim()"
            @click="replacePolicy"
          >
            原子替换并发布草稿
          </button>
        </fieldset>
      </section>
      <section v-if="['claims','invoices','approvals','payments','archives','analytics'].includes(section) && workspace !== 'invoice-upload'" class="expense-panel">
        <h2>{{ workspace === 'invoice-abnormal' ? '异常票据处理' : '查询与筛选' }}</h2>
        <p v-if="workspace === 'invoice-abnormal'">集中处理未确认、查验不一致及待关闭风险；进入详情查看真实来源和处理记录。</p>
        <div v-if="section === 'claims' && workspace !== 'submitted'" class="expense-tabs" role="group" aria-label="报销状态">
          <button v-for="(label,key) in { '':'全部',DRAFT:'草稿',IN_APPROVAL:'审批中',APPROVED_PENDING_PAYMENT:'待付款',PAID:'已付款',RETURNED:'已退回' }"
            :key="key" class="expense-button" :aria-pressed="listFilters.status===key"
            @click="listFilters.status=key;applyFilters()">{{ label }}</button>
        </div>
        <form class="expense-grid" @submit.prevent="applyFilters">
          <label>单号 / 标题 / 发票号码<input v-model="listFilters.q" maxlength="128"></label>
          <label v-if="section !== 'invoices'">报销类型<select v-model="listFilters.claim_type">
            <option value="">全部类型</option><option v-for="(label,key) in claimTypes" :key="key" :value="key">{{ label }}</option>
          </select></label>
          <label>开始日期<input v-model="listFilters.date_from" type="date"></label>
          <label>结束日期<input v-model="listFilters.date_to" type="date"></label>
          <label v-if="section !== 'invoices'">报销人主体<input v-model="listFilters.applicant_subject_id" maxlength="64" placeholder="仅在当前可见范围筛选"></label>
          <template v-if="section === 'invoices'">
            <label>票种<input v-model="listFilters.invoice_type" maxlength="64"></label>
            <label>核验状态<select v-model="listFilters.verification_status"><option value="">全部</option>
              <option value="NOT_CHECKED">未核验</option><option value="MANUAL_REVIEWED">已人工核验</option>
              <option value="MISMATCH">不一致</option><option value="VERIFIED">正式外部验真通过</option></select></label>
            <label>票面复核<select v-model="listFilters.review_status"><option value="">全部</option>
              <option value="PENDING">待复核</option><option value="CONFIRMED">已确认</option></select></label>
          </template>
          <div class="expense-actions"><button class="expense-button primary" :disabled="loading">查询</button>
            <button type="button" class="expense-button" @click="resetFilters">重置</button></div>
        </form>
        <p>日期按北京时间业务日查询。仅筛选当前账号可见对象，不授予额外数据权限。</p>
      </section>
      <InvoiceClassificationEvidence v-if="['invoices','claims'].includes(section)" :rows="invoiceSuggestions" />
      <section v-if="section === 'analytics' && statistics" class="expense-panel">
        <h2>个人与项目费用看板</h2>
        <p>范围：{{ statistics.date_from }} 至 {{ statistics.date_to }}；按单据创建月归属的当前已付净额，已全额冲正的历史付款不重复计入。</p>
        <p>退回率按当前筛选范围内有真实提交事实的去重单据计算；同单多轮退回只计一次，撤回与作废不计退回，差旅异常单独统计。</p>
        <div class="expense-metrics">
          <span class="expense-metric">单据 {{ statistics.total_count }}</span>
          <span class="expense-metric">超标 {{ statistics.over_standard_count }}</span>
          <span class="expense-metric">差旅异常 {{ statistics.exception_count }}</span>
          <span class="expense-metric">已提交单据 {{ statistics.submitted_count ?? '未提供' }}</span>
          <span class="expense-metric">实际退回单据 {{ statistics.returned_count ?? '未提供' }}</span>
          <span class="expense-metric">实际退回率 {{ returnRateLabel(statistics.return_rate_basis_points) }}</span>
          <span class="expense-metric">超标占比 {{ statistics.total_count ? (statistics.over_standard_count*100/statistics.total_count).toFixed(1) : '0.0' }}%</span>
        </div>
        <article v-for="group in [{key:'monthly',field:'month',title:'月度趋势'},{key:'by_type',field:'claim_type',title:'类型分布'},{key:'by_project',field:'project_id',title:'项目成本'}]" :key="group.key" class="expense-item">
          <h3>{{ group.title }}</h3>
          <p v-if="!statistics[group.key]?.length">当前范围没有数据。</p>
          <div v-for="row in statistics[group.key]" :key="row[group.field]" class="expense-chart-row">
            <span>{{ group.key==='by_type' ? claimTypes[row.claim_type] || '历史未分类' : row[group.field] }}</span>
            <meter min="0" max="100" :value="statisticWidth(row,statistics[group.key])" :aria-label="`${row[group.field]}金额占最大分组比例`" />
            <span>{{ formatMinor(row.amount_minor) }} 元 · {{ row.count }} 单</span>
          </div>
        </article>
      </section>
      <section v-if="section === 'archives' && archiveProjects" class="expense-panel">
        <h2>项目归档包</h2><p>按实际封存日期筛选；同一单据多个档案版本不重复累计金额，金额为当前已付净额。</p>
        <div class="expense-table"><table><thead><tr><th>项目</th><th>报销单数</th><th>当前净额</th><th>最近封存</th><th>操作</th></tr></thead>
          <tbody><tr v-for="project in archiveProjects.items" :key="project.project_id"><td>{{ project.project_id }}</td><td>{{ project.claim_count }}</td>
            <td>{{ formatMinor(project.amount_minor) }}元</td><td>{{ formatBusinessDateTime(project.last_archived_at) }}</td>
            <td><button class="expense-button" @click="openArchiveProject(project.project_id)">查看项目档案</button></td></tr>
            <tr v-if="!archiveProjects.items.length"><td colspan="5">当前范围没有已封存项目档案。</td></tr></tbody></table></div>
      </section>
      <section v-if="section !== 'dashboard' && !['invoice-upload','analytics','recovery','messages'].includes(workspace)" class="expense-panel">
        <div v-if="section === 'invoices' && can('expense.claim.create')" class="expense-actions">
          <span>已选择 {{ selectedInvoiceIDs.length }} 张</span>
          <button class="expense-button primary" :disabled="!selectedInvoiceIDs.length || saving || !!pending" @click="createDraftFromInvoices">从已确认发票生成费用草稿</button>
        </div>
        <div class="expense-table">
          <table>
            <thead>
              <tr>
                <th v-if="section === 'invoices' && can('expense.claim.create')">选择</th>
                <th v-if="['claims','payments','archives'].includes(section) && can('expense.archive.export')">导出选择</th>
                <th>
                  编号 / 标题
                </th>
                <th>
                  状态 / 版本
                </th>
                <th>
                  {{ section === 'invoices' ? '票面金额' : '金额 / 任务' }}
                </th>
                <th>{{ section === 'invoices' ? '类型 / 开票日期' : '类型 / 报销人' }}</th>
                <th>{{ section === 'invoices' ? '销售方税号 / 核验' : '当前节点 / 异常' }}</th>
                <th>创建时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id">
                <td v-if="['claims','payments','archives'].includes(section) && can('expense.archive.export')">
                  <input v-model="selectedClaimIDs" type="checkbox" :value="row.id" :disabled="saving || !!pending" :aria-label="`选择导出 ${row.claim_no || row.id}`"></td>
                <td v-if="section === 'invoices' && can('expense.claim.create')">
                  <input v-model="selectedInvoiceIDs" type="checkbox" :value="row.id"
                    :disabled="row.review_status !== 'CONFIRMED' || !['AVAILABLE',''].includes(row.reservation_state || '')"
                    :aria-label="`选择发票${row.invoice_number || row.id}`">
                </td>
                <td>
                  {{ row.claim_no || row.invoice_number || row.claim_id || row.id }}
                  <small>
                    {{ row.title || row.fee_type || row.node_code || row.name }}
                  </small>
                </td>
                <td>
                  {{ row.lifecycle_status ? statusLabel(row.lifecycle_status) : row.status || row.review_status || (row.published ? '已发布' : '草稿') }}
                  <small>
                    版本 {{ row.version }}
                  </small>
                </td>
                <td>
                  {{ section === 'invoices' ? formatMinor(row.total_minor) : section === 'approvals' ? `第 ${row.round} 轮` : formatMinor(row.payable_minor || row.limit_minor) }}
                </td>
                <td>{{ section === 'invoices' ? `${row.invoice_type || '待确认'} / ${row.invoice_date || '日期待确认'}` : `${claimTypes[row.claim_type] || '历史未分类'} / ${row.applicant_subject_id || row.assignee_subject_id || '按任务可见'}` }}</td>
                <td v-if="section === 'invoices'">{{ row.seller_tax_id || '税号待核对' }} · {{ statusLabel(row.verification_status) }}</td>
                <td v-else>{{ row.current_approval_node || row.node_code || '—' }}
                  <span v-if="section==='approvals' && row.urgency==='OVERDUE'" class="expense-flag danger">待办超48小时</span>
                  <span v-if="row.has_over_standard" class="expense-flag">超标</span>
                  <span v-if="row.has_exception" class="expense-flag danger">异常</span>
                </td>
                <td>{{ formatBusinessDateTime(row.created_at) }}
                  <small v-if="section==='approvals' && row.pending_since">当前待办起点 {{ formatBusinessDateTime(row.pending_since) }}</small></td>
                <td class="expense-actions">
                  <button
                    v-if="section === 'invoices'"
                    class="expense-button"
                    @click="openInvoice(row.id)"
                  >
                    复核详情
                  </button>
                  <template v-else-if="section === 'approvals'">
                    <button class="expense-button" @click="openApproval(row.id)">
                      查看固定快照
                    </button>
                    <button
                      v-for="action in (row.allowed_actions || [])"
                      :key="action"
                      class="expense-button"
                      :disabled="saving || !!pending"
                      @click="approve(row, action)"
                    >
                      {{ { APPROVE: '同意', RETURN: '退回', TRANSFER: '转交',ADDSIGN:'加签' }[action] || action }}
                    </button>
                    <span v-if="!row.allowed_actions?.length">
                      服务端未授予动作
                    </span>
                  </template>
                  <button
                    v-else-if="section === 'policies'"
                    class="expense-button"
                    :disabled="saving || !!pending"
                    @click="selectPolicy(row)"
                  >
                    查看版本
                  </button>
                  <button v-else class="expense-button" @click="openClaim(row.id)">
                    查看详情
                  </button>
                </td>
              </tr>
              <tr v-if="!loading && !error && !rows.length">
                <td :colspan="section === 'invoices' && can('expense.claim.create') ? 8 : 7">
                  当前权限范围内暂无记录
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="expense-actions">
          <button v-if="['claims','payments','archives'].includes(section) && can('expense.archive.export')" class="expense-button"
            :disabled="!selectedClaimIDs.length || saving || !!pending" @click="exportSelectedClaims">导出所选 {{ selectedClaimIDs.length }} 张</button>
          <span>
            共 {{ total }} 条 · 第 {{ page }} 页
          </span>
          <label>每页<select v-model.number="pageSize" @change="applyFilters"><option v-for="size in [10,20,50,100]" :key="size" :value="size">{{ size }}</option></select></label>
          <button class="expense-button" :disabled="page <= 1 || loading" @click="page--; load()">
            上一页
          </button>
          <button
            class="expense-button"
            :disabled="page * pageSize >= total || loading"
            @click="page++; load()"
          >
            下一页
          </button>
        </footer>
      </section>
      <ApprovalRoundsPanel v-if="approvalTask && section === 'approvals'" :claim-id="approvalTask.claim_id" />
      <section v-if="approvalTask && section === 'approvals'" class="expense-panel">
        <h2>
          第 {{ approvalTask.round }} 轮 · {{ approvalNodeLabel(approvalTask.node_role || approvalTask.node_code) }}
        </h2>
        <p>
          固定快照版本 {{ approvalTask.snapshot?.version }} · 状态 {{ statusLabel(approvalTask.status) }}
        </p>
        <p v-if="approvalTask.snapshot?.scope_limited">
          仅展示本任务覆盖项目；完整票据和其他项目分摊不在本任务范围。
        </p>
        <template v-if="!approvalTask.snapshot?.scope_limited && can('expense.invoice.read')">
          <h3>审批关联票据影像</h3>
          <div class="expense-actions" v-for="item in approvalTask.snapshot?.items || []" :key="item.id">
            <button v-for="usage in item.invoice_usages || []" :key="usage.invoice_id" class="expense-button" @click="previewApprovalInvoice(usage.invoice_id)">读取票据 {{ usage.invoice_id }} 原件</button>
          </div>
          <button v-for="source in invoiceRows" :key="source.id || source.file_id" class="expense-button" @click="readInvoiceOriginal(source)">{{ source.filename || source.file_id }} 查看影像</button>
          <div data-invoice-preview class="expense-original-container">
            <iframe v-if="originalPreview" :src="originalPreview" class="expense-original-preview" title="审批受控票据原件" />
            <img v-else-if="['image/png','image/jpeg'].includes(originalMedia) && originalDownload" :src="originalDownload" alt="审批受控发票影像" class="expense-original-image">
          </div>
        </template>
        <div class="expense-table">
          <table>
            <thead>
              <tr>
                <th>
                  费用类型
                </th>
                <th>
                  发生日
                </th>
                <th>
                  范围内金额
                </th>
                <th>
                  项目分摊
                </th>
                <th>
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
                    <button v-for="file in item.no_invoice_evidence_file_ids || []" :key="file" class="expense-button"
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
          <button class="expense-button" :disabled="historyLoading" @click="loadApprovalHistory">
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
                {{ { TRANSFER: '转交', APPROVE: '同意', RETURN: '退回' }[entry.action] || entry.action }}
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
      <section
        v-if="section === 'claims' && (selected || can('expense.claim.create'))"
        class="expense-panel"
      >
        <h2>
          {{ selected ? `单据 ${selected.claim_no || selected.id}` : '新建草稿' }}
        </h2>
        <p v-if="selected">
          状态 {{ statusLabel(selected.status) }} · 版本 {{ selected.version }} · 服务端金额 {{ formatMinor(selected.payable_minor) }} 元
        </p>
        <p v-if="selected?.invoice_date_warnings?.length" class="expense-alert warning">存在发票时效风险：{{ selected.invoice_date_warnings.map(row=>`${row.invoice_id}已开具${row.age_days}天`).join('；') }}。已冻结到当前审批快照。</p>
        <fieldset :disabled="!editable || saving || !!pending">
          <div class="expense-grid">
            <label>
              标题
              <input v-model="draft.title" maxlength="200">
            </label>
            <label>报销类型<select v-model="draft.claim_type">
              <option v-if="!draft.claim_type" value="">历史未分类，请确认后选择</option>
              <option v-for="(label,key) in claimTypes" :key="key" :value="key">{{ label }}</option>
            </select></label>
            <label>备注<textarea v-model="draft.remark" maxlength="2000" /></label>
            <label>
              组织ID
              <select v-model="draft.org_id">
                <option value="">
                  选择组织
                </option>
                <option
                  v-for="org in organizationOptions"
                  :key="org"
                  :value="org"
                >
                  {{ org }}
                </option>
              </select>
            </label>
            <label>
              业务线路
              <select v-model="draft.route_type">
                <option value="TECHNICAL">
                  技术线
                </option>
                <option value="SALES">
                  销售线
                </option>
              </select>
            </label>
            <label>
              付款主体ID
              <select v-model="draft.finance_entity_id">
                <option value="">
                  选择付款主体
                </option>
                <option
                  v-for="entity in editorOptions?.finance_entities || []"
                  :key="entity.id"
                  :value="entity.id"
                >
                  {{ entity.name }}
                </option>
              </select>
            </label>
            <label>
              收款档案ID
              <select v-model="draft.payee_profile_id">
                <option value="">
                  选择已审核收款档案
                </option>
                <option
                  v-for="profile in editorOptions?.payee_profiles || []"
                  :key="profile.id"
                  :value="profile.id"
                >
                  {{ profile.account_ref }} · v{{ profile.version }}
                </option>
              </select>
            </label>
          </div>
          <div class="expense-actions">
            <input v-model="keyword" aria-label="项目关键词" placeholder="搜索有费用资格的项目">
            <button class="expense-button" @click="searchProjects">
              查询项目选项
            </button>
          </div>
          <p v-if="route.query.project_id">
            项目预选提示：{{ route.query.project_id }}。请查询选项并重新选择，地址参数不代表资格。
          </p>
          <ClaimPreviewPanel :value="claimPreview" :busy="previewBusy" :error="previewError"
            :enabled="previewEnabled" :disabled="!selected || !editable || saving || !!pending" @refresh="refreshClaimPreview" />
          <article v-for="(item, index) in draft.items" :key="item.id" class="expense-item" :data-expense-index="index" tabindex="-1">
            <InvoiceClassificationEvidence :rows="item.classification_evidence || []" saved />
            <TravelFields v-model:value="item.travel_declaration" :disabled="!editable" />
            <div class="expense-form-grid">
              <label>费用性质<select v-model="item.expense_nature"><option value="ACTUAL">实际发生费用</option><option value="PREPAYMENT">预付费用（须政策允许及财务复核）</option></select></label>
              <p v-if="item.expense_nature==='PREPAYMENT'">预付需说明用途并上传独立证明；没有有效预付政策时服务端拒绝提交，不产生借款或自动核销。</p>
              <label>城市代码<input v-model="item.city_code" maxlength="6" placeholder="六位结构化城市代码"></label>
              <label>交通分类<input v-model="item.transport_category" :list="`transport-${item.id}`" placeholder="选择已发布标准编码或输入">
                <datalist :id="`transport-${item.id}`"><option v-for="value in standardChoices('transport_category',item.fee_type)" :key="value" :value="value" /></datalist></label>
              <label>住宿分类<input v-model="item.accommodation_category" :list="`accommodation-${item.id}`" placeholder="选择已发布标准编码或输入">
                <datalist :id="`accommodation-${item.id}`"><option v-for="value in standardChoices('accommodation_category',item.fee_type)" :key="value" :value="value" /></datalist></label>
              <label>无票证明类型<select v-model="item.no_invoice_proof_type"><option value="">未选择</option><option value="PAYMENT_PROOF">支付证明</option><option value="SERVICE_CONFIRMATION">服务确认</option><option value="OTHER">其他证明</option></select></label>
              <label>无票／预付独立证明（PDF / PNG / JPEG）<input type="file" accept=".pdf,.png,.jpg,.jpeg"
                @change="uploadInvoice($event,'reimbursement.claim.evidence',`claimNoInvoice:${item.id}`)"></label>
              <label>独立证明文件引用<input v-model="item.no_invoice_evidence_text" placeholder="上传后自动关联；引用仍由服务器校验"></label>
            </div>
            <h3>
              费用 {{ index + 1 }}
            </h3>
            <div class="expense-grid">
              <label>
                费用类型
                <select v-model="item.fee_type">
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
                <input v-model="item.occurred_date" type="date">
              </label>
              <label>
                申请金额（元）
                <input v-model="item.amount" inputmode="decimal">
              </label>
              <label>
                标准单位数
                <input v-model.number="item.units" type="number" min="1">
              </label>
              <label>
                城市等级
                <input v-model="item.city_level" :list="`city-level-${item.id}`">
                <datalist :id="`city-level-${item.id}`"><option v-for="value in standardChoices('city_level',item.fee_type)" :key="value" :value="value" /></datalist>
              </label>
              <label>
                费用职级
                <input
                  :value="editorOptions?.employee_profiles?.find((profile) => profile.org_id === draft.org_id)?.grade || '待配置'"
                  readonly
                >
              </label>
            </div>
            <label>
              个人说明
              <textarea v-model="item.reason" />
            </label>
            <label>
              超标说明
              <input v-model="item.exception_reason">
            </label>
            <label>
              <input v-model="item.travel_exception" type="checkbox">
              差旅异常
            </label>
            <label>
              无票原因（受政策限制）
              <input v-model="item.no_invoice_reason">
            </label>
            <h4>
              项目分摊 · 已分摊 {{ allocationTotal(item) }} 元 / 申请 {{ item.amount || '待填写' }} 元
            </h4>
            <label>分摊方式<select :value="item.allocation_mode || 'AMOUNT'" @change="changeAllocationMode(item,$event.target.value)">
              <option value="AMOUNT">按金额</option><option value="RATIO">按比例</option></select></label>
            <p v-if="item.allocation_mode === 'RATIO'">比例合计100%，最多两位小数；按最大余数分配尾分，同余数按项目/服务项排序。金额仅供核对，保存时服务器重新计算。</p>
            <div v-for="(allocation, ai) in item.allocations" :key="ai" class="expense-actions">
              <select
                aria-label="项目服务项"
                :value="selectedProjectOption(allocation)"
                @change="selectProject(allocation, $event)"
              >
                <option value="">
                  {{ allocation.project_id ? `${allocation.project_id} / ${allocation.service_item_id || '项目'}` : '选择项目 / 服务项' }}
                </option>
                <option
                  v-for="(option, oi) in projectOptions"
                  :key="`${option.project_id}/${option.service_item_id}`"
                  :value="oi"
                  :disabled="!canSelectProjectReference(option)"
                >
                  {{ option.project_name }} / {{ option.service_item_id || '项目级' }}
                  · {{ option.project_status || '状态待确认' }} / {{ option.service_item_status || '项目级' }}
                  {{ option.eligible ? '' : canSelectProjectReference(option) ? '终止状态：仅可申请尾款政策' : '不可选' }}
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
              <button class="expense-button" @click="item.allocations.splice(ai, 1)">
                删除分摊
              </button>
            </div>
            <button
              class="expense-button"
              @click="item.allocations.push({ project_id: '', service_item_id: '', amount: '',ratio:'' })"
            >
              增加项目分摊
            </button>
            <h4>
              票据用量
            </h4>
            <button class="expense-button" @click="loadInvoiceChoices">查询本人已确认发票</button>
            <div v-for="(usage, ui) in item.invoice_usages" :key="ui" class="expense-actions">
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
              <button class="expense-button" @click="checkInvoice(usage.invoice_id)">
                核对票据余额
              </button>
              <span>
                服务器剩余 {{ formatMinor(invoiceFacts[usage.invoice_id]?.remaining_minor) }} 元；本草稿合计 {{ draftInvoiceUsage(usage.invoice_id) }} 元
              </span>
              <button class="expense-button" @click="item.invoice_usages.splice(ui, 1)">
                删除用量
              </button>
            </div>
            <div class="expense-actions">
              <button
                class="expense-button"
                @click="item.invoice_usages.push({ invoice_id: '', amount: '' })"
              >
                增加票据
              </button>
              <button class="expense-button" @click="draft.items.splice(index, 1)">
                删除费用
              </button>
            </div>
          </article>
          <button class="expense-button" @click="addItem">
            添加费用
          </button>
        </fieldset>
        <ClaimEvidenceTravelPanel
          v-for="(item, index) in draft.items"
          :key="item.id"
          :item="item"
          :item-number="index + 1"
          :references="item.allocations.map(referenceFor)"
          :standard-hints="(editorOptions?.standards || []).filter((standard) => standard.org_id === draft.org_id && standard.fee_type === item.fee_type)"
          :tail-policies="(editorOptions?.historical_tail_policies || []).filter((policy) => policy.org_id === draft.org_id && item.allocations.some((part) => part.project_id === policy.project_id))"
          :disabled="!editable || saving || !!pending"
          :can-download="!!selected?.id && !selected?.scope_limited"
          @upload="(event, kind) => uploadClaimEvidence(item.id, event, kind)"
          @download="downloadClaimEvidence"
        />
        <footer class="expense-actions">
          <button
            v-if="!selected"
            class="expense-button primary"
            :disabled="saving || !!pending || !draft.org_id"
            @click="createDraft"
          >
            创建服务器草稿
          </button>
          <button
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
          <button
            class="expense-button primary"
            :disabled="!editable || saving || !!pending"
            @click="saveDraft"
          >
            保存草稿
          </button>
          <button
            v-if="selected?.allowed_actions?.includes('SUBMIT')"
            class="expense-button"
            :disabled="saving || !!pending"
            @click="claimAction('submit')"
          >
            提交已保存版本
          </button>
          <button
            v-if="selected?.allowed_actions?.includes('WITHDRAW')"
            class="expense-button"
            :disabled="saving || !!pending"
            @click="claimAction('withdraw')"
          >
            撤回
          </button>
          <button
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
      <section v-if="selected && ['payments', 'archives'].includes(section)" class="expense-panel">
        <h2>
          {{ selected.claim_no || selected.title }}
        </h2>
        <p>
          状态 {{ statusLabel(selected.status) }} · 版本 {{ selected.version }} · 应付 {{ formatMinor(selected.payable_minor) }} {{ selected.currency }}
        </p>
        <ApprovalRoundsPanel :claim-id="selected.id" />
        <ArchivePackagePanel v-if="section === 'archives' && can('expense.archive.export')" :key="selected.id" :archives="archives" />
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
              <textarea v-model="claimControlReason" maxlength="2000" />
            </label>
            <div class="expense-actions">
              <button
                v-if="selected.allowed_actions?.includes('REOPEN') && can('expense.claim.reopen')"
                class="expense-button"
                :disabled="!claimControlReason.trim()"
                @click="controlledClaimAction('reopen')"
              >
                重开并交回申请人
              </button>
              <button
                v-if="selected.allowed_actions?.includes('APPROVED_VOID') && can('expense.claim.approved_void')"
                class="expense-button"
                :disabled="!claimControlReason.trim()"
                @click="controlledClaimAction('approved-void')"
              >
                作废已批准待付款义务
              </button>
            </div>
          </fieldset>
          <h3>
            全额付款事实登记
          </h3>
          <p>
            请核对银行或现金支付事实后登记。本操作不执行银行转账。
          </p>
          <div class="expense-grid">
            <label>
              实际付款日期
              <input v-model="paymentForm.paid_date" type="date">
            </label>
            <label>
              付款方式
              <select v-model="paymentForm.method">
                <option value="BANK">
                  银行转账
                </option>
                <option value="CASH">
                  现金
                </option>
              </select>
            </label>
            <label>
              付款账户引用
              <input v-model="paymentForm.source_account_ref">
            </label>
            <label>
              流水号
              <input v-model="paymentForm.transaction_no">
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
            <label>
              付款凭证文件ID（逗号分隔）
              <input v-model="paymentForm.voucher_file_ids">
            </label>
          </div>
          <button
            v-if="can('expense.payment.record')"
            class="expense-button primary"
            :disabled="saving || !!pending || selected.status !== 'APPROVED_PENDING_PAYMENT'"
            @click="registerPayment"
          >
            登记全额 {{ formatMinor(selected.payable_minor) }} 元
          </button>
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
          <h3>
            独立冲正申请
          </h3>
          <label>
            事实类型
            <select v-model="reversalFact">
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
            <textarea v-model="reversalReason" />
          </label>
          <label>
            证据文件ID
            <input v-model="evidenceFiles">
          </label>
          <button
            v-if="can('expense.payment.reversal.request')"
            class="expense-button"
            :disabled="saving || !!pending"
            @click="requestReversal"
          >
            申请冲正
          </button>
          <div v-if="can('expense.payment.reversal.approve')" class="expense-actions">
            <button class="expense-button" @click="loadReversals">
              读取冲正待办
            </button>
            <select aria-label="冲正申请" @change="selectReversal">
              <option value="">
                请选择申请及版本
              </option>
              <option v-for="request in reversalRequests" :key="request.id" :value="request.id">
                {{ request.id }} · {{ request.status }} · v{{ request.version }}
              </option>
            </select>
            <button
              class="expense-button"
              :disabled="saving || !reversalID || reversalVersion === null || !!pending"
              @click="decideReversal(true)"
            >
              批准冲正
            </button>
            <button
              class="expense-button"
              :disabled="saving || !reversalID || reversalVersion === null || !!pending"
              @click="decideReversal(false)"
            >
              拒绝冲正
            </button>
          </div>
        </template>
        <template v-else>
          <button class="expense-button" @click="loadArchives">
            读取归档版本和完整性
          </button>
          <button
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
        <button class="expense-button" :disabled="saving || !!pending" @click="createExport">
          创建导出任务
        </button>
        <template v-if="exportJob">
          <button class="expense-button" @click="refreshExport">
            查询导出状态
          </button>
          <button
            v-if="exportJob.status === 'DONE' && exportJob.result?.result?.content !== undefined"
            class="expense-button"
            @click="downloadExport"
          >
            下载导出文件
          </button>
          <p>
            任务 {{ exportJob.id }} · {{ statusLabel(exportJob.status) }} · 已尝试 {{ exportJob.attempt ?? 0 }} 次
          </p>
          <p v-if="exportJob.last_error">
            处理失败：{{ exportJob.last_error }}
          </p>
          <p v-if="exportJob.result?.result">
            结果：{{ exportJob.result.result.filename }} · {{ exportJob.result.result.claim_ids?.length }} 张单据 · 摘要 {{ exportJob.result.result.sha256 }}
          </p>
        </template>
      </section>
      <InvoiceControlsPanel v-if="selectedInvoice && section === 'invoices' && session" :key="selectedInvoice.id" :invoice="selectedInvoice" :session="session" @changed="openInvoice(selectedInvoice.id)" />
      <section v-if="selectedInvoice && section === 'invoices'" class="expense-panel">
        <h2>
          人工复核 · {{ selectedInvoice.id }}
        </h2>
        <aside v-if="selectedInvoice.suspected_duplicates?.length" class="expense-alert warning" role="alert">
          <strong>疑似重复：存在同日、同金额、同销售方的不同票据，请对照原件核验。</strong>
          <p v-for="invoice in selectedInvoice.suspected_duplicates" :key="invoice.invoice_id">{{ invoice.invoice_number }} · {{ invoice.invoice_date }} · {{ formatMinor(invoice.total_minor) }}元</p>
          <p v-if="selectedInvoice.suspected_duplicates_more">当前范围还有匹配票据，请进一步查询台账。</p>
        </aside>
        <InvoiceContentFields v-model:value="invoiceContentEditor" :disabled="!can('expense.invoice.review') || selectedInvoice.owner_subject_id!==session?.subject_id || selectedInvoice.reservation_state!=='AVAILABLE' || saving || !!pending" />
        <p v-if="selectedInvoice.reservation_state!=='AVAILABLE'">已占用或消费的商品服务明细只读，须通过独立更正及申请人重新确认。</p>
        <TravelFields v-model:value="selectedInvoice.travel_facts" invoice :disabled="!can('expense.invoice.review') || selectedInvoice.review_status==='CONFIRMED'" />
        <p v-if="selectedInvoice.review_status==='CONFIRMED'">已确认票面行程只读；重大变化请使用独立更正审批，不重新覆盖原事实。</p>
        <p>
          复核：{{ statusLabel(selectedInvoice.review_status) }} · 外部查验：{{ statusLabel(selectedInvoice.verification_status) }} · 占用：{{ statusLabel(selectedInvoice.reservation_state) }}
        </p>
        <div class="expense-grid">
          <aside>
            <h3>
              来源原件
            </h3>
            <button class="expense-button" @click="invoiceSources">
              获取受控原件
            </button>
            <p v-if="!invoiceRows.length">
              OFD请下载原件对照；缺字段请人工补录，不能视为已验真。
            </p>
            <button
              v-for="source in invoiceRows"
              :key="source.id || source.file_id"
              class="expense-button"
              @click="readInvoiceOriginal(source)"
            >
              {{ source.filename || source.file_id }} 下载
            </button>
            <div v-if="selectedSource">
              <p>
                来源：{{ selectedSource.original_name || selectedSource.file_id }} · {{ selectedSource.parse_status || '解析状态待查询' }}
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
                  <table>
                    <thead>
                      <tr>
                        <th>
                          页码 / XML路径
                        </th>
                        <th>
                          坐标
                        </th>
                        <th>
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
            <div data-invoice-preview class="expense-original-container">
            <iframe
              v-if="originalPreview"
              :src="originalPreview"
              class="expense-original-preview"
              title="发票原件对照"
            />
            <img v-else-if="['image/png','image/jpeg'].includes(originalMedia) && originalDownload" :src="originalDownload" alt="受控发票原件"
              class="expense-original-image" :style="{transform:`rotate(${previewRotation}deg) scale(${previewZoom})`}">
            </div>
            <div v-if="originalDownload" class="expense-actions">
              <button class="expense-button" @click="fullscreenOriginal">全屏查看</button>
              <template v-if="['image/png','image/jpeg'].includes(originalMedia)">
                <button class="expense-button" @click="previewRotation=(previewRotation+90)%360">旋转</button>
                <button class="expense-button" :disabled="previewZoom>=3" @click="previewZoom+=0.25">放大</button>
                <button class="expense-button" :disabled="previewZoom<=0.5" @click="previewZoom-=0.25">缩小</button>
              </template>
            </div>
            <a
              v-if="originalDownload"
              :href="originalDownload"
              :download="`invoice-original.${({'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg'})[originalMedia] || 'ofd'}`"
              class="expense-button"
            >
              下载当前原件
            </a>
          </aside>
          <fieldset :disabled="saving || !!pending || !can('expense.invoice.review')">
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
              票面总额（整数分）
              <input v-model="selectedInvoice.total_minor" inputmode="numeric">
            </label>
            <label>
              人工复核或校正原因
              <textarea v-model="invoiceReviewReason" />
            </label>
            <button class="expense-button primary" @click="confirmInvoice">
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
          <label>
            已上传证据原件ID（逗号分隔）
            <input v-model="verificationEvidence">
          </label>
          <button class="expense-button" @click="verifyInvoice">
            保存人工核验记录
          </button>
        </fieldset>
      </section>
    </template>
  </AppShell>
</template>
