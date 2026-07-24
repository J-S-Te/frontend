<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuditOperationsModule from '@/modules/platform/audit/components/AuditOperationsModule.vue'
import FileTaskOperationsModule from '@/modules/platform/files/components/FileTaskOperationsModule.vue'
import IamSettingsModule from '@/modules/platform/iam/components/IamSettingsModule.vue'
import ApplicationLoginTargetModule from '@/modules/platform/login-targets/components/ApplicationLoginTargetModule.vue'
import NotificationCenterModule from '@/modules/platform/notifications/components/NotificationCenterModule.vue'
import ObservabilityManagementModule from '@/modules/platform/observability/components/ObservabilityManagementModule.vue'
import SecurityObservabilityModule from '@/modules/platform/security/components/SecurityObservabilityModule.vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { listApplications, listEnvironments } from '@/modules/platform/applications/api/applications'
import {
  AuditEventsError,
  listAuditEvents,
  createAuditExportJob,
} from '@/modules/platform/audit/api/auditEvents'
import {
  PlatformSettingsError,
  getPlatformSettings,
  updatePlatformSettings,
} from '@/modules/platform/settings/api/platformSettings'
import '@/modules/platform/styles/console.css'

const route = useRoute()
const router = useRouter()
const settings = reactive({ organizationName: '', organizationAlias: '', timezone: '', qualification: '', version: 0 })
const settingsLoading = ref(false)
const settingsError = ref('')
const settingsSaving = ref(false)
const currentView = computed(() => (route.name === 'audit' ? 'audit' : 'settings'))
const loginTargetBoundary = reactive({ applicationId: '', environmentId: '', applicationName: '', environmentName: '', baseURL: '', pathPrefix: '' })
const loginTargetEnvironments = ref([])
const mobileMenuOpen = ref(false)
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
  { key: 'base', label: '基础设置' },
  { key: 'iam', label: '用户与角色' },
  { key: 'login-targets', label: '统一登录目标' },
  { key: 'notify', label: '通知中心' },
  { key: 'security', label: '安全设置' },
  { key: 'observability', label: '可观测性' },
  { key: 'files', label: '文件与任务' },
  { key: 'dict', label: '字典管理' },
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

// 前后端 result / risk 枚举到中文标签的映射，与后端 audit/application 层枚举保持一致。
const RESULT_LABELS = { SUCCESS: '成功', DENIED: '拒绝', ERROR: '异常', PARTIAL: '部分成功' }
const RISK_LABELS = { HIGH: '高', MEDIUM: '中', LOW: '低' }
const AUDIT_TYPE_OPTIONS = ['登录', '新增', '修改', '导出', '状态变更']
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
const pagedAuditRecords = computed(() => {
  const startIndex = (auditPage.value - 1) * auditPageSize
  return filteredAuditRecords.value.slice(startIndex, startIndex + auditPageSize)
})
const allPageAuditSelected = computed(() => pagedAuditRecords.value.length > 0 && pagedAuditRecords.value.every((record) => selectedAuditIds.value.includes(record.id)))

const viewMeta = computed(() => {
  if (currentView.value === 'audit') {
    return { title: '审计日志', crumb: '审计日志', description: 'AUD-001 · 审计事件、数据变更摘要与跨链路追溯' }
  }
  if (activeSettingsTab.value === 'iam') {
    return { title: '系统设置', crumb: '系统设置', description: 'SYS-002 ~ SYS-004 · 身份、组织、角色与权限集中配置' }
  }
  if (activeSettingsTab.value === 'security') {
    return { title: '系统设置', crumb: '系统设置', description: 'AUD-002 · 登录安全与风险策略集中配置' }
  }
  if (activeSettingsTab.value === 'observability') {
    return { title: '系统设置', crumb: '系统设置', description: 'OBS-001 · 运行日志、Trace、Metric 与告警规则运营' }
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
    const data = await listApplications({ page: 1, pageSize: 200, status: 'ACTIVE' })
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
    loginTargetBoundary.baseURL = ''
    loginTargetBoundary.pathPrefix = ''
    return
  }
  try {
    const data = await listEnvironments({ applicationId: applicationID, page: 1, pageSize: 50, status: 'ACTIVE' })
    loginTargetEnvironments.value = data.items || []
    if (!loginTargetEnvironments.value.some((env) => env.environment_id === loginTargetBoundary.environmentId)) {
      loginTargetBoundary.environmentId = ''
      loginTargetBoundary.baseURL = ''
      loginTargetBoundary.pathPrefix = ''
    }
  } catch (error) {
    loginTargetEnvironments.value = []
  }
}

watch(() => loginTargetBoundary.applicationId, (value) => {
  loadLoginTargetEnvironments(value)
})

watch(() => loginTargetBoundary.environmentId, (value) => {
  if (!value) {
    loginTargetBoundary.baseURL = ''
    loginTargetBoundary.pathPrefix = ''
    return
  }
  const env = loginTargetEnvironments.value.find((item) => item.environment_id === value)
  loginTargetBoundary.baseURL = env?.base_url || ''
  loginTargetBoundary.pathPrefix = env?.path_prefix || ''
})

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
      action: auditType.value,
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
      action: auditType.value,
      result: auditResultValue(auditResult.value),
      riskLevel: auditRiskValue(auditRisk.value),
      occurredFrom: bounds.from,
      occurredTo: bounds.to,
    })
    const status = job?.status || '已接收'
    showToast(`导出任务已提交（${status}），稍后到“审计运营”下载。`)
  } catch (error) {
    showToast(error.message || '提交导出任务失败。')
  } finally {
    auditExporting.value = false
  }
}

