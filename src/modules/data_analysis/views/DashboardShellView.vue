<script setup>
// 数据看板统一外壳（对齐 project_management 模式）：
// 深色侧栏导航 + 顶栏 + 页面头，按 route.params.section 切换分区；
// 总览、报告、财务看板经嵌入桥加载；合同、项目看板使用本地原生模型，避免空白 iframe。
import { computed, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { AuthError, logoutCurrentSession } from "@/modules/platform/auth/api/auth"
import ConsoleIcon from "@/modules/platform/shared/components/ConsoleIcon.vue"
import ErrorState from "@/modules/platform/shared/components/ErrorState.vue"
import LoadingState from "@/modules/platform/shared/components/LoadingState.vue"
import { closeSubsystemTabOrFallback } from "@/modules/shared/utils/returnToPortal"
import { getAuthMe, getEmbedToken, getContractDashboardSummary, getProjectDashboardSummary } from "../api/dataAnalysis"
import AlertsCenterView from "./AlertsCenterView.vue"
import DictionaryView from "./DictionaryView.vue"
import AdminSourcesView from "./AdminSourcesView.vue"
import AlertRulesView from "./AlertRulesView.vue"
import NativeDashboardView from "./NativeDashboardView.vue"
import "@/modules/data_analysis/styles/data-analysis.css"

const route = useRoute()
const router = useRouter()
const isLoggingOut = ref(false)

const DASHBOARD_CODES = {
  overview: 'overview',
  contract: 'contract',
  project: 'project',
  report: 'report',
  finance: 'finance',
}

const DASHBOARD_SECTIONS = Object.keys(DASHBOARD_CODES)
const DASHBOARD_PERMISSIONS = {
  overview: "dashboard.overview.view",
  contract: "dashboard.contract.view",
  project: "dashboard.project.view",
  report: "dashboard.report.view",
  finance: "dashboard.finance.view",
}
const ROLE_SCOPE_LABELS = {
  boss: "全租户经营视角",
  finance_manager: "全租户财务视角",
  sales_director: "本人及下属组织",
  tech_director: "管辖团队",
  dashboard_admin: "系统运维视角（不含业务明细）",
  admin: "全量系统视角",
}
const ROLE_LABELS = {
  admin: "超级管理员",
  boss: "老板/总经理",
  sales_director: "销售总监",
  tech_director: "技术总监",
  finance_manager: "财务经理",
  dashboard_admin: "看板系统管理员",
}
// 合同、项目看板只展示聚合库摘要；其余看板仍通过统一嵌入桥加载。
const EMBEDDED_DASHBOARD_SECTIONS = DASHBOARD_SECTIONS.filter((code) => !['contract', 'project'].includes(code))
const KNOWN_SECTIONS = [...DASHBOARD_SECTIONS, "alerts", "dictionary", "admin/sources", "admin/rules"]

const navGroups = [
  { label: "经营看板", items: [
    { key: "overview", label: "经营总览", icon: "dashboard", meta: ["集团经营指标与目标达成态势", "OQ1"], permission: DASHBOARD_PERMISSIONS.overview },
    { key: "contract", label: "合同看板", icon: "account", meta: ["合同签约、执行与回款全景", "OQ2"], permission: DASHBOARD_PERMISSIONS.contract },
    { key: "project", label: "项目看板", icon: "organization", meta: ["项目交付、进度与质量全景", "OQ3"], permission: DASHBOARD_PERMISSIONS.project },
    { key: "report", label: "报告看板", icon: "audit", meta: ["报告编制、复核与签发效率", "OQ4"], permission: DASHBOARD_PERMISSIONS.report },
    { key: "finance", label: "财务看板", icon: "settings", meta: ["收入、成本与利润口径分析", "OQ5"], permission: DASHBOARD_PERMISSIONS.finance },
  ] },
  { label: "预警与口径", items: [
    { key: "alerts", label: "预警中心", icon: "bell", meta: ["指标预警的受理、跟踪与闭环", "P-08"], permission: "alert.view" },
    { key: "dictionary", label: "指标字典", icon: "info", meta: ["指标口径与版本的统一查阅", "P-07"], permission: "dictionary.view" },
  ] },
  { label: "管理配置", items: [
    { key: "admin/sources", label: "数据源与同步", icon: "save", meta: ["各子系统数据源接入与同步状态", "P-09"], permission: "aggregation.manage" },
    { key: "admin/rules", label: "预警规则配置", icon: "shield", meta: ["预警触发条件与阈值参数", "P-10"], permission: "alert.manage" },
  ] },
]

const pageMeta = {
  overview: ["经营总览", "集团经营指标与目标达成态势"],
  contract: ["合同看板", "合同签约、执行与回款全景"],
  project: ["项目看板", "项目交付、进度与质量全景"],
  report: ["报告看板", "报告编制、复核与签发效率"],
  finance: ["财务看板", "收入、成本与利润口径分析"],
  alerts: ["预警中心", "指标预警的受理、跟踪与闭环"],
  dictionary: ["指标字典", "指标口径与版本的统一查阅"],
  "admin/sources": ["数据源与同步", "各子系统数据源接入与同步状态"],
  "admin/rules": ["预警规则配置", "预警触发条件与阈值参数"],
}

const section = computed(() => {
  const raw = String(route.params.section || "").replace(/^\/+|\/+$/g, "")
  return KNOWN_SECTIONS.includes(raw) ? raw : "overview"
})

const me = ref(null)
const loading = ref(true)
const loadError = ref("")
const mobileMenuOpen = ref(false)
const iframeSrc = ref("")
const iframeLoading = ref(false)
const iframeError = ref(null)
const dashboardSummary = ref(null)
const overviewSummary = ref({ contract: null, project: null })
const summaryLoading = ref(false)
const summaryError = ref("")
const statusFilter = ref("全部")
let iframeRequestVersion = 0
let summaryRequestVersion = 0

const currentMeta = computed(() => pageMeta[section.value] || pageMeta.overview)
const currentUserName = computed(() => me.value?.display_name || "当前用户")
const currentUserRole = computed(() => {
  const roles = (me.value?.roles || []).map((role) => ROLE_LABELS[role] || role)
  return roles.join(" / ") || "看板用户"
})
const currentUserInitial = computed(() => currentUserName.value.slice(0, 1).toUpperCase())
const permissions = computed(() => me.value?.permissions || [])
const hasPermission = (code) => permissions.value.includes(code)
const canViewDashboard = (code) => permissions.value.includes(DASHBOARD_PERMISSIONS[code])
const visibleDashboardSections = computed(() => DASHBOARD_SECTIONS.filter(canViewDashboard))
const dataScopeLabel = computed(() => {
  const role = (me.value?.roles || []).find((item) => ROLE_SCOPE_LABELS[item])
  return ROLE_SCOPE_LABELS[role] || "当前授权数据范围"
})
const statusOptions = computed(() => {
  if (section.value === "contract") return ["全部", "审批中", "履行中", "已到期"]
  if (section.value !== "project") return []
  const statuses = Object.keys(dashboardSummary.value?.status_counts || {})
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
  return ["全部", ...statuses]
})

async function loadMe() {
  loading.value = true
  loadError.value = ""
  try {
    me.value = await getAuthMe()
  } catch (err) {
    loadError.value = err?.message || "会话读取失败"
  } finally {
    loading.value = false
  }
}

async function loadDashboard(code) {
  const requestVersion = ++iframeRequestVersion
  iframeLoading.value = true
  iframeError.value = null
  iframeSrc.value = ""
  try {
    const { token } = await getEmbedToken(code)
    if (requestVersion !== iframeRequestVersion || section.value !== code) return
    // 令牌单次消费：仅本次 iframe 加载使用
    iframeSrc.value = `/data_analysis/api/v1/embed-proxy/${encodeURIComponent(token)}`
  } catch (err) {
    if (requestVersion !== iframeRequestVersion) return
    iframeError.value = err?.code === "FORBIDDEN" ? "当前账号无权限查看该看板" : (err?.message || "看板加载失败")
  } finally {
    if (requestVersion === iframeRequestVersion) iframeLoading.value = false
  }
}

async function loadSummary(code) {
  const requestVersion = ++summaryRequestVersion
  if (code === 'overview') {
    summaryLoading.value = true
    summaryError.value = ""
    try {
      const [contractResult, projectResult] = await Promise.allSettled([
        canViewDashboard("contract") ? getContractDashboardSummary() : Promise.reject(new Error("contract dashboard unavailable")),
        canViewDashboard("project") ? getProjectDashboardSummary() : Promise.reject(new Error("project dashboard unavailable")),
      ])
      if (requestVersion !== summaryRequestVersion || section.value !== code) return
      overviewSummary.value = {
        contract: contractResult.status === "fulfilled" ? contractResult.value : null,
        project: projectResult.status === "fulfilled" ? projectResult.value : null,
      }
    } catch (err) {
      if (requestVersion !== summaryRequestVersion) return
      overviewSummary.value = { contract: null, project: null }
      summaryError.value = err?.message || "摘要加载失败"
    } finally {
      if (requestVersion === summaryRequestVersion) summaryLoading.value = false
    }
    return
  }
  if (!['contract', 'project'].includes(code)) {
    summaryLoading.value = false
    summaryError.value = ""
    dashboardSummary.value = null
    overviewSummary.value = { contract: null, project: null }
    return
  }
  summaryLoading.value = true
  summaryError.value = ""
  try {
    const result = code === 'contract'
      ? await getContractDashboardSummary()
      : await getProjectDashboardSummary()
    if (requestVersion !== summaryRequestVersion || section.value !== code) return
    dashboardSummary.value = result
  } catch (err) {
    if (requestVersion !== summaryRequestVersion) return
    dashboardSummary.value = null
    summaryError.value = err?.message || "摘要加载失败"
  } finally {
    if (requestVersion === summaryRequestVersion) summaryLoading.value = false
  }
}

async function refreshCurrentDashboard() {
  const code = DASHBOARD_CODES[section.value]
  if (!code) return
  const tasks = [loadSummary(code)]
  if (EMBEDDED_DASHBOARD_SECTIONS.includes(section.value)) tasks.push(loadDashboard(code))
  await Promise.all(tasks)
}

function navigate(key) {
  router.push({ name: "data_analysis", params: { section: key } })
  mobileMenuOpen.value = false
}

function returnToUnifiedPortal() {
  mobileMenuOpen.value = false
  closeSubsystemTabOrFallback(window, () => router.replace({ name: "portal" }))
}
async function logoutSystem() {
  if (isLoggingOut.value) return
  isLoggingOut.value = true
  try {
    await logoutCurrentSession()
    await router.replace({ name: "login", query: { reason: "session-ended" } })
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) {
      await router.replace({ name: "login", query: { reason: "session-ended" } })
      return
    }
    summaryError.value = error?.message || "退出系统失败，请稍后重试。"
  } finally {
    isLoggingOut.value = false
  }
}

