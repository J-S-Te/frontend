<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, logoutCurrentSession } from '@/modules/platform/auth/api/auth'
import IamSettingsModule from '@/modules/platform/iam/components/IamSettingsModule.vue'
import PersonnelChangeCenter from '@/modules/platform/iam/components/PersonnelChangeCenter.vue'
import PublicAccessSettingsModule from '@/modules/platform/settings/components/PublicAccessSettingsModule.vue'
import EmployeeOnboardingModal from '@/modules/platform/iam/components/EmployeeOnboardingModal.vue'
import NotificationCenterModule from '@/modules/platform/notifications/components/NotificationCenterModule.vue'
import ConfigurationCenterModule from '@/modules/platform/configuration/components/ConfigurationCenterModule.vue'
import FileTaskOperationsModule from '@/modules/platform/files/components/FileTaskOperationsModule.vue'
import CommercialLicenseView from '@/modules/platform/features/licenses/CommercialLicenseView.vue'
import { getUnreadCount, listInbox, markNotificationRead } from '@/modules/platform/notifications/api/notifications'
import LoginSecurityModule from '@/modules/platform/security/components/LoginSecurityModule.vue'
import DictionaryManagementModule from '@/modules/platform/dictionaries/components/DictionaryManagementModule.vue'
import SubsystemOnboardingModule from '@/modules/platform/applications/components/SubsystemOnboardingModule.vue'
import SubsystemAccessWizard from '@/modules/platform/applications/components/SubsystemAccessWizard.vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import AppShell from '@/modules/shared/components/AppShell.vue'
import ListState from '@/modules/shared/components/ListState.vue'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'
import OperationResultBanner from '@/modules/shared/components/OperationResultBanner.vue'
import OperationInboxPanel from '@/modules/shared/components/OperationInboxPanel.vue'
import { usePersistentResult } from '@/modules/shared/composables/usePersistentResult.js'
import { useOperationInbox } from '@/modules/shared/composables/useOperationInbox.js'
import {
  listApplications,
  listEnvironments,
} from '@/modules/platform/applications/api/applications'
import { listOrgUnits, listPositions } from '@/modules/platform/iam/api/iam'
import { loadAllCatalogPages } from '@/modules/platform/iam/utils/paginatedCatalog'
import {
  listAuditEvents,
  getAuditIngestionHealth,
  createAuditExportJob,
  createAuditExportDownloadTicket,
  getAuditExportJob,
  downloadAuditExportFile,
} from '@/modules/platform/audit/api/auditEvents'
import {
  auditActionCode,
  auditActionLabel,
  auditHttpStatusLabel,
  auditRiskLabel,
  auditResultLabel,
  auditResultMeta,
  auditResultTone,
} from '@/modules/platform/audit/utils/auditPresentation'
import {
  AUDIT_ACTION_CATEGORY_OPTIONS,
  AUDIT_RESULT_LABELS,
  AUDIT_RISK_LABELS,
} from '@/modules/platform/audit/utils/auditDictionaries'
import {
  getPlatformSettings,
  updatePlatformSettings,
} from '@/modules/platform/settings/api/platformSettings'
import {
  hasAnyPermission,
  hasPermission,
  useCurrentPrincipal,
} from '@/modules/platform/auth/utils/principal'
import {
  PLATFORM_AUDIT_EXPORT_PERMISSION,
  PLATFORM_AUDIT_VIEW_PERMISSION,
  PLATFORM_SETTINGS_SECTION_PERMISSIONS,
} from '@/modules/platform/auth/utils/platformConsoleAccess'
import { closeSubsystemTabOrFallback } from '@/modules/shared/utils/returnToPortal'
import { IAM_PERMISSIONS } from '@/modules/platform/iam/utils/iamPermissions'
import { useRelatedDataInvalidation } from '@/modules/platform/shared/composables/useRelatedDataInvalidation'
import {
  RELATED_DATA,
  loadRelatedDataSafely,
} from '@/modules/platform/shared/utils/relatedDataInvalidation'
import { formatUserError } from '../../shared/utils/userError.js'
import { formatBusinessDateTime } from '@/modules/shared/utils/businessTime.js'
import '@/modules/platform/styles/console.css'
import '@/modules/platform/styles/settings-showcase.css'
// 平台控制台视觉层：只作用于 .console-page--platform，避免影响共用 console.css 的其他业务外壳。
import '@/modules/platform/styles/platform-console.css'

const route = useRoute()
const router = useRouter()
const settings = reactive({ organizationName: '', organizationAlias: '', timezone: '', qualification: '', version: 0 })
const settingsLoading = ref(false)
const settingsError = ref('')
const settingsSaving = ref(false)
const currentView = computed(() => (route.name === 'audit' ? 'audit' : 'settings'))
const mobileMenuOpen = ref(false)
const isLoggingOut = ref(false)
const toastMessage = ref('')
const auditKeyword = ref('')
// 批次 3：按操作地址、对象、链路 ID 精确检索。
const auditClientIP = ref('')
const auditResourceID = ref('')
const auditRequestID = ref('')
const auditCorrelationID = ref('')
const auditEventID = ref('')
const auditActorID = ref('')
const auditLoginIP = ref('')
const auditType = ref('')
const auditRisk = ref('')
const auditApplication = ref('')
const auditEnvironment = ref('')
const auditResult = ref('')
const auditTimeRange = ref('7d')
const auditPage = ref(1)
const auditPageSize = ref(20)
const auditDetail = ref(null)
const auditRecords = ref([])
const auditTotal = ref(0)
// 批次 3：平台侧摄取健康度（口径：平台已接收事件，不含子系统本地 Outbox 积压）。
const auditHealth = ref(null)
const auditHealthError = ref('')
// 高级筛选（操作类型/结果/风险/精确 ID）默认收起，主筛选保持一眼可读。
const auditAdvancedOpen = ref(false)
const auditLoading = ref(false)
const auditError = ref('')
const auditExporting = ref(false)
const auditDownloading = ref(false)
const auditExportJob = ref(null)
const notificationMenuOpen = ref(false)
const notificationMenuLoading = ref(false)
// 顶栏未读通知弹层：失败原因单独留存，弹层用三态闸门展示，不再吞成「暂无未读通知」。
const topbarNotificationsError = ref('')
const topbarNotifications = ref([])
const topbarUnreadCount = ref(0)
// 筛选器会在用户连续操作时触发多次请求；序号和 AbortController 共同保证旧响应
// 不会覆盖最后一次查询结果，也避免无效请求继续占用浏览器与 API 连接。
let auditRequestSequence = 0
let auditRequestController = null
const applications = ref([])
// 应用目录是审计筛选的输入之一：失败必须单独留痕并可重试，
// 否则只剩「全部应用」一个选项，用户会误判成「系统里只有一个应用」。
const applicationsError = ref('')
const environments = ref([])
let toastTimer = null

// 员工列表中的「新增员工」入口会打开该 modal。modal 自身需要
// organizations / positions / applications，因此这里维护一份预加载缓存；
// applications 与 audit 面板共享同一份响应，避免重复请求。
const showEmployeeOnboarding = ref(false)
const onboardingOrganizations = ref([])
const onboardingPositions = ref([])
const iamRefreshKey = ref(0)
// 从用户详情「办理离职」跳转到人员异动中心时携带的人员；异动中心渲染后消费并清空。
const pendingPersonnelChangeUserId = ref('')

const { principal, refreshPrincipal } = useCurrentPrincipal()

const currentAccountName = computed(() => {
  const account = principal.value?.account
  const user = principal.value?.user
  return String(account?.name || account?.code || user?.name || '').trim() || '当前登录用户'
})

const currentRoleNames = computed(() => {
  const roles = Array.isArray(principal.value?.roles) ? principal.value.roles : []
  const names = roles
    .map((role) => String(role?.name || role?.code || role?.id || '').trim())
    .filter(Boolean)
  return [...new Set(names)].join('、') || '未分配角色'
})

const currentAccountAvatar = computed(() => {
  const name = currentAccountName.value
  if (/^[\x00-\x7F]+$/.test(name)) return name.slice(0, 2).toUpperCase()
  return Array.from(name).slice(0, 1).join('') || '用'
})

const canViewAudit = computed(() => hasPermission(PLATFORM_AUDIT_VIEW_PERMISSION))
const canExportAudit = computed(() => hasPermission(PLATFORM_AUDIT_EXPORT_PERMISSION))
const canReadPlatformSettings = computed(() => hasPermission('platform:settings:read'))
const canUpdatePlatformSettings = computed(() => hasPermission('platform:settings:update'))
const canReadApplications = computed(() => hasPermission('platform:application:read'))
const subsystemOnboardingPermissions = Object.freeze([
  'platform:application:create',
  'platform:application-environment:create',
  'platform:application-login-target:create',
  'platform:oauth-client:create',
  'platform:role-binding:update',
])
const canOnboardSubsystem = computed(() => subsystemOnboardingPermissions.every((permission) => hasPermission(permission)))

