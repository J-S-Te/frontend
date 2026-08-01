<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import ContractDocumentPreview from '@/modules/contract_management/components/ContractDocumentPreview.vue'
import ContractReportsPanel from '@/modules/contract_management/components/ContractReportsPanel.vue'
import {
  commandApproval,
  ContractAuthError,
  createApprovalRule,
  createContract,
  deleteApprovalRule,
  deleteContractTemplate,
  getApproval,
  getContractDashboard,
  getContractSession,
  listApprovals,
  listApprovalRules,
  listApprovalTasks,
  listContractTemplates,
  listContracts,
  listMyOpportunities,
  previewApprovalContract,
  previewContractTemplate,
  previewContractDocument,
  submitContract,
  updateApprovalRule,
  updateContractTemplate,
  uploadContractTemplate,
} from '@/modules/contract_management/api/contract'
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
const businessDataErrors = ref({})

const sectionMeta = {
  dashboard: { title: '工作台', description: '合同全生命周期概览与重点事项提醒' },
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
      { key: 'contracts', label: '合同台账', icon: 'account' },
      { key: 'approvals', label: '审批中心', icon: 'audit' },
    ],
  },
  {
    label: '查询台账',
    items: [
      { key: 'customers', label: '客户查询', icon: 'user' },
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
      { key: 'customers', label: '客户查询', icon: 'user' },
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
const adminDashboard = ref(null)
const dashboardDetailKey = ref('')
const approvals = ref([])
const initiatedApprovals = ref([])
const approvalTab = ref('tasks')
const rules = ref([])
const contractTemplates = ref([])
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
const templateEditDialogOpen = ref(false)
const templateSaving = ref(false)
const templateEditForm = ref({ id: '', name: '', number_format: 'HT-{YYYYMMDD}-{ID8}', fields: [] })
const templatePreviewHTML = ref('')
const templatePreviewing = ref(false)
const templatePreviewError = ref('')
const templatePreviewRef = ref(null)
const ruleSaving = ref(false)
const editingRuleId = ref('')
const newContract = ref({
  opportunity_id: '',
  opportunity_name: '',
  title: '',
  contract_type: '',
  service_type: '',
  amount: '',
  currency: 'CNY',
  content: '',
  customer_name: '',
  customer_address: '',
  customer_contact: '',
  customer_phone: '',
  systems: [{ name: '', level: '' }],
  template_id: '',
  template_values: {},
})

const contractTypeOptions = ['直签', '三方']
const serviceTypeOptions = ['等保测评', '商用密码应用安全性评估', '软件测试', '源代码审计', '渗透测试', '漏洞扫描', 'APP安全加固', '上线测试', '安全加固', '网络安全风险评估', '差距分析', '机房检测', '网络安全巡检服务', '安全培训', '安全性测试', '应急响应服务', '网络安全攻防演练', '安全运维']
const systemLevelOptions = ['一级', '二级', '三级', '四级']
const opportunityPickerOpen = ref(false)
const opportunityLoading = ref(false)
const opportunityError = ref('')
const opportunityKeyword = ref('')
const opportunityOptions = ref([])
const filteredOpportunityOptions = computed(() => {
  const query = opportunityKeyword.value.trim().toLowerCase()
  return opportunityOptions.value.filter((item) => !query || [item.name, item.title, item.code, item.customer_name].join(' ').toLowerCase().includes(query))
})
const canAddSystemRow = computed(() => {
  const last = newContract.value.systems.at(-1)
  return newContract.value.systems.length < 15 && Boolean(last?.name.trim() && last?.level)
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
const navGroups = computed(() => (isAdmin.value ? adminNavGroupDefinitions : userNavGroupDefinitions)
  .map((group) => ({ ...group, items: group.items.filter((item) => canAccessContractSection(session.value, item.key)) }))
  .filter((group) => group.items.length))
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
const businessDataError = computed(() => businessDataErrors.value[activeSection.value] || '')
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
const adminDashboardContracts = computed(() => (adminDashboard.value?.contracts || []).map(normalizeContract))
const reportContracts = computed(() => adminDashboardContracts.value.length ? adminDashboardContracts.value : contracts.value)
const dashboardDetailMeta = computed(() => ({
  total_amount: { title: '当前企业合同总额', value: formatAmount(Number(adminDashboard.value?.total_amount_minor || 0) / 100) },
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

function openDashboardDetail(key) {
  dashboardDetailKey.value = key
}

function openDashboardContract(contract) {
  dashboardDetailKey.value = ''
  openContract(contract)
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

function normalizeContract(item) {
  return {
    recordId: item.id,
    id: item.contract_number || '审批通过后生成',
    name: item.title || '未命名合同',
    type: item.contract_type || '—',
    serviceType: item.service_type || '—',
    amount: Number(item.amount_minor || 0) / 100,
    currency: item.currency || 'CNY',
    owner: displayNameFor(item.owner_user_id, item.owner_display_name),
    createdAt: formatDate(item.created_at),
    updatedAt: formatDate(item.updated_at),
    startDate: formatDate(item.start_date),
    endDate: formatDate(item.end_date),
    status: contractStatusLabel(item.status),
    version: item.version,
    content: item.content || '',
    templateId: item.template_id || '',
    customerCreditLevel: item.customer_credit_level || '未填写',
    inApproval: Boolean(item.in_approval),
    activeUnexpired: Boolean(item.active_unexpired),
    expired: Boolean(item.expired),
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
    type: approvalKindLabel(item.kind),
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
  businessDataErrors.value = {}
  const requests = []
  const addRequest = (label, sections, promise) => requests.push({ label, sections, promise })
  if (can('contract.read')) {
    addRequest('合同统计', ['dashboard', 'reports'], getContractDashboard().then((summary) => { adminDashboard.value = summary }))
  } else {
    adminDashboard.value = null
  }
  addRequest('我发起的审批', ['dashboard', 'approvals'], listApprovals({ limit: 200 }).then((items) => { initiatedApprovals.value = items.map(normalizeApproval) }))
  if (can('contract.read')) {
    addRequest('合同台账', ['dashboard', 'contracts', 'signing', 'reports'], listContracts({ limit: 200 }).then((items) => { contracts.value = items.map(normalizeContract) }))
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
    contractTemplates.value = await listContractTemplates()
    templateEditDialogOpen.value = false
    showToast('合同模板已更新')
  } catch (error) {
    showToast(error?.message || '更新合同模板失败')
  } finally {
    templateSaving.value = false
  }
}

async function removeTemplate(item) {
  if (!window.confirm(`确定删除合同模板“${item.name}”吗？已生成的合同不受影响。`)) return
  try {
    await deleteContractTemplate(item.id)
    contractTemplates.value = await listContractTemplates()
    if (newContract.value.template_id === item.id) {
      newContract.value.template_id = ''
      selectContractTemplate()
    }
    showToast('合同模板已删除')
  } catch (error) {
    showToast(error?.message || '删除合同模板失败')
  }
}

function openNewContract() {
  templatePreviewHTML.value = ''
  templatePreviewError.value = ''
  createDialogOpen.value = true
}

async function openOpportunityPicker() {
  opportunityPickerOpen.value = true
  opportunityError.value = ''
  opportunityLoading.value = true
  try {
    opportunityOptions.value = await listMyOpportunities({ limit: 200 })
  } catch (error) {
    opportunityError.value = error?.message || '读取可关联商机失败，请稍后重试。'
  } finally {
    opportunityLoading.value = false
  }
}

function selectOpportunity(item) {
  newContract.value.opportunity_id = String(item.id || item.opportunity_id || '')
  newContract.value.opportunity_name = item.name || item.title || item.opportunity_name || '未命名商机'
  if (!newContract.value.customer_name) newContract.value.customer_name = item.customer_name || item.customer?.name || ''
  opportunityPickerOpen.value = false
}

function clearOpportunity() {
  newContract.value.opportunity_id = ''
  newContract.value.opportunity_name = ''
}

function addSystemRow() {
  if (!canAddSystemRow.value) return
  newContract.value.systems.push({ name: '', level: '' })
}

function removeSystemRow(index) {
  if (newContract.value.systems.length === 1) {
    newContract.value.systems[0] = { name: '', level: '' }
    return
  }
  newContract.value.systems.splice(index, 1)
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
      opportunity_id: newContract.value.opportunity_id,
      opportunity_name: newContract.value.opportunity_name,
      title: newContract.value.title.trim(),
      contract_type: newContract.value.contract_type,
      service_type: newContract.value.service_type,
      amount_minor: Math.round(Number(newContract.value.amount) * 100),
      currency: newContract.value.currency,
      customer_name: newContract.value.customer_name.trim(),
      customer_address: newContract.value.customer_address.trim(),
      customer_contact: newContract.value.customer_contact.trim(),
      customer_phone: newContract.value.customer_phone.trim(),
      systems: newContract.value.systems
        .filter((item) => item.name.trim() || item.level)
        .map((item) => ({ name: item.name.trim(), level: item.level })),
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
    newContract.value = { opportunity_id: '', opportunity_name: '', title: '', contract_type: '', service_type: '', amount: '', currency: 'CNY', content: '', customer_name: '', customer_address: '', customer_contact: '', customer_phone: '', systems: [{ name: '', level: '' }], template_id: '', template_values: {} }
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
  approvalContractPreviewHTML.value = ''
  approvalContractPreviewError.value = ''
  approvalComment.value = ''
  approvalTargetUser.value = ''
  approvalTargetNode.value = ''
  approvalDetailLoading.value = true
  try {
    approvalDetail.value = await getApproval(approval.id)
    approvalDetailLoading.value = false
    if (approvalDetail.value?.contract?.template_id) {
      approvalContractPreviewLoading.value = true
      try {
        const result = await previewApprovalContract(approval.id)
        approvalContractPreviewHTML.value = result?.html || ''
        if (!approvalContractPreviewHTML.value) approvalContractPreviewError.value = '模板合同没有可预览的正文内容。'
      } catch (error) {
        approvalContractPreviewError.value = error?.message || '读取格式化合同失败'
      } finally {
        approvalContractPreviewLoading.value = false
      }
    }
  } catch (error) {
    showToast(error?.message || '读取审批详情失败')
  } finally {
    approvalDetailLoading.value = false
  }
}

function closeApproval() {
  selectedApproval.value = null
  approvalDetail.value = null
  approvalContractPreviewHTML.value = ''
  approvalContractPreviewError.value = ''
  approvalContractPreviewLoading.value = false
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
    if (close) closeApproval()
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
  ruleForm.value.nodes.push({ id: `node-${Date.now()}-${index}`, name: '', role_code: '', countersign: 'any' })
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

function formatContractAmount(contract) {
  const currency = /^[A-Z]{3}$/.test(contract?.currency || '') ? contract.currency : 'CNY'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(contract?.amount || 0)
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
          <section class="contract-welcome"><div><span>已安全登录</span><h2>您好，{{ currentUserLabel }}</h2><p>当前角色：<b>{{ currentRoleLabel }}</b>。您可以使用当前角色已授权的合同功能。</p></div><button v-if="can('approval.process')" type="button" @click="navigate('approvals')">查看我的待办 <ConsoleIcon name="chevron" /></button></section>
          <section v-if="isAdmin" class="contract-stat-grid contract-admin-stat-grid">
            <button class="blue" type="button" @click="openDashboardDetail('total_amount')"><span class="contract-stat-icon"><ConsoleIcon name="account" /></span><p>当前企业合同总额</p><strong>{{ formatAmount(Number(adminDashboard?.total_amount_minor || 0) / 100) }}</strong><em>点击查看全部合同</em></button>
            <button class="purple" type="button" @click="openDashboardDetail('total_count')"><span class="contract-stat-icon"><ConsoleIcon name="save" /></span><p>当前企业合同份数</p><strong>{{ adminDashboard?.total_contracts || 0 }}<small>份</small></strong><em>点击查看全部合同</em></button>
            <button class="orange" type="button" @click="openDashboardDetail('approval')"><span class="contract-stat-icon"><ConsoleIcon name="audit" /></span><p>当前处于审批流程中的合同</p><strong>{{ adminDashboard?.approval_contracts || 0 }}<small>份</small></strong><em>点击查看审批中合同</em></button>
            <button class="green" type="button" @click="openDashboardDetail('active')"><span class="contract-stat-icon"><ConsoleIcon name="shield" /></span><p>已生效未到期的合同</p><strong>{{ adminDashboard?.active_contracts || 0 }}<small>份</small></strong><em>点击查看有效合同</em></button>
            <button class="red" type="button" @click="openDashboardDetail('expired')"><span class="contract-stat-icon"><ConsoleIcon name="info" /></span><p>已超期的合同</p><strong>{{ adminDashboard?.expired_contracts || 0 }}<small>份</small></strong><em>点击查看超期合同</em></button>
          </section>
          <section v-else class="contract-stat-grid">
            <article class="blue"><span class="contract-stat-icon"><ConsoleIcon name="account" /></span><p>本人合同总额</p><strong>{{ formatAmount(totalContractAmount) }}</strong><em>按当前可查合同汇总</em></article>
            <article class="purple"><span class="contract-stat-icon"><ConsoleIcon name="save" /></span><p>本人合同</p><strong>{{ contracts.length }}<small>份</small></strong><em>当前可见范围</em></article>
            <article v-if="can('approval.process')" class="orange"><span class="contract-stat-icon"><ConsoleIcon name="audit" /></span><p>待我审批</p><strong>{{ approvals.length }}<small>项</small></strong><em>当前活动任务</em></article>
            <article class="green"><span class="contract-stat-icon"><ConsoleIcon name="shield" /></span><p>生效及履约</p><strong>{{ activeContractCount }}<small>份</small></strong><em>按当前状态统计</em></article>
          </section>
        </template>

        <template v-else-if="activeSection === 'customers'">
          <div class="contract-card contract-empty-state"><ConsoleIcon name="user" /><h3>暂无客户数据</h3><p>当前没有可查看的客户记录。</p></div>
        </template>

        <template v-else-if="activeSection === 'contracts'">
          <div class="contract-filter-bar"><label class="contract-search-field"><ConsoleIcon name="search" /><input v-model="keyword" type="search" placeholder="合同编号 / 名称 / 类型" /></label><button class="contract-button ghost small" type="button" @click="resetFilters"><ConsoleIcon name="reset" />重置</button><button class="contract-button primary small" type="button" @click="loadBusinessData"><ConsoleIcon name="reset" />刷新</button></div>
          <div class="contract-table-card"><div class="contract-table-scroll"><table class="contract-data-table contract-ledger-table"><thead><tr><th>合同编号 / 名称</th><th>合同类型</th><th>服务类型</th><th>合同金额</th><th>负责人姓名</th><th>创建日期</th><th>到期日期</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="contract in filteredContracts" :key="contract.recordId"><td><button class="contract-entity-link" type="button" @click="openContract(contract)"><strong>{{ contract.name }}</strong><small>{{ contract.id }}</small></button></td><td>{{ contract.type }}</td><td>{{ contract.serviceType }}</td><td class="amount">{{ formatContractAmount(contract) }}</td><td>{{ contract.owner }}</td><td>{{ contract.createdAt }}</td><td>{{ contract.endDate }}</td><td><span class="contract-badge" :class="statusTone(contract.status)"><i></i>{{ contract.status }}</span></td><td><button class="contract-text-button" type="button" @click="openContract(contract)">详情</button></td></tr><tr v-if="!filteredContracts.length"><td colspan="9" class="contract-empty">当前没有可查看的合同</td></tr></tbody></table></div><footer class="contract-table-footer"><span>共 {{ filteredContracts.length }} 条合同记录</span></footer></div>
        </template>

        <template v-else-if="activeSection === 'templates'">
          <section v-if="contractTemplates.length" class="contract-template-grid">
            <article v-for="(item, index) in contractTemplates" :key="item.id">
              <div class="contract-template-cover" :class="['', 'purple', 'green', 'orange'][index % 4]"><span><ConsoleIcon name="save" /></span><i>DOCX</i></div>
              <div class="contract-template-copy"><span class="contract-badge success"><i></i>可用</span><h3>{{ item.name }}</h3><p>{{ item.original_filename }}</p><p>编号格式：{{ item.number_format || 'HT-{YYYYMMDD}-{ID8}' }}</p><div><span>{{ item.fields?.length || 0 }} 个填写字段 · {{ item.fields?.filter((field) => field.locked).length || 0 }} 个管理员配置</span><span>{{ formatDate(item.created_at) }}</span></div></div>
              <footer v-if="isAdmin" class="contract-template-actions"><button type="button" @click="editTemplate(item)">编辑</button><button class="danger" type="button" @click="removeTemplate(item)">删除</button></footer>
            </article>
          </section>
          <div v-else class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>暂无合同模板</h3><p>{{ isAdmin ? '点击右上角“上传模板”添加第一个 DOCX 模板。' : '超级管理员尚未上传合同模板。' }}</p></div>
        </template>

        <template v-else-if="activeSection === 'approvals'">
          <div class="contract-tabs" role="tablist" aria-label="审批列表">
            <button :class="{ active: approvalTab === 'tasks' }" type="button" role="tab" :aria-selected="approvalTab === 'tasks'" @click="approvalTab = 'tasks'">活动待办 <i>{{ approvals.length }}</i></button>
            <button :class="{ active: approvalTab === 'initiated' }" type="button" role="tab" :aria-selected="approvalTab === 'initiated'" @click="approvalTab = 'initiated'">我发起的 {{ initiatedApprovals.length }}</button>
            <button type="button" @click="loadBusinessData">刷新</button>
          </div>
          <section v-if="approvalTab === 'tasks'" class="contract-approval-list" role="tabpanel"><article v-for="approval in approvals" :key="approval.id"><header><span class="contract-badge" :class="approvalStatusTone(approval.status)"><i></i>{{ approvalStatusLabel(approval.status) }}</span><small>{{ approval.submittedAt }}</small></header><div><span class="contract-approval-icon"><ConsoleIcon name="audit" /></span><section><div><span class="contract-badge neutral">{{ approval.type }}</span><h3>合同审批</h3></div><p>任务创建于 {{ approval.submittedAt }}</p></section></div><footer><span><i></i>当前节点：{{ approval.step }}</span><button v-if="can('approval.process')" class="contract-button primary small" type="button" @click="openApproval(approval)">查看并处理</button></footer></article><div v-if="!approvals.length" class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>当前没有活动待办</h3><p>当有合同流转到您处理时，待办会显示在这里。</p></div></section>
          <section v-else class="contract-approval-list" role="tabpanel"><article v-for="approval in initiatedApprovals" :key="approval.id"><header><span class="contract-badge" :class="approvalStatusTone(approval.status)"><i></i>{{ approvalStatusLabel(approval.status) }}</span><small>{{ approval.submittedAt }}</small></header><div><span class="contract-approval-icon"><ConsoleIcon name="audit" /></span><section><div><span class="contract-badge neutral">{{ approval.type }}</span><h3>合同审批</h3></div><p>发起于 {{ approval.submittedAt }}</p></section></div><footer><span><i></i>流程位置：{{ approval.step }}</span><button class="contract-button secondary small" type="button" @click="openApproval(approval)">查看进度</button></footer></article><div v-if="!initiatedApprovals.length" class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>尚未发起审批</h3><p>在合同台账打开草稿并点击“提交审批”。</p></div></section>
        </template>

        <template v-else-if="activeSection === 'rules'">
          <div class="contract-info-banner"><ConsoleIcon name="info" /><span>审批流程按合同类型、金额与组织范围自动匹配。规则变更仅对新发起的流程生效。</span></div>
          <section class="contract-rule-list"><article v-for="rule in rules" :key="rule.id"><header><span class="contract-rule-icon"><ConsoleIcon name="organization" /></span><div><h3>{{ rule.name }}</h3><p>{{ ruleConditionSummary(rule) }}</p><p>优先级 {{ rule.priority }}</p></div><span class="contract-badge" :class="rule.enabled ? 'success' : 'neutral'"><i></i>{{ rule.enabled ? '已启用' : '已停用' }}</span><div v-if="can('approval_rule.manage')" class="contract-rule-actions"><button class="contract-text-button" type="button" @click="editRule(rule)">编辑</button><button class="contract-text-button" type="button" @click="toggleRule(rule)">{{ rule.enabled ? '停用' : '启用' }}</button><button class="contract-text-button danger" type="button" @click="removeRule(rule)">删除</button></div></header><div class="contract-stepper"><template v-for="(node, index) in rule.nodes || []" :key="node.id"><span><b>{{ index + 1 }}</b><small>{{ node.name }} · {{ roleLabel(node.role_code) }}</small></span><i v-if="index < rule.nodes.length - 1"></i></template></div></article><div v-if="!rules.length" class="contract-card contract-empty-state"><ConsoleIcon name="organization" /><h3>暂无审批规则</h3><p>{{ can('approval_rule.manage') ? '点击“新增规则”配置第一条审批规则；未匹配时使用默认审批流程。' : '当前企业尚未配置审批规则。' }}</p></div></section>
        </template>

        <template v-else-if="activeSection === 'signing'">
          <div class="contract-card contract-empty-state"><ConsoleIcon name="shield" /><h3>暂无签署数据</h3><p>当前没有可查看的合同签署记录。</p></div>
        </template>

        <template v-else-if="activeSection === 'reports'">
          <ContractReportsPanel :contracts="reportContracts" :enterprise-scope="isAdmin" :summary="adminDashboard" :detail-limited="Boolean(adminDashboard?.contract_detail_limited)" @open-contract="openReportContract" />
        </template>
      </section>
    </main>

    <div v-if="selectedContract" class="contract-modal-mask" @click.self="closeContract">
      <article class="contract-detail-modal contract-document-modal"><header><div><span class="contract-badge" :class="statusTone(selectedContract.status)"><i></i>{{ selectedContract.status }}</span><h2>{{ selectedContract.name }}</h2><p>{{ selectedContract.id }}</p></div><button type="button" aria-label="关闭" @click="closeContract"><ConsoleIcon name="close" /></button></header><div class="contract-detail-highlight"><div><span>合同金额</span><strong>{{ formatContractAmount(selectedContract) }}</strong></div><div><span>更新日期</span><strong>{{ selectedContract.updatedAt }}</strong></div><div><span>负责人姓名</span><strong>{{ selectedContract.owner }}</strong></div></div><section><h3>基本信息</h3><dl><div><dt>合同类型</dt><dd>{{ selectedContract.type }}</dd></div><div><dt>服务类型</dt><dd>{{ selectedContract.serviceType }}</dd></div><div><dt>创建日期</dt><dd>{{ selectedContract.createdAt }}</dd></div><div><dt>到期日期</dt><dd>{{ selectedContract.endDate }}</dd></div></dl></section><section><h3>合同内容</h3><div v-if="selectedContractPreviewLoading" class="contract-modal-loading">正在读取格式化合同…</div><p v-else-if="selectedContractPreviewError" class="contract-session-error">{{ selectedContractPreviewError }}</p><ContractDocumentPreview v-else-if="selectedContractPreviewHTML" class="contract-saved-document-preview" title="合同正文预览" :html="selectedContractPreviewHTML" /><p v-else class="contract-approval-summary">{{ selectedContract.content || '未填写合同内容' }}</p><label v-if="selectedContract.status === '草稿' && can('contract.create')" class="contract-check-label"><input v-model="termsIdentical" type="checkbox" /><span>本合同条款与关联历史合同一致（参与审批规则匹配）</span></label></section><footer><button class="contract-button secondary" type="button" @click="closeContract">关闭</button><button v-if="selectedContract.status === '草稿' && can('contract.create')" class="contract-button primary" type="button" :disabled="submittingContract" @click="submitSelectedContract">{{ submittingContract ? '正在提交…' : '提交审批' }}</button></footer></article>
    </div>

    <div v-if="dashboardDetailKey" class="contract-modal-mask" @click.self="dashboardDetailKey = ''"><article class="contract-detail-modal contract-dashboard-detail-modal"><header><div><span class="contract-badge info">企业合同统计</span><h2>{{ dashboardDetailMeta.title }}</h2><p>{{ dashboardDetailMeta.value }} · 数据范围为当前企业</p></div><button type="button" aria-label="关闭" @click="dashboardDetailKey = ''"><ConsoleIcon name="close" /></button></header><section><p v-if="adminDashboard?.contract_detail_limited" class="contract-info-banner"><ConsoleIcon name="info" />明细仅展示最近更新的 200 份合同，卡片统计值为企业全部合同的精确结果。</p><div class="contract-table-scroll"><table class="contract-data-table contract-dashboard-detail-table"><thead><tr><th>合同编号 / 名称</th><th>金额</th><th>负责人</th><th>到期日期</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="contract in dashboardDetailContracts" :key="contract.recordId"><td><strong>{{ contract.name }}</strong><span class="block mono">{{ contract.id }}</span></td><td class="amount">{{ formatAmount(contract.amount) }}</td><td>{{ contract.owner }}</td><td>{{ contract.endDate }}</td><td><span class="contract-badge" :class="statusTone(contract.status)"><i></i>{{ contract.status }}</span></td><td><button class="contract-text-button" type="button" @click="openDashboardContract(contract)">查看详情</button></td></tr><tr v-if="!dashboardDetailContracts.length"><td colspan="6" class="contract-empty">当前分类暂无合同</td></tr></tbody></table></div></section><footer><button class="contract-button secondary" type="button" @click="dashboardDetailKey = ''">关闭</button></footer></article></div>

    <div v-if="selectedApproval" class="contract-modal-mask" @click.self="closeApproval"><article class="contract-detail-modal contract-approval-modal"><header><div><span class="contract-badge" :class="approvalStatusTone(approvalDetail?.state?.status || selectedApproval.status)"><i></i>{{ approvalStatusLabel(approvalDetail?.state?.status || selectedApproval.status) }}</span><h2>{{ approvalDetail?.contract?.title || '合同审批' }}</h2><p>{{ selectedApproval.type }} · {{ selectedApproval.submittedAt }}</p></div><button type="button" aria-label="关闭" @click="closeApproval"><ConsoleIcon name="close" /></button></header><div v-if="approvalDetailLoading" class="contract-modal-loading">正在加载审批内容与流程记录…</div><template v-else-if="approvalDetail"><div class="contract-detail-highlight"><div><span>合同金额</span><strong>{{ formatAmount(Number(approvalDetail.contract.amount_minor || 0) / 100) }}</strong></div><div><span>申请人姓名</span><strong>{{ displayNameFor(approvalDetail.meta.applicant_user_id, approvalDetail.meta.applicant_display_name) }}</strong></div><div><span>当前节点</span><strong>{{ selectedApproval.step }}</strong></div></div><section><h3>审批事项</h3><dl><div><dt>合同编号</dt><dd>{{ approvalDetail.contract.contract_number }}</dd></div><div><dt>合同类型</dt><dd>{{ approvalDetail.contract.contract_type }}</dd></div><div><dt>服务类型</dt><dd>{{ approvalDetail.contract.service_type }}</dd></div><div><dt>审批流程</dt><dd>{{ approvalDetail.meta.rule_id ? '已匹配配置流程' : '系统默认流程' }}</dd></div><div><dt>状态变更</dt><dd>{{ contractStatusLabel(approvalDetail.meta.from_status) }} → {{ contractStatusLabel(approvalDetail.meta.target_status) }}</dd></div><div><dt>申请原因</dt><dd>{{ approvalDetail.meta.reason || '合同提交审批' }}</dd></div></dl></section><section><h3>合同正文</h3><div v-if="approvalContractPreviewLoading" class="contract-modal-loading">正在读取格式化合同…</div><p v-else-if="approvalContractPreviewError" class="contract-session-error">{{ approvalContractPreviewError }}</p><ContractDocumentPreview v-else-if="approvalContractPreviewHTML" class="contract-saved-document-preview" title="审批合同预览" :html="approvalContractPreviewHTML" /><p v-else class="contract-approval-summary">{{ approvalDetail.contract.content || '未填写合同内容' }}</p></section><section><h3>审批流程</h3><div class="contract-detail-timeline"><div v-for="(runtime, index) in approvalDetail.state.nodes || []" :key="runtime.node.id" :class="{ done: runtime.status === 'approved', active: runtime.status === 'active' }"><i>{{ index + 1 }}</i><span><strong>{{ runtime.node.name }}</strong><small>{{ roleLabel(runtime.node.role_code) }} · {{ approvalStatusLabel(runtime.status) }}</small></span></div></div></section><section v-if="approvalDetail.actions?.length"><h3>处理记录</h3><div class="contract-action-log"><div v-for="action in approvalDetail.actions" :key="action.id"><strong>{{ approvalActionLabel(action.action) }}</strong><span>{{ displayNameFor(action.actor_user_id, action.actor_display_name) }}</span><p>{{ action.comment || '无备注' }} · {{ formatDate(action.occurred_at) }}</p></div></div></section><section><label class="contract-comment-label">审批意见 / 评论<textarea v-model="approvalComment" placeholder="驳回、加签、转交、退回和撤回时必须填写原因"></textarea></label><div v-if="can('approval.process')" class="contract-advanced-actions"><label><span>目标用户姓名</span><select v-model="approvalTargetUser"><option value="">{{ userDirectory.length ? '请选择平台人员' : '平台人员清单暂不可用' }}</option><option v-for="user in userDirectory" :key="user.user_id" :value="user.user_id">{{ user.display_name }}</option></select></label><button class="contract-button secondary small" type="button" :disabled="!approvalTargetUser || approvalCommandBusy" @click="executeApprovalCommand('sign', { target_user_ids: [approvalTargetUser], countersign: 'all' })">加签</button><button class="contract-button secondary small" type="button" :disabled="!approvalTargetUser || approvalCommandBusy" @click="executeApprovalCommand('transfer', { target_user_ids: [approvalTargetUser] })">转交</button><label><span>退回至</span><select v-model="approvalTargetNode"><option value="">请选择已通过节点</option><option v-for="runtime in (approvalDetail.state.nodes || []).filter((item) => item.status === 'approved')" :key="runtime.node.id" :value="runtime.node.id">{{ runtime.node.name }}</option></select></label><button class="contract-button secondary small" type="button" :disabled="!approvalTargetNode || approvalCommandBusy" @click="executeApprovalCommand('return', { target_node_id: approvalTargetNode })">退回</button></div></section></template><footer><button v-if="can('approval.process')" class="contract-button danger" type="button" :disabled="approvalCommandBusy" @click="processApproval('reject')">驳回</button><button class="contract-button secondary" type="button" :disabled="approvalCommandBusy || !approvalComment.trim()" @click="executeApprovalCommand('comments')">发表评论</button><button v-if="can('approval.manage') || approvalDetail?.meta?.applicant_user_id === session?.user_id" class="contract-button secondary" type="button" :disabled="approvalCommandBusy" @click="executeApprovalCommand('urge')">催办</button><button v-if="approvalDetail?.meta?.applicant_user_id === session?.user_id" class="contract-button secondary" type="button" :disabled="approvalCommandBusy" @click="executeApprovalCommand('withdraw', {}, { close: true })">撤回</button><button v-if="can('approval.process')" class="contract-button primary" type="button" :disabled="approvalCommandBusy" @click="processApproval('approve')"><ConsoleIcon name="save" />同意</button></footer></article></div>

    <div v-if="ruleDialogOpen" class="contract-modal-mask" @click.self="ruleDialogOpen = false"><form class="contract-detail-modal contract-rule-modal" @submit.prevent="saveRule"><header><div><span class="contract-badge info">规则引擎</span><h2>{{ editingRuleId ? '编辑审批规则' : '新增审批规则' }}</h2><p>按优先级从高到低匹配，命中第一条规则后固化到审批实例。</p></div><button type="button" aria-label="关闭" @click="ruleDialogOpen = false"><ConsoleIcon name="close" /></button></header><section><div class="contract-form-grid"><label><span>规则名称</span><input v-model="ruleForm.name" required placeholder="例如：标准服务简化审批" /></label><label><span>优先级</span><input v-model.number="ruleForm.priority" required type="number" /></label><label><span>条件关系</span><select v-model="ruleForm.logical"><option value="and">全部满足（AND）</option><option value="or">任一满足（OR）</option></select></label><label class="contract-check-label"><input v-model="ruleForm.enabled" type="checkbox" /><span>保存后立即启用</span></label></div></section><section><div class="contract-section-title"><h3>触发条件</h3><button class="contract-text-button" type="button" @click="addRuleCondition">＋ 添加条件</button></div><div class="contract-rule-editor-list"><div v-for="(condition, index) in ruleForm.conditions" :key="index"><select v-model="condition.field" @change="condition.operator = conditionOperators(condition.field)[0].value; condition.value = conditionField(condition.field).kind === 'boolean' ? true : ''"><option v-for="field in ruleFieldOptions" :key="field.value" :value="field.value">{{ field.label }}</option></select><select v-model="condition.operator"><option v-for="operator in conditionOperators(condition.field)" :key="operator.value" :value="operator.value">{{ operator.label }}</option></select><select v-if="conditionField(condition.field).kind === 'boolean'" v-model="condition.value"><option :value="true">是</option><option :value="false">否</option></select><input v-else v-model="condition.value" required :type="conditionField(condition.field).kind === 'number' ? 'number' : 'text'" :placeholder="condition.operator === 'in' ? '多个值用逗号分隔' : '条件值'" /><button type="button" aria-label="删除条件" :disabled="ruleForm.conditions.length === 1" @click="ruleForm.conditions.splice(index, 1)">×</button></div></div></section><section><div class="contract-section-title"><h3>审批节点</h3><button class="contract-text-button" type="button" @click="addRuleNode">＋ 添加节点</button></div><div class="contract-rule-editor-list nodes"><div v-for="(node, index) in ruleForm.nodes" :key="index"><input v-model="node.name" required placeholder="节点名称" /><select v-model="node.role_code" required><option value="">请选择审批角色</option><option v-if="node.role_code && !contractRole(node.role_code)" :value="node.role_code">未识别角色</option><option v-for="role in CONTRACT_ROLE_DEFINITIONS" :key="role.code" :value="role.code">{{ role.name }}</option></select><select v-model="node.countersign" disabled><option value="any">或签（任一）</option></select><button type="button" aria-label="删除节点" :disabled="ruleForm.nodes.length === 1" @click="ruleForm.nodes.splice(index, 1)">×</button></div></div></section><footer><button class="contract-button secondary" type="button" @click="ruleDialogOpen = false">取消</button><button class="contract-button primary" type="submit" :disabled="ruleSaving">{{ ruleSaving ? '正在保存…' : '保存规则' }}</button></footer></form></div>

    <div v-if="createDialogOpen" class="contract-modal-mask" @click.self="createDialogOpen = false">
      <form class="contract-detail-modal contract-create-modal" @submit.prevent="submitNewContract">
        <header><div><span class="contract-badge info">合同草稿</span><h2>新建合同</h2><p>选择模板后直接填写自动生成的合同字段</p></div><button type="button" aria-label="关闭" @click="createDialogOpen = false"><ConsoleIcon name="close" /></button></header>
        <section>
          <div class="contract-form-grid">
            <label><span>关联商机（选填）</span><div class="contract-opportunity-control"><button type="button" @click="openOpportunityPicker">{{ newContract.opportunity_name || '点击选择权限范围内的商机' }}</button><button v-if="newContract.opportunity_id" type="button" aria-label="清除关联商机" @click="clearOpportunity">×</button></div><small>合同编号将在审批通过后自动生成</small></label>
            <label><span>合同名称</span><input v-model="newContract.title" required placeholder="请输入合同名称" /></label>
            <label><span>合同类型</span><select v-model="newContract.contract_type" required><option value="" disabled>请选择合同类型</option><option v-for="item in contractTypeOptions" :key="item" :value="item">{{ item }}</option></select></label>
            <label><span>服务类型</span><select v-model="newContract.service_type" required><option value="" disabled>请选择服务类型</option><option v-for="item in serviceTypeOptions" :key="item" :value="item">{{ item }}</option></select></label>
            <div class="contract-form-wide contract-system-information"><div class="contract-section-title"><div><h3>系统信息（选填）</h3><p>填写完整后可继续新增，最多 15 个系统</p></div><button class="contract-text-button" type="button" :disabled="!canAddSystemRow" @click="addSystemRow">＋ 继续新增一行</button></div><div v-for="(system, index) in newContract.systems" :key="index" class="contract-system-row"><label><span>系统名称</span><input v-model="system.name" :required="Boolean(system.name || system.level)" maxlength="255" placeholder="请输入系统名称" /></label><label><span>系统等级</span><select v-model="system.level" :required="Boolean(system.name || system.level)"><option value="">请选择系统等级</option><option v-for="level in systemLevelOptions" :key="level" :value="level">{{ level }}</option></select></label><button type="button" aria-label="删除系统信息" @click="removeSystemRow(index)">×</button></div></div>
            <label><span>合同金额</span><input v-model="newContract.amount" required type="number" min="0" step="0.01" placeholder="0.00" /></label>
            <label><span>币种</span><input v-model="newContract.currency" required /></label>
            <label><span>客户名称</span><input v-model="newContract.customer_name" required placeholder="请输入客户名称" /></label>
            <label><span>客户地址</span><input v-model="newContract.customer_address" placeholder="请输入客户地址" /></label>
            <label><span>客户联系人</span><input v-model="newContract.customer_contact" placeholder="请输入客户联系人" /></label>
            <label><span>客户联系电话</span><input v-model="newContract.customer_phone" type="tel" placeholder="请输入客户联系电话" /></label>
            <label class="contract-form-wide"><span>合同模板</span><select v-model="newContract.template_id" @change="selectContractTemplate"><option value="">不使用模板，手工填写正文</option><option v-for="item in contractTemplates" :key="item.id" :value="item.id">{{ item.name }}（{{ item.fields?.length || 0 }} 个字段）</option></select></label>
          </div>
          <div v-if="selectedContractTemplate" class="contract-generated-form">
            <div class="contract-section-title"><div><h3>填写模板字段</h3><p>{{ selectedContractTemplate.original_filename }}</p></div><button class="contract-button secondary small" type="button" :disabled="templatePreviewing" @click="previewNewContract">{{ templatePreviewing ? '正在生成预览…' : '预览合同' }}</button></div>
            <div class="contract-template-field-grid"><label v-for="field in selectedContractTemplate.fields || []" :key="field.name" :title="field.locked && !isAdmin ? '此项已由管理员预设' : undefined"><span>{{ field.label }}</span><input v-model="newContract.template_values[field.name]" required :readonly="field.locked && !isAdmin" :class="{ 'is-admin-configured': field.locked && !isAdmin }" :title="field.locked && !isAdmin ? '此项已由管理员预设' : undefined" :placeholder="field.default ? `默认：${field.default}` : `请输入${field.label}`" /><small v-if="field.locked && !isAdmin">此项已由管理员预设</small></label></div>
            <p v-if="templatePreviewError" class="contract-template-preview-error" role="alert">{{ templatePreviewError }}</p>
          </div>
          <label v-else class="contract-comment-label"><span>合同内容</span><textarea v-model="newContract.content" required placeholder="请输入合同内容"></textarea></label>
          <ContractDocumentPreview v-if="templatePreviewHTML" ref="templatePreviewRef" closable :html="templatePreviewHTML" @close="templatePreviewHTML = ''" />
        </section>
        <footer><button class="contract-button secondary" type="button" @click="createDialogOpen = false">取消</button><button class="contract-button primary" type="submit"><ConsoleIcon name="save" />生成并保存合同</button></footer>
      </form>
    </div>

    <div v-if="opportunityPickerOpen" class="contract-modal-mask contract-opportunity-mask" @click.self="opportunityPickerOpen = false"><article class="contract-detail-modal contract-opportunity-modal"><header><div><span class="contract-badge info">客户与商机管理</span><h2>选择关联商机</h2><p>仅显示当前账号权限范围内的商机</p></div><button type="button" aria-label="关闭" @click="opportunityPickerOpen = false"><ConsoleIcon name="close" /></button></header><section><label class="contract-opportunity-search"><span>搜索商机</span><input v-model="opportunityKeyword" type="search" placeholder="商机名称 / 编号 / 客户名称" /></label><p v-if="opportunityLoading" class="contract-modal-loading">正在读取商机…</p><p v-else-if="opportunityError" class="contract-session-error">{{ opportunityError }}</p><div v-else class="contract-opportunity-list"><button v-for="item in filteredOpportunityOptions" :key="item.id || item.opportunity_id" type="button" @click="selectOpportunity(item)"><strong>{{ item.name || item.title || item.opportunity_name }}</strong><span>{{ item.code || item.opportunity_code || '—' }} · {{ item.customer_name || item.customer?.name || '未关联客户' }}</span></button><p v-if="!filteredOpportunityOptions.length" class="contract-empty">当前没有可关联的商机</p></div></section><footer><button class="contract-button secondary" type="button" @click="opportunityPickerOpen = false">取消</button></footer></article></div>

    <div v-if="templateUploadDialogOpen" class="contract-modal-mask" @click.self="templateUploadDialogOpen = false"><form class="contract-detail-modal contract-template-upload-modal" @submit.prevent="submitTemplateUpload"><header><div><span class="contract-badge info">超级管理员</span><h2>上传合同模板</h2><p>上传不超过 10MB 的 DOCX，模板中使用 <code v-pre>{{field_name:字段名称}}</code> 标记填写项。</p></div><button type="button" aria-label="关闭" @click="templateUploadDialogOpen = false"><ConsoleIcon name="close" /></button></header><section><div class="contract-form-grid"><label><span>模板名称</span><input v-model="templateUploadForm.name" required maxlength="160" placeholder="例如：标准服务合同" /></label><label><span>DOCX 文件</span><input required type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" @change="selectTemplateFile" /></label></div></section><footer><button class="contract-button secondary" type="button" :disabled="templateUploading" @click="templateUploadDialogOpen = false">取消</button><button class="contract-button primary" type="submit" :disabled="templateUploading">{{ templateUploading ? '正在上传…' : '上传模板' }}</button></footer></form></div>

    <div v-if="templateEditDialogOpen" class="contract-modal-mask" @click.self="templateEditDialogOpen = false"><form class="contract-detail-modal contract-template-edit-modal" @submit.prevent="saveTemplate"><header><div><span class="contract-badge info">超级管理员</span><h2>编辑合同模板</h2><p>可编辑合同编号格式，并将需要统一控制的合同信息设为管理员预设。</p></div><button type="button" aria-label="关闭" @click="templateEditDialogOpen = false"><ConsoleIcon name="close" /></button></header><section><div class="contract-template-base-fields"><label class="contract-template-name-field"><span>模板名称</span><input v-model="templateEditForm.name" required maxlength="160" /></label><label class="contract-template-name-field"><span>合同编号格式</span><input v-model="templateEditForm.number_format" required maxlength="160" placeholder="HT-{YYYYMMDD}-{ID8}" /><small>支持 {YYYYMMDD}、{YYYY}、{MM}、{DD}、{ID8}；必须包含 {ID8}</small></label></div><div class="contract-template-editor-list"><div v-for="field in templateEditForm.fields" :key="field.name" class="contract-template-editor-row"><label><span>显示名称</span><input v-model="field.label" required /></label><label><span>{{ field.locked ? '管理员预设值' : '默认值（可选）' }}</span><input v-model="field.default" :required="field.locked" :placeholder="field.locked ? '请输入固定值' : '新建合同时仍可修改'" /></label><label class="contract-check-label"><input v-model="field.locked" type="checkbox" /><span>由管理员预设</span></label></div><p v-if="!templateEditForm.fields.length" class="contract-session-error">该 DOCX 中没有可配置字段。</p></div></section><footer><button class="contract-button secondary" type="button" :disabled="templateSaving" @click="templateEditDialogOpen = false">取消</button><button class="contract-button primary" type="submit" :disabled="templateSaving">{{ templateSaving ? '正在保存…' : '保存模板' }}</button></footer></form></div>

    <Transition name="contract-toast"><div v-if="toast" class="contract-toast"><ConsoleIcon name="save" />{{ toast }}</div></Transition>
  </div>
</template>
