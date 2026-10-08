<script setup>
// 预警规则配置（P-10，alert.manage）：阈值参数暂存于看板配置库，
// 由后端整表替换并写入审计；所有写操作串行，成功后才更新已保存状态。
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import ConsoleIcon from "@/modules/platform/shared/components/ConsoleIcon.vue"
import EmptyState from "@/modules/platform/shared/components/EmptyState.vue"
import ErrorState from "@/modules/platform/shared/components/ErrorState.vue"
import LoadingState from "@/modules/platform/shared/components/LoadingState.vue"
import { deleteAlertRule, getAlertRules, putAlertRules } from "../api/dataAnalysis"

const props = defineProps({ permissions: { type: Array, default: () => [] } })

const rules = ref([])
const loading = ref(true)
const error = ref(null)
const saving = ref(false)
const toast = ref("")
const editing = ref(null)
const draft = ref(null)
const keyword = ref("")
let toastTimer = 0
let loadPending = false

const canManage = computed(() => props.permissions.includes("alert.manage"))
const canWrite = computed(() => canManage.value && !loading.value && !error.value && !saving.value)
const canCreate = computed(() => canWrite.value && !rules.value.some((rule) => rule.rule_code === "CONTRACT_EXPIRY"))

const filteredRules = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return rules.value
  return rules.value.filter((rule) => [rule.rule_code, rule.name, rule.source_fct].join(" ").toLowerCase().includes(query))
})

const SEVERITY_LABELS = { HIGH: "高", MEDIUM: "中", LOW: "低" }

function showToast(message) {
  toast.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = "" }, 2600)
}

function mutationError(err, fallback) {
  return err?.code === "RULE_VERSION_CONFLICT"
    ? "规则已被其他用户修改，请刷新规则后重试"
    : err?.message || fallback
}

async function load() {
  if (loadPending || saving.value || editing.value) return
  loadPending = true
  loading.value = true
  error.value = null
  try {
    rules.value = await getAlertRules()
  } catch (err) {
    error.value = err?.message || "预警规则加载失败"
  } finally {
    loadPending = false
    loading.value = false
  }
}

async function toggleRule(rule) {
  if (!canWrite.value || editing.value || !rules.value.includes(rule)) return
  saving.value = true
  try {
    const payload = rules.value.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : { ...item })
    const saved = await putAlertRules(payload)
    rules.value = saved
    showToast(rule.enabled ? "规则已停用" : "规则已启用")
  } catch (err) {
    showToast(mutationError(err, "规则状态保存失败"))
  } finally {
    saving.value = false
  }
}

function openEditor(rule = null) {
  if (!canWrite.value || (rule ? !rules.value.includes(rule) : !canCreate.value)) return
  editing.value = rule ? "edit" : "create"
  draft.value = rule
    ? { ...rule, threshold_json: rule.threshold_json || '{"days":30}' }
    : { rule_code: "CONTRACT_EXPIRY", name: "合同到期提醒", source_fct: "dim_contract", severity: "MEDIUM", enabled: false, threshold_json: '{"days":30}' }
}

function closeEditor() {
  if (saving.value) return
  editing.value = null
  draft.value = null
}

function draftThresholdDays() {
  try { return JSON.parse(draft.value?.threshold_json || "{}").days ?? 30 } catch { return 30 }
}

function setDraftThresholdDays(value) {
  if (!draft.value || saving.value) return
  draft.value.threshold_json = JSON.stringify({ days: Number(value) })
}

function validateDraft() {
  if (!draft.value?.name?.trim() || draft.value.rule_code !== "CONTRACT_EXPIRY" || draft.value.source_fct !== "dim_contract") return "当前仅支持合同到期规则，且名称不能为空"
  let threshold
  try { threshold = JSON.parse(draft.value.threshold_json) } catch { return "阈值必须是 JSON，例如 {\"days\":30}" }
  if (!Number.isInteger(threshold.days) || threshold.days < 1 || threshold.days > 3650) return "合同到期提前天数必须为 1～3650 的整数"
  if (!["LOW", "MEDIUM", "HIGH"].includes(draft.value.severity)) return "请选择有效的严重度"
  return ""
}

async function saveEditor() {
  if (!canWrite.value || !editing.value || !draft.value) return
  const validationError = validateDraft()
  if (validationError) { showToast(validationError); return }
  if (editing.value === "create" && rules.value.some((rule) => rule.rule_code === draft.value.rule_code)) {
    showToast("该规则已存在，请直接编辑现有规则")
    return
  }
  const mode = editing.value
  saving.value = true
  try {
    const payload = editing.value === "edit"
      ? rules.value.map((rule) => rule.id === draft.value.id ? { ...draft.value, name: draft.value.name.trim() } : { ...rule })
      : [...rules.value, { ...draft.value, name: draft.value.name.trim() }]
    const saved = await putAlertRules(payload)
    rules.value = saved
    editing.value = null
    draft.value = null
    showToast(mode === "create" ? "规则已创建" : "规则已更新")
  } catch (err) {
    showToast(mutationError(err, "保存失败"))
  } finally {
    saving.value = false
  }
}

