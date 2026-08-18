<script setup>
// 指标字典（P-07）：版本化只读口径查阅；完整口径待字典发布流水线接入后
// 由版本卡片结构化展示，不再使用调试用 JSON 直出。
import { computed, onMounted, ref } from "vue"
import ConsoleIcon from "@/modules/platform/shared/components/ConsoleIcon.vue"
import { getDictionary } from "../api/dataAnalysis"

const dictionary = ref(null)
const loading = ref(true)
const error = ref(null)
const keyword = ref("")

const filteredMetrics = computed(() => {
  const items = dictionary.value?.metrics || []
  const query = keyword.value.trim().toLowerCase()
  if (!query) return items
  return items.filter((item) => [item.code, item.name, item.dashboard, item.definition, item.source].join(" ").toLowerCase().includes(query))
})

async function load() {
  loading.value = true
  error.value = null
  try {
    dictionary.value = await getDictionary()
  } catch (err) {
    error.value = err?.message || "指标字典加载失败"
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section>
    <div v-if="loading" class="da-empty"><div class="da-spinner"></div><b>指标字典加载中…</b></div>
    <div v-else-if="error" class="da-empty"><ConsoleIcon name="info" /><b>{{ error }}</b><button class="da-button" @click="load">重新加载</button></div>
    <div v-else-if="dictionary" class="da-dict-grid">
      <article class="da-dict-card">
        <p class="da-panel-kicker">DICTIONARY VERSION</p>
        <div class="da-dict-version"><b>v{{ dictionary.version }}</b><span class="da-badge normal">{{ dictionary.status === 'ALL_CONFIRMED' ? '全部口径已确认' : dictionary.status }}</span></div>
        <p class="da-dict-meta">来源：{{ dictionary.source }}</p>
        <p class="da-dict-meta">{{ dictionary.note }}</p>
      </article>
      <aside class="da-dict-note">
        <h2>口径查阅说明</h2>
        <p>指标字典采用版本化管理：每次口径变更都会生成新的版本号，看板与报表按版本锁定指标定义，保证历史数据可追溯、可复核。</p>
        <ul>
          <li>指标名称、业务口径、计算公式为只读内容</li>
          <li>新增或修订口径需字典发布流水线确认后生效</li>
          <li>历史版本保留，支持按版本回溯指标定义</li>
        </ul>
      </aside>
      <div class="da-dict-metrics da-table-panel">
        <div class="da-filters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="检索指标名称 / 看板 / 关键词" /></label><span>{{ filteredMetrics.length }} / {{ dictionary.metrics?.length || 0 }} 项指标</span></div>
        <div class="da-table-scroll"><table class="da-table"><thead><tr><th>编码</th><th>指标</th><th>看板</th><th>业务定义</th><th>计算公式</th><th>数据源</th><th>周期</th><th>状态</th></tr></thead><tbody><tr v-for="item in filteredMetrics" :key="item.code"><td class="mono">{{ item.code }}</td><td><b>{{ item.name }}</b></td><td>{{ item.dashboard }}</td><td>{{ item.definition }}</td><td>{{ item.formula }}</td><td class="mono">{{ item.source }}</td><td>{{ item.period }}</td><td><span class="da-badge normal">{{ item.status }}</span></td></tr></tbody></table></div>
        <div v-if="filteredMetrics.length === 0" class="da-empty"><ConsoleIcon name="info" /><b>未找到匹配指标</b></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.da-dict-meta { margin: 6px 0 0; color: #64748b; font-size: 12.5px; }
.da-dict-meta:first-of-type { margin-top: 14px; }
</style>
