<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, logoutCurrentSession } from '@/modules/platform/auth/api/auth'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import SearchableSelect from '@/modules/project_management/components/SearchableSelect.vue'
import ServiceItemPicker from '@/modules/project_management/components/ServiceItemPicker.vue'
import { implementationPlanReady, projectAllowsWorkflowNode } from '@/modules/project_management/workflowNode'
import { subsystemAccessMessage } from '@/modules/shared/authz/sessionCompatibility'
import { closeSubsystemTabOrFallback } from '@/modules/shared/utils/returnToPortal'
import {
  adjustDecomposition,
  confirmServiceItems as confirmServiceItemsRequest,
  createProject,
  createRule,
  getDashboard,
  getProjectSession,
  getProjectNavigation,
  listProjects,
  listCapabilities,
  upsertCapability,
  importCapabilities,
  exportCapabilities,
  syncPersonnelIdentities,
  listEquipment,
  upsertEquipment,
  deleteEquipment,
  listDeliveryEvents,
  listApplicationRoles,
  listRuleConfigurationCatalog,
  listRules,
  listSlaOverdue,
  getSplitPolicy,
  saveSplitPolicy,
  listDetectionCategories,
  saveDetectionCategory,
  deleteDetectionCategory,
  listSplitOverrides,
  saveSplitOverride,
  importDetectionCategories,
  deleteSplitOverride,
  listServiceItems,
  listPersonnel,
  listQualifiedPersonnel,
  listEquipmentReservations,
  returnServiceItemEquipment,
  resolvePersonnelNames,
  assignTeam,
  assignExecutionTeam,
  revokeTeamAssignment,
  returnServiceItemToDecomposition,
  revokeExecutionAssignment,
  revokeImplementationPlan,
  revokePreparation,
  requestRollback,
  decideRollback,
  withdrawRollback,
  planImplementation,
  startImplementationPreparation,
  submitFieldRecord,
  uploadServiceItemEvidence,
  registerReportArtifact,
  reportDeviation,
  reviewDeviation,
  completeServiceItemField,
  setRuleEnabled,
  updateRule,
  deleteRule,
  reviewSpecialMethod,
  updateReportStatus,
  listApprovedContracts,
} from '@/modules/project_management/api/projectManagement'
import '@/modules/project_management/styles/project-management.css'

const route = useRoute()
const router = useRouter()

// 这五类治理规则共用同一配置工作台，侧边栏只保留一个入口，避免与页内标签重复。
// sectionKeys 仍保留服务端下发的细粒度栏目：入口是否可见、默认落点以及页内权限
// 都以服务端 navigation 为准，旧的栏目深链接也继续有效。
const configurationCenterSections = Object.freeze([
  'capability-codes',
  'warning-rules',
  'automations',
  'permissions',
  'sla',
])

const allNavGroups = [
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
    { key: 'equipment', label: '设备能力', icon: 'settings' },
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
    { key: 'split-rules', label: '合同拆解规则', icon: 'settings' },
    { key: 'configuration-center', label: '规则配置中心', icon: 'shield', sectionKeys: configurationCenterSections },
  ] },
]

const pageMeta = {
  dashboard: ['项目执行总览', '全集团项目交付、资源与风险态势'],
  monitoring: ['在途项目 · 实时监控', '在途项目的里程碑、交付进度与资源状态'],
  projects: ['项目列表', '统一管理项目、合同来源、服务项及交付状态'],
  project_detail: ['项目详情', '合同来源、服务项拆解、实施计划与交付动态全景'],
  decomposition: ['服务项拆解确认', '核对合同范围与自动拆解结果，确认后进入任务分配'],
  allocation: ['任务分配', '按团队负载与专业能力完成服务项下达'],
  inbox: ['分配待办收件箱', '处理指派给我的项目与服务项'],
  planning: ['现场实施计划制定', '编排现场窗口、里程碑及交付节奏'],
  preparation: ['实施准备', '集中核验授权、资料、工具与出行准备'],
  qualifications: ['资质与能力管理', '维护人员资质与能力标签，以及设备检定有效期'],
  equipment: ['设备能力维护', '新增、停用、检定和更新设备基础信息'],
  assignments: ['匹配校验与冲突预警', '校验人员、设备、资质与计划冲突'],
  methods: ['特殊方法复核待办', '复核非标准方法的适用性与风险控制'],
  implementation: ['实施看板 · 进度总览', '按状态跟踪服务项现场执行与闭环进度'],
  exceptions: ['异常评审 · 偏离上报', '处理现场偏离、阻塞与整改回路'],
  standards: ['检测标准变更评估', '统一登记标准或方法变更及其影响范围，完成评估后归档'],
  reports: ['报告编制状态维护', '衔接实施完成、报告编制、复核与签发'],
  'split-rules': ['合同拆解规则配置', '默认分组规则 + 检测类别域 + 覆盖规则：合同生效后自动生成服务项的分组与初始状态口径'],
  'capability-codes': ['资质 / 能力编码配置', '按人员资质与设备能力分类维护可选编码，停用编码仅保留历史引用'],
  'warning-rules': ['冲突预警规则配置', '配置资质与能力校验冲突的触发类型与数量阈值'],
  automations: ['自动化触发配置', '维护真实交付事件触发的角色站内通知'],
  permissions: ['字段级权限配置', '按角色隐藏服务端返回的敏感字段'],
  sla: ['状态 SLA 配置', '配置项目状态流转的时限与超期提醒策略'],
}

const activeSection = computed(() => pageMeta[route.params.section] ? route.params.section : 'dashboard')
const navigation = ref({ sections: [], default_section: '' })
// 导航角标与原型一致：待办数量由工作区数据实时派生，可见性仍以服务端 navigation 为准。
const navBadges = computed(() => ({
  decomposition: decompositionItems.value.length,
  inbox: inboxItems.value.length,
  exceptions: pendingDeviations.value.length,
}))
const visibleNavGroups = computed(() => {
  const allowed = new Set(navigation.value.sections)
  return allNavGroups
    .map((group) => ({
      ...group,
      items: group.items
        .map((item) => {
          const targetSection = item.sectionKeys?.find((section) => allowed.has(section)) || item.key
          const visible = item.sectionKeys ? item.sectionKeys.some((section) => allowed.has(section)) : allowed.has(item.key)
          return visible ? { ...item, targetSection, badge: navBadges.value[item.key] || '' } : null
        })
        .filter(Boolean),
    }))
    .filter((group) => group.items.length)
})
function isNavItemActive(item) {
  return item.sectionKeys ? item.sectionKeys.includes(activeSection.value) : activeSection.value === item.key
}
function navigateNavItem(item) {
  navigate(item.targetSection || item.key)
}
const collapsedNavGroups = ref(new Set())
function navGroupContainsActiveItem(group) {
  return group.items.some((item) => isNavItemActive(item))
}
function isNavGroupCollapsed(group) {
  return collapsedNavGroups.value.has(group.label)
}
function toggleNavGroup(group) {
  const next = new Set(collapsedNavGroups.value)
  if (next.has(group.label)) next.delete(group.label)
  else next.add(group.label)
  collapsedNavGroups.value = next
}
// 默认只展开当前路由所属分组，让完整导航在常用桌面高度内可见；用户仍可按需展开其它分组。
watch([activeSection, () => navigation.value.sections.join('|')], () => {
  const groups = visibleNavGroups.value
  collapsedNavGroups.value = new Set(groups.filter((group) => !navGroupContainsActiveItem(group)).map((group) => group.label))
}, { immediate: true })
const currentMeta = computed(() => pageMeta[activeSection.value])
const mobileMenuOpen = ref(false)
const keyword = ref('')
const statusFilter = ref('')
const categoryFilter = ref('')
const teamFilter = ref('')
const selectedRows = ref([])
const createOpen = ref(false)
const notificationOpen = ref(false)
const toastMessage = ref('')
const toastType = ref('success')
const isLoggingOut = ref(false)
const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
const emptyServiceLink = () => ({ system: '', systemLevel: '', category: '' })
const createForm = ref({ name: '', customer: '', contract: '', contractID: '', contractVersion: '', site: '', requirement: '', testMode: 'STANDARD', serviceLinks: [emptyServiceLink()], scope: '', trigger: '', notes: '' })
const approvedContracts = ref([])
const equipment = ref([])
const equipmentError = ref('')
const equipmentForm = ref({ resourceID: '', resourceName: '', codes: [], originalCodes: [], validFrom: '', validUntil: '', status: 'ACTIVE', usageScope: 'ANY' })
const dashboard = ref({ project_count: 0, in_flight_projects: 0, risk_projects: 0, pending_project_creation: 0, pending_project_creation_available: false, service_items: 0, status_counts: {} })
// SLA 超期/临近项来自服务端 GET /delivery/sla-overdue，口径由后端统一计算（计划完成超期 + 状态停留超期/临近）。
const slaOverdueItems = ref([])
// 同一服务项可能同时命中「计划完成超期」与「状态停留超期」两条口径，列表里保留两行（口径不同），
// 但计数按服务项去重，否则一个服务项会被算成两条，指标虚高。
const slaOverdueItemCount = computed(() => new Set(slaOverdueItems.value.map((item) => item.id)).size)
const session = ref(null)
const lastUpdatedAt = ref(null)
let toastTimer = 0

// 线性节点必须与服务端 domain.ProjectStatusNodes 完全一致；两个分支状态由同一后端状态机返回。
// 服务端按项目全部服务项派生唯一状态，前端只做展示，不得再自行推导阶段。
const projectStatusNodes = ['待拆解确认', '待分配', '待实施', '实施准备中', '实施中', '异常处理中', '现场实施完成', '报告编制', '已完成']
const projectStatusFilters = [...projectStatusNodes, '补充协议处理中', '已终止']
const projectStatusCompleted = '已完成'

const projects = ref([])

const filteredProjects = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return projects.value.filter((project) => {
    const matchKeyword = !query || [project.id, project.customer, project.contract, project.category, project.manager].join(' ').toLowerCase().includes(query)
    return matchKeyword
      && (!statusFilter.value || project.status === statusFilter.value)
      && (!categoryFilter.value || project.category === categoryFilter.value)
      && (!teamFilter.value || project.team === teamFilter.value)
  })
})
// 项目表分页。后端列表接口已支持 page/page_size（返回 items+total），但类别/团队
// 筛选目前仍在前端完成，因此这里先对筛选后的结果分页；筛选下推到服务端后可直接
// 切换到服务端分页，无需改动表格结构。
const projectPage = ref(1)
const projectPageSize = 20
const projectPageCount = computed(() => Math.max(1, Math.ceil(filteredProjects.value.length / projectPageSize)))
const pagedProjects = computed(() => {
  const start = (projectPage.value - 1) * projectPageSize
  return filteredProjects.value.slice(start, start + projectPageSize)
})
function gotoProjectPage(page) {
  projectPage.value = Math.min(Math.max(1, page), projectPageCount.value)
}
// 筛选条件变化后回到第一页，避免停留在越界页码上看到空表。
watch([keyword, statusFilter, categoryFilter, teamFilter], () => { projectPage.value = 1 })

const categoryOptions = computed(() => [...new Set(projects.value.map((p) => p.category).filter(Boolean))])
const teamOptions = computed(() => [...new Set(projects.value.map((p) => p.team).filter(Boolean))])
const inFlightProjects = computed(() => projects.value.filter((p) => p.status !== projectStatusCompleted))
// 风险口径由服务端统一派生（domain.IsRiskProject）：派生状态为异常处理中/已终止，
// 或项目内存在已终止服务项。前端不再复刻该规则——此前前后端各写一遍，
// 口径一旦调整（例如把"部分终止"纳入风险）就会出现两处不一致。
const isRiskProject = (project) => Boolean(project && project.risk)
const riskProjectCount = computed(() => projects.value.filter(isRiskProject).length)
const doneProjectCount = computed(() => projects.value.filter((p) => p.status === projectStatusCompleted).length)
const pendingDecompositionCount = computed(() => projects.value.filter((p) => p.status === '待拆解确认').length)
const averageProgress = computed(() => {
  const raw = projects.value.length ? projects.value.reduce((sum, p) => sum + (p.progress || 0), 0) / projects.value.length : 0
  return Math.round(raw)
})
function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  d.setHours(0, 0, 0, 0)
  return d
}
function dateKey(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3)
  const firstThursday = d.getTime()
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((firstThursday - yearStart) / 86400000 + 1) / 7)
}
const completedDeliveryEvents = computed(() => deliveryEvents.value.filter((event) => event.type === 'FIELD_COMPLETED'))
const weeklyDeliveryTrend = computed(() => {
  const monday = startOfWeek(new Date())
  const weeks = []
  for (let offset = 11; offset >= 0; offset--) {
    const weekStart = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - offset * 7)
    weeks.push({ key: dateKey(weekStart), label: `W${isoWeekOf(weekStart)}`, total: 0, scheduled: 0, onTime: 0 })
  }
  const byKey = Object.fromEntries(weeks.map((week) => [week.key, week]))
  const plannedEndByItem = new Map(serviceItems.value.map((item) => [item.id, item.planned_end]))
  for (const event of completedDeliveryEvents.value) {
    const week = byKey[dateKey(startOfWeek(new Date(event.created_at)))]
    if (!week) continue
    week.total += 1
    const plannedEnd = plannedEndByItem.get(event.service_item_id)
    if (plannedEnd) {
      week.scheduled += 1
      if (new Date(plannedEnd) >= new Date(event.created_at)) week.onTime += 1
    }
  }
  return weeks.map((week) => ({
    ...week,
    rate: week.scheduled ? Math.round((week.onTime / week.scheduled) * 100) : 0,
    tooltip: week.total ? `${week.label} 完成 ${week.total} 项 · 已排期 ${week.scheduled} 项 · 准时 ${week.onTime} 项` : `${week.label} 暂无完成记录`,
  }))
})
const onTimeRecentAverage = computed(() => {
  const recent = weeklyDeliveryTrend.value.slice(-4).filter((week) => week.scheduled)
  return recent.length ? Math.round(recent.reduce((sum, week) => sum + week.rate, 0) / recent.length) : null
})
const categoryDist = computed(() => {
  const counts = new Map()
  for (const item of serviceItems.value) {
    const category = item.category || '未分类'
    counts.set(category, (counts.get(category) || 0) + 1)
  }
  const palette = ['#0ea5e9', '#8b5cf6', '#d97706', '#dc2626', '#f59e0b', '#16a34a', '#64748b']
  const total = serviceItems.value.length || 1
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count], index) => ({ name, count, pct: Math.round((count / total) * 100), color: palette[index % palette.length] }))
  const others = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(6)
  if (others.length) entries.push({ name: '其他', count: others.reduce((sum, [, count]) => sum + count, 0), pct: Math.round((others.reduce((sum, [, count]) => sum + count, 0) / total) * 100), color: palette[6] })
  return entries
})
const categoryDonutStyle = computed(() => {
  const total = serviceItems.value.length
  if (!total) return 'conic-gradient(#e2e8f0 0 100%)'
  let acc = 0
  const stops = categoryDist.value.map((segment) => { const from = acc; acc += (segment.count / total) * 100; return `${segment.color} ${from}% ${Math.min(acc, 100)}%` })
  return `conic-gradient(${stops.join(', ')})`
})
const teamUtilization = computed(() => {
  const teamByProject = new Map(projects.value.map((project) => [project.id, project.team || '未归属']))
  const active = serviceItems.value.filter((item) => !['已完成', '已终止', '终止'].includes(item.status))
  const counts = new Map()
  for (const item of active) {
    const team = teamByProject.get(item.project_id) || '未归属'
    counts.set(team, (counts.get(team) || 0) + 1)
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const total = active.length || 1
  return entries.map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 100) }))
})
const concentratedTeam = computed(() => {
  const activeCount = serviceItems.value.filter((item) => !['已完成', '已终止', '终止'].includes(item.status)).length
  if (activeCount < 5) return null
  const top = teamUtilization.value[0]
  return top && top.pct >= 40 ? top : null
})
const monitoredProjects = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return inFlightProjects.value.filter((p) => {
    const matchKeyword = !query || [p.id, p.customer, p.team, p.manager].join(' ').toLowerCase().includes(query)
    return matchKeyword && (!teamFilter.value || p.team === teamFilter.value)
  })
})
// 服务项状态色调：取自服务项自身状态，供状态分布表的徽标复用。
// 状态字段统一胶囊语义映射：所有状态渲染统一经 statusTone 取色调，
// 语义与 V1.1 原型 crm-badge 对齐（待处理=amber、推进=violet、进行=blue、完成=green、异常=red、停用=gray）。
const statusToneMap = {
  待拆解确认: 'amber', 待确认: 'amber', 待复核: 'amber', 待处理: 'amber', 待评审: 'amber', PENDING: 'amber', 实施中: 'amber',
  待分配: 'blue', 已分配: 'blue', 已审核: 'blue', 已签发: 'blue', 计划已发布: 'blue', REVIEWED: 'blue', ISSUED: 'blue',
  待实施: 'violet', 实施准备中: 'violet', 编制中: 'violet', 报告编制: 'violet', 准备中: 'violet', COMPILING: 'violet',
  异常处理中: '风险', 已终止: '风险', 已驳回: '风险', REJECTED: '风险', MISSING: '风险', CONFLICT: '风险', 能力冲突: '风险', 排期冲突: '风险', 阻断: '风险', TERMINATE: '风险',
  现场实施完成: 'green', 已完成: 'green', 已归档: 'green', ARCHIVED: 'green',
  已通过: 'normal', APPROVED: 'normal', PASSED: 'normal', 校验通过: 'normal', 启用: 'normal', 有效: 'normal', ACTIVE: 'normal', 在公司: 'normal',
  停用: 'neutral', DISABLED: 'neutral', 未提交: 'neutral', 待校验: 'neutral', 待排期: 'neutral', '不在公司（借出中）': 'amber',
}
function statusTone(status) { return statusToneMap[String(status ?? '').trim()] || 'neutral' }
function resetProjectFilters() { keyword.value = ''; statusFilter.value = ''; categoryFilter.value = ''; teamFilter.value = '' }

const serviceItems = ref([])
const deliveryEvents = ref([])
const capabilities = ref([])
const capabilityTypeFilter = ref('')
const capabilityStatusFilter = ref('')
const capabilityDialog = ref(null)
// 新建资质时编号由系统生成：人员 P-0001 / 设备 EQ-0001，编辑既有记录时保持原编号。
const capabilityAutoID = ref(false)
const importResult = ref(null)
const qualificationFileInput = ref(null)
// 资质列表受标签页（全部/人员/设备）与类型、状态筛选共同约束；
// 「体系与编码」「到期提醒」两个标签页使用各自的聚合视图，不走本筛选。
const filteredCapabilities = computed(() => capabilities.value
  .filter((item) => (capabilityTab.value === 'all' || capabilityTab.value === 'codes' || capabilityTab.value === 'expiry' || item.resource_type === capabilityTab.value) && (!capabilityTypeFilter.value || item.resource_type === capabilityTypeFilter.value) && (!capabilityStatusFilter.value || item.status === capabilityStatusFilter.value))
  .map((item) => item.resource_type === 'PERSON' ? { ...item, valid_from: '', valid_until: '' } : item))
const canManageResource = computed(() => Array.isArray(session.value?.permissions) && session.value.permissions.includes('project.resource.manage'))
// 设备维护是独立权限码（PUT /equipment → project.device.manage）：站点/资质/规则都按各自
// 权限码门控入口，设备此前没有门控，一旦设备模块对更多角色可见就会变成「能点必 403」。
const canManageDevice = computed(() => Array.isArray(session.value?.permissions) && session.value.permissions.includes('project.device.manage'))
const selectedServiceItemIDs = ref([])
const operationForm = ref({ teamLeadID: '', projectManagerID: '', engineerIDs: '', plannedStart: '', plannedEnd: '', penetrationTestPlan: '', authDocNo: '', authStart: '', authEnd: '', authScope: '', testScope: '', testWindow: '', emergencyContact: '', rollbackPlan: '', reviewComment: '', personnel: [], equipment: [], travelRequestID: '', rawData: '', environment: '', fieldEvidenceFile: null, reportFile: null, deviationDescription: '', deviationEvidenceFile: null, severity: 'MEDIUM', decision: 'RELEASE', comment: '' })
const deviationSeverityOptions = Object.freeze([
  { value: 'LOW', label: '低' },
  { value: 'MEDIUM', label: '中' },
  { value: 'HIGH', label: '高' },
])
const deviationDecisionOptions = Object.freeze([
  { value: 'RELEASE', label: '放行' },
  { value: 'RETEST', label: '重测' },
  { value: 'TERMINATE', label: '终止' },
])

// 各套真实配置表的列与编辑字段元数据。
const fieldPermissionFieldOptions = Object.freeze([
  { value: 'name', label: '项目名称', description: '项目主档' },
  { value: 'customer', label: '客户名称', description: '项目主档、设备预约记录' },
  { value: 'contract', label: '合同编号', description: '项目主档' },
  { value: 'category', label: '检测类别', description: '项目主档、服务项及事件快照' },
  { value: 'team', label: '执行团队', description: '项目主档' },
  { value: 'manager', label: '项目经理（项目展示）', description: '项目主档展示字段' },
  { value: 'due', label: '计划完成时间', description: '项目主档' },
  { value: 'batch', label: '批次', description: '服务项及事件快照' },
  { value: 'site', label: '实施场所', description: '服务项、SLA 超期记录及事件快照' },
  { value: 'requirement', label: '技术要求', description: '服务项及事件快照' },
  { value: 'system', label: '系统名称', description: '服务项及事件快照' },
  { value: 'system_level', label: '系统等级', description: '服务项及事件快照' },
  { value: 'special', label: '特殊方法标记', description: '服务项及事件快照' },
  { value: 'test_mode', label: '测试模式', description: '服务项及事件快照' },
  { value: 'source_service_id', label: '合同服务项来源编号', description: '服务项及事件快照' },
  { value: 'team_lead_id', label: '团队负责人', description: '服务项指派关系及事件快照' },
  { value: 'project_manager_id', label: '项目经理（服务项指派）', description: '服务项指派关系及事件快照' },
  { value: 'engineer_ids', label: '工程师名单', description: '服务项指派关系及事件快照' },
])
const warningRuleCheckTypeOptions = Object.freeze([
  { value: '资质能力冲突', label: '资质能力冲突', description: '人员或设备缺少有效资质 / 能力记录' },
  { value: '能力缺失', label: '能力缺失', description: '人员或设备未覆盖服务项要求的能力编码' },
  { value: '其他冲突', label: '其他冲突', description: '无法归入以上类型的能力校验冲突' },
])
const automationTriggerOptions = ref([])
const slaStatusOptions = ref([])
const ruleConfigurationCatalogError = ref('')
const capabilityTypeOptions = Object.freeze([
  { value: 'PERSON', label: '人员资质', description: '供项目人员能力校验和派工使用' },
  { value: 'EQUIPMENT', label: '设备能力', description: '供实施准备设备能力筛选使用' },
])
// 检测标准变更是现场实施治理台账，不是运行时规则。它保留独立业务入口，不能再作为
// “规则配置中心”的页签重复出现；底层继续复用 standards CRUD，避免迁移既有记录。
const standardChangeMeta = Object.freeze({
  kind: 'standards',
  label: '检测标准变更',
  columns: [{ key: 'scope', label: '变更内容 / 影响范围' }],
  fields: [{ key: 'scope', label: '变更内容及影响范围', field: 'text', required: true, placeholder: '例如国家标准版本更新；影响等保测评类在途项目，需复核检测方法' }],
})
const configKindsMeta = [
  { kind: 'capability-codes', label: '资质 / 能力编码', nameLabel: '资质 / 能力名称', effectNote: '新建或启用后立即进入对应资源类型的可选编码目录；停用只阻止新引用，已有业务记录继续保留。', columns: [{ key: 'scope', label: '编码' }, { key: 'resource_type_label', label: '适用类型' }], fields: [{ key: 'scope', label: '编码', field: 'text', required: true, lockOnEdit: true, placeholder: '例如 CISP / ISO27001 / EQ-SCAN' }, { key: 'check_type', label: '适用类型', field: 'catalog-single', required: true, lockOnEdit: true, options: capabilityTypeOptions, placeholder: '请选择适用类型', searchPlaceholder: '搜索资源类型' }] },
  { kind: 'warning-rules', label: '预警规则', nameLabel: '预警名称', effectNote: '只影响保存后新产生的能力校验冲突事件，不重新生成既有项目的历史告警。', columns: [{ key: 'check_type', label: '检查类型' }, { key: 'threshold', label: '触发数量' }], fields: [{ key: 'check_type', label: '检查类型', field: 'catalog-single', required: true, options: warningRuleCheckTypeOptions, placeholder: '请选择预警检查类型', searchPlaceholder: '搜索检查类型' }, { key: 'threshold', label: '触发数量', field: 'positive-integer', required: true, min: 1 }] },
  { kind: 'automations', label: '自动化动作', nameLabel: '通知规则名称', effectNote: '只监听保存后新产生的交付事件；当前唯一动作是按项目角色发送站内通知，不创建工单或调用外部系统。', columns: [{ key: 'trigger', label: '触发事件' }, { key: 'target_label', label: '通知角色' }], fields: [{ key: 'trigger', label: '触发事件', field: 'catalog-single', required: true, options: automationTriggerOptions.value, placeholder: '请选择真实交付事件', searchPlaceholder: '搜索事件名称或编码' }, { key: 'target', label: '通知角色', field: 'role', required: true }] },
  { kind: 'permissions', label: '字段级权限', nameLabel: '隐藏规则名称', effectNote: '启用后立即影响该角色读取已有和新增项目数据；接口返回对应字段时统一脱敏为 ***。', columns: [{ key: 'role_code', label: '角色' }, { key: 'field_name', label: '字段' }, { key: 'access_level', label: '访问级别' }], fields: [{ key: 'role_codes', label: '角色', field: 'roles', required: true }, { key: 'field_name', label: '字段', field: 'permission-field', required: true, options: fieldPermissionFieldOptions }, { key: 'access_level', label: '访问级别', field: 'catalog-single', required: true, options: [{ value: 'hidden', label: '隐藏（接口返回 ***）' }] }] },
  { kind: 'sla', label: 'SLA 规则', nameLabel: 'SLA 名称', effectNote: '保存或启用后立即按当前服务项进入该状态的时间开始计算；0 小时表示不提前提醒，不改变计划完成时间超期口径。', columns: [{ key: 'status', label: '状态' }, { key: 'deadline_hours', label: '时限(小时)' }, { key: 'remind_hours', label: '提醒(小时)' }], fields: [{ key: 'status', label: '生效状态', field: 'catalog-single', required: true, options: slaStatusOptions.value, placeholder: '请选择服务项状态', searchPlaceholder: '搜索服务项状态' }, { key: 'deadline_hours', label: '时限(小时)', field: 'number', required: true, min: 1 }, { key: 'remind_hours', label: '提前提醒(小时)', field: 'number', required: true, min: 0 }] },
]
// 字段级权限规则由独立权限把关（服务端 ruleKindPermission 要求 project.field_permission.manage）：
// 只有 project_rule.manage 的角色不该看到这个页签，否则页面能打开、提交必然 403。
const visibleConfigKinds = computed(() => configKindsMeta.filter((meta) => meta.kind !== 'permissions' || canManageFieldPermissions.value))
// 页签被隐藏时不能只靠 activeSection 判断：那样配置页仍会打开，表头取回退后的首个可见
// 配置、列表却按被隐藏的 kind 过滤，得到一张标题与内容不符的空表；「新建规则」也会为
// 隐藏的 kind 建档。因此页签、面板与入口统一以可见集合为准。
const isStandardChangeSection = computed(() => activeSection.value === standardChangeMeta.kind)
const isVisibleConfigSection = computed(() => isStandardChangeSection.value || visibleConfigKinds.value.some((meta) => meta.kind === activeSection.value))
const activeConfigMeta = computed(() => isStandardChangeSection.value ? standardChangeMeta : visibleConfigKinds.value.find((meta) => meta.kind === activeSection.value) || visibleConfigKinds.value[0])
const configEditorOpen = ref(false)
const configForm = ref({})
// 字段隐藏与自动通知共用服务端角色目录，浏览器不维护第二份角色码。
const applicationRoles = ref([])
const applicationRolesError = ref('')
let applicationRolesRequest = null
function loadApplicationRoles() {
  if (applicationRoles.value.length) return Promise.resolve()
  if (applicationRolesRequest) return applicationRolesRequest
  applicationRolesRequest = listApplicationRoles()
    .then((roles) => { applicationRoles.value = roles; applicationRolesError.value = ''; rules.value = rules.value.map(decorateRule) })
    .catch((error) => { applicationRolesError.value = error?.message || '角色目录加载失败' })
    .finally(() => { applicationRolesRequest = null })
  return applicationRolesRequest
}
const configRoleSelection = computed(() => (Array.isArray(configForm.value.role_codes) ? configForm.value.role_codes : []))
// 已保存的角色可能已不在目录内（历史错值或目录调整）：补一条并标注，避免编辑时被静默改写。
const configRoleOptions = computed(() => {
  const options = [...applicationRoles.value]
  const known = new Set(options.map((option) => option.code))
  const selectedCodes = [...configRoleSelection.value, String(configForm.value.target || '').trim()].filter(Boolean)
  for (const code of selectedCodes) {
    if (code && !known.has(code)) { options.push({ code, name: `${code}（不在角色目录中）` }); known.add(code) }
  }
  return options
})
function defaultConfigFieldValue(field) {
  if (field.field === 'roles') return []
  if (field.key === 'access_level') return 'hidden'
  if (field.field === 'positive-integer') return '1'
  if (field.field === 'number') {
    if (field.key === 'deadline_hours') return 24
    if (field.key === 'remind_hours') return 4
    return field.min || 0
  }
  return ''
}
function configNamePlaceholder() {
  if (activeSection.value === 'standards') return '例如检测方法国家标准版本更新'
  return ['warning-rules', 'automations', 'sla'].includes(activeSection.value) ? '选择生效条件后自动生成，可按需修改' : `请输入${activeConfigMeta.value.nameLabel || '配置名称'}`
}
function onConfigFieldChange(field, value) {
  if (String(configForm.value.name || '').trim()) return
  if (activeSection.value === 'warning-rules' && field.key === 'check_type') configForm.value.name = `${value}预警`
  if (activeSection.value === 'sla' && field.key === 'status') configForm.value.name = `${value} SLA`
  if (activeSection.value === 'automations') {
    const trigger = automationTriggerOptions.value.find((option) => option.value === configForm.value.trigger)?.label
    const role = applicationRoles.value.find((option) => option.code === configForm.value.target)?.name
    if (trigger && role) configForm.value.name = `${trigger} → 通知${role}`
  }
}
function configUsesRoleCatalog() {
  return activeConfigMeta.value.fields.some((field) => field.field === 'roles' || field.field === 'role')
}
function configFieldDisabled(field) {
  return Boolean(configForm.value.id && field.lockOnEdit)
}
function openConfigCreate() {
  configForm.value = { id: null, kind: activeSection.value, name: '', enabled: true }
  for (const field of activeConfigMeta.value.fields) {
    configForm.value[field.key] = defaultConfigFieldValue(field)
  }
  // 打开配置弹窗时收起页面上仍在使用旧式组件的设备/检测编码菜单；角色选择器
  // 自身随弹窗挂载，始终从收起态开始。
  openMulti.value = ''
  if (configUsesRoleCatalog()) loadApplicationRoles()
  configEditorOpen.value = true
}
function openConfigEdit(rule) {
  configForm.value = { ...rule, name: rule.name || '', enabled: rule.enabled !== false, kind: rule.kind || activeSection.value }
  openMulti.value = ''
  if (activeConfigMeta.value.fields.some((field) => field.field === 'roles')) {
    configForm.value.role_codes = rule.role_code ? [rule.role_code] : []
    // 历史 view/edit 规则从未进入运行时判定；编辑时收口为唯一真实生效的 hidden，
    // 避免继续展示“保存成功但没有权限效果”的配置。
    configForm.value.access_level = 'hidden'
    loadApplicationRoles()
  }
  if (configUsesRoleCatalog()) loadApplicationRoles()
  configEditorOpen.value = true
}
function applySavedRule(saved) {
  // 规则分表的自增 ID 可以重复，因此列表回填必须以 kind + id 作为联合身份。
  const index = rules.value.findIndex((rule) => rule.kind === saved.kind && rule.id === saved.id)
  const normalized = decorateRule(saved)
  if (index >= 0) rules.value.splice(index, 1, normalized)
  else rules.value.push(normalized)
}
async function saveConfigRule() {
  saving.value = true
  try {
    const name = String(configForm.value.name || '').trim()
    if (!name) { showToast('请填写配置名称', 'warning'); return }
    const payload = { kind: configForm.value.kind, name, enabled: configForm.value.enabled }
    let roleCodes = []
    let roleField = false
    for (const field of activeConfigMeta.value.fields) {
      if (field.field === 'roles') { roleField = true; roleCodes = configRoleSelection.value; continue }
      payload[field.key] = typeof configForm.value[field.key] === 'number' ? configForm.value[field.key] : String(configForm.value[field.key] || '').trim()
    }
    if (payload.kind === 'warning-rules') {
      if (!warningRuleCheckTypeOptions.some((option) => option.value === payload.check_type)) { showToast('请选择有效的检查类型', 'warning'); return }
      const threshold = Number(payload.threshold)
      if (!Number.isInteger(threshold) || threshold < 1) { showToast('触发数量必须是大于等于 1 的整数', 'warning'); return }
      payload.threshold = String(threshold)
    }
    if (payload.kind === 'automations') {
      if (!automationTriggerOptions.value.some((option) => option.value === payload.trigger)) { showToast('请选择有效的触发事件', 'warning'); return }
      if (!applicationRoles.value.some((option) => option.code === payload.target)) { showToast('请选择项目系统角色作为通知目标', 'warning'); return }
    }
    if (payload.kind === 'sla') {
      if (!slaStatusOptions.value.some((option) => option.value === payload.status)) { showToast('请选择有效的服务项状态', 'warning'); return }
      const deadline = Number(payload.deadline_hours)
      const remind = Number(payload.remind_hours)
      if (!Number.isInteger(deadline) || deadline < 1) { showToast('时限小时必须是大于等于 1 的整数', 'warning'); return }
      if (!Number.isInteger(remind) || remind < 0 || remind >= deadline) { showToast('提前提醒小时必须大于等于 0 且小于时限小时', 'warning'); return }
      payload.deadline_hours = deadline
      payload.remind_hours = remind
    }
    if (roleField && !roleCodes.length) { showToast('请至少选择一个角色', 'warning'); return }
    if (roleField) {
      // 服务端 field_permission 按 role_code 与主体角色做精确比对，一条规则只承载一个角色，
      // 因此多选即「每个选中角色各存一条」，role_code 仍是目录内的单个规范角色码。
      // 编辑时首个角色沿用原规则 ID，新增的角色各建一条；每建一条即刻回填列表，
      // 中途失败也能看到已生效的那几条，不会重试出重复规则。
      const created = []
      for (const [index, roleCode] of roleCodes.entries()) {
        const body = { ...payload, role_code: roleCode }
        const saved = index === 0 && configForm.value.id ? await updateRule(configForm.value.id, body) : await createRule(body)
        applySavedRule(saved)
        created.push(saved)
      }
      configEditorOpen.value = false
      showToast(created.length > 1 ? `已保存 ${created.length} 条配置（每个角色一条）` : '配置已保存')
      return
    }
    const saved = configForm.value.id ? await updateRule(configForm.value.id, payload) : await createRule(payload)
    applySavedRule(saved)
    configEditorOpen.value = false
    showToast(payload.kind === 'standards' ? (configForm.value.id ? '标准变更记录已保存' : '标准变更已登记，进入影响评估') : (configForm.value.id ? '配置已保存' : '配置已创建'))
  } catch (error) { showToast(error?.message || '配置保存失败', 'error') }
  finally { saving.value = false }
}