watch(() => section.value, (value) => {
  statusFilter.value = "全部"
  if (DASHBOARD_SECTIONS.includes(value)) {
    if (me.value && !canViewDashboard(value)) {
      const fallback = visibleDashboardSections.value[0]
      if (fallback) router.replace({ name: "data_analysis", params: { section: fallback } })
      return
    }
    if (EMBEDDED_DASHBOARD_SECTIONS.includes(value)) {
      loadDashboard(DASHBOARD_CODES[value])
    } else {
      // 离开嵌入看板时清理上一次令牌，避免业务摘要页残留旧 iframe 状态。
      iframeRequestVersion += 1
      iframeSrc.value = ""
      iframeError.value = null
      iframeLoading.value = false
    }
    loadSummary(DASHBOARD_CODES[value])
  }
})

watch(statusOptions, (options) => {
  if (!options.includes(statusFilter.value)) statusFilter.value = "全部"
})

onMounted(async () => {
  await loadMe()
  if (DASHBOARD_SECTIONS.includes(section.value)) {
    if (!canViewDashboard(section.value)) {
      const fallback = visibleDashboardSections.value[0]
      if (fallback) await router.replace({ name: "data_analysis", params: { section: fallback } })
      return
    }
    const tasks = [loadSummary(DASHBOARD_CODES[section.value])]
    if (EMBEDDED_DASHBOARD_SECTIONS.includes(section.value)) {
      tasks.unshift(loadDashboard(DASHBOARD_CODES[section.value]))
    }
    await Promise.all(tasks)
  }
})
</script>

