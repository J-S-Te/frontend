<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, logoutCurrentSession } from '@/modules/platform/auth/api/auth'
import FileTaskOperationsModule from '@/modules/platform/files/components/FileTaskOperationsModule.vue'
import IamSettingsModule from '@/modules/platform/iam/components/IamSettingsModule.vue'
import ApplicationLoginTargetModule from '@/modules/platform/login-targets/components/ApplicationLoginTargetModule.vue'
import NotificationCenterModule from '@/modules/platform/notifications/components/NotificationCenterModule.vue'
import LoginSecurityModule from '@/modules/platform/security/components/LoginSecurityModule.vue'
import DictionaryManagementModule from '@/modules/platform/dictionaries/components/DictionaryManagementModule.vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  ApplicationRegistryError,
  listApplications,
  listEnvironments,
  onboardSubsystem,
} from '@/modules/platform/applications/api/applications'
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
import '@/modules/platform/styles/console.css'
import '@/modules/platform/styles/settings-showcase.css'

const route = useRoute()
const router = useRouter()
const settings = reactive({ organizationName: '', organizationAlias: '', timezone: '', qualification: '', version: 0 })
const settingsLoading = ref(false)
const settingsError = ref('')
const settingsSaving = ref(false)
const currentView = computed(() => (route.name === 'audit' ? 'audit' : 'settings'))
const loginTargetBoundary = reactive({ applicationId: '', environmentId: '', applicationName: '', environmentName: '', baseURL: '', upstreamURL: '', pathPrefix: '' })
const subsystemEditor = reactive({
  code: '',
  name: '',
  environment: 'prod',
  baseURL: typeof window === 'undefined' ? '' : window.location.origin,
  upstreamURL: '',
  pathPrefix: '',
  clientType: 'confidential',
})
const subsystemSaving = ref(false)
const subsystemError = ref('')
const loginTargetEnvironments = ref([])
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
const auditPageSize = 5
const selectedAuditIds = ref([])
const auditDetail = ref(null)
const auditRecords = ref([])
const auditTotal = ref(0)
const auditLoading = ref(false)
const auditError = ref('')
const auditExporting = ref(false)
const applications = ref([])
const environments = ref([])
let toastTimer = null

const settingsTabs = [
  {
    key: 'base', label: '平台基础信息', icon: 'settings', tone: 'blue',
    description: '维护平台名称与基础展示信息。',
    capabilities: ['平台名称', '平台简称'],
  },
  {
    key: 'iam', label: '身份、组织与授权', icon: 'organization', tone: 'violet',
    description: '集中管理身份目录、组织架构与访问权限。',
    capabilities: ['新增组织单元', '新增岗位', '新增任职关系', '新增外部身份绑定', '新增角色', '新增角色绑定', '新增权限注册'],
  },
  {
    key: 'login-targets', label: '统一登录目标', icon: 'link', tone: 'cyan',
    description: '接入子系统并配置统一门户登录入口。',
    capabilities: ['子系统接入', '登录跳转', 'OAuth 客户端'],
  },
  {
    key: 'notify', label: '通知中心', icon: 'bell', tone: 'orange',
    description: '查看平台消息，并维护通知模板与投递记录。',
    capabilities: ['站内通知', '通知模板', '投递记录'],
  },
  {
    key: 'security', label: '安全设置', icon: 'shield', tone: 'red',
    description: '配置登录安全、会话超时和全局退出策略。',
    capabilities: ['登录安全', '会话策略', '超时退出'],
  },
  {
    key: 'files', label: '文件与任务', icon: 'audit', tone: 'green',
    description: '管理审计导出、文件处理和异步任务结果。',
    capabilities: ['审计导出', '文件任务', '结果下载'],
  },
  {
    key: 'dict', label: '字典管理', icon: 'dashboard', tone: 'slate',
    description: '维护审计、风险和通知等平台统一枚举。',
    capabilities: ['审计类型', '风险等级', '通知事件'],
  },
]

