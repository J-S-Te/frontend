import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createRequestScope } from '@/modules/platform/shared/composables/requestScope'
import { getProjectMonitoring } from '@/modules/project_management/api/projectManagement'
import { formatUserError } from '@/modules/shared/utils/userError.js'
import { formatDateTime } from '@/modules/project_management/projectDisplay'

/**
 * 在途项目实时监控域（治理批次 4 项目，自 ProjectManagementView.vue 逐字迁移）。
 * 收编：服务端快照状态、筛选/分页、状态分布聚合、15 秒轮询与可见性刷新、
 * 筛选防抖、请求作用域守卫与监听器生命周期。
 *
 * 注入项与组件内同名标识一一对应：activeSection/keyword/teamFilter/loadPersonnelNames/navigate/openProject。
 */
export function useProjectMonitoring({ activeSection, keyword, teamFilter, loadPersonnelNames, navigate, openProject }) {
// 监控页（PG-DASH-02）使用独立的服务端快照：项目、服务项、SLA 和事件在
// 同一授权范围内聚合。页面只提交筛选/分页，不再用普通项目列表重建“在途”口径。
const monitorFilter = ref('')
const monitoringSnapshot = ref({ items: [], recent_events: [], status_counts: {}, categories: [], teams: [], project_manager_ids: [], total: 0, page: 1, page_size: 20, server_time: '', snapshot_version: '' })
const monitoringLoading = ref(false)
const monitoringError = ref('')
const monitorPage = ref(1)
const monitorPageSize = ref(20)
const monitorCategory = ref('')
const monitorProjectManager = ref('')
const monitorSLAOnly = ref(false)
const monitorConflictOnly = ref(false)
const monitorDueFrom = ref('')
const monitorDueTo = ref('')
let monitoringPollTimer = 0
let monitoringFilterTimer = 0
const monitoringScope = createRequestScope()
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
  const counts = monitoringSnapshot.value.status_counts || {}
  const total = monitoringSnapshot.value.total || 1
  return buckets.map((bucket) => {
    const count = bucket.statuses.reduce((sum, status) => sum + Number(counts[status] || 0), 0)
    return { ...bucket, count, pct: Math.round((count / total) * 100) }
  }).filter((bucket) => bucket.count)
})
const monitoredStatusByProject = (status) => monitoredStatusMix.value.find((bucket) => bucket.statuses.includes(status))?.key || status
const monitoringRows = computed(() => monitoringSnapshot.value.items || [])
const monitoringTotalPages = computed(() => Math.max(1, Math.ceil(monitoringSnapshot.value.total / monitorPageSize.value)))
const monitoringUpdatedLabel = computed(() => monitoringSnapshot.value.server_time ? formatDateTime(monitoringSnapshot.value.server_time) : '尚未同步')
const monitoringLagSeconds = computed(() => monitoringSnapshot.value.server_time ? Math.max(0, Math.round((Date.now() - new Date(monitoringSnapshot.value.server_time).getTime()) / 1000)) : null)