async function removeRule(rule) {
  if (!canWrite.value || editing.value || !rules.value.includes(rule) || !window.confirm(`确认删除规则“${rule.name || rule.rule_code}”吗？已有历史预警的规则只能停用。`)) return
  saving.value = true
  try {
    await deleteAlertRule(rule.id)
    rules.value = rules.value.filter((item) => item.id !== rule.id)
    showToast("规则已删除")
  } catch (err) {
    showToast(mutationError(err, "删除失败"))
  } finally {
    saving.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => window.clearTimeout(toastTimer))
</script>

<template>
  <section>
    <div class="da-filters">
      <label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索规则编码 / 名称 / 数据源" /></label>
      <span>{{ filteredRules.length }} 条规则</span>
      <button class="da-button" :disabled="loading || saving || !!editing" @click="load">刷新规则</button>
      <button v-if="canManage" class="da-button" :disabled="!canCreate || !!editing" @click="openEditor()"><ConsoleIcon name="plus" />新建规则</button>
      <span v-if="saving" role="status">保存中…</span>
    </div>

    <LoadingState v-if="loading" title="预警规则加载中…" />
    <ErrorState v-else-if="error" :error="error" @retry="load" />
    <div v-else class="da-table-panel">
      <div class="da-table-scroll">
        <table class="da-table">
          <thead><tr><th>规则编码</th><th>规则名称</th><th>数据源</th><th>严重度</th><th>阈值参数</th><th>启用</th><th v-if="canManage">操作</th></tr></thead>
          <tbody>
            <tr v-for="rule in filteredRules" :key="rule.rule_code">
              <td class="mono"><b>{{ rule.rule_code }}</b></td>
              <td>{{ rule.name || '—' }}</td>
              <td>{{ rule.source_fct || '—' }}</td>
              <td><span class="da-badge" :class="String(rule.severity).toUpperCase() === 'HIGH' ? 'high' : String(rule.severity).toUpperCase() === 'MEDIUM' ? 'warning' : 'info'">{{ SEVERITY_LABELS[String(rule.severity).toUpperCase()] || rule.severity }}</span></td>
              <td class="mono"><small>{{ rule.threshold_json || '—' }}</small></td>
              <td><button class="da-switch" :class="{ on: rule.enabled }" :disabled="!canWrite || !!editing" role="switch" :aria-checked="rule.enabled" :aria-label="`${rule.enabled ? '停用' : '启用'} ${rule.rule_code}`" @click="toggleRule(rule)"><i></i></button></td>
              <td v-if="canManage"><div class="da-rule-actions"><button class="da-button compact" :disabled="!canWrite || !!editing" @click="openEditor(rule)">编辑</button><button class="da-button compact danger" :disabled="!canWrite || !!editing" @click="removeRule(rule)">删除</button></div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <EmptyState v-if="filteredRules.length === 0" :title="keyword.trim() ? '未找到匹配规则' : '暂无预警规则'" :description="keyword.trim() ? '请调整搜索关键词' : '当前支持合同到期提醒（CONTRACT_EXPIRY），可新建规则后启用。'" />
      <footer><span>当前支持合同到期提醒，每种规则仅可配置一条。</span><span>开关立即保存；已有历史预警的规则只能停用。</span></footer>
    </div>

    <div v-if="editing && draft" class="da-modal-backdrop" @click.self="closeEditor">
      <form class="da-modal" @submit.prevent="saveEditor">
        <header><div><b>{{ editing === 'create' ? '新建预警规则' : '编辑预警规则' }}</b><span>需要预警管理权限</span></div><button type="button" class="da-icon-button" :disabled="saving" aria-label="关闭" @click="closeEditor">×</button></header>
        <label>规则编码<select v-model="draft.rule_code" disabled><option value="CONTRACT_EXPIRY">CONTRACT_EXPIRY · 合同到期</option></select></label>
        <label>规则名称<input v-model="draft.name" :disabled="!canWrite" maxlength="128" required /></label>
        <label>严重度<select v-model="draft.severity" :disabled="!canWrite"><option value="HIGH">高</option><option value="MEDIUM">中</option><option value="LOW">低</option></select></label>
        <label>提前天数<input :value="draftThresholdDays()" :disabled="!canWrite" type="number" min="1" max="3650" step="1" required @input="setDraftThresholdDays($event.target.value)" /></label>
        <p v-if="editing === 'create'" class="da-modal-help">新规则默认停用，创建后可通过列表开关启用。</p>
        <p class="da-modal-help">合同结束日期在当前日期起 1～3650 天内时触发预警，系统会自动保存为标准阈值 JSON。</p>
        <footer><button type="button" class="da-button" :disabled="saving" @click="closeEditor">取消</button><button type="submit" class="da-button primary" :disabled="!canWrite">{{ saving ? '保存中…' : '确认保存' }}</button></footer>
      </form>
    </div>

    <Transition name="da-toast"><div v-if="toast" class="da-toast"><span>✓</span>{{ toast }}</div></Transition>
  </section>
</template>
