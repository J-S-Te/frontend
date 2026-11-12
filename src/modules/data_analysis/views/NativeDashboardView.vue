<script setup>
// 高保真模型的本地兜底视图：没有 Metabase 或业务摘要时，仍提供清晰的指标层级与数据状态。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import PaginationBar from "@/modules/shared/components/PaginationBar.vue"
import ConsoleIcon from "@/modules/shared/components/ConsoleIcon.vue"
import { dashboardFreshnessItems, dashboardFreshnessStatus } from "../utils/freshness.js"
import {
  PROJECT_CARD_KEYS,
  cardHiddenStorageKey,
  metricColumnCount,
  normalizeHiddenCardKeys,
  readHiddenCardKeys,
  reportStageCount,
  visibleDashboardCards,
  writeHiddenCardKeys,
} from "../utils/dashboardCardVisibility.js"

const emit = defineEmits(["detail-page", "navigate"])

const props = defineProps({
  section: { type: String, required: true },
  contractSummary: { type: Object, default: null },
  projectSummary: { type: Object, default: null },
  businessSummary: { type: Object, default: null },
  contractRegions: { type: Object, default: () => ({ available: false, items: [], basis: "" }) },
  regionsError: { type: String, default: "" },
  contractDetails: { type: Object, default: () => ({ items: [], total: 0 }) },
  projectDetails: { type: Object, default: () => ({ available: false, items: [], total: 0 }) },
  detailLoading: { type: Boolean, default: false },
  detailError: { type: String, default: "" },
  canViewContract: { type: Boolean, default: true },
  canViewProject: { type: Boolean, default: true },
  canViewFinance: { type: Boolean, default: true },
  statusFilter: { type: String, default: "全部" },
  trend: { type: Array, default: () => [] },
  alertSummary: { type: Object, default: null },
  // 指标卡显示偏好按「租户 + 用户」隔离；身份未就绪时只保留内存态，不写本地存储。
  tenantId: { type: [String, Number], default: "" },
  userId: { type: [String, Number], default: "" },
})

// 合同目标仅作为当前浏览器的展示配置保存；真实合同金额始终来自后端聚合快照。
const contractTargetWan = ref(0)
try {
  const savedTarget = Number(window.localStorage.getItem("data-analysis.contract-target-wan"))
  if (Number.isFinite(savedTarget) && savedTarget > 0) contractTargetWan.value = savedTarget
} catch {
  // 隐私模式或禁用存储时仍可正常查看看板，不影响业务数据。
}
watch(contractTargetWan, (value) => {
  try {
    if (Number.isFinite(value) && value > 0) window.localStorage.setItem("data-analysis.contract-target-wan", String(value))
    else window.localStorage.removeItem("data-analysis.contract-target-wan")
  } catch {
    // 存储不可用时忽略持久化失败。
  }
})

// —— 项目分区指标卡的显示/隐藏偏好 ——
// 纯展示偏好：开关只影响渲染，不改数据请求与口径；默认全部可见，允许全部隐藏后一键恢复。
// 键按「租户 + 用户」隔离，未知 key 与跨分区 key 在读写时丢弃。
const projectCardHiddenKeys = ref([])
const cardSettingsOpen = ref(false)
const cardSettingsRoot = ref(null)
const cardSettingsTrigger = ref(null)
const cardSettingsPanel = ref(null)