// 统一接入向导：选项来自当前目录与环境快照；提交权限按动作由服务端最终校验。
const subsystemAccessApplications = computed(() => (Array.isArray(applications.value) ? applications.value : [])
  .map((item) => ({ code: String(item?.code || item?.application_code || '').trim(), name: String(item?.name || '').trim() }))
  .filter((item) => item.code))
const subsystemAccessEnvironments = computed(() => {
  const values = (Array.isArray(environments.value) ? environments.value : [])
    .map((item) => String(item?.environment_code || item?.environment || '').trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(values)]
})
const canSubmitSubsystemAccess = computed(() => hasPermission('platform:application:update') || canOnboardSubsystem.value)

const settingsTabs = [
  {
    key: 'licenses', label: '商业授权', icon: 'security', tone: 'blue',
    description: '核对部署身份、导入签名许可证并追溯授权变更。',
    capabilities: ['签发申请', '授权期限', '验签预览', '导入审计'],
    permissions: PLATFORM_SETTINGS_SECTION_PERMISSIONS.licenses,
  },
  {
    key: 'applications', label: '应用目录', icon: 'dashboard', tone: 'cyan',
    description: '新增、设置、更新或下线业务子系统，并维护统一登录部署边界。',
    capabilities: ['新增接入', '应用设置', '环境更新', '登录目标', '安全下线'],
    permissions: PLATFORM_SETTINGS_SECTION_PERMISSIONS.applications,
  },
  {
    key: 'base', label: '平台基础信息', icon: 'settings', tone: 'blue',
    description: '维护平台名称与基础展示信息。',
    capabilities: ['平台名称', '平台简称'],
    permissions: PLATFORM_SETTINGS_SECTION_PERMISSIONS.base,
  },
  {
    key: 'access', label: '对外访问', icon: 'globe', tone: 'blue',
    description: '配置统一前端的公开地址与 OAuth HTTP 回调策略。',
    capabilities: ['公开地址', 'HTTP 回调', '应用配置'],
    permissions: PLATFORM_SETTINGS_SECTION_PERMISSIONS.access,
  },
  {
    key: 'iam', label: '身份、组织与授权', icon: 'organization', tone: 'violet',
    description: '按组织归属、岗位职责、标准岗位模板和个人例外分层管理。',
    capabilities: ['新增员工', '组织与岗位', '任职关系', '岗位授权模板', '个人例外'],
    permissions: PLATFORM_SETTINGS_SECTION_PERMISSIONS.iam,
  },
  {
    key: 'personnel', label: '人员异动中心', icon: 'organization', tone: 'violet',
    description: '由管理员集中配置晋升、降职、调岗、离职和复职，并跟踪权限影响与生效结果。',
    capabilities: ['管理员配置', '权限预览', '未来生效', '执行记录'],
    permissions: PLATFORM_SETTINGS_SECTION_PERMISSIONS.iam,
  },
  {
    key: 'notify', label: '通知中心', icon: 'bell', tone: 'orange',
    description: '查看平台消息，并维护通知模板与投递记录。',
    capabilities: ['站内通知', '通知模板', '投递记录'],
    permissions: PLATFORM_SETTINGS_SECTION_PERMISSIONS.notify,
  },
  {
    key: 'security', label: '安全设置', icon: 'shield', tone: 'red',
    description: '配置登录安全、会话超时和全局退出策略。',
    capabilities: ['登录安全', '会话策略', '超时退出'],
    permissions: PLATFORM_SETTINGS_SECTION_PERMISSIONS.security,
  },
  {
    key: 'dict', label: '字典管理', icon: 'dashboard', tone: 'slate',
    description: '维护各业务模块共用的稳定编码、展示名称和可选值。',
    capabilities: ['字典定义', '字典项', '启停与排序'],
    permissions: PLATFORM_SETTINGS_SECTION_PERMISSIONS.dict,
  },
  {
    key: 'config', label: '配置中心', icon: 'settings', tone: 'cyan',
    description: '维护应用配置草稿并发布不可变版本。',
    capabilities: ['命名空间', '配置草稿', '版本发布'],
    permissions: PLATFORM_SETTINGS_SECTION_PERMISSIONS.config,
  },
  {
    key: 'jobs', label: '异步任务', icon: 'audit', tone: 'orange',
    description: '查询、重试和重跑平台异步任务；业务文件仍在对应子系统中上传和下载。',
    capabilities: ['任务查询', '失败重试', '取消与重跑'],
    permissions: PLATFORM_SETTINGS_SECTION_PERMISSIONS.jobs,
  },
]

// 设置导航分组：只影响左侧导航的展示顺序与分组标题，不改变 settingsTabs 的既有顺序、
// 权限判定与搜索过滤结果（filteredSettingsTabs 仍是唯一过滤来源）。
const SETTINGS_NAV_GROUPS = Object.freeze([
  { key: 'identity', label: '身份与权限', sections: ['iam', 'personnel'] },
  { key: 'platform', label: '平台与接入', sections: ['licenses', 'applications', 'base', 'access'] },
  { key: 'security', label: '安全与通知', sections: ['security', 'notify'] },
  { key: 'runtime', label: '运行支撑', sections: ['config', 'dict', 'jobs'] },
])
const SETTINGS_NAV_GROUPED_KEYS = new Set(SETTINGS_NAV_GROUPS.flatMap((group) => group.sections))

const settingsSectionKeys = new Set(settingsTabs.map((tab) => tab.key))
// 当前账号对各 tab 都有权限的可见集合 + "一个都看不到"的判断。
// 没有权限的 tab 不会渲染按钮，且 lastSettingsSection 不会落到无权限 tab 上。
const visibleSettingsTabs = computed(() => settingsTabs.filter((tab) => hasAnyPermission(tab.permissions)))
const hasNoVisibleSettingsTab = computed(() => visibleSettingsTabs.value.length === 0)
const canOpenSettings = computed(() => visibleSettingsTabs.value.length > 0)
const hasAnySettingsOrAuditPermission = computed(() => canOpenSettings.value || canViewAudit.value)

// 侧栏导航的数据化描述：外壳只负责渲染，权限与当前视图仍由本页决定。
// 第一组不带 label（置顶的「返回子系统门户」），第二组按既有顺序列出系统管理入口；
// visible: false 等价于原来的 v-if，不会渲染成空按钮。
const navGroups = computed(() => [
  {
    items: [
      { key: 'portal', label: '返回子系统门户', icon: 'dashboard', itemClass: 'console-nav-item--portal', anchor: 'subsystem-portal' },
    ],
  },
  {
    label: '系统管理',
    items: [
      { key: 'settings', label: '系统设置', icon: 'settings', active: currentView.value === 'settings', visible: canOpenSettings.value },
      { key: 'audit', label: '审计日志', icon: 'audit', note: '只读', active: currentView.value === 'audit', visible: canViewAudit.value },
    ],
  },
])

const lastSettingsSection = ref('iam')
// 设置页 tab 快速过滤：匹配 label / description / capabilities 任一字段，
// 用于在 8 个 tab 中快速定位；空字符串不过滤。
const settingsTabKeyword = ref('')
const filteredSettingsTabs = computed(() => {
  const query = settingsTabKeyword.value.trim().toLowerCase()
  if (!query) return visibleSettingsTabs.value
  return visibleSettingsTabs.value.filter((tab) => {
    const haystack = [tab.label, tab.description, ...(tab.capabilities || [])].join(' ').toLowerCase()
    return haystack.includes(query)
  })
})
// filteredSettingsTabGroups 按导航分组渲染当前过滤结果。
// 新增设置分区但忘记登记分组时，不会被静默隐藏：未登记的 key 落到末尾“其他”分组。
const filteredSettingsTabGroups = computed(() => {
  const groups = SETTINGS_NAV_GROUPS
    .map((group) => ({
      key: group.key,
      label: group.label,
      tabs: group.sections
        .map((key) => filteredSettingsTabs.value.find((tab) => tab.key === key))
        .filter(Boolean),
    }))
    .filter((group) => group.tabs.length > 0)
  const others = filteredSettingsTabs.value.filter((tab) => !SETTINGS_NAV_GROUPED_KEYS.has(tab.key))
  if (others.length) groups.push({ key: 'other', label: '其他', tabs: others })
  return groups
})
const activeSettingsTab = computed({
  get() {
    const section = typeof route.params.section === 'string' ? route.params.section : ''
    if (settingsSectionKeys.has(section) && visibleSettingsTabs.value.some((tab) => tab.key === section)) {
      return section
    }
    // 兜底：当前 section 没权限时落回第一个可见 tab，没有可见 tab 时回 'iam' 占位（由 v-if 拦截渲染）。
    return visibleSettingsTabs.value[0]?.key || lastSettingsSection.value
  },
  set(section) {
    if (!settingsSectionKeys.has(section)) {
      return
    }
    if (!visibleSettingsTabs.value.some((tab) => tab.key === section)) {
      // 切到没权限的 tab 时直接拒绝，更不能写 lastSettingsSection。
      return
    }
    lastSettingsSection.value = section
    if (route.name !== 'settings' || section !== route.params.section) {
      router.push({ name: 'settings', params: { section } })
    }
  },
})

