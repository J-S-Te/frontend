<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import '@/modules/project_management/styles/project-management.css'

const route = useRoute()
const router = useRouter()

const navGroups = [
  { label: '执行总览', items: [
    { key: 'dashboard', label: '项目执行总览', icon: 'dashboard' },
    { key: 'monitoring', label: '在途项目实时监控', icon: 'audit', badge: 28 },
  ] },
  { label: '项目管理', items: [
    { key: 'projects', label: '项目列表', icon: 'account' },
    { key: 'decomposition', label: '服务项拆解确认', icon: 'organization', badge: 7 },
  ] },
  { label: '资源分配', items: [
    { key: 'allocation', label: '任务分配', icon: 'user' },
    { key: 'inbox', label: '我的分配待办', icon: 'bell', badge: 3 },
    { key: 'planning', label: '实施计划', icon: 'audit' },
    { key: 'preparation', label: '实施准备', icon: 'save' },
    { key: 'qualifications', label: '资质与能力', icon: 'shield' },
    { key: 'assignments', label: '人员设备指派', icon: 'organization' },
    { key: 'methods', label: '特殊方法复核', icon: 'info', badge: 2 },
  ] },
  { label: '现场实施', items: [
    { key: 'implementation', label: '实施看板', icon: 'dashboard' },
    { key: 'exceptions', label: '异常评审', icon: 'audit', badge: 1 },
    { key: 'standards', label: '标准方法更新评估', icon: 'reset' },
    { key: 'reports', label: '报告编制状态', icon: 'account' },
  ] },
  { label: '系统配置', items: [
    { key: 'split-rules', label: '拆解规则', icon: 'settings' },
    { key: 'warning-rules', label: '冲突预警规则', icon: 'shield' },
    { key: 'automations', label: '自动化触发', icon: 'reset' },
    { key: 'permissions', label: '字段级权限', icon: 'role' },
  ] },
]

const pageMeta = {
  dashboard: ['项目执行总览', '全集团项目交付、资源与风险态势'],
  monitoring: ['在途项目 · 实时监控', '28 个在途项目的里程碑、健康度与资源状态'],
  projects: ['项目列表', '统一管理项目、合同来源、服务项及交付状态'],
  decomposition: ['服务项拆解确认', '核对合同范围与自动拆解结果，确认后进入任务分配'],
  allocation: ['任务分配', '按团队负载与专业能力完成服务项下达'],
  inbox: ['分配待办收件箱', '处理指派给我的项目与服务项'],
  planning: ['现场实施计划制定', '编排现场窗口、里程碑及交付节奏'],
  preparation: ['实施准备', '集中核验授权、资料、工具与出行准备'],
  qualifications: ['资质与能力管理', '维护人员资质、能力标签和有效期'],
  assignments: ['匹配校验与冲突预警', '校验人员、设备、资质与计划冲突'],
  methods: ['特殊方法复核待办', '复核非标准方法的适用性与风险控制'],
  implementation: ['实施看板 · 进度总览', '按状态跟踪服务项现场执行与闭环进度'],
  exceptions: ['异常评审 · 偏离上报', '处理现场偏离、阻塞与整改回路'],
  standards: ['检测标准方法更新 · 影响评估', '识别标准变更对在途项目的影响'],
  reports: ['报告编制状态维护', '衔接实施完成、报告编制、复核与签发'],
  'split-rules': ['合同拆解规则配置', '配置合同服务清单到项目服务项的转换规则'],
  'warning-rules': ['冲突预警规则配置', '配置资源、资质、地域与排期冲突策略'],
  automations: ['自动化触发配置', '维护项目状态变化后的自动任务与通知'],
  permissions: ['字段级权限配置', '按角色控制敏感字段的查看与编辑范围'],
}

const activeSection = computed(() => pageMeta[route.params.section] ? route.params.section : 'dashboard')
const currentMeta = computed(() => pageMeta[activeSection.value])
const mobileMenuOpen = ref(false)
const keyword = ref('')
const statusFilter = ref('')
const selectedRows = ref([])
const drawerProject = ref(null)
const createOpen = ref(false)
const notificationOpen = ref(false)
const toastMessage = ref('')
let toastTimer = 0

