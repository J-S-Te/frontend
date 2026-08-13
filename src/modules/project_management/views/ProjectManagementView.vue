<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { subsystemAccessMessage } from '@/modules/shared/authz/sessionCompatibility'
import { closeSubsystemTabOrFallback } from '@/modules/shared/utils/returnToPortal'
import {
  confirmServiceItems as confirmServiceItemsRequest,
  createProject,
  createRule,
  getDashboard,
  getProjectSession,
  listProjects,
  listCapabilities,
  listDeliveryEvents,
  listRules,
  listServiceItems,
  setRuleEnabled,
} from '@/modules/project_management/api/projectManagement'
import '@/modules/project_management/styles/project-management.css'

const route = useRoute()
const router = useRouter()

const navGroups = [
  { label: '执行总览', items: [
    { key: 'dashboard', label: '项目执行总览', icon: 'dashboard' },
    { key: 'monitoring', label: '在途项目实时监控', icon: 'audit' },
  ] },
  { label: '项目管理', items: [
    { key: 'projects', label: '项目列表', icon: 'account' },
    { key: 'decomposition', label: '服务项拆解确认', icon: 'organization' },
  ] },
  { label: '资源分配', items: [
    { key: 'allocation', label: '任务分配', icon: 'user' },
    { key: 'inbox', label: '我的分配待办', icon: 'bell' },
    { key: 'planning', label: '实施计划', icon: 'audit' },
    { key: 'preparation', label: '实施准备', icon: 'save' },
    { key: 'qualifications', label: '资质与能力', icon: 'shield' },
    { key: 'assignments', label: '人员设备指派', icon: 'organization' },
    { key: 'methods', label: '特殊方法复核', icon: 'info' },
  ] },
  { label: '现场实施', items: [
    { key: 'implementation', label: '实施看板', icon: 'dashboard' },
    { key: 'exceptions', label: '异常评审', icon: 'audit' },
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
  monitoring: ['在途项目 · 实时监控', '在途项目的里程碑、健康度与资源状态'],
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
const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
const createForm = ref({ name: '', customer: '', contract: '', scope: '', trigger: '', manager: '', notes: '' })
const dashboard = ref({ project_count: 0, in_flight_projects: 0, risk_projects: 0, service_items: 0, status_counts: {} })
const session = ref(null)
const lastUpdatedAt = ref(null)
let toastTimer = 0

const projects = ref([])

const filteredProjects = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return projects.value.filter((project) => {
    const matchKeyword = !query || [project.id, project.customer, project.contract, project.category, project.manager].join(' ').toLowerCase().includes(query)
    return matchKeyword && (!statusFilter.value || project.status === statusFilter.value)
  })
})

const serviceItems = ref([])
const deliveryEvents = ref([])
const capabilities = ref([])

const projectByID = computed(() => new Map(projects.value.map((project) => [project.id, project])))
const itemByID = computed(() => new Map(serviceItems.value.map((item) => [item.id, item])))
const stampedContractStateByProject = computed(() => {
  const states = new Map()
  for (const event of deliveryEvents.value) {
    if (event.type === 'CONTRACT_STAMP_STATUS_SYNCED' && !states.has(event.project_id) && typeof event.payload?.stamped_contract_uploaded === 'boolean') {
      states.set(event.project_id, event.payload.stamped_contract_uploaded)
    }
    if (event.type === 'CONTRACT_ACTIVATED' && !states.has(event.project_id) && typeof event.payload?.stamped_contract_uploaded === 'boolean') {
      states.set(event.project_id, event.payload.stamped_contract_uploaded)
    }
  }
  return states
})
const missingStampedContractCount = computed(() => new Set(serviceItems.value.filter((item) => stampedContractStateByProject.value.get(item.project_id) === false).map((item) => item.project_id)).size)
const reviewedDeviationIDs = computed(() => new Set(deliveryEvents.value.filter((event) => event.type === 'DEVIATION_REVIEWED').map((event) => event.payload?.deviation_id)))
const pendingDeviations = computed(() => deliveryEvents.value.filter((event) => event.type === 'DEVIATION_REPORTED' && !reviewedDeviationIDs.value.has(event.payload?.deviation_id)))
const decompositionItems = computed(() => serviceItems.value.filter((item) => ['待确认', '待复核'].includes(item.status)))
const inboxItems = computed(() => serviceItems.value.filter((item) => item.team_lead_id && (!item.project_manager_id || !(item.engineer_ids || []).length)))
const penetrationPending = computed(() => serviceItems.value.filter((item) => item.test_mode === 'PENETRATION' && !item.planned_start))
const notificationCount = computed(() => pendingDeviations.value.length + decompositionItems.value.length + inboxItems.value.length)
const activeServiceCount = computed(() => serviceItems.value.filter((item) => !['现场实施完成', '已完成', '已终止'].includes(item.status)).length)
const completedProjectCount = computed(() => projects.value.filter((project) => ['已完成', '现场实施完成'].includes(project.status)).length)
const currentUserName = computed(() => session.value?.display_name || session.value?.user_name || '当前用户')
const currentUserRole = computed(() => session.value?.roles?.join(' / ') || '项目成员')
const lastUpdatedLabel = computed(() => lastUpdatedAt.value ? lastUpdatedAt.value.toLocaleString() : '尚未加载')
const serviceFlow = computed(() => [
  { key: '待分配', color: 'slate', count: serviceItems.value.filter((item) => item.status === '待分配').length, route: 'allocation' },
  { key: '待实施', color: 'violet', count: serviceItems.value.filter((item) => ['待制定计划', '待实施', '实施准备中'].includes(item.status)).length, route: 'planning' },
  { key: '实施中', color: 'amber', count: serviceItems.value.filter((item) => ['实施中', '异常处理中'].includes(item.status)).length, route: 'implementation' },
  { key: '报告编制', color: 'blue', count: projects.value.filter((item) => item.status === '报告编制').length, route: 'reports' },
  { key: '已完成', color: 'green', count: serviceItems.value.filter((item) => ['现场实施完成', '已完成'].includes(item.status)).length, route: 'implementation' },
])
const decompositionProject = computed(() => projectByID.value.get(decompositionItems.value[0]?.project_id) || null)
const decompositionBatches = computed(() => Object.entries(decompositionItems.value.reduce((groups, item) => { const key = item.batch || '未设置批次'; (groups[key] ||= []).push(item); return groups }, {})))
const riskRows = computed(() => [
  ...pendingDeviations.value.map((event) => { const item = itemByID.value.get(event.service_item_id); const project = projectByID.value.get(item?.project_id); return { id: event.id, level: event.payload?.severity === 'HIGH' ? '高' : '中', project: `${project?.id || item?.project_id || '未知项目'} · ${project?.customer || item?.site || '现场任务'}`, issue: event.payload?.description || '现场偏离待评审', owner: event.actor_user_id || '待认领', deadline: formatDateTime(event.created_at) } }),
  ...serviceItems.value.filter((item) => item.conflict_status === 'CONFLICT').map((item) => { const project = projectByID.value.get(item.project_id); return { id: `conflict-${item.id}`, level: '高', project: `${item.project_id} · ${project?.customer || item.site}`, issue: `${item.id} 人员或设备能力冲突`, owner: item.project_manager_id || item.team_lead_id || '待分配', deadline: item.planned_start?.slice(0, 10) || '待处理' } }),
].slice(0, 10))

const kanbanColumns = computed(() => [
  { key: '待分配', color: 'slate', cards: projects.value.filter((p) => ['待分配', '待拆解确认'].includes(p.status)) },
  { key: '待实施', color: 'violet', cards: projects.value.filter((p) => ['待实施', '实施准备中', '待制定计划'].includes(p.status)) },
  { key: '实施中', color: 'amber', cards: projects.value.filter((p) => ['实施中', '异常处理中'].includes(p.status)) },
  { key: '报告编制', color: 'blue', cards: projects.value.filter((p) => p.status === '报告编制') },
  { key: '已完成', color: 'green', cards: projects.value.filter((p) => ['已完成', '现场实施完成'].includes(p.status)) },
].map((column) => ({ ...column, count: column.cards.length })))

const operationRows = computed(() => ({
  monitoring: projects.value.slice(0, 5).map((p) => ({ name: `${p.id} · ${p.customer}`, detail: p.category, owner: p.manager, state: p.health, progress: p.progress, due: p.due })),
  allocation: serviceItems.value.filter((s) => s.status === '待分配').map((s) => ({ name: `${s.id} · ${s.category}`, detail: `${s.site} / ${s.batch}`, warning: stampedContractStateByProject.value.get(s.project_id) === false ? '未上传盖章合同' : '', owner: s.team_lead_id || '待分配团队负责人', state: s.conflict_status === 'CONFLICT' ? '能力冲突' : s.team_lead_id ? '已分配' : '待分配', progress: s.project_manager_id ? 100 : s.team_lead_id ? 50 : 0, due: s.planned_end?.slice(0, 10) || '待排期' })),
  inbox: inboxItems.value.map((s) => ({ name: `${s.id} · ${projectByID.value.get(s.project_id)?.customer || s.site}`, detail: s.project_manager_id ? '实施工程师待指派' : '项目经理待指派', owner: s.team_lead_id, state: '待处理', progress: s.project_manager_id ? 50 : 0, due: s.planned_start?.slice(0, 10) || '待排期' })),
  planning: serviceItems.value.map((s) => ({ name: `${s.id} · ${s.site}`, detail: s.test_mode === 'PENETRATION' ? '渗透测试专项计划' : '现场实施计划', owner: s.project_manager_id || '待指派项目经理', state: s.planned_start ? '计划已发布' : '待排期', progress: s.planned_start ? 100 : 0, due: s.planned_end?.slice(0, 10) || '待排期' })),
  preparation: deliveryEvents.value.filter((e) => e.type === 'PREPARATION_STARTED').map((e) => ({ name: e.service_item_id, detail: `设备申领 ${e.payload.equipment_request_id} / 行程 ${e.payload.travel_request_id}`, owner: e.actor_user_id, state: '准备中', progress: 50, due: new Date(e.created_at).toLocaleDateString() })),
  qualifications: capabilities.value.map((c) => ({ name: c.resource_name, detail: c.codes.join(' / '), owner: c.resource_type === 'PERSON' ? '人员资质' : '设备能力', state: c.status === 'ACTIVE' ? '有效' : c.status, progress: c.status === 'ACTIVE' ? 100 : 0, due: c.valid_until?.slice(0, 10) || '长期' })),
  assignments: serviceItems.value.map((s) => ({ name: `${s.id} · ${s.site}`, detail: `${s.engineer_ids?.length || 0} 人 / ${s.equipment_ids?.length || 0} 台设备`, owner: s.project_manager_id || '待指派', state: s.conflict_status === 'CONFLICT' ? '排期冲突' : s.conflict_status === 'PASSED' ? '校验通过' : '待校验', progress: s.conflict_status === 'PASSED' ? 100 : 30, due: s.planned_end?.slice(0, 10) || '待排期' })),
  methods: serviceItems.value.filter((s) => s.test_mode === 'PENETRATION').map((s) => ({ name: `${s.id} · ${s.category}`, detail: `${s.site} / ${s.system}`, owner: s.project_manager_id || '待指派', state: s.planned_start ? '专项计划已发布' : '待制定渗透测试计划', progress: s.planned_start ? 100 : 0, due: s.planned_end?.slice(0, 10) || '待排期' })),
  exceptions: pendingDeviations.value.map((e) => ({ name: `${e.payload?.deviation_id} · ${e.service_item_id}`, detail: e.payload?.description || '现场偏离', owner: e.actor_user_id, state: '待评审', progress: 0, due: formatDateTime(e.created_at) })),
  standards: [],
  reports: projects.value.filter((p) => ['现场实施完成', '报告编制'].includes(p.status)).map((p) => ({ name: `${p.id} · ${p.customer}`, detail: `${p.services} 个服务项报告`, owner: p.manager || '待指派', state: p.status === '报告编制' ? '编制中' : '待编制', progress: p.progress, due: p.due || '待排期' })),
}[activeSection.value] || []))

const rules = ref([])
const visibleRules = computed(() => rules.value.filter((rule) => rule.kind === activeSection.value))

async function loadWorkspace() {
  loading.value = true
  loadError.value = ''
  try {
    // 项目、服务项和规则共同构成当前工作区快照；三者全部成功后才一次性替换页面状态，
    // 防止新旧数据混用。接口层仍分别执行会话与资源权限校验。
    const [projectRows, itemRows, ruleRows, eventRows, capabilityRows, dashboardData, sessionData] = await Promise.all([listProjects(), listServiceItems(), listRules(), listDeliveryEvents(), listCapabilities(), getDashboard(), getProjectSession()])
    projects.value = projectRows
    serviceItems.value = itemRows.map((item) => ({ ...item, selected: ['待确认', '待复核'].includes(item.status) }))
    rules.value = ruleRows
    deliveryEvents.value = eventRows
    capabilities.value = capabilityRows
    dashboard.value = dashboardData
    session.value = sessionData
    if (!createForm.value.manager) createForm.value.manager = sessionData?.display_name || ''
    lastUpdatedAt.value = new Date()
  } catch (error) {
    loadError.value = subsystemAccessMessage(error, '项目管理数据加载失败。')
  } finally {
    loading.value = false
  }
}

function navigate(section) {
  router.push({ name: 'project_management', params: { section } })
  mobileMenuOpen.value = false
}

function returnToUnifiedPortal() {
  mobileMenuOpen.value = false
  notificationOpen.value = false
  closeSubsystemTabOrFallback(window, () => router.replace({ name: 'portal' }))
}

function showToast(message) {
  toastMessage.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastMessage.value = '' }, 2600)
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function projectEvents(project) {
  const itemIDs = new Set(serviceItems.value.filter((item) => item.project_id === project.id).map((item) => item.id))
  return deliveryEvents.value.filter((event) => event.project_id === project.id || itemIDs.has(event.service_item_id)).slice(0, 5)
}

