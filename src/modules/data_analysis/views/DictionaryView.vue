<script setup>
// 指标字典（P-07）：版本化只读口径查阅；完整口径待字典发布流水线接入后
// 由版本卡片结构化展示，不再使用调试用 JSON 直出。
import { computed, onMounted, ref } from "vue"
import ConsoleIcon from "@/modules/platform/shared/components/ConsoleIcon.vue"
import EmptyState from "@/modules/platform/shared/components/EmptyState.vue"
import ErrorState from "@/modules/platform/shared/components/ErrorState.vue"
import LoadingState from "@/modules/platform/shared/components/LoadingState.vue"
import { getDictionary, putDictionary } from "../api/dataAnalysis"
const props = defineProps({ permissions: { type: Array, default: () => [] } })
const isAdmin = computed(() => props.permissions.includes("admin"))
const editing = ref(null)
const saving = ref(false)

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

function openEditor(item = null) { if (isAdmin.value) editing.value = item ? { ...item } : { code: "", name: "", dashboard: "合同看板", definition: "", formula: "", source: "", period: "月", status: "待确认" } }
function closeEditor() { editing.value = null }
async function saveEditor() { if (!editing.value || saving.value) return; saving.value=true; try { const metrics=[...dictionary.value.metrics.filter((item)=>item.code!==editing.value.code), editing.value].sort((a,b)=>a.code.localeCompare(b.code)); dictionary.value=await putDictionary(metrics); closeEditor() } finally { saving.value=false } }
</script>

<template>
  <section>
    <LoadingState v-if="loading" title="指标字典加载中…" />
    <ErrorState v-else-if="error" :error="error" @retry="load" />
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
        <div class="da-filters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="检索指标名称 / 看板 / 关键词" /></label><span>{{ filteredMetrics.length }} / {{ dictionary.metrics?.length || 0 }} 项指标</span><button v-if="isAdmin" class="da-button primary" @click="openEditor()">新建指标</button></div>
        <div class="da-table-scroll"><table class="da-table"><thead><tr><th>编码</th><th>指标</th><th>看板</th><th>业务定义</th><th>计算公式</th><th>数据源</th><th>周期</th><th>状态</th><th v-if="isAdmin">操作</th></tr></thead><tbody><tr v-for="item in filteredMetrics" :key="item.code"><td class="mono">{{ item.code }}</td><td><b>{{ item.name }}</b></td><td>{{ item.dashboard }}</td><td>{{ item.definition }}</td><td>{{ item.formula }}</td><td class="mono">{{ item.source }}</td><td>{{ item.period }}</td><td><span class="da-badge normal">{{ item.status }}</span></td><td v-if="isAdmin"><button class="da-button compact" @click="openEditor(item)">编辑</button></td></tr></tbody></table></div>
        <EmptyState v-if="filteredMetrics.length === 0" title="未找到匹配指标" />
      </div>
      <div v-if="editing" class="da-modal-backdrop" @click.self="closeEditor"><form class="da-modal" @submit.prevent="saveEditor"><header><b>{{ editing.code ? '编辑指标' : '新建指标' }}</b><button type="button" class="da-icon-button" @click="closeEditor">×</button></header><label>编码<input v-model="editing.code" required /></label><label>名称<input v-model="editing.name" required /></label><label>看板<input v-model="editing.dashboard" required /></label><label>业务定义<textarea v-model="editing.definition" required /></label><label>计算公式<textarea v-model="editing.formula" required /></label><label>数据源<input v-model="editing.source" required /></label><label>统计周期<input v-model="editing.period" required /></label><footer><button type="button" class="da-button" @click="closeEditor">取消</button><button class="da-button primary" :disabled="saving">确认保存</button></footer></form></div>
    </div>
  </section>
</template>

<style scoped>
.da-dict-meta { margin: 6px 0 0; color: #64748b; font-size: 12.5px; }
.da-dict-meta:first-of-type { margin-top: 14px; }
</style>