const projects = ref([
  { id: 'PJ-2026-0826', customer: '某省政务云', contract: 'HT-2026-0411', services: 22, category: '等保测评 / 商用密码', team: '测评一组', manager: '张磊', health: '正常', status: '待分配', progress: 36, due: '2026-08-15' },
  { id: 'PJ-2026-0823', customer: '某银行股份', contract: 'HT-2026-0408', services: 14, category: '等保测评', team: '测评一组', manager: '张磊', health: '正常', status: '实施中', progress: 68, due: '2026-07-22' },
  { id: 'PJ-2026-0817', customer: '某证券交易所', contract: 'HT-2026-0402', services: 9, category: '等保测评 / 渗透测试', team: '测评二组', manager: '李娜', health: '风险', status: '异常处理中', progress: 55, due: '超期 3 天' },
  { id: 'PJ-2026-0825', customer: '某三甲医院', contract: 'HT-2026-0410', services: 7, category: '渗透测试 / 应急响应', team: '渗透测试组', manager: '王明', health: '关注', status: '报告编制', progress: 82, due: '2026-07-25' },
  { id: 'PJ-2026-0831', customer: '某航空公司', contract: 'HT-2026-0414', services: 12, category: '源代码审计 / 软件测试', team: '测评二组', manager: '李娜', health: '正常', status: '待实施', progress: 24, due: '2026-08-30' },
  { id: 'PJ-2026-0833', customer: '某市公积金', contract: 'HT-2026-0415', services: 8, category: '等保测评', team: '未分配', manager: '—', health: '待确认', status: '待拆解确认', progress: 8, due: '—' },
])

const filteredProjects = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return projects.value.filter((project) => {
    const matchKeyword = !query || [project.id, project.customer, project.contract, project.category, project.manager].join(' ').toLowerCase().includes(query)
    return matchKeyword && (!statusFilter.value || project.status === statusFilter.value)
  })
})

const riskRows = [
  { level: '高', project: 'PJ-2026-0817 · 某证券交易所', issue: '现场授权范围发生变更，1 项服务终止', owner: '李娜', deadline: '今日 16:00' },
  { level: '中', project: 'PJ-2026-0825 · 某三甲医院', issue: '整改证据尚未回传，影响报告复核', owner: '王明', deadline: '明日 12:00' },
  { level: '中', project: 'PJ-2026-0823 · 某银行股份', issue: '特殊方法复核待处理', owner: '张磊', deadline: '07-19' },
]

const serviceItems = ref([
  { id: 'SI-0833-01', batch: '第一批次', site: '总部数据中心', category: '等保测评（三级）', requirement: '核心业务系统 8 套', system: 'ISO 27001', special: '否', status: '待确认', selected: true },
  { id: 'SI-0833-02', batch: '第一批次', site: '总部数据中心', category: '商用密码应用安全性评估', requirement: '密码应用方案与密评', system: '—', special: '否', status: '待确认', selected: true },
  { id: 'SI-0833-03', batch: '第一批次', site: '灾备中心', category: '渗透测试', requirement: '互联网暴露面黑盒测试', system: 'ISO 27001', special: '是', status: '待复核', selected: true },
  { id: 'SI-0833-04', batch: '第二批次', site: '办公区', category: '等保测评（二级）', requirement: '办公内网与终端安全', system: '—', special: '否', status: '待确认', selected: true },
])

const kanbanColumns = computed(() => [
  { key: '待分配', count: 26, color: 'slate', cards: projects.value.filter((p) => ['待分配', '待拆解确认'].includes(p.status)) },
  { key: '待实施', count: 64, color: 'violet', cards: projects.value.filter((p) => p.status === '待实施') },
  { key: '实施中', count: 42, color: 'amber', cards: projects.value.filter((p) => ['实施中', '异常处理中'].includes(p.status)) },
  { key: '报告编制', count: 31, color: 'blue', cards: projects.value.filter((p) => p.status === '报告编制') },
  { key: '已完成', count: 223, color: 'green', cards: [{ id: 'PJ-2026-0809', customer: '某保险公司', progress: 100, due: '07-10' }] },
])