const settingsSectionKeys = new Set(settingsTabs.map((tab) => tab.key))
const lastSettingsSection = ref('iam')
const activeSettingsTab = computed({
  get() {
    const section = typeof route.params.section === 'string' ? route.params.section : ''
    return settingsSectionKeys.has(section) ? section : lastSettingsSection.value
  },
  set(section) {
    if (!settingsSectionKeys.has(section)) {
      return
    }
    lastSettingsSection.value = section
    if (route.name !== 'settings' || section !== route.params.section) {
      router.push({ name: 'settings', params: { section } })
    }
  },
})

const activeSettingsMeta = computed(() => (
  settingsTabs.find((tab) => tab.key === activeSettingsTab.value) || settingsTabs[0]
))

// 前后端 result / risk 枚举到中文标签的映射，与后端 audit/application 层枚举保持一致。
const RESULT_LABELS = { SUCCESS: '成功', DENIED: '拒绝', ERROR: '异常', PARTIAL: '部分成功' }
const RISK_LABELS = { HIGH: '高', MEDIUM: '中', LOW: '低' }
// 下拉框展示中文标签，提交给后端的是稳定的机器可读分类值，不能把中文标签当作 action 精确值查询。
const AUDIT_TYPE_OPTIONS = [
  { label: '登录', value: 'LOGIN' },
  { label: '新增', value: 'CREATE' },
  { label: '修改', value: 'UPDATE' },
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
const allPageAuditSelected = computed(() => pagedAuditRecords.value.length > 0 && pagedAuditRecords.value.every((record) => selectedAuditIds.value.includes(record.id)))

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
  if (settingsSaving.value) return
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
  // 重新拉一次服务端真值，避免清成前端硬编码的占位字符串。
  loadPlatformSettings()
  showToast('已重新读取平台基础设置。')
}

async function loadApplications() {
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

async function loadLoginTargetEnvironments(applicationID) {
  if (!applicationID) {
    loginTargetEnvironments.value = []
    loginTargetBoundary.environmentId = ''
    loginTargetBoundary.applicationName = ''
    loginTargetBoundary.environmentName = ''
    loginTargetBoundary.baseURL = ''
    loginTargetBoundary.upstreamURL = ''
    loginTargetBoundary.pathPrefix = ''
    return
  }
  try {
    const data = await listEnvironments({ applicationId: applicationID, page: 1, pageSize: 50, status: 'ACTIVE' })
    loginTargetEnvironments.value = data.items || []
    if (!loginTargetEnvironments.value.some((env) => env.environment_id === loginTargetBoundary.environmentId)) {
      loginTargetBoundary.environmentId = ''
      loginTargetBoundary.environmentName = ''
      loginTargetBoundary.baseURL = ''
      loginTargetBoundary.upstreamURL = ''
      loginTargetBoundary.pathPrefix = ''
    }
  } catch (error) {
    loginTargetEnvironments.value = []
  }
}

watch(() => loginTargetBoundary.applicationId, (value) => {
  const app = applications.value.find((item) => item.application_id === value)
  loginTargetBoundary.applicationName = app?.name || app?.code || ''
  loadLoginTargetEnvironments(value)
})

watch(() => loginTargetBoundary.environmentId, (value) => {
  if (!value) {
    loginTargetBoundary.environmentName = ''
    loginTargetBoundary.baseURL = ''
    loginTargetBoundary.upstreamURL = ''
    loginTargetBoundary.pathPrefix = ''
    return
  }
  const env = loginTargetEnvironments.value.find((item) => item.environment_id === value)
  loginTargetBoundary.environmentName = env?.environment || ''
  loginTargetBoundary.baseURL = env?.base_url || ''
  loginTargetBoundary.upstreamURL = env?.upstream_url || ''
  loginTargetBoundary.pathPrefix = env?.path_prefix || ''
})

function validateSubsystemEditor() {
  const code = subsystemEditor.code.trim().toLowerCase()
  const name = subsystemEditor.name.trim()
  const baseURL = subsystemEditor.baseURL.trim().replace(/\/+$/, '')
  const upstreamURL = subsystemEditor.upstreamURL.trim().replace(/\/+$/, '')
  const pathPrefix = subsystemEditor.pathPrefix.trim().replace(/\/+$/, '')

  if (!code || !name || !baseURL || !upstreamURL) {
    throw new ApplicationRegistryError('子系统编码、名称、门户 BaseURL 和内部 UpstreamURL 均不能为空。', { code: 'VALIDATION_ERROR' })
  }
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(code)) {
    throw new ApplicationRegistryError('子系统编码需为 1-64 位，并以小写字母开头；其余可使用小写字母、数字、点、下划线或连字符。', { code: 'VALIDATION_ERROR' })
  }
  const resolvedPathPrefix = pathPrefix || `/${code}`
  if (!/^\/[A-Za-z0-9._~!+/\-]*$/.test(resolvedPathPrefix) || resolvedPathPrefix === '/' || resolvedPathPrefix.includes('//') || resolvedPathPrefix.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new ApplicationRegistryError('路径前缀必须是类似 /business-app 的门户绝对路径，只能使用字母、数字、/、点、下划线、~、!、+、-，且不能包含重复斜杠或点路径段。', { code: 'VALIDATION_ERROR' })
  }
  const upstreamMatch = upstreamURL.match(/^https?:\/\/(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._~-]+)(?::([0-9]{1,5}))?(?:\/[A-Za-z0-9._~!%+/@-]*)?$/)
  if (!upstreamMatch || (upstreamMatch[1] && (Number(upstreamMatch[1]) < 1 || Number(upstreamMatch[1]) > 65535))) {
    throw new ApplicationRegistryError('内部 UpstreamURL 必须是可安全写入网关配置的 http/https 地址，例如 http://10.0.0.8:8081。', { code: 'VALIDATION_ERROR' })
  }
  for (const [label, value] of [['门户 BaseURL', baseURL], ['内部 UpstreamURL', upstreamURL]]) {
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      throw new ApplicationRegistryError(`${label} 不是有效 URL。`, { code: 'VALIDATION_ERROR' })
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new ApplicationRegistryError(`${label} 仅支持无账号、查询参数和片段的 http/https URL。`, { code: 'VALIDATION_ERROR' })
    }
  }
  return { code, name, baseURL, upstreamURL, pathPrefix: resolvedPathPrefix }
}