function browserStorage() {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

// 用途：按当前身份读取偏好；身份未就绪时只裁剪不属于本分区的 key，保留本次内存选择。
function applyStoredCardHiddenKeys() {
  if (!cardHiddenStorageKey(props.tenantId, props.userId)) {
    projectCardHiddenKeys.value = normalizeHiddenCardKeys(projectCardHiddenKeys.value, PROJECT_CARD_KEYS)
    return
  }
  projectCardHiddenKeys.value = readHiddenCardKeys(browserStorage(), props.tenantId, props.userId, PROJECT_CARD_KEYS)
}
watch([() => props.tenantId, () => props.userId], applyStoredCardHiddenKeys, { immediate: true })

// 用途：写入隐藏集合并即时生效；无身份时写入函数返回 false，只保留内存态。
function applyProjectCardHiddenKeys(keys) {
  const normalized = normalizeHiddenCardKeys(keys, PROJECT_CARD_KEYS)
  projectCardHiddenKeys.value = normalized
  writeHiddenCardKeys(browserStorage(), props.tenantId, props.userId, normalized, PROJECT_CARD_KEYS)
}

function isProjectCardVisible(key) {
  return !projectCardHiddenKeys.value.includes(String(key ?? ""))
}

// 开关使用原生 button，Enter/Space 由浏览器派发 click，无需额外 keydown（避免二次切换）。
function toggleProjectCard(key) {
  const value = String(key ?? "").trim()
  if (!PROJECT_CARD_KEYS.includes(value)) return
  applyProjectCardHiddenKeys(projectCardHiddenKeys.value.includes(value)
    ? projectCardHiddenKeys.value.filter((item) => item !== value)
    : [...projectCardHiddenKeys.value, value])
}

function resetProjectCards() {
  applyProjectCardHiddenKeys([])
}

// 设置面板的焦点管理：打开后聚焦第一个开关，关闭时把焦点还给触发按钮。
function openCardSettings() {
  cardSettingsOpen.value = !cardSettingsOpen.value
  if (!cardSettingsOpen.value) return
  nextTick(() => {
    const firstSwitch = cardSettingsPanel.value?.querySelector('[role="switch"]')
    ;(firstSwitch || cardSettingsTrigger.value)?.focus()
  })
}

function dismissCardSettings({ restoreFocus = false } = {}) {
  if (!cardSettingsOpen.value) return false
  const panel = cardSettingsPanel.value
  const focusInside = Boolean(panel && typeof document !== "undefined" && panel.contains(document.activeElement))
  cardSettingsOpen.value = false
  if (restoreFocus || focusInside) cardSettingsTrigger.value?.focus()
  return true
}

// 点击面板与触发按钮以外的区域关闭；触发按钮在 root 内，不会误关。
function onCardSettingsOutsideClick(event) {
  if (!cardSettingsOpen.value) return
  const root = cardSettingsRoot.value
  if (root && event.target instanceof Node && root.contains(event.target)) return
  dismissCardSettings()
}

function onCardSettingsKeydown(event) {
  if (!cardSettingsOpen.value) return
  if (event.key !== "Escape") return
  event.stopPropagation()
  dismissCardSettings({ restoreFocus: true })
}

onMounted(() => {
  document.addEventListener("click", onCardSettingsOutsideClick)
  document.addEventListener("keydown", onCardSettingsKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener("click", onCardSettingsOutsideClick)
  document.removeEventListener("keydown", onCardSettingsKeydown)
})
// 切换看板分区时收起面板，避免再次进入项目分区时残留展开态。
watch(() => props.section, () => { if (cardSettingsOpen.value) dismissCardSettings() })

const sectionMeta = {
  overview: { title: "经营总览", description: "高管落地页 · 一眼看全局" },
  contract: { title: "合同看板", description: "合同签约、执行与回款全景" },
  project: { title: "项目执行看板", description: "项目交付、进度与质量全景" },
  report: { title: "报告与质量看板", description: "报告编制、复核与签发效率" },
  finance: { title: "财务与经营看板", description: "应收、已核销回款与账龄分析" },
}

const metric = (label, value, suffix = "", tone = "", extra = {}) => ({ label, value, suffix, tone, key: extra.key || "", meta: extra.meta || "", target: extra.target || "", trendText: extra.trendText || "", trendTone: extra.trendTone || "" })

// contractCountTrend 比较最近两个同步周期的合同数量，输出带方向的趋势标注。
// 数量口径单一（无币种歧义）；样本不足两个周期时不产出趋势文本。
// 参数：rows 为按时间升序的月度趋势行。
// 返回值：趋势标注（trendText/trendTone），样本不足返回空。
function contractCountTrend(rows) {
  const count = (row) => numberValue(row?.contract_count)
  if (!Array.isArray(rows) || rows.length < 2) return { trendText: "", trendTone: "" }
  const latest = count(rows[rows.length - 1])
  const previous = count(rows[rows.length - 2])
  if (previous <= 0) return { trendText: "", trendTone: "" }
  const delta = Math.round(((latest - previous) / previous) * 1000) / 10
  return { trendText: `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% 较上月`, trendTone: delta >= 0 ? "up" : "down" }
}

function numberValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatInteger(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(numberValue(value))
}

function formatAmountMinor(value) {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(numberValue(value) / 1_000_000)
}

function formatPercent(value, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(digits)
}

const CONTRACT_STATUS_LABELS = {
  PENDING: "待审批",
  DRAFT: "草稿",
  ACTIVE: "生效中",
  EXPIRED: "已到期",
  COMPLETED: "已完成",
  TERMINATED: "已终止",
  ARCHIVED: "已归档",
  REJECTED: "已驳回",
}

function contractStatusLabel(value) {
  const normalized = String(value || "").trim().toUpperCase()
  return CONTRACT_STATUS_LABELS[normalized] || String(value || "—")
}

// contractStatusTone 把源状态映射到原型徽章色，未知状态保留中性色。
// 参数：value 为合同源状态。返回值：da-badge 的语义类名。
function contractStatusTone(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (["EXPIRED", "TERMINATED", "REJECTED"].includes(normalized)) return "risk"
  if (["PENDING", "DRAFT"].includes(normalized)) return "warning"
  if (["ACTIVE", "COMPLETED", "ARCHIVED"].includes(normalized)) return "normal"
  return "neutral"
}

const contractCurrencyItems = computed(() => Array.isArray(props.contractSummary?.currency_totals) ? props.contractSummary.currency_totals.filter((item) => item && item.currency) : [])
const primaryContractCurrency = computed(() => {
  const rows = [...contractCurrencyItems.value].sort((left, right) => numberValue(right.amount_minor) - numberValue(left.amount_minor))
  return rows[0] || null
})
const contractAmountWan = computed(() => {
  const cny = contractCurrencyItems.value.find((item) => String(item.currency).toUpperCase() === "CNY")
  return numberValue(cny ? cny.amount_minor : props.contractSummary?.total_amount_minor) / 1_000_000
})
const contractTargetRatio = computed(() => {
  if (contractTargetWan.value <= 0) return 0
  return contractAmountWan.value / contractTargetWan.value
})
const contractProgressWidth = computed(() => `${Math.min(100, Math.round(contractTargetRatio.value * 100))}%`)
const contractExcessWidth = computed(() => `${Math.min(100, Math.max(0, Math.round((contractTargetRatio.value - 1) * 100)))}%`)
const contractProgressLabel = computed(() => {
  if (contractTargetWan.value <= 0) return "设置目标后显示完成进度"
  if (contractTargetRatio.value > 1) return `已超额 ${(contractTargetRatio.value - 1) * 100 >= 10 ? Math.round((contractTargetRatio.value - 1) * 100) : ((contractTargetRatio.value - 1) * 100).toFixed(1)}%`
  return `完成 ${(contractTargetRatio.value * 100).toFixed(1)}%`
})

const activeSummary = computed(() => {
  if (props.section === "contract") return props.contractSummary
  if (props.section === "project") return props.projectSummary
  if (['report', 'finance'].includes(props.section)) return props.businessSummary
  return null
})

const summaryAvailable = computed(() => Boolean(activeSummary.value?.available))
// 数据状态来自后端 freshness：源更新时间、同步时间和本次查询时间不互相替代。
const summaryFreshness = computed(() => dashboardFreshnessStatus(activeSummary.value))
const summaryFreshnessItems = computed(() => (summaryAvailable.value ? dashboardFreshnessItems(activeSummary.value) : []))
const summaryStatusLabel = computed(() => {
  if (props.section === "overview") return "聚合快照"
  if (!summaryAvailable.value) return "暂无聚合快照"
  return summaryFreshness.value.label
})

const contractStatusItems = computed(() => {
  const contract = props.contractSummary || {}
  return [
    { label: "审批中", value: numberValue(contract.approval_contracts), tone: "tone-amber" },
    { label: "履行中", value: numberValue(contract.active_contracts), tone: "" },
    { label: "已到期", value: numberValue(contract.expired_contracts), tone: "tone-danger" },
  ]
})
const contractFunnelItems = computed(() => {
  const contract = props.contractSummary || {}
  return [
    { label: "有效商机", value: numberValue(contract.opportunity_count) },
    { label: "已转合同", value: numberValue(contract.won_contract_count) },
  ]
})
const contractDiscountItems = computed(() => Object.entries(props.contractSummary?.discount_buckets || {}).map(([label, value], index) => ({
  label,
  value: numberValue(value),
  tone: ["tone-green", "", "tone-amber", "tone-danger"][index] || "",
})))

const projectStatusItems = computed(() => Object.entries(props.projectSummary?.status_counts || {})
  .map(([label, value]) => ({ label, value: numberValue(value) }))
  .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "zh-CN")))

const breakdownItems = computed(() => {
  const items = props.section === "contract" ? contractStatusItems.value : projectStatusItems.value
  if (props.statusFilter === "全部") return items
  return items.filter((item) => item.label === props.statusFilter)
})

const maxBreakdownValue = computed(() => Math.max(1, ...breakdownItems.value.map((item) => item.value)))

// —— 趋势：按币种绘制原型折线图，并保留逐月明细（真实零值与缺失来源分开） ——
// trendItems 统一按业务月倒序，不依赖服务端返回顺序；趋势图和明细共用同一排序契约。
const trendItems = computed(() => [...(props.trend || [])]
  .filter((item) => item && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(item.period || "")))
  .sort((left, right) => String(right.period).localeCompare(String(left.period))))
const trendAscending = computed(() => [...(props.trend || [])]
  .filter((item) => item && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(item.period || "")))
  .sort((left, right) => String(left.period).localeCompare(String(right.period))))
const trendCurrencies = computed(() => [...new Set(trendAscending.value.flatMap((item) =>
  (item.currency_totals || []).map((row) => row.currency)))].sort())
const trendCurrency = ref("")
watch(trendCurrencies, (currencies) => {
  if (!currencies.includes(trendCurrency.value)) trendCurrency.value = currencies[0] || ""
}, { immediate: true })

// trendAmount 读取指定月份和币种的金额，缺币种保持零而不跨币种相加。
function trendAmount(item, currency) {
  return numberValue((item.currency_totals || []).find((row) => row.currency === currency)?.amount_minor)
}