// ---- 合同拆解规则配置 v2（原型 PG-CFG-01）-------------------------------------
// 三块配置：默认分组规则 / 检测类别（服务类型）域 / 覆盖规则。
// 页面只负责呈现与提交，分组与初始状态的判定完全在服务端（激活合同与拆解调整共用同一套口径）。
// 进页面即渲染表单，先用后端 domain.DefaultSplitPolicy 的同款默认值兜底，
// 避免首帧 splitPolicy 为 null 时对 null 取属性。
const splitPolicy = ref({
  dimension_primary: 'batch',
  dimension_secondary: 'category',
  dimension_tertiary: '',
  default_status: '待确认',
  generate_requirement_summary: true,
  requirement_summary_locked: false,
  missing_rule_action: 'HUMAN_CONFIRM',
  scope_change_detection: true,
  enabled: true,
})
const splitPolicySaving = ref(false)
const detectionCategories = ref([])
const splitOverrides = ref([])
const splitConfigLoading = ref(false)
const splitConfigError = ref('')
const categoryDialog = ref(null)
const overrideDialog = ref(null)
const splitPolicyBaseline = ref('')

// 维度取值与原型一致：维度 1 取清单/项目侧字段，维度 2/3 另可含服务项属性。
const splitDimensionPrimaryOptions = [
  { value: 'batch', label: '批次（默认）' },
  { value: 'site', label: '场所' },
  { value: 'customer', label: '客户' },
  { value: 'contract', label: '合同' },
]
const splitDimensionSecondaryOptions = [
  { value: 'category', label: '检测类别（默认）' },
  { value: 'system_standard', label: '体系要求' },
  { value: 'test_mode', label: '方法类型' },
]
const splitDimensionAnyOptions = [...splitDimensionPrimaryOptions, ...splitDimensionSecondaryOptions]
const splitDefaultStatusOptions = [
  { value: '待确认', label: '待确认（默认，业务员确认后→待分配）' },
  { value: '待分配', label: '待分配（跳过确认）' },
]
const splitMissingRuleOptions = [
  { value: 'HUMAN_CONFIRM', label: '标记「待人工确认」并通知业务管理员（默认）' },
  { value: 'DEFAULT_RULE', label: '按默认规则生成' },
  { value: 'SILENT', label: '按默认规则生成（不通知，不推荐）' },
]
const specialMethodOptions = [
  { value: 'NO', label: '否' },
  { value: 'MARKABLE', label: '可标记' },
  { value: 'REQUIRED', label: '必为特殊方法' },
]
const specialMethodTone = { NO: 'neutral', MARKABLE: 'violet', REQUIRED: 'violet' }
const specialMethodLabel = Object.fromEntries(specialMethodOptions.map((option) => [option.value, option.label]))
const splitDimensionLabel = Object.fromEntries(splitDimensionAnyOptions.map((option) => [option.value, option.label.replace(/（默认）$/, '')]))
function splitDimensionText(value) { return splitDimensionLabel[value] || value || '—' }
function splitMissingRuleText(value) { return splitMissingRuleOptions.find((option) => option.value === value)?.label.replace(/（默认）|（不通知，不推荐）/, '') || value }

const activeDetectionCategoryCount = computed(() => detectionCategories.value.filter((item) => item.enabled).length)
const activeSplitOverrideCount = computed(() => splitOverrides.value.filter((item) => item.enabled).length)
const splitPolicyDimensions = computed(() => [
  splitPolicy.value?.dimension_primary,
  splitPolicy.value?.dimension_secondary,
  splitPolicy.value?.dimension_tertiary,
].filter(Boolean))
const splitPolicyIssues = computed(() => {
  const issues = []
  const dimensions = splitPolicyDimensions.value
  if (new Set(dimensions).size !== dimensions.length) issues.push('分组维度不能重复，请为每一层选择不同字段')
  if (!splitPolicy.value?.generate_requirement_summary && splitPolicy.value?.requirement_summary_locked) issues.push('未生成技术要求摘要时，不能锁定摘要字段')
  return issues
})
const splitPolicyDirty = computed(() => Boolean(splitPolicyBaseline.value) && JSON.stringify(splitPolicy.value) !== splitPolicyBaseline.value)
const splitPolicySummary = computed(() => {
  if (splitPolicy.value?.enabled === false) return '自定义规则已停用。后续合同将回退到“批次 + 检测类别”的安全默认分组，全部进入“待确认”，且不应用特殊合同覆盖规则。'
  const dimensions = splitPolicyDimensions.value.map(splitDimensionText).join(' + ') || '尚未设置分组维度'
  const status = splitPolicy.value?.default_status || '待确认'
  return `系统按「${dimensions}」合并合同明细，每个组合生成 1 个服务项，并进入「${status}」状态。`
})

function scrollToSplitSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function applyRecommendedSplitPolicy() {
  const recommended = {
    ...splitPolicy.value,
    dimension_primary: 'batch',
    dimension_secondary: 'category',
    dimension_tertiary: '',
    default_status: '待确认',
    generate_requirement_summary: true,
    requirement_summary_locked: false,
    missing_rule_action: 'HUMAN_CONFIRM',
    scope_change_detection: true,
    enabled: true,
  }
  const changed = JSON.stringify(recommended) !== JSON.stringify(splitPolicy.value)
  splitPolicy.value = recommended
  showToast(changed ? '已填入安全推荐配置，请确认后点击保存' : '当前已经是安全推荐配置', changed ? 'info' : 'success')
  scrollToSplitSection('split-policy-section')
}

function resetSplitPolicyChanges() {
  if (!splitPolicyBaseline.value) return
  splitPolicy.value = JSON.parse(splitPolicyBaseline.value)
  showToast('已撤销尚未保存的默认规则修改', 'info')
}

async function loadSplitConfig() {
  splitConfigLoading.value = true
  splitConfigError.value = ''
  try {
    const [policy, categories, overrides] = await Promise.all([getSplitPolicy(), listDetectionCategories(), listSplitOverrides()])
    splitPolicy.value = policy
    splitPolicyBaseline.value = JSON.stringify(policy)
    detectionCategories.value = categories
    splitOverrides.value = overrides
  } catch (error) {
    splitConfigError.value = error?.message || '拆解规则配置加载失败'
  } finally {
    splitConfigLoading.value = false
  }
}

async function submitSplitPolicy() {
  if (!splitPolicy.value || splitPolicySaving.value) return
  if (splitPolicyIssues.value.length) { showToast(splitPolicyIssues.value[0], 'warning'); return }
  if (!splitPolicyDirty.value) { showToast('当前没有需要保存的修改', 'info'); return }
  splitPolicySaving.value = true
  try {
    splitPolicy.value = await saveSplitPolicy(splitPolicy.value)
    splitPolicyBaseline.value = JSON.stringify(splitPolicy.value)
    showToast('默认分组规则已保存，对新合同的拆解生效')
  } catch (error) { showToast(error?.message || '默认分组规则保存失败', 'error') }
  finally { splitPolicySaving.value = false }
}

// 检测类别域 CSV 导出/导入：导出在浏览器侧生成（UTF-8 BOM，Excel 可直接打开），
// 导入走批量接口并把逐行原因回显，避免整批失败。
const detectionCategoryFileInput = ref(null)
const DETECTION_CATEGORY_HEADERS = ['检测类别', '默认体系要求', '必备资质（默认）', '必检能力码', '是否特殊方法', '状态']

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadDetectionCategories() {
  const lines = [DETECTION_CATEGORY_HEADERS.join(',')]
  for (const item of detectionCategories.value) {
    lines.push([
      item.category, item.system_standard, item.required_qualifications, item.required_codes,
      specialMethodLabel[item.special_method] || '', item.enabled ? '启用' : '停用',
    ].map(csvCell).join(','))
  }
  const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `检测类别域-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
  showToast(`已导出 ${detectionCategories.value.length} 条检测类别`)
}

// 逐行解析 CSV：识别表头、忽略空行，特殊方法/状态同时接受中文与枚举值。
function parseDetectionCategoryCSV(text) {
  const rows = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim() !== '')
  if (!lines.length) return rows
  const parseLine = (line) => {
    const cells = []
    let current = ''
    let quoted = false
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]
      if (quoted) {
        if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1 }
        else if (char === '"') quoted = false
        else current += char
      } else if (char === '"') quoted = true
      else if (char === ',') { cells.push(current); current = '' }
      else current += char
    }
    cells.push(current)
    return cells.map((cell) => cell.trim())
  }
  const header = parseLine(lines[0])
  const hasHeader = header.includes('检测类别')
  const body = hasHeader ? lines.slice(1) : lines
  const specialFromText = { 否: 'NO', 可标记: 'MARKABLE', 必为特殊方法: 'REQUIRED', NO: 'NO', MARKABLE: 'MARKABLE', REQUIRED: 'REQUIRED' }
  for (const line of body) {
    const cells = parseLine(line)
    if (!cells.length || !cells[0]) continue
    rows.push({
      category: cells[0],
      system_standard: cells[1] || '',
      required_qualifications: cells[2] || '',
      required_codes: cells[3] || '',
      special_method: specialFromText[cells[4]] || 'NO',
      enabled: (cells[5] || '启用') !== '停用',
    })
  }
  return rows
}

async function importDetectionCategoryFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  saving.value = true
  try {
    const rows = parseDetectionCategoryCSV(await file.text())
    if (!rows.length) { showToast('CSV 里没有可导入的检测类别', 'warning'); return }
    const result = await importDetectionCategories(rows)
    detectionCategories.value = await listDetectionCategories()
    showToast(result?.skipped ? `导入完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条` : `导入完成：成功 ${result?.imported ?? 0} 条`)
    if (result?.errors?.length) splitConfigError.value = `导入跳过原因：${result.errors.slice(0, 3).join('；')}`
  } catch (error) { showToast(error?.message || 'CSV 导入失败', 'error') }
  finally { saving.value = false }
}

function openCategoryDialog(item = null) {
  categoryDialog.value = item
    ? { ...item }
    : { category: '', system_standard: '', required_qualifications: '', required_codes: '', special_method: 'NO', enabled: true }
  openMulti.value = ''
}

async function submitDetectionCategory() {
  if (!categoryDialog.value) return
  saving.value = true
  try {
    await saveDetectionCategory({ ...categoryDialog.value, required_codes: detectionRequiredCodeSelection.value.join(',') })
    categoryDialog.value = null
    detectionCategories.value = await listDetectionCategories()
    showToast('检测类别已保存')
  } catch (error) { showToast(error?.message || '检测类别保存失败', 'error') }
  finally { saving.value = false }
}

async function removeDetectionCategory(item) {
  if (saving.value) return
  if (!window.confirm(`确认删除检测类别「${item.category}」？仍被服务项引用的类别不能删除，可改为禁用。`)) return
  saving.value = true
  try {
    await deleteDetectionCategory(item.category)
    detectionCategories.value = await listDetectionCategories()
    showToast(`检测类别「${item.category}」已删除`)
  } catch (error) { showToast(error?.message || '检测类别删除失败', 'error') }
  finally { saving.value = false }
}

function openOverrideDialog(item = null) {
  overrideDialog.value = item
    ? { ...item, match: { ...item.match_conditions }, settings: { ...item.override_settings } }
    : { name: '', match: { customer_contains: '', contract_contains: '', max_service_items: 0 }, settings: {}, priority: 100, enabled: true }
}

function overrideMatchText(item) {
  const parts = []
  if (item.match_conditions?.customer_contains) parts.push(`客户名称包含 ${item.match_conditions.customer_contains}`)
  if (item.match_conditions?.contract_contains) parts.push(`合同号包含 ${item.match_conditions.contract_contains}`)
  if (item.match_conditions?.max_service_items) parts.push(`合同服务项数 ≤ ${item.match_conditions.max_service_items}`)
  if (item.match_conditions?.min_service_items) parts.push(`合同服务项数 ≥ ${item.match_conditions.min_service_items}`)
  if ((item.match_conditions?.categories || []).length) parts.push(`检测类别包含 ${item.match_conditions.categories.join(' / ')}`)
  return parts.join(' 且 ') || '—'
}

function overrideSettingsText(item) {
  const settings = item.override_settings || {}
  const parts = []
  const dims = [settings.dimension_primary, settings.dimension_secondary, settings.dimension_tertiary].filter(Boolean)
  if (dims.length) parts.push(`分组维度 = ${dims.map(splitDimensionText).join(' + ')}`)
  if (settings.default_status) parts.push(`默认进入状态 = ${settings.default_status}`)
  if (settings.generate_requirement_summary === false) parts.push('技术要求摘要留空人工填写')
  if (settings.generate_requirement_summary === true) parts.push('生成技术要求摘要')
  if (settings.requirement_summary_locked === true) parts.push('技术要求摘要锁定')
  if (settings.missing_rule_action) parts.push(`缺规则处理 = ${splitMissingRuleText(settings.missing_rule_action)}`)
  if (settings.scope_change_detection === false) parts.push('范围变更检测关闭')
  return parts.join('；') || '—'
}

// 空字符串代表"不覆盖"，必须从载荷里剔除：服务端把非 null 的空串当成非法维度取值。
function compactOverrideSettings(settings) {
  const compact = {}
  for (const [key, value] of Object.entries(settings || {})) {
    if (value === undefined || value === null || value === '') continue
    compact[key] = value
  }
  return compact
}

function compactOverrideMatch(match) {
  const compact = {}
  for (const [key, value] of Object.entries(match || {})) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && !value.length) continue
    compact[key] = value
  }
  return compact
}

async function submitSplitOverride() {
  if (!overrideDialog.value) return
  saving.value = true
  try {
    await saveSplitOverride({
      ...overrideDialog.value,
      match: compactOverrideMatch(overrideDialog.value.match),
      settings: compactOverrideSettings(overrideDialog.value.settings),
    })
    overrideDialog.value = null
    splitOverrides.value = await listSplitOverrides()
    showToast('覆盖规则已保存')
  } catch (error) { showToast(error?.message || '覆盖规则保存失败', 'error') }
  finally { saving.value = false }
}

async function removeSplitOverride(item) {
  if (saving.value) return
  if (!window.confirm(`确认删除覆盖规则「${item.name}」？删除后该合同将回到默认分组规则。`)) return
  saving.value = true
  try {
    await deleteSplitOverride(item.id)
    splitOverrides.value = await listSplitOverrides()
    showToast(`覆盖规则「${item.name}」已删除`)
  } catch (error) { showToast(error?.message || '覆盖规则删除失败', 'error') }
  finally { saving.value = false }
}

const reportStatusLabel = { NONE: '待编制', COMPILING: '编制中', REVIEWED: '已审核', ISSUED: '已签发', ARCHIVED: '已归档' }
// SLA 口径标签与剩余/超期文案：与后端 domain.SlaKind* 常量对齐。
const slaKindLabel = { PLAN_END_OVERDUE: '计划完成超期', STATUS_DEADLINE_OVERDUE: '状态停留超期', STATUS_DEADLINE_APPROACHING: '状态临近超期' }
function slaDueLabel(item) {
  const hours = Number(item.overdue_hours || 0)
  if (item.kind === 'STATUS_DEADLINE_APPROACHING') return `剩余 ${hours} 小时`
  return `已超期 ${hours} 小时`
}
const reportStatusRank = { COMPILING: 1, REVIEWED: 2, ISSUED: 3, ARCHIVED: 4 }
const reportPhaseNext = { NONE: 'COMPILING', COMPILING: 'REVIEWED', REVIEWED: 'ISSUED', ISSUED: 'ARCHIVED' }
const reportItems = computed(() => serviceItems.value.filter((item) => {
  const projectStatus = projectByID.value.get(item.project_id)?.status
  return ['现场实施完成', '报告编制', '已完成'].includes(projectStatus) && (item.status === '现场实施完成' || (item.report_status && item.report_status !== 'NONE'))
}))
const reportTechReviewLabel = (status) => ({ NONE: '未提交', PENDING: '待复核', APPROVED: '已通过', REJECTED: '已驳回' }[status] || '未提交')
const personnelLoading = ref(false)
const personnelError = ref('')
const capabilityPersonnel = ref([])
const capabilityPersonnelLoading = ref(false)
const capabilityPersonnelError = ref('')
const personnelRequestSequence = ref(0)

// 分配候选必须同时满足：项目人员资质有效、平台身份有效、具备对应项目角色。
// 人员日期不限制派工；基础平台目录仍只用于新建资质时选择身份主体。
const PROJECT_ROLE_CODES = Object.freeze({ teamLead: 'team_lead', projectManager: 'project_manager', engineer: 'engineer' })

const emptyPersonnelByRole = () => ({ [PROJECT_ROLE_CODES.teamLead]: [], [PROJECT_ROLE_CODES.projectManager]: [], [PROJECT_ROLE_CODES.engineer]: [] })
const personnelByRole = ref(emptyPersonnelByRole())

async function loadPersonnel() {
  const sequence = ++personnelRequestSequence.value
  personnelLoading.value = true
  personnelError.value = ''
  // 项目经理/工程师只在具备 project.execution.assign 的表单里出现。
  const roles = canExecutionAssign.value
    ? [PROJECT_ROLE_CODES.teamLead, PROJECT_ROLE_CODES.projectManager, PROJECT_ROLE_CODES.engineer]
    : [PROJECT_ROLE_CODES.teamLead]
  try {
    const rolePages = await Promise.all(roles.map(async (roleCode) => {
      // 浏览器内做模糊匹配，因此分别加载对应角色的全部资质候选。
      const firstPage = await listQualifiedPersonnel({ role_code: roleCode, page: 1, page_size: 50 })
      const total = Math.max(Number(firstPage?.total || 0), firstPage?.items?.length || 0)
      const pageCount = Math.ceil(total / 50)
      const remainingPages = pageCount > 1
        ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => listQualifiedPersonnel({ role_code: roleCode, page: index + 2, page_size: 50 })))
        : []
      return { roleCode, pages: [firstPage, ...remainingPages] }
    }))
    if (sequence !== personnelRequestSequence.value) return
    const byRole = emptyPersonnelByRole()
    const names = {}
    for (const { roleCode, pages } of rolePages) {
      const personnelByID = new Map()
      const items = pages.flatMap((page) => Array.isArray(page?.items) ? page.items : [])
      for (const person of items) {
        const id = String(person?.user_id || '').trim()
        if (!id) continue
        const existing = personnelByID.get(id)
        const codes = [...new Set([...(existing?.codes || []), ...(Array.isArray(person.codes) ? person.codes : [])])]
        const resourceID = existing?.resourceID || person.resource_id || ''
        personnelByID.set(id, {
          id,
          name: existing?.name || person.display_name || '未命名人员',
          resourceID,
          codes,
          description: `${resourceID || '资质档案'} · ${codes.join('、') || '未设置资质编码'}`,
        })
        names[id] = personnelByID.get(id).name
      }
      byRole[roleCode] = [...personnelByID.values()]
    }
    personnelByRole.value = byRole
    rememberPersonnelNames(names)
  } catch (error) {
    if (sequence !== personnelRequestSequence.value) return
    personnelByRole.value = emptyPersonnelByRole()
    personnelError.value = error?.message || '人员资质库加载失败'
  } finally {
    if (sequence === personnelRequestSequence.value) personnelLoading.value = false
  }
}

// 人员资质只能从基础平台目录选择主体；名称由服务端再次按 user_id 复核后写入，
// 这里的列表只负责提供单选下拉候选项，不把用户输入的姓名当作身份依据。
async function loadCapabilityPersonnel() {
  capabilityPersonnelLoading.value = true
  capabilityPersonnelError.value = ''
  try {
    const page = await listPersonnel({ page: 1, page_size: 50 })
    capabilityPersonnel.value = (page.items || []).map((person) => ({ id: person.user_id, name: person.display_name || '未命名人员' }))
    rememberPersonnelNames(Object.fromEntries(capabilityPersonnel.value.map((person) => [person.id, person.name])))
  } catch (error) {
    capabilityPersonnel.value = []
    capabilityPersonnelError.value = error?.message || '基础平台人员目录加载失败'
  } finally {
    capabilityPersonnelLoading.value = false
  }
}

const capabilityPersonOptions = computed(() => {
  const options = [...capabilityPersonnel.value]
  const selectedID = capabilityDialog.value?.user_id
  if (selectedID && !options.some((person) => person.id === selectedID)) {
    options.push({ id: selectedID, name: capabilityDialog.value?.resource_name || personnelNameByID.value.get(selectedID) || '当前人员（目录中不可用）' })
  }
  return options
})

function onCapabilityPersonChange() {
  if (!capabilityDialog.value) return
  const person = capabilityPersonOptions.value.find((option) => option.id === capabilityDialog.value.user_id)
  capabilityDialog.value.resource_name = person?.name || ''
}

// 已保存的角色可能不在当前查询结果里（例如任职已调整）；补一条“当前值”选项，避免编辑既有
// 服务项时被静默清空。下拉里也不显示 ULID：姓名尚未解析时用占位符，解析成功后自动变成姓名。
function roleOptions(roleCode, selectedIDs) {
  const options = [...(personnelByRole.value[roleCode] || [])]
  const known = new Set(options.map((option) => option.id))
  for (const id of selectedIDs) {
    if (id && !known.has(id)) {
      options.push({ id, name: personnelNameByID.value.get(id) || '姓名解析中…' })
      known.add(id)
    }
  }
  return options
}
const teamLeadOptions = computed(() => roleOptions(PROJECT_ROLE_CODES.teamLead, [operationForm.value.teamLeadID]))
const projectManagerOptions = computed(() => roleOptions(PROJECT_ROLE_CODES.projectManager, [operationForm.value.projectManagerID]))

// 工程师改为下拉多选：选中结果仍写回逗号分隔的 engineerIDs，保持后端载荷不变。
const engineerSelection = computed({
  get: () => selectedIDs(operationForm.value.engineerIDs),
  set: (values) => { operationForm.value.engineerIDs = values.join(',') },
})
const engineerOptions = computed(() => roleOptions(PROJECT_ROLE_CODES.engineer, engineerSelection.value))
// 工程师使用与团队负责人、项目经理一致的下拉样式：展开后逐项勾选，
// 不要求用户按住 ⌘/Ctrl 做加选，选中结果仍写回逗号分隔的 ID 列表。
// 设备不在任务分配中选取：设备清单在「实施准备」阶段登记。
const openMulti = ref('')
// 键盘可达的多选下拉：↑↓ 移动高亮、Enter 勾选、Esc 关闭（统一交互基线，
// 与设备选择器的"禁用原因"、ServiceItemPicker 的 listbox 语义同源）。
const multiActiveIndex = ref(-1)
function toggleMulti(kind) { openMulti.value = openMulti.value === kind ? '' : kind }
// 人员的选中值是 ID、角色的选中值是角色码，因此选项命中键可指定（默认 id）。
function multiSummary(values, options, placeholder, key = 'id') {
  const names = (values || []).map((value) => options.find((option) => option[key] === value)?.name || value)
  if (!names.length) return placeholder
  if (names.length <= 2) return names.join('、')
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 项`
}
function closeMultiOnOutsideClick(event) {
  if (!(event.target instanceof Element) || !event.target.closest('.pm-multi-dropdown')) openMulti.value = ''
}
// 键盘可达的多选下拉统一走这里：↑↓ 移动高亮、Enter 勾选、Esc 关闭；人员选择器与
// 设备维护和检测规则的旧式多选共用同一套交互基线；字段级权限角色已统一迁移到
// SearchableSelect，由组件处理点击触发、模糊搜索、键盘导航和视口动态定位。
function navigateMulti(event, options, name, toggle) {
  if (event.key === 'Escape') {
    if (openMulti.value === name) { event.stopPropagation(); openMulti.value = ''; multiActiveIndex.value = -1 }
    return
  }
  if (openMulti.value !== name || !options.length) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    multiActiveIndex.value = (multiActiveIndex.value + delta + options.length) % options.length
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const option = options[multiActiveIndex.value]
    if (option && !option.disabled) toggle(option)
  }
}
function onEquipmentCodesKeydown(event) { navigateMulti(event, equipmentCodeOptions.value, 'equipmentCodes', (option) => toggleEquipmentCode(option.code)) }
function onDetectionRequiredCodesKeydown(event) { navigateMulti(event, detectionRequiredCodeOptions.value, 'detectionRequiredCodes', (option) => toggleDetectionRequiredCode(option.code)) }
const projectByID = computed(() => new Map(projects.value.map((project) => [project.id, project])))
const projectStatusForItem = (item) => projectByID.value.get(item?.project_id)?.status || ''
const projectAllowsNode = (item, node) => projectAllowsWorkflowNode(projectStatusForItem(item), node)
// 任务分配只接收“项目和服务项都处于待分配”的记录。任一服务项退回拆解后，服务端会把
// 项目派生状态降为“待拆解确认”；此时即使同项目其它服务项仍残留待分配状态，也必须整体
// 退出任务分配，避免在拆解范围尚未重新确认时继续下达人员。
const allocationItems = computed(() => serviceItems.value.filter((item) => item.status === '待分配' && projectAllowsNode(item, 'allocation')))
const selectedServiceItems = computed(() => {
  const candidates = activeNodeItems.value
  return candidates.filter((item) => selectedServiceItemIDs.value.includes(item.id))
})
const selectedServiceItem = computed(() => selectedServiceItems.value[0] || null)
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
const decompositionItems = computed(() => serviceItems.value.filter((item) => ['待确认', '待复核'].includes(item.status) && projectAllowsNode(item, 'decomposition')))
// 节点列表不能根据“历史上到过该节点”生成。以下事件只保留每个服务项最后一次节点动作，
// 用于区分状态值相同但来源不同的场景，例如首次实施准备与“现场回退到实施准备”。
const workflowNodeEventTypes = new Set([
  'DECOMPOSITION_RETURNED', 'TEAM_ASSIGNED', 'EXECUTION_TEAM_ASSIGNED',
  'IMPLEMENTATION_PLANNED', 'IMPLEMENTATION_PLAN_REVOKED',
  'PREPARATION_STARTED', 'PREPARATION_REVOKED', 'FIELD_RECORD_SUBMITTED',
  'FIELD_COMPLETED', 'ROLLBACK_APPROVED', 'REPORT_STATUS_UPDATED',
])
const latestWorkflowEventByItem = computed(() => {
  const latest = new Map()
  for (const event of deliveryEvents.value) {
    if (!event.service_item_id || !workflowNodeEventTypes.has(event.type)) continue
    const current = latest.get(event.service_item_id)
    const order = `${event.created_at || ''}|${event.id || ''}`
    if (!current || order > current.order) latest.set(event.service_item_id, { event, order })
  }
  return new Map([...latest].map(([id, value]) => [id, value.event]))
})
const latestWorkflowEvent = (item) => latestWorkflowEventByItem.value.get(item?.id)
const inboxItems = computed(() => allocationItems.value.filter((item) => item.team_lead_id && (!item.project_manager_id || !(item.engineer_ids || []).length)))
const planningItems = computed(() => serviceItems.value.filter((item) => {
  // “实施计划”是分配完成后的下一节点。仅有待分配状态远远不够，必须与后端
  // CheckImplementationPlanPrecondition 的责任链、能力校验和特殊方法前置保持一致。
  return projectAllowsNode(item, 'planning') && implementationPlanReady(item)
}))
const preparationItems = computed(() => serviceItems.value.filter((item) => {
  const event = latestWorkflowEvent(item)
  if (item.status === '待实施') return projectAllowsNode(item, 'preparation')
  return projectAllowsNode(item, 'preparation') && item.status === '实施准备中' && event?.type === 'ROLLBACK_APPROVED' && event.payload?.kind === 'FIELD_TO_PREPARATION'
}))
const implementationItems = computed(() => serviceItems.value.filter((item) => {
  const event = latestWorkflowEvent(item)
  if (item.status === '实施中') return projectAllowsNode(item, 'implementation')
  return projectAllowsNode(item, 'implementation') && item.status === '实施准备中' && event?.type === 'PREPARATION_STARTED'
}))
const implementationProjectCount = computed(() => new Set(implementationItems.value.map((item) => item.project_id)).size)
const preparedImplementationCount = computed(() => implementationItems.value.filter((item) => item.status === '实施准备中').length)
const fieldImplementationCount = computed(() => implementationItems.value.filter((item) => item.status === '实施中').length)
const exceptionItems = computed(() => serviceItems.value.filter((item) => item.status === '异常处理中' && projectAllowsNode(item, 'exceptions')))
const exceptionItemIDs = computed(() => new Set(exceptionItems.value.map((item) => item.id)))
const pendingDeviations = computed(() => deliveryEvents.value.filter((event) => event.type === 'DEVIATION_REPORTED' && exceptionItemIDs.value.has(event.service_item_id) && !reviewedDeviationIDs.value.has(event.payload?.deviation_id)))
const methodItems = computed(() => serviceItems.value.filter((item) => projectAllowsNode(item, 'methods') && item.status === '待分配' && item.special === '是' && ['PENDING', 'REJECTED'].includes(item.tech_review_status)))
const assignmentItems = computed(() => allocationItems.value.filter((item) => item.team_lead_id && item.conflict_status !== 'PASSED'))
const activeNodeItems = computed(() => ({
  allocation: allocationItems.value,
  inbox: inboxItems.value,
  planning: planningItems.value,
  preparation: preparationItems.value,
  assignments: assignmentItems.value,
  methods: methodItems.value,
  exceptions: exceptionItems.value,
  reports: reportItems.value,
  implementation: implementationItems.value,
}[activeSection.value] || serviceItems.value))
const penetrationPending = computed(() => serviceItems.value.filter((item) => item.test_mode === 'PENETRATION' && !item.planned_start))
const notificationCount = computed(() => pendingDeviations.value.length + decompositionItems.value.length + inboxItems.value.length)
const activeServiceCount = computed(() => serviceItems.value.filter((item) => !['现场实施完成', '已完成', '已终止'].includes(item.status)).length)
const completedProjectCount = computed(() => projects.value.filter((project) => project.status === projectStatusCompleted).length)
const currentUserName = computed(() => session.value?.display_name || session.value?.user_name || '当前用户')
// 与客户与商机系统的账号行保持一致：首字头像 + 账号名 + 角色名。
// 角色名取服务端角色目录，目录未就绪或请求失败时退回角色码，不出现空白副标题。
const currentUserInitial = computed(() => {
  const label = currentUserName.value
  return /^[\x00-\x7F]+$/.test(label) ? label.slice(0, 2).toUpperCase() : Array.from(label)[0] || '用'
})
const currentUserRoleLabel = computed(() => {
  const roles = Array.isArray(session.value?.roles) ? session.value.roles : []
  const names = new Map(applicationRoles.value.map((role) => [role.code, role.name]))
  return [...new Set(roles.map((role) => names.get(role) || role).filter(Boolean))].join('、') || '未分配角色'
})
// 团队负责人 / 项目经理 / 工程师在界面上必须显示姓名而不是平台 ULID。
// 目录只支持单个 user_id 查询，所以由服务端批量解析，这里缓存映射避免重复请求。
const personnelNameByID = ref(new Map())
const personnelNameError = ref('')