async function saveSubsystemConnection() {
  if (subsystemSaving.value) return
  subsystemSaving.value = true
  subsystemError.value = ''
  try {
    const normalized = validateSubsystemEditor()
    const result = await onboardSubsystem({
      applicationCode: normalized.code,
      applicationName: normalized.name,
      description: `门户路径接入：${normalized.pathPrefix}`,
      environment: subsystemEditor.environment,
      publicBaseUrl: normalized.baseURL,
      upstreamUrl: normalized.upstreamURL,
      pathPrefix: normalized.pathPrefix,
      clientType: subsystemEditor.clientType,
    })
    await loadApplications()
    loginTargetBoundary.applicationId = result.application?.application_id || ''
    await loadLoginTargetEnvironments(loginTargetBoundary.applicationId)
    loginTargetBoundary.environmentId = result.environment?.environment_id || ''
    showToast('子系统配置已自动写入并完成部署，刷新门户即可访问。')
  } catch (error) {
    subsystemError.value = error instanceof ApplicationRegistryError ? error.message : '自动接入并部署子系统失败。'
  } finally {
    subsystemSaving.value = false
  }
}


async function loadAuditEvents() {
  if (currentView.value !== 'audit') return
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
  selectedAuditIds.value = []
  loadEnvironments('')
  loadAuditEvents()
}

function applyAuditFilters() {
  auditPage.value = 1
  selectedAuditIds.value = []
  loadAuditEvents()
}

function toggleAllAuditRecords() {
  const ids = pagedAuditRecords.value.map((record) => record.id)
  if (allPageAuditSelected.value) {
    selectedAuditIds.value = selectedAuditIds.value.filter((id) => !ids.includes(id))
  } else {
    selectedAuditIds.value = [...new Set([...selectedAuditIds.value, ...ids])]
  }
}

