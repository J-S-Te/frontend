<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  commandApproval,
  ContractAuthError,
  createApprovalRule,
  createContract,
  deleteApprovalRule,
  getApproval,
  getContractSession,
  getOpportunityIntake,
  listApprovals,
  listApprovalRules,
  listApprovalTasks,
  listContractTemplates,
  listContracts,
  listOpportunityIntakes,
  previewContractTemplate,
  previewContractDocument,
  submitContract,
  reviewOpportunityIntake,
  updateApprovalRule,
  uploadContractTemplate,
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
import '@/modules/contract_management/styles/contract-management.css'

const route = useRoute()
const router = useRouter()
const session = ref(null)
const sessionError = ref('')

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

const navGroupDefinitions = [
  {
    label: '业务中心',
    items: [
      { key: 'dashboard', label: '工作台', icon: 'dashboard' },
      { key: 'intakes', label: '签单关联核对', icon: 'audit' },
      { key: 'customers', label: '客户查询', icon: 'user' },
      { key: 'contracts', label: '合同台账', icon: 'account' },
      { key: 'templates', label: '合同模板', icon: 'save' },
    ],
  },
  {
    label: '流程协同',
    items: [
      { key: 'approvals', label: '审批中心', icon: 'audit' },
      { key: 'rules', label: '审批规则', icon: 'organization' },
      { key: 'signing', label: '签署台账', icon: 'shield' },
    ],
  },
  { label: '数据分析', items: [{ key: 'reports', label: '统计报表', icon: 'dashboard' }] },
]

const contracts = ref([])
const approvals = ref([])
const initiatedApprovals = ref([])
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
const businessDataError = ref('')
const businessDataLoading = ref(false)
const approvalComment = ref('')
const approvalDetail = ref(null)
const approvalDetailLoading = ref(false)
const approvalCommandBusy = ref(false)
const approvalTargetUser = ref('')
const approvalTargetNode = ref('')
const termsIdentical = ref(false)
const submittingContract = ref(false)
const ruleDialogOpen = ref(false)
const templateUploadDialogOpen = ref(false)
const templateUploading = ref(false)
const templateUploadForm = ref({ name: '', file: null })
const templatePreviewHTML = ref('')
const templatePreviewing = ref(false)
const templatePreviewError = ref('')
const templatePreviewRef = ref(null)
const ruleSaving = ref(false)
const editingRuleId = ref('')
const newContract = ref({
  contract_number: '',
  title: '',
  contract_type: '',
  service_type: '',
  amount: '',
  currency: 'CNY',
  content: '',
  end_date: '',
  template_id: '',
  template_values: {},
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
    nodes: [{ id: 'sales-director', name: '销售总监审批', role_code: 'sales_director', countersign: 'any' }],
    version: 0,
  }
}
const ruleForm = ref(emptyRuleForm())

const navGroups = computed(() => navGroupDefinitions
  .map((group) => ({ ...group, items: group.items.filter((item) => canAccessContractSection(session.value, item.key)) }))
  .filter((group) => group.items.length))

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
const can = (permission) => hasContractPermission(session.value, permission)
const isAdmin = computed(() => {
  const roleCodes = Array.isArray(session.value?.roles) ? session.value.roles : []
  return roleCodes.includes('admin') || session.value?.role?.code === 'admin'
})
const selectedContractTemplate = computed(() => contractTemplates.value.find((item) => item.id === newContract.value.template_id) || null)

const keyword = ref('')
const statusFilter = ref('')
const typeFilter = ref('')
const mobileMenuOpen = ref(false)
const selectedContract = ref(null)
const selectedContractPreviewHTML = ref('')
const selectedContractPreviewLoading = ref(false)
const selectedContractPreviewError = ref('')
const selectedApproval = ref(null)
const createDialogOpen = ref(false)
const notificationOpen = ref(false)
const toast = ref('')
let toastTimer = 0

const activeSection = computed(() => {
  const section = typeof route.params.section === 'string' ? route.params.section : 'dashboard'
  return sectionMeta[section] ? section : 'dashboard'
})
const pageMeta = computed(() => sectionMeta[activeSection.value])

const filteredContracts = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return contracts.value.filter((contract) => {
    const hitKeyword = !query || [contract.id, contract.name, contract.type, contract.serviceType, contract.owner].join(' ').toLowerCase().includes(query)
    return hitKeyword && (!statusFilter.value || contract.status === statusFilter.value) && (!typeFilter.value || contract.type === typeFilter.value)
  })
})

const totalContractAmount = computed(() => contracts.value.reduce((total, item) => total + item.amount, 0))
const activeContractCount = computed(() => contracts.value.filter((item) => ['已批准', '已生效', '履约中', '待付款'].includes(item.status)).length)
const averageContractAmount = computed(() => contracts.value.length ? totalContractAmount.value / contracts.value.length : 0)

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

function resetFilters() {
  keyword.value = ''
  statusFilter.value = ''
  typeFilter.value = ''
}

function showToast(message) {
  toast.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = '' }, 2600)
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
    id: item.contract_number || item.id,
    name: item.title || '未命名合同',
    type: item.contract_type || '—',
    serviceType: item.service_type || '—',
    amount: Number(item.amount_minor || 0) / 100,
    currency: item.currency || 'CNY',
    owner: displayNameFor(item.owner_user_id, item.owner_display_name),
    createdAt: formatDate(item.created_at),
    updatedAt: formatDate(item.updated_at),
    endDate: formatDate(item.end_date),
    status: statusLabels[item.status] || item.status || '—',
    version: item.version,
    content: item.content || '',
    templateId: item.template_id || '',
  }
}

