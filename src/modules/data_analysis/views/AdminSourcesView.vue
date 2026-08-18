<script setup>
// 数据源与同步状态（P-09，aggregation.manage）：表格展示各子系统数据源
// 接入、启停与最近同步结果；触发同步由后端排队执行。
import { computed, onMounted, ref } from "vue"
import ConsoleIcon from "@/modules/platform/shared/components/ConsoleIcon.vue"
import { listSources, triggerSource } from "../api/dataAnalysis"

const props = defineProps({ permissions: { type: Array, default: () => [] } })

const sources = ref([])
const loading = ref(true)
const error = ref(null)
const triggering = ref(null)
const notice = ref("")
const keyword = ref("")

const canTrigger = computed(() => props.permissions.includes("aggregation.manage"))

const subsystemLabel = (code) => ({
  contract_management: "合同管理",
  customer_and_opportunity: "客户与商机管理",
  project_management: "项目管理",
  customer_portal: "客户门户",
  data_analysis: "数据看板与统计分析",
}[String(code || "").trim()] || code || "未知子系统")

const filteredSources = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return sources.value
  return sources.value.filter((s) => [s.subsystem_code, s.db_schema, s.db_host].join(" ").toLowerCase().includes(query))
})

const statusLabel = (value) => ({
  OK: "正常", SUCCESS: "正常", RUNNING: "同步中", FAILED: "失败", ERROR: "失败", PENDING: "待接入",
}[String(value || "").toUpperCase()] || (value || "未知"))

const statusTone = (value) => {
  const key = String(value || "").toUpperCase()
  if (["OK", "SUCCESS"].includes(key)) return "normal"
  if (["RUNNING"].includes(key)) return "info"
  if (["FAILED", "ERROR"].includes(key)) return "risk"
  if (["PENDING"].includes(key)) return "warning"
  return "neutral"
}

async function load() {
  loading.value = true
  error.value = null
  try {
    sources.value = await listSources()
  } catch (err) {
    error.value = err?.message || "数据源状态加载失败"
  } finally {
    loading.value = false
  }
}

async function onTrigger(id) {
  if (!canTrigger.value || triggering.value) return
  triggering.value = id
  notice.value = ""
  try {
    const result = await triggerSource(id)
    notice.value = result?.note || `数据源 ${id} 已触发同步`
    await load()
  } catch (err) {
    error.value = err?.message || "触发同步失败"
  } finally {
    triggering.value = null
  }
}

onMounted(load)
</script>

<template>
  <section>
    <div v-if="notice" class="da-filters" style="border-color:#bfe7d7;background:#f0fcf7;color:#177457">{{ notice }}</div>
    <div class="da-filters">
      <label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索子系统 / 库 / 主机" /></label>
      <button class="da-button ghost" :disabled="loading" @click="load"><ConsoleIcon name="reset" />刷新</button>
      <span>{{ filteredSources.length }} 个数据源</span>
    </div>

    <div v-if="loading" class="da-empty"><div class="da-spinner"></div><b>数据源状态加载中…</b></div>
    <div v-else-if="error" class="da-empty"><ConsoleIcon name="info" /><b>{{ error }}</b><button class="da-button" @click="load">重新加载</button></div>
    <div v-else class="da-table-panel">
      <div class="da-table-scroll">
        <table class="da-table">
          <thead><tr><th>子系统</th><th>数据库</th><th>主机</th><th>接入状态</th><th>最近同步</th><th>最近结果</th><th>最近错误</th><th></th></tr></thead>
          <tbody>
            <tr v-for="s in filteredSources" :key="s.id">
              <td><b>{{ subsystemLabel(s.subsystem_code) }}</b><small class="da-source-code">{{ s.subsystem_code }}</small></td>
              <td class="mono">{{ s.db_schema || '—' }}</td>
              <td class="mono">{{ s.db_host || '—' }}</td>
              <td><span class="da-badge" :class="s.enabled ? 'normal' : 'neutral'">{{ s.enabled ? '已启用' : '已停用' }}</span></td>
              <td>{{ s.last_run_at || '—' }}</td>
              <td><span class="da-badge" :class="statusTone(s.last_status)">{{ statusLabel(s.last_status) }}</span></td>
              <td><small>{{ s.last_error || '—' }}</small></td>
              <td><button class="da-button ghost" :disabled="!canTrigger || triggering === s.id" @click="onTrigger(s.id)">{{ triggering === s.id ? '触发中…' : '触发同步' }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="filteredSources.length === 0" class="da-empty"><ConsoleIcon name="info" /><b>暂无数据源</b><span>尚未登记任何子系统数据源</span></div>
      <footer v-else><span>共 {{ filteredSources.length }} 个数据源</span><span>同步调度由 aggregation-worker 执行</span></footer>
    </div>
  </section>
</template>
