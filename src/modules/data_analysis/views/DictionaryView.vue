<script setup>
import OperationToast from '@/modules/shared/components/OperationToast.vue'
import { computed, onMounted, ref } from "vue"
import { useConfirmDialog } from "@/modules/shared/composables/useConfirmDialog.js"
import ConfirmDialog from "@/modules/shared/components/ConfirmDialog.vue"
import ConsoleIcon from "@/modules/shared/components/ConsoleIcon.vue"
import EmptyState from "@/modules/shared/components/EmptyState.vue"
import ErrorState from "@/modules/shared/components/ErrorState.vue"
import LoadingState from "@/modules/shared/components/LoadingState.vue"
import { getDictionary, createDictionaryMetric, updateDictionaryMetric, setDictionaryMetricEnabled, deleteDictionaryMetric, getDictionaryMetricVersions } from "../api/dataAnalysis"
import { formatDataAnalysisError } from "../utils/errors.js"
import { enableableMetricLabels, metricEnableBlockText } from "../utils/metricEnable.js"
const props = defineProps({ permissions: { type: Array, default: () => [] } })
const canManage = computed(() => props.permissions.includes("dictionary.manage"))
const canWrite = computed(() => canManage.value && !!dictionary.value && !loading.value && !error.value && !saving.value)
const editing = ref(null)
const draft = ref({})
let editorInitialSnapshot = ""
const saving = ref(false)
const editorError = ref("")
const { dialog: confirmDialog, askConfirm, accept: acceptConfirm, cancel: cancelConfirm } = useConfirmDialog()
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
const enableableMetricSummary = computed(() => {
  const labels = enableableMetricLabels(dictionary.value?.metrics || [])
  return labels.length ? labels.join("、") : "暂无"
})
// groupedMetrics 按看板分组呈现，保持原型“口径目录”的阅读顺序；未知看板归入未分类。
const groupedMetrics = computed(() => {
  const groups = new Map()
  for (const item of filteredMetrics.value) {
    const dashboard = String(item.dashboard || "").trim() || "未分类"
    if (!groups.has(dashboard)) groups.set(dashboard, [])
    groups.get(dashboard).push(item)
  }
  return [...groups.entries()].map(([dashboard, items]) => ({ dashboard, items }))
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
    error.value = formatDataAnalysisError(err, { fallback: "指标字典加载失败，请稍后刷新。" })
  } finally {
    loading.value = false
  }
}

onMounted(load)

function failureMessage(err) {
  if (err?.status === 409 && !err?.code) return `${formatDataAnalysisError(err, { fallback: "指标状态已变化。" })}请刷新指标字典后重试。`
  return formatDataAnalysisError(err, { fallback: "指标操作失败，请刷新字典确认结果后重试。" })
}
function openEditor(item = null) {
	if (!canWrite.value || editing.value) return
  editing.value = { mode: item ? "edit" : "create", code: item?.code, version: item?.version ?? 0 }
  draft.value = item ? Object.fromEntries(["code", ...fields].map((key) => [key, item[key] || ""])) : { code: "", name: "", dashboard: "合同看板", definition: "", formula: "", source: "", period: "月", status: "待确认" }
  editorInitialSnapshot = JSON.stringify(draft.value)
  editorError.value = ""
}
async function closeEditor() {
  if (saving.value || !editing.value || confirmDialog.value) return
  const current = editing.value
  if (editorInitialSnapshot !== JSON.stringify(draft.value)) {
    const discard = await askConfirm({ title: '放弃指标编辑？', description: '当前表单有未保存的修改，放弃后不会保留。', confirmText: '放弃修改', cancelText: '继续编辑', danger: true })
    if (!discard || saving.value || editing.value !== current) return
  }
  editing.value = null
  editorInitialSnapshot = ""
  editorError.value = ""
}
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
  const ok = await askConfirm({
    title: '删除指标？',
    description: `确认删除指标“${item.name}”（${item.code}）？已被引用的指标不能删除，可选择停用。版本历史将保留。`,
    confirmText: '删除指标',
    cancelText: '取消',
    danger: true,
  })
  if (!ok) return
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
  } catch (err) { if (request === historyRequest) historyError.value = formatDataAnalysisError(err, { fallback: "版本历史加载失败，请稍后刷新。" }) }
  finally { if (request === historyRequest) historyLoading.value = false }
}
function closeHistory() { historyRequest += 1; history.value = null; historyLoading.value = false }
function operationLabel(operation) { return ({ BASELINE: "原始口径", CREATE: "新建", UPDATE: "修改口径", ENABLE: "启用", DISABLE: "停用", SET_ENABLED: "变更启用状态", DELETE: "删除" })[operation] || operation }
</script>