async function openContract(contract) {
  selectedContract.value = contract
  selectedContractPreviewHTML.value = ''
  selectedContractPreviewError.value = ''
  if (!contract.templateId) return
  selectedContractPreviewLoading.value = true
  try {
    const result = await previewContractDocument(contract.recordId)
    selectedContractPreviewHTML.value = result?.html || ''
  } catch (error) {
    selectedContractPreviewError.value = error?.message || '读取格式化合同失败'
  } finally {
    selectedContractPreviewLoading.value = false
  }
}

function closeContract() {
  selectedContract.value = null
  selectedContractPreviewHTML.value = ''
  selectedContractPreviewError.value = ''
}

function normalizeApproval(item) {
  return {
    id: item.approval_id,
    contractId: item.contract_id,
    step: item.node_name || item.node_id || (Number.isInteger(item.current_node_index) ? `第 ${item.current_node_index + 1} 节点` : '—'),
    type: item.kind || '—',
    status: item.status || '—',
    submittedAt: formatDate(item.created_at),
  }
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
  const parts = (rule.expression?.conditions || []).map(conditionLabel)
  return parts.length ? parts.join(rule.expression?.logical === 'or' ? ' 或 ' : ' 且 ') : '未配置条件'
}

async function loadBusinessData() {
  businessDataLoading.value = true
  businessDataError.value = ''
  const requests = []
  if (can('approval.view') || can('approval.process') || can('contract.create')) {
    requests.push(listApprovals({ limit: 200 }).then((items) => { initiatedApprovals.value = items.map(normalizeApproval) }))
  }
  if (can('contract.read')) {
    requests.push(listContracts({ limit: 200 }).then((items) => { contracts.value = items.map(normalizeContract) }))
  }
  if (can('approval.process')) {
    requests.push(listApprovalTasks({ limit: 200 }).then((items) => { approvals.value = items.map(normalizeApproval) }))
  }
  if (can('approval.view') || can('approval_rule.manage')) {
    requests.push(listApprovalRules().then((items) => { rules.value = items }))
  }
  if (can('contract.create') || isAdmin.value) {
    requests.push(listContractTemplates().then((items) => { contractTemplates.value = items }))
  }
  if (can('opportunity_intake.read')) {
    requests.push(loadOpportunityIntakes())
  }
  const results = await Promise.allSettled(requests)
  const failures = results.filter((result) => result.status === 'rejected')
  // API 客户端已在第一次 401 时发起单次 OIDC 跳转。页面不再把多个并发 401
  // 拼成重复的“登录状态无效”提示，避免跳转前出现误导性错误横幅。
  if (failures.some((result) => result.reason instanceof ContractAuthError || result.reason?.status === 401)) {
    businessDataLoading.value = false
    return
  }
  if (failures.length) {
    businessDataError.value = failures.map((result) => result.reason?.message || '业务数据加载失败').join('；')
  }
  businessDataLoading.value = false
}

async function loadOpportunityIntakes({ append = false } = {}) {
  if (append && (!opportunityIntakeHasMore.value || !opportunityIntakeNextCursor.value)) return
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
    if (sequence === opportunityIntakeLoadSequence) opportunityIntakeError.value = error?.message || '读取签单关联核对队列失败'
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
    if (sequence === opportunityIntakeDetailSequence) showToast(error?.message || '读取签单关联详情失败')
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
    showToast(error?.message || '无法生成安全的幂等键')
    return
  }
  opportunityIntakeReviewBusy.value = true
  opportunityIntakeConflictNotice.value = ''
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
        opportunityIntakeConflictNotice.value = refreshError?.message || '数据已变化，但刷新最新状态失败。请关闭后重新打开。'
      }
    } else if (!error?.status || error.status >= 500) {
      showToast(`${error?.message || '核对提交失败'}；可直接重试，页面将复用同一幂等键。`)
    } else {
      showToast(error?.message || '核对提交被拒绝，请核对权限和输入。')
    }
  } finally {
    opportunityIntakeReviewBusy.value = false
  }
}

function selectTemplateFile(event) {
  templateUploadForm.value.file = event.target.files?.[0] || null
}

function openTemplateUpload() {
  if (!isAdmin.value) {
    showToast('只有超级管理员可以上传合同模板。')
    return
  }
  templateUploadForm.value = { name: '', file: null }
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
  templateUploading.value = true
  try {
    await uploadContractTemplate({
      name: templateUploadForm.value.name.trim(),
      file: templateUploadForm.value.file,
    })
    contractTemplates.value = await listContractTemplates()
    templateUploadDialogOpen.value = false
    showToast('合同模板上传成功')
  } catch (error) {
    showToast(error?.message || '上传合同模板失败')
  } finally {
    templateUploading.value = false
  }
}

function openNewContract() {
  templatePreviewHTML.value = ''
  templatePreviewError.value = ''
  createDialogOpen.value = true
}

function selectContractTemplate() {
  const values = {}
  for (const field of selectedContractTemplate.value?.fields || []) {
    values[field.name] = field.default || ''
  }
  newContract.value.template_values = values
  templatePreviewHTML.value = ''
  templatePreviewError.value = ''
}

