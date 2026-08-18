<script setup>
// 预警中心（P-08）：按严重度/到期日排序展示，OPEN→ACK→CLOSED 闭环。
// 权限与数据范围由后端逐请求执行，前端仅按 permissions 控制动作显隐。
import { computed, onMounted, ref } from "vue"
import ConsoleIcon from "@/modules/platform/shared/components/ConsoleIcon.vue"
import { ackAlert, closeAlert, getAlerts } from "../api/dataAnalysis"

const props = defineProps({ permissions: { type: Array, default: () => [] } })

const alerts = ref([])
const loading = ref(true)
const error = ref(null)
const keyword = ref("")
const statusFilter = ref("")
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
  open: alerts.value.filter((item) => item.status === "OPEN").length,
  ack: alerts.value.filter((item) => item.status === "ACK").length,
  closed: alerts.value.filter((item) => item.status === "CLOSED").length,
  high: alerts.value.filter((item) => item.status !== "CLOSED" && String(item.severity).toUpperCase() === "HIGH").length,
}))

async function load() {
  loading.value = true
  error.value = null
  try {
    alerts.value = await getAlerts({ sort: 'severity,due_date', direction: 'desc,asc' })
  } catch (err) {
    error.value = err?.message || "预警加载失败"
  } finally {
    loading.value = false
  }
}

async function runAction(id, action) {
  if (!canManage.value || acting.value) return
  acting.value = id
  try {
    if (action === "ack") await ackAlert(id)
    else await closeAlert(id)
    await load()
  } catch (err) {
    error.value = err?.message || "操作失败"
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
      <button type="button" @click="statusFilter = statusFilter === 'OPEN' ? '' : 'OPEN'"><b>{{ counts.open }}</b><span>待受理</span></button>
      <button type="button" @click="statusFilter = statusFilter === 'ACK' ? '' : 'ACK'"><b>{{ counts.ack }}</b><span>处理中</span></button>
      <button type="button" @click="statusFilter = statusFilter === 'CLOSED' ? '' : 'CLOSED'"><b>{{ counts.closed }}</b><span>已关闭</span></button>
      <button type="button" class="danger"><b>{{ counts.high }}</b><span>未闭环高危预警</span></button>
    </div>

    <div class="da-filters">
      <label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索标题 / 类型 / 规则 / 对象" /></label>
      <select v-model="statusFilter">
        <option value="">全部状态</option>
        <option value="OPEN">待受理</option>
        <option value="ACK">处理中</option>
        <option value="CLOSED">已关闭</option>
      </select>
      <button class="da-button ghost" :disabled="loading" @click="load"><ConsoleIcon name="reset" />刷新</button>
      <span>{{ filteredAlerts.length }} 条预警</span>
    </div>

    <div v-if="loading" class="da-empty"><div class="da-spinner"></div><b>预警加载中…</b></div>
    <div v-else-if="error" class="da-empty"><ConsoleIcon name="info" /><b>{{ error }}</b><button class="da-button" @click="load">重新加载</button></div>
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
      <div v-if="filteredAlerts.length === 0" class="da-empty"><ConsoleIcon name="info" /><b>暂无预警</b><span>当前筛选条件下没有预警记录</span></div>
    </div>
  </section>
</template>