<template>
  <div class="console-page da-shell">
    <aside class="da-sidebar" :class="{ open: mobileMenuOpen }">
      <div class="da-brand">
        <span class="da-brand-mark"><ConsoleIcon name="logo" /></span>
        <span><b>数据看板与统计分析</b><small>DATA INTELLIGENCE</small></span>
        <button class="da-icon-button da-mobile-close" aria-label="关闭菜单" @click="mobileMenuOpen = false"><ConsoleIcon name="close" /></button>
      </div>
      <nav class="da-nav" aria-label="数据看板导航">
        <div v-for="group in navGroups" :key="group.label" class="da-nav-group">
          <div class="da-nav-label">{{ group.label }}</div>
          <button v-for="item in group.items" :key="item.key" v-show="!item.permission || hasPermission(item.permission)" class="da-nav-item" :class="{ active: section === item.key }" :aria-current="section === item.key ? 'page' : undefined" @click="navigate(item.key)">
            <ConsoleIcon :name="item.icon" /><span>{{ item.label }}</span>
          </button>
        </div>
        <div class="da-nav-group">
          <div class="da-nav-label">平台能力</div>
          <button class="da-nav-item" type="button" @click="returnToUnifiedPortal"><ConsoleIcon name="dashboard" /><span>返回子系统门户</span></button>
        </div>
      </nav>
      <div class="da-sidebar-user">
        <span class="da-avatar">{{ currentUserInitial }}</span>
        <span class="da-sidebar-user-copy"><strong>{{ currentUserName }}</strong><small>{{ currentUserRole }}</small></span>
        <button type="button" :disabled="isLoggingOut" aria-label="退出应用系统" @click="logoutSystem"><ConsoleIcon name="logout" /></button>
      </div>
    </aside>
    <div v-if="mobileMenuOpen" class="da-menu-mask" @click="mobileMenuOpen = false"></div>

    <main class="da-main">
      <header class="da-topbar">
        <button class="da-icon-button da-menu-button" aria-label="打开菜单" @click="mobileMenuOpen = true"><ConsoleIcon name="menu" /></button>
        <div class="da-breadcrumb"><span>数据看板与统计分析</span><ConsoleIcon name="chevron" /><strong>{{ currentMeta[0] }}</strong></div>
        <div class="da-top-tools"><span class="da-topbar-avatar">{{ currentUserInitial }}</span></div>
      </header>

      <div class="da-page">
        <section class="da-page-head">
          <div><p class="da-eyebrow">DATA INTELLIGENCE</p><h1>{{ currentMeta[0] }}</h1><p>{{ currentMeta[1] }} · {{ dataScopeLabel }}</p></div>
          <div v-if="statusOptions.length" class="da-page-filters" aria-label="看板筛选条件">
            <label>状态<select v-model="statusFilter"><option v-for="option in statusOptions" :key="option" :value="option">{{ option }}</option></select></label>
          </div>
          <div class="da-actions">
            <button v-if="DASHBOARD_SECTIONS.includes(section)" class="da-button" :disabled="iframeLoading || summaryLoading" @click="refreshCurrentDashboard"><ConsoleIcon name="reset" />{{ iframeLoading || summaryLoading ? '加载中' : '刷新看板' }}</button>
          </div>
        </section>

        <ErrorState v-if="loadError" title="会话读取失败" :error="loadError" @retry="loadMe" />

        <template v-else-if="DASHBOARD_SECTIONS.includes(section)">
          <LoadingState v-if="summaryLoading && ['contract', 'project'].includes(section)" title="摘要加载中…" compact />
          <ErrorState v-else-if="summaryError && ['contract', 'project'].includes(section)" title="摘要加载失败" :error="summaryError" @retry="loadSummary(DASHBOARD_CODES[section])" compact />
          <NativeDashboardView
            v-else-if="['overview', 'contract', 'project', 'report', 'finance'].includes(section)"
            :section="section"
            :contract-summary="section === 'overview' ? overviewSummary.contract : section === 'contract' ? dashboardSummary : null"
            :project-summary="section === 'overview' ? overviewSummary.project : section === 'project' ? dashboardSummary : null"
            :can-view-contract="canViewDashboard('contract')"
            :can-view-project="canViewDashboard('project')"
            :status-filter="statusFilter"
          />
          <section v-if="EMBEDDED_DASHBOARD_SECTIONS.includes(section)" class="da-frame-panel">
            <header class="da-frame-head"><div><p>EMBEDDED DASHBOARD</p><b>{{ currentMeta[0] }}</b></div><span>经统一嵌入桥加载 · 数据实时刷新</span></header>
            <div class="da-frame-stage">
              <LoadingState v-if="iframeLoading" title="看板加载中…" compact />
              <ErrorState v-else-if="iframeError" :error="iframeError" @retry="loadDashboard(DASHBOARD_CODES[section])" compact />
              <iframe v-else :src="iframeSrc" class="da-iframe" :title="`${currentMeta[0]}嵌入看板`" sandbox="allow-scripts allow-forms allow-popups" referrerpolicy="no-referrer" />
            </div>
          </section>
        </template>

        <AlertsCenterView v-else-if="section === 'alerts'" :permissions="permissions" />
        <DictionaryView v-else-if="section === 'dictionary'" />
        <AdminSourcesView v-else-if="section === 'admin/sources'" :permissions="permissions" />
        <AlertRulesView v-else-if="section === 'admin/rules'" :permissions="permissions" />
      </div>
    </main>
  </div>
</template>
