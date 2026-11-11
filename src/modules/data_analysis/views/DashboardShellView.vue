<script setup>
import { loginUsername } from "@/modules/shared/loginUsername.mjs"
// 数据看板统一外壳（对齐 project_management 模式）：
// 深色侧栏导航 + 顶栏 + 页面头，按 route.params.section 切换分区；
// 启用嵌入时总览、报告、财务看板经嵌入桥加载；合同、项目看板使用本地原生模型，避免空白 iframe。
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { AuthError, logoutCurrentSession } from "@/modules/platform/auth/api/auth"
import ConsoleIcon from "@/modules/platform/shared/components/ConsoleIcon.vue"
import ErrorState from "@/modules/platform/shared/components/ErrorState.vue"
import LoadingState from "@/modules/platform/shared/components/LoadingState.vue"
import { closeSubsystemTabOrFallback } from "@/modules/shared/utils/returnToPortal"
import { isDashboardEmbedEnabled, getAuthMe, getEmbedToken, getContractDashboardSummary, getProjectDashboardSummary, getReportDashboardSummary, getFinanceDashboardSummary, getContractDetails, getProjectDetails, getDashboardTrend, getAlertSummary } from "../api/dataAnalysis"
import AlertsCenterView from "./AlertsCenterView.vue"
import DictionaryView from "./DictionaryView.vue"
import AdminSourcesView from "./AdminSourcesView.vue"
import AlertRulesView from "./AlertRulesView.vue"
import NativeDashboardView from "./NativeDashboardView.vue"
import ContractImportHistoryPanel from "../components/ContractImportHistoryPanel.vue"
import { isolatedEmbedUrl } from "../utils/embedOrigin.mjs"
import { createEmbedSessionActivity } from "../utils/embedSessionActivity.js"
import { RELATED_DATA, subscribeRelatedDataChanges } from "@/modules/platform/shared/utils/relatedDataInvalidation.js"
import { formatDataAnalysisError } from "../utils/errors.js"
import { useUrlFilterState } from "@/modules/shared/composables/useUrlFilterState.js"
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
const ROLE_LABELS = {
  admin: "超级管理员",
  boss: "老板/总经理",
  sales_director: "销售总监",
  tech_director: "技术总监",
  finance_manager: "财务经理",
  dashboard_admin: "看板系统管理员",
}
// 五种看板均保留原生摘要；总览、报告、财务按服务端能力附加嵌入区域。
const EMBEDDED_DASHBOARD_SECTIONS = DASHBOARD_SECTIONS.filter((code) => !['contract', 'project'].includes(code))
const KNOWN_SECTIONS = [...DASHBOARD_SECTIONS, "alerts", "dictionary", "admin/sources", "admin/rules"]

