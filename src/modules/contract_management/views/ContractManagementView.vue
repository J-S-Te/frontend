<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  commandApproval,
  createApprovalRule,
  createContract,
  deleteApprovalRule,
  getApproval,
  getContractSession,
  listApprovals,
  listApprovalRules,
  listApprovalTasks,
  listContracts,
  submitContract,
  updateApprovalRule,
} from '@/modules/contract_management/api/contract'
import { canAccessContractSection, hasContractPermission } from '@/modules/shared/authz/sys004'
import '@/modules/contract_management/styles/contract-management.css'

const route = useRoute()
const router = useRouter()
const session = ref(null)
const sessionError = ref('')

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

const navGroupDefinitions = [
  {
    label: '业务中心',
    items: [
      { key: 'dashboard', label: '工作台', icon: 'dashboard' },
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
    nodes: [{ id: 'sales-director', name: '销售总监审批', role_code: 'sales_director', countersign: 'all' }],
    version: 0,
  }
}
const ruleForm = ref(emptyRuleForm())

const navGroups = computed(() => navGroupDefinitions
  .map((group) => ({ ...group, items: group.items.filter((item) => canAccessContractSection(session.value, item.key)) }))
  .filter((group) => group.items.length))

const currentUserLabel = computed(() => session.value?.display_name || session.value?.user_name || '当前用户')
const currentRoleLabel = computed(() => session.value?.role?.name || session.value?.role?.code || '未分配角色')
const currentUserInitial = computed(() => currentUserLabel.value.slice(0, 1).toUpperCase())
const userDirectory = computed(() => Array.isArray(session.value?.user_directory) ? session.value.user_directory : [])
const can = (permission) => hasContractPermission(session.value, permission)

const keyword = ref('')
const statusFilter = ref('')
const typeFilter = ref('')
const mobileMenuOpen = ref(false)
const selectedContract = ref(null)
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
  }
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
  requests.push(listApprovals({ limit: 200 }).then((items) => { initiatedApprovals.value = items.map(normalizeApproval) }))
  if (can('contract.read')) {
    requests.push(listContracts({ limit: 200 }).then((items) => { contracts.value = items.map(normalizeContract) }))
  }
  if (can('approval.process')) {
    requests.push(listApprovalTasks({ limit: 200 }).then((items) => { approvals.value = items.map(normalizeApproval) }))
  }
  if (can('approval.view') || can('approval_rule.manage')) {
    requests.push(listApprovalRules().then((items) => { rules.value = items }))
  }
  const results = await Promise.allSettled(requests)
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length) {
    businessDataError.value = failures.map((result) => result.reason?.message || '业务数据加载失败').join('；')
  }
  businessDataLoading.value = false
}