function logout() {
  router.push({ name: 'login' })
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
        <button class="console-logout" type="button" aria-label="退出登录" @click="logout"><ConsoleIcon name="logout" /></button>
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
            <label class="console-select-field"><select v-model="auditType" aria-label="操作类型"><option value="">全部操作</option><option v-for="option in AUDIT_TYPE_OPTIONS" :key="option" :value="option">{{ option }}</option></select></label>
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
                    <td data-label="操作"><span class="console-badge" :class="`type-${record.type}`">{{ record.type || record.action || '—' }}</span><span class="console-entity-meta">{{ record.action }}</span></td>
                    <td data-label="应用 / 环境"><strong>{{ record.application || '—' }}</strong><span class="console-entity-meta">{{ record.environment || '—' }}</span></td>
                    <td data-label="资源对象"><strong>{{ record.object || record.resource || '—' }}</strong><span class="console-entity-meta">{{ record.resource }}</span></td>
                    <td data-label="方法 / 路径"><span class="audit-method">{{ record.method || '—' }}</span><span class="console-entity-meta console-mono">{{ record.path || '—' }}</span></td>
                    <td class="console-mono" data-label="客户端 IP">{{ record.ip || '—' }}</td>
                    <td data-label="状态"><span class="console-badge" :class="record.result === 'SUCCESS' ? 'status-active' : 'audit-result-denied'">{{ record.statusCode || '—' }} · {{ record.resultLabel || record.result || '—' }}</span></td>
                    <td data-label="风险"><span class="console-badge" :class="`risk-${record.risk}`">{{ record.riskLabel || record.risk || '—' }}</span></td>
                    <td class="console-actions-cell" data-label="操作"><button class="console-text-button" type="button" @click="openAuditDetail(record)">详情</button><button class="console-text-button danger" type="button" @click="deleteAuditRecords([record.id])">归档</button></td>
                  </tr>
                  <tr v-if="!pagedAuditRecords.length"><td class="console-empty" colspan="12">未找到符合筛选条件的审计事件。</td></tr>
                </tbody>
              </table>
            </div>
            <footer class="console-table-footer audit-table-footer"><span>第 {{ auditPage }} / {{ auditTotalPages }} 页 · 共 {{ auditTotal }} 条 · 审计事件保留与清理请走受控保留任务</span><div class="audit-pagination"><button class="console-text-button" type="button" :disabled="auditPage === 1 || auditLoading" @click="changeAuditPage(auditPage - 1)">上一页</button><span class="console-page-token">{{ auditPage }} / {{ auditTotalPages }}</span><button class="console-text-button" type="button" :disabled="auditPage === auditTotalPages || auditLoading" @click="changeAuditPage(auditPage + 1)">下一页</button></div></footer>
          </div>

          <AuditOperationsModule @toast="showToast" />
        </section>

        <section v-else class="settings-view" aria-label="系统设置">
          <div class="console-tabs" role="tablist" aria-label="系统设置分类">
            <button v-for="tab in settingsTabs" :key="tab.key" class="console-tab" :class="{ active: activeSettingsTab === tab.key }" type="button" role="tab" :aria-selected="activeSettingsTab === tab.key" @click="activeSettingsTab = tab.key">{{ tab.label }}</button>
          </div>

          <div v-if="activeSettingsTab === 'base'" class="console-card settings-card">
            <div class="console-card-body">
              <h2>平台基础信息</h2>
              <p class="console-card-hint">用于定义基础能力平台的展示名称与平台标识。</p>
              <p v-if="settingsLoading" class="console-card-hint">正在读取平台设置…</p>
              <p v-else-if="settingsError" class="login-target-module__error" role="alert">{{ settingsError }}</p>
              <div class="console-form-grid">
                <label class="console-form-item"><span>平台名称</span><input v-model="settings.organizationName" :disabled="settingsLoading" /></label>
                <label class="console-form-item"><span>平台简称</span><input v-model="settings.organizationAlias" :disabled="settingsLoading" /></label>
                <div class="console-form-item"><span>平台标识</span><div class="console-logo-preview"><b>{{ (settings.organizationName || '基').slice(0, 1) }}</b><small>默认文字标识，后续可接入本地文件上传。</small></div></div>
              </div>
              <div class="console-form-actions"><button class="console-button primary" type="button" :disabled="settingsSaving" @click="saveSettings"><ConsoleIcon name="save" />{{ settingsSaving ? '保存中…' : '保存设置' }}</button><button class="console-button ghost" type="button" :disabled="settingsLoading" @click="resetSettings">重新读取</button></div>
            </div>
          </div>

          <IamSettingsModule v-else-if="activeSettingsTab === 'iam'" @toast="showToast" />

          <div v-else-if="activeSettingsTab === 'login-targets'" class="settings-module-stack">
            <div class="console-card settings-card"><div class="console-card-body"><h2>管理边界</h2><p class="console-card-hint">登录目标严格归属于一个应用环境；目标地址必须为 https 绝对地址或相对路径（以 <code>/</code> 开头），且与 OAuth redirect_uri 分离。</p>
              <div class="console-form-grid">
                <label class="console-form-item"><span>应用</span><select v-model="loginTargetBoundary.applicationId" :disabled="!applications.length"><option value="">请选择应用</option><option v-for="app in applications" :key="app.application_id" :value="app.application_id">{{ app.name || app.code }}（{{ app.code }}）</option></select></label>
                <label class="console-form-item"><span>环境</span><select v-model="loginTargetBoundary.environmentId" :disabled="!loginTargetBoundary.applicationId || !loginTargetEnvironments.length"><option value="">请选择环境</option><option v-for="env in loginTargetEnvironments" :key="env.environment_id" :value="env.environment_id">{{ env.environment }}</option></select></label>
                <div class="console-form-item"><span>应用 / 环境路径前缀</span><strong class="console-mono">{{ loginTargetBoundary.pathPrefix || '—' }}</strong><small>由后台 UpstreamURL / PathPrefix 决定；非空表示门户会按此路径反代到子系。</small></div>
                <div class="console-form-item"><span>应用基础地址</span><strong class="console-mono">{{ loginTargetBoundary.baseURL || '—' }}</strong><small>子系对外的 BaseURL；相对路径 TargetURI 会在此地址上拼接。</small></div>
              </div>
            </div></div>
            <ApplicationLoginTargetModule :application-id="loginTargetBoundary.applicationId" :environment-id="loginTargetBoundary.environmentId" :application-name="loginTargetBoundary.applicationName" :environment-name="loginTargetBoundary.environmentName" @toast="showToast" />
          </div>

          <NotificationCenterModule v-else-if="activeSettingsTab === 'notify'" @toast="showToast" />

          <SecurityObservabilityModule v-else-if="activeSettingsTab === 'security'" @toast="showToast" />

          <ObservabilityManagementModule v-else-if="activeSettingsTab === 'observability'" @toast="showToast" />

          <FileTaskOperationsModule v-else-if="activeSettingsTab === 'files'" @toast="showToast" />

          <div v-else class="console-card settings-card"><div class="console-card-body"><h2>字典管理</h2><p class="console-card-hint">本期保留字典管理入口，字典项维护接口后续由平台配置模块接入。</p>
            <div class="console-setting-list">
              <div class="console-setting-row"><div><strong>审计操作类型</strong><p>登录、查看、新增、修改、删除、导出、状态变更。</p></div><button class="console-button ghost small" type="button" @click="showToast('字典维护功能待配置模块接口接入。')">管理</button></div>
              <div class="console-setting-row"><div><strong>风险等级</strong><p>高、中、低；用于审计事件风险分级展示。</p></div><button class="console-button ghost small" type="button" @click="showToast('字典维护功能待配置模块接口接入。')">管理</button></div>
              <div class="console-setting-row"><div><strong>通知事件类型</strong><p>安全告警、策略变更、审计导出、系统异常。</p></div><button class="console-button ghost small" type="button" @click="showToast('字典维护功能待配置模块接口接入。')">管理</button></div>
            </div>
          </div></div>
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
          <div><span>操作结果</span><strong>{{ auditDetail.statusCode || '—' }} · {{ auditDetail.resultLabel || auditDetail.result || '—' }} · {{ auditDetail.riskLabel || auditDetail.risk || '—' }}风险</strong></div>
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