const navGroups = [
  { label: "经营看板", items: [
    { key: "overview", label: "经营总览", icon: "dashboard", meta: ["合同与项目经营指标及趋势", "OQ1"], permission: DASHBOARD_PERMISSIONS.overview },
    { key: "contract", label: "合同看板", icon: "account", meta: ["普通合同签约与执行统计", "OQ2"], permission: DASHBOARD_PERMISSIONS.contract },
    { key: "project", label: "项目看板", icon: "organization", meta: ["项目规模、交付状态与报告阶段", "OQ3"], permission: DASHBOARD_PERMISSIONS.project },
    { key: "report", label: "报告看板", icon: "audit", meta: ["报告编制、复核与签发效率", "OQ4"], permission: DASHBOARD_PERMISSIONS.report },
    { key: "finance", label: "财务看板", icon: "settings", meta: ["应收、净核销回款与账龄分析", "OQ5"], permission: DASHBOARD_PERMISSIONS.finance },
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
  overview: ["经营总览", "合同与项目经营指标及趋势"],
  contract: ["合同看板", "普通合同签约与执行统计"],
  project: ["项目看板", "项目规模、交付状态与报告阶段"],
  report: ["报告看板", "报告编制、复核与签发效率"],
  finance: ["财务看板", "应收、净核销回款与账龄分析"],
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
const dashboardEmbedEnabled = computed(() => !!me.value && isDashboardEmbedEnabled(me.value))
const loading = ref(true)
const loadError = ref("")
const mobileMenuOpen = ref(false)
// 侧栏的稳定 id 由模板给出（aria-controls 指向它）；menuButton 是抽屉收起后焦点的落脚点。
const menuButton = ref(null)

// closeMenuOnEscape 处理文档级 Escape：只在抽屉打开时收起，收起后把焦点交还汉堡按钮，
// 键盘用户不会掉进已隐藏的侧栏。
// 参数：event 为 keydown 事件。返回值：无。
function closeMenuOnEscape(event) {
  if (event.key !== "Escape" && event.key !== "Esc") return
  if (!mobileMenuOpen.value) return
  // 弹窗（确认框 / 指标卡设置等）先处理同一个 Escape：抽屉既不抢按键，也不抢焦点。
  if (event.defaultPrevented) return
  if (document.body?.dataset?.confirmDialogOpen === "true") return
  if (document.querySelector('[role="dialog"]')) return
  mobileMenuOpen.value = false
  menuButton.value?.focus?.()
}
const iframeSrc = ref("")
const embedFrame = ref(null)
const recordEmbeddedActivity = inject('central-session-record-activity', null)
const embedActivity = createEmbedSessionActivity({ getFrame: () => embedFrame.value,
  getURL: () => iframeSrc.value, onActivity: recordEmbeddedActivity })
watch(iframeSrc, embedActivity.reset, { flush: 'sync' })
const iframeLoading = ref(false)
const iframeError = ref(null)
const dashboardSummary = ref(null)
const contractDetails = ref({ items: [], total: 0, page: 1, page_size: 20 })
const projectDetails = ref({ available: false, items: [], total: 0, page: 1, page_size: 20 })
const detailLoading = ref(false)
const historyPanel = ref(null)
let detailsRequestVersion = 0
let meRequestVersion = 0
let disposed = false
const overviewSummary = ref({ contract: null, project: null })
const dashboardTrend = ref([])
const alertSummary = ref(null)
const summaryLoading = ref(false)
const summaryError = ref("")
const detailError = ref("")
const statusFilter = ref("全部")
useUrlFilterState({ route, router, fields: { status: statusFilter } })
let iframeRequestVersion = 0
let summaryRequestVersion = 0
let embedRenewTimer = null
let embedExpiresAt = 0
let relatedRefreshTimer = null
let unsubscribeRelatedData = null
const EMBED_RENEW_BEFORE_SECONDS = 30

// 服务端切换到原生模式后清理旧能力，防止在途响应恢复旧 iframe。
watch(dashboardEmbedEnabled, (enabled) => {
  if (enabled) return
  iframeRequestVersion += 1
  clearEmbedRenewal()
  iframeSrc.value = ""
  iframeError.value = null
  iframeLoading.value = false
})

const currentMeta = computed(() => pageMeta[section.value] || pageMeta.overview)
const currentUserName = computed(() => loginUsername(me.value))
const currentUserRole = computed(() => {
  const roles = (me.value?.roles || []).map((role) => ROLE_LABELS[role] || role)
  return roles.join(" / ") || "看板用户"
})
const currentUserInitial = computed(() => currentUserName.value.slice(0, 1).toUpperCase())
const permissions = computed(() => me.value?.permissions || [])
const hasPermission = (code) => permissions.value.includes(code)
const canViewDashboard = (code) => permissions.value.includes(DASHBOARD_PERMISSIONS[code])
const visibleDashboardSections = computed(() => DASHBOARD_SECTIONS.filter(canViewDashboard))
const dataScopeLabel = computed(() => SCOPE_MODE_LABELS[scopeMode.value] ? `当前授权范围：${SCOPE_MODE_LABELS[scopeMode.value]}` : "数据范围尚未提供")
// 数据范围只读可信会话字段；缺失时明确未知，不由角色名推断。
const SCOPE_MODE_LABELS = { TENANT: "全租户", ORG: "组织", TEAM: "团队", SELF: "个人", NONE: "无可用范围" }
// 用途：按别名读取 /auth/me 的可选数据范围字段。
// 参数：source 为会话对象；names 为候选字段名；返回值缺失时为 undefined。
function readScopeField(source, names) {
  if (!source || typeof source !== "object") return undefined
  for (const name of names) {
    const value = source[name]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}
const scopeMode = computed(() => {
  const raw = readScopeField(me.value, ["scope_mode", "scopeMode", "ScopeMode"])
  const mode = typeof raw === "string" ? raw.trim().toUpperCase() : ""
  return Object.hasOwn(SCOPE_MODE_LABELS, mode) ? mode : ""
})
const scopeModeLabel = computed(() => SCOPE_MODE_LABELS[scopeMode.value] || "")
// 空范围提示只在“确实拿到范围集合且集合为空”时出现：字段缺失代表后端尚未上线，
// 据此提示“无数据”会把接口未就绪误判成系统故障；因此仅对明确为空的数组触发。
const scopeCollectionEmpty = computed(() => {
  const mode = scopeMode.value
  if (!mode) return false
  if (mode === "NONE") return true
  if (mode === "TENANT" || mode === "SELF") return false
  const teamIDs = readScopeField(me.value, ["team_ids", "teamIds", "TeamIDs"])
  const orgIDs = readScopeField(me.value, ["organization_ids", "organizationIds", "OrganizationIDs"])
  const collections = (mode === "TEAM" ? [teamIDs] : [orgIDs, teamIDs]).filter((value) => Array.isArray(value))
  return collections.length > 0 && collections.every((value) => value.length === 0)
})
const scopeEmptyHint = computed(() => (scopeCollectionEmpty.value ? "当前账号的数据范围集合为空，看板可能看不到任何数据；这不代表系统故障，请联系管理员补齐团队/组织授权。" : ""))
const statusOptions = computed(() => {
  if (section.value === "contract") return ["全部", "审批中", "履行中", "已到期"]
  if (section.value !== "project") return []
  const statuses = Object.keys(dashboardSummary.value?.status_counts || {})
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
  return ["全部", ...statuses]
})

// loadMe 读取最新身份并使旧身份的请求立即失效。
// 参数：无。
// 返回值：无；会话读取失败保留明确错误状态。
async function loadMe() {
  const ticket = ++meRequestVersion
  invalidateDashboardRequests()
  loading.value = true
  loadError.value = ""
  try {
    const identity = await getAuthMe()
    if (disposed || ticket !== meRequestVersion) return
    me.value = identity
  } catch (err) {
    if (disposed || ticket !== meRequestVersion) return
    loadError.value = formatDataAnalysisError(err, { fallback: "会话读取失败，请稍后刷新。" })
  } finally {
    if (ticket === meRequestVersion && !disposed) loading.value = false
  }
}

// 用途：按服务端能力加载隔离嵌入看板，原生模式不签发令牌。
// 参数：code 为当前可见看板代码。
// 返回值：无；加载失败写入页面错误状态。
async function loadDashboard(code) {
  if (!dashboardEmbedEnabled.value) return
  const requestVersion = ++iframeRequestVersion
  iframeLoading.value = true
  iframeError.value = null
  iframeSrc.value = ""
  try {
    const { token, embed_url: embedUrl, expires_at: expiresAt } = await getEmbedToken(code)
    if (requestVersion !== iframeRequestVersion || section.value !== code) return
    // 后端校验独立的 Cookie 域；浏览器额外
    // 拒绝平台主机。Metabase 存储被限制在该源内。
    iframeSrc.value = isolatedEmbedUrl(embedUrl, token, window.location.origin)
    scheduleEmbedRenewal(Number(expiresAt) || 0, code, requestVersion)
  } catch (err) {
    if (requestVersion !== iframeRequestVersion) return
    iframeError.value = err?.code === "FORBIDDEN" ? "当前账号无权限查看该看板" : formatDataAnalysisError(err, { fallback: "看板加载失败，请稍后刷新。" })
  } finally {
    if (requestVersion === iframeRequestVersion) iframeLoading.value = false
  }
}

function clearEmbedRenewal() {
  if (embedRenewTimer) window.clearTimeout(embedRenewTimer)
  embedRenewTimer = null
  embedExpiresAt = 0
}

// 用途：在当前嵌入能力到期前安排安全重签。
// 参数：expiresAtSeconds 为期限，code 为看板，requestVersion 为请求版本。
// 返回值：无；原生模式及旧请求不会续签。
function scheduleEmbedRenewal(expiresAtSeconds, code, requestVersion) {
  clearEmbedRenewal()
  if (!expiresAtSeconds) return
  embedExpiresAt = expiresAtSeconds
  const delay = Math.max(5000, (expiresAtSeconds - Math.floor(Date.now() / 1000) - EMBED_RENEW_BEFORE_SECONDS) * 1000)
  embedRenewTimer = window.setTimeout(() => {
    // 仅为仍处于激活状态的嵌入区域重新签发令牌；令牌
    // 仅可使用一次，不能原地续期。应重新加载，
    // 避免 iframe 继续使用过期令牌交互。
    if (requestVersion !== iframeRequestVersion || section.value !== code) return
    if (!dashboardEmbedEnabled.value || !EMBEDDED_DASHBOARD_SECTIONS.includes(code)) return
    if (document.visibilityState === "hidden") {
      // 页签重新激活时由可见性监听器续期，
      // 不要创建短周期的后台定时循环。
      embedRenewTimer = null
      return
    }
    loadDashboard(code)
  }, delay)
}

// 用途：页签恢复可见时按当前能力检查嵌入期限。
// 参数：无。
// 返回值：无；原生模式不发起嵌入请求。
function onVisibilityChange() {
  if (document.visibilityState === "visible" && embedExpiresAt) {
    const code = DASHBOARD_CODES[section.value]
    if (code && dashboardEmbedEnabled.value && EMBEDDED_DASHBOARD_SECTIONS.includes(section.value)) {
      if (Math.floor(Date.now() / 1000) >= embedExpiresAt - EMBED_RENEW_BEFORE_SECONDS) loadDashboard(code)
      else scheduleEmbedRenewal(embedExpiresAt, code, iframeRequestVersion)
    }
  }
}

// loadSummary 加载当前有权查看分区的摘要，组合来源失败相互独立。
// 参数：code 为当前分区代码。
// 返回值：无；迟到响应在切换、身份刷新或卸载后失效。
async function loadSummary(code) {
  if (disposed || !me.value || !canViewDashboard(code)) return
  const requestVersion = ++summaryRequestVersion
  detailError.value = ""
  if (code === 'overview') {
    summaryLoading.value = true
    summaryError.value = ""
    try {
      const [contractResult, projectResult, trendResult, alertResult] = await Promise.allSettled([
        canViewDashboard("contract") ? getContractDashboardSummary() : Promise.resolve(null),
        canViewDashboard("project") ? getProjectDashboardSummary() : Promise.resolve(null),
        canViewDashboard("overview") ? getDashboardTrend() : Promise.resolve([]),
        // 预警摘要是总览中的可选模块；没有查看权限时静默跳过，不能把权限缺失误报成总览加载失败。
        hasPermission("alert.view") ? getAlertSummary() : Promise.resolve(null),
      ])
      if (requestVersion !== summaryRequestVersion || section.value !== code) return
      const failedParts = [
        ['合同摘要', contractResult],
        ['项目摘要', projectResult],
        ['趋势', trendResult],
        ['预警摘要', alertResult],
      ].filter(([, result]) => result.status === 'rejected').map(([label]) => label)
      overviewSummary.value = {
        contract: contractResult.status === "fulfilled" ? contractResult.value : null,
        project: projectResult.status === "fulfilled" ? projectResult.value : null,
      }
      dashboardTrend.value = trendResult.status === "fulfilled" ? (Array.isArray(trendResult.value) ? trendResult.value : trendResult.value?.items || []) : []
      alertSummary.value = alertResult.status === "fulfilled" ? alertResult.value : null
      summaryError.value = failedParts.length ? `${failedParts.join('、')}加载失败，页面仅展示已成功返回的数据。` : ""
    } catch (err) {
      if (requestVersion !== summaryRequestVersion) return
      overviewSummary.value = { contract: null, project: null }
      summaryError.value = formatDataAnalysisError(err, { fallback: "摘要加载失败，请稍后刷新。" })
    } finally {
      if (requestVersion === summaryRequestVersion) summaryLoading.value = false
    }
    return
  }
  if (!['contract', 'project', 'report', 'finance'].includes(code)) {
    summaryLoading.value = false
    summaryError.value = ""
    dashboardSummary.value = null
    overviewSummary.value = { contract: null, project: null }
    return
  }
  summaryLoading.value = true
  summaryError.value = ""
  detailError.value = ""
  try {
    const loaders = { contract: getContractDashboardSummary, project: getProjectDashboardSummary, report: getReportDashboardSummary, finance: getFinanceDashboardSummary }
    const result = await loaders[code]()
    if (requestVersion !== summaryRequestVersion || section.value !== code) return
    dashboardSummary.value = result
    if (code === 'contract' || code === 'project') await loadDetails(code, 1)

  } catch (err) {
    if (requestVersion !== summaryRequestVersion) return
    dashboardSummary.value = null
    summaryError.value = formatDataAnalysisError(err, { fallback: "摘要加载失败，请稍后刷新。" })
  } finally {
    if (requestVersion === summaryRequestVersion) summaryLoading.value = false
  }
}

// invalidateDashboardRequests 使切换、身份刷新和卸载前的异步响应失效。
// 参数：无。
// 返回值：无；同时清空旧身份可见的摘要和明细。
function invalidateDashboardRequests() {
  summaryRequestVersion += 1
  detailsRequestVersion += 1
  iframeRequestVersion += 1
  clearEmbedRenewal()
  dashboardSummary.value = null
  overviewSummary.value = { contract: null, project: null }
  dashboardTrend.value = []
  alertSummary.value = null
  contractDetails.value = { items: [], total: 0, page: 1, page_size: 20 }
  projectDetails.value = { available: false, items: [], total: 0, page: 1, page_size: 20 }
  detailError.value = ""
  detailLoading.value = false
  summaryLoading.value = false
  iframeSrc.value = ""
  iframeLoading.value = false
}

// loadDetails 独立读取当前分区的服务端分页明细。
// 参数：code 为合同或项目分区，page 为目标页码。
// 返回值：无；明细失败只更新明细错误，不覆盖成功摘要。
async function loadDetails(code, page) {
  if (disposed || !canViewDashboard(code)) return
  const ticket = ++detailsRequestVersion
  detailError.value = ""
  detailLoading.value = true
  try {
    const loader = code === 'contract' ? getContractDetails : getProjectDetails
    const value = await loader({ page, page_size: 20 })
    if (disposed || ticket !== detailsRequestVersion || section.value !== code) return
    if (code === 'contract') contractDetails.value = value
    else projectDetails.value = value
  } catch (err) {
    if (disposed || ticket !== detailsRequestVersion || section.value !== code) return
    if (code === 'contract') contractDetails.value = { items: [], total: 0, page, page_size: 20 }
    else projectDetails.value = { available: false, items: [], total: 0, page, page_size: 20 }
    detailError.value = `明细加载失败：${formatDataAnalysisError(err, { fallback: '请稍后重试。' })}`
  } finally {
    if (ticket === detailsRequestVersion && !disposed) detailLoading.value = false
  }
}

function scheduleRelatedRefresh() {
  if (relatedRefreshTimer) window.clearTimeout(relatedRefreshTimer)
  relatedRefreshTimer = window.setTimeout(async () => {
    relatedRefreshTimer = null
    await loadMe()
    if (disposed) return
    if (DASHBOARD_SECTIONS.includes(section.value)) await refreshCurrentDashboard()
  }, 50)
}

// 用途：刷新当前原生摘要并按服务端能力附加嵌入刷新。
// 参数：无。
// 返回值：无；摘要与嵌入分别保留各自错误状态。
async function refreshCurrentDashboard() {
  const code = DASHBOARD_CODES[section.value]
  if (!code || disposed || !canViewDashboard(code)) return
  const tasks = [loadSummary(code)]
  if (code === 'contract') tasks.push(historyPanel.value?.refresh?.())
  if (dashboardEmbedEnabled.value && EMBEDDED_DASHBOARD_SECTIONS.includes(section.value)) tasks.push(loadDashboard(code))
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
    summaryError.value = formatDataAnalysisError(error, { fallback: "退出系统失败，请稍后重试。" })
  } finally {
    isLoggingOut.value = false
  }
}

watch(() => section.value, (value) => {
  invalidateDashboardRequests()
  statusFilter.value = "全部"
  if (DASHBOARD_SECTIONS.includes(value)) {
    if (!me.value || loading.value || disposed) return
    if (!canViewDashboard(value)) {
      const fallback = visibleDashboardSections.value[0]
      if (fallback) router.replace({ name: "data_analysis", params: { section: fallback } })
      return
    }
    if (dashboardEmbedEnabled.value && EMBEDDED_DASHBOARD_SECTIONS.includes(value)) {
      loadDashboard(DASHBOARD_CODES[value])
    } else {
      // 离开嵌入看板时清理上一次令牌，避免业务摘要页残留旧 iframe 状态。
      iframeRequestVersion += 1
      clearEmbedRenewal()
      iframeSrc.value = ""
      iframeError.value = null
      iframeLoading.value = false
    }
    loadSummary(DASHBOARD_CODES[value])
  }
}, { flush: 'sync' })

watch(() => `${me.value?.tenant_id || ''}/${me.value?.user_id || ''}`, () => {
  invalidateDashboardRequests()
}, { flush: 'sync' })

watch(statusOptions, (options) => {
  if (!options.includes(statusFilter.value)) statusFilter.value = "全部"
})

onMounted(async () => {
  document.addEventListener("visibilitychange", onVisibilityChange)
  // 抽屉的 Escape 必须挂在 document 上：焦点在遮罩或侧栏里时事件不会冒泡到外壳根节点。
  document.addEventListener("keydown", closeMenuOnEscape)
  unsubscribeRelatedData = subscribeRelatedDataChanges(scheduleRelatedRefresh, { kinds: [RELATED_DATA.ORGANIZATIONS, RELATED_DATA.POSITIONS, RELATED_DATA.MEMBERSHIPS, RELATED_DATA.ROLE_CATALOG] })
  await loadMe()
  if (disposed) return
  if (DASHBOARD_SECTIONS.includes(section.value)) {
    if (!canViewDashboard(section.value)) {
      const fallback = visibleDashboardSections.value[0]
      if (fallback) await router.replace({ name: "data_analysis", params: { section: fallback } })
      return
    }
    const tasks = [loadSummary(DASHBOARD_CODES[section.value])]
    if (dashboardEmbedEnabled.value && EMBEDDED_DASHBOARD_SECTIONS.includes(section.value)) {
      tasks.unshift(loadDashboard(DASHBOARD_CODES[section.value]))
    }
    await Promise.all(tasks)
  }
})

onBeforeUnmount(() => {
  disposed = true
  meRequestVersion += 1
  invalidateDashboardRequests()
  embedActivity.destroy()
  clearEmbedRenewal()
  if (relatedRefreshTimer) window.clearTimeout(relatedRefreshTimer)
  if (unsubscribeRelatedData) unsubscribeRelatedData()
  document.removeEventListener("visibilitychange", onVisibilityChange)
  // 模块切走后不再持有 Escape 监听，避免去动已经卸载的抽屉状态。
  document.removeEventListener("keydown", closeMenuOnEscape)
})
</script>

<template>
  <div class="console-page da-shell">
    <aside id="da-sidebar" class="da-sidebar" :class="{ open: mobileMenuOpen }">
      <div class="da-brand">
        <span class="da-brand-mark"><ConsoleIcon name="logo" /></span>
        <span><b>数据看板与统计分析</b><small>DATA INTELLIGENCE</small></span>
        <button class="da-icon-button da-mobile-close" aria-label="关闭菜单" @click="mobileMenuOpen = false"><ConsoleIcon name="close" /></button>
      </div>
      <nav class="da-nav" aria-label="数据看板导航" data-first-run-anchor="subsystem-nav">
        <div v-for="group in navGroups" :key="group.label" class="da-nav-group">
          <div class="da-nav-label">{{ group.label }}</div>
          <button v-for="item in group.items" :key="item.key" v-show="!item.permission || hasPermission(item.permission)" class="da-nav-item" :class="{ active: section === item.key }" :aria-current="section === item.key ? 'page' : undefined" @click="navigate(item.key)">
            <ConsoleIcon :name="item.icon" /><span>{{ item.label }}</span>
          </button>
        </div>
        <div class="da-nav-group">
          <div class="da-nav-label">平台能力</div>
          <button class="da-nav-item" type="button" data-first-run-anchor="subsystem-portal" @click="returnToUnifiedPortal"><ConsoleIcon name="dashboard" /><span>返回子系统门户</span></button>
        </div>
      </nav>
      <div class="da-sidebar-user subsystem-sidebar-user">
        <span class="da-avatar">{{ currentUserInitial }}</span>
        <span class="da-sidebar-user-copy"><strong :title="currentUserName">{{ currentUserName }}</strong><small :title="currentUserRole">{{ currentUserRole }}</small></span>
        <button type="button" :disabled="isLoggingOut" aria-label="退出应用系统" @click="logoutSystem"><ConsoleIcon name="logout" /></button>
      </div>
    </aside>
    <div v-if="mobileMenuOpen" class="da-menu-mask" @click="mobileMenuOpen = false"></div>

    <main id="main-content" class="da-main" tabindex="-1">
      <header class="da-topbar">
        <button ref="menuButton" class="da-icon-button da-menu-button" aria-label="打开菜单" :aria-expanded="mobileMenuOpen ? 'true' : 'false'" aria-controls="da-sidebar" @click="mobileMenuOpen = true"><ConsoleIcon name="menu" /></button>
        <div class="da-breadcrumb"><span>数据看板与统计分析</span><ConsoleIcon name="chevron" /><strong>{{ currentMeta[0] }}</strong></div>
        <div class="da-top-tools"><span class="da-topbar-avatar">{{ currentUserInitial }}</span></div>
      </header>

      <div class="da-page">
        <section class="da-page-head" data-first-run-anchor="subsystem-title">
          <div><p class="da-eyebrow">DATA INTELLIGENCE</p><h1>{{ currentMeta[0] }}</h1><p>{{ currentMeta[1] }} · {{ dataScopeLabel }} <span v-if="scopeModeLabel" class="da-badge neutral">数据范围：{{ scopeModeLabel }}</span></p></div>
          <div v-if="statusOptions.length" class="da-page-filters" aria-label="看板筛选条件">
            <label>状态分布局部筛选<select v-model="statusFilter"><option v-for="option in statusOptions" :key="option" :value="option">{{ option }}</option></select></label>
          </div>
          <div class="da-actions">
            <button v-if="DASHBOARD_SECTIONS.includes(section)" class="da-button" :disabled="iframeLoading || summaryLoading" @click="refreshCurrentDashboard"><ConsoleIcon name="reset" />{{ iframeLoading || summaryLoading ? '加载中' : '刷新看板' }}</button>
          </div>
        </section>

        <p v-if="scopeEmptyHint" class="da-native-note" role="status">{{ scopeEmptyHint }}</p>

        <ErrorState v-if="loadError" title="会话读取失败" :error="loadError" @retry="loadMe" />

        <template v-else-if="DASHBOARD_SECTIONS.includes(section)">
          <LoadingState v-if="summaryLoading && ['contract', 'project', 'report', 'finance'].includes(section)" title="摘要加载中…" compact />
          <ErrorState v-else-if="summaryError && ['contract', 'project', 'report', 'finance'].includes(section)" title="摘要加载失败" :error="summaryError" @retry="loadSummary(DASHBOARD_CODES[section])" compact />
          <NativeDashboardView
            v-else-if="['overview', 'contract', 'project', 'report', 'finance'].includes(section)"
            :section="section"
            :contract-summary="section === 'overview' ? overviewSummary.contract : section === 'contract' ? dashboardSummary : null"
            :project-summary="section === 'overview' ? overviewSummary.project : section === 'project' ? dashboardSummary : null"
            :business-summary="['report', 'finance'].includes(section) ? dashboardSummary : null"
            :contract-details="contractDetails"
            :project-details="projectDetails"
            :detail-loading="detailLoading"
            :detail-error="detailError"
            @detail-page="loadDetails(section, $event)"
            :can-view-contract="canViewDashboard('contract')"
            :can-view-project="canViewDashboard('project')"
    :status-filter="statusFilter"
            :tenant-id="me?.tenant_id"
            :user-id="me?.user_id"
            :trend="section === 'overview' ? dashboardTrend : []"
            :alert-summary="section === 'overview' ? alertSummary : null"
          />
          <ContractImportHistoryPanel ref="historyPanel" :key="`${me?.tenant_id}/${me?.user_id}`" v-if="section === 'contract' && canViewDashboard('contract')" />
          <p v-if="summaryError && section === 'overview'" class="da-native-inline-error" role="alert">{{ summaryError }}</p>

          <section v-if="dashboardEmbedEnabled && EMBEDDED_DASHBOARD_SECTIONS.includes(section)" class="da-frame-panel">
            <header class="da-frame-head"><div><p>EMBEDDED DASHBOARD</p><b>{{ currentMeta[0] }}</b></div><span>经统一嵌入桥加载 · 数据实时刷新</span></header>
            <div class="da-frame-stage">
              <LoadingState v-if="iframeLoading" title="看板加载中…" compact />
              <ErrorState v-else-if="iframeError" :error="iframeError" @retry="loadDashboard(DASHBOARD_CODES[section])" compact />
              <iframe v-else ref="embedFrame" :src="iframeSrc" class="da-iframe" :title="`${currentMeta[0]}嵌入看板`" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" @load="embedActivity.initialize($event.target)" />
            </div>
          </section>
        </template>

        <AlertsCenterView v-else-if="section === 'alerts'" :permissions="permissions" />
        <DictionaryView v-else-if="section === 'dictionary'" :permissions="permissions" />
        <AdminSourcesView v-else-if="section === 'admin/sources'" :permissions="permissions" />
        <AlertRulesView v-else-if="section === 'admin/rules'" :permissions="permissions" />
      </div>
    </main>
  </div>
</template>