function monitoringParams() {
  return {
    page: monitorPage.value, page_size: monitorPageSize.value, keyword: keyword.value.trim(), team: teamFilter.value,
    category: monitorCategory.value, project_manager_id: monitorProjectManager.value,
    risk: monitorFilter.value === 'risk', status: ['risk', ''].includes(monitorFilter.value) ? '' : monitorFilter.value,
    sla: monitorSLAOnly.value, conflict: monitorConflictOnly.value, due_from: monitorDueFrom.value, due_to: monitorDueTo.value,
  }
}
async function loadMonitoring({ quiet = false } = {}) {
  if (activeSection.value !== 'monitoring') return
  if (!quiet) monitoringLoading.value = true
  // 票据 key 含完整查询条件：轮询、筛选或翻页并发时只采纳最后一次请求，
  // 旧筛选的迟到响应不得覆盖新快照，其 finally 也不得关闭新请求的加载态。
  const params = monitoringParams()
  const ticket = monitoringScope.begin(`MONITOR:${JSON.stringify(params)}`)
  try {
    const snapshot = await getProjectMonitoring(params)
    if (!monitoringScope.isCurrent(ticket)) return
    monitoringSnapshot.value = snapshot
    monitoringError.value = ''
    if (monitorPage.value > monitoringTotalPages.value) { monitorPage.value = monitoringTotalPages.value; return loadMonitoring({ quiet }) }
    loadPersonnelNames()
  } catch (error) {
    if (!monitoringScope.isCurrent(ticket)) return
    monitoringError.value = formatUserError(error, { fallback: '监控数据刷新失败' })
  } finally {
    if (monitoringScope.isCurrent(ticket)) monitoringLoading.value = false
  }
}
function scheduleMonitoringPoll() {
  window.clearInterval(monitoringPollTimer)
  if (activeSection.value === 'monitoring') monitoringPollTimer = window.setInterval(() => {
    if (!document.hidden) loadMonitoring({ quiet: true })
  }, 15000)
}
function onMonitoringVisibility() {
  if (activeSection.value === 'monitoring' && !document.hidden) loadMonitoring({ quiet: true })
}
function resetMonitoringFilters() {
  keyword.value = ''; teamFilter.value = ''; monitorFilter.value = ''; monitorCategory.value = ''; monitorProjectManager.value = ''
  monitorSLAOnly.value = false; monitorConflictOnly.value = false; monitorDueFrom.value = ''; monitorDueTo.value = ''; monitorPage.value = 1
}
function changeMonitoringPage(page) {
  const next = Math.min(Math.max(1, page), monitoringTotalPages.value)
  if (next === monitorPage.value) return
  monitorPage.value = next
}
function openMonitoringAction(row) {
  if (row.action_section) navigate(row.action_section)
  else openProject(row.project)
}

  // 筛选变化防抖 250ms 后重查；翻页立即重查。
  // 进入监控页即装载快照；离开也保持轮询调度（原视图行为：每次 section 变化都重排轮询）。
  watch(activeSection, (section) => {
    if (section === 'monitoring') loadMonitoring()
    scheduleMonitoringPoll()
  })

watch([keyword, teamFilter, monitorFilter, monitorCategory, monitorProjectManager, monitorSLAOnly, monitorConflictOnly, monitorDueFrom, monitorDueTo], () => {
  if (activeSection.value !== 'monitoring') return
  monitorPage.value = 1
  window.clearTimeout(monitoringFilterTimer)
  monitoringFilterTimer = window.setTimeout(() => loadMonitoring(), 250)
})
watch(monitorPage, () => loadMonitoring())

  // 可见性与聚焦时立即刷新（浏览器标签切回不等待轮询周期）。
  onMounted(() => {
    document.addEventListener('visibilitychange', onMonitoringVisibility)
    window.addEventListener('focus', onMonitoringVisibility)
  })
  onBeforeUnmount(() => {
    window.clearTimeout(monitoringFilterTimer)
    window.clearInterval(monitoringPollTimer)
    document.removeEventListener('visibilitychange', onMonitoringVisibility)
    window.removeEventListener('focus', onMonitoringVisibility)
  })

  return {
    monitorFilter, monitoringSnapshot, monitoringLoading, monitoringError, monitorPage, monitorPageSize,
    monitorCategory, monitorProjectManager, monitorSLAOnly, monitorConflictOnly, monitorDueFrom, monitorDueTo,
    monitorFilterTabs, monitoredStatusMix, monitoredStatusByProject, monitoringRows, monitoringTotalPages,
    monitoringUpdatedLabel, monitoringLagSeconds,
    monitoringParams, loadMonitoring, scheduleMonitoringPoll, onMonitoringVisibility,
    resetMonitoringFilters, changeMonitoringPage, openMonitoringAction,
  }
}
