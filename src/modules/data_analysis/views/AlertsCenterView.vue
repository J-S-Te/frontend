<script setup>
// 预警中心（P-08）：按严重度/到期日排序展示，OPEN→ACK→CLOSED 闭环。
// 权限与数据范围由后端逐请求执行，前端仅按 permissions 控制动作显隐。
import { computed, onMounted, ref } from "vue"
import ConsoleIcon from "@/modules/shared/components/ConsoleIcon.vue"
import ListState from "@/modules/shared/components/ListState.vue"
import PaginationBar from "@/modules/shared/components/PaginationBar.vue"
import { ackAlert, closeAlert, getAlertSummary, getAlerts } from "../api/dataAnalysis"
import { formatDataAnalysisError } from "../utils/errors.js"

const props = defineProps({ permissions: { type: Array, default: () => [] } })

const alerts = ref([])
const loading = ref(true)
const error = ref(null)
const keyword = ref("")
const statusFilter = ref("")
const severityFilter = ref("")
const page = ref(1)
const pageSize = 50
const total = ref(0)
const summary = ref({ total: 0, open: 0, ack: 0, closed: 0, by_severity: {} })
const acting = ref(null)

const canManage = computed(() => props.permissions.includes("alert.manage"))

const SEVERITY_LABELS = { HIGH: "高", MEDIUM: "中", LOW: "低" }
const STATUS_LABELS = { OPEN: "待受理", ACK: "处理中", CLOSED: "已关闭" }

// 关闭原因（DATA-07）：后端 closed_reason 可能尚未上线，缺失时不显示任何标签。
// 自动关闭与人工关闭必须区分：自动关闭说明条件已消失/目标离开窗口，人工关闭说明有人处理过。
// 未知 closed_reason 原样展示后端原文，不得用笼统的占位文案替代。
const CLOSED_REASON_LABELS = {
  AUTO_CONDITION_CLEARED: "自动关闭：条件消失",
  AUTO_WINDOW_EXIT: "自动关闭：离开窗口（历史）",
  MANUAL: "人工关闭",
}
// 后端字段可能尚未上线：兼容 snake_case / camelCase / PascalCase，读取不到即视为缺失。
const ALERT_FIELD_ALIASES = {
  closedReason: ["closed_reason", "closedReason", "ClosedReason"],
  reopenCount: ["reopen_count", "reopenCount", "ReopenCount"],
  acknowledgedAt: ["acknowledged_at", "acknowledgedAt", "AcknowledgedAt", "acked_at", "ackedAt"],
  acknowledgedBy: ["acknowledged_by", "acknowledgedBy", "AcknowledgedBy", "acked_by", "ackedBy"],
}
// 用途：按别名读取可选字段，undefined/null/空串一律视为未提供。
// 参数：item 为预警记录；key 为 ALERT_FIELD_ALIASES 的键。
// 返回值：首个有值的字段值，缺失返回 undefined。
function alertField(item, key) {
  if (!item || typeof item !== "object") return undefined
  for (const name of ALERT_FIELD_ALIASES[key] || []) {
    const value = item[name]
    if (value === undefined || value === null) continue
    if (typeof value === "string" && value.trim() === "") continue
    return value
  }
  return undefined
}
// 用途：把 closed_reason 码值转成中文说明；未知码值保留原文。
// 参数：item 为预警记录；返回空串表示无需展示。
function closedReasonText(item) {
  const raw = alertField(item, "closedReason")
  if (raw === undefined) return ""
  const text = String(raw).trim()
  if (!text) return ""
  return CLOSED_REASON_LABELS[text.toUpperCase()] || `关闭原因：${text}`
}
// 用途：复开次数说明；0/缺失/非数字时不显示。
function reopenCountText(item) {
  const count = Number(alertField(item, "reopenCount"))
  return Number.isFinite(count) && count > 0 ? `已复开 ${count} 次` : ""
}
// 用途：ACK 的确认人/时间说明，任一字段缺失只显示存在的那个，不输出空标签。
function ackNotes(item) {
  const notes = []
  const by = alertField(item, "acknowledgedBy")
  const at = alertField(item, "acknowledgedAt")
  if (by !== undefined) notes.push(`确认人：${String(by).trim()}`)
  if (at !== undefined) notes.push(`确认时间：${String(at).trim()}`)
  return notes
}
// 用途：拼装状态列补充说明（确认信息 / 关闭原因 / 复开次数）。
// 参数：item 为预警记录（字段可缺失）；返回字符串数组，空数组表示不渲染。
function alertStatusNotes(item) {
  const notes = []
  const status = item?.status
  if (status === "ACK" || status === "CLOSED") notes.push(...ackNotes(item))
  if (status === "CLOSED") {
    const reason = closedReasonText(item)
    if (reason) notes.push(reason)
  }
  const reopen = reopenCountText(item)
  if (reopen) notes.push(reopen)
  return notes
}

const filteredAlerts = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return alerts.value.filter((item) => {
    const matchKeyword = !query || [item.title, item.alert_type, item.rule_code, item.target_ref].join(" ").toLowerCase().includes(query)
    return matchKeyword && (!statusFilter.value || item.status === statusFilter.value)
  })
})