function eventLabel(event) {
  return ({ CONTRACT_ACTIVATED: '合同生效并生成项目', DECOMPOSITION_ADJUSTED: '服务项拆解已调整', ASSIGNMENT_PUBLISHED: '资源分配已下达', TEAM_ASSIGNED: '团队负责人已分配', EXECUTION_TEAM_ASSIGNED: '项目经理及工程师已指派', IMPLEMENTATION_PLANNED: '现场实施计划已发布', PREPARATION_STARTED: '实施准备已发起', FIELD_CHECK_IN: '现场签到已完成', FIELD_RECORD_SUBMITTED: '现场原始记录已提交', DEVIATION_REPORTED: '现场偏离已上报', DEVIATION_REVIEWED: '偏离评审已完成', FIELD_IMPLEMENTATION_COMPLETED: '现场实施已完成' })[event.type] || event.type
}

function openProject(project) { drawerProject.value = project }
function toggleRow(id) {
  selectedRows.value = selectedRows.value.includes(id) ? selectedRows.value.filter((item) => item !== id) : [...selectedRows.value, id]
}
async function confirmDecomposition() {
  const ids = serviceItems.value.filter((item) => item.selected).map((item) => item.id)
  if (!ids.length) { showToast('请至少选择一个服务项'); return }
  saving.value = true
  try {
    // 只依据服务端返回的已变更服务项更新本地列表；未返回的行保持原状态，避免把整批
    // 请求都乐观标记为成功。
    const changed = await confirmServiceItemsRequest(ids)
    const byID = new Map(changed.map((item) => [item.id, item]))
    serviceItems.value = serviceItems.value.map((item) => byID.has(item.id) ? { ...byID.get(item.id), selected: false } : item)
    showToast(`已确认 ${ids.length} 个服务项，任务已进入分配队列`)
  } catch (error) { showToast(error?.message || '确认失败') }
  finally { saving.value = false }
}

