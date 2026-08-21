<script setup>
// 高保真模型的本地兜底视图：没有 Metabase 或业务摘要时，仍提供清晰的指标层级与数据状态。
import { computed } from "vue"

const props = defineProps({
  section: { type: String, required: true },
  contractSummary: { type: Object, default: null },
  projectSummary: { type: Object, default: null },
  canViewContract: { type: Boolean, default: true },
  canViewProject: { type: Boolean, default: true },
  statusFilter: { type: String, default: "全部" },
})

const sectionMeta = {
  overview: { title: "经营总览", description: "集团经营指标与目标达成态势" },
  contract: { title: "合同看板", description: "合同签约、执行与回款全景" },
  project: { title: "项目执行看板", description: "项目交付、进度与质量全景" },
  report: { title: "报告与质量看板", description: "报告编制、复核与签发效率" },
  finance: { title: "财务与经营看板", description: "收入、成本与利润口径分析" },
}

const metric = (label, value, suffix = "", tone = "") => ({ label, value, suffix, tone })

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

function formatSnapshotAt(value) {
  if (!value) return "暂无快照"
  const normalized = String(value).includes("T") ? String(value) : String(value).replace(" ", "T")
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

const activeSummary = computed(() => {
  if (props.section === "contract") return props.contractSummary
  if (props.section === "project") return props.projectSummary
  return null
})

const summaryAvailable = computed(() => Boolean(activeSummary.value?.available))
const summaryStatusLabel = computed(() => {
  if (props.section === "overview") return "聚合快照"
  return summaryAvailable.value ? `更新于 ${formatSnapshotAt(activeSummary.value?.snapshot_at)}` : "暂无聚合快照"
})

const contractStatusItems = computed(() => {
  const contract = props.contractSummary || {}
  return [
    { label: "审批中", value: numberValue(contract.approval_contracts) },
    { label: "履行中", value: numberValue(contract.active_contracts) },
    { label: "已到期", value: numberValue(contract.expired_contracts), tone: "danger" },
  ]
})

const projectStatusItems = computed(() => Object.entries(props.projectSummary?.status_counts || {})
  .map(([label, value]) => ({ label, value: numberValue(value) }))
  .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "zh-CN")))

const breakdownItems = computed(() => {
  const items = props.section === "contract" ? contractStatusItems.value : projectStatusItems.value
  if (props.statusFilter === "全部") return items
  return items.filter((item) => item.label === props.statusFilter)
})

const maxBreakdownValue = computed(() => Math.max(1, ...breakdownItems.value.map((item) => item.value)))

function barWidth(value) {
  const normalized = numberValue(value)
  if (normalized <= 0) return "0%"
  return `${Math.max(4, Math.round((normalized / maxBreakdownValue.value) * 100))}%`
}

function metricsForSection() {
  const contract = props.contractSummary || {}
  const project = props.projectSummary || {}
  if (props.section === "overview") {
    const metrics = []
    if (props.canViewContract) {
      metrics.push(metric("合同总数", contract.available ? formatInteger(contract.total_contracts) : "—", "份"))
      metrics.push(metric("合同金额", contract.available ? formatAmountMinor(contract.total_amount_minor) : "—", "万元"))
    }
    if (props.canViewProject) {
      metrics.push(metric("项目总数", project.available ? formatInteger(project.project_count) : "—", "个"))
      metrics.push(metric("进行中项目", project.available ? formatInteger(project.in_flight_projects) : "—", "个"))
      metrics.push(metric("风险项目", project.available ? formatInteger(project.risk_projects) : "—", "个", "danger"))
      metrics.push(metric("服务项", project.available ? formatInteger(project.service_items) : "—", "项"))
    }
    return metrics
  }
  if (props.section === "contract") {
    return [
      metric("合同总金额", contract.available ? formatAmountMinor(contract.total_amount_minor) : "—", "万元"),
      metric("合同总数", contract.available ? formatInteger(contract.total_contracts) : "—", "份"),
      metric("审批中", contract.available ? formatInteger(contract.approval_contracts) : "—", "份"),
      metric("履行中", contract.available ? formatInteger(contract.active_contracts) : "—", "份"),
      metric("已到期", contract.available ? formatInteger(contract.expired_contracts) : "—", "份", "danger"),
    ]
  }
  if (props.section === "project") {
    return [
      metric("项目总数", project.available ? formatInteger(project.project_count) : "—", "个"),
      metric("进行中项目", project.available ? formatInteger(project.in_flight_projects) : "—", "个"),
      metric("风险项目", project.available ? formatInteger(project.risk_projects) : "—", "个", "danger"),
      metric("服务项", project.available ? formatInteger(project.service_items) : "—", "项"),
    ]
  }
  if (props.section === "report") {
    return [metric("报告周期 P50", "—", "天"), metric("首次通过率", "—", "%"), metric("未关闭投诉", "—", "项", "danger")]
  }
  return [metric("回款率", "—", "%"), metric("90 天以上应收", "—", "分", "danger"), metric("本月收入", "—", "分"), metric("部门成本", "—", "分")]
}
</script>

