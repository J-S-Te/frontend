<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, logoutCurrentSession } from '@/modules/platform/auth/api/auth'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import ServiceItemPicker from '@/modules/project_management/components/ServiceItemPicker.vue'
import { subsystemAccessMessage } from '@/modules/shared/authz/sessionCompatibility'
import { closeSubsystemTabOrFallback } from '@/modules/shared/utils/returnToPortal'
import {
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
  listEquipment,
  upsertEquipment,
  listDeliveryEvents,
  listRules,
  listServiceItems,
  listPersonnel,
  listEquipmentReservations,
  returnServiceItemEquipment,
  resolvePersonnelNames,
  assignTeam,
  assignExecutionTeam,
  planImplementation,
  startImplementationPreparation,
  fieldCheckIn,
  submitFieldRecord,
  reportDeviation,
  reviewDeviation,
  completeFieldImplementation,
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
  decomposition: ['服务项拆解确认', '核对合同范围与自动拆解结果，确认后进入任务分配'],
  allocation: ['任务分配', '按团队负载与专业能力完成服务项下达'],
  inbox: ['分配待办收件箱', '处理指派给我的项目与服务项'],
  planning: ['现场实施计划制定', '编排现场窗口、里程碑及交付节奏'],
  preparation: ['实施准备', '集中核验授权、资料、工具与出行准备'],
  qualifications: ['资质与能力管理', '维护人员资质、能力标签和有效期'],
  equipment: ['设备能力维护', '新增、停用、检定和更新设备基础信息'],
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
const visibleNavGroups = computed(() => {
  const allowed = new Set(navigation.value.sections)
  return allNavGroups.map((group) => ({ ...group, items: group.items.filter((item) => allowed.has(item.key)) })).filter((group) => group.items.length)
})
const currentMeta = computed(() => pageMeta[activeSection.value])
const mobileMenuOpen = ref(false)
const keyword = ref('')
const statusFilter = ref('')
const categoryFilter = ref('')
const teamFilter = ref('')
const selectedRows = ref([])
const drawerProject = ref(null)
const createOpen = ref(false)
const notificationOpen = ref(false)
const toastMessage = ref('')
const isLoggingOut = ref(false)
const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
const emptyServiceLink = () => ({ system: '', systemLevel: '', category: '' })
const createForm = ref({ name: '', customer: '', contract: '', contractID: '', contractVersion: '', site: '', requirement: '', testMode: 'STANDARD', serviceLinks: [emptyServiceLink()], scope: '', trigger: '', notes: '' })
const approvedContracts = ref([])
const equipment = ref([])
const equipmentError = ref('')
const equipmentForm = ref({ resourceID: '', resourceName: '', codes: '', validFrom: '', validUntil: '', status: 'ACTIVE', usageScope: 'ANY' })
const dashboard = ref({ project_count: 0, in_flight_projects: 0, risk_projects: 0, service_items: 0, status_counts: {} })
const session = ref(null)
const lastUpdatedAt = ref(null)
let toastTimer = 0

// 项目状态节点必须与服务端 domain.ProjectStatusNodes 完全一致。
// 服务端按服务项派生唯一状态，前端只做展示，不得再自行拼装状态集合。
const projectStatusNodes = ['待拆解确认', '待分配', '待制定计划', '待实施', '实施准备中', '实施中', '异常处理中', '现场实施完成', '报告编制', '已完成']
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
const completedDeliveryEvents = computed(() => deliveryEvents.value.filter((event) => event.type === 'FIELD_IMPLEMENTATION_COMPLETED'))
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
const serviceFlowTone = (key) => (['待实施', '实施中', '报告编制', '已完成'].includes(key) ? 'normal' : 'neutral')
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
const filteredCapabilities = computed(() => capabilities.value.filter((item) => (!capabilityTypeFilter.value || item.resource_type === capabilityTypeFilter.value) && (!capabilityStatusFilter.value || item.status === capabilityStatusFilter.value)))
const canManageResource = computed(() => Array.isArray(session.value?.permissions) && session.value.permissions.includes('project.resource.manage'))
const selectedServiceItemIDs = ref([])
const operationForm = ref({ teamLeadID: '', projectManagerID: '', engineerIDs: '', plannedStart: '', plannedEnd: '', sitePlan: '', penetrationTestPlan: '', authDocNo: '', authStart: '', authEnd: '', authScope: '', testScope: '', testWindow: '', emergencyContact: '', rollbackPlan: '', reviewComment: '', personnel: [], equipment: [], equipmentRequestID: '', travelRequestID: '', latitude: '', longitude: '', rawData: '', environment: '', deviationDescription: '', severity: 'MEDIUM', decision: 'RELEASE', comment: '' })

// 五套真实配置表的列与编辑字段元数据。
const configKindsMeta = [
  { kind: 'split-rules', label: '拆解规则', columns: [{ key: 'scope', label: '适用范围' }], fields: [{ key: 'scope', label: '适用范围', field: 'text', required: true, placeholder: '例如 单批次金额超过 50 万元' }] },
  { kind: 'warning-rules', label: '预警规则', columns: [{ key: 'check_type', label: '检查类型' }, { key: 'threshold', label: '阈值' }], fields: [{ key: 'check_type', label: '检查类型', field: 'text', required: true, placeholder: '例如 资质能力冲突 / 排期冲突 / 场地冲突' }, { key: 'threshold', label: '阈值', field: 'text', placeholder: '例如 连续 3 项冲突' }] },
  { kind: 'automations', label: '自动化动作', columns: [{ key: 'trigger', label: '触发事件' }, { key: 'target', label: '目标' }], fields: [{ key: 'trigger', label: '触发事件', field: 'text', required: true, placeholder: '例如 DEVIATION_REPORTED' }, { key: 'target', label: '目标', field: 'text', required: true, placeholder: '例如 通知技术总监 / 创建整改工单' }] },
  { kind: 'permissions', label: '字段级权限', columns: [{ key: 'role_code', label: '角色' }, { key: 'field_name', label: '字段' }, { key: 'access_level', label: '访问级别' }], fields: [{ key: 'role_code', label: '角色', field: 'text', required: true, placeholder: '例如 project_manager' }, { key: 'field_name', label: '字段', field: 'text', required: true, placeholder: '例如 report_revenue' }, { key: 'access_level', label: '访问级别', field: 'select', required: true, options: [{ value: 'view', label: '只读可见' }, { value: 'edit', label: '可编辑' }, { value: 'hidden', label: '隐藏' }] }] },
  { kind: 'sla', label: 'SLA 规则', columns: [{ key: 'status', label: '状态' }, { key: 'deadline_hours', label: '时限(小时)' }, { key: 'remind_hours', label: '提醒(小时)' }], fields: [{ key: 'status', label: '生效状态', field: 'text', required: true, placeholder: '例如 报告编制' }, { key: 'deadline_hours', label: '时限(小时)', field: 'number', required: true, min: 1 }, { key: 'remind_hours', label: '提前提醒(小时)', field: 'number', min: 0 }] },
]
const activeConfigMeta = computed(() => configKindsMeta.find((meta) => meta.kind === activeSection.value) || configKindsMeta[0])
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
    if (!payload.name) { showToast('请填写配置名称'); return }
    const saved = configForm.value.id ? await updateRule(configForm.value.id, payload) : await createRule(payload)
    const index = rules.value.findIndex((rule) => rule.id === saved.id)
    if (index >= 0) rules.value.splice(index, 1, saved)
    else rules.value.push(saved)
    configEditorOpen.value = false
    showToast(configForm.value.id ? '配置已保存' : '配置已创建')
  } catch (error) { showToast(error?.message || '配置保存失败') }
  finally { saving.value = false }
}