// personLabel 渲染单个人员；personListLabel 渲染工程师这类多人字段。
// 解析不到时显示占位符而不是回退成 ULID：对业务用户来说 ID 没有任何信息量。
function personLabel(userID, fallback = '待指派') {
  const id = String(userID || '').trim()
  if (!id) return fallback
  return personnelNameByID.value.get(id) || '—'
}
function personListLabel(ids, fallback = '未指派') {
  const list = (Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)
  if (!list.length) return fallback
  return list.map((id) => personnelNameByID.value.get(id) || '—').join('、')
}
function rememberPersonnelNames(names = {}) {
  const merged = new Map(personnelNameByID.value)
  let changed = false
  for (const [id, name] of Object.entries(names)) {
    const key = String(id || '').trim()
    const value = String(name || '').trim()
    if (key && value && merged.get(key) !== value) { merged.set(key, value); changed = true }
  }
  if (changed) personnelNameByID.value = merged
}

const canExecutionAssign = computed(() => Array.isArray(session.value?.permissions) && session.value.permissions.includes('project.execution.assign'))
// 项目创建是高影响动作：除 project.create 外，仅超级管理员（admin）和业务管理员可发起。
// 与服务端 mayCreateProject 同口径，避免其他角色被误授权限码后在界面上出现入口。
const projectCreationRoles = new Set(['admin', 'business_admin'])
const canCreateProject = computed(() => {
  if (!Array.isArray(session.value?.permissions) || !session.value.permissions.includes('project.create')) return false
  const roles = Array.isArray(session.value?.roles) ? session.value.roles : []
  return roles.some((role) => projectCreationRoles.has(role))
})
// 其余写操作入口同样用服务端同款权限码门控：只门控少数几个权限码时，
// 未授权角色会看到自己无权执行的按钮，点击必然 403。
const permissionSet = computed(() => new Set(Array.isArray(session.value?.permissions) ? session.value.permissions : []))
const canAssignTeam = computed(() => permissionSet.value.has('project.team.assign'))
const canRevokeTeam = computed(() => permissionSet.value.has('project.team.revoke'))
const canRevokeExecution = computed(() => permissionSet.value.has('project.execution.revoke'))
const canRevokeImplementation = computed(() => permissionSet.value.has('project.implementation.revoke'))
const canRequestRollback = computed(() => permissionSet.value.has('project.rollback.request'))
const canApproveRollback = computed(() => permissionSet.value.has('project.rollback.approve'))
const canPlanImplementation = computed(() => permissionSet.value.has('project.implementation.plan'))
const canExecuteField = computed(() => permissionSet.value.has('project.field.execute'))
const canCompleteField = computed(() => permissionSet.value.has('project.field.complete'))
const canReportDeviation = computed(() => permissionSet.value.has('project.deviation.report'))
const canReviewDeviation = computed(() => permissionSet.value.has('project.deviation.review'))
const canManageRules = computed(() => permissionSet.value.has('project_rule.manage'))
const canManageFieldPermissions = computed(() => permissionSet.value.has('project.field_permission.manage'))
const canReviewSpecialMethod = computed(() => permissionSet.value.has('project.special_method.review'))
// 确认拆解与调整拆解是两个独立权限，不能共用：服务端 POST /service-items/confirm
// 由 service_item.confirm 把关，POST /projects/:id/decomposition-adjustments 由
// project.decomposition.manage 把关。二者合并门控会让只有其中一个权限的角色看到
// 「点击必然 403」的按钮。
const canConfirmDecomposition = computed(() => permissionSet.value.has('service_item.confirm'))
// 拆解调整需要独立权限：业务管理员据此发起补充协议并重建服务项清单。
const canManageDecomposition = computed(() => permissionSet.value.has('project.decomposition.manage'))
const reportPhasePermission = { COMPILING: 'project.report.prepare', REVIEWED: 'project.report.review', ISSUED: 'project.report.issue', ARCHIVED: 'project.report.archive' }
const canAdvanceReportPhase = (phase) => permissionSet.value.has(reportPhasePermission[phase])
// 分配动作由两个权限之一触发：业务管理员用 team.assign，团队负责人用 execution.assign。
const canSubmitAllocation = computed(() => canAssignTeam.value || canExecutionAssign.value)
// 服务端在"发布实施计划"时强校验前置状态。这里提前把"还差哪一步"说清楚并禁用主按钮，
// 避免用户填完整张表单才被拒绝（规范原则④：不允许「点了才报错」，且必须给可执行替代方案）。
// tone 按规范 §2.5 取色：能力冲突=red，其余"待处理"=amber。
const planningBlocked = computed(() => {
  const item = selectedServiceItem.value
  if (!item) return null
  if (item.status !== '待分配') {
    return { tone: 'warn', reason: `服务项当前状态为「${item.status}」，不能发布实施计划。` }
  }
  if (!item.project_manager_id) return { tone: 'warn', reason: '请先在「任务分配」中指派项目经理、工程师与设备。' }
  if (item.conflict_status === 'CONFLICT') return { tone: 'danger', reason: '当前人员或设备能力存在冲突，请调整分配后重新校验。' }
  if (item.conflict_status !== 'PASSED') return { tone: 'warn', reason: `请先在「任务分配」中完成能力校验（当前状态：${conflictStatusLabel(item.conflict_status)}）。` }
  if (item.special === '是' && item.tech_review_status !== 'APPROVED') {
    return { tone: 'warn', reason: '该服务项为特殊方法，需先通过技术总监复核后才能发布实施计划。' }
  }
  return null
})
const lastUpdatedLabel = computed(() => lastUpdatedAt.value ? lastUpdatedAt.value.toLocaleString() : '尚未加载')
const serviceFlow = computed(() => [
  { key: '待分配', color: 'slate', count: allocationItems.value.length, route: 'allocation' },
  { key: '待实施', color: 'violet', count: preparationItems.value.length, route: 'preparation' },
  { key: '实施中', color: 'amber', count: implementationItems.value.length, route: 'implementation' },
  { key: '报告编制', color: 'blue', count: reportItems.value.filter((item) => item.report_status !== 'ARCHIVED').length, route: 'reports' },
  { key: '已完成', color: 'green', count: serviceItems.value.filter((item) => item.report_status === 'ARCHIVED' || (['现场实施完成', '已完成'].includes(item.status) && (!item.report_status || item.report_status === 'NONE'))).length, route: 'implementation' },
])
const selectedDecompositionProjectID = ref('')
const decompositionProjects = computed(() => [...new Set(decompositionItems.value.map((item) => item.project_id))].map((id) => projectByID.value.get(id)).filter(Boolean))
watch(decompositionProjects, (items) => {
  if (!items.some((item) => item.id === selectedDecompositionProjectID.value)) selectedDecompositionProjectID.value = items[0]?.id || ''
}, { immediate: true })
const currentDecompositionItems = computed(() => decompositionItems.value.filter((item) => item.project_id === selectedDecompositionProjectID.value))
const decompositionProject = computed(() => projectByID.value.get(selectedDecompositionProjectID.value) || null)
const canConfirmCurrentDecomposition = computed(() => currentDecompositionItems.value.some((item) => item.selected))
const decompositionBatches = computed(() => Object.entries(currentDecompositionItems.value.reduce((groups, item) => { const key = item.batch || '未设置批次'; (groups[key] ||= []).push(item); return groups }, {})))
const riskRows = computed(() => [
  ...pendingDeviations.value.map((event) => { const item = itemByID.value.get(event.service_item_id); const project = projectByID.value.get(item?.project_id); return { id: event.id, level: event.payload?.severity === 'HIGH' ? '高' : '中', project: `${project?.id || item?.project_id || '未知项目'} · ${project?.customer || item?.site || '现场任务'}`, issue: event.payload?.description || '现场偏离待评审', owner: personLabel(event.actor_user_id, '待认领'), deadline: formatDateTime(event.created_at) } }),
  ...serviceItems.value.filter((item) => item.conflict_status === 'CONFLICT').map((item) => { const project = projectByID.value.get(item.project_id); return { id: `conflict-${item.id}`, level: '高', project: `${item.project_id} · ${project?.customer || item.site}`, issue: `${item.id} 人员或设备能力冲突`, owner: personLabel(item.project_manager_id || item.team_lead_id, '待分配'), deadline: item.planned_start?.slice(0, 10) || '待处理' } }),
].slice(0, 10))

// 现场实施页不是全生命周期总览，只展示真正处于现场实施节点的项目。
// 拆解、分配、计划、准备、异常和报告项目分别留在各自工作区，不能在这里提前出现或继续残留。
const implementationKanbanColumns = computed(() => [
  { key: '准备完成', color: 'violet', statuses: ['实施准备中'] },
  { key: '现场实施', color: 'amber', statuses: ['实施中'] },
].map((column) => {
  // 看板与操作列表必须共用同一节点归属结果，不能只看项目状态。尤其现场回退到
  // 实施准备后，项目状态仍是“实施准备中”，但最新事件已把它归还准备节点。
  const projectIDs = new Set(implementationItems.value
    .filter((item) => column.statuses.includes(item.status))
    .map((item) => item.project_id))
  const cards = projects.value.filter((project) => projectIDs.has(project.id))
  return { ...column, cards, count: cards.length }
}))

const operationRows = computed(() => ({
  monitoring: projects.value.slice(0, 5).map((p) => ({ id: p.id, name: `${p.id} · ${p.customer}`, detail: p.category, owner: p.manager, state: p.status, progress: p.progress, due: p.due })),
  allocation: allocationItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.category}`, detail: `${s.site} / ${s.batch}`, warning: stampedContractStateByProject.value.get(s.project_id) === false ? '未上传盖章合同' : '', owner: personLabel(s.team_lead_id, '待分配团队负责人'), state: s.conflict_status === 'CONFLICT' ? '能力冲突' : s.team_lead_id ? '已分配' : '待分配', progress: s.project_manager_id ? 100 : s.team_lead_id ? 50 : 0, due: s.planned_end?.slice(0, 10) || '待排期' })),
  inbox: inboxItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${projectByID.value.get(s.project_id)?.customer || s.site}`, detail: s.project_manager_id ? '实施工程师待指派' : '项目经理待指派', owner: personLabel(s.team_lead_id, '—'), state: '待处理', progress: s.project_manager_id ? 50 : 0, due: s.planned_start?.slice(0, 10) || '待排期' })),
  planning: planningItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.site}`, detail: s.test_mode === 'PENETRATION' ? '渗透测试专项计划' : '现场实施计划', owner: personLabel(s.project_manager_id, '待指派项目经理'), state: latestWorkflowEvent(s)?.type === 'IMPLEMENTATION_PLAN_REVOKED' ? '已撤销，待重新制定' : '待制定计划', progress: 0, due: '待排期' })),
  preparation: preparationItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.site}`, detail: s.status === '实施准备中' ? '现场已回退，请重新核验设备与行程' : '实施计划已发布，待准备', owner: personLabel(s.project_manager_id, '待指派项目经理'), state: s.status, progress: s.status === '实施准备中' ? 50 : 0, due: s.planned_end?.slice(0, 10) || '待排期' })),
  qualifications: capabilities.value.map((c) => ({ id: c.resource_id, name: c.resource_name, detail: c.codes, owner: c.resource_type === 'PERSON' ? '人员资质' : '设备能力', state: c.status === 'ACTIVE' ? '有效' : c.status, progress: c.status === 'ACTIVE' ? 100 : 0, due: c.resource_type === 'PERSON' ? '不限制' : c.valid_until?.slice(0, 10) || '长期' })),
  assignments: assignmentItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.site}`, detail: `${s.engineer_ids?.length || 0} 人 / ${(s.implementation_plan?.equipment || []).length} 台设备`, owner: personLabel(s.project_manager_id), state: s.conflict_status === 'CONFLICT' ? '排期冲突' : '待校验', progress: 30, due: '待排期' })),
  methods: methodItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.category}`, detail: `${s.site} / ${s.system || '—'}`, owner: personLabel(s.project_manager_id), state: reportTechReviewLabel(s.tech_review_status), progress: s.tech_review_status === 'PENDING' ? 50 : 0, due: s.planned_end?.slice(0, 10) || '待排期', review: s.tech_review_status, comment: s.tech_review_comment, reviewedAt: s.tech_reviewed_at })),
  exceptions: pendingDeviations.value.map((e) => ({ id: e.id, name: `${e.payload?.deviation_id} · ${e.service_item_id}`, detail: e.payload?.description || '现场偏离', owner: personLabel(e.actor_user_id, '—'), state: '待评审', progress: 0, due: formatDateTime(e.created_at) })),
  standards: [],
  reports: reportItems.value.map((item) => { const project = projectByID.value.get(item.project_id); return { id: item.id, name: `${item.id} · ${item.site}`, detail: `${project?.customer || item.project_id} / 报告${reportStatusLabel[item.report_status] || item.report_status}`, owner: personLabel(item.project_manager_id, project?.manager || '待指派'), state: reportStatusLabel[item.report_status] || item.report_status, progress: (reportStatusRank[item.report_status] || 0) * 25, due: item.report_updated_at ? item.report_updated_at.slice(0, 10) : item.planned_end?.slice(0, 10) || '待排期', report_status: item.report_status } }),
}[activeSection.value] || []))

const rules = ref([])
function decorateRule(rule) {
  const targetRole = applicationRoles.value.find((role) => role.code === rule.target)
  return { ...rule, resource_type_label: rule.check_type === 'PERSON' ? '人员资质' : rule.check_type === 'EQUIPMENT' ? '设备能力' : rule.check_type, target_label: targetRole?.name || rule.target }
}
const visibleRules = computed(() => rules.value.filter((rule) => rule.kind === activeSection.value))

// 资质 / 能力编码由租户级系统配置统一供给人员资质和设备能力表单。
// 已停用或已删除但仍被历史档案引用的编码会补回到选项并显式标记，
// 避免编辑其他字段时把历史编码静默丢失。
const capabilityCodeCatalog = computed(() => rules.value.filter((rule) => rule.kind === 'capability-codes' && String(rule.scope || '').trim()))
function capabilityCodeKey(code) { return String(code || '').trim().toUpperCase() }
function canonicalCapabilityCodes(resourceType, codes) {
  const configured = new Map(capabilityCodeCatalog.value
    .filter((rule) => rule.check_type === resourceType && rule.enabled)
    .map((rule) => [capabilityCodeKey(rule.scope), String(rule.scope).trim()]))
  return (codes || []).map((code) => configured.get(capabilityCodeKey(code)) || String(code || '').trim()).filter(Boolean)
}
function capabilityCodeOptions(resourceType, selectedCodes = []) {
  const catalog = capabilityCodeCatalog.value.filter((rule) => rule.check_type === resourceType)
  const options = catalog
    .filter((rule) => rule.enabled)
    .map((rule) => ({ code: String(rule.scope).trim(), name: `${String(rule.scope).trim()} · ${rule.name}`, unavailable: false }))
    .sort((a, b) => a.code.localeCompare(b.code, 'zh-CN'))
  const activeKeys = new Set(options.map((option) => capabilityCodeKey(option.code)))
  const catalogByCode = new Map(catalog.map((rule) => [capabilityCodeKey(rule.scope), rule]))
  for (const selected of selectedCodes || []) {
    const code = String(selected || '').trim()
    const key = capabilityCodeKey(code)
    if (!code || activeKeys.has(key)) continue
    const configured = catalogByCode.get(key)
    options.push({
      code,
      name: `${code} · ${configured?.name || '历史编码'}`,
      unavailable: true,
      unavailableReason: configured ? '已停用' : '不在当前编码目录',
    })
    activeKeys.add(key)
  }
  return options
}
const equipmentCodeSelection = computed({
  get: () => Array.isArray(equipmentForm.value.codes) ? equipmentForm.value.codes : selectedIDs(equipmentForm.value.codes),
  set: (values) => { equipmentForm.value.codes = [...values] },
})
const equipmentCodeOptions = computed(() => capabilityCodeOptions('EQUIPMENT', equipmentCodeSelection.value))
const capabilityCodeSelection = computed({
  get: () => Array.isArray(capabilityDialog.value?.codes) ? capabilityDialog.value.codes : selectedIDs(capabilityDialog.value?.codes),
  set: (values) => { if (capabilityDialog.value) capabilityDialog.value.codes = [...values] },
})
const capabilityDialogCodeOptions = computed(() => capabilityCodeOptions(capabilityDialog.value?.resource_type || 'PERSON', capabilityCodeSelection.value))
const detectionRequiredCodeSelection = computed({
  get: () => canonicalCapabilityCodes('PERSON', selectedIDs(categoryDialog.value?.required_codes)),
  set: (values) => { if (categoryDialog.value) categoryDialog.value.required_codes = values.join(',') },
})
// 检测类别的 required_codes 只用于分配工程师时的人员能力校验，
// 因此只提供 PERSON 编码；历史停用/删除值仍显式回显。
const detectionRequiredCodeOptions = computed(() => capabilityCodeOptions('PERSON', detectionRequiredCodeSelection.value))
function hasActiveCapabilityCodes(resourceType) {
  return capabilityCodeCatalog.value.some((rule) => rule.check_type === resourceType && rule.enabled)
}
function toggleCodeSelection(selection, update, code) {
  const selected = new Map(selection.map((value) => [capabilityCodeKey(value), value]))
  const key = capabilityCodeKey(code)
  if (selected.has(key)) selected.delete(key)
  else selected.set(key, code)
  update([...selected.values()])
}
function toggleEquipmentCode(code) { toggleCodeSelection(equipmentCodeSelection.value, (values) => { equipmentCodeSelection.value = values }, code) }
function toggleDetectionRequiredCode(code) { toggleCodeSelection(detectionRequiredCodeSelection.value, (values) => { detectionRequiredCodeSelection.value = values }, code) }
function validateCapabilityCodes(resourceType, codes, originalCodes = []) {
  if (!codes.length) { showToast('请至少选择一个资质 / 能力编码', 'warning'); return false }
  const original = new Set(originalCodes.map(capabilityCodeKey))
  const invalidAdded = capabilityCodeOptions(resourceType, codes).filter((option) => option.unavailable && !original.has(capabilityCodeKey(option.code)))
  if (invalidAdded.length) { showToast(`不能新增已停用或不在目录的编码：${invalidAdded.map((option) => option.code).join('、')}`, 'warning'); return false }
  return true
}

// 原型 PG-RES-04 的七步交付链：按当前服务项的真实状态与人员/计划数据判定，
// 只读展示，不引入任何本地状态机。
const operationSteps = computed(() => {
  const item = selectedServiceItem.value
  if (!item) return []
  const plan = item.implementation_plan || {}
  const preparing = ['实施准备中', '实施中', '异常处理中', '现场实施完成', '报告编制', '已完成'].includes(item.status)
  const executing = ['实施中', '异常处理中', '现场实施完成', '报告编制', '已完成'].includes(item.status)
  const closing = ['现场实施完成', '报告编制', '已完成'].includes(item.status)
  return [
    { label: '拆解确认', state: item.status === '待确认' || item.status === '待复核' ? 'doing' : 'done' },
    { label: '分配至团队', state: item.team_lead_id ? 'done' : 'idle' },
    { label: '指派人员', state: item.project_manager_id && (item.engineer_ids || []).length ? 'done' : item.team_lead_id ? 'doing' : 'idle' },
    { label: '制定实施计划', state: item.planned_start ? 'done' : item.status === '待分配' ? 'doing' : 'idle' },
    { label: '实施准备', state: preparing ? 'done' : item.planned_start ? 'doing' : 'idle' },
    { label: '现场实施', state: executing ? 'done' : 'idle' },
    { label: '完成确认', state: closing ? 'done' : 'idle', note: plan.planned_end ? `计划至 ${String(plan.planned_end).slice(0, 10)}` : '' },
  ]
})

// 原型 PG-IMP-10 的报告阶段链：COMPILING→REVIEWED→ISSUED→ARCHIVED。
const reportSteps = computed(() => {
  const item = selectedServiceItem.value
  const current = reportStatusRank[item?.report_status] || 0
  return [
    { phase: 'COMPILING', label: '报告编制' },
    { phase: 'REVIEWED', label: '报告审核' },
    { phase: 'ISSUED', label: '报告签发' },
    { phase: 'ARCHIVED', label: '报告归档' },
  ].map((step, index) => ({ ...step, state: index + 1 < current ? 'done' : index + 1 === current ? 'doing' : 'idle' }))
})

// 监控页（PG-DASH-02）：状态分布条 + 胶囊筛选。口径为服务端派生项目状态，
// 不再使用已删除的人工状态字段。
const monitorFilter = ref('')
const monitorFilterTabs = computed(() => [
  { key: '', label: '全部' },
  { key: 'risk', label: '风险' },
  { key: '实施中', label: '实施中' },
  { key: '报告编制', label: '报告编制' },
])
const monitoredStatusMix = computed(() => {
  const buckets = [
    { key: '推进中', tone: 'var(--pm-green)', statuses: ['待拆解确认', '待分配', '待实施', '实施准备中'] },
    { key: '实施中', tone: 'var(--pm-primary)', statuses: ['实施中'] },
    { key: '异常处理', tone: 'var(--pm-red)', statuses: ['异常处理中'] },
    { key: '收尾归档', tone: 'var(--pm-violet)', statuses: ['现场实施完成', '报告编制'] },
    { key: '已终止', tone: 'var(--pm-gray)', statuses: ['已终止'] },
  ]
  const total = inFlightProjects.value.length || 1
  return buckets.map((bucket) => {
    const count = inFlightProjects.value.filter((project) => bucket.statuses.includes(project.status)).length
    return { ...bucket, count, pct: Math.round((count / total) * 100) }
  }).filter((bucket) => bucket.count)
})
const monitoredStatusByProject = (status) => monitoredStatusMix.value.find((bucket) => bucket.statuses.includes(status))?.key || status
const filteredMonitoredProjects = computed(() => {
  if (!monitorFilter.value) return monitoredProjects.value
  if (monitorFilter.value === 'risk') return monitoredProjects.value.filter((project) => project.risk)
  return monitoredProjects.value.filter((project) => project.status === monitorFilter.value)
})

// 资质与能力（PG-RES-06）：全部 / 人员 / 设备 / 体系与编码 / 到期提醒 标签页。
const capabilityTab = ref('all')
// 30 天内到期或已过期的设备检定，按到期时间升序；人员资质不受日期限制。
const expiringCapabilities = computed(() => {
  const horizon = Date.now() + 30 * 86400000
  return capabilities.value
    .filter((item) => item.resource_type === 'EQUIPMENT' && item.valid_until && new Date(item.valid_until).getTime() <= horizon)
    .sort((a, b) => new Date(a.valid_until) - new Date(b.valid_until))
})
// 体系映射：按能力编码聚合持有该编码的人员数与设备数（真实台账推导，不引入静态映射表）。
const capabilityCodeRows = computed(() => {
  const rows = new Map()
  for (const item of capabilities.value) {
    for (const code of item.codes || []) {
      const row = rows.get(code) || { code, personCount: 0, equipmentCount: 0 }
      if (item.resource_type === 'PERSON') row.personCount += 1
      else row.equipmentCount += 1
      rows.set(code, row)
    }
  }
  return [...rows.values()].sort((a, b) => (b.personCount + b.equipmentCount) - (a.personCount + a.equipmentCount))
})
const capabilityTabs = computed(() => [
  { key: 'all', label: '全部', count: capabilities.value.length },
  { key: 'PERSON', label: '人员资质', count: capabilities.value.filter((item) => item.resource_type === 'PERSON').length },
  { key: 'EQUIPMENT', label: '设备能力', count: capabilities.value.filter((item) => item.resource_type === 'EQUIPMENT').length },
  { key: 'codes', label: '体系与编码', count: capabilityCodeRows.value.length },
  { key: 'expiry', label: '设备到期提醒', count: expiringCapabilities.value.length },
])

// 特殊方法复核（PG-RES-08）：待复核表 + 复核历史表（历史来自服务端事件流）。
const methodHistory = computed(() => deliveryEvents.value.filter((event) => event.type === 'SPECIAL_METHOD_REVIEWED'))

// 异常评审（PG-IMP-06）：按偏离编号串联上报 → 评审 → 结论的审批流节点。
const selectedDeviation = computed(() => {
  const wanted = String(operationForm.value.deviationID || '').trim()
  return pendingDeviations.value.find((event) => event.payload?.deviation_id === wanted) || pendingDeviations.value[0] || null
})
const exceptionFlow = computed(() => {
  const deviation = selectedDeviation.value
  if (!deviation) return []
  const item = itemByID.value.get(deviation.service_item_id)
  const reviewed = deliveryEvents.value.find((event) => event.type === 'DEVIATION_REVIEWED' && event.payload?.deviation_id === deviation.payload?.deviation_id)
  const decision = reviewed?.payload?.decision
  const decisionLabel = { RELEASE: '放行 · 继续实施', RETEST: '重测 · 退回实施前', TERMINATE: '终止服务项' }[decision] || '待结论'
  return [
    { title: personLabel(deviation.actor_user_id, '现场工程师'), when: `${formatDateTime(deviation.created_at)} · 上报`, note: `偏离编号 ${deviation.payload?.deviation_id || '—'} · ${deviation.payload?.severity || '未分级'}`, state: 'done' },
    { title: personLabel(item?.team_lead_id, '团队负责人'), when: reviewed ? formatDateTime(reviewed.created_at) : '评审中', note: reviewed ? decisionLabel : '放行 / 重测 / 终止', state: reviewed ? 'done' : 'doing' },
    { title: '技术总监', when: decision === 'TERMINATE' ? '需复核' : '按需介入', note: decision === 'TERMINATE' ? '终止决策需技术总监复核' : '重大异常升级复核', state: decision === 'TERMINATE' ? 'done' : 'idle' },
    { title: '结论归档', when: decision ? '已归档' : '待定', note: decisionLabel, state: decision ? 'done' : 'idle' },
  ]
})

// 配置页（PG-CFG 系列）：顶部 KPI 由当前 kind 的规则统计派生。
const configStats = computed(() => {
  const kindRules = rules.value.filter((rule) => rule.kind === activeSection.value)
  return {
    total: kindRules.length,
    enabled: kindRules.filter((rule) => rule.enabled).length,
    disabled: kindRules.filter((rule) => !rule.enabled).length,
  }
})
// 字段级权限矩阵（PG-CFG-04）：字段 × 角色，取值 hidden/edit/view，空格表示未配置。
const permissionMatrix = computed(() => {
  const permRules = rules.value.filter((rule) => rule.kind === 'permissions')
  const roles = [...new Set(permRules.map((rule) => rule.role_code).filter(Boolean))]
  const fields = [...new Set(permRules.map((rule) => rule.field_name).filter(Boolean))]
  const levelFor = (field, role) => permRules.find((rule) => rule.field_name === field && rule.role_code === role)?.access_level || ''
  return {
    roles,
    rows: fields.map((field) => ({ field, cells: roles.map((role) => levelFor(field, role)) })),
  }
})
const permissionLevelLabel = { hidden: '隐藏', edit: '可编辑', view: '只读' }
const permissionLevelTone = { hidden: '风险', edit: '关注', view: 'normal' }

const operationDetail = ref(null)
const operationSectionLabel = (section) => ({
  allocation: '任务分配', inbox: '实施收件箱', planning: '现场实施计划制定', preparation: '实施准备',
  assignments: '匹配校验与冲突预警', methods: '特殊方法复核待办', qualifications: '资质与能力管理',
  exceptions: '偏离评审', reports: '报告与收尾', monitoring: '执行总览',
}[section] || '事项详情')
function openOperationDetail(row) {
  const section = activeSection.value
  let record = null
  if (['allocation', 'inbox', 'planning', 'preparation', 'assignments', 'methods', 'reports'].includes(section)) record = serviceItems.value.find((item) => item.id === row.id) || null
  else if (section === 'qualifications') record = capabilities.value.find((cap) => cap.resource_id === row.id) || capabilities.value.find((cap) => cap.resource_name === row.name) || null
  else if (section === 'exceptions') record = deliveryEvents.value.find((event) => event.id === row.id) || null
  else if (['monitoring'].includes(section)) record = projects.value.find((project) => project.id === row.id) || null
  operationDetail.value = { section, row: { ...row }, record }
}
const operationDetailFields = computed(() => {
  const detail = operationDetail.value
  if (!detail) return []
  const record = detail.record || {}
  const section = detail.section
  if (['allocation', 'inbox', 'planning', 'preparation', 'assignments', 'methods', 'reports'].includes(section)) {
    return [
      { label: '服务项编号', value: record.id || detail.row.name },
      { label: '所属项目', value: record.project_id || '—' },
      { label: '检测类别', value: record.category || '—' },
      { label: '实施场所 / 批次', value: `${record.site || '—'} / ${record.batch || '—'}` },
      { label: '技术要求', value: record.requirement || '—' },
      { label: '特殊方法', value: record.special || '—' },
      { label: '当前状态', value: record.status || detail.row.state || '—' },
      { label: '团队负责人', value: personLabel(record.team_lead_id, '待分配') },
      { label: '项目经理', value: personLabel(record.project_manager_id, '待指派') },
      { label: '工程师', value: personListLabel(record.engineer_ids) },
      { label: '实施人员', value: (record.implementation_plan?.personnel || []).map((row) => row.resource_name).join('、') || '未登记' },
      { label: '设备清单', value: (record.implementation_plan?.equipment || []).map((row) => row.resource_name).join('、') || '未登记' },
      { label: '设备使用时段', value: (record.implementation_plan?.equipment || []).map((row) => `${row.resource_name} ${row.window_start ? `${row.window_start} ~ ${row.window_end}` : '全程'}`).join('；') || '—' },
      { label: '匹配校验', value: record.conflict_status === 'CONFLICT' ? '排期冲突' : record.conflict_status === 'PASSED' ? '校验通过' : record.conflict_status || '待校验' },
      { label: '测试模式', value: record.test_mode === 'PENETRATION' ? '渗透测试' : '标准方法' },
      { label: '计划窗口', value: `${(record.planned_start || '—').replace('T', ' ')} 至 ${(record.planned_end || '—').replace('T', ' ')}` },
    ]
  }
  if (section === 'preparation') {
    const payload = record.payload || {}
    return [
      { label: '事件编号', value: record.id || '—' },
      { label: '服务项', value: record.service_item_id || detail.row.name },
      { label: '设备清单', value: (payload.equipment || []).map((row) => `${row.resource_name}${row.window_start ? ` ${row.window_start} ~ ${row.window_end}` : ' 全程'}`).join('；') || '—' },
      { label: '行程预订单', value: payload.travel_request_id || '—' },
      { label: '操作人', value: record.actor_user_id || '—' },
      { label: '发起时间', value: record.created_at ? formatDateTime(record.created_at) : '—' },
    ]
  }
  if (section === 'qualifications') {
    const fields = [
      { label: '资源类型', value: record.resource_type === 'PERSON' ? '人员资质' : '设备能力' },
      { label: '资源名称', value: record.resource_name || '-—' },
      { label: '能力编码', value: record.codes || [] },
      { label: '状态', value: record.status === 'ACTIVE' ? '有效' : record.status || '—' },
    ]
    if (record.resource_type === 'EQUIPMENT') fields.push({ label: '检定有效期', value: record.valid_until ? formatDateTime(record.valid_until) : '长期有效' })
    else fields.push({ label: '有效期规则', value: '人员资质不限制有效期' })
    return fields
  }
  if (section === 'exceptions') {
    const payload = record.payload || {}
    return [
      { label: '偏离编号', value: payload.deviation_id || record.id || '—' },
      { label: '服务项', value: record.service_item_id || '—' },
      { label: '偏离描述', value: payload.description || detail.row.detail || '—' },
      { label: '严重度', value: payload.severity || '—' },
      { label: '操作人', value: record.actor_user_id || '—' },
      { label: '上报时间', value: record.created_at ? formatDateTime(record.created_at) : '—' },
    ]
  }
  if (['monitoring', 'reports'].includes(section)) {
    if (section === 'reports') {
      return [
        { label: '服务项编号', value: record.id || detail.row.name },
        { label: '所属项目', value: record.project_id || '—' },
        { label: '客户', value: projectByID.value.get(record.project_id)?.customer || '—' },
        { label: '实施场所', value: record.site || '—' },
        { label: '报告状态', value: reportStatusLabel[record.report_status] || record.report_status || '—' },
        { label: '报告更新时间', value: record.report_updated_at ? formatDateTime(record.report_updated_at) : '—' },
        { label: '报告更新人', value: record.report_updated_by || '—' },
        { label: '现场状态', value: record.status || '—' },
      ]
    }
    return [
      { label: '项目编号', value: record.id || '—' },
      { label: '客户', value: record.customer || '—' },
      { label: '服务项', value: record.services ? `${record.services} 项` : detail.row.detail || '—' },
      { label: '项目经理', value: record.manager || '待指派' },
      { label: '当前状态', value: record.status || detail.row.state || '—' },
      { label: '计划完成', value: record.due || detail.row.due || '待排期' },
    ]
  }
  return []
})

