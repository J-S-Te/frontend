<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { getContractSession } from '@/modules/contract_management/api/contract'
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
      { key: 'approvals', label: '审批中心', icon: 'audit', badge: 3 },
      { key: 'rules', label: '审批规则', icon: 'organization' },
      { key: 'signing', label: '签署台账', icon: 'shield' },
    ],
  },
  { label: '数据分析', items: [{ key: 'reports', label: '统计报表', icon: 'dashboard' }] },
]

const contracts = ref([
  { id: 'HT-2026-0078', name: '云平台年度运维服务合同', customer: '上海数智科技有限公司', type: '运维服务', amount: 860000, owner: '李明', signedAt: '2026-07-10', expiresAt: '2027-07-09', status: '审批中', progress: 35 },
  { id: 'HT-2026-0077', name: '数据中心机柜租赁合同', customer: '华东云计算有限公司', type: '资源租赁', amount: 420000, owner: '王芳', signedAt: '2026-07-08', expiresAt: '2027-07-07', status: '待签署', progress: 55 },
  { id: 'HT-2026-0074', name: 'ERP 系统实施与技术服务合同', customer: '恒越制造集团', type: '定制开发', amount: 1260000, owner: '赵强', signedAt: '2026-06-26', expiresAt: '2027-03-31', status: '执行中', progress: 72 },
  { id: 'HT-2026-0069', name: '信息安全咨询服务合同', customer: '国信金融服务有限公司', type: '咨询服务', amount: 380000, owner: '陈晨', signedAt: '2026-06-18', expiresAt: '2026-12-17', status: '已生效', progress: 64 },
  { id: 'HT-2026-0062', name: '统一身份认证平台升级合同', customer: '远航能源股份有限公司', type: '定制开发', amount: 960000, owner: '李明', signedAt: '2026-05-30', expiresAt: '2026-11-29', status: '待付款', progress: 80 },
  { id: 'HT-2026-0051', name: '网络设备采购框架合同', customer: '北辰通信有限公司', type: '采购合同', amount: 680000, owner: '王芳', signedAt: '2026-04-22', expiresAt: '2027-04-21', status: '已完成', progress: 100 },
])

const customers = [
  { code: 'KH-00126', name: '上海数智科技有限公司', industry: '互联网', contact: '周文', level: 'A+', contracts: 8, amount: '¥ 426.0 万', status: '成交' },
  { code: 'KH-00119', name: '恒越制造集团', industry: '智能制造', contact: '林琳', level: 'A', contracts: 5, amount: '¥ 318.6 万', status: '成交' },
  { code: 'KH-00108', name: '国信金融服务有限公司', industry: '金融', contact: '吴迪', level: 'A', contracts: 4, amount: '¥ 274.2 万', status: '在跟' },
  { code: 'KH-00096', name: '远航能源股份有限公司', industry: '能源', contact: '钱峰', level: 'B+', contracts: 6, amount: '¥ 206.8 万', status: '成交' },
  { code: 'KH-00081', name: '北辰通信有限公司', industry: '通信', contact: '宋佳', level: 'B', contracts: 3, amount: '¥ 128.0 万', status: '在跟' },
]

const approvals = ref([
  { id: 'AP-2026-0318', title: '云平台年度运维服务合同', applicant: '李明', department: '华东大区', amount: '¥ 86.0 万', step: '技术总监审批', submittedAt: '今天 09:24', urgency: '剩余 18 小时', type: '合同新建' },
  { id: 'AP-2026-0317', title: '数据中心机柜租赁合同', applicant: '王芳', department: '大客户部', amount: '¥ 42.0 万', step: '销售总监审批', submittedAt: '昨天 16:40', urgency: '剩余 31 小时', type: '合同新建' },
  { id: 'AP-2026-0312', title: 'ERP 系统实施与技术服务合同', applicant: '赵强', department: '交付中心', amount: '¥ 126.0 万', step: '财务总监审批', submittedAt: '07-19 14:16', urgency: '剩余 46 小时', type: '状态变更' },
])