const reportStatusLabel = { COMPILING: '编制中', REVIEWED: '已审核', ISSUED: '已签发', ARCHIVED: '已归档' }
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
// 服务端在"发布实施计划"时强校验前置状态。这里提前把"还差哪一步"说清楚并禁用主按钮，
// 避免用户填完整张表单才被拒绝（规范原则④：不允许「点了才报错」，且必须给可执行替代方案）。
// tone 按规范 §2.5 取色：能力冲突=red，其余"待处理"=amber。
const planningBlocked = computed(() => {
  const item = selectedServiceItem.value
  if (!item) return null
  if (!['待分配', '待制定计划'].includes(item.status)) {
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
  { key: '待实施', color: 'violet', count: serviceItems.value.filter((item) => ['待制定计划', '待实施', '实施准备中'].includes(item.status)).length, route: 'planning' },
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
  { key: '待实施', color: 'violet', statuses: ['待制定计划', '待实施', '实施准备中'] },
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
  preparation: deliveryEvents.value.filter((e) => e.type === 'PREPARATION_STARTED').map((e) => ({ id: e.id, name: e.service_item_id, detail: `设备申领 ${e.payload.equipment_request_id} / 行程 ${e.payload.travel_request_id}`, owner: personLabel(e.actor_user_id, '—'), state: '准备中', progress: 50, due: new Date(e.created_at).toLocaleDateString() })),
  qualifications: capabilities.value.map((c) => ({ id: c.resource_id, name: c.resource_name, detail: c.codes.join(' / '), owner: c.resource_type === 'PERSON' ? '人员资质' : '设备能力', state: c.status === 'ACTIVE' ? '有效' : c.status, progress: c.status === 'ACTIVE' ? 100 : 0, due: c.valid_until?.slice(0, 10) || '长期' })),
  assignments: serviceItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.site}`, detail: `${s.engineer_ids?.length || 0} 人 / ${(s.implementation_plan?.equipment || []).length} 台设备`, owner: personLabel(s.project_manager_id), state: s.conflict_status === 'CONFLICT' ? '排期冲突' : s.conflict_status === 'PASSED' ? '校验通过' : '待校验', progress: s.conflict_status === 'PASSED' ? 100 : 30, due: s.planned_end?.slice(0, 10) || '待排期' })),
  methods: serviceItems.value.filter((s) => s.special === '是').map((s) => ({ id: s.id, name: `${s.id} · ${s.category}`, detail: `${s.site} / ${s.system || '—'}`, owner: personLabel(s.project_manager_id), state: reportTechReviewLabel(s.tech_review_status), progress: s.tech_review_status === 'APPROVED' ? 100 : s.tech_review_status === 'PENDING' ? 50 : 0, due: s.planned_end?.slice(0, 10) || '待排期', review: s.tech_review_status, comment: s.tech_review_comment, reviewedAt: s.tech_reviewed_at })),
  exceptions: pendingDeviations.value.map((e) => ({ id: e.id, name: `${e.payload?.deviation_id} · ${e.service_item_id}`, detail: e.payload?.description || '现场偏离', owner: personLabel(e.actor_user_id, '—'), state: '待评审', progress: 0, due: formatDateTime(e.created_at) })),
  standards: [],
  reports: reportItems.value.map((item) => { const project = projectByID.value.get(item.project_id); return { id: item.id, name: `${item.id} · ${item.site}`, detail: `${project?.customer || item.project_id} / 报告${reportStatusLabel[item.report_status] || item.report_status}`, owner: personLabel(item.project_manager_id, project?.manager || '待指派'), state: reportStatusLabel[item.report_status] || item.report_status, progress: (reportStatusRank[item.report_status] || 0) * 25, due: item.report_updated_at ? item.report_updated_at.slice(0, 10) : item.planned_end?.slice(0, 10) || '待排期', report_status: item.report_status } }),
}[activeSection.value] || []))

const rules = ref([])
const visibleRules = computed(() => rules.value.filter((rule) => rule.kind === activeSection.value))

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
      { label: '设备申领单', value: payload.equipment_request_id || '—' },
      { label: '行程预订单', value: payload.travel_request_id || '—' },
      { label: '操作人', value: record.actor_user_id || '—' },
      { label: '发起时间', value: record.created_at ? formatDateTime(record.created_at) : '—' },
    ]
  }
  if (section === 'qualifications') {
    return [
      { label: '资源类型', value: record.resource_type === 'PERSON' ? '人员资质' : '设备能力' },
      { label: '资源名称', value: record.resource_name || '-—' },
      { label: '能力编码', value: (record.codes || []).join('、') || '—' },
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
    if (!allowed.has(route.params.section)) {
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
    if (!approvedContracts.value.length) { showToast('当前没有已通过审批的可用合同'); return }
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
    showToast(error?.message || '读取已审批合同失败')
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
  if (!serviceItemID) { showToast('未找到借出该设备的服务项，请刷新后重试'); return }
  saving.value = true
  try {
    await returnServiceItemEquipment(serviceItemID, item.resource_id)
    showToast(`设备 ${item.resource_name} 已归还`)
    await Promise.all([loadEquipment(), loadEquipmentReservations(selectedServiceItem.value)])
  } catch (error) { showToast(error?.message || '归还失败，请稍后重试') }
  finally { saving.value = false }
}
async function saveEquipment() {
  saving.value = true
  try {
    const item = await upsertEquipment({ resource_id: equipmentForm.value.resourceID, resource_name: equipmentForm.value.resourceName, codes: selectedIDs(equipmentForm.value.codes), valid_from: equipmentForm.value.validFrom ? new Date(equipmentForm.value.validFrom).toISOString() : '', valid_until: equipmentForm.value.validUntil ? new Date(equipmentForm.value.validUntil).toISOString() : '', status: equipmentForm.value.status, usage_scope: equipmentForm.value.usageScope })
    equipment.value = [item, ...equipment.value.filter((row) => row.resource_id !== item.resource_id)]
    showToast('设备信息已保存')
  } catch (error) { showToast(error?.message || '设备信息保存失败') }
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
    ? { resource_type: item.resource_type, resource_id: item.resource_id, resource_name: item.resource_name, codes: (item.codes || []).join(','), valid_from: item.valid_from?.slice(0, 10) || '', valid_until: item.valid_until?.slice(0, 10) || '', status: item.status || 'ACTIVE' }
    : { resource_type: 'PERSON', resource_id: nextResourceID('PERSON'), resource_name: '', codes: '', valid_from: '', valid_until: '', status: 'ACTIVE' }
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
    })
    capabilities.value = [saved, ...capabilities.value.filter((row) => !(row.resource_type === saved.resource_type && row.resource_id === saved.resource_id))]
    capabilityDialog.value = null
    showToast('资质 / 能力已保存')
  } catch (error) { showToast(error?.message || '资质保存失败') }
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
  } catch (error) { showToast(error?.message || 'CSV 导入失败') }
  finally { saving.value = false }
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
  } catch (error) { showToast(error?.message || 'CSV 导出失败') }
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
    showToast(error?.message || '退出系统失败，请稍后重试。')
  } finally {
    isLoggingOut.value = false
  }
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
    const updated = await setRuleEnabled(rule.id, rule.kind || activeSection.value, next)
    Object.assign(rule, updated)
    showToast(next ? '规则已启用' : '规则已停用')
  } catch (error) { showToast(error?.message || '规则更新失败') }
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
  return (capability?.codes || []).join(' / ')
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
const planEquipmentOptions = computed(() => equipment.value.filter((item) => item.status !== 'DISABLED'))
const planEquipmentPickable = computed(() => {
  const used = new Set(operationForm.value.equipment.map((row) => row.resourceID))
  return planEquipmentOptions.value.filter((item) => !used.has(item.resource_id) && !equipmentUnavailableReason(item))
})
function addPlanEquipment(equipmentItem) {
  if (!equipmentItem) return
  if (equipmentUnavailableReason(equipmentItem)) return
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
      if (!form.plannedStart || !form.plannedEnd) { showToast('请填写计划开始与计划结束时间'); return }
      if (new Date(form.plannedEnd).getTime() <= new Date(form.plannedStart).getTime()) { showToast('计划结束时间必须晚于计划开始时间'); return }
      if (!String(form.sitePlan || '').trim()) { showToast('请填写现场计划'); return }
      const personRows = form.personnel
      if (!personRows.length) { showToast('请至少添加一名实施人员'); return }
      const windowProblem = form.personnel.find((row) => (row.windowStart && !row.windowEnd) || (!row.windowStart && row.windowEnd) || (row.windowStart && row.windowEnd && new Date(row.windowEnd) < new Date(row.windowStart)))
      if (windowProblem) { showToast(`「${planResourceName(windowProblem)}」的使用时段不完整或结束早于开始`); return }
      if (selectedServiceItem.value?.test_mode === 'PENETRATION') {
        const compliance = [
          [form.penetrationTestPlan, '渗透测试专项计划'], [form.authDocNo, '授权书编号'],
          [form.authScope, '授权范围'], [form.testScope, '计划测试范围'], [form.testWindow, '测试时间窗'],
          [form.emergencyContact, '应急联系人'], [form.rollbackPlan, '回滚方案'],
        ].filter(([value]) => !String(value || '').trim()).map(([, label]) => label)
        if (compliance.length) { showToast(`请补充渗透测试专项合规要素：${compliance.join('、')}`); return }
        if (!form.authStart || !form.authEnd) { showToast('请填写授权生效与授权截止时间'); return }
        if (new Date(form.authEnd).getTime() <= new Date(form.authStart).getTime()) { showToast('授权截止时间必须晚于授权生效时间'); return }
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
      if (!form.equipment.length) { showToast('请至少选择一台实施设备'); return }
      const equipmentWindowProblem = form.equipment.find((row) => (row.windowStart && !row.windowEnd) || (!row.windowStart && row.windowEnd) || (row.windowStart && row.windowEnd && new Date(row.windowEnd) < new Date(row.windowStart)))
      if (equipmentWindowProblem) { showToast(`「${planResourceName(equipmentWindowProblem)}」的使用时段不完整或结束早于开始`); return }
      await startImplementationPreparation(item.id, { equipment_request_id: form.equipmentRequestID, travel_request_id: form.travelRequestID, notes: form.comment, equipment: form.equipment.map((row) => ({ resource_type: 'EQUIPMENT', resource_id: row.resourceID, window_start: row.windowStart, window_end: row.windowEnd, note: row.note })) })
      showToast('实施准备已发起')
    } else if (kind === 'field') {
      await fieldCheckIn(item.id, { latitude: Number(form.latitude), longitude: Number(form.longitude), occurred_at: new Date().toISOString() })
      await submitFieldRecord(item.id, { raw_data: form.rawData, environment: form.environment, evidence_urls: [] })
      showToast('签到和现场记录已提交')
    } else if (kind === 'exception-report') {
      const result = await reportDeviation(item.id, { description: form.deviationDescription, severity: form.severity, evidence_url: '' })
      showToast(`偏离已上报：${result.deviation_id || '待评审'}`)
    } else if (kind === 'exception-review') {
      await reviewDeviation(form.deviationID, { decision: form.decision, comment: form.comment })
      showToast('偏离评审已完成')
    } else if (kind === 'complete') {
      const project = projectByID.value.get(item.project_id)
      await completeFieldImplementation(project?.id || item.project_id)
      showToast('现场实施已完成')
    }
    await loadWorkspace()
  } catch (error) { showToast(error?.message || '操作失败') }
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
        <div class="pm-breadcrumb"><span>项目服务管理</span><b>/</b><strong>{{ currentMeta[0] }}</strong></div>
        <div class="pm-top-tools">
          <button class="pm-icon-button" aria-label="全局搜索" @click="showToast('全局搜索即将开放')"><ConsoleIcon name="search" /></button>
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
            <button v-if="['split-rules', 'warning-rules', 'automations', 'permissions', 'sla'].includes(activeSection)" class="pm-button primary" @click="openConfigCreate">＋ 新建规则</button><button v-if="activeSection === 'projects' && canCreateProject" class="pm-button primary" @click="openCreateProject">＋ 新建项目</button>
            <button v-if="activeSection === 'decomposition'" class="pm-button primary" :disabled="saving" @click="confirmDecomposition">{{ saving ? '提交中…' : '确认拆解' }}</button>
          </div>
        </section>

        <section v-if="loadError" class="pm-empty">
          <ConsoleIcon name="info" /><b>后端数据加载失败</b><span>{{ loadError }}</span><button class="pm-button" @click="loadWorkspace">重新加载</button>
        </section>

        <section v-if="['decomposition', 'allocation'].includes(activeSection) && missingStampedContractCount" class="pm-contract-warning"><ConsoleIcon name="info" /><div><b>{{ missingStampedContractCount }} 份合同尚未上传盖章合同</b><p>{{ activeSection === 'decomposition' ? '合同审批已完成，可继续核对并确认服务项拆解；该提示不阻断拆解确认。' : '服务项拆解已确认，可继续分配团队、人员及设备；上传盖章合同后提示将自动清除。' }}</p></div></section>

        <template v-if="activeSection === 'dashboard'">
          <section class="pm-kpis">
            <button type="button" class="pm-kpi blue" @click="navigate('projects')"><div class="pm-kpi-label"><span>全部项目</span><em>实时</em></div><strong class="pm-kpi-value">{{ dashboard.project_count }}<small>个</small></strong><p class="pm-kpi-note"><span>{{ dashboard.in_flight_projects }} 个在途项目</span></p></button>
            <button type="button" class="pm-kpi cyan" @click="navigate('decomposition')"><div class="pm-kpi-label"><span>全部服务项</span><em>合同拆解</em></div><strong class="pm-kpi-value">{{ dashboard.service_items }}<small>项</small></strong><p class="pm-kpi-note"><span>{{ decompositionItems.length }} 项待确认 · 需业务管理员处理</span></p></button>
            <button type="button" class="pm-kpi amber" @click="navigate('allocation')"><div class="pm-kpi-label"><span>资源分配待办</span><em>待处理</em></div><strong class="pm-kpi-value">{{ serviceFlow[0].count }}<small>项</small></strong><p class="pm-kpi-note"><span>{{ inboxItems.length }} 项已下达待完善</span></p></button>
            <button type="button" class="pm-kpi violet" @click="navigate('exceptions')"><div class="pm-kpi-label"><span>风险项目 / 异常</span><em>实时</em></div><strong class="pm-kpi-value">{{ dashboard.risk_projects }}<small>项</small></strong><p class="pm-kpi-note"><span>{{ pendingDeviations.length }} 项偏离待评审</span></p></button>
          </section>
          <section class="pm-dashboard-grid">
            <article class="pm-panel pm-status-panel">
              <header><div><p class="pm-panel-kicker">SERVICE FLOW</p><h2>服务项状态分布</h2></div><span>总计 <b>{{ serviceItems.length }}</b> 项</span></header>
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>状态</th><th class="num">数量</th><th>占比</th><th></th></tr></thead><tbody><tr v-for="flow in serviceFlow" :key="flow.key" @click="navigate(flow.route)"><td><span class="pm-badge" :class="serviceFlowTone(flow.key)">{{ flow.key }}</span></td><td class="num">{{ flow.count }}</td><td><div class="pm-bar-bg"><i class="pm-bar-fill" :class="flow.color" :style="{ width: `${serviceItems.length ? (flow.count * 100 / serviceItems.length).toFixed(1) : 0}%` }"></i></div><small>{{ serviceItems.length ? (flow.count * 100 / serviceItems.length).toFixed(1) : '0.0' }}%</small></td><td><button class="pm-link">查看 →</button></td></tr><tr v-if="!serviceFlow.length"><td colspan="4" class="pm-empty-mini">暂无服务项数据</td></tr></tbody></table></div>
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
          <section class="pm-summary-strip">
            <button type="button" @click="statusFilter = ''"><span>全部项目</span><b>{{ projects.length }}</b><em>当前租户 · 实时</em></button>
            <button type="button" @click="statusFilter = '待拆解确认'"><span>待拆解确认</span><b>{{ pendingDecompositionCount }}</b><em>需业务管理员处理</em></button>
            <button type="button" @click="statusFilter = ''"><span>在途项目</span><b>{{ inFlightProjects.length }}</b><em>含实施中 / 报告编制</em></button>
            <button type="button" @click="statusFilter = '已完成'"><span>已完成</span><b>{{ doneProjectCount }}</b><em>已完成交付</em></button>
            <button type="button" class="danger" @click="navigate('monitoring')"><span>风险项目</span><b>{{ riskProjectCount }}</b><em>含终止 / 超期</em></button>
          </section>
          <section class="pm-filters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索项目编号 / 客户名称 / 服务项" /></label><select v-model="statusFilter"><option value="">状态：全部</option><option v-for="node in projectStatusNodes" :key="node" :value="node">{{ node }}</option></select><select v-model="categoryFilter"><option value="">检测类别：全部</option><option v-for="option in categoryOptions" :key="option" :value="option">{{ option }}</option></select><select v-model="teamFilter"><option value="">团队：全部</option><option v-for="option in teamOptions" :key="option" :value="option">{{ option }}</option></select><button class="pm-button ghost" @click="resetProjectFilters">重置</button><span class="pm-filter-count">{{ filteredProjects.length }} 条结果</span></section>
          <section class="pm-table-panel">
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th></th><th>项目 / 客户</th><th>合同编号</th><th>服务项</th><th>检测类别</th><th>团队 / 项目经理</th><th>状态</th><th>交付进度</th><th>计划完成</th><th></th></tr></thead><tbody>
              <tr v-for="project in filteredProjects" :key="project.id" :class="{ selected: selectedRows.includes(project.id), risk: riskProjectStatuses.includes(project.status) }"><td><input type="checkbox" :checked="selectedRows.includes(project.id)" :aria-label="`选择 ${project.id}`" @change="toggleRow(project.id)" /></td><td><button class="pm-project-link" @click="openProject(project)"><b>{{ project.id }}</b><span>{{ project.customer }}</span></button></td><td class="mono">{{ project.contract }}</td><td>{{ project.services }}</td><td>{{ project.category }}</td><td><b>{{ project.team }}</b><span class="pm-cell-sub">{{ project.manager }}</span></td><td><span class="pm-badge neutral">{{ project.status }}</span></td><td><div class="pm-progress-cell"><div class="pm-inline-progress"><i :style="{ width: `${project.progress}%` }"></i></div><small>{{ project.progress }}%</small></div></td><td :class="{ 'pm-text-danger': project.due.includes('超期') }">{{ project.due }}</td><td><button class="pm-link" @click="openProject(project)">详情</button></td></tr>
            </tbody></table></div>
            <footer class="pm-table-footer"><span>已选择 {{ selectedRows.length }} 项 · 共 {{ filteredProjects.length }} 条</span><div class="pm-pagination"><button class="pm-pg" disabled>‹</button><button class="pm-pg active">1</button><button class="pm-pg" disabled>›</button></div></footer>
          </section>
        </template>

        <template v-else-if="activeSection === 'monitoring'">
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
            <header class="pm-monitor-head">
              <span class="pm-filter-count">共 {{ monitoredProjects.length }} 条</span>
            </header>
            <div class="pm-filters pm-filters-flat"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索项目 / 客户 / 团队" /></label><select v-model="teamFilter"><option value="">团队：全部</option><option v-for="option in teamOptions" :key="option" :value="option">{{ option }}</option></select><button class="pm-button ghost" @click="resetProjectFilters">重置</button></div>
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>项目编号</th><th>客户</th><th>服务项</th><th>团队</th><th>项目经理</th><th>状态</th><th>进度</th><th>计划完成</th><th></th></tr></thead><tbody><tr v-for="project in monitoredProjects" :key="project.id" :class="{ risk: riskProjectStatuses.includes(project.status) }"><td><button class="pm-project-link" @click="openProject(project)"><b>{{ project.id }}</b></button></td><td>{{ project.customer }}</td><td>{{ project.services }} 项</td><td>{{ project.team }}</td><td>{{ project.manager }}</td><td><span class="pm-badge neutral">{{ project.status }}</span></td><td><div class="pm-progress-cell"><div class="pm-inline-progress"><i :style="{ width: `${project.progress}%` }"></i></div><small>{{ project.progress }}%</small></div></td><td :class="{ 'pm-text-danger': project.due.includes('超期') }">{{ project.due }}</td><td><button class="pm-btn-link" @click="openProject(project)">详情</button></td></tr><tr v-if="!monitoredProjects.length"><td colspan="9" class="pm-empty-mini">暂无匹配的在途项目</td></tr></tbody></table></div>
            <footer class="pm-table-footer"><span>共 {{ monitoredProjects.length }} 个在途项目</span><div class="pm-pagination"><button class="pm-pg" disabled>‹</button><button class="pm-pg active">1</button><button class="pm-pg" disabled>›</button></div></footer>
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
          <section class="pm-kanban"><article v-for="column in kanbanColumns" :key="column.key"><header><div><i :class="column.color"></i><b>{{ column.key }}</b></div><span>{{ column.count }}</span></header><div class="pm-kanban-body"><button v-for="card in column.cards" :key="card.id" @click="openProject(card)"><b>{{ card.id }}</b><h3>{{ card.customer }}</h3><span class="pm-badge neutral">{{ card.status }}</span><div class="pm-inline-progress"><i :style="{ width: `${card.progress}%` }"></i></div><footer><span>{{ card.progress }}%</span><time>{{ card.due || '待排期' }}</time></footer></button><div v-if="!column.cards.length" class="pm-empty-mini">暂无数据</div></div></article></section>
          <section class="pm-panel pm-operation-panel"><header><div><p class="pm-panel-kicker">FIELD EXECUTION</p><h2>现场签到与原始记录</h2></div></header><ServiceItemPicker :items="serviceItems" :selected-ids="selectedServiceItem ? [selectedServiceItem.id] : []" empty-text="暂无可签到服务项" @select="selectServiceItem" /><div v-if="selectedServiceItem" class="pm-form pm-operation-form"><label><span>纬度 <em>*</em></span><input v-model.trim="operationForm.latitude" type="number" step="any" placeholder="例如 30.2741" /></label><label><span>经度 <em>*</em></span><input v-model.trim="operationForm.longitude" type="number" step="any" placeholder="例如 120.1551" /></label><label><span>现场原始数据 <em>*</em></span><textarea v-model.trim="operationForm.rawData" rows="3"></textarea></label><label><span>环境条件 <em>*</em></span><textarea v-model.trim="operationForm.environment" rows="3"></textarea></label><button class="pm-button primary" :disabled="saving" @click="runOperation('field')">提交签到和现场记录</button></div><div v-else class="pm-empty-mini">请先选择服务项</div></section>
        </template>

        <template v-else-if="activeSection === 'equipment'">
          <section class="pm-panel pm-equipment-layout"><header><div><p class="pm-panel-kicker">EQUIPMENT CAPABILITY</p><h2>设备能力维护</h2><p>维护设备基础信息、能力编码、检定有效期与启停状态。</p></div></header><form class="pm-form pm-equipment-form" @submit.prevent="saveEquipment"><label><span>设备编号 <em>*</em></span><input v-model.trim="equipmentForm.resourceID" required placeholder="例如 EQ-001" /></label><label><span>设备名称 <em>*</em></span><input v-model.trim="equipmentForm.resourceName" required placeholder="请输入设备名称" /></label><label><span>能力编码 <em>*</em></span><input v-model.trim="equipmentForm.codes" required placeholder="多个编码用逗号分隔" /></label><label><span>检定开始</span><input v-model="equipmentForm.validFrom" type="date" /></label><label><span>检定到期</span><input v-model="equipmentForm.validUntil" type="date" /></label><label><span>状态</span><select v-model="equipmentForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label><label><span>使用范围</span><select v-model="equipmentForm.usageScope"><option value="ANY">可借出</option><option value="COMPANY_ONLY">仅在公司使用（不可借出）</option></select></label><button class="pm-button primary">保存设备</button></form></section><section class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>设备编号</th><th>设备名称</th><th>能力</th><th>检定有效期</th><th>状态</th><th>在位 / 使用范围</th><th>操作</th></tr></thead><tbody><tr v-for="item in equipment" :key="item.resource_id"><td class="mono">{{ item.resource_id }}</td><td><b>{{ item.resource_name }}</b></td><td>{{ (item.codes || []).join(' / ') }}</td><td>{{ item.valid_until ? formatDateTime(item.valid_until) : '未设置' }}</td><td><span class="pm-badge" :class="item.status === 'ACTIVE' ? 'normal' : 'neutral'">{{ item.status === 'ACTIVE' ? '启用' : '停用' }}</span></td><td><span class="pm-badge" :class="item.presence === 'OUT_OF_COMPANY' ? 'warning' : 'normal'">{{ equipmentPresenceLabel(item) }}</span><small v-if="item.borrowed_by" class="pm-cell-sub">{{ item.borrowed_by }} · {{ item.borrowed_window }}</small><small v-if="item.usage_scope === 'COMPANY_ONLY'" class="pm-form-hint">仅在公司使用 · 不可借出</small></td><td><button class="pm-link" @click="editEquipment(item)">编辑 / 更新</button><button v-if="item.presence === 'OUT_OF_COMPANY'" class="pm-link danger" @click="returnEquipment(item)">归还</button></td></tr></tbody></table></div><p v-if="equipmentError" class="pm-form-hint" role="alert">{{ equipmentError }}</p><div v-else-if="!equipment.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无设备</b><span>使用上方表单新增设备。</span></div></section>
        </template>
        <template v-else-if="activeSection === 'qualifications'"><section class="pm-panel"><header><div><p class="pm-panel-kicker">RESOURCE CAPABILITY</p><h2>资质与能力管理</h2><p>维护并展示人员资质与设备能力记录。</p></div><div class="pm-panel-actions"><input ref="qualificationFileInput" class="pm-file-input" type="file" accept=".csv,text/csv" @change="importQualificationFile" /><button class="pm-button" :disabled="saving" @click="downloadCapabilities">导出 CSV</button><template v-if="canManageResource"><button class="pm-button" :disabled="saving" @click="qualificationFileInput.click()">导入 CSV</button><button class="pm-button primary" :disabled="saving" @click="openCapabilityDialog()">＋ 新建资质</button></template></div></header><div class="pm-qualification-filter"><label><span>资源类型</span><select v-model="capabilityTypeFilter"><option value="">全部</option><option value="PERSON">人员资质</option><option value="EQUIPMENT">设备能力</option></select></label><label><span>状态</span><select v-model="capabilityStatusFilter"><option value="">全部</option><option value="ACTIVE">有效</option><option value="DISABLED">停用</option></select></label></div></section><section class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>资源类型</th><th>编号</th><th>名称</th><th>资质 / 能力编码</th><th>有效期</th><th>状态</th><th></th></tr></thead><tbody><tr v-for="item in filteredCapabilities" :key="item.resource_id"><td><span class="pm-badge neutral">{{ item.resource_type === 'PERSON' ? '人员' : '设备' }}</span></td><td class="mono">{{ item.resource_id }}</td><td><b>{{ item.resource_name }}</b></td><td>{{ (item.codes || []).join(' / ') }}</td><td>{{ item.valid_until ? (item.valid_from ? `${item.valid_from.slice(0, 10)} ~ ` : '') + item.valid_until.slice(0, 10) : '长期' }}</td><td><span class="pm-badge" :class="item.status === 'ACTIVE' ? 'normal' : 'neutral'">{{ item.status === 'ACTIVE' ? '有效' : '停用' }}</span></td><td style="width: 90px; min-width: 90px;"><button class="pm-link" @click="openCapabilityDialog(item)">编辑 / 更新</button></td></tr></tbody></table></div><div v-if="!filteredCapabilities.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无资质记录</b><span>点击「＋ 新建资质」或通过 CSV 导入添加记录。</span></div><footer v-if="importResult"><span role="status">导入完成：成功 {{ importResult.imported }} 条，跳过 {{ importResult.skipped }} 条。</span><span v-if="importResult.errors?.length"><small>{{ importResult.errors.slice(0, 3).join('；') }}{{ importResult.errors.length > 3 ? '…' : '' }}</small></span></footer></section><div v-if="capabilityDialog" class="pm-overlay" @click.self="capabilityDialog = null"><form class="pm-dialog" @submit.prevent="saveCapability"><header><div><span>CAPABILITY</span><h2>{{ capabilityDialog.resource_id ? '编辑资质 / 能力' : '新建资质 / 能力' }}</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="capabilityDialog = null"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>资源类型 <em>*</em></span><select v-model="capabilityDialog.resource_type" required @change="onCapabilityTypeChange"><option value="PERSON">人员资质</option><option value="EQUIPMENT">设备能力</option></select></label><label><span>{{ capabilityDialog.resource_type === 'EQUIPMENT' ? '设备编号' : '人员编号' }} <em>*</em></span><input v-model.trim="capabilityDialog.resource_id" :readonly="capabilityAutoID" required placeholder="系统自动生成" /><small v-if="capabilityAutoID" class="pm-form-hint">由系统自动生成（人员 P- / 设备 EQ-），无需手工填写</small></label><label><span>资源名称 <em>*</em></span><input v-model.trim="capabilityDialog.resource_name" required placeholder="例如 张三 或 基站A" /></label><label><span>资质 / 能力编码 <em>*</em></span><input v-model.trim="capabilityDialog.codes" required placeholder="多个编码用逗号分隔" /></label><label><span>起始日期</span><input v-model="capabilityDialog.valid_from" type="date" /></label><label><span>截止日期</span><input v-model="capabilityDialog.valid_until" type="date" /></label><label><span>状态</span><select v-model="capabilityDialog.status"><option value="ACTIVE">有效</option><option value="DISABLED">停用</option></select></label></div><footer><button type="button" class="pm-button" @click="capabilityDialog = null">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存资质' }}</button></footer></form></div></template><template v-else-if="['split-rules', 'warning-rules', 'automations', 'permissions', 'sla'].includes(activeSection)">
          <section class="pm-config-layout"><aside class="pm-config-note"><span><ConsoleIcon name="info" /></span><h2>配置说明</h2><p>{{ currentMeta[1] }}。变更将在保存后对新任务生效，已有项目不自动追溯。</p><ul><li>配置修改需业务管理员权限</li><li>关键规则变更会记录审计日志</li><li>关闭规则前请确认影响范围</li></ul></aside><article class="pm-table-panel"><header class="pm-filter-bar"><div class="pm-sm-tabs"><button v-for="meta in configKindsMeta" :key="meta.kind" type="button" class="pm-tab-pill" :class="{ active: activeSection === meta.kind }" @click="navigate(meta.kind)">{{ meta.label }}</button></div><span class="pm-filter-count">{{ activeConfigMeta.label }} 共 {{ visibleRules.length }} 条</span></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>配置名称</th><th v-for="column in activeConfigMeta.columns" :key="column.key">{{ column.label }}</th><th>状态</th><th>最后更新</th><th></th></tr></thead><tbody><tr v-for="rule in visibleRules" :key="rule.id"><td><b>{{ rule.name }}</b></td><td v-for="column in activeConfigMeta.columns" :key="column.key">{{ rule[column.key] !== undefined && rule[column.key] !== '' ? rule[column.key] : '—' }}</td><td><button class="pm-switch" :class="{ on: rule.enabled }" :aria-label="`${rule.enabled ? '停用' : '启用'} ${rule.name}`" @click="toggleRule(rule)"><i></i></button></td><td>{{ rule.updated }}</td><td><button class="pm-link" @click="openConfigEdit(rule)">编辑</button></td></tr></tbody></table></div><div v-if="!visibleRules.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无配置规则</b><span>点击「＋ 新建规则」添加 {{ activeConfigMeta.label }} 配置。</span></div></article></section>
        </template>

        <template v-else>
          <section class="pm-operational-stats"><article><span>待处理</span><strong>{{ operationRows.length }}</strong><small>来自当前工作区</small></article><article><span>服务项总数</span><strong>{{ serviceItems.length }}</strong><small>以服务端状态为准</small></article><article><span>已完成项目</span><strong>{{ completedProjectCount }}</strong><small>当前租户累计</small></article></section>
          <section class="pm-filters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索编号、项目或负责人" /></label><span>{{ operationRows.length }} 条结果</span></section>
          <section v-if="['allocation', 'inbox', 'planning', 'preparation', 'assignments', 'methods', 'exceptions', 'reports'].includes(activeSection)" class="pm-panel pm-operation-panel">
            <header><div><p class="pm-panel-kicker">REAL OPERATION</p><h2>服务项操作台</h2></div><span v-if="selectedServiceItem">当前：{{ selectedServiceItem.id }} · {{ selectedServiceItem.status }}</span></header>
            <ServiceItemPicker v-if="activeSection === 'allocation'" :items="serviceItems" :selected-ids="selectedServiceItemIDs" multiple empty-text="暂无可分配服务项" hint="可同时选择多个服务项，批量分配团队负责人或执行团队。" @toggle="toggleServiceItem" /><ServiceItemPicker v-else :items="serviceItems" :selected-ids="selectedServiceItem ? [selectedServiceItem.id] : []" empty-text="暂无可操作服务项" @select="selectServiceItem" />
            <div v-if="selectedServiceItem" class="pm-form pm-operation-form">
              <template v-if="['allocation', 'inbox', 'assignments'].includes(activeSection)"><div class="pm-personnel-search"><label><span>查找平台人员</span><input v-model.trim="personnelKeyword" placeholder="输入姓名关键字" @keydown.enter.prevent="loadPersonnel" /></label><button type="button" class="pm-button" :disabled="personnelLoading" @click="loadPersonnel">{{ personnelLoading ? '查询中…' : '查询' }}</button></div><p v-if="personnelError" class="pm-form-hint" role="alert">{{ personnelError }}</p><label><span>团队负责人 <em>*</em></span><select v-model="operationForm.teamLeadID" :disabled="personnelLoading" required><option value="">请选择团队负责人</option><option v-for="option in teamLeadOptions" :key="option.id" :value="option.id">{{ option.name }}</option></select></label><template v-if="canExecutionAssign"><label><span>项目经理 <em>*</em></span><select v-model="operationForm.projectManagerID" :disabled="personnelLoading" required><option value="">请选择项目经理</option><option v-for="option in projectManagerOptions" :key="option.id" :value="option.id">{{ option.name }}</option></select></label><div class="pm-field"><span>工程师 <em>*</em></span><div class="pm-multi-dropdown" :class="{ open: openMulti === 'engineer' }"><button type="button" class="pm-multi-trigger" :class="{ placeholder: !engineerSelection.length }" :disabled="personnelLoading" @click.stop="toggleMulti('engineer')"><span>{{ multiSummary(engineerSelection, engineerOptions, '请选择工程师') }}</span><i class="pm-multi-caret"></i></button><div v-if="openMulti === 'engineer'" class="pm-multi-menu"><label v-for="option in engineerOptions" :key="option.id" class="pm-multi-option"><input type="checkbox" :checked="engineerSelection.includes(option.id)" @change="toggleEngineer(option.id)" /><span>{{ option.name }}</span></label><p v-if="!engineerOptions.length" class="pm-empty-mini">暂无可选人员</p></div></div></div></template><button class="pm-button primary" :disabled="saving" @click="runOperation('allocation')">{{ saving ? '提交中…' : canExecutionAssign ? '保存分配并校验能力' : '分配团队负责人' }}</button></template>
              <template v-else-if="activeSection === 'planning'"><div v-if="planningBlocked" class="pm-blocker" :class="planningBlocked.tone" role="alert"><b>暂时不能发布实施计划</b><span>{{ planningBlocked.reason }}</span><button class="pm-button" type="button" @click="navigate('allocation')">前往任务分配</button></div><label><span>计划开始 <em>*</em></span><input v-model.trim="operationForm.plannedStart" type="datetime-local" /></label><label><span>计划结束 <em>*</em></span><input v-model.trim="operationForm.plannedEnd" type="datetime-local" /></label><label><span>现场计划 <em>*</em></span><textarea v-model.trim="operationForm.sitePlan" rows="3" placeholder="现场实施步骤和窗口"></textarea></label><template v-if="selectedServiceItem.test_mode === 'PENETRATION'"><label><span>渗透测试专项计划 <em>*</em></span><textarea v-model.trim="operationForm.penetrationTestPlan" rows="3"></textarea></label><fieldset class="pm-compliant-fieldset"><legend>专项合规要素（授权 / 白名单 / 时间窗 / 应急 / 回滚）</legend><label><span>授权书编号 <em>*</em></span><input v-model.trim="operationForm.authDocNo" required placeholder="例如 AUTH-2026-001" /></label><label><span>授权生效 <em>*</em></span><input v-model.trim="operationForm.authStart" type="datetime-local" required /></label><label><span>授权截止 <em>*</em></span><input v-model.trim="operationForm.authEnd" type="datetime-local" required /></label><label><span>授权范围 <em>*</em></span><input v-model.trim="operationForm.authScope" required placeholder="例如 内网段 10.0.0.0/8" /></label><label><span>计划测试范围 <em>*</em></span><input v-model.trim="operationForm.testScope" required placeholder="例如 关键业务系统 WEB 渗透" /></label><label><span>测试时间窗 <em>*</em></span><input v-model.trim="operationForm.testWindow" required placeholder="例如 00:00-06:00" /></label><label><span>应急联系人 <em>*</em></span><input v-model.trim="operationForm.emergencyContact" required placeholder="姓名 + 电话" /></label><label><span>回滚方案 <em>*</em></span><textarea v-model.trim="operationForm.rollbackPlan" rows="3" required></textarea></label></fieldset></template><section class="pm-plan-resources"><header><div><b>实施人员</b><small>资质与有效期取自「资质与能力」档案；使用时段留空表示全程；设备清单在「实施准备」中登记</small></div></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>名称</th><th>规格 / 资质</th><th>有效期</th><th>使用时段</th><th>备注</th><th></th></tr></thead><tbody><tr v-for="(row, index) in operationForm.personnel" :key="row.resourceID"><td>{{ planResourceName(row) }}</td><td>{{ planResourceCodes(row) || '—' }}</td><td>{{ planResourceValidUntil(row) }}</td><td><div class="pm-plan-window"><input v-model="row.windowStart" type="date" aria-label="使用时段开始" /><span>~</span><input v-model="row.windowEnd" type="date" aria-label="使用时段结束" /></div></td><td><input v-model.trim="row.note" placeholder="例如 备份" /></td><td><button type="button" class="pm-link danger" @click="removePlanPersonnel(index)">移除</button></td></tr><tr v-if="!operationForm.personnel.length"><td colspan="6" class="pm-empty-mini">请至少添加一名实施人员</td></tr></tbody></table></div></section><button class="pm-button primary" :disabled="saving || !!planningBlocked" :title="planningBlocked ? planningBlocked.reason : ''" @click="runOperation('planning')">发布实施计划</button></template>
              <template v-else-if="activeSection === 'methods'"><div class="pm-review-state"><span>复核状态</span><b>{{ item && reportTechReviewLabel(item.tech_review_status) }}</b></div><template v-if="item && ['PENDING', 'REJECTED'].includes(item.tech_review_status)"><label><span>复核意见</span><textarea v-model.trim="operationForm.reviewComment" rows="3" placeholder="填写风险说明或驳回原因"></textarea></label><div class="pm-form-row"><button class="pm-button primary" :disabled="saving" @click="runOperation('special-approve')">通过复核</button><button class="pm-button" :disabled="saving" @click="runOperation('special-reject')">驳回复核</button></div></template><template v-else-if="item && item.tech_review_status === 'APPROVED'"><p class="pm-form-hint">{{ item.tech_review_comment || '已通过复核，可发布实施计划' }}<span v-if="item.tech_reviewed_at"> · {{ formatDateTime(item.tech_reviewed_at) }} · {{ item.tech_reviewed_by }} </span></p></template><template v-else-if="item && item.tech_review_status === 'PENDING'"><p class="pm-form-hint">等待技术总监复核特殊方法。</p></template></template>
              <template v-else-if="activeSection === 'preparation'"><section class="pm-plan-resources"><header><div><b>设备清单</b><small>只列设备目录中的有效设备；同一设备在同一时段被其他服务项占用时不可选取</small></div><button type="button" class="pm-button" @click="planEquipmentPickerOpen = true">＋ 添加设备</button></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>设备</th><th>能力码</th><th>检定有效期</th><th>使用时段</th><th>备注</th><th></th></tr></thead><tbody><tr v-for="(row, index) in operationForm.equipment" :key="row.resourceID"><td>{{ planResourceName(row) }}</td><td>{{ planResourceCodes(row) || '—' }}</td><td>{{ planResourceValidUntil(row) }}</td><td><div class="pm-plan-window"><input v-model="row.windowStart" type="date" aria-label="使用时段开始" /><span>~</span><input v-model="row.windowEnd" type="date" aria-label="使用时段结束" /></div></td><td><input v-model.trim="row.note" placeholder="例如 备用机" /></td><td><button type="button" class="pm-link danger" @click="removePlanEquipment(index)">移除</button></td></tr><tr v-if="!operationForm.equipment.length"><td colspan="6" class="pm-empty-mini">请至少选择一台实施设备</td></tr></tbody></table></div></section><label><span>设备申领单 <em>*</em></span><input v-model.trim="operationForm.equipmentRequestID" /></label><label><span>行程预订单 <em>*</em></span><input v-model.trim="operationForm.travelRequestID" /></label><label><span>备注</span><textarea v-model.trim="operationForm.comment" rows="3"></textarea></label><button class="pm-button primary" :disabled="saving" @click="runOperation('preparation')">发起实施准备</button></template>
              <template v-else-if="activeSection === 'exceptions'"><label><span>偏离描述</span><textarea v-model.trim="operationForm.deviationDescription" rows="3" placeholder="选择服务项后填写偏离内容"></textarea></label><label><span>严重度</span><select v-model="operationForm.severity"><option value="LOW">低</option><option value="MEDIUM">中</option><option value="HIGH">高</option></select></label><button class="pm-button primary" :disabled="saving" @click="runOperation('exception-report')">上报偏离</button><label><span>评审偏离 ID</span><input v-model.trim="operationForm.deviationID" placeholder="DV-..." /></label><label><span>评审决定</span><select v-model="operationForm.decision"><option value="RELEASE">放行</option><option value="RETEST">重测</option><option value="TERMINATE">终止</option></select></label><button class="pm-button" :disabled="saving" @click="runOperation('exception-review')">提交偏离评审</button></template>
              <template v-else-if="activeSection === 'reports'"><div class="pm-report-phase" v-if="item && item.report_status"><span>当前报告阶段</span><b>{{ reportStatusLabel[item.report_status] || item.report_status }}</b></div><button v-if="item && reportPhaseNext[item.report_status]" class="pm-button primary" :disabled="saving" @click="runOperation('report-next')">推进至{{ reportStatusLabel[reportPhaseNext[item.report_status]] }}</button><button class="pm-button" :disabled="saving" @click="runOperation('complete')">确认现场实施完成</button></template>
            </div><div v-else class="pm-empty-mini">请先选择服务项</div>
          </section>
          <section class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>事项 / 项目</th><th>内容摘要</th><th>负责人 / 归属</th><th>状态</th><th>完成度</th><th>时限</th><th></th></tr></thead><tbody><tr v-for="row in operationRows" :key="row.name"><td><b>{{ row.name }}</b></td><td>{{ row.detail }}<span v-if="row.warning" class="pm-cell-warning">{{ row.warning }}</span></td><td>{{ row.owner }}</td><td><span class="pm-badge" :class="['阻断', '排期冲突'].includes(row.state) ? '风险' : 'neutral'">{{ row.state }}</span></td><td><div class="pm-inline-progress"><i :style="{ width: `${row.progress}%` }"></i></div><small>{{ row.progress }}%</small></td><td>{{ row.due }}</td><td style="width: 90px; min-width: 90px;"><button class="pm-link" @click="openOperationDetail(row)">查看详情</button></td></tr></tbody></table></div><div v-if="!operationRows.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无数据</b><span>当前页面尚无待处理事项</span></div></section>
        </template>
      </div>
    </main>

    <div v-if="drawerProject" class="pm-overlay" @click.self="drawerProject = null"><aside class="pm-drawer"><header><div><span>项目详情</span><h2>{{ drawerProject.id }}</h2></div><button class="pm-icon-button" aria-label="关闭" @click="drawerProject = null"><ConsoleIcon name="close" /></button></header><div class="pm-drawer-body"><section class="pm-drawer-hero"><span class="pm-badge neutral">{{ drawerProject.status }}</span><h3>{{ drawerProject.customer }}</h3><p>{{ drawerProject.category }}</p><div class="pm-progress"><i :style="{ width: `${drawerProject.progress}%` }"></i></div><b>{{ drawerProject.progress }}% 已完成</b></section><dl><div><dt>合同编号</dt><dd>{{ drawerProject.contract || '—' }}</dd></div><div><dt>服务项数量</dt><dd>{{ drawerProject.services || '—' }}</dd></div><div><dt>负责团队</dt><dd>{{ drawerProject.team || '—' }}</dd></div><div><dt>项目经理</dt><dd>{{ drawerProject.manager || '—' }}</dd></div><div><dt>当前状态</dt><dd>{{ drawerProject.status || '—' }}</dd></div><div><dt>计划完成</dt><dd>{{ drawerProject.due || '—' }}</dd></div></dl><section class="pm-timeline"><h3>最近动态</h3><div v-for="event in projectEvents(drawerProject)" :key="event.id"><i></i><b>{{ eventLabel(event) }}</b><p>{{ event.service_item_id || drawerProject.id }} · 操作人 {{ event.actor_user_id }}</p><time>{{ formatDateTime(event.created_at) }}</time></div><div v-if="!projectEvents(drawerProject).length" class="pm-empty-mini">暂无交付动态</div></section></div><footer><button class="pm-button" @click="drawerProject = null">关闭</button></footer></aside></div>

    <div v-if="operationDetail" class="pm-overlay" @click.self="operationDetail = null"><aside class="pm-drawer"><header><div><span>{{ operationSectionLabel(operationDetail.section) }}</span><h2>{{ operationDetail.row.name }}</h2></div><button class="pm-icon-button" aria-label="关闭" @click="operationDetail = null"><ConsoleIcon name="close" /></button></header><div class="pm-drawer-body"><section class="pm-drawer-hero"><span class="pm-badge neutral">{{ operationDetail.row.state }}</span><p>{{ operationDetail.row.detail }}<span v-if="operationDetail.row.warning" class="pm-cell-warning">{{ operationDetail.row.warning }}</span></p><div class="pm-progress"><i :style="{ width: `${operationDetail.row.progress}%` }"></i></div><b>{{ operationDetail.row.progress }}% 已完成</b></section><dl><div v-for="field in operationDetailFields" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div></dl></div><footer><button class="pm-button" @click="operationDetail = null">关闭</button></footer></aside></div>

    <div v-if="planEquipmentPickerOpen" class="pm-overlay" @click.self="planEquipmentPickerOpen = false"><aside class="pm-dialog"><header><div><span>EQUIPMENT</span><h2>添加设备</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="planEquipmentPickerOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-form"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>设备</th><th>能力码</th><th>检定有效期</th><th></th></tr></thead><tbody><tr v-for="item in planEquipmentPickable" :key="item.resource_id"><td>{{ item.resource_name }}</td><td>{{ (item.codes || []).join(' / ') || '—' }}</td><td>{{ item.valid_until ? item.valid_until.slice(0, 10) : '—' }}</td><td><span v-if="equipmentUnavailableReason(item)" class="pm-form-hint" role="status">{{ equipmentUnavailableReason(item) }}</span><button type="button" class="pm-link" :disabled="!!equipmentUnavailableReason(item)" @click="addPlanEquipment(item)">{{ equipmentUnavailableReason(item) ? '不可选取' : '添加' }}</button></td></tr><tr v-if="!planEquipmentPickable.length"><td colspan="4" class="pm-empty-mini">没有可添加的设备：设备目录为空或已全部加入清单，请先在「资质与能力」中维护设备</td></tr></tbody></table></div></div><footer><button type="button" class="pm-button" @click="planEquipmentPickerOpen = false">关闭</button></footer></aside></div><div v-if="createOpen" class="pm-overlay" @click.self="createOpen = false"><form class="pm-dialog" @submit.prevent="saveCreate"><header><div><span>CREATE</span><h2>新建项目</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="createOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>名称 <em>*</em></span><input v-model.trim="createForm.name" required placeholder="请输入项目名称" /></label><template v-if="activeSection === 'projects'"><label><span>已审批合同 <em>*</em></span><select v-model="createForm.contractID" required @change="selectApprovedContract(approvedContracts.find((item) => item.id === createForm.contractID))"><option value="">请选择已通过审批的合同</option><option v-for="contract in approvedContracts" :key="contract.id" :value="contract.id">{{ contract.contract_number }} · {{ contract.title }} · {{ contract.customer_name || '未填写客户' }}</option></select></label><label><span>客户</span><input v-model.trim="createForm.customer" readonly /></label><label><span>合同编号</span><input v-model.trim="createForm.contract" readonly /></label><label><span>实施场所 <em>*</em></span><input v-model.trim="createForm.site" required placeholder="例如 杭州机房" /></label><label><span>技术要求</span><input v-model.trim="createForm.requirement" placeholder="请输入服务项技术要求" /></label><label><span>测试模式</span><select v-model="createForm.testMode"><option value="STANDARD">标准方法</option><option value="PENETRATION">渗透测试</option></select></label><section class="pm-service-links"><header><div><b>关联服务项</b><small>系统名称、系统等级、检测类别均为非必填</small></div><button type="button" class="pm-link" @click="addServiceLink">＋ 增加一行</button></header><div v-for="(link, index) in createForm.serviceLinks" :key="index" class="pm-service-link-row"><input v-model.trim="link.system" placeholder="系统名称" /><input v-model.trim="link.systemLevel" placeholder="系统等级" /><input v-model.trim="link.category" placeholder="检测类别" /><button type="button" class="pm-icon-button" :aria-label="`删除第 ${index + 1} 行`" @click="removeServiceLink(index)">×</button></div></section></template><label><span>备注</span><textarea v-model.trim="createForm.notes" rows="4" placeholder="补充说明（选填）"></textarea></label></div><footer><button type="button" class="pm-button" @click="createOpen = false">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></footer></form></div>

    <div v-if="configEditorOpen" class="pm-overlay" @click.self="configEditorOpen = false"><form class="pm-dialog" @submit.prevent="saveConfigRule"><header><div><span>CONFIG</span><h2>{{ configForm.id ? '编辑配置' : '新建配置' }} · {{ activeConfigMeta.label }}</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="configEditorOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>配置名称 <em>*</em></span><input v-model.trim="configForm.name" required placeholder="请输入配置名称" /></label><template v-for="field in activeConfigMeta.fields" :key="field.key"><label v-if="field.field === 'select'"><span>{{ field.label }} <em>*</em></span><select v-model="configForm[field.key]" required><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label v-else-if="field.field === 'number'"><span>{{ field.label }} <em v-if="field.required">*</em></span><input v-model.number="configForm[field.key]" type="number" :required="field.required" :min="field.min || 0" /></label><label v-else><span>{{ field.label }} <em v-if="field.required">*</em></span><input v-model.trim="configForm[field.key]" :required="field.required" :placeholder="field.placeholder || ''" /></label></template><label><span>启用</span><button type="button" class="pm-switch" :class="{ on: configForm.enabled }" :aria-label="`${configForm.enabled ? '停用' : '启用'}`" @click="configForm.enabled = !configForm.enabled"><i></i></button></label></div><footer><button type="button" class="pm-button" @click="configEditorOpen = false">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></footer></form></div>
    <Transition name="pm-toast"><div v-if="toastMessage" class="pm-toast"><span>✓</span>{{ toastMessage }}</div></Transition>
  </div>
</template>