function changeAuditPage(nextPage) {
  auditPage.value = Math.min(Math.max(nextPage, 1), auditTotalPages.value)
  selectedAuditIds.value = []
  loadAuditEvents()
}

function openAuditDetail(record) {
  auditDetail.value = record
}

function closeAuditDetail() {
  auditDetail.value = null
}

function deleteAuditRecords(ids) {
  // 后端审计事件不支持前端直接删除；统一提示走受控的归档 / 保留任务。
  selectedAuditIds.value = []
  showToast(`已选择 ${ids.length} 条事件，审计事件需通过“保留任务”归档或清理。`)
}

async function exportAuditRecords() {
  if (auditExporting.value) return
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
  if (view === 'audit') {
    if (!applications.value.length) loadApplications()
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
  if (tab === 'base' && !settings.organizationName && !settingsLoading.value) {
    loadPlatformSettings()
  }
  if (tab === 'login-targets' && !applications.value.length) {
    loadApplications()
  }
}, { immediate: true })

onMounted(() => {
  loadApplications()
  loadPlatformSettings()
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
        <p class="console-nav-label">系统管理</p>
        <button class="console-nav-item" :class="{ active: currentView === 'settings' }" type="button" @click="navigate('settings')">
          <ConsoleIcon name="settings" />
          <span>系统设置</span>
        </button>
        <button class="console-nav-item" :class="{ active: currentView === 'audit' }" type="button" @click="navigate('audit')">
          <ConsoleIcon name="audit" />
          <span>审计日志</span>
          <span class="console-nav-note">只读</span>
        </button>
      </nav>

      <div class="console-sidebar-note">
        <ConsoleIcon name="info" />
        <span>本期仅开放系统设置与审计日志。</span>
      </div>

      <div class="console-sidebar-user">
        <span class="console-avatar">管</span>
        <span class="console-user-copy"><strong>平台管理员</strong><small>系统管理员</small></span>
        <button class="console-logout" type="button" :disabled="isLoggingOut" aria-label="退出应用系统" @click="logout"><ConsoleIcon name="logout" /></button>
      </div>
    </aside>

    <main class="console-main">
      <header class="console-topbar">
        <button class="console-menu-button" type="button" aria-label="打开导航菜单" @click="mobileMenuOpen = true"><ConsoleIcon name="menu" /></button>
        <div class="console-crumb"><span>基础能力平台</span><ConsoleIcon name="chevron" /><strong>{{ viewMeta.crumb }}</strong></div>
        <div class="console-topbar-actions">
          <button class="console-icon-button" type="button" aria-label="通知" @click="showToast('暂无新的平台通知。')"><ConsoleIcon name="bell" /><i></i></button>
          <span class="console-topbar-avatar">管</span>
        </div>
      </header>

      <section class="console-content">
        <div class="console-page-head">
          <div>
            <h1>{{ viewMeta.title }}</h1>
            <p>{{ viewMeta.description }}</p>
          </div>
          <button v-if="currentView === 'audit'" class="console-button secondary" type="button" @click="exportAuditRecords"><ConsoleIcon name="export" />导出日志</button>
        </div>

        <section v-if="currentView === 'audit'" class="audit-view" aria-label="审计日志列表">
          <div class="audit-readonly-note"><ConsoleIcon name="info" /><span>审计事件与运行日志分离存储；本页用于查询 <code>audit_event</code> 及其变更摘要，运行日志、Trace、Metric 与告警请在“安全与可观测”中查看。</span></div>
          <div class="console-filter-bar audit-filter-bar">
            <label class="console-search-field">
              <ConsoleIcon name="search" />
              <input v-model="auditKeyword" type="search" placeholder="操作人 / 请求路径 / Request ID / Trace ID…" />
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
            <span>已选择 <b>{{ selectedAuditIds.length }}</b> 条事件</span>
            <div><button class="console-button ghost small" type="button" :disabled="!selectedAuditIds.length" @click="deleteAuditRecords(selectedAuditIds)">归档到保留任务</button><button class="console-button secondary small" type="button" :disabled="auditExporting" @click="exportAuditRecords"><ConsoleIcon name="export" />导出筛选结果</button></div>
          </div>

          <div class="console-table-card audit-table-card">
            <div class="console-table-scroll">
              <table class="console-data-table audit-data-table">
                <thead><tr><th class="audit-check-cell"><input type="checkbox" :checked="allPageAuditSelected" aria-label="全选当前页审计事件" @change="toggleAllAuditRecords" /></th><th>发生时间</th><th>操作人</th><th>操作</th><th>应用 / 环境</th><th>资源对象</th><th>方法 / 路径</th><th>客户端 IP</th><th>状态</th><th>风险</th><th class="console-actions-cell">操作</th></tr></thead>
                <tbody>
                  <tr v-if="auditLoading">
                    <td colspan="11" class="login-target-module__state">正在读取审计事件…</td>
                  </tr>
                  <tr v-else-if="!pagedAuditRecords.length">
                    <td colspan="11" class="login-target-module__state">未找到符合筛选条件的审计事件。</td>
                  </tr>
                  <tr v-for="record in pagedAuditRecords" :key="record.id">
                    <td class="audit-check-cell"><input v-model="selectedAuditIds" type="checkbox" :value="record.id" :aria-label="`选择 ${record.id}`" /></td>
                    <td class="console-mono" data-label="发生时间">{{ formatAuditTime(record.time) }}</td>
                    <td data-label="操作人"><strong class="console-entity-name">{{ record.operator || '—' }}</strong></td>
                    <td data-label="操作"><span class="console-badge audit-action-badge" :class="`type-${auditActionLabel(record)}`">{{ auditActionLabel(record) }}</span><span v-if="auditActionCode(record)" class="console-entity-meta console-mono">{{ auditActionCode(record) }}</span></td>
                    <td data-label="应用 / 环境"><strong>{{ record.application || '—' }}</strong><span class="console-entity-meta">{{ record.environment || '—' }}</span></td>
                    <td data-label="资源对象"><strong>{{ record.object || record.resource || '—' }}</strong><span class="console-entity-meta">{{ record.resource }}</span></td>
                    <td data-label="方法 / 路径"><span class="audit-method">{{ record.method || '—' }}</span><span class="console-entity-meta console-mono">{{ record.path || '—' }}</span></td>
                    <td class="console-mono" data-label="客户端 IP">{{ record.ip || '—' }}</td>
                    <td data-label="状态"><span class="console-badge audit-result-badge" :class="auditResultTone(record.result)">{{ auditResultLabel(record) }}</span><span v-if="auditHttpStatusLabel(record.statusCode)" class="console-entity-meta audit-status-code">{{ auditHttpStatusLabel(record.statusCode) }}</span></td>
                    <td data-label="风险"><span class="console-badge" :class="`risk-${record.risk}`">{{ record.riskLabel || record.risk || '—' }}</span></td>
                    <td class="console-actions-cell" data-label="操作"><button class="console-text-button" type="button" @click="openAuditDetail(record)">详情</button><button class="console-text-button danger" type="button" @click="deleteAuditRecords([record.id])">归档</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <footer class="console-table-footer audit-table-footer"><span>第 {{ auditPage }} / {{ auditTotalPages }} 页 · 共 {{ auditTotal }} 条 · 审计事件保留与清理请走受控保留任务</span><div class="audit-pagination"><button class="console-text-button" type="button" :disabled="auditPage === 1 || auditLoading" @click="changeAuditPage(auditPage - 1)">上一页</button><span class="console-page-token">{{ auditPage }} / {{ auditTotalPages }}</span><button class="console-text-button" type="button" :disabled="auditPage === auditTotalPages || auditLoading" @click="changeAuditPage(auditPage + 1)">下一页</button></div></footer>
          </div>

        </section>

        <section v-else class="settings-view" aria-label="系统设置">
          <header class="settings-showcase-head">
            <div>
              <span class="settings-showcase-kicker"><ConsoleIcon name="settings" />平台配置中心</span>
              <h2>系统设置</h2>
              <p>集中维护平台基础资料、身份组织、统一登录、安全策略与运行支撑能力。</p>
            </div>
          </header>

          <nav class="settings-tab-bar" role="tablist" aria-label="系统设置分类">
            <button
              v-for="tab in settingsTabs"
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

          <div class="settings-active-summary" :class="activeSettingsMeta.tone">
            <span class="settings-active-summary-icon"><ConsoleIcon :name="activeSettingsMeta.icon" /></span>
            <div class="settings-active-summary-copy">
              <strong>{{ activeSettingsMeta.label }}</strong>
              <p>{{ activeSettingsMeta.description }}</p>
            </div>
            <div class="settings-active-capabilities" aria-label="当前模块功能">
              <span v-for="capability in activeSettingsMeta.capabilities" :key="capability">{{ capability }}</span>
            </div>
          </div>

          <div v-if="activeSettingsTab === 'base'" class="console-card settings-card">
            <div class="console-card-body">
              <h2>平台基础信息</h2>
              <p class="console-card-hint">用于定义基础能力平台的展示名称。</p>
              <p v-if="settingsLoading" class="console-card-hint">正在读取平台设置…</p>
              <p v-else-if="settingsError" class="login-target-module__error" role="alert">{{ settingsError }}</p>
              <div class="console-form-grid">
                <label class="console-form-item"><span>平台名称</span><input v-model="settings.organizationName" :disabled="settingsLoading" /></label>
                <label class="console-form-item"><span>平台简称</span><input v-model="settings.organizationAlias" :disabled="settingsLoading" /></label>
              </div>
              <div class="console-form-actions"><button class="console-button primary" type="button" :disabled="settingsSaving" @click="saveSettings"><ConsoleIcon name="save" />{{ settingsSaving ? '保存中…' : '保存设置' }}</button><button class="console-button ghost" type="button" :disabled="settingsLoading" @click="resetSettings">重新读取</button></div>
            </div>
          </div>

          <IamSettingsModule v-else-if="activeSettingsTab === 'iam'" @toast="showToast" />

          <div v-else-if="activeSettingsTab === 'login-targets'" class="settings-module-stack">
            <form class="console-card settings-card" @submit.prevent="saveSubsystemConnection">
              <div class="console-card-body">
                <h2>子系统一键接入</h2>
                <p class="console-card-hint">一次完成应用登记、OAuth 配置写入、子系统容器构建启动和门户网关更新。接入过程中不会在页面展示或复制客户端密钥；子系统端口仅作为内部上游使用，对外统一通过门户路径访问。</p>
                <p v-if="subsystemError" class="login-target-module__error" role="alert">{{ subsystemError }}</p>
                <div class="console-form-grid">
                  <label class="console-form-item"><span>子系统编码</span><input v-model="subsystemEditor.code" autocomplete="off" placeholder="business-app" /><small>稳定且唯一，例如 <code>business-app</code>。</small></label>
                  <label class="console-form-item"><span>子系统名称</span><input v-model="subsystemEditor.name" autocomplete="off" placeholder="业务应用" /></label>
                  <label class="console-form-item"><span>环境</span><select v-model="subsystemEditor.environment"><option value="dev">dev</option><option value="test">test</option><option value="staging">staging</option><option value="prod">prod</option></select></label>
                  <label class="console-form-item"><span>OAuth 客户端类型</span><select v-model="subsystemEditor.clientType"><option value="confidential">后端服务（推荐，有密钥）</option><option value="public">纯前端 SPA（无密钥）</option></select><small>有后端的子系统应选择“后端服务”。</small></label>
                  <label class="console-form-item"><span>门户公开 BaseURL</span><input v-model="subsystemEditor.baseURL" autocomplete="url" placeholder="https://portal.example.com" /><small>用户在浏览器中访问的统一入口；生产环境建议使用 HTTPS。</small></label>
                  <label class="console-form-item"><span>内部 UpstreamURL</span><input v-model="subsystemEditor.upstreamURL" autocomplete="url" placeholder="http://10.0.0.8:8081" /><small>只供门户网关访问，不需要对公网开放。</small></label>
                  <label class="console-form-item"><span>门户路径前缀</span><input v-model="subsystemEditor.pathPrefix" autocomplete="off" placeholder="留空时自动使用 /business-app" /><small>留空时根据子系统编码生成；必须独占且不能为 <code>/</code>。</small></label>
                </div>
                <div class="console-form-actions">
                  <button class="console-button primary" type="submit" :disabled="subsystemSaving"><ConsoleIcon name="save" />{{ subsystemSaving ? '自动部署中…' : '一键接入并部署' }}</button>
                </div>
              </div>
            </form>

            <div class="console-card settings-card">
              <div class="console-card-body">
                <h2>登录目标管理边界</h2>
                <p class="console-card-hint">登录目标严格归属于一个应用环境；目标地址必须为 https 绝对地址或相对路径（以 <code>/</code> 开头），且与 OAuth redirect_uri 分离。</p>
                <div class="console-form-grid">
                  <label class="console-form-item"><span>应用</span><select v-model="loginTargetBoundary.applicationId" :disabled="!applications.length"><option value="">请选择应用</option><option v-for="app in applications" :key="app.application_id" :value="app.application_id">{{ app.name || app.code }}（{{ app.code }}）</option></select></label>
                  <label class="console-form-item"><span>环境</span><select v-model="loginTargetBoundary.environmentId" :disabled="!loginTargetBoundary.applicationId || !loginTargetEnvironments.length"><option value="">请选择环境</option><option v-for="env in loginTargetEnvironments" :key="env.environment_id" :value="env.environment_id">{{ env.environment }}</option></select></label>
                  <div class="console-form-item"><span>门户路径前缀</span><strong class="console-mono">{{ loginTargetBoundary.pathPrefix || '—' }}</strong><small>网关按此前缀把请求转发到内部上游。</small></div>
                  <div class="console-form-item"><span>门户公开 BaseURL</span><strong class="console-mono">{{ loginTargetBoundary.baseURL || '—' }}</strong><small>相对 TargetURI 最终按 BaseURL + PathPrefix + TargetURI 拼接。</small></div>
                  <div class="console-form-item full"><span>内部 UpstreamURL</span><strong class="console-mono">{{ loginTargetBoundary.upstreamURL || '—' }}</strong><small>只用于反向代理，不作为浏览器跳转地址。</small></div>
                </div>
              </div>
            </div>
            <ApplicationLoginTargetModule :application-id="loginTargetBoundary.applicationId" :environment-id="loginTargetBoundary.environmentId" :application-name="loginTargetBoundary.applicationName" :environment-name="loginTargetBoundary.environmentName" @toast="showToast" />
          </div>

          <NotificationCenterModule v-else-if="activeSettingsTab === 'notify'" @toast="showToast" />

          <LoginSecurityModule v-else-if="activeSettingsTab === 'security'" @toast="showToast" />


          <FileTaskOperationsModule v-else-if="activeSettingsTab === 'files'" @toast="showToast" />

          <DictionaryManagementModule v-else-if="activeSettingsTab === 'dict'" @toast="showToast" />
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
        </div>
        <section class="audit-detail-section"><h3>事件说明</h3><p>{{ auditDetail.detail || '无附加说明。' }}</p></section>
        <section class="audit-detail-section"><h3>数据变更摘要</h3><p>{{ auditDetail.changeSummary || '无字段变更。' }}</p><small>审计事件保存操作上下文；数据变更明细由独立 audit_change 存储，敏感字段按脱敏和最小化原则展示。</small></section>
        <footer><button class="console-button ghost" type="button" @click="closeAuditDetail">关闭</button></footer>
      </section>
    </div>

    <button v-if="mobileMenuOpen" class="console-menu-mask" type="button" aria-label="关闭导航遮罩" @click="mobileMenuOpen = false"></button>
    <div v-if="toastMessage" class="console-toast" role="status"><ConsoleIcon name="info" /><span>{{ toastMessage }}</span></div>
  </div>
</template>
