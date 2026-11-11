<script setup>
import { loginUsername } from "@/modules/shared/loginUsername.mjs"
import OperationToast from '@/modules/shared/components/OperationToast.vue'
import ListState from '@/modules/shared/components/ListState.vue'
import LoadingState from '@/modules/shared/components/LoadingState.vue'
import ErrorState from '@/modules/shared/components/ErrorState.vue'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'
import { computed, defineAsyncComponent, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { formatUserError } from '../../shared/utils/userError.js'
import { createRequestScope } from '../../platform/shared/composables/requestScope.js'
import { useConfirmDialog } from '../../shared/composables/useConfirmDialog.js'
import { usePromptDialog } from '../../shared/composables/usePromptDialog.js'
import { useUrlFilterState } from '../../shared/composables/useUrlFilterState.js'
import ConfirmDialog from '../../shared/components/ConfirmDialog.vue'
import PromptDialog from '../../shared/components/PromptDialog.vue'
import { assignServiceItemTeams } from '../assignment.js'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, logoutCurrentSession } from '@/modules/platform/auth/api/auth'
import { getUnreadCount, listInbox as listNotificationInbox, markNotificationRead } from '@/modules/platform/notifications/api/notifications'
import { useDecompositionAdjust } from '@/modules/project_management/composables/useDecompositionAdjust'
import { useSupplementClosure } from '@/modules/project_management/composables/useSupplementClosure'
import { supplementClosureAvailability } from '@/modules/project_management/supplementClosure.js'
import { useProjectSectionData } from '@/modules/project_management/composables/useProjectSectionData.js'
import { useProjectAuxiliaryResource } from '@/modules/project_management/composables/useProjectAuxiliaryResource.js'
import { useProjectEquipment } from '@/modules/project_management/composables/useProjectEquipment.js'
import { useProjectPersonnelNames } from '@/modules/project_management/composables/useProjectPersonnelNames.js'
import { useProjectMonitoring } from '@/modules/project_management/composables/useProjectMonitoring'
import { useProjectNotifications } from '@/modules/project_management/composables/useProjectNotifications'
import { rectifyingProjectCount, useProjectKpiVisibility } from '@/modules/project_management/composables/useProjectKpiVisibility'
// BIZ-PROJECT-06：缺项判定由服务端按服务项完整事件流给出，前端只消费结论；
// 判定不可用（未拉取/失败/待同步）一律按"未知"处理并 fail-closed。
import {
  FIELD_EVIDENCE_STATUS_PENDING,
  FIELD_EVIDENCE_STATUS_READY,
  FIELD_EVIDENCE_STATUS_UNKNOWN,
  fieldEvidenceCompletionBlocked,
  fieldEvidenceReasonMismatch,
  normalizeServiceItemFieldEvidence,
  resolveFieldEvidenceVerdict,
} from '@/modules/project_management/fieldEvidence.js'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import CodePills from '@/modules/project_management/components/CodePills.vue'
import EmptyHint from '@/modules/project_management/components/EmptyHint.vue'
import ProjectNotificationPopover from '@/modules/project_management/components/ProjectNotificationPopover.vue'
import FilterBar from '@/modules/project_management/components/FilterBar.vue'
import KpiCard from '@/modules/project_management/components/KpiCard.vue'
import PageHead from '@/modules/project_management/components/PageHead.vue'
import PenetrationWorkPackageCard from '@/modules/project_management/components/PenetrationWorkPackageCard.vue'
import OperationDetailDrawer from '@/modules/project_management/components/OperationDetailDrawer.vue'
import ProgressCell from '@/modules/project_management/components/ProgressCell.vue'
import ProjectNotificationCenter from '@/modules/project_management/components/ProjectNotificationCenter.vue'
import QualificationImportDialog from '@/modules/project_management/components/QualificationImportDialog.vue'
import DetectionCategoryImportDialog from '@/modules/project_management/components/DetectionCategoryImportDialog.vue'
import NativeProjectCreateDialog from '@/modules/project_management/components/NativeProjectCreateDialog.vue'
import ReimbursementSpendPanel from '@/modules/project_management/components/ReimbursementSpendPanel.vue'
import ProjectArchiveDirectory from '../components/ProjectArchiveDirectory.vue'
import NativeScopeChangePanel from '@/modules/project_management/components/NativeScopeChangePanel.vue'
import { useProjectCreationCapabilities } from '@/modules/project_management/composables/useProjectCreationCapabilities.js'
import RiskList from '@/modules/project_management/components/RiskList.vue'
import SearchableSelect from '@/modules/project_management/components/SearchableSelect.vue'
import ServiceItemPicker from '@/modules/project_management/components/ServiceItemPicker.vue'
import SignaturePad from '@/modules/project_management/components/SignaturePad.vue'
import SupplementClosureDialog from '@/modules/project_management/components/SupplementClosureDialog.vue'
import { implementationPlanReady, projectAllowsWorkflowNode } from '@/modules/project_management/workflowNode'
import { countFieldOperations, listFieldOperations, processFieldQueue, removeFieldOperation, saveFieldOperation } from '@/modules/project_management/offlineFieldQueue'
import {
  PROJECT_ROLE_CODES,
  capabilityCodeKey,
  capabilityEffectiveStatus,
  capabilityStatusLabel,
  compactOverrideMatch,
  compactOverrideSettings,
  conflictStatusLabel,
  contractOptionLabel,
  csvCell,
  dateKey,
  datetimeLocalToInstant,
  defaultConfigFieldValue,
  emptyAdjustForm,
  emptyAdjustItem,
  equipmentPresenceLabel,
  eventLabel,
  fieldPermissionAccessLevelLabel,
  fieldPermissionFieldLabel,
  fieldPermissionFieldOptions,
  formatDateTime,
  ganttTone,
  identityStatusLabel,
  isEmbeddedPenetrationItem,
  isoWeekOf,
  monitoringResourceSummary,
  monitoringServiceSummary,
  monitoringSlaLabel,
  multiSummary,
  newFieldOperationID,
  operationSectionLabel,
  overrideMatchText,
  overrideSettingsText,
  penetrationEngineerCandidates,
  penetrationPackageLabel,
  permissionFieldLabel,
  planEquipmentFor,
  planPersonnelFor,
  planPersonnelRows,
  projectReportStageLabel,
  reportStageLabel,
  reportStatusLabel,
  reportTechReviewLabel,
  selectedIDs,
  slaDueLabel,
  specialMethodLabel,
  specialMethodOptions,
  specialMethodTone,
  splitDefaultStatusOptions,
  splitDimensionAnyOptions,
  splitDimensionLabel,
  splitDimensionPrimaryOptions,
  splitDimensionSecondaryOptions,
  splitDimensionText,
  splitMissingRuleOptions,
  splitMissingRuleText,
  startOfWeek,
  statusTone,
  statusToneMap,
  toDateTimeLocal,
  toggleCodeSelection,
} from '@/modules/project_management/projectDisplay'
import { principalIdentityID, subsystemAccessMessage } from '@/modules/shared/authz/sessionCompatibility'
import { formatBusinessDate, formatBusinessDateTime, todayBusinessDate } from '@/modules/shared/utils/businessTime.js'
import { closeSubsystemTabOrFallback } from '@/modules/shared/utils/returnToPortal'
import {
  adjustDecomposition,
  confirmServiceItems as confirmServiceItemsRequest,
  createProject,
  getProjectCreationCapabilities,
  createRule,
  getDashboard,
  getProjectSession,
  getProjectNavigation,
  listProjectsSnapshot,
  getProjectMonitoring,
  listCapabilities,
  upsertCapability,
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
  deleteSplitOverride,
  listServiceItemsSnapshot,
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
  requestReportCorrection,
  decideReportCorrection,
  planImplementation,
  startImplementationPreparation,
  startFieldExecution,
  checkInField,
  captureFieldSignature,
  submitFieldRecord,
  uploadServiceItemEvidence,
  registerReportArtifact,
  reportDeviation,
  reviewDeviation,
  completeServiceItemField,
  getServiceItemFieldEvidence,
  setRuleEnabled,
  updateRule,
  deleteRule,
  reviewSpecialMethod,
  updateReportStatus,
  searchApprovedContractOptions,
  listSupplementContracts,
  closeSupplement,
  getApprovedContractServiceItems,
} from '@/modules/project_management/api/projectManagement'
import '@/modules/project_management/styles/project-management.css'

const { dialog: confirmDialog, askConfirm, accept: acceptConfirm, cancel: cancelConfirm } = useConfirmDialog()
const { dialog: promptDialog, askPrompt, accept: acceptPrompt, cancel: cancelPrompt } = usePromptDialog()

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
    { key: 'notifications', label: '个人通知中心', icon: 'bell' },
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
  notifications: ['个人通知中心', '查看发送给当前用户的统一站内信与业务提醒'],
  dashboard: ['项目执行总览', '全集团项目交付、资源与风险态势'],
  monitoring: ['在途项目 · 实时监控', '在途项目的里程碑、交付进度与资源状态'],
  projects: ['项目列表', '统一管理项目、合同来源、服务项及交付状态'],
  project_detail: ['项目详情', '合同来源、服务项拆解、实施计划与交付动态全景'],
  decomposition: ['服务项拆解确认', '核对合同范围与自动拆解结果，确认后进入任务分配'],
  allocation: ['任务分配', '按团队负载与专业能力完成服务项下达'],
  inbox: ['分配待办收件箱', '处理指派给我的项目与服务项'],
  planning: ['现场实施计划制定', '编排现场窗口、里程碑及交付节奏'],
  preparation: ['实施准备', '集中核验授权、资料、工具与出行准备'],
  qualifications: ['资质与能力管理', '维护人员资质与能力标签，查看设备能力与检定状态'],
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
const navBadges = computed(() => sectionEventsReady.value ? ({
  decomposition: decompositionItems.value.length,
  inbox: inboxItems.value.length,
  exceptions: pendingDeviations.value.length,
}) : ({}))
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
// 汉堡按钮引用：抽屉用 Escape 收起后焦点交还给它，键盘用户不会掉进已隐藏的侧栏。
const mobileMenuButton = ref(null)
const keyword = ref('')
const statusFilter = ref('')
const reportStageFilter = ref('')
// 报告阶段下拉的选项由唯一中文词表生成，值直接作为列表接口的 report_stage 查询参数。
const reportStageFilterOptions = Object.entries(reportStageLabel).map(([value, label]) => ({ value, label }))
const categoryFilter = ref('')
const teamFilter = ref('')
const projectCardFilter = ref('')

useUrlFilterState({
  route,
  router,
  fields: { keyword, status: statusFilter, report_stage: reportStageFilter, category: categoryFilter, team: teamFilter, card: projectCardFilter },
})
const selectedRows = ref([])
const createOpen = ref(false)
const nativeCreateOpen = ref(false)
const nativeScopeProjectID = ref('')
const {
  notificationOpen, notificationItems, notificationCount, notificationLoading, notificationError, notificationActionID,
  closeNotifications, refreshNotificationCount, openNotification, toggleNotifications, disposeNotifications,
} = useProjectNotifications({ getUnreadCount, listNotificationInbox, markNotificationRead, formatUserError, navigate, showToast })
const toastMessage = ref('')
const toastType = ref('success')
const isLoggingOut = ref(false)
const loading = ref(true)
const loadError = ref('')
// 工作区快照走 all=1（服务端上限 500 行）；truncated 只驱动提示条，不改变整体替换逻辑。
const workspaceTruncated = ref(false)
const saving = ref(false)
const emptyCreateForm = () => ({ name: '', customer: '', contract: '', contractID: '', contractVersion: '', site: '' })
const createForm = ref(emptyCreateForm())
const approvedContracts = ref([])
const approvedContractsError = ref('')
// BIZ-XAPI-09：已审批合同选择器改为服务端关键字搜索 + 游标分页，不再一次
// 拉 200 条后静默截断。只有"首页空且无下一页"才提示没有可用合同。
const approvedContractSearchKeyword = ref('')
const approvedContractSearchLoading = ref(false)
const approvedContractSearchNextAfterID = ref('')
const selectedApprovedContract = ref(null)
const APPROVED_CONTRACT_OPTION_LIMIT = 50
let approvedContractSearchRequest = 0
let approvedContractSearchTimer = null
const approvedContractServiceItems = ref([])
const selectedContractServiceIDs = ref([])
const contractServicesLoading = ref(false)
const contractServicesError = ref('')
let contractServiceRequest = 0
const approvedContractServiceOptions = computed(() => approvedContractServiceItems.value.map((item) => ({
  ...item,
  label: item.name || item.service_type || item.category || item.source_id,
  description: [item.system && `${item.system}${item.system_level ? `（${item.system_level}）` : ''}`, item.category, item.batch, item.site].filter(Boolean).join(' · '),
})))
const selectedApprovedContractServices = computed(() => {
  const selected = new Set(selectedContractServiceIDs.value)
  return approvedContractServiceItems.value.filter((item) => selected.has(item.source_id))
})
const dashboard = ref({ project_count: 0, in_flight_projects: 0, risk_projects: 0, pending_project_creation: 0, pending_project_creation_available: false, service_items: 0, status_counts: {} })
// SLA 超期/临近项来自服务端 GET /delivery/sla-overdue，口径由后端统一计算（计划完成超期 + 状态停留超期/临近）。
const slaOverdueItems = ref([])
const session = ref(null)
const lastUpdatedAt = ref(null)
// 附加/辅助数据严格按用户、租户、授权修订和导航隔离，不跨身份永久缓存。
// 换用户、换租户或授权修订变化后，旧代次的在途读取不得回写任何数据/错误/加载态。
const sectionDataContext = computed(() => JSON.stringify([
  session.value?.tenant_id, principalIdentityID(session.value), session.value?.authorization_revision,
  session.value?.permissions, session.value?.roles, navigation.value.sections,
  navigation.value.authorization_revision, navigation.value.catalog_version,
]))
let toastTimer = 0

// 线性节点必须与服务端 domain.ProjectStatusNodes 完全一致；两个分支状态由同一后端状态机返回。
// 服务端按项目全部服务项派生唯一状态，前端只做展示，不得再自行推导阶段。
const projectStatusNodes = ['待拆解确认', '待分配', '待实施', '实施准备中', '实施中', '异常处理中', '现场实施完成', '报告编制', '已完成']
const projectStatusFilters = [...projectStatusNodes, '补充协议处理中', '已终止']
const projectStatusCompleted = '已完成'

const projects = ref([])
// 报告阶段筛选由服务端完成：保留 projects 作为完整工作区快照（指标卡、详情跳转都要用），
// 另存一份服务端按 report_stage 过滤后的列表，仅本项目列表消费，避免指标口径被筛选缩小。
const reportStageProjects = ref([])
const reportStageListLoading = ref(false)
const reportStageListError = ref('')
const reportStageListScope = createRequestScope()
const projectListSource = computed(() => reportStageFilter.value ? reportStageProjects.value : projects.value)
// 项目列表的失败原因：报告阶段筛选失败时整表不可信，必须显示失败态而不是「暂无项目」。
const projectListError = computed(() => reportStageListError.value || '')

const filteredProjects = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return projectListSource.value.filter((project) => {
    const assigned = projectAssignmentPeople(project.id)
    const matchKeyword = !query || [project.name, project.id, project.customer, project.contract, project.category, assigned.teamLeads, assigned.projectManagers].join(' ').toLowerCase().includes(query)
    const matchCard = !projectCardFilter.value
      || (projectCardFilter.value === 'in_flight' && project.status !== projectStatusCompleted)
      || (projectCardFilter.value === 'risk' && isRiskProject(project))
    return matchKeyword
      && matchCard
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
watch([keyword, statusFilter, categoryFilter, teamFilter, projectCardFilter], () => { projectPage.value = 1 })

// 报告阶段筛选由服务端执行：值变化时带 report_stage 重新请求列表，不清空工作区快照。
// 工作区刷新（写后/手动刷新）也会重新拉取当前筛选结果，避免展示过期的筛选快照。
async function loadReportStageProjects() {
  const stage = reportStageFilter.value
  const ticket = reportStageListScope.begin(`REPORT_STAGE:${stage}`)
  if (!stage) {
    reportStageProjects.value = []
    reportStageListError.value = ''
    reportStageListLoading.value = false
    return
  }
  reportStageListLoading.value = true
  try {
    // 报告阶段筛选同样必须走 all=1：默认分页只回 20 行，会把筛选结果静默截少。
    const snapshot = await listProjectsSnapshot({ report_stage: stage })
    if (!reportStageListScope.isCurrent(ticket)) return
    reportStageProjects.value = snapshot.items
    reportStageListError.value = ''
  } catch (error) {
    if (!reportStageListScope.isCurrent(ticket)) return
    reportStageProjects.value = []
    reportStageListError.value = formatUserError(error, { fallback: '报告阶段筛选加载失败，请稍后重试' })
  } finally {
    if (reportStageListScope.isCurrent(ticket)) reportStageListLoading.value = false
  }
}
watch(reportStageFilter, () => { projectPage.value = 1; loadReportStageProjects() }, { immediate: true })
watch(projects, () => { if (reportStageFilter.value) loadReportStageProjects() })

// 检测类别目录是建项、拆解调整与列表筛选共用的唯一受控域。
// 仅展示启用项，避免前端再次维护一套与服务端不一致的硬编码列表。
const detectionCategories = ref([])
const activeDetectionCategoryOptions = computed(() => detectionCategories.value
  .filter((item) => item.enabled)
  .map((item) => ({ value: item.category, label: item.category, description: item.system_standard || item.required_qualifications || '启用的检测类别' })))
const categoryOptions = computed(() => activeDetectionCategoryOptions.value.map((item) => item.value))
const teamOptions = computed(() => [...new Set(projects.value.map((p) => p.team).filter(Boolean))])
const inFlightProjects = computed(() => projects.value.filter((p) => p.status !== projectStatusCompleted))
// 副标注与服务项状态分布同口径：统计当前已加载服务项中报告阶段为整改中的项数，
// 不代表全量；旧后端/旧数据没有 report_status 时自然为 0，前端不推断报告阶段。
const rectifyingItemCount = computed(() => serviceItems.value.filter((item) => String(item.report_status ?? '').trim().toUpperCase() === 'RECTIFYING').length)
// 风险口径由服务端统一派生（domain.IsRiskProject）：派生状态为异常处理中/已终止，
// 或项目内存在已终止服务项。前端不再复刻该规则——此前前后端各写一遍，
// 口径一旦调整（例如把"部分终止"纳入风险）就会出现两处不一致。
const isRiskProject = (project) => Boolean(project && project.risk)
const riskProjectCount = computed(() => projects.value.filter(isRiskProject).length)
const doneProjectCount = computed(() => projects.value.filter((p) => p.status === projectStatusCompleted).length)
const pendingDecompositionCount = computed(() => projects.value.filter((p) => p.status === '待拆解确认').length)
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
function resetProjectFilters() { keyword.value = ''; statusFilter.value = ''; reportStageFilter.value = ''; categoryFilter.value = ''; teamFilter.value = ''; projectCardFilter.value = '' }

const serviceItems = ref([])
// 项目本身的 team/manager 是建项时的展示快照，不能代表后续资源分配结果。
// 列表中的“团队 / 项目经理”必须按服务项上的真实指派关系聚合，且同一人员只显示一次。
const projectAssignmentIDsByProject = computed(() => {
  const assignments = new Map()
  for (const item of serviceItems.value) {
    if (!assignments.has(item.project_id)) assignments.set(item.project_id, { teamLeads: new Set(), projectManagers: new Set() })
    const assigned = assignments.get(item.project_id)
    if (item.team_lead_id) assigned.teamLeads.add(item.team_lead_id)
    if (item.project_manager_id) assigned.projectManagers.add(item.project_manager_id)
  }
  return new Map([...assignments].map(([projectID, assigned]) => [projectID, {
    teamLeads: [...assigned.teamLeads],
    projectManagers: [...assigned.projectManagers],
  }]))
})
const deliveryEvents = ref([])
const sectionEventsReady = ref(false)
// 服务端现场证据判定快照：只保存与当前选中服务项对应的那一份，
// 切换服务项或拉取失败都必须清空，避免把上一项的结论当成本项的结论。
const fieldEvidenceSnapshot = ref(null)
const fieldEvidenceError = ref('')
const fieldEvidenceLoading = ref(false)
// 现场证据读取与其他工作区请求一样用票据管在途响应：切项后的旧响应整体作废。
const fieldEvidenceScope = createRequestScope()
const capabilities = ref([])
const capabilityTypeFilter = ref('')
const capabilityStatusFilter = ref('')
const capabilityDialog = ref(null)
// 资质工作台只新建/编辑人员资质；设备由「设备能力」统一维护。
const capabilityAutoID = ref(false)
const importResult = ref(null)
const qualificationImportOpen = ref(false)
// 设备导入弹窗的开关由 useProjectEquipment 持有（与设备维护状态同源）。
// 资质列表受标签页（全部/人员/设备）与类型、状态筛选共同约束；
// 「体系与编码」「到期提醒」两个标签页使用各自的聚合视图，不走本筛选。
const filteredCapabilities = computed(() => capabilities.value
  .filter((item) => (capabilityTab.value === 'all' || capabilityTab.value === 'codes' || capabilityTab.value === 'expiry' || item.resource_type === capabilityTab.value) && (!capabilityTypeFilter.value || item.resource_type === capabilityTypeFilter.value) && (!capabilityStatusFilter.value || capabilityEffectiveStatus(item) === capabilityStatusFilter.value))
  .map((item) => item.resource_type === 'PERSON' ? { ...item, valid_from: '', valid_until: '' } : item))
const canManageResource = computed(() => Array.isArray(session.value?.permissions) && session.value.permissions.includes('project.resource.manage'))
// 设备维护是独立权限码（PUT /equipment → project.device.manage）：站点/资质/规则都按各自
// 权限码门控入口，设备此前没有门控，一旦设备模块对更多角色可见就会变成「能点必 403」。
const canManageDevice = computed(() => Array.isArray(session.value?.permissions) && session.value.permissions.includes('project.device.manage'))
const selectedServiceItemIDs = ref([])
// 切换服务项时递增，用于强制重建签名画布（避免沿用上一项的签名图像）。
const signaturePadKey = ref(0)
const operationForm = ref({ teamLeadID: '', projectManagerID: '', engineerIDs: '', plannedStart: '', plannedEnd: '', sitePlan: '', penetrationTestPlan: '', authDocNo: '', authStart: '', authEnd: '', authScope: '', testScope: '', testWindow: '', emergencyContact: '', rollbackPlan: '', reviewComment: '', personnel: [], equipment: [], travelMode: '', travelReferenceEventID: '', noTravelReason: '', travelOrigin: '', travelDestination: '', travelDepartureDate: '', travelReturnDate: '', travelTransport: '', travelAccommodationNeed: '', travelTravelerIDs: [], rawData: '', environment: '', fieldEvidenceFile: null, fieldSignatureFile: null, checkInDeviationReason: '', fieldIncompleteReason: '', reportFile: null, reportCorrectionReason: '', reportCorrectionComment: '', deviationDescription: '', deviationEvidenceFile: null, severity: 'MEDIUM', decision: 'RELEASE', comment: '' })
const pendingFieldSyncCount = ref(0)
const fieldSyncing = ref(false)
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
  { kind: 'automations', label: '自动化动作', nameLabel: '通知规则名称', effectNote: '只监听保存后新产生的交付事件；当前唯一动作是按项目角色发送站内通知，不创建工单或调用外部系统。', columns: [{ key: 'trigger', label: '触发事件' }, { key: 'target_label', label: '通知角色' }], fields: [{ key: 'trigger', label: '触发事件', field: 'catalog-single', required: true, options: automationTriggerOptions.value, placeholder: '请选择真实交付事件', searchPlaceholder: '搜索事件名称或编码' }, { key: 'targets', label: '通知角色', field: 'automation-roles', required: true }] },
  { kind: 'permissions', label: '字段级权限', nameLabel: '隐藏规则名称', effectNote: '启用后立即影响该角色读取已有和新增项目数据；接口返回对应字段时统一脱敏为 ***。', columns: [{ key: 'role_label', label: '角色' }, { key: 'field_label', label: '字段' }, { key: 'access_level_label', label: '访问级别' }], fields: [{ key: 'role_codes', label: '角色', field: 'roles', required: true }, { key: 'field_name', label: '字段', field: 'permission-field', required: true, options: fieldPermissionFieldOptions }, { key: 'access_level', label: '访问级别', field: 'catalog-single', required: true, options: [{ value: 'hidden', label: '隐藏（接口返回 ***）' }] }] },
  { kind: 'sla', label: 'SLA 规则', nameLabel: 'SLA 名称', effectNote: '保存或启用后立即按当前服务项进入该状态的时间开始计算；0 小时表示不提前提醒，不改变计划完成时间超期口径。', columns: [{ key: 'status', label: '状态' }, { key: 'deadline_hours', label: '时限(小时)' }, { key: 'remind_hours', label: '提醒(小时)' }], fields: [{ key: 'status', label: '生效状态', field: 'catalog-single', required: true, options: slaStatusOptions.value, placeholder: '请选择服务项状态', searchPlaceholder: '搜索服务项状态' }, { key: 'deadline_hours', label: '时限(小时)', field: 'number', required: true, min: 1 }, { key: 'remind_hours', label: '提前提醒(小时)', field: 'number', required: true, min: 0 }] },
]
// 配置中心按 kind 与服务端使用同一权限边界：设备管理员只能管理编码目录，
// 字段脱敏仍需独立高风险权限，其余运营规则由 project_rule.manage 把关。
const canViewConfigKind = (kind) => {
  if (kind === 'permissions') return canManageFieldPermissions.value
  if (kind === 'capability-codes') return canManageCapabilityCodes.value
  return canManageRules.value
}
const visibleConfigKinds = computed(() => configKindsMeta.filter((meta) => canViewConfigKind(meta.kind)))
// 页签被隐藏时不能只靠 activeSection 判断：那样配置页仍会打开，表头取回退后的首个可见
// 配置、列表却按被隐藏的 kind 过滤，得到一张标题与内容不符的空表；「新建规则」也会为
// 隐藏的 kind 建档。因此页签、面板与入口统一以可见集合为准。
const isStandardChangeSection = computed(() => activeSection.value === standardChangeMeta.kind)
const isVisibleConfigSection = computed(() => isStandardChangeSection.value || visibleConfigKinds.value.some((meta) => meta.kind === activeSection.value))
const activeConfigMeta = computed(() => isStandardChangeSection.value ? standardChangeMeta : visibleConfigKinds.value.find((meta) => meta.kind === activeSection.value) || visibleConfigKinds.value[0])
const canManageActiveConfig = computed(() => isStandardChangeSection.value ? canManageRules.value : canViewConfigKind(activeSection.value))
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
    .catch((error) => { applicationRolesError.value = formatUserError(error, { fallback: '角色目录加载失败' }) })
    .finally(() => { applicationRolesRequest = null })
  return applicationRolesRequest
}
const configRoleSelection = computed(() => (Array.isArray(configForm.value.role_codes) ? configForm.value.role_codes : []))
const configAutomationRoleSelection = computed(() => (Array.isArray(configForm.value.targets) ? configForm.value.targets : []))
// 已保存的角色可能已不在目录内（历史错值或目录调整）：补一条并标注，避免编辑时被静默改写。
const configRoleOptions = computed(() => {
  const options = [...applicationRoles.value]
  const known = new Set(options.map((option) => option.code))
  const selectedCodes = [...configRoleSelection.value, ...configAutomationRoleSelection.value, String(configForm.value.target || '').trim()].filter(Boolean)
  for (const code of selectedCodes) {
    if (code && !known.has(code)) { options.push({ code, name: `${code}（不在角色目录中）` }); known.add(code) }
  }
  return options
})
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
    const roles = configAutomationRoleSelection.value.map((code) => applicationRoles.value.find((option) => option.code === code)?.name || code)
    if (trigger && roles.length) configForm.value.name = `${trigger} → 通知${roles.join('、')}`
  }
}
function configUsesRoleCatalog() {
  return activeConfigMeta.value.fields.some((field) => ['roles', 'automation-roles', 'role'].includes(field.field))
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
  if (activeConfigMeta.value.fields.some((field) => field.field === 'automation-roles')) {
    configForm.value.targets = rule.target ? [rule.target] : []
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
    let automationTargets = []
    for (const field of activeConfigMeta.value.fields) {
      if (field.field === 'roles') { roleField = true; roleCodes = configRoleSelection.value; continue }
      if (field.field === 'automation-roles') { automationTargets = configAutomationRoleSelection.value; continue }
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
      if (!automationTargets.length) { showToast('请至少选择一个通知角色', 'warning'); return }
      if (automationTargets.some((roleCode) => !applicationRoles.value.some((option) => option.code === roleCode))) { showToast('通知角色必须来自项目系统角色目录', 'warning'); return }
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
    if (payload.kind === 'automations') {
      // 自动化表保持一条规则对应一个角色；运行时会合并同一触发事件命中的所有规则，
      // 因而多选既不需要改变数据库结构，也能让每个角色真实收到站内通知。
      const created = []
      for (const [index, target] of automationTargets.entries()) {
        const body = { ...payload, target }
        const saved = index === 0 && configForm.value.id ? await updateRule(configForm.value.id, body) : await createRule(body)
        applySavedRule(saved)
        created.push(saved)
      }
      configEditorOpen.value = false
      showToast(created.length > 1 ? `已保存 ${created.length} 条自动化规则（每个通知角色一条）` : '自动化规则已保存')
      return
    }
    const saved = configForm.value.id ? await updateRule(configForm.value.id, payload) : await createRule(payload)
    applySavedRule(saved)
    configEditorOpen.value = false
    showToast(payload.kind === 'standards' ? (configForm.value.id ? '标准变更记录已保存' : '标准变更已登记，进入影响评估') : (configForm.value.id ? '配置已保存' : '配置已创建'))
  } catch (error) { showToast(formatUserError(error, { fallback: '配置保存失败' }), 'error') }
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
const splitOverrides = ref([])
const splitConfigLoading = ref(false)
const splitConfigError = ref('')
const categoryDialog = ref(null)
const overrideDialog = ref(null)
const splitPolicyBaseline = ref('')


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
    splitConfigError.value = formatUserError(error, { fallback: '拆解规则配置加载失败' })
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
  } catch (error) { showToast(formatUserError(error, { fallback: '默认分组规则保存失败' }), 'error') }
  finally { splitPolicySaving.value = false }
}

// 检测类别域 CSV 导出/导入：导出在浏览器侧生成（UTF-8 BOM，Excel 可直接打开），
// 导入先由服务端预检，确认时重新校验勾选行。
const detectionCategoryImportOpen = ref(false)
const DETECTION_CATEGORY_HEADERS = ['检测类别', '默认体系要求', '必备资质（默认）', '必检能力码', '是否特殊方法', '状态']


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
  link.download = `检测类别域-${todayBusinessDate()}.csv`
  link.click()
  URL.revokeObjectURL(url)
  showToast(`已导出 ${detectionCategories.value.length} 条检测类别`)
}

async function importDetectionCategoryFile(result) {
  try {
    detectionCategories.value = await listDetectionCategories()
    showToast(`导入结果：成功 ${result.imported} 条，失败 ${result.skipped} 条`)
  } catch (error) { showToast(`导入已完成，但类别目录刷新失败：${formatUserError(error, { fallback: '请手动刷新' })}`, 'warning') }
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
  } catch (error) { showToast(formatUserError(error, { fallback: '检测类别保存失败' }), 'error') }
  finally { saving.value = false }
}

async function removeDetectionCategory(item) {
  if (saving.value) return
  const ok = await askConfirm({
    title: '删除检测类别？',
    description: `确认删除检测类别「${item.category}」？仍被服务项引用的类别不能删除，可改为禁用。`,
    confirmText: '删除类别',
    cancelText: '取消',
    danger: true,
  })
  if (!ok) return
  saving.value = true
  try {
    await deleteDetectionCategory(item.category)
    detectionCategories.value = await listDetectionCategories()
    showToast(`检测类别「${item.category}」已删除`)
  } catch (error) { showToast(formatUserError(error, { fallback: '检测类别删除失败' }), 'error') }
  finally { saving.value = false }
}

function openOverrideDialog(item = null) {
  overrideDialog.value = item
    ? { ...item, match: { ...item.match_conditions }, settings: { ...item.override_settings } }
    : { name: '', match: { customer_contains: '', contract_contains: '', max_service_items: 0 }, settings: {}, priority: 100, enabled: true }
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
  } catch (error) { showToast(formatUserError(error, { fallback: '覆盖规则保存失败' }), 'error') }
  finally { saving.value = false }
}

