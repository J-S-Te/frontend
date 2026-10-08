<script setup>
import { computed, onMounted, ref } from "vue"
import ConsoleIcon from "@/modules/platform/shared/components/ConsoleIcon.vue"
import EmptyState from "@/modules/platform/shared/components/EmptyState.vue"
import ErrorState from "@/modules/platform/shared/components/ErrorState.vue"
import LoadingState from "@/modules/platform/shared/components/LoadingState.vue"
import { getDictionary, createDictionaryMetric, updateDictionaryMetric, setDictionaryMetricEnabled, deleteDictionaryMetric, getDictionaryMetricVersions } from "../api/dataAnalysis"
const props = defineProps({ permissions: { type: Array, default: () => [] } })
const canManage = computed(() => props.permissions.includes("dictionary.manage"))
const canWrite = computed(() => canManage.value && !!dictionary.value && !loading.value && !error.value && !saving.value)
const editing = ref(null)
const draft = ref({})
const saving = ref(false)
const editorError = ref("")
const toast = ref("")
const history = ref(null)
const historyLoading = ref(false)
const historyError = ref("")
let historyRequest = 0
const fields = ["name", "dashboard", "definition", "formula", "source", "period", "status"]
const fieldLimits = { name: 128, dashboard: 128, definition: 512, formula: 512, source: 255, period: 64, status: 32 }

const dictionary = ref(null)
const loading = ref(false)
const error = ref(null)
const keyword = ref("")

const filteredMetrics = computed(() => {
  const items = dictionary.value?.metrics || []
  const query = keyword.value.trim().toLowerCase()
  if (!query) return items
  return items.filter((item) => [item.code, item.name, item.dashboard, item.definition, item.source].join(" ").toLowerCase().includes(query))
})

async function load() {
  if (loading.value || saving.value) return
  loading.value = true
  error.value = null
  try {
    dictionary.value = await getDictionary()
    if (editing.value?.mode === "edit") editorError.value = "字典已刷新；请关闭并重新打开编辑，以使用最新版本。"
    toast.value = ""
  } catch (err) {
    error.value = err?.message || "指标字典加载失败"
  } finally {
    loading.value = false
  }
}

onMounted(load)

function failureMessage(err) {
  if (err?.status === 409 || err?.code === "METRIC_VERSION_CONFLICT") return `${err?.message || "指标已被其他操作修改"}。请刷新指标字典后重试。`
  return err?.message || "指标操作失败，请重试"
}
function openEditor(item = null) {
	if (!canWrite.value || editing.value) return
  editing.value = { mode: item ? "edit" : "create", code: item?.code, version: item?.version ?? 0 }
  draft.value = item ? Object.fromEntries(["code", ...fields].map((key) => [key, item[key] || ""])) : { code: "", name: "", dashboard: "合同看板", definition: "", formula: "", source: "", period: "月", status: "待确认" }
  editorError.value = ""
}
function closeEditor() { if (!saving.value) { editing.value = null; editorError.value = "" } }
function replaceMetric(metric) {
  dictionary.value = { ...dictionary.value, metrics: [...dictionary.value.metrics.filter((item) => item.code !== metric.code), metric].sort((a, b) => a.code.localeCompare(b.code)) }
}
async function saveEditor() {
  if (!canWrite.value || !editing.value) return
  const payload = Object.fromEntries(fields.map((key) => [key, String(draft.value[key] || "").trim()]))
  const code = String(editing.value.mode === "edit" ? editing.value.code : draft.value.code || "").trim()
  if (!code || fields.some((key) => !payload[key])) { editorError.value = "请填写所有口径字段。"; return }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(code)) { editorError.value = "指标编码须以字母或数字开头，仅含字母、数字、下划线、点或横线，最多64字符。"; return }
  if (fields.some((key) => [...payload[key]].length > fieldLimits[key])) { editorError.value = "字段超出长度限制：名称和看板128、定义和公式512、数据源255、周期64、状态32字符。"; return }
  if (editing.value.mode === "create" && dictionary.value.metrics.some((item) => item.code === code)) { editorError.value = "指标编码已存在，请使用其他编码。"; return }
  editorError.value = ""
  saving.value = true
  try {
    const metric = editing.value.mode === "edit" ? await updateDictionaryMetric(code, { ...payload, version: editing.value.version }) : await createDictionaryMetric({ ...payload, code })
    replaceMetric(metric)
    editing.value = null
    toast.value = "指标口径已保存"
  } catch (err) { editorError.value = failureMessage(err) }
  finally { saving.value = false }
}
async function toggleMetric(item) {
  if (!canWrite.value || editing.value || (!item.enabled && !item.can_enable)) return
  saving.value = true
  toast.value = ""
  try { replaceMetric(await setDictionaryMetricEnabled(item.code, !item.enabled, item.version)); toast.value = item.enabled ? "指标已停用" : "指标已启用" }
  catch (err) { toast.value = failureMessage(err) }
  finally { saving.value = false }
}
async function removeMetric(item) {
  if (!canWrite.value || editing.value || item.origin !== "CUSTOM") return
  if (!window.confirm(`确认删除指标“${item.name}”（${item.code}）？已被引用的指标不能删除，可选择停用。版本历史将保留。`)) return
  saving.value = true
  toast.value = ""
  try {
    await deleteDictionaryMetric(item.code, item.version)
    dictionary.value = { ...dictionary.value, metrics: dictionary.value.metrics.filter((metric) => metric.code !== item.code) }
    toast.value = "指标已删除"
  } catch (err) { toast.value = failureMessage(err) }
  finally { saving.value = false }
}
async function openHistory(item) {
  const request = ++historyRequest
  history.value = { code: item.code, name: item.name, versions: [] }
  historyLoading.value = true
  historyError.value = ""
  try {
    const versions = await getDictionaryMetricVersions(item.code)
    if (request === historyRequest) history.value = { code: item.code, name: item.name, versions }
  } catch (err) { if (request === historyRequest) historyError.value = err?.message || "版本历史加载失败" }
  finally { if (request === historyRequest) historyLoading.value = false }
}
function closeHistory() { historyRequest += 1; history.value = null; historyLoading.value = false }
function operationLabel(operation) { return ({ BASELINE: "原始口径", CREATE: "新建", UPDATE: "修改口径", ENABLE: "启用", DISABLE: "停用", SET_ENABLED: "变更启用状态", DELETE: "删除" })[operation] || operation }
</script>

