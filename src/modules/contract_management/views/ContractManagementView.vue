<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  commandApproval,
  createContract,
  getContractSession,
  listApprovalRules,
  listApprovalTasks,
  listContracts,
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
const rules = ref([])
const businessDataError = ref('')
const businessDataLoading = ref(false)
const approvalComment = ref('')
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


const navGroups = computed(() => navGroupDefinitions
  .map((group) => ({ ...group, items: group.items.filter((item) => canAccessContractSection(session.value, item.key)) }))
  .filter((group) => group.items.length))

const currentUserLabel = computed(() => session.value?.user_name || session.value?.display_name || session.value?.user_id || '当前用户')
const currentRoleLabel = computed(() => session.value?.role?.name || session.value?.role?.code || '未分配角色')
const currentUserInitial = computed(() => currentUserLabel.value.slice(0, 1).toUpperCase())
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
  const csv = [['合同编号', '合同名称', '合同类型', '服务类型', '金额', '负责人 ID', '状态'], ...rows]
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
    owner: item.owner_user_id || '—',
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
    step: item.node_name || item.node_id || '—',
    type: item.kind || '—',
    status: item.status || '—',
    submittedAt: formatDate(item.created_at),
  }
}

async function loadBusinessData() {
  businessDataLoading.value = true
  businessDataError.value = ''
  const requests = []
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

async function processApproval(action) {
  if (!can('approval.process')) {
    showToast('当前角色无权处理审批。')
    return
  }
  const target = selectedApproval.value
  if (!target) return
  try {
    await commandApproval(target.id, action, { comment: approvalComment.value.trim() })
    selectedApproval.value = null
    approvalComment.value = ''
    await loadBusinessData()
    showToast(action === 'approve' ? '审批已通过' : '审批已驳回')
  } catch (error) {
    showToast(error?.message || '处理审批失败')
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
          <div class="contract-table-card"><div class="contract-table-scroll"><table class="contract-data-table contract-ledger-table"><thead><tr><th>合同编号 / 名称</th><th>合同类型</th><th>服务类型</th><th>合同金额</th><th>负责人 ID</th><th>创建日期</th><th>到期日期</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="contract in filteredContracts" :key="contract.recordId"><td><button class="contract-entity-link" type="button" @click="selectedContract = contract"><strong>{{ contract.name }}</strong><small>{{ contract.id }}</small></button></td><td>{{ contract.type }}</td><td>{{ contract.serviceType }}</td><td class="amount">{{ formatAmount(contract.amount) }}</td><td class="mono">{{ contract.owner }}</td><td>{{ contract.createdAt }}</td><td>{{ contract.endDate }}</td><td><span class="contract-badge" :class="statusTone(contract.status)"><i></i>{{ contract.status }}</span></td><td><button class="contract-text-button" type="button" @click="selectedContract = contract">详情</button></td></tr><tr v-if="!filteredContracts.length"><td colspan="9" class="contract-empty">合同 API 当前未返回可见合同</td></tr></tbody></table></div><footer class="contract-table-footer"><span>共 {{ filteredContracts.length }} 条真实合同记录</span></footer></div>
        </template>

        <template v-else-if="activeSection === 'templates'">
          <div class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>暂无合同模板</h3><p>合同后端尚未提供模板接口。</p></div>
        </template>

        <template v-else-if="activeSection === 'approvals'">
          <div class="contract-tabs"><button class="active" type="button">活动待办 <i>{{ approvals.length }}</i></button><button type="button" @click="loadBusinessData">刷新</button></div>
          <section class="contract-approval-list"><article v-for="approval in approvals" :key="approval.id"><header><span class="contract-badge warning"><i></i>{{ approval.status }}</span><small>{{ approval.id }}</small></header><div><span class="contract-approval-icon"><ConsoleIcon name="audit" /></span><section><div><span class="contract-badge neutral">{{ approval.type }}</span><h3>合同 {{ approval.contractId }}</h3></div><p>任务创建于 {{ approval.submittedAt }}</p></section></div><footer><span><i></i>当前节点：{{ approval.step }}</span><button v-if="can('approval.process')" class="contract-button primary small" type="button" @click="selectedApproval = approval">立即处理</button></footer></article><div v-if="!approvals.length" class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>当前没有活动待办</h3><p>审批任务接口未返回需要您处理的任务。</p></div></section>
        </template>

        <template v-else-if="activeSection === 'rules'">
          <div class="contract-info-banner"><ConsoleIcon name="info" /><span>审批流程按合同类型、金额与组织范围自动匹配。规则变更仅对新发起的流程生效。</span></div>
          <section class="contract-rule-list"><article v-for="rule in rules" :key="rule.id"><header><span class="contract-rule-icon"><ConsoleIcon name="organization" /></span><div><h3>{{ rule.name }}</h3><p>优先级 {{ rule.priority }} · 版本 {{ rule.version }}</p></div><span class="contract-badge" :class="rule.enabled ? 'success' : 'neutral'"><i></i>{{ rule.enabled ? '已启用' : '已停用' }}</span></header><div class="contract-stepper"><template v-for="(node, index) in rule.nodes || []" :key="node.id"><span><b>{{ index + 1 }}</b><small>{{ node.name }} · {{ node.role_code }}</small></span><i v-if="index < rule.nodes.length - 1"></i></template></div></article><div v-if="!rules.length" class="contract-card contract-empty-state"><ConsoleIcon name="organization" /><h3>暂无审批规则</h3><p>审批规则 API 当前未返回数据。</p></div></section>
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
      <article class="contract-detail-modal"><header><div><span class="contract-badge" :class="statusTone(selectedContract.status)"><i></i>{{ selectedContract.status }}</span><h2>{{ selectedContract.name }}</h2><p>{{ selectedContract.id }}</p></div><button type="button" aria-label="关闭" @click="selectedContract = null"><ConsoleIcon name="close" /></button></header><div class="contract-detail-highlight"><div><span>合同金额</span><strong>{{ formatAmount(selectedContract.amount) }}</strong></div><div><span>数据版本</span><strong>{{ selectedContract.version }}</strong></div><div><span>负责人 ID</span><strong>{{ selectedContract.owner }}</strong></div></div><section><h3>基本信息</h3><dl><div><dt>合同类型</dt><dd>{{ selectedContract.type }}</dd></div><div><dt>服务类型</dt><dd>{{ selectedContract.serviceType }}</dd></div><div><dt>创建日期</dt><dd>{{ selectedContract.createdAt }}</dd></div><div><dt>到期日期</dt><dd>{{ selectedContract.endDate }}</dd></div></dl></section><section><h3>合同内容</h3><p class="contract-approval-summary">{{ selectedContract.content || '未填写合同内容' }}</p></section><footer><button class="contract-button secondary" type="button" @click="selectedContract = null">关闭</button></footer></article>
    </div>

    <div v-if="selectedApproval" class="contract-modal-mask" @click.self="selectedApproval = null"><article class="contract-detail-modal contract-approval-modal"><header><div><span class="contract-badge warning"><i></i>{{ selectedApproval.status }}</span><h2>合同 {{ selectedApproval.contractId }}</h2><p>{{ selectedApproval.id }} · {{ selectedApproval.type }}</p></div><button type="button" aria-label="关闭" @click="selectedApproval = null"><ConsoleIcon name="close" /></button></header><div class="contract-detail-highlight"><div><span>审批 ID</span><strong>{{ selectedApproval.id }}</strong></div><div><span>创建时间</span><strong>{{ selectedApproval.submittedAt }}</strong></div><div><span>当前节点</span><strong>{{ selectedApproval.step }}</strong></div></div><section><label v-if="can('approval.process')" class="contract-comment-label">审批意见<textarea v-model="approvalComment" placeholder="请输入审批意见（驳回时必填）"></textarea></label></section><footer><button v-if="can('approval.process')" class="contract-button danger" type="button" @click="processApproval('reject')">驳回</button><button class="contract-button secondary" type="button" @click="selectedApproval = null">稍后处理</button><button v-if="can('approval.process')" class="contract-button primary" type="button" @click="processApproval('approve')"><ConsoleIcon name="save" />同意</button></footer></article></div>

    <div v-if="createDialogOpen" class="contract-modal-mask" @click.self="createDialogOpen = false"><form class="contract-detail-modal contract-create-modal" @submit.prevent="submitNewContract"><header><div><span class="contract-badge info">合同草稿</span><h2>新建合同</h2><p>数据将提交至合同 API</p></div><button type="button" aria-label="关闭" @click="createDialogOpen = false"><ConsoleIcon name="close" /></button></header><section><div class="contract-form-grid"><label><span>合同编号</span><input v-model="newContract.contract_number" required placeholder="请输入合同编号" /></label><label><span>合同名称</span><input v-model="newContract.title" required placeholder="请输入合同名称" /></label><label><span>合同类型</span><input v-model="newContract.contract_type" required placeholder="请输入合同类型" /></label><label><span>服务类型</span><input v-model="newContract.service_type" required placeholder="请输入服务类型" /></label><label><span>合同金额</span><input v-model="newContract.amount" required type="number" min="0" step="0.01" placeholder="0.00" /></label><label><span>币种</span><input v-model="newContract.currency" required /></label><label><span>负责人</span><input :value="currentUserLabel" readonly /></label><label><span>到期日期</span><input v-model="newContract.end_date" type="date" /></label></div><label class="contract-comment-label"><span>合同内容</span><textarea v-model="newContract.content" required placeholder="请输入合同内容"></textarea></label></section><footer><button class="contract-button secondary" type="button" @click="createDialogOpen = false">取消</button><button class="contract-button primary" type="submit"><ConsoleIcon name="save" />保存草稿</button></footer></form></div>

    <Transition name="contract-toast"><div v-if="toast" class="contract-toast"><ConsoleIcon name="save" />{{ toast }}</div></Transition>
  </div>
</template>