async function removeSplitOverride(item) {
  if (saving.value) return
  const ok = await askConfirm({
    title: '删除覆盖规则？',
    description: `确认删除覆盖规则「${item.name}」？删除后该合同将回到默认分组规则。`,
    confirmText: '删除规则',
    cancelText: '取消',
    danger: true,
  })
  if (!ok) return
  saving.value = true
  try {
    await deleteSplitOverride(item.id)
    splitOverrides.value = await listSplitOverrides()
    showToast(`覆盖规则「${item.name}」已删除`)
  } catch (error) { showToast(formatUserError(error, { fallback: '覆盖规则删除失败' }), 'error') }
  finally { saving.value = false }
}

// 报告阶段与服务项报告状态的中文词表统一由 projectDisplay.js 提供；
// 页面只负责展示，不在这里重复维护第二份文案。
// SLA 口径标签与剩余/超期文案：与后端 domain.SlaKind* 常量对齐。
const slaKindLabel = { PLAN_END_OVERDUE: '计划完成超期', STATUS_DEADLINE_OVERDUE: '状态停留超期', STATUS_DEADLINE_APPROACHING: '状态临近超期' }
const reportStatusRank = { RECTIFYING: 1, COMPILING: 2, REVIEWED: 3, ISSUED: 4, ARCHIVED: 5 }
const reportPhaseNext = { NONE: 'RECTIFYING', RECTIFYING: 'COMPILING', COMPILING: 'REVIEWED', REVIEWED: 'ISSUED', ISSUED: 'ARCHIVED' }
const reportPhaseAction = { RECTIFYING: '开始整改', COMPILING: '开始编制', REVIEWED: '审核报告', ISSUED: '签发报告', ARCHIVED: '归档报告' }
const reportItems = computed(() => serviceItems.value.filter((item) => {
  const projectStatus = projectByID.value.get(item.project_id)?.status
  return ['现场实施完成', '报告编制', '已完成'].includes(projectStatus) && (item.status === '现场实施完成' || (item.report_status && item.report_status !== 'NONE'))
}))
const personnelLoading = ref(false)
const personnelError = ref('')
const capabilityPersonnel = ref([])
const capabilityPersonnelLoading = ref(false)
const capabilityPersonnelError = ref('')
const personnelScope = createRequestScope()


const emptyPersonnelByRole = () => ({ [PROJECT_ROLE_CODES.teamLead]: [], [PROJECT_ROLE_CODES.projectManager]: [], [PROJECT_ROLE_CODES.engineer]: [], [PROJECT_ROLE_CODES.penetrationEngineer]: [] })
const personnelByRole = ref(emptyPersonnelByRole())

// 用途：按已确认项目会话能力加载人员目录。
// 参数：无。
// 返回值：无；无项目读取权限时不发请求。
async function loadPersonnel() {
  if (!session.value?.permissions?.includes('project.read')) return
  // 项目经理/工程师只在具备 project.execution.assign 的表单里出现。
  const roles = canExecutionAssign.value
    ? [PROJECT_ROLE_CODES.teamLead, PROJECT_ROLE_CODES.projectManager, PROJECT_ROLE_CODES.engineer]
    : [PROJECT_ROLE_CODES.teamLead]
  // 渗透测试工程师只服务渗透专项指派（project.implementation.plan + 专项卡片），
  // 没有该权限的账号不额外请求这一角色的目录，避免无谓的候选查询。
  if (canPlanImplementation.value) roles.push(PROJECT_ROLE_CODES.penetrationEngineer)
  const ticket = personnelScope.begin(`PERSONNEL:${roles.join('+')}`)
  personnelLoading.value = true
  personnelError.value = ''
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
    if (!personnelScope.isCurrent(ticket)) return
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
    if (!personnelScope.isCurrent(ticket)) return
    personnelByRole.value = emptyPersonnelByRole()
    personnelError.value = formatUserError(error, { fallback: '人员资质库加载失败' })
  } finally {
    if (personnelScope.isCurrent(ticket)) personnelLoading.value = false
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
    capabilityPersonnelError.value = formatUserError(error, { fallback: '基础平台人员目录加载失败' })
  } finally {
    capabilityPersonnelLoading.value = false
  }
}

