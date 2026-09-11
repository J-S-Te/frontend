<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, logoutCurrentSession } from '@/modules/platform/auth/api/auth'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import ServiceItemPicker from '@/modules/project_management/components/ServiceItemPicker.vue'
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
  listSites,
  upsertSite,
  deleteSite,
  upsertEquipment,
  listDeliveryEvents,
  listRules,
  listSlaOverdue,
  listServiceItems,
  listPersonnel,
  listEquipmentReservations,
  returnServiceItemEquipment,
  resolvePersonnelNames,
  assignTeam,
  assignExecutionTeam,
  planImplementation,
  startImplementationPreparation,
  submitFieldRecord,
  reportDeviation,
  reviewDeviation,
  completeServiceItemField,
  setRuleEnabled,
  updateRule,
  reviewSpecialMethod,
  updateReportStatus,
} from '@/modules/project_management/api/projectManagement'
import { listApprovedContracts, openContractAuthorizationInNewTab } from '@/modules/contract_management/api/contract'
import '@/modules/project_management/styles/project-management.css'

const route = useRoute()
const router = useRouter()

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
    { key: 'sites', label: '站点档案', icon: 'organization' },
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
    { key: 'sla', label: '状态 SLA 配置', icon: 'audit' },
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
  qualifications: ['资质与能力管理', '维护人员资质、能力标签和有效期'],
  equipment: ['设备能力维护', '新增、停用、检定和更新设备基础信息'],
  sites: ['站点档案', '维护站点编码、地址与坐标；坐标可在现场用浏览器定位自动获取'],
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
    .map((group) => ({ ...group, items: group.items.filter((item) => allowed.has(item.key)).map((item) => ({ ...item, badge: navBadges.value[item.key] || '' })) }))
    .filter((group) => group.items.length)
})
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
const sites = ref([])
const siteDialog = ref(null)
const siteError = ref('')
const locatingSite = ref(false)
// 坐标未采集与"坐标为 0"必须区分：0,0 是合法位置，因此单独用 has_coordinates 表达。
const emptySite = () => ({ site_code: '', name: '', address: '', latitude: '', longitude: '', has_coordinates: false, status: 'ACTIVE', notes: '' })
const equipmentForm = ref({ resourceID: '', resourceName: '', codes: '', validFrom: '', validUntil: '', status: 'ACTIVE', usageScope: 'ANY' })
const dashboard = ref({ project_count: 0, in_flight_projects: 0, risk_projects: 0, service_items: 0, status_counts: {} })
// SLA 超期/临近项来自服务端 GET /delivery/sla-overdue，口径由后端统一计算（计划完成超期 + 状态停留超期/临近）。
const slaOverdueItems = ref([])
const session = ref(null)
const lastUpdatedAt = ref(null)
let toastTimer = 0

// 项目状态节点必须与服务端 domain.ProjectStatusNodes 完全一致。
// 服务端按服务项派生唯一状态，前端只做展示，不得再自行拼装状态集合。
const projectStatusNodes = ['待拆解确认', '待分配', '待实施', '实施准备中', '实施中', '异常处理中', '现场实施完成', '报告编制', '已完成']
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
// 风险口径与服务端 domain.IsRiskProjectStatus 保持一致：异常处理中或已终止的派生状态。
const riskProjectStatuses = ['异常处理中', '已终止']
const riskProjectCount = computed(() => projects.value.filter((p) => riskProjectStatuses.includes(p.status)).length)
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
const filteredCapabilities = computed(() => capabilities.value.filter((item) => (capabilityTab.value === 'all' || capabilityTab.value === 'codes' || capabilityTab.value === 'expiry' || item.resource_type === capabilityTab.value) && (!capabilityTypeFilter.value || item.resource_type === capabilityTypeFilter.value) && (!capabilityStatusFilter.value || item.status === capabilityStatusFilter.value)))
const canManageResource = computed(() => Array.isArray(session.value?.permissions) && session.value.permissions.includes('project.resource.manage'))
const selectedServiceItemIDs = ref([])
const operationForm = ref({ teamLeadID: '', projectManagerID: '', engineerIDs: '', plannedStart: '', plannedEnd: '', sitePlan: '', penetrationTestPlan: '', authDocNo: '', authStart: '', authEnd: '', authScope: '', testScope: '', testWindow: '', emergencyContact: '', rollbackPlan: '', reviewComment: '', personnel: [], equipment: [], travelRequestID: '', rawData: '', environment: '', deviationDescription: '', severity: 'MEDIUM', decision: 'RELEASE', comment: '' })

// 六套真实配置表的列与编辑字段元数据。
const configKindsMeta = [
  { kind: 'split-rules', label: '拆解规则', columns: [{ key: 'scope', label: '适用范围' }], fields: [{ key: 'scope', label: '适用范围', field: 'text', required: true, placeholder: '例如 单批次金额超过 50 万元' }] },
  { kind: 'warning-rules', label: '预警规则', columns: [{ key: 'check_type', label: '检查类型' }, { key: 'threshold', label: '阈值' }], fields: [{ key: 'check_type', label: '检查类型', field: 'text', required: true, placeholder: '例如 资质能力冲突 / 排期冲突 / 场地冲突' }, { key: 'threshold', label: '阈值', field: 'text', placeholder: '例如 连续 3 项冲突' }] },
  { kind: 'automations', label: '自动化动作', columns: [{ key: 'trigger', label: '触发事件' }, { key: 'target', label: '目标' }], fields: [{ key: 'trigger', label: '触发事件', field: 'text', required: true, placeholder: '例如 DEVIATION_REPORTED' }, { key: 'target', label: '目标', field: 'text', required: true, placeholder: '例如 通知技术总监 / 创建整改工单' }] },
  { kind: 'permissions', label: '字段级权限', columns: [{ key: 'role_code', label: '角色' }, { key: 'field_name', label: '字段' }, { key: 'access_level', label: '访问级别' }], fields: [{ key: 'role_code', label: '角色', field: 'text', required: true, placeholder: '例如 project_manager' }, { key: 'field_name', label: '字段', field: 'text', required: true, placeholder: '例如 report_revenue' }, { key: 'access_level', label: '访问级别', field: 'select', required: true, options: [{ value: 'view', label: '只读可见' }, { value: 'edit', label: '可编辑' }, { value: 'hidden', label: '隐藏' }] }] },
  { kind: 'sla', label: 'SLA 规则', columns: [{ key: 'status', label: '状态' }, { key: 'deadline_hours', label: '时限(小时)' }, { key: 'remind_hours', label: '提醒(小时)' }], fields: [{ key: 'status', label: '生效状态', field: 'text', required: true, placeholder: '例如 报告编制' }, { key: 'deadline_hours', label: '时限(小时)', field: 'number', required: true, min: 1 }, { key: 'remind_hours', label: '提前提醒(小时)', field: 'number', min: 0 }] },
  { kind: 'standards', label: '检测标准', columns: [{ key: 'scope', label: '适用方法/范围' }], fields: [{ key: 'scope', label: '适用方法/范围', field: 'text', required: true, placeholder: '例如 GB/T 28448 更新的检测方法进入评估' }] },
]
// 字段级权限规则由独立权限把关（服务端 ruleKindPermission 要求 project.field_permission.manage）：
// 只有 project_rule.manage 的角色不该看到这个页签，否则页面能打开、提交必然 403。
const visibleConfigKinds = computed(() => configKindsMeta.filter((meta) => meta.kind !== 'permissions' || canManageFieldPermissions.value))
// 页签被隐藏时不能只靠 activeSection 判断：那样配置页仍会打开，表头取回退后的首个可见
// 配置、列表却按被隐藏的 kind 过滤，得到一张标题与内容不符的空表；「新建规则」也会为
// 隐藏的 kind 建档。因此页签、面板与入口统一以可见集合为准。
const isVisibleConfigSection = computed(() => visibleConfigKinds.value.some((meta) => meta.kind === activeSection.value))
const activeConfigMeta = computed(() => visibleConfigKinds.value.find((meta) => meta.kind === activeSection.value) || visibleConfigKinds.value[0])
const configEditorOpen = ref(false)
const configForm = ref({})
function openConfigCreate() {
  configForm.value = { id: null, kind: activeSection.value, name: '', enabled: true }
  for (const field of activeConfigMeta.value.fields) {
    configForm.value[field.key] = field.field === 'number' ? (field.key === 'deadline_hours' ? 24 : field.key === 'remind_hours' ? 4 : 0) : field.key === 'access_level' ? 'view' : ''
  }
  configEditorOpen.value = true
}
function openConfigEdit(rule) {
  configForm.value = { ...rule, name: rule.name || '', enabled: rule.enabled !== false, kind: rule.kind || activeSection.value }
  configEditorOpen.value = true
}
async function saveConfigRule() {
  saving.value = true
  try {
    const payload = { kind: configForm.value.kind, name: configForm.value.name.trim(), enabled: configForm.value.enabled }
    for (const field of activeConfigMeta.value.fields) payload[field.key] = typeof configForm.value[field.key] === 'number' ? configForm.value[field.key] : String(configForm.value[field.key] || '').trim()
    if (!payload.name) { showToast('请填写配置名称', 'warning'); return }
    const saved = configForm.value.id ? await updateRule(configForm.value.id, payload) : await createRule(payload)
    const index = rules.value.findIndex((rule) => rule.id === saved.id)
    if (index >= 0) rules.value.splice(index, 1, saved)
    else rules.value.push(saved)
    configEditorOpen.value = false
    showToast(configForm.value.id ? '配置已保存' : '配置已创建')
  } catch (error) { showToast(error?.message || '配置保存失败', 'error') }
  finally { saving.value = false }
}

const reportStatusLabel = { COMPILING: '编制中', REVIEWED: '已审核', ISSUED: '已签发', ARCHIVED: '已归档' }
// SLA 口径标签与剩余/超期文案：与后端 domain.SlaKind* 常量对齐。
const slaKindLabel = { PLAN_END_OVERDUE: '计划完成超期', STATUS_DEADLINE_OVERDUE: '状态停留超期', STATUS_DEADLINE_APPROACHING: '状态临近超期' }
function slaDueLabel(item) {
  const hours = Number(item.overdue_hours || 0)
  if (item.kind === 'STATUS_DEADLINE_APPROACHING') return `剩余 ${hours} 小时`
  return `已超期 ${hours} 小时`
}
const reportStatusRank = { COMPILING: 1, REVIEWED: 2, ISSUED: 3, ARCHIVED: 4 }
const reportPhaseNext = { COMPILING: 'REVIEWED', REVIEWED: 'ISSUED', ISSUED: 'ARCHIVED' }
const reportItems = computed(() => serviceItems.value.filter((item) => item.report_status && item.report_status !== 'NONE'))
const reportTechReviewLabel = (status) => ({ NONE: '未提交', PENDING: '待复核', APPROVED: '已通过', REJECTED: '已驳回' }[status] || '未提交')
const personnelKeyword = ref('')
const personnelLoading = ref(false)
const personnelError = ref('')

// 服务项操作台的角色选择必须来自基础平台负责人目录，不能要求业务用户手工填写用户 ID。
// 三个下拉各自按应用角色取人：团队负责人=team_lead、项目经理=project_manager、工程师=engineer。
// 角色成员由平台按有效授权判定，这里再限定来源为岗位授权模板：只列出岗位模板授予的人，
// 管理员为个人直接开通的角色（超级管理员、平台管理员等）不会出现在候选人列表里。
// 目录失败时只禁用选择并提示，不影响其余工作区数据。
const PROJECT_ROLE_CODES = Object.freeze({ teamLead: 'team_lead', projectManager: 'project_manager', engineer: 'engineer' })
const PROJECT_ROLE_ORIGIN = 'TEMPLATE'

const emptyPersonnelByRole = () => ({ [PROJECT_ROLE_CODES.teamLead]: [], [PROJECT_ROLE_CODES.projectManager]: [], [PROJECT_ROLE_CODES.engineer]: [] })
const personnelByRole = ref(emptyPersonnelByRole())