async function loadWorkspace() {
  loading.value = true
  loadError.value = ''
  ruleConfigurationCatalogError.value = ''
  let loaded = false
  try {
    // 项目、服务项和规则共同构成当前工作区快照；三者全部成功后才一次性替换页面状态，
    // 防止新旧数据混用。接口层仍分别执行会话与资源权限校验。
    const [projectRows, itemRows, ruleRows, eventRows, capabilityRows, dashboardData, sessionData, navigationData, ruleCatalog] = await Promise.all([listProjects(), listServiceItems(), listRules(), listDeliveryEvents(), listCapabilities(), getDashboard(), getProjectSession(), getProjectNavigation(), listRuleConfigurationCatalog().catch((error) => {
      ruleConfigurationCatalogError.value = error?.message || '规则目录加载失败'
      return { automation_triggers: [], sla_statuses: [] }
    })])
    projects.value = projectRows
    serviceItems.value = itemRows.map((item) => ({ ...item, selected: ['待确认', '待复核'].includes(item.status) }))
    rules.value = ruleRows.map(decorateRule)
    deliveryEvents.value = eventRows
    capabilities.value = capabilityRows
    dashboard.value = dashboardData
    session.value = sessionData
    navigation.value = navigationData
    automationTriggerOptions.value.splice(0, automationTriggerOptions.value.length, ...ruleCatalog.automation_triggers)
    slaStatusOptions.value.splice(0, slaStatusOptions.value.length, ...ruleCatalog.sla_statuses)
    // 侧栏账号行的角色名依赖服务端角色目录；不阻塞工作区首屏，失败只影响副标题文案。
    loadApplicationRoles()
    // 拆解规则配置由独立接口提供（不属于六类规则表），进入页面时按需加载。
    if (activeSection.value === 'split-rules') loadSplitConfig()
    const allowed = new Set(navigationData.sections)
    // 项目详情是从列表下钻的页面（携带 query.project），不要求出现在服务端导航清单里。
    if (route.params.section !== 'project_detail' && !allowed.has(route.params.section)) {
      await router.replace({ name: 'project_management', params: { section: navigationData.default_section || navigationData.sections[0] || 'dashboard' } })
    }
    lastUpdatedAt.value = new Date()
    loaded = true
  } catch (error) {
    loadError.value = subsystemAccessMessage(error, '项目管理数据加载失败。')
  } finally {
    loading.value = false
  }
  // 设备目录只作为表单下拉选项，属于辅助数据：单独加载并容忍失败，
  // 避免某一个下拉数据源不可用就把整个工作区替换成错误页。
  if (loaded) {
    await loadEquipment()
    await loadPersonnelNames()
    // SLA 超期是监控页的辅助指标：拉取失败只清空面板，不阻断工作区。
    try {
      slaOverdueItems.value = await listSlaOverdue()
    } catch {
      slaOverdueItems.value = []
    }
  }
}

// loadPersonnelNames 把当前工作区引用的平台 user_id 批量解析成姓名：
// 团队负责人、项目经理、工程师以及操作人都不应该在界面上显示成 ULID。
// 解析失败只降级为占位符，不影响工作区本身的可读性。
async function loadPersonnelNames() {
  const wanted = new Set()
  const remember = (value) => {
    const id = String(value || '').trim()
    if (id && !personnelNameByID.value.has(id)) wanted.add(id)
  }
  for (const item of serviceItems.value) {
    remember(item.team_lead_id)
    remember(item.project_manager_id)
    for (const id of item.engineer_ids || []) remember(id)
  }
  for (const event of deliveryEvents.value) remember(event.actor_user_id)
  if (!wanted.size) return
  try {
    rememberPersonnelNames(await resolvePersonnelNames([...wanted]))
    personnelNameError.value = ''
  } catch (error) {
    personnelNameError.value = subsystemAccessMessage(error, '人员姓名暂时无法解析，将显示占位符。')
  }
}

async function loadEquipment() {
  equipmentError.value = ''
  try {
    equipment.value = await listEquipment()
  } catch (error) {
    equipment.value = []
    equipmentError.value = subsystemAccessMessage(error, '设备目录加载失败，请稍后重试。')
  }
}

async function openCreateProject() {
  try {
    // 浏览器只调用项目后端；项目后端通过机器身份读取合同审批结果，避免要求业务管理员
    // 额外建立合同系统浏览器会话或持有合同读取权限。
    approvedContracts.value = await listApprovedContracts({ limit: 200 })
    if (!approvedContracts.value.length) { showToast('当前没有已通过审批的可用合同', 'warning'); return }
    createOpen.value = true
  } catch (error) {
    showToast(error?.message || '读取已审批合同失败，请稍后重试', error?.status === 503 ? 'warning' : 'error')
  }
}
// 同一 (合同号, 版本) 在服务端是唯一键：已有项目时再选它必然冲突。这里在选项上直接标注并
// 禁用，把"提交后才报错"提前到"选择时就能看见"；服务端的 409 仍是最终兜底
// （本页项目列表受数据范围过滤，可能看不到别人建的项目）。
const builtContractKeys = computed(() => {
  const keys = new Set()
  for (const project of projects.value) {
    if (project.contract) keys.add(`${project.contract}\u0000${project.contract_version || ''}`)
  }
  return keys
})

function contractOptionLabel(contract) {
  const base = `${contract.contract_number} · ${contract.title} · ${contract.customer_name || '未填写客户'}`
  const key = `${contract.contract_number || ''}\u0000${String(contract.version || '')}`
  const built = projects.value.find((project) => project.contract === contract.contract_number && (project.contract_version || '') === String(contract.version || ''))
  return built ? `${base}（已建项目 ${built.id}）` : base
}

function contractOptionDisabled(contract) {
  return builtContractKeys.value.has(`${contract.contract_number || ''}\u0000${String(contract.version || '')}`)
}

function selectApprovedContract(contract) {
  if (!contract) {
    createForm.value.contractID = ''
    createForm.value.contractVersion = ''
    createForm.value.contract = ''
    return
  }
  createForm.value.contractID = contract.id || ''
  createForm.value.contractVersion = String(contract.version || '')
  createForm.value.contract = contract.contract_number || ''
  createForm.value.customer = contract.customer_name || ''
}
// 设备在位状态由占用时段派生：借出中显示占用方与时段，否则显示在公司。
function equipmentPresenceLabel(item) {
  return item.presence === 'OUT_OF_COMPANY' ? '不在公司（借出中）' : '在公司'
}
function editEquipment(item) {
  const codes = canonicalCapabilityCodes('EQUIPMENT', item.codes || [])
  equipmentForm.value = {
    resourceID: item.resource_id, resourceName: item.resource_name, codes, originalCodes: [...codes],
    validFrom: item.valid_from?.slice(0, 10) || '', validUntil: item.valid_until?.slice(0, 10) || '',
    status: item.status || 'ACTIVE', usageScope: item.usage_scope || 'ANY',
  }
  openMulti.value = ''
}
// 归还：把设备从借出它的服务项清单里释放；设备维护人员也能操作，现场可能提前寄回。
async function returnEquipment(item) {
  const serviceItemID = item.borrowed_service_item_id || equipmentReservationByID.value.get(item.resource_id)?.service_item_id
  if (!serviceItemID) { showToast('未找到借出该设备的服务项，请刷新后重试', 'warning'); return }
  saving.value = true
  try {
    await returnServiceItemEquipment(serviceItemID, item.resource_id)
    showToast(`设备 ${item.resource_name} 已归还`)
    await Promise.all([loadEquipment(), loadEquipmentReservations(selectedServiceItem.value)])
  } catch (error) { showToast(error?.message || '归还失败，请稍后重试', 'error') }
  finally { saving.value = false }
}
async function saveEquipment() {
  if (!validateCapabilityCodes('EQUIPMENT', equipmentCodeSelection.value, equipmentForm.value.originalCodes || [])) return
  saving.value = true
  try {
    const item = await upsertEquipment({ resource_id: equipmentForm.value.resourceID, resource_name: equipmentForm.value.resourceName, codes: [...equipmentCodeSelection.value], valid_from: equipmentForm.value.validFrom ? new Date(equipmentForm.value.validFrom).toISOString() : '', valid_until: equipmentForm.value.validUntil ? new Date(equipmentForm.value.validUntil).toISOString() : '', status: equipmentForm.value.status, usage_scope: equipmentForm.value.usageScope })
    equipment.value = [item, ...equipment.value.filter((row) => row.resource_id !== item.resource_id)]
    showToast('设备信息已保存')
  } catch (error) { showToast(error?.message || '设备信息保存失败', 'error') }
  finally { saving.value = false }
}
async function removeEquipment(item) {
  if (!item?.resource_id || !window.confirm(`确定删除设备「${item.resource_name || item.resource_id}」吗？已归还或已完成项目中的历史设备快照不会受影响。`)) return
  saving.value = true
  try {
    await deleteEquipment(item.resource_id)
    equipment.value = equipment.value.filter((row) => row.resource_id !== item.resource_id)
    showToast(`设备 ${item.resource_name || item.resource_id} 已删除`)
  } catch (error) { showToast(error?.message || '设备删除失败，请先确认设备未被实施计划占用', 'error') }
  finally { saving.value = false }
}

// 人员与设备使用不同前缀，编号由系统顺延生成，业务用户无需手工填写。
function resourceIDPrefix(resourceType) {
  return resourceType === 'EQUIPMENT' ? 'EQ-' : 'P-'
}
function nextResourceID(resourceType) {
  const prefix = resourceIDPrefix(resourceType)
  const used = new Set()
  let maxSequence = 0
  for (const item of capabilities.value) {
    if (item.resource_type !== resourceType) continue
    used.add(String(item.resource_id || ''))
    const raw = String(item.resource_id || '')
    if (!raw.startsWith(prefix)) continue
    const sequence = Number.parseInt(raw.slice(prefix.length), 10)
    if (Number.isFinite(sequence) && sequence > maxSequence) maxSequence = sequence
  }
  let candidate
  do {
    maxSequence += 1
    candidate = `${prefix}${String(maxSequence).padStart(4, '0')}`
  } while (used.has(candidate))
  return candidate
}
function onCapabilityTypeChange() {
  if (!capabilityDialog.value) return
  if (capabilityAutoID.value) capabilityDialog.value.resource_id = nextResourceID(capabilityDialog.value.resource_type)
  if (capabilityDialog.value.resource_type !== 'PERSON') capabilityDialog.value.user_id = ''
  if (capabilityDialog.value.resource_type === 'PERSON') {
    capabilityDialog.value.valid_from = ''
    capabilityDialog.value.valid_until = ''
  }
  capabilityDialog.value.codes = []
  capabilityDialog.value.original_codes = []
  openMulti.value = ''
  if (capabilityDialog.value.resource_type === 'PERSON') void loadCapabilityPersonnel()
}

function openCapabilityDialog(item) {
  capabilityAutoID.value = !item
  const codes = item ? canonicalCapabilityCodes(item.resource_type, item.codes || []) : []
  capabilityDialog.value = item
    ? { resource_type: item.resource_type, resource_id: item.resource_id, resource_name: item.resource_name, user_id: item.user_id || '', codes, original_codes: [...codes], valid_from: item.valid_from?.slice(0, 10) || '', valid_until: item.valid_until?.slice(0, 10) || '', status: item.status || 'ACTIVE', usage_scope: item.usage_scope || 'ANY' }
    : { resource_type: 'PERSON', resource_id: nextResourceID('PERSON'), resource_name: '', user_id: '', codes: [], original_codes: [], valid_from: '', valid_until: '', status: 'ACTIVE', usage_scope: 'ANY' }
  openMulti.value = ''
  if (capabilityDialog.value.resource_type === 'PERSON') void loadCapabilityPersonnel()
}

async function saveCapability() {
  if (!capabilityDialog.value) return
  if (!validateCapabilityCodes(capabilityDialog.value.resource_type, capabilityCodeSelection.value, capabilityDialog.value.original_codes || [])) return
  saving.value = true
  try {
    const form = capabilityDialog.value
    const saved = await upsertCapability({
      resource_type: form.resource_type,
      resource_id: form.resource_id,
      resource_name: form.resource_name,
      user_id: form.resource_type === 'PERSON' ? form.user_id : '',
      codes: [...capabilityCodeSelection.value],
      valid_from: form.resource_type === 'EQUIPMENT' && form.valid_from ? new Date(form.valid_from).toISOString() : '',
      valid_until: form.resource_type === 'EQUIPMENT' && form.valid_until ? new Date(form.valid_until).toISOString() : '',
      status: form.status,
      usage_scope: form.usage_scope || 'ANY',
    })
    capabilities.value = [saved, ...capabilities.value.filter((row) => !(row.resource_type === saved.resource_type && row.resource_id === saved.resource_id))]
    capabilityDialog.value = null
    showToast('资质 / 能力已保存')
  } catch (error) { showToast(error?.message || '资质保存失败', 'error') }
  finally { saving.value = false }
}

async function importQualificationFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  saving.value = true
  try {
    importResult.value = await importCapabilities(file)
    capabilities.value = await listCapabilities()
    if (importResult.value.skipped > 0) showToast(`导入完成：成功 ${importResult.value.imported} 条，跳过 ${importResult.value.skipped} 条`)
    else showToast(`导入完成：成功 ${importResult.value.imported} 条`)
  } catch (error) { showToast(error?.message || 'CSV 导入失败', 'error') }
  finally { saving.value = false }
}

// 人员资质档案的身份必须回基础平台复核：本系统只知道"谁有资质"，
// "这个人是否还在职"只能由基础平台回答。
async function syncIdentities() {
  saving.value = true
  try {
    const result = await syncPersonnelIdentities()
    await loadWorkspace()
    showToast(`人员状态已复核：在职 ${result.active} · 已离职/查无此人 ${result.missing} · 未关联 ${result.unlinked}${result.unverified ? ` · 目录未响应 ${result.unverified}` : ''}`)
  } catch (error) {
    showToast(error?.message || '人员状态复核失败', 'error')
  } finally {
    saving.value = false
  }
}

async function downloadCapabilities() {
  try {
    const { blob, filename } = await exportCapabilities(capabilityTypeFilter.value)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    showToast('已开始导出 CSV')
  } catch (error) { showToast(error?.message || 'CSV 导出失败', 'error') }
}

function navigate(section) {
  router.push({ name: 'project_management', params: { section } })
  mobileMenuOpen.value = false
  // 拆解规则配置来自独立接口：切到该页签时按需加载，避免影响其它工作区的首屏。
  if (section === 'split-rules') loadSplitConfig()
}

// 项目详情是从列表/看板下钻的独立页面（原型 PG-PRJ-02），不在侧边栏导航里，
// 通过 query.project 携带项目编号，可直接深链与刷新恢复。
function openProject(project) {
  if (!project) return
  router.push({ name: 'project_management', params: { section: 'project_detail' }, query: { project: project.id } })
}
const detailProject = computed(() => {
  const id = String(route.query.project || '')
  return projects.value.find((project) => project.id === id) || null
})
const detailItems = computed(() => detailProject.value ? serviceItems.value.filter((item) => item.project_id === detailProject.value.id) : [])
const detailEvents = computed(() => detailProject.value ? projectEvents(detailProject.value) : [])
const detailPendingDeviations = computed(() => pendingDeviations.value.filter((event) => detailItems.value.some((item) => item.id === event.service_item_id)))
const detailTab = ref('items')
const detailTabs = computed(() => [
  { key: 'items', label: '服务项拆解', count: detailItems.value.length },
  { key: 'plan', label: '实施计划', count: detailItems.value.filter((item) => item.implementation_plan).length },
  { key: 'events', label: '交付动态', count: detailEvents.value.length },
  { key: 'exceptions', label: '异常记录', count: detailPendingDeviations.value.length },
])
// 甘特条以项目内全部已排期服务项的窗口并集为坐标系，按状态着色。
const detailGantt = computed(() => {
  const items = detailItems.value.filter((item) => item.planned_start && item.planned_end)
  if (!items.length) return []
  const times = items.flatMap((item) => [new Date(item.planned_start).getTime(), new Date(item.planned_end).getTime()])
  const min = Math.min(...times)
  const span = Math.max(1, Math.max(...times) - min)
  return items.map((item) => {
    const start = new Date(item.planned_start).getTime()
    const end = new Date(item.planned_end).getTime()
    return {
      id: item.id,
      label: item.category || item.site || item.id,
      status: item.status,
      left: ((start - min) / span) * 100,
      width: Math.max(3, ((end - start) / span) * 100),
      window: `${String(item.planned_start).slice(0, 10)} ~ ${String(item.planned_end).slice(0, 10)}`,
    }
  })
})
function ganttTone(status) {
  if (['异常处理中', '已终止'].includes(status)) return 'red'
  if (['现场实施完成', '报告编制', '已完成'].includes(status)) return 'green'
  if (['实施中', '实施准备中'].includes(status)) return 'amber'
  if (['待拆解确认', '待分配'].includes(status)) return 'gray'
  return ''
}

function returnToUnifiedPortal() {
  mobileMenuOpen.value = false
  notificationOpen.value = false
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
    showToast(error?.message || '退出系统失败，请稍后重试。', 'error')
  } finally {
    isLoggingOut.value = false
  }
}

// toast 带语义类型：success/error/warning/info，图标底色随类型切换（§18.11）。
function showToast(message, type = 'success') {
  toastMessage.value = message
  toastType.value = type
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
  // 事件名必须与后端 application/delivery.go 的常量逐字一致：曾把现场完成的事件名
  // 多写一层 IMPLEMENTATION 前缀，导致交付趋势/准时率按该名过滤时恒为空。
  return ({ CONTRACT_ACTIVATED: '合同生效并生成项目', CONTRACT_STAMP_STATUS_SYNCED: '盖章合同状态已同步', DECOMPOSITION_ADJUSTED: '服务项拆解已调整', DECOMPOSITION_RETURNED: '服务项已退回拆解确认', TEAM_ASSIGNED: '团队负责人已分配', EXECUTION_TEAM_ASSIGNED: '项目经理及工程师已指派', IMPLEMENTATION_PLANNED: '现场实施计划已发布', PREPARATION_STARTED: '实施准备已发起', FIELD_RECORD_SUBMITTED: '现场原始记录已提交', FIELD_COMPLETED: '现场实施已完成', EQUIPMENT_RETURNED: '设备已归还', DEVIATION_REPORTED: '现场偏离已上报', DEVIATION_REVIEWED: '偏离评审已完成', SPECIAL_METHOD_REVIEWED: '特殊方法复核已完成', REPORT_STATUS_UPDATED: '报告阶段已推进', WARNING_TRIGGERED: '预警规则已触发', AUTOMATION_TRIGGERED: '自动化动作已执行' })[event.type] || event.type
}

function toggleRow(id) {
  selectedRows.value = selectedRows.value.includes(id) ? selectedRows.value.filter((item) => item !== id) : [...selectedRows.value, id]
}
async function confirmDecomposition() {
  const ids = currentDecompositionItems.value.filter((item) => item.selected).map((item) => item.id)
  if (!ids.length) { showToast('请至少选择一个服务项', 'warning'); return }
  saving.value = true
  try {
    // 只依据服务端返回的已变更服务项更新本地列表；未返回的行保持原状态，避免把整批
    // 请求都乐观标记为成功。
    const changed = await confirmServiceItemsRequest(ids)
    const byID = new Map(changed.map((item) => [item.id, item]))
    serviceItems.value = serviceItems.value.map((item) => byID.has(item.id) ? { ...byID.get(item.id), selected: false } : item)
    showToast(`已确认 ${ids.length} 个服务项，任务已进入分配队列`)
  } catch (error) { showToast(error?.message || '确认失败', 'error') }
  finally { saving.value = false }
}

// 调整拆解：服务端在同一事务里替换该项目的全部服务项并要求所有项仍处于待确认/待复核，
// 因此入口只在拆解阶段可用，成功后项目进入「补充协议处理中」。
const adjustOpen = ref(false)
const adjustForm = ref(emptyAdjustForm())
function emptyAdjustItem() {
  return { sourceID: '', batch: '', site: '', category: '', system: '', systemLevel: '', requirement: '', testMode: 'STANDARD' }
}
function emptyAdjustForm() {
  return { reason: '', supplementContractID: '', items: [emptyAdjustItem()] }
}
function openDecompositionAdjust() {
  if (!decompositionProject.value) { showToast('请先选择要调整拆解的项目', 'warning'); return }
  adjustForm.value = emptyAdjustForm()
  adjustOpen.value = true
}
function addAdjustItem() { adjustForm.value.items.push(emptyAdjustItem()) }
function removeAdjustItem(index) {
  if (adjustForm.value.items.length === 1) adjustForm.value.items[0] = emptyAdjustItem()
  else adjustForm.value.items.splice(index, 1)
}
async function submitDecompositionAdjust() {
  const project = decompositionProject.value
  if (!project) { showToast('请先选择要调整拆解的项目', 'warning'); return }
  const items = adjustForm.value.items.map((row, index) => ({
    source_id: row.sourceID || `ADJUST-${String(index + 1).padStart(3, '0')}`,
    batch: row.batch, site: row.site, category: row.category, system: row.system,
    system_level: row.systemLevel, requirement: row.requirement, test_mode: row.testMode,
  }))
  if (items.some((row) => !row.site || !row.batch || !row.category)) {
    showToast('每个服务项都要填写场所、批次与检测类别'); return
  }
  saving.value = true
  try {
    await adjustDecomposition(project.id, { reason: adjustForm.value.reason, supplement_contract_id: adjustForm.value.supplementContractID, items })
    adjustOpen.value = false
    showToast('拆解已调整，项目进入补充协议处理中')
    await loadWorkspace()
  } catch (error) { showToast(error?.message || '调整拆解失败', 'error') }
  finally { saving.value = false }
}

async function toggleRule(rule) {
  const next = !rule.enabled
  try {
    // 不预先翻转开关，等待带有最新版本语义的服务端结果后再覆盖当前行。
    const updated = await setRuleEnabled(rule.id, rule.kind || activeSection.value, next)
    Object.assign(rule, updated)
    showToast(rule.kind === 'standards' ? (next ? '标准变更已恢复评估' : '标准变更评估已完成并归档') : (next ? '规则已启用' : '规则已停用'))
  } catch (error) { showToast(error?.message || (rule.kind === 'standards' ? '标准变更状态更新失败' : '规则更新失败'), 'error') }
}

// 删除配置规则。停用开关是可逆操作，删除不可恢复，因此必须二次确认；kind 必填，
// 六套配置表主键各自自增，只按 id 删会命中别的配置类型。删除按钮与新建、编辑同权限门控。
async function removeConfigRule(rule) {
  if (saving.value) return
  const kind = rule.kind || activeSection.value
  if (!window.confirm(`确认删除配置「${rule.name || rule.id}」？删除后无法恢复，如需临时停用请使用状态开关。`)) return
  saving.value = true
  try {
    const removed = await deleteRule(rule.id, kind)
    const index = rules.value.indexOf(rule)
    if (index >= 0) rules.value.splice(index, 1)
    showToast(`配置「${removed?.name || rule.name || rule.id}」已删除`)
  } catch (error) { showToast(error?.message || '配置删除失败', 'error') }
  finally { saving.value = false }
}