// 搜索无结果时不再继续展示被过滤掉的模块内容，避免导航与主体状态不一致。
const hasActiveFilteredSettingsTab = computed(() => (
  filteredSettingsTabs.value.some((tab) => tab.key === activeSettingsTab.value)
))

// 设置页大纲补位：页面标题是 <h1>，各设置模块内部的标题从 <h3> 起（含无权限空状态），
// 中间缺 <h2> 会造成标题层级跳跃。这里用当前 tab 名称生成一个只存在于可访问性树里的
// 小节标题：视觉隐藏、不占布局、不改变任何可见标题的级别。
const activeSettingsTabLabel = computed(() => (
  filteredSettingsTabs.value.find((tab) => tab.key === activeSettingsTab.value)?.label
  || visibleSettingsTabs.value.find((tab) => tab.key === activeSettingsTab.value)?.label
  || '系统设置'
))

// 前后端 result / risk 枚举到中文标签的映射，与后端 audit/application 层枚举保持一致。
// 下拉框展示中文标签，提交给后端的是稳定的机器可读分类值，不能把中文标签当作 action 精确值查询。
const AUDIT_TYPE_OPTIONS = AUDIT_ACTION_CATEGORY_OPTIONS
const AUDIT_RESULT_OPTIONS = Object.values(AUDIT_RESULT_LABELS)
const AUDIT_RISK_OPTIONS = Object.values(AUDIT_RISK_LABELS)

function auditResultValue(label) {
  return Object.entries(AUDIT_RESULT_LABELS).find(([, value]) => value === label)?.[0] || ''
}
function auditRiskValue(label) {
  return Object.entries(AUDIT_RISK_LABELS).find(([, value]) => value === label)?.[0] || ''
}