async function loadPersonnel() {
  personnelLoading.value = true
  personnelError.value = ''
  const keyword = personnelKeyword.value.trim()
  // 项目经理/工程师只在具备 project.execution.assign 的表单里出现，未授权时不必查询这两个角色的目录。
  const roles = canExecutionAssign.value
    ? [PROJECT_ROLE_CODES.teamLead, PROJECT_ROLE_CODES.projectManager, PROJECT_ROLE_CODES.engineer]
    : [PROJECT_ROLE_CODES.teamLead]
  try {
    const pages = await Promise.all(roles.map((role) => listPersonnel({ keyword, role_code: role, role_origin: PROJECT_ROLE_ORIGIN, page: 1, page_size: 50 })))
    const byRole = emptyPersonnelByRole()
    const names = {}
    roles.forEach((role, index) => {
      const items = Array.isArray(pages[index]?.items) ? pages[index].items : []
      byRole[role] = items.map((person) => ({ id: person.user_id, name: person.display_name || '未命名人员' }))
      for (const person of items) names[person.user_id] = person.display_name
    })
    personnelByRole.value = byRole
    rememberPersonnelNames(names)
  } catch (error) {
    personnelByRole.value = emptyPersonnelByRole()
    personnelError.value = error?.message || '基础平台人员目录加载失败'
  } finally {
    personnelLoading.value = false
  }
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
function multiSummary(ids, options, placeholder) {
  const names = (ids || []).map((id) => options.find((option) => option.id === id)?.name || id)
  if (!names.length) return placeholder
  if (names.length <= 2) return names.join('、')
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 项`
}
function toggleEngineer(id) {
  const selected = new Set(engineerSelection.value)
  if (selected.has(id)) selected.delete(id)
  else selected.add(id)
  engineerSelection.value = [...selected]
}
function closeMultiOnOutsideClick(event) {
  if (!(event.target instanceof Element) || !event.target.closest('.pm-multi-dropdown')) openMulti.value = ''
}
function onMultiKeydown(event) {
  const count = engineerOptions.value.length
  if (event.key === 'Escape') {
    if (openMulti.value === 'engineer') { event.stopPropagation(); openMulti.value = ''; multiActiveIndex.value = -1 }
    return
  }
  if (openMulti.value !== 'engineer' || !count) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    multiActiveIndex.value = (multiActiveIndex.value + delta + count) % count
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const option = engineerOptions.value[multiActiveIndex.value]
    if (option && !option.disabled) toggleEngineer(option.id)
  }
}
// 已选人员在触发器下方以 chip 回显，支持单个移除；摘要文本保留给屏幕阅读器与窄屏。
const engineerChipOptions = computed(() => engineerSelection.value.map((id) => engineerOptions.value.find((option) => option.id === id) || { id, name: id }))
const selectedServiceItems = computed(() => serviceItems.value.filter((item) => selectedServiceItemIDs.value.includes(item.id)))
const selectedServiceItem = computed(() => selectedServiceItems.value[0] || null)

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
const completedProjectCount = computed(() => projects.value.filter((project) => project.status === projectStatusCompleted).length)
const currentUserName = computed(() => session.value?.display_name || session.value?.user_name || '当前用户')
const currentUserRole = computed(() => session.value?.roles?.join(' / ') || '项目成员')
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
// 服务端 POST /projects 强制要求 project.create。前端必须用同一权限门控入口按钮：
// 否则项目经理等角色会点进一个注定 403 的链路（且该链路会调用合同系统接口，把用户弹到合同登录）。
const canCreateProject = computed(() => Array.isArray(session.value?.permissions) && session.value.permissions.includes('project.create'))
// 其余写操作入口同样用服务端同款权限码门控：只门控少数几个权限码时，
// 未授权角色会看到自己无权执行的按钮，点击必然 403。
const permissionSet = computed(() => new Set(Array.isArray(session.value?.permissions) ? session.value.permissions : []))
const canAssignTeam = computed(() => permissionSet.value.has('project.team.assign'))
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
// 报告阶段权限按阶段区分：归档需要 project.report.archive，其余阶段需要 project.report.manage。
const canAdvanceReportPhase = (phase) => permissionSet.value.has(phase === 'ARCHIVED' ? 'project.report.archive' : 'project.report.manage')
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
  { key: '待分配', color: 'slate', count: serviceItems.value.filter((item) => item.status === '待分配').length, route: 'allocation' },
  { key: '待实施', color: 'violet', count: serviceItems.value.filter((item) => ['待实施', '实施准备中'].includes(item.status)).length, route: 'planning' },
  { key: '实施中', color: 'amber', count: serviceItems.value.filter((item) => ['实施中', '异常处理中'].includes(item.status)).length, route: 'implementation' },
  { key: '报告编制', color: 'blue', count: reportItems.value.filter((item) => item.report_status !== 'ARCHIVED').length, route: 'reports' },
  { key: '已完成', color: 'green', count: serviceItems.value.filter((item) => item.report_status === 'ARCHIVED' || (['现场实施完成', '已完成'].includes(item.status) && (!item.report_status || item.report_status === 'NONE'))).length, route: 'implementation' },
])
const decompositionProject = computed(() => projectByID.value.get(decompositionItems.value[0]?.project_id) || null)
const decompositionBatches = computed(() => Object.entries(decompositionItems.value.reduce((groups, item) => { const key = item.batch || '未设置批次'; (groups[key] ||= []).push(item); return groups }, {})))
const riskRows = computed(() => [
  ...pendingDeviations.value.map((event) => { const item = itemByID.value.get(event.service_item_id); const project = projectByID.value.get(item?.project_id); return { id: event.id, level: event.payload?.severity === 'HIGH' ? '高' : '中', project: `${project?.id || item?.project_id || '未知项目'} · ${project?.customer || item?.site || '现场任务'}`, issue: event.payload?.description || '现场偏离待评审', owner: personLabel(event.actor_user_id, '待认领'), deadline: formatDateTime(event.created_at) } }),
  ...serviceItems.value.filter((item) => item.conflict_status === 'CONFLICT').map((item) => { const project = projectByID.value.get(item.project_id); return { id: `conflict-${item.id}`, level: '高', project: `${item.project_id} · ${project?.customer || item.site}`, issue: `${item.id} 人员或设备能力冲突`, owner: personLabel(item.project_manager_id || item.team_lead_id, '待分配'), deadline: item.planned_start?.slice(0, 10) || '待处理' } }),
].slice(0, 10))

// 看板泳道是派生状态的确定性分组：只做归类，卡片仍展示唯一的 project.status。
const kanbanColumns = computed(() => [
  { key: '待分配', color: 'slate', statuses: ['待拆解确认', '待分配'] },
  { key: '待实施', color: 'violet', statuses: ['待实施', '实施准备中'] },
  { key: '实施中', color: 'amber', statuses: ['实施中', '异常处理中'] },
  { key: '报告编制', color: 'blue', statuses: ['报告编制'] },
  { key: '已完成', color: 'green', statuses: [projectStatusCompleted] },
].map((column) => {
  const cards = projects.value.filter((p) => column.statuses.includes(p.status))
  return { ...column, cards, count: cards.length }
}))

const operationRows = computed(() => ({
  monitoring: projects.value.slice(0, 5).map((p) => ({ id: p.id, name: `${p.id} · ${p.customer}`, detail: p.category, owner: p.manager, state: p.status, progress: p.progress, due: p.due })),
  allocation: serviceItems.value.filter((s) => s.status === '待分配').map((s) => ({ id: s.id, name: `${s.id} · ${s.category}`, detail: `${s.site} / ${s.batch}`, warning: stampedContractStateByProject.value.get(s.project_id) === false ? '未上传盖章合同' : '', owner: personLabel(s.team_lead_id, '待分配团队负责人'), state: s.conflict_status === 'CONFLICT' ? '能力冲突' : s.team_lead_id ? '已分配' : '待分配', progress: s.project_manager_id ? 100 : s.team_lead_id ? 50 : 0, due: s.planned_end?.slice(0, 10) || '待排期' })),
  inbox: inboxItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${projectByID.value.get(s.project_id)?.customer || s.site}`, detail: s.project_manager_id ? '实施工程师待指派' : '项目经理待指派', owner: personLabel(s.team_lead_id, '—'), state: '待处理', progress: s.project_manager_id ? 50 : 0, due: s.planned_start?.slice(0, 10) || '待排期' })),
  planning: serviceItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.site}`, detail: s.test_mode === 'PENETRATION' ? '渗透测试专项计划' : '现场实施计划', owner: personLabel(s.project_manager_id, '待指派项目经理'), state: s.planned_start ? '计划已发布' : '待排期', progress: s.planned_start ? 100 : 0, due: s.planned_end?.slice(0, 10) || '待排期' })),
  preparation: deliveryEvents.value.filter((e) => e.type === 'PREPARATION_STARTED').map((e) => ({ id: e.id, name: e.service_item_id, detail: `设备 ${(e.payload.equipment || []).length} 台 / 行程 ${e.payload.travel_request_id}`, owner: personLabel(e.actor_user_id, '—'), state: '准备中', progress: 50, due: new Date(e.created_at).toLocaleDateString() })),
  qualifications: capabilities.value.map((c) => ({ id: c.resource_id, name: c.resource_name, detail: c.codes, owner: c.resource_type === 'PERSON' ? '人员资质' : '设备能力', state: c.status === 'ACTIVE' ? '有效' : c.status, progress: c.status === 'ACTIVE' ? 100 : 0, due: c.valid_until?.slice(0, 10) || '长期' })),
  assignments: serviceItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.site}`, detail: `${s.engineer_ids?.length || 0} 人 / ${(s.implementation_plan?.equipment || []).length} 台设备`, owner: personLabel(s.project_manager_id), state: s.conflict_status === 'CONFLICT' ? '排期冲突' : s.conflict_status === 'PASSED' ? '校验通过' : '待校验', progress: s.conflict_status === 'PASSED' ? 100 : 30, due: s.planned_end?.slice(0, 10) || '待排期' })),
  methods: serviceItems.value.filter((s) => s.special === '是').map((s) => ({ id: s.id, name: `${s.id} · ${s.category}`, detail: `${s.site} / ${s.system || '—'}`, owner: personLabel(s.project_manager_id), state: reportTechReviewLabel(s.tech_review_status), progress: s.tech_review_status === 'APPROVED' ? 100 : s.tech_review_status === 'PENDING' ? 50 : 0, due: s.planned_end?.slice(0, 10) || '待排期', review: s.tech_review_status, comment: s.tech_review_comment, reviewedAt: s.tech_reviewed_at })),
  exceptions: pendingDeviations.value.map((e) => ({ id: e.id, name: `${e.payload?.deviation_id} · ${e.service_item_id}`, detail: e.payload?.description || '现场偏离', owner: personLabel(e.actor_user_id, '—'), state: '待评审', progress: 0, due: formatDateTime(e.created_at) })),
  standards: [],
  reports: reportItems.value.map((item) => { const project = projectByID.value.get(item.project_id); return { id: item.id, name: `${item.id} · ${item.site}`, detail: `${project?.customer || item.project_id} / 报告${reportStatusLabel[item.report_status] || item.report_status}`, owner: personLabel(item.project_manager_id, project?.manager || '待指派'), state: reportStatusLabel[item.report_status] || item.report_status, progress: (reportStatusRank[item.report_status] || 0) * 25, due: item.report_updated_at ? item.report_updated_at.slice(0, 10) : item.planned_end?.slice(0, 10) || '待排期', report_status: item.report_status } }),
}[activeSection.value] || []))

const rules = ref([])
const visibleRules = computed(() => rules.value.filter((rule) => rule.kind === activeSection.value))

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
  if (monitorFilter.value === 'risk') return monitoredProjects.value.filter((project) => riskProjectStatuses.includes(project.status))
  return monitoredProjects.value.filter((project) => project.status === monitorFilter.value)
})

