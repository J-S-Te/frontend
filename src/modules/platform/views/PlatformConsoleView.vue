<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, logoutCurrentSession } from '@/modules/platform/auth/api/auth'
import IamSettingsModule from '@/modules/platform/iam/components/IamSettingsModule.vue'
import PersonnelChangeCenter from '@/modules/platform/iam/components/PersonnelChangeCenter.vue'
import PublicAccessSettingsModule from '@/modules/platform/settings/components/PublicAccessSettingsModule.vue'
import EmployeeOnboardingModal from '@/modules/platform/iam/components/EmployeeOnboardingModal.vue'
import NotificationCenterModule from '@/modules/platform/notifications/components/NotificationCenterModule.vue'
import LoginSecurityModule from '@/modules/platform/security/components/LoginSecurityModule.vue'
import DictionaryManagementModule from '@/modules/platform/dictionaries/components/DictionaryManagementModule.vue'
import SubsystemOnboardingModule from '@/modules/platform/applications/components/SubsystemOnboardingModule.vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  listApplications,
  listEnvironments,
} from '@/modules/platform/applications/api/applications'
import { listOrgUnits, listPositions } from '@/modules/platform/iam/api/iam'
import { loadAllCatalogPages } from '@/modules/platform/iam/utils/paginatedCatalog'
import {
  AuditEventsError,
  listAuditEvents,
  createAuditExportJob,
} from '@/modules/platform/audit/api/auditEvents'
import {
  auditActionCode,
  auditActionLabel,
  auditHttpStatusLabel,
  auditResultLabel,
  auditResultMeta,
  auditResultTone,
} from '@/modules/platform/audit/utils/auditPresentation'
import {
  PlatformSettingsError,
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
import '@/modules/platform/styles/console.css'
import '@/modules/platform/styles/settings-showcase.css'

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
const auditType = ref('')
const auditRisk = ref('')
const auditApplication = ref('')
const auditEnvironment = ref('')
const auditResult = ref('')
const auditTimeRange = ref('7d')
const auditPage = ref(1)
const auditPageSize = 20
const auditDetail = ref(null)
const auditRecords = ref([])
const auditTotal = ref(0)
const auditLoading = ref(false)
const auditError = ref('')
const auditExporting = ref(false)
const applications = ref([])
const environments = ref([])
let toastTimer = null

// 员工列表中的「新增员工」入口会打开该 modal。modal 自身需要
// organizations / positions / applications，因此这里维护一份预加载缓存；
// applications 与 audit 面板共享同一份响应，避免重复请求。
const showEmployeeOnboarding = ref(false)
const onboardingOrganizations = ref([])
const onboardingPositions = ref([])
const iamRefreshKey = ref(0)

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

const settingsTabs = [
  {
    key: 'applications', label: '应用接入', icon: 'dashboard', tone: 'cyan',
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
    description: '集中办理晋升、降职、调岗、离职和复职，并跟踪审批与权限影响。',
    capabilities: ['异动单', '权限预览', '审批轨迹', '未来生效'],
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
]

const settingsSectionKeys = new Set(settingsTabs.map((tab) => tab.key))
// 当前账号对各 tab 都有权限的可见集合 + "一个都看不到"的判断。
// 没有权限的 tab 不会渲染按钮，且 lastSettingsSection 不会落到无权限 tab 上。
const visibleSettingsTabs = computed(() => settingsTabs.filter((tab) => hasAnyPermission(tab.permissions)))
const hasNoVisibleSettingsTab = computed(() => visibleSettingsTabs.value.length === 0)
const canOpenSettings = computed(() => visibleSettingsTabs.value.length > 0)
const hasAnySettingsOrAuditPermission = computed(() => canOpenSettings.value || canViewAudit.value)
const lastSettingsSection = ref('iam')
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

const activeSettingsMeta = computed(() => {
  const found = settingsTabs.find((tab) => tab.key === activeSettingsTab.value)
  if (found) return found
  // 兜底：可见 tab 里第一个；完全没有可见 tab 时返回 null（template v-if 拦截）。
  return visibleSettingsTabs.value[0] || null
})

// 前后端 result / risk 枚举到中文标签的映射，与后端 audit/application 层枚举保持一致。
const RESULT_LABELS = { SUCCESS: '成功', FAILURE: '失败', DENIED: '拒绝' }
const RISK_LABELS = { CRITICAL: '严重', HIGH: '高', MEDIUM: '中', LOW: '低' }
// 下拉框展示中文标签，提交给后端的是稳定的机器可读分类值，不能把中文标签当作 action 精确值查询。
const AUDIT_TYPE_OPTIONS = [
  { label: '登录', value: 'LOGIN' },
  { label: '新增', value: 'CREATE' },
  { label: '修改', value: 'UPDATE' },
  { label: '删除', value: 'DELETE' },
  { label: '授权变更', value: 'AUTHORIZATION_CHANGE' },
  { label: '凭据轮换', value: 'SECRET_ROTATION' },
  { label: '密码重置', value: 'PASSWORD_RESET' },
  { label: '目录同步', value: 'CATALOG_SYNC' },
  { label: '审计访问', value: 'AUDIT_ACCESS' },
  { label: '导入', value: 'IMPORT' },
  { label: '导出', value: 'EXPORT' },
  { label: '状态变更', value: 'STATUS_CHANGE' },
]
const AUDIT_RESULT_OPTIONS = Object.values(RESULT_LABELS)
const AUDIT_RISK_OPTIONS = Object.values(RISK_LABELS)

function auditResultValue(label) {
  return Object.entries(RESULT_LABELS).find(([, value]) => value === label)?.[0] || ''
}
function auditRiskValue(label) {
  return Object.entries(RISK_LABELS).find(([, value]) => value === label)?.[0] || ''
}

function rangeBounds(range) {
  const now = new Date()
  const ms = { '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 }[range] || 0
  if (!ms) return { from: '', to: '' }
  const from = new Date(now.getTime() - ms)
  return { from: from.toISOString(), to: now.toISOString() }
}

function formatAuditTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

const filteredAuditRecords = computed(() => auditRecords.value)

const auditTotalPages = computed(() => Math.max(1, Math.ceil(auditTotal.value / auditPageSize)))
// 审计接口已经按 page/page_size 返回当前页数据，前端不能再次按照全局页码切片，
// 否则从第二页开始会把后端返回的当前页记录全部过滤掉。
const pagedAuditRecords = computed(() => filteredAuditRecords.value)

const viewMeta = computed(() => {
  if (currentView.value === 'audit') {
    return { title: '审计日志', crumb: '审计日志', description: 'AUD-001 · 审计事件、数据变更摘要与跨链路追溯' }
  }
  if (activeSettingsTab.value === 'iam') {
    return { title: '系统设置', crumb: '系统设置', description: 'SYS-002 ~ SYS-004 · 身份、组织、角色与权限集中配置' }
  }
  if (activeSettingsTab.value === 'security') {
    return { title: '系统设置', crumb: '系统设置', description: '登录策略、账户锁定与会话超时集中配置' }
  }
  return { title: '系统设置', crumb: '系统设置', description: 'SYS-001 · 平台级参数、通知与安全策略集中配置' }
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

function showToast(message) {
  toastMessage.value = message
  if (toastTimer) {
    window.clearTimeout(toastTimer)
  }
  toastTimer = window.setTimeout(() => {
    toastMessage.value = ''
  }, 2600)
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
    settingsError.value = error instanceof PlatformSettingsError ? error.message : '读取平台设置失败。'
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
    settingsError.value = error instanceof PlatformSettingsError ? error.message : '保存平台设置失败。'
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
    return
  }
  try {
    const data = await listApplications({ page: 1, pageSize: 100, status: 'ACTIVE' })
    applications.value = data.items || []
  } catch (error) {
    applications.value = []
    if (error && error.code !== 'NETWORK_ERROR') {
      showToast(error.message || '读取应用列表失败。')
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

// 「新增员工」入口的预加载逻辑：先并发拉取组织 / 岗位 / 应用，缓存到本地。
// 失败时仍允许打开 modal —— modal 自己的前置检查会处理缺失项的快速补齐。
async function loadOnboardingReferences() {
  if (!hasPermission(IAM_PERMISSIONS.userCreate)) return
  const tasks = []
  if (!onboardingOrganizations.value.length) {
    tasks.push(
      loadAllCatalogPages(
        listOrgUnits,
        { pageSize: 100, status: 'ACTIVE' },
        (item) => item?.org_unit_id || item?.id,
      )
        .then((items) => { onboardingOrganizations.value = items })
        .catch((error) => { console.error('loadOnboardingReferences: listOrgUnits failed', error) }),
    )
  }
  if (!onboardingPositions.value.length) {
    tasks.push(
      loadAllCatalogPages(
        listPositions,
        { pageSize: 100, status: 'ACTIVE' },
        (item) => item?.position_id || item?.id,
      )
        .then((items) => { onboardingPositions.value = items })
        .catch((error) => { console.error('loadOnboardingReferences: listPositions failed', error) }),
    )
  }
  if (!applications.value.length) {
    tasks.push(loadApplications())
  }
  if (tasks.length) await Promise.all(tasks)
}

async function openEmployeeOnboarding() {
  if (!hasPermission(IAM_PERMISSIONS.userCreate)) return
  // 先触发预加载再开 modal —— 前置检查组件依赖这些 prop 的实时长度。
  await loadOnboardingReferences()
  showEmployeeOnboarding.value = true
}

function closeEmployeeOnboarding() {
  showEmployeeOnboarding.value = false
}

async function refreshOnboardingReferences() {
  // 前置检查"快速补齐"成功后会被 modal 回调，重新拉一次确保 wizard 表单拿到最新值。
  onboardingOrganizations.value = []
  onboardingPositions.value = []
  await loadOnboardingReferences()
}

function handleEmployeeOnboardingCompleted() {
  // 新增员工成功后刷新缓存，让下一次打开 modal 时看到刚建好的组织 / 岗位。
  // IAM 列表组件与员工 modal 是兄弟组件，递增 key 让用户、账号、任职关系
  // 及顶部统计在当前页面立即重新读取，而不必整页刷新。
  iamRefreshKey.value += 1
  loadOnboardingReferences().catch(() => {})
}

async function loadAuditEvents() {
  if (currentView.value !== 'audit' || !canViewAudit.value) return
  auditLoading.value = true
  auditError.value = ''
  try {
    const bounds = rangeBounds(auditTimeRange.value)
    const data = await listAuditEvents({
      page: auditPage.value,
      pageSize: auditPageSize,
      keyword: auditKeyword.value.trim(),
      applicationCode: auditApplication.value,
      environmentCode: auditEnvironment.value,
      actionCategory: auditType.value,
      result: auditResultValue(auditResult.value),
      riskLevel: auditRiskValue(auditRisk.value),
      occurredFrom: bounds.from,
      occurredTo: bounds.to,
    })
    auditRecords.value = data.items
    auditTotal.value = data.total
    if (auditPage.value > auditTotalPages.value) {
      auditPage.value = auditTotalPages.value
      await loadAuditEvents()
    }
  } catch (error) {
    auditError.value = error instanceof AuditEventsError ? error.message : '读取审计事件失败。'
    auditRecords.value = []
    auditTotal.value = 0
  } finally {
    auditLoading.value = false
  }
}

function resetAuditFilters() {
  auditKeyword.value = ''
  auditType.value = ''
  auditRisk.value = ''
  auditApplication.value = ''
  auditEnvironment.value = ''
  auditResult.value = ''
  auditTimeRange.value = '7d'
  auditPage.value = 1
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

function openAuditDetail(record) {
  auditDetail.value = record
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
    const status = job?.status || '已接收'
    showToast(`导出任务已提交（${status}），请稍后在“文件与任务”中查看结果。`)
  } catch (error) {
    showToast(error.message || '提交导出任务失败。')
  } finally {
    auditExporting.value = false
  }
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
    showToast(error.message || '退出登录失败，请稍后重试。')
  } finally {
    isLoggingOut.value = false
  }
}

watch(currentView, (view) => {
  if (view === 'audit' && canViewAudit.value) {
    if (canReadApplications.value && !applications.value.length) loadApplications()
    loadAuditEvents()
  }
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
  }
})

onMounted(async () => {
  // 拉取 principal，让 IAM 操作按钮的权限判断立即生效；后端仍执行最终鉴权。
  await refreshPrincipal().catch(() => null)
  if (canReadApplications.value) loadApplications()
  if (canReadPlatformSettings.value) loadPlatformSettings()
  // 只有具备新增员工权限时才预热创建流程所需目录。
  if (hasPermission(IAM_PERMISSIONS.userCreate)) loadOnboardingReferences().catch(() => {})
})

onBeforeUnmount(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer)
  }
})
</script>

<template>
  <div class="console-page">
    <aside class="console-sidebar" :class="{ open: mobileMenuOpen }">
      <div class="console-brand">
        <span class="console-brand-mark"><ConsoleIcon name="logo" /></span>
        <span class="console-brand-copy">
          <strong>基础能力平台</strong>
          <small>Basic Platform</small>
        </span>
        <button class="console-close-menu" type="button" aria-label="关闭导航菜单" @click="mobileMenuOpen = false">
          <ConsoleIcon name="close" />
        </button>
      </div>

      <nav class="console-nav" aria-label="平台导航">
        <button class="console-nav-item console-nav-item--portal" type="button" @click="goToPortal">
          <ConsoleIcon name="dashboard" />
          <span>返回子系统门户</span>
        </button>
        <p class="console-nav-label">系统管理</p>
        <button
          v-if="canOpenSettings"
          class="console-nav-item"
          :class="{ active: currentView === 'settings' }"
          type="button"
          @click="navigate('settings')"
        >
          <ConsoleIcon name="settings" />
          <span>系统设置</span>
        </button>
        <button
          v-if="canViewAudit"
          class="console-nav-item"
          :class="{ active: currentView === 'audit' }"
          type="button"
          @click="navigate('audit')"
        >
          <ConsoleIcon name="audit" />
          <span>审计日志</span>
          <span class="console-nav-note">只读</span>
        </button>
        <p v-if="!hasAnySettingsOrAuditPermission" class="console-nav-empty">
          当前账号未配置系统管理模块的访问权限。
        </p>
      </nav>

      <div class="console-sidebar-note">
        <ConsoleIcon name="info" />
        <span>本期仅开放系统设置与审计日志。</span>
      </div>

      <div class="console-sidebar-user">
        <span class="console-avatar" aria-hidden="true">{{ currentAccountAvatar }}</span>
        <span class="console-user-copy">
          <strong :title="currentAccountName">{{ currentAccountName }}</strong>
          <small :title="currentRoleNames">{{ currentRoleNames }}</small>
        </span>
        <button class="console-logout" type="button" :disabled="isLoggingOut" aria-label="退出应用系统" @click="logout"><ConsoleIcon name="logout" /></button>
      </div>
    </aside>

    <main class="console-main">
      <header class="console-topbar">
        <button class="console-menu-button" type="button" aria-label="打开导航菜单" @click="mobileMenuOpen = true"><ConsoleIcon name="menu" /></button>
        <div class="console-crumb"><span>基础能力平台</span><ConsoleIcon name="chevron" /><strong>{{ viewMeta.crumb }}</strong></div>
        <div class="console-topbar-actions">
          <button class="console-icon-button" type="button" aria-label="通知" @click="showToast('暂无新的平台通知。')"><ConsoleIcon name="bell" /><i></i></button>
          <span class="console-topbar-avatar">{{ currentAccountAvatar }}</span>
        </div>
      </header>

      <section class="console-content">
        <div class="console-page-head">
          <div>
            <h1>{{ viewMeta.title }}</h1>
            <span v-if="currentView === 'settings' && activeSettingsTab === 'base'" class="console-requirement-chip">{{ viewMeta.description }}</span>
            <p v-else-if="viewMeta.description">{{ viewMeta.description }}</p>
            <span v-if="currentView === 'audit'" class="console-requirement-chip">AUD-001 · 统一审计查询</span>
          </div>
          <button v-if="currentView === 'audit' && canExportAudit" class="console-button secondary" type="button" @click="exportAuditRecords"><ConsoleIcon name="export" />导出日志</button>
        </div>

        <section v-if="currentView === 'audit' && canViewAudit" class="audit-view" aria-label="审计日志列表">
          <div class="audit-readonly-note"><ConsoleIcon name="info" /><span>审计事件与运行日志分离存储；本页用于查询 <code>audit_event</code> 及其变更摘要，运行日志、Trace、Metric 与告警请在“安全与可观测”中查看。</span></div>
          <div class="console-filter-bar audit-filter-bar">
            <label class="console-search-field">
              <ConsoleIcon name="search" />
              <input v-model="auditKeyword" type="search" placeholder="操作人 / 操作 / 资源 / 请求路径 / Request ID / Trace ID…" />
            </label>
            <label class="console-select-field"><select v-model="auditApplication" aria-label="应用"><option value="">全部应用</option><option v-for="app in applications" :key="app.application_id" :value="app.code">{{ app.name || app.code }}</option></select></label>
            <label class="console-select-field"><select v-model="auditEnvironment" :disabled="!auditApplication" aria-label="环境"><option value="">全部环境</option><option v-for="env in environments" :key="env.environment_id" :value="env.environment_code || env.environment">{{ env.environment_code || env.environment }}</option></select></label>
            <label class="console-select-field"><select v-model="auditType" aria-label="操作类型"><option value="">全部操作</option><option v-for="option in AUDIT_TYPE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
            <label class="console-select-field"><select v-model="auditRisk" aria-label="风险等级"><option value="">全部风险</option><option v-for="option in AUDIT_RISK_OPTIONS" :key="option" :value="option">{{ option }}</option></select></label>
            <label class="console-select-field"><select v-model="auditResult" aria-label="操作结果"><option value="">全部结果</option><option v-for="option in AUDIT_RESULT_OPTIONS" :key="option" :value="option">{{ option }}</option></select></label>
            <label class="console-select-field"><select v-model="auditTimeRange" aria-label="时间范围"><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option></select></label>
            <button class="console-button primary small" type="button" :disabled="auditLoading" @click="applyAuditFilters">查询</button>
            <button class="console-button ghost small" type="button" :disabled="auditLoading" @click="resetAuditFilters"><ConsoleIcon name="reset" />重置</button>
          </div>

          <p v-if="auditError" class="login-target-module__error" role="alert">{{ auditError }}</p>

          <div class="audit-batch-bar">
            <span>审计事件为只读记录，不支持页面直接删除或归档。</span>
            <div><button v-if="canExportAudit" class="console-button secondary small" type="button" :disabled="auditExporting" @click="exportAuditRecords"><ConsoleIcon name="export" />导出筛选结果</button></div>
          </div>

          <div class="console-table-card audit-table-card">
            <div class="console-table-scroll">
              <table class="console-data-table audit-data-table">
                <thead><tr><th>发生时间</th><th>操作人</th><th>操作</th><th>应用 / 环境</th><th>资源对象</th><th>方法 / 路径</th><th>客户端 IP</th><th>状态</th><th>风险</th><th class="console-actions-cell">操作</th></tr></thead>
                <tbody>
                  <tr v-if="auditLoading">
                    <td colspan="10" class="login-target-module__state">正在读取审计事件…</td>
                  </tr>
                  <tr v-else-if="!pagedAuditRecords.length">
                    <td colspan="10" class="login-target-module__state">未找到符合筛选条件的审计事件。</td>
                  </tr>
                  <tr v-for="record in pagedAuditRecords" :key="record.id">
                    <td class="console-mono" data-label="发生时间">{{ formatAuditTime(record.time) }}</td>
                    <td data-label="操作人"><strong class="console-entity-name">{{ record.operator || '—' }}</strong></td>
                    <td data-label="操作"><span class="console-badge audit-action-badge" :class="`type-${auditActionLabel(record)}`">{{ auditActionLabel(record) }}</span><span v-if="auditActionCode(record)" class="console-entity-meta console-mono">{{ auditActionCode(record) }}</span></td>
                    <td data-label="应用 / 环境"><strong>{{ record.application || '—' }}</strong><span class="console-entity-meta">{{ record.environment || '—' }}</span></td>
                    <td data-label="资源对象"><strong>{{ record.object || record.resource || '—' }}</strong><span class="console-entity-meta">{{ record.resource }}</span></td>
                    <td data-label="方法 / 路径"><span class="audit-method">{{ record.method || '—' }}</span><span class="console-entity-meta console-mono">{{ record.path || '—' }}</span></td>
                    <td class="console-mono" data-label="客户端 IP">{{ record.ip || '—' }}</td>
                    <td data-label="状态"><span class="console-badge audit-result-badge" :class="auditResultTone(record.result)">{{ auditResultLabel(record) }}</span><span v-if="auditHttpStatusLabel(record.statusCode)" class="console-entity-meta audit-status-code">{{ auditHttpStatusLabel(record.statusCode) }}</span></td>
                    <td data-label="风险"><span class="console-badge" :class="`risk-${record.risk}`">{{ record.riskLabel || record.risk || '—' }}</span></td>
                    <td class="console-actions-cell" data-label="操作"><button class="console-text-button" type="button" @click="openAuditDetail(record)">详情</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <footer class="console-table-footer audit-table-footer"><span>第 {{ auditPage }} / {{ auditTotalPages }} 页 · 共 {{ auditTotal }} 条 · 审计事件为只读记录</span><div class="audit-pagination"><button class="console-text-button" type="button" :disabled="auditPage === 1 || auditLoading" @click="changeAuditPage(auditPage - 1)">上一页</button><span class="console-page-token">{{ auditPage }} / {{ auditTotalPages }}</span><button class="console-text-button" type="button" :disabled="auditPage === auditTotalPages || auditLoading" @click="changeAuditPage(auditPage + 1)">下一页</button></div></footer>
          </div>

        </section>

        <section v-else-if="currentView === 'settings' && canOpenSettings" class="settings-view" aria-label="系统设置">
          <header class="settings-showcase-head">
            <div>
              <span class="settings-showcase-kicker"><ConsoleIcon name="settings" />平台配置中心</span>
              <h2>系统设置</h2>
              <p>集中维护平台基础资料、身份组织、统一登录、安全策略与运行支撑能力。</p>
            </div>
          </header>

          <nav v-if="!hasNoVisibleSettingsTab" class="settings-tab-bar" role="tablist" aria-label="系统设置分类">
            <button
              v-for="tab in visibleSettingsTabs"
              :key="tab.key"
              class="settings-tab"
              :class="{ active: activeSettingsTab === tab.key }"
              type="button"
              role="tab"
              :aria-selected="activeSettingsTab === tab.key"
              :title="tab.description"
              @click="activeSettingsTab = tab.key"
            >
              <ConsoleIcon :name="tab.icon" />
              <span>{{ tab.label }}</span>
            </button>
          </nav>
          <div v-else class="settings-empty" role="status">
            <span class="settings-empty-icon" aria-hidden="true"><ConsoleIcon name="shield" /></span>
            <h3>当前账号没有可访问的设置模块</h3>
            <p>请联系平台管理员授予对应模块的读取或管理权限；IAM 不要求额外授予 <code>platform:user:read</code>。</p>
          </div>

          <div v-if="!hasNoVisibleSettingsTab && activeSettingsMeta" class="settings-active-summary" :class="activeSettingsMeta.tone">
            <span class="settings-active-summary-icon"><ConsoleIcon :name="activeSettingsMeta.icon" /></span>
            <div class="settings-active-summary-copy">
              <strong>{{ activeSettingsMeta.label }}</strong>
              <p>{{ activeSettingsMeta.description }}</p>
            </div>
            <div class="settings-active-capabilities" aria-label="当前模块功能">
              <span v-for="capability in activeSettingsMeta.capabilities" :key="capability">{{ capability }}</span>
            </div>
          </div>

          <div v-if="!hasNoVisibleSettingsTab && activeSettingsTab === 'base'" class="console-card settings-card">
            <div class="console-card-body">
              <h2>平台基础信息</h2>
              <p class="console-card-hint">用于定义基础能力平台的展示名称。</p>
              <p v-if="settingsLoading" class="console-card-hint">正在读取平台设置…</p>
              <p v-else-if="settingsError" class="login-target-module__error" role="alert">{{ settingsError }}</p>
              <div v-if="canReadPlatformSettings" class="console-form-grid">
                <label class="console-form-item"><span>平台名称</span><input v-model="settings.organizationName" :disabled="settingsLoading || !canUpdatePlatformSettings" /></label>
                <label class="console-form-item"><span>平台简称</span><input v-model="settings.organizationAlias" :disabled="settingsLoading || !canUpdatePlatformSettings" /></label>
              </div>
              <div v-if="canReadPlatformSettings" class="console-form-actions"><button v-if="canUpdatePlatformSettings" class="console-button primary" type="button" :disabled="settingsSaving" @click="saveSettings"><ConsoleIcon name="save" />{{ settingsSaving ? '保存中…' : '保存设置' }}</button><button class="console-button ghost" type="button" :disabled="settingsLoading" @click="resetSettings">重新读取</button></div>
            </div>
          </div>

          <PublicAccessSettingsModule v-else-if="!hasNoVisibleSettingsTab && activeSettingsTab === 'access'" @toast="showToast" />

          <IamSettingsModule v-else-if="!hasNoVisibleSettingsTab && activeSettingsTab === 'iam'" :refresh-key="iamRefreshKey" @toast="showToast" @employee-onboarding="openEmployeeOnboarding" />

          <PersonnelChangeCenter v-else-if="!hasNoVisibleSettingsTab && activeSettingsTab === 'personnel'" @toast="showToast" @employee-onboarding="openEmployeeOnboarding" />

          <NotificationCenterModule v-else-if="!hasNoVisibleSettingsTab && activeSettingsTab === 'notify'" @toast="showToast" />

          <LoginSecurityModule v-else-if="!hasNoVisibleSettingsTab && activeSettingsTab === 'security'" @toast="showToast" />


          <DictionaryManagementModule v-else-if="!hasNoVisibleSettingsTab && activeSettingsTab === 'dict'" @toast="showToast" />

          <SubsystemOnboardingModule
            v-else-if="!hasNoVisibleSettingsTab && activeSettingsTab === 'applications'"
            :can-onboard="canOnboardSubsystem"
            @toast="showToast"
            @completed="loadApplications"
          />
        </section>
      </section>
    </main>

    <div v-if="auditDetail" class="console-modal-backdrop" role="presentation" @click.self="closeAuditDetail">
      <section class="console-detail-modal audit-detail-modal" role="dialog" aria-modal="true" aria-label="审计事件详情">
        <header><div><p class="console-modal-eyebrow">AUDIT EVENT · {{ auditDetail.id }}</p><h2>{{ auditDetail.object || auditDetail.resource || '审计事件' }}</h2></div><button class="console-modal-close" type="button" aria-label="关闭审计事件详情" @click="closeAuditDetail"><ConsoleIcon name="close" /></button></header>
        <div class="audit-detail-grid">
          <div><span>发生时间</span><strong>{{ formatAuditTime(auditDetail.time) }}</strong></div>
          <div><span>操作人</span><strong>{{ auditDetail.operator || '—' }}</strong></div>
          <div><span>应用 / 环境</span><strong>{{ auditDetail.application || '—' }} / {{ auditDetail.environment || '—' }}</strong></div>
          <div><span>操作结果</span><strong class="audit-detail-result-wrap"><span class="console-badge audit-result-badge" :class="auditResultTone(auditDetail.result)">{{ auditResultLabel(auditDetail) }}</span><small v-if="auditResultMeta(auditDetail)">{{ auditResultMeta(auditDetail) }}</small></strong></div>
          <div><span>HTTP 请求</span><strong>{{ auditDetail.method || '—' }} {{ auditDetail.path || '—' }}</strong></div>
          <div><span>客户端</span><strong>{{ auditDetail.ip || '—' }}</strong></div>
          <div><span>Request ID</span><strong class="console-mono">{{ auditDetail.requestId || '—' }}</strong></div>
          <div><span>Trace ID</span><strong class="console-mono">{{ auditDetail.traceId || '—' }}</strong></div>
          <div><span>Correlation ID</span><strong class="console-mono">{{ auditDetail.correlationId || '—' }}</strong></div>
          <div><span>User Agent</span><strong>{{ auditDetail.userAgent || '—' }}</strong></div>
        </div>
        <section class="audit-detail-section"><h3>事件说明</h3><p>{{ auditDetail.summary || '无附加说明。' }}</p><small v-if="auditDetail.detail">原因代码：{{ auditDetail.detail }}</small></section>
        <section class="audit-detail-section"><h3>数据变更摘要</h3><p>{{ auditDetail.changeSummary || '无字段变更。' }}</p><small>字段变更保存在当前审计事件中，敏感值按脱敏和最小化原则展示。</small></section>
        <footer><button class="console-button ghost" type="button" @click="closeAuditDetail">关闭</button></footer>
      </section>
    </div>

    <EmployeeOnboardingModal
      v-if="showEmployeeOnboarding"
      :organizations="onboardingOrganizations"
      :positions="onboardingPositions"
      :applications="applications"
      :on-before-open="() => loadOnboardingReferences()"
      @close="closeEmployeeOnboarding"
      @completed="handleEmployeeOnboardingCompleted"
      @refresh-prerequisites="refreshOnboardingReferences"
      @toast="showToast"
    />

    <button v-if="mobileMenuOpen" class="console-menu-mask" type="button" aria-label="关闭导航遮罩" @click="mobileMenuOpen = false"></button>
    <div v-if="toastMessage" class="console-toast" role="status"><ConsoleIcon name="info" /><span>{{ toastMessage }}</span></div>
  </div>
</template>