const templates = [
  { id: 'TPL-001', name: '标准技术服务合同', type: '服务合同', version: 'V3.2', updatedAt: '2026-07-18', scope: '技术服务 / 运维', used: 48, color: 'blue' },
  { id: 'TPL-002', name: '软件定制开发合同', type: '开发合同', version: 'V2.6', updatedAt: '2026-07-09', scope: '软件开发 / 实施', used: 32, color: 'purple' },
  { id: 'TPL-003', name: '设备采购框架合同', type: '采购合同', version: 'V1.8', updatedAt: '2026-06-28', scope: '设备 / 软硬件采购', used: 21, color: 'green' },
  { id: 'TPL-004', name: '咨询服务合同', type: '咨询合同', version: 'V2.1', updatedAt: '2026-06-15', scope: '咨询 / 评估服务', used: 16, color: 'orange' },
]

const rules = [
  { name: '标准合同审批流', condition: '合同金额 ≤ 50 万', usage: '服务合同、采购合同', nodes: ['部门负责人', '销售总监'], enabled: true },
  { name: '大额合同审批流', condition: '合同金额 50–100 万', usage: '全部合同类型', nodes: ['部门负责人', '销售总监', '财务总监'], enabled: true },
  { name: '重大合同审批流', condition: '合同金额 > 100 万', usage: '全部合同类型', nodes: ['部门负责人', '技术总监', '财务总监', '总经理'], enabled: true },
]

const signingRecords = [
  { id: 'HT-2026-0077', name: '数据中心机柜租赁合同', party: '华东云计算有限公司', method: '电子签', owner: '王芳', due: '2026-07-25', status: '待对方签署' },
  { id: 'HT-2026-0071', name: '应用监控平台采购合同', party: '灵犀软件有限公司', method: '纸质签', owner: '陈晨', due: '2026-07-24', status: '待我方盖章' },
  { id: 'HT-2026-0069', name: '信息安全咨询服务合同', party: '国信金融服务有限公司', method: '电子签', owner: '陈晨', due: '2026-06-20', status: '已签署' },
  { id: 'HT-2026-0062', name: '统一身份认证平台升级合同', party: '远航能源股份有限公司', method: '纸质签', owner: '李明', due: '2026-06-03', status: '已归档' },
]


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
    const hitKeyword = !query || [contract.id, contract.name, contract.customer, contract.owner].join(' ').toLowerCase().includes(query)
    return hitKeyword && (!statusFilter.value || contract.status === statusFilter.value) && (!typeFilter.value || contract.type === typeFilter.value)
  })
})

const filteredCustomers = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return customers.filter((customer) => !query || [customer.code, customer.name, customer.industry, customer.contact].join(' ').toLowerCase().includes(query))
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