<template>
  <section class="da-native-dashboard">
    <div class="da-native-heading">
      <div>
        <p class="da-panel-kicker">{{ sectionMeta[section].title }}</p>
        <h2>{{ sectionMeta[section].description }}</h2>
      </div>
      <span class="da-badge neutral">数据状态：{{ summaryStatusLabel }}</span>
    </div>

    <div class="da-native-metrics">
      <article v-for="item in metricsForSection()" :key="item.label" class="da-native-metric" :class="item.tone">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong><small>{{ item.suffix }}</small>
      </article>
    </div>

    <div v-if="section === 'contract' || section === 'project'" class="da-native-columns">
      <article class="da-native-panel">
        <header><b>{{ section === 'contract' ? '合同状态分布' : '项目状态分布' }}</b><span>最新聚合快照</span></header>
        <div v-if="summaryAvailable && breakdownItems.length" class="da-native-bars">
          <div v-for="item in breakdownItems" :key="item.label" class="da-native-bar-row">
            <span>{{ item.label }}</span><i><em :style="{ width: barWidth(item.value) }"></em></i><small>{{ formatInteger(item.value) }}</small>
          </div>
        </div>
        <div v-else class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>暂无状态快照</b><p>完成一次数据源同步后，这里会展示真实状态分布。</p></div>
        <p v-if="summaryAvailable" class="da-native-note">当前筛选：{{ statusFilter }}；数据更新时间 {{ formatSnapshotAt(activeSummary?.snapshot_at) }}。</p>
      </article>
      <article class="da-native-panel">
        <header><b>数据口径说明</b><span>只读</span></header>
        <div class="da-native-empty">
          <span class="da-native-empty-icon">i</span>
          <b>{{ summaryAvailable ? '已接入真实聚合快照' : '等待首次同步' }}</b>
          <p>{{ section === 'contract' ? '当前接口提供合同金额、数量及审批中、履行中、已到期统计。' : '当前接口提供项目数量、进行中、风险项目、服务项及状态分布。' }}</p>
        </div>
      </article>
    </div>

    <div v-else class="da-native-columns">
      <article class="da-native-panel">
        <header><b>{{ section === 'overview' ? '签约与项目趋势' : section === 'report' ? '质量效率分析' : '经营回款分析' }}</b><span>T+1 · 指标口径见字典</span></header>
        <div class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>等待完整趋势快照</b><p>当前先展示已接入的聚合摘要，完整趋势由下方嵌入看板提供。</p></div>
      </article>
      <article class="da-native-panel">
        <header><b>{{ section === 'overview' ? '预警聚合' : section === 'report' ? '退回原因分布' : '应收账款账龄' }}</b><span>只读</span></header>
        <div class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>暂无独立摘要</b><p>请以下方嵌入看板中的真实数据为准。</p></div>
      </article>
    </div>
    <div v-if="section === 'contract' || section === 'project'" class="da-native-columns da-native-secondary">
      <article class="da-native-panel">
        <header><b>{{ section === 'contract' ? '商机→合同转化率漏斗' : '返工率（报告退回+现场重测）' }}</b><span>聚合级</span></header>
        <div class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>暂无明细快照</b><p>接入对应事实表后展示分布与下钻数据。</p></div>
      </article>
      <article class="da-native-panel">
        <header><b>{{ section === 'contract' ? '折扣分析（区间分布）' : '人员 / 设备利用率（本月）' }}</b><span>只读</span></header>
        <div class="da-native-bars">
          <div v-for="label in (section === 'contract' ? ['0%', '1-5%', '5-10%', '>10%'] : ['人员利用率', '设备利用率'])" :key="label" class="da-native-bar-row"><span>{{ label }}</span><i><em></em></i><small>—</small></div>
        </div>
        <p class="da-native-note">暂无可用快照，不使用演示数据填充业务指标。</p>
      </article>
    </div>
    <div v-if="section === 'contract' || section === 'project'" class="da-native-panel da-native-table-panel">
      <header><b>{{ section === 'contract' ? '合同列表（下钻明细）' : '项目执行明细' }}</b><span>聚合级 · 不含敏感字段</span></header>
      <div class="da-native-empty"><b>暂无明细数据</b><p>当前租户没有可展示的{{ section === 'contract' ? '合同' : '项目' }}记录。</p></div>
    </div>
  </section>
</template>
