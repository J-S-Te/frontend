<script setup>
// 预警中心（P-08）：按严重度/到期日排序展示，OPEN→ACK→CLOSED 闭环。
// 权限与数据范围由后端逐请求执行，前端仅按 permissions 控制动作显隐。
import { computed, onMounted, ref } from "vue"
import ConsoleIcon from "@/modules/platform/shared/components/ConsoleIcon.vue"
import EmptyState from "@/modules/platform/shared/components/EmptyState.vue"
import ErrorState from "@/modules/platform/shared/components/ErrorState.vue"
import LoadingState from "@/modules/platform/shared/components/LoadingState.vue"
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

async function load() {
  loading.value = true
  error.value = null
  try {
    const [result, aggregate] = await Promise.all([
      getAlerts({ page: page.value, page_size: pageSize, severity: severityFilter.value, status: statusFilter.value }),
      getAlertSummary(),
    ])
    alerts.value = Array.isArray(result) ? result : (result?.items || [])
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
      <span>共 {{ total }} 条 · 第 {{ page }} / {{ pageCount }} 页</span>
    </div>

    <LoadingState v-if="loading" title="预警加载中…" />
    <ErrorState v-else-if="error" :error="error" @retry="load" />
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
        </div>
        <div class="da-alert-actions">
          <button v-if="item.status === 'OPEN'" class="da-button" :disabled="acting === item.id" @click="onAck(item.id)">{{ acting === item.id ? '处理中…' : '受理' }}</button>
          <button v-if="item.status !== 'CLOSED'" class="da-button ghost" :disabled="acting === item.id" @click="onClose(item.id)">关闭</button>
        </div>
      </article>
      <EmptyState v-if="filteredAlerts.length === 0" title="暂无预警" description="当前筛选条件下没有预警记录" />
      <div class="da-filters" style="justify-content:flex-end">
        <button class="da-button ghost" :disabled="page <= 1 || loading" @click="changePage(page - 1)">上一页</button>
        <button class="da-button ghost" :disabled="page >= pageCount || loading" @click="changePage(page + 1)">下一页</button>
      </div>
    </div>
  </section>
</template>