const capabilityPersonOptions = computed(() => {
  const options = [...capabilityPersonnel.value]
  const selectedID = capabilityDialog.value?.user_id
  if (selectedID && !options.some((person) => person.id === selectedID)) {
    options.push({ id: selectedID, name: capabilityDialog.value?.resource_name || personnelNames.names.value.get(selectedID) || '当前人员（目录中不可用）' })
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
const personFallbackName = (id) => personnelNames.names.value.get(id) || '姓名解析中…'
function roleOptions(roleCode, selectedIDs) {
  const options = [...(personnelByRole.value[roleCode] || [])]
  const known = new Set(options.map((option) => option.id))
  for (const id of selectedIDs) {
    if (id && !known.has(id)) {
      options.push({ id, name: personFallbackName(id) })
      known.add(id)
    }
  }
  return options
}
const teamLeadOptions = computed(() => roleOptions(PROJECT_ROLE_CODES.teamLead, [operationForm.value.teamLeadID]))
const projectManagerOptions = computed(() => roleOptions(PROJECT_ROLE_CODES.projectManager, [operationForm.value.projectManagerID, ...(monitoringSnapshot?.value?.project_manager_ids || [])]))

// 工程师改为下拉多选：选中结果仍写回逗号分隔的 engineerIDs，保持后端载荷不变。
const engineerSelection = computed({
  get: () => selectedIDs(operationForm.value.engineerIDs),
  set: (values) => { operationForm.value.engineerIDs = values.join(',') },
})
const engineerOptions = computed(() => roleOptions(PROJECT_ROLE_CODES.engineer, engineerSelection.value))
// 渗透专项卡片与任务分配表单是两处独立指派：这里提交的是专项计划的 engineer_ids。
// 后端按「实施工程师 ∪ 渗透测试工程师」合并校验角色，候选因此取两个角色目录的并集，
// 再按 PENETRATION_TEST 能力过滤——只认单一角色会出现“后端放行、页面选不到”。
const penetrationEngineerOptions = computed(() => penetrationEngineerCandidates({
  personnelByRole: personnelByRole.value,
  capabilities: capabilities.value,
  selectedIDs: serviceItems.value.flatMap((item) => item.penetration_work_package?.engineer_ids || []),
  resolveName: personFallbackName,
}))
// 工程师使用与团队负责人、项目经理一致的下拉样式：展开后逐项勾选，
// 不要求用户按住 ⌘/Ctrl 做加选，选中结果仍写回逗号分隔的 ID 列表。
// 设备不在任务分配中选取：设备清单在「实施准备」阶段登记。
const openMulti = ref('')
// 键盘可达的多选下拉：↑↓ 移动高亮、Enter 勾选、Esc 关闭（统一交互基线，
// 与设备选择器的"禁用原因"、ServiceItemPicker 的 listbox 语义同源）。
const multiActiveIndex = ref(-1)
function toggleMulti(kind) { openMulti.value = openMulti.value === kind ? '' : kind }
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
// 现场缺项判定（BIZ-PROJECT-06）：口径来自服务端 GET /service-items/:id/field-evidence，
// 不再从 deliveryEvents（租户最近 500 条窗口）里挑事件推导。判定不可用即"未知"，
// 未知不等于齐全——完成动作必须被拦下。
const selectedFieldEvidence = computed(() => resolveFieldEvidenceVerdict({
  itemID: selectedServiceItem.value?.id || '',
  snapshot: fieldEvidenceSnapshot.value,
  error: fieldEvidenceError.value,
  pendingSyncCount: pendingFieldSyncCount.value,
  loading: fieldEvidenceLoading.value,
}))
const selectedFieldEvidenceStatus = computed(() => selectedFieldEvidence.value.status)
const selectedFieldEvidenceGaps = computed(() => selectedFieldEvidence.value.missing)
const selectedFieldEvidenceDetails = computed(() => selectedFieldEvidence.value.evidence)
const fieldEvidenceBlocksCompletion = computed(() => fieldEvidenceCompletionBlocked(selectedFieldEvidence.value))
// 已具备证据明细（BIZ-PROJECT-06）：真实证据必须在界面上看得见，不能再出现
// "证据其实存在、界面只说缺项"的错位。
const selectedFieldEvidenceEvidenceSummary = computed(() => selectedFieldEvidenceDetails.value
  .map((entry) => {
    const parts = [entry.label]
    if (entry.summary) parts.push(entry.summary)
    if (entry.fileRef) parts.push(`回执 ${entry.fileRef}`)
    if (entry.capturedAt) parts.push(formatDateTime(entry.capturedAt))
    return parts.join('，')
  })
  .join(' ｜ '))
const travelExistingOptions = computed(() => {
  const projectID = selectedServiceItem.value?.project_id
  if (!projectID) return []
  return deliveryEvents.value
    .filter((event) => event.project_id === projectID && event.type === 'PREPARATION_STARTED' && event.payload?.travel_request_id && event.payload?.travel?.mode !== 'NO_TRAVEL')
    .map((event) => {
      const travel = event.payload?.travel || {}
      const route = travel.origin && travel.destination ? `${travel.origin} → ${travel.destination}` : '已登记行程'
      const dates = travel.departure_date && travel.return_date ? `${travel.departure_date} 至 ${travel.return_date}` : formatDateTime(event.created_at)
      return { id: event.id, label: route, description: `${dates} · ${personListLabel(travel.traveler_ids, event.service_item_id || '历史行程')} · ${event.payload.travel_request_id}` }
    })
})
const travelTravelerOptions = computed(() => {
  const item = selectedServiceItem.value
  if (!item) return []
  const planIDs = (item.implementation_plan?.personnel || []).map((row) => row.resource_id)
  const ids = [...new Set([item.team_lead_id, item.project_manager_id, ...(item.engineer_ids || []), ...planIDs].filter(Boolean))]
  return ids.map((id) => ({ id, name: personLabel(id), description: id === item.team_lead_id ? '团队负责人' : id === item.project_manager_id ? '项目经理' : '实施工程师' }))
})
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
  'PREPARATION_STARTED', 'PREPARATION_REVOKED', 'FIELD_STARTED', 'FIELD_RECORD_SUBMITTED',
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
const penetrationPackageStats = computed(() => {
  const packages = serviceItems.value.map((item) => item.penetration_work_package).filter(Boolean)
  return {
    total: packages.length,
    pending: packages.filter((item) => item.decision_status === 'PENDING').length,
    active: packages.filter((item) => item.decision_status === 'REQUIRED' && item.execution_status !== 'COMPLETED').length,
    completed: packages.filter((item) => item.execution_status === 'COMPLETED').length,
  }
})
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
const completedProjectCount = computed(() => projects.value.filter((project) => project.status === projectStatusCompleted).length)
const currentUserName = computed(() => loginUsername(session.value))
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
// 姓名属于辅助数据：只在已加载的业务记录出现未解析的人员 ID 时才按集合批量读取，
// 映射由 useProjectPersonnelNames 持有（按租户/用户/授权代次隔离，刷新后重新确认）。
// personLabel 渲染单个人员；personListLabel 渲染工程师这类多人字段。
// 解析不到时显示占位符而不是回退成 ULID：对业务用户来说 ID 没有任何信息量。
function personLabel(userID, fallback = '待指派') {
  const id = String(userID || '').trim()
  if (!id) return fallback
  return personnelNames.names.value.get(id) || '—'
}
function personListLabel(ids, fallback = '未指派') {
  const list = (Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)
  if (!list.length) return fallback
  return list.map((id) => personnelNames.names.value.get(id) || '—').join('、')
}
function projectAssignmentPeople(projectID) {
  const assigned = projectAssignmentIDsByProject.value.get(projectID) || { teamLeads: [], projectManagers: [] }
  return {
    teamLeads: personListLabel(assigned.teamLeads, '待分配'),
    projectManagers: personListLabel(assigned.projectManagers, '待指派'),
  }
}
function rememberPersonnelNames(names = {}) { personnelNames.remember(names) }

const canExecutionAssign = computed(() => Array.isArray(session.value?.permissions) && session.value.permissions.includes('project.execution.assign'))
// 项目创建是高影响动作：除 project.create 外，仅超级管理员（admin）和业务管理员可发起。
// 与服务端 mayCreateProject 同口径，避免其他角色被误授权限码后在界面上出现入口。
const projectCreationRoles = new Set(['admin', 'business_admin'])
const canCreateProject = computed(() => {
  if (!Array.isArray(session.value?.permissions) || !session.value.permissions.includes('project.create')) return false
  const roles = Array.isArray(session.value?.roles) ? session.value.roles : []
  return roles.some((role) => projectCreationRoles.has(role))
})
const canReadNativeProjectScope = computed(() =>
  Array.isArray(session.value?.permissions) && session.value.permissions.includes('project.read'))
const canReadProjectSourceCapabilities = computed(() =>
  canReadNativeProjectScope.value || canCreateProject.value)
const {
  nativeEnabled: nativeProjectEnabled,
  error: projectCreationCapabilityError,
  refresh: refreshProjectCreationCapabilities,
} = useProjectCreationCapabilities({
  allowed: canReadProjectSourceCapabilities,
  session,
  loader: getProjectCreationCapabilities,
})
watch([canCreateProject, nativeProjectEnabled], ([allowed, enabled]) => {
  if (!allowed || !enabled) nativeCreateOpen.value = false
})

// 用途：接收已成功保存的原生项目并刷新工作区，不重复发起建项。
// 参数：project为服务端返回的新建或幂等重放项目。
// 返回值：异步完成；刷新失败沿用已保存提示，保留服务端事实。
async function onNativeProjectCreated(project) {
  nativeCreateOpen.value = false
  showToast(`项目 ${project.id} 已创建，服务项待拆解确认`)
  await refreshAfterWrite()
}

const projectCardRole = computed(() => {
  const roles = new Set((Array.isArray(session.value?.roles) ? session.value.roles : []).map((role) => String(role).trim().toLowerCase()))
  // 多角色账号采用职责覆盖面更大的卡片方案；列表数据范围仍由服务端授权上下文裁剪。
  return ['admin', 'system_admin', 'technical_director', 'business_admin', 'team_lead', 'project_manager', 'engineer', 'penetration_engineer']
    .find((role) => roles.has(role)) || 'default'
})

const projectKpiCards = computed(() => {
  const pendingProjectValue = dashboard.value.pending_project_creation_available ? dashboard.value.pending_project_creation : '—'
  const catalog = {
    all_projects: { key: 'all_projects', label: '全部项目', value: projects.value.length, suffix: '个', meta: projectCardRole.value === 'team_lead' ? '当前团队' : '当前授权范围', action: 'all' },
    all_service_items: { key: 'all_service_items', label: '全部服务项', value: serviceItems.value.length, suffix: '项', meta: projectCardRole.value === 'project_manager' ? '分配给我的服务项' : '当前授权范围' },
    pending_decomposition: { key: 'pending_decomposition', label: '待拆解确认', value: pendingDecompositionCount.value, suffix: '个', meta: '需业务管理员处理', tone: 'amber', action: 'decomposition' },
    in_flight: { key: 'in_flight', label: '在途项目', value: inFlightProjects.value.length, suffix: '个', meta: '含实施中 / 报告编制', tone: 'blue', action: 'in_flight' },
    // 整改中是报告的独立阶段（与 9 个项目状态正交），计数只取已加载项目，不伪造旧后端数据。
    rectifying: { key: 'rectifying', label: '整改中项目', value: rectifyingProjectCount(projects.value), suffix: '个', meta: '报告整改阶段', tone: 'amber', action: 'rectifying' },
    completed: { key: 'completed', label: '已完成项目', value: doneProjectCount.value, suffix: '个', meta: '已完成交付', tone: 'green', action: 'completed' },
    allocation_pending: { key: 'allocation_pending', label: '资源分配待办', value: inboxItems.value.length, suffix: '项', meta: '责任团队待补齐人员', tone: 'amber', action: 'allocation' },
    risk: { key: 'risk', label: '风险项目', value: riskProjectCount.value, suffix: '个', meta: '含终止 / 超期', tone: 'red', action: 'risk' },
    pending_creation: { key: 'pending_creation', label: '待新建项目', value: pendingProjectValue, suffix: dashboard.value.pending_project_creation_available ? '个' : '', meta: dashboard.value.pending_project_creation_available ? '合同流程已完成 · 尚未建项目' : '合同统计暂时不可用', tone: 'red', action: canCreateProject.value ? 'create' : '' },
  }
  const layouts = {
    business_admin: ['pending_decomposition', 'in_flight', 'rectifying', 'pending_creation'],
    technical_director: ['all_projects', 'all_service_items', 'allocation_pending', 'in_flight', 'rectifying', 'risk', 'pending_creation'],
    team_lead: ['all_projects', 'in_flight', 'rectifying', 'completed', 'risk'],
    project_manager: ['all_projects', 'all_service_items', 'rectifying', 'risk'],
    engineer: ['all_projects', 'in_flight', 'rectifying', 'completed', 'risk'],
    penetration_engineer: ['all_projects', 'in_flight', 'rectifying', 'completed', 'risk'],
    admin: ['all_projects', 'all_service_items', 'pending_decomposition', 'in_flight', 'rectifying', 'completed', 'allocation_pending', 'risk', 'pending_creation'],
    system_admin: ['all_projects', 'all_service_items', 'pending_decomposition', 'in_flight', 'rectifying', 'completed', 'allocation_pending', 'risk'],
    default: ['all_projects', 'in_flight', 'rectifying', 'completed', 'risk'],
  }
  return layouts[projectCardRole.value].map((key) => catalog[key])
})

// 指标卡可逐张显示/隐藏，偏好按「租户 + 用户」存在浏览器本地；默认全部可见。
// 隐藏后网格列数按可见卡片数重算，只做本地重排，不重新请求任何接口。
const {
  hiddenKeys: hiddenProjectKpiKeys,
  visibleCards: projectKpiVisibleCards,
  columnCount: projectKpiColumnCount,
  allHidden: allProjectKpiHidden,
  settingsOpen: kpiSettingsOpen,
  isCardVisible: isProjectKpiVisible,
  toggleCard: toggleProjectKpiCard,
  resetCards: resetProjectKpiCards,
  toggleSettings: toggleKpiSettings,
  closeSettings: closeKpiSettings,
} = useProjectKpiVisibility({
  cards: projectKpiCards,
  tenantID: computed(() => session.value?.tenant_id),
  userID: computed(() => session.value?.user_id),
})

// 指标卡设置面板的焦点管理：打开后聚焦第一个开关，关闭时把焦点还给触发按钮。
const kpiSettingsRoot = ref(null)
const kpiSettingsTrigger = ref(null)
const kpiSettingsPanel = ref(null)
function openKpiSettings() {
  toggleKpiSettings()
  if (!kpiSettingsOpen.value) return
  nextTick(() => {
    const firstSwitch = kpiSettingsPanel.value?.querySelector('[role="switch"]')
    ;(firstSwitch || kpiSettingsTrigger.value)?.focus()
  })
}
function dismissKpiSettings({ restoreFocus = false } = {}) {
  if (!kpiSettingsOpen.value) return false
  const panel = kpiSettingsPanel.value
  const focusInside = Boolean(panel && typeof document !== 'undefined' && panel.contains(document.activeElement))
  closeKpiSettings()
  if (restoreFocus || focusInside) kpiSettingsTrigger.value?.focus()
  return true
}
// 点击面板与触发按钮以外的区域关闭；触发按钮自身在 root 内，不会误关。
function onKpiSettingsOutsideClick(event) {
  if (!kpiSettingsOpen.value) return
  const root = kpiSettingsRoot.value
  if (root && event.target instanceof Node && root.contains(event.target)) return
  dismissKpiSettings()
}
// 离开项目列表时收起面板，避免再次进入时残留展开态。
watch(activeSection, () => { if (kpiSettingsOpen.value) dismissKpiSettings() })

const projectCardFilterLabel = computed(() => ({ in_flight: '在途项目', risk: '风险项目' })[projectCardFilter.value] || '')
function activateProjectKpi(card) {
  if (!card.action) return
  if (card.action === 'create') { openCreateProject(); return }
  if (card.action === 'allocation') { navigate('inbox'); return }
  // 指标卡切换的是项目范围，和状态筛选一样清掉报告阶段筛选，避免“全部项目”仍停留在子集。
  // 例外：整改中卡片本身就是报告阶段范围，保留它写入的 report_stage 筛选。
  projectCardFilter.value = ['in_flight', 'risk'].includes(card.action) ? card.action : ''
  if (card.action === 'rectifying') {
    reportStageFilter.value = 'RECTIFYING'
    statusFilter.value = ''
    return
  }
  reportStageFilter.value = ''
  if (card.action === 'decomposition') statusFilter.value = '待拆解确认'
  else if (card.action === 'completed') statusFilter.value = projectStatusCompleted
  else statusFilter.value = ''
}
// 其余写操作入口同样用服务端同款权限码门控：只门控少数几个权限码时，
// 未授权角色会看到自己无权执行的按钮，点击必然 403。
const permissionSet = computed(() => new Set(Array.isArray(session.value?.permissions) ? session.value.permissions : []))
const canAssignTeam = computed(() => permissionSet.value.has('project.team.assign'))
const canRevokeTeam = computed(() => permissionSet.value.has('project.team.revoke'))
const canRevokeExecution = computed(() => permissionSet.value.has('project.execution.revoke'))
const canRevokeImplementation = computed(() => permissionSet.value.has('project.implementation.revoke'))
const canRequestRollback = computed(() => permissionSet.value.has('project.rollback.request'))
const canApproveRollback = computed(() => permissionSet.value.has('project.rollback.approve'))
const canRequestReportCorrection = computed(() => permissionSet.value.has('project.report.correction.request'))
const canApproveReportCorrection = computed(() => permissionSet.value.has('project.report.correction.approve'))
const canPlanImplementation = computed(() => permissionSet.value.has('project.implementation.plan'))
const canExecuteField = computed(() => permissionSet.value.has('project.field.execute'))
const canCompleteField = computed(() => permissionSet.value.has('project.field.complete'))
const canReportDeviation = computed(() => permissionSet.value.has('project.deviation.report'))
const canReviewDeviation = computed(() => permissionSet.value.has('project.deviation.review'))
const canManageRules = computed(() => permissionSet.value.has('project_rule.manage'))
const canManageFieldPermissions = computed(() => permissionSet.value.has('project.field_permission.manage'))
const canManageCapabilityCodes = computed(() => canManageRules.value || permissionSet.value.has('project.capability_code.manage'))
const canReviewSpecialMethod = computed(() => permissionSet.value.has('project.special_method.review'))
// 确认拆解与调整拆解是两个独立权限，不能共用：服务端 POST /service-items/confirm
// 由 service_item.confirm 把关，POST /projects/:id/decomposition-adjustments 由
// project.decomposition.manage 把关。二者合并门控会让只有其中一个权限的角色看到
// 「点击必然 403」的按钮。
const canConfirmDecomposition = computed(() => permissionSet.value.has('service_item.confirm'))
// 拆解调整需要独立权限：业务管理员据此发起补充协议并重建服务项清单。
const canManageDecomposition = computed(() => permissionSet.value.has('project.decomposition.manage'))
const reportPhasePermission = { RECTIFYING: 'project.report.prepare', COMPILING: 'project.report.prepare', REVIEWED: 'project.report.review', ISSUED: 'project.report.issue', ARCHIVED: 'project.report.archive' }
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
const lastUpdatedLabel = computed(() => lastUpdatedAt.value ? formatBusinessDateTime(lastUpdatedAt.value) : '尚未加载')
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
// 补充协议关账入口：只有 supplement_status=REQUIRED 且具备拆解管理权限才可提交；
// 缺少权限时保留说明而不是让按钮“看起来能点、点了必然 403”。
const decompositionSupplementClosure = computed(() => supplementClosureAvailability(decompositionProject.value, permissionSet.value))
const supplementContractOptions = computed(() => {
  const project = decompositionProject.value
  if (!project || project.id !== adjustProjectID.value) return []
  return supplementContracts.value.filter((contract) => {
    if (!contract?.id || !contract.approval_passed || !['approved', 'active'].includes(String(contract.status).trim().toLowerCase())) return false
    const originals = [project.contract_id, project.contract].map((value) => String(value || '').trim()).filter(Boolean)
    if (originals.includes(contract.id) || originals.includes(contract.contract_number)) return false
    if (project.customer_id) return contract.customer_id === project.customer_id
    return Boolean(project.customer && contract.customer_name && project.customer.trim().toLocaleLowerCase() === contract.customer_name.trim().toLocaleLowerCase())
  })
})
const canConfirmCurrentDecomposition = computed(() => currentDecompositionItems.value.some((item) => item.selected))
const decompositionBatches = computed(() => Object.entries(currentDecompositionItems.value.reduce((groups, item) => { const key = item.batch || '未设置批次'; (groups[key] ||= []).push(item); return groups }, {})))
// 批次列表是可操作的筛选入口，选中批次驱动右侧服务项表格；默认展示第一个批次。
const selectedDecompositionBatch = ref('')
const activeDecompositionBatch = computed(() => selectedDecompositionBatch.value || decompositionBatches.value[0]?.[0] || '')
const visibleDecompositionItems = computed(() => {
  const batch = activeDecompositionBatch.value
  return batch ? currentDecompositionItems.value.filter((item) => (item.batch || '未设置批次') === batch) : currentDecompositionItems.value
})
watch(decompositionBatches, (batches) => {
  if (selectedDecompositionBatch.value && !batches.some(([batch]) => batch === selectedDecompositionBatch.value)) selectedDecompositionBatch.value = ''
})
const riskRows = computed(() => [
  ...pendingDeviations.value.map((event) => { const item = itemByID.value.get(event.service_item_id); const project = projectByID.value.get(item?.project_id); return { id: event.id, level: event.payload?.severity === 'HIGH' ? '高' : '中', project: `${project?.id || item?.project_id || '未知项目'} · ${project?.customer || item?.site || '现场任务'}`, issue: event.payload?.description || '现场偏离待评审', owner: personLabel(event.actor_user_id, '待认领'), deadline: formatDateTime(event.created_at) } }),
  ...serviceItems.value.filter((item) => item.conflict_status === 'CONFLICT').map((item) => { const project = projectByID.value.get(item.project_id); return { id: `conflict-${item.id}`, level: '高', project: `${item.project_id} · ${project?.customer || item.site}`, issue: `${item.id} 人员或设备能力冲突`, owner: personLabel(item.project_manager_id || item.team_lead_id, '待分配'), deadline: formatBusinessDate(item.planned_start) || '待处理' } }),
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
  allocation: allocationItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.category}`, detail: `${s.site} / ${s.batch}`, warning: stampedContractStateByProject.value.get(s.project_id) === false ? '未上传盖章合同' : '', owner: personLabel(s.team_lead_id, '待分配团队负责人'), state: s.conflict_status === 'CONFLICT' ? '能力冲突' : s.team_lead_id ? '已分配' : '待分配', progress: s.project_manager_id ? 100 : s.team_lead_id ? 50 : 0, due: formatBusinessDate(s.planned_end) || '待排期' })),
  inbox: inboxItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${projectByID.value.get(s.project_id)?.customer || s.site}`, detail: s.project_manager_id ? '实施工程师待指派' : '项目经理待指派', owner: personLabel(s.team_lead_id, '—'), state: '待处理', progress: s.project_manager_id ? 50 : 0, due: formatBusinessDate(s.planned_start) || '待排期' })),
  planning: planningItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.site}`, detail: s.test_mode === 'PENETRATION' ? '渗透测试专项计划' : '现场实施计划', owner: personLabel(s.project_manager_id, '待指派项目经理'), state: latestWorkflowEvent(s)?.type === 'IMPLEMENTATION_PLAN_REVOKED' ? '已撤销，待重新制定' : '待制定计划', progress: 0, due: '待排期' })),
  preparation: preparationItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.site}`, detail: s.status === '实施准备中' ? '现场已回退，请重新核验设备与行程' : '实施计划已发布，待准备', owner: personLabel(s.project_manager_id, '待指派项目经理'), state: s.status, progress: s.status === '实施准备中' ? 50 : 0, due: formatBusinessDate(s.planned_end) || '待排期' })),
  qualifications: capabilities.value.map((c) => ({ id: c.resource_id, name: c.resource_name, detail: c.codes, owner: c.resource_type === 'PERSON' ? '人员资质' : '设备能力', state: capabilityStatusLabel(c), warning: c.status_reason || '', progress: capabilityEffectiveStatus(c) === 'ACTIVE' ? 100 : 0, due: c.resource_type === 'PERSON' ? '不限制' : formatBusinessDate(c.valid_until) || '长期' })),
  assignments: assignmentItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.site}`, detail: `${s.engineer_ids?.length || 0} 人 / ${(s.implementation_plan?.equipment || []).length} 台设备`, owner: personLabel(s.project_manager_id), state: s.conflict_status === 'CONFLICT' ? '排期冲突' : '待校验', progress: 30, due: '待排期' })),
  methods: methodItems.value.map((s) => ({ id: s.id, name: `${s.id} · ${s.category}`, detail: `${s.site} / ${s.system || '—'}`, owner: personLabel(s.project_manager_id), state: reportTechReviewLabel(s.tech_review_status), progress: s.tech_review_status === 'PENDING' ? 50 : 0, due: formatBusinessDate(s.planned_end) || '待排期', review: s.tech_review_status, comment: s.tech_review_comment, reviewedAt: s.tech_reviewed_at })),
  exceptions: pendingDeviations.value.map((e) => ({ id: e.id, name: `${e.payload?.deviation_id} · ${e.service_item_id}`, detail: e.payload?.description || '现场偏离', owner: personLabel(e.actor_user_id, '—'), state: '待评审', progress: 0, due: formatDateTime(e.created_at) })),
  standards: [],
  reports: reportItems.value.map((item) => { const project = projectByID.value.get(item.project_id); return { id: item.id, name: `${item.id} · ${item.site}`, detail: `${project?.customer || item.project_id} / 报告${reportStatusLabel[item.report_status] || item.report_status}`, owner: personLabel(item.project_manager_id, project?.manager || '待指派'), state: reportStatusLabel[item.report_status] || item.report_status, progress: (reportStatusRank[item.report_status] || 0) * 20, due: item.report_updated_at ? formatBusinessDate(item.report_updated_at) || '待排期' : formatBusinessDate(item.planned_end) || '待排期', report_status: item.report_status } }),
}[activeSection.value] || []))

const rules = ref([])
function applicationRoleLabel(roleCode) {
  const code = String(roleCode || '').trim()
  return applicationRoles.value.find((role) => role.code === code)?.name || code || '—'
}
function decorateRule(rule) {
  return {
    ...rule,
    resource_type_label: rule.check_type === 'PERSON' ? '人员资质' : rule.check_type === 'EQUIPMENT' ? '设备能力' : rule.check_type,
    target_label: applicationRoleLabel(rule.target),
    role_label: applicationRoleLabel(rule.role_code),
    field_label: permissionFieldLabel(rule.field_name),
    access_level_label: fieldPermissionAccessLevelLabel[rule.access_level] || rule.access_level,
  }
}
const visibleRules = computed(() => rules.value.filter((rule) => rule.kind === activeSection.value))

// 资质 / 能力编码由租户级系统配置统一供给人员资质和设备能力表单。
// 已停用或已删除但仍被历史档案引用的编码会补回到选项并显式标记，
// 避免编辑其他字段时把历史编码静默丢失。
const capabilityCodeCatalog = computed(() => rules.value.filter((rule) => rule.kind === 'capability-codes' && String(rule.scope || '').trim()))
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
    { label: '完成确认', state: closing ? 'done' : 'idle', note: plan.planned_end ? `计划至 ${formatBusinessDate(plan.planned_end)}` : '' },
  ]
})

// 报告必须先整改，再依次完成编制、审核、签发与归档。
const reportSteps = computed(() => {
  const item = selectedServiceItem.value
  const current = reportStatusRank[item?.report_status] || 0
  return [
    { phase: 'RECTIFYING', label: '报告整改' },
    { phase: 'COMPILING', label: '报告编制' },
    { phase: 'REVIEWED', label: '报告审核' },
    { phase: 'ISSUED', label: '报告签发' },
    { phase: 'ARCHIVED', label: '报告归档' },
  ].map((step, index) => ({ ...step, state: index + 1 < current ? 'done' : index + 1 === current ? 'doing' : 'idle' }))
})

const {
  monitorFilter, monitoringSnapshot, monitoringLoading, monitoringError, monitorPage, monitorPageSize,
  monitorCategory, monitorProjectManager, monitorSLAOnly, monitorConflictOnly, monitorDueFrom, monitorDueTo,
  monitorFilterTabs, monitoredStatusMix, monitoredStatusByProject, monitoringRows, monitoringTotalPages,
  monitoringUpdatedLabel, monitoringLagSeconds,
  monitoringParams, loadMonitoring, scheduleMonitoringPoll, onMonitoringVisibility,
  resetMonitoringFilters, changeMonitoringPage, openMonitoringAction,
} = useProjectMonitoring({ activeSection, keyword, teamFilter, loadPersonnelNames, navigate, openProject })

// 人员姓名按需读取：汇总当前已加载业务记录引用的人员 ID（服务项、交付事件、监控快照），
// 只解析其中尚未解析的 ID；租户/用户/授权代次变化或工作区刷新后重新确认。
const referencedPersonnelIDs = computed(() => {
  const ids = []
  const push = (value) => {
    const id = String(value || '').trim()
    if (id) ids.push(id)
  }
  for (const item of serviceItems.value) {
    push(item.team_lead_id)
    push(item.project_manager_id)
    for (const id of item.engineer_ids || []) push(id)
  }
  for (const event of deliveryEvents.value) push(event.actor_user_id)
  for (const row of monitoringRows.value) for (const id of row.project_manager_ids || []) push(id)
  for (const event of monitoringSnapshot.value.recent_events || []) push(event.actor_user_id)
  return ids
})
const personnelNames = useProjectPersonnelNames({
  context: sectionDataContext,
  readIDs: () => referencedPersonnelIDs.value,
  resolve: resolvePersonnelNames,
  describe: (cause, fallback) => subsystemAccessMessage(cause, fallback),
})
// 模板直接消费展平的读取态：姓名映射/错误/加载中都是独立的辅助数据状态。
const { names: personnelNameByID, loading: personnelNamesLoading, error: personnelNamesError } = personnelNames
watch(referencedPersonnelIDs, () => { void personnelNames.load() })

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
const permissionLevelLabel = fieldPermissionAccessLevelLabel
const permissionLevelTone = { hidden: '风险', edit: '关注', view: 'normal' }
const operationDetail = ref(null)

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
      { label: '状态', value: `${capabilityStatusLabel(record)}${record.status_reason ? `（${record.status_reason}）` : ''}` },
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
      { label: '团队负责人', value: projectAssignmentPeople(record.id).teamLeads },
      { label: '项目经理', value: projectAssignmentPeople(record.id).projectManagers },
      { label: '当前状态', value: record.status || detail.row.state || '—' },
      { label: '计划完成', value: record.due || detail.row.due || '待排期' },
    ]
  }
  return []
})

// 写操作后的随动刷新统一走 refreshAfterWrite：loadWorkspace 仅在默认（reportError=true）
// 时把失败写入页面错误区；reportError=false 用于写后刷新——静默上抛，由调用方以
// “已保存，但最新数据读取失败”的准确文案提示，不把整个工作区替换成错误页。
const workspaceScope = createRequestScope()
const workspaceReady = ref(false)
const { loading: sectionExtrasLoading, error: sectionExtrasError, load: loadSectionExtras } = useProjectSectionData({
  section: activeSection, context: sectionDataContext, ready: workspaceReady,
  allowed: (section) => navigation.value.sections.includes(section)
    || (section === 'project_detail' && navigation.value.sections.includes('projects')),
  loaders: { events: () => listDeliveryEvents(), dashboard: () => getDashboard(), catalog: () => listRuleConfigurationCatalog() },
  apply: (data) => {
    if (data.events) { deliveryEvents.value = data.events; sectionEventsReady.value = true }
    if (data.dashboard) dashboard.value = data.dashboard
    if (data.catalog) {
      // 配置字段持有目录数组引用，原地更新才能让已构建的表单获得新选项。
      automationTriggerOptions.value.splice(0, automationTriggerOptions.value.length, ...data.catalog.automation_triggers)
      slaStatusOptions.value.splice(0, slaStatusOptions.value.length, ...data.catalog.sla_statuses)
    }
  },
  reset: () => {
    deliveryEvents.value = []
    sectionEventsReady.value = false
    dashboard.value = { pending_project_creation_available: false }
    automationTriggerOptions.value.splice(0)
    slaStatusOptions.value.splice(0)
  },
})
// 设备目录与设备维护状态（阶段 3-项目）：目录只在进入「设备能力」「实施准备」或打开
// 设备候选选择器时确认；维护成功后失效并在下次使用重新读取。主页面仍持有导航、会话、
// 核心快照与写后刷新协调，组合式只消费注入的能力。
const {
  equipment, equipmentLoading, equipmentError, equipmentConfirmed,
  ensureEquipmentCatalog, retryEquipmentCatalog, invalidateEquipmentCatalog,
  equipmentForm, equipmentImportOpen, equipmentCodeSelection, equipmentCodeOptions, toggleEquipmentCode,
  editEquipment, saveEquipment, removeEquipment, returnEquipment, importEquipmentFile,
} = useProjectEquipment({
  context: sectionDataContext,
  saving,
  canManage: canManageDevice,
  askConfirm,
  notify: showToast,
  closeMulti: () => { openMulti.value = '' },
  describeError: (cause, fallback) => subsystemAccessMessage(cause, fallback),
  codeOptions: (selectedCodes) => capabilityCodeOptions('EQUIPMENT', selectedCodes),
  canonicalCodes: (codes) => canonicalCapabilityCodes('EQUIPMENT', codes),
  validateCodes: (codes, originalCodes) => validateCapabilityCodes('EQUIPMENT', codes, originalCodes),
  formatDate: formatBusinessDate,
  reservationFor: (resourceID) => equipmentReservationByID.value.get(resourceID),
  reloadReservations: () => loadEquipmentReservations(selectedServiceItem.value),
  listEquipment, upsertEquipment, deleteEquipment, returnServiceItemEquipment,
})
// SLA 超期明细是监控区域的辅助数据：只在进入监控区域或显式刷新时读取。
// 口径仍由服务端统一计算；读取失败必须显示「不可用」，不能渲染成「没有超期」。
const {
  loading: slaOverdueLoading,
  error: slaOverdueError,
  confirmed: slaOverdueConfirmed,
  load: loadSlaOverdueDetails,
  invalidate: invalidateSlaOverdue,
} = useProjectAuxiliaryResource({
  context: sectionDataContext,
  loader: () => listSlaOverdue(),
  apply: (rows) => { slaOverdueItems.value = Array.isArray(rows) ? rows : [] },
  reset: () => { slaOverdueItems.value = [] },
  describe: (cause, fallback) => subsystemAccessMessage(cause, fallback),
})

// 设备目录尚未确认（未读取/维护后失效）时按读取中呈现，避免显示成「暂无设备」。
const equipmentCatalogPending = computed(() => !equipmentConfirmed.value && !equipmentError.value)
// SLA 明细尚未确认时同样按读取中呈现，避免把「未知」说成「没有超期」。
const slaOverduePending = computed(() => !slaOverdueConfirmed.value && !slaOverdueError.value)
// 用途：刷新后按当前区域重新确认辅助数据；未进入的区域不发请求（保持按需读取）。
// 参数：无。
// 返回值：无；失败由各资源自己的错误态与重试入口承担，不阻断工作区。
// 说明：设备占用由 selectedServiceItem 的监听在快照替换后读取，这里不重复发起。
function refreshSectionAuxiliary() {
  if (!workspaceReady.value) return
  const section = activeSection.value
  if (['equipment', 'preparation'].includes(section)) void ensureEquipmentCatalog()
  if (section === 'monitoring') void loadSlaOverdueDetails()
}

// 用途：监控区域的显式刷新（同时刷新服务端快照与 SLA 明细）。
// 参数：无。
// 返回值：无；两者各自维护加载态与错误态。
function refreshMonitoringSnapshot() {
  void loadSlaOverdueDetails({ force: true })
  void loadMonitoring()
}

// 用途：SLA 明细的显式刷新/失败重试。
// 参数：无。
// 返回值：无；失败保持「不可用」并显示重试入口。
function refreshSlaDetails() { void loadSlaOverdueDetails({ force: true }) }

// 用途：人员姓名读取失败后的重试入口（姓名只影响可读性，不阻断页面）。
// 参数：无。
// 返回值：无。
function retryPersonnelNames() { void personnelNames.retry() }

// 用途：刷新核心原子快照，再读取当前已授权栏目的依赖。
// 参数：reportError 控制读取失败是否显示为工作区错误。
// 返回值：读取完成；写后刷新失败仍交由既有调用方区分已保存结果。
async function loadWorkspace({ reportError = true } = {}) {
  const ticket = workspaceScope.begin('WORKSPACE')
  workspaceReady.value = false
  loading.value = true
  loadError.value = ''
  ruleConfigurationCatalogError.value = ''
  let loaded = false
  try {
    // 项目、服务项和规则共同构成当前工作区快照；三者全部成功后才一次性替换页面状态，
    // 防止新旧数据混用。接口层仍分别执行会话与资源权限校验。
    // 列表接口省略 page_size 时只返回 20 行，工作区必须显式走 all=1 快照；
    // 超过服务端 500 行上限时 truncated 为 true，用户据此提示缩小筛选范围。
    const sessionData = await getProjectSession({ force: true })
    if (!workspaceScope.isCurrent(ticket)) return
    session.value = sessionData
    if (!sessionData.permissions?.includes('project.read')) {
      projects.value = []; serviceItems.value = []; rules.value = []; capabilities.value = []
      navigation.value = { sections: [], default_section: 'expense-entry', roles: [] }
      workspaceReady.value = true
      return
    }
    const [projectSnapshot, itemSnapshot, ruleRows, capabilityRows, navigationData, categoryRows,
    ] = await Promise.all([
      listProjectsSnapshot(), listServiceItemsSnapshot(), listRules(), listCapabilities(),
      getProjectNavigation(), listDetectionCategories(),
    ])
    if (!workspaceScope.isCurrent(ticket)) return
    projects.value = projectSnapshot.items
    serviceItems.value = itemSnapshot.items.map((item) => ({ ...item, selected: ['待确认', '待复核'].includes(item.status) }))
    workspaceTruncated.value = Boolean(projectSnapshot.truncated || itemSnapshot.truncated)
    rules.value = ruleRows.map(decorateRule)
    capabilities.value = capabilityRows
    session.value = sessionData
    navigation.value = navigationData
    detectionCategories.value = categoryRows
    // 侧栏账号行的角色名依赖服务端角色目录；不阻塞工作区首屏，失败只影响副标题文案。
    loadApplicationRoles()
    void loadPersonnel()
    void refreshNotificationCount()
    // 拆解规则配置由独立接口提供（不属于六类规则表），进入页面时按需加载。
    if (activeSection.value === 'split-rules') loadSplitConfig()
    const allowed = new Set(navigationData.sections)
    // 项目详情是从列表下钻的页面（携带 query.project），不要求出现在服务端导航清单里。
    if (route.params.section !== 'project_detail' && !allowed.has(route.params.section)) {
      await router.replace({ name: 'project_management', params: { section: navigationData.default_section || navigationData.sections[0] || 'dashboard' } })
    }
    lastUpdatedAt.value = new Date()
    workspaceReady.value = true
    const extrasLoaded = await loadSectionExtras()
    if (!workspaceScope.isCurrent(ticket)) return
    if (!extrasLoaded && !reportError) throw new Error('当前栏目依赖数据读取失败。')
    loaded = true
  } catch (error) {
    // 迟到的旧请求失败不得代表当前上下文报错；写后随动刷新（reportError=false）静默上抛，
    // 由 refreshAfterWrite 用准确文案上报，不误报为操作失败。
    if (!workspaceScope.isCurrent(ticket)) return
    if (!reportError) throw error
    loadError.value = subsystemAccessMessage(error, '项目管理数据加载失败。')
  } finally {
    // 只有仍持有当前票据的请求才能结束 loading，避免旧请求的 finally 关闭新请求的加载态。
    if (workspaceScope.isCurrent(ticket)) loading.value = false
  }
  // 设备目录、人员姓名与 SLA 明细都不在首屏预读：设备目录在进入相关区域/打开候选
  // 选择器时确认，姓名只在出现未解析 ID 时合并读取，SLA 明细只在监控区域读取。
  // 工作区刷新后现场证据可能已变化（现场操作、报告推进），判定必须重新拉取；
  // 失败只影响"能否完成"这一步（界面转"未知"），不阻断工作区本身。
  if (loaded) await refreshSelectedFieldEvidence()
}

// 任务 B：计划/现场/报告的写操作 HTTP 2xx 即已保存。随后的工作区刷新失败只提示
// “已保存，但最新数据读取失败”，不误报为操作失败、不回退任何已提交结果，也不自动重发写请求；
// 页面保留旧快照，由用户手动刷新核对。
async function refreshAfterWrite() {
  try {
    await loadWorkspace({ reportError: false })
  } catch {
    showToast('已保存，但最新数据读取失败；请稍后点击刷新核对，勿凭旧页面重复提交。', 'warning')
  }
}

// refreshSelectedFieldEvidence 拉取当前服务项的现场证据判定（BIZ-PROJECT-06）。
// 现场操作同步成功后必须重新拉取：本地队列与事件流都是判定输入，旧结论不能沿用。
// 拉取失败时清空快照并记录原因——界面据此显示"未知"，完成动作按 fail-closed 拒绝。
async function refreshSelectedFieldEvidence({ reportError = false } = {}) {
  const itemID = selectedServiceItem.value?.id || ''
  const ticket = fieldEvidenceScope.begin(`FIELD_EVIDENCE:${itemID}`)
  if (!itemID) {
    fieldEvidenceSnapshot.value = null
    fieldEvidenceError.value = ''
    fieldEvidenceLoading.value = false
    return
  }
  fieldEvidenceLoading.value = true
  try {
    const evidence = await getServiceItemFieldEvidence(itemID)
    if (!fieldEvidenceScope.isCurrent(ticket)) return
    const snapshot = normalizeServiceItemFieldEvidence(evidence, itemID)
    if (!snapshot) {
      // 响应结构不可用等同于判定不可用：不能把空对象当成"证据齐全"。
      fieldEvidenceSnapshot.value = null
      fieldEvidenceError.value = '服务端未返回有效的缺项判定'
      return
    }
    fieldEvidenceSnapshot.value = snapshot
    fieldEvidenceError.value = ''
  } catch (error) {
    if (!fieldEvidenceScope.isCurrent(ticket)) return
    fieldEvidenceSnapshot.value = null
    fieldEvidenceError.value = formatUserError(error, { fallback: '缺项判定读取失败' })
    if (reportError) showToast(`${fieldEvidenceError.value}；完成动作已暂停，请重新读取后再确认。`, 'warning')
  } finally {
    if (fieldEvidenceScope.isCurrent(ticket)) fieldEvidenceLoading.value = false
  }
}

// loadPersonnelNames 把当前工作区引用的平台 user_id 批量解析成姓名：
// 团队负责人、项目经理、工程师以及操作人都不应该在界面上显示成 ULID。
// 名称解析是辅助数据：只合并读取“已加载记录里未解析的 ID”，失败降级为占位符并保留重试入口。
function loadPersonnelNames() { return personnelNames.load() }

async function openCreateProject() {
  try {
    // 浏览器只调用项目后端；项目后端通过机器身份读取合同审批结果，避免要求业务管理员
    // 额外建立合同系统浏览器会话或持有合同读取权限。
    // 选择器首屏只取一页（50 条）并可继续搜索/加载更多：超过 200 份合同时
    // 窗口外的合同仍然可达，不再被静默丢弃。
    approvedContracts.value = []
    approvedContractsError.value = ''
    approvedContractSearchKeyword.value = ''
    approvedContractSearchNextAfterID.value = ''
    selectedApprovedContract.value = null
    createForm.value = emptyCreateForm()
    approvedContractServiceItems.value = []
    selectedContractServiceIDs.value = []
    contractServicesError.value = ''
    await loadApprovedContractOptions({ keyword: '' })
    if (!approvedContractOptions.value.length && !approvedContractSearchNextAfterID.value) {
      approvedContractsError.value = '当前没有尚未建立项目的已审批合同。每个合同只能建立一个项目（按合同身份判定，状态/版本变化不会释放重复建项）；如需新增范围请在「服务项拆解确认」中走补充协议调整。'
    }
    // 没有可用合同时仍打开弹窗并说明原因，避免点击后只有短暂提示、看起来像“按钮不可用”。
    createOpen.value = true
  } catch (error) {
    showToast(formatUserError(error, { fallback: '读取已审批合同失败，请稍后重试' }), error?.status === 503 ? 'warning' : 'error')
  }
}

// loadApprovedContractOptions 拉取一页可选合同：append=false 为新一轮搜索结果，
// append=true 沿用当前游标继续加载。错误会写入 approvedContractsError 并向上抛出，
// 由调用方决定是提示还是静默（搜索过程中只更新弹窗内提示）。
async function loadApprovedContractOptions({ keyword = '', append = false } = {}) {
  const requestID = ++approvedContractSearchRequest
  const afterID = append ? approvedContractSearchNextAfterID.value : ''
  approvedContractSearchLoading.value = true
  try {
    const page = await searchApprovedContractOptions({ keyword, afterId: afterID, limit: APPROVED_CONTRACT_OPTION_LIMIT })
    if (requestID !== approvedContractSearchRequest) return
    // 同一合同可能因已建项在后续页被过滤，前端按合同身份去重，避免重复选项。
    const merged = append ? [...approvedContracts.value, ...page.contracts] : page.contracts
    const seen = new Set()
    approvedContracts.value = merged.filter((contract) => {
      const key = String(contract.id || '').trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    approvedContractSearchNextAfterID.value = page.next_after_id
    approvedContractsError.value = ''
  } catch (error) {
    if (requestID === approvedContractSearchRequest) {
      if (!append) approvedContracts.value = []
      approvedContractSearchNextAfterID.value = ''
      approvedContractsError.value = formatUserError(error, { fallback: '读取已审批合同失败，请稍后重试' })
    }
    throw error
  } finally {
    if (requestID === approvedContractSearchRequest) approvedContractSearchLoading.value = false
  }
}

// 输入防抖 300ms：逐字输入不会逐字打服务端，只保留最后一次关键字。
function onApprovedContractSearch(keyword) {
  approvedContractSearchKeyword.value = String(keyword || '')
  if (approvedContractSearchTimer) clearTimeout(approvedContractSearchTimer)
  approvedContractSearchTimer = setTimeout(() => {
    approvedContractSearchTimer = null
    loadApprovedContractOptions({ keyword: approvedContractSearchKeyword.value }).catch(() => {})
  }, 300)
}

function loadMoreApprovedContractOptions() {
  if (!approvedContractSearchNextAfterID.value || approvedContractSearchLoading.value) return
  loadApprovedContractOptions({ keyword: approvedContractSearchKeyword.value, append: true }).catch(() => {})
}

function onApprovedContractChange(contractID) {
  const contract = approvedContracts.value.find((item) => item.id === contractID) || null
  selectedApprovedContract.value = contract
  // 选中后沿用既有目录读取：合同服务范围仍由合同管理按 contract_id 权威回读。
  selectApprovedContract(contract)
}
// 后端按「租户 + 合同身份（合同 ID；历史空 ID 回退合同号）」过滤已建项合同；
// 这里基于当前列表再做一层展示防护，避免刷新期间已出现于本页的合同短暂进入选择器。
// 普通合同版本只用于展示/审计，不作为建项身份，状态变化不会释放重复建项。
const builtContractKeys = computed(() => {
  const keys = new Set()
  for (const project of projects.value) {
    for (const value of [project.contract_id, project.contract]) {
      const identity = String(value || '').trim()
      if (identity) keys.add(identity)
    }
  }
  return keys
})

const availableApprovedContracts = computed(() => approvedContracts.value.filter((contract) =>
  ![contract.id, contract.contract_number].some((value) => builtContractKeys.value.has(String(value || '').trim()))))

// 选择器选项：服务端已排除已建项合同，这里仍按当前项目列表再兜一层，
// 并补上当前选中项——关键字变化后选中项可能不在本页，触发器必须显示已选合同。
const approvedContractOptions = computed(() => {
  const options = availableApprovedContracts.value.map((contract) => ({
    id: contract.id,
    label: contractOptionLabel(contract),
    description: [contract.status === 'active' ? '已生效' : '已审批', contract.version ? `版本 ${contract.version}` : ''].filter(Boolean).join(' · '),
  }))
  const selected = selectedApprovedContract.value
  if (selected && !options.some((option) => option.id === selected.id)) {
    options.unshift({ id: selected.id, label: contractOptionLabel(selected), description: '当前已选合同' })
  }
  return options
})
const approvedContractEmptyText = computed(() => (approvedContractSearchKeyword.value.trim()
  ? '没有匹配的已审批合同，可换合同编号、标题或客户名再试'
  : '没有尚未建立项目的已审批合同'))


async function selectApprovedContract(contract) {
  const requestID = ++contractServiceRequest
  approvedContractServiceItems.value = []
  selectedContractServiceIDs.value = []
  contractServicesError.value = ''
  if (!contract) {
    createForm.value.contractID = ''
    createForm.value.contractVersion = ''
    createForm.value.contract = ''
    createForm.value.customer = ''
    return
  }
  createForm.value.contractID = contract.id || ''
  createForm.value.contractVersion = String(contract.version || '')
  createForm.value.contract = contract.contract_number || ''
  createForm.value.customer = contract.customer_name || ''
  contractServicesLoading.value = true
  try {
    const catalog = await getApprovedContractServiceItems(contract.id)
    if (requestID !== contractServiceRequest || createForm.value.contractID !== contract.id) return
    if (catalog.contract_id !== contract.id || String(catalog.contract_version || '') !== String(contract.version || '')) {
      throw new Error('合同服务范围已更新，请刷新已审批合同后重新选择')
    }
    approvedContractServiceItems.value = catalog.service_items
    selectedContractServiceIDs.value = catalog.service_items.map((item) => item.source_id).filter(Boolean)
    if (!catalog.service_items.length) contractServicesError.value = '该合同没有可关联的服务项，请先在合同管理系统中补全服务范围'
  } catch (error) {
    if (requestID !== contractServiceRequest) return
    contractServicesError.value = formatUserError(error, { fallback: '读取合同服务范围失败，请稍后重试' })
    showToast(contractServicesError.value, 'error')
  } finally {
    if (requestID === contractServiceRequest) contractServicesLoading.value = false
  }
}
// 设备维护动作（编辑/保存/删除/归还/导入）由 useProjectEquipment 持有：
// 写成功后使设备目录失效并重新确认；读取失败按「已保存但读取失败」提示，不重发写入。
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
function openCapabilityDialog(item) {
  if (item && item.resource_type !== 'PERSON') {
    showToast('设备请在「设备能力」中新建或维护', 'error')
    return
  }
  capabilityAutoID.value = !item
  const codes = item ? canonicalCapabilityCodes('PERSON', item.codes || []) : []
  capabilityDialog.value = item
    ? { resource_type: 'PERSON', resource_id: item.resource_id, resource_name: item.resource_name, user_id: item.user_id || '', codes, original_codes: [...codes], status: item.status || 'ACTIVE' }
    : { resource_type: 'PERSON', resource_id: nextResourceID('PERSON'), resource_name: '', user_id: '', codes: [], original_codes: [], status: 'ACTIVE' }
  openMulti.value = ''
  void loadCapabilityPersonnel()
}

async function saveCapability() {
  if (!capabilityDialog.value) return
  if (!validateCapabilityCodes('PERSON', capabilityCodeSelection.value, capabilityDialog.value.original_codes || [])) return
  saving.value = true
  try {
    const form = capabilityDialog.value
    const payload = {
      resource_type: 'PERSON',
      resource_id: form.resource_id,
      resource_name: form.resource_name,
      user_id: form.user_id,
      codes: [...capabilityCodeSelection.value],
      status: form.status,
    }
    const saved = await upsertCapability(payload)
    capabilities.value = [saved, ...capabilities.value.filter((row) => !(row.resource_type === saved.resource_type && row.resource_id === saved.resource_id))]
    capabilityDialog.value = null
    showToast('人员资质已保存')
  } catch (error) { showToast(formatUserError(error, { fallback: '资质保存失败' }), 'error') }
  finally { saving.value = false }
}

async function importQualificationFile(result) {
  importResult.value = result
  showToast(`导入完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条`)
  try {
    capabilities.value = await listCapabilities()
  } catch (error) { showToast(`导入已完成，但台账刷新失败。${formatUserError(error, { fallback: '请手动刷新核对结果，勿重复导入。' })}`, 'warning') }
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
    showToast(formatUserError(error, { fallback: '人员状态复核失败' }), 'error')
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
  } catch (error) { showToast(formatUserError(error, { fallback: 'CSV 导出失败' }), 'error') }
}

let projectListScrollY = 0

function navigate(section) {
  if (section === 'projects' && typeof window !== 'undefined') {
    nextTick(() => window.scrollTo({ top: projectListScrollY, behavior: 'auto' }))
  }
  router.push({ name: 'project_management', params: { section } })
  mobileMenuOpen.value = false
  // 拆解规则配置来自独立接口：切到该页签时按需加载，避免影响其它工作区的首屏。
  if (section === 'split-rules') loadSplitConfig()
}

// 项目详情是从列表/看板下钻的独立页面（原型 PG-PRJ-02），不在侧边栏导航里，
// 通过 query.project 携带项目编号，可直接深链与刷新恢复。
function openProject(project) {
  if (!project) return
  if (typeof window !== 'undefined') projectListScrollY = window.scrollY || 0
  router.push({ name: 'project_management', params: { section: 'project_detail' }, query: { project: project.id } })
}
function openProjectTimeline(project) {
  detailTab.value = 'events'
  openProject(project)
}
const detailProject = computed(() => {
  const id = String(route.query.project || '')
  return projects.value.find((project) => project.id === id) || null
})
// 只在身份、项目或读取授权变化时销毁工作区；普通刷新不丢弃未知写结果的原操作号。
watch([
  () => detailProject.value?.id,
  () => principalIdentityID(session.value),
  () => session.value?.tenant_id,
  canReadNativeProjectScope,
], () => { nativeScopeProjectID.value = '' })

// 用途：刷新已提交的原生范围与服务项，不重发提案或审批。
// 参数：change为真实持久提案回执。
// 返回值：异步完成；读取失败保留既有已保存提示。
async function onNativeScopeChanged(change) {
  const status = { PENDING: '已提交，待审批', APPROVED: '已批准生效，请重新确认拆解', REJECTED: '已驳回', WITHDRAWN: '已撤回' }[change?.status] || '已保存'
  showToast(`原生范围提案 ${change?.id || ''}${status}`)
  await refreshAfterWrite()
}

// 项目详情是拆解已推进、无法再重建清单时唯一还能看到关账入口的地方，因此同样按
// supplement_status 与 project.decomposition.manage 双重门控，缺权限时说明原因。
const detailSupplementClosure = computed(() => supplementClosureAvailability(detailProject.value, permissionSet.value))
const detailItems = computed(() => detailProject.value ? serviceItems.value.filter((item) => item.project_id === detailProject.value.id) : [])
const detailEvents = computed(() => detailProject.value ? projectEvents(detailProject.value) : [])
const detailPendingDeviations = computed(() => pendingDeviations.value.filter((event) => detailItems.value.some((item) => item.id === event.service_item_id)))
const detailTab = ref('items')
const detailTabKeys = new Set(['items', 'plan', 'events', 'exceptions'])
useUrlFilterState({
  route,
  router,
  fields: { tab: detailTab },
  normalize: (value, name) => name === 'tab' && !detailTabKeys.has(value) ? 'items' : value,
})
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
      window: `${formatBusinessDate(item.planned_start)} ~ ${formatBusinessDate(item.planned_end)}`,
    }
  })
})

function returnToUnifiedPortal() {
  mobileMenuOpen.value = false
  closeNotifications()
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
    showToast(formatUserError(error, { fallback: '退出系统失败，请稍后重试。' }), 'error')
  } finally {
    isLoggingOut.value = false
  }
}

// toast 带语义类型：success/error/warning/info，图标底色随类型切换（§18.11）。
function showToast(message, type = 'success') {
  toastMessage.value = formatUserError(message, { fallback: '操作未完成，请核对页面信息；仍失败时请联系管理员。' })
  toastType.value = type
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastMessage.value = '' }, 5200)
}


function projectEvents(project) {
  const itemIDs = new Set(serviceItems.value.filter((item) => item.project_id === project.id).map((item) => item.id))
  return deliveryEvents.value.filter((event) => event.project_id === project.id || itemIDs.has(event.service_item_id)).slice(0, 5)
}


function toggleRow(id) {
  selectedRows.value = selectedRows.value.includes(id) ? selectedRows.value.filter((item) => item !== id) : [...selectedRows.value, id]
}
async function confirmDecomposition() {
  if (saving.value) return
  const ids = currentDecompositionItems.value.filter((item) => item.selected).map((item) => item.id)
  if (!ids.length) { showToast('请至少选择一个服务项', 'warning'); return }
  saving.value = true
  try {
    // 只依据服务端返回的已变更服务项更新本地列表；未返回的行保持原状态，避免把整批
    // 请求都乐观标记为成功。
    const changed = await confirmServiceItemsRequest(ids)
    const byID = new Map(changed.map((item) => [item.id, item]))
    serviceItems.value = serviceItems.value.map((item) => byID.has(item.id) ? { ...byID.get(item.id), selected: false } : item)
    // 确认拆解会推进**项目派生状态**（待拆解确认 → 待分配）。只更新服务项列表会让项目快照停在
    // 旧节点，页面按项目节点过滤时下一步（分配）不可见，必须重新拉取工作区。
    showToast(`已确认 ${ids.length} 个服务项，任务已进入分配队列`)
    await refreshAfterWrite()
  } catch (error) { showToast(formatUserError(error, { fallback: '确认失败' }), 'error') }
  finally { saving.value = false }
}

// 调整拆解：服务端在同一事务里替换该项目的全部服务项并要求所有项仍处于待确认/待复核，
// 因此入口只在拆解阶段可用，成功后项目进入「补充协议处理中」。

const {
  adjustOpen, adjustForm, supplementContracts, adjustProjectID,
  openDecompositionAdjust, addAdjustItem, removeAdjustItem, submitDecompositionAdjust,
} = useDecompositionAdjust({
  decompositionProject, detectionCategories, activeDetectionCategoryOptions, supplementContractOptions,
  saving, showToast, formatUserError, refreshAfterWrite,
})

// 补充协议关账：拆解已推进、无法再重建清单时的受控出口。候选合同复用补充协议目录，
// 二次确认由共享 ConfirmDialog 承载，成功后随工作区刷新回读项目状态与列表。
const {
  closureOpen, closureProject, closureContracts, closureForm,
  closureLoading, closureLoadError, closureSaving, closureError,
  openSupplementClosure, closeSupplementClosure, reloadSupplementClosure, submitSupplementClosure,
} = useSupplementClosure({
  closeSupplement, listSupplementContracts, formatUserError, showToast, refreshAfterWrite, askConfirm,
  closureAllowed: (project) => !saving.value && supplementClosureAvailability(project, permissionSet.value).allowed,
})

async function toggleRule(rule) {
  const next = !rule.enabled
  try {
    // 不预先翻转开关，等待带有最新版本语义的服务端结果后再覆盖当前行。
    const updated = await setRuleEnabled(rule.id, rule.kind || activeSection.value, next)
    Object.assign(rule, updated)
    showToast(rule.kind === 'standards' ? (next ? '标准变更已恢复评估' : '标准变更评估已完成并归档') : (next ? '规则已启用' : '规则已停用'))
  } catch (error) { showToast(formatUserError(error, { fallback: rule.kind === 'standards' ? '标准变更状态更新失败' : '规则更新失败' }), 'error') }
}

// 删除配置规则。停用开关是可逆操作，删除不可恢复，因此必须二次确认；kind 必填，
// 六套配置表主键各自自增，只按 id 删会命中别的配置类型。删除按钮与新建、编辑同权限门控。
async function removeConfigRule(rule) {
  if (saving.value) return
  const kind = rule.kind || activeSection.value
  const ok = await askConfirm({
    title: '删除配置规则？',
    description: `确认删除配置「${rule.name || rule.id}」？删除后无法恢复，如需临时停用请使用状态开关。`,
    confirmText: '删除配置',
    cancelText: '取消',
    danger: true,
  })
  if (!ok) return
  saving.value = true
  try {
    const removed = await deleteRule(rule.id, kind)
    const index = rules.value.indexOf(rule)
    if (index >= 0) rules.value.splice(index, 1)
    showToast(`配置「${removed?.name || rule.name || rule.id}」已删除`)
  } catch (error) { showToast(formatUserError(error, { fallback: '配置删除失败' }), 'error') }
  finally { saving.value = false }
}


function selectServiceItem(item) {
  if (!item) return
  selectedServiceItemIDs.value = [item.id]
  fillOperationForm(item)
  // 切换服务项即失效旧判定：先清空快照（界面转"未知"），再异步读取本项的判定。
  fieldEvidenceSnapshot.value = null
  fieldEvidenceError.value = ''
  refreshSelectedFieldEvidence()
}
function fillOperationForm(item) {
  // 切换服务项时必须清掉仅属于上一项的草稿字段：报告文件、偏离实例与纠正说明。
  // 否则在 A 选择材料后切到 B 再提交，会把 A 的文件挂到 B 上（服务端无法识别内容归属）。
  signaturePadKey.value += 1
  operationForm.value = {
    ...operationForm.value,
    // 条目级草稿一律清空：报告/偏离材料、现场证据与签名、原始数据与判断项。
    reportFile: null, deviationID: '', reportCorrectionComment: '', reportCorrectionReason: '',
    fieldEvidenceFile: null, fieldSignatureFile: null, deviationEvidenceFile: null,
    rawData: '', environment: '', deviationDescription: '',
    severity: 'MEDIUM', decision: 'RELEASE', comment: '',
    checkInDeviationReason: '', fieldIncompleteReason: '',
  }
  const plan = item.implementation_plan || {}
  const personnel = planPersonnelFor(item, plan)
  operationForm.value = { ...operationForm.value, teamLeadID: item.team_lead_id || '', projectManagerID: item.project_manager_id || '', engineerIDs: (item.engineer_ids || []).join(','), plannedStart: toDateTimeLocal(item.planned_start || plan.planned_start), plannedEnd: toDateTimeLocal(item.planned_end || plan.planned_end), sitePlan: plan.site_plan || '', penetrationTestPlan: plan.penetration_test_plan || '', authDocNo: plan.auth_doc_no || '', authStart: toDateTimeLocal(plan.auth_start), authEnd: toDateTimeLocal(plan.auth_end), authScope: plan.auth_scope || '', testScope: plan.test_scope || '', testWindow: plan.test_window || '', emergencyContact: plan.emergency_contact || '', rollbackPlan: plan.rollback_plan || '', reviewComment: item.tech_review_comment || '', personnel, equipment: planEquipmentFor(plan), travelMode: '', travelReferenceEventID: '', noTravelReason: '', travelOrigin: '', travelDestination: '', travelDepartureDate: formatBusinessDate(item.planned_start || plan.planned_start), travelReturnDate: formatBusinessDate(item.planned_end || plan.planned_end), travelTransport: '', travelAccommodationNeed: '', travelTravelerIDs: personnel.map((row) => row.resourceID).filter(Boolean), comment: '' }
}
function updatePenetrationPackage(workPackage) {
  const index = serviceItems.value.findIndex((item) => item.id === workPackage?.parent_service_item_id)
  if (index < 0) return
  serviceItems.value[index] = { ...serviceItems.value[index], penetration_work_package: workPackage }
}
function notifyFromPenetration({ message, type }) { showToast(message, type) }
function planResourceName(row) {
  const capability = capabilities.value.find((item) => item.resource_id === row.resourceID || (item.resource_type === 'PERSON' && item.user_id === row.resourceID))
  return capability?.resource_name || personnelNames.names.value.get(row.resourceID) || row.resourceID || '未命名资源'
}
function planResourceCodes(row) {
  const capability = capabilities.value.find((item) => item.resource_id === row.resourceID || (item.resource_type === 'PERSON' && item.user_id === row.resourceID))
  return capability?.codes || []
}
function planResourceValidUntil(row) {
  const capability = capabilities.value.find((item) => item.resource_id === row.resourceID || (item.resource_type === 'PERSON' && item.user_id === row.resourceID))
  if (capability?.resource_type === 'PERSON' || row.resourceType === 'PERSON') return '不限制'
  return capability?.valid_until ? formatBusinessDate(capability.valid_until) : '—'
}
// 设备占用：实施准备阶段把已被其他服务项在同一时段占用的设备置灰，不允许重复选取。
// 占用是独立于设备目录的读取：不能用目录内容代替占用校验，读取失败也不能当成「没有占用」。
const equipmentReservations = ref([])
const equipmentReservationsLoading = ref(false)
const equipmentReservationsError = ref('')
// 计划/准备链读取的作用域：设备占用按服务项隔离，工作区快照全局一份；
// 组件卸载时 requestScope 经 onScopeDispose 自动失效在途响应。
const reservationScope = createRequestScope()
const equipmentReservationByID = computed(() => {
  const map = new Map()
  for (const item of equipmentReservations.value) {
    if (!map.has(item.resource_id)) map.set(item.resource_id, item)
  }
  return map
})
// 同一服务项的并发读取合并：进入准备区域、切换服务项与快照替换可能在同一拍触发，
// 复用同一个在途读取；失败不缓存，下一次调用会重新发起。
const reservationReads = { targetID: '', pending: null }
function loadEquipmentReservations(item) {
  const targetID = item?.id
  if (!targetID) {
    reservationScope.invalidate()
    equipmentReservations.value = []
    equipmentReservationsLoading.value = false
    equipmentReservationsError.value = ''
    return Promise.resolve(false)
  }
  if (reservationReads.targetID === targetID && reservationReads.pending) return reservationReads.pending
  const ticket = reservationScope.begin(`RESERVATIONS:${targetID}`)
  equipmentReservationsLoading.value = true
  equipmentReservationsError.value = ''
  let pending = null
  pending = (async () => {
    try {
      const rows = await listEquipmentReservations(targetID)
      // 此前选中的服务项所返回的迟到响应，绝不能
      // 覆盖当前服务项的设备可用情况。
      if (!reservationScope.isCurrent(ticket) || selectedServiceItem.value?.id !== targetID) return false
      equipmentReservations.value = rows
      return true
    } catch (error) {
      if (!reservationScope.isCurrent(ticket) || selectedServiceItem.value?.id !== targetID) return false
      // 占用信息拿不到时不阻断挑选，但必须标明「占用未确认」并提供重试；
      // 保存时服务端仍会硬拦重叠占用，界面绝不能把失败当成「没有占用」。
      equipmentReservations.value = []
      equipmentReservationsError.value = formatUserError(error, { fallback: '设备占用信息读取失败，请重试。' })
      return false
    } finally {
      if (reservationScope.isCurrent(ticket)) equipmentReservationsLoading.value = false
      if (reservationReads.pending === pending) { reservationReads.pending = null; reservationReads.targetID = '' }
    }
  })()
  reservationReads.targetID = targetID
  reservationReads.pending = pending
  return pending
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
async function openEquipmentPicker() {
  equipmentPickerKeyword.value = ''
  planEquipmentPickerOpen.value = true
  // 打开时校验目录新鲜度：过期/未读取/上一次读取失败都会重新确认，
  // 未确认前选择器不展示可选设备，避免按旧目录完成选择。
  await ensureEquipmentCatalog()
}
// 实施准备只展示有效期覆盖整个实施计划窗口的设备。设备档案只在“今天”有效仍不够：
// 若计划结束前检定到期，提交时服务端会拒绝，因此选择阶段就应过滤掉。
function isEquipmentValidForPreparation(item) {
  const today = todayBusinessDate()
  const usageStart = formatBusinessDate(selectedServiceItem.value?.planned_start) || today
  const usageEnd = formatBusinessDate(selectedServiceItem.value?.planned_end) || usageStart
  const validFrom = formatBusinessDate(item.valid_from)
  const validUntil = formatBusinessDate(item.valid_until)
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
// 占用读取失败或尚未确认时不得标成「可添加」：目录里的在位字段不能代替占用校验，
// 否则会把“占用未知”误导成“没有占用”；保存时服务端仍会硬拦重叠占用。
function equipmentPickerState(item) {
  if (operationForm.value.equipment.some((row) => row.resourceID === item.resource_id)) {
    return { label: '已加入', tone: 'normal', action: '已加入', disabled: true }
  }
  const reason = equipmentUnavailableReason(item)
  if (reason) return { label: '不可选取', tone: 'warning', action: '不可选取', disabled: true }
  if (equipmentReservationsLoading.value || equipmentReservationsError.value) {
    return { label: '占用未确认', tone: 'warning', action: '占用未确认', disabled: false, note: '保存时由服务端校验重叠占用' }
  }
  return { label: '可添加', tone: 'neutral', action: '添加', disabled: false }
}
function addPlanEquipment(equipmentItem) {
  if (!equipmentItem) return
  // 设备目录尚未确认（未读取/读取失败/维护后失效）时不允许据此完成选择。
  if (!equipmentConfirmed.value) { showToast('设备目录尚未确认，请先重试读取目录后再选择设备', 'warning'); return }
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
async function uploadCurrentReport() {
  if (saving.value) return
  const item = selectedServiceItem.value
  const file = operationForm.value.reportFile
  if (!item || item.report_status !== 'COMPILING' || !(file instanceof File)) { showToast('请选择当前编制版本的 PDF 报告', 'warning'); return }
  saving.value = true
  try {
    const artifact = await uploadServiceItemEvidence(item.id, 'REPORT', file)
    await registerReportArtifact(item.id, Number(item.report_revision) || 0, artifact)
    operationForm.value.reportFile = null
    showToast(`R${Number(item.report_revision) || 0} 报告文件已登记，可提交审核`)
    await refreshAfterWrite()
  } catch (error) { showToast(formatUserError(error, { fallback: '报告文件上传失败' }), 'error') }
  finally { saving.value = false }
}


function fieldQueueOwner() {
  const tenantID = String(session.value?.tenant_id || '').trim()
  const userID = String(session.value?.user_id || '').trim()
  return tenantID && userID ? `${tenantID}:${userID}` : ''
}

async function refreshFieldQueueCount() {
  try { pendingFieldSyncCount.value = await countFieldOperations(fieldQueueOwner()) } catch { pendingFieldSyncCount.value = 0 }
}

async function persistAndSyncFieldOperation(operation) {
  const ownerKey = fieldQueueOwner()
  if (!ownerKey) throw new Error('当前登录身份不可用，无法安全保存离线作业')
  await saveFieldOperation({ ...operation, ownerKey, createdAt: operation.createdAt || new Date().toISOString() })
  await refreshFieldQueueCount()
  if (!navigator.onLine) {
    showToast('当前离线，现场作业已安全保存；联网后将自动补传。', 'warning')
    return false
  }
  try {
    await flushFieldOperations(true)
  } catch (error) {
    // 本地队列已落盘（client_operation_id 幂等）：同步阶段异常不得说成“操作未完成”，
    // 也不得让用户以为记录丢失而重复录入；联网或手动“立即重试”都会继续补传。
    showToast(`现场作业已安全保存到本地队列，但自动同步未完成：${formatUserError(error, { fallback: '请稍后点击立即重试' })}`, 'warning')
  }
  return true
}

// holder.current 始终指向已经带上最新上传回执的那份操作对象：
// 失败时调用方必须用它回写，不能用循环里取到的旧快照，否则会覆盖回执，
// 导致重试重新上传、同一 client_operation_id 对应不同载荷而被服务端拒绝。
async function submitStoredFieldOperation(operation, holder = { current: operation }) {
  if (!operation.ownerKey || operation.ownerKey !== fieldQueueOwner()) throw new Error('离线作业归属与当前账号不一致')
  let current = operation
  holder.current = current
  if (current.file && !current.artifact) {
    const artifact = await uploadServiceItemEvidence(current.itemID, 'FIELD', current.file)
    current = { ...current, artifact, file: null }
    holder.current = current
    await saveFieldOperation(current)
  }
  const payload = { ...current.payload, client_operation_id: current.id, captured_at: current.capturedAt }
  if (current.kind === 'check-in') return checkInField(current.itemID, payload)
  if (current.kind === 'record') return submitFieldRecord(current.itemID, { ...payload, evidence_files: current.artifact ? [current.artifact] : [] })
  if (current.kind === 'signature') return captureFieldSignature(current.itemID, { ...payload, signature_file: current.artifact })
  throw new Error('未知的现场离线作业类型')
}

async function flushFieldOperations(announce = false) {
  const ownerKey = fieldQueueOwner()
  if (fieldSyncing.value || !navigator.onLine || !ownerKey) return
  fieldSyncing.value = true
  let synced = 0
  let failed = 0
  try {
    const result = await processFieldQueue({
      operations: await listFieldOperations(ownerKey),
      submit: submitStoredFieldOperation,
      remove: removeFieldOperation,
      save: saveFieldOperation,
      formatError: (error) => formatUserError(error, { fallback: '同步失败' }),
    })
    synced = result.synced
    failed = result.failed
    if (failed && announce) {
      showToast(`有 ${failed} 条现场作业尚未同步；其余操作不受影响，可稍后重试。`, 'warning')
    }
  } finally {
    fieldSyncing.value = false
    await refreshFieldQueueCount()
  }
  if (synced) {
    if (announce) showToast(`已同步 ${synced} 条现场作业`)
    await refreshAfterWrite()
  }
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('当前设备不支持定位')); return }
    navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('无法获取定位，请检查浏览器定位权限')), {
      enableHighAccuracy: true, timeout: 15000, maximumAge: 30000,
    })
  })
}

// 用途：固定原因输入前的服务项、选择范围与当前会话，防止等待期间串写。
// 参数：items 为本次动作已经核验的服务项。
// 返回值：服务项副本、选择范围、页面和会话快照。
function captureReasonContext(items) {
  return {
    items: items.map((item) => ({ ...item })),
    selection: JSON.stringify([...selectedServiceItemIDs.value].sort()),
    section: activeSection.value,
    session: session.value,
  }
}

// 用途：复核输入期间页面、选择与服务项版本是否仍属于原操作。
// 参数：context 为输入前保存的操作快照。
// 返回值：上下文一致返回 true，否则返回 false。
function reasonContextCurrent(context) {
  if (activeSection.value !== context.section || session.value !== context.session) return false
  if (JSON.stringify([...selectedServiceItemIDs.value].sort()) !== context.selection) return false
  const fields = ['version', 'status', 'report_status', 'team_lead_id', 'project_manager_id']
  return context.items.every((item) => {
    const current = serviceItems.value.find((row) => row.id === item.id)
    return current && fields.every((field) => current[field] === item[field])
  })
}

// 用途：收集必填操作原因，并在提交前重新核验忙锁与业务上下文。
// 参数：options 为输入弹窗文案，context 为快照，allowed 为当前权限和状态核验。
// 返回值：有效原因字符串；取消、空白或上下文失效时返回 null。
async function askOperationReason(options, context, allowed) {
  if (saving.value || promptDialog.value || !allowed()) return null
  const value = await askPrompt({ ...options, minlength: 1 })
  if (value === null) return null
  if (saving.value || !reasonContextCurrent(context) || !allowed()) {
    showToast('操作范围或权限已变化，请重新选择后操作', 'warning')
    return null
  }
  const reason = String(value).trim()
  if (!reason) { showToast('请填写原因或审批意见', 'warning'); return null }
  return reason
}

// 用途：按当前操作类型执行服务项交付动作并刷新工作区。
// 参数：kind 为分配、计划、现场实施或报告推进等操作类型。
// 返回值：无；校验失败不写入，接口失败以提示反馈。
async function runOperation(kind) {
  if (saving.value) return
  const item = selectedServiceItem.value
  const items = kind === 'allocation' ? selectedServiceItems.value : (item ? [item] : [])
  if (!items.length) { showToast(kind === 'allocation' ? '请至少选择一个服务项' : '当前没有可操作的服务项'); return }
  const form = operationForm.value
  const completedAssignmentIDs = []
  saving.value = true
  try {
    if (kind === 'allocation') {
      // 设备清单在「实施准备」阶段确定；此处只编排团队负责人和执行团队指派。
      for (const selected of items) {
        await assignServiceItemTeams({
          item: selected, teamLeadID: form.teamLeadID, projectManagerID: form.projectManagerID,
          engineerIDs: selectedIDs(form.engineerIDs), executionAllowed: canExecutionAssign.value,
          assignTeam, assignExecutionTeam, listServiceItemsSnapshot,
          onTeamAssigned: (id) => { selected.team_lead_id = id },
        })
        completedAssignmentIDs.push(selected.id)
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
      await planImplementation(item.id, { expected_version: Number(item.version) || 0, planned_start: datetimeLocalToInstant(form.plannedStart), planned_end: datetimeLocalToInstant(form.plannedEnd), site_plan: form.sitePlan, penetration_test_plan: form.penetrationTestPlan, auth_doc_no: form.authDocNo, auth_start: datetimeLocalToInstant(form.authStart), auth_end: datetimeLocalToInstant(form.authEnd), auth_scope: form.authScope, test_scope: form.testScope, test_window: form.testWindow, emergency_contact: form.emergencyContact, rollback_plan: form.rollbackPlan , personnel: form.personnel.map((row) => ({ resource_type: 'PERSON', resource_id: row.resourceID, window_start: row.windowStart, window_end: row.windowEnd, note: row.note })) })
      showToast('实施计划已发布')
    } else if (kind === 'special-approve' || kind === 'special-reject') {
      await reviewSpecialMethod(item.id, { decision: kind === 'special-approve' ? 'APPROVED' : 'REJECTED', comment: form.reviewComment })
      showToast(kind === 'special-approve' ? '复核已通过，可发布实施计划' : '复核已驳回，请修正后重新提交复核')
    } else if (kind === 'report-next') {
      const next = reportPhaseNext[item.report_status]
      await updateReportStatus(item.id, next, item.version)
      showToast(`报告状态已推进至：${reportStatusLabel[next]}`)
    } else if (kind === 'preparation') {
      const equipmentWindowProblem = form.equipment.find((row) => (row.windowStart && !row.windowEnd) || (!row.windowStart && row.windowEnd) || (row.windowStart && row.windowEnd && new Date(row.windowEnd) < new Date(row.windowStart)))
      if (equipmentWindowProblem) { showToast(`「${planResourceName(equipmentWindowProblem)}」的使用时段不完整或结束早于开始`); return }
      if (!form.travelMode) { showToast('请选择行程安排方式', 'warning'); return }
      if (form.travelMode === 'NO_TRAVEL' && !form.noTravelReason) { showToast('请填写无需行程原因', 'warning'); return }
      if (form.travelMode === 'EXISTING' && !form.travelReferenceEventID) { showToast('请选择已有行程', 'warning'); return }
      if (form.travelMode === 'NEW') {
        if (!form.travelOrigin || !form.travelDestination) { showToast('请填写出发地和目的地', 'warning'); return }
        if (!form.travelDepartureDate || !form.travelReturnDate || form.travelReturnDate < form.travelDepartureDate) { showToast('请填写有效的出发和返回日期', 'warning'); return }
        if (!form.travelTravelerIDs.length) { showToast('请至少选择一名出行人员', 'warning'); return }
      }
      await startImplementationPreparation(item.id, {
        expected_version: Number(item.version) || 0,
        travel: {
          mode: form.travelMode,
          reference_event_id: form.travelReferenceEventID,
          no_travel_reason: form.noTravelReason,
          origin: form.travelOrigin,
          destination: form.travelDestination,
          departure_date: form.travelDepartureDate,
          return_date: form.travelReturnDate,
          transport: form.travelTransport,
          accommodation_need: form.travelAccommodationNeed,
          traveler_ids: form.travelTravelerIDs,
        },
        notes: form.comment,
        equipment: form.equipment.map((row) => ({ resource_type: 'EQUIPMENT', resource_id: row.resourceID, window_start: row.windowStart, window_end: row.windowEnd, note: row.note })),
      })
      showToast('实施准备已发起')
    } else if (kind === 'field-start') {
      await startFieldExecution(item.id, { expected_version: Number(item.version) || 0 })
      showToast('已进入实施中，可以提交现场记录')
    } else if (kind === 'field-check-in') {
      const position = await currentPosition()
      const operation = {
        id: newFieldOperationID('checkin'), kind: 'check-in', itemID: item.id, capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        payload: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_meters: position.coords.accuracy, deviation_reason: form.checkInDeviationReason, expected_version: 0 },
      }
      await persistAndSyncFieldOperation(operation)
      form.checkInDeviationReason = ''
    } else if (kind === 'field') {
      if (!String(form.rawData || '').trim() || !String(form.environment || '').trim()) { showToast('请填写现场原始数据与环境条件', 'warning'); return }
	  if (!(form.fieldEvidenceFile instanceof File)) { showToast('请上传至少一份现场证据', 'warning'); return }
      await persistAndSyncFieldOperation({
        id: newFieldOperationID('record'), kind: 'record', itemID: item.id, capturedAt: new Date().toISOString(), file: form.fieldEvidenceFile,
        payload: { expected_version: 0, raw_data: form.rawData, environment: form.environment },
      })
	  form.fieldEvidenceFile = null
      form.rawData = ''
      form.environment = ''
    } else if (kind === 'field-signature') {
      if (!(form.fieldSignatureFile instanceof File)) { showToast('请先完成电子签名', 'warning'); return }
      await persistAndSyncFieldOperation({
        id: newFieldOperationID('signature'), kind: 'signature', itemID: item.id, capturedAt: new Date().toISOString(), file: form.fieldSignatureFile,
        payload: { expected_version: 0 },
      })
      form.fieldSignatureFile = null
    } else if (kind === 'exception-report') {
	  const evidenceFiles = form.deviationEvidenceFile instanceof File ? [await uploadServiceItemEvidence(item.id, 'DEVIATION', form.deviationEvidenceFile)] : []
	  const result = await reportDeviation(item.id, { description: form.deviationDescription, severity: form.severity, evidence_files: evidenceFiles })
	  form.deviationEvidenceFile = null
      showToast(`偏离已上报：${result.deviation_id || '待评审'}`)
    } else if (kind === 'exception-review') {
	  if (form.decision === 'TERMINATE' && !String(form.comment || '').trim()) { showToast('终止服务项时必须填写终止原因', 'warning'); return }
      await reviewDeviation(form.deviationID, { decision: form.decision, comment: form.comment })
      showToast('偏离评审已完成')
    } else if (kind === 'complete') {
      // 判定不可用（未拉取/失败/待同步）时 fail-closed：不知道缺不缺项就不能确认完成。
      if (fieldEvidenceBlocksCompletion.value) {
        showToast(selectedFieldEvidence.value.blockReason || '缺项判定不可用，无法确认现场证据；请重新读取后再完成。', 'warning')
        return
      }
      // 与服务端 422 门禁同口径，先在界面拦下矛盾叙述，避免用户白跑一次请求。
      const mismatch = fieldEvidenceReasonMismatch(selectedFieldEvidence.value, form.fieldIncompleteReason)
      if (mismatch === 'REASON_REQUIRED') {
        showToast(`请先补齐${selectedFieldEvidenceGaps.value.join('、')}，或填写无法补齐的缺项确认说明`, 'warning')
        return
      }
      if (mismatch === 'REASON_NOT_ALLOWED') {
        showToast('服务端判定现场证据已齐全，请清空缺项确认说明后再确认完成', 'warning')
        return
      }
      await completeServiceItemField(item.id, { expected_version: Number(item.version) || 0, incomplete_reason: String(form.fieldIncompleteReason || '').trim() })
      form.fieldIncompleteReason = ''
      showToast('现场测评已结束，报告待整改')
    }
    await refreshAfterWrite()
  } catch (error) {
    const partialAssignment = kind === 'allocation' && (completedAssignmentIDs.length > 0 || error?.partialCompletion?.teamAssigned === true)
    let message = formatUserError(error?.cause || error, { fallback: '操作未完成，请核对当前状态后继续。' })
    // 为已完成事实预留提示长度，避免长业务原因被 Toast 的安全长度限制整体替换。
    if (partialAssignment && message.length > 180) message = `${message.slice(0, 180)}…`
    // 先根据已确认的提交事实拼结果，再交给 Toast 做文本安全处理；不能让原因的
    // NETWORK_ERROR / TIMEOUT 分类把“负责人已成功分配”覆盖成整次操作结果未知。
    if (kind === 'allocation' && error?.partialCompletion?.teamAssigned === true) {
      message = `当前服务项的团队负责人已分配；执行团队分配未确认完成。${message}`
    }
    if (kind === 'allocation' && completedAssignmentIDs.length) {
      const completed = new Set(completedAssignmentIDs)
      selectedServiceItemIDs.value = selectedServiceItemIDs.value.filter((id) => !completed.has(id))
      message = `本批次已确认完成 ${completedAssignmentIDs.length} / ${items.length} 个服务项的分配，已完成项已取消勾选，不会重复提交。${message}`
    }
    showToast(message, partialAssignment ? 'warning' : 'error')
    // 并发冲突：服务端已拒绝本次写入，重新拉取让用户看到最新版本后再决定怎么做。
    // 批次前项已提交后，即使本项是 403 也必须刷新并保留部分完成事实；
    // 恢复刷新失败时静默上抛，由下方 catch 提示“列表刷新未完成”，不误报写操作结果。
    if (error?.status === 409 || error?.requiresReload || partialAssignment) {
      try { await loadWorkspace({ reportError: false }) }
      catch { showToast(`${message}列表刷新未完成，请手动刷新核对，勿重复提交已完成项。`, 'warning') }
    }
  }
  finally { saving.value = false }
}

/** 用途：按原选择范围撤销负责人或执行团队分配并保留历史记录。
 * 参数：kind 为 team（负责人）或 execution（执行团队）。
 * 返回值：无；取消不写入，失败以提示反馈。 */
async function revokeSelectedAssignment(kind) {
  const permitted = () => kind === 'team' ? canRevokeTeam.value : kind === 'execution' && canRevokeExecution.value
  if (saving.value || promptDialog.value || !permitted()) return
  const items = selectedServiceItems.value
  if (!items.length) { showToast('请至少选择一个服务项', 'warning'); return }
  const eligible = items.filter((item) => item.status === '待分配' && (kind === 'team' ? item.team_lead_id : item.project_manager_id))
  if (eligible.length !== items.length) { showToast('仅可撤销处于待分配状态且已有对应分配的服务项', 'warning'); return }
  const context = captureReasonContext(eligible)
  const label = kind === 'team' ? '团队负责人分配' : '执行团队分配'
  const reason = await askOperationReason({
    title: `撤销${label}`, confirmText: `撤销${label}`, label: '撤销原因', danger: true,
    description: `请输入撤销${label}的原因。${kind === 'team' ? '同时撤销项目经理、工程师分配及能力校验。' : ''}`,
  }, context, permitted)
  if (reason === null) return
  saving.value = true
  try {
    for (const item of context.items) {
      const payload = { reason, expected_version: Number(item.version) || 0 }
      if (kind === 'team') await revokeTeamAssignment(item.id, payload)
      else await revokeExecutionAssignment(item.id, payload)
    }
    showToast(`已撤销 ${eligible.length} 个服务项的${kind === 'team' ? '团队负责人分配及下游执行团队' : '执行团队分配'}，历史记录已保留`)
    await loadWorkspace()
  } catch (error) {
    showToast(formatUserError(error, { fallback: '撤销分配失败，请刷新后重试' }), 'error')
  } finally { saving.value = false }
}

// 用途：将原选择范围内待分配的服务项退回拆解确认。
// 参数：无。
// 返回值：无；取消不写入，失败以提示反馈。
async function returnSelectedToDecomposition() {
  if (saving.value || promptDialog.value || !canManageDecomposition.value) return
  const items = selectedServiceItems.value
  if (!items.length) { showToast('请至少选择一个服务项', 'warning'); return }
  if (items.some((item) => item.status !== '待分配')) { showToast('仅可将待分配服务项退回拆解确认', 'warning'); return }
  const context = captureReasonContext(items)
  const reason = await askOperationReason({
    title: '退回拆解确认', confirmText: '退回拆解确认', label: '退回原因', danger: true,
    description: '请输入退回拆解确认的原因。原分配与能力校验结果将清除。',
  }, context, () => canManageDecomposition.value)
  if (reason === null) return
  saving.value = true
  try {
    for (const item of context.items) {
      await returnServiceItemToDecomposition(item.id, { reason: String(reason).trim(), expected_version: Number(item.version) || 0 })
    }
    showToast(`已将 ${items.length} 个服务项退回拆解确认，原分配与校验结果已清除`)
    selectedServiceItemIDs.value = []
    await loadWorkspace()
  } catch (error) {
    showToast(formatUserError(error, { fallback: '退回拆解确认失败，请刷新后重试' }), 'error')
    if (error?.status === 409) await loadWorkspace()
  } finally { saving.value = false }
}

const pendingRollbackRequests = computed(() => {
  const decided = new Set(deliveryEvents.value.filter((event) => ['ROLLBACK_APPROVED', 'ROLLBACK_REJECTED', 'ROLLBACK_WITHDRAWN'].includes(event.type)).map((event) => event.payload?.request_id))
  return deliveryEvents.value.filter((event) => event.type === 'ROLLBACK_REQUESTED' && !decided.has(event.id))
})
const pendingReportCorrectionRequests = computed(() => {
  const decided = new Set(deliveryEvents.value.filter((event) => ['REPORT_CORRECTION_APPROVED', 'REPORT_CORRECTION_REJECTED'].includes(event.type)).map((event) => event.payload?.request_id))
  return deliveryEvents.value.filter((event) => event.type === 'REPORT_CORRECTION_REQUESTED' && !decided.has(event.id))
})
const selectedReportCorrectionRequests = computed(() => pendingReportCorrectionRequests.value.filter((event) => event.service_item_id === selectedServiceItem.value?.id))
const canSubmitReportCorrection = computed(() => canRequestReportCorrection.value
  && selectedServiceItem.value?.status === '现场实施完成'
  && ['ISSUED', 'ARCHIVED'].includes(selectedServiceItem.value?.report_status)
  && selectedReportCorrectionRequests.value.length === 0)
// 用途：由申请人撤回仍待处理的回退申请。
// 参数：request 为待撤回的回退申请。
// 返回值：无；取消或申请失效不写入，失败以提示反馈。
async function withdrawPendingRollback(request) {
  const requestID = request.id
  const itemID = request.service_item_id
  const permitted = () => canRequestRollback.value && request.actor_user_id === session.value?.user_id
    && pendingRollbackRequests.value.some((row) => row.id === requestID && row.service_item_id === itemID && row.actor_user_id === session.value?.user_id)
  if (saving.value || promptDialog.value || !permitted()) return
  const item = serviceItems.value.find((row) => row.id === itemID)
  if (!item) { showToast('服务项已不可见，无法撤回', 'warning'); return }
  const context = captureReasonContext([item])
  const reason = await askOperationReason({
    title: '撤回回退申请', confirmText: '撤回申请', label: '撤回原因',
  }, context, permitted)
  if (reason === null) return
  saving.value = true
  try {
    await withdrawRollback(itemID, requestID, { reason })
    showToast('回退申请已撤回')
    await refreshAfterWrite()
  } catch (error) { showToast(formatUserError(error, { fallback: '撤回失败，请刷新后重试' }), 'error') } finally { saving.value = false }
}

// 用途：撤销实施计划或实施准备，并保留对应补偿语义。
// 参数：kind 为 plan（计划）或 preparation（准备）。
// 返回值：无；取消不写入，失败以提示反馈。
async function revokeDeliveryPhase(kind) {
  if (saving.value || promptDialog.value || !canRevokeImplementation.value) return
  if (!['plan', 'preparation'].includes(kind)) return
  const selected = selectedServiceItem.value
  if (!selected) { showToast('请先选择服务项', 'warning'); return }
  const expectedStatus = kind === 'plan' ? '待实施' : '实施准备中'
  if (selected.status !== expectedStatus) { showToast(`当前状态不能撤销${kind === 'plan' ? '实施计划' : '实施准备'}`, 'warning'); return }
  const context = captureReasonContext([selected])
  const item = context.items[0]
  const label = kind === 'plan' ? '实施计划' : '实施准备'
  const reason = await askOperationReason({
    title: `撤销${label}`, confirmText: `撤销${label}`, label: '撤销原因', danger: true,
    description: kind === 'plan' ? '撤销后回到待分配。' : '撤销后释放设备预约。',
  }, context, () => canRevokeImplementation.value)
  if (reason === null) return
  saving.value = true
  try {
    const payload = { reason, expected_version: Number(item.version) || 0 }
    if (kind === 'plan') await revokeImplementationPlan(item.id, payload)
    else await revokePreparation(item.id, payload)
    showToast(kind === 'plan' ? '实施计划已撤销，已回到待分配' : '实施准备已撤销，设备预约已释放')
    await refreshAfterWrite()
  } catch (error) { showToast(formatUserError(error, { fallback: '撤销失败，请刷新后重试' }), 'error') } finally { saving.value = false }
}

// 用途：为符合当前状态的服务项提交现场回退或报告返工申请。
// 参数：kind 为现场回退或报告返工的业务类型。
// 返回值：无；取消不写入，失败以提示反馈。
async function submitRollbackRequest(kind) {
  const eligible = () => canRequestRollback.value && (kind === 'FIELD_TO_PREPARATION'
    ? selectedServiceItem.value?.status === '实施中'
    : kind === 'REPORT_TO_FIELD' && selectedServiceItem.value?.status === '现场实施完成'
      && ['RECTIFYING', 'COMPILING', 'REVIEWED'].includes(selectedServiceItem.value?.report_status))
  if (saving.value || promptDialog.value || !eligible()) return
  const context = captureReasonContext([selectedServiceItem.value])
  const item = context.items[0]
  const label = kind === 'FIELD_TO_PREPARATION' ? '申请回退至实施准备' : '申请报告返工'
  const reason = await askOperationReason({
    title: label, confirmText: label, label: '申请原因',
  }, context, eligible)
  if (reason === null) return
  saving.value = true
  try {
    await requestRollback(item.id, { kind, reason, expected_version: Number(item.version) || 0 })
    showToast('回退申请已提交，等待技术总监或系统管理员审批')
    await refreshAfterWrite()
  } catch (error) { showToast(formatUserError(error, { fallback: '回退申请失败' }), 'error') } finally { saving.value = false }
}

// 用途：以当前版本批准或驳回他人仍待处理的回退申请。
// 参数：request 为回退申请，decision 为 APPROVED 或 REJECTED。
// 返回值：无；取消或申请失效不写入，失败以提示反馈。
async function decidePendingRollback(request, decision) {
  const requestID = request.id
  const itemID = request.service_item_id
  const permitted = () => canApproveRollback.value && ['APPROVED', 'REJECTED'].includes(decision)
    && request.actor_user_id !== session.value?.user_id
    && pendingRollbackRequests.value.some((row) => row.id === requestID && row.service_item_id === itemID && row.actor_user_id !== session.value?.user_id)
  if (saving.value || promptDialog.value || !permitted()) return
  const selected = serviceItems.value.find((row) => row.id === itemID)
  if (!selected) { showToast('服务项已不可见，无法审批', 'warning'); return }
  const context = captureReasonContext([selected])
  const item = context.items[0]
  const label = decision === 'APPROVED' ? '批准回退申请' : '驳回回退申请'
  const comment = await askOperationReason({
    title: label, confirmText: label, label: '审批意见', danger: decision === 'APPROVED',
  }, context, permitted)
  if (comment === null) return
  saving.value = true
  try {
    await decideRollback(item.id, requestID, { decision, comment, expected_version: Number(item.version) || 0 })
    showToast(decision === 'APPROVED' ? '回退申请已批准，服务项已按补偿规则回退' : '回退申请已驳回')
    await refreshAfterWrite()
  } catch (error) { showToast(formatUserError(error, { fallback: '审批失败，请刷新后重试' }), 'error') } finally { saving.value = false }
}

async function submitReportCorrection() {
  if (saving.value) return
  const item = selectedServiceItem.value
  const reason = String(operationForm.value.reportCorrectionReason || '').trim()
  if (!item || !canSubmitReportCorrection.value) { showToast('当前报告不能申请更正', 'warning'); return }
  if (!reason) { showToast('请填写报告更正原因', 'warning'); return }
  saving.value = true
  try {
    await requestReportCorrection(item.id, { reason, expected_version: Number(item.version) || 0 })
    operationForm.value.reportCorrectionReason = ''
    showToast('报告更正申请已提交，等待技术总监审批')
    await refreshAfterWrite()
  } catch (error) {
    showToast(formatUserError(error, { fallback: '报告更正申请失败' }), 'error')
    if (error?.status === 409) await loadWorkspace()
  } finally { saving.value = false }
}

// 用途：审批报告更正申请，通过后生成待整改的新报告版本。
// 参数：request 为待处理更正申请，decision 为批准或驳回决定。
// 返回值：无；审批失败以提示反馈，版本冲突时重新加载工作区。
async function decidePendingReportCorrection(request, decision) {
  if (saving.value) return
  const item = itemByID.value.get(request.service_item_id)
  const comment = String(operationForm.value.reportCorrectionComment || '').trim()
  if (!item) { showToast('服务项已不可见，无法审批', 'warning'); return }
  if (request.actor_user_id === session.value?.user_id) { showToast('申请人与审批人不能是同一人', 'warning'); return }
  if (!comment) { showToast('请填写报告更正审批意见', 'warning'); return }
  saving.value = true
  try {
    await decideReportCorrection(item.id, request.id, { decision, comment, expected_version: Number(item.version) || 0 })
    operationForm.value.reportCorrectionComment = ''
    showToast(decision === 'APPROVED' ? '报告更正已批准，已生成新版本待整改' : '报告更正申请已驳回')
    await refreshAfterWrite()
  } catch (error) {
    showToast(formatUserError(error, { fallback: '报告更正审批失败' }), 'error')
    if (error?.status === 409) await loadWorkspace()
  } finally { saving.value = false }
}

async function saveCreate() {
  saving.value = true
  try {
    // 同一弹窗根据当前栏目创建不同资源；路由栏目在提交瞬间决定载荷形态，成功后再把
    // 服务端生成的记录并入对应集合。
    if (activeSection.value === 'projects') {
      if (!selectedApprovedContractServices.value.length) {
        showToast('请至少选择一个合同服务项', 'warning')
        return
      }
      const created = await createProject({
        name: createForm.value.name,
        contract_id: createForm.value.contractID,
        service_items: selectedApprovedContractServices.value.map((item) => ({ source_id: item.source_id, site: createForm.value.site })),
      })
      projects.value = [created, ...projects.value]
      showToast(`项目 ${created.id} 已创建，服务项待拆解确认`)
      createOpen.value = false
      createForm.value = emptyCreateForm()
      approvedContractServiceItems.value = []
      selectedContractServiceIDs.value = []
    }
  } catch (error) { showToast(formatUserError(error, { fallback: '保存失败' }), 'error') }
  finally { saving.value = false }
}
function exportProjects() {
  const rows = filteredProjects.value.map((p) => [p.id, p.customer, p.contract, p.category, p.team, p.manager, p.status, p.due])
  // 单元格转义统一走 projectDisplay.csvCell → platform/iam/utils/csvExport.js：
  // 结构转义 + 公式前缀中和（= + - @ 与 TAB/CR 开头），纯数字豁免。
  const csv = [['项目编号', '客户', '合同编号', '检测类别', '团队', '项目经理', '状态', '计划完成'], ...rows]
    .map((row) => row.map(csvCell).join(',')).join('\n')
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
  // 关账请求在途时不允许 ESC 关闭，避免用户以为已取消而重复提交。
  if (saving.value || closureSaving.value) return false
  if (openMulti.value) { openMulti.value = ''; return true }
  if (planEquipmentPickerOpen.value) { planEquipmentPickerOpen.value = false; return true }
  if (operationDetail.value) { operationDetail.value = null; return true }
  if (configEditorOpen.value) { configEditorOpen.value = false; return true }
  if (overrideDialog.value) { overrideDialog.value = null; return true }
  if (categoryDialog.value) { categoryDialog.value = null; return true }
  if (capabilityDialog.value) { capabilityDialog.value = null; return true }
  if (adjustOpen.value) { adjustOpen.value = false; return true }
  if (closureOpen.value) { closeSupplementClosure(); return true }
  if (createOpen.value) { createOpen.value = false; return true }
  if (notificationOpen.value) { closeNotifications(); return true }
  if (kpiSettingsOpen.value) { dismissKpiSettings({ restoreFocus: true }); return true }
  // 收起抽屉后把焦点交还汉堡按钮（与共享外壳一致），否则焦点会留在已隐藏的侧栏里。
  if (mobileMenuOpen.value) { mobileMenuOpen.value = false; mobileMenuButton.value?.focus?.(); return true }
  return false
}

function onGlobalKeydown(event) {
  if (event.key !== 'Escape') return
  if (event.defaultPrevented) return
  if (document.body?.dataset?.confirmDialogOpen === 'true') return
  if (closeActiveOverlay()) event.preventDefault()
}

function onFieldOnline() { flushFieldOperations(true) }

// 设备维护面板只在进入「设备能力」栏目时才加载对应代码块；模块加载失败给出显式重试，
// 不把“资源没加载出来”渲染成“暂无设备”。
function createEquipmentPanel() {
  return defineAsyncComponent({
    loader: () => import('@/modules/project_management/components/ProjectEquipmentPanel.vue'),
    loadingComponent: LoadingState,
    delay: 120,
    timeout: 30000,
    errorComponent: defineComponent({
      name: 'ProjectEquipmentPanelError',
      setup: () => () => h(ErrorState, {
        title: '设备维护面板加载失败',
        description: '页面资源暂不可用，请重试加载。',
        retryText: '重试加载',
        onRetry: retryEquipmentPanel,
      }),
    }),
  })
}
const equipmentPanel = shallowRef(createEquipmentPanel())
// 用途：面板代码块加载失败后的重试入口。
// 参数：无。
// 返回值：无；替换为新实例以重新请求代码块。
function retryEquipmentPanel() { equipmentPanel.value = createEquipmentPanel() }

onMounted(loadWorkspace)
watch(() => fieldQueueOwner(), (ownerKey) => {
  pendingFieldSyncCount.value = 0
  if (ownerKey && session.value?.permissions?.includes('project.read')) {
    refreshFieldQueueCount(); flushFieldOperations(false)
  }
}, { immediate: true })
onMounted(() => {
  document.addEventListener('click', closeMultiOnOutsideClick)
  document.addEventListener('click', onKpiSettingsOutsideClick)
  document.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('online', onFieldOnline)
})
// 栏目切换只触发该栏目真正依赖的辅助数据：设备目录在「设备能力」「实施准备」读取，
// 设备占用在准备操作读取，SLA 明细在监控区域读取；未进入的区域一律不发请求。
// 进入资源分配/待办/指派栏目时刷新人员目录，保证新建或停用的平台账号能及时反映。
// 用途：按已确认会话能力加载切换栏目所需辅助数据。
// 参数：section 为目标栏目。
// 返回值：无；无项目读取能力时保留独立费用入口。
function onSectionChanged(section) {
  if (!session.value?.permissions?.includes('project.read')) return
  if (['allocation', 'inbox', 'assignments', 'monitoring'].includes(section)) loadPersonnel()
  if (['equipment', 'preparation'].includes(section)) void ensureEquipmentCatalog()
  if (section === 'preparation') void loadEquipmentReservations(selectedServiceItem.value)
  // 监控区域每次进入都重新确认 SLA 明细：时限预警不能沿用离开页面之前的旧结论。
  if (section === 'monitoring') void loadSlaOverdueDetails({ force: true })
}
watch(activeSection, onSectionChanged)
// 工作区成功刷新后辅助数据必须重新确认：姓名按新快照重新读取，设备目录/SLA 明细置为
// 待确认并在当前使用区域重新读取；失败不缓存，由各自的重试入口承担。
watch(lastUpdatedAt, () => {
  if (!lastUpdatedAt.value) return
  void personnelNames.reload()
  invalidateEquipmentCatalog()
  invalidateSlaOverdue()
  refreshSectionAuxiliary()
})
// 刷新或切换节点后，立即清除已经不属于当前节点的选择，避免回退项目残留操作按钮。
watch([activeSection, activeNodeItems, loading, sectionExtrasLoading, workspaceReady], ([section, items]) => {
  // 事件参与节点判定；未就绪时的暂时空集合不能当作服务项已经移出节点。
  if (loading.value || sectionExtrasLoading.value || !workspaceReady.value) return
  if (!['allocation', 'inbox', 'planning', 'preparation', 'assignments', 'methods', 'exceptions', 'reports', 'implementation'].includes(section)) return
  const available = new Set(items.map((item) => item.id))
  selectedServiceItemIDs.value = selectedServiceItemIDs.value.filter((id) => available.has(id))
}, { immediate: true })
// 会话权限异步到达：只有拿到执行团队分配权限后，项目经理/工程师的角色目录才会被查询；
// 权限在这之后才加载完成时必须补一次，否则这两个下拉会一直空着。
// 切换服务项或在准备页刷新工作区时重新拉取设备占用：占用是别的项目造成的，
// 只靠本地缓存（或设备目录的在位字段）会给出过期的可选设备。
watch(selectedServiceItem, (item) => {
  if (activeSection.value === 'preparation') void loadEquipmentReservations(item)
})
watch(canExecutionAssign, (allowed) => {
  if (allowed && ['allocation', 'inbox', 'assignments'].includes(activeSection.value)) loadPersonnel()
})
onBeforeUnmount(() => {
  window.clearTimeout(toastTimer)
  // 合同搜索防抖计时器随组件销毁一起取消，避免卸载后再发请求。
  if (approvedContractSearchTimer) window.clearTimeout(approvedContractSearchTimer)
  disposeNotifications()
  document.removeEventListener('click', closeMultiOnOutsideClick)
  document.removeEventListener('click', onKpiSettingsOutsideClick)
  document.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('online', onFieldOnline)
})
</script>

<template>
  <div class="pm-shell">
    <aside id="pm-sidebar" class="pm-sidebar" :class="{ open: mobileMenuOpen }">
      <div class="pm-brand">
        <span class="pm-brand-mark">PS</span>
        <span><b>项目服务管理</b><small>PROJECT SERVICE</small></span>
        <!-- P2-2：移动抽屉必须有可见关闭按钮；桌面隐藏，打开抽屉时才能点。 -->
        <button class="pm-close-menu" type="button" aria-label="关闭菜单" @click="mobileMenuOpen = false"><ConsoleIcon name="close" /></button>
      </div>
      <nav class="pm-nav" aria-label="项目管理导航" data-first-run-anchor="subsystem-nav">
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
          <button class="pm-nav-item" type="button" data-first-run-anchor="subsystem-portal" @click="returnToUnifiedPortal"><ConsoleIcon name="dashboard" /><span>返回子系统门户</span></button>
        </div>
      </nav>
      <div class="pm-sidebar-user subsystem-sidebar-user">
        <span class="pm-avatar" aria-hidden="true">{{ currentUserInitial }}</span>
        <span class="pm-user-copy"><strong :title="currentUserName">{{ currentUserName }}</strong><small :title="currentUserRoleLabel">{{ currentUserRoleLabel }}</small></span>
        <button class="pm-logout" type="button" :disabled="isLoggingOut" aria-label="退出应用系统" @click="logoutSystem"><ConsoleIcon name="logout" /></button>
      </div>
    </aside>
    <div v-if="mobileMenuOpen" class="pm-menu-mask" @click="mobileMenuOpen = false"></div>

    <main id="main-content" class="pm-main" tabindex="-1">
      <header class="pm-topbar">
        <button ref="mobileMenuButton" class="pm-icon-button pm-menu-button" aria-label="打开菜单" :aria-expanded="mobileMenuOpen ? 'true' : 'false'" aria-controls="pm-sidebar" @click="mobileMenuOpen = true"><ConsoleIcon name="menu" /></button>
        <div class="pm-breadcrumb"><span>项目服务管理</span><b>/</b><template v-if="activeSection === 'project_detail'"><button type="button" class="pm-crumb-link" @click="navigate('projects')">项目列表</button><b>/</b><strong>{{ detailProject?.id || '项目详情' }}</strong></template><strong v-else>{{ currentMeta[0] }}</strong></div>
        <div class="pm-top-tools">
          <button class="pm-icon-button pm-notification-button" aria-label="通知" aria-controls="project-notifications" :aria-expanded="notificationOpen" @click="toggleNotifications"><ConsoleIcon name="bell" /><em v-if="notificationCount">{{ notificationCount }}</em></button>
          <span class="pm-topbar-avatar" aria-hidden="true">{{ currentUserInitial }}</span>
        </div>
        <Transition name="pm-notification-pop">
          <ProjectNotificationPopover
            v-if="notificationOpen"
            :count="notificationCount"
            :loading="notificationLoading"
            :error="notificationError"
            :items="notificationItems"
            :action-id="notificationActionID"
            :show-view-all="navigation.sections.includes('notifications')"
            @open-item="openNotification"
            @view-all="closeNotifications(); navigate('notifications')"
          />
        </Transition>
      </header>

      <div class="pm-page">
        <PageHead eyebrow="项目运营" data-first-run-anchor="subsystem-title" :title="currentMeta[0]" :description="activeSection === 'notifications' ? currentMeta[1] : `${currentMeta[1]} · 数据更新于 ${lastUpdatedLabel}`">
          <template #actions>
            <button v-if="activeSection !== 'notifications'" class="pm-button" :disabled="loading" @click="loadWorkspace"><ConsoleIcon name="reset" />{{ loading ? '加载中' : '刷新' }}</button>
            <button v-if="activeSection === 'projects'" class="pm-button" @click="exportProjects"><ConsoleIcon name="export" />导出</button>
            <button v-if="activeSection === 'projects' && canCreateProject && nativeProjectEnabled" class="pm-button" @click="nativeCreateOpen = true">＋ 原生委托项目</button>
            <button v-if="canManageActiveConfig && isVisibleConfigSection" class="pm-button primary" @click="openConfigCreate">{{ isStandardChangeSection ? '＋ 登记标准变更' : '＋ 新建规则' }}</button><button v-if="activeSection === 'projects' && canCreateProject" class="pm-button primary" @click="openCreateProject">＋ 新建项目</button>
            <button v-if="activeSection === 'decomposition' && canConfirmDecomposition" class="pm-button primary" :disabled="saving || !canConfirmCurrentDecomposition" @click="confirmDecomposition">{{ saving ? '提交中…' : '确认拆解' }}</button><button v-if="activeSection === 'decomposition' && canManageDecomposition" type="button" class="pm-button" :disabled="saving || !decompositionProject" @click="openDecompositionAdjust">调整拆解</button><button v-if="activeSection === 'decomposition' && decompositionSupplementClosure.allowed" type="button" class="pm-button" :disabled="saving || closureSaving || closureLoading || !decompositionProject" @click="openSupplementClosure(decompositionProject)">{{ closureLoading ? '读取中…' : '补充协议关账' }}</button>
          </template>
        </PageHead>

        <section v-if="['projects', 'project_detail'].includes(activeSection) && canReadProjectSourceCapabilities && projectCreationCapabilityError" class="pm-contract-warning" role="alert">
          <span>{{ projectCreationCapabilityError }}</span>
          <button class="pm-button" @click="refreshProjectCreationCapabilities">重试来源能力</button>
        </section>


        <!-- F1：工作区走 all=1 快照，服务端上限 500 行；截断时明示集合不完整并引导缩小范围。 -->
        <section v-if="workspaceTruncated" class="pm-contract-warning" role="status">
          <ConsoleIcon name="info" />
          <p>当前快照超过 500 行，仅展示前 500 条；请使用筛选或分页缩小范围</p>
        </section>

        <!-- F1：工作区走 all=1 快照，服务端上限 500 行；截断时明示集合不完整并引导缩小范围。 -->
        <section v-if="workspaceTruncated" class="pm-contract-warning" role="status">
          <ConsoleIcon name="info" />
          <p>当前快照超过 500 行，仅展示前 500 条；请使用筛选或分页缩小范围</p>
        </section>

        <section v-if="['decomposition', 'allocation'].includes(activeSection) && missingStampedContractCount" class="pm-contract-warning"><ConsoleIcon name="info" /><div><b>{{ missingStampedContractCount }} 份合同尚未上传盖章合同</b><p>{{ activeSection === 'decomposition' ? '合同审批已完成，可继续核对并确认服务项拆解；该提示不阻断拆解确认。' : '服务项拆解已确认，可继续分配团队、人员及设备；上传盖章合同后提示将自动清除。' }}</p></div></section>

        <!-- 人员姓名是辅助数据：读取失败只降级为占位符并保留重试入口，不阻断工作区。 -->
        <section v-if="personnelNamesError" class="pm-contract-warning" role="alert">
          <ConsoleIcon name="info" />
          <p>{{ personnelNamesError }}<button type="button" class="pm-link" :disabled="personnelNamesLoading" @click="retryPersonnelNames">{{ personnelNamesLoading ? '读取中…' : '重试读取姓名' }}</button></p>
        </section>

        <ListState v-if="loading || sectionExtrasLoading" loading loading-title="正在读取当前栏目数据…" />
        <ListState v-else-if="loadError || !workspaceReady" error-title="后端数据加载失败" :error="loadError || '工作区数据尚未确认，请重新读取。'" retry-text="重新加载" @retry="loadWorkspace" />
        <ListState v-else-if="sectionExtrasError" error-title="当前栏目数据读取失败" :error="sectionExtrasError" retry-text="重试当前栏目" @retry="loadSectionExtras" />
        <ReimbursementSpendPanel v-else-if="session && !session.permissions?.includes('project.read')" :session="session" />
        <ProjectNotificationCenter v-else-if="activeSection === 'notifications'" @read="refreshNotificationCount" />
        <template v-else-if="activeSection === 'dashboard'">
          <section class="pm-kpis">
            <KpiCard label="全部项目" :value="dashboard.project_count" suffix="个" badge="实时" tone="primary" actionable @activate="navigate('projects')">
              <p class="pm-kpi-meta">已完成 <b>{{ doneProjectCount }}</b> · 风险 <b>{{ dashboard.risk_projects }}</b> · 待拆解 <b>{{ pendingDecompositionCount }}</b></p>
            </KpiCard>
            <KpiCard label="全部服务项" :value="dashboard.service_items" suffix="项" badge="实时" tone="primary" actionable @activate="navigate('decomposition')">
              <p class="pm-kpi-meta">待拆解确认 <b>{{ decompositionItems.length }}</b> 项 · 需业务管理员处理</p>
            </KpiCard>
            <KpiCard label="资源分配待办" :value="serviceFlow[0].count" suffix="项" badge="待处理" tone="warn" actionable @activate="navigate('allocation')">
              <p class="pm-kpi-meta">已下达待完善 <b>{{ inboxItems.length }}</b> 项</p>
            </KpiCard>
            <KpiCard label="风险项目 / 异常" :value="dashboard.risk_projects" suffix="项" badge="实时" tone="danger" actionable @activate="navigate('exceptions')">
              <p class="pm-kpi-meta">待评审偏离 <b>{{ pendingDeviations.length }}</b> 项 · 优先关注异常与终止项目</p>
            </KpiCard>
          </section>
          <section class="pm-dashboard-grid">
            <article class="pm-panel pm-status-panel">
              <header><div><p class="pm-panel-kicker">服务流程</p><h2>服务项状态分布</h2></div><span>总计 <b>{{ serviceItems.length }}</b> 项</span></header>
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">状态</th><th scope="col" class="num">数量</th><th scope="col">占比</th><th scope="col"></th></tr></thead><tbody><tr v-for="flow in serviceFlow" :key="flow.key" :class="{ 'is-empty': flow.count === 0 }" @click="navigate(flow.route)"><td><span class="pm-badge" :class="statusTone(flow.key)">{{ flow.key }}</span><span v-if="flow.key === '报告编制'" class="pm-cell-sub" title="按当前已加载服务项统计，非全量">其中整改中 {{ rectifyingItemCount }} 项</span></td><td class="num">{{ flow.count }}</td><td><div class="pm-bar-bg"><i class="pm-bar-fill" :class="flow.color" :style="{ width: `${serviceItems.length ? (flow.count * 100 / serviceItems.length).toFixed(1) : 0}%` }"></i></div><small>{{ serviceItems.length ? (flow.count * 100 / serviceItems.length).toFixed(1) : '0.0' }}%</small></td><td><button class="pm-link" type="button" :aria-label="`查看${flow.key}服务项`" @click.stop="navigate(flow.route)">→</button></td></tr><tr v-if="!serviceFlow.length"><td colspan="4" class="pm-empty-mini">暂无服务项数据</td></tr></tbody></table></div>
            </article>
            <article class="pm-panel">
              <header><div><p class="pm-panel-kicker danger">风险提示</p><h2>风险与待办</h2></div><button class="pm-link" @click="navigate('exceptions')">查看全部 →</button></header>
              <RiskList :items="riskRows" empty-text="暂无风险或待评审异常" @select="navigate('exceptions')" />
            </article>
          </section>
          <section class="pm-dashboard-grid-3">
            <article class="pm-panel pm-trend-panel">
              <header><div><p class="pm-panel-kicker">准时交付</p><h2>近 12 周准时交付率趋势</h2></div><span>近 4 周均值 <b>{{ onTimeRecentAverage !== null ? `${onTimeRecentAverage}%` : '—' }}</b></span></header>
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
              <header><div><p class="pm-panel-kicker">类别分布</p><h2>检测类别分布（占比）</h2></div><span>{{ serviceItems.length }} 项服务项</span></header>
              <div class="pm-donut pm-category-donut" :style="{ background: categoryDonutStyle }"><div><strong>{{ serviceItems.length }}</strong><span>服务项</span></div></div>
              <div class="pm-status-list">
                <div v-for="segment in categoryDist" :key="segment.name" class="pm-status-row"><i class="pm-dot" :style="{ background: segment.color }"></i>{{ segment.name }}<b class="pm-num">{{ segment.pct }}%</b></div>
                <EmptyHint v-if="!categoryDist.length" message="暂无服务项数据" />
              </div>
            </article>
            <article class="pm-panel pm-util-panel">
              <header><div><p class="pm-panel-kicker">团队负载</p><h2>团队资源利用率</h2></div><span>按当前在途服务项统计</span></header>
              <div class="pm-status-list">
                <div v-for="team in teamUtilization" :key="team.name" class="pm-status-libar"><span class="pm-lib-lbl">{{ team.name }}</span><div class="pm-bar-bg"><i class="pm-bar-fill" :class="team.pct >= 40 ? 'warn' : 'normal'" :style="{ width: `${team.pct}%` }"></i></div><span class="pm-num">{{ team.pct }}%</span></div>
                <EmptyHint v-if="!teamUtilization.length" message="暂无在途团队负载数据" />
              </div>
              <p v-if="concentratedTeam" class="pm-alert warn"><i></i><b>{{ concentratedTeam.name }} 承担 {{ concentratedTeam.pct }}%</b> 的当前在途工作 · 建议关注排期与人力调配</p>
            </article>
          </section>
          <section class="pm-table-panel pm-panel-inflight">
            <header><div><p class="pm-panel-kicker">交付脉搏</p><h2>在途项目 · 实时动态</h2></div></header>
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">项目名称</th><th scope="col">客户</th><th scope="col">服务项</th><th scope="col">团队 / 项目经理</th><th scope="col">进度</th><th scope="col">计划完成</th><th scope="col"></th></tr></thead><tbody><tr v-for="project in inFlightProjects.slice(0, 8)" :key="project.id" :class="{ risk: project.risk }"><td><button class="pm-project-link" :title="`项目编号：${project.id}`" :aria-label="`${project.name || '未命名项目'}，项目编号：${project.id}`" @click="openProject(project)"><b>{{ project.name || '未命名项目' }}</b></button></td><td>{{ project.customer }}</td><td>{{ project.services }} 项</td><td><b>团队负责人：{{ projectAssignmentPeople(project.id).teamLeads }}</b><span class="pm-cell-sub">项目经理：{{ projectAssignmentPeople(project.id).projectManagers }}</span></td><td><ProgressCell :percent="project.progress" /></td><td :class="{ 'pm-text-danger': project.due.includes('超期') }">{{ project.due }}</td><td><button class="pm-link" @click="openProject(project)">详情</button></td></tr><tr v-if="!inFlightProjects.length"><td colspan="7" class="pm-empty-mini">暂无在途项目</td></tr></tbody></table></div>
            <footer v-if="inFlightProjects.length" class="pm-table-footer"><span>显示前 {{ Math.min(inFlightProjects.length, 8) }} 条</span><span>完整列表请前往实时监控</span></footer>
          </section>
        </template>

        <template v-else-if="activeSection === 'projects'">
          <section class="pm-project-kpi" aria-label="项目指标">
            <div ref="kpiSettingsRoot" class="pm-kpi-settings">
              <button
                ref="kpiSettingsTrigger"
                type="button"
                class="pm-kpi-settings-trigger"
                aria-haspopup="dialog"
                :aria-expanded="kpiSettingsOpen"
                aria-controls="project-kpi-settings"
                @click="openKpiSettings"
              >
                <ConsoleIcon name="settings" /><span>指标卡设置</span><em>{{ projectKpiVisibleCards.length }}/{{ projectKpiCards.length }}</em>
              </button>
              <div
                v-if="kpiSettingsOpen"
                id="project-kpi-settings"
                ref="kpiSettingsPanel"
                class="pm-kpi-settings-panel"
                role="dialog"
                aria-label="指标卡显示设置"
              >
                <div class="pm-kpi-settings-head"><b>指标卡显示</b><span>按当前角色可用指标，默认全部显示</span></div>
                <ul class="pm-kpi-settings-list">
                  <li v-for="card in projectKpiCards" :key="card.key">
                    <button
                      type="button"
                      class="pm-kpi-switch"
                      role="switch"
                      :aria-checked="isProjectKpiVisible(card.key)"
                      @click="toggleProjectKpiCard(card.key)"
                    >
                      <span class="pm-kpi-switch-text"><b>{{ card.label }}</b><small>{{ card.meta || '项目指标' }}</small></span>
                      <span class="pm-kpi-switch-track" aria-hidden="true"><i></i></span>
                    </button>
                  </li>
                </ul>
                <div class="pm-kpi-settings-foot">
                  <span>{{ allProjectKpiHidden ? '已隐藏全部指标卡' : `已隐藏 ${hiddenProjectKpiKeys.length} 张` }}</span>
                  <button type="button" class="pm-kpi-settings-reset" :disabled="!hiddenProjectKpiKeys.length" @click="resetProjectKpiCards">恢复默认</button>
                </div>
              </div>
            </div>
            <div
              class="pm-kpi-row pm-project-kpi-grid"
              :class="`pm-project-kpi-columns-${projectKpiColumnCount}`"
              role="group"
              :aria-label="`项目指标，共 ${projectKpiVisibleCards.length} 项`"
            >
              <KpiCard
                v-for="card in projectKpiVisibleCards"
                :key="card.key"
                :label="card.label"
                :value="card.value"
                :suffix="card.suffix"
                :meta="card.meta"
                :tone="card.tone"
                :actionable="Boolean(card.action)"
                @activate="activateProjectKpi(card)"
              />
            </div>
            <p v-if="allProjectKpiHidden" class="pm-kpi-hidden-empty">
              <ConsoleIcon name="info" /><span>已隐藏全部指标卡</span>
              <button type="button" class="pm-kpi-settings-reset" @click="resetProjectKpiCards">恢复默认</button>
            </p>
          </section>
          <FilterBar :count="filteredProjects.length" @reset="resetProjectFilters">
            <label class="pm-search-input"><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索项目名称 / 项目编号 / 客户名称 / 服务项" aria-label="搜索项目"  maxlength="100"/></label>
            <select v-model="statusFilter" class="pm-filter-select" aria-label="按状态筛选" @change="projectCardFilter = ''"><option value="">状态：全部</option><option v-for="node in projectStatusFilters" :key="node" :value="node">{{ node }}</option></select>
            <select v-model="reportStageFilter" class="pm-filter-select" aria-label="按报告阶段筛选"><option value="">报告阶段：全部</option><option v-for="option in reportStageFilterOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
            <select v-model="categoryFilter" class="pm-filter-select" aria-label="按检测类别筛选"><option value="">检测类别：全部</option><option v-for="option in categoryOptions" :key="option" :value="option">{{ option }}</option></select>
            <select v-model="teamFilter" class="pm-filter-select" aria-label="按团队筛选"><option value="">团队：全部</option><option v-for="option in teamOptions" :key="option" :value="option">{{ option }}</option></select>
            <template #tags>
              <span v-if="statusFilter" class="pm-filter-tag">状态：{{ statusFilter }}<button type="button" class="pm-filter-tag-x" :aria-label="`移除状态筛选 ${statusFilter}`" @click="statusFilter = ''">✕</button></span>
              <span v-if="reportStageFilter" class="pm-filter-tag">报告阶段：{{ reportStageLabel[reportStageFilter] || reportStageFilter }}<button type="button" class="pm-filter-tag-x" :aria-label="`移除报告阶段筛选 ${reportStageLabel[reportStageFilter] || reportStageFilter}`" @click="reportStageFilter = ''">✕</button></span>
              <span v-if="categoryFilter" class="pm-filter-tag">类别：{{ categoryFilter }}<button type="button" class="pm-filter-tag-x" :aria-label="`移除类别筛选 ${categoryFilter}`" @click="categoryFilter = ''">✕</button></span>
              <span v-if="teamFilter" class="pm-filter-tag">团队：{{ teamFilter }}<button type="button" class="pm-filter-tag-x" :aria-label="`移除团队筛选 ${teamFilter}`" @click="teamFilter = ''">✕</button></span>
              <span v-if="projectCardFilterLabel" class="pm-filter-tag">范围：{{ projectCardFilterLabel }}<button type="button" class="pm-filter-tag-x" :aria-label="`移除范围筛选 ${projectCardFilterLabel}`" @click="projectCardFilter = ''">✕</button></span>
            </template>
          </FilterBar>
          <p v-if="reportStageListError" class="pm-inline-alert danger" role="alert">{{ reportStageListError }}</p>
          <section class="pm-table-panel">
            <div class="pm-table-scroll"><table class="pm-table pm-responsive-list"><thead><tr><th scope="col"></th><th scope="col">项目 / 客户</th><th scope="col">合同编号</th><th scope="col">服务项</th><th scope="col">检测类别</th><th scope="col">团队 / 项目经理</th><th scope="col">状态</th><th scope="col">交付进度</th><th scope="col">计划完成</th><th scope="col"></th></tr></thead><tbody>
              <tr v-for="project in pagedProjects" :key="project.id" :class="{ selected: selectedRows.includes(project.id), risk: project.risk }"><td class="pm-card-select" data-label="选择"><input type="checkbox" :checked="selectedRows.includes(project.id)" :aria-label="`选择 ${project.id}`" @change="toggleRow(project.id)" /></td><td class="pm-card-title" data-label="项目 / 客户"><button class="pm-project-link" @click="openProject(project)"><b>{{ project.id }}</b><span>{{ project.customer }}</span></button></td><td class="mono" data-label="合同编号">{{ project.contract }}</td><td data-label="服务项">{{ project.services }}</td><td data-label="检测类别">{{ project.category }}</td><td data-label="团队 / 项目经理"><b>团队负责人：{{ projectAssignmentPeople(project.id).teamLeads }}</b><span class="pm-cell-sub">项目经理：{{ projectAssignmentPeople(project.id).projectManagers }}</span></td><td data-label="状态"><span class="pm-badge-stack"><span class="pm-badge" :class="statusTone(project.status)">{{ project.status }}</span><span v-if="projectReportStageLabel(project)" class="pm-badge" :class="statusTone(project.report_stage)">报告编制 · {{ projectReportStageLabel(project) }}</span></span></td><td data-label="交付进度"><ProgressCell :percent="project.progress" /></td><td data-label="计划完成" :class="{ 'pm-text-danger': project.due.includes('超期') }">{{ project.due }}</td><td class="pm-card-action" data-label="操作"><button class="pm-link" @click="openProject(project)">详情</button></td></tr>
              <tr v-if="!pagedProjects.length"><td colspan="10">
                <ListState
                  :loading="reportStageListLoading"
                  :error="projectListError"
                  error-title="报告阶段筛选结果读取失败"
                  :retry="Boolean(projectListError)"
                  :empty-title="projectListSource.length ? '暂无符合当前筛选条件的项目' : '暂无项目，请先新建项目'"
                  loading-title="正在按报告阶段筛选…"
                  @retry="loadReportStageProjects"
                  compact
                >
                  <template #empty-action><button type="button" class="pm-button" @click="resetProjectFilters">重置筛选</button></template>
                </ListState>
              </td></tr>
            </tbody></table></div>
            <footer class="pm-table-footer"><span>已选择 {{ selectedRows.length }} 项</span><PaginationBar label="项目列表分页" :page="projectPage" :total="filteredProjects.length" :page-size="projectPageSize" :loading="reportStageListLoading" @change="gotoProjectPage" /></footer>
          </section>
        </template>

        <template v-else-if="activeSection === 'project_detail'">
          <section v-if="!detailProject" class="pm-empty">
            <ConsoleIcon name="info" /><b>未找到项目</b><span>可能已被删除或不在你的数据范围内。</span><button class="pm-button" @click="navigate('projects')">返回项目列表</button>
          </section>
          <template v-else>
            <section class="pm-actions-bar"><button class="pm-button" @click="navigate('projects')"><ConsoleIcon name="reset" />返回项目列表</button><button class="pm-button" :disabled="loading" @click="loadWorkspace"><ConsoleIcon name="reset" />刷新</button></section>
            <ReimbursementSpendPanel :session="session" :project-id="detailProject.id" :project-status="detailProject.status" />
            <ProjectArchiveDirectory :key="detailProject.id" :project="detailProject" :items="detailItems"
              :events="detailEvents" :session="session" @view-service="detailTab='items';selectServiceItem($event)"
              @view-events="detailTab='events'" />
            <section v-if="detailProject.source_kind === 'NATIVE' && canReadNativeProjectScope && (nativeProjectEnabled || nativeScopeProjectID === detailProject.id)" class="pm-panel">
              <button v-if="!nativeScopeProjectID && nativeProjectEnabled" type="button" class="pm-button"
                :disabled="saving" @click="nativeScopeProjectID = detailProject.id">原生委托范围变更</button>
              <NativeScopeChangePanel
                v-if="nativeScopeProjectID === detailProject.id"
                :key="detailProject.id" :project-id="detailProject.id"
                :categories="detectionCategories" :disabled="saving || !nativeProjectEnabled"
                @close="nativeScopeProjectID = ''" @changed="onNativeScopeChanged"
              />
            </section>
            <section v-if="detailSupplementClosure.visible" class="pm-supplement-closure" aria-label="补充协议关账">
              <ConsoleIcon name="info" />
              <div>
                <b>项目处于补充协议处理中</b>
                <p>补充协议已审批回写后，如果拆解已推进、无法再通过「调整拆解」重建清单，就在这里显式关账。关账后以当前拆解范围指纹为基准，不能再通过「确认拆解」清除补充协议标记。</p>
                <p v-if="!detailSupplementClosure.allowed" class="pm-supplement-closure-locked">{{ detailSupplementClosure.reason }}</p>
              </div>
              <button v-if="detailSupplementClosure.allowed" type="button" class="pm-button primary" :disabled="saving || closureLoading || closureSaving" @click="openSupplementClosure(detailProject)">{{ closureLoading ? '读取中…' : '补充协议关账' }}</button>
              <button v-else type="button" class="pm-button" disabled :title="detailSupplementClosure.reason">补充协议关账</button>
            </section>
            <article class="pm-panel">
              <header><div><p class="pm-panel-kicker">项目概览</p><h2>{{ detailProject.id }} · {{ detailProject.customer }}</h2></div><span class="pm-badge neutral">{{ detailProject.status }}</span></header>
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
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">服务项编号</th><th scope="col">场所 / 批次</th><th scope="col">检测类别</th><th scope="col">体系</th><th scope="col">特殊方法</th><th scope="col">状态</th><th scope="col">渗透专项</th><th scope="col">报告</th><th scope="col">计划窗口</th><th scope="col"></th></tr></thead><tbody>
                <tr v-for="item in detailItems" :key="item.id"><td class="mono"><b>{{ item.id }}</b></td><td>{{ item.site }}<span class="pm-cell-sub">{{ item.batch }}</span></td><td>{{ item.category }}</td><td>{{ item.system || '—' }}</td><td><span class="pm-badge" :class="item.special === '是' ? '待确认' : 'neutral'">{{ item.special || '否' }}</span></td><td><span class="pm-badge" :class="statusTone(item.status)">{{ item.status }}</span></td><td><span v-if="isEmbeddedPenetrationItem(item)" class="pm-badge" :class="item.penetration_work_package?.decision_status === 'REQUIRED' ? '待确认' : 'neutral'">{{ penetrationPackageLabel(item) }}</span><span v-else>—</span></td><td>{{ item.report_status ? (reportStatusLabel[item.report_status] || item.report_status) : '—' }}</td><td>{{ item.planned_start ? `${formatBusinessDate(item.planned_start)} ~ ${formatBusinessDate(item.planned_end)}` : '待排期' }}</td><td><button class="pm-link" @click="navigate('implementation')">看板</button></td></tr>
                <tr v-if="!detailItems.length"><td colspan="10" class="pm-empty-mini">该项目暂无服务项</td></tr>
              </tbody></table></div>
            </article>
            <article v-if="detailTab === 'items' && detailGantt.length" class="pm-panel">
              <header><div><p class="pm-panel-kicker">计划窗口</p><h2>服务项计划窗口</h2></div><span>按全部已排期服务项的时间并集定位</span></header>
              <div class="pm-gantt">
                <div v-for="row in detailGantt" :key="row.id" class="pm-gantt-row">
                  <span class="pm-gantt-label"><b>{{ row.id }}</b> · {{ row.label }}</span>
                  <div class="pm-gantt-track"><span class="pm-gantt-bar" :class="ganttTone(row.status)" :style="{ left: `${row.left}%`, width: `${row.width}%` }">{{ row.window }}</span></div>
                </div>
              </div>
            </article>
            <article v-if="detailTab === 'plan'" class="pm-table-panel">
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">服务项</th><th scope="col">计划窗口</th><th scope="col">实施人员</th><th scope="col">设备</th><th scope="col">渗透合规</th></tr></thead><tbody>
                <tr v-for="item in detailItems.filter((row) => row.implementation_plan)" :key="item.id"><td class="mono"><b>{{ item.id }}</b></td><td>{{ item.planned_start ? `${formatBusinessDate(item.planned_start)} ~ ${formatBusinessDate(item.planned_end)}` : '—' }}</td><td>{{ (item.implementation_plan?.personnel || []).map((row) => row.resource_name).join('、') || '未登记' }}</td><td>{{ (item.implementation_plan?.equipment || []).map((row) => row.resource_name).join('、') || '未登记' }}</td><td><span v-if="item.test_mode === 'PENETRATION'" class="pm-badge 待确认">{{ item.implementation_plan?.auth_doc_no || '待补授权书' }}</span><span v-else>—</span></td></tr>
                <tr v-if="!detailItems.some((row) => row.implementation_plan)"><td colspan="5" class="pm-empty-mini">暂无已发布的实施计划</td></tr>
              </tbody></table></div>
            </article>
            <section v-if="detailTab === 'plan' && detailItems.some(isEmbeddedPenetrationItem)" class="pm-detail-penetration-list">
              <PenetrationWorkPackageCard v-for="item in detailItems.filter(isEmbeddedPenetrationItem)" :key="item.id" :item="item" :session="session" :engineer-options="penetrationEngineerOptions" compact @updated="updatePenetrationPackage" @notify="notifyFromPenetration" />
            </section>
            <article v-if="detailTab === 'events'" class="pm-panel">
              <header><div><p class="pm-panel-kicker">交付事件</p><h2>交付动态</h2></div><span>最近 {{ detailEvents.length }} 条</span></header>
              <div class="pm-timeline"><div v-for="event in detailEvents" :key="event.id"><i></i><b>{{ eventLabel(event) }}</b><p>{{ event.service_item_id || detailProject.id }} · 操作人 {{ personLabel(event.actor_user_id, '系统') }}</p><time>{{ formatDateTime(event.created_at) }}</time></div><div v-if="!detailEvents.length" class="pm-empty-mini">暂无交付动态</div></div>
            </article>
            <article v-if="detailTab === 'exceptions'" class="pm-panel">
              <header><div><p class="pm-panel-kicker danger">异常记录</p><h2>异常记录</h2></div><button class="pm-link" @click="navigate('exceptions')">前往异常评审 →</button></header>
              <div class="pm-risk-list"><button v-for="event in detailPendingDeviations" :key="event.id" @click="navigate('exceptions')"><span :class="event.payload?.severity === 'HIGH' ? 'high' : 'medium'">{{ event.payload?.severity === 'HIGH' ? '高' : '中' }}</span><div><b>{{ event.payload?.deviation_id }} · {{ event.service_item_id }}</b><p>{{ event.payload?.description || '现场偏离' }}</p></div><time>{{ formatDateTime(event.created_at) }}</time></button><div v-if="!detailPendingDeviations.length" class="pm-empty-mini">该项目暂无待评审异常</div></div>
            </article>
          </template>
        </template>

        <template v-else-if="activeSection === 'monitoring'">
          <article class="pm-panel pm-monitoring-snapshot" :class="{ 'is-empty': !monitoringLoading && !monitoredStatusMix.length }">
            <header><div><p class="pm-panel-kicker">实时快照</p><h2>在途项目实时监控</h2><small>服务端快照 {{ monitoringUpdatedLabel }} · 与本机相差 {{ monitoringLagSeconds ?? '—' }} 秒</small></div><div class="pm-panel-actions"><span>共 {{ monitoringSnapshot.total }} 个在途项目</span><button type="button" class="pm-button ghost" :disabled="monitoringLoading" @click="refreshMonitoringSnapshot">{{ monitoringLoading ? '同步中…' : '立即刷新' }}</button></div></header>
            <div v-if="monitoringError" class="pm-inline-alert danger" role="alert">{{ monitoringError }}；已保留上一份成功快照。</div>
            <template v-if="monitoredStatusMix.length">
              <div class="pm-statusbar" role="img" :aria-label="monitoredStatusMix.map((bucket) => `${bucket.key} ${bucket.count} 个`).join('，')">
                <i v-for="bucket in monitoredStatusMix" :key="bucket.key" :style="{ width: `${bucket.pct}%`, background: bucket.tone }" :title="`${bucket.key} ${bucket.count} 个（${bucket.pct}%）`"></i>
              </div>
              <div class="pm-statusbar-legend">
                <span v-for="bucket in monitoredStatusMix" :key="bucket.key"><i :style="{ background: bucket.tone }"></i>{{ bucket.key }} {{ bucket.count }} 个</span>
                <span class="mono">版本 {{ monitoringSnapshot.snapshot_version }}</span>
              </div>
            </template>
            <div v-else class="pm-monitoring-empty-state" role="status">
              <span class="pm-monitoring-empty-icon" aria-hidden="true"><ConsoleIcon name="info" /></span>
              <div><b>{{ monitoringLoading ? '正在同步监控快照' : '当前没有在途项目' }}</b><span>{{ monitoringLoading ? '正在向服务端获取最新项目状态，请稍候。' : '新项目完成审批并进入交付后，会自动出现在这里。' }}</span></div>
              <small v-if="monitoringSnapshot.snapshot_version" class="mono">版本 {{ monitoringSnapshot.snapshot_version }}</small>
            </div>
          </article>
          <section class="pm-sm-tabs">
            <button v-for="tab in monitorFilterTabs" :key="tab.key || 'all'" type="button" class="pm-tab-pill" :class="{ active: monitorFilter === tab.key }" @click="monitorFilter = tab.key">{{ tab.label }}</button>
          </section>
          <section class="pm-dashboard-grid">
            <article class="pm-panel">
              <header><div><p class="pm-panel-kicker">在途交付</p><h2>在途交付概览</h2></div><span>口径来自监控接口</span></header>
              <div class="pm-overview-metrics">
                <dl class="pm-desc-list">
                  <div class="pm-desc-item"><dt>当前筛选项目</dt><dd>{{ monitoringSnapshot.total }}</dd></div>
                  <div class="pm-desc-item"><dt>当前页服务项</dt><dd>{{ monitoringRows.reduce((sum, row) => sum + Number(row.project?.services || 0), 0) }}</dd></div>
                  <div class="pm-desc-item"><dt>SLA 超期 / 临近</dt><dd :class="monitoringRows.some((row) => row.sla_items?.length) ? 'pm-text-danger' : ''">{{ monitoringRows.reduce((sum, row) => sum + (row.sla_items?.length || 0), 0) }}</dd></div>
                  <div class="pm-desc-item"><dt>资源冲突</dt><dd class="pm-text-danger">{{ monitoringRows.reduce((sum, row) => sum + Number(row.resources?.conflict_items || 0), 0) }}</dd></div>
                  <div class="pm-desc-item"><dt>最近事件</dt><dd>{{ monitoringSnapshot.recent_events.length }}</dd></div>
                  <div class="pm-desc-item"><dt>自动同步</dt><dd class="pm-text-success">15 秒</dd></div>
                </dl>
              </div>
            </article>
            <article class="pm-panel pm-risk-card">
              <header><div><p class="pm-panel-kicker danger">风险预警</p><h2>⚠ 风险预警 <b class="pm-num-badge">{{ riskProjectCount }}</b></h2></div><button class="pm-link" @click="navigate('exceptions')">查看全部 →</button></header>
              <RiskList :items="riskRows" @select="navigate('exceptions')" />
            </article>
          </section>
          <!-- SLA 超期明细是辅助数据：只在进入监控区域或显式刷新时读取。
               失败必须显示「不可用」并保留重试，不能渲染成「暂无超期」。 -->
          <section class="pm-table-panel">
            <header class="pm-monitor-head"><div><p class="pm-panel-kicker danger">时限预警</p><h2>SLA 超期与临近超期服务项</h2></div><div class="pm-panel-actions"><span>综合计划完成时间与流程时限生成提醒</span><button type="button" class="pm-button ghost" :disabled="slaOverdueLoading" @click="refreshSlaDetails">{{ slaOverdueLoading ? '同步中…' : '立即刷新' }}</button></div></header>
            <ListState v-if="slaOverdueLoading || slaOverduePending || slaOverdueError" :loading="slaOverdueLoading || slaOverduePending" :error="slaOverdueError" error-title="SLA 超期明细不可用" loading-title="正在读取 SLA 超期明细…" retry-text="重试读取" compact @retry="refreshSlaDetails" />
            <div v-else class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">服务项</th><th scope="col">所属项目</th><th scope="col">场所 / 类别</th><th scope="col">状态</th><th scope="col">口径</th><th scope="col">判定依据</th><th scope="col">时限</th></tr></thead><tbody>
              <tr v-for="item in slaOverdueItems" :key="`${item.kind}-${item.id}`"><td class="mono"><b>{{ item.id }}</b></td><td><button class="pm-project-link" @click="openProject({ id: item.project_id })"><b>{{ item.project_id }}</b></button></td><td>{{ item.site }}<span class="pm-cell-sub">{{ item.category }}</span></td><td><span class="pm-badge" :class="statusTone(item.status)">{{ item.status }}</span></td><td><span class="pm-badge" :class="item.kind === 'STATUS_DEADLINE_APPROACHING' ? '关注' : '风险'">{{ slaKindLabel[item.kind] || '计划完成超期' }}</span></td><td>{{ item.rule_name ? `${item.rule_name}（${item.rule_status} · ${item.deadline_hours}h）` : (item.planned_end ? `计划完成 ${formatBusinessDateTime(item.planned_end)}` : '—') }}</td><td :class="{ 'pm-text-danger': item.kind !== 'STATUS_DEADLINE_APPROACHING' }">{{ slaDueLabel(item) }}</td></tr>
              <tr v-if="!slaOverdueItems.length"><td colspan="7" class="pm-empty-mini">暂无超期或临近超期的服务项</td></tr>
            </tbody></table></div>
          </section>
          <section class="pm-table-panel">
            <header class="pm-monitor-head">
              <div><p class="pm-panel-kicker">运营明细</p><h2>项目、里程碑、资源与 SLA</h2></div><span class="pm-filter-count">共 {{ monitoringSnapshot.total }} 条</span>
            </header>
            <FilterBar variant="flat" @reset="resetMonitoringFilters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索项目 / 客户 / 团队"  maxlength="100"/></label><select v-model="teamFilter" class="pm-filter-select" aria-label="按团队筛选"><option value="">团队：全部</option><option v-for="option in teamOptions" :key="option" :value="option">{{ option }}</option></select><select v-model="monitorCategory" class="pm-filter-select" aria-label="按检测类别筛选"><option value="">服务类别：全部</option><option v-for="option in categoryOptions" :key="option" :value="option">{{ option }}</option></select><select v-model="monitorProjectManager" class="pm-filter-select" aria-label="按项目经理筛选"><option value="">项目经理：全部</option><option v-for="option in projectManagerOptions" :key="option.id" :value="option.id">{{ option.name }}</option></select><label class="pm-filter-check"><input v-model="monitorSLAOnly" type="checkbox" /> SLA 预警</label><label class="pm-filter-check"><input v-model="monitorConflictOnly" type="checkbox" /> 资源冲突</label><label class="pm-filter-date">计划完成从 <input v-model="monitorDueFrom" type="date" /></label><label class="pm-filter-date">至 <input v-model="monitorDueTo" type="date" /></label></FilterBar>
            <div class="pm-table-scroll"><table class="pm-table pm-monitor-table"><thead><tr><th scope="col">项目 / 客户</th><th scope="col">当前 / 下一里程碑</th><th scope="col">服务项 / 资源</th><th scope="col">项目状态 / 进度</th><th scope="col">SLA / 冲突</th><th scope="col">最近动态</th><th scope="col"></th></tr></thead><tbody>
              <tr v-for="row in monitoringRows" :key="row.project.id" :class="{ risk: row.project.risk || row.sla_items?.length || row.resources?.conflict_items }"><td class="pm-monitor-sticky-col"><button class="pm-project-link" @click="openProject(row.project)"><b>{{ row.project.id }}</b></button><span class="pm-cell-sub">{{ row.project.customer }}</span><span class="pm-cell-sub">{{ row.project.team || '未分配团队' }}</span></td><td><b>{{ row.milestone.current }}</b><span class="pm-cell-sub">下一节点：{{ row.milestone.next || '—' }}</span><div class="pm-inline-progress"><i :style="{ width: `${Math.round((row.milestone.done / row.milestone.total) * 100)}%` }"></i></div></td><td aria-label="服务项状态与资源"><span>{{ row.project.services }} 项</span><span class="pm-cell-sub">{{ monitoringServiceSummary(row) }}</span><span class="pm-cell-sub"><b class="pm-inline-label">资源：</b>{{ monitoringResourceSummary(row) }}<template v-if="row.resources?.conflict_items"><span class="pm-cell-warning"> · {{ row.resources.conflict_items }} 项冲突</span></template></span></td><td><span class="pm-badge-stack"><span class="pm-badge" :class="statusTone(row.project.status)">{{ row.project.status }}</span><span v-if="projectReportStageLabel(row.project)" class="pm-badge" :class="statusTone(row.project.report_stage)">报告编制 · {{ projectReportStageLabel(row.project) }}</span></span><span class="pm-cell-sub">{{ monitoredStatusByProject(row.project) }}</span><ProgressCell :percent="row.project.progress" /></td><td><span class="pm-badge" :class="row.sla_items?.length ? '风险' : 'normal'">{{ monitoringSlaLabel(row) }}</span><span class="pm-cell-sub" :class="{ 'pm-text-danger': row.sla_items?.some((item) => item.kind === 'PLAN_END_OVERDUE') }">计划完成：{{ row.planned_end ? formatBusinessDate(row.planned_end) : '待排期' }}</span></td><td><template v-if="row.latest_event"><b>{{ eventLabel(row.latest_event) }}</b><span class="pm-cell-sub">{{ personLabel(row.latest_event.actor_user_id, '系统') }} · {{ formatDateTime(row.latest_event.created_at) }}</span></template><span v-else>—</span></td><td class="pm-col-actions"><button class="pm-link" @click="openMonitoringAction(row)">前往当前节点</button><button class="pm-link" @click="openProjectTimeline(row.project)">时间线</button></td></tr>
              <tr v-if="!monitoringRows.length"><td colspan="7" class="pm-empty-mini">{{ monitoringLoading ? '正在同步监控快照…' : '暂无匹配的在途项目' }}</td></tr>
            </tbody></table></div>
            <!-- 总数只由分页条给出「第 N 页，共 M 条」：不再在页脚紧邻手写一行「共 N 个在途项目」。 -->
            <footer class="pm-table-footer"><PaginationBar label="在途项目监控分页" :page="monitorPage" :total="monitoringSnapshot.total" :page-size="monitorPageSize" :loading="monitoringLoading" @change="changeMonitoringPage" /></footer>
          </section>
          <section class="pm-table-panel pm-event-stream-panel">
            <details class="pm-event-stream">
              <summary class="pm-event-stream-summary">
                <div><p class="pm-panel-kicker">事件流</p><h2>最近交付事件</h2></div>
                <span>{{ monitoringSnapshot.recent_events.length }} 条 · 点击展开</span>
              </summary>
              <div class="pm-timeline"><button v-for="event in monitoringSnapshot.recent_events" :key="event.id" type="button" @click="openProjectTimeline({ id: event.project_id })"><i></i><b>{{ eventLabel(event) }}</b><p>{{ event.project_id }}<template v-if="event.service_item_id"> · {{ event.service_item_id }}</template> · {{ personLabel(event.actor_user_id, '系统') }}</p><time>{{ formatDateTime(event.created_at) }}</time></button><div v-if="!monitoringSnapshot.recent_events.length" class="pm-empty-mini">当前筛选范围内暂无交付事件</div></div>
            </details>
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
          <section v-else class="pm-decompose-grid"><article class="pm-panel pm-tree-panel"><header><div><p class="pm-panel-kicker">服务项树</p><h2>服务项树</h2></div><span>{{ currentDecompositionItems.length }} 项</span></header><button v-for="([batch, items], index) in decompositionBatches" :key="batch" type="button" :aria-pressed="activeDecompositionBatch === batch" :class="{ active: activeDecompositionBatch === batch }" @click="selectedDecompositionBatch = batch"><span>{{ String(index + 1).padStart(2, '0') }}</span><div><b>{{ batch }}</b><small>{{ items.length }} 个服务项</small></div></button><div class="pm-tree-note"><b>自动拆解校验</b><p>{{ currentDecompositionItems.filter((item) => item.test_mode === 'PENETRATION').length }} 项渗透测试需要专项计划；确认后的服务项进入资源分配。</p></div></article>
            <article class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">纳入</th><th scope="col">服务项编号</th><th scope="col">场所 / 批次</th><th scope="col">检测类别</th><th scope="col">技术要求摘要</th><th scope="col">体系</th><th scope="col">特殊方法</th><th scope="col">状态</th></tr></thead><tbody><tr v-for="item in visibleDecompositionItems" :key="item.id"><td><input v-model="item.selected" type="checkbox" :aria-label="`纳入 ${item.id}`" /></td><td class="mono"><b>{{ item.id }}</b></td><td>{{ item.site }}<span class="pm-cell-sub">{{ item.batch }}</span></td><td>{{ item.category }}</td><td>{{ item.requirement }}</td><td>{{ item.system }}</td><td><span class="pm-badge" :class="item.special === '是' ? '待确认' : 'neutral'">{{ item.special }}</span></td><td><span class="pm-badge" :class="statusTone(item.status)">{{ item.status }}</span></td></tr></tbody></table></div></article>
          </section>
        </template>

        <template v-else-if="activeSection === 'implementation'">
          <section class="pm-board-summary"><div><strong>{{ implementationProjectCount }}</strong><span>当前节点项目</span></div><div><strong>{{ implementationItems.length }}</strong><span>当前节点服务项</span></div><div><strong>{{ preparedImplementationCount }}</strong><span>准备完成</span></div><div><strong>{{ fieldImplementationCount }}</strong><span>现场实施中</span></div><div><strong>{{ penetrationPackageStats.total }}</strong><span>渗透专项（待确认 {{ penetrationPackageStats.pending }} / 进行中 {{ penetrationPackageStats.active }} / 完成 {{ penetrationPackageStats.completed }}）</span></div></section>
          <section class="pm-kanban"><article v-for="column in implementationKanbanColumns" :key="column.key"><header><div><i :class="column.color"></i><b>{{ column.key }}</b></div><span>{{ column.count }}</span></header><div class="pm-kanban-body"><button v-for="card in column.cards" :key="card.id" class="pm-kanban-card" :class="[column.color, { risk: card.risk }]" @click="openProject(card)"><b>{{ card.id }}</b><h3>{{ card.customer }}</h3><span class="pm-badge-stack"><span class="pm-badge" :class="statusTone(card.status)">{{ card.status }}</span><span v-if="projectReportStageLabel(card)" class="pm-badge" :class="statusTone(card.report_stage)">报告编制 · {{ projectReportStageLabel(card) }}</span></span><div class="pm-inline-progress"><i :style="{ width: `${card.progress}%` }"></i></div><footer><span>{{ card.progress }}%</span><time>{{ card.due || '待排期' }}</time></footer></button><div v-if="!column.cards.length" class="pm-empty-mini">暂无当前节点项目</div></div></article></section>
          <section class="pm-panel pm-operation-panel">
            <header><div><p class="pm-panel-kicker">现场实施</p><h2>现场测评与记录</h2></div><div class="pm-field-sync"><span class="pm-badge" :class="pendingFieldSyncCount ? '关注' : 'normal'">待同步 {{ pendingFieldSyncCount }}</span><button v-if="pendingFieldSyncCount" type="button" class="pm-link" :disabled="fieldSyncing" @click="flushFieldOperations(true)">{{ fieldSyncing ? '同步中…' : '立即重试' }}</button></div></header>
            <ServiceItemPicker :items="implementationItems" :selected-ids="selectedServiceItem ? [selectedServiceItem.id] : []" empty-text="暂无处于现场实施节点的服务项" @select="selectServiceItem" />
            <PenetrationWorkPackageCard v-if="selectedServiceItem && isEmbeddedPenetrationItem(selectedServiceItem)" :item="selectedServiceItem" :session="session" :engineer-options="penetrationEngineerOptions" @updated="updatePenetrationPackage" @notify="notifyFromPenetration" />
            <button v-if="selectedServiceItem && selectedServiceItem.status === '实施准备中' && canExecuteField" class="pm-button primary" :disabled="saving" @click="runOperation('field-start')">进入实施中</button>
            <div v-if="selectedServiceItem && selectedServiceItem.status === '实施中' && canExecuteField" class="pm-field-workflow">
              <section class="pm-field-step"><header><span>01</span><div><b>GPS 现场签到</b><small>记录设备定位、精度与采集时间；离线时安全排队。</small></div></header><label><span>偏离说明（定位与现场不一致时填写）</span><input v-model.trim="operationForm.checkInDeviationReason" placeholder="例如 客户临时安排在同园区备用机房"  maxlength="1000"/></label><button class="pm-button primary" :disabled="saving" @click="runOperation('field-check-in')">获取定位并签到</button></section>
              <section class="pm-field-step"><header><span>02</span><div><b>填写现场记录</b><small>原始数据、环境条件与文件回执绑定同一采集时间。</small></div></header><div class="pm-form pm-operation-form"><label><span>现场原始数据 <em>*</em></span><textarea v-model.trim="operationForm.rawData" rows="3" placeholder="记录现场实测数据与依据" maxlength="2000"></textarea></label><label><span>环境条件 <em>*</em></span><textarea v-model.trim="operationForm.environment" rows="3" placeholder="记录现场环境条件" maxlength="500"></textarea></label><label><span>现场证据 <em>*</em></span><input type="file" accept="application/pdf,image/png,image/jpeg" @change="operationForm.fieldEvidenceFile = $event.target.files?.[0] || null" /><small>文件通过统一文件网关上传、校验并以 SHA-256 回执存证。</small></label><button class="pm-button primary" :disabled="saving" @click="runOperation('field')">保存现场记录</button></div></section>
              <section class="pm-field-step"><header><span>03</span><div><b>电子签名</b><small>签名图像经文件网关存证，并绑定当前账号与时间戳。</small></div></header><SignaturePad :key="signaturePadKey" @signed="operationForm.fieldSignatureFile = $event" @cleared="operationForm.fieldSignatureFile = null" /><button class="pm-button primary" :disabled="saving || !operationForm.fieldSignatureFile" @click="runOperation('field-signature')">提交电子签名</button></section>
            </div>
            <p v-if="selectedServiceItem && selectedServiceItem.status === '实施中' && canCompleteField" class="pm-form-hint" role="status"><b>缺项判定（服务端）</b><span class="pm-badge" :class="selectedFieldEvidenceStatus === FIELD_EVIDENCE_STATUS_READY ? 'normal' : '关注'">{{ selectedFieldEvidenceStatus === FIELD_EVIDENCE_STATUS_READY ? '已判定' : selectedFieldEvidenceStatus === FIELD_EVIDENCE_STATUS_PENDING ? '待同步' : '未知' }}</span>：{{ selectedFieldEvidence.label }}<span v-if="selectedFieldEvidenceDetails.length"> · 已具备 {{ selectedFieldEvidenceEvidenceSummary }}</span><button v-if="selectedFieldEvidenceStatus === FIELD_EVIDENCE_STATUS_UNKNOWN" type="button" class="pm-link" :disabled="fieldEvidenceLoading" @click="refreshSelectedFieldEvidence({ reportError: true })">{{ fieldEvidenceLoading ? '读取中…' : '重新读取' }}</button></p>
            <button v-if="selectedServiceItem && selectedServiceItem.status === '实施中' && canCompleteField" class="pm-button" :disabled="saving || pendingFieldSyncCount > 0 || fieldEvidenceBlocksCompletion" @click="runOperation('complete')">现场测评结束</button>
            <label v-if="selectedServiceItem && selectedServiceItem.status === '实施中' && canCompleteField && !fieldEvidenceBlocksCompletion && selectedFieldEvidenceGaps.length" class="pm-field-incomplete"><span>缺项确认说明 <em>*</em></span><textarea v-model.trim="operationForm.fieldIncompleteReason" rows="2" :placeholder="`当前缺少：${selectedFieldEvidenceGaps.join('、')}。确实无法补齐时说明原因。`" maxlength="1000"></textarea></label>
            <small v-if="pendingFieldSyncCount" class="pm-form-hint">仍有现场签到、记录或签名未同步，完成确认前请先联网补传。</small>
            <div v-else-if="!selectedServiceItem" class="pm-empty-mini">请先选择服务项</div>
          </section>
        </template>

        <component
          :is="equipmentPanel"
          v-else-if="activeSection === 'equipment'"
          :items="equipment"
          :loading="equipmentLoading || equipmentCatalogPending"
          :error="equipmentError"
          :can-manage="canManageDevice"
          :can-plan="canPlanImplementation"
          :saving="saving"
          :form="equipmentForm"
          :code-options="equipmentCodeOptions"
          :selected-codes="equipmentCodeSelection"
          :has-active-codes="hasActiveCapabilityCodes('EQUIPMENT')"
          :open-multi="openMulti"
          :multi-active-index="multiActiveIndex"
          @retry="retryEquipmentCatalog"
          @edit="editEquipment"
          @remove="removeEquipment"
          @return="returnEquipment"
          @save="saveEquipment"
          @open-import="equipmentImportOpen = true"
          @toggle-multi="toggleMulti('equipmentCodes')"
          @toggle-code="toggleEquipmentCode"
          @codes-keydown="onEquipmentCodesKeydown"
        />
        <template v-else-if="activeSection === 'qualifications'"><section class="pm-panel"><header class="pm-section-toolbar"><div class="pm-panel-actions"><button class="pm-button" :disabled="saving" @click="downloadCapabilities">导出 CSV</button><template v-if="canManageResource"><button class="pm-button" :disabled="saving" @click="qualificationImportOpen = true">导入人员资质 CSV</button><button class="pm-button" :disabled="saving" @click="syncIdentities">同步人员状态</button><button class="pm-button primary" :disabled="saving" @click="openCapabilityDialog()">＋ 新建人员资质</button></template></div></header><div class="pm-qualification-filter"><section class="pm-sm-tabs pm-capability-tabs"><button v-for="tab in capabilityTabs" :key="tab.key" type="button" class="pm-tab-pill" :class="{ active: capabilityTab === tab.key }" @click="capabilityTab = tab.key">{{ tab.label }}<span class="pm-tab-count">{{ tab.count }}</span></button></section><label><span>资源类型</span><select v-model="capabilityTypeFilter" class="pm-filter-select"><option value="">全部</option><option value="PERSON">人员资质</option><option value="EQUIPMENT">设备能力（只读）</option></select></label><label><span>状态</span><select v-model="capabilityStatusFilter" class="pm-filter-select"><option value="">全部</option><option value="ACTIVE">有效</option><option value="EXPIRED">无效（已过期）</option><option value="NOT_YET_EFFECTIVE">未生效</option><option value="DISABLED">停用</option></select></label></div></section><section v-if="capabilityTab === 'codes'" class="pm-table-panel"><header><div><p class="pm-panel-kicker">资质矩阵</p><h2>体系与编码映射</h2></div><span>按能力台账聚合：编码 × 持有人员数 / 设备数</span></header><div class="pm-matrix-wrap" data-table-scroll><table class="pm-matrix"><thead><tr><th scope="col">能力编码</th><th scope="col">人员</th><th scope="col">设备</th><th scope="col">覆盖合计</th></tr></thead><tbody><tr v-for="row in capabilityCodeRows" :key="row.code"><td><span class="pm-code-pill">{{ row.code }}</span></td><td><span class="pm-badge" :class="row.personCount ? 'normal' : 'neutral'">{{ row.personCount }} 人</span></td><td><span class="pm-badge" :class="row.equipmentCount ? 'normal' : 'neutral'">{{ row.equipmentCount }} 台</span></td><td class="num">{{ row.personCount + row.equipmentCount }}</td></tr><tr v-if="!capabilityCodeRows.length"><td colspan="4" class="pm-empty-mini">暂无能力编码，请在规则配置中心维护</td></tr></tbody></table></div></section>
          <section v-else-if="capabilityTab === 'expiry'" class="pm-table-panel"><header><div><p class="pm-panel-kicker danger">到期提醒</p><h2>设备检定到期提醒</h2></div><span>30 天内到期或已过期 · 按到期时间升序</span></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">设备编号</th><th scope="col">设备名称</th><th scope="col">能力编码</th><th scope="col">检定到期日</th><th scope="col">状态</th></tr></thead><tbody><tr v-for="item in expiringCapabilities" :key="item.resource_id" :class="{ risk: new Date(item.valid_until).getTime() <= Date.now() }"><td class="mono">{{ item.resource_id }}</td><td><b>{{ item.resource_name }}</b></td><td><CodePills :codes="item.codes || []" /></td><td :class="{ 'pm-text-danger': new Date(item.valid_until).getTime() <= Date.now() }">{{ formatBusinessDate(item.valid_until) }}</td><td><span class="pm-badge" :class="new Date(item.valid_until).getTime() <= Date.now() ? '风险' : '关注'">{{ new Date(item.valid_until).getTime() <= Date.now() ? '已过期' : '即将到期' }}</span></td></tr><tr v-if="!expiringCapabilities.length"><td colspan="5" class="pm-empty-mini">30 天内没有到期的设备检定</td></tr></tbody></table></div></section>
          <section v-else class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">资源类型</th><th scope="col">编号</th><th scope="col">名称</th><th scope="col">资质 / 能力编码</th><th scope="col">有效期</th><th scope="col">使用范围</th><th scope="col">状态</th><th scope="col">人员状态</th><th scope="col"></th></tr></thead><tbody><tr v-for="item in filteredCapabilities" :key="item.resource_id"><td><span class="pm-badge neutral">{{ item.resource_type === 'PERSON' ? '人员' : '设备' }}</span></td><td class="mono">{{ item.resource_id }}</td><td><b>{{ item.resource_name }}</b></td><td><CodePills :codes="item.codes || []" /></td><td>{{ item.valid_until ? (item.valid_from ? `${formatBusinessDate(item.valid_from)} ~ ` : '') + formatBusinessDate(item.valid_until) : '长期' }}</td><td><span v-if="item.resource_type === 'EQUIPMENT'" class="pm-badge" :class="item.usage_scope === 'COMPANY_ONLY' ? '关注' : 'neutral'">{{ item.usage_scope === 'COMPANY_ONLY' ? '仅在公司使用' : '可借出' }}</span><span v-else>—</span></td><td><span class="pm-badge" :class="statusTone(capabilityEffectiveStatus(item))">{{ capabilityStatusLabel(item) }}</span><small v-if="item.status_reason" class="pm-cell-sub">{{ item.status_reason }}</small></td><td><template v-if="item.resource_type === 'PERSON'"><span class="pm-badge" :class="statusTone(item.identity_status)">{{ identityStatusLabel(item.identity_status) }}</span></template><span v-else>—</span></td><td class="pm-col-actions"><button v-if="canManageResource && item.resource_type === 'PERSON'" class="pm-link" @click="openCapabilityDialog(item)">编辑人员资质</button><span v-else-if="item.resource_type === 'EQUIPMENT'" class="pm-cell-sub">请到设备能力维护</span></td></tr></tbody></table></div><div v-if="!filteredCapabilities.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无资质记录</b><span>点击「＋ 新建人员资质」或通过 CSV 导入添加人员资质。</span></div><footer v-if="importResult"><span role="status">导入完成：成功 {{ importResult.imported }} 条，跳过 {{ importResult.skipped }} 条。</span><span v-if="importResult.errors?.length"><small>{{ importResult.errors.slice(0, 3).join('；') }}{{ importResult.errors.length > 3 ? '…' : '' }}</small></span></footer></section>
          <div v-if="capabilityDialog" class="pm-overlay" @click.self="capabilityDialog = null">
            <form class="pm-dialog" @submit.prevent="saveCapability">
              <header><div><span>人员资质</span><h2>{{ capabilityAutoID ? '新建人员资质' : '编辑人员资质' }}</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="capabilityDialog = null"><ConsoleIcon name="close" /></button></header>
              <div class="pm-form">
                <label><span>资源类型</span><input value="人员资质" readonly /></label>
                <label><span>人员编号 <em>*</em></span><input v-model.trim="capabilityDialog.resource_id" :readonly="capabilityAutoID" required placeholder="系统自动生成"  maxlength="64"/><small v-if="capabilityAutoID" class="pm-form-hint">由系统自动生成（P-），无需手工填写</small></label>
                <label><span>人员名称 <em>*</em></span><select v-model="capabilityDialog.user_id" :disabled="capabilityPersonnelLoading" required @change="onCapabilityPersonChange"><option value="">{{ capabilityPersonnelLoading ? '基础平台人员加载中…' : '请选择基础平台人员' }}</option><option v-for="person in capabilityPersonOptions" :key="person.id" :value="person.id">{{ person.name }}</option></select><small v-if="capabilityPersonnelError" class="pm-form-hint" role="alert">{{ capabilityPersonnelError }}</small></label>
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
                  <p v-if="!hasActiveCapabilityCodes('PERSON')" class="pm-form-hint">请先到「规则配置中心 → 资质 / 能力编码」新增并启用人员资质编码。</p>
                </div>
                <p class="pm-form-hint pm-span-full">人员资质不限制有效期；停用资质或人员身份失效后将不能参与项目分配。设备新建、停用和删除请到「设备能力」。</p>
                <label><span>状态</span><select v-model="capabilityDialog.status"><option value="ACTIVE">有效</option><option value="DISABLED">停用</option></select></label>
              </div>
              <footer><button type="button" class="pm-button" @click="capabilityDialog = null">取消</button><button class="pm-button primary" :disabled="saving || !capabilityDialog.user_id || capabilityPersonnelLoading">{{ saving ? '保存中…' : '保存人员资质' }}</button></footer>
            </form>
          </div>
        </template><template v-else-if="activeSection === 'split-rules'">
            <section class="pm-split-guide" aria-labelledby="split-guide-title">
              <div class="pm-split-guide-copy">
                <span class="pm-badge normal">新手引导</span>
                <p class="pm-panel-kicker">快速开始</p>
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
              <header><div><p class="pm-panel-kicker">第 1 步 · 拆解规则</p><h2>① 默认分组规则</h2><p>先定义大多数合同如何合并明细。建议保留“批次 + 检测类别”，并让业务管理员确认后再进入分配。</p></div><span class="pm-badge" :class="splitPolicy?.enabled ? 'normal' : 'neutral'">{{ splitPolicy?.enabled ? '已启用' : '已停用' }}</span></header>
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
              <header><div><p class="pm-panel-kicker">第 2 步 · 检测类别</p><h2>② 检测类别与人员要求</h2><p>为合同里的检测类别设置默认体系、人员资质和特殊方法要求，拆解后会自动带入服务项。</p></div><span class="pm-filter-count">启用 {{ activeDetectionCategoryCount }} / 共 {{ detectionCategories.length }} 类</span><div class="pm-panel-actions"><template v-if="canManageRules"><button type="button" class="pm-button" @click="downloadDetectionCategories">导出</button><button type="button" class="pm-button" :disabled="saving" @click="detectionCategoryImportOpen = true">导入</button><button type="button" class="pm-button primary" @click="openCategoryDialog()">＋ 新增类别</button></template></div></header>
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">检测类别</th><th scope="col">默认体系要求</th><th scope="col">必备资质（默认）</th><th scope="col">是否特殊方法</th><th scope="col">关联服务项</th><th scope="col">状态</th><th scope="col"></th></tr></thead><tbody><tr v-for="item in detectionCategories" :key="item.category"><td><b>{{ item.category }}</b></td><td>{{ item.system_standard || '—' }}</td><td>{{ item.required_qualifications || '—' }}</td><td><span class="pm-badge" :class="specialMethodTone[item.special_method] || 'neutral'">{{ specialMethodLabel[item.special_method] || item.special_method }}</span></td><td>{{ item.service_item_count || 0 }} 项</td><td><span class="pm-badge" :class="item.enabled ? 'normal' : 'neutral'">{{ item.enabled ? '启用' : '停用' }}</span></td><td class="pm-split-actions"><button v-if="canManageRules" class="pm-link" @click="openCategoryDialog(item)">编辑</button><button v-if="canManageRules" class="pm-link pm-text-danger" :disabled="saving" @click="removeDetectionCategory(item)">删除</button></td></tr><tr v-if="!detectionCategories.length"><td colspan="7" class="pm-empty-mini">尚未配置检测类别域</td></tr></tbody></table></div>
            </section>

            <section id="split-override-section" class="pm-panel pm-split-card pm-split-anchor">
              <header><div><p class="pm-panel-kicker">第 3 步 · 异常处理</p><h2>③ 特殊合同覆盖规则 <span class="pm-badge neutral">可选</span></h2><p>只有少数客户或合同需要不同拆解方式时才配置。数字越小优先级越高，命中第一条后停止继续匹配。</p></div><span class="pm-filter-count">启用 {{ activeSplitOverrideCount }} / 共 {{ splitOverrides.length }} 条</span><div class="pm-panel-actions"><button v-if="canManageRules" type="button" class="pm-button" @click="openOverrideDialog()">＋ 新建特例</button></div></header>
              <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">规则名称</th><th scope="col">匹配条件</th><th scope="col">覆盖设置</th><th scope="col">优先级</th><th scope="col">状态</th><th scope="col"></th></tr></thead><tbody><tr v-for="item in splitOverrides" :key="item.id"><td><b>{{ item.name }}</b></td><td>{{ overrideMatchText(item) }}</td><td>{{ overrideSettingsText(item) }}</td><td>{{ item.priority }}</td><td><span class="pm-badge" :class="item.enabled ? 'normal' : 'neutral'">{{ item.enabled ? '启用' : '停用' }}</span></td><td class="pm-split-actions"><button v-if="canManageRules" class="pm-link" @click="openOverrideDialog(item)">编辑</button><button v-if="canManageRules" class="pm-link pm-text-danger" :disabled="saving" @click="removeSplitOverride(item)">删除</button></td></tr><tr v-if="!splitOverrides.length"><td colspan="6" class="pm-empty-mini">尚未配置覆盖规则，全部合同按默认分组规则拆解</td></tr></tbody></table></div>
              <p v-if="splitConfigError" class="pm-form-hint" role="alert">{{ splitConfigError }}</p>
              <p v-else-if="splitConfigLoading" class="pm-form-hint">配置加载中…</p>
            </section>

            <div v-if="categoryDialog" class="pm-overlay" @click.self="categoryDialog = null">
              <form class="pm-dialog" @submit.prevent="submitDetectionCategory">
                <header><div><span>检测类别</span><h2>{{ categoryDialog.id ? '编辑检测类别' : '新增检测类别' }}</h2></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="categoryDialog = null"><ConsoleIcon name="close" /></button></header>
                <div class="pm-form">
                  <label><span>检测类别 <em>*</em></span><input v-model.trim="categoryDialog.category" required placeholder="例如 等保测评"  maxlength="128"/></label>
                  <label><span>默认体系要求</span><input v-model.trim="categoryDialog.system_standard" placeholder="例如 等保 2.0 / ISO 9001"  maxlength="128"/></label>
                  <label><span>必备资质（默认）</span><input v-model.trim="categoryDialog.required_qualifications" placeholder="例如 等级保护测评师（中级+）"  maxlength="255"/></label>
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
                <footer><button type="button" class="pm-button" @click="categoryDialog = null">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存检测类别' }}</button></footer>
              </form>
            </div>

            <div v-if="overrideDialog" class="pm-overlay" @click.self="overrideDialog = null"><form class="pm-dialog pm-dialog-wide" @submit.prevent="submitSplitOverride"><header><div><span>覆盖规则</span><h2>{{ overrideDialog.id ? '编辑覆盖规则' : '新建覆盖规则' }}</h2><small class="pm-dialog-sub">只覆盖显式给出的设置，其余沿用默认分组规则；命中多条时取优先级最小的那条。</small></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="overrideDialog = null"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>规则名称 <em>*</em></span><input v-model.trim="overrideDialog.name" required placeholder="例如 金融行业批量合同"  maxlength="255"/></label><label><span>优先级 <em>*</em></span><input v-model.number="overrideDialog.priority" type="number" min="1" required /></label><label><span>客户名称包含</span><input v-model.trim="overrideDialog.match.customer_contains" placeholder="例如 银行 / 证券"  maxlength="255"/></label><label><span>合同号包含</span><input v-model.trim="overrideDialog.match.contract_contains" placeholder="例如 GTSR-"  maxlength="64"/><small>按合同编号子串匹配，编号里包含这段文字才算命中；如果合同编号规则或前缀调整过，需要回来核对这条规则还能不能命中合同。</small></label><label><span>合同服务项数 ≤</span><input v-model.number="overrideDialog.match.max_service_items" type="number" min="0" /></label><label><span>覆盖分组维度 1</span><select v-model="overrideDialog.settings.dimension_primary"><option value="">不覆盖</option><option v-for="option in splitDimensionAnyOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label><span>覆盖分组维度 2</span><select v-model="overrideDialog.settings.dimension_secondary"><option value="">不覆盖</option><option v-for="option in splitDimensionAnyOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label><span>覆盖分组维度 3</span><select v-model="overrideDialog.settings.dimension_tertiary"><option value="">不覆盖</option><option v-for="option in splitDimensionAnyOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label><span>覆盖默认进入状态</span><select v-model="overrideDialog.settings.default_status"><option value="">不覆盖</option><option v-for="option in splitDefaultStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label><span>覆盖缺规则处理</span><select v-model="overrideDialog.settings.missing_rule_action"><option value="">不覆盖</option><option v-for="option in splitMissingRuleOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label><span>状态</span><select v-model="overrideDialog.enabled"><option :value="true">启用</option><option :value="false">停用</option></select></label></div><footer><button type="button" class="pm-button" @click="overrideDialog = null">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存覆盖规则' }}</button></footer></form></div>
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
            <header><div><p class="pm-panel-kicker">权限矩阵</p><h2>字段 × 角色 访问矩阵</h2></div><span>{{ permissionMatrix.rows.length }} 个受控字段 · {{ permissionMatrix.roles.length }} 个角色</span></header>
            <div class="pm-matrix-wrap" data-table-scroll><table class="pm-matrix"><thead><tr><th scope="col">字段 ↓ \ 角色 →</th><th scope="col" v-for="role in permissionMatrix.roles" :key="role">{{ applicationRoleLabel(role) }}</th></tr></thead><tbody><tr v-for="row in permissionMatrix.rows" :key="row.field"><td>{{ permissionFieldLabel(row.field) }}</td><td v-for="(cell, index) in row.cells" :key="`${row.field}-${permissionMatrix.roles[index]}`"><span v-if="cell" class="pm-badge" :class="permissionLevelTone[cell] || 'neutral'">{{ permissionLevelLabel[cell] || cell }}</span><span v-else class="pm-matrix-empty">未配置</span></td></tr></tbody></table></div>
          </section>
          <section class="pm-config-layout"><aside class="pm-config-note"><span><ConsoleIcon name="info" /></span><h2>{{ isStandardChangeSection ? '评估流程' : '生效范围' }}</h2><template v-if="isStandardChangeSection"><p>登记标准变化与影响范围，核对在途项目、检测方法和报告模板，处置完成后将记录归档。</p><ul><li>评估中：尚有影响待确认或待处置</li><li>已归档：影响核对和处置均已完成</li><li>历史记录用于追溯，不会自动改写已有项目</li></ul></template><template v-else><p>{{ activeConfigMeta.effectNote || currentMeta[1] }}</p><ul><li>配置修改需当前配置类型的管理权限</li><li>创建、更新和重新启用执行相同校验</li><li>关闭规则前请确认影响范围</li></ul></template></aside><article class="pm-table-panel"><header class="pm-filter-bar"><div v-if="!isStandardChangeSection" class="pm-sm-tabs"><button v-for="meta in visibleConfigKinds" :key="meta.kind" type="button" class="pm-tab-pill" :class="{ active: activeSection === meta.kind }" @click="navigate(meta.kind)">{{ meta.label }}</button></div><div v-else><b>标准变更评估清单</b></div><span class="pm-filter-count">{{ activeConfigMeta.label }} 共 {{ visibleRules.length }} 条</span></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">{{ isStandardChangeSection ? '标准 / 方法名称' : '配置名称' }}</th><th scope="col" v-for="column in activeConfigMeta.columns" :key="column.key">{{ column.label }}</th><th scope="col">状态</th><th scope="col">最后更新</th><th scope="col"></th></tr></thead><tbody><tr v-for="rule in visibleRules" :key="rule.id"><td><b>{{ rule.name }}</b></td><td v-for="column in activeConfigMeta.columns" :key="column.key">{{ rule[column.key] !== undefined && rule[column.key] !== '' ? rule[column.key] : '—' }}</td><td><template v-if="isStandardChangeSection"><span class="pm-badge" :class="rule.enabled ? 'amber' : 'neutral'">{{ rule.enabled ? '评估中' : '已归档' }}</span><button v-if="canManageRules" class="pm-link" :disabled="saving" @click="toggleRule(rule)">{{ rule.enabled ? '完成并归档' : '恢复评估' }}</button></template><button v-else-if="canManageActiveConfig" class="pm-switch" :class="{ on: rule.enabled }" :aria-label="`${rule.enabled ? '停用' : '启用'} ${rule.name}`" @click="toggleRule(rule)"><i></i></button><span v-else class="pm-badge" :class="rule.enabled ? 'normal' : 'neutral'">{{ rule.enabled ? '已启用' : '已停用' }}</span></td><td>{{ rule.updated }}</td><td><button v-if="canManageActiveConfig" class="pm-link" @click="openConfigEdit(rule)">编辑</button><button v-if="canManageActiveConfig" class="pm-link pm-text-danger" :disabled="saving" @click="removeConfigRule(rule)">删除</button></td></tr></tbody></table></div><div v-if="!visibleRules.length" class="pm-empty"><ConsoleIcon name="info" /><b>{{ isStandardChangeSection ? '暂无标准变更记录' : '暂无配置规则' }}</b><span>{{ isStandardChangeSection ? '发生标准或检测方法变更时，点击“登记标准变更”开始影响评估。' : `点击“新建规则”添加 ${activeConfigMeta.label} 配置。` }}</span></div></article></section>
        </template>

        <template v-else>
          <section class="pm-operational-stats"><article><span>{{ activeSection === 'allocation' ? '当前阶段服务项' : '待处理' }}</span><strong>{{ operationRows.length }}</strong><small>{{ activeSection === 'allocation' ? '含已分配、待补齐执行团队的服务项' : '来自当前工作区' }}</small></article><article><span>服务项总数</span><strong>{{ serviceItems.length }}</strong><small>以最新流程状态为准</small></article><article><span>已完成项目</span><strong>{{ completedProjectCount }}</strong><small>当前租户累计</small></article></section>
          <section class="pm-filters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索编号、项目或负责人"  maxlength="100"/></label><span>{{ operationRows.length }} 条结果</span></section>
          <section v-if="['allocation', 'inbox', 'planning', 'preparation', 'assignments', 'methods', 'exceptions', 'reports'].includes(activeSection)" class="pm-panel pm-operation-panel">
            <header><div><p class="pm-panel-kicker">现场操作</p><h2>服务项操作台</h2></div><span v-if="selectedServiceItem" class="pm-op-current">当前：{{ selectedServiceItem.id }} · <span class="pm-badge" :class="statusTone(selectedServiceItem.status)">{{ selectedServiceItem.status }}</span></span></header>
            <ServiceItemPicker v-if="activeSection === 'allocation'" :items="allocationItems" :selected-ids="selectedServiceItemIDs" multiple empty-text="暂无可分配服务项" hint="仅显示已完成拆解确认、当前处于待分配的项目；可多选批量分配。" @toggle="toggleServiceItem" /><ServiceItemPicker v-else :items="activeNodeItems" :selected-ids="selectedServiceItem ? [selectedServiceItem.id] : []" empty-text="当前节点暂无可操作服务项" @select="selectServiceItem" />
            <PenetrationWorkPackageCard v-if="activeSection !== 'allocation' && selectedServiceItem && isEmbeddedPenetrationItem(selectedServiceItem)" :item="selectedServiceItem" :session="session" :engineer-options="penetrationEngineerOptions" :auto-ensure="activeSection === 'planning'" @updated="updatePenetrationPackage" @notify="notifyFromPenetration" />
            <div v-if="activeSection === 'allocation' && selectedServiceItems.length" class="pm-panel-actions">
              <button v-if="canManageDecomposition" type="button" class="pm-button" :disabled="saving" @click="returnSelectedToDecomposition">退回拆解确认</button>
              <button v-if="canRevokeExecution" type="button" class="pm-button" :disabled="saving" @click="revokeSelectedAssignment('execution')">撤销执行团队</button>
              <button v-if="canRevokeTeam" type="button" class="pm-button danger" :disabled="saving" @click="revokeSelectedAssignment('team')">撤销团队负责人</button>
            </div>
            <div v-if="selectedServiceItem" class="pm-panel-actions">
              <button v-if="canRevokeImplementation && selectedServiceItem.status === '待实施'" type="button" class="pm-button danger" :disabled="saving" @click="revokeDeliveryPhase('plan')">撤销实施计划</button>
              <button v-if="canRevokeImplementation && selectedServiceItem.status === '实施准备中'" type="button" class="pm-button danger" :disabled="saving" @click="revokeDeliveryPhase('preparation')">撤销实施准备并释放设备</button>
              <button v-if="canRequestRollback && selectedServiceItem.status === '实施中'" type="button" class="pm-button" :disabled="saving" @click="submitRollbackRequest('FIELD_TO_PREPARATION')">申请回退至实施准备</button>
              <button v-if="canRequestRollback && selectedServiceItem.status === '现场实施完成' && ['RECTIFYING', 'COMPILING', 'REVIEWED'].includes(selectedServiceItem.report_status)" type="button" class="pm-button" :disabled="saving" @click="submitRollbackRequest('REPORT_TO_FIELD')">申请报告返工</button>
            </div>
            <section v-if="activeSection === 'inbox' && pendingRollbackRequests.length" class="pm-panel pm-approval-panel"><header><div><p class="pm-panel-kicker">回退审批</p><h2>待处理回退申请</h2></div><span>{{ pendingRollbackRequests.length }} 项</span></header><div v-for="request in pendingRollbackRequests" :key="request.id" class="pm-form-row"><span>{{ request.service_item_id }} · {{ request.payload?.kind === 'FIELD_TO_PREPARATION' ? '现场回退' : '报告返工' }} · {{ request.payload?.reason }}</span><template v-if="canApproveRollback && request.actor_user_id !== session?.user_id"><button type="button" class="pm-button primary" :disabled="saving" @click="decidePendingRollback(request, 'APPROVED')">批准回退</button><button type="button" class="pm-button danger" :disabled="saving" @click="decidePendingRollback(request, 'REJECTED')">驳回回退</button></template><button v-if="canRequestRollback && request.actor_user_id === session?.user_id" type="button" class="pm-button" :disabled="saving" @click="withdrawPendingRollback(request)">撤回申请</button></div></section>
            <div v-if="selectedServiceItem" class="pm-form pm-operation-form">
              <template v-if="['allocation', 'inbox', 'assignments'].includes(activeSection)">
                <p v-if="personnelError" class="pm-form-hint pm-span-full" role="alert">{{ personnelError }}</p>
                <div class="pm-field"><span>团队负责人 <em>*</em></span><SearchableSelect v-model="operationForm.teamLeadID" :options="teamLeadOptions" value-key="id" label-key="name" description-key="description" placeholder="请选择团队负责人" search-placeholder="搜索姓名、资质编号或资质编码" empty-text="人员资质库中没有匹配的团队负责人" aria-label="选择团队负责人" :disabled="personnelLoading" required /></div>
                <template v-if="canExecutionAssign">
                  <div class="pm-field"><span>项目经理 <em>*</em></span><SearchableSelect v-model="operationForm.projectManagerID" :options="projectManagerOptions" value-key="id" label-key="name" description-key="description" placeholder="请选择项目经理" search-placeholder="搜索姓名、资质编号或资质编码" empty-text="人员资质库中没有匹配的项目经理" aria-label="选择项目经理" :disabled="personnelLoading" required /></div>
                  <div class="pm-field"><span>实施工程师 <em>*</em></span><SearchableSelect v-model="engineerSelection" :options="engineerOptions" value-key="id" label-key="name" description-key="description" placeholder="请选择实施工程师（可多选）" search-placeholder="搜索姓名、资质编号或资质编码" empty-text="人员资质库中没有匹配的实施工程师" aria-label="选择实施工程师" :disabled="personnelLoading" multiple required /></div>
                </template>
                <p v-if="selectedServiceItems.length" class="pm-form-hint pm-allocation-preview">影响预览：将为 {{ selectedServiceItems.length }} 个服务项{{ canExecutionAssign ? '写入团队负责人、项目经理与实施工程师并触发能力校验' : '写入团队负责人' }}；已选 {{ selectedServiceItems.map((item) => item.id).join('、') }}</p>
                <button v-if="canSubmitAllocation" class="pm-button primary" :disabled="saving" @click="runOperation('allocation')">{{ saving ? '提交中…' : canExecutionAssign ? '保存分配并校验能力' : '分配团队负责人' }}</button>
              </template>
              <template v-else-if="activeSection === 'planning'"><section v-if="operationSteps.length" class="pm-panel pm-stepper-panel"><div class="pm-stepper"><template v-for="(step, index) in operationSteps" :key="step.label"><div class="pm-step" :class="step.state"><span class="pm-step-num">{{ step.state === 'done' ? '✓' : index + 1 }}</span><span>{{ step.label }}</span></div><div v-if="index < operationSteps.length - 1" class="pm-step-line"></div></template></div></section><div v-if="planningBlocked" class="pm-blocker" :class="planningBlocked.tone" role="alert"><b>暂时不能发布实施计划</b><span>{{ planningBlocked.reason }}</span><button class="pm-button" type="button" @click="navigate('allocation')">前往任务分配</button></div><label><span>计划开始 <em>*</em></span><input v-model.trim="operationForm.plannedStart" type="datetime-local" /></label><label><span>计划结束 <em>*</em></span><input v-model.trim="operationForm.plannedEnd" type="datetime-local" /></label><label><span>现场计划</span><textarea v-model.trim="operationForm.sitePlan" rows="3" placeholder="现场实施步骤和窗口" maxlength="5000"></textarea></label><template v-if="selectedServiceItem.test_mode === 'PENETRATION'"><label><span>渗透测试专项计划 <em>*</em></span><textarea v-model.trim="operationForm.penetrationTestPlan" rows="3" maxlength="5000"></textarea></label><fieldset class="pm-compliant-fieldset"><legend>专项合规要素（授权 / 白名单 / 时间窗 / 应急 / 回滚）</legend><label><span>授权书编号 <em>*</em></span><input v-model.trim="operationForm.authDocNo" required placeholder="例如 AUTH-2026-001"  maxlength="128"/></label><label><span>授权生效 <em>*</em></span><input v-model.trim="operationForm.authStart" type="datetime-local" required /></label><label><span>授权截止 <em>*</em></span><input v-model.trim="operationForm.authEnd" type="datetime-local" required /></label><label><span>授权范围 <em>*</em></span><input v-model.trim="operationForm.authScope" required placeholder="例如 内网段 10.0.0.0/8"  maxlength="5000"/></label><label><span>计划测试范围 <em>*</em></span><input v-model.trim="operationForm.testScope" required placeholder="例如 关键业务系统 WEB 渗透"  maxlength="5000"/></label><label><span>测试时间窗 <em>*</em></span><input v-model.trim="operationForm.testWindow" required placeholder="例如 00:00-06:00"  maxlength="128"/></label><label><span>应急联系人 <em>*</em></span><input v-model.trim="operationForm.emergencyContact" required placeholder="姓名 + 电话"  maxlength="128"/></label><label><span>回滚方案 <em>*</em></span><textarea v-model.trim="operationForm.rollbackPlan" rows="3" required maxlength="5000"></textarea></label></fieldset></template><section class="pm-plan-resources"><header><div><b>实施人员</b><small>资质编码取自「资质与能力」档案，人员不限制有效期；使用时段留空表示全程；设备清单在「实施准备」中登记</small></div></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">名称</th><th scope="col">规格 / 资质</th><th scope="col">有效期规则</th><th scope="col">使用时段</th><th scope="col">备注</th><th scope="col"></th></tr></thead><tbody><tr v-for="(row, index) in operationForm.personnel" :key="row.resourceID"><td>{{ planResourceName(row) }}</td><td><CodePills :codes="planResourceCodes(row)" /></td><td>{{ planResourceValidUntil(row) }}</td><td><div class="pm-plan-window"><input v-model="row.windowStart" type="date" aria-label="使用时段开始" /><span>~</span><input v-model="row.windowEnd" type="date" aria-label="使用时段结束" /></div></td><td><input v-model.trim="row.note" placeholder="例如 备份"  maxlength="500"/></td><td><button type="button" class="pm-link danger" @click="removePlanPersonnel(index)">移除</button></td></tr><tr v-if="!operationForm.personnel.length"><td colspan="6" class="pm-empty-mini">请至少添加一名实施人员</td></tr></tbody></table></div></section><button v-if="canPlanImplementation" class="pm-button primary" :disabled="saving || !!planningBlocked" :title="planningBlocked ? planningBlocked.reason : ''" @click="runOperation('planning')">发布实施计划</button></template>
              <template v-else-if="activeSection === 'methods'"><div class="pm-review-state"><span>复核状态</span><b class="pm-badge" :class="statusTone(item && reportTechReviewLabel(item.tech_review_status))">{{ item && reportTechReviewLabel(item.tech_review_status) }}</b></div><template v-if="item && ['PENDING', 'REJECTED'].includes(item.tech_review_status)"><label><span>复核意见</span><textarea v-model.trim="operationForm.reviewComment" rows="3" placeholder="填写风险说明或驳回原因" maxlength="1000"></textarea></label><div v-if="canReviewSpecialMethod" class="pm-form-row"><button class="pm-button primary" :disabled="saving" @click="runOperation('special-approve')">通过复核</button><button class="pm-button" :disabled="saving" @click="runOperation('special-reject')">驳回复核</button></div></template><template v-else-if="item && item.tech_review_status === 'APPROVED'"><p class="pm-form-hint">{{ item.tech_review_comment || '已通过复核，可发布实施计划' }}<span v-if="item.tech_reviewed_at"> · {{ formatDateTime(item.tech_reviewed_at) }} · {{ item.tech_reviewed_by }} </span></p></template><template v-else-if="item && item.tech_review_status === 'PENDING'"><p class="pm-form-hint">等待技术总监复核特殊方法。</p></template></template>
              <template v-else-if="activeSection === 'preparation'">
                <section class="pm-plan-resources"><header><div><b>设备清单（选填）</b><small>无需设备的项目可留空；选择设备后仍会校验有效档案、检定有效期、在位状态及占用冲突</small></div><button type="button" class="pm-button" @click="openEquipmentPicker">＋ 添加设备</button></header><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">设备</th><th scope="col">能力码</th><th scope="col">检定有效期</th><th scope="col">使用时段</th><th scope="col">备注</th><th scope="col"></th></tr></thead><tbody><tr v-for="(row, index) in operationForm.equipment" :key="row.resourceID"><td>{{ planResourceName(row) }}</td><td><CodePills :codes="planResourceCodes(row)" /></td><td>{{ planResourceValidUntil(row) }}</td><td><div class="pm-plan-window"><input v-model="row.windowStart" type="date" aria-label="使用时段开始" /><span>~</span><input v-model="row.windowEnd" type="date" aria-label="使用时段结束" /></div></td><td><input v-model.trim="row.note" placeholder="例如 备用机"  maxlength="500"/></td><td><button type="button" class="pm-link danger" @click="removePlanEquipment(index)">移除</button></td></tr><tr v-if="!operationForm.equipment.length"><td colspan="6" class="pm-empty-mini">本服务项无需设备时可留空</td></tr></tbody></table></div></section>
                <section class="pm-travel-arrangement">
                  <header class="pm-travel-head"><span class="pm-travel-head-icon" aria-hidden="true">行</span><div><b>行程安排 <em>*</em></b><small>按实际实施方式选择，行程编号由系统自动处理</small></div><span class="pm-travel-head-status">{{ operationForm.travelMode ? '已选择' : '待选择' }}</span></header>
                  <div class="pm-travel-mode" role="radiogroup" aria-label="行程安排方式">
                    <label class="pm-travel-mode-card"><input v-model="operationForm.travelMode" type="radio" value="NO_TRAVEL" /><span class="pm-travel-mode-icon no-travel" aria-hidden="true">免</span><span class="pm-travel-mode-copy"><b>无需出差</b><small>本地实施、远程实施或当日往返</small></span><i aria-hidden="true">✓</i></label>
                    <label class="pm-travel-mode-card"><input v-model="operationForm.travelMode" type="radio" value="EXISTING" /><span class="pm-travel-mode-icon existing" aria-hidden="true">关</span><span class="pm-travel-mode-copy"><b>关联已有行程</b><small>复用本项目已经登记的行程安排</small></span><i aria-hidden="true">✓</i></label>
                    <label class="pm-travel-mode-card"><input v-model="operationForm.travelMode" type="radio" value="NEW" /><span class="pm-travel-mode-icon new-travel" aria-hidden="true">新</span><span class="pm-travel-mode-copy"><b>新建行程申请</b><small>登记路线、日期和实际出行人员</small></span><i aria-hidden="true">✓</i></label>
                  </div>
                  <div v-if="!operationForm.travelMode" class="pm-travel-empty"><span aria-hidden="true">↑</span><div><b>请选择一种行程方式</b><small>选择后仅展示当前场景需要填写的内容</small></div></div>
                  <div v-else class="pm-travel-detail" :class="`mode-${operationForm.travelMode.toLowerCase()}`">
                    <div class="pm-travel-detail-title"><span>{{ operationForm.travelMode === 'NO_TRAVEL' ? '无需出差说明' : operationForm.travelMode === 'EXISTING' ? '选择已有行程' : '填写新行程信息' }}</span><small>{{ operationForm.travelMode === 'NO_TRAVEL' ? '原因将随实施准备记录留存' : operationForm.travelMode === 'EXISTING' ? '可按路线、日期或人员搜索' : '保存后由系统自动生成行程编号' }}</small></div>
                    <label v-if="operationForm.travelMode === 'NO_TRAVEL'"><span>无需行程原因 <em>*</em></span><textarea v-model.trim="operationForm.noTravelReason" rows="2" placeholder="例如：客户现场位于本市，当日往返" maxlength="1000"></textarea></label>
                    <template v-else-if="operationForm.travelMode === 'EXISTING'"><SearchableSelect v-model="operationForm.travelReferenceEventID" :options="travelExistingOptions" value-key="id" label-key="label" description-key="description" placeholder="请选择本项目已有行程" search-placeholder="搜索路线、日期、人员或行程编号" empty-text="本项目暂无可关联行程，请选择新建行程申请" aria-label="选择已有行程" required /><p class="pm-travel-hint">列表只展示当前项目已登记的有效行程，不需要手工输入编号。</p></template>
                    <template v-else-if="operationForm.travelMode === 'NEW'"><div v-if="operationForm.travelOrigin || operationForm.travelDestination" class="pm-travel-route-preview"><span>{{ operationForm.travelOrigin || '出发地' }}</span><i aria-hidden="true">→</i><span>{{ operationForm.travelDestination || '目的地' }}</span><small>{{ operationForm.travelDepartureDate || '待定' }} 至 {{ operationForm.travelReturnDate || '待定' }}</small></div><div class="pm-travel-grid"><label><span>出发地 <em>*</em></span><input v-model.trim="operationForm.travelOrigin" placeholder="例如：杭州"  maxlength="255"/></label><label><span>目的地 <em>*</em></span><input v-model.trim="operationForm.travelDestination" placeholder="例如：上海"  maxlength="255"/></label><label><span>出发日期 <em>*</em></span><input v-model="operationForm.travelDepartureDate" type="date" /></label><label><span>返回日期 <em>*</em></span><input v-model="operationForm.travelReturnDate" type="date" /></label><label><span>交通方式</span><input v-model.trim="operationForm.travelTransport" placeholder="例如：高铁"  maxlength="255"/></label><label><span>住宿需求</span><input v-model.trim="operationForm.travelAccommodationNeed" placeholder="例如：2 晚，单间"  maxlength="255"/></label></div><label><span>出行人员 <em>*</em></span><SearchableSelect v-model="operationForm.travelTravelerIDs" :options="travelTravelerOptions" value-key="id" label-key="name" description-key="description" placeholder="请选择出行人员（可多选）" search-placeholder="搜索已分配人员" empty-text="当前服务项尚未分配可出行人员" aria-label="选择出行人员" multiple required /></label></template>
                  </div>
                </section>
                <label><span>备注</span><textarea v-model.trim="operationForm.comment" rows="3" maxlength="1000"></textarea></label><button v-if="canPlanImplementation" class="pm-button primary" :disabled="saving" @click="runOperation('preparation')">发起实施准备</button>
              </template>
              <template v-else-if="activeSection === 'exceptions'"><section v-if="exceptionFlow.length" class="pm-panel pm-approval-panel"><header><div><p class="pm-panel-kicker">复核流程</p><h2>异常处置流程 · {{ selectedDeviation?.payload?.deviation_id || '—' }}</h2></div><span>{{ pendingDeviations.length }} 项待评审</span></header><div class="pm-approval"><template v-for="(step, index) in exceptionFlow" :key="step.title"><div class="pm-approval-step" :class="step.state"><span class="pm-approval-dot">{{ step.state === 'done' ? '✓' : step.state === 'doing' ? '!' : '○' }}</span><div class="pm-approval-body"><b>{{ step.title }}</b><small>{{ step.when }}</small><em>{{ step.note }}</em></div></div><span v-if="index < exceptionFlow.length - 1" class="pm-approval-arrow">→</span></template></div></section><label><span>偏离描述</span><textarea v-model.trim="operationForm.deviationDescription" rows="3" placeholder="选择服务项后填写偏离内容" maxlength="1000"></textarea></label><label><span>偏离证据</span><input type="file" accept="application/pdf,image/png,image/jpeg" @change="operationForm.deviationEvidenceFile = $event.target.files?.[0] || null" /></label><div class="pm-field"><span>严重度</span><SearchableSelect v-model="operationForm.severity" :options="deviationSeverityOptions" placeholder="请选择严重度" search-placeholder="搜索严重度" aria-label="选择偏离严重度" /></div><button v-if="canReportDeviation" class="pm-button primary" :disabled="saving" @click="runOperation('exception-report')">上报偏离</button><label><span>评审偏离 ID</span><input v-model.trim="operationForm.deviationID" placeholder="DV-..."  maxlength="64"/></label><div class="pm-field"><span>评审决定</span><SearchableSelect v-model="operationForm.decision" :options="deviationDecisionOptions" placeholder="请选择评审决定" search-placeholder="搜索放行、重测或终止" aria-label="选择评审决定" /></div><label><span>{{ operationForm.decision === 'TERMINATE' ? '终止原因 *' : '评审说明' }}</span><textarea v-model.trim="operationForm.comment" rows="3" :required="operationForm.decision === 'TERMINATE'" placeholder="说明放行、重测或终止依据" maxlength="1000"></textarea></label><button v-if="canReviewDeviation" class="pm-button" :disabled="saving" @click="runOperation('exception-review')">提交偏离评审</button></template>
              <template v-else-if="activeSection === 'reports'">
                <section class="pm-panel pm-stepper-panel"><header><div><p class="pm-panel-kicker">报告阶段</p><h2>报告阶段链</h2></div><span v-if="selectedServiceItem" class="pm-op-current">当前：<span class="pm-badge" :class="statusTone(reportStatusLabel[selectedServiceItem.report_status] || '未开始')">{{ reportStatusLabel[selectedServiceItem.report_status] || '未开始' }}</span></span></header><div class="pm-stepper"><template v-for="(step, index) in reportSteps" :key="step.phase"><div class="pm-step" :class="step.state"><span class="pm-step-num">{{ step.state === 'done' ? '✓' : index + 1 }}</span><span>{{ step.label }}</span></div><div v-if="index < reportSteps.length - 1" class="pm-step-line"></div></template></div></section>
                <div class="pm-report-phase" v-if="selectedServiceItem?.report_status"><span>当前报告阶段</span><b class="pm-badge" :class="statusTone(reportStatusLabel[selectedServiceItem.report_status] || selectedServiceItem.report_status)">{{ reportStatusLabel[selectedServiceItem.report_status] || selectedServiceItem.report_status }}</b></div>
                <div v-if="selectedServiceItem?.report_status === 'COMPILING' && permissionSet.has('project.report.prepare')" class="pm-form"><label><span>R{{ Number(selectedServiceItem.report_revision) || 0 }} 报告文件 <em>*</em></span><input type="file" accept="application/pdf" @change="operationForm.reportFile = $event.target.files?.[0] || null" /><small>上传后由统一文件网关校验并登记摘要，审核人与编制人必须不同。</small></label><button class="pm-button" :disabled="saving" @click="uploadCurrentReport">上传并登记报告</button></div>
                <section v-if="selectedReportCorrectionRequests.length" class="pm-panel pm-approval-panel">
                  <header><div><p class="pm-panel-kicker">报告更正</p><h2>待处理更正申请</h2></div><span>{{ selectedReportCorrectionRequests.length }} 项</span></header>
                  <div v-for="request in selectedReportCorrectionRequests" :key="request.id" class="pm-form">
                    <p class="pm-form-hint">R{{ Number(request.payload?.old_revision) || 0 }} · {{ request.payload?.reason }} · 申请人：{{ personLabel(request.actor_user_id, '未知') }}</p>
                    <template v-if="canApproveReportCorrection && request.actor_user_id !== session?.user_id">
                      <label><span>审批意见 <em>*</em></span><textarea v-model.trim="operationForm.reportCorrectionComment" rows="2" placeholder="填写批准或驳回意见" maxlength="1000"></textarea></label>
                      <div class="pm-form-row"><button type="button" class="pm-button primary" :disabled="saving" @click="decidePendingReportCorrection(request, 'APPROVED')">批准更正</button><button type="button" class="pm-button danger" :disabled="saving" @click="decidePendingReportCorrection(request, 'REJECTED')">驳回申请</button></div>
                    </template>
                    <p v-else class="pm-form-hint">更正申请正在等待其他有审批权限的人员处理。</p>
                  </div>
                </section>
                <div v-if="canSubmitReportCorrection" class="pm-form">
                  <label><span>报告更正原因 <em>*</em></span><textarea v-model.trim="operationForm.reportCorrectionReason" rows="3" placeholder="说明已签发或已归档报告需要更正的内容" maxlength="1000"></textarea><small>审批通过后旧版本作废并生成下一报告版本，需重新完成整改、编制、审核、签发和归档。</small></label>
                  <button type="button" class="pm-button" :disabled="saving" @click="submitReportCorrection">申请报告更正</button>
                </div>
                <button v-if="selectedServiceItem && reportPhaseNext[selectedServiceItem.report_status] && canAdvanceReportPhase(reportPhaseNext[selectedServiceItem.report_status])" class="pm-button primary" :disabled="saving" @click="runOperation('report-next')">{{ reportPhaseAction[reportPhaseNext[selectedServiceItem.report_status]] }}</button>
              </template>
            </div><div v-else class="pm-empty-mini">请先选择服务项</div>
          </section>
          <section v-if="activeSection === 'methods'" class="pm-table-panel">
            <header><div><p class="pm-panel-kicker">复核历史</p><h2>复核历史</h2></div><span>{{ methodHistory.length }} 条复核记录</span></header>
            <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">服务项</th><th scope="col">结论</th><th scope="col">复核意见</th><th scope="col">复核人</th><th scope="col">复核时间</th></tr></thead><tbody><tr v-for="event in methodHistory" :key="event.id"><td class="mono"><b>{{ event.service_item_id }}</b></td><td><span class="pm-badge" :class="event.payload?.decision === 'APPROVED' ? 'normal' : '风险'">{{ event.payload?.decision === 'APPROVED' ? '通过复核' : '已驳回' }}</span></td><td>{{ event.payload?.comment || '—' }}</td><td>{{ personLabel(event.actor_user_id, '—') }}</td><td>{{ formatDateTime(event.created_at) }}</td></tr><tr v-if="!methodHistory.length"><td colspan="5" class="pm-empty-mini">暂无特殊方法复核记录</td></tr></tbody></table></div>
          </section>
          <section class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">事项 / 项目</th><th scope="col">内容摘要</th><th scope="col">负责人 / 归属</th><th scope="col">状态</th><th scope="col">{{ activeSection === 'allocation' ? '分配进度' : '完成度' }}</th><th scope="col">时限</th><th scope="col"></th></tr></thead><tbody><tr v-for="row in operationRows" :key="row.name"><td><b>{{ row.name }}</b></td><td><template v-if="Array.isArray(row.detail)"><span v-if="!row.detail.length">—</span><span v-else class="pm-code-pills"><span v-for="code in row.detail" :key="code" class="pm-code-pill">{{ code }}</span></span></template><template v-else>{{ row.detail }}</template><span v-if="row.warning" class="pm-cell-warning">{{ row.warning }}</span></td><td>{{ row.owner }}</td><td><span class="pm-badge" :class="statusTone(row.state)">{{ row.state }}</span></td><td><div class="pm-inline-progress"><i :style="{ width: `${row.progress}%` }"></i></div><small>{{ row.progress }}%</small></td><td>{{ row.due }}</td><td class="pm-col-actions"><button class="pm-link" @click="openOperationDetail(row)">查看详情</button></td></tr></tbody></table></div><div v-if="!operationRows.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无数据</b><span>当前页面尚无待处理事项</span></div></section>
        </template>
      </div>
    </main>
    <QualificationImportDialog v-if="qualificationImportOpen && canManageResource" :code-options="capabilityCodeOptions('PERSON').map((option) => ({ value: option.code, label: option.name }))" @close="qualificationImportOpen = false" @completed="importQualificationFile" />
    <QualificationImportDialog v-if="equipmentImportOpen && canManageDevice" resource-type="EQUIPMENT" :code-options="capabilityCodeOptions('EQUIPMENT').map((option) => ({ value: option.code, label: option.name }))" @close="equipmentImportOpen = false" @completed="importEquipmentFile" />
    <DetectionCategoryImportDialog v-if="detectionCategoryImportOpen && canManageRules" :code-options="capabilityCodeOptions('PERSON').map((option) => ({ value: option.code, label: option.name }))" @close="detectionCategoryImportOpen = false" @completed="importDetectionCategoryFile" />

    <Transition name="pm-drawer">
      <OperationDetailDrawer
        v-if="operationDetail"
        :detail="operationDetail"
        :fields="operationDetailFields"
        @close="operationDetail = null"
      />
    </Transition>

    <!-- 设备候选：目录未确认（读取中/失败/维护后失效）时不展示可选设备；
         占用未确认时行仍可添加但明确标注，保存时由服务端校验重叠占用。 -->
    <div v-if="planEquipmentPickerOpen" class="pm-overlay" @click.self="planEquipmentPickerOpen = false"><aside class="pm-dialog pm-dialog-wide"><header><div><span>设备</span><h2>添加设备</h2><small class="pm-dialog-sub">只列设备目录中的有效设备；已被其他服务项占用、仅在公司使用或不在公司的设备不可选取。</small></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="planEquipmentPickerOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-dialog-body"><div class="pm-picker-search"><ConsoleIcon name="search" /><input v-model.trim="equipmentPickerKeyword" placeholder="搜索设备名称或能力码"  maxlength="100"/></div><p v-if="equipmentReservationsError" class="pm-form-hint" role="alert">{{ equipmentReservationsError }}<button type="button" class="pm-link" :disabled="equipmentReservationsLoading" @click="loadEquipmentReservations(selectedServiceItem)">{{ equipmentReservationsLoading ? '读取中…' : '重试读取占用' }}</button></p><ListState v-if="equipmentLoading" loading compact loading-title="正在读取设备目录…" /><ListState v-else-if="equipmentError" error-title="设备目录读取失败" :error="equipmentError" retry-text="重试读取目录" compact @retry="retryEquipmentCatalog" /><div v-else class="pm-table-scroll"><table class="pm-table pm-table-picker"><thead><tr><th scope="col">设备</th><th scope="col">能力码</th><th scope="col">检定有效期</th><th scope="col">状态</th><th scope="col" class="pm-col-action">操作</th></tr></thead><tbody><tr v-for="item in planEquipmentFiltered" :key="item.resource_id"><td><b>{{ item.resource_name }}</b><small class="mono">{{ item.resource_id }}</small><small v-if="equipmentUnavailableReason(item)" class="pm-cell-sub pm-cell-danger">{{ equipmentUnavailableReason(item) }}</small></td><td><CodePills :codes="item.codes || []" /></td><td>{{ item.valid_until ? formatBusinessDate(item.valid_until) : '长期' }}</td><td><span class="pm-badge" :class="equipmentPickerState(item).tone">{{ equipmentPickerState(item).label }}</span><small v-if="equipmentPickerState(item).note" class="pm-cell-sub">{{ equipmentPickerState(item).note }}</small></td><td><button type="button" class="pm-link" :disabled="equipmentPickerState(item).disabled" @click="addPlanEquipment(item)">{{ equipmentPickerState(item).action }}</button></td></tr><tr v-if="!planEquipmentFiltered.length"><td colspan="5" class="pm-empty-mini">{{ equipmentPickerKeyword ? '没有匹配的设备，换个关键字试试' : '设备目录为空，请先在「资质与能力」或「设备能力维护」中登记设备' }}</td></tr></tbody></table></div></div><footer><span class="pm-dialog-footnote">已加入 {{ planEquipmentAddedCount }} 台 · 可选 {{ planEquipmentAddableCount }} 台</span><button type="button" class="pm-button" @click="planEquipmentPickerOpen = false">关闭</button></footer></aside></div>
    <NativeProjectCreateDialog
      v-if="nativeCreateOpen && canCreateProject && nativeProjectEnabled"
      :categories="detectionCategories"
      @close="nativeCreateOpen = false"
      @created="onNativeProjectCreated"
    />
    <div v-if="createOpen" class="pm-overlay" @click.self="createOpen = false">
      <form class="pm-dialog pm-dialog-wide" @submit.prevent="saveCreate">
        <header><div><span>新建项目</span><h2>新建项目</h2><small class="pm-dialog-sub">选择已审批合同后，系统会自动读取合同服务范围；合同字段不可手工改写。</small></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="createOpen = false"><ConsoleIcon name="close" /></button></header>
        <div class="pm-form">
          <div v-if="approvedContractsError" class="pm-contract-service-state error" role="alert">
            {{ approvedContractsError }}
            <a href="/contract_management/" target="_blank" rel="noopener">前往合同管理</a>
          </div>
          <label><span>名称 <em>*</em></span><input v-model.trim="createForm.name" required placeholder="请输入项目名称"  maxlength="255"/></label>
          <template v-if="activeSection === 'projects'">
            <label><span>已审批合同 <em>*</em></span><SearchableSelect v-model="createForm.contractID" :options="approvedContractOptions" value-key="id" label-key="label" description-key="description" placeholder="请选择尚未建立项目的已审批合同" search-placeholder="搜索合同编号、标题或客户名" :empty-text="approvedContractEmptyText" aria-label="选择已审批合同" remote :loading="approvedContractSearchLoading" :has-more="Boolean(approvedContractSearchNextAfterID)" menu-z-index="calc(var(--pm-z-modal, 50) + 1)" required @search="onApprovedContractSearch" @load-more="loadMoreApprovedContractOptions" @change="onApprovedContractChange" /><small>支持按合同编号、标题或客户名搜索；已建立项目的合同不再出现。</small></label>
            <label><span>客户</span><input :value="createForm.customer" readonly aria-readonly="true" /><small>选择合同后由合同管理系统自动带入</small></label>
            <label><span>合同编号</span><input :value="createForm.contract" readonly aria-readonly="true" /><small>以合同管理系统中的合同编号为准，不支持手工修改</small></label>
            <label><span>实施场所 <em>*</em></span><input v-model.trim="createForm.site" required placeholder="例如 杭州机房"  maxlength="255"/><small>这是本项目的实施场所，将应用到本次选择的服务项。</small></label>
            <section class="pm-service-links pm-contract-services">
              <header><div><b>合同服务范围 <em>*</em></b><small>默认选择合同中的全部服务项；可搜索并取消本项目不包含的服务项。</small></div><span v-if="approvedContractServiceItems.length" class="pm-contract-service-count">已选 {{ selectedContractServiceIDs.length }} / {{ approvedContractServiceItems.length }} 项</span></header>
              <div v-if="contractServicesLoading" class="pm-contract-service-state">正在读取合同服务范围…</div>
              <div v-else-if="contractServicesError" class="pm-contract-service-state error" role="alert">{{ contractServicesError }}</div>
              <template v-else-if="createForm.contractID">
                <SearchableSelect v-model="selectedContractServiceIDs" :options="approvedContractServiceOptions" value-key="source_id" label-key="label" description-key="description" placeholder="请选择合同服务项（可多选）" search-placeholder="搜索服务名称、系统、等级或检测类别" empty-text="当前合同没有匹配的服务项" aria-label="选择合同服务项" menu-z-index="calc(var(--pm-z-modal, 50) + 1)" multiple required />
                <div v-if="selectedApprovedContractServices.length" class="pm-contract-service-list">
                  <article v-for="item in selectedApprovedContractServices" :key="item.source_id" class="pm-contract-service-card">
                    <div><b>{{ item.name || item.service_type || '未命名服务' }}</b><span class="mono">{{ item.source_id }}</span></div>
                    <dl><div><dt>系统</dt><dd>{{ item.system || '未指定' }}<span v-if="item.system_level"> · {{ item.system_level }}</span></dd></div><div><dt>检测类别</dt><dd>{{ item.category || item.service_type || '未指定' }}</dd></div><div><dt>合同批次</dt><dd>{{ item.batch || '未指定' }}</dd></div><div><dt>合同场所</dt><dd>{{ item.site || '未指定' }}</dd></div><div><dt>测试模式</dt><dd>{{ item.test_mode === 'PENETRATION' ? '渗透测试' : '标准方法' }}</dd></div><div><dt>技术要求</dt><dd>{{ item.requirement || '未约定' }}</dd></div></dl>
                  </article>
                </div>
                <div v-else class="pm-contract-service-state">请至少选择一个合同服务项</div>
              </template>
              <div v-else class="pm-contract-service-state">请先选择已审批合同，系统将自动展示合同约定的服务。</div>
            </section>
          </template>
        </div>
        <footer><button type="button" class="pm-button" @click="createOpen = false">取消</button><button class="pm-button primary" :disabled="saving || contractServicesLoading || !selectedContractServiceIDs.length">{{ saving ? '保存中…' : '创建项目' }}</button></footer>
      </form>
    </div>

    <div v-if="adjustOpen" class="pm-overlay" @click.self="adjustOpen = false"><form class="pm-dialog pm-dialog-wide" @submit.prevent="submitDecompositionAdjust"><header><div><span>调整拆解</span><h2>调整拆解</h2><small class="pm-dialog-sub">目标项目：<b>{{ decompositionProject ? `${decompositionProject.id} · ${decompositionProject.name || decompositionProject.customer || ''}` : '未选择' }}</b> —— 提交后该项目的<b>全部</b>服务项会被这份清单替换并进入补充协议处理中；原服务项转为归档保留历史。</small></div><button type="button" class="pm-icon-button" aria-label="关闭" @click="adjustOpen = false"><ConsoleIcon name="close" /></button></header><div class="pm-form"><label><span>调整原因 <em>*</em></span><input v-model.trim="adjustForm.reason" required placeholder="例如 客户追加两个系统"  maxlength="1000"/></label><label><span>已审批补充协议 <em>*</em></span><select v-model="adjustForm.supplementContractID" required><option value="">请选择已审批补充协议</option><option v-for="contract in supplementContractOptions" :key="contract.id" :value="contract.id">{{ contractOptionLabel(contract) }}</option></select><small>只能选择当前客户已审批且不同于原合同的记录</small></label><section class="pm-service-links"><header><div><b>新的服务项清单</b><small>提交后该项目的全部服务项会被这份清单替换，并进入补充协议处理中</small></div><button type="button" class="pm-link" @click="addAdjustItem">＋ 增加一行</button></header><div v-for="(row, index) in adjustForm.items" :key="index" class="pm-adjust-item"><div class="pm-service-link-row"><input v-model.trim="row.batch" required placeholder="批次"  maxlength="64"/><input v-model.trim="row.site" required placeholder="场所"  maxlength="255"/><SearchableSelect v-model="row.category" :options="activeDetectionCategoryOptions" placeholder="请选择检测类别" search-placeholder="搜索检测类别" empty-text="没有启用的检测类别" aria-label="选择检测类别" menu-z-index="calc(var(--pm-z-modal, 50) + 1)" required /><button type="button" class="pm-icon-button" :aria-label="`删除第 ${index + 1} 行`" @click="removeAdjustItem(index)">×</button></div><div class="pm-service-link-row"><input v-model.trim="row.system" placeholder="系统名称"  maxlength="128"/><input v-model.trim="row.systemLevel" placeholder="系统等级"  maxlength="64"/><input v-model.trim="row.requirement" placeholder="技术要求"  maxlength="2000"/><select v-model="row.testMode"><option value="STANDARD">标准方法</option><option value="PENETRATION">渗透测试</option></select></div></div></section></div><footer><button type="button" class="pm-button" @click="adjustOpen = false">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '提交中…' : '提交调整' }}</button></footer></form></div>

    <SupplementClosureDialog
      :open="closureOpen"
      :project="closureProject"
      :form="closureForm"
      :contracts="closureContracts"
      :loading="closureLoading"
      :load-error="closureLoadError"
      :saving="closureSaving"
      :error="closureError"
      @close="closeSupplementClosure"
      @submit="submitSupplementClosure"
      @reload="reloadSupplementClosure"
    />

    <div v-if="configEditorOpen" class="pm-overlay" @click.self="configEditorOpen = false">
      <form class="pm-dialog" @submit.prevent="saveConfigRule">
        <header>
          <div><span>规则配置</span><h2>{{ configForm.id ? '编辑配置' : '新建配置' }} · {{ activeConfigMeta.label }}</h2></div>
          <button type="button" class="pm-icon-button" aria-label="关闭" @click="configEditorOpen = false"><ConsoleIcon name="close" /></button>
        </header>
        <div class="pm-form">
          <label>
            <span>{{ activeConfigMeta.nameLabel || '配置名称' }} <em>*</em></span>
            <input v-model.trim="configForm.name" required :placeholder="configNamePlaceholder()"  maxlength="255"/>
            <small v-if="['warning-rules', 'automations', 'sla'].includes(activeSection)">选择生效条件后会自动生成，仍可按业务口径修改。</small>
          </label>
          <template v-for="field in activeConfigMeta.fields" :key="field.key">
            <div v-if="field.field === 'roles'" class="pm-field pm-span-full">
              <span>{{ field.label }} <em v-if="field.required">*</em></span>
              <SearchableSelect v-model="configForm.role_codes" :options="configRoleOptions" value-key="code" label-key="name" placeholder="请选择角色（可多选）" search-placeholder="搜索角色名称或编码" :empty-text="applicationRolesError || '暂无匹配角色'" aria-label="选择字段级权限角色" menu-z-index="calc(var(--pm-z-modal, 50) + 1)" multiple required />
              <p v-if="configRoleSelection.length > 1" class="pm-form-hint">已选 {{ configRoleSelection.length }} 个角色，保存后每个角色各生成一条规则。</p>
              <p v-else-if="applicationRolesError" class="pm-form-hint" role="alert">{{ applicationRolesError }}</p>
            </div>
            <div v-else-if="field.field === 'automation-roles'" class="pm-field pm-span-full">
              <span>{{ field.label }} <em>*</em></span>
              <SearchableSelect v-model="configForm.targets" :options="configRoleOptions" value-key="code" label-key="name" placeholder="请选择通知角色（可多选）" search-placeholder="搜索角色名称或编码" :empty-text="applicationRolesError || '暂无匹配角色'" aria-label="选择自动化通知角色" menu-z-index="calc(var(--pm-z-modal, 50) + 1)" multiple required @change="onConfigFieldChange(field, $event)" />
              <p v-if="configAutomationRoleSelection.length > 1" class="pm-form-hint">已选 {{ configAutomationRoleSelection.length }} 个通知角色，保存后每个角色各生成一条自动化规则。</p>
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
              <input v-model.trim="configForm[field.key]" :required="field.required" :readonly="configFieldDisabled(field)" :aria-readonly="configFieldDisabled(field)" :placeholder="field.placeholder || ''"  maxlength="2000"/>
              <small v-if="configFieldDisabled(field)">编码与类型创建后不可修改；如需变更，请停用原配置后新建。</small>
            </label>
          </template>
          <label><span>启用</span><button type="button" class="pm-switch" :class="{ on: configForm.enabled }" :aria-label="`${configForm.enabled ? '停用' : '启用'}`" @click="configForm.enabled = !configForm.enabled"><i></i></button></label>
        </div>
        <footer><button type="button" class="pm-button" @click="configEditorOpen = false">取消</button><button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : isStandardChangeSection ? '保存标准变更记录' : '保存配置规则' }}</button></footer>
      </form>
    </div>
    <ConfirmDialog
      :open="Boolean(confirmDialog)"
      v-bind="confirmDialog || {}"
      @confirm="acceptConfirm"
      @cancel="cancelConfirm"
    />

    <PromptDialog
      :open="Boolean(promptDialog)"
      v-bind="promptDialog || {}"
      @confirm="acceptPrompt" @cancel="cancelPrompt"
    />
    <OperationToast :message="toastMessage" :tone="toastType" />
  </div>
</template>