async function previewNewContract() {
  if (!selectedContractTemplate.value) {
    templatePreviewError.value = '请先选择合同模板。'
    return
  }
  const missingField = (selectedContractTemplate.value.fields || []).find((field) => !String(newContract.value.template_values[field.name] ?? '').trim() && !field.default)
  if (missingField) {
    templatePreviewError.value = `请先填写“${missingField.label}”。`
    return
  }
  templatePreviewError.value = ''
  templatePreviewHTML.value = ''
  templatePreviewing.value = true
  try {
    const result = await previewContractTemplate(selectedContractTemplate.value.id, newContract.value.template_values)
    templatePreviewHTML.value = result?.html || ''
    if (!templatePreviewHTML.value) {
      templatePreviewError.value = '模板没有可预览的正文内容。'
      return
    }
    await nextTick()
    templatePreviewRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (error) {
    templatePreviewError.value = error?.message || '生成合同预览失败'
    showToast(templatePreviewError.value)
  } finally {
    templatePreviewing.value = false
  }
}

async function submitNewContract() {
  try {
    const payload = {
      contract_number: newContract.value.contract_number.trim(),
      title: newContract.value.title.trim(),
      contract_type: newContract.value.contract_type,
      service_type: newContract.value.service_type.trim(),
      amount_minor: Math.round(Number(newContract.value.amount) * 100),
      currency: newContract.value.currency,
      ...(newContract.value.end_date ? { end_date: new Date(`${newContract.value.end_date}T00:00:00Z`).toISOString() } : {}),
    }
    if (selectedContractTemplate.value) {
      payload.content = ''
      payload.template_id = selectedContractTemplate.value.id
      payload.template_values = { ...newContract.value.template_values }
    } else {
      payload.content = newContract.value.content.trim()
    }
    await createContract(payload)
    createDialogOpen.value = false
    newContract.value = { contract_number: '', title: '', contract_type: '', service_type: '', amount: '', currency: 'CNY', content: '', end_date: '', template_id: '', template_values: {} }
    templatePreviewHTML.value = ''
    await loadBusinessData()
    showToast('合同草稿已创建')
  } catch (error) {
    showToast(error?.message || '创建合同失败')
  }
}

async function openApproval(approval) {
  selectedApproval.value = approval
  approvalDetail.value = null
  approvalComment.value = ''
  approvalTargetUser.value = ''
  approvalTargetNode.value = ''
  approvalDetailLoading.value = true
  try {
    approvalDetail.value = await getApproval(approval.id)
  } catch (error) {
    showToast(error?.message || '读取审批详情失败')
  } finally {
    approvalDetailLoading.value = false
  }
}

async function executeApprovalCommand(action, payload = {}, { close = false } = {}) {
  const isApplicant = approvalDetail.value?.meta?.applicant_user_id === session.value?.user_id
  const allowed = ['approve', 'reject', 'sign', 'transfer', 'return'].includes(action)
    ? can('approval.process')
    : action === 'comments'
      ? can('approval.view') || can('approval.process') || isApplicant
      : action === 'urge'
        ? can('approval.manage') || isApplicant
        : action === 'withdraw' && isApplicant
  if (!allowed) {
    showToast('当前用户无权执行此审批操作。')
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
    await commandApproval(target.id, action, { comment: approvalComment.value.trim(), ...payload })
    if (close) selectedApproval.value = null
    else approvalDetail.value = await getApproval(target.id)
    await loadBusinessData()
    const labels = { approve: '审批已通过', reject: '审批已驳回', comments: '评论已提交', urge: '催办已发送', sign: '加签请求已提交', transfer: '转交请求已提交', return: '退回请求已提交', withdraw: '审批已撤回' }
    showToast(labels[action] || '操作已提交')
    approvalComment.value = ''
  } catch (error) {
    showToast(error?.message || '处理审批失败')
  } finally {
    approvalCommandBusy.value = false
  }
}

function processApproval(action) {
  return executeApprovalCommand(action, {}, { close: true })
}

async function submitSelectedContract() {
  if (!selectedContract.value || selectedContract.value.status !== '草稿') return
  submittingContract.value = true
  try {
    await submitContract(selectedContract.value.recordId, { terms_identical: termsIdentical.value })
    selectedContract.value = null
    termsIdentical.value = false
    await loadBusinessData()
    showToast('合同已提交审批')
  } catch (error) {
    showToast(error?.message || '提交审批失败')
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
  editingRuleId.value = rule.id
  ruleForm.value = {
    name: rule.name,
    priority: rule.priority,
    enabled: rule.enabled,
    logical: rule.expression?.logical || 'and',
    conditions: (rule.expression?.conditions || []).map((condition) => ({
      ...condition,
      value: condition.field === 'amount_minor' ? Number(condition.value) / 100 : Array.isArray(condition.value) ? condition.value.join(',') : condition.value,
    })),
    nodes: (rule.nodes || []).map((node) => ({ ...node, countersign: 'any' })),
    version: rule.version,
  }
  if (!ruleForm.value.conditions.length) ruleForm.value.conditions.push({ field: 'amount_minor', operator: 'lte', value: '' })
  ruleDialogOpen.value = true
}

function addRuleCondition() {
  ruleForm.value.conditions.push({ field: 'amount_minor', operator: 'lte', value: '' })
}

function addRuleNode() {
  const index = ruleForm.value.nodes.length + 1
  ruleForm.value.nodes.push({ id: `node-${index}`, name: '', role_code: '', countersign: 'any' })
}

function normalizeRuleCondition(condition) {
  const kind = conditionField(condition.field).kind
  let value = condition.value
  if (kind === 'number') value = Math.round(Number(value) * 100)
  if (kind === 'boolean') value = value === true || value === 'true'
  if (condition.operator === 'in') value = String(value).split(',').map((item) => item.trim()).filter(Boolean)
  return { field: condition.field, operator: condition.operator, value }
}

function rulePayload(form) {
  return {
    name: form.name.trim(),
    priority: Number(form.priority),
    enabled: Boolean(form.enabled),
    expression: { logical: form.logical, conditions: form.conditions.map(normalizeRuleCondition) },
    nodes: form.nodes.map((node) => ({
      id: node.id.trim(), name: node.name.trim(), role_code: node.role_code.trim(),
      countersign: 'any', assignee_ids: [],
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
    showToast(error?.message || '保存审批规则失败')
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
    showToast(error?.message || '更新审批规则失败')
  }
}

async function removeRule(rule) {
  if (!window.confirm(`确定删除审批规则“${rule.name}”吗？`)) return
  try {
    await deleteApprovalRule(rule.id, rule.version)
    await loadBusinessData()
    showToast('审批规则已删除')
  } catch (error) {
    showToast(error?.message || '删除审批规则失败')
  }
}

function statusTone(status) {
  if (['已生效', '已完成', '已签署', '已归档', '成交'].includes(status)) return 'success'
  if (['审批中', '执行中', '履约中', '在跟'].includes(status)) return 'info'
  if (['待签署', '待付款', '待对方签署', '待我方盖章'].includes(status)) return 'warning'
  return 'neutral'
}

function formatAmount(amount) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(amount)
}

watch(activeSection, () => {
  resetFilters()
  notificationOpen.value = false
  document.title = `${pageMeta.value.title} · 机构合同管理系统`
}, { immediate: true })

onMounted(async () => {
  try {
    session.value = await getContractSession()
    await loadBusinessData()
  } catch (error) {
    if (error instanceof ContractAuthError || error?.status === 401) return
    sessionError.value = error?.message || '读取合同系统登录状态失败。'
  }
})

onBeforeUnmount(() => window.clearTimeout(toastTimer))
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
          <button type="button" @click="navigatePlatform('portal')"><ConsoleIcon name="logout" /><span>返回统一门户</span><em>平台</em></button>
        </section>
      </nav>
      <div class="contract-sidebar-user"><span class="contract-avatar">{{ currentUserInitial }}</span><span><strong>{{ currentUserLabel }}</strong><small>{{ currentRoleLabel }}</small></span><button type="button" aria-label="返回门户" @click="navigatePlatform('portal')"><ConsoleIcon name="logout" /></button></div>
    </aside>

    <main class="contract-main">
      <header class="contract-topbar">
        <button class="contract-menu-button" type="button" aria-label="打开菜单" @click="mobileMenuOpen = true"><ConsoleIcon name="menu" /></button>
        <div class="contract-breadcrumb"><span>合同管理系统</span><ConsoleIcon name="chevron" /><strong>{{ pageMeta.title }}</strong></div>
        <label class="contract-global-search"><ConsoleIcon name="search" /><input v-model="keyword" type="search" placeholder="搜索合同编号 / 名称 / 类型…" /></label>
        <div class="contract-topbar-actions">
          <button class="contract-icon-button" type="button" aria-label="通知" @click="notificationOpen = !notificationOpen"><ConsoleIcon name="bell" /><i></i></button>
          <span class="contract-topbar-avatar">{{ currentUserInitial }}</span>
        </div>
        <div v-if="notificationOpen" class="contract-notification-panel">
          <header><strong>通知中心</strong><span>{{ approvals.length }} 项待办</span></header>
          <button v-if="can('approval.process')" type="button" @click="navigate('approvals')"><i class="warning"></i><span><strong>您有 {{ approvals.length }} 项合同审批待处理</strong><small>请按审批时限及时处理</small></span></button>
        </div>
      </header>

      <section class="contract-content">
        <p v-if="sessionError" class="contract-session-error" role="alert">{{ sessionError }}</p>
        <p v-if="businessDataError" class="contract-session-error" role="alert">{{ businessDataError }}</p>
        <p v-if="businessDataLoading" class="contract-session-error">正在读取合同系统真实数据…</p>
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
          <section class="contract-welcome"><div><span>统一身份认证已生效</span><h2>您好，{{ currentUserLabel }}</h2><p>当前角色：<b>{{ currentRoleLabel }}</b>。页面菜单与操作按钮已按服务端会话权限生成。</p></div><button v-if="can('approval.process')" type="button" @click="navigate('approvals')">查看我的待办 <ConsoleIcon name="chevron" /></button></section>
          <section class="contract-stat-grid">
            <article class="blue"><span class="contract-stat-icon"><ConsoleIcon name="account" /></span><p>本人合同总额</p><strong>{{ formatAmount(totalContractAmount) }}</strong><em>来自合同 API</em></article>
            <article class="purple"><span class="contract-stat-icon"><ConsoleIcon name="save" /></span><p>本人合同</p><strong>{{ contracts.length }}<small>份</small></strong><em>当前可见范围</em></article>
            <article v-if="can('approval.process')" class="orange"><span class="contract-stat-icon"><ConsoleIcon name="audit" /></span><p>待我审批</p><strong>{{ approvals.length }}<small>项</small></strong><em>当前活动任务</em></article>
            <article class="green"><span class="contract-stat-icon"><ConsoleIcon name="shield" /></span><p>生效及履约</p><strong>{{ activeContractCount }}<small>份</small></strong><em>按真实状态统计</em></article>
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
          <div class="contract-card contract-empty-state"><ConsoleIcon name="user" /><h3>暂无客户数据</h3><p>合同后端尚未提供客户查询接口。</p></div>
        </template>

        <template v-else-if="activeSection === 'contracts'">
          <div class="contract-filter-bar"><label class="contract-search-field"><ConsoleIcon name="search" /><input v-model="keyword" type="search" placeholder="合同编号 / 名称 / 类型" /></label><button class="contract-button ghost small" type="button" @click="resetFilters"><ConsoleIcon name="reset" />重置</button><button class="contract-button primary small" type="button" @click="loadBusinessData"><ConsoleIcon name="reset" />刷新真实数据</button></div>
          <div class="contract-table-card"><div class="contract-table-scroll"><table class="contract-data-table contract-ledger-table"><thead><tr><th>合同编号 / 名称</th><th>合同类型</th><th>服务类型</th><th>合同金额</th><th>负责人姓名</th><th>创建日期</th><th>到期日期</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="contract in filteredContracts" :key="contract.recordId"><td><button class="contract-entity-link" type="button" @click="openContract(contract)"><strong>{{ contract.name }}</strong><small>{{ contract.id }}</small></button></td><td>{{ contract.type }}</td><td>{{ contract.serviceType }}</td><td class="amount">{{ formatAmount(contract.amount) }}</td><td>{{ contract.owner }}</td><td>{{ contract.createdAt }}</td><td>{{ contract.endDate }}</td><td><span class="contract-badge" :class="statusTone(contract.status)"><i></i>{{ contract.status }}</span></td><td><button class="contract-text-button" type="button" @click="openContract(contract)">详情</button></td></tr><tr v-if="!filteredContracts.length"><td colspan="9" class="contract-empty">合同 API 当前未返回可见合同</td></tr></tbody></table></div><footer class="contract-table-footer"><span>共 {{ filteredContracts.length }} 条真实合同记录</span></footer></div>
        </template>

        <template v-else-if="activeSection === 'templates'">
          <section v-if="contractTemplates.length" class="contract-template-grid">
            <article v-for="(item, index) in contractTemplates" :key="item.id">
              <div class="contract-template-cover" :class="['', 'purple', 'green', 'orange'][index % 4]"><span><ConsoleIcon name="save" /></span><i>DOCX</i></div>
              <div class="contract-template-copy"><span class="contract-badge success"><i></i>可用</span><h3>{{ item.name }}</h3><p>{{ item.original_filename }}</p><div><span>{{ item.fields?.length || 0 }} 个填写字段</span><span>{{ formatDate(item.created_at) }}</span></div></div>
            </article>
          </section>
          <div v-else class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>暂无合同模板</h3><p>{{ isAdmin ? '点击右上角“上传模板”添加第一个 DOCX 模板。' : '超级管理员尚未上传合同模板。' }}</p></div>
        </template>

        <template v-else-if="activeSection === 'approvals'">
          <div class="contract-tabs"><button class="active" type="button">活动待办 <i>{{ approvals.length }}</i></button><button type="button">我发起的 {{ initiatedApprovals.length }}</button><button type="button" @click="loadBusinessData">刷新</button></div>
          <section class="contract-approval-list"><article v-for="approval in approvals" :key="approval.id"><header><span class="contract-badge warning"><i></i>{{ approval.status }}</span><small>{{ approval.id }}</small></header><div><span class="contract-approval-icon"><ConsoleIcon name="audit" /></span><section><div><span class="contract-badge neutral">{{ approval.type }}</span><h3>合同 {{ approval.contractId }}</h3></div><p>任务创建于 {{ approval.submittedAt }}</p></section></div><footer><span><i></i>当前节点：{{ approval.step }}</span><button v-if="can('approval.process')" class="contract-button primary small" type="button" @click="openApproval(approval)">查看并处理</button></footer></article><div v-if="!approvals.length" class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>当前没有活动待办</h3><p>提交合同审批并完成当前审批人配置后，待办会显示在这里。</p></div></section>
          <h2 class="contract-subsection-title">我发起的审批</h2>
          <section class="contract-approval-list"><article v-for="approval in initiatedApprovals" :key="approval.id"><header><span class="contract-badge" :class="approval.status === 'running' ? 'info' : approval.status === 'approved' ? 'success' : approval.status === 'rejected' ? 'danger' : 'neutral'"><i></i>{{ approval.status }}</span><small>{{ approval.id }}</small></header><div><span class="contract-approval-icon"><ConsoleIcon name="audit" /></span><section><div><span class="contract-badge neutral">{{ approval.type }}</span><h3>合同 {{ approval.contractId }}</h3></div><p>发起于 {{ approval.submittedAt }}</p></section></div><footer><span><i></i>流程位置：{{ approval.step }}</span><button class="contract-button secondary small" type="button" @click="openApproval(approval)">查看进度</button></footer></article><div v-if="!initiatedApprovals.length" class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>尚未发起审批</h3><p>在合同台账打开草稿并点击“提交审批”。</p></div></section>
        </template>

        <template v-else-if="activeSection === 'rules'">
          <div class="contract-info-banner"><ConsoleIcon name="info" /><span>审批流程按合同类型、金额与组织范围自动匹配。规则变更仅对新发起的流程生效。</span></div>
          <section class="contract-rule-list"><article v-for="rule in rules" :key="rule.id"><header><span class="contract-rule-icon"><ConsoleIcon name="organization" /></span><div><h3>{{ rule.name }}</h3><p>{{ ruleConditionSummary(rule) }}</p><p>优先级 {{ rule.priority }} · 版本 {{ rule.version }}</p></div><span class="contract-badge" :class="rule.enabled ? 'success' : 'neutral'"><i></i>{{ rule.enabled ? '已启用' : '已停用' }}</span><div v-if="can('approval_rule.manage')" class="contract-rule-actions"><button class="contract-text-button" type="button" @click="editRule(rule)">编辑</button><button class="contract-text-button" type="button" @click="toggleRule(rule)">{{ rule.enabled ? '停用' : '启用' }}</button><button class="contract-text-button danger" type="button" @click="removeRule(rule)">删除</button></div></header><div class="contract-stepper"><template v-for="(node, index) in rule.nodes || []" :key="node.id"><span><b>{{ index + 1 }}</b><small>{{ node.name }} · {{ roleLabel(node.role_code) }}</small></span><i v-if="index < rule.nodes.length - 1"></i></template></div></article><div v-if="!rules.length" class="contract-card contract-empty-state"><ConsoleIcon name="organization" /><h3>暂无审批规则</h3><p>{{ can('approval_rule.manage') ? '点击“新增规则”配置第一条真实审批规则；未匹配时使用系统默认三级审批。' : '当前租户尚未配置审批规则。' }}</p></div></section>
        </template>

        <template v-else-if="activeSection === 'signing'">
          <div class="contract-card contract-empty-state"><ConsoleIcon name="shield" /><h3>暂无签署数据</h3><p>合同后端尚未提供签署台账接口。</p></div>
        </template>

        <template v-else-if="activeSection === 'reports'">
          <section class="contract-report-summary"><article><p>本人合同总额</p><strong>{{ formatAmount(totalContractAmount) }}</strong><span>来自合同 API</span></article><article><p>本人合同数量</p><strong>{{ contracts.length }} 份</strong><span>当前可见范围</span></article><article><p>平均合同金额</p><strong>{{ formatAmount(averageContractAmount) }}</strong><span>按当前结果计算</span></article><article><p>生效及履约合同</p><strong>{{ activeContractCount }} 份</strong><span>按真实状态计算</span></article></section>
          <div class="contract-card contract-empty-state"><ConsoleIcon name="dashboard" /><h3>暂无独立统计接口</h3><p>当前汇总仅使用合同列表 API 返回的数据。</p></div>
        </template>
      </section>
    </main>

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
      <article class="contract-detail-modal contract-document-modal"><header><div><span class="contract-badge" :class="statusTone(selectedContract.status)"><i></i>{{ selectedContract.status }}</span><h2>{{ selectedContract.name }}</h2><p>{{ selectedContract.id }}</p></div><button type="button" aria-label="关闭" @click="closeContract"><ConsoleIcon name="close" /></button></header><div class="contract-detail-highlight"><div><span>合同金额</span><strong>{{ formatAmount(selectedContract.amount) }}</strong></div><div><span>数据版本</span><strong>{{ selectedContract.version }}</strong></div><div><span>负责人姓名</span><strong>{{ selectedContract.owner }}</strong></div></div><section><h3>基本信息</h3><dl><div><dt>合同类型</dt><dd>{{ selectedContract.type }}</dd></div><div><dt>服务类型</dt><dd>{{ selectedContract.serviceType }}</dd></div><div><dt>创建日期</dt><dd>{{ selectedContract.createdAt }}</dd></div><div><dt>到期日期</dt><dd>{{ selectedContract.endDate }}</dd></div></dl></section><section><h3>合同内容</h3><div v-if="selectedContractPreviewLoading" class="contract-modal-loading">正在读取格式化合同…</div><p v-else-if="selectedContractPreviewError" class="contract-session-error">{{ selectedContractPreviewError }}</p><div v-else-if="selectedContractPreviewHTML" class="contract-document-preview contract-saved-document-preview"><div v-html="selectedContractPreviewHTML"></div></div><p v-else class="contract-approval-summary">{{ selectedContract.content || '未填写合同内容' }}</p><label v-if="selectedContract.status === '草稿' && can('contract.create')" class="contract-check-label"><input v-model="termsIdentical" type="checkbox" /><span>本合同条款与关联历史合同一致（参与审批规则匹配）</span></label></section><footer><button class="contract-button secondary" type="button" @click="closeContract">关闭</button><button v-if="selectedContract.status === '草稿' && can('contract.create')" class="contract-button primary" type="button" :disabled="submittingContract" @click="submitSelectedContract">{{ submittingContract ? '正在提交…' : '提交审批' }}</button></footer></article>
    </div>

    <div v-if="selectedApproval" class="contract-modal-mask" @click.self="selectedApproval = null"><article class="contract-detail-modal contract-approval-modal"><header><div><span class="contract-badge warning"><i></i>{{ approvalDetail?.state?.status || selectedApproval.status }}</span><h2>{{ approvalDetail?.contract?.title || `合同 ${selectedApproval.contractId}` }}</h2><p>{{ selectedApproval.id }} · {{ selectedApproval.type }}</p></div><button type="button" aria-label="关闭" @click="selectedApproval = null"><ConsoleIcon name="close" /></button></header><div v-if="approvalDetailLoading" class="contract-modal-loading">正在加载审批内容与流程记录…</div><template v-else-if="approvalDetail"><div class="contract-detail-highlight"><div><span>合同金额</span><strong>{{ formatAmount(Number(approvalDetail.contract.amount_minor || 0) / 100) }}</strong></div><div><span>申请人姓名</span><strong>{{ displayNameFor(approvalDetail.meta.applicant_user_id, approvalDetail.meta.applicant_display_name) }}</strong></div><div><span>当前节点</span><strong>{{ selectedApproval.step }}</strong></div></div><section><h3>审批事项</h3><dl><div><dt>合同编号</dt><dd>{{ approvalDetail.contract.contract_number }}</dd></div><div><dt>合同类型</dt><dd>{{ approvalDetail.contract.contract_type }}</dd></div><div><dt>服务类型</dt><dd>{{ approvalDetail.contract.service_type }}</dd></div><div><dt>规则版本</dt><dd>{{ approvalDetail.meta.rule_id ? `${approvalDetail.meta.rule_id} / V${approvalDetail.meta.rule_version}` : '系统默认流程' }}</dd></div><div><dt>状态变更</dt><dd>{{ approvalDetail.meta.from_status }} → {{ approvalDetail.meta.target_status }}</dd></div><div><dt>申请原因</dt><dd>{{ approvalDetail.meta.reason || '合同提交审批' }}</dd></div></dl></section><section><h3>合同正文</h3><p class="contract-approval-summary">{{ approvalDetail.contract.content || '未填写合同内容' }}</p></section><section><h3>审批流程</h3><div class="contract-detail-timeline"><div v-for="(runtime, index) in approvalDetail.state.nodes || []" :key="runtime.node.id" :class="{ done: runtime.status === 'approved', active: runtime.status === 'active' }"><i>{{ index + 1 }}</i><span><strong>{{ runtime.node.name }}</strong><small>{{ roleLabel(runtime.node.role_code) }} · {{ runtime.status }}</small></span></div></div></section><section v-if="approvalDetail.actions?.length"><h3>处理记录</h3><div class="contract-action-log"><div v-for="action in approvalDetail.actions" :key="action.id"><strong>{{ action.action }}</strong><span>{{ displayNameFor(action.actor_user_id, action.actor_display_name) }}</span><p>{{ action.comment || '无备注' }} · {{ formatDate(action.occurred_at) }}</p></div></div></section><section><label class="contract-comment-label">审批意见 / 评论<textarea v-model="approvalComment" placeholder="驳回、加签、转交、退回和撤回时必须填写原因"></textarea></label><div v-if="can('approval.process')" class="contract-advanced-actions"><label><span>目标用户姓名</span><select v-model="approvalTargetUser"><option value="">{{ userDirectory.length ? '请选择平台人员' : '平台人员清单暂不可用' }}</option><option v-for="user in userDirectory" :key="user.user_id" :value="user.user_id">{{ user.display_name }}</option></select></label><button class="contract-button secondary small" type="button" :disabled="!approvalTargetUser || approvalCommandBusy" @click="executeApprovalCommand('sign', { target_user_ids: [approvalTargetUser], countersign: 'all' })">加签</button><button class="contract-button secondary small" type="button" :disabled="!approvalTargetUser || approvalCommandBusy" @click="executeApprovalCommand('transfer', { target_user_ids: [approvalTargetUser] })">转交</button><label><span>退回节点 ID</span><input v-model="approvalTargetNode" placeholder="已通过节点 ID" /></label><button class="contract-button secondary small" type="button" :disabled="!approvalTargetNode || approvalCommandBusy" @click="executeApprovalCommand('return', { target_node_id: approvalTargetNode })">退回</button></div></section></template><footer><button v-if="can('approval.process')" class="contract-button danger" type="button" :disabled="approvalCommandBusy" @click="processApproval('reject')">驳回</button><button class="contract-button secondary" type="button" :disabled="approvalCommandBusy || !approvalComment.trim()" @click="executeApprovalCommand('comments')">发表评论</button><button v-if="can('approval.manage') || approvalDetail?.meta?.applicant_user_id === session?.user_id" class="contract-button secondary" type="button" :disabled="approvalCommandBusy" @click="executeApprovalCommand('urge')">催办</button><button v-if="approvalDetail?.meta?.applicant_user_id === session?.user_id" class="contract-button secondary" type="button" :disabled="approvalCommandBusy" @click="executeApprovalCommand('withdraw', {}, { close: true })">撤回</button><button v-if="can('approval.process')" class="contract-button primary" type="button" :disabled="approvalCommandBusy" @click="processApproval('approve')"><ConsoleIcon name="save" />同意</button></footer></article></div>

    <div v-if="ruleDialogOpen" class="contract-modal-mask" @click.self="ruleDialogOpen = false"><form class="contract-detail-modal contract-rule-modal" @submit.prevent="saveRule"><header><div><span class="contract-badge info">规则引擎</span><h2>{{ editingRuleId ? '编辑审批规则' : '新增审批规则' }}</h2><p>按优先级从高到低匹配，命中第一条规则后固化到审批实例。</p></div><button type="button" aria-label="关闭" @click="ruleDialogOpen = false"><ConsoleIcon name="close" /></button></header><section><div class="contract-form-grid"><label><span>规则名称</span><input v-model="ruleForm.name" required placeholder="例如：标准服务简化审批" /></label><label><span>优先级</span><input v-model.number="ruleForm.priority" required type="number" /></label><label><span>条件关系</span><select v-model="ruleForm.logical"><option value="and">全部满足（AND）</option><option value="or">任一满足（OR）</option></select></label><label class="contract-check-label"><input v-model="ruleForm.enabled" type="checkbox" /><span>保存后立即启用</span></label></div></section><section><div class="contract-section-title"><h3>触发条件</h3><button class="contract-text-button" type="button" @click="addRuleCondition">＋ 添加条件</button></div><div class="contract-rule-editor-list"><div v-for="(condition, index) in ruleForm.conditions" :key="index"><select v-model="condition.field" @change="condition.operator = conditionOperators(condition.field)[0].value; condition.value = conditionField(condition.field).kind === 'boolean' ? true : ''"><option v-for="field in ruleFieldOptions" :key="field.value" :value="field.value">{{ field.label }}</option></select><select v-model="condition.operator"><option v-for="operator in conditionOperators(condition.field)" :key="operator.value" :value="operator.value">{{ operator.label }}</option></select><select v-if="conditionField(condition.field).kind === 'boolean'" v-model="condition.value"><option :value="true">是</option><option :value="false">否</option></select><input v-else v-model="condition.value" required :type="conditionField(condition.field).kind === 'number' ? 'number' : 'text'" :placeholder="condition.operator === 'in' ? '多个值用逗号分隔' : '条件值'" /><button type="button" aria-label="删除条件" :disabled="ruleForm.conditions.length === 1" @click="ruleForm.conditions.splice(index, 1)">×</button></div></div></section><section><div class="contract-section-title"><h3>审批节点</h3><button class="contract-text-button" type="button" @click="addRuleNode">＋ 添加节点</button></div><div class="contract-rule-editor-list nodes"><div v-for="(node, index) in ruleForm.nodes" :key="index"><input v-model="node.id" required placeholder="节点 ID" /><input v-model="node.name" required placeholder="节点名称" /><select v-model="node.role_code" required><option value="">请选择审批角色</option><option v-if="node.role_code && !contractRole(node.role_code)" :value="node.role_code">未识别角色</option><option v-for="role in CONTRACT_ROLE_DEFINITIONS" :key="role.code" :value="role.code">{{ role.name }}</option></select><select v-model="node.countersign" disabled><option value="any">或签（任一）</option></select><button type="button" aria-label="删除节点" :disabled="ruleForm.nodes.length === 1" @click="ruleForm.nodes.splice(index, 1)">×</button></div></div></section><footer><button class="contract-button secondary" type="button" @click="ruleDialogOpen = false">取消</button><button class="contract-button primary" type="submit" :disabled="ruleSaving">{{ ruleSaving ? '正在保存…' : '保存规则' }}</button></footer></form></div>

    <div v-if="createDialogOpen" class="contract-modal-mask" @click.self="createDialogOpen = false">
      <form class="contract-detail-modal contract-create-modal" @submit.prevent="submitNewContract">
        <header><div><span class="contract-badge info">合同草稿</span><h2>新建合同</h2><p>选择模板后直接填写自动生成的合同字段</p></div><button type="button" aria-label="关闭" @click="createDialogOpen = false"><ConsoleIcon name="close" /></button></header>
        <section>
          <div class="contract-form-grid">
            <label><span>合同编号</span><input v-model="newContract.contract_number" required placeholder="请输入合同编号" /></label>
            <label><span>合同名称</span><input v-model="newContract.title" required placeholder="请输入合同名称" /></label>
            <label><span>合同类型</span><input v-model="newContract.contract_type" required placeholder="请输入合同类型" /></label>
            <label><span>服务类型</span><input v-model="newContract.service_type" required placeholder="请输入服务类型" /></label>
            <label><span>合同金额</span><input v-model="newContract.amount" required type="number" min="0" step="0.01" placeholder="0.00" /></label>
            <label><span>币种</span><input v-model="newContract.currency" required /></label>
            <label><span>负责人</span><input :value="currentUserLabel" readonly /></label>
            <label><span>到期日期</span><input v-model="newContract.end_date" type="date" /></label>
            <label class="contract-form-wide"><span>合同模板</span><select v-model="newContract.template_id" @change="selectContractTemplate"><option value="">不使用模板，手工填写正文</option><option v-for="item in contractTemplates" :key="item.id" :value="item.id">{{ item.name }}（{{ item.fields?.length || 0 }} 个字段）</option></select></label>
          </div>
          <div v-if="selectedContractTemplate" class="contract-generated-form">
            <div class="contract-section-title"><div><h3>填写模板字段</h3><p>{{ selectedContractTemplate.original_filename }}</p></div><button class="contract-button secondary small" type="button" :disabled="templatePreviewing" @click="previewNewContract">{{ templatePreviewing ? '正在生成预览…' : '预览合同' }}</button></div>
            <div class="contract-template-field-grid"><label v-for="field in selectedContractTemplate.fields || []" :key="field.name"><span>{{ field.label }}</span><input v-model="newContract.template_values[field.name]" required :placeholder="field.default ? `默认：${field.default}` : `请输入${field.label}`" /></label></div>
            <p v-if="templatePreviewError" class="contract-template-preview-error" role="alert">{{ templatePreviewError }}</p>
          </div>
          <label v-else class="contract-comment-label"><span>合同内容</span><textarea v-model="newContract.content" required placeholder="请输入合同内容"></textarea></label>
          <div v-if="templatePreviewHTML" ref="templatePreviewRef" class="contract-document-preview"><div class="contract-section-title"><h3>合同预览</h3><button class="contract-text-button" type="button" @click="templatePreviewHTML = ''">收起</button></div><div v-html="templatePreviewHTML"></div></div>
        </section>
        <footer><button class="contract-button secondary" type="button" @click="createDialogOpen = false">取消</button><button class="contract-button primary" type="submit"><ConsoleIcon name="save" />生成并保存合同</button></footer>
      </form>
    </div>

    <div v-if="templateUploadDialogOpen" class="contract-modal-mask" @click.self="templateUploadDialogOpen = false"><form class="contract-detail-modal contract-template-upload-modal" @submit.prevent="submitTemplateUpload"><header><div><span class="contract-badge info">超级管理员</span><h2>上传合同模板</h2><p>上传不超过 10MB 的 DOCX，模板中使用 <code v-pre>{{field_name:字段名称}}</code> 标记填写项。</p></div><button type="button" aria-label="关闭" @click="templateUploadDialogOpen = false"><ConsoleIcon name="close" /></button></header><section><div class="contract-form-grid"><label><span>模板名称</span><input v-model="templateUploadForm.name" required maxlength="160" placeholder="例如：标准服务合同" /></label><label><span>DOCX 文件</span><input required type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" @change="selectTemplateFile" /></label></div></section><footer><button class="contract-button secondary" type="button" :disabled="templateUploading" @click="templateUploadDialogOpen = false">取消</button><button class="contract-button primary" type="submit" :disabled="templateUploading">{{ templateUploading ? '正在上传…' : '上传模板' }}</button></footer></form></div>

    <Transition name="contract-toast"><div v-if="toast" class="contract-toast"><ConsoleIcon name="save" />{{ toast }}</div></Transition>
  </div>
</template>