async function submitNewContract() {
  try {
    await createContract({
      contract_number: newContract.value.contract_number.trim(),
      title: newContract.value.title.trim(),
      contract_type: newContract.value.contract_type,
      service_type: newContract.value.service_type.trim(),
      amount_minor: Math.round(Number(newContract.value.amount) * 100),
      currency: newContract.value.currency,
      content: newContract.value.content.trim(),
      ...(newContract.value.end_date ? { end_date: new Date(`${newContract.value.end_date}T00:00:00Z`).toISOString() } : {}),
    })
    createDialogOpen.value = false
    newContract.value = { contract_number: '', title: '', contract_type: '', service_type: '', amount: '', currency: 'CNY', content: '', end_date: '' }
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
    nodes: (rule.nodes || []).map((node) => ({ ...node })),
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
  ruleForm.value.nodes.push({ id: `node-${index}`, name: '', role_code: '', countersign: 'all' })
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
      countersign: node.countersign || 'all', assignee_ids: [],
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
            <button v-if="['dashboard', 'contracts'].includes(activeSection) && can('contract.create')" class="contract-button primary" type="button" @click="createDialogOpen = true">＋ 新建合同</button>
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

        <template v-else-if="activeSection === 'customers'">
          <div class="contract-card contract-empty-state"><ConsoleIcon name="user" /><h3>暂无客户数据</h3><p>合同后端尚未提供客户查询接口。</p></div>
        </template>

        <template v-else-if="activeSection === 'contracts'">
          <div class="contract-filter-bar"><label class="contract-search-field"><ConsoleIcon name="search" /><input v-model="keyword" type="search" placeholder="合同编号 / 名称 / 类型" /></label><button class="contract-button ghost small" type="button" @click="resetFilters"><ConsoleIcon name="reset" />重置</button><button class="contract-button primary small" type="button" @click="loadBusinessData"><ConsoleIcon name="reset" />刷新真实数据</button></div>
          <div class="contract-table-card"><div class="contract-table-scroll"><table class="contract-data-table contract-ledger-table"><thead><tr><th>合同编号 / 名称</th><th>合同类型</th><th>服务类型</th><th>合同金额</th><th>负责人姓名</th><th>创建日期</th><th>到期日期</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="contract in filteredContracts" :key="contract.recordId"><td><button class="contract-entity-link" type="button" @click="selectedContract = contract"><strong>{{ contract.name }}</strong><small>{{ contract.id }}</small></button></td><td>{{ contract.type }}</td><td>{{ contract.serviceType }}</td><td class="amount">{{ formatAmount(contract.amount) }}</td><td>{{ contract.owner }}</td><td>{{ contract.createdAt }}</td><td>{{ contract.endDate }}</td><td><span class="contract-badge" :class="statusTone(contract.status)"><i></i>{{ contract.status }}</span></td><td><button class="contract-text-button" type="button" @click="selectedContract = contract">详情</button></td></tr><tr v-if="!filteredContracts.length"><td colspan="9" class="contract-empty">合同 API 当前未返回可见合同</td></tr></tbody></table></div><footer class="contract-table-footer"><span>共 {{ filteredContracts.length }} 条真实合同记录</span></footer></div>
        </template>

        <template v-else-if="activeSection === 'templates'">
          <div class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>暂无合同模板</h3><p>合同后端尚未提供模板接口。</p></div>
        </template>

        <template v-else-if="activeSection === 'approvals'">
          <div class="contract-tabs"><button class="active" type="button">活动待办 <i>{{ approvals.length }}</i></button><button type="button">我发起的 {{ initiatedApprovals.length }}</button><button type="button" @click="loadBusinessData">刷新</button></div>
          <section class="contract-approval-list"><article v-for="approval in approvals" :key="approval.id"><header><span class="contract-badge warning"><i></i>{{ approval.status }}</span><small>{{ approval.id }}</small></header><div><span class="contract-approval-icon"><ConsoleIcon name="audit" /></span><section><div><span class="contract-badge neutral">{{ approval.type }}</span><h3>合同 {{ approval.contractId }}</h3></div><p>任务创建于 {{ approval.submittedAt }}</p></section></div><footer><span><i></i>当前节点：{{ approval.step }}</span><button v-if="can('approval.process')" class="contract-button primary small" type="button" @click="openApproval(approval)">查看并处理</button></footer></article><div v-if="!approvals.length" class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>当前没有活动待办</h3><p>提交合同审批并完成当前审批人配置后，待办会显示在这里。</p></div></section>
          <h2 class="contract-subsection-title">我发起的审批</h2>
          <section class="contract-approval-list"><article v-for="approval in initiatedApprovals" :key="approval.id"><header><span class="contract-badge" :class="approval.status === 'running' ? 'info' : approval.status === 'approved' ? 'success' : approval.status === 'rejected' ? 'danger' : 'neutral'"><i></i>{{ approval.status }}</span><small>{{ approval.id }}</small></header><div><span class="contract-approval-icon"><ConsoleIcon name="audit" /></span><section><div><span class="contract-badge neutral">{{ approval.type }}</span><h3>合同 {{ approval.contractId }}</h3></div><p>发起于 {{ approval.submittedAt }}</p></section></div><footer><span><i></i>流程位置：{{ approval.step }}</span><button class="contract-button secondary small" type="button" @click="openApproval(approval)">查看进度</button></footer></article><div v-if="!initiatedApprovals.length" class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>尚未发起审批</h3><p>在合同台账打开草稿并点击“提交审批”。</p></div></section>
        </template>

        <template v-else-if="activeSection === 'rules'">
          <div class="contract-info-banner"><ConsoleIcon name="info" /><span>审批流程按合同类型、金额与组织范围自动匹配。规则变更仅对新发起的流程生效。</span></div>
          <section class="contract-rule-list"><article v-for="rule in rules" :key="rule.id"><header><span class="contract-rule-icon"><ConsoleIcon name="organization" /></span><div><h3>{{ rule.name }}</h3><p>{{ ruleConditionSummary(rule) }}</p><p>优先级 {{ rule.priority }} · 版本 {{ rule.version }}</p></div><span class="contract-badge" :class="rule.enabled ? 'success' : 'neutral'"><i></i>{{ rule.enabled ? '已启用' : '已停用' }}</span><div v-if="can('approval_rule.manage')" class="contract-rule-actions"><button class="contract-text-button" type="button" @click="editRule(rule)">编辑</button><button class="contract-text-button" type="button" @click="toggleRule(rule)">{{ rule.enabled ? '停用' : '启用' }}</button><button class="contract-text-button danger" type="button" @click="removeRule(rule)">删除</button></div></header><div class="contract-stepper"><template v-for="(node, index) in rule.nodes || []" :key="node.id"><span><b>{{ index + 1 }}</b><small>{{ node.name }} · {{ node.role_code }}</small></span><i v-if="index < rule.nodes.length - 1"></i></template></div></article><div v-if="!rules.length" class="contract-card contract-empty-state"><ConsoleIcon name="organization" /><h3>暂无审批规则</h3><p>{{ can('approval_rule.manage') ? '点击“新增规则”配置第一条真实审批规则；未匹配时使用系统默认三级审批。' : '当前租户尚未配置审批规则。' }}</p></div></section>
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

    <div v-if="selectedContract" class="contract-modal-mask" @click.self="selectedContract = null">
      <article class="contract-detail-modal"><header><div><span class="contract-badge" :class="statusTone(selectedContract.status)"><i></i>{{ selectedContract.status }}</span><h2>{{ selectedContract.name }}</h2><p>{{ selectedContract.id }}</p></div><button type="button" aria-label="关闭" @click="selectedContract = null"><ConsoleIcon name="close" /></button></header><div class="contract-detail-highlight"><div><span>合同金额</span><strong>{{ formatAmount(selectedContract.amount) }}</strong></div><div><span>数据版本</span><strong>{{ selectedContract.version }}</strong></div><div><span>负责人姓名</span><strong>{{ selectedContract.owner }}</strong></div></div><section><h3>基本信息</h3><dl><div><dt>合同类型</dt><dd>{{ selectedContract.type }}</dd></div><div><dt>服务类型</dt><dd>{{ selectedContract.serviceType }}</dd></div><div><dt>创建日期</dt><dd>{{ selectedContract.createdAt }}</dd></div><div><dt>到期日期</dt><dd>{{ selectedContract.endDate }}</dd></div></dl></section><section><h3>合同内容</h3><p class="contract-approval-summary">{{ selectedContract.content || '未填写合同内容' }}</p><label v-if="selectedContract.status === '草稿' && can('contract.create')" class="contract-check-label"><input v-model="termsIdentical" type="checkbox" /><span>本合同条款与关联历史合同一致（参与审批规则匹配）</span></label></section><footer><button class="contract-button secondary" type="button" @click="selectedContract = null">关闭</button><button v-if="selectedContract.status === '草稿' && can('contract.create')" class="contract-button primary" type="button" :disabled="submittingContract" @click="submitSelectedContract">{{ submittingContract ? '正在提交…' : '提交审批' }}</button></footer></article>
    </div>

    <div v-if="selectedApproval" class="contract-modal-mask" @click.self="selectedApproval = null"><article class="contract-detail-modal contract-approval-modal"><header><div><span class="contract-badge warning"><i></i>{{ approvalDetail?.state?.status || selectedApproval.status }}</span><h2>{{ approvalDetail?.contract?.title || `合同 ${selectedApproval.contractId}` }}</h2><p>{{ selectedApproval.id }} · {{ selectedApproval.type }}</p></div><button type="button" aria-label="关闭" @click="selectedApproval = null"><ConsoleIcon name="close" /></button></header><div v-if="approvalDetailLoading" class="contract-modal-loading">正在加载审批内容与流程记录…</div><template v-else-if="approvalDetail"><div class="contract-detail-highlight"><div><span>合同金额</span><strong>{{ formatAmount(Number(approvalDetail.contract.amount_minor || 0) / 100) }}</strong></div><div><span>申请人姓名</span><strong>{{ displayNameFor(approvalDetail.meta.applicant_user_id, approvalDetail.meta.applicant_display_name) }}</strong></div><div><span>当前节点</span><strong>{{ selectedApproval.step }}</strong></div></div><section><h3>审批事项</h3><dl><div><dt>合同编号</dt><dd>{{ approvalDetail.contract.contract_number }}</dd></div><div><dt>合同类型</dt><dd>{{ approvalDetail.contract.contract_type }}</dd></div><div><dt>服务类型</dt><dd>{{ approvalDetail.contract.service_type }}</dd></div><div><dt>规则版本</dt><dd>{{ approvalDetail.meta.rule_id ? `${approvalDetail.meta.rule_id} / V${approvalDetail.meta.rule_version}` : '系统默认流程' }}</dd></div><div><dt>状态变更</dt><dd>{{ approvalDetail.meta.from_status }} → {{ approvalDetail.meta.target_status }}</dd></div><div><dt>申请原因</dt><dd>{{ approvalDetail.meta.reason || '合同提交审批' }}</dd></div></dl></section><section><h3>合同正文</h3><p class="contract-approval-summary">{{ approvalDetail.contract.content || '未填写合同内容' }}</p></section><section><h3>审批流程</h3><div class="contract-detail-timeline"><div v-for="(runtime, index) in approvalDetail.state.nodes || []" :key="runtime.node.id" :class="{ done: runtime.status === 'approved', active: runtime.status === 'active' }"><i>{{ index + 1 }}</i><span><strong>{{ runtime.node.name }}</strong><small>{{ runtime.node.role_code }} · {{ runtime.status }}</small></span></div></div></section><section v-if="approvalDetail.actions?.length"><h3>处理记录</h3><div class="contract-action-log"><div v-for="action in approvalDetail.actions" :key="action.id"><strong>{{ action.action }}</strong><span>{{ displayNameFor(action.actor_user_id, action.actor_display_name) }}</span><p>{{ action.comment || '无备注' }} · {{ formatDate(action.occurred_at) }}</p></div></div></section><section><label class="contract-comment-label">审批意见 / 评论<textarea v-model="approvalComment" placeholder="驳回、加签、转交、退回和撤回时必须填写原因"></textarea></label><div v-if="can('approval.process')" class="contract-advanced-actions"><label><span>目标用户姓名</span><select v-model="approvalTargetUser"><option value="">请选择人员</option><option v-for="user in userDirectory" :key="user.user_id" :value="user.user_id">{{ user.display_name }}</option></select></label><button class="contract-button secondary small" type="button" :disabled="!approvalTargetUser || approvalCommandBusy" @click="executeApprovalCommand('sign', { target_user_ids: [approvalTargetUser], countersign: 'all' })">加签</button><button class="contract-button secondary small" type="button" :disabled="!approvalTargetUser || approvalCommandBusy" @click="executeApprovalCommand('transfer', { target_user_ids: [approvalTargetUser] })">转交</button><label><span>退回节点 ID</span><input v-model="approvalTargetNode" placeholder="已通过节点 ID" /></label><button class="contract-button secondary small" type="button" :disabled="!approvalTargetNode || approvalCommandBusy" @click="executeApprovalCommand('return', { target_node_id: approvalTargetNode })">退回</button></div></section></template><footer><button v-if="can('approval.process')" class="contract-button danger" type="button" :disabled="approvalCommandBusy" @click="processApproval('reject')">驳回</button><button class="contract-button secondary" type="button" :disabled="approvalCommandBusy || !approvalComment.trim()" @click="executeApprovalCommand('comments')">发表评论</button><button v-if="can('approval.manage') || approvalDetail?.meta?.applicant_user_id === session?.user_id" class="contract-button secondary" type="button" :disabled="approvalCommandBusy" @click="executeApprovalCommand('urge')">催办</button><button v-if="approvalDetail?.meta?.applicant_user_id === session?.user_id" class="contract-button secondary" type="button" :disabled="approvalCommandBusy" @click="executeApprovalCommand('withdraw', {}, { close: true })">撤回</button><button v-if="can('approval.process')" class="contract-button primary" type="button" :disabled="approvalCommandBusy" @click="processApproval('approve')"><ConsoleIcon name="save" />同意</button></footer></article></div>

    <div v-if="ruleDialogOpen" class="contract-modal-mask" @click.self="ruleDialogOpen = false"><form class="contract-detail-modal contract-rule-modal" @submit.prevent="saveRule"><header><div><span class="contract-badge info">规则引擎</span><h2>{{ editingRuleId ? '编辑审批规则' : '新增审批规则' }}</h2><p>按优先级从高到低匹配，命中第一条规则后固化到审批实例。</p></div><button type="button" aria-label="关闭" @click="ruleDialogOpen = false"><ConsoleIcon name="close" /></button></header><section><div class="contract-form-grid"><label><span>规则名称</span><input v-model="ruleForm.name" required placeholder="例如：标准服务简化审批" /></label><label><span>优先级</span><input v-model.number="ruleForm.priority" required type="number" /></label><label><span>条件关系</span><select v-model="ruleForm.logical"><option value="and">全部满足（AND）</option><option value="or">任一满足（OR）</option></select></label><label class="contract-check-label"><input v-model="ruleForm.enabled" type="checkbox" /><span>保存后立即启用</span></label></div></section><section><div class="contract-section-title"><h3>触发条件</h3><button class="contract-text-button" type="button" @click="addRuleCondition">＋ 添加条件</button></div><div class="contract-rule-editor-list"><div v-for="(condition, index) in ruleForm.conditions" :key="index"><select v-model="condition.field" @change="condition.operator = conditionOperators(condition.field)[0].value; condition.value = conditionField(condition.field).kind === 'boolean' ? true : ''"><option v-for="field in ruleFieldOptions" :key="field.value" :value="field.value">{{ field.label }}</option></select><select v-model="condition.operator"><option v-for="operator in conditionOperators(condition.field)" :key="operator.value" :value="operator.value">{{ operator.label }}</option></select><select v-if="conditionField(condition.field).kind === 'boolean'" v-model="condition.value"><option :value="true">是</option><option :value="false">否</option></select><input v-else v-model="condition.value" required :type="conditionField(condition.field).kind === 'number' ? 'number' : 'text'" :placeholder="condition.operator === 'in' ? '多个值用逗号分隔' : '条件值'" /><button type="button" aria-label="删除条件" :disabled="ruleForm.conditions.length === 1" @click="ruleForm.conditions.splice(index, 1)">×</button></div></div></section><section><div class="contract-section-title"><h3>审批节点</h3><button class="contract-text-button" type="button" @click="addRuleNode">＋ 添加节点</button></div><div class="contract-rule-editor-list nodes"><div v-for="(node, index) in ruleForm.nodes" :key="index"><input v-model="node.id" required placeholder="节点 ID" /><input v-model="node.name" required placeholder="节点名称" /><input v-model="node.role_code" required placeholder="角色编码" /><select v-model="node.countersign"><option value="all">会签（全部）</option><option value="any">或签（任一）</option></select><button type="button" aria-label="删除节点" :disabled="ruleForm.nodes.length === 1" @click="ruleForm.nodes.splice(index, 1)">×</button></div></div></section><footer><button class="contract-button secondary" type="button" @click="ruleDialogOpen = false">取消</button><button class="contract-button primary" type="submit" :disabled="ruleSaving">{{ ruleSaving ? '正在保存…' : '保存规则' }}</button></footer></form></div>

    <div v-if="createDialogOpen" class="contract-modal-mask" @click.self="createDialogOpen = false"><form class="contract-detail-modal contract-create-modal" @submit.prevent="submitNewContract"><header><div><span class="contract-badge info">合同草稿</span><h2>新建合同</h2><p>数据将提交至合同 API</p></div><button type="button" aria-label="关闭" @click="createDialogOpen = false"><ConsoleIcon name="close" /></button></header><section><div class="contract-form-grid"><label><span>合同编号</span><input v-model="newContract.contract_number" required placeholder="请输入合同编号" /></label><label><span>合同名称</span><input v-model="newContract.title" required placeholder="请输入合同名称" /></label><label><span>合同类型</span><input v-model="newContract.contract_type" required placeholder="请输入合同类型" /></label><label><span>服务类型</span><input v-model="newContract.service_type" required placeholder="请输入服务类型" /></label><label><span>合同金额</span><input v-model="newContract.amount" required type="number" min="0" step="0.01" placeholder="0.00" /></label><label><span>币种</span><input v-model="newContract.currency" required /></label><label><span>负责人</span><input :value="currentUserLabel" readonly /></label><label><span>到期日期</span><input v-model="newContract.end_date" type="date" /></label></div><label class="contract-comment-label"><span>合同内容</span><textarea v-model="newContract.content" required placeholder="请输入合同内容"></textarea></label></section><footer><button class="contract-button secondary" type="button" @click="createDialogOpen = false">取消</button><button class="contract-button primary" type="submit"><ConsoleIcon name="save" />保存草稿</button></footer></form></div>

    <Transition name="contract-toast"><div v-if="toast" class="contract-toast"><ConsoleIcon name="save" />{{ toast }}</div></Transition>
  </div>
</template>