function selectedIDs(value) { return String(value || '').split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean) }
function asRFC3339(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toISOString() }
// 后端保存 RFC3339（UTC），而 <input type="datetime-local"> 只接受本地时间的 YYYY-MM-DDTHH:mm。
// 直接把 ISO 串塞进输入框会被浏览器判为非法值并显示为空，导致再次编辑已有计划时时间"丢失"。
function toDateTimeLocal(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
// identityStatusLabel 把身份复核结果翻译成用户能读懂的状态。
function identityStatusLabel(status) {
  if (status === 'ACTIVE') return '在职'
  if (status === 'MISSING') return '已离职/查无此人'
  return '未关联平台账号'
}

function conflictStatusLabel(status) {
  if (status === 'PASSED') return '校验通过'
  if (status === 'CONFLICT') return '存在冲突'
  return '尚未校验'
}
function selectServiceItem(item) {
  if (!item) return
  selectedServiceItemIDs.value = [item.id]
  fillOperationForm(item)
}
function fillOperationForm(item) {
  const plan = item.implementation_plan || {}
  operationForm.value = { ...operationForm.value, teamLeadID: item.team_lead_id || '', projectManagerID: item.project_manager_id || '', engineerIDs: (item.engineer_ids || []).join(','), plannedStart: toDateTimeLocal(item.planned_start || plan.planned_start), plannedEnd: toDateTimeLocal(item.planned_end || plan.planned_end), penetrationTestPlan: plan.penetration_test_plan || '', authDocNo: plan.auth_doc_no || '', authStart: toDateTimeLocal(plan.auth_start), authEnd: toDateTimeLocal(plan.auth_end), authScope: plan.auth_scope || '', testScope: plan.test_scope || '', testWindow: plan.test_window || '', emergencyContact: plan.emergency_contact || '', rollbackPlan: plan.rollback_plan || '', reviewComment: item.tech_review_comment || '', personnel: planPersonnelFor(item, plan), equipment: planEquipmentFor(plan) }
}
// 实施计划的人员与设备清单：已发布的计划用保存下来的快照回填；首次制定时按服务项已指派的
// 团队与设备自动生成，业务用户只需调整使用时段或移除，不必手工重新挑一遍人和设备。
// 实施计划的人员清单：已发布的计划用保存下来的快照回填；首次制定时按服务项已指派的
// 团队自动生成，业务用户只需调整使用时段或移除。设备清单在「实施准备」阶段维护。
function planPersonnelFor(item, plan) {
  const saved = Array.isArray(plan.personnel) ? plan.personnel : []
  if (saved.length) {
    return saved.map((row) => ({ resourceType: 'PERSON', resourceID: row.resource_id, windowStart: row.window_start || '', windowEnd: row.window_end || '', note: row.note || '' }))
  }
  return planPersonnelRows(item)
}
// 已指派的执行团队默认全员参与；团队负责人同样计入，避免计划里出现"没有负责人"的空档。
function planPersonnelRows(item) {
  const personIDs = [item.team_lead_id, item.project_manager_id, ...(item.engineer_ids || [])].filter(Boolean)
  return [...new Set(personIDs)].map((id) => ({ resourceType: 'PERSON', resourceID: id, windowStart: '', windowEnd: '', note: '' }))
}
// 实施准备的设备清单：已登记的回填快照，未登记时留空由用户在准备阶段挑选。
function planEquipmentFor(plan) {
  const saved = Array.isArray(plan.equipment) ? plan.equipment : []
  return saved.map((row) => ({ resourceType: 'EQUIPMENT', resourceID: row.resource_id, windowStart: row.window_start || '', windowEnd: row.window_end || '', note: row.note || '' }))
}
// 清单行展示的名称/资质/有效期：优先取当前能力档案，档案缺失时回落到人员姓名缓存，
// 避免已停用资源在表单里显示成空白。
function planResourceName(row) {
  const capability = capabilities.value.find((item) => item.resource_id === row.resourceID || (item.resource_type === 'PERSON' && item.user_id === row.resourceID))
  return capability?.resource_name || personnelNameByID.value.get(row.resourceID) || row.resourceID || '未命名资源'
}
function planResourceCodes(row) {
  const capability = capabilities.value.find((item) => item.resource_id === row.resourceID || (item.resource_type === 'PERSON' && item.user_id === row.resourceID))
  return capability?.codes || []
}
function planResourceValidUntil(row) {
  const capability = capabilities.value.find((item) => item.resource_id === row.resourceID || (item.resource_type === 'PERSON' && item.user_id === row.resourceID))
  if (capability?.resource_type === 'PERSON' || row.resourceType === 'PERSON') return '不限制'
  return capability?.valid_until ? capability.valid_until.slice(0, 10) : '—'
}
// 设备占用：实施准备阶段把已被其他服务项在同一时段占用的设备置灰，不允许重复选取。
const equipmentReservations = ref([])
const equipmentReservationByID = computed(() => {
  const map = new Map()
  for (const item of equipmentReservations.value) {
    if (!map.has(item.resource_id)) map.set(item.resource_id, item)
  }
  return map
})
async function loadEquipmentReservations(item) {
  if (!item?.id) { equipmentReservations.value = []; return }
  try {
    equipmentReservations.value = await listEquipmentReservations(item.id)
  } catch {
    // 占用信息拿不到时不阻断挑选，保存时服务端仍会硬拦重叠占用。
    equipmentReservations.value = []
  }
}
// 设备不可选的三种原因按优先级解释：仅在公司使用（不可借出）> 当前不在公司 > 时段已被占用。
function equipmentUnavailableReason(item) {
  if (item.usage_scope === 'COMPANY_ONLY') return '仅在公司使用 · 不可借出'
  if (item.presence === 'OUT_OF_COMPANY') return `当前不在公司（${item.borrowed_by || '借出中'} ${item.borrowed_window || ''}）`.trim()
  const reservation = equipmentReservationByID.value.get(item.resource_id)
  if (reservation) return `${reservation.project_id || reservation.service_item_id} 已占用 ${reservation.window_start} ~ ${reservation.window_end}`
  return ''
}
function equipmentReservationLabel(resourceID) {
  const item = equipment.value.find((row) => row.resource_id === resourceID)
  return item ? equipmentUnavailableReason(item) : ''
}
const planEquipmentPickerOpen = ref(false)
const equipmentPickerKeyword = ref('')
function openEquipmentPicker() {
  equipmentPickerKeyword.value = ''
  planEquipmentPickerOpen.value = true
}
// 实施准备只展示有效期覆盖整个实施计划窗口的设备。设备档案只在“今天”有效仍不够：
// 若计划结束前检定到期，提交时服务端会拒绝，因此选择阶段就应过滤掉。
function isEquipmentValidForPreparation(item) {
  const today = new Date().toISOString().slice(0, 10)
  const usageStart = String(selectedServiceItem.value?.planned_start || '').slice(0, 10) || today
  const usageEnd = String(selectedServiceItem.value?.planned_end || '').slice(0, 10) || usageStart
  const validFrom = String(item.valid_from || '').slice(0, 10)
  const validUntil = String(item.valid_until || '').slice(0, 10)
  return item.status === 'ACTIVE' && (!validFrom || validFrom <= usageStart) && (!validUntil || validUntil >= usageEnd)
}
// 选择器列出全部当前有效设备（而不是过滤掉已加入/不可选的），让设备管理员一眼看到完整台账与原因。
const planEquipmentOptions = computed(() => equipment.value.filter(isEquipmentValidForPreparation))
const planEquipmentFiltered = computed(() => {
  const query = equipmentPickerKeyword.value.trim().toLowerCase()
  if (!query) return planEquipmentOptions.value
  return planEquipmentOptions.value.filter((item) => [item.resource_name, item.resource_id, (item.codes || []).join(' ')].join(' ').toLowerCase().includes(query))
})
const planEquipmentAddedCount = computed(() => operationForm.value.equipment.length)
const planEquipmentAddableCount = computed(() => planEquipmentOptions.value.filter((item) => !equipmentPickerState(item).disabled).length)
// 每一行的状态与可执行动作：已加入 > 不可选取（含原因）> 可添加。
function equipmentPickerState(item) {
  if (operationForm.value.equipment.some((row) => row.resourceID === item.resource_id)) {
    return { label: '已加入', tone: 'normal', action: '已加入', disabled: true }
  }
  const reason = equipmentUnavailableReason(item)
  if (reason) return { label: '不可选取', tone: 'warning', action: '不可选取', disabled: true }
  return { label: '可添加', tone: 'neutral', action: '添加', disabled: false }
}
function addPlanEquipment(equipmentItem) {
  if (!equipmentItem) return
  if (equipmentPickerState(equipmentItem).disabled) return
  operationForm.value.equipment = [...operationForm.value.equipment, { resourceType: 'EQUIPMENT', resourceID: equipmentItem.resource_id, windowStart: '', windowEnd: '', note: '' }]
  planEquipmentPickerOpen.value = false
}
function removePlanEquipment(index) {
  operationForm.value.equipment = operationForm.value.equipment.filter((_, position) => position !== index)
}
function removePlanPersonnel(index) {
  operationForm.value.personnel = operationForm.value.personnel.filter((_, position) => position !== index)
}
function toggleServiceItem(item) {
  const selected = new Set(selectedServiceItemIDs.value)
  if (selected.has(item.id)) selected.delete(item.id)
  else selected.add(item.id)
  selectedServiceItemIDs.value = [...selected]
  if (selectedServiceItems.value.length === 1) fillOperationForm(selectedServiceItems.value[0])
}
function addServiceLink() { createForm.value.serviceLinks.push(emptyServiceLink()) }
function removeServiceLink(index) {
  if (createForm.value.serviceLinks.length === 1) createForm.value.serviceLinks[0] = emptyServiceLink()
  else createForm.value.serviceLinks.splice(index, 1)
}
async function uploadCurrentReport() {
  const item = selectedServiceItem.value
  const file = operationForm.value.reportFile
  if (!item || item.report_status !== 'COMPILING' || !(file instanceof File)) { showToast('请选择当前编制版本的 PDF 报告', 'warning'); return }
  saving.value = true
  try {
    const artifact = await uploadServiceItemEvidence(item.id, 'REPORT', file)
    await registerReportArtifact(item.id, Number(item.report_revision) || 0, artifact)
    operationForm.value.reportFile = null
    showToast(`R${Number(item.report_revision) || 0} 报告文件已登记，可提交审核`)
    await loadWorkspace()
  } catch (error) { showToast(error?.message || '报告文件上传失败', 'error') }
  finally { saving.value = false }
}

async function runOperation(kind) {
  const item = selectedServiceItem.value
  const items = kind === 'allocation' ? selectedServiceItems.value : (item ? [item] : [])
  if (!items.length) { showToast(kind === 'allocation' ? '请至少选择一个服务项' : '当前没有可操作的服务项'); return }
  const form = operationForm.value
  saving.value = true
  try {
    if (kind === 'allocation') {
      for (const selected of items) {
        if (!selected.team_lead_id) await assignTeam(selected.id, { team_lead_id: form.teamLeadID, expected_version: Number(selected.version) || 0 })
        if (canExecutionAssign.value) {
          // 设备清单在「实施准备」阶段确定，任务分配只指派执行团队。
          await assignExecutionTeam(selected.id, { project_manager_id: form.projectManagerID, engineer_ids: selectedIDs(form.engineerIDs), expected_version: Number(selected.version) || 0 })
        }
      }
      showToast(canExecutionAssign.value ? `已批量保存 ${items.length} 个服务项并完成能力校验` : `已批量分配 ${items.length} 个服务项的团队负责人`)
    } else if (kind === 'planning') {
      // 操作台用的是 div 而非 <form>，浏览器不会执行 required 校验，这里显式前置拦截。
      if (planningBlocked.value) { showToast(planningBlocked.value.reason); return }
      if (!form.plannedStart || !form.plannedEnd) { showToast('请填写计划开始与计划结束时间', 'warning'); return }
      if (new Date(form.plannedEnd).getTime() <= new Date(form.plannedStart).getTime()) { showToast('计划结束时间必须晚于计划开始时间', 'warning'); return }
      const personRows = form.personnel
      if (!personRows.length) { showToast('请至少添加一名实施人员', 'warning'); return }
      const windowProblem = form.personnel.find((row) => (row.windowStart && !row.windowEnd) || (!row.windowStart && row.windowEnd) || (row.windowStart && row.windowEnd && new Date(row.windowEnd) < new Date(row.windowStart)))
      if (windowProblem) { showToast(`「${planResourceName(windowProblem)}」的使用时段不完整或结束早于开始`); return }
      if (selectedServiceItem.value?.test_mode === 'PENETRATION') {
        const compliance = [
          [form.penetrationTestPlan, '渗透测试专项计划'], [form.authDocNo, '授权书编号'],
          [form.authScope, '授权范围'], [form.testScope, '计划测试范围'], [form.testWindow, '测试时间窗'],
          [form.emergencyContact, '应急联系人'], [form.rollbackPlan, '回滚方案'],
        ].filter(([value]) => !String(value || '').trim()).map(([, label]) => label)
        if (compliance.length) { showToast(`请补充渗透测试专项合规要素：${compliance.join('、')}`); return }
        if (!form.authStart || !form.authEnd) { showToast('请填写授权生效与授权截止时间', 'warning'); return }
        if (new Date(form.authEnd).getTime() <= new Date(form.authStart).getTime()) { showToast('授权截止时间必须晚于授权生效时间', 'warning'); return }
      }
      await planImplementation(item.id, { expected_version: Number(item.version) || 0, planned_start: asRFC3339(form.plannedStart), planned_end: asRFC3339(form.plannedEnd), penetration_test_plan: form.penetrationTestPlan, auth_doc_no: form.authDocNo, auth_start: asRFC3339(form.authStart), auth_end: asRFC3339(form.authEnd), auth_scope: form.authScope, test_scope: form.testScope, test_window: form.testWindow, emergency_contact: form.emergencyContact, rollback_plan: form.rollbackPlan , personnel: form.personnel.map((row) => ({ resource_type: 'PERSON', resource_id: row.resourceID, window_start: row.windowStart, window_end: row.windowEnd, note: row.note })) })
      showToast('实施计划已发布')
    } else if (kind === 'special-approve' || kind === 'special-reject') {
      await reviewSpecialMethod(item.id, { decision: kind === 'special-approve' ? 'APPROVED' : 'REJECTED', comment: form.reviewComment })
      showToast(kind === 'special-approve' ? '复核已通过，可发布实施计划' : '复核已驳回，请修正后重新提交复核')
    } else if (kind === 'report-next') {
      const next = reportPhaseNext[item.report_status]
      await updateReportStatus(item.id, next, item.version)
      showToast(`报告状态已推进至：${reportStatusLabel[next]}`)
    } else if (kind === 'preparation') {
      if (!form.equipment.length) { showToast('请至少选择一台实施设备', 'warning'); return }
      const equipmentWindowProblem = form.equipment.find((row) => (row.windowStart && !row.windowEnd) || (!row.windowStart && row.windowEnd) || (row.windowStart && row.windowEnd && new Date(row.windowEnd) < new Date(row.windowStart)))
      if (equipmentWindowProblem) { showToast(`「${planResourceName(equipmentWindowProblem)}」的使用时段不完整或结束早于开始`); return }
      await startImplementationPreparation(item.id, { expected_version: Number(item.version) || 0, travel_request_id: form.travelRequestID, notes: form.comment, equipment: form.equipment.map((row) => ({ resource_type: 'EQUIPMENT', resource_id: row.resourceID, window_start: row.windowStart, window_end: row.windowEnd, note: row.note })) })
      showToast('实施准备已发起')
    } else if (kind === 'field') {
      // 坐标签到已删除：手工填写的经纬度没有任何证明力，服务端也不再保存。
      // 现场记录（原始数据 / 环境条件）是进入"实施中"的真实动作。
      if (!String(form.rawData || '').trim() || !String(form.environment || '').trim()) { showToast('请填写现场原始数据与环境条件', 'warning'); return }
	  if (!(form.fieldEvidenceFile instanceof File)) { showToast('请上传至少一份现场证据', 'warning'); return }
	  const evidence = await uploadServiceItemEvidence(item.id, 'FIELD', form.fieldEvidenceFile)
	  await submitFieldRecord(item.id, { expected_version: Number(item.version) || 0, raw_data: form.rawData, environment: form.environment, evidence_files: [evidence] })
	  form.fieldEvidenceFile = null
      showToast('现场记录已提交，服务项进入实施中')
    } else if (kind === 'exception-report') {
	  const evidenceFiles = form.deviationEvidenceFile instanceof File ? [await uploadServiceItemEvidence(item.id, 'DEVIATION', form.deviationEvidenceFile)] : []
	  const result = await reportDeviation(item.id, { description: form.deviationDescription, severity: form.severity, evidence_files: evidenceFiles })
	  form.deviationEvidenceFile = null
      showToast(`偏离已上报：${result.deviation_id || '待评审'}`)
    } else if (kind === 'exception-review') {
      await reviewDeviation(form.deviationID, { decision: form.decision, comment: form.comment })
      showToast('偏离评审已完成')
    } else if (kind === 'complete') {
      await completeServiceItemField(item.id)
      showToast('该服务项现场实施已完成，进入报告编制')
    }
    await loadWorkspace()
  } catch (error) {
    showToast(error?.message || '操作失败', 'error')
    // 并发冲突：服务端已拒绝本次写入，重新拉取让用户看到最新版本后再决定怎么做。
    if (error?.status === 409) await loadWorkspace()
  }
  finally { saving.value = false }
}

async function revokeSelectedAssignment(kind) {
  const items = selectedServiceItems.value
  if (!items.length) { showToast('请至少选择一个服务项', 'warning'); return }
  const eligible = items.filter((item) => item.status === '待分配' && (kind === 'team' ? item.team_lead_id : item.project_manager_id))
  if (eligible.length !== items.length) { showToast('仅可撤销处于待分配状态且已有对应分配的服务项', 'warning'); return }
  const label = kind === 'team' ? '团队负责人分配（会同时撤销项目经理、工程师和能力校验）' : '项目经理与工程师分配'
  const reason = window.prompt(`请输入撤销${label}的原因：`)
  if (reason === null) return
  if (!String(reason).trim()) { showToast('撤销原因不能为空', 'warning'); return }
  saving.value = true
  try {
    for (const item of eligible) {
      const payload = { reason: String(reason).trim(), expected_version: Number(item.version) || 0 }
      if (kind === 'team') await revokeTeamAssignment(item.id, payload)
      else await revokeExecutionAssignment(item.id, payload)
    }
    showToast(`已撤销 ${eligible.length} 个服务项的${kind === 'team' ? '团队负责人分配及下游执行团队' : '执行团队分配'}，历史记录已保留`)
    await loadWorkspace()
  } catch (error) {
    showToast(error?.message || '撤销分配失败，请刷新后重试', 'error')
  } finally { saving.value = false }
}

async function returnSelectedToDecomposition() {
  const items = selectedServiceItems.value
  if (!items.length) { showToast('请至少选择一个服务项', 'warning'); return }
  if (items.some((item) => item.status !== '待分配')) { showToast('仅可将待分配服务项退回拆解确认', 'warning'); return }
  const reason = window.prompt('请输入退回拆解确认的原因：')
  if (reason === null) return
  if (!String(reason).trim()) { showToast('退回原因不能为空', 'warning'); return }
  saving.value = true
  try {
    for (const item of items) {
      await returnServiceItemToDecomposition(item.id, { reason: String(reason).trim(), expected_version: Number(item.version) || 0 })
    }
    showToast(`已将 ${items.length} 个服务项退回拆解确认，原分配与校验结果已清除`)
    selectedServiceItemIDs.value = []
    await loadWorkspace()
  } catch (error) {
    showToast(error?.message || '退回拆解确认失败，请刷新后重试', 'error')
    if (error?.status === 409) await loadWorkspace()
  } finally { saving.value = false }
}

const pendingRollbackRequests = computed(() => {
  const decided = new Set(deliveryEvents.value.filter((event) => ['ROLLBACK_APPROVED', 'ROLLBACK_REJECTED', 'ROLLBACK_WITHDRAWN'].includes(event.type)).map((event) => event.payload?.request_id))
  return deliveryEvents.value.filter((event) => event.type === 'ROLLBACK_REQUESTED' && !decided.has(event.id))
})
async function withdrawPendingRollback(request) {
  const reason = window.prompt('请输入撤回原因：')
  if (reason === null) return
  if (!String(reason).trim()) { showToast('撤回原因不能为空', 'warning'); return }
  saving.value = true
  try {
    await withdrawRollback(request.service_item_id, request.id, { reason: String(reason).trim() })
    showToast('回退申请已撤回')
    await loadWorkspace()
  } catch (error) { showToast(error?.message || '撤回失败，请刷新后重试', 'error') } finally { saving.value = false }
}
async function revokeDeliveryPhase(kind) {
  const item = selectedServiceItem.value
  if (!item) { showToast('请先选择服务项', 'warning'); return }
  const expectedStatus = kind === 'plan' ? '待实施' : '实施准备中'
  if (item.status !== expectedStatus) { showToast(`当前状态不能撤销${kind === 'plan' ? '实施计划' : '实施准备'}`, 'warning'); return }
  const reason = window.prompt(`请输入撤销${kind === 'plan' ? '实施计划' : '实施准备'}的原因：`)
  if (reason === null) return
  if (!String(reason).trim()) { showToast('撤销原因不能为空', 'warning'); return }
  saving.value = true
  try {
    const payload = { reason: String(reason).trim(), expected_version: Number(item.version) || 0 }
    if (kind === 'plan') await revokeImplementationPlan(item.id, payload)
    else await revokePreparation(item.id, payload)
    showToast(kind === 'plan' ? '实施计划已撤销，已回到待分配' : '实施准备已撤销，设备预约已释放')
    await loadWorkspace()
  } catch (error) { showToast(error?.message || '撤销失败，请刷新后重试', 'error') } finally { saving.value = false }
}
async function submitRollbackRequest(kind) {
  const item = selectedServiceItem.value
  if (!item) { showToast('请先选择服务项', 'warning'); return }
  const reason = window.prompt(`请输入${kind === 'FIELD_TO_PREPARATION' ? '现场实施回退' : '报告返工'}申请原因：`)
  if (reason === null) return
  if (!String(reason).trim()) { showToast('申请原因不能为空', 'warning'); return }
  saving.value = true
  try {
    await requestRollback(item.id, { kind, reason: String(reason).trim(), expected_version: Number(item.version) || 0 })
    showToast('回退申请已提交，等待技术总监或系统管理员审批')
    await loadWorkspace()
  } catch (error) { showToast(error?.message || '回退申请失败', 'error') } finally { saving.value = false }
}
async function decidePendingRollback(request, decision) {
  const item = serviceItems.value.find((row) => row.id === request.service_item_id)
  if (!item) { showToast('服务项已不可见，无法审批', 'warning'); return }
  const comment = window.prompt(`请输入${decision === 'APPROVED' ? '批准' : '驳回'}意见：`)
  if (comment === null) return
  if (!String(comment).trim()) { showToast('审批意见不能为空', 'warning'); return }
  saving.value = true
  try {
    await decideRollback(item.id, request.id, { decision, comment: String(comment).trim(), expected_version: Number(item.version) || 0 })
    showToast(decision === 'APPROVED' ? '回退申请已批准，服务项已按补偿规则回退' : '回退申请已驳回')
    await loadWorkspace()
  } catch (error) { showToast(error?.message || '审批失败，请刷新后重试', 'error') } finally { saving.value = false }
}

async function saveCreate() {
  saving.value = true
  try {
    // 同一弹窗根据当前栏目创建不同资源；路由栏目在提交瞬间决定载荷形态，成功后再把
    // 服务端生成的记录并入对应集合。
    if (activeSection.value === 'projects') {
      const created = await createProject({
        name: createForm.value.name,
        contract_id: createForm.value.contractID,
        service_items: createForm.value.serviceLinks.map((link, index) => ({ source_id: `MANUAL-${String(index + 1).padStart(3, '0')}`, site: createForm.value.site, category: link.category, system: link.system, system_level: link.systemLevel, requirement: createForm.value.requirement, test_mode: createForm.value.testMode })),
      })
      projects.value = [created, ...projects.value]
      showToast(`项目 ${created.id} 已创建，服务项待拆解确认`)
      createOpen.value = false
      createForm.value = { name: '', customer: '', contract: '', contractID: '', contractVersion: '', site: '', requirement: '', testMode: 'STANDARD', serviceLinks: [emptyServiceLink()], scope: '', trigger: '', notes: '' }
    }
  } catch (error) { showToast(error?.message || '保存失败', 'error') }
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

// 所有弹层遵循同一关闭顺序：先收起内部下拉菜单，再关闭当前弹层；保存进行中不允许
// 通过 Esc 意外卸载表单，避免用户误以为保存已取消。按钮和遮罩仍保留各自明确的关闭动作。
function closeActiveOverlay() {
  if (saving.value) return false
  if (openMulti.value) { openMulti.value = ''; return true }
  if (planEquipmentPickerOpen.value) { planEquipmentPickerOpen.value = false; return true }
  if (operationDetail.value) { operationDetail.value = null; return true }
  if (configEditorOpen.value) { configEditorOpen.value = false; return true }
  if (overrideDialog.value) { overrideDialog.value = null; return true }
  if (categoryDialog.value) { categoryDialog.value = null; return true }
  if (capabilityDialog.value) { capabilityDialog.value = null; return true }
  if (adjustOpen.value) { adjustOpen.value = false; return true }
  if (createOpen.value) { createOpen.value = false; return true }
  if (mobileMenuOpen.value) { mobileMenuOpen.value = false; return true }
  return false
}

function onGlobalKeydown(event) {
  if (event.key !== 'Escape') return
  if (closeActiveOverlay()) event.preventDefault()
}

onMounted(loadWorkspace)
onMounted(loadPersonnel)
onMounted(() => {
  document.addEventListener('click', closeMultiOnOutsideClick)
  document.addEventListener('keydown', onGlobalKeydown)
})
// 进入资源分配/待办/指派栏目时刷新人员目录，保证新建或停用的平台账号能及时反映。
watch(activeSection, (section) => {
  if (['allocation', 'inbox', 'assignments'].includes(section)) loadPersonnel()
  if (section === 'preparation') loadEquipmentReservations(selectedServiceItem.value)
})
// 刷新或切换节点后，立即清除已经不属于当前节点的选择，避免回退项目残留操作按钮。
watch([activeSection, activeNodeItems], ([section, items]) => {
  if (!['allocation', 'inbox', 'planning', 'preparation', 'assignments', 'methods', 'exceptions', 'reports', 'implementation'].includes(section)) return
  const available = new Set(items.map((item) => item.id))
  selectedServiceItemIDs.value = selectedServiceItemIDs.value.filter((id) => available.has(id))
}, { immediate: true })
// 会话权限异步到达：只有拿到执行团队分配权限后，项目经理/工程师的角色目录才会被查询；
// 权限在这之后才加载完成时必须补一次，否则这两个下拉会一直空着。
// 切换服务项或在准备页刷新工作区时重新拉取设备占用：占用是别的项目造成的，
// 只靠本地缓存会给出过期的可选设备。
watch(selectedServiceItem, (item) => {
  if (activeSection.value === 'preparation') loadEquipmentReservations(item)
})
watch(canExecutionAssign, (allowed) => {
  if (allowed && ['allocation', 'inbox', 'assignments'].includes(activeSection.value)) loadPersonnel()
})
onBeforeUnmount(() => {
  window.clearTimeout(toastTimer)
  document.removeEventListener('click', closeMultiOnOutsideClick)
  document.removeEventListener('keydown', onGlobalKeydown)
})
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
        <div v-for="group in visibleNavGroups" :key="group.label" class="pm-nav-group">
          <button type="button" class="pm-nav-label" :aria-expanded="!isNavGroupCollapsed(group)" @click="toggleNavGroup(group)"><span>{{ group.label }}</span><i aria-hidden="true"></i></button>
          <div v-show="!isNavGroupCollapsed(group)" class="pm-nav-group-items">
            <button v-for="item in group.items" :key="item.key" class="pm-nav-item" :class="{ active: isNavItemActive(item) }" :aria-current="isNavItemActive(item) ? 'page' : undefined" @click="navigateNavItem(item)">
              <ConsoleIcon :name="item.icon" /><span>{{ item.label }}</span><em v-if="item.badge">{{ item.badge }}</em>
            </button>
          </div>
        </div>
        <div class="pm-nav-group">
          <div class="pm-nav-label">平台能力</div>
          <button class="pm-nav-item" type="button" @click="returnToUnifiedPortal"><ConsoleIcon name="dashboard" /><span>返回子系统门户</span></button>
        </div>
      </nav>
      <div class="pm-sidebar-foot">V1.0 · 项目服务内容管理</div>
      <div class="pm-sidebar-user">
        <span class="pm-avatar" aria-hidden="true">{{ currentUserInitial }}</span>
        <span class="pm-user-copy"><strong :title="currentUserName">{{ currentUserName }}</strong><small :title="currentUserRoleLabel">{{ currentUserRoleLabel }}</small></span>
        <button class="pm-logout" type="button" :disabled="isLoggingOut" aria-label="退出应用系统" @click="logoutSystem"><ConsoleIcon name="logout" /></button>
      </div>
    </aside>
    <div v-if="mobileMenuOpen" class="pm-menu-mask" @click="mobileMenuOpen = false"></div>

    <main class="pm-main">
      <header class="pm-topbar">
        <button class="pm-icon-button pm-menu-button" aria-label="打开菜单" @click="mobileMenuOpen = true"><ConsoleIcon name="menu" /></button>
        <div class="pm-breadcrumb"><span>项目服务管理</span><b>/</b><template v-if="activeSection === 'project_detail'"><button type="button" class="pm-crumb-link" @click="navigate('projects')">项目列表</button><b>/</b><strong>{{ detailProject?.id || '项目详情' }}</strong></template><strong v-else>{{ currentMeta[0] }}</strong></div>
        <div class="pm-top-tools">
          <button class="pm-icon-button pm-notification-button" aria-label="通知" @click="notificationOpen = !notificationOpen"><ConsoleIcon name="bell" /><em v-if="notificationCount">{{ notificationCount }}</em></button>
          <span class="pm-topbar-avatar" aria-hidden="true">{{ currentUserInitial }}</span>
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
            <button v-if="canManageRules && isVisibleConfigSection" class="pm-button primary" @click="openConfigCreate">{{ isStandardChangeSection ? '＋ 登记标准变更' : '＋ 新建规则' }}</button><button v-if="activeSection === 'projects' && canCreateProject" class="pm-button primary" @click="openCreateProject">＋ 新建项目</button>
            <button v-if="activeSection === 'decomposition' && canConfirmDecomposition" class="pm-button primary" :disabled="saving || !canConfirmCurrentDecomposition" @click="confirmDecomposition">{{ saving ? '提交中…' : '确认拆解' }}</button><button v-if="activeSection === 'decomposition' && canManageDecomposition" type="button" class="pm-button" :disabled="saving || !decompositionProject" @click="openDecompositionAdjust">调整拆解</button>
          </div>
        </section>

        <section v-if="loadError" class="pm-empty">
          <ConsoleIcon name="info" /><b>后端数据加载失败</b><span>{{ loadError }}</span><button class="pm-button" @click="loadWorkspace">重新加载</button>
        </section>

        <section v-if="['decomposition', 'allocation'].includes(activeSection) && missingStampedContractCount" class="pm-contract-warning"><ConsoleIcon name="info" /><div><b>{{ missingStampedContractCount }} 份合同尚未上传盖章合同</b><p>{{ activeSection === 'decomposition' ? '合同审批已完成，可继续核对并确认服务项拆解；该提示不阻断拆解确认。' : '服务项拆解已确认，可继续分配团队、人员及设备；上传盖章合同后提示将自动清除。' }}</p></div></section>

        <template v-if="activeSection === 'dashboard'">
          <section class="pm-kpis">
            <button type="button" class="pm-kpi primary" @click="navigate('projects')">
              <div class="pm-kpi-label"><span>全部项目</span><em>实时</em></div>
              <strong class="pm-kpi-value">{{ dashboard.project_count }}<small>个</small></strong>
              <p class="pm-kpi-meta">已完成 <b>{{ doneProjectCount }}</b> · 风险 <b>{{ dashboard.risk_projects }}</b> · 待拆解 <b>{{ pendingDecompositionCount }}</b></p>
            </button>
            <button type="button" class="pm-kpi primary" @click="navigate('decomposition')">
              <div class="pm-kpi-label"><span>全部服务项</span><em>实时</em></div>
              <strong class="pm-kpi-value">{{ dashboard.service_items }}<small>项</small></strong>
              <p class="pm-kpi-meta">待拆解确认 <b>{{ decompositionItems.length }}</b> 项 · 需业务管理员处理</p>
            </button>
            <button type="button" class="pm-kpi warn" @click="navigate('allocation')">
              <div class="pm-kpi-label"><span>资源分配待办</span><em>待处理</em></div>
              <strong class="pm-kpi-value">{{ serviceFlow[0].count }}<small>项</small></strong>
              <p class="pm-kpi-meta">已下达待完善 <b>{{ inboxItems.length }}</b> 项</p>
            </button>
            <button type="button" class="pm-kpi danger" @click="navigate('exceptions')">
              <div class="pm-kpi-label"><span>风险项目 / 异常</span><em>实时</em></div>
              <strong class="pm-kpi-value">{{ dashboard.risk_projects }}<small>项</small></strong>
              <p class="pm-kpi-meta">待评审偏离 <b>{{ pendingDeviations.length }}</b> 项 · 优先关注异常与终止项目</p>
            </button>
          </section>
          <section class="pm-dashboard-grid">
            <article class="pm-panel pm-status-panel">
              <header><div><p class="pm-panel-kicker">SERVICE FLOW</p><h2>服务项状态分布</h2></div><span>总计 <b>{{ serviceItems.length }}</b> 项</span></header>
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>状态</th><th class="num">数量</th><th>占比</th><th></th></tr></thead><tbody><tr v-for="flow in serviceFlow" :key="flow.key" :class="{ 'is-empty': flow.count === 0 }" @click="navigate(flow.route)"><td><span class="pm-badge" :class="statusTone(flow.key)">{{ flow.key }}</span></td><td class="num">{{ flow.count }}</td><td><div class="pm-bar-bg"><i class="pm-bar-fill" :class="flow.color" :style="{ width: `${serviceItems.length ? (flow.count * 100 / serviceItems.length).toFixed(1) : 0}%` }"></i></div><small>{{ serviceItems.length ? (flow.count * 100 / serviceItems.length).toFixed(1) : '0.0' }}%</small></td><td><button class="pm-link">→</button></td></tr><tr v-if="!serviceFlow.length"><td colspan="4" class="pm-empty-mini">暂无服务项数据</td></tr></tbody></table></div>
            </article>
            <article class="pm-panel">
              <header><div><p class="pm-panel-kicker danger">ATTENTION</p><h2>风险与待办</h2></div><button class="pm-link" @click="navigate('exceptions')">查看全部 →</button></header>
              <div class="pm-risk-list"><button v-for="risk in riskRows" :key="risk.id" @click="navigate('exceptions')"><span :class="risk.level === '高' ? 'high' : 'medium'">{{ risk.level }}</span><div><b>{{ risk.project }}</b><p>{{ risk.issue }}</p></div><time>{{ risk.deadline }}</time></button><div v-if="!riskRows.length" class="pm-empty-mini">暂无风险或待评审异常</div></div>
            </article>
          </section>
          <section class="pm-dashboard-grid-3">
            <article class="pm-panel pm-trend-panel">
              <header><div><p class="pm-panel-kicker">ON-TIME DELIVERY</p><h2>近 12 周准时交付率趋势</h2></div><span>近 4 周均值 <b>{{ onTimeRecentAverage !== null ? `${onTimeRecentAverage}%` : '—' }}</b></span></header>
              <div class="pm-trend-chart">
                <div v-for="week in weeklyDeliveryTrend" :key="week.key" class="pm-trend-bar" :title="week.tooltip">
                  <span class="pm-trend-val">{{ week.rate }}%</span>
                  <i :class="week.rate >= 85 ? 'good' : 'low'" :style="{ height: `${week.rate}%` }"></i>
                  <span class="pm-trend-lbl">{{ week.label }}</span>
                </div>
              </div>
              <div class="pm-chart-legend"><span><i class="pm-swatch good"></i>≥ 85% 准时</span><span><i class="pm-swatch low"></i>&lt; 85%</span></div>
            </article>
            <article class="pm-panel pm-category-panel">
              <header><div><p class="pm-panel-kicker">CATEGORY MIX</p><h2>检测类别分布（占比）</h2></div><span>{{ serviceItems.length }} 项服务项</span></header>
              <div class="pm-donut pm-category-donut" :style="{ background: categoryDonutStyle }"><div><strong>{{ serviceItems.length }}</strong><span>服务项</span></div></div>
              <div class="pm-status-list">
                <div v-for="segment in categoryDist" :key="segment.name" class="pm-status-row"><i class="pm-dot" :style="{ background: segment.color }"></i>{{ segment.name }}<b class="pm-num">{{ segment.pct }}%</b></div>
                <div v-if="!categoryDist.length" class="pm-empty-mini">暂无服务项数据</div>
              </div>
            </article>
            <article class="pm-panel pm-util-panel">
              <header><div><p class="pm-panel-kicker">TEAM LOAD</p><h2>团队资源利用率</h2></div><span>按当前在途服务项统计</span></header>
              <div class="pm-status-list">
                <div v-for="team in teamUtilization" :key="team.name" class="pm-status-libar"><span class="pm-lib-lbl">{{ team.name }}</span><div class="pm-bar-bg"><i class="pm-bar-fill" :class="team.pct >= 40 ? 'warn' : 'normal'" :style="{ width: `${team.pct}%` }"></i></div><span class="pm-num">{{ team.pct }}%</span></div>
                <div v-if="!teamUtilization.length" class="pm-empty-mini">暂无在途团队负载数据</div>
              </div>
              <p v-if="concentratedTeam" class="pm-alert warn"><i></i><b>{{ concentratedTeam.name }} 承担 {{ concentratedTeam.pct }}%</b> 的当前在途工作 · 建议关注排期与人力调配</p>
            </article>
          </section>
          <section class="pm-table-panel pm-panel-inflight">
            <header><div><p class="pm-panel-kicker">DELIVERY PULSE</p><h2>在途项目 · 实时动态</h2></div></header>
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>项目编号</th><th>客户</th><th>服务项</th><th>团队 / 项目经理</th><th>进度</th><th>计划完成</th><th></th></tr></thead><tbody><tr v-for="project in inFlightProjects.slice(0, 8)" :key="project.id" :class="{ risk: project.risk }"><td><button class="pm-project-link" @click="openProject(project)"><b>{{ project.id }}</b></button></td><td>{{ project.customer }}</td><td>{{ project.services }} 项</td><td><b>{{ project.team }}</b><span class="pm-cell-sub">{{ project.manager }}</span></td><td><div class="pm-progress-cell"><div class="pm-inline-progress"><i :style="{ width: `${project.progress}%` }"></i></div><small>{{ project.progress }}%</small></div></td><td :class="{ 'pm-text-danger': project.due.includes('超期') }">{{ project.due }}</td><td><button class="pm-link" @click="openProject(project)">详情</button></td></tr><tr v-if="!inFlightProjects.length"><td colspan="7" class="pm-empty-mini">暂无在途项目</td></tr></tbody></table></div>
            <footer v-if="inFlightProjects.length" class="pm-table-footer"><span>显示前 {{ Math.min(inFlightProjects.length, 8) }} 条</span><span>完整列表请前往实时监控</span></footer>
          </section>
        </template>

        <template v-else-if="activeSection === 'projects'">
          <section class="pm-kpi-row">
            <button type="button" class="pm-kpi" @click="statusFilter = ''"><div class="pm-kpi-label"><span>全部项目</span></div><strong class="pm-kpi-value">{{ projects.length }}<small>个</small></strong><p class="pm-kpi-meta">当前租户 · 实时</p></button>
            <button type="button" class="pm-kpi amber" @click="statusFilter = '待拆解确认'"><div class="pm-kpi-label"><span>待拆解确认</span></div><strong class="pm-kpi-value">{{ pendingDecompositionCount }}<small>个</small></strong><p class="pm-kpi-meta">需业务管理员处理</p></button>
            <button type="button" class="pm-kpi blue" @click="statusFilter = ''"><div class="pm-kpi-label"><span>在途项目</span></div><strong class="pm-kpi-value">{{ inFlightProjects.length }}<small>个</small></strong><p class="pm-kpi-meta">含实施中 / 报告编制</p></button>
            <button type="button" class="pm-kpi green" @click="statusFilter = '已完成'"><div class="pm-kpi-label"><span>已完成</span></div><strong class="pm-kpi-value">{{ doneProjectCount }}<small>个</small></strong><p class="pm-kpi-meta">已完成交付</p></button>
            <button v-if="canCreateProject" type="button" class="pm-kpi red" @click="openCreateProject"><div class="pm-kpi-label"><span>待新建项目</span></div><strong class="pm-kpi-value">{{ dashboard.pending_project_creation_available ? dashboard.pending_project_creation : '—' }}<small v-if="dashboard.pending_project_creation_available">个</small></strong><p class="pm-kpi-meta">{{ dashboard.pending_project_creation_available ? '合同流程已完成 · 尚未建项目' : '合同统计暂时不可用' }}</p></button>
            <button v-else type="button" class="pm-kpi red" @click="navigate('monitoring')"><div class="pm-kpi-label"><span>风险项目</span></div><strong class="pm-kpi-value">{{ riskProjectCount }}<small>个</small></strong><p class="pm-kpi-meta">含终止 / 超期</p></button>
          </section>
          <section class="pm-search-bar">
            <label class="pm-search-input"><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索项目编号 / 客户名称 / 服务项" aria-label="搜索项目" /></label>
            <select v-model="statusFilter" class="pm-filter-select" aria-label="按状态筛选"><option value="">状态：全部</option><option v-for="node in projectStatusFilters" :key="node" :value="node">{{ node }}</option></select>
            <select v-model="categoryFilter" class="pm-filter-select" aria-label="按检测类别筛选"><option value="">检测类别：全部</option><option v-for="option in categoryOptions" :key="option" :value="option">{{ option }}</option></select>
            <select v-model="teamFilter" class="pm-filter-select" aria-label="按团队筛选"><option value="">团队：全部</option><option v-for="option in teamOptions" :key="option" :value="option">{{ option }}</option></select>
            <span v-if="statusFilter" class="pm-filter-tag">状态：{{ statusFilter }}<button type="button" class="pm-filter-tag-x" :aria-label="`移除状态筛选 ${statusFilter}`" @click="statusFilter = ''">✕</button></span>
            <span v-if="categoryFilter" class="pm-filter-tag">类别：{{ categoryFilter }}<button type="button" class="pm-filter-tag-x" :aria-label="`移除类别筛选 ${categoryFilter}`" @click="categoryFilter = ''">✕</button></span>
            <span v-if="teamFilter" class="pm-filter-tag">团队：{{ teamFilter }}<button type="button" class="pm-filter-tag-x" :aria-label="`移除团队筛选 ${teamFilter}`" @click="teamFilter = ''">✕</button></span>
            <div class="pm-actions-row"><button class="pm-button ghost" @click="resetProjectFilters">重置</button><span class="pm-filter-count">{{ filteredProjects.length }} 条结果</span></div>
          </section>
          <section class="pm-table-panel">
            <div class="pm-table-scroll"><table class="pm-table pm-responsive-list"><thead><tr><th></th><th>项目 / 客户</th><th>合同编号</th><th>服务项</th><th>检测类别</th><th>团队 / 项目经理</th><th>状态</th><th>交付进度</th><th>计划完成</th><th></th></tr></thead><tbody>
              <tr v-for="project in pagedProjects" :key="project.id" :class="{ selected: selectedRows.includes(project.id), risk: project.risk }"><td class="pm-card-select" data-label="选择"><input type="checkbox" :checked="selectedRows.includes(project.id)" :aria-label="`选择 ${project.id}`" @change="toggleRow(project.id)" /></td><td class="pm-card-title" data-label="项目 / 客户"><button class="pm-project-link" @click="openProject(project)"><b>{{ project.id }}</b><span>{{ project.customer }}</span></button></td><td class="mono" data-label="合同编号">{{ project.contract }}</td><td data-label="服务项">{{ project.services }}</td><td data-label="检测类别">{{ project.category }}</td><td data-label="团队 / 项目经理"><b>{{ project.team }}</b><span class="pm-cell-sub">{{ project.manager }}</span></td><td data-label="状态"><span class="pm-badge" :class="statusTone(project.status)">{{ project.status }}</span></td><td data-label="交付进度"><div class="pm-progress-cell"><div class="pm-inline-progress"><i :style="{ width: `${project.progress}%` }"></i></div><small>{{ project.progress }}%</small></div></td><td data-label="计划完成" :class="{ 'pm-text-danger': project.due.includes('超期') }">{{ project.due }}</td><td class="pm-card-action" data-label="操作"><button class="pm-link" @click="openProject(project)">详情</button></td></tr>
              <tr v-if="!pagedProjects.length"><td colspan="10" class="pm-empty-mini">{{ projects.length ? '暂无符合当前筛选条件的项目' : '暂无项目，请先新建项目' }}</td></tr>
            </tbody></table></div>
            <footer class="pm-table-footer"><span>已选择 {{ selectedRows.length }} 项 · 共 {{ filteredProjects.length }} 条 · 第 {{ projectPage }} / {{ projectPageCount }} 页</span><div class="pm-pagination"><button class="pm-pg" :disabled="projectPage <= 1" @click="gotoProjectPage(projectPage - 1)">‹</button><button class="pm-pg active">{{ projectPage }}</button><button class="pm-pg" :disabled="projectPage >= projectPageCount" @click="gotoProjectPage(projectPage + 1)">›</button></div></footer>
          </section>
        </template>

        <template v-else-if="activeSection === 'project_detail'">
          <section v-if="!detailProject" class="pm-empty">
            <ConsoleIcon name="info" /><b>未找到项目</b><span>可能已被删除或不在你的数据范围内。</span><button class="pm-button" @click="navigate('projects')">返回项目列表</button>
          </section>
          <template v-else>
            <section class="pm-actions-bar"><button class="pm-button" @click="navigate('projects')"><ConsoleIcon name="reset" />返回项目列表</button><button class="pm-button" :disabled="loading" @click="loadWorkspace"><ConsoleIcon name="reset" />刷新</button></section>
            <article class="pm-panel">
              <header><div><p class="pm-panel-kicker">PROJECT OVERVIEW</p><h2>{{ detailProject.id }} · {{ detailProject.customer }}</h2></div><span class="pm-badge neutral">{{ detailProject.status }}</span></header>
              <dl class="pm-detail-summary">
                <div><dt>客户</dt><dd>{{ detailProject.customer }}</dd></div>
                <div><dt>合同编号</dt><dd>{{ detailProject.contract || '—' }}<small v-if="detailProject.contract_version">v{{ detailProject.contract_version }}</small></dd></div>
                <div><dt>服务项</dt><dd>{{ detailProject.services }} 项</dd></div>
                <div><dt>负责团队</dt><dd>{{ detailProject.team || '—' }}</dd></div>
                <div><dt>项目经理</dt><dd>{{ detailProject.manager || '待指派' }}</dd></div>
                <div><dt>计划完成</dt><dd>{{ detailProject.due || '待排期' }}</dd></div>
                <div><dt>盖章合同</dt><dd><span class="pm-badge" :class="stampedContractStateByProject.get(detailProject.id) === false ? '风险' : 'normal'">{{ stampedContractStateByProject.get(detailProject.id) === false ? '未上传' : '已上传' }}</span></dd></div>
                <div><dt>最近更新</dt><dd>{{ formatDateTime(detailProject.updated_at) }}</dd></div>
              </dl>
            </article>
            <section class="pm-sm-tabs pm-detail-tabs">
              <button v-for="tab in detailTabs" :key="tab.key" type="button" class="pm-tab-pill" :class="{ active: detailTab === tab.key }" @click="detailTab = tab.key">{{ tab.label }}<span class="pm-tab-count">{{ tab.count }}</span></button>
            </section>
            <article v-if="detailTab === 'items'" class="pm-table-panel">
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>服务项编号</th><th>场所 / 批次</th><th>检测类别</th><th>体系</th><th>特殊方法</th><th>状态</th><th>报告</th><th>计划窗口</th><th></th></tr></thead><tbody>
                <tr v-for="item in detailItems" :key="item.id"><td class="mono"><b>{{ item.id }}</b></td><td>{{ item.site }}<span class="pm-cell-sub">{{ item.batch }}</span></td><td>{{ item.category }}</td><td>{{ item.system || '—' }}</td><td><span class="pm-badge" :class="item.special === '是' ? '待确认' : 'neutral'">{{ item.special || '否' }}</span></td><td><span class="pm-badge" :class="statusTone(item.status)">{{ item.status }}</span></td><td>{{ item.report_status ? (reportStatusLabel[item.report_status] || item.report_status) : '—' }}</td><td>{{ item.planned_start ? `${String(item.planned_start).slice(0, 10)} ~ ${String(item.planned_end).slice(0, 10)}` : '待排期' }}</td><td><button class="pm-link" @click="navigate('implementation')">看板</button></td></tr>
                <tr v-if="!detailItems.length"><td colspan="9" class="pm-empty-mini">该项目暂无服务项</td></tr>
              </tbody></table></div>
            </article>
            <article v-if="detailTab === 'items' && detailGantt.length" class="pm-panel">
              <header><div><p class="pm-panel-kicker">PLAN WINDOW</p><h2>服务项计划窗口</h2></div><span>按全部已排期服务项的时间并集定位</span></header>
              <div class="pm-gantt">
                <div v-for="row in detailGantt" :key="row.id" class="pm-gantt-row">
                  <span class="pm-gantt-label"><b>{{ row.id }}</b> · {{ row.label }}</span>
                  <div class="pm-gantt-track"><span class="pm-gantt-bar" :class="ganttTone(row.status)" :style="{ left: `${row.left}%`, width: `${row.width}%` }">{{ row.window }}</span></div>
                </div>
              </div>
            </article>
            <article v-if="detailTab === 'plan'" class="pm-table-panel">
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>服务项</th><th>计划窗口</th><th>实施人员</th><th>设备</th><th>渗透合规</th></tr></thead><tbody>
                <tr v-for="item in detailItems.filter((row) => row.implementation_plan)" :key="item.id"><td class="mono"><b>{{ item.id }}</b></td><td>{{ item.planned_start ? `${String(item.planned_start).slice(0, 10)} ~ ${String(item.planned_end).slice(0, 10)}` : '—' }}</td><td>{{ (item.implementation_plan?.personnel || []).map((row) => row.resource_name).join('、') || '未登记' }}</td><td>{{ (item.implementation_plan?.equipment || []).map((row) => row.resource_name).join('、') || '未登记' }}</td><td><span v-if="item.test_mode === 'PENETRATION'" class="pm-badge 待确认">{{ item.implementation_plan?.auth_doc_no || '待补授权书' }}</span><span v-else>—</span></td></tr>
                <tr v-if="!detailItems.some((row) => row.implementation_plan)"><td colspan="5" class="pm-empty-mini">暂无已发布的实施计划</td></tr>
              </tbody></table></div>
            </article>
            <article v-if="detailTab === 'events'" class="pm-panel">
              <header><div><p class="pm-panel-kicker">DELIVERY EVENTS</p><h2>交付动态</h2></div><span>最近 {{ detailEvents.length }} 条</span></header>
              <div class="pm-timeline"><div v-for="event in detailEvents" :key="event.id"><i></i><b>{{ eventLabel(event) }}</b><p>{{ event.service_item_id || detailProject.id }} · 操作人 {{ personLabel(event.actor_user_id, '系统') }}</p><time>{{ formatDateTime(event.created_at) }}</time></div><div v-if="!detailEvents.length" class="pm-empty-mini">暂无交付动态</div></div>
            </article>
            <article v-if="detailTab === 'exceptions'" class="pm-panel">
              <header><div><p class="pm-panel-kicker danger">EXCEPTIONS</p><h2>异常记录</h2></div><button class="pm-link" @click="navigate('exceptions')">前往异常评审 →</button></header>
              <div class="pm-risk-list"><button v-for="event in detailPendingDeviations" :key="event.id" @click="navigate('exceptions')"><span :class="event.payload?.severity === 'HIGH' ? 'high' : 'medium'">{{ event.payload?.severity === 'HIGH' ? '高' : '中' }}</span><div><b>{{ event.payload?.deviation_id }} · {{ event.service_item_id }}</b><p>{{ event.payload?.description || '现场偏离' }}</p></div><time>{{ formatDateTime(event.created_at) }}</time></button><div v-if="!detailPendingDeviations.length" class="pm-empty-mini">该项目暂无待评审异常</div></div>
            </article>
          </template>
        </template>

        <template v-else-if="activeSection === 'monitoring'">
          <article class="pm-panel">
            <header><div><p class="pm-panel-kicker">STATUS MIX</p><h2>在途项目状态分布</h2></div><span>共 {{ inFlightProjects.length }} 个在途项目</span></header>
            <div class="pm-statusbar" role="img" :aria-label="monitoredStatusMix.map((bucket) => `${bucket.key} ${bucket.count} 个`).join('，')">
              <i v-for="bucket in monitoredStatusMix" :key="bucket.key" :style="{ width: `${bucket.pct}%`, background: bucket.tone }" :title="`${bucket.key} ${bucket.count} 个（${bucket.pct}%）`"></i>
            </div>
            <div class="pm-statusbar-legend">
              <span v-for="bucket in monitoredStatusMix" :key="bucket.key"><i :style="{ background: bucket.tone }"></i>{{ bucket.key }} {{ bucket.count }} 个</span>
              <span v-if="!monitoredStatusMix.length">暂无在途项目</span>
            </div>
          </article>
          <section class="pm-sm-tabs">
            <button v-for="tab in monitorFilterTabs" :key="tab.key || 'all'" type="button" class="pm-tab-pill" :class="{ active: monitorFilter === tab.key }" @click="monitorFilter = tab.key">{{ tab.label }}</button>
          </section>
          <section class="pm-dashboard-grid">
            <article class="pm-panel">
              <header><div><p class="pm-panel-kicker">IN FLIGHT</p><h2>在途项目概览</h2></div><span>共 {{ inFlightProjects.length }} 个在途项目</span></header>
              <div class="pm-overview-metrics">
                <dl class="pm-desc-list">
                  <div class="pm-desc-item"><dt>平均完成度</dt><dd>{{ averageProgress }}%</dd></div>
                  <div class="pm-desc-item"><dt>服务项总数</dt><dd>{{ serviceItems.length }}</dd></div>
                  <div class="pm-desc-item"><dt>待拆解确认</dt><dd>{{ pendingDecompositionCount }}</dd></div>
                  <div class="pm-desc-item"><dt>活跃异常</dt><dd class="pm-text-danger">{{ riskRows.length }}</dd></div>
                  <div class="pm-desc-item"><dt>待评审偏离</dt><dd class="pm-text-danger">{{ pendingDeviations.length }}</dd></div>
                  <div class="pm-desc-item"><dt>SLA 超期 / 临近</dt><dd :class="slaOverdueItems.length ? 'pm-text-danger' : ''">{{ slaOverdueItemCount }}</dd></div>
                  <div class="pm-desc-item"><dt>已完成项目</dt><dd class="pm-text-success">{{ doneProjectCount }}</dd></div>
                </dl>
              </div>
            </article>
            <article class="pm-panel pm-risk-card">
              <header><div><p class="pm-panel-kicker danger">RISK WATCH</p><h2>⚠ 风险预警 <b class="pm-num-badge">{{ riskProjectCount }}</b></h2></div><button class="pm-link" @click="navigate('exceptions')">查看全部 →</button></header>
              <div class="pm-risk-list"><button v-for="risk in riskRows" :key="risk.id" @click="navigate('exceptions')"><span :class="risk.level === '高' ? 'high' : 'medium'">{{ risk.level }}</span><div><b>{{ risk.project }}</b><p>{{ risk.issue }}</p></div><time>{{ risk.deadline }}</time></button><div v-if="!riskRows.length" class="pm-empty-mini">暂无风险待处理</div></div>
            </article>
          </section>
          <section class="pm-table-panel">
            <header><div><p class="pm-panel-kicker danger">SLA WATCH</p><h2>SLA 超期与临近超期服务项</h2></div><span>综合计划完成时间与流程时限生成提醒</span></header>
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>服务项</th><th>所属项目</th><th>场所 / 类别</th><th>状态</th><th>口径</th><th>判定依据</th><th>时限</th></tr></thead><tbody>
              <tr v-for="item in slaOverdueItems" :key="`${item.kind}-${item.id}`"><td class="mono"><b>{{ item.id }}</b></td><td><button class="pm-project-link" @click="openProject({ id: item.project_id })"><b>{{ item.project_id }}</b></button></td><td>{{ item.site }}<span class="pm-cell-sub">{{ item.category }}</span></td><td><span class="pm-badge" :class="statusTone(item.status)">{{ item.status }}</span></td><td><span class="pm-badge" :class="item.kind === 'STATUS_DEADLINE_APPROACHING' ? '关注' : '风险'">{{ slaKindLabel[item.kind] || '计划完成超期' }}</span></td><td>{{ item.rule_name ? `${item.rule_name}（${item.rule_status} · ${item.deadline_hours}h）` : (item.planned_end ? `计划完成 ${String(item.planned_end).slice(0, 16).replace('T', ' ')}` : '—') }}</td><td :class="{ 'pm-text-danger': item.kind !== 'STATUS_DEADLINE_APPROACHING' }">{{ slaDueLabel(item) }}</td></tr>
              <tr v-if="!slaOverdueItems.length"><td colspan="7" class="pm-empty-mini">暂无超期或临近超期的服务项</td></tr>
            </tbody></table></div>
          </section>
          <section class="pm-table-panel">
            <header class="pm-monitor-head">
              <span class="pm-filter-count">共 {{ monitoredProjects.length }} 条</span>
            </header>
            <div class="pm-filters pm-filters-flat"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索项目 / 客户 / 团队" /></label><select v-model="teamFilter" class="pm-filter-select" aria-label="按团队筛选"><option value="">团队：全部</option><option v-for="option in teamOptions" :key="option" :value="option">{{ option }}</option></select><button class="pm-button ghost" @click="resetProjectFilters">重置</button></div>
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>项目编号</th><th>客户</th><th>服务项</th><th>团队</th><th>项目经理</th><th>状态</th><th>进度</th><th>计划完成</th><th></th></tr></thead><tbody><tr v-for="project in filteredMonitoredProjects" :key="project.id" :class="{ risk: project.risk }"><td><button class="pm-project-link" @click="openProject(project)"><b>{{ project.id }}</b></button></td><td>{{ project.customer }}</td><td>{{ project.services }} 项</td><td>{{ project.team }}</td><td>{{ project.manager }}</td><td><span class="pm-badge" :class="statusTone(project.status)">{{ project.status }}</span><span class="pm-cell-sub">{{ monitoredStatusByProject(project.status) }}</span></td><td><div class="pm-progress-cell"><div class="pm-inline-progress"><i :style="{ width: `${project.progress}%` }"></i></div><small>{{ project.progress }}%</small></div></td><td :class="{ 'pm-text-danger': project.due.includes('超期') }">{{ project.due }}</td><td><button class="pm-btn-link" @click="openProject(project)">详情</button></td></tr><tr v-if="!filteredMonitoredProjects.length"><td colspan="9" class="pm-empty-mini">暂无匹配的在途项目</td></tr></tbody></table></div>
            <footer class="pm-table-footer"><span>共 {{ filteredMonitoredProjects.length }} 个在途项目</span><div class="pm-pagination"><button class="pm-pg" disabled>‹</button><button class="pm-pg active">1</button><button class="pm-pg" disabled>›</button></div></footer>
          </section>
        </template>

        <template v-else-if="activeSection === 'decomposition'">
          <section v-if="decompositionProject" class="pm-source-card pm-decomposition-source-card">
            <div class="pm-source-icon"><ConsoleIcon name="account" /></div>
            <div class="pm-source-content">
              <span>合同来源</span>
              <h2>{{ decompositionProject.contract }} · {{ decompositionProject.customer }}</h2>
              <p>合同版本 {{ decompositionProject.contract_version || '—' }} · 自动生成于 {{ formatDateTime(decompositionProject.created_at) }}</p>
            </div>
            <div class="pm-source-actions">
              <label v-if="decompositionProjects.length > 1" class="pm-decomposition-switcher">
                <span class="pm-decomposition-switcher-label">当前拆解项目</span>
                <span class="pm-decomposition-select-shell">
                  <select v-model="selectedDecompositionProjectID" aria-label="选择当前拆解项目">
                    <option v-for="project in decompositionProjects" :key="project.id" :value="project.id">{{ project.id }} · {{ project.name || project.customer }}</option>
                  </select>
                </span>
              </label>
              <span class="pm-badge normal">{{ decompositionProject.status }}</span>
            </div>
          </section>
          <section v-if="!decompositionProject" class="pm-empty pm-decomposition-empty"><ConsoleIcon name="info" /><b>暂无待拆解合同</b><span>已审批合同生成待确认服务项后会显示在这里，无需手工创建拆解任务。</span></section>
          <section v-else class="pm-decompose-grid"><article class="pm-panel pm-tree-panel"><header><div><p class="pm-panel-kicker">SERVICE TREE</p><h2>服务项树</h2></div><span>{{ currentDecompositionItems.length }} 项</span></header><button v-for="([batch, items], index) in decompositionBatches" :key="batch" :class="{ active: index === 0 }"><span>{{ String(index + 1).padStart(2, '0') }}</span><div><b>{{ batch }}</b><small>{{ items.length }} 个服务项</small></div></button><div class="pm-tree-note"><b>自动拆解校验</b><p>{{ currentDecompositionItems.filter((item) => item.test_mode === 'PENETRATION').length }} 项渗透测试需要专项计划；确认后的服务项进入资源分配。</p></div></article>
            <article class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>纳入</th><th>服务项编号</th><th>场所 / 批次</th><th>检测类别</th><th>技术要求摘要</th><th>体系</th><th>特殊方法</th><th>状态</th></tr></thead><tbody><tr v-for="item in currentDecompositionItems" :key="item.id"><td><input v-model="item.selected" type="checkbox" :aria-label="`纳入 ${item.id}`" /></td><td class="mono"><b>{{ item.id }}</b></td><td>{{ item.site }}<span class="pm-cell-sub">{{ item.batch }}</span></td><td>{{ item.category }}</td><td>{{ item.requirement }}</td><td>{{ item.system }}</td><td><span class="pm-badge" :class="item.special === '是' ? '待确认' : 'neutral'">{{ item.special }}</span></td><td><span class="pm-badge" :class="statusTone(item.status)">{{ item.status }}</span></td></tr></tbody></table></div></article>
          </section>
        </template>

        <template v-else-if="activeSection === 'implementation'">
          <section class="pm-board-summary"><div><strong>{{ implementationProjectCount }}</strong><span>当前节点项目</span></div><div><strong>{{ implementationItems.length }}</strong><span>当前节点服务项</span></div><div><strong>{{ preparedImplementationCount }}</strong><span>准备完成</span></div><div><strong>{{ fieldImplementationCount }}</strong><span>现场实施中</span></div></section>
          <section class="pm-kanban"><article v-for="column in implementationKanbanColumns" :key="column.key"><header><div><i :class="column.color"></i><b>{{ column.key }}</b></div><span>{{ column.count }}</span></header><div class="pm-kanban-body"><button v-for="card in column.cards" :key="card.id" class="pm-kanban-card" :class="[column.color, { risk: card.risk }]" @click="openProject(card)"><b>{{ card.id }}</b><h3>{{ card.customer }}</h3><span class="pm-badge" :class="statusTone(card.status)">{{ card.status }}</span><div class="pm-inline-progress"><i :style="{ width: `${card.progress}%` }"></i></div><footer><span>{{ card.progress }}%</span><time>{{ card.due || '待排期' }}</time></footer></button><div v-if="!column.cards.length" class="pm-empty-mini">暂无当前节点项目</div></div></article></section>
          <section class="pm-panel pm-operation-panel"><header><div><p class="pm-panel-kicker">FIELD EXECUTION</p><h2>现场记录与实施完成</h2></div></header><ServiceItemPicker :items="implementationItems" :selected-ids="selectedServiceItem ? [selectedServiceItem.id] : []" empty-text="暂无处于现场实施节点的服务项" @select="selectServiceItem" /><div v-if="selectedServiceItem && canExecuteField" class="pm-form pm-operation-form"><label><span>现场原始数据 <em>*</em></span><textarea v-model.trim="operationForm.rawData" rows="3" placeholder="记录现场实测数据与依据"></textarea></label><label><span>环境条件 <em>*</em></span><textarea v-model.trim="operationForm.environment" rows="3" placeholder="记录现场环境条件"></textarea></label><label><span>现场证据 <em>*</em></span><input type="file" accept="application/pdf,image/png,image/jpeg" @change="operationForm.fieldEvidenceFile = $event.target.files?.[0] || null" /><small>文件通过统一文件网关上传、扫描并以 SHA-256 回执存证。</small></label><button class="pm-button primary" :disabled="saving" @click="runOperation('field')">提交现场记录</button></div><button v-if="selectedServiceItem && selectedServiceItem.status === '实施中' && canCompleteField" class="pm-button" :disabled="saving" @click="runOperation('complete')">确认该服务项现场完成</button><div v-else-if="!selectedServiceItem" class="pm-empty-mini">请先选择服务项</div></section>
        </template>

        <template v-else-if="activeSection === 'equipment'">
          <section class="pm-panel pm-equipment-layout">
            <form v-if="canManageDevice" class="pm-form pm-equipment-form" @submit.prevent="saveEquipment">
              <label><span>设备编号 <em>*</em></span><input v-model.trim="equipmentForm.resourceID" required placeholder="例如 EQ-001" /></label>
              <label><span>设备名称 <em>*</em></span><input v-model.trim="equipmentForm.resourceName" required placeholder="请输入设备名称" /></label>
              <div class="pm-field pm-span-full">
                <span>能力编码 <em>*</em></span>
                <div class="pm-multi-dropdown" :class="{ open: openMulti === 'equipmentCodes' }">
                  <button type="button" class="pm-multi-trigger" :class="{ placeholder: !equipmentCodeSelection.length }" aria-haspopup="listbox" :aria-expanded="openMulti === 'equipmentCodes'" @click.stop="toggleMulti('equipmentCodes')" @keydown="onEquipmentCodesKeydown"><span>{{ multiSummary(equipmentCodeSelection, equipmentCodeOptions, '请选择设备能力编码', 'code') }}</span><i class="pm-multi-caret"></i></button>
                  <div v-if="openMulti === 'equipmentCodes'" class="pm-multi-menu" role="listbox" aria-label="选择设备能力编码" aria-multiselectable="true">
                    <label v-for="option in equipmentCodeOptions" :key="option.code" class="pm-multi-option" :class="{ 'is-active': equipmentCodeOptions[multiActiveIndex]?.code === option.code }" role="option" :aria-selected="equipmentCodeSelection.includes(option.code)"><input type="checkbox" :checked="equipmentCodeSelection.includes(option.code)" @change="toggleEquipmentCode(option.code)" /><span>{{ option.name }}<small v-if="option.unavailable" class="pm-form-hint">{{ option.unavailableReason }}，仅保留历史引用</small></span></label>
                    <p v-if="!equipmentCodeOptions.length" class="pm-empty-mini">暂无可选编码，请先到系统配置维护设备能力编码</p>
                  </div>
                </div>
                <div v-if="equipmentCodeSelection.length" class="pm-multi-chips"><span v-for="option in equipmentCodeOptions.filter((item) => equipmentCodeSelection.includes(item.code))" :key="option.code" class="pm-chip">{{ option.code }}{{ option.unavailable ? `（${option.unavailableReason}）` : '' }}<button type="button" class="pm-chip-x" :aria-label="`移除 ${option.code}`" @click.stop="toggleEquipmentCode(option.code)">✕</button></span></div>
                <p v-if="!hasActiveCapabilityCodes('EQUIPMENT')" class="pm-form-hint">请先到「系统配置 → 资质 / 能力编码」新增并启用设备能力编码。</p>
              </div>
              <label><span>检定开始</span><input v-model="equipmentForm.validFrom" type="date" /></label>
              <label><span>检定到期</span><input v-model="equipmentForm.validUntil" type="date" /></label>
              <label><span>状态</span><select v-model="equipmentForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
              <label><span>使用范围</span><select v-model="equipmentForm.usageScope"><option value="ANY">可借出</option><option value="COMPANY_ONLY">仅在公司使用（不可借出）</option></select></label>
              <button class="pm-button primary">保存设备</button>
            </form>
            <p v-else class="pm-form-hint">当前角色只能查看设备台账；维护设备需要「设备维护」权限。</p>
          </section>
          <section class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>设备编号</th><th>设备名称</th><th>能力</th><th>检定有效期</th><th>状态</th><th>在位 / 使用范围</th><th>操作</th></tr></thead><tbody><tr v-for="item in equipment" :key="item.resource_id"><td class="mono">{{ item.resource_id }}</td><td><b>{{ item.resource_name }}</b></td><td><span v-if="!(item.codes || []).length">—</span><span v-else class="pm-code-pills"><span v-for="code in item.codes" :key="code" class="pm-code-pill">{{ code }}</span></span></td><td>{{ item.valid_until ? formatDateTime(item.valid_until) : '未设置' }}</td><td><span class="pm-badge" :class="statusTone(item.status)">{{ item.status === 'ACTIVE' ? '启用' : '停用' }}</span></td><td><span class="pm-badge" :class="item.presence === 'OUT_OF_COMPANY' ? 'amber' : 'normal'">{{ equipmentPresenceLabel(item) }}</span><small v-if="item.borrowed_by" class="pm-cell-sub">{{ item.borrowed_by }} · {{ item.borrowed_window }}</small><small v-if="item.usage_scope === 'COMPANY_ONLY'" class="pm-form-hint">仅在公司使用 · 不可借出</small></td><td><button v-if="canManageDevice" class="pm-link" :disabled="saving" @click="editEquipment(item)">编辑 / 更新</button><button v-if="canManageDevice" class="pm-link danger" :disabled="saving" @click="removeEquipment(item)">删除</button><button v-if="item.presence === 'OUT_OF_COMPANY' && (canManageDevice || canPlanImplementation)" class="pm-link danger" :disabled="saving" @click="returnEquipment(item)">归还</button></td></tr></tbody></table></div><p v-if="equipmentError" class="pm-form-hint" role="alert">{{ equipmentError }}</p><div v-else-if="!equipment.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无设备</b><span>使用上方表单新增设备。</span></div></section>
        </template>
        <template v-else-if="activeSection === 'qualifications'"><section class="pm-panel"><header class="pm-section-toolbar"><div class="pm-panel-actions"><input ref="qualificationFileInput" class="pm-file-input" type="file" accept=".csv,text/csv" @change="importQualificationFile" /><button class="pm-button" :disabled="saving" @click="downloadCapabilities">导出 CSV</button><template v-if="canManageResource"><button class="pm-button" :disabled="saving" @click="qualificationFileInput.click()">导入 CSV</button><button class="pm-button" :disabled="saving" @click="syncIdentities">同步人员状态</button><button class="pm-button primary" :disabled="saving" @click="openCapabilityDialog()">＋ 新建资质</button></template></div></header><div class="pm-qualification-filter"><section class="pm-sm-tabs pm-capability-tabs"><button v-for="tab in capabilityTabs" :key="tab.key" type="button" class="pm-tab-pill" :class="{ active: capabilityTab === tab.key }" @click="capabilityTab = tab.key">{{ tab.label }}<span class="pm-tab-count">{{ tab.count }}</span></button></section><label><span>资源类型</span><select v-model="capabilityTypeFilter" class="pm-filter-select"><option value="">全部</option><option value="PERSON">人员资质</option><option value="EQUIPMENT">设备能力</option></select></label><label><span>状态</span><select v-model="capabilityStatusFilter" class="pm-filter-select"><option value="">全部</option><option value="ACTIVE">有效</option><option value="DISABLED">停用</option></select></label></div></section><section v-if="capabilityTab === 'codes'" class="pm-table-panel"><header><div><p class="pm-panel-kicker">CODE MATRIX</p><h2>体系与编码映射</h2></div><span>按能力台账聚合：编码 × 持有人员数 / 设备数</span></header><div class="pm-matrix-wrap"><table class="pm-matrix"><thead><tr><th>能力编码</th><th>人员</th><th>设备</th><th>覆盖合计</th></tr></thead><tbody><tr v-for="row in capabilityCodeRows" :key="row.code"><td><span class="pm-code-pill">{{ row.code }}</span></td><td><span class="pm-badge" :class="row.personCount ? 'normal' : 'neutral'">{{ row.personCount }} 人</span></td><td><span class="pm-badge" :class="row.equipmentCount ? 'normal' : 'neutral'">{{ row.equipmentCount }} 台</span></td><td class="num">{{ row.personCount + row.equipmentCount }}</td></tr><tr v-if="!capabilityCodeRows.length"><td colspan="4" class="pm-empty-mini">暂无能力编码，请在资质记录中维护</td></tr></tbody></table></div></section>
          <section v-else-if="capabilityTab === 'expiry'" class="pm-table-panel"><header><div><p class="pm-panel-kicker danger">EXPIRY WATCH</p><h2>设备检定到期提醒</h2></div><span>30 天内到期或已过期 · 按到期时间升序</span></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>设备编号</th><th>设备名称</th><th>能力编码</th><th>检定到期日</th><th>状态</th></tr></thead><tbody><tr v-for="item in expiringCapabilities" :key="item.resource_id" :class="{ risk: new Date(item.valid_until).getTime() <= Date.now() }"><td class="mono">{{ item.resource_id }}</td><td><b>{{ item.resource_name }}</b></td><td><span v-if="!(item.codes || []).length">—</span><span v-else class="pm-code-pills"><span v-for="code in item.codes" :key="code" class="pm-code-pill">{{ code }}</span></span></td><td :class="{ 'pm-text-danger': new Date(item.valid_until).getTime() <= Date.now() }">{{ item.valid_until.slice(0, 10) }}</td><td><span class="pm-badge" :class="new Date(item.valid_until).getTime() <= Date.now() ? '风险' : '关注'">{{ new Date(item.valid_until).getTime() <= Date.now() ? '已过期' : '即将到期' }}</span></td></tr><tr v-if="!expiringCapabilities.length"><td colspan="5" class="pm-empty-mini">30 天内没有到期的设备检定</td></tr></tbody></table></div></section>
          <section v-else class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>资源类型</th><th>编号</th><th>名称</th><th>资质 / 能力编码</th><th>有效期</th><th>使用范围</th><th>状态</th><th>人员状态</th><th></th></tr></thead><tbody><tr v-for="item in filteredCapabilities" :key="item.resource_id"><td><span class="pm-badge neutral">{{ item.resource_type === 'PERSON' ? '人员' : '设备' }}</span></td><td class="mono">{{ item.resource_id }}</td><td><b>{{ item.resource_name }}</b></td><td><span v-if="!(item.codes || []).length">—</span><span v-else class="pm-code-pills"><span v-for="code in item.codes" :key="code" class="pm-code-pill">{{ code }}</span></span></td><td>{{ item.valid_until ? (item.valid_from ? `${item.valid_from.slice(0, 10)} ~ ` : '') + item.valid_until.slice(0, 10) : '长期' }}</td><td><span v-if="item.resource_type === 'EQUIPMENT'" class="pm-badge" :class="item.usage_scope === 'COMPANY_ONLY' ? '关注' : 'neutral'">{{ item.usage_scope === 'COMPANY_ONLY' ? '仅在公司使用' : '可借出' }}</span><span v-else>—</span></td><td><span class="pm-badge" :class="statusTone(item.status)">{{ item.status === 'ACTIVE' ? '有效' : '停用' }}</span></td><td><template v-if="item.resource_type === 'PERSON'"><span class="pm-badge" :class="statusTone(item.identity_status)">{{ identityStatusLabel(item.identity_status) }}</span></template><span v-else>—</span></td><td class="pm-col-actions"><button v-if="canManageResource" class="pm-link" @click="openCapabilityDialog(item)">编辑 / 更新</button></td></tr></tbody></table></div><div v-if="!filteredCapabilities.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无资质记录</b><span>点击「＋ 新建资质」或通过 CSV 导入添加记录。</span></div><footer v-if="importResult"><span role="status">导入完成：成功 {{ importResult.imported }} 条，跳过 {{ importResult.skipped }} 条。</span><span v-if="importResult.errors?.length"><small>{{ importResult.errors.slice(0, 3).join('；') }}{{ importResult.errors.length > 3 ? '…' : '' }}</small></span></footer></section>
          <div v-if="capabilityDialog" class="pm-overlay" @click.self="capabilityDialog = null">
            <form class="pm-dialog" @submit.prevent="saveCapability">
              <header><div><span>CAPABILITY</span><h2>{{ capabilityDialog.resource_id ? '编辑资质 / 能力' : '新建资质 / 能力' }}</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="capabilityDialog = null"><ConsoleIcon name="close" /></button></header>
              <div class="pm-form">
                <label><span>资源类型 <em>*</em></span><select v-model="capabilityDialog.resource_type" required @change="onCapabilityTypeChange"><option value="PERSON">人员资质</option><option value="EQUIPMENT">设备能力</option></select></label>
                <label><span>{{ capabilityDialog.resource_type === 'EQUIPMENT' ? '设备编号' : '人员编号' }} <em>*</em></span><input v-model.trim="capabilityDialog.resource_id" :readonly="capabilityAutoID" required placeholder="系统自动生成" /><small v-if="capabilityAutoID" class="pm-form-hint">由系统自动生成（人员 P- / 设备 EQ-），无需手工填写</small></label>
                <label v-if="capabilityDialog.resource_type === 'PERSON'"><span>人员名称 <em>*</em></span><select v-model="capabilityDialog.user_id" :disabled="capabilityPersonnelLoading" required @change="onCapabilityPersonChange"><option value="">{{ capabilityPersonnelLoading ? '基础平台人员加载中…' : '请选择基础平台人员' }}</option><option v-for="person in capabilityPersonOptions" :key="person.id" :value="person.id">{{ person.name }}</option></select><small v-if="capabilityPersonnelError" class="pm-form-hint" role="alert">{{ capabilityPersonnelError }}</small></label>
                <label v-else><span>资源名称 <em>*</em></span><input v-model.trim="capabilityDialog.resource_name" required placeholder="例如 基站A" /></label>
                <div class="pm-field pm-span-full">
                  <span>资质 / 能力编码 <em>*</em></span>
                  <SearchableSelect
                    v-model="capabilityCodeSelection"
                    :options="capabilityDialogCodeOptions"
                    value-key="code"
                    label-key="name"
                    description-key="unavailableReason"
                    placeholder="请选择资质 / 能力编码"
                    search-placeholder="搜索编码或名称"
                    empty-text="暂无匹配编码，请先到系统配置维护"
                    aria-label="选择资质或能力编码"
                    menu-z-index="calc(var(--pm-z-modal, 50) + 1)"
                    multiple
                    required
                  />
                  <p v-if="!hasActiveCapabilityCodes(capabilityDialog.resource_type)" class="pm-form-hint">请先到「系统配置 → 资质 / 能力编码」新增并启用{{ capabilityDialog.resource_type === 'PERSON' ? '人员资质' : '设备能力' }}编码。</p>
                </div>
                <label v-if="capabilityDialog.resource_type === 'EQUIPMENT'"><span>检定开始</span><input v-model="capabilityDialog.valid_from" type="date" /></label>
                <label v-if="capabilityDialog.resource_type === 'EQUIPMENT'"><span>检定到期</span><input v-model="capabilityDialog.valid_until" type="date" /></label>
                <p v-else class="pm-form-hint pm-span-full">人员资质不限制有效期；停用资质或人员身份失效后将不能参与项目分配。</p>
                <label v-if="capabilityDialog.resource_type === 'EQUIPMENT'"><span>使用范围</span><select v-model="capabilityDialog.usage_scope"><option value="ANY">可借出</option><option value="COMPANY_ONLY">仅在公司使用（不可借出）</option></select></label>
                <label><span>状态</span><select v-model="capabilityDialog.status"><option value="ACTIVE">有效</option><option value="DISABLED">停用</option></select></label>
              </div>
              <footer><button type="button" class="pm-button" @click="capabilityDialog = null">取消</button><button class="pm-button primary" :disabled="saving || (capabilityDialog.resource_type === 'PERSON' && (!capabilityDialog.user_id || capabilityPersonnelLoading))">{{ saving ? '保存中…' : '保存资质' }}</button></footer>
            </form>
          </div>
        </template><template v-else-if="activeSection === 'split-rules'">
            <section class="pm-split-guide" aria-labelledby="split-guide-title">
              <div class="pm-split-guide-copy">
                <span class="pm-badge normal">新手引导</span>
                <p class="pm-panel-kicker">QUICK START</p>
                <h2 id="split-guide-title">3 步完成合同自动拆解</h2>
                <p>合同生效或补充协议调整时，系统会依次应用下面三层配置。已有项目不会被自动重算，可以放心先从推荐配置开始。</p>
                <div class="pm-split-guide-actions">
                  <button v-if="canManageRules" type="button" class="pm-button primary" :disabled="splitConfigLoading || splitPolicySaving" @click="applyRecommendedSplitPolicy">使用安全推荐配置</button>
                  <button type="button" class="pm-button" @click="scrollToSplitSection('split-policy-section')">从第 1 步开始</button>
                </div>
              </div>
              <div class="pm-split-flow" aria-label="拆解规则生效顺序">
                <button type="button" @click="scrollToSplitSection('split-policy-section')"><span>1</span><b>决定怎么分组</b><small>{{ splitPolicy?.enabled ? '默认规则已启用' : '默认规则未启用' }}</small></button>
                <i aria-hidden="true">→</i>
                <button type="button" @click="scrollToSplitSection('split-category-section')"><span>2</span><b>补全类别要求</b><small>{{ activeDetectionCategoryCount }} 个启用类别</small></button>
                <i aria-hidden="true">→</i>
                <button type="button" @click="scrollToSplitSection('split-override-section')"><span>3</span><b>处理特殊合同</b><small>{{ activeSplitOverrideCount }} 条启用特例 · 可选</small></button>
              </div>
              <div class="pm-split-outcome">
                <div><span>当前规则会怎样执行</span><b>{{ splitPolicySummary }}</b></div>
                <ul><li>未匹配类别：{{ splitMissingRuleText(splitPolicy?.missing_rule_action) }}</li><li>范围变更核对：{{ splitPolicy?.scope_change_detection ? '开启' : '关闭' }}</li><li>技术要求摘要：{{ splitPolicy?.generate_requirement_summary ? '自动生成' : '人工填写' }}</li></ul>
              </div>
            </section>

            <section id="split-policy-section" class="pm-panel pm-split-card pm-split-anchor">
              <header><div><p class="pm-panel-kicker">STEP 1 · SPLIT POLICY</p><h2>① 默认分组规则</h2><p>先定义大多数合同如何合并明细。建议保留“批次 + 检测类别”，并让业务管理员确认后再进入分配。</p></div><span class="pm-badge" :class="splitPolicy?.enabled ? 'normal' : 'neutral'">{{ splitPolicy?.enabled ? '已启用' : '已停用' }}</span></header>
              <div class="pm-form pm-split-form">
                <div class="pm-split-live-summary pm-span-full"><span>实时结果预览</span><b>{{ splitPolicySummary }}</b><small>这只是配置解释，不会立即修改已有项目；保存后仅对后续合同生效。</small></div>
                <div v-if="splitPolicyIssues.length" class="pm-split-validation pm-span-full" role="alert"><b>保存前请修正</b><span v-for="issue in splitPolicyIssues" :key="issue">{{ issue }}</span></div>
                <label><span>分组维度 1</span><select v-model="splitPolicy.dimension_primary" :disabled="!canManageRules"><option v-for="option in splitDimensionPrimaryOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                <label><span>分组维度 2</span><select v-model="splitPolicy.dimension_secondary" :disabled="!canManageRules"><option v-for="option in splitDimensionSecondaryOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                <label><span>分组维度 3（可选）</span><select v-model="splitPolicy.dimension_tertiary" :disabled="!canManageRules"><option value="">不使用</option><option v-for="option in splitDimensionAnyOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                <label><span>默认进入状态</span><select v-model="splitPolicy.default_status" :disabled="!canManageRules"><option v-for="option in splitDefaultStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                <label><span>是否生成「技术要求摘要」</span><select v-model="splitPolicy.generate_requirement_summary" :disabled="!canManageRules"><option :value="true">是 · 自动从合同条款抽取（默认）</option><option :value="false">否 · 留空人工填写</option></select></label>
                <label><span>技术要求摘要字段</span><select v-model="splitPolicy.requirement_summary_locked" :disabled="!canManageRules"><option :value="false">生成后默认可编辑（默认）</option><option :value="true">锁定（仅技术总监可改）</option></select></label>
                <label><span>分组规则缺失时</span><select v-model="splitPolicy.missing_rule_action" :disabled="!canManageRules"><option v-for="option in splitMissingRuleOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                <label><span>范围变更检测</span><select v-model="splitPolicy.scope_change_detection" :disabled="!canManageRules"><option :value="true">开启：合同清单与拆解结果勾对（默认）</option><option :value="false">关闭</option></select></label>
                <label><span>启用自动拆解规则</span><select v-model="splitPolicy.enabled" :disabled="!canManageRules"><option :value="true">启用自定义规则</option><option :value="false">停用并回退到安全默认</option></select><small>停用后不会停止生成服务项，而是全部进入待确认，且不应用特殊合同覆盖规则。</small></label>
                <div v-if="canManageRules" class="pm-split-savebar pm-span-full"><span>{{ splitPolicyDirty ? '有尚未保存的修改' : '当前配置已保存' }}</span><div><button v-if="splitPolicyDirty" type="button" class="pm-button" :disabled="splitPolicySaving" @click="resetSplitPolicyChanges">撤销修改</button><button type="button" class="pm-button primary" :disabled="splitPolicySaving || !splitPolicyDirty || splitPolicyIssues.length > 0" @click="submitSplitPolicy">{{ splitPolicySaving ? '保存中…' : '保存并用于后续合同' }}</button></div></div>
              </div>
            </section>

            <section id="split-category-section" class="pm-panel pm-split-card pm-split-anchor">
              <header><div><p class="pm-panel-kicker">STEP 2 · DETECTION CATEGORY</p><h2>② 检测类别与人员要求</h2><p>为合同里的检测类别设置默认体系、人员资质和特殊方法要求，拆解后会自动带入服务项。</p></div><span class="pm-filter-count">启用 {{ activeDetectionCategoryCount }} / 共 {{ detectionCategories.length }} 类</span><div class="pm-panel-actions"><template v-if="canManageRules"><button type="button" class="pm-button" @click="downloadDetectionCategories">导出</button><button type="button" class="pm-button" :disabled="saving" @click="detectionCategoryFileInput.click()">导入</button><button type="button" class="pm-button primary" @click="openCategoryDialog()">＋ 新增类别</button><input ref="detectionCategoryFileInput" type="file" accept=".csv,text/csv" class="sr-only" @change="importDetectionCategoryFile" /></template></div></header>
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>检测类别</th><th>默认体系要求</th><th>必备资质（默认）</th><th>是否特殊方法</th><th>关联服务项</th><th>状态</th><th></th></tr></thead><tbody><tr v-for="item in detectionCategories" :key="item.category"><td><b>{{ item.category }}</b></td><td>{{ item.system_standard || '—' }}</td><td>{{ item.required_qualifications || '—' }}</td><td><span class="pm-badge" :class="specialMethodTone[item.special_method] || 'neutral'">{{ specialMethodLabel[item.special_method] || item.special_method }}</span></td><td>{{ item.service_item_count || 0 }} 项</td><td><span class="pm-badge" :class="item.enabled ? 'normal' : 'neutral'">{{ item.enabled ? '启用' : '停用' }}</span></td><td class="pm-split-actions"><button v-if="canManageRules" class="pm-link" @click="openCategoryDialog(item)">编辑</button><button v-if="canManageRules" class="pm-link pm-text-danger" :disabled="saving" @click="removeDetectionCategory(item)">删除</button></td></tr><tr v-if="!detectionCategories.length"><td colspan="7" class="pm-empty-mini">尚未配置检测类别域</td></tr></tbody></table></div>
            </section>

            <section id="split-override-section" class="pm-panel pm-split-card pm-split-anchor">
              <header><div><p class="pm-panel-kicker">STEP 3 · EXCEPTIONS</p><h2>③ 特殊合同覆盖规则 <span class="pm-badge neutral">可选</span></h2><p>只有少数客户或合同需要不同拆解方式时才配置。数字越小优先级越高，命中第一条后停止继续匹配。</p></div><span class="pm-filter-count">启用 {{ activeSplitOverrideCount }} / 共 {{ splitOverrides.length }} 条</span><div class="pm-panel-actions"><button v-if="canManageRules" type="button" class="pm-button" @click="openOverrideDialog()">＋ 新建特例</button></div></header>
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>规则名称</th><th>匹配条件</th><th>覆盖设置</th><th>优先级</th><th>状态</th><th></th></tr></thead><tbody><tr v-for="item in splitOverrides" :key="item.id"><td><b>{{ item.name }}</b></td><td>{{ overrideMatchText(item) }}</td><td>{{ overrideSettingsText(item) }}</td><td>{{ item.priority }}</td><td><span class="pm-badge" :class="item.enabled ? 'normal' : 'neutral'">{{ item.enabled ? '启用' : '停用' }}</span></td><td class="pm-split-actions"><button v-if="canManageRules" class="pm-link" @click="openOverrideDialog(item)">编辑</button><button v-if="canManageRules" class="pm-link pm-text-danger" :disabled="saving" @click="removeSplitOverride(item)">删除</button></td></tr><tr v-if="!splitOverrides.length"><td colspan="6" class="pm-empty-mini">尚未配置覆盖规则，全部合同按默认分组规则拆解</td></tr></tbody></table></div>
              <p v-if="splitConfigError" class="pm-form-hint" role="alert">{{ splitConfigError }}</p>
              <p v-else-if="splitConfigLoading" class="pm-form-hint">配置加载中…</p>
            </section>

            <div v-if="categoryDialog" class="pm-overlay" @click.self="categoryDialog = null">
              <form class="pm-dialog" @submit.prevent="submitDetectionCategory">
                <header><div><span>DETECTION CATEGORY</span><h2>{{ categoryDialog.id ? '编辑检测类别' : '新增检测类别' }}</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="categoryDialog = null"><ConsoleIcon name="close" /></button></header>
                <div class="pm-form">
                  <label><span>检测类别 <em>*</em></span><input v-model.trim="categoryDialog.category" required placeholder="例如 等保测评" /></label>
                  <label><span>默认体系要求</span><input v-model.trim="categoryDialog.system_standard" placeholder="例如 等保 2.0 / ISO 9001" /></label>
                  <label><span>必备资质（默认）</span><input v-model.trim="categoryDialog.required_qualifications" placeholder="例如 等级保护测评师（中级+）" /></label>
                  <div class="pm-field pm-span-full">
                    <span>必检人员能力码（默认）</span>
                    <div class="pm-multi-dropdown" :class="{ open: openMulti === 'detectionRequiredCodes' }">
                      <button type="button" class="pm-multi-trigger" :class="{ placeholder: !detectionRequiredCodeSelection.length }" aria-haspopup="listbox" :aria-expanded="openMulti === 'detectionRequiredCodes'" @click.stop="toggleMulti('detectionRequiredCodes')" @keydown="onDetectionRequiredCodesKeydown"><span>{{ multiSummary(detectionRequiredCodeSelection, detectionRequiredCodeOptions, '请选择人员资质编码', 'code') }}</span><i class="pm-multi-caret"></i></button>
                      <div v-if="openMulti === 'detectionRequiredCodes'" class="pm-multi-menu" role="listbox" aria-label="选择必检人员能力码" aria-multiselectable="true">
                        <label v-for="option in detectionRequiredCodeOptions" :key="option.code" class="pm-multi-option" :class="{ 'is-active': detectionRequiredCodeOptions[multiActiveIndex]?.code === option.code }" role="option" :aria-selected="detectionRequiredCodeSelection.includes(option.code)"><input type="checkbox" :checked="detectionRequiredCodeSelection.includes(option.code)" @change="toggleDetectionRequiredCode(option.code)" /><span>{{ option.name }}<small v-if="option.unavailable" class="pm-form-hint">{{ option.unavailableReason }}，仅保留历史引用</small></span></label>
                        <p v-if="!detectionRequiredCodeOptions.length" class="pm-empty-mini">暂无可选人员资质编码，请先到系统配置维护</p>
                      </div>
                    </div>
                    <div v-if="detectionRequiredCodeSelection.length" class="pm-multi-chips"><span v-for="option in detectionRequiredCodeOptions.filter((item) => detectionRequiredCodeSelection.includes(item.code))" :key="option.code" class="pm-chip">{{ option.code }}{{ option.unavailable ? `（${option.unavailableReason}）` : '' }}<button type="button" class="pm-chip-x" :aria-label="`移除 ${option.code}`" @click.stop="toggleDetectionRequiredCode(option.code)">✕</button></span></div>
                    <small class="pm-form-hint">按该类别拆解出的服务项会带上这些人员资质编码，分配工程师时据此校验。</small>
                  </div>
                  <label><span>是否特殊方法</span><select v-model="categoryDialog.special_method"><option v-for="option in specialMethodOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                  <label><span>状态</span><select v-model="categoryDialog.enabled"><option :value="true">启用</option><option :value="false">停用</option></select></label>
                </div>
                <footer><button type="button" class="pm-button" @click="categoryDialog = null">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></footer>
              </form>
            </div>

            <div v-if="overrideDialog" class="pm-overlay" @click.self="overrideDialog = null"><form class="pm-dialog pm-dialog-wide" @submit.prevent="submitSplitOverride"><header><div><span>OVERRIDE RULE</span><h2>{{ overrideDialog.id ? '编辑覆盖规则' : '新建覆盖规则' }}</h2><small class="pm-dialog-sub">只覆盖显式给出的设置，其余沿用默认分组规则；命中多条时取优先级最小的那条。</small></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="overrideDialog = null"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>规则名称 <em>*</em></span><input v-model.trim="overrideDialog.name" required placeholder="例如 金融行业批量合同" /></label><label><span>优先级 <em>*</em></span><input v-model.number="overrideDialog.priority" type="number" min="1" required /></label><label><span>客户名称包含</span><input v-model.trim="overrideDialog.match.customer_contains" placeholder="例如 银行 / 证券" /></label><label><span>合同号包含</span><input v-model.trim="overrideDialog.match.contract_contains" placeholder="例如 HT-2026" /></label><label><span>合同服务项数 ≤</span><input v-model.number="overrideDialog.match.max_service_items" type="number" min="0" /></label><label><span>覆盖分组维度 1</span><select v-model="overrideDialog.settings.dimension_primary"><option value="">不覆盖</option><option v-for="option in splitDimensionAnyOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label><span>覆盖分组维度 2</span><select v-model="overrideDialog.settings.dimension_secondary"><option value="">不覆盖</option><option v-for="option in splitDimensionAnyOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label><span>覆盖分组维度 3</span><select v-model="overrideDialog.settings.dimension_tertiary"><option value="">不覆盖</option><option v-for="option in splitDimensionAnyOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label><span>覆盖默认进入状态</span><select v-model="overrideDialog.settings.default_status"><option value="">不覆盖</option><option v-for="option in splitDefaultStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label><span>覆盖缺规则处理</span><select v-model="overrideDialog.settings.missing_rule_action"><option value="">不覆盖</option><option v-for="option in splitMissingRuleOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label><span>状态</span><select v-model="overrideDialog.enabled"><option :value="true">启用</option><option :value="false">停用</option></select></label></div><footer><button type="button" class="pm-button" @click="overrideDialog = null">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></footer></form></div>
          </template>
          <template v-else-if="isVisibleConfigSection">
          <section class="pm-kpi-row">
            <div class="pm-kpi"><div class="pm-kpi-label"><span>{{ isStandardChangeSection ? '变更登记' : '规则总数' }}</span></div><strong class="pm-kpi-value">{{ configStats.total }}<small>条</small></strong><p class="pm-kpi-meta">{{ activeConfigMeta.label }}</p></div>
            <div class="pm-kpi green"><div class="pm-kpi-label"><span>{{ isStandardChangeSection ? '评估中' : '已启用' }}</span></div><strong class="pm-kpi-value">{{ configStats.enabled }}<small>条</small></strong><p class="pm-kpi-meta">{{ isStandardChangeSection ? '待确认影响并完成处置' : '参与运行时判定' }}</p></div>
            <div class="pm-kpi red"><div class="pm-kpi-label"><span>{{ isStandardChangeSection ? '已归档' : '已停用' }}</span></div><strong class="pm-kpi-value">{{ configStats.disabled }}<small>条</small></strong><p class="pm-kpi-meta">{{ isStandardChangeSection ? '影响评估已完成' : '不再参与运行时判定' }}</p></div>
          </section>
          <section v-if="isStandardChangeSection" class="pm-alert info"><i></i><b>唯一维护入口</b><span>检测标准变更只在此处登记和评估，不再出现在“规则配置中心”。“评估中”表示仍需核对在途项目、检测方法或报告模板；完成处置后请归档记录。</span></section>
          <section v-if="activeSection === 'sla'" class="pm-alert info"><i></i><b>SLA 口径说明</b><span>状态 SLA 按「服务项停留在该状态的时长」判定（每次状态推进刷新计时）：超过时限记为超期，剩余时间不足提前提醒小时数记为临近提醒；计划完成时间超期作为独立口径在服务项列表单独统计。</span></section>
          <section v-if="activeSection === 'permissions' && permissionMatrix.rows.length" class="pm-table-panel">
            <header><div><p class="pm-panel-kicker">ACCESS MATRIX</p><h2>字段 × 角色 访问矩阵</h2></div><span>{{ permissionMatrix.rows.length }} 个受控字段 · {{ permissionMatrix.roles.length }} 个角色</span></header>
            <div class="pm-matrix-wrap"><table class="pm-matrix"><thead><tr><th>字段 ↓ \ 角色 →</th><th v-for="role in permissionMatrix.roles" :key="role">{{ role }}</th></tr></thead><tbody><tr v-for="row in permissionMatrix.rows" :key="row.field"><td class="mono">{{ row.field }}</td><td v-for="(cell, index) in row.cells" :key="`${row.field}-${permissionMatrix.roles[index]}`"><span v-if="cell" class="pm-badge" :class="permissionLevelTone[cell] || 'neutral'">{{ permissionLevelLabel[cell] || cell }}</span><span v-else class="pm-matrix-empty">未配置</span></td></tr></tbody></table></div>
          </section>
          <section class="pm-config-layout"><aside class="pm-config-note"><span><ConsoleIcon name="info" /></span><h2>{{ isStandardChangeSection ? '评估流程' : '生效范围' }}</h2><template v-if="isStandardChangeSection"><p>登记标准变化与影响范围，核对在途项目、检测方法和报告模板，处置完成后将记录归档。</p><ul><li>评估中：尚有影响待确认或待处置</li><li>已归档：影响核对和处置均已完成</li><li>历史记录用于追溯，不会自动改写已有项目</li></ul></template><template v-else><p>{{ activeConfigMeta.effectNote || currentMeta[1] }}</p><ul><li>配置修改需业务管理员权限</li><li>创建、更新和重新启用执行相同校验</li><li>关闭规则前请确认影响范围</li></ul></template></aside><article class="pm-table-panel"><header class="pm-filter-bar"><div v-if="!isStandardChangeSection" class="pm-sm-tabs"><button v-for="meta in visibleConfigKinds" :key="meta.kind" type="button" class="pm-tab-pill" :class="{ active: activeSection === meta.kind }" @click="navigate(meta.kind)">{{ meta.label }}</button></div><div v-else><b>标准变更评估清单</b></div><span class="pm-filter-count">{{ activeConfigMeta.label }} 共 {{ visibleRules.length }} 条</span></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>{{ isStandardChangeSection ? '标准 / 方法名称' : '配置名称' }}</th><th v-for="column in activeConfigMeta.columns" :key="column.key">{{ column.label }}</th><th>状态</th><th>最后更新</th><th></th></tr></thead><tbody><tr v-for="rule in visibleRules" :key="rule.id"><td><b>{{ rule.name }}</b></td><td v-for="column in activeConfigMeta.columns" :key="column.key">{{ rule[column.key] !== undefined && rule[column.key] !== '' ? rule[column.key] : '—' }}</td><td><template v-if="isStandardChangeSection"><span class="pm-badge" :class="rule.enabled ? 'amber' : 'neutral'">{{ rule.enabled ? '评估中' : '已归档' }}</span><button v-if="canManageRules" class="pm-link" :disabled="saving" @click="toggleRule(rule)">{{ rule.enabled ? '完成并归档' : '恢复评估' }}</button></template><button v-else-if="canManageRules" class="pm-switch" :class="{ on: rule.enabled }" :aria-label="`${rule.enabled ? '停用' : '启用'} ${rule.name}`" @click="toggleRule(rule)"><i></i></button><span v-else class="pm-badge" :class="rule.enabled ? 'normal' : 'neutral'">{{ rule.enabled ? '已启用' : '已停用' }}</span></td><td>{{ rule.updated }}</td><td><button v-if="canManageRules" class="pm-link" @click="openConfigEdit(rule)">编辑</button><button v-if="canManageRules" class="pm-link pm-text-danger" :disabled="saving" @click="removeConfigRule(rule)">删除</button></td></tr></tbody></table></div><div v-if="!visibleRules.length" class="pm-empty"><ConsoleIcon name="info" /><b>{{ isStandardChangeSection ? '暂无标准变更记录' : '暂无配置规则' }}</b><span>{{ isStandardChangeSection ? '发生标准或检测方法变更时，点击“登记标准变更”开始影响评估。' : `点击“新建规则”添加 ${activeConfigMeta.label} 配置。` }}</span></div></article></section>
        </template>

        <template v-else>
          <section class="pm-operational-stats"><article><span>待处理</span><strong>{{ operationRows.length }}</strong><small>来自当前工作区</small></article><article><span>服务项总数</span><strong>{{ serviceItems.length }}</strong><small>以最新流程状态为准</small></article><article><span>已完成项目</span><strong>{{ completedProjectCount }}</strong><small>当前租户累计</small></article></section>
          <section class="pm-filters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索编号、项目或负责人" /></label><span>{{ operationRows.length }} 条结果</span></section>
          <section v-if="['allocation', 'inbox', 'planning', 'preparation', 'assignments', 'methods', 'exceptions', 'reports'].includes(activeSection)" class="pm-panel pm-operation-panel">
            <header><div><p class="pm-panel-kicker">REAL OPERATION</p><h2>服务项操作台</h2></div><span v-if="selectedServiceItem" class="pm-op-current">当前：{{ selectedServiceItem.id }} · <span class="pm-badge" :class="statusTone(selectedServiceItem.status)">{{ selectedServiceItem.status }}</span></span></header>
            <ServiceItemPicker v-if="activeSection === 'allocation'" :items="allocationItems" :selected-ids="selectedServiceItemIDs" multiple empty-text="暂无可分配服务项" hint="仅显示已完成拆解确认、当前处于待分配的项目；可多选批量分配。" @toggle="toggleServiceItem" /><ServiceItemPicker v-else :items="activeNodeItems" :selected-ids="selectedServiceItem ? [selectedServiceItem.id] : []" empty-text="当前节点暂无可操作服务项" @select="selectServiceItem" />
            <div v-if="activeSection === 'allocation' && selectedServiceItems.length" class="pm-panel-actions">
              <button v-if="canManageDecomposition" type="button" class="pm-button" :disabled="saving" @click="returnSelectedToDecomposition">退回拆解确认</button>
              <button v-if="canRevokeExecution" type="button" class="pm-button" :disabled="saving" @click="revokeSelectedAssignment('execution')">撤销执行团队</button>
              <button v-if="canRevokeTeam" type="button" class="pm-button danger" :disabled="saving" @click="revokeSelectedAssignment('team')">撤销团队负责人</button>
            </div>
            <div v-if="selectedServiceItem" class="pm-panel-actions">
              <button v-if="canRevokeImplementation && selectedServiceItem.status === '待实施'" type="button" class="pm-button danger" :disabled="saving" @click="revokeDeliveryPhase('plan')">撤销实施计划</button>
              <button v-if="canRevokeImplementation && selectedServiceItem.status === '实施准备中'" type="button" class="pm-button danger" :disabled="saving" @click="revokeDeliveryPhase('preparation')">撤销实施准备并释放设备</button>
              <button v-if="canRequestRollback && selectedServiceItem.status === '实施中'" type="button" class="pm-button" :disabled="saving" @click="submitRollbackRequest('FIELD_TO_PREPARATION')">申请回退至实施准备</button>
              <button v-if="canRequestRollback && selectedServiceItem.status === '现场实施完成' && ['COMPILING', 'REVIEWED'].includes(selectedServiceItem.report_status)" type="button" class="pm-button" :disabled="saving" @click="submitRollbackRequest('REPORT_TO_FIELD')">申请报告返工</button>
            </div>
            <section v-if="activeSection === 'inbox' && pendingRollbackRequests.length" class="pm-panel pm-approval-panel"><header><div><p class="pm-panel-kicker">ROLLBACK APPROVAL</p><h2>待处理回退申请</h2></div><span>{{ pendingRollbackRequests.length }} 项</span></header><div v-for="request in pendingRollbackRequests" :key="request.id" class="pm-form-row"><span>{{ request.service_item_id }} · {{ request.payload?.kind === 'FIELD_TO_PREPARATION' ? '现场回退' : '报告返工' }} · {{ request.payload?.reason }}</span><template v-if="canApproveRollback && request.actor_user_id !== session?.user_id"><button type="button" class="pm-button primary" :disabled="saving" @click="decidePendingRollback(request, 'APPROVED')">批准</button><button type="button" class="pm-button danger" :disabled="saving" @click="decidePendingRollback(request, 'REJECTED')">驳回</button></template><button v-if="canRequestRollback && request.actor_user_id === session?.user_id" type="button" class="pm-button" :disabled="saving" @click="withdrawPendingRollback(request)">撤回申请</button></div></section>
            <div v-if="selectedServiceItem" class="pm-form pm-operation-form">
              <template v-if="['allocation', 'inbox', 'assignments'].includes(activeSection)">
                <p v-if="personnelError" class="pm-form-hint pm-span-full" role="alert">{{ personnelError }}</p>
                <div class="pm-field"><span>团队负责人 <em>*</em></span><SearchableSelect v-model="operationForm.teamLeadID" :options="teamLeadOptions" value-key="id" label-key="name" description-key="description" placeholder="请选择团队负责人" search-placeholder="搜索姓名、资质编号或资质编码" empty-text="人员资质库中没有匹配的团队负责人" aria-label="选择团队负责人" :disabled="personnelLoading" required /></div>
                <template v-if="canExecutionAssign">
                  <div class="pm-field"><span>项目经理 <em>*</em></span><SearchableSelect v-model="operationForm.projectManagerID" :options="projectManagerOptions" value-key="id" label-key="name" description-key="description" placeholder="请选择项目经理" search-placeholder="搜索姓名、资质编号或资质编码" empty-text="人员资质库中没有匹配的项目经理" aria-label="选择项目经理" :disabled="personnelLoading" required /></div>
                  <div class="pm-field"><span>工程师 <em>*</em></span><SearchableSelect v-model="engineerSelection" :options="engineerOptions" value-key="id" label-key="name" description-key="description" placeholder="请选择工程师（可多选）" search-placeholder="搜索姓名、资质编号或资质编码" empty-text="人员资质库中没有匹配的工程师" aria-label="选择工程师" :disabled="personnelLoading" multiple required /></div>
                </template>
                <p v-if="selectedServiceItems.length" class="pm-form-hint pm-allocation-preview">影响预览：将为 {{ selectedServiceItems.length }} 个服务项{{ canExecutionAssign ? '写入团队负责人、项目经理与工程师并触发能力校验' : '写入团队负责人' }}；已选 {{ selectedServiceItems.map((item) => item.id).join('、') }}</p>
                <button v-if="canSubmitAllocation" class="pm-button primary" :disabled="saving" @click="runOperation('allocation')">{{ saving ? '提交中…' : canExecutionAssign ? '保存分配并校验能力' : '分配团队负责人' }}</button>
              </template>
              <template v-else-if="activeSection === 'planning'"><section v-if="operationSteps.length" class="pm-panel pm-stepper-panel"><div class="pm-stepper"><template v-for="(step, index) in operationSteps" :key="step.label"><div class="pm-step" :class="step.state"><span class="pm-step-num">{{ step.state === 'done' ? '✓' : index + 1 }}</span><span>{{ step.label }}</span></div><div v-if="index < operationSteps.length - 1" class="pm-step-line"></div></template></div></section><div v-if="planningBlocked" class="pm-blocker" :class="planningBlocked.tone" role="alert"><b>暂时不能发布实施计划</b><span>{{ planningBlocked.reason }}</span><button class="pm-button" type="button" @click="navigate('allocation')">前往任务分配</button></div><label><span>计划开始 <em>*</em></span><input v-model.trim="operationForm.plannedStart" type="datetime-local" /></label><label><span>计划结束 <em>*</em></span><input v-model.trim="operationForm.plannedEnd" type="datetime-local" /></label><label><span>现场计划 <em>*</em></span><textarea v-model.trim="operationForm.sitePlan" rows="3" placeholder="现场实施步骤和窗口"></textarea></label><template v-if="selectedServiceItem.test_mode === 'PENETRATION'"><label><span>渗透测试专项计划 <em>*</em></span><textarea v-model.trim="operationForm.penetrationTestPlan" rows="3"></textarea></label><fieldset class="pm-compliant-fieldset"><legend>专项合规要素（授权 / 白名单 / 时间窗 / 应急 / 回滚）</legend><label><span>授权书编号 <em>*</em></span><input v-model.trim="operationForm.authDocNo" required placeholder="例如 AUTH-2026-001" /></label><label><span>授权生效 <em>*</em></span><input v-model.trim="operationForm.authStart" type="datetime-local" required /></label><label><span>授权截止 <em>*</em></span><input v-model.trim="operationForm.authEnd" type="datetime-local" required /></label><label><span>授权范围 <em>*</em></span><input v-model.trim="operationForm.authScope" required placeholder="例如 内网段 10.0.0.0/8" /></label><label><span>计划测试范围 <em>*</em></span><input v-model.trim="operationForm.testScope" required placeholder="例如 关键业务系统 WEB 渗透" /></label><label><span>测试时间窗 <em>*</em></span><input v-model.trim="operationForm.testWindow" required placeholder="例如 00:00-06:00" /></label><label><span>应急联系人 <em>*</em></span><input v-model.trim="operationForm.emergencyContact" required placeholder="姓名 + 电话" /></label><label><span>回滚方案 <em>*</em></span><textarea v-model.trim="operationForm.rollbackPlan" rows="3" required></textarea></label></fieldset></template><section class="pm-plan-resources"><header><div><b>实施人员</b><small>资质编码取自「资质与能力」档案，人员不限制有效期；使用时段留空表示全程；设备清单在「实施准备」中登记</small></div></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>名称</th><th>规格 / 资质</th><th>有效期规则</th><th>使用时段</th><th>备注</th><th></th></tr></thead><tbody><tr v-for="(row, index) in operationForm.personnel" :key="row.resourceID"><td>{{ planResourceName(row) }}</td><td><span v-if="!planResourceCodes(row).length">—</span><span v-else class="pm-code-pills"><span v-for="code in planResourceCodes(row)" :key="code" class="pm-code-pill">{{ code }}</span></span></td><td>{{ planResourceValidUntil(row) }}</td><td><div class="pm-plan-window"><input v-model="row.windowStart" type="date" aria-label="使用时段开始" /><span>~</span><input v-model="row.windowEnd" type="date" aria-label="使用时段结束" /></div></td><td><input v-model.trim="row.note" placeholder="例如 备份" /></td><td><button type="button" class="pm-link danger" @click="removePlanPersonnel(index)">移除</button></td></tr><tr v-if="!operationForm.personnel.length"><td colspan="6" class="pm-empty-mini">请至少添加一名实施人员</td></tr></tbody></table></div></section><button v-if="canPlanImplementation" class="pm-button primary" :disabled="saving || !!planningBlocked" :title="planningBlocked ? planningBlocked.reason : ''" @click="runOperation('planning')">发布实施计划</button></template>
              <template v-else-if="activeSection === 'methods'"><div class="pm-review-state"><span>复核状态</span><b class="pm-badge" :class="statusTone(item && reportTechReviewLabel(item.tech_review_status))">{{ item && reportTechReviewLabel(item.tech_review_status) }}</b></div><template v-if="item && ['PENDING', 'REJECTED'].includes(item.tech_review_status)"><label><span>复核意见</span><textarea v-model.trim="operationForm.reviewComment" rows="3" placeholder="填写风险说明或驳回原因"></textarea></label><div v-if="canReviewSpecialMethod" class="pm-form-row"><button class="pm-button primary" :disabled="saving" @click="runOperation('special-approve')">通过复核</button><button class="pm-button" :disabled="saving" @click="runOperation('special-reject')">驳回复核</button></div></template><template v-else-if="item && item.tech_review_status === 'APPROVED'"><p class="pm-form-hint">{{ item.tech_review_comment || '已通过复核，可发布实施计划' }}<span v-if="item.tech_reviewed_at"> · {{ formatDateTime(item.tech_reviewed_at) }} · {{ item.tech_reviewed_by }} </span></p></template><template v-else-if="item && item.tech_review_status === 'PENDING'"><p class="pm-form-hint">等待技术总监复核特殊方法。</p></template></template>
              <template v-else-if="activeSection === 'preparation'"><section class="pm-plan-resources"><header><div><b>设备清单</b><small>只列设备目录中的有效设备；同一设备在同一时段被其他服务项占用时不可选取</small></div><button type="button" class="pm-button" @click="openEquipmentPicker">＋ 添加设备</button></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>设备</th><th>能力码</th><th>检定有效期</th><th>使用时段</th><th>备注</th><th></th></tr></thead><tbody><tr v-for="(row, index) in operationForm.equipment" :key="row.resourceID"><td>{{ planResourceName(row) }}</td><td><span v-if="!planResourceCodes(row).length">—</span><span v-else class="pm-code-pills"><span v-for="code in planResourceCodes(row)" :key="code" class="pm-code-pill">{{ code }}</span></span></td><td>{{ planResourceValidUntil(row) }}</td><td><div class="pm-plan-window"><input v-model="row.windowStart" type="date" aria-label="使用时段开始" /><span>~</span><input v-model="row.windowEnd" type="date" aria-label="使用时段结束" /></div></td><td><input v-model.trim="row.note" placeholder="例如 备用机" /></td><td><button type="button" class="pm-link danger" @click="removePlanEquipment(index)">移除</button></td></tr><tr v-if="!operationForm.equipment.length"><td colspan="6" class="pm-empty-mini">请至少选择一台实施设备</td></tr></tbody></table></div></section><label><span>行程预订单 <em>*</em></span><input v-model.trim="operationForm.travelRequestID" /></label><label><span>备注</span><textarea v-model.trim="operationForm.comment" rows="3"></textarea></label><button v-if="canPlanImplementation" class="pm-button primary" :disabled="saving" @click="runOperation('preparation')">发起实施准备</button></template>
              <template v-else-if="activeSection === 'exceptions'"><section v-if="exceptionFlow.length" class="pm-panel pm-approval-panel"><header><div><p class="pm-panel-kicker">REVIEW FLOW</p><h2>异常处置流程 · {{ selectedDeviation?.payload?.deviation_id || '—' }}</h2></div><span>{{ pendingDeviations.length }} 项待评审</span></header><div class="pm-approval"><template v-for="(step, index) in exceptionFlow" :key="step.title"><div class="pm-approval-step" :class="step.state"><span class="pm-approval-dot">{{ step.state === 'done' ? '✓' : step.state === 'doing' ? '!' : '○' }}</span><div class="pm-approval-body"><b>{{ step.title }}</b><small>{{ step.when }}</small><em>{{ step.note }}</em></div></div><span v-if="index < exceptionFlow.length - 1" class="pm-approval-arrow">→</span></template></div></section><label><span>偏离描述</span><textarea v-model.trim="operationForm.deviationDescription" rows="3" placeholder="选择服务项后填写偏离内容"></textarea></label><label><span>偏离证据</span><input type="file" accept="application/pdf,image/png,image/jpeg" @change="operationForm.deviationEvidenceFile = $event.target.files?.[0] || null" /></label><div class="pm-field"><span>严重度</span><SearchableSelect v-model="operationForm.severity" :options="deviationSeverityOptions" placeholder="请选择严重度" search-placeholder="搜索严重度" aria-label="选择偏离严重度" /></div><button v-if="canReportDeviation" class="pm-button primary" :disabled="saving" @click="runOperation('exception-report')">上报偏离</button><label><span>评审偏离 ID</span><input v-model.trim="operationForm.deviationID" placeholder="DV-..." /></label><div class="pm-field"><span>评审决定</span><SearchableSelect v-model="operationForm.decision" :options="deviationDecisionOptions" placeholder="请选择评审决定" search-placeholder="搜索放行、重测或终止" aria-label="选择评审决定" /></div><button v-if="canReviewDeviation" class="pm-button" :disabled="saving" @click="runOperation('exception-review')">提交偏离评审</button></template>
              <template v-else-if="activeSection === 'reports'"><section class="pm-panel pm-stepper-panel"><header><div><p class="pm-panel-kicker">REPORT PHASE</p><h2>报告阶段链</h2></div><span v-if="selectedServiceItem" class="pm-op-current">当前：<span class="pm-badge" :class="statusTone(reportStatusLabel[selectedServiceItem.report_status] || '未开始')">{{ reportStatusLabel[selectedServiceItem.report_status] || '未开始' }}</span></span></header><div class="pm-stepper"><template v-for="(step, index) in reportSteps" :key="step.phase"><div class="pm-step" :class="step.state"><span class="pm-step-num">{{ step.state === 'done' ? '✓' : index + 1 }}</span><span>{{ step.label }}</span></div><div v-if="index < reportSteps.length - 1" class="pm-step-line"></div></template></div></section><div class="pm-report-phase" v-if="item && item.report_status"><span>当前报告阶段</span><b class="pm-badge" :class="statusTone(reportStatusLabel[item.report_status] || item.report_status)">{{ reportStatusLabel[item.report_status] || item.report_status }}</b></div><div v-if="item?.report_status === 'COMPILING' && can('project.report.prepare')" class="pm-form"><label><span>R{{ Number(item.report_revision) || 0 }} 报告文件 <em>*</em></span><input type="file" accept="application/pdf" @change="operationForm.reportFile = $event.target.files?.[0] || null" /><small>上传后由统一文件网关扫描并登记摘要，审核人与编制人必须不同。</small></label><button class="pm-button" :disabled="saving" @click="uploadCurrentReport">上传并登记报告</button></div><button v-if="item && reportPhaseNext[item.report_status] && canAdvanceReportPhase(reportPhaseNext[item.report_status])" class="pm-button primary" :disabled="saving" @click="runOperation('report-next')">推进至{{ reportStatusLabel[reportPhaseNext[item.report_status]] }}</button><button v-if="canCompleteField" class="pm-button" :disabled="saving" @click="runOperation('complete')">确认现场实施完成</button></template>
            </div><div v-else class="pm-empty-mini">请先选择服务项</div>
          </section>
          <section v-if="activeSection === 'methods'" class="pm-table-panel">
            <header><div><p class="pm-panel-kicker">REVIEW HISTORY</p><h2>复核历史</h2></div><span>{{ methodHistory.length }} 条复核记录</span></header>
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>服务项</th><th>结论</th><th>复核意见</th><th>复核人</th><th>复核时间</th></tr></thead><tbody><tr v-for="event in methodHistory" :key="event.id"><td class="mono"><b>{{ event.service_item_id }}</b></td><td><span class="pm-badge" :class="event.payload?.decision === 'APPROVED' ? 'normal' : '风险'">{{ event.payload?.decision === 'APPROVED' ? '通过复核' : '已驳回' }}</span></td><td>{{ event.payload?.comment || '—' }}</td><td>{{ personLabel(event.actor_user_id, '—') }}</td><td>{{ formatDateTime(event.created_at) }}</td></tr><tr v-if="!methodHistory.length"><td colspan="5" class="pm-empty-mini">暂无特殊方法复核记录</td></tr></tbody></table></div>
          </section>
          <section class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>事项 / 项目</th><th>内容摘要</th><th>负责人 / 归属</th><th>状态</th><th>完成度</th><th>时限</th><th></th></tr></thead><tbody><tr v-for="row in operationRows" :key="row.name"><td><b>{{ row.name }}</b></td><td><template v-if="Array.isArray(row.detail)"><span v-if="!row.detail.length">—</span><span v-else class="pm-code-pills"><span v-for="code in row.detail" :key="code" class="pm-code-pill">{{ code }}</span></span></template><template v-else>{{ row.detail }}</template><span v-if="row.warning" class="pm-cell-warning">{{ row.warning }}</span></td><td>{{ row.owner }}</td><td><span class="pm-badge" :class="statusTone(row.state)">{{ row.state }}</span></td><td><div class="pm-inline-progress"><i :style="{ width: `${row.progress}%` }"></i></div><small>{{ row.progress }}%</small></td><td>{{ row.due }}</td><td class="pm-col-actions"><button class="pm-link" @click="openOperationDetail(row)">查看详情</button></td></tr></tbody></table></div><div v-if="!operationRows.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无数据</b><span>当前页面尚无待处理事项</span></div></section>
        </template>
      </div>
    </main>

    <div v-if="operationDetail" class="pm-overlay" @click.self="operationDetail = null"><aside class="pm-drawer"><header><div><span>{{ operationSectionLabel(operationDetail.section) }}</span><h2>{{ operationDetail.row.name }}</h2></div><button class="pm-icon-button" aria-label="关闭" @click="operationDetail = null"><ConsoleIcon name="close" /></button></header><div class="pm-drawer-body"><section class="pm-drawer-hero"><span class="pm-badge neutral">{{ operationDetail.row.state }}</span><p><template v-if="Array.isArray(operationDetail.row.detail)"><span v-if="!operationDetail.row.detail.length">—</span><span v-else class="pm-code-pills"><span v-for="code in operationDetail.row.detail" :key="code" class="pm-code-pill">{{ code }}</span></span></template><template v-else>{{ operationDetail.row.detail }}</template><span v-if="operationDetail.row.warning" class="pm-cell-warning">{{ operationDetail.row.warning }}</span></p><div class="pm-progress"><i :style="{ width: `${operationDetail.row.progress}%` }"></i></div><b>{{ operationDetail.row.progress }}% 已完成</b></section><dl><div v-for="field in operationDetailFields" :key="field.label"><dt>{{ field.label }}</dt><dd><template v-if="Array.isArray(field.value)"><span v-if="!field.value.length">—</span><span v-else class="pm-code-pills"><span v-for="code in field.value" :key="code" class="pm-code-pill">{{ code }}</span></span></template><template v-else>{{ field.value }}</template></dd></div></dl></div><footer><button class="pm-button" @click="operationDetail = null">关闭</button></footer></aside></div>

    <div v-if="planEquipmentPickerOpen" class="pm-overlay" @click.self="planEquipmentPickerOpen = false"><aside class="pm-dialog pm-dialog-wide"><header><div><span>EQUIPMENT</span><h2>添加设备</h2><small class="pm-dialog-sub">只列设备目录中的有效设备；已被其他服务项占用、仅在公司使用或不在公司的设备不可选取。</small></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="planEquipmentPickerOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-dialog-body"><div class="pm-picker-search"><ConsoleIcon name="search" /><input v-model.trim="equipmentPickerKeyword" placeholder="搜索设备名称或能力码" /></div><div class="pm-table-scroll"><table class="pm-table pm-table-picker"><thead><tr><th>设备</th><th>能力码</th><th>检定有效期</th><th>状态</th><th class="pm-col-action">操作</th></tr></thead><tbody><tr v-for="item in planEquipmentFiltered" :key="item.resource_id"><td><b>{{ item.resource_name }}</b><small class="mono">{{ item.resource_id }}</small><small v-if="equipmentUnavailableReason(item)" class="pm-cell-sub pm-cell-danger">{{ equipmentUnavailableReason(item) }}</small></td><td><span v-if="!(item.codes || []).length">—</span><span v-else class="pm-code-pills"><span v-for="code in item.codes" :key="code" class="pm-code-pill">{{ code }}</span></span></td><td>{{ item.valid_until ? item.valid_until.slice(0, 10) : '长期' }}</td><td><span class="pm-badge" :class="equipmentPickerState(item).tone">{{ equipmentPickerState(item).label }}</span></td><td><button type="button" class="pm-link" :disabled="equipmentPickerState(item).disabled" @click="addPlanEquipment(item)">{{ equipmentPickerState(item).action }}</button></td></tr><tr v-if="!planEquipmentFiltered.length"><td colspan="5" class="pm-empty-mini">{{ equipmentPickerKeyword ? '没有匹配的设备，换个关键字试试' : '设备目录为空，请先在「资质与能力」或「设备能力维护」中登记设备' }}</td></tr></tbody></table></div></div><footer><span class="pm-dialog-footnote">已加入 {{ planEquipmentAddedCount }} 台 · 可选 {{ planEquipmentAddableCount }} 台</span><button type="button" class="pm-button" @click="planEquipmentPickerOpen = false">关闭</button></footer></aside></div>
<div v-if="createOpen" class="pm-overlay" @click.self="createOpen = false"><form class="pm-dialog" @submit.prevent="saveCreate"><header><div><span>CREATE</span><h2>新建项目</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="createOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>名称 <em>*</em></span><input v-model.trim="createForm.name" required placeholder="请输入项目名称" /></label><template v-if="activeSection === 'projects'"><label><span>已审批合同 <em>*</em></span><select v-model="createForm.contractID" required @change="selectApprovedContract(approvedContracts.find((item) => item.id === createForm.contractID))"><option value="">请选择已通过审批的合同</option><option v-for="contract in approvedContracts" :key="contract.id" :value="contract.id" :disabled="contractOptionDisabled(contract)">{{ contractOptionLabel(contract) }}</option></select></label><label><span>客户</span><input :value="createForm.customer" readonly aria-readonly="true" /><small>选择合同后由合同管理系统自动带入</small></label><label><span>合同编号</span><input :value="createForm.contract" readonly aria-readonly="true" /><small>以合同管理系统中的合同编号为准，不支持手工修改</small></label><label><span>实施场所 <em>*</em></span><input v-model.trim="createForm.site" required placeholder="例如 杭州机房" /></label><label><span>技术要求</span><input v-model.trim="createForm.requirement" placeholder="请输入服务项技术要求" /></label><label><span>测试模式</span><select v-model="createForm.testMode"><option value="STANDARD">标准方法</option><option value="PENETRATION">渗透测试</option></select></label><section class="pm-service-links"><header><div><b>关联服务项</b><small>系统名称、系统等级、检测类别均为非必填</small></div><button type="button" class="pm-link" @click="addServiceLink">＋ 增加一行</button></header><div v-for="(link, index) in createForm.serviceLinks" :key="index" class="pm-service-link-row"><input v-model.trim="link.system" placeholder="系统名称" /><input v-model.trim="link.systemLevel" placeholder="系统等级" /><input v-model.trim="link.category" placeholder="检测类别" /><button type="button" class="pm-icon-button" :aria-label="`删除第 ${index + 1} 行`" @click="removeServiceLink(index)">×</button></div></section></template><label><span>备注</span><textarea v-model.trim="createForm.notes" rows="4" placeholder="补充说明（选填）"></textarea></label></div><footer><button type="button" class="pm-button" @click="createOpen = false">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></footer></form></div>

    <div v-if="adjustOpen" class="pm-overlay" @click.self="adjustOpen = false"><form class="pm-dialog pm-dialog-wide" @submit.prevent="submitDecompositionAdjust"><header><div><span>ADJUST</span><h2>调整拆解</h2><small class="pm-dialog-sub">目标项目：<b>{{ decompositionProject ? `${decompositionProject.id} · ${decompositionProject.name || decompositionProject.customer || ''}` : '未选择' }}</b> —— 提交后该项目的<b>全部</b>服务项会被这份清单替换并进入补充协议处理中；原服务项转为归档保留历史。</small></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="adjustOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>调整原因 <em>*</em></span><input v-model.trim="adjustForm.reason" required placeholder="例如 客户追加两个系统" /></label><label><span>补充协议编号 <em>*</em></span><input v-model.trim="adjustForm.supplementContractID" required placeholder="例如 SC-2026-0007" /></label><section class="pm-service-links"><header><div><b>新的服务项清单</b><small>提交后该项目的全部服务项会被这份清单替换，并进入补充协议处理中</small></div><button type="button" class="pm-link" @click="addAdjustItem">＋ 增加一行</button></header><div v-for="(row, index) in adjustForm.items" :key="index" class="pm-adjust-item"><div class="pm-service-link-row"><input v-model.trim="row.batch" required placeholder="批次" /><input v-model.trim="row.site" required placeholder="场所" /><input v-model.trim="row.category" required placeholder="检测类别" /><button type="button" class="pm-icon-button" :aria-label="`删除第 ${index + 1} 行`" @click="removeAdjustItem(index)">×</button></div><div class="pm-service-link-row"><input v-model.trim="row.system" placeholder="系统名称" /><input v-model.trim="row.systemLevel" placeholder="系统等级" /><input v-model.trim="row.requirement" placeholder="技术要求" /><select v-model="row.testMode"><option value="STANDARD">标准方法</option><option value="PENETRATION">渗透测试</option></select></div></div></section></div><footer><button type="button" class="pm-button" @click="adjustOpen = false">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '提交中…' : '提交调整' }}</button></footer></form></div>

    <div v-if="configEditorOpen" class="pm-overlay" @click.self="configEditorOpen = false">
      <form class="pm-dialog" @submit.prevent="saveConfigRule">
        <header>
          <div><span>CONFIG</span><h2>{{ configForm.id ? '编辑配置' : '新建配置' }} · {{ activeConfigMeta.label }}</h2></div>
          <button type="button" class="pm-icon-button" aria-label="关闭" @click="configEditorOpen = false"><ConsoleIcon name="close" /></button>
        </header>
        <div class="pm-form">
          <label>
            <span>{{ activeConfigMeta.nameLabel || '配置名称' }} <em>*</em></span>
            <input v-model.trim="configForm.name" required :placeholder="configNamePlaceholder()" />
            <small v-if="['warning-rules', 'automations', 'sla'].includes(activeSection)">选择生效条件后会自动生成，仍可按业务口径修改。</small>
          </label>
          <template v-for="field in activeConfigMeta.fields" :key="field.key">
            <div v-if="field.field === 'roles'" class="pm-field pm-span-full">
              <span>{{ field.label }} <em v-if="field.required">*</em></span>
              <SearchableSelect v-model="configForm.role_codes" :options="configRoleOptions" value-key="code" label-key="name" placeholder="请选择角色（可多选）" search-placeholder="搜索角色名称或编码" :empty-text="applicationRolesError || '暂无匹配角色'" aria-label="选择字段级权限角色" menu-z-index="calc(var(--pm-z-modal, 50) + 1)" multiple required />
              <p v-if="configRoleSelection.length > 1" class="pm-form-hint">已选 {{ configRoleSelection.length }} 个角色，保存后每个角色各生成一条规则。</p>
              <p v-else-if="applicationRolesError" class="pm-form-hint" role="alert">{{ applicationRolesError }}</p>
            </div>
            <div v-else-if="field.field === 'role'" class="pm-field pm-span-full">
              <span>{{ field.label }} <em v-if="field.required">*</em></span>
              <SearchableSelect v-model="configForm[field.key]" :options="configRoleOptions" value-key="code" label-key="name" placeholder="请选择目标角色" search-placeholder="搜索角色名称或编码" :empty-text="applicationRolesError || '暂无匹配角色'" :aria-label="`选择${field.label}`" menu-z-index="calc(var(--pm-z-modal, 50) + 1)" required @change="onConfigFieldChange(field, $event)" />
              <p v-if="applicationRolesError" class="pm-form-hint" role="alert">{{ applicationRolesError }}</p>
            </div>
            <div v-else-if="field.field === 'permission-field'" class="pm-field pm-span-full">
              <span>{{ field.label }} <em>*</em></span>
              <SearchableSelect v-model="configForm[field.key]" :options="field.options" placeholder="请选择需要隐藏的字段" search-placeholder="搜索字段名称或编码" empty-text="没有匹配的有效字段" aria-label="选择字段级权限字段" menu-z-index="calc(var(--pm-z-modal, 50) + 1)" required />
            </div>
            <div v-else-if="field.field === 'catalog-single'" class="pm-field pm-span-full">
              <span>{{ field.label }} <em v-if="field.required">*</em></span>
              <SearchableSelect v-model="configForm[field.key]" :options="field.options" :placeholder="field.placeholder || `请选择${field.label}`" :search-placeholder="field.searchPlaceholder || `搜索${field.label}`" :empty-text="(['trigger', 'status'].includes(field.key) && ruleConfigurationCatalogError) || field.emptyText || '没有匹配的有效选项'" :aria-label="`选择${field.label}`" :disabled="configFieldDisabled(field)" menu-z-index="calc(var(--pm-z-modal, 50) + 1)" :required="field.required" @change="onConfigFieldChange(field, $event)" />
              <p v-if="configFieldDisabled(field)" class="pm-form-hint">编码与类型创建后不可修改；如需变更，请停用原配置后新建。</p>
            </div>
            <label v-else-if="field.field === 'positive-integer'">
              <span>{{ field.label }} <em>*</em></span>
              <input v-model.trim="configForm[field.key]" type="number" required inputmode="numeric" step="1" :min="field.min || 1" @change="onConfigFieldChange(field, $event.target.value)" />
              <small>请输入大于等于 {{ field.min || 1 }} 的整数。</small>
            </label>
            <label v-else-if="field.field === 'number'">
              <span>{{ field.label }} <em v-if="field.required">*</em></span>
              <input v-model.number="configForm[field.key]" type="number" step="1" :required="field.required" :min="field.min ?? 0" @change="onConfigFieldChange(field, $event.target.value)" />
            </label>
            <label v-else>
              <span>{{ field.label }} <em v-if="field.required">*</em></span>
              <input v-model.trim="configForm[field.key]" :required="field.required" :readonly="configFieldDisabled(field)" :aria-readonly="configFieldDisabled(field)" :placeholder="field.placeholder || ''" />
              <small v-if="configFieldDisabled(field)">编码与类型创建后不可修改；如需变更，请停用原配置后新建。</small>
            </label>
          </template>
          <label><span>启用</span><button type="button" class="pm-switch" :class="{ on: configForm.enabled }" :aria-label="`${configForm.enabled ? '停用' : '启用'}`" @click="configForm.enabled = !configForm.enabled"><i></i></button></label>
        </div>
        <footer><button type="button" class="pm-button" @click="configEditorOpen = false">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></footer>
      </form>
    </div>
    <Transition name="pm-toast"><div v-if="toastMessage" class="pm-toast" :class="toastType" role="status"><span>{{ toastType === 'error' ? '✕' : toastType === 'warning' ? '⚠' : toastType === 'info' ? 'ℹ' : '✓' }}</span>{{ toastMessage }}</div></Transition>
  </div>
</template>