<template>
  <section>
    <LoadingState v-if="loading" title="指标字典加载中…" />
    <ErrorState v-else-if="error" :error="error" @retry="load" />
    <div v-else-if="dictionary" class="da-dict-page">
      <div class="da-dict-toolbar">
        <label class="da-dict-search"><ConsoleIcon name="search" /><input v-model="keyword" placeholder="检索指标名称 / 看板 / 关键词…" maxlength="100" /></label>
        <span class="da-pill">{{ filteredMetrics.length }} / {{ dictionary.metrics?.length || 0 }} 项 · 每项独立版本</span>
        <span class="da-dict-toolbar-spacer"></span>
        <button class="da-button" :disabled="saving" @click="load"><ConsoleIcon name="reset" />刷新</button>
        <button v-if="canManage" class="da-button primary" :disabled="!canWrite" @click="openEditor()">新建指标</button>
      </div>
      <OperationToast :message="toast" />

      <div v-if="groupedMetrics.length" class="da-dict-list">
        <section v-for="group in groupedMetrics" :key="group.dashboard" class="da-dict-section">
          <div class="da-dict-group">{{ group.dashboard }}<span>{{ group.items.length }} 项</span></div>
          <article v-for="item in group.items" :key="item.code" class="da-dict-item">
            <h4>
              <span>{{ item.name }}</span>
              <span class="da-badge" :class="item.status === '已确认' ? 'normal' : 'warning'">{{ item.status }}</span>
              <span class="da-badge" :class="item.enabled ? 'normal' : 'neutral'">{{ item.enabled ? '已启用' : '已停用' }}</span>
              <span class="da-badge neutral">{{ item.code }} · v{{ item.version }}</span>
              <span class="da-dict-origin">{{ item.origin === 'BUILTIN' ? '内置' : '自定义' }}</span>
            </h4>
            <div class="da-dict-meta-grid">
              <span><b>定义</b>{{ item.definition }}</span>
              <span><b>源</b>{{ item.source }}</span>
              <span><b>公式</b>{{ item.formula }}</span>
              <span><b>周期</b>{{ item.period }}</span>
            </div>
            <p v-if="!item.enabled && !item.can_enable" class="da-dict-hint">{{ metricEnableBlockText(item) }}</p>
            <p v-else class="da-dict-hint">{{ item.calculation_binding || '已绑定计算能力' }}</p>
            <div class="da-dict-item-actions">
              <button class="da-button compact" @click="openHistory(item)">版本历史</button>
              <template v-if="canManage">
                <button class="da-button compact" :disabled="!canWrite" @click="openEditor(item)">编辑</button>
                <button class="da-button compact" :disabled="!canWrite || (!item.enabled && !item.can_enable)" :title="item.enabled || item.can_enable ? '' : metricEnableBlockText(item)" @click="toggleMetric(item)">{{ item.enabled ? '停用' : '启用' }}</button>
                <button v-if="item.origin === 'CUSTOM'" class="da-button compact danger" :disabled="!canWrite" @click="removeMetric(item)">删除</button>
              </template>
            </div>
          </article>
        </section>
      </div>
      <EmptyState v-else title="未找到匹配指标" />

      <div class="da-dict-note-panel">
        <div class="da-dict-note">
          <h2>口径与计算说明</h2>
          <p>公式是业务口径说明，不作为 SQL 或可执行表达式运行。新建指标默认停用，未绑定计算能力的自定义指标不可启用。</p>
          <p>“已确认”表示口径已确认，与启用开关独立。启用要求口径已确认且匹配后台受控计算能力；字典开关不改写既有统计结果。</p>
          <p>当前具备受控计算能力的指标：{{ enableableMetricSummary }}；新建或修订口径不会自动创建计算能力。</p>
          <p v-if="!canManage">当前权限允许查阅口径和版本历史；维护需要 dictionary.manage 权限。</p>
        </div>
      </div>
    </div>
    <div v-if="editing" class="da-modal-backdrop" @click.self="closeEditor"><form class="da-modal" @submit.prevent="saveEditor"><header><b>{{ editing.mode === 'edit' ? '编辑指标口径' : '新建指标口径' }}</b><button type="button" class="da-icon-button" :disabled="saving" @click="closeEditor">×</button></header><p class="da-dict-meta">公式仅作为口径说明。新建指标保存后停用；计算绑定由服务端管理。</p><label>编码<input v-model="draft.code" :disabled="editing.mode === 'edit' || saving" required  maxlength="64"/></label><label>名称<input v-model="draft.name" :disabled="saving" required  maxlength="128"/></label><label>看板<input v-model="draft.dashboard" :disabled="saving" required  maxlength="128"/></label><label>业务定义<textarea v-model="draft.definition" :disabled="saving" required  maxlength="512"/></label><label>公式说明<textarea v-model="draft.formula" :disabled="saving" required  maxlength="512"/></label><label>数据源说明<input v-model="draft.source" :disabled="saving" required  maxlength="255"/></label><label>统计周期<input v-model="draft.period" :disabled="saving" required  maxlength="64"/></label><label>口径确认状态<input v-model="draft.status" :disabled="saving" list="metric-confirmation-status" maxlength="32" required /><datalist id="metric-confirmation-status"><option value="待确认" /><option value="已确认" /></datalist></label><p v-if="editorError" role="alert" class="da-dict-message">{{ editorError }}</p><footer><button type="button" class="da-button" :disabled="saving" @click="closeEditor">取消</button><button class="da-button primary" :disabled="!canWrite">{{ saving ? '保存中…' : '保存口径' }}</button></footer></form></div>
    <div v-if="history" class="da-modal-backdrop" @click.self="closeHistory"><section class="da-modal da-dict-history"><header><b>{{ history.name }} · 版本历史</b><button type="button" class="da-icon-button" @click="closeHistory">×</button></header><p class="da-dict-meta">按版本从新到旧展示最近 200 条；更早版本仍保留在数据库中。</p><LoadingState v-if="historyLoading" title="版本历史加载中…" /><ErrorState v-else-if="historyError" :error="historyError" @retry="openHistory(history)" /><template v-else><article v-for="(entry, index) in history.versions" :key="`${entry.metric?.version}-${index}`" class="da-dict-history-entry"><h3>v{{ entry.metric.version }} · {{ operationLabel(entry.operation) }}</h3><p>{{ entry.created_at }} · 操作人 {{ entry.actor_id || '系统' }}</p><p>{{ entry.metric.name }} · {{ entry.metric.dashboard }} · {{ entry.metric.period }}</p><p>口径状态：{{ entry.metric.status }}；{{ entry.metric.enabled ? '已启用' : '已停用' }}</p><p>业务定义：{{ entry.metric.definition }}</p><p>公式说明：{{ entry.metric.formula }}</p><p>数据源说明：{{ entry.metric.source }}</p></article><EmptyState v-if="history.versions.length === 0" title="暂无持久化版本历史" /></template></section></div>
  </section>
  <ConfirmDialog
    :open="Boolean(confirmDialog)"
    v-bind="confirmDialog || {}"
    @confirm="acceptConfirm"
    @cancel="cancelConfirm"
  />