const operationRows = computed(() => ({
  monitoring: projects.value.slice(0, 5).map((p) => ({ name: `${p.id} · ${p.customer}`, detail: p.category, owner: p.manager, state: p.health, progress: p.progress, due: p.due })),
  allocation: serviceItems.value.map((s, i) => ({ name: `${s.id} · ${s.category}`, detail: s.site, owner: i === 2 ? '渗透测试组' : '测评一组', state: i === 2 ? '能力待校验' : '可下达', progress: i === 2 ? 45 : 80, due: '2 工作日内' })),
  inbox: projects.value.slice(0, 3).map((p, i) => ({ name: `${p.id} · ${p.customer}`, detail: i ? '实施工程师指派' : '项目经理指派', owner: '王晓飞', state: i === 2 ? '即将超时' : '待接受', progress: 0, due: i === 2 ? '剩余 2 小时' : '今日' })),
  planning: projects.value.slice(0, 5).map((p) => ({ name: `${p.id} · ${p.customer}`, detail: `${p.services} 个服务项`, owner: p.manager, state: p.progress > 50 ? '计划已发布' : '待排期', progress: p.progress, due: p.due })),
  preparation: serviceItems.value.map((s, i) => ({ name: `${s.id} · ${s.site}`, detail: ['客户授权书', '检测工具', '出行申请', '资料清单'][i], owner: ['王明', '陈静', '李娜', '张磊'][i], state: i === 1 ? '缺失 1 项' : '已就绪', progress: i === 1 ? 75 : 100, due: '07-20' })),
  qualifications: ['张磊', '李娜', '王明', '陈静'].map((name, i) => ({ name, detail: ['等保测评高级 / 项目经理', '商用密码评估 / 等保测评', '渗透测试 / 应急响应', '软件测试 / 源代码审计'][i], owner: '测评技术部', state: i === 2 ? '60 天后到期' : '有效', progress: i === 2 ? 60 : 92, due: ['2027-04-30', '2027-01-18', '2026-09-20', '2027-06-12'][i] })),
  assignments: projects.value.slice(0, 4).map((p, i) => ({ name: `${p.id} · ${p.customer}`, detail: `${p.team} / ${p.services} 项`, owner: p.manager, state: i === 2 ? '排期冲突' : '校验通过', progress: i === 2 ? 50 : 100, due: p.due })),
  methods: serviceItems.value.filter((s) => s.special === '是').concat(serviceItems.value.slice(0, 2)).map((s, i) => ({ name: `${s.id} · ${s.category}`, detail: i ? '取证抽样比例调整' : '黑盒测试方法', owner: ['赵毅', '孙工', '周工'][i], state: i === 0 ? '待复核' : '已通过', progress: i === 0 ? 35 : 100, due: i === 0 ? '今日 17:00' : '已完成' })),
  exceptions: riskRows.map((r, i) => ({ name: r.project, detail: r.issue, owner: r.owner, state: i ? '待评审' : '阻断', progress: i ? 40 : 20, due: r.deadline })),
  standards: ['GB/T 28448-2019', 'GB/T 39786-2021', '网络安全等级保护测评要求'].map((name, i) => ({ name, detail: ['2026 年修订版发布', '密码应用测评指标调整', '检测证据要求更新'][i], owner: '质量管理部', state: i === 0 ? '影响 12 项' : '评估中', progress: [62, 45, 80][i], due: ['07-25', '07-28', '08-02'][i] })),
  reports: projects.value.slice(1, 5).map((p, i) => ({ name: `${p.id} · ${p.customer}`, detail: `${p.services} 个服务项报告`, owner: p.manager, state: ['编制中', '待复核', '客户确认', '待编制'][i], progress: [68, 86, 92, 20][i], due: p.due })),
}[activeSection.value] || []))