// 资质与能力（PG-RES-06）：全部 / 人员 / 设备 / 体系与编码 / 到期提醒 标签页。
const capabilityTab = ref('all')
// 30 天内到期或已过期的资质/检定，按到期时间升序。
const expiringCapabilities = computed(() => {
  const horizon = Date.now() + 30 * 86400000
  return capabilities.value
    .filter((item) => item.valid_until && new Date(item.valid_until).getTime() <= horizon)
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
  { key: 'expiry', label: '到期提醒', count: expiringCapabilities.value.length },
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
  if (['allocation', 'inbox', 'planning', 'assignments', 'methods', 'reports'].includes(section)) record = serviceItems.value.find((item) => item.id === row.id) || null
  else if (section === 'qualifications') record = capabilities.value.find((cap) => cap.resource_id === row.id) || capabilities.value.find((cap) => cap.resource_name === row.name) || null
  else if (['preparation', 'exceptions'].includes(section)) record = deliveryEvents.value.find((event) => event.id === row.id) || null
  else if (['monitoring'].includes(section)) record = projects.value.find((project) => project.id === row.id) || null
  operationDetail.value = { section, row: { ...row }, record }
}
const operationDetailFields = computed(() => {
  const detail = operationDetail.value
  if (!detail) return []
  const record = detail.record || {}
  const section = detail.section
  if (['allocation', 'inbox', 'planning', 'assignments', 'methods', 'reports'].includes(section)) {
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
    return [
      { label: '资源类型', value: record.resource_type === 'PERSON' ? '人员资质' : '设备能力' },
      { label: '资源名称', value: record.resource_name || '-—' },
      { label: '能力编码', value: record.codes || [] },
      { label: '状态', value: record.status === 'ACTIVE' ? '有效' : record.status || '—' },
      { label: '检定有效期', value: record.valid_until ? formatDateTime(record.valid_until) : '长期有效' },
    ]
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
  let loaded = false
  try {
    // 项目、服务项和规则共同构成当前工作区快照；三者全部成功后才一次性替换页面状态，
    // 防止新旧数据混用。接口层仍分别执行会话与资源权限校验。
    const [projectRows, itemRows, ruleRows, eventRows, capabilityRows, dashboardData, sessionData, navigationData] = await Promise.all([listProjects(), listServiceItems(), listRules(), listDeliveryEvents(), listCapabilities(), getDashboard(), getProjectSession(), getProjectNavigation()])
    projects.value = projectRows
    serviceItems.value = itemRows.map((item) => ({ ...item, selected: ['待确认', '待复核'].includes(item.status) }))
    rules.value = ruleRows
    deliveryEvents.value = eventRows
    capabilities.value = capabilityRows
    dashboard.value = dashboardData
    session.value = sessionData
    navigation.value = navigationData
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
    await loadSites()
    await loadPersonnelNames()
    // SLA 超期是监控页的辅助指标：拉取失败只清空面板，不阻断工作区。
    try {
      slaOverdueItems.value = await listSlaOverdue()
    } catch {
      slaOverdueItems.value = []
    }
  }
}

// loadSites 读取站点台账。失败不阻断工作区：站点档案是辅助主数据。
async function loadSites() {
  siteError.value = ''
  try {
    sites.value = await listSites()
  } catch (error) {
    sites.value = []
    siteError.value = subsystemAccessMessage(error, '站点档案加载失败，请稍后重试。')
  }
}

function openSiteDialog(item = null) {
  siteDialog.value = item
    ? { site_code: item.site_code, name: item.name, address: item.address || '', latitude: item.has_coordinates ? String(item.latitude) : '', longitude: item.has_coordinates ? String(item.longitude) : '', has_coordinates: Boolean(item.has_coordinates), status: item.status || 'ACTIVE', notes: item.notes || '' }
    : emptySite()
}

// locateCurrentSite 用浏览器定位自动获取坐标——录入人通常就在现场，因此不需要
// 任何外部地图凭据。定位失败（未授权 / 不支持 / 超时）时保留手工填写路径。
function locateCurrentSite() {
  if (!navigator.geolocation) { showToast('当前浏览器不支持定位，请手工填写坐标', 'warning'); return }
  locatingSite.value = true
  navigator.geolocation.getCurrentPosition(
    (position) => {
      locatingSite.value = false
      if (!siteDialog.value) return
      siteDialog.value.latitude = position.coords.latitude.toFixed(6)
      siteDialog.value.longitude = position.coords.longitude.toFixed(6)
      siteDialog.value.has_coordinates = true
      showToast(`已获取当前位置（精度约 ${Math.round(position.coords.accuracy || 0)} 米）`)
    },
    (error) => {
      locatingSite.value = false
      const reasons = { 1: '定位权限被拒绝', 2: '无法获取位置', 3: '定位超时' }
      showToast(`${reasons[error?.code] || '定位失败'}，请手工填写坐标`)
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  )
}

async function saveSite() {
  const form = siteDialog.value
  if (!form) return
  const hasCoordinates = form.has_coordinates && form.latitude !== '' && form.longitude !== ''
  saving.value = true
  try {
    await upsertSite({
      site_code: form.site_code, name: form.name, address: form.address,
      has_coordinates: hasCoordinates,
      latitude: hasCoordinates ? Number(form.latitude) : 0,
      longitude: hasCoordinates ? Number(form.longitude) : 0,
      status: form.status, notes: form.notes,
    })
    await loadSites()
    siteDialog.value = null
    showToast('站点档案已保存')
  } catch (error) {
    showToast(error?.message || '站点保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function disableSite(item) {
  saving.value = true
  try {
    await deleteSite(item.site_code)
    await loadSites()
    showToast(`站点 ${item.site_code} 已停用`)
  } catch (error) {
    showToast(error?.message || '站点停用失败', 'error')
  } finally {
    saving.value = false
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
    // 项目系统只依赖自身会话：合同系统返回 401 时不得把用户跳转到合同登录
    // （对没有合同应用授权的账号，那里只会以 403 结束），改为就地给出可执行提示。
    approvedContracts.value = await listApprovedContracts({}, { suppressLoginRedirect: true })
    if (!approvedContracts.value.length) { showToast('当前没有已通过审批的可用合同', 'warning'); return }
    createOpen.value = true
  } catch (error) {
    if (error?.status === 401) {
      // 401 分不清"没有合同授权"和"有授权但还没建立合同会话"。在新标签页补一次授权，
      // 不劫持当前页面；授权成功后回到本页重试即可。
      const opened = openContractAuthorizationInNewTab()
      showToast(opened
        ? '已在新标签页打开合同系统授权，完成后回到本页重新点击「新建项目」'
        : '无法打开合同系统授权窗口，请手动进入合同系统完成一次授权，或联系管理员开通权限')
      return
    }
    showToast(error?.message || '读取已审批合同失败', 'error')
  }
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
  equipmentForm.value = {
    resourceID: item.resource_id, resourceName: item.resource_name, codes: (item.codes || []).join(','),
    validFrom: item.valid_from?.slice(0, 10) || '', validUntil: item.valid_until?.slice(0, 10) || '',
    status: item.status || 'ACTIVE', usageScope: item.usage_scope || 'ANY',
  }
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
  saving.value = true
  try {
    const item = await upsertEquipment({ resource_id: equipmentForm.value.resourceID, resource_name: equipmentForm.value.resourceName, codes: selectedIDs(equipmentForm.value.codes), valid_from: equipmentForm.value.validFrom ? new Date(equipmentForm.value.validFrom).toISOString() : '', valid_until: equipmentForm.value.validUntil ? new Date(equipmentForm.value.validUntil).toISOString() : '', status: equipmentForm.value.status, usage_scope: equipmentForm.value.usageScope })
    equipment.value = [item, ...equipment.value.filter((row) => row.resource_id !== item.resource_id)]
    showToast('设备信息已保存')
  } catch (error) { showToast(error?.message || '设备信息保存失败', 'error') }
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
  if (!capabilityAutoID.value || !capabilityDialog.value) return
  capabilityDialog.value.resource_id = nextResourceID(capabilityDialog.value.resource_type)
}

function openCapabilityDialog(item) {
  capabilityAutoID.value = !item
  capabilityDialog.value = item
    ? { resource_type: item.resource_type, resource_id: item.resource_id, resource_name: item.resource_name, codes: (item.codes || []).join(','), valid_from: item.valid_from?.slice(0, 10) || '', valid_until: item.valid_until?.slice(0, 10) || '', status: item.status || 'ACTIVE', usage_scope: item.usage_scope || 'ANY' }
    : { resource_type: 'PERSON', resource_id: nextResourceID('PERSON'), resource_name: '', codes: '', valid_from: '', valid_until: '', status: 'ACTIVE', usage_scope: 'ANY' }
}

async function saveCapability() {
  if (!capabilityDialog.value) return
  saving.value = true
  try {
    const form = capabilityDialog.value
    const saved = await upsertCapability({
      resource_type: form.resource_type,
      resource_id: form.resource_id,
      resource_name: form.resource_name,
      codes: selectedIDs(form.codes),
      valid_from: form.valid_from ? new Date(form.valid_from).toISOString() : '',
      valid_until: form.valid_until ? new Date(form.valid_until).toISOString() : '',
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
  return ({ CONTRACT_ACTIVATED: '合同生效并生成项目', CONTRACT_STAMP_STATUS_SYNCED: '盖章合同状态已同步', DECOMPOSITION_ADJUSTED: '服务项拆解已调整', TEAM_ASSIGNED: '团队负责人已分配', EXECUTION_TEAM_ASSIGNED: '项目经理及工程师已指派', IMPLEMENTATION_PLANNED: '现场实施计划已发布', PREPARATION_STARTED: '实施准备已发起', FIELD_RECORD_SUBMITTED: '现场原始记录已提交', FIELD_COMPLETED: '现场实施已完成', EQUIPMENT_RETURNED: '设备已归还', DEVIATION_REPORTED: '现场偏离已上报', DEVIATION_REVIEWED: '偏离评审已完成', SPECIAL_METHOD_REVIEWED: '特殊方法复核已完成', REPORT_STATUS_UPDATED: '报告阶段已推进', WARNING_TRIGGERED: '预警规则已触发', AUTOMATION_TRIGGERED: '自动化动作已执行' })[event.type] || event.type
}

function toggleRow(id) {
  selectedRows.value = selectedRows.value.includes(id) ? selectedRows.value.filter((item) => item !== id) : [...selectedRows.value, id]
}
async function confirmDecomposition() {
  const ids = serviceItems.value.filter((item) => item.selected).map((item) => item.id)
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
    showToast(next ? '规则已启用' : '规则已停用')
  } catch (error) { showToast(error?.message || '规则更新失败', 'error') }
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
  operationForm.value = { ...operationForm.value, teamLeadID: item.team_lead_id || '', projectManagerID: item.project_manager_id || '', engineerIDs: (item.engineer_ids || []).join(','), plannedStart: toDateTimeLocal(item.planned_start || plan.planned_start), plannedEnd: toDateTimeLocal(item.planned_end || plan.planned_end), sitePlan: plan.site_plan || '', penetrationTestPlan: plan.penetration_test_plan || '', authDocNo: plan.auth_doc_no || '', authStart: toDateTimeLocal(plan.auth_start), authEnd: toDateTimeLocal(plan.auth_end), authScope: plan.auth_scope || '', testScope: plan.test_scope || '', testWindow: plan.test_window || '', emergencyContact: plan.emergency_contact || '', rollbackPlan: plan.rollback_plan || '', reviewComment: item.tech_review_comment || '', personnel: planPersonnelFor(item, plan), equipment: planEquipmentFor(plan) }
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
  const capability = capabilities.value.find((item) => item.resource_id === row.resourceID)
  return capability?.resource_name || personnelNameByID.value.get(row.resourceID) || row.resourceID || '未命名资源'
}
function planResourceCodes(row) {
  const capability = capabilities.value.find((item) => item.resource_id === row.resourceID)
  return capability?.codes || []
}
function planResourceValidUntil(row) {
  const capability = capabilities.value.find((item) => item.resource_id === row.resourceID)
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
// 选择器列出全部有效设备（而不是过滤掉已加入/不可选的），让设备管理员一眼看到完整台账与原因。
const planEquipmentOptions = computed(() => equipment.value.filter((item) => item.status !== 'DISABLED'))
const planEquipmentFiltered = computed(() => {
  const query = equipmentPickerKeyword.value.trim().toLowerCase()
  if (!query) return planEquipmentOptions.value
  return planEquipmentOptions.value.filter((item) => [item.resource_name, item.resource_id, (item.codes || []).join(' ')].join(' ').toLowerCase().includes(query))
})
const planEquipmentAddedCount = computed(() => operationForm.value.equipment.length)
const planEquipmentAddableCount = computed(() => equipment.value.filter((item) => !equipmentPickerState(item).disabled).length)
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
async function runOperation(kind) {
  const item = selectedServiceItem.value
  const items = kind === 'allocation' ? selectedServiceItems.value : (item ? [item] : [])
  if (!items.length) { showToast(kind === 'allocation' ? '请至少选择一个服务项' : '当前没有可操作的服务项'); return }
  const form = operationForm.value
  saving.value = true
  try {
    if (kind === 'allocation') {
      for (const selected of items) {
        if (!selected.team_lead_id) await assignTeam(selected.id, { team_lead_id: form.teamLeadID })
        if (canExecutionAssign.value) {
          // 设备清单在「实施准备」阶段确定，任务分配只指派执行团队。
          await assignExecutionTeam(selected.id, { project_manager_id: form.projectManagerID, engineer_ids: selectedIDs(form.engineerIDs) })
        }
      }
      showToast(canExecutionAssign.value ? `已批量保存 ${items.length} 个服务项并完成能力校验` : `已批量分配 ${items.length} 个服务项的团队负责人`)
    } else if (kind === 'planning') {
      // 操作台用的是 div 而非 <form>，浏览器不会执行 required 校验，这里显式前置拦截。
      if (planningBlocked.value) { showToast(planningBlocked.value.reason); return }
      if (!form.plannedStart || !form.plannedEnd) { showToast('请填写计划开始与计划结束时间', 'warning'); return }
      if (new Date(form.plannedEnd).getTime() <= new Date(form.plannedStart).getTime()) { showToast('计划结束时间必须晚于计划开始时间', 'warning'); return }
      if (!String(form.sitePlan || '').trim()) { showToast('请填写现场计划', 'warning'); return }
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
      await planImplementation(item.id, { planned_start: asRFC3339(form.plannedStart), planned_end: asRFC3339(form.plannedEnd), site_plan: form.sitePlan, penetration_test_plan: form.penetrationTestPlan, auth_doc_no: form.authDocNo, auth_start: asRFC3339(form.authStart), auth_end: asRFC3339(form.authEnd), auth_scope: form.authScope, test_scope: form.testScope, test_window: form.testWindow, emergency_contact: form.emergencyContact, rollback_plan: form.rollbackPlan , personnel: form.personnel.map((row) => ({ resource_type: 'PERSON', resource_id: row.resourceID, window_start: row.windowStart, window_end: row.windowEnd, note: row.note })) })
      showToast('实施计划已发布')
    } else if (kind === 'special-approve' || kind === 'special-reject') {
      await reviewSpecialMethod(item.id, { decision: kind === 'special-approve' ? 'APPROVED' : 'REJECTED', comment: form.reviewComment })
      showToast(kind === 'special-approve' ? '复核已通过，可发布实施计划' : '复核已驳回，请修正后重新提交复核')
    } else if (kind === 'report-next') {
      const next = reportPhaseNext[item.report_status]
      await updateReportStatus(item.id, next)
      showToast(`报告状态已推进至：${reportStatusLabel[next]}`)
    } else if (kind === 'preparation') {
      if (!form.equipment.length) { showToast('请至少选择一台实施设备', 'warning'); return }
      const equipmentWindowProblem = form.equipment.find((row) => (row.windowStart && !row.windowEnd) || (!row.windowStart && row.windowEnd) || (row.windowStart && row.windowEnd && new Date(row.windowEnd) < new Date(row.windowStart)))
      if (equipmentWindowProblem) { showToast(`「${planResourceName(equipmentWindowProblem)}」的使用时段不完整或结束早于开始`); return }
      await startImplementationPreparation(item.id, { travel_request_id: form.travelRequestID, notes: form.comment, equipment: form.equipment.map((row) => ({ resource_type: 'EQUIPMENT', resource_id: row.resourceID, window_start: row.windowStart, window_end: row.windowEnd, note: row.note })) })
      showToast('实施准备已发起')
    } else if (kind === 'field') {
      // 坐标签到已删除：手工填写的经纬度没有任何证明力，服务端也不再保存。
      // 现场记录（原始数据 / 环境条件）是进入"实施中"的真实动作。
      if (!String(form.rawData || '').trim() || !String(form.environment || '').trim()) { showToast('请填写现场原始数据与环境条件', 'warning'); return }
      await submitFieldRecord(item.id, { raw_data: form.rawData, environment: form.environment, evidence_urls: [] })
      showToast('现场记录已提交，服务项进入实施中')
    } else if (kind === 'exception-report') {
      const result = await reportDeviation(item.id, { description: form.deviationDescription, severity: form.severity, evidence_url: '' })
      showToast(`偏离已上报：${result.deviation_id || '待评审'}`)
    } else if (kind === 'exception-review') {
      await reviewDeviation(form.deviationID, { decision: form.decision, comment: form.comment })
      showToast('偏离评审已完成')
    } else if (kind === 'complete') {
      await completeServiceItemField(item.id)
      showToast('该服务项现场实施已完成，进入报告编制')
    }
    await loadWorkspace()
  } catch (error) { showToast(error?.message || '操作失败', 'error') }
  finally { saving.value = false }
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
        contract_id: createForm.value.contractID,
        contract_version: createForm.value.contractVersion,
        service_items: createForm.value.serviceLinks.map((link, index) => ({ source_id: `MANUAL-${String(index + 1).padStart(3, '0')}`, site: createForm.value.site, category: link.category, system: link.system, system_level: link.systemLevel, requirement: createForm.value.requirement, test_mode: createForm.value.testMode })),
      })
      projects.value = [created, ...projects.value]
      showToast(`项目 ${created.id} 已创建`)
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

onMounted(loadWorkspace)
onMounted(loadPersonnel)
onMounted(() => document.addEventListener('click', closeMultiOnOutsideClick))
// 进入资源分配/待办/指派栏目时刷新人员目录，保证新建或停用的平台账号能及时反映。
watch(activeSection, (section) => {
  if (['allocation', 'inbox', 'assignments'].includes(section)) loadPersonnel()
  if (section === 'preparation') loadEquipmentReservations(selectedServiceItem.value)
})
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
          <div class="pm-nav-label">{{ group.label }}</div>
          <button v-for="item in group.items" :key="item.key" class="pm-nav-item" :class="{ active: activeSection === item.key }" :aria-current="activeSection === item.key ? 'page' : undefined" @click="navigate(item.key)">
            <ConsoleIcon :name="item.icon" /><span>{{ item.label }}</span><em v-if="item.badge">{{ item.badge }}</em>
          </button>
        </div>
        <div class="pm-nav-group">
          <div class="pm-nav-label">平台能力</div>
          <button class="pm-nav-item" type="button" @click="returnToUnifiedPortal"><ConsoleIcon name="dashboard" /><span>返回子系统门户</span></button>
        </div>
      </nav>
      <div class="pm-sidebar-foot">V1.0 · 项目服务内容管理</div>
    </aside>
    <div v-if="mobileMenuOpen" class="pm-menu-mask" @click="mobileMenuOpen = false"></div>

    <main class="pm-main">
      <header class="pm-topbar">
        <button class="pm-icon-button pm-menu-button" aria-label="打开菜单" @click="mobileMenuOpen = true"><ConsoleIcon name="menu" /></button>
        <div class="pm-breadcrumb"><span>项目服务管理</span><b>/</b><template v-if="activeSection === 'project_detail'"><button type="button" class="pm-crumb-link" @click="navigate('projects')">项目列表</button><b>/</b><strong>{{ detailProject?.id || '项目详情' }}</strong></template><strong v-else>{{ currentMeta[0] }}</strong></div>
        <div class="pm-top-tools">
          <button class="pm-icon-button pm-notification-button" aria-label="通知" @click="notificationOpen = !notificationOpen"><ConsoleIcon name="bell" /><em v-if="notificationCount">{{ notificationCount }}</em></button>
          <div class="pm-user"><span>{{ currentUserName.slice(0, 1) }}</span><div><b>{{ currentUserName }}</b><small>{{ currentUserRole }}</small></div><button class="pm-user-return" type="button" :disabled="isLoggingOut" aria-label="退出应用系统" @click="logoutSystem"><ConsoleIcon name="logout" /></button></div>
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
            <button v-if="canManageRules && isVisibleConfigSection" class="pm-button primary" @click="openConfigCreate">＋ 新建规则</button><button v-if="activeSection === 'projects' && canCreateProject" class="pm-button primary" @click="openCreateProject">＋ 新建项目</button>
            <button v-if="activeSection === 'decomposition' && canConfirmDecomposition" class="pm-button primary" :disabled="saving" @click="confirmDecomposition">{{ saving ? '提交中…' : '确认拆解' }}</button><button v-if="activeSection === 'decomposition' && canManageDecomposition" type="button" class="pm-button" :disabled="saving" @click="openDecompositionAdjust">调整拆解</button>
          </div>
        </section>

        <section v-if="loadError" class="pm-empty">
          <ConsoleIcon name="info" /><b>后端数据加载失败</b><span>{{ loadError }}</span><button class="pm-button" @click="loadWorkspace">重新加载</button>
        </section>

        <section v-if="['decomposition', 'allocation'].includes(activeSection) && missingStampedContractCount" class="pm-contract-warning"><ConsoleIcon name="info" /><div><b>{{ missingStampedContractCount }} 份合同尚未上传盖章合同</b><p>{{ activeSection === 'decomposition' ? '合同审批已完成，可继续核对并确认服务项拆解；该提示不阻断拆解确认。' : '服务项拆解已确认，可继续分配团队、人员及设备；上传盖章合同后提示将自动清除。' }}</p></div></section>

        <template v-if="activeSection === 'dashboard'">
          <section class="pm-kpis">
            <button type="button" class="pm-kpi blue" @click="navigate('projects')"><span class="pm-kpi-corner">北极星</span><div class="pm-kpi-label"><span>全部项目</span><em>实时</em></div><strong class="pm-kpi-value">{{ dashboard.project_count }}<small>个</small></strong><p class="pm-kpi-note"><span>{{ dashboard.in_flight_projects }} 个在途项目</span></p><p class="pm-kpi-meta">已完成 {{ doneProjectCount }} · 风险 {{ dashboard.risk_projects }} · 待拆解 {{ pendingDecompositionCount }}</p></button>
            <button type="button" class="pm-kpi cyan" @click="navigate('decomposition')"><span class="pm-kpi-corner">合同拆解</span><div class="pm-kpi-label"><span>全部服务项</span><em>实时</em></div><strong class="pm-kpi-value">{{ dashboard.service_items }}<small>项</small></strong><p class="pm-kpi-note"><span>{{ decompositionItems.length }} 项待确认 · 需业务管理员处理</span></p><p class="pm-kpi-meta">现场记录驱动实施中状态 · 交付事件全量留痕</p></button>
            <button type="button" class="pm-kpi amber" @click="navigate('allocation')"><div class="pm-kpi-label"><span>资源分配待办</span><em>待处理</em></div><strong class="pm-kpi-value">{{ serviceFlow[0].count }}<small>项</small></strong><p class="pm-kpi-note"><span>{{ inboxItems.length }} 项已下达待完善</span></p><p class="pm-kpi-meta">人员与设备在实施准备阶段登记使用时段</p></button>
            <button type="button" class="pm-kpi violet" @click="navigate('exceptions')"><div class="pm-kpi-label"><span>风险项目 / 异常</span><em>实时</em></div><strong class="pm-kpi-value">{{ dashboard.risk_projects }}<small>项</small></strong><p class="pm-kpi-note"><span>{{ pendingDeviations.length }} 项偏离待评审</span></p><p class="pm-kpi-meta">风险口径：异常处理中 + 已终止（服务端派生）</p></button>
          </section>
          <section class="pm-dashboard-grid">
            <article class="pm-panel pm-status-panel">
              <header><div><p class="pm-panel-kicker">SERVICE FLOW</p><h2>服务项状态分布</h2></div><span>总计 <b>{{ serviceItems.length }}</b> 项</span></header>
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>状态</th><th class="num">数量</th><th>占比</th><th></th></tr></thead><tbody><tr v-for="flow in serviceFlow" :key="flow.key" @click="navigate(flow.route)"><td><span class="pm-badge" :class="statusTone(flow.key)">{{ flow.key }}</span></td><td class="num">{{ flow.count }}</td><td><div class="pm-bar-bg"><i class="pm-bar-fill" :class="flow.color" :style="{ width: `${serviceItems.length ? (flow.count * 100 / serviceItems.length).toFixed(1) : 0}%` }"></i></div><small>{{ serviceItems.length ? (flow.count * 100 / serviceItems.length).toFixed(1) : '0.0' }}%</small></td><td><button class="pm-link">查看 →</button></td></tr><tr v-if="!serviceFlow.length"><td colspan="4" class="pm-empty-mini">暂无服务项数据</td></tr></tbody></table></div>
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
            <header><div><p class="pm-panel-kicker">DELIVERY PULSE</p><h2>在途项目 · 实时动态</h2></div><span>共 {{ inFlightProjects.length }} 个在途项目</span></header>
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>项目编号</th><th>客户</th><th>服务项</th><th>团队 / 项目经理</th><th>进度</th><th>计划完成</th><th></th></tr></thead><tbody><tr v-for="project in inFlightProjects.slice(0, 8)" :key="project.id" :class="{ risk: riskProjectStatuses.includes(project.status) }"><td><button class="pm-project-link" @click="openProject(project)"><b>{{ project.id }}</b></button></td><td>{{ project.customer }}</td><td>{{ project.services }} 项</td><td><b>{{ project.team }}</b><span class="pm-cell-sub">{{ project.manager }}</span></td><td><div class="pm-progress-cell"><div class="pm-inline-progress"><i :style="{ width: `${project.progress}%` }"></i></div><small>{{ project.progress }}%</small></div></td><td :class="{ 'pm-text-danger': project.due.includes('超期') }">{{ project.due }}</td><td><button class="pm-link" @click="openProject(project)">详情</button></td></tr><tr v-if="!inFlightProjects.length"><td colspan="7" class="pm-empty-mini">暂无在途项目</td></tr></tbody></table></div>
            <footer class="pm-table-footer"><span>共 {{ inFlightProjects.length }} 个在途项目</span><span>前 8 条 · 完整列表请前往实时监控</span></footer>
          </section>
        </template>

        <template v-else-if="activeSection === 'projects'">
          <section class="pm-kpi-row">
            <button type="button" class="pm-kpi" @click="statusFilter = ''"><div class="pm-kpi-label"><span>全部项目</span></div><strong class="pm-kpi-value">{{ projects.length }}<small>个</small></strong><p class="pm-kpi-meta">当前租户 · 实时</p></button>
            <button type="button" class="pm-kpi amber" @click="statusFilter = '待拆解确认'"><div class="pm-kpi-label"><span>待拆解确认</span></div><strong class="pm-kpi-value">{{ pendingDecompositionCount }}<small>个</small></strong><p class="pm-kpi-meta">需业务管理员处理</p></button>
            <button type="button" class="pm-kpi blue" @click="statusFilter = ''"><div class="pm-kpi-label"><span>在途项目</span></div><strong class="pm-kpi-value">{{ inFlightProjects.length }}<small>个</small></strong><p class="pm-kpi-meta">含实施中 / 报告编制</p></button>
            <button type="button" class="pm-kpi green" @click="statusFilter = '已完成'"><div class="pm-kpi-label"><span>已完成</span></div><strong class="pm-kpi-value">{{ doneProjectCount }}<small>个</small></strong><p class="pm-kpi-meta">已完成交付</p></button>
            <button type="button" class="pm-kpi red" @click="navigate('monitoring')"><div class="pm-kpi-label"><span>风险项目</span></div><strong class="pm-kpi-value">{{ riskProjectCount }}<small>个</small></strong><p class="pm-kpi-meta">含终止 / 超期</p></button>
          </section>
          <section class="pm-search-bar">
            <label class="pm-search-input"><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索项目编号 / 客户名称 / 服务项" aria-label="搜索项目" /></label>
            <select v-model="statusFilter" class="pm-filter-select" aria-label="按状态筛选"><option value="">状态：全部</option><option v-for="node in projectStatusNodes" :key="node" :value="node">{{ node }}</option></select>
            <select v-model="categoryFilter" class="pm-filter-select" aria-label="按检测类别筛选"><option value="">检测类别：全部</option><option v-for="option in categoryOptions" :key="option" :value="option">{{ option }}</option></select>
            <select v-model="teamFilter" class="pm-filter-select" aria-label="按团队筛选"><option value="">团队：全部</option><option v-for="option in teamOptions" :key="option" :value="option">{{ option }}</option></select>
            <span v-if="statusFilter" class="pm-filter-tag">状态：{{ statusFilter }}<button type="button" class="pm-filter-tag-x" :aria-label="`移除状态筛选 ${statusFilter}`" @click="statusFilter = ''">✕</button></span>
            <span v-if="categoryFilter" class="pm-filter-tag">类别：{{ categoryFilter }}<button type="button" class="pm-filter-tag-x" :aria-label="`移除类别筛选 ${categoryFilter}`" @click="categoryFilter = ''">✕</button></span>
            <span v-if="teamFilter" class="pm-filter-tag">团队：{{ teamFilter }}<button type="button" class="pm-filter-tag-x" :aria-label="`移除团队筛选 ${teamFilter}`" @click="teamFilter = ''">✕</button></span>
            <div class="pm-actions-row"><button class="pm-button ghost" @click="resetProjectFilters">重置</button><span class="pm-filter-count">{{ filteredProjects.length }} 条结果</span></div>
          </section>
          <section class="pm-table-panel">
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th></th><th>项目 / 客户</th><th>合同编号</th><th>服务项</th><th>检测类别</th><th>团队 / 项目经理</th><th>状态</th><th>交付进度</th><th>计划完成</th><th></th></tr></thead><tbody>
              <tr v-for="project in pagedProjects" :key="project.id" :class="{ selected: selectedRows.includes(project.id), risk: riskProjectStatuses.includes(project.status) }"><td><input type="checkbox" :checked="selectedRows.includes(project.id)" :aria-label="`选择 ${project.id}`" @change="toggleRow(project.id)" /></td><td><button class="pm-project-link" @click="openProject(project)"><b>{{ project.id }}</b><span>{{ project.customer }}</span></button></td><td class="mono">{{ project.contract }}</td><td>{{ project.services }}</td><td>{{ project.category }}</td><td><b>{{ project.team }}</b><span class="pm-cell-sub">{{ project.manager }}</span></td><td><span class="pm-badge" :class="statusTone(project.status)">{{ project.status }}</span></td><td><div class="pm-progress-cell"><div class="pm-inline-progress"><i :style="{ width: `${project.progress}%` }"></i></div><small>{{ project.progress }}%</small></div></td><td :class="{ 'pm-text-danger': project.due.includes('超期') }">{{ project.due }}</td><td><button class="pm-link" @click="openProject(project)">详情</button></td></tr>
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
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>服务项</th><th>计划窗口</th><th>现场计划</th><th>实施人员</th><th>设备</th><th>渗透合规</th></tr></thead><tbody>
                <tr v-for="item in detailItems.filter((row) => row.implementation_plan)" :key="item.id"><td class="mono"><b>{{ item.id }}</b></td><td>{{ item.planned_start ? `${String(item.planned_start).slice(0, 10)} ~ ${String(item.planned_end).slice(0, 10)}` : '—' }}</td><td>{{ item.implementation_plan?.site_plan || '—' }}</td><td>{{ (item.implementation_plan?.personnel || []).map((row) => row.resource_name).join('、') || '未登记' }}</td><td>{{ (item.implementation_plan?.equipment || []).map((row) => row.resource_name).join('、') || '未登记' }}</td><td><span v-if="item.test_mode === 'PENETRATION'" class="pm-badge 待确认">{{ item.implementation_plan?.auth_doc_no || '待补授权书' }}</span><span v-else>—</span></td></tr>
                <tr v-if="!detailItems.some((row) => row.implementation_plan)"><td colspan="6" class="pm-empty-mini">暂无已发布的实施计划</td></tr>
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
                  <div class="pm-desc-item"><dt>SLA 超期 / 临近</dt><dd :class="slaOverdueItems.length ? 'pm-text-danger' : ''">{{ slaOverdueItems.length }}</dd></div>
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
            <header><div><p class="pm-panel-kicker danger">SLA WATCH</p><h2>SLA 超期与临近超期服务项</h2></div><span>服务端口径：计划完成超期 + 状态停留时限（pm_sla 规则）</span></header>
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
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>项目编号</th><th>客户</th><th>服务项</th><th>团队</th><th>项目经理</th><th>状态</th><th>进度</th><th>计划完成</th><th></th></tr></thead><tbody><tr v-for="project in filteredMonitoredProjects" :key="project.id" :class="{ risk: riskProjectStatuses.includes(project.status) }"><td><button class="pm-project-link" @click="openProject(project)"><b>{{ project.id }}</b></button></td><td>{{ project.customer }}</td><td>{{ project.services }} 项</td><td>{{ project.team }}</td><td>{{ project.manager }}</td><td><span class="pm-badge" :class="statusTone(project.status)">{{ project.status }}</span><span class="pm-cell-sub">{{ monitoredStatusByProject(project.status) }}</span></td><td><div class="pm-progress-cell"><div class="pm-inline-progress"><i :style="{ width: `${project.progress}%` }"></i></div><small>{{ project.progress }}%</small></div></td><td :class="{ 'pm-text-danger': project.due.includes('超期') }">{{ project.due }}</td><td><button class="pm-btn-link" @click="openProject(project)">详情</button></td></tr><tr v-if="!filteredMonitoredProjects.length"><td colspan="9" class="pm-empty-mini">暂无匹配的在途项目</td></tr></tbody></table></div>
            <footer class="pm-table-footer"><span>共 {{ filteredMonitoredProjects.length }} 个在途项目</span><div class="pm-pagination"><button class="pm-pg" disabled>‹</button><button class="pm-pg active">1</button><button class="pm-pg" disabled>›</button></div></footer>
          </section>
        </template>

        <template v-else-if="activeSection === 'decomposition'">
          <section v-if="decompositionProject" class="pm-source-card"><div class="pm-source-icon"><ConsoleIcon name="account" /></div><div><span>合同来源</span><h2>{{ decompositionProject.contract }} · {{ decompositionProject.customer }}</h2><p>合同版本 {{ decompositionProject.contract_version || '—' }} · 自动生成于 {{ formatDateTime(decompositionProject.created_at) }}</p></div><span class="pm-badge normal">{{ decompositionProject.status }}</span></section>
          <section class="pm-decompose-grid"><article class="pm-panel pm-tree-panel"><header><div><p class="pm-panel-kicker">SERVICE TREE</p><h2>服务项树</h2></div><span>{{ decompositionItems.length }} 项</span></header><button v-for="([batch, items], index) in decompositionBatches" :key="batch" :class="{ active: index === 0 }"><span>{{ String(index + 1).padStart(2, '0') }}</span><div><b>{{ batch }}</b><small>{{ items.length }} 个服务项</small></div></button><div class="pm-tree-note"><b>自动拆解校验</b><p>{{ penetrationPending.length }} 项渗透测试需要专项计划；确认后的服务项进入资源分配。</p></div></article>
            <article class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>纳入</th><th>服务项编号</th><th>场所 / 批次</th><th>检测类别</th><th>技术要求摘要</th><th>体系</th><th>特殊方法</th><th>状态</th></tr></thead><tbody><tr v-for="item in decompositionItems" :key="item.id"><td><input v-model="item.selected" type="checkbox" :aria-label="`纳入 ${item.id}`" /></td><td class="mono"><b>{{ item.id }}</b></td><td>{{ item.site }}<span class="pm-cell-sub">{{ item.batch }}</span></td><td>{{ item.category }}</td><td>{{ item.requirement }}</td><td>{{ item.system }}</td><td><span class="pm-badge" :class="item.special === '是' ? '待确认' : 'neutral'">{{ item.special }}</span></td><td><span class="pm-badge" :class="statusTone(item.status)">{{ item.status }}</span></td></tr></tbody></table></div></article>
          </section>
        </template>

        <template v-else-if="activeSection === 'implementation'">
          <section class="pm-board-summary"><div><strong>{{ serviceItems.length }}</strong><span>全部服务项</span></div><div><strong>{{ serviceFlow[2].count }}</strong><span>正在实施</span></div><div><strong>{{ serviceFlow[3].count }}</strong><span>报告编制</span></div><div><strong>{{ serviceFlow[4].count }}</strong><span>现场完成</span></div></section>
          <section class="pm-kanban"><article v-for="column in kanbanColumns" :key="column.key"><header><div><i :class="column.color"></i><b>{{ column.key }}</b></div><span>{{ column.count }}</span></header><div class="pm-kanban-body"><button v-for="card in column.cards" :key="card.id" class="pm-kanban-card" :class="[column.color, { risk: riskProjectStatuses.includes(card.status) }]" @click="openProject(card)"><b>{{ card.id }}</b><h3>{{ card.customer }}</h3><span class="pm-badge" :class="statusTone(card.status)">{{ card.status }}</span><div class="pm-inline-progress"><i :style="{ width: `${card.progress}%` }"></i></div><footer><span>{{ card.progress }}%</span><time>{{ card.due || '待排期' }}</time></footer></button><div v-if="!column.cards.length" class="pm-empty-mini">暂无数据</div></div></article></section>
          <section class="pm-panel pm-operation-panel"><header><div><p class="pm-panel-kicker">FIELD EXECUTION</p><h2>现场记录与实施完成</h2></div></header><ServiceItemPicker :items="serviceItems" :selected-ids="selectedServiceItem ? [selectedServiceItem.id] : []" empty-text="暂无可签到服务项" @select="selectServiceItem" /><div v-if="selectedServiceItem && canExecuteField" class="pm-form pm-operation-form"><label><span>现场原始数据 <em>*</em></span><textarea v-model.trim="operationForm.rawData" rows="3" placeholder="记录现场实测数据与依据"></textarea></label><label><span>环境条件 <em>*</em></span><textarea v-model.trim="operationForm.environment" rows="3" placeholder="记录现场环境条件"></textarea></label><button class="pm-button primary" :disabled="saving" @click="runOperation('field')">提交现场记录</button></div><button v-if="selectedServiceItem && selectedServiceItem.status === '实施中' && canCompleteField" class="pm-button" :disabled="saving" @click="runOperation('complete')">确认该服务项现场完成</button><div v-else-if="!selectedServiceItem" class="pm-empty-mini">请先选择服务项</div></section>
        </template>

        <template v-else-if="activeSection === 'sites'">
          <section class="pm-panel pm-equipment-layout"><header><div><p class="pm-panel-kicker">SITE REGISTRY</p><h2>站点档案</h2><p>维护站点编码、地址与坐标；坐标可在现场用浏览器定位自动获取，也可手工填写。</p></div><div class="pm-panel-actions"><button class="pm-button" :disabled="saving" @click="loadSites">刷新</button><button v-if="canManageResource" class="pm-button primary" :disabled="saving" @click="openSiteDialog()">＋ 新建站点</button></div></header></section>
          <p v-if="siteError" class="pm-form-hint" role="alert">{{ siteError }}</p>
          <section class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>站点编码</th><th>站点名称</th><th>地址</th><th>坐标</th><th>状态</th><th></th></tr></thead><tbody><tr v-for="item in sites" :key="item.site_code"><td class="mono">{{ item.site_code }}</td><td><b>{{ item.name }}</b></td><td>{{ item.address || '—' }}</td><td><span v-if="item.has_coordinates" class="mono">{{ item.latitude }}, {{ item.longitude }}</span><span v-else class="pm-badge neutral">未采集</span></td><td><span class="pm-badge" :class="statusTone(item.status)">{{ item.status === 'ACTIVE' ? '启用' : '停用' }}</span></td><td style="width: 160px; min-width: 160px;"><button v-if="canManageResource" class="pm-link" @click="openSiteDialog(item)">编辑</button><button v-if="canManageResource && item.status === 'ACTIVE'" class="pm-link" :disabled="saving" @click="disableSite(item)">停用</button></td></tr></tbody></table></div><div v-if="!sites.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无站点档案</b><span>点击「＋ 新建站点」开始维护站点主数据。</span></div></section>
          <div v-if="siteDialog" class="pm-overlay" @click.self="siteDialog = null"><form class="pm-dialog" @submit.prevent="saveSite"><header><div><span>SITE</span><h2>{{ siteDialog.site_code ? '编辑站点' : '新建站点' }}</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="siteDialog = null"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>站点编码 <em>*</em></span><input v-model.trim="siteDialog.site_code" required placeholder="例如 SITE-HZ-01" /></label><label><span>站点名称 <em>*</em></span><input v-model.trim="siteDialog.name" required placeholder="例如 杭州机房" /></label><label class="pm-span-full"><span>地址</span><input v-model.trim="siteDialog.address" placeholder="例如 杭州市余杭区..." /></label><div class="pm-field pm-span-full"><span>坐标</span><div class="pm-form-row"><input v-model.trim="siteDialog.latitude" type="number" step="any" aria-label="纬度" placeholder="纬度" /><input v-model.trim="siteDialog.longitude" type="number" step="any" aria-label="经度" placeholder="经度" /><button type="button" class="pm-button" :disabled="locatingSite" @click="locateCurrentSite">{{ locatingSite ? '定位中…' : '定位当前位置' }}</button></div><p class="pm-form-hint">在现场点击「定位当前位置」可由浏览器自动获取坐标；留空表示尚未采集。</p></div><label><span>状态</span><select v-model="siteDialog.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label><label class="pm-span-half"><span>备注</span><textarea v-model.trim="siteDialog.notes" rows="2"></textarea></label></div><footer><button type="button" class="pm-button" @click="siteDialog = null">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存站点' }}</button></footer></form></div>
        </template>
        <template v-else-if="activeSection === 'equipment'">
          <section class="pm-panel pm-equipment-layout"><header><div><p class="pm-panel-kicker">EQUIPMENT CAPABILITY</p><h2>设备能力维护</h2><p>维护设备基础信息、能力编码、检定有效期与启停状态。</p></div></header><form class="pm-form pm-equipment-form" @submit.prevent="saveEquipment"><label><span>设备编号 <em>*</em></span><input v-model.trim="equipmentForm.resourceID" required placeholder="例如 EQ-001" /></label><label><span>设备名称 <em>*</em></span><input v-model.trim="equipmentForm.resourceName" required placeholder="请输入设备名称" /></label><label><span>能力编码 <em>*</em></span><input v-model.trim="equipmentForm.codes" required placeholder="多个编码用逗号分隔" /></label><label><span>检定开始</span><input v-model="equipmentForm.validFrom" type="date" /></label><label><span>检定到期</span><input v-model="equipmentForm.validUntil" type="date" /></label><label><span>状态</span><select v-model="equipmentForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label><label><span>使用范围</span><select v-model="equipmentForm.usageScope"><option value="ANY">可借出</option><option value="COMPANY_ONLY">仅在公司使用（不可借出）</option></select></label><button class="pm-button primary">保存设备</button></form></section><section class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>设备编号</th><th>设备名称</th><th>能力</th><th>检定有效期</th><th>状态</th><th>在位 / 使用范围</th><th>操作</th></tr></thead><tbody><tr v-for="item in equipment" :key="item.resource_id"><td class="mono">{{ item.resource_id }}</td><td><b>{{ item.resource_name }}</b></td><td><span v-if="!(item.codes || []).length">—</span><span v-else class="pm-code-pills"><span v-for="code in item.codes" :key="code" class="pm-code-pill">{{ code }}</span></span></td><td>{{ item.valid_until ? formatDateTime(item.valid_until) : '未设置' }}</td><td><span class="pm-badge" :class="statusTone(item.status)">{{ item.status === 'ACTIVE' ? '启用' : '停用' }}</span></td><td><span class="pm-badge" :class="item.presence === 'OUT_OF_COMPANY' ? 'amber' : 'normal'">{{ equipmentPresenceLabel(item) }}</span><small v-if="item.borrowed_by" class="pm-cell-sub">{{ item.borrowed_by }} · {{ item.borrowed_window }}</small><small v-if="item.usage_scope === 'COMPANY_ONLY'" class="pm-form-hint">仅在公司使用 · 不可借出</small></td><td><button class="pm-link" @click="editEquipment(item)">编辑 / 更新</button><button v-if="item.presence === 'OUT_OF_COMPANY'" class="pm-link danger" @click="returnEquipment(item)">归还</button></td></tr></tbody></table></div><p v-if="equipmentError" class="pm-form-hint" role="alert">{{ equipmentError }}</p><div v-else-if="!equipment.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无设备</b><span>使用上方表单新增设备。</span></div></section>
        </template>
        <template v-else-if="activeSection === 'qualifications'"><section class="pm-panel"><header><div><p class="pm-panel-kicker">RESOURCE CAPABILITY</p><h2>资质与能力管理</h2><p>维护并展示人员资质与设备能力记录。</p></div><div class="pm-panel-actions"><input ref="qualificationFileInput" class="pm-file-input" type="file" accept=".csv,text/csv" @change="importQualificationFile" /><button class="pm-button" :disabled="saving" @click="downloadCapabilities">导出 CSV</button><template v-if="canManageResource"><button class="pm-button" :disabled="saving" @click="qualificationFileInput.click()">导入 CSV</button><button class="pm-button" :disabled="saving" @click="syncIdentities">同步人员状态</button><button class="pm-button primary" :disabled="saving" @click="openCapabilityDialog()">＋ 新建资质</button></template></div></header><div class="pm-qualification-filter"><section class="pm-sm-tabs pm-capability-tabs"><button v-for="tab in capabilityTabs" :key="tab.key" type="button" class="pm-tab-pill" :class="{ active: capabilityTab === tab.key }" @click="capabilityTab = tab.key">{{ tab.label }}<span class="pm-tab-count">{{ tab.count }}</span></button></section><label><span>资源类型</span><select v-model="capabilityTypeFilter" class="pm-filter-select"><option value="">全部</option><option value="PERSON">人员资质</option><option value="EQUIPMENT">设备能力</option></select></label><label><span>状态</span><select v-model="capabilityStatusFilter" class="pm-filter-select"><option value="">全部</option><option value="ACTIVE">有效</option><option value="DISABLED">停用</option></select></label></div></section><section v-if="capabilityTab === 'codes'" class="pm-table-panel"><header><div><p class="pm-panel-kicker">CODE MATRIX</p><h2>体系与编码映射</h2></div><span>按能力台账聚合：编码 × 持有人员数 / 设备数</span></header><div class="pm-matrix-wrap"><table class="pm-matrix"><thead><tr><th>能力编码</th><th>人员</th><th>设备</th><th>覆盖合计</th></tr></thead><tbody><tr v-for="row in capabilityCodeRows" :key="row.code"><td><span class="pm-code-pill">{{ row.code }}</span></td><td><span class="pm-badge" :class="row.personCount ? 'normal' : 'neutral'">{{ row.personCount }} 人</span></td><td><span class="pm-badge" :class="row.equipmentCount ? 'normal' : 'neutral'">{{ row.equipmentCount }} 台</span></td><td class="num">{{ row.personCount + row.equipmentCount }}</td></tr><tr v-if="!capabilityCodeRows.length"><td colspan="4" class="pm-empty-mini">暂无能力编码，请在资质记录中维护</td></tr></tbody></table></div></section>
          <section v-else-if="capabilityTab === 'expiry'" class="pm-table-panel"><header><div><p class="pm-panel-kicker danger">EXPIRY WATCH</p><h2>到期提醒</h2></div><span>30 天内到期或已过期 · 按到期时间升序</span></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>编号</th><th>名称</th><th>类型</th><th>能力编码</th><th>到期日</th><th>状态</th></tr></thead><tbody><tr v-for="item in expiringCapabilities" :key="item.resource_id" :class="{ risk: new Date(item.valid_until).getTime() <= Date.now() }"><td class="mono">{{ item.resource_id }}</td><td><b>{{ item.resource_name }}</b></td><td>{{ item.resource_type === 'PERSON' ? '人员资质' : '设备能力' }}</td><td><span v-if="!(item.codes || []).length">—</span><span v-else class="pm-code-pills"><span v-for="code in item.codes" :key="code" class="pm-code-pill">{{ code }}</span></span></td><td :class="{ 'pm-text-danger': new Date(item.valid_until).getTime() <= Date.now() }">{{ item.valid_until.slice(0, 10) }}</td><td><span class="pm-badge" :class="new Date(item.valid_until).getTime() <= Date.now() ? '风险' : '关注'">{{ new Date(item.valid_until).getTime() <= Date.now() ? '已过期' : '即将到期' }}</span></td></tr><tr v-if="!expiringCapabilities.length"><td colspan="6" class="pm-empty-mini">30 天内没有到期的资质或检定</td></tr></tbody></table></div></section>
          <section v-else class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>资源类型</th><th>编号</th><th>名称</th><th>资质 / 能力编码</th><th>有效期</th><th>使用范围</th><th>状态</th><th>人员状态</th><th></th></tr></thead><tbody><tr v-for="item in filteredCapabilities" :key="item.resource_id"><td><span class="pm-badge neutral">{{ item.resource_type === 'PERSON' ? '人员' : '设备' }}</span></td><td class="mono">{{ item.resource_id }}</td><td><b>{{ item.resource_name }}</b></td><td><span v-if="!(item.codes || []).length">—</span><span v-else class="pm-code-pills"><span v-for="code in item.codes" :key="code" class="pm-code-pill">{{ code }}</span></span></td><td>{{ item.valid_until ? (item.valid_from ? `${item.valid_from.slice(0, 10)} ~ ` : '') + item.valid_until.slice(0, 10) : '长期' }}</td><td><span v-if="item.resource_type === 'EQUIPMENT'" class="pm-badge" :class="item.usage_scope === 'COMPANY_ONLY' ? '关注' : 'neutral'">{{ item.usage_scope === 'COMPANY_ONLY' ? '仅在公司使用' : '可借出' }}</span><span v-else>—</span></td><td><span class="pm-badge" :class="statusTone(item.status)">{{ item.status === 'ACTIVE' ? '有效' : '停用' }}</span></td><td><template v-if="item.resource_type === 'PERSON'"><span class="pm-badge" :class="statusTone(item.identity_status)">{{ identityStatusLabel(item.identity_status) }}</span></template><span v-else>—</span></td><td style="width: 90px; min-width: 90px;"><button v-if="canManageResource" class="pm-link" @click="openCapabilityDialog(item)">编辑 / 更新</button></td></tr></tbody></table></div><div v-if="!filteredCapabilities.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无资质记录</b><span>点击「＋ 新建资质」或通过 CSV 导入添加记录。</span></div><footer v-if="importResult"><span role="status">导入完成：成功 {{ importResult.imported }} 条，跳过 {{ importResult.skipped }} 条。</span><span v-if="importResult.errors?.length"><small>{{ importResult.errors.slice(0, 3).join('；') }}{{ importResult.errors.length > 3 ? '…' : '' }}</small></span></footer></section><div v-if="capabilityDialog" class="pm-overlay" @click.self="capabilityDialog = null"><form class="pm-dialog" @submit.prevent="saveCapability"><header><div><span>CAPABILITY</span><h2>{{ capabilityDialog.resource_id ? '编辑资质 / 能力' : '新建资质 / 能力' }}</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="capabilityDialog = null"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>资源类型 <em>*</em></span><select v-model="capabilityDialog.resource_type" required @change="onCapabilityTypeChange"><option value="PERSON">人员资质</option><option value="EQUIPMENT">设备能力</option></select></label><label><span>{{ capabilityDialog.resource_type === 'EQUIPMENT' ? '设备编号' : '人员编号' }} <em>*</em></span><input v-model.trim="capabilityDialog.resource_id" :readonly="capabilityAutoID" required placeholder="系统自动生成" /><small v-if="capabilityAutoID" class="pm-form-hint">由系统自动生成（人员 P- / 设备 EQ-），无需手工填写</small></label><label><span>资源名称 <em>*</em></span><input v-model.trim="capabilityDialog.resource_name" required placeholder="例如 张三 或 基站A" /></label><label><span>资质 / 能力编码 <em>*</em></span><input v-model.trim="capabilityDialog.codes" required placeholder="多个编码用逗号分隔" /></label><label><span>起始日期</span><input v-model="capabilityDialog.valid_from" type="date" /></label><label><span>截止日期</span><input v-model="capabilityDialog.valid_until" type="date" /></label><label v-if="capabilityDialog.resource_type === 'EQUIPMENT'"><span>使用范围</span><select v-model="capabilityDialog.usage_scope"><option value="ANY">可借出</option><option value="COMPANY_ONLY">仅在公司使用（不可借出）</option></select></label><label><span>状态</span><select v-model="capabilityDialog.status"><option value="ACTIVE">有效</option><option value="DISABLED">停用</option></select></label></div><footer><button type="button" class="pm-button" @click="capabilityDialog = null">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存资质' }}</button></footer></form></div></template><template v-else-if="isVisibleConfigSection">
          <section class="pm-kpi-row">
            <div class="pm-kpi"><div class="pm-kpi-label"><span>规则总数</span></div><strong class="pm-kpi-value">{{ configStats.total }}<small>条</small></strong><p class="pm-kpi-meta">{{ activeConfigMeta.label }}</p></div>
            <div class="pm-kpi green"><div class="pm-kpi-label"><span>已启用</span></div><strong class="pm-kpi-value">{{ configStats.enabled }}<small>条</small></strong><p class="pm-kpi-meta">参与运行时判定</p></div>
            <div class="pm-kpi red"><div class="pm-kpi-label"><span>已停用</span></div><strong class="pm-kpi-value">{{ configStats.disabled }}<small>条</small></strong><p class="pm-kpi-meta">停用后立即对新事件生效</p></div>
          </section>
          <section v-if="activeSection === 'sla'" class="pm-alert info"><i></i><b>SLA 口径说明</b><span>状态 SLA 按「服务项停留在该状态的时长」判定（每次状态推进刷新计时）：超过时限记为超期，剩余时间不足提前提醒小时数记为临近提醒；计划完成时间超期作为独立口径在服务项列表单独统计。</span></section>
          <section v-if="activeSection === 'permissions' && permissionMatrix.rows.length" class="pm-table-panel">
            <header><div><p class="pm-panel-kicker">ACCESS MATRIX</p><h2>字段 × 角色 访问矩阵</h2></div><span>{{ permissionMatrix.rows.length }} 个受控字段 · {{ permissionMatrix.roles.length }} 个角色</span></header>
            <div class="pm-matrix-wrap"><table class="pm-matrix"><thead><tr><th>字段 ↓ \ 角色 →</th><th v-for="role in permissionMatrix.roles" :key="role">{{ role }}</th></tr></thead><tbody><tr v-for="row in permissionMatrix.rows" :key="row.field"><td class="mono">{{ row.field }}</td><td v-for="(cell, index) in row.cells" :key="`${row.field}-${permissionMatrix.roles[index]}`"><span v-if="cell" class="pm-badge" :class="permissionLevelTone[cell] || 'neutral'">{{ permissionLevelLabel[cell] || cell }}</span><span v-else class="pm-matrix-empty">未配置</span></td></tr></tbody></table></div>
          </section>
          <section class="pm-config-layout"><aside class="pm-config-note"><span><ConsoleIcon name="info" /></span><h2>配置说明</h2><p>{{ currentMeta[1] }}。变更将在保存后对新任务生效，已有项目不自动追溯。</p><ul><li>配置修改需业务管理员权限</li><li>关键规则变更会记录审计日志</li><li>关闭规则前请确认影响范围</li></ul></aside><article class="pm-table-panel"><header class="pm-filter-bar"><div class="pm-sm-tabs"><button v-for="meta in visibleConfigKinds" :key="meta.kind" type="button" class="pm-tab-pill" :class="{ active: activeSection === meta.kind }" @click="navigate(meta.kind)">{{ meta.label }}</button></div><span class="pm-filter-count">{{ activeConfigMeta.label }} 共 {{ visibleRules.length }} 条</span></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>配置名称</th><th v-for="column in activeConfigMeta.columns" :key="column.key">{{ column.label }}</th><th>状态</th><th>最后更新</th><th></th></tr></thead><tbody><tr v-for="rule in visibleRules" :key="rule.id"><td><b>{{ rule.name }}</b></td><td v-for="column in activeConfigMeta.columns" :key="column.key">{{ rule[column.key] !== undefined && rule[column.key] !== '' ? rule[column.key] : '—' }}</td><td><button v-if="canManageRules" class="pm-switch" :class="{ on: rule.enabled }" :aria-label="`${rule.enabled ? '停用' : '启用'} ${rule.name}`" @click="toggleRule(rule)"><i></i></button></td><td>{{ rule.updated }}</td><td><button v-if="canManageRules" class="pm-link" @click="openConfigEdit(rule)">编辑</button></td></tr></tbody></table></div><div v-if="!visibleRules.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无配置规则</b><span>点击「＋ 新建规则」添加 {{ activeConfigMeta.label }} 配置。</span></div></article></section>
        </template>

        <template v-else>
          <section class="pm-operational-stats"><article><span>待处理</span><strong>{{ operationRows.length }}</strong><small>来自当前工作区</small></article><article><span>服务项总数</span><strong>{{ serviceItems.length }}</strong><small>以服务端状态为准</small></article><article><span>已完成项目</span><strong>{{ completedProjectCount }}</strong><small>当前租户累计</small></article></section>
          <section class="pm-filters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索编号、项目或负责人" /></label><span>{{ operationRows.length }} 条结果</span></section>
          <section v-if="['allocation', 'inbox', 'planning', 'preparation', 'assignments', 'methods', 'exceptions', 'reports'].includes(activeSection)" class="pm-panel pm-operation-panel">
            <header><div><p class="pm-panel-kicker">REAL OPERATION</p><h2>服务项操作台</h2></div><span v-if="selectedServiceItem" class="pm-op-current">当前：{{ selectedServiceItem.id }} · <span class="pm-badge" :class="statusTone(selectedServiceItem.status)">{{ selectedServiceItem.status }}</span></span></header>
            <ServiceItemPicker v-if="activeSection === 'allocation'" :items="serviceItems" :selected-ids="selectedServiceItemIDs" multiple empty-text="暂无可分配服务项" hint="可同时选择多个服务项，批量分配团队负责人或执行团队。" @toggle="toggleServiceItem" /><ServiceItemPicker v-else :items="serviceItems" :selected-ids="selectedServiceItem ? [selectedServiceItem.id] : []" empty-text="暂无可操作服务项" @select="selectServiceItem" />
            <div v-if="selectedServiceItem" class="pm-form pm-operation-form">
              <template v-if="['allocation', 'inbox', 'assignments'].includes(activeSection)"><div class="pm-personnel-search"><label><span>查找平台人员</span><input v-model.trim="personnelKeyword" placeholder="输入姓名关键字" @keydown.enter.prevent="loadPersonnel" /></label><button type="button" class="pm-button" :disabled="personnelLoading" @click="loadPersonnel">{{ personnelLoading ? '查询中…' : '查询' }}</button></div><p v-if="personnelError" class="pm-form-hint" role="alert">{{ personnelError }}</p><label><span>团队负责人 <em>*</em></span><select v-model="operationForm.teamLeadID" :disabled="personnelLoading" required><option value="">请选择团队负责人</option><option v-for="option in teamLeadOptions" :key="option.id" :value="option.id">{{ option.name }}</option></select></label><template v-if="canExecutionAssign"><label><span>项目经理 <em>*</em></span><select v-model="operationForm.projectManagerID" :disabled="personnelLoading" required><option value="">请选择项目经理</option><option v-for="option in projectManagerOptions" :key="option.id" :value="option.id">{{ option.name }}</option></select></label><div class="pm-field"><span>工程师 <em>*</em></span><div class="pm-multi-dropdown" :class="{ open: openMulti === 'engineer' }"><button type="button" class="pm-multi-trigger" :class="{ placeholder: !engineerSelection.length }" :disabled="personnelLoading" aria-haspopup="listbox" :aria-expanded="openMulti === 'engineer'" @click.stop="toggleMulti('engineer')" @keydown="onMultiKeydown"><span>{{ multiSummary(engineerSelection, engineerOptions, '请选择工程师') }}</span><i class="pm-multi-caret"></i></button><div v-if="openMulti === 'engineer'" class="pm-multi-menu" role="listbox" aria-label="选择工程师" aria-multiselectable="true"><label v-for="option in engineerOptions" :key="option.id" class="pm-multi-option" :class="{ 'is-active': engineerOptions[multiActiveIndex]?.id === option.id, 'is-disabled': option.disabled }" role="option" :aria-selected="engineerSelection.includes(option.id)"><input type="checkbox" :checked="engineerSelection.includes(option.id)" :disabled="option.disabled" @change="toggleEngineer(option.id)" /><span>{{ option.name }}</span></label><p v-if="!engineerOptions.length" class="pm-empty-mini">暂无可选人员</p></div></div><div v-if="engineerChipOptions.length" class="pm-multi-chips"><span v-for="option in engineerChipOptions" :key="option.id" class="pm-chip">{{ option.name }}<button type="button" class="pm-chip-x" :aria-label="`移除 ${option.name}`" @click.stop="toggleEngineer(option.id)">✕</button></span></div></div></template><p v-if="selectedServiceItemIDs.length" class="pm-form-hint pm-allocation-preview">影响预览：将为 {{ selectedServiceItemIDs.length }} 个服务项{{ canExecutionAssign ? '写入团队负责人、项目经理与工程师并触发能力校验' : '写入团队负责人' }}；已选 {{ selectedServiceItems.map((item) => item.id).join('、') }}</p><button v-if="canSubmitAllocation" class="pm-button primary" :disabled="saving" @click="runOperation('allocation')">{{ saving ? '提交中…' : canExecutionAssign ? '保存分配并校验能力' : '分配团队负责人' }}</button></template>
              <template v-else-if="activeSection === 'planning'"><section v-if="operationSteps.length" class="pm-panel pm-stepper-panel"><div class="pm-stepper"><template v-for="(step, index) in operationSteps" :key="step.label"><div class="pm-step" :class="step.state"><span class="pm-step-num">{{ step.state === 'done' ? '✓' : index + 1 }}</span><span>{{ step.label }}</span></div><div v-if="index < operationSteps.length - 1" class="pm-step-line"></div></template></div></section><div v-if="planningBlocked" class="pm-blocker" :class="planningBlocked.tone" role="alert"><b>暂时不能发布实施计划</b><span>{{ planningBlocked.reason }}</span><button class="pm-button" type="button" @click="navigate('allocation')">前往任务分配</button></div><label><span>计划开始 <em>*</em></span><input v-model.trim="operationForm.plannedStart" type="datetime-local" /></label><label><span>计划结束 <em>*</em></span><input v-model.trim="operationForm.plannedEnd" type="datetime-local" /></label><label><span>现场计划 <em>*</em></span><textarea v-model.trim="operationForm.sitePlan" rows="3" placeholder="现场实施步骤和窗口"></textarea></label><template v-if="selectedServiceItem.test_mode === 'PENETRATION'"><label><span>渗透测试专项计划 <em>*</em></span><textarea v-model.trim="operationForm.penetrationTestPlan" rows="3"></textarea></label><fieldset class="pm-compliant-fieldset"><legend>专项合规要素（授权 / 白名单 / 时间窗 / 应急 / 回滚）</legend><label><span>授权书编号 <em>*</em></span><input v-model.trim="operationForm.authDocNo" required placeholder="例如 AUTH-2026-001" /></label><label><span>授权生效 <em>*</em></span><input v-model.trim="operationForm.authStart" type="datetime-local" required /></label><label><span>授权截止 <em>*</em></span><input v-model.trim="operationForm.authEnd" type="datetime-local" required /></label><label><span>授权范围 <em>*</em></span><input v-model.trim="operationForm.authScope" required placeholder="例如 内网段 10.0.0.0/8" /></label><label><span>计划测试范围 <em>*</em></span><input v-model.trim="operationForm.testScope" required placeholder="例如 关键业务系统 WEB 渗透" /></label><label><span>测试时间窗 <em>*</em></span><input v-model.trim="operationForm.testWindow" required placeholder="例如 00:00-06:00" /></label><label><span>应急联系人 <em>*</em></span><input v-model.trim="operationForm.emergencyContact" required placeholder="姓名 + 电话" /></label><label><span>回滚方案 <em>*</em></span><textarea v-model.trim="operationForm.rollbackPlan" rows="3" required></textarea></label></fieldset></template><section class="pm-plan-resources"><header><div><b>实施人员</b><small>资质与有效期取自「资质与能力」档案；使用时段留空表示全程；设备清单在「实施准备」中登记</small></div></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>名称</th><th>规格 / 资质</th><th>有效期</th><th>使用时段</th><th>备注</th><th></th></tr></thead><tbody><tr v-for="(row, index) in operationForm.personnel" :key="row.resourceID"><td>{{ planResourceName(row) }}</td><td><span v-if="!planResourceCodes(row).length">—</span><span v-else class="pm-code-pills"><span v-for="code in planResourceCodes(row)" :key="code" class="pm-code-pill">{{ code }}</span></span></td><td>{{ planResourceValidUntil(row) }}</td><td><div class="pm-plan-window"><input v-model="row.windowStart" type="date" aria-label="使用时段开始" /><span>~</span><input v-model="row.windowEnd" type="date" aria-label="使用时段结束" /></div></td><td><input v-model.trim="row.note" placeholder="例如 备份" /></td><td><button type="button" class="pm-link danger" @click="removePlanPersonnel(index)">移除</button></td></tr><tr v-if="!operationForm.personnel.length"><td colspan="6" class="pm-empty-mini">请至少添加一名实施人员</td></tr></tbody></table></div></section><button v-if="canPlanImplementation" class="pm-button primary" :disabled="saving || !!planningBlocked" :title="planningBlocked ? planningBlocked.reason : ''" @click="runOperation('planning')">发布实施计划</button></template>
              <template v-else-if="activeSection === 'methods'"><div class="pm-review-state"><span>复核状态</span><b class="pm-badge" :class="statusTone(item && reportTechReviewLabel(item.tech_review_status))">{{ item && reportTechReviewLabel(item.tech_review_status) }}</b></div><template v-if="item && ['PENDING', 'REJECTED'].includes(item.tech_review_status)"><label><span>复核意见</span><textarea v-model.trim="operationForm.reviewComment" rows="3" placeholder="填写风险说明或驳回原因"></textarea></label><div v-if="canReviewSpecialMethod" class="pm-form-row"><button class="pm-button primary" :disabled="saving" @click="runOperation('special-approve')">通过复核</button><button class="pm-button" :disabled="saving" @click="runOperation('special-reject')">驳回复核</button></div></template><template v-else-if="item && item.tech_review_status === 'APPROVED'"><p class="pm-form-hint">{{ item.tech_review_comment || '已通过复核，可发布实施计划' }}<span v-if="item.tech_reviewed_at"> · {{ formatDateTime(item.tech_reviewed_at) }} · {{ item.tech_reviewed_by }} </span></p></template><template v-else-if="item && item.tech_review_status === 'PENDING'"><p class="pm-form-hint">等待技术总监复核特殊方法。</p></template></template>
              <template v-else-if="activeSection === 'preparation'"><section class="pm-plan-resources"><header><div><b>设备清单</b><small>只列设备目录中的有效设备；同一设备在同一时段被其他服务项占用时不可选取</small></div><button type="button" class="pm-button" @click="openEquipmentPicker">＋ 添加设备</button></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>设备</th><th>能力码</th><th>检定有效期</th><th>使用时段</th><th>备注</th><th></th></tr></thead><tbody><tr v-for="(row, index) in operationForm.equipment" :key="row.resourceID"><td>{{ planResourceName(row) }}</td><td><span v-if="!planResourceCodes(row).length">—</span><span v-else class="pm-code-pills"><span v-for="code in planResourceCodes(row)" :key="code" class="pm-code-pill">{{ code }}</span></span></td><td>{{ planResourceValidUntil(row) }}</td><td><div class="pm-plan-window"><input v-model="row.windowStart" type="date" aria-label="使用时段开始" /><span>~</span><input v-model="row.windowEnd" type="date" aria-label="使用时段结束" /></div></td><td><input v-model.trim="row.note" placeholder="例如 备用机" /></td><td><button type="button" class="pm-link danger" @click="removePlanEquipment(index)">移除</button></td></tr><tr v-if="!operationForm.equipment.length"><td colspan="6" class="pm-empty-mini">请至少选择一台实施设备</td></tr></tbody></table></div></section><label><span>行程预订单 <em>*</em></span><input v-model.trim="operationForm.travelRequestID" /></label><label><span>备注</span><textarea v-model.trim="operationForm.comment" rows="3"></textarea></label><button v-if="canPlanImplementation" class="pm-button primary" :disabled="saving" @click="runOperation('preparation')">发起实施准备</button></template>
              <template v-else-if="activeSection === 'exceptions'"><section v-if="exceptionFlow.length" class="pm-panel pm-approval-panel"><header><div><p class="pm-panel-kicker">REVIEW FLOW</p><h2>异常处置流程 · {{ selectedDeviation?.payload?.deviation_id || '—' }}</h2></div><span>{{ pendingDeviations.length }} 项待评审</span></header><div class="pm-approval"><template v-for="(step, index) in exceptionFlow" :key="step.title"><div class="pm-approval-step" :class="step.state"><span class="pm-approval-dot">{{ step.state === 'done' ? '✓' : step.state === 'doing' ? '!' : '○' }}</span><div class="pm-approval-body"><b>{{ step.title }}</b><small>{{ step.when }}</small><em>{{ step.note }}</em></div></div><span v-if="index < exceptionFlow.length - 1" class="pm-approval-arrow">→</span></template></div></section><label><span>偏离描述</span><textarea v-model.trim="operationForm.deviationDescription" rows="3" placeholder="选择服务项后填写偏离内容"></textarea></label><label><span>严重度</span><select v-model="operationForm.severity"><option value="LOW">低</option><option value="MEDIUM">中</option><option value="HIGH">高</option></select></label><button v-if="canReportDeviation" class="pm-button primary" :disabled="saving" @click="runOperation('exception-report')">上报偏离</button><label><span>评审偏离 ID</span><input v-model.trim="operationForm.deviationID" placeholder="DV-..." /></label><label><span>评审决定</span><select v-model="operationForm.decision"><option value="RELEASE">放行</option><option value="RETEST">重测</option><option value="TERMINATE">终止</option></select></label><button v-if="canReviewDeviation" class="pm-button" :disabled="saving" @click="runOperation('exception-review')">提交偏离评审</button></template>
              <template v-else-if="activeSection === 'reports'"><section class="pm-panel pm-stepper-panel"><header><div><p class="pm-panel-kicker">REPORT PHASE</p><h2>报告阶段链</h2></div><span v-if="selectedServiceItem" class="pm-op-current">当前：<span class="pm-badge" :class="statusTone(reportStatusLabel[selectedServiceItem.report_status] || '未开始')">{{ reportStatusLabel[selectedServiceItem.report_status] || '未开始' }}</span></span></header><div class="pm-stepper"><template v-for="(step, index) in reportSteps" :key="step.phase"><div class="pm-step" :class="step.state"><span class="pm-step-num">{{ step.state === 'done' ? '✓' : index + 1 }}</span><span>{{ step.label }}</span></div><div v-if="index < reportSteps.length - 1" class="pm-step-line"></div></template></div></section><div class="pm-report-phase" v-if="item && item.report_status"><span>当前报告阶段</span><b class="pm-badge" :class="statusTone(reportStatusLabel[item.report_status] || item.report_status)">{{ reportStatusLabel[item.report_status] || item.report_status }}</b></div><button v-if="item && reportPhaseNext[item.report_status] && canAdvanceReportPhase(reportPhaseNext[item.report_status])" class="pm-button primary" :disabled="saving" @click="runOperation('report-next')">推进至{{ reportStatusLabel[reportPhaseNext[item.report_status]] }}</button><button v-if="canCompleteField" class="pm-button" :disabled="saving" @click="runOperation('complete')">确认现场实施完成</button></template>
            </div><div v-else class="pm-empty-mini">请先选择服务项</div>
          </section>
          <section v-if="activeSection === 'methods'" class="pm-table-panel">
            <header><div><p class="pm-panel-kicker">REVIEW HISTORY</p><h2>复核历史</h2></div><span>{{ methodHistory.length }} 条复核记录</span></header>
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>服务项</th><th>结论</th><th>复核意见</th><th>复核人</th><th>复核时间</th></tr></thead><tbody><tr v-for="event in methodHistory" :key="event.id"><td class="mono"><b>{{ event.service_item_id }}</b></td><td><span class="pm-badge" :class="event.payload?.decision === 'APPROVED' ? 'normal' : '风险'">{{ event.payload?.decision === 'APPROVED' ? '通过复核' : '已驳回' }}</span></td><td>{{ event.payload?.comment || '—' }}</td><td>{{ personLabel(event.actor_user_id, '—') }}</td><td>{{ formatDateTime(event.created_at) }}</td></tr><tr v-if="!methodHistory.length"><td colspan="5" class="pm-empty-mini">暂无特殊方法复核记录</td></tr></tbody></table></div>
          </section>
          <section class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>事项 / 项目</th><th>内容摘要</th><th>负责人 / 归属</th><th>状态</th><th>完成度</th><th>时限</th><th></th></tr></thead><tbody><tr v-for="row in operationRows" :key="row.name"><td><b>{{ row.name }}</b></td><td><template v-if="Array.isArray(row.detail)"><span v-if="!row.detail.length">—</span><span v-else class="pm-code-pills"><span v-for="code in row.detail" :key="code" class="pm-code-pill">{{ code }}</span></span></template><template v-else>{{ row.detail }}</template><span v-if="row.warning" class="pm-cell-warning">{{ row.warning }}</span></td><td>{{ row.owner }}</td><td><span class="pm-badge" :class="statusTone(row.state)">{{ row.state }}</span></td><td><div class="pm-inline-progress"><i :style="{ width: `${row.progress}%` }"></i></div><small>{{ row.progress }}%</small></td><td>{{ row.due }}</td><td style="width: 90px; min-width: 90px;"><button class="pm-link" @click="openOperationDetail(row)">查看详情</button></td></tr></tbody></table></div><div v-if="!operationRows.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无数据</b><span>当前页面尚无待处理事项</span></div></section>
        </template>
      </div>
    </main>

    <div v-if="operationDetail" class="pm-overlay" @click.self="operationDetail = null"><aside class="pm-drawer"><header><div><span>{{ operationSectionLabel(operationDetail.section) }}</span><h2>{{ operationDetail.row.name }}</h2></div><button class="pm-icon-button" aria-label="关闭" @click="operationDetail = null"><ConsoleIcon name="close" /></button></header><div class="pm-drawer-body"><section class="pm-drawer-hero"><span class="pm-badge neutral">{{ operationDetail.row.state }}</span><p><template v-if="Array.isArray(operationDetail.row.detail)"><span v-if="!operationDetail.row.detail.length">—</span><span v-else class="pm-code-pills"><span v-for="code in operationDetail.row.detail" :key="code" class="pm-code-pill">{{ code }}</span></span></template><template v-else>{{ operationDetail.row.detail }}</template><span v-if="operationDetail.row.warning" class="pm-cell-warning">{{ operationDetail.row.warning }}</span></p><div class="pm-progress"><i :style="{ width: `${operationDetail.row.progress}%` }"></i></div><b>{{ operationDetail.row.progress }}% 已完成</b></section><dl><div v-for="field in operationDetailFields" :key="field.label"><dt>{{ field.label }}</dt><dd><template v-if="Array.isArray(field.value)"><span v-if="!field.value.length">—</span><span v-else class="pm-code-pills"><span v-for="code in field.value" :key="code" class="pm-code-pill">{{ code }}</span></span></template><template v-else>{{ field.value }}</template></dd></div></dl></div><footer><button class="pm-button" @click="operationDetail = null">关闭</button></footer></aside></div>

    <div v-if="planEquipmentPickerOpen" class="pm-overlay" @click.self="planEquipmentPickerOpen = false"><aside class="pm-dialog pm-dialog-wide"><header><div><span>EQUIPMENT</span><h2>添加设备</h2><small class="pm-dialog-sub">只列设备目录中的有效设备；已被其他服务项占用、仅在公司使用或不在公司的设备不可选取。</small></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="planEquipmentPickerOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-dialog-body"><div class="pm-picker-search"><ConsoleIcon name="search" /><input v-model.trim="equipmentPickerKeyword" placeholder="搜索设备名称或能力码" /></div><div class="pm-table-scroll"><table class="pm-table pm-table-picker"><thead><tr><th>设备</th><th>能力码</th><th>检定有效期</th><th>状态</th><th class="pm-col-action">操作</th></tr></thead><tbody><tr v-for="item in planEquipmentFiltered" :key="item.resource_id"><td><b>{{ item.resource_name }}</b><small class="mono">{{ item.resource_id }}</small><small v-if="equipmentUnavailableReason(item)" class="pm-cell-sub pm-cell-danger">{{ equipmentUnavailableReason(item) }}</small></td><td><span v-if="!(item.codes || []).length">—</span><span v-else class="pm-code-pills"><span v-for="code in item.codes" :key="code" class="pm-code-pill">{{ code }}</span></span></td><td>{{ item.valid_until ? item.valid_until.slice(0, 10) : '长期' }}</td><td><span class="pm-badge" :class="equipmentPickerState(item).tone">{{ equipmentPickerState(item).label }}</span></td><td><button type="button" class="pm-link" :disabled="equipmentPickerState(item).disabled" @click="addPlanEquipment(item)">{{ equipmentPickerState(item).action }}</button></td></tr><tr v-if="!planEquipmentFiltered.length"><td colspan="5" class="pm-empty-mini">{{ equipmentPickerKeyword ? '没有匹配的设备，换个关键字试试' : '设备目录为空，请先在「资质与能力」或「设备能力维护」中登记设备' }}</td></tr></tbody></table></div></div><footer><span class="pm-dialog-footnote">已加入 {{ planEquipmentAddedCount }} 台 · 可选 {{ planEquipmentAddableCount }} 台</span><button type="button" class="pm-button" @click="planEquipmentPickerOpen = false">关闭</button></footer></aside></div>
<div v-if="createOpen" class="pm-overlay" @click.self="createOpen = false"><form class="pm-dialog" @submit.prevent="saveCreate"><header><div><span>CREATE</span><h2>新建项目</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="createOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>名称 <em>*</em></span><input v-model.trim="createForm.name" required placeholder="请输入项目名称" /></label><template v-if="activeSection === 'projects'"><label><span>已审批合同 <em>*</em></span><select v-model="createForm.contractID" required @change="selectApprovedContract(approvedContracts.find((item) => item.id === createForm.contractID))"><option value="">请选择已通过审批的合同</option><option v-for="contract in approvedContracts" :key="contract.id" :value="contract.id">{{ contract.contract_number }} · {{ contract.title }} · {{ contract.customer_name || '未填写客户' }}</option></select></label><label><span>客户</span><input v-model.trim="createForm.customer" readonly /></label><label><span>合同编号</span><input v-model.trim="createForm.contract" readonly /></label><label><span>实施场所 <em>*</em></span><input v-model.trim="createForm.site" required placeholder="例如 杭州机房" /></label><label><span>技术要求</span><input v-model.trim="createForm.requirement" placeholder="请输入服务项技术要求" /></label><label><span>测试模式</span><select v-model="createForm.testMode"><option value="STANDARD">标准方法</option><option value="PENETRATION">渗透测试</option></select></label><section class="pm-service-links"><header><div><b>关联服务项</b><small>系统名称、系统等级、检测类别均为非必填</small></div><button type="button" class="pm-link" @click="addServiceLink">＋ 增加一行</button></header><div v-for="(link, index) in createForm.serviceLinks" :key="index" class="pm-service-link-row"><input v-model.trim="link.system" placeholder="系统名称" /><input v-model.trim="link.systemLevel" placeholder="系统等级" /><input v-model.trim="link.category" placeholder="检测类别" /><button type="button" class="pm-icon-button" :aria-label="`删除第 ${index + 1} 行`" @click="removeServiceLink(index)">×</button></div></section></template><label><span>备注</span><textarea v-model.trim="createForm.notes" rows="4" placeholder="补充说明（选填）"></textarea></label></div><footer><button type="button" class="pm-button" @click="createOpen = false">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></footer></form></div>

    <div v-if="adjustOpen" class="pm-overlay" @click.self="adjustOpen = false"><form class="pm-dialog pm-dialog-wide" @submit.prevent="submitDecompositionAdjust"><header><div><span>ADJUST</span><h2>调整拆解</h2><small class="pm-dialog-sub">提交后该项目的全部服务项会被这份清单替换并进入补充协议处理中；原服务项转为归档保留历史。</small></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="adjustOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>调整原因 <em>*</em></span><input v-model.trim="adjustForm.reason" required placeholder="例如 客户追加两个系统" /></label><label><span>补充协议编号 <em>*</em></span><input v-model.trim="adjustForm.supplementContractID" required placeholder="例如 SC-2026-0007" /></label><section class="pm-service-links"><header><div><b>新的服务项清单</b><small>提交后该项目的全部服务项会被这份清单替换，并进入补充协议处理中</small></div><button type="button" class="pm-link" @click="addAdjustItem">＋ 增加一行</button></header><div v-for="(row, index) in adjustForm.items" :key="index" class="pm-adjust-item"><div class="pm-service-link-row"><input v-model.trim="row.batch" required placeholder="批次" /><input v-model.trim="row.site" required placeholder="场所" /><input v-model.trim="row.category" required placeholder="检测类别" /><button type="button" class="pm-icon-button" :aria-label="`删除第 ${index + 1} 行`" @click="removeAdjustItem(index)">×</button></div><div class="pm-service-link-row"><input v-model.trim="row.system" placeholder="系统名称" /><input v-model.trim="row.systemLevel" placeholder="系统等级" /><input v-model.trim="row.requirement" placeholder="技术要求" /><select v-model="row.testMode"><option value="STANDARD">标准方法</option><option value="PENETRATION">渗透测试</option></select></div></div></section></div><footer><button type="button" class="pm-button" @click="adjustOpen = false">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '提交中…' : '提交调整' }}</button></footer></form></div>

    <div v-if="configEditorOpen" class="pm-overlay" @click.self="configEditorOpen = false"><form class="pm-dialog" @submit.prevent="saveConfigRule"><header><div><span>CONFIG</span><h2>{{ configForm.id ? '编辑配置' : '新建配置' }} · {{ activeConfigMeta.label }}</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="configEditorOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>配置名称 <em>*</em></span><input v-model.trim="configForm.name" required placeholder="请输入配置名称" /></label><template v-for="field in activeConfigMeta.fields" :key="field.key"><label v-if="field.field === 'select'"><span>{{ field.label }} <em>*</em></span><select v-model="configForm[field.key]" required><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label v-else-if="field.field === 'number'"><span>{{ field.label }} <em v-if="field.required">*</em></span><input v-model.number="configForm[field.key]" type="number" :required="field.required" :min="field.min || 0" /></label><label v-else><span>{{ field.label }} <em v-if="field.required">*</em></span><input v-model.trim="configForm[field.key]" :required="field.required" :placeholder="field.placeholder || ''" /></label></template><label><span>启用</span><button type="button" class="pm-switch" :class="{ on: configForm.enabled }" :aria-label="`${configForm.enabled ? '停用' : '启用'}`" @click="configForm.enabled = !configForm.enabled"><i></i></button></label></div><footer><button type="button" class="pm-button" @click="configEditorOpen = false">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></footer></form></div>
    <Transition name="pm-toast"><div v-if="toastMessage" class="pm-toast" :class="toastType" role="status"><span>{{ toastType === 'error' ? '✕' : toastType === 'warning' ? '⚠' : toastType === 'info' ? 'ℹ' : '✓' }}</span>{{ toastMessage }}</div></Transition>
  </div>
</template>