<template>
  <section>
    <LoadingState v-if="loading" title="指标字典加载中…" />
    <ErrorState v-else-if="error" :error="error" @retry="load" />
    <div v-else-if="dictionary" class="da-dict-grid">
      <article class="da-dict-card">
        <p class="da-panel-kicker">METRIC DICTIONARY</p>
        <h2>指标口径目录</h2>
        <p class="da-dict-meta">共 {{ dictionary.metrics?.length || 0 }} 项指标；每个指标独立管理版本。</p>
        <p class="da-dict-meta">内置指标可修订或停用；自定义指标在未被引用时可删除。</p>
      </article>
      <aside class="da-dict-note">
        <h2>口径与计算说明</h2>
        <p>公式是业务口径说明，不作为 SQL 或可执行表达式运行。新建指标默认停用，未绑定计算能力的自定义指标不可启用。</p>
        <p>“已确认”表示口径已确认，与启用开关独立。启用要求口径已确认且匹配后台受控计算能力；字典开关不改写既有统计结果，也不会自动为自定义指标创建计算任务或将历史报表绑定到新版本。</p>
        <p v-if="!canManage">当前权限允许查阅口径和版本历史；维护需要 dictionary.manage 权限。</p>
      </aside>
      <div class="da-dict-metrics da-table-panel">
        <div class="da-filters"><label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="检索指标名称 / 看板 / 关键词" /></label><span>{{ filteredMetrics.length }} / {{ dictionary.metrics?.length || 0 }} 项指标</span><button class="da-button" :disabled="saving" @click="load">刷新</button><button v-if="canManage" class="da-button primary" :disabled="!canWrite" @click="openEditor()">新建指标</button></div>
        <p v-if="toast" role="status" class="da-dict-message">{{ toast }}</p>
        <div class="da-table-scroll"><table class="da-table"><thead><tr><th>编码 / 版本</th><th>指标 / 来源</th><th>看板</th><th>业务定义</th><th>公式说明</th><th>数据源</th><th>周期</th><th>口径状态</th><th>启用状态</th><th>操作</th></tr></thead><tbody><tr v-for="item in filteredMetrics" :key="item.code"><td class="mono">{{ item.code }}<br />v{{ item.version }}</td><td><b>{{ item.name }}</b><br />{{ item.origin === 'BUILTIN' ? '内置' : '自定义' }}</td><td>{{ item.dashboard }}</td><td>{{ item.definition }}</td><td>{{ item.formula }}</td><td class="mono">{{ item.source }}</td><td>{{ item.period }}</td><td>{{ item.status }}</td><td><span class="da-badge" :class="item.enabled ? 'normal' : 'warning'">{{ item.enabled ? '已启用' : '已停用' }}</span><small v-if="!item.enabled && !item.can_enable" class="da-dict-hint">未绑定可用计算能力或口径不匹配，不能启用</small><small v-else class="da-dict-hint">{{ item.calculation_binding || '已绑定计算能力' }}</small></td><td><div class="da-dict-actions"><button class="da-button compact" @click="openHistory(item)">版本历史</button><template v-if="canManage"><button class="da-button compact" :disabled="!canWrite" @click="openEditor(item)">编辑</button><button class="da-button compact" :disabled="!canWrite || (!item.enabled && !item.can_enable)" @click="toggleMetric(item)">{{ item.enabled ? '停用' : '启用' }}</button><button v-if="item.origin === 'CUSTOM'" class="da-button compact" :disabled="!canWrite" @click="removeMetric(item)">删除</button></template></div></td></tr></tbody></table></div>
        <EmptyState v-if="filteredMetrics.length === 0" title="未找到匹配指标" />
      </div>
    </div>
    <div v-if="editing" class="da-modal-backdrop" @click.self="closeEditor"><form class="da-modal" @submit.prevent="saveEditor"><header><b>{{ editing.mode === 'edit' ? '编辑指标口径' : '新建指标口径' }}</b><button type="button" class="da-icon-button" :disabled="saving" @click="closeEditor">×</button></header><p class="da-dict-meta">公式仅作为口径说明。新建指标保存后停用；计算绑定由服务端管理。</p><label>编码<input v-model="draft.code" :disabled="editing.mode === 'edit' || saving" required /></label><label>名称<input v-model="draft.name" :disabled="saving" required /></label><label>看板<input v-model="draft.dashboard" :disabled="saving" required /></label><label>业务定义<textarea v-model="draft.definition" :disabled="saving" required /></label><label>公式说明<textarea v-model="draft.formula" :disabled="saving" required /></label><label>数据源说明<input v-model="draft.source" :disabled="saving" required /></label><label>统计周期<input v-model="draft.period" :disabled="saving" required /></label><label>口径确认状态<input v-model="draft.status" :disabled="saving" list="metric-confirmation-status" maxlength="32" required /><datalist id="metric-confirmation-status"><option value="待确认" /><option value="已确认" /></datalist></label><p v-if="editorError" role="alert" class="da-dict-message">{{ editorError }}</p><footer><button type="button" class="da-button" :disabled="saving" @click="closeEditor">取消</button><button class="da-button primary" :disabled="!canWrite">{{ saving ? '保存中…' : '保存口径' }}</button></footer></form></div>
    <div v-if="history" class="da-modal-backdrop" @click.self="closeHistory"><section class="da-modal da-dict-history"><header><b>{{ history.name }} · 版本历史</b><button type="button" class="da-icon-button" @click="closeHistory">×</button></header><p class="da-dict-meta">按版本从新到旧展示最近 200 条；更早版本仍保留在数据库中。</p><LoadingState v-if="historyLoading" title="版本历史加载中…" /><ErrorState v-else-if="historyError" :error="historyError" @retry="openHistory(history)" /><template v-else><article v-for="(entry, index) in history.versions" :key="`${entry.metric?.version}-${index}`" class="da-dict-history-entry"><h3>v{{ entry.metric.version }} · {{ operationLabel(entry.operation) }}</h3><p>{{ entry.created_at }} · 操作人 {{ entry.actor_id || '系统' }}</p><p>{{ entry.metric.name }} · {{ entry.metric.dashboard }} · {{ entry.metric.period }}</p><p>口径状态：{{ entry.metric.status }}；{{ entry.metric.enabled ? '已启用' : '已停用' }}</p><p>业务定义：{{ entry.metric.definition }}</p><p>公式说明：{{ entry.metric.formula }}</p><p>数据源说明：{{ entry.metric.source }}</p></article><EmptyState v-if="history.versions.length === 0" title="暂无持久化版本历史" /></template></section></div>
  </section>
</template>

<style scoped>
.da-dict-meta { margin: 6px 0 0; color: #64748b; font-size: 12.5px; }
.da-dict-meta:first-of-type { margin-top: 14px; }
.da-dict-hint { display: block; margin-top: 6px; color: #64748b; }
.da-dict-message { padding: 12px; background: #fff7ed; color: #9a3412; border-radius: 8px; }
.da-dict-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.da-dict-history { max-height: 85vh; overflow: auto; }
.da-dict-history-entry { border-bottom: 1px solid #e2e8f0; padding: 12px 0; overflow-wrap: anywhere; }
</style>
