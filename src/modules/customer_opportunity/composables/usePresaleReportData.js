import { ref } from 'vue'
import { getPresaleReportDistribution, getPresaleReportSummary, getPresaleReportTrend, requestPresaleReportExport } from '../api/presale.js'
import { formatCRMError } from '../api/errorMessages.js'
import { defaultReportFilters, normalizeReportRows, normalizeReportSummary, reportDateParam } from '../crmDisplay.js'

/**
 * 售前投入报表数据域（治理批次 5 CRM，自 CustomerOpportunityView.vue 逐字迁移）。
 * 收编：报表弹窗开关、装载/导出、汇总/趋势/分布三路状态。
 * 筛选 reactive 仍由视图持有（createPresaleReportFilters 装载选项），经注入传入；
 * reportBarWidth 依赖视图的 reportDistribution 注入引用（逐字保留原实现语义）。
 *
 * 注入项与组件内同名标识一一对应：reportFilters/resetMessages/showError/notice/error/
 * formatCRMError/presaleReportExportAvailable/getPresaleReportSummary/getPresaleReportTrend/
 * getPresaleReportDistribution/requestPresaleReportExport/reportDistribution。
 */
export function usePresaleReportData({ reportFilters, resetMessages, showError, notice, error, formatCRMError, presaleReportExportAvailable, getPresaleReportSummary, getPresaleReportTrend, getPresaleReportDistribution, requestPresaleReportExport, loadReportFilterOptions }) {
  const showReport = ref(false)
  const reportLoading = ref(false)
  const reportSummary = ref(null)
  const reportError = ref('')
  const reportTrend = ref([])
  const reportDistribution = ref([])

function reportParams() {
  return {
    from: reportDateParam(reportFilters.from), to: reportDateParam(reportFilters.to),
    organization_id: reportFilters.organization_id, person_id: reportFilters.person_id,
    opportunity_id: reportFilters.opportunity_id, dimension: reportFilters.dimension,
  }
}
function reportBarWidth(value) {
  const maximum = Math.max(0, ...reportDistribution.value.map((item) => Number(item.work_hours || 0)))
  return maximum > 0 ? `${Math.max(2, Number(value || 0) / maximum * 100)}%` : '0%'
}
async function openReports() {
  showReport.value = true
  reportError.value = ''
  await loadReportFilterOptions()
  await loadReports()
}
async function loadReports() {
  reportLoading.value = true; resetMessages()
  try {
    const params = reportParams()
    if (new Date(params.to) <= new Date(params.from)) {
      throw new Error('结束时间必须晚于开始时间。')
    }
    const [summary, trend, distribution] = await Promise.all([getPresaleReportSummary(params), getPresaleReportTrend(params), getPresaleReportDistribution(params)])
    reportSummary.value = normalizeReportSummary(summary)
    reportTrend.value = normalizeReportRows(trend)
    reportDistribution.value = normalizeReportRows(distribution)
  } catch (value) { reportError.value = formatCRMError(value, { fallback: '投入报表加载失败' }) } finally { reportLoading.value = false }
}

async function exportReport() {
  if (!presaleReportExportAvailable.value) {
    error.value = '售前报表导出当前不可用，请刷新页面或联系管理员。'
    return
  }
  try {
    const payload = reportParams()
    const result = await requestPresaleReportExport({ ...payload, opportunity_id: payload.opportunity_id ? Number(payload.opportunity_id) : 0 })
    const url = URL.createObjectURL(result.blob)
    try {
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = result.filename || 'presale-report.csv'; anchor.click()
    } finally { URL.revokeObjectURL(url) }
    notice.value = '售前投入报表 CSV 已生成并下载，包含汇总、趋势及所选维度分布。'
  } catch (value) {
    showError(value)
  }
}

  return {
    showReport, reportLoading, reportSummary, reportError, reportTrend, reportDistribution,
    reportParams, reportBarWidth, loadReports, exportReport,
  }
}