async function toggleRule(rule) {
  const next = !rule.enabled
  try {
    // 不预先翻转开关，等待带有最新版本语义的服务端结果后再覆盖当前行。
    const updated = await setRuleEnabled(rule.id, next)
    Object.assign(rule, updated)
    showToast(next ? '规则已启用' : '规则已停用')
  } catch (error) { showToast(error?.message || '规则更新失败') }
}

async function saveCreate() {
  saving.value = true
  try {
    // 同一弹窗根据当前栏目创建不同资源；路由栏目在提交瞬间决定载荷形态，成功后再把
    // 服务端生成的记录并入对应集合。
    if (activeSection.value === 'projects') {
      const created = await createProject({
        name: createForm.value.name,
        customer: createForm.value.customer,
        contract: createForm.value.contract,
        manager: createForm.value.manager,
        category: createForm.value.notes,
      })
      projects.value = [created, ...projects.value]
      showToast(`项目 ${created.id} 已创建`)
    } else {
      const created = await createRule({
        kind: activeSection.value,
        name: createForm.value.name,
        scope: createForm.value.scope,
        trigger: createForm.value.trigger || createForm.value.notes,
        enabled: true,
      })
      rules.value = [...rules.value, created]
      showToast('配置规则已创建')
    }
    createOpen.value = false
    createForm.value = { name: '', customer: '', contract: '', scope: '', trigger: '', manager: currentUserName.value, notes: '' }
  } catch (error) { showToast(error?.message || '保存失败') }
  finally { saving.value = false }
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

onMounted(loadWorkspace)
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
          <button v-for="item in group.items" :key="item.key" class="pm-nav-item" :class="{ active: activeSection === item.key }" :aria-current="activeSection === item.key ? 'page' : undefined" @click="navigate(item.key)">
            <ConsoleIcon :name="item.icon" /><span>{{ item.label }}</span><em v-if="item.badge">{{ item.badge }}</em>
          </button>
        </div>
        <div class="pm-nav-group">
          <div class="pm-nav-label">平台能力</div>
          <button class="pm-nav-item" type="button" @click="returnToUnifiedPortal"><ConsoleIcon name="logout" /><span>返回统一门户</span><em class="pm-platform-tag">平台</em></button>
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
          <button class="pm-icon-button pm-notification-button" aria-label="通知" @click="notificationOpen = !notificationOpen"><ConsoleIcon name="bell" /><em v-if="notificationCount">{{ notificationCount }}</em></button>
          <div class="pm-user"><span>{{ currentUserName.slice(0, 1) }}</span><div><b>{{ currentUserName }}</b><small>{{ currentUserRole }}</small></div><button class="pm-user-return" type="button" aria-label="返回门户" @click="returnToUnifiedPortal"><ConsoleIcon name="logout" /></button></div>
        </div>
        <div v-if="notificationOpen" class="pm-notifications">
          <div class="pm-popover-head"><b>业务待办</b><span>{{ notificationCount }} 条</span></div>
          <button v-if="pendingDeviations.length" @click="navigate('exceptions'); notificationOpen = false"><i class="danger"></i><span><b>{{ pendingDeviations.length }} 项异常待评审</b><small>来自现场偏离上报</small></span></button>
          <button v-if="decompositionItems.length" @click="navigate('decomposition'); notificationOpen = false"><i></i><span><b>{{ decompositionItems.length }} 个服务项待拆解确认</b><small>合同生效后自动生成</small></span></button>
          <button v-if="inboxItems.length" @click="navigate('inbox'); notificationOpen = false"><i class="warning"></i><span><b>{{ inboxItems.length }} 项资源分配待办</b><small>项目经理或工程师尚未完成指派</small></span></button>
          <div v-if="!notificationCount" class="pm-empty-mini">暂无业务待办</div>
        </div>
      </header>

      <div class="pm-page">
        <section class="pm-page-head">
          <div><p class="pm-eyebrow">PROJECT OPERATIONS</p><h1>{{ currentMeta[0] }}</h1><p>{{ currentMeta[1] }} · 数据更新于 {{ lastUpdatedLabel }}</p></div>
          <div class="pm-actions">
            <button class="pm-button" :disabled="loading" @click="loadWorkspace"><ConsoleIcon name="reset" />{{ loading ? '加载中' : '刷新' }}</button>
            <button v-if="activeSection === 'projects'" class="pm-button" @click="exportProjects"><ConsoleIcon name="export" />导出</button>
            <button v-if="['projects', 'split-rules', 'warning-rules', 'automations'].includes(activeSection)" class="pm-button primary" @click="createOpen = true">＋ 新建{{ activeSection === 'projects' ? '项目' : '规则' }}</button>
            <button v-if="activeSection === 'decomposition'" class="pm-button primary" :disabled="saving" @click="confirmDecomposition">{{ saving ? '提交中…' : '确认拆解' }}</button>
          </div>
        </section>

        <section v-if="loadError" class="pm-empty">
          <ConsoleIcon name="info" /><b>后端数据加载失败</b><span>{{ loadError }}</span><button class="pm-button" @click="loadWorkspace">重新加载</button>
        </section>

        <section v-if="['decomposition', 'allocation'].includes(activeSection) && missingStampedContractCount" class="pm-contract-warning"><ConsoleIcon name="info" /><div><b>{{ missingStampedContractCount }} 份合同尚未上传盖章合同</b><p>{{ activeSection === 'decomposition' ? '合同审批已完成，可继续核对并确认服务项拆解；该提示不阻断拆解确认。' : '服务项拆解已确认，可继续分配团队、人员及设备；上传盖章合同后提示将自动清除。' }}</p></div></section>

        <template v-if="activeSection === 'dashboard'">
          <section class="pm-kpis">
            <button type="button" class="pm-kpi blue" @click="navigate('projects')"><div><span>全部项目</span><em>实时</em></div><strong>{{ dashboard.project_count }}</strong><p><span>{{ dashboard.in_flight_projects }} 个在途项目</span></p></button>
            <button type="button" class="pm-kpi cyan" @click="navigate('decomposition')"><div><span>全部服务项</span><em>合同拆解</em></div><strong>{{ dashboard.service_items }}</strong><p><span>{{ decompositionItems.length }} 项待确认</span></p></button>
            <button type="button" class="pm-kpi amber" @click="navigate('allocation')"><div><span>资源分配待办</span><em>待处理</em></div><strong>{{ serviceFlow[0].count }}</strong><p><span>{{ inboxItems.length }} 项已下达待完善</span></p></button>
            <button type="button" class="pm-kpi violet" @click="navigate('exceptions')"><div><span>风险项目 / 异常</span><em>实时</em></div><strong>{{ dashboard.risk_projects }}<small> / {{ pendingDeviations.length }}</small></strong><p><span>风险项目与待评审偏离</span></p></button>
          </section>
          <section class="pm-dashboard-grid">
            <article class="pm-panel pm-status-panel">
              <header><div><p class="pm-panel-kicker">SERVICE FLOW</p><h2>服务项状态分布</h2></div><span>总计 <b>{{ serviceItems.length }}</b> 项</span></header>
              <div class="pm-status-chart"><div class="pm-donut"><div><strong>{{ activeServiceCount }}</strong><span>在途服务项</span></div></div><div class="pm-legend">
                <button v-for="flow in serviceFlow" :key="flow.key" @click="navigate(flow.route)"><i :class="flow.color"></i><span>{{ flow.key }}</span><b>{{ flow.count }}</b><em>{{ serviceItems.length ? (flow.count * 100 / serviceItems.length).toFixed(1) : '0.0' }}%</em></button>
              </div></div>
            </article>
            <article class="pm-panel">
              <header><div><p class="pm-panel-kicker danger">ATTENTION</p><h2>风险与待办</h2></div><button class="pm-link" @click="navigate('exceptions')">查看全部 →</button></header>
              <div class="pm-risk-list"><button v-for="risk in riskRows" :key="risk.id" @click="navigate('exceptions')"><span :class="risk.level === '高' ? 'high' : 'medium'">{{ risk.level }}</span><div><b>{{ risk.project }}</b><p>{{ risk.issue }}</p></div><time>{{ risk.deadline }}</time></button><div v-if="!riskRows.length" class="pm-empty-mini">暂无风险或待评审异常</div></div>
            </article>
          </section>
          <section class="pm-panel pm-project-progress">
            <header><div><p class="pm-panel-kicker">DELIVERY PULSE</p><h2>重点项目交付进度</h2></div><button class="pm-link" @click="navigate('monitoring')">实时监控 →</button></header>
            <div class="pm-progress-row" v-for="project in projects.slice(0, 4)" :key="project.id" @click="openProject(project)"><div><b>{{ project.id }}</b><span>{{ project.customer }}</span></div><span class="pm-badge" :class="project.health">{{ project.health }}</span><div class="pm-progress"><i :style="{ width: `${project.progress}%` }"></i></div><strong>{{ project.progress }}%</strong><time>{{ project.due }}</time></div>
          </section>
        </template>

        <template v-else-if="activeSection === 'projects'">
          <section class="pm-summary-strip"><button><b>{{ projects.length }}</b><span>全部项目</span></button><button><b>{{ projects.filter((p) => p.status === '待拆解确认').length }}</b><span>待拆解确认</span></button><button><b>{{ projects.filter((p) => p.status !== '已完成').length }}</b><span>在途项目</span></button><button><b>{{ projects.filter((p) => p.status === '已完成').length }}</b><span>已完成</span></button><button class="danger"><b>{{ projects.filter((p) => p.health === '风险').length }}</b><span>风险项目</span></button></section>
          <section class="pm-filters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索项目编号 / 客户 / 合同 / 项目经理" /></label><select v-model="statusFilter"><option value="">全部状态</option><option>待拆解确认</option><option>待分配</option><option>待实施</option><option>实施中</option><option>报告编制</option><option>异常处理中</option></select><button class="pm-button ghost" @click="keyword = ''; statusFilter = ''">重置</button><span>{{ filteredProjects.length }} 条结果</span></section>
          <section class="pm-table-panel">
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th></th><th>项目 / 客户</th><th>合同编号</th><th>服务项</th><th>检测类别</th><th>团队 / 项目经理</th><th>健康度</th><th>状态</th><th>交付进度</th><th>计划完成</th><th></th></tr></thead><tbody>
              <tr v-for="project in filteredProjects" :key="project.id" :class="{ selected: selectedRows.includes(project.id), risk: project.health === '风险' }"><td><input type="checkbox" :checked="selectedRows.includes(project.id)" :aria-label="`选择 ${project.id}`" @change="toggleRow(project.id)" /></td><td><button class="pm-project-link" @click="openProject(project)"><b>{{ project.id }}</b><span>{{ project.customer }}</span></button></td><td class="mono">{{ project.contract }}</td><td>{{ project.services }}</td><td>{{ project.category }}</td><td><b>{{ project.team }}</b><span class="pm-cell-sub">{{ project.manager }}</span></td><td><span class="pm-badge" :class="project.health">{{ project.health }}</span></td><td><span class="pm-badge neutral">{{ project.status }}</span></td><td><div class="pm-inline-progress"><i :style="{ width: `${project.progress}%` }"></i></div><small>{{ project.progress }}%</small></td><td :class="{ 'pm-text-danger': project.due.includes('超期') }">{{ project.due }}</td><td><button class="pm-link" @click="openProject(project)">详情</button></td></tr>
            </tbody></table></div><footer><span>已选择 {{ selectedRows.length }} 项</span><span>第 1 / 1 页</span></footer>
          </section>
        </template>

        <template v-else-if="activeSection === 'decomposition'">
          <section v-if="decompositionProject" class="pm-source-card"><div class="pm-source-icon"><ConsoleIcon name="account" /></div><div><span>合同来源</span><h2>{{ decompositionProject.contract }} · {{ decompositionProject.customer }}</h2><p>合同版本 {{ decompositionProject.contract_version || '—' }} · 自动生成于 {{ formatDateTime(decompositionProject.created_at) }}</p></div><span class="pm-badge normal">{{ decompositionProject.status }}</span></section>
          <section class="pm-decompose-grid"><article class="pm-panel pm-tree-panel"><header><div><p class="pm-panel-kicker">SERVICE TREE</p><h2>服务项树</h2></div><span>{{ decompositionItems.length }} 项</span></header><button v-for="([batch, items], index) in decompositionBatches" :key="batch" :class="{ active: index === 0 }"><span>{{ String(index + 1).padStart(2, '0') }}</span><div><b>{{ batch }}</b><small>{{ items.length }} 个服务项</small></div></button><div class="pm-tree-note"><b>自动拆解校验</b><p>{{ penetrationPending.length }} 项渗透测试需要专项计划；确认后的服务项进入资源分配。</p></div></article>
            <article class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>纳入</th><th>服务项编号</th><th>场所 / 批次</th><th>检测类别</th><th>技术要求摘要</th><th>体系</th><th>特殊方法</th><th>状态</th></tr></thead><tbody><tr v-for="item in decompositionItems" :key="item.id"><td><input v-model="item.selected" type="checkbox" :aria-label="`纳入 ${item.id}`" /></td><td class="mono"><b>{{ item.id }}</b></td><td>{{ item.site }}<span class="pm-cell-sub">{{ item.batch }}</span></td><td>{{ item.category }}</td><td>{{ item.requirement }}</td><td>{{ item.system }}</td><td><span class="pm-badge" :class="item.special === '是' ? '待确认' : 'neutral'">{{ item.special }}</span></td><td><span class="pm-badge neutral">{{ item.status }}</span></td></tr></tbody></table></div></article>
          </section>
        </template>

        <template v-else-if="activeSection === 'implementation'">
          <section class="pm-board-summary"><div><strong>{{ serviceItems.length }}</strong><span>全部服务项</span></div><div><strong>{{ serviceFlow[2].count }}</strong><span>正在实施</span></div><div><strong>{{ serviceFlow[3].count }}</strong><span>报告编制</span></div><div><strong>{{ serviceFlow[4].count }}</strong><span>现场完成</span></div></section>
          <section class="pm-kanban"><article v-for="column in kanbanColumns" :key="column.key"><header><div><i :class="column.color"></i><b>{{ column.key }}</b></div><span>{{ column.count }}</span></header><div class="pm-kanban-body"><button v-for="card in column.cards" :key="card.id" @click="openProject(card)"><b>{{ card.id }}</b><h3>{{ card.customer }}</h3><div class="pm-inline-progress"><i :style="{ width: `${card.progress}%` }"></i></div><footer><span>{{ card.progress }}%</span><time>{{ card.due || '待排期' }}</time></footer></button><div v-if="!column.cards.length" class="pm-empty-mini">暂无数据</div></div></article></section>
        </template>

        <template v-else-if="['split-rules', 'warning-rules', 'automations', 'permissions'].includes(activeSection)">
          <section class="pm-config-layout"><aside class="pm-config-note"><span><ConsoleIcon name="info" /></span><h2>配置说明</h2><p>{{ currentMeta[1] }}。变更将在保存后对新任务生效，已有项目不自动追溯。</p><ul><li>配置修改需业务管理员权限</li><li>关键规则变更会记录审计日志</li><li>关闭规则前请确认影响范围</li></ul></aside><article class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>配置名称</th><th>适用范围</th><th>触发条件</th><th>状态</th><th>最后更新</th><th></th></tr></thead><tbody><tr v-for="rule in visibleRules" :key="rule.id"><td><b>{{ rule.name }}</b></td><td>{{ rule.scope }}</td><td>{{ rule.trigger }}</td><td><button class="pm-switch" :class="{ on: rule.enabled }" :aria-label="`${rule.enabled ? '停用' : '启用'} ${rule.name}`" @click="toggleRule(rule)"><i></i></button></td><td>{{ rule.updated }}</td><td><button class="pm-link" @click="showToast(`正在编辑：${rule.name}`)">编辑</button></td></tr></tbody></table></div><div v-if="!visibleRules.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无配置规则</b><span>点击“新建规则”添加当前类型的配置。</span></div></article></section>
        </template>

        <template v-else>
          <section class="pm-operational-stats"><article><span>待处理</span><strong>{{ operationRows.filter((r) => !['有效', '已就绪', '校验通过', '已通过', '计划已发布', '专项计划已发布'].includes(r.state)).length }}</strong><small>来自当前工作区</small></article><article><span>处理中</span><strong>{{ operationRows.filter((r) => ['准备中', '编制中', '实施中'].includes(r.state)).length }}</strong><small>按实际状态统计</small></article><article><span>已完成项目</span><strong>{{ completedProjectCount }}</strong><small>当前租户累计</small></article></section>
          <section class="pm-filters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索编号、项目或负责人" /></label><span>{{ operationRows.length }} 条结果</span></section>
          <section class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>事项 / 项目</th><th>内容摘要</th><th>负责人 / 归属</th><th>状态</th><th>完成度</th><th>时限</th><th></th></tr></thead><tbody><tr v-for="row in operationRows" :key="row.name"><td><b>{{ row.name }}</b></td><td>{{ row.detail }}<span v-if="row.warning" class="pm-cell-warning">{{ row.warning }}</span></td><td>{{ row.owner }}</td><td><span class="pm-badge" :class="['阻断', '排期冲突'].includes(row.state) ? '风险' : 'neutral'">{{ row.state }}</span></td><td><div class="pm-inline-progress"><i :style="{ width: `${row.progress}%` }"></i></div><small>{{ row.progress }}%</small></td><td>{{ row.due }}</td><td><button class="pm-link" @click="showToast(`已打开：${row.name}`)">处理</button></td></tr></tbody></table></div><div v-if="!operationRows.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无数据</b><span>当前页面尚无待处理事项</span></div></section>
        </template>
      </div>
    </main>

    <div v-if="drawerProject" class="pm-overlay" @click.self="drawerProject = null"><aside class="pm-drawer"><header><div><span>项目详情</span><h2>{{ drawerProject.id }}</h2></div><button class="pm-icon-button" aria-label="关闭" @click="drawerProject = null"><ConsoleIcon name="close" /></button></header><div class="pm-drawer-body"><section class="pm-drawer-hero"><span class="pm-badge" :class="drawerProject.health">{{ drawerProject.health }}</span><h3>{{ drawerProject.customer }}</h3><p>{{ drawerProject.category }}</p><div class="pm-progress"><i :style="{ width: `${drawerProject.progress}%` }"></i></div><b>{{ drawerProject.progress }}% 已完成</b></section><dl><div><dt>合同编号</dt><dd>{{ drawerProject.contract || '—' }}</dd></div><div><dt>服务项数量</dt><dd>{{ drawerProject.services || '—' }}</dd></div><div><dt>负责团队</dt><dd>{{ drawerProject.team || '—' }}</dd></div><div><dt>项目经理</dt><dd>{{ drawerProject.manager || '—' }}</dd></div><div><dt>当前状态</dt><dd>{{ drawerProject.status || '—' }}</dd></div><div><dt>计划完成</dt><dd>{{ drawerProject.due || '—' }}</dd></div></dl><section class="pm-timeline"><h3>最近动态</h3><div v-for="event in projectEvents(drawerProject)" :key="event.id"><i></i><b>{{ eventLabel(event) }}</b><p>{{ event.service_item_id || drawerProject.id }} · 操作人 {{ event.actor_user_id }}</p><time>{{ formatDateTime(event.created_at) }}</time></div><div v-if="!projectEvents(drawerProject).length" class="pm-empty-mini">暂无交付动态</div></section></div><footer><button class="pm-button" @click="drawerProject = null">关闭</button></footer></aside></div>

    <div v-if="createOpen" class="pm-overlay" @click.self="createOpen = false"><form class="pm-dialog" @submit.prevent="saveCreate"><header><div><span>CREATE</span><h2>{{ activeSection === 'projects' ? '新建项目' : '新建配置规则' }}</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="createOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>名称 <em>*</em></span><input v-model.trim="createForm.name" required :placeholder="activeSection === 'projects' ? '请输入项目名称' : '请输入规则名称'" /></label><template v-if="activeSection === 'projects'"><label><span>客户 <em>*</em></span><input v-model.trim="createForm.customer" required placeholder="请输入客户名称" /></label><label><span>合同编号 <em>*</em></span><input v-model.trim="createForm.contract" required placeholder="例如 HT-2026-0416" /></label><label><span>负责人</span><input v-model.trim="createForm.manager" :placeholder="currentUserName" /></label></template><template v-else><label><span>适用范围 <em>*</em></span><input v-model.trim="createForm.scope" required placeholder="请输入适用范围" /></label><label><span>触发条件</span><input v-model.trim="createForm.trigger" placeholder="请输入触发条件" /></label></template><label><span>备注</span><textarea v-model.trim="createForm.notes" rows="4" placeholder="补充说明（选填）"></textarea></label></div><footer><button type="button" class="pm-button" @click="createOpen = false">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></footer></form></div>
    <Transition name="pm-toast"><div v-if="toastMessage" class="pm-toast"><span>✓</span>{{ toastMessage }}</div></Transition>
  </div>
</template>