function exportContracts() {
  const rows = filteredContracts.value.map((item) => [item.id, item.name, item.customer, item.type, item.amount, item.owner, item.status])
  const csv = [['合同编号', '合同名称', '客户', '类型', '金额', '负责人', '状态'], ...rows]
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

function submitNewContract() {
  createDialogOpen.value = false
  showToast('合同草稿已创建，可前往合同台账继续完善')
}

function processApproval(result) {
  if (!can('approval.process')) {
    showToast('当前角色无权处理审批。')
    return
  }
  const target = selectedApproval.value
  if (!target) return
  approvals.value = approvals.value.filter((item) => item.id !== target.id)
  selectedApproval.value = null
  showToast(`审批已${result}，流程记录已更新`)
}

function statusTone(status) {
  if (['已生效', '已完成', '已签署', '已归档', '成交'].includes(status)) return 'success'
  if (['审批中', '执行中', '在跟'].includes(status)) return 'info'
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
        <label class="contract-global-search"><ConsoleIcon name="search" /><input v-model="keyword" type="search" placeholder="搜索合同 / 客户…" /></label>
        <div class="contract-topbar-actions">
          <button class="contract-icon-button" type="button" aria-label="通知" @click="notificationOpen = !notificationOpen"><ConsoleIcon name="bell" /><i></i></button>
          <span class="contract-topbar-avatar">{{ currentUserInitial }}</span>
        </div>
        <div v-if="notificationOpen" class="contract-notification-panel">
          <header><strong>通知中心</strong><span>3 条未读</span></header>
          <button v-if="can('approval.process')" type="button" @click="navigate('approvals')"><i class="warning"></i><span><strong>您有 {{ approvals.length }} 项合同审批待处理</strong><small>请按审批时限及时处理</small></span></button>
          <button type="button" @click="navigate('signing')"><i class="info"></i><span><strong>2 份合同等待签署</strong><small>请及时跟进双方签章进度</small></span></button>
        </div>
      </header>

      <section class="contract-content">
        <p v-if="sessionError" class="contract-session-error" role="alert">{{ sessionError }}</p>
        <header class="contract-page-head">
          <div><h1>{{ pageMeta.title }}</h1><p>{{ pageMeta.description }}</p></div>
          <div class="contract-page-actions">
            <button v-if="['contracts', 'reports'].includes(activeSection)" class="contract-button secondary" type="button" @click="exportContracts"><ConsoleIcon name="export" />导出</button>
            <button v-if="['dashboard', 'contracts'].includes(activeSection) && can('contract.create')" class="contract-button primary" type="button" @click="createDialogOpen = true">＋ 新建合同</button>
            <button v-if="activeSection === 'templates' && can('contract_template.manage')" class="contract-button primary" type="button" @click="showToast('已创建空白模板草稿')">＋ 新建模板</button>
          </div>
        </header>

        <template v-if="activeSection === 'dashboard'">
          <section class="contract-welcome"><div><span>统一身份认证已生效</span><h2>您好，{{ currentUserLabel }}</h2><p>当前角色：<b>{{ currentRoleLabel }}</b>。页面菜单与操作按钮已按服务端会话权限生成。</p></div><button v-if="can('approval.process')" type="button" @click="navigate('approvals')">查看我的待办 <ConsoleIcon name="chevron" /></button></section>
          <section class="contract-stat-grid">
            <article class="blue"><span class="contract-stat-icon"><ConsoleIcon name="account" /></span><p>合同总额</p><strong>¥ 3,842<small>万</small></strong><em class="up">↑ 8.4% 较上月</em></article>
            <article class="purple"><span class="contract-stat-icon"><ConsoleIcon name="save" /></span><p>生效合同</p><strong>128<small>份</small></strong><em class="up">↑ 12 份 本月</em></article>
            <article v-if="can('approval.process')" class="orange"><span class="contract-stat-icon"><ConsoleIcon name="audit" /></span><p>待我审批</p><strong>{{ approvals.length }}<small>项</small></strong><em>最早剩余 18 小时</em></article>
            <article class="green"><span class="contract-stat-icon"><ConsoleIcon name="shield" /></span><p>本月回款</p><strong>¥ 286<small>万</small></strong><em class="up">达成率 76%</em></article>
          </section>
          <section class="contract-dashboard-grid">
            <article class="contract-card contract-trend-card">
              <header><div><h3>合同金额趋势</h3><p>近 7 个月签约金额（万元）</p></div><span>2026 年</span></header>
              <div class="contract-chart-y"><span>600</span><span>400</span><span>200</span><span>0</span></div>
              <div class="contract-line-chart"><i></i><svg viewBox="0 0 700 240" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2563eb" stop-opacity=".24"/><stop offset="1" stop-color="#2563eb" stop-opacity="0"/></linearGradient></defs><path class="area" d="M12 170 L125 194 L238 120 L350 140 L462 84 L575 104 L688 48 L688 226 L12 226 Z"/><path class="line" d="M12 170 L125 194 L238 120 L350 140 L462 84 L575 104 L688 48"/><g><circle cx="12" cy="170" r="4"/><circle cx="125" cy="194" r="4"/><circle cx="238" cy="120" r="4"/><circle cx="350" cy="140" r="4"/><circle cx="462" cy="84" r="4"/><circle cx="575" cy="104" r="4"/><circle cx="688" cy="48" r="4"/></g></svg><div class="contract-chart-x"><span>1月</span><span>2月</span><span>3月</span><span>4月</span><span>5月</span><span>6月</span><span>7月</span></div></div>
            </article>
            <article class="contract-card contract-type-card"><header><div><h3>合同类型分布</h3><p>按当前有效合同统计</p></div></header><div class="contract-donut"><div><strong>128</strong><span>合同总数</span></div></div><ul><li><i class="blue"></i><span>标准服务</span><b>38%</b></li><li><i class="purple"></i><span>定制开发</span><b>25%</b></li><li><i class="green"></i><span>咨询服务</span><b>19%</b></li><li><i class="orange"></i><span>其他类型</span><b>18%</b></li></ul></article>
            <article v-if="can('approval.process')" class="contract-card contract-todo-card"><header><div><h3>我的待办</h3><p>需要您关注的合同事项</p></div><button type="button" @click="navigate('approvals')">查看全部</button></header><button v-for="item in approvals" :key="item.id" type="button" @click="selectedApproval = item"><span class="contract-todo-icon"><ConsoleIcon name="audit" /></span><span><strong>{{ item.title }}</strong><small>{{ item.applicant }} · {{ item.amount }} · {{ item.step }}</small></span><em>{{ item.urgency }}</em><ConsoleIcon name="chevron" /></button></article>
            <article class="contract-card contract-risk-card"><header><div><h3>关键提醒</h3><p>未来 30 天内需关注</p></div></header><div><span class="danger">7</span><p><strong>即将到期</strong><small>3 份合同需本周确认续签</small></p></div><div><span class="warning">5</span><p><strong>待回款节点</strong><small>应收金额共计 ¥ 192 万</small></p></div><div><span class="info">2</span><p><strong>签署逾期</strong><small>请联系对方经办人确认</small></p></div></article>
          </section>
        </template>

        <template v-else-if="activeSection === 'customers'">
          <div class="contract-filter-bar"><label class="contract-search-field"><ConsoleIcon name="search" /><input v-model="keyword" type="search" placeholder="客户名称 / 编号 / 联系人" /></label><label><select><option>全部行业</option><option>互联网</option><option>金融</option><option>智能制造</option></select></label><label><select><option>全部等级</option><option>A+</option><option>A</option><option>B+</option></select></label><button class="contract-button primary small" type="button" @click="showToast(`查询到 ${filteredCustomers.length} 家客户`)">查询</button><button class="contract-button ghost small" type="button" @click="resetFilters"><ConsoleIcon name="reset" />重置</button></div>
          <div class="contract-table-card"><div class="contract-table-scroll"><table class="contract-data-table"><thead><tr><th>客户编号</th><th>客户名称</th><th>所属行业</th><th>联系人</th><th>信用等级</th><th>关联合同</th><th>累计金额</th><th>合作状态</th><th>操作</th></tr></thead><tbody><tr v-for="customer in filteredCustomers" :key="customer.code"><td class="mono">{{ customer.code }}</td><td><strong>{{ customer.name }}</strong></td><td>{{ customer.industry }}</td><td>{{ customer.contact }}</td><td><span class="contract-badge success">{{ customer.level }}</span></td><td>{{ customer.contracts }} 份</td><td class="amount">{{ customer.amount }}</td><td><span class="contract-badge" :class="statusTone(customer.status)">{{ customer.status }}</span></td><td><button class="contract-text-button" type="button" @click="showToast('客户信息来自主数据系统，仅供查询')">详情</button></td></tr></tbody></table></div><footer class="contract-table-footer"><span>共 {{ filteredCustomers.length }} 条客户记录</span><div><button disabled>‹</button><button class="active">1</button><button>2</button><button>›</button></div></footer></div>
        </template>

        <template v-else-if="activeSection === 'contracts'">
          <div class="contract-filter-bar"><label class="contract-search-field"><ConsoleIcon name="search" /><input v-model="keyword" type="search" placeholder="合同编号 / 名称 / 客户" /></label><label><select v-model="typeFilter"><option value="">全部类型</option><option>运维服务</option><option>定制开发</option><option>咨询服务</option><option>采购合同</option></select></label><label><select v-model="statusFilter"><option value="">全部状态</option><option>审批中</option><option>待签署</option><option>执行中</option><option>已生效</option><option>待付款</option><option>已完成</option></select></label><button class="contract-button primary small" type="button" @click="showToast(`查询到 ${filteredContracts.length} 份合同`)">查询</button><button class="contract-button ghost small" type="button" @click="resetFilters"><ConsoleIcon name="reset" />重置</button></div>
          <div class="contract-table-card"><div class="contract-table-scroll"><table class="contract-data-table contract-ledger-table"><thead><tr><th>合同编号 / 名称</th><th>客户</th><th>类型</th><th>合同金额</th><th>负责人</th><th>签订日期</th><th>履约进度</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="contract in filteredContracts" :key="contract.id"><td><button class="contract-entity-link" type="button" @click="selectedContract = contract"><strong>{{ contract.name }}</strong><small>{{ contract.id }}</small></button></td><td>{{ contract.customer }}</td><td>{{ contract.type }}</td><td class="amount">{{ formatAmount(contract.amount) }}</td><td>{{ contract.owner }}</td><td>{{ contract.signedAt }}</td><td><div class="contract-progress"><i><b :style="{ width: `${contract.progress}%` }"></b></i><span>{{ contract.progress }}%</span></div></td><td><span class="contract-badge" :class="statusTone(contract.status)"><i></i>{{ contract.status }}</span></td><td><button class="contract-text-button" type="button" @click="selectedContract = contract">详情</button></td></tr><tr v-if="!filteredContracts.length"><td colspan="9" class="contract-empty">未找到符合条件的合同</td></tr></tbody></table></div><footer class="contract-table-footer"><span>共 {{ filteredContracts.length }} 条，当前显示第 1 页</span><div><button disabled>‹</button><button class="active">1</button><button>2</button><button>3</button><button>›</button></div></footer></div>
        </template>

        <template v-else-if="activeSection === 'templates'">
          <div class="contract-filter-bar"><label class="contract-search-field"><ConsoleIcon name="search" /><input v-model="keyword" type="search" placeholder="搜索模板名称 / 适用范围" /></label><label><select><option>全部合同类型</option><option>服务合同</option><option>开发合同</option><option>采购合同</option></select></label><button class="contract-button primary small" type="button" @click="showToast('模板筛选已应用')">查询</button><button class="contract-button ghost small" type="button" @click="resetFilters"><ConsoleIcon name="reset" />重置</button></div>
          <section class="contract-template-grid"><article v-for="template in templates" :key="template.id"><div class="contract-template-cover" :class="template.color"><span><ConsoleIcon name="save" /></span><i>{{ template.version }}</i></div><div class="contract-template-copy"><span class="contract-badge neutral">{{ template.type }}</span><h3>{{ template.name }}</h3><p>{{ template.scope }}</p><div><span>使用 {{ template.used }} 次</span><span>更新于 {{ template.updatedAt }}</span></div></div><footer><button type="button" @click="showToast(`正在预览「${template.name}」`)">预览</button><button type="button" @click="showToast('已从模板创建合同草稿')">使用模板</button></footer></article></section>
        </template>

        <template v-else-if="activeSection === 'approvals'">
          <div class="contract-tabs"><button class="active" type="button">待我审批 <i>{{ approvals.length }}</i></button><button type="button" @click="showToast('已切换至我已处理的审批')">我已处理</button><button type="button" @click="showToast('已切换至我发起的审批')">我发起的</button></div>
          <section class="contract-approval-list"><article v-for="approval in approvals" :key="approval.id"><header><span class="contract-badge warning"><i></i>待审批</span><small>{{ approval.id }}</small><em>{{ approval.urgency }}</em></header><div><span class="contract-approval-icon"><ConsoleIcon name="audit" /></span><section><div><span class="contract-badge neutral">{{ approval.type }}</span><h3>{{ approval.title }}</h3></div><p>申请人 {{ approval.applicant }} · {{ approval.department }} · 提交于 {{ approval.submittedAt }}</p></section><strong>{{ approval.amount }}</strong></div><footer><span><i></i>当前节点：{{ approval.step }}</span><button class="contract-button secondary small" type="button" @click="selectedApproval = approval">查看详情</button><button v-if="can('approval.process')" class="contract-button primary small" type="button" @click="selectedApproval = approval">立即处理</button></footer></article><div v-if="!approvals.length" class="contract-card contract-empty-state"><ConsoleIcon name="save" /><h3>待办已全部处理</h3><p>当前没有需要您处理的合同审批。</p></div></section>
        </template>

        <template v-else-if="activeSection === 'rules'">
          <div class="contract-info-banner"><ConsoleIcon name="info" /><span>审批流程按合同类型、金额与组织范围自动匹配。规则变更仅对新发起的流程生效。</span></div>
          <section class="contract-rule-list"><article v-for="rule in rules" :key="rule.name"><header><span class="contract-rule-icon"><ConsoleIcon name="organization" /></span><div><h3>{{ rule.name }}</h3><p>{{ rule.condition }} · {{ rule.usage }}</p></div><span class="contract-badge success"><i></i>已启用</span><button v-if="can('all')" class="contract-button secondary small" type="button" @click="showToast('审批规则编辑器将在后续版本接入')">编辑规则</button></header><div class="contract-stepper"><template v-for="(node, index) in rule.nodes" :key="node"><span><b>{{ index + 1 }}</b><small>{{ node }}</small></span><i v-if="index < rule.nodes.length - 1"></i></template></div></article></section>
        </template>

        <template v-else-if="activeSection === 'signing'">
          <section class="contract-sign-stats"><article><span class="warning"><ConsoleIcon name="audit" /></span><div><p>待签署</p><strong>2 份</strong></div></article><article><span class="info"><ConsoleIcon name="save" /></span><div><p>待归档</p><strong>1 份</strong></div></article><article><span class="success"><ConsoleIcon name="shield" /></span><div><p>本月已签</p><strong>18 份</strong></div></article></section>
          <div class="contract-filter-bar"><label class="contract-search-field"><ConsoleIcon name="search" /><input v-model="keyword" type="search" placeholder="合同编号 / 名称 / 签约方" /></label><label><select><option>全部签署方式</option><option>电子签</option><option>纸质签</option></select></label><label><select><option>全部状态</option><option>待对方签署</option><option>待我方盖章</option><option>已签署</option><option>已归档</option></select></label><button class="contract-button primary small" type="button" @click="showToast('签署台账筛选已应用')">查询</button></div>
          <div class="contract-table-card"><div class="contract-table-scroll"><table class="contract-data-table"><thead><tr><th>合同编号 / 名称</th><th>签约方</th><th>签署方式</th><th>负责人</th><th>计划完成日期</th><th>签署状态</th><th>操作</th></tr></thead><tbody><tr v-for="record in signingRecords" :key="record.id"><td><strong>{{ record.name }}</strong><small class="block mono">{{ record.id }}</small></td><td>{{ record.party }}</td><td>{{ record.method }}</td><td>{{ record.owner }}</td><td>{{ record.due }}</td><td><span class="contract-badge" :class="statusTone(record.status)"><i></i>{{ record.status }}</span></td><td><button class="contract-text-button" type="button" @click="showToast('签署记录详情已打开')">详情</button><button class="contract-text-button" type="button" @click="showToast('已发送签署提醒')">提醒</button></td></tr></tbody></table></div></div>
        </template>

        <template v-else-if="activeSection === 'reports'">
          <section class="contract-report-summary"><article><p>本年签约金额</p><strong>¥ 2,710.4 万</strong><span class="up">同比 +18.6%</span></article><article><p>本年签约合同</p><strong>76 份</strong><span class="up">同比 +12.3%</span></article><article><p>平均合同金额</p><strong>¥ 35.7 万</strong><span>同比 +2.1%</span></article><article><p>按期履约率</p><strong>94.8%</strong><span class="up">同比 +1.6%</span></article></section>
          <section class="contract-report-grid"><article class="contract-card"><header><div><h3>月度签约金额</h3><p>2026 年 1–7 月，单位：万元</p></div><span class="contract-badge info">本年度</span></header><div class="contract-bar-chart"><div v-for="(value, index) in [340,180,420,380,460,410,520]" :key="value"><span :style="{ height: `${value / 5.8}px` }"><i>{{ value }}</i></span><small>{{ index + 1 }}月</small></div></div></article><article class="contract-card"><header><div><h3>客户行业分布</h3><p>按生效合同金额统计</p></div></header><div class="contract-rank-list"><div v-for="(item, index) in [['金融',86],['互联网',72],['能源',58],['智能制造',44],['通信',31]]" :key="item[0]"><span>{{ index + 1 }}</span><strong>{{ item[0] }}</strong><i><b :style="{ width: `${item[1]}%` }"></b></i><em>{{ item[1] }}%</em></div></div></article><article class="contract-card contract-report-wide"><header><div><h3>区域签约表现</h3><p>年度累计签约金额与目标完成率</p></div></header><div class="contract-region-grid"><div v-for="region in [{name:'华东大区',amount:'1,280',rate:91},{name:'华北大区',amount:'980',rate:84},{name:'华南大区',amount:'860',rate:78},{name:'西南大区',amount:'620',rate:72}]" :key="region.name"><span>{{ region.name }}</span><strong>¥ {{ region.amount }} 万</strong><i><b :style="{ width: `${region.rate}%` }"></b></i><small>目标完成 {{ region.rate }}%</small></div></div></article></section>
        </template>
      </section>
    </main>

    <div v-if="selectedContract" class="contract-modal-mask" @click.self="selectedContract = null">
      <article class="contract-detail-modal"><header><div><span class="contract-badge" :class="statusTone(selectedContract.status)"><i></i>{{ selectedContract.status }}</span><h2>{{ selectedContract.name }}</h2><p>{{ selectedContract.id }}</p></div><button type="button" aria-label="关闭" @click="selectedContract = null"><ConsoleIcon name="close" /></button></header><div class="contract-detail-highlight"><div><span>合同金额</span><strong>{{ formatAmount(selectedContract.amount) }}</strong></div><div><span>履约进度</span><strong>{{ selectedContract.progress }}%</strong></div><div><span>负责人</span><strong>{{ selectedContract.owner }}</strong></div></div><section><h3>基本信息</h3><dl><div><dt>客户名称</dt><dd>{{ selectedContract.customer }}</dd></div><div><dt>合同类型</dt><dd>{{ selectedContract.type }}</dd></div><div><dt>签订日期</dt><dd>{{ selectedContract.signedAt }}</dd></div><div><dt>到期日期</dt><dd>{{ selectedContract.expiresAt }}</dd></div></dl></section><section><h3>履约节点</h3><div class="contract-detail-timeline"><div class="done"><i>✓</i><span><strong>合同创建</strong><small>{{ selectedContract.signedAt }} · {{ selectedContract.owner }}</small></span></div><div class="done"><i>✓</i><span><strong>合同审批</strong><small>审批记录与意见已归档</small></span></div><div class="active"><i>3</i><span><strong>履约执行</strong><small>当前进度 {{ selectedContract.progress }}%</small></span></div><div><i>4</i><span><strong>完成归档</strong><small>等待履约完成</small></span></div></div></section><footer><button class="contract-button secondary" type="button" @click="selectedContract = null">关闭</button><button v-if="can('contract.edit')" class="contract-button primary" type="button" @click="showToast('已进入合同编辑模式')">编辑合同</button></footer></article>
    </div>

    <div v-if="selectedApproval" class="contract-modal-mask" @click.self="selectedApproval = null"><article class="contract-detail-modal contract-approval-modal"><header><div><span class="contract-badge warning"><i></i>待审批</span><h2>{{ selectedApproval.title }}</h2><p>{{ selectedApproval.id }} · {{ selectedApproval.type }}</p></div><button type="button" aria-label="关闭" @click="selectedApproval = null"><ConsoleIcon name="close" /></button></header><div class="contract-detail-highlight"><div><span>合同金额</span><strong>{{ selectedApproval.amount }}</strong></div><div><span>申请人</span><strong>{{ selectedApproval.applicant }}</strong></div><div><span>当前节点</span><strong>{{ selectedApproval.step }}</strong></div></div><section><h3>审批摘要</h3><p class="contract-approval-summary">申请人已完成合同基础信息、服务范围、付款计划及附件提交。系统规则校验通过，当前无高风险条款命中。</p><label v-if="can('approval.process')" class="contract-comment-label">审批意见<textarea placeholder="请输入审批意见（驳回时必填）"></textarea></label></section><footer><button v-if="can('approval.process')" class="contract-button danger" type="button" @click="processApproval('驳回')">驳回</button><button class="contract-button secondary" type="button" @click="selectedApproval = null">稍后处理</button><button v-if="can('approval.process')" class="contract-button primary" type="button" @click="processApproval('通过')"><ConsoleIcon name="save" />同意</button></footer></article></div>

    <div v-if="createDialogOpen" class="contract-modal-mask" @click.self="createDialogOpen = false"><form class="contract-detail-modal contract-create-modal" @submit.prevent="submitNewContract"><header><div><span class="contract-badge info">合同草稿</span><h2>新建合同</h2><p>填写基础信息后保存为草稿</p></div><button type="button" aria-label="关闭" @click="createDialogOpen = false"><ConsoleIcon name="close" /></button></header><section><div class="contract-form-grid"><label><span>合同名称</span><input required placeholder="请输入合同名称" /></label><label><span>合同类型</span><select required><option value="">请选择合同类型</option><option>技术服务</option><option>定制开发</option><option>采购合同</option></select></label><label><span>客户名称</span><input required placeholder="请输入或选择客户" /></label><label><span>合同金额</span><input required type="number" min="0" placeholder="0.00" /></label><label><span>负责人</span><input :value="currentUserLabel" readonly /></label><label><span>计划签订日期</span><input type="date" value="2026-07-22" /></label></div></section><footer><button class="contract-button secondary" type="button" @click="createDialogOpen = false">取消</button><button class="contract-button primary" type="submit"><ConsoleIcon name="save" />保存草稿</button></footer></form></div>

    <Transition name="contract-toast"><div v-if="toast" class="contract-toast"><ConsoleIcon name="save" />{{ toast }}</div></Transition>
  </div>
</template>
