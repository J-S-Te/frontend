<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { getMetricFacts } from '../api/dataAnalysis.js'
import { formatDataAnalysisError } from '../utils/errors.js'
import MetricFactsDisplay from './MetricFactsDisplay.vue'

const props = defineProps({ section: { type: String, required: true },
  tenantId: { type: [String, Number], required: true }, userId: { type: [String, Number], required: true } })
const summary = ref(null)
const error = ref('')
const loading = ref(false)
let mounted = false
let requestVersion = 0

// currentBusinessMonth 使用北京时间生成月份，避免浏览器本地时区改变统计归属。
// 参数：无。
// 返回值：YYYY-MM业务月份。
function currentBusinessMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}`
}
const period = ref(props.section === 'contract' ? '' : currentBusinessMonth())

// refresh 读取当前身份及分区的新事实统计，过期响应和卸载后结果均丢弃。
// 参数：无；查询来自受控分区和月份，范围由服务端确定。
// 返回值：Promise完成；失败清空旧身份数据并展示错误。
async function refresh() {
  const ticket = ++requestVersion
  summary.value = null
  error.value = ''
  if (!mounted || !props.tenantId || !props.userId) return
  loading.value = true
  try {
    const result = await getMetricFacts(props.section, period.value)
    if (mounted && ticket === requestVersion) summary.value = result
  } catch (failure) {
    if (mounted && ticket === requestVersion) {
      // 旧后端尚未发布指标事实端点时隐藏本面板，不把跨版本差异显示成红色错误；
      // 端点上线后同一前端无需改动即可恢复真实指标展示。
      if (failure?.status === 404) {
        error.value = ''
        summary.value = null
        return
      }
      error.value = formatDataAnalysisError(failure, { fallback: '新增指标读取失败，请稍后重试。' })
    }
  } finally {
    if (mounted && ticket === requestVersion) loading.value = false
  }
}

watch(() => props.section, () => { period.value = props.section === 'contract' ? '' : currentBusinessMonth() })
watch([() => props.section, () => props.tenantId, () => props.userId, period], () => { refresh() })
onMounted(() => { mounted = true; refresh() })
onBeforeUnmount(() => { mounted = false; requestVersion += 1; summary.value = null })
defineExpose({ refresh })
</script>

<template>
  <section class="metric-facts-panel" :aria-busy="loading">
    <div class="metric-facts-toolbar">
      <label :for="`${section}-facts-period`">统计月份</label>
      <input :id="`${section}-facts-period`" v-model="period" type="month" />
      <button v-if="section === 'contract'" type="button" class="da-button" :disabled="loading || !period" @click="period = ''">全部合同</button>
      <button type="button" class="da-button" :disabled="loading" @click="refresh">{{ loading ? '正在读取…' : '刷新新增指标' }}</button>
    </div>
    <p v-if="error" class="da-native-inline-error" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="da-native-note" role="status">正在读取当前授权范围的指标…</p>
    <MetricFactsDisplay v-else :section="section" :summary="summary" />
  </section>
</template>

<style scoped>
.metric-facts-panel { margin-top: 18px; }
.metric-facts-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.metric-facts-toolbar input { padding: 8px; border: 1px solid var(--da-line); border-radius: 6px; background: var(--surface-card); color: var(--da-ink); }
</style>