const counts = computed(() => ({
  open: Number(summary.value.open || 0),
  ack: Number(summary.value.ack || 0),
  closed: Number(summary.value.closed || 0),
  high: Number(summary.value.by_severity?.HIGH || 0) + Number(summary.value.by_severity?.CRITICAL || 0),
}))
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
// 三态闸门：加载中 / 加载失败 / 无记录都走 ListState；失败一定带重试，不会渲染成「暂无预警」。
const alertListState = computed(() => loading.value || Boolean(error.value) || !filteredAlerts.value.length)

async function load() {
  loading.value = true
  error.value = null
  try {
    const [result, aggregate] = await Promise.all([
      getAlerts({ page: page.value, page_size: pageSize, severity: severityFilter.value, status: statusFilter.value }),
      getAlertSummary(),
    ])
    const items = Array.isArray(result) ? result : (result?.items || [])
    // 状态列补充说明在加载时算好，模板只做渲染，避免每帧重复解析字段。
    alerts.value = items.map((item) => (item && typeof item === "object" ? { ...item, statusNotes: alertStatusNotes(item) } : item))
    total.value = Array.isArray(result) ? result.length : Number(result?.total || 0)
    if (aggregate && typeof aggregate === "object") summary.value = aggregate
  } catch (err) {
    error.value = formatDataAnalysisError(err, { fallback: "预警加载失败，请稍后刷新。" })
    return false
  } finally {
    loading.value = false
  }
  return true
}

function changePage(next) {
  if (next < 1 || next > pageCount.value || loading.value) return
  page.value = next
  load()
}

function applyFilters() {
  page.value = 1
  load()
}

async function runAction(id, action) {
  if (!canManage.value || acting.value) return
  acting.value = id
  try {
    if (action === "ack") await ackAlert(id)
    else await closeAlert(id)
    if (!await load()) error.value = `预警已${action === "ack" ? "受理" : "关闭"}，但列表刷新失败。请刷新列表查看结果，无需重复操作。`
  } catch (err) {
    error.value = formatDataAnalysisError(err, { fallback: "预警操作失败，请刷新列表确认状态。" })
  } finally {
    acting.value = null
  }
}

function onAck(id) { runAction(id, "ack") }
function onClose(id) { runAction(id, "close") }

onMounted(load)
</script>

<template>
  <section>
    <div class="da-summary-strip">
      <button type="button" @click="statusFilter = statusFilter === 'OPEN' ? '' : 'OPEN'; applyFilters()"><b>{{ counts.open }}</b><span>待受理</span></button>
      <button type="button" @click="statusFilter = statusFilter === 'ACK' ? '' : 'ACK'; applyFilters()"><b>{{ counts.ack }}</b><span>处理中</span></button>
      <button type="button" @click="statusFilter = statusFilter === 'CLOSED' ? '' : 'CLOSED'; applyFilters()"><b>{{ counts.closed }}</b><span>已关闭</span></button>
      <button type="button" class="danger"><b>{{ counts.high }}</b><span>高危预警</span></button>
    </div>

    <div class="da-filters">
      <label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索标题 / 类型 / 规则 / 对象"  maxlength="100"/></label>
      <select v-model="statusFilter" @change="applyFilters">
        <option value="">全部状态</option>
        <option value="OPEN">待受理</option>
        <option value="ACK">处理中</option>
        <option value="CLOSED">已关闭</option>
      </select>
      <select v-model="severityFilter" @change="applyFilters">
        <option value="">全部严重度</option>
        <option value="CRITICAL">紧急</option>
        <option value="HIGH">高</option>
        <option value="MEDIUM">中</option>
        <option value="LOW">低</option>
      </select>
      <button class="da-button ghost" :disabled="loading" @click="load"><ConsoleIcon name="reset" />刷新</button>
    </div>

    <ListState
      v-if="alertListState"
      :loading="loading"
      :error="error"
      error-title="预警列表加载失败"
      empty-title="暂无预警"
      empty-description="当前筛选条件下没有预警记录"
      @retry="load"
    />
    <div v-else class="da-alert-list">
      <article v-for="item in filteredAlerts" :key="item.id" class="da-alert-card">
        <i class="da-alert-severity" :class="item.severity.toLowerCase()"></i>
        <div class="da-alert-main">
          <div class="da-alert-title">
            <b>{{ item.title }}</b>
            <span class="da-badge" :class="item.status === 'OPEN' ? 'risk' : item.status === 'ACK' ? 'warning' : 'neutral'">{{ STATUS_LABELS[item.status] || item.status }}</span>
            <span class="da-badge neutral">{{ SEVERITY_LABELS[String(item.severity).toUpperCase()] || item.severity }}</span>
          </div>
          <div class="da-alert-meta">{{ item.alert_type }} · 规则 {{ item.rule_code || '—' }} · 对象 {{ item.target_ref || '—' }} · 到期 {{ item.due_date || '无期限' }}</div>
          <div v-if="item.statusNotes?.length" class="da-alert-meta da-alert-status">{{ item.statusNotes.join(' · ') }}</div>
        </div>
        <div class="da-alert-actions">
          <button v-if="item.status === 'OPEN'" class="da-button" :disabled="acting === item.id" @click="onAck(item.id)">{{ acting === item.id ? '处理中…' : '受理' }}</button>
          <button v-if="item.status !== 'CLOSED'" class="da-button ghost" :disabled="acting === item.id" @click="onClose(item.id)">关闭</button>
        </div>
      </article>
      <PaginationBar label="预警列表分页" :page="page" :total="total" :page-size="pageSize" :loading="loading" @change="changePage" />
    </div>
  </section>
</template>