const trendChartRows = computed(() => {
  if (!trendCurrency.value) return []
  return trendAscending.value
    .filter((item) => item.contract_available !== false)
    .map((item) => ({ period: item.period, amount: trendAmount(item, trendCurrency.value) }))
})
const trendChartMax = computed(() => Math.max(1, ...trendChartRows.value.map((row) => row.amount)))
const trendChartPoints = computed(() => {
  const rows = trendChartRows.value
  if (!rows.length) return []
  const width = 470
  const step = rows.length > 1 ? width / (rows.length - 1) : 0
  return rows.map((row, index) => ({
    ...row,
    x: rows.length > 1 ? 40 + index * step : 40 + width / 2,
    y: 170 - Math.round((row.amount / trendChartMax.value) * 150),
  }))
})
const trendChartArea = computed(() => {
  const points = trendChartPoints.value
  if (!points.length) return ""
  return [...points.map((point) => `${point.x},${point.y}`), `${points[points.length - 1].x},170`, `${points[0].x},170`].join(" ")
})
const trendChartPolyline = computed(() => trendChartPoints.value.map((point) => `${point.x},${point.y}`).join(" "))
const trendChartLabels = computed(() => {
  const points = trendChartPoints.value
  if (!points.length) return []
  const indexes = points.length === 1 ? [0] : [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]
  return indexes.map((index) => ({ x: points[index].x, label: `${Number(String(points[index].period).slice(5))}月` }))
})
const trendLatest = computed(() => trendChartPoints.value[trendChartPoints.value.length - 1] || null)

// trendWidth 按各币种或计数序列独立标尺计算柱宽。
// 参数：item 为月度点，series 为币种代码或计数字段名。
// 返回值：非负百分比；真实零值为0%。
function trendWidth(item, series) {
  const amount = /^[A-Z]{3}$/.test(series)
  const read = (row) => amount ? trendAmount(row, series) : numberValue(row[series])
  const value = read(item)
  const maximum = Math.max(1, ...trendItems.value.map(read))
  return `${value <= 0 ? 0 : Math.max(4, Math.round(value / maximum * 100))}%`
}

// —— 区域分布：金额/数量双口径，多币种分行不合计 ——
const regionMode = ref("amount")
const regionRows = computed(() => {
  const rows = Array.isArray(props.contractRegions?.items) ? props.contractRegions.items : []
  return [...rows].sort((left, right) => {
    const key = regionMode.value === "amount" ? "amount_minor" : "contract_count"
    return numberValue(right[key]) - numberValue(left[key]) || String(left.region).localeCompare(String(right.region), "zh-CN")
  })
})
const regionMax = computed(() => Math.max(1, ...regionRows.value.map((row) =>
  regionMode.value === "amount" ? numberValue(row.amount_minor) : numberValue(row.contract_count))))
function regionBarWidth(row) {
  const value = regionMode.value === "amount" ? numberValue(row.amount_minor) : numberValue(row.contract_count)
  return `${value <= 0 ? 0 : Math.max(4, Math.round(value / regionMax.value * 100))}%`
}

const activeDetails = computed(() => props.section === 'contract' ? props.contractDetails : props.projectDetails)
const conversionRate = computed(() => {
  const total = numberValue(props.contractSummary?.opportunity_count)
  return total > 0 ? `${(numberValue(props.contractSummary?.won_contract_count) / total * 100).toFixed(2)}%` : '不可计算（有效商机为0）'
})
const alertItems = computed(() => Object.entries(props.alertSummary?.by_severity || {}).map(([label, value]) => ({ label, value: numberValue(value) })))
// alertTypeLabels 覆盖迁移 000002 声明的五类预警类型；未知键保留原文兜底。
const alertTypeLabels = { CONTRACT_EXPIRY: '合同到期', PAYMENT_OVERDUE: '付款逾期', PROJECT_DELAY: '项目延期', REPORT_OVERDUE: '报告超期', ISSUE_UNCLOSED: '异常未闭环' }
// alertTypeItems 消费后端 by_type 聚合（原型预警聚合卡按类型展示）；未知类型保留编码。
const alertTypeItems = computed(() => Object.entries(props.alertSummary?.by_type || {}).map(([key, value]) => ({ label: alertTypeLabels[key] || key, value: numberValue(value) })))
// alertBreakdownItems 在旧服务缺少 by_type 时回退到严重度分布，不把“接口未提供”展示成“没有预警”。
const alertBreakdownItems = computed(() => alertTypeItems.value.length ? alertTypeItems.value : alertItems.value)
const maxAlertValue = computed(() => Math.max(1, ...alertBreakdownItems.value.map((item) => item.value)))

function barWidth(value) {
  const normalized = numberValue(value)
  if (normalized <= 0) return "0%"
  return `${Math.max(4, Math.round((normalized / maxBreakdownValue.value) * 100))}%`
}

// funnelWidth 使用有效商机分母计算漏斗柱宽。
// 参数：value 为当前漏斗项数量。
// 返回值：百分比；分母为0时返回0%并由文案说明不可计算。
function funnelWidth(value) {
  const denominator = numberValue(props.contractSummary?.opportunity_count)
  return `${denominator > 0 ? Math.min(100, Math.max(0, numberValue(value) / denominator * 100)) : 0}%`
}

// alertWidth 计算预警计数柱宽并保持真实零值。
// 参数：value 为当前级别计数。
// 返回值：按预警最大值缩放的百分比。
function alertWidth(value) {
  return `${numberValue(value) <= 0 ? 0 : Math.max(4, Math.round((numberValue(value) / maxAlertValue.value) * 100))}%`
}

// —— 项目状态环图 ——
const PROJECT_STATUS_COLORS = ["#2563eb", "#059669", "#f59e0b", "#94a3b8", "#8b5cf6"]
const projectStatusTotal = computed(() => breakdownItems.value.reduce((total, item) => total + item.value, 0))
const projectStatusSlices = computed(() => {
  const circumference = 2 * Math.PI * 70
  let offset = 0
  return breakdownItems.value.map((item, index) => {
    const length = projectStatusTotal.value > 0 ? item.value / projectStatusTotal.value * circumference : 0
    const slice = {
      ...item,
      color: PROJECT_STATUS_COLORS[index % PROJECT_STATUS_COLORS.length],
      length,
      offset,
      percent: projectStatusTotal.value > 0 ? Math.round(item.value / projectStatusTotal.value * 100) : 0,
    }
    offset += length
    return slice
  })
})