function rangeBounds(range) {
  const now = new Date()
  const ms = { '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 }[range] || 0
  if (!ms) return { from: '', to: '' }
  const from = new Date(now.getTime() - ms)
  return { from: from.toISOString(), to: now.toISOString() }
}

// 审计时间与商业授权页共用业务时间入口（北京时间 UTC+8、24 小时制）。
// 之前这里用浏览器时区，服务器跑 UTC 且运维用 UTC 浏览器时，同一事件会比授权页早 8 小时。
function formatAuditTime(value) {
  if (!value) return '—'
  return formatBusinessDateTime(value, { seconds: true }) || String(value)
}

const filteredAuditRecords = computed(() => auditRecords.value)

// 高级筛选已生效条件数（只用于按钮角标，不参与查询语义）。
const activeAuditAdvancedCount = computed(() => [
  auditType.value,
  auditResult.value,
  auditRisk.value,
  auditEventID.value,
  auditActorID.value,
  auditCorrelationID.value,
  auditLoginIP.value,
  auditRequestID.value,
  auditResourceID.value,
  auditClientIP.value,
].filter((value) => String(value || '').trim()).length)

const auditTotalPages = computed(() => Math.max(1, Math.ceil(auditTotal.value / auditPageSize.value)))
// 审计列表的三态闸门：读取失败必须渲染可重试的错误态，绝不能退化成「未找到符合条件的审计事件」，
// 否则运维会以为筛选条件没匹配到，而不是「请求失败了」。
const auditListState = computed(() => auditLoading.value || Boolean(auditError.value) || !pagedAuditRecords.value.length)
// 顶栏未读通知弹层同样走三态闸门：加载中 / 读取失败 / 没有未读。
const topbarNotificationsState = computed(() => notificationMenuLoading.value || Boolean(topbarNotificationsError.value) || !topbarNotifications.value.length)
// 审计接口已经按 page/page_size 返回当前页数据，前端不能再次按照全局页码切片，
// 否则从第二页开始会把后端返回的当前页记录全部过滤掉。
const pagedAuditRecords = computed(() => filteredAuditRecords.value)

const viewMeta = computed(() => {
  if (currentView.value === 'audit') {
    return { title: '审计日志', crumb: '审计日志', description: '审计事件、数据变更摘要与跨链路追溯' }
  }
  // 面包屑带出当前设置页签：深链直达某个设置分组时，顶栏能直接看出当前分组，
  // 而不是所有设置页都显示同一个“系统设置”。
  const settingsCrumb = activeSettingsTabLabel.value && activeSettingsTabLabel.value !== '系统设置'
    ? `系统设置 · ${activeSettingsTabLabel.value}`
    : '系统设置'
  if (activeSettingsTab.value === 'iam') {
    return { title: '系统设置', crumb: settingsCrumb, description: '身份、组织、角色与权限集中配置' }
  }
  if (activeSettingsTab.value === 'security') {
    return { title: '系统设置', crumb: settingsCrumb, description: '登录策略、账户锁定与会话超时集中配置' }
  }
  return { title: '系统设置', crumb: settingsCrumb, description: '平台级参数、通知与安全策略集中配置' }
})

function navigate(view) {
  const target = view === 'audit'
    ? { name: 'audit' }
    : { name: 'settings', params: { section: activeSettingsTab.value } }

  if (route.name !== target.name) {
    router.push(target)
  }
  mobileMenuOpen.value = false
}

// 从平台控制台返回子系统门户；门户是统一登录后的入口，不属于系统管理权限模块。
function goToPortal() {
  mobileMenuOpen.value = false
  closeSubsystemTabOrFallback(window, () => router.replace({ name: 'portal' }))
}

// handleNavigate 把共享外壳抛出的导航键映射到本页现有入口，路由与权限口径保持不变。
// 参数：key 为 navGroups 里的导航键。返回值：无。
function handleNavigate(key) {
  if (key === 'portal') {
    goToPortal()
    return
  }
  navigate(key)
}

function showToast(message) {
  toastMessage.value = formatUserError(message)
  if (toastTimer) {
    window.clearTimeout(toastTimer)
  }
  toastTimer = window.setTimeout(() => {
    toastMessage.value = ''
  }, 5200)
}

async function loadPlatformSettings() {
  if (!canReadPlatformSettings.value) return
  settingsLoading.value = true
  settingsError.value = ''
  try {
    const payload = await getPlatformSettings()
    if (payload) {
      Object.assign(settings, payload)
    }
  } catch (error) {
    settingsError.value = formatUserError(error, { fallback: '读取平台设置失败。' })
  } finally {
    settingsLoading.value = false
  }
}

async function saveSettings() {
  if (!canUpdatePlatformSettings.value || settingsSaving.value) return
  settingsSaving.value = true
  settingsError.value = ''
  try {
    const payload = await updatePlatformSettings({
      organizationName: settings.organizationName.trim(),
      organizationAlias: settings.organizationAlias.trim(),
      timezone: settings.timezone || '',
      qualification: settings.qualification || '',
      version: settings.version,
    })
    if (payload) Object.assign(settings, payload)
    showToast('平台基础设置已保存。')
  } catch (error) {
    settingsError.value = formatUserError(error, { fallback: '保存平台设置失败。' })
  } finally {
    settingsSaving.value = false
  }
}

function resetSettings() {
  if (!canReadPlatformSettings.value) return
  // 重新拉一次服务端真值，避免清成前端硬编码的占位字符串。
  loadPlatformSettings()
  showToast('已重新读取平台基础设置。')
}

async function loadApplications() {
  if (!canReadApplications.value) {
    applications.value = []
    applicationsError.value = ''
    return
  }
  try {
    // 逐页读取完整应用目录：审计筛选和员工向导的应用前置检查都依赖这份列表，
    // 只取第一页会让第 101 个之后的应用静默消失。
    applications.value = await loadAllCatalogPages(
      listApplications,
      { pageSize: 100, status: 'ACTIVE' },
      (item) => item?.application_id || item?.id || item?.code,
    )
    // 成功即清空失败位：审计筛选的错误行不能在一次成功读取后继续挂着。
    applicationsError.value = ''
  } catch (error) {
    applications.value = []
    applicationsError.value = formatUserError(error, { fallback: '读取应用列表失败。' })
    if (error && error.code !== 'NETWORK_ERROR') {
      showToast(applicationsError.value)
    }
  }
}

async function loadEnvironments(applicationCode) {
  if (!applicationCode) {
    environments.value = []
    return
  }
  const target = applications.value.find((app) => app.code === applicationCode || app.application_id === applicationCode)
  if (!target) {
    environments.value = []
    return
  }
  try {
    const data = await listEnvironments({ applicationId: target.application_id, page: 1, pageSize: 50, status: 'ACTIVE' })
    environments.value = data.items || []
  } catch (error) {
    environments.value = []
  }
}

// 「新增员工」入口的预加载目录：组织 / 岗位 / 应用。
//
// 这里刻意不做“数组非空就永久复用”：员工弹窗打开过一次之后，管理员仍可能在
// 其他页面新增组织或岗位，永久缓存会让向导一直看不到新数据。每次打开都重新读取，
// 同一时刻的重复调用按会话与类别合并；读取失败保留上一次可用值并单独提示重试。
const onboardingReferencesLoading = ref(false)
const onboardingReferencesError = ref('')
let onboardingReferencesSequence = 0

function onboardingReferenceKey(item, ...keys) {
  for (const key of keys) {
    const value = String(item?.[key] || '').trim()
    if (value) return value
  }
  return ''
}

async function loadOnboardingReferences() {
  if (!hasPermission(IAM_PERMISSIONS.userCreate)) return
  const sequence = ++onboardingReferencesSequence
  onboardingReferencesLoading.value = true
  onboardingReferencesError.value = ''
  const failures = []
  // loadRelatedDataSafely 负责“同一时刻合并重复读取、失败可重试、会话切换后丢弃迟到响应”，
  // 以及“写入已确认后不把写入前在途的旧目录当成最新目录”。
  const fetchCatalog = async (key, loader, assign, label, kinds) => {
    const result = await loadRelatedDataSafely(key, loader, { kinds })
    if (result.stale) return
    if (result.error) {
      failures.push(`${label}：${formatUserError(result.error, { method: 'GET', fallback: `${label}暂时无法读取。` }).slice(0, 120)}`)
      console.error(`loadOnboardingReferences: ${label} failed`, result.error)
      return
    }
    assign(result.items || [])
  }
  await Promise.all([
    fetchCatalog(
      'console:onboarding:organizations',
      () => loadAllCatalogPages(listOrgUnits, { pageSize: 100, status: 'ACTIVE' }, (item) => onboardingReferenceKey(item, 'org_unit_id', 'id')),
      (items) => { onboardingOrganizations.value = items },
      '组织目录',
      [RELATED_DATA.ORGANIZATIONS],
    ),
    fetchCatalog(
      'console:onboarding:positions',
      () => loadAllCatalogPages(listPositions, { pageSize: 100, status: 'ACTIVE' }, (item) => onboardingReferenceKey(item, 'position_id', 'id')),
      (items) => { onboardingPositions.value = items },
      '岗位目录',
      [RELATED_DATA.POSITIONS],
    ),
    fetchCatalog(
      'console:onboarding:applications',
      () => loadAllCatalogPages(listApplications, { pageSize: 100, status: 'ACTIVE' }, (item) => onboardingReferenceKey(item, 'application_id', 'id', 'code')),
      (items) => { applications.value = items; applicationsError.value = '' },
      '应用目录',
      [RELATED_DATA.APPLICATIONS, RELATED_DATA.ENVIRONMENTS],
    ),
  ])
  // 只有最后一次发起的读取才能结束加载状态；旧调用不能覆盖新调用的结果。
  if (sequence !== onboardingReferencesSequence) return
  onboardingReferencesError.value = failures.join('；')
  onboardingReferencesLoading.value = false
}

function openEmployeeOnboarding() {
  if (!hasPermission(IAM_PERMISSIONS.userCreate)) return
  // 先打开弹窗（内部展示明确的加载状态），再后台读取当前目录；不阻塞在网络上。
  showEmployeeOnboarding.value = true
  loadOnboardingReferences().catch(() => {})
}

function closeEmployeeOnboarding() {
  showEmployeeOnboarding.value = false
}

async function refreshOnboardingReferences() {
  // 前置检查“快速补齐”成功后由弹窗回调：强制重新读取，确认新组织 / 岗位确实进入目录。
  await loadOnboardingReferences()
}

// 用户详情里的离职入口不再直接改用户状态，而是交给人员异动中心的离职申请流程。
function openPersonnelChangeForUser(user) {
  const userId = String(user?.user_id || user?.id || '').trim()
  if (!userId) return
  pendingPersonnelChangeUserId.value = userId
  activeSettingsTab.value = 'personnel'
}

// 会话作用域持久化：操作结果/操作记录按租户+用户隔离，登出统一清除。
const { result: onboardingResult, save: saveOnboardingResult, clear: clearOnboardingResult } = usePersistentResult('uip:last-employee-onboarding', { principal })
const { push: pushOperationRecord } = useOperationInbox({ principal })
const iamInitialPanel = ref('')

function openPositionAuthorizationFromOnboarding() {
  activeSettingsTab.value = 'iam'
  iamInitialPanel.value = 'positionAuthorizationTemplates'
}

function openServerTaskCenter() {
  activeSettingsTab.value = 'jobs'
}

function handleEmployeeOnboardingCompleted(result) {
  // 新增员工成功后刷新缓存，让下一次打开 modal 时看到刚建好的组织 / 岗位。
  // IAM 列表组件与员工 modal 是兄弟组件，递增 key 让用户、账号、任职关系
  // 及顶部统计在当前页面立即重新读取，而不必整页刷新。
  iamRefreshKey.value += 1
  loadOnboardingReferences().catch(() => {})
  const user = result?.user || result || {}
  const displayName = user.display_name || user.displayName || result?.display_name || '新员工'
  const reference = user.employee_no || user.employeeNo || user.user_id || result?.user_id || ''
  const record = {
    title: '员工已创建',
    message: `${displayName} 的档案、登录账号或任职关系已按提交结果创建。`,
    reference,
    nextAction: '请核对账号状态与岗位授权继承结果；首次登录后按提示修改初始密码。',
    module: '基础平台',
  }
  saveOnboardingResult(record)
  pushOperationRecord(record)
}

async function loadAuditHealth() {
  auditHealthError.value = ''
  try {
    auditHealth.value = await getAuditIngestionHealth()
  } catch (error) {
    // 健康度是辅助信息：失败不影响审计列表本身。
    auditHealth.value = null
    auditHealthError.value = formatUserError(error)
  }
}

async function loadAuditEvents() {
  if (currentView.value !== 'audit' || !canViewAudit.value) return
  const requestSequence = ++auditRequestSequence
  auditRequestController?.abort()
  const requestController = new AbortController()
  auditRequestController = requestController
  auditLoading.value = true
  auditError.value = ''
  try {
    const bounds = rangeBounds(auditTimeRange.value)
    const data = await listAuditEvents({
      page: auditPage.value,
      pageSize: auditPageSize.value,
      keyword: auditKeyword.value.trim(),
      clientIp: auditClientIP.value.trim(),
      resourceId: auditResourceID.value.trim(),
      requestId: auditRequestID.value.trim(),
      correlationId: auditCorrelationID.value.trim(),
      eventId: auditEventID.value.trim(),
      actorId: auditActorID.value.trim(),
      loginIp: auditLoginIP.value.trim(),
      applicationCode: auditApplication.value,
      environmentCode: auditEnvironment.value,
      actionCategory: auditType.value,
      result: auditResultValue(auditResult.value),
      riskLevel: auditRiskValue(auditRisk.value),
      occurredFrom: bounds.from,
      occurredTo: bounds.to,
      signal: requestController.signal,
    })
    // 后端返回前用户可能已修改筛选条件；旧请求即使成功也不能回写当前列表。
    if (requestSequence !== auditRequestSequence || requestController.signal.aborted) return
    auditRecords.value = data.items
    auditTotal.value = data.total
    if (auditPage.value > auditTotalPages.value) {
      auditPage.value = auditTotalPages.value
      await loadAuditEvents()
    }
  } catch (error) {
    if (requestController.signal.aborted || requestSequence !== auditRequestSequence) return
    auditError.value = formatUserError(error, { fallback: '读取审计事件失败。' })
    auditRecords.value = []
    auditTotal.value = 0
  } finally {
    if (requestSequence === auditRequestSequence) {
      auditLoading.value = false
      if (auditRequestController === requestController) auditRequestController = null
    }
  }
}

function resetAuditFilters() {
  auditKeyword.value = ''
  auditType.value = ''
  auditRisk.value = ''
  auditApplication.value = ''
  auditEnvironment.value = ''
  auditResult.value = ''
  auditEventID.value = ''
  auditActorID.value = ''
  auditCorrelationID.value = ''
  auditLoginIP.value = ''
  auditTimeRange.value = '7d'
  auditPage.value = 1
  auditAdvancedOpen.value = false
  loadEnvironments('')
  loadAuditEvents()
}

function applyAuditFilters() {
  auditPage.value = 1
  loadAuditEvents()
}

function changeAuditPage(nextPage) {
  auditPage.value = Math.min(Math.max(nextPage, 1), auditTotalPages.value)
  loadAuditEvents()
}

// 切换每页条数后原页码大概率越界：回到第 1 页并用服务端 total 重算页数。
function changeAuditPageSize(nextSize) {
  const size = Math.trunc(Number(nextSize) || 0)
  if (size <= 0 || size === auditPageSize.value) return
  auditPageSize.value = size
  auditPage.value = 1
  loadAuditEvents()
}

function openAuditDetail(record) {
  auditDetail.value = record
}

/**
 * 从详情跳到"相关事件"：只设置过滤条件，不拼 URL、不带任何越权参数；
 * 后端仍按当前租户与应用权限过滤。
 */
function filterRelatedAudit(field, value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return
  if (field === 'requestId') auditRequestID.value = trimmed
  if (field === 'correlationId') auditCorrelationID.value = trimmed
  // 从详情点进来的精确条件在高级筛选里，展开让用户看到当前过滤条件。
  auditAdvancedOpen.value = true
  auditPage.value = 1
  closeAuditDetail()
  loadAuditEvents()
}

function closeAuditDetail() {
  auditDetail.value = null
}

async function exportAuditRecords() {
  if (!canExportAudit.value || auditExporting.value) return
  auditExporting.value = true
  try {
    const bounds = rangeBounds(auditTimeRange.value)
    const job = await createAuditExportJob({
      keyword: auditKeyword.value.trim(),
      applicationCode: auditApplication.value,
      environmentCode: auditEnvironment.value,
      actionCategory: auditType.value,
      result: auditResultValue(auditResult.value),
      riskLevel: auditRiskValue(auditRisk.value),
      occurredFrom: bounds.from,
      occurredTo: bounds.to,
    })
    auditExportJob.value = job || null
    const status = job?.status || '已接收'
    showToast(`导出任务已提交（${status}），可在当前页面刷新状态并下载。`)
  } catch (error) {
    showToast(formatUserError(error, { fallback: '提交导出任务失败。' }))
  } finally {
    auditExporting.value = false
  }
}

async function refreshAuditExportJob() {
  if (!auditExportJob.value?.job_id) return
  try { auditExportJob.value = await getAuditExportJob(auditExportJob.value.job_id) }
  catch (error) { showToast(formatUserError(error, { fallback: '查询导出任务状态失败。' })) }
}

async function downloadAuditExport() {
  if (auditDownloading.value || auditExportJob.value?.status !== 'SUCCEEDED' || !auditExportJob.value?.job_id) return
  auditDownloading.value = true
  try {
    // 下载分两步（审计导出下载一次性票据）：先申请短时票据，再凭票据取文件字节。
    // 票据只在本函数内存中短暂存在，不入组件状态、不写日志；过期（410）时重新申请即可。
    const issued = await createAuditExportDownloadTicket(auditExportJob.value.job_id)
    const { blob, filename } = await downloadAuditExportFile(auditExportJob.value.job_id, { ticket: issued?.ticket })
    const url = URL.createObjectURL(blob)
    try {
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = filename; anchor.click()
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
  } catch (error) { showToast(formatUserError(error, { fallback: '审计文件下载失败，请稍后重新下载。' })) }
  finally { auditDownloading.value = false }
}

async function loadTopbarNotifications() {
  notificationMenuLoading.value = true
  topbarNotificationsError.value = ''
  try {
    const [count, page] = await Promise.all([getUnreadCount(), listInbox({ pageSize: 8, unreadOnly: true })])
    topbarUnreadCount.value = Number(count?.unread_count || 0)
    topbarNotifications.value = page?.items || []
  } catch (error) {
    topbarUnreadCount.value = 0
    topbarNotifications.value = []
    // 读取失败不能显示成「暂无未读通知」：交给列表三态给出可重试的错误。
    topbarNotificationsError.value = formatUserError(error, { fallback: '未读通知读取失败，请稍后重试。' })
  } finally { notificationMenuLoading.value = false }
}

async function toggleNotificationMenu() {
  notificationMenuOpen.value = !notificationMenuOpen.value
  if (notificationMenuOpen.value) await loadTopbarNotifications()
}

async function openTopbarNotification(item) {
  if (!item?.delivery_id) return
  if (!item.read_at) await markNotificationRead(item.delivery_id).catch(() => null)
  await loadTopbarNotifications()
  const target = String(item.target_url || '')
  if (target.startsWith('/') && !target.startsWith('//')) await router.push(target).catch(() => {})
}

async function logout() {
  if (isLoggingOut.value) return

  isLoggingOut.value = true
  try {
    await logoutCurrentSession()
    await router.replace({ name: 'login', query: { reason: 'session-ended' } })
  } catch (error) {
    // 服务端已失效的会话同样需要落到登录页，避免页面停留在受保护区域。
    if (error instanceof AuthError && error.status === 401) {
      await router.replace({ name: 'login', query: { reason: 'session-ended' } })
      return
    }
    showToast(formatUserError(error, { fallback: '退出登录失败，请稍后重试。' }))
  } finally {
    isLoggingOut.value = false
  }
}

// 直接打开 /audit 时 currentView 从初始值起就是 'audit'，不会触发"变化"；
// 因此这里既要处理视图切换，也要在权限就绪后补一次首次查询（见 principal 监听）。
function loadAuditViewOnce() {
  if (currentView.value !== 'audit' || !canViewAudit.value) return
  if (canReadApplications.value && !applications.value.length) loadApplications()
  loadAuditEvents()
  loadAuditHealth()
}

watch(currentView, (view) => {
  if (view !== 'settings') {
    // 搜索只属于当前设置页会话，离开后清空，避免返回时隐藏设置模块。
    settingsTabKeyword.value = ''
  }
  loadAuditViewOnce()
})

watch(filteredSettingsTabs, (tabs) => {
  if (currentView.value !== 'settings' || !tabs.length) return
  if (tabs.some((tab) => tab.key === activeSettingsTab.value)) return

  // 当前 tab 被搜索条件排除时，同步切换到第一个匹配项。
  // 搜索输入不应为每次自动切换新增浏览器历史，因此使用 replace。
  const nextSection = tabs[0].key
  lastSettingsSection.value = nextSection
  void router.replace({ name: 'settings', params: { section: nextSection } })
})

watch(auditApplication, (value, previous) => {
  if (value === previous) return
  auditEnvironment.value = ''
  loadEnvironments(value)
  applyAuditFilters()
})

watch([auditKeyword, auditType, auditRisk, auditEnvironment, auditResult, auditTimeRange], () => {
  applyAuditFilters()
})

watch(() => route.params.section, (section) => {
  if (route.name === 'settings' && typeof section === 'string' && settingsSectionKeys.has(section)) {
    lastSettingsSection.value = section
  }
}, { immediate: true })

watch([currentView, activeSettingsTab], () => {
  document.title = `${viewMeta.value.title} · 基础能力平台`
}, { immediate: true })

watch(activeSettingsTab, (tab) => {
  if (tab === 'base' && canReadPlatformSettings.value && !settings.organizationName && !settingsLoading.value) {
    loadPlatformSettings()
  }
}, { immediate: true })

watch(principal, (current) => {
  if (!current) return
  if (currentView.value === 'audit' && !canViewAudit.value) {
    const firstSection = visibleSettingsTabs.value[0]?.key
    void router.replace(firstSection
      ? { name: 'settings', params: { section: firstSection } }
      : { name: 'portal' })
    return
  }
  if (currentView.value === 'settings') {
    const requestedSection = typeof route.params.section === 'string' ? route.params.section : ''
    if (!visibleSettingsTabs.value.some((tab) => tab.key === requestedSection)) {
      const firstSection = visibleSettingsTabs.value[0]?.key
      void router.replace(firstSection
        ? { name: 'settings', params: { section: firstSection } }
        : canViewAudit.value ? { name: 'audit' } : { name: 'portal' })
    }
    return
  }
  // 权限在挂载后才就绪：直接打开审计路由时在这里发起首次查询，避免空列表。
  loadAuditViewOnce()
})

// 关联数据失效订阅：本页面自己或兄弟组件（IAM 设置、人员异动中心、应用接入）写入
// 组织 / 岗位 / 人员 / 任职 / 应用后，立即重新读取员工向导依赖的目录，无需整页刷新。
useRelatedDataInvalidation((event) => {
  if (event.type === 'session') return
  // 应用 / 环境变化影响审计筛选与向导前置检查，按应用读取权限单独刷新。
  if (event.kinds.includes(RELATED_DATA.APPLICATIONS) || event.kinds.includes(RELATED_DATA.ENVIRONMENTS)) {
    loadApplications()
  }
  if (!hasPermission(IAM_PERMISSIONS.userCreate)) return
  loadOnboardingReferences().catch(() => {})
}, {
  kinds: [
    RELATED_DATA.ORGANIZATIONS,
    RELATED_DATA.POSITIONS,
    RELATED_DATA.PEOPLE,
    RELATED_DATA.MEMBERSHIPS,
    RELATED_DATA.APPLICATIONS,
  ],
})

// 其他标签页或其他管理员的改动不会推送；窗口重新获得焦点时重新校验一次，
// 让“切回来就能看到新组织 / 新岗位”，而不是要求用户整页刷新。
function refreshOnboardingReferencesOnFocus() {
  if (!showEmployeeOnboarding.value) return
  if (!hasPermission(IAM_PERMISSIONS.userCreate)) return
  loadOnboardingReferences().catch(() => {})
}

onMounted(async () => {
  // 拉取 principal，让 IAM 操作按钮的权限判断立即生效；后端仍执行最终鉴权。
  await refreshPrincipal().catch(() => null)
  if (canReadApplications.value) loadApplications()
  if (canReadPlatformSettings.value) loadPlatformSettings()
  // 只有具备新增员工权限时才预热创建流程所需目录。
  if (hasPermission(IAM_PERMISSIONS.userCreate)) loadOnboardingReferences().catch(() => {})
  loadTopbarNotifications().catch(() => {})
  window.addEventListener('focus', refreshOnboardingReferencesOnFocus)
})

onBeforeUnmount(() => {
  auditRequestSequence += 1
  auditRequestController?.abort()
  auditRequestController = null
  window.removeEventListener('focus', refreshOnboardingReferencesOnFocus)
  if (toastTimer) {
    window.clearTimeout(toastTimer)
  }
})
</script>

<template>
  <AppShell
    v-model:menu-open="mobileMenuOpen"
    page-class="console-page--platform"
    brand-name="基础能力平台"
    brand-subtitle="Basic Platform"
    nav-label="平台导航"
    :nav-groups="navGroups"
    :nav-empty="!hasAnySettingsOrAuditPermission"
    :user-name="currentAccountName"
    :user-role="currentRoleNames"
    :avatar-text="currentAccountAvatar"
    :logout-disabled="isLoggingOut"
    logout-label="退出应用系统"
    topbar-avatar
    @navigate="handleNavigate"
    @logout="logout"
  >
    <template #nav-empty>当前账号未配置系统管理模块的访问权限。</template>

    <template #breadcrumb>
      <span>基础能力平台</span>
      <ConsoleIcon name="chevron" />
      <strong>{{ viewMeta.crumb }}</strong>
    </template>

    <template #topbar-actions>
      <OperationInboxPanel server-tasks @open-server-tasks="openServerTaskCenter" />
      <div class="console-notification-menu">
        <button class="console-icon-button" type="button" aria-label="通知" :aria-expanded="notificationMenuOpen" @click="toggleNotificationMenu"><ConsoleIcon name="bell" /><i v-if="topbarUnreadCount"></i><b v-if="topbarUnreadCount">{{ topbarUnreadCount > 99 ? '99+' : topbarUnreadCount }}</b></button>
        <aside v-if="notificationMenuOpen" class="console-notification-popover"><header><strong>未读通知</strong><button type="button" @click="notificationMenuOpen = false">×</button></header><ListState v-if="topbarNotificationsState" :loading="notificationMenuLoading" :error="topbarNotificationsError" error-title="未读通知加载失败" empty-title="暂无未读通知。" compact @retry="loadTopbarNotifications" /><button v-for="item in topbarNotifications" v-else :key="item.delivery_id" class="console-notification-row" type="button" @click="openTopbarNotification(item)"><strong>{{ item.title }}</strong><span>{{ item.content }}</span></button><footer><button type="button" @click="activeSettingsTab = 'notify'; notificationMenuOpen = false">进入通知中心</button></footer></aside>
      </div>
    </template>

    <template #main-prefix>
      <OperationResultBanner
        v-if="onboardingResult"
        :title="onboardingResult.title"
        :message="onboardingResult.message"
        :reference="onboardingResult.reference"
        :next-action="onboardingResult.nextAction"
        :saved-at="onboardingResult.savedAt"
        action-text="查看岗位授权模板"
        @action="openPositionAuthorizationFromOnboarding"
        @dismiss="clearOnboardingResult"
      />
    </template>

    <template #page-head>
      <div v-if="currentView === 'audit'" class="console-page-head">
        <div>
          <h1>{{ viewMeta.title }}</h1>
          <p v-if="viewMeta.description">{{ viewMeta.description }}</p>
        </div>
      </div>
    </template>

    <section v-if="currentView === 'audit' && canViewAudit" class="audit-view" aria-label="审计日志列表">
      <!-- 摄取健康度：从一行文本改为四个指标块，口径说明与数值分开，便于一眼核对。 -->
      <section v-if="auditHealth" class="audit-health" data-testid="audit-health-card" aria-label="审计摄取健康度">
        <header class="audit-health-head">
          <div>
            <strong>审计摄取健康（平台侧）</strong>
            <small>口径：平台已接收的审计事件；子系统本地 Outbox 积压不在本卡片内。</small>
          </div>
          <span class="console-badge audit-health-badge">只读</span>
        </header>
        <dl class="audit-health-grid">
          <div class="audit-health-tile"><dt>近 24 小时接收</dt><dd>{{ auditHealth.recent_events ?? 0 }}<small>条</small></dd></div>
          <div class="audit-health-tile"><dt>累计接收</dt><dd>{{ auditHealth.total_events ?? 0 }}<small>条</small></dd></div>
          <div class="audit-health-tile"><dt>来源未采集</dt><dd>{{ auditHealth.unknown_provenance ?? 0 }}<small>条</small></dd></div>
          <div class="audit-health-tile is-text"><dt>最后接收</dt><dd>{{ auditHealth.last_received_at ? formatAuditTime(auditHealth.last_received_at) : '—' }}</dd></div>
        </dl>
        <p v-if="auditHealth.oldest_unknown_at" class="audit-health-foot">最老未采集：{{ formatAuditTime(auditHealth.oldest_unknown_at) }}</p>
      </section>
      <div v-else-if="auditHealthError" class="audit-readonly-note"><ConsoleIcon name="info" /><span>审计摄取健康度暂不可用：{{ auditHealthError }}</span></div>

      <!-- 筛选：主筛选常驻，精确检索收进「高级筛选」，避免 11 个控件同时铺开。 -->
      <section class="audit-filter-card" aria-label="审计筛选">
        <div class="audit-filter-primary">
          <label class="console-search-field audit-filter-keyword">
            <ConsoleIcon name="search" />
            <input v-model="auditKeyword" type="search" placeholder="操作人 / 操作 / 资源 / 请求路径 / Request ID / Trace ID…"  maxlength="100"/>
          </label>
          <label class="console-select-field"><select v-model="auditApplication" aria-label="应用"><option value="">全部应用</option><option v-for="app in applications" :key="app.application_id" :value="app.code">{{ app.name || app.code }}</option></select></label>
          <label class="console-select-field"><select v-model="auditEnvironment" :disabled="!auditApplication" aria-label="环境"><option value="">全部环境</option><option v-for="env in environments" :key="env.environment_id" :value="env.environment_code || env.environment">{{ env.environment_code || env.environment }}</option></select></label>
          <label class="console-select-field"><select v-model="auditTimeRange" aria-label="时间范围"><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option></select></label>
          <div class="audit-filter-actions">
            <button class="console-button primary" type="button" :disabled="auditLoading" @click="applyAuditFilters">查询</button>
            <button class="console-button ghost" type="button" :disabled="auditLoading" @click="resetAuditFilters"><ConsoleIcon name="reset" />重置</button>
            <button
              class="console-button ghost audit-advanced-toggle"
              type="button"
              :class="{ active: auditAdvancedOpen }"
              :aria-expanded="auditAdvancedOpen ? 'true' : 'false'"
              aria-controls="audit-advanced-filters"
              @click="auditAdvancedOpen = !auditAdvancedOpen"
            >
              <ConsoleIcon name="filter" />高级筛选
              <span v-if="activeAuditAdvancedCount" class="audit-advanced-count">{{ activeAuditAdvancedCount }}</span>
              <ConsoleIcon name="chevron" class="audit-advanced-chevron" />
            </button>
          </div>
        </div>
        <div v-show="auditAdvancedOpen" id="audit-advanced-filters" class="audit-filter-advanced">
          <label class="console-select-field"><select v-model="auditType" aria-label="操作类型"><option value="">全部操作</option><option v-for="option in AUDIT_TYPE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
          <label class="console-select-field"><select v-model="auditResult" aria-label="操作结果"><option value="">全部结果</option><option v-for="option in AUDIT_RESULT_OPTIONS" :key="option" :value="option">{{ option }}</option></select></label>
          <label class="console-select-field"><select v-model="auditRisk" aria-label="风险等级"><option value="">全部风险</option><option v-for="option in AUDIT_RISK_OPTIONS" :key="option" :value="option">{{ option }}</option></select></label>
          <label class="console-search-field audit-advanced-field"><input v-model="auditEventID" type="search" placeholder="事件 ID" maxlength="64" aria-label="按事件 ID 精确检索"/></label>
          <label class="console-search-field audit-advanced-field"><input v-model="auditActorID" type="search" placeholder="操作者 ID" maxlength="64" aria-label="按稳定操作者 ID 精确检索"/></label>
          <label class="console-search-field audit-advanced-field"><input v-model="auditCorrelationID" type="search" placeholder="关联 ID" maxlength="64" aria-label="按业务关联 ID 精确检索"/></label>
          <label class="console-search-field audit-advanced-field"><input v-model="auditLoginIP" type="search" placeholder="登录 IP" maxlength="45" aria-label="按登录 IP 精确检索"/></label>
        </div>
      </section>

      <!-- 应用下拉只有「全部应用」有两种可能：读到目录后确实只有一项，或者读取失败。
           这里把失败单独说出来并给出就地重试（重发同一个 loadApplications），
           不能让失败伪装成「只有一个应用」；「全部应用」同时保持可用。 -->
      <p v-if="applicationsError" class="console-prereq-error" data-testid="audit-applications-error" role="alert">
        应用列表读取失败，应用筛选暂时只能选「全部应用」：{{ applicationsError }}
        <button class="console-button ghost small" type="button" @click="loadApplications"><ConsoleIcon name="reset" />重试</button>
      </p>

      <div class="audit-toolbar">
        <p class="audit-toolbar-note"><ConsoleIcon name="info" /><span>审计事件为只读记录，不支持页面直接删除或归档。数据来源与运行日志分离，本页查询 <code>audit_event</code> 及其变更摘要。</span></p>
        <div class="audit-toolbar-actions"><button v-if="canExportAudit" class="console-button secondary" type="button" :disabled="auditExporting" @click="exportAuditRecords"><ConsoleIcon name="export" />导出筛选结果</button></div>
      </div>

      <div v-if="auditExportJob" class="audit-readonly-note audit-export-status"><ConsoleIcon name="export" /><span>导出任务 <code>{{ auditExportJob.job_id }}</code>：{{ auditExportJob.status }}<template v-if="auditExportJob.error_message"> · {{ formatUserError({ message: auditExportJob.error_message, code: auditExportJob.error_code }) }}</template></span><button v-if="auditExportJob.status !== 'SUCCEEDED'" class="console-button ghost small" type="button" @click="refreshAuditExportJob">刷新状态</button><button v-else class="console-button primary small" type="button" :disabled="auditDownloading" @click="downloadAuditExport">{{ auditDownloading ? '下载中…' : '下载导出文件' }}</button></div>

      <ListState
        v-if="auditListState"
        :loading="auditLoading"
        :error="auditError"
        error-title="审计事件加载失败"
        empty-title="未找到符合筛选条件的审计事件。"
        @retry="loadAuditEvents"
      />
      <div v-else class="console-table-card audit-table-card">
        <div class="console-table-scroll">
          <table class="console-data-table audit-data-table">
            <thead><tr><th scope="col">发生时间</th><th scope="col">操作人</th><th scope="col">操作</th><th scope="col">应用 / 环境</th><th scope="col">资源对象</th><th scope="col">方法 / 路径</th><th scope="col">客户端 IP</th><th scope="col">状态</th><th scope="col">风险</th><th scope="col" class="console-actions-cell">查看</th></tr></thead>
            <tbody>
              <tr v-for="record in pagedAuditRecords" :key="record.id">
                <td class="console-mono" data-label="发生时间">{{ formatAuditTime(record.time) }}</td>
                <td data-label="操作人"><strong class="console-entity-name">{{ record.operator || '—' }}</strong></td>
                <td data-label="操作"><span class="console-badge audit-action-badge" :class="`type-${auditActionLabel(record)}`">{{ auditActionLabel(record) }}</span><span v-if="auditActionCode(record)" class="console-entity-meta console-mono">{{ auditActionCode(record) }}</span></td>
                <td data-label="应用 / 环境"><strong>{{ record.application || '—' }}</strong><span class="console-entity-meta">{{ record.environment || '—' }}</span></td>
                <td data-label="资源对象"><strong>{{ record.object || record.resource || '—' }}</strong><span class="console-entity-meta">{{ record.resource }}</span></td>
                <td data-label="方法 / 路径"><span class="audit-method">{{ record.method || '—' }}</span><span class="console-entity-meta console-mono">{{ record.path || '—' }}</span></td>
                <td class="console-mono" data-label="操作 IP">{{ record.ip || '—' }}</td>
                <td data-label="状态"><span class="console-badge audit-result-badge" :class="auditResultTone(record.result)">{{ auditResultLabel(record) }}</span><span v-if="auditHttpStatusLabel(record.statusCode)" class="console-entity-meta audit-status-code">{{ auditHttpStatusLabel(record.statusCode) }}</span></td>
                <td data-label="风险"><span class="console-badge" :class="`risk-${record.risk}`">{{ auditRiskLabel(record) }}</span></td>
                <td class="console-actions-cell" data-label="操作"><button class="console-text-button" type="button" @click="openAuditDetail(record)">详情</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="console-table-footer audit-table-footer"><span>审计事件为只读记录</span><PaginationBar label="审计事件分页" :page="auditPage" :total="auditTotal" :page-size-options="[20, 50, 100]" :page-size="auditPageSize" :loading="auditLoading" @change="changeAuditPage" @change-page-size="changeAuditPageSize" /></footer>
      </div>

    </section>

    <section v-else-if="currentView === 'settings' && canOpenSettings" class="settings-view" aria-label="系统设置">
      <!-- 设置导航：宽屏为左侧分组导航（≥1800px），窄屏回退为页头下方吸顶的横向分区条。
           分组只影响展示顺序与分组标题；可见性、权限与 filteredSettingsTabs 的既有语义不变。 -->
      <aside class="settings-rail">
        <header class="settings-showcase-head">
          <div>
            <span class="settings-showcase-kicker"><ConsoleIcon name="settings" />平台配置中心</span>
            <h1>系统设置</h1>
            <p>集中维护平台基础资料、身份组织、统一登录、安全策略与运行支撑能力。</p>
          </div>
        </header>

        <div v-if="!hasNoVisibleSettingsTab" class="settings-tab-toolbar">
          <label class="settings-tab-search">
            <ConsoleIcon name="search" />
            <input
              v-model="settingsTabKeyword"
              type="search"
              placeholder="搜索设置模块"
              aria-label="搜索设置模块"
             maxlength="100"/>
            <button
              v-if="settingsTabKeyword"
              type="button"
              class="settings-tab-search-clear"
              aria-label="清空搜索"
              @click="settingsTabKeyword = ''"
            >×</button>
          </label>
          <span class="settings-tab-count">{{ filteredSettingsTabs.length }} / {{ visibleSettingsTabs.length }}</span>
        </div>
        <nav v-if="!hasNoVisibleSettingsTab" class="settings-tab-bar" role="tablist" aria-label="系统设置分类">
          <template v-for="group in filteredSettingsTabGroups" :key="group.key">
            <p class="settings-nav-group" role="presentation">{{ group.label }}</p>
            <button
              v-for="tab in group.tabs"
              :key="tab.key"
              class="settings-tab"
              :class="{ active: activeSettingsTab === tab.key }"
              type="button"
              role="tab"
              :aria-selected="activeSettingsTab === tab.key"
              :title="tab.description"
              @click="activeSettingsTab = tab.key"
            >
              <span class="settings-tab-icon" aria-hidden="true"><ConsoleIcon :name="tab.icon" /></span>
              <span class="settings-tab-label">{{ tab.label }}</span>
            </button>
          </template>
          <span v-if="filteredSettingsTabs.length === 0" class="settings-tab-empty">没有匹配“{{ settingsTabKeyword }}”的设置模块</span>
        </nav>
        <div v-else class="settings-empty" role="status">
          <span class="settings-empty-icon" aria-hidden="true"><ConsoleIcon name="shield" /></span>
          <h3>当前账号没有可访问的设置模块</h3>
          <p>请联系平台管理员授予对应模块的读取或管理权限；IAM 不要求额外授予 <code>platform:user:read</code>。</p>
        </div>
      </aside>

      <div class="settings-content">
        <!-- 页面标题为 <h1>。除“身份、组织与授权”外的 10 个设置模块自身首个标题就是 <h2>，
             大纲已经连续，再补隐藏 <h2> 会让读屏标题列表出现两条同名同级的条目。
             只有 IAM 模块内部从 <h3> 起（“按归属、职责和例外分层管理”），此处在它的面板前
             补一层隐藏的 <h2> 承载 tab 名称，让大纲保持 h1 → h2 → h3，且不改变任何可见标题的
             级别与布局。条件必须与下面 IamSettingsModule 的渲染条件一致。 -->
        <h2 v-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'iam'" class="shared-visually-hidden">{{ activeSettingsTabLabel }}</h2>

        <div v-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'base'" class="console-card settings-card">
          <div class="console-card-body">
            <h2>平台基础信息</h2>
            <p class="console-card-hint">用于定义基础能力平台的展示名称。</p>
            <p v-if="settingsLoading" class="console-card-hint">正在读取平台设置…</p>
            <p v-else-if="settingsError" class="login-target-module__error" role="alert">{{ settingsError }}</p>
            <div v-if="canReadPlatformSettings" class="console-form-grid">
              <label class="console-form-item"><span>平台名称</span><input v-model="settings.organizationName" :disabled="settingsLoading || !canUpdatePlatformSettings"  maxlength="128"/></label>
              <label class="console-form-item"><span>平台简称</span><input v-model="settings.organizationAlias" :disabled="settingsLoading || !canUpdatePlatformSettings"  maxlength="64"/></label>
            </div>
            <div v-if="canReadPlatformSettings" class="console-form-actions"><button v-if="canUpdatePlatformSettings" class="console-button primary" type="button" :disabled="settingsSaving" @click="saveSettings"><ConsoleIcon name="save" />{{ settingsSaving ? '保存中…' : '保存设置' }}</button><button class="console-button ghost" type="button" :disabled="settingsLoading" @click="resetSettings">重新读取</button></div>
          </div>
        </div>

        <PublicAccessSettingsModule v-else-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'access'" @toast="showToast" />

        <IamSettingsModule
      :initial-panel="iamInitialPanel" v-else-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'iam'" :refresh-key="iamRefreshKey" @toast="showToast" @employee-onboarding="openEmployeeOnboarding" @personnel-change="openPersonnelChangeForUser" />

        <PersonnelChangeCenter v-else-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'personnel'" :prefill-user-id="pendingPersonnelChangeUserId" @toast="showToast" @employee-onboarding="openEmployeeOnboarding" @prefill-consumed="pendingPersonnelChangeUserId = ''" />

        <NotificationCenterModule v-else-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'notify'" @toast="showToast" />

        <LoginSecurityModule v-else-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'security'" @toast="showToast" />


        <DictionaryManagementModule v-else-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'dict'" @toast="showToast" />

        <ConfigurationCenterModule v-else-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'config'" @toast="showToast" />

        <FileTaskOperationsModule v-else-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'jobs'" @toast="showToast" />
        <CommercialLicenseView v-else-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'licenses'" @toast="showToast" />

        <template v-else-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'applications'">
          <SubsystemOnboardingModule
            :can-onboard="canOnboardSubsystem"
            @toast="showToast"
            @completed="loadApplications"
          >
            <template #header-actions>
              <SubsystemAccessWizard
                :can-preview="canReadApplications"
                :can-submit="canSubmitSubsystemAccess"
                :applications="subsystemAccessApplications"
                :environments="subsystemAccessEnvironments"
                @toast="showToast"
                @completed="loadApplications"
              />
            </template>
          </SubsystemOnboardingModule>
        </template>
      </div>
    </section>

    <template #overlay>
      <div v-if="auditDetail" class="console-modal-backdrop" role="presentation" @click.self="closeAuditDetail">
        <section class="console-detail-modal audit-detail-modal" role="dialog" aria-modal="true" aria-label="审计事件详情">
          <header><div><p class="console-modal-eyebrow">AUDIT EVENT · {{ auditDetail.id }}</p><h2>{{ auditDetail.object || auditDetail.resource || '审计事件' }}</h2></div><button class="console-modal-close" type="button" aria-label="关闭审计事件详情" @click="closeAuditDetail"><ConsoleIcon name="close" /></button></header>
          <div class="audit-detail-sections">
            <section class="audit-detail-section"><h3>事件概览</h3><div class="audit-detail-grid">
              <div><span>动作</span><strong class="console-mono">{{ auditDetail.action || '—' }}</strong></div>
              <div><span>结果</span><strong class="audit-detail-result-wrap"><span class="console-badge audit-result-badge" :class="auditResultTone(auditDetail.result)">{{ auditResultLabel(auditDetail) }}</span><small v-if="auditResultMeta(auditDetail)">{{ auditResultMeta(auditDetail) }}</small></strong></div>
              <div><span>风险等级</span><strong>{{ auditDetail.riskLabel || '—' }}</strong></div>
              <div><span>业务发生时间</span><strong>{{ formatAuditTime(auditDetail.time) }}</strong></div>
              <div><span>平台接收时间</span><strong>{{ auditDetail.receivedAt ? formatAuditTime(auditDetail.receivedAt) : '历史记录无此字段' }}</strong></div>
              <div><span>应用 / 环境</span><strong>{{ auditDetail.application || '—' }} / {{ auditDetail.environment || '—' }}</strong></div>
              <div><span>HTTP 请求</span><strong>{{ auditDetail.method || '—' }} {{ auditDetail.path || '—' }}</strong></div>
            </div></section>
            <section class="audit-detail-section"><h3>操作者</h3><div class="audit-detail-grid">
              <div><span>名称快照</span><strong>{{ auditDetail.operator || '—' }}</strong></div>
              <div><span>稳定身份</span><strong class="console-mono">{{ auditDetail.actorId || '历史记录无此字段' }}</strong></div>
              <div><span>主体类型</span><strong>{{ auditDetail.actorTypeLabel }}</strong></div>
            </div></section>
            <section class="audit-detail-section"><h3>业务对象</h3><div class="audit-detail-grid">
              <div><span>对象类型</span><strong>{{ auditDetail.resource || '—' }}</strong></div>
              <div><span>对象名称</span><strong>{{ auditDetail.object || '—' }}</strong></div>
              <div><span>对象 ID</span><strong class="console-mono">{{ auditDetail.businessId || auditDetail.resourceId || '—' }}</strong></div>
            </div></section>
            <section class="audit-detail-section"><h3>来源地址</h3><div class="audit-detail-grid">
              <div><span>登录 IP</span><strong>{{ auditDetail.loginIp || '未采集' }}</strong></div>
              <div><span>登录地址来源</span><strong>{{ auditDetail.loginIpSourceLabel }}</strong></div>
              <div><span>操作 IP</span><strong>{{ auditDetail.ip || '未采集' }}</strong></div>
              <div><span>操作地址来源</span><strong>{{ auditDetail.ipSourceLabel }}</strong></div>
              <div><span>投递端地址</span><strong>{{ auditDetail.ingestPeerIp || '未采集' }}</strong></div>
              <div><span>User Agent</span><strong>{{ auditDetail.userAgent || '未采集' }}</strong></div>
            </div><small>登录 IP 创建会话时固定，操作 IP 每次请求重新解析，投递地址只表示谁送来审计；三者不可互相替代。</small></section>
            <section class="audit-detail-section"><h3>处理与关联</h3><div class="audit-detail-grid">
              <div><span>原因代码</span><strong class="console-mono">{{ auditDetail.reasonCode || auditDetail.detail || '—' }}</strong></div>
              <div><span>Request ID</span><strong class="console-mono">{{ auditDetail.requestId || '—' }}</strong></div>
              <div><span>Trace ID</span><strong class="console-mono">{{ auditDetail.traceId || '—' }}</strong></div>
              <div><span>Correlation ID</span><strong class="console-mono">{{ auditDetail.correlationId || '—' }}</strong></div>
            </div></section>
          </div>
          <section class="audit-detail-section"><h3>事件说明</h3><p>{{ auditDetail.summary || '无附加说明。' }}</p><small v-if="auditDetail.reasonCode || auditDetail.detail">原因代码：{{ auditDetail.reasonCode || auditDetail.detail }}</small></section>
          <section class="audit-detail-section"><h3>关联事件</h3><p class="audit-link-row">
            <button v-if="auditDetail.requestId" class="console-button ghost" type="button" @click="filterRelatedAudit('requestId', auditDetail.requestId)">同一请求（{{ auditDetail.requestId }}）</button>
            <button v-if="auditDetail.correlationId" class="console-button ghost" type="button" @click="filterRelatedAudit('correlationId', auditDetail.correlationId)">同一业务关联（{{ auditDetail.correlationId }}）</button>
            <span v-if="!auditDetail.requestId && !auditDetail.correlationId">该事件没有可追溯的关联 ID。</span>
          </p><small>关联检索沿用当前列表过滤条件，不会绕过租户与应用权限。</small></section>
          <section class="audit-detail-section"><h3>数据变更摘要</h3><p>{{ auditDetail.changeSummary || '无字段变更。' }}</p><small>字段变更保存在当前审计事件中，敏感值按脱敏和最小化原则展示。</small></section>
          <footer><button class="console-button ghost" type="button" @click="closeAuditDetail">关闭</button></footer>
        </section>
      </div>

      <EmployeeOnboardingModal
        v-if="showEmployeeOnboarding"
        :organizations="onboardingOrganizations"
        :positions="onboardingPositions"
        :applications="applications"
        :references-loading="onboardingReferencesLoading"
        :references-error="onboardingReferencesError"
        :on-before-open="() => loadOnboardingReferences()"
        @close="closeEmployeeOnboarding"
        @completed="handleEmployeeOnboardingCompleted"
        @refresh-prerequisites="refreshOnboardingReferences"
        @retry-references="loadOnboardingReferences"
        @toast="showToast"
      />
      <Teleport to="body">
        <Transition name="console-toast">
          <div v-if="toastMessage" class="console-toast" role="status" aria-live="polite" aria-atomic="true"><ConsoleIcon name="info" /><span>{{ toastMessage }}</span></div>
        </Transition>
      </Teleport>
    </template>
  </AppShell>
</template>