</template>

<style scoped>
.da-dict-page { display: grid; gap: 0; }
.da-dict-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 16px; }
.da-dict-search { flex: 1; max-width: 420px; height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid var(--da-line); border-radius: 8px; background: var(--surface-card); }
.da-dict-search svg { width: 15px; height: 15px; color: var(--text-muted); }
.da-dict-search input { width: 100%; border: 0; outline: 0; color: var(--text); background: transparent; font-size:  var(--fs-sm); }
.da-dict-toolbar-spacer { flex: 1; }
.da-dict-list { display: grid; gap: 0; }
.da-dict-section { display: grid; gap: 0; }
.da-dict-group { display: flex; align-items: center; justify-content: space-between; margin: 18px 0 8px; padding-left: 8px; border-left: 3px solid var(--primary); color: var(--text); font-size:  var(--fs-sm); font-weight: 700; }
.da-dict-group span { color: var(--text-muted); font-size:  var(--fs-xs); font-weight: 400; }
.da-dict-item { margin-bottom: 12px; padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 12px; background: var(--surface-card); box-shadow: 0 1px 3px rgba(0, 0, 0, .06); }
.da-dict-item h4 { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: 0; color: var(--text); font-size:  var(--fs-body); }
.da-dict-item h4 > span:first-child { margin-right: 2px; font-weight: 600; }
.da-dict-origin { color: var(--text-muted); font-size:  var(--fs-xs); }
.da-dict-meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 18px; margin-top: 10px; color: var(--text-secondary); font-size:  var(--fs-xs); line-height: 1.6; }
.da-dict-meta-grid span { overflow-wrap: anywhere; }
.da-dict-meta-grid b { margin-right: 4px; color: var(--text-muted); font-weight: 600; }
.da-dict-item-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.da-dict-note-panel { margin-top: 8px; }
.da-dict-meta { margin: 6px 0 0; color: var(--text-muted); font-size:  var(--fs-xs); }
.da-dict-meta:first-of-type { margin-top: 14px; }
.da-dict-hint { display: block; margin: 6px 0 0; color: var(--text-muted); font-size:  var(--fs-xs); }
.da-dict-message { padding: 12px; background: var(--surface-card)7ed; color: var(--warning-text); border-radius: 8px; }
.da-dict-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.da-dict-history { max-height: 85vh; overflow: auto; }
.da-dict-history-entry { border-bottom: 1px solid var(--border); padding: 12px 0; overflow-wrap: anywhere; }

[data-theme="dark"] .da-dict-meta,
[data-theme="dark"] .da-dict-hint,
[data-theme="dark"] .da-dict-origin {
  color: var(--text-muted);
}
[data-theme="dark"] .da-dict-search,
[data-theme="dark"] .da-dict-item {
  background: var(--surface-card);
  border-color: var(--border);
}
[data-theme="dark"] .da-dict-search input { color: var(--text); }
[data-theme="dark"] .da-dict-message {
  background: var(--warning-soft);
  color: var(--text-on-warning);
}
[data-theme="dark"] .da-dict-history-entry {
  border-bottom-color: var(--border);
}
</style>