// —— 报告与财务 ——
const reportStatusItems = computed(() => Object.entries(props.businessSummary?.metrics?.status_counts || {}).map(([label, value]) => ({ label, value: numberValue(value) })).sort((left, right) => right.value - left.value))
const firstPassRate = computed(() => {
  const value = props.businessSummary?.metrics?.first_pass_rate
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Math.min(100, Math.max(0, Number(value)))
})
const firstPassLength = computed(() => (firstPassRate.value === null ? 0 : firstPassRate.value / 100 * 2 * Math.PI * 70))
const financeRows = computed(() => Array.isArray(props.businessSummary?.metrics?.currencies) ? [...props.businessSummary.metrics.currencies].sort((left, right) => numberValue(right.original_minor) - numberValue(left.original_minor)) : [])
const primaryFinance = computed(() => financeRows.value[0] || null)
const financeReceiptLabel = computed(() => {
  const month = String(props.businessSummary?.metrics?.month || "")
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `${month}登记回款` : "本月登记回款"
})
const currencyItems = computed(() => financeRows.value)
const missingMetricLabels = { first_pass_rate: '首次通过率见下方真实审核事实统计。', open_complaints: '客户投诉统计本轮暂缓。', recognized_income: '收入确认见下方财务独立复核账本统计。', department_cost: '部门、人员及项目确认成本见下方成本归属统计。' }
const reportMissingMetrics = computed(() => Array.isArray(props.businessSummary?.missing_metrics) && props.businessSummary.missing_metrics.length
  ? props.businessSummary.missing_metrics
  : ['first_pass_rate', 'open_complaints'])

const projectStatusCounts = computed(() => props.projectSummary?.status_counts || {})
// completedProjectCount 从后端项目状态分布读取“已完成”；快照不可用时返回 null，
// 不能被展示成真实 0。状态词表来自项目子系统生命周期枚举。
const completedProjectCount = computed(() => {
  if (!props.projectSummary?.available) return null
  const counts = projectStatusCounts.value
  const key = Object.keys(counts).find((item) => item.trim().toUpperCase() === "COMPLETED" || item.trim() === "已完成")
  return key ? numberValue(counts[key]) : 0
})

// 用途：按可用的真实摘要构造当前看板指标，并标明财务回款事实期间。
// 参数：无，读取当前视图传入的摘要与权限可见状态。
// 返回值：可展示的指标；缺失值继续使用不可用标记。
function metricsForSection() {
  const contract = props.contractSummary || {}
  const project = props.projectSummary || {}
  if (props.section === "overview") {
    // 原型经营总览的两行三卡：签约金额 / 回款率 / 完成项目数，应收超期 / 待处理预警 / 在执项目。
    // 指标卡只消费真实快照；无权限或无来源时展示“—”，不补零。
    const trendRows = trendAscending.value
    const finance = primaryFinance.value
    const highCount = numberValue(props.alertSummary?.by_severity?.CRITICAL) + numberValue(props.alertSummary?.by_severity?.HIGH)
    const contractPrimary = primaryContractCurrency.value
    const rectifying = reportStageCount(project.report_stage_counts, "RECTIFYING")
    return [
      metric("签约金额", contract.available && contractPrimary ? formatAmountMinor(contractPrimary.amount_minor) : "—", contractPrimary ? `万${contractPrimary.currency}` : "含税", "", {
        target: props.canViewContract ? "contract" : "",
        ...contractCountTrend(trendRows.map((row) => ({ contract_count: row.contract_count }))),
        meta: contractCurrencyItems.value.length > 1 ? `另有 ${contractCurrencyItems.value.length - 1} 个币种` : "",
      }),
      metric("回款率（本月）", finance ? formatPercent(finance.collection_rate) : "—", "%", "", {
        target: props.canViewFinance ? "finance" : "",
        meta: finance ? (financeRows.value.length > 1 ? `按${finance.currency}口径` : "") : "暂无财务来源",
      }),
      metric("完成项目数", completedProjectCount.value === null ? "—" : formatInteger(completedProjectCount.value), "个", "", {
        target: props.canViewProject ? "project" : "",
        meta: completedProjectCount.value === null
          ? "暂无项目快照"
          : (rectifying.available ? `已完成状态 · 整改中项目 ${formatInteger(rectifying.value)} 个` : "已完成状态 · 整改中项目未采集"),
      }),
      metric("应收账款（账龄 >90天）", finance ? formatAmountMinor(finance.over_90_minor) : "—", finance ? `万${finance.currency}` : "含税", numberValue(finance?.over_90_minor) > 0 ? "danger" : "", { target: props.canViewFinance ? "finance" : "", meta: finance ? "需持续关注" : "暂无财务来源" }),
      metric("待处理预警", props.alertSummary ? formatInteger(numberValue(props.alertSummary.open)) : "—", "项", highCount > 0 ? "danger" : "", {
        key: "pending-alerts",
        target: props.alertSummary ? "alert" : "",
        meta: props.alertSummary ? (highCount > 0 ? `${formatInteger(highCount)} 项高严重度` : "需跟进") : "暂无预警来源",
      }),
      metric("在执项目数", project.available ? formatInteger(project.in_flight_projects) : "—", "个", "", { target: props.canViewProject ? "project" : "", meta: project.available ? "进行中项目" : "暂无项目快照" }),
    ]
  }
  if (props.section === "contract") {
    const amountMetrics = contractCurrencyItems.value.length
      ? contractCurrencyItems.value.map((item) => metric(`合同金额 ${item.currency}`, formatAmountMinor(item.amount_minor), `万${item.currency}`))
      : [metric("合同总金额", contract.available ? formatAmountMinor(contract.total_amount_minor) : "—", "万CNY")]
    return [
      ...amountMetrics.slice(0, 1),
      metric("合同总数", contract.available ? formatInteger(contract.total_contracts) : "—", "份"),
      metric("审批中", contract.available ? formatInteger(contract.approval_contracts) : "—", "份", "warn"),
      metric("履行中", contract.available ? formatInteger(contract.active_contracts) : "—", "份"),
      metric("已到期", contract.available ? formatInteger(contract.expired_contracts) : "—", "份", "danger"),
    ]
  }
  if (props.section === "project") {
    // 整改中是报告的独立阶段（与项目状态正交）：只读后端聚合快照的 RECTIFYING 计数，
    // 旧快照没有 report_stage_counts 时显示「—」+「未采集」，不用 0 冒充未知。
    const rectifying = reportStageCount(project.report_stage_counts, "RECTIFYING")
    return [
      metric("项目总数", project.available ? formatInteger(project.project_count) : "—", "个", "", { key: "project_total" }),
      metric("进行中项目", project.available ? formatInteger(project.in_flight_projects) : "—", "个", "", { key: "in_flight" }),
      metric("风险项目", project.available ? formatInteger(project.risk_projects) : "—", "个", "danger", { key: "risk" }),
      metric("服务项", project.available ? formatInteger(project.service_items) : "—", "项", "", { key: "service_items" }),
      metric("整改中项目", rectifying.available ? formatInteger(rectifying.value) : "—", "个", "warn", {
        key: "rectifying",
        meta: rectifying.available ? "报告整改阶段" : "未采集",
      }),
    ]
  }
  if (props.section === "report") {
    const values = props.businessSummary?.available ? props.businessSummary.metrics || {} : {}
    return [
      metric("报告周期 P50", values.cycle_p50_days == null ? "—" : Number(values.cycle_p50_days).toFixed(2), "天"),
      metric("首次通过率", firstPassRate.value === null ? "—" : formatPercent(firstPassRate.value), "%", "", { meta: firstPassRate.value === null ? "缺少首轮审核事实" : "机审+人审" }),
      metric("有效报告版本", values.active_reports == null ? "—" : formatInteger(values.active_reports), "份"),
    ]
  }
  const finance = primaryFinance.value
  return [
    metric("回款率（本月）", finance ? formatPercent(finance.collection_rate) : "—", "%", "", { meta: financeRows.value.length > 1 ? "分币种" : "" }),
    metric("未清应收", finance ? formatAmountMinor(finance.open_minor) : "—", finance ? `万${finance.currency}` : ""),
    metric("超期90天应收", finance ? formatAmountMinor(finance.over_90_minor) : "—", finance ? `万${finance.currency}` : "", "danger"),
    metric("本月登记回款", finance ? formatAmountMinor(finance.month_receipts_minor) : "—", finance ? `万${finance.currency}` : ""),
  ]
}