const rules = ref([
  { id: 1, name: '按批次 + 检测类别拆解', scope: '等保测评、商用密码', trigger: '合同生效', enabled: true, updated: '2026-07-16 14:20' },
  { id: 2, name: '特殊方法独立成项', scope: '全部检测类别', trigger: '服务清单含特殊方法', enabled: true, updated: '2026-07-12 09:42' },
  { id: 3, name: '跨地域实施冲突预警', scope: '项目经理、实施工程师', trigger: '排期重叠且跨城市', enabled: true, updated: '2026-07-08 17:10' },
  { id: 4, name: '资质临期强提醒', scope: '人员资质', trigger: '有效期不足 90 天', enabled: false, updated: '2026-06-28 11:05' },
])

function navigate(section) {
  router.push({ name: 'project_management', params: { section } })
  mobileMenuOpen.value = false
}

function showToast(message) {
  toastMessage.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastMessage.value = '' }, 2600)
}

function openProject(project) { drawerProject.value = project }
function toggleRow(id) {
  selectedRows.value = selectedRows.value.includes(id) ? selectedRows.value.filter((item) => item !== id) : [...selectedRows.value, id]
}
function confirmDecomposition() {
  serviceItems.value = serviceItems.value.map((item) => ({ ...item, status: item.selected ? '待分配' : item.status }))
  showToast('已确认 4 个服务项，任务已进入分配队列')
}
function exportProjects() {
  const rows = filteredProjects.value.map((p) => [p.id, p.customer, p.contract, p.category, p.team, p.manager, p.status, p.due])
  const csv = [['项目编号', '客户', '合同编号', '检测类别', '团队', '项目经理', '状态', '计划完成'], ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = '项目列表.csv'
  link.click()
  URL.revokeObjectURL(url)
  showToast(`已导出 ${rows.length} 条项目记录`)
}

onBeforeUnmount(() => window.clearTimeout(toastTimer))
</script>

<template>
  <div class="pm-shell">
    <aside class="pm-sidebar" :class="{ open: mobileMenuOpen }">
      <div class="pm-brand">
        <span class="pm-brand-mark">PS</span>
        <span><b>项目服务管理</b><small>PROJECT SERVICE</small></span>
        <button class="pm-icon-button pm-mobile-close" aria-label="关闭菜单" @click="mobileMenuOpen = false"><ConsoleIcon name="close" /></button>
      </div>
      <nav class="pm-nav" aria-label="项目管理导航">
        <div v-for="group in navGroups" :key="group.label" class="pm-nav-group">
          <div class="pm-nav-label">{{ group.label }}</div>
          <button v-for="item in group.items" :key="item.key" class="pm-nav-item" :class="{ active: activeSection === item.key }" @click="navigate(item.key)">
            <ConsoleIcon :name="item.icon" /><span>{{ item.label }}</span><em v-if="item.badge">{{ item.badge }}</em>
          </button>
        </div>
      </nav>
      <div class="pm-sidebar-foot">V1.0 · 项目服务内容管理</div>
    </aside>
    <div v-if="mobileMenuOpen" class="pm-menu-mask" @click="mobileMenuOpen = false"></div>

    <main class="pm-main">
      <header class="pm-topbar">
        <button class="pm-icon-button pm-menu-button" aria-label="打开菜单" @click="mobileMenuOpen = true"><ConsoleIcon name="menu" /></button>
        <div class="pm-breadcrumb"><span>项目服务管理</span><b>/</b><strong>{{ currentMeta[0] }}</strong></div>
        <div class="pm-top-tools">
          <button class="pm-icon-button" aria-label="全局搜索" @click="showToast('全局搜索即将开放')"><ConsoleIcon name="search" /></button>
          <button class="pm-icon-button pm-notification-button" aria-label="通知" @click="notificationOpen = !notificationOpen"><ConsoleIcon name="bell" /><em>9</em></button>
          <div class="pm-user"><span>王</span><div><b>王晓飞</b><small>业务管理员</small></div></div>
        </div>
        <div v-if="notificationOpen" class="pm-notifications">
          <div class="pm-popover-head"><b>消息通知</b><span>9 条未读</span></div>
          <button @click="navigate('exceptions'); notificationOpen = false"><i class="danger"></i><span><b>异常评审待处理</b><small>PJ-2026-0817 授权范围变更</small></span></button>
          <button @click="navigate('decomposition'); notificationOpen = false"><i></i><span><b>7 个项目待拆解确认</b><small>最早一项已等待 3 小时</small></span></button>
          <button @click="navigate('inbox'); notificationOpen = false"><i class="warning"></i><span><b>任务分配待接受</b><small>2 小时后将触发超时提醒</small></span></button>
        </div>
      </header>

      <div class="pm-page">
        <section class="pm-page-head">
          <div><p class="pm-eyebrow">PROJECT OPERATIONS</p><h1>{{ currentMeta[0] }}</h1><p>{{ currentMeta[1] }} · 数据更新于 2026-07-31 13:00</p></div>
          <div class="pm-actions">
            <button class="pm-button" @click="showToast('数据已刷新')"><ConsoleIcon name="reset" />刷新</button>
            <button v-if="activeSection === 'projects'" class="pm-button" @click="exportProjects"><ConsoleIcon name="export" />导出</button>
            <button v-if="['projects', 'split-rules', 'warning-rules', 'automations'].includes(activeSection)" class="pm-button primary" @click="createOpen = true">＋ 新建{{ activeSection === 'projects' ? '项目' : '规则' }}</button>
            <button v-if="activeSection === 'decomposition'" class="pm-button primary" @click="confirmDecomposition">确认拆解</button>
          </div>
        </section>

        <template v-if="activeSection === 'dashboard'">
          <section class="pm-kpis">
            <article class="pm-kpi blue" @click="navigate('projects')"><div><span>现场实施准时交付率</span><em>北极星指标</em></div><strong>87.4<small>%</small></strong><p class="positive">↑ 3.2% <span>目标 ≥ 85%</span></p></article>
            <article class="pm-kpi cyan" @click="navigate('decomposition')"><div><span>合同→项目拆解自动化率</span><em>自动化</em></div><strong>92.1<small>%</small></strong><p class="positive">↑ 1.5% <span>目标 ≥ 90%</span></p></article>
            <article class="pm-kpi amber" @click="navigate('allocation')"><div><span>资源下达及时率</span><em>分配 SLA</em></div><strong>96.8<small>%</small></strong><p class="positive">↑ 0.7% <span>≤ 2 工作日</span></p></article>
            <article class="pm-kpi violet" @click="navigate('exceptions')"><div><span>异常闭环时长</span><em>中位数</em></div><strong>0.6<small>工作日</small></strong><p class="positive">↓ 0.2 天 <span>目标 ≤ 1 天</span></p></article>
          </section>
          <section class="pm-dashboard-grid">
            <article class="pm-panel pm-status-panel">
              <header><div><p class="pm-panel-kicker">SERVICE FLOW</p><h2>服务项状态分布</h2></div><span>总计 <b>386</b> 项</span></header>
              <div class="pm-status-chart"><div class="pm-donut"><div><strong>163</strong><span>在途服务项</span></div></div><div class="pm-legend">
                <button @click="navigate('allocation')"><i class="slate"></i><span>待分配</span><b>26</b><em>6.7%</em></button>
                <button @click="navigate('planning')"><i class="violet"></i><span>待实施</span><b>64</b><em>16.6%</em></button>
                <button @click="navigate('implementation')"><i class="amber"></i><span>实施中</span><b>42</b><em>10.9%</em></button>
                <button @click="navigate('reports')"><i class="blue"></i><span>报告编制</span><b>31</b><em>8.0%</em></button>
                <button><i class="green"></i><span>已完成</span><b>223</b><em>57.8%</em></button>
              </div></div>
            </article>
            <article class="pm-panel">
              <header><div><p class="pm-panel-kicker danger">ATTENTION</p><h2>风险与待办</h2></div><button class="pm-link" @click="navigate('exceptions')">查看全部 →</button></header>
              <div class="pm-risk-list"><button v-for="risk in riskRows" :key="risk.project" @click="navigate('exceptions')"><span :class="risk.level === '高' ? 'high' : 'medium'">{{ risk.level }}</span><div><b>{{ risk.project }}</b><p>{{ risk.issue }}</p></div><time>{{ risk.deadline }}</time></button></div>
            </article>
          </section>
          <section class="pm-panel pm-project-progress">
            <header><div><p class="pm-panel-kicker">DELIVERY PULSE</p><h2>重点项目交付进度</h2></div><button class="pm-link" @click="navigate('monitoring')">实时监控 →</button></header>
            <div class="pm-progress-row" v-for="project in projects.slice(0, 4)" :key="project.id" @click="openProject(project)"><div><b>{{ project.id }}</b><span>{{ project.customer }}</span></div><span class="pm-badge" :class="project.health">{{ project.health }}</span><div class="pm-progress"><i :style="{ width: `${project.progress}%` }"></i></div><strong>{{ project.progress }}%</strong><time>{{ project.due }}</time></div>
          </section>
        </template>

        <template v-else-if="activeSection === 'projects'">
          <section class="pm-summary-strip"><button><b>86</b><span>全部项目</span></button><button><b>7</b><span>待拆解确认</span></button><button><b>28</b><span>在途项目</span></button><button><b>12</b><span>本月完成</span></button><button class="danger"><b>3</b><span>风险项目</span></button></section>
          <section class="pm-filters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索项目编号 / 客户 / 合同 / 项目经理" /></label><select v-model="statusFilter"><option value="">全部状态</option><option>待拆解确认</option><option>待分配</option><option>待实施</option><option>实施中</option><option>报告编制</option><option>异常处理中</option></select><button class="pm-button ghost" @click="keyword = ''; statusFilter = ''">重置</button><span>{{ filteredProjects.length }} 条结果</span></section>
          <section class="pm-table-panel">
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th></th><th>项目 / 客户</th><th>合同编号</th><th>服务项</th><th>检测类别</th><th>团队 / 项目经理</th><th>健康度</th><th>状态</th><th>交付进度</th><th>计划完成</th><th></th></tr></thead><tbody>
              <tr v-for="project in filteredProjects" :key="project.id" :class="{ selected: selectedRows.includes(project.id), risk: project.health === '风险' }"><td><input type="checkbox" :checked="selectedRows.includes(project.id)" :aria-label="`选择 ${project.id}`" @change="toggleRow(project.id)" /></td><td><button class="pm-project-link" @click="openProject(project)"><b>{{ project.id }}</b><span>{{ project.customer }}</span></button></td><td class="mono">{{ project.contract }}</td><td>{{ project.services }}</td><td>{{ project.category }}</td><td><b>{{ project.team }}</b><span class="pm-cell-sub">{{ project.manager }}</span></td><td><span class="pm-badge" :class="project.health">{{ project.health }}</span></td><td><span class="pm-badge neutral">{{ project.status }}</span></td><td><div class="pm-inline-progress"><i :style="{ width: `${project.progress}%` }"></i></div><small>{{ project.progress }}%</small></td><td :class="{ 'pm-text-danger': project.due.includes('超期') }">{{ project.due }}</td><td><button class="pm-link" @click="openProject(project)">详情</button></td></tr>
            </tbody></table></div><footer><span>已选择 {{ selectedRows.length }} 项</span><span>第 1 / 1 页</span></footer>
          </section>
        </template>

        <template v-else-if="activeSection === 'decomposition'">
          <section class="pm-source-card"><div class="pm-source-icon"><ConsoleIcon name="account" /></div><div><span>合同来源</span><h2>HT-2026-0415 · 某市公积金管理中心</h2><p>交付截止 2026-10-31 · 分组规则：批次 + 检测类别 · 自动生成于 2026-07-15 10:23</p></div><span class="pm-badge normal">已生效</span></section>
          <section class="pm-decompose-grid"><article class="pm-panel pm-tree-panel"><header><div><p class="pm-panel-kicker">SERVICE TREE</p><h2>服务项树</h2></div><span>8 项</span></header><button class="active"><span>01</span><div><b>第一批次</b><small>3 个服务项</small></div></button><button><span>02</span><div><b>第二批次</b><small>5 个服务项</small></div></button><div class="pm-tree-note"><b>自动拆解校验</b><p>范围覆盖 100%，未发现重复项；1 项特殊方法需复核。</p></div></article>
            <article class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>纳入</th><th>服务项编号</th><th>场所 / 批次</th><th>检测类别</th><th>技术要求摘要</th><th>体系</th><th>特殊方法</th><th>状态</th></tr></thead><tbody><tr v-for="item in serviceItems" :key="item.id"><td><input v-model="item.selected" type="checkbox" :aria-label="`纳入 ${item.id}`" /></td><td class="mono"><b>{{ item.id }}</b></td><td>{{ item.site }}<span class="pm-cell-sub">{{ item.batch }}</span></td><td>{{ item.category }}</td><td>{{ item.requirement }}</td><td>{{ item.system }}</td><td><span class="pm-badge" :class="item.special === '是' ? '待确认' : 'neutral'">{{ item.special }}</span></td><td><span class="pm-badge neutral">{{ item.status }}</span></td></tr></tbody></table></div></article>
          </section>
        </template>

        <template v-else-if="activeSection === 'implementation'">
          <section class="pm-board-summary"><div><strong>386</strong><span>全部服务项</span></div><div><strong>42</strong><span>正在实施</span></div><div><strong>31</strong><span>报告编制</span></div><div><strong>87.4%</strong><span>准时交付率</span></div></section>
          <section class="pm-kanban"><article v-for="column in kanbanColumns" :key="column.key"><header><div><i :class="column.color"></i><b>{{ column.key }}</b></div><span>{{ column.count }}</span></header><div class="pm-kanban-body"><button v-for="card in column.cards" :key="card.id" @click="openProject(card)"><b>{{ card.id }}</b><h3>{{ card.customer }}</h3><div class="pm-inline-progress"><i :style="{ width: `${card.progress}%` }"></i></div><footer><span>{{ card.progress }}%</span><time>{{ card.due }}</time></footer></button><div v-if="!column.cards.length" class="pm-empty-mini">暂无当前样例</div></div></article></section>
        </template>

        <template v-else-if="['split-rules', 'warning-rules', 'automations', 'permissions'].includes(activeSection)">
          <section class="pm-config-layout"><aside class="pm-config-note"><span><ConsoleIcon name="info" /></span><h2>配置说明</h2><p>{{ currentMeta[1] }}。变更将在保存后对新任务生效，已有项目不自动追溯。</p><ul><li>配置修改需业务管理员权限</li><li>关键规则变更会记录审计日志</li><li>关闭规则前请确认影响范围</li></ul></aside><article class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>配置名称</th><th>适用范围</th><th>触发条件</th><th>状态</th><th>最后更新</th><th></th></tr></thead><tbody><tr v-for="rule in rules" :key="rule.id"><td><b>{{ rule.name }}</b></td><td>{{ rule.scope }}</td><td>{{ rule.trigger }}</td><td><button class="pm-switch" :class="{ on: rule.enabled }" :aria-label="`${rule.enabled ? '停用' : '启用'} ${rule.name}`" @click="rule.enabled = !rule.enabled; showToast(rule.enabled ? '规则已启用' : '规则已停用')"><i></i></button></td><td>{{ rule.updated }}</td><td><button class="pm-link" @click="showToast(`正在编辑：${rule.name}`)">编辑</button></td></tr></tbody></table></div></article></section>
        </template>

        <template v-else>
          <section class="pm-operational-stats"><article><span>待处理</span><strong>{{ operationRows.filter((r) => !['有效', '已就绪', '校验通过', '已通过', '计划已发布'].includes(r.state)).length }}</strong><small>需要本周完成</small></article><article><span>处理中</span><strong>{{ Math.max(operationRows.length - 1, 1) }}</strong><small>按计划推进</small></article><article><span>本月完成</span><strong>24</strong><small class="positive">较上月 +12%</small></article></section>
          <section class="pm-filters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索编号、项目或负责人" /></label><select><option>全部状态</option><option>待处理</option><option>进行中</option><option>已完成</option></select><select><option>全部团队</option><option>测评一组</option><option>测评二组</option><option>渗透测试组</option></select><span>{{ operationRows.length }} 条结果</span></section>
          <section class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>事项 / 项目</th><th>内容摘要</th><th>负责人 / 归属</th><th>状态</th><th>完成度</th><th>时限</th><th></th></tr></thead><tbody><tr v-for="row in operationRows" :key="row.name"><td><b>{{ row.name }}</b></td><td>{{ row.detail }}</td><td>{{ row.owner }}</td><td><span class="pm-badge" :class="['阻断', '排期冲突'].includes(row.state) ? '风险' : 'neutral'">{{ row.state }}</span></td><td><div class="pm-inline-progress"><i :style="{ width: `${row.progress}%` }"></i></div><small>{{ row.progress }}%</small></td><td>{{ row.due }}</td><td><button class="pm-link" @click="showToast(`已打开：${row.name}`)">处理</button></td></tr></tbody></table></div><div v-if="!operationRows.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无数据</b><span>当前页面尚无待处理事项</span></div></section>
        </template>
      </div>
    </main>

    <div v-if="drawerProject" class="pm-overlay" @click.self="drawerProject = null"><aside class="pm-drawer"><header><div><span>项目详情</span><h2>{{ drawerProject.id }}</h2></div><button class="pm-icon-button" aria-label="关闭" @click="drawerProject = null"><ConsoleIcon name="close" /></button></header><div class="pm-drawer-body"><section class="pm-drawer-hero"><span class="pm-badge" :class="drawerProject.health">{{ drawerProject.health }}</span><h3>{{ drawerProject.customer }}</h3><p>{{ drawerProject.category }}</p><div class="pm-progress"><i :style="{ width: `${drawerProject.progress}%` }"></i></div><b>{{ drawerProject.progress }}% 已完成</b></section><dl><div><dt>合同编号</dt><dd>{{ drawerProject.contract || '—' }}</dd></div><div><dt>服务项数量</dt><dd>{{ drawerProject.services || '—' }}</dd></div><div><dt>负责团队</dt><dd>{{ drawerProject.team || '—' }}</dd></div><div><dt>项目经理</dt><dd>{{ drawerProject.manager || '—' }}</dd></div><div><dt>当前状态</dt><dd>{{ drawerProject.status || '已完成' }}</dd></div><div><dt>计划完成</dt><dd>{{ drawerProject.due }}</dd></div></dl><section class="pm-timeline"><h3>最近动态</h3><div><i></i><b>项目状态更新</b><p>服务项进度同步至 {{ drawerProject.progress }}%</p><time>今天 11:32</time></div><div><i></i><b>实施记录已提交</b><p>现场取证资料已上传并完成校验</p><time>昨天 17:20</time></div><div><i></i><b>任务完成指派</b><p>负责人已确认实施计划</p><time>07-16 09:45</time></div></section></div><footer><button class="pm-button" @click="drawerProject = null">关闭</button><button class="pm-button primary" @click="showToast('已进入项目工作区')">进入项目工作区</button></footer></aside></div>

    <div v-if="createOpen" class="pm-overlay" @click.self="createOpen = false"><form class="pm-dialog" @submit.prevent="createOpen = false; showToast('已保存为草稿')"><header><div><span>CREATE</span><h2>{{ activeSection === 'projects' ? '新建项目' : '新建配置规则' }}</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="createOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>名称 <em>*</em></span><input required :placeholder="activeSection === 'projects' ? '请输入项目名称' : '请输入规则名称'" /></label><label><span>{{ activeSection === 'projects' ? '客户 / 合同' : '适用范围' }} <em>*</em></span><input required placeholder="请输入关键信息" /></label><label><span>负责人</span><select><option>王晓飞</option><option>张磊</option><option>李娜</option></select></label><label><span>备注</span><textarea rows="4" placeholder="补充说明（选填）"></textarea></label></div><footer><button type="button" class="pm-button" @click="createOpen = false">取消</button><button class="pm-button primary">保存草稿</button></footer></form></div>
    <Transition name="pm-toast"><div v-if="toastMessage" class="pm-toast"><span>✓</span>{{ toastMessage }}</div></Transition>
  </div>
</template>