// 项目分区按隐藏偏好过滤卡片；其他分区保持既有全部展示，不做重排。
const sectionMetrics = computed(() => metricsForSection())
const projectVisibleMetrics = computed(() => visibleDashboardCards(sectionMetrics.value, projectCardHiddenKeys.value))
const displayedMetrics = computed(() => (props.section === "project" ? projectVisibleMetrics.value : sectionMetrics.value))
const allProjectCardsHidden = computed(() => props.section === "project" && sectionMetrics.value.length > 0 && projectVisibleMetrics.value.length === 0)
// 列数跟随可见卡片数变化，隐藏后不留下空列；全隐藏时网格不渲染，列数类仍保持合法。
const metricsColumnsClass = computed(() => {
  if (props.section === "project") return `da-native-metrics-cols-${metricColumnCount(displayedMetrics.value.length)}`
  if (props.section === "overview") return "da-native-metrics-cols-3"
  if (props.section === "contract") return "da-native-metrics-cols-5"
  if (props.section === "report") return "da-native-metrics-cols-3"
  if (props.section === "finance") return "da-native-metrics-cols-4"
  return ""
})
</script>

<template>
  <section class="da-native-dashboard">
    <div v-if="section !== 'overview'" class="da-native-statusline">
      <span class="da-badge" :class="summaryFreshness.stale ? 'risk' : 'neutral'">{{ summaryStatusLabel }}</span>
      <span v-if="activeSummary?.snapshot_at" class="da-native-status-time">快照 {{ activeSummary.snapshot_at }}</span>
    </div>

    <aside v-if="summaryAvailable && summaryFreshness.present" class="da-native-freshness" :class="{ stale: summaryFreshness.stale }" role="status">
      <div class="da-native-freshness-head">
        <span class="da-badge" :class="summaryFreshness.stale ? 'risk' : 'normal'">{{ summaryFreshness.badge }}</span>
        <p v-if="summaryFreshness.stale && summaryFreshness.reason">{{ summaryFreshness.reason }}</p>
      </div>
      <dl class="da-native-freshness-grid">
        <template v-for="item in summaryFreshnessItems" :key="item.key"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></template>
      </dl>
      <p class="da-native-freshness-note">源数据更新时间、最近成功同步时间与本次查询时间分别展示；本次查询时间不代表源数据更新时间。</p>
    </aside>

    <p v-if="businessSummary?.source_code && section !== 'overview'" class="da-native-note">来源：{{ businessSummary.source_code }}</p>

    <div v-if="section === 'project'" class="da-native-metrics-toolbar">
      <div ref="cardSettingsRoot" class="da-native-card-settings">
        <button
          ref="cardSettingsTrigger"
          type="button"
          class="da-native-card-settings-trigger"
          aria-haspopup="dialog"
          :aria-expanded="cardSettingsOpen"
          aria-controls="da-project-card-settings"
          @click="openCardSettings"
        >
          <ConsoleIcon name="settings" /><span>指标卡设置</span><em>{{ displayedMetrics.length }}/{{ sectionMetrics.length }}</em>
        </button>
        <div
          v-if="cardSettingsOpen"
          id="da-project-card-settings"
          ref="cardSettingsPanel"
          class="da-native-card-settings-panel"
          role="dialog"
          aria-label="指标卡显示设置"
        >
          <div class="da-native-card-settings-head"><b>指标卡显示</b><span>默认全部显示</span></div>
          <ul class="da-native-card-settings-list">
            <li v-for="card in sectionMetrics" :key="card.key">
              <button
                type="button"
                class="da-native-card-switch"
                role="switch"
                :aria-checked="isProjectCardVisible(card.key)"
                @click="toggleProjectCard(card.key)"
              >
                <span class="da-native-card-switch-text"><b>{{ card.label }}</b><small>{{ card.meta || '项目指标' }}</small></span>
                <span class="da-native-card-switch-track" aria-hidden="true"><i></i></span>
              </button>
            </li>
          </ul>
          <div class="da-native-card-settings-foot">
            <span>{{ allProjectCardsHidden ? '已隐藏全部指标卡' : `已隐藏 ${projectCardHiddenKeys.length} 张` }}</span>
            <button type="button" class="da-native-card-settings-reset" :disabled="!projectCardHiddenKeys.length" @click="resetProjectCards">恢复默认</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!allProjectCardsHidden" class="da-native-metrics" :class="metricsColumnsClass" role="group" :aria-label="`本分区指标卡，共 ${displayedMetrics.length} 项`">
      <article v-for="item in displayedMetrics" :key="item.key || item.label" class="da-native-metric" :class="[item.tone, { clickable: Boolean(item.target) }]" :role="item.target ? 'button' : undefined" :tabindex="item.target ? 0 : undefined" @click="item.target && emit('navigate', item.target)" @keydown.enter="item.target && emit('navigate', item.target)">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong><small>{{ item.suffix }}</small>
        <p v-if="item.trendText" class="da-native-metric-trend" :class="item.trendTone">{{ item.trendText }}</p>
        <p v-if="item.meta" class="da-native-metric-meta">{{ item.meta }}</p>
        <template v-if="section === 'contract' && item.label === '合同总金额' && contractSummary?.available">
          <div class="da-contract-target-row">
            <label for="contract-target">目标</label>
            <input id="contract-target" v-model.number="contractTargetWan" type="number" min="0" step="1" placeholder="万元" />
            <small>万元</small>
          </div>
          <div v-if="contractTargetWan > 0" class="da-contract-progress" role="progressbar" :aria-valuenow="Math.round(contractTargetRatio * 100)" aria-valuemin="0" :aria-valuemax="100">
            <i class="da-contract-progress-track"><em :style="{ width: contractProgressWidth }"></em><b v-if="contractTargetRatio > 1" :style="{ width: contractExcessWidth }"></b></i>
            <span :class="{ excess: contractTargetRatio > 1 }">{{ contractProgressLabel }}</span>
          </div>
        </template>
      </article>
    </div>
    <p v-if="allProjectCardsHidden" class="da-native-metrics-empty" role="status">
      <span>已隐藏全部指标卡</span>
      <button type="button" class="da-native-card-settings-reset" @click="resetProjectCards">恢复默认</button>
    </p>

    <!-- ===== 经营总览：签约趋势 + 预警聚合 ===== -->
    <div v-if="section === 'overview'" class="da-native-columns">
      <article class="da-native-panel">
        <header><b>签约金额趋势（万元·含税）</b><span>合同签约事实 · T+1</span></header>
        <div v-if="trendChartRows.length" class="da-chart-tabs">
          <button v-for="currency in trendCurrencies" :key="currency" type="button" class="da-chart-tab" :class="{ active: trendCurrency === currency }" @click="trendCurrency = currency">{{ currency }}</button>
        </div>
        <svg v-if="trendChartRows.length" class="da-chart" viewBox="0 0 520 200" role="img" :aria-label="`签约金额趋势，${trendCurrency} 币种`">
          <line class="da-chart-grid" x1="40" y1="170" x2="510" y2="170" />
          <line class="da-chart-grid" x1="40" y1="20" x2="40" y2="170" />
          <polyline class="da-chart-area" :points="trendChartArea" />
          <polyline class="da-chart-line" :points="trendChartPolyline" />
          <circle v-for="point in trendChartPoints" :key="point.period" class="da-chart-dot" :cx="point.x" :cy="point.y" r="2.5" />
          <text v-for="label in trendChartLabels" :key="label.x" class="da-chart-label" :x="label.x" y="190" text-anchor="middle">{{ label.label }}</text>
          <text v-if="trendLatest" class="da-chart-value" :x="trendLatest.x" :y="Math.max(14, trendLatest.y - 10)" text-anchor="middle">{{ formatAmountMinor(trendLatest.amount) }} 万</text>
        </svg>
        <div v-else class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>暂无趋势快照</b><p>完成授权来源同步后展示真实月度趋势；不以演示数据填充。</p></div>
        <details class="da-native-trend-detail">
          <summary>展开逐月明细（{{ trendItems.length }} 个月）</summary>
          <template v-for="item in trendItems" :key="item.period">
            <template v-if="canViewContract && item.contract_available !== false">
              <div v-for="currency in trendCurrencies" :key="`${item.period}/${currency}`" class="da-native-bar-row">
                <span>{{ item.period }} {{ currency }}</span><i><em :style="{ width: trendWidth(item, currency) }"></em></i><small>{{ formatAmountMinor(trendAmount(item, currency)) }} 万{{ currency }}</small>
              </div>
              <div class="da-native-bar-row"><span>{{ item.period }} 合同数</span><i><em :style="{ width: trendWidth(item, 'contract_count') }"></em></i><small>{{ formatInteger(item.contract_count) }} 份</small></div>
            </template>
            <div v-if="canViewProject && item.project_available !== false" class="da-native-bar-row"><span>{{ item.period }} 项目数</span><i><em :style="{ width: trendWidth(item, 'project_count') }"></em></i><small>{{ formatInteger(item.project_count) }} 个</small></div>
            <p v-if="canViewContract && item.contract_available === false" class="da-native-note">{{ item.period }}：无当月合同事实，不计为0。</p>
            <p v-if="canViewProject && item.project_available === false" class="da-native-note">{{ item.period }}：无当月项目快照，不计为0。</p>
          </template>
          <p class="da-native-note">金额按原币种独立量纲展示，各币种和数量序列各用独立标尺，不跨币种合计。</p>
        </details>
      </article>
      <article class="da-native-panel">
        <header><b>预警聚合</b><span>来源：预警中心</span></header>
        <div v-if="alertBreakdownItems.length" class="da-native-bars">
          <div v-for="(item, index) in alertBreakdownItems" :key="item.label" class="da-native-bar-row" :class="index === 0 ? 'tone-danger' : index === 1 ? 'tone-amber' : ''">
            <span>{{ item.label }}</span><i><em :style="{ width: alertWidth(item.value) }"></em></i><small>{{ formatInteger(item.value) }} 条</small>
          </div>
          <p class="da-native-note">未关闭 {{ formatInteger(numberValue(alertSummary?.open) + numberValue(alertSummary?.ack)) }} 条，共 {{ formatInteger(numberValue(alertSummary?.total)) }} 条；预警数据与预警中心同源。</p>
        </div>
        <div v-else class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>暂无预警摘要</b><p>当前租户没有可展示的预警聚合数据。</p></div>
      </article>
    </div>

    <!-- ===== 合同看板：趋势 + 区域分布 / 漏斗 + 折扣 ===== -->
    <div v-if="section === 'contract'" class="da-native-columns">
      <article class="da-native-panel">
        <header><b>签约金额趋势</b><span>同比/环比 · 含税万元</span></header>
        <div v-if="trendChartRows.length" class="da-chart-tabs">
          <button v-for="currency in trendCurrencies" :key="currency" type="button" class="da-chart-tab" :class="{ active: trendCurrency === currency }" @click="trendCurrency = currency">{{ currency }}</button>
        </div>
        <svg v-if="trendChartRows.length" class="da-chart" viewBox="0 0 520 200" role="img" :aria-label="`合同签约金额趋势，${trendCurrency} 币种`">
          <line class="da-chart-grid" x1="40" y1="170" x2="510" y2="170" />
          <line class="da-chart-grid" x1="40" y1="20" x2="40" y2="170" />
          <polyline class="da-chart-area" :points="trendChartArea" />
          <polyline class="da-chart-line" :points="trendChartPolyline" />
          <circle v-for="point in trendChartPoints" :key="point.period" class="da-chart-dot" :cx="point.x" :cy="point.y" r="2.5" />
          <text v-for="label in trendChartLabels" :key="label.x" class="da-chart-label" :x="label.x" y="190" text-anchor="middle">{{ label.label }}</text>
          <text v-if="trendLatest" class="da-chart-value" :x="trendLatest.x" :y="Math.max(14, trendLatest.y - 10)" text-anchor="middle">{{ formatAmountMinor(trendLatest.amount) }} 万</text>
        </svg>
        <div v-else class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>暂无趋势快照</b><p>合同来源完成一次成功同步后展示真实月度趋势。</p></div>
      </article>
      <article class="da-native-panel">
        <header><b>区域分布</b><span>金额 ↔ 数量可切换</span></header>
        <div class="da-chart-tabs">
          <button type="button" class="da-chart-tab" :class="{ active: regionMode === 'amount' }" @click="regionMode = 'amount'">金额</button>
          <button type="button" class="da-chart-tab" :class="{ active: regionMode === 'count' }" @click="regionMode = 'count'">数量</button>
        </div>
        <div v-if="contractRegions?.available && regionRows.length" class="da-native-bars">
          <div v-for="row in regionRows" :key="`${row.region}/${row.currency}`" class="da-native-bar-row">
            <span>{{ row.region }}<small class="da-region-currency">{{ row.currency }}</small></span>
            <i><em :style="{ width: regionBarWidth(row) }"></em></i>
            <small>{{ regionMode === 'amount' ? `${formatAmountMinor(row.amount_minor)} 万${row.currency}` : `${formatInteger(row.contract_count)} 单` }}</small>
          </div>
          <p class="da-native-note">{{ contractRegions.basis }}</p>
        </div>
        <div v-else class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>{{ contractRegions?.available ? '当前范围内暂无区域签约事实' : '区域分布暂不可用' }}</b><p>{{ contractRegions?.available ? '合同来源已接入，但该口径下没有可展示的区域聚合；空列表不代表金额为 0。' : (regionsError || contractRegions?.basis || '当前来源尚未提供区域聚合；不以演示数据填充。') }}</p></div>
      </article>
    </div>

    <div v-if="section === 'contract'" class="da-native-columns da-native-columns-even">
      <article class="da-native-panel">
        <header><b>商机→合同转化率漏斗</b><span>聚合级</span></header>
        <div v-if="summaryAvailable && contractSummary?.conversion_available" class="da-native-bars">
          <svg class="da-chart" viewBox="0 0 480 150" role="img" aria-label="商机到合同转化漏斗">
            <polygon points="60,10 420,10 360,62 120,62" fill="#EFF6FF" stroke="#2563EB" />
            <text x="240" y="41" fill="#1D4ED8" font-size="12" text-anchor="middle">有效商机 {{ formatInteger(contractSummary.opportunity_count) }}</text>
            <polygon points="120,78 360,78 310,130 170,130" fill="#DBEAFE" stroke="#3B82F6" />
            <text x="240" y="109" fill="#1D4ED8" font-size="12" text-anchor="middle">已转合同 {{ formatInteger(contractSummary.won_contract_count) }}</text>
          </svg>
          <p class="da-native-note">转化率：{{ conversionRate }}；{{ contractSummary.conversion_basis }}</p>
        </div>
        <div v-else class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>暂无转化来源快照</b><p>商机与合同来源均首次成功后展示同范围转化漏斗。</p></div>
      </article>
      <article class="da-native-panel">
        <header><b>折扣分析（区间分布）</b><span>只读</span></header>
        <div v-if="summaryAvailable && contractDiscountItems.length" class="da-native-bars">
          <div v-for="item in contractDiscountItems" :key="item.label" class="da-native-bar-row" :class="item.tone"><span>{{ item.label }}</span><i><em :style="{ width: barWidth(item.value) }"></em></i><small>{{ formatInteger(item.value) }}</small></div>
        </div>
        <div v-else class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>折扣无法计算</b><p>缺少权威标准报价及币种基准，不能计算折扣区间。</p></div>
        <p class="da-native-note">{{ contractSummary?.discount_unavailable_reason || '暂无可用快照，不使用演示数据填充业务指标。' }}</p>
      </article>
    </div>

    <!-- ===== 项目执行看板：状态环图 + 交付周期 / 返工 + 利用率 ===== -->
    <div v-if="section === 'project'" class="da-native-columns da-native-columns-even">
      <article class="da-native-panel">
        <header><b>项目状态分布</b><span>T+1 快照</span></header>
        <div v-if="projectStatusSlices.length" class="da-donut-wrap">
          <svg class="da-donut" viewBox="0 0 220 180" role="img" aria-label="项目状态分布环形图">
            <circle cx="90" cy="90" r="70" fill="none" stroke="#E4ECFC" stroke-width="22" />
            <circle v-for="slice in projectStatusSlices" :key="slice.label" cx="90" cy="90" r="70" fill="none" :stroke="slice.color" stroke-width="22" :stroke-dasharray="`${slice.length} ${2 * Math.PI * 70 - slice.length}`" :stroke-dashoffset="-slice.offset" transform="rotate(-90 90 90)" />
            <text x="90" y="86" class="da-donut-center">{{ formatInteger(projectStatusTotal) }}</text>
            <text x="90" y="104" class="da-donut-caption">项目总数</text>
          </svg>
          <div class="da-donut-legend">
            <span v-for="slice in projectStatusSlices" :key="slice.label"><i :style="{ background: slice.color }"></i>{{ slice.label }} {{ slice.percent }}%（{{ formatInteger(slice.value) }}）</span>
          </div>
        </div>
        <div v-else class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>暂无状态快照</b><p>完成一次数据源同步后，这里会展示真实状态分布。</p></div>
        <p v-if="summaryAvailable" class="da-native-note">当前筛选仅影响状态分布：{{ statusFilter }}；数据时间以「源数据更新 / 最近成功同步」为准，本次查询时间不冒充数据更新时间。</p>
      </article>
      <article class="da-native-panel">
        <header><b>交付周期（天）· 维度：团队/项目经理</b><span>尚未接入</span></header>
        <div class="da-native-bars">
          <div class="da-native-bar-row tone-muted"><span>平均</span><i><em style="width: 0"></em></i><small>—</small></div>
          <div class="da-native-bar-row tone-muted"><span>P50</span><i><em style="width: 0"></em></i><small>—</small></div>
          <div class="da-native-bar-row tone-muted"><span>P90</span><i><em style="width: 0"></em></i><small>—</small></div>
        </div>
        <p class="da-native-note">锚点：实际开始日（缺失补计划开始日）；异常终止单列，不计入常规分布。当前来源未提供周期字段。</p>
      </article>
    </div>
    <!-- ===== 报告与质量看板：退回原因 + 首次通过率 / 状态分布 + 边界 ===== -->
    <div v-if="section === 'report'" class="da-native-columns">
      <article class="da-native-panel">
        <header><b>退回原因分布</b><span>按环节/标签</span></header>
        <div class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>暂无报告退回原因数据源</b><p>缺少报告退回环节与标签事实，不能计算原因分布。</p></div>
      </article>
      <article class="da-native-panel">
        <header><b>首次通过率（机审+人审）</b><span>字典 3.2</span></header>
        <div v-if="firstPassRate !== null" class="da-gauge-wrap">
          <svg class="da-gauge" viewBox="0 0 200 180" role="img" :aria-label="`首次通过率 ${formatPercent(firstPassRate)}%`">
            <circle cx="90" cy="90" r="70" fill="none" stroke="#E4ECFC" stroke-width="24" />
            <circle cx="90" cy="90" r="70" fill="none" stroke="#059669" stroke-width="24" :stroke-dasharray="`${firstPassLength} ${2 * Math.PI * 70 - firstPassLength}`" transform="rotate(-90 90 90)" />
            <text x="90" y="96" class="da-gauge-value">{{ formatPercent(firstPassRate) }}%</text>
            <text x="90" y="116" class="da-gauge-caption">机审+人审</text>
          </svg>
        </div>
        <div v-else class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>首次通过率尚未接入</b><p>缺少完整首轮审核结果记录；客户原因补充不计入失败。</p></div>
        <p class="da-native-note">客户原因补充不计入失败；退回修改后再过算失败（字典 3.2）。</p>
      </article>
    </div>
    <div v-if="section === 'report'" class="da-native-columns da-native-columns-even">
      <article class="da-native-panel">
        <header><b>报告状态分布</b><span>真实来源快照</span></header>
        <div v-if="businessSummary?.available && reportStatusItems.length" class="da-native-bars">
          <div v-for="item in reportStatusItems" :key="item.label" class="da-native-bar-row"><span>{{ item.label }}</span><i><em :style="{ width: barWidth(item.value) }"></em></i><small>{{ formatInteger(item.value) }} 份</small></div>
          <p class="da-native-note">{{ businessSummary.basis }}</p>
        </div>
        <div v-else-if="businessSummary?.available" class="da-native-empty"><b>当前来源快照可用，尚无可展示的报告版本</b><p>{{ businessSummary.basis }}</p></div>
        <div v-else class="da-native-empty"><b>尚无可用来源快照</b><p>{{ businessSummary?.basis || "需要配置该系统的受控只读数据源并完成一次同步；读取失败不会显示演示统计。" }}</p></div>
      </article>
      <article class="da-native-panel">
        <header><b>口径与数据边界</b><span>缺失来源不计为零</span></header>
        <p v-for="code in reportMissingMetrics" :key="code" class="da-native-note">{{ missingMetricLabels[code] || code }}</p>
        <p class="da-native-note">作废版本不冒充投诉或审核失败；客户投诉未关闭数尚未接入。</p>
      </article>
    </div>

    <!-- ===== 财务与经营看板：账龄 + 部门产值 / 分币种应收 ===== -->
    <div v-if="section === 'finance'" class="da-native-columns">
      <article class="da-native-panel">
        <header><b>应收账款账龄分档</b><span>T+1 快照</span></header>
        <div v-if="businessSummary?.available" class="da-native-bars">
          <div class="da-native-bar-row tone-muted"><span>0-30天</span><i><em style="width: 0"></em></i><small>未接入</small></div>
          <div class="da-native-bar-row tone-muted"><span>31-60天</span><i><em style="width: 0"></em></i><small>未接入</small></div>
          <div class="da-native-bar-row tone-muted"><span>61-90天</span><i><em style="width: 0"></em></i><small>未接入</small></div>
          <div class="da-native-bar-row tone-danger"><span>&gt;90天</span><i><em :style="{ width: primaryFinance ? `${Math.min(100, Math.max(4, numberValue(primaryFinance.over_90_minor) / Math.max(1, numberValue(primaryFinance.original_minor)) * 100))}%` : '0%' }"></em></i><small>{{ primaryFinance ? `${formatAmountMinor(primaryFinance.over_90_minor)} 万${primaryFinance.currency}` : '—' }}</small></div>
          <p class="da-native-note">当前来源只提供超过 90 天的未清余额；0-90 天分档尚未接入，不以演示数据拆分。</p>
        </div>
        <div v-else class="da-native-empty"><b>尚无可用来源快照</b><p>{{ businessSummary?.basis || "需要配置财务受控只读数据源并完成一次同步。" }}</p></div>
      </article>
      <article class="da-native-panel">
        <header><b>部门/个人产值</b><span>技术按产值·销售按收入</span></header>
        <div class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>部门产值尚未接入</b><p>尚无部门产出与收入确认数据源，不能计算部门/个人产值。</p></div>
        <p class="da-native-note warn">⚠ 技术部门按项目子系统产值确认、销售部门按结算子系统收入确认，跨类型不混用（字典 4.4）。</p>
      </article>
    </div>
    <div v-if="section === 'finance'" class="da-native-columns da-native-columns-even">
      <article class="da-native-panel">
        <header><b>分币种应收与回款</b><span>金额不跨币种相加</span></header>
        <div v-if="businessSummary?.available" class="da-native-bars">
          <template v-if="currencyItems.length">
            <p v-for="row in currencyItems" :key="row.currency" class="da-native-note">{{ row.currency }} 原始应收 {{ formatAmountMinor(row.original_minor) }} 万{{ row.currency }}，已核销回款 {{ formatAmountMinor(row.allocated_minor) }} 万{{ row.currency }}，未清 {{ formatAmountMinor(row.open_minor) }} 万{{ row.currency }}</p>
            <p v-for="row in currencyItems" :key="`${row.currency}-receipt`" class="da-native-note">{{ row.currency }} {{ financeReceiptLabel }} {{ formatAmountMinor(row.month_receipts_minor) }} 万{{ row.currency }}</p>
            <p class="da-native-note">{{ businessSummary.basis }}</p>
          </template>
          <div v-else class="da-native-empty"><b>当前来源快照可用，当前租户尚无应收或回款记录</b><p>{{ businessSummary.basis }}</p></div>
        </div>
        <div v-else class="da-native-empty"><b>尚无可用来源快照</b><p>{{ businessSummary?.basis || "需要配置财务受控只读数据源并完成一次同步；读取失败不会显示演示统计。" }}</p></div>
      </article>
      <article class="da-native-panel">
        <header><b>口径与数据边界</b><span>缺失来源不计为零</span></header>
        <p v-for="code in (businessSummary?.missing_metrics || ['recognized_income', 'department_cost'])" :key="code" class="da-native-note">{{ missingMetricLabels[code] || code }}</p>
        <p class="da-native-note">金额不跨币种相加；回款不冒充收入，作废版本不冒充投诉或审核失败。本月回款不是收入确认。</p>
      </article>
    </div>

    <!-- ===== 合同 / 项目明细表 ===== -->
    <div v-if="section === 'contract' || section === 'project'" class="da-native-panel da-native-table-panel">
      <header><b>{{ section === 'contract' ? '合同列表（下钻明细）' : '项目执行明细' }}</b><span>聚合级 · 不含敏感字段</span></header>
      <p v-if="detailLoading" class="da-native-note" role="status">正在加载明细…</p>
      <p v-if="detailError" class="da-native-inline-error" role="alert">{{ detailError }}<button type="button" class="da-button" @click="emit('detail-page', activeDetails.page || 1)">重试明细</button></p>
      <div v-if="!detailError && activeDetails.items?.length && (section !== 'contract' || summaryAvailable)" class="da-native-detail-table">
        <table v-if="section === 'contract'" class="da-table"><thead><tr><th scope="col">合同编号</th><th scope="col">名称</th><th scope="col">状态</th><th scope="col">金额</th><th scope="col">到期日</th></tr></thead><tbody><tr v-for="item in contractDetails.items" :key="item.contract_number" :class="{ risk: String(item.status).toUpperCase() === 'EXPIRED' }"><td class="mono">{{ item.contract_number }}</td><td>{{ item.title }}</td><td><span class="da-badge" :class="contractStatusTone(item.status)">{{ contractStatusLabel(item.status) }}</span></td><td>{{ formatAmountMinor(item.amount_minor) }} 万{{ item.currency }}</td><td>{{ item.end_date || '—' }}</td></tr></tbody></table>
        <table v-else class="da-table"><thead><tr><th scope="col">项目</th><th scope="col">状态</th><th scope="col">经理</th><th scope="col">归属组织ID</th><th scope="col">服务项</th><th scope="col">报告阶段</th><th scope="col">风险</th></tr></thead><tbody><tr v-for="item in projectDetails.items" :key="item.project_id" :class="{ risk: item.risk }"><td>{{ item.name }}</td><td>{{ item.status }}</td><td>{{ item.manager || '—' }}</td><td>{{ item.owner_org_id || '—' }}</td><td>{{ item.service_items }}</td><td>{{ item.report_stage || '未采集' }}</td><td>{{ item.risk ? '风险' : '正常' }}</td></tr></tbody></table>
      </div>
      <div v-else-if="!detailLoading && !detailError" class="da-native-empty"><b>{{ section === 'project' && !projectDetails.available ? '尚无可用项目投影' : section === 'contract' && !summaryAvailable ? '尚无可用合同快照' : '当前范围内暂无明细' }}</b><p>{{ section === 'project' && !projectDetails.available ? '等待首次完整项目投影成功发布；无可用范围也不可读取明细。' : section === 'contract' && !summaryAvailable ? '等待首次合同来源同步成功后核对明细。' : '当前成功来源在授权范围内没有记录。' }}</p></div>
      <p v-if="section === 'contract'" class="da-native-note">排除项：不展示合同脱敏字段（如成本价）；草稿/审批中/作废不计。明细不提供导出。</p>
      <PaginationBar :page="activeDetails.page || 1" :total="detailError ? null : activeDetails.total" :page-size="activeDetails.page_size || 20" :loading="detailLoading" :label="section === 'contract' ? '合同明细分页' : '项目明细分页'" @change="emit('detail-page', $event)" />
    </div>
  </section>
</template>
