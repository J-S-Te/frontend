<script setup>
// 预警规则配置（P-10，alert.manage）：阈值参数暂存于看板配置库，
// 由后端整表替换并写入审计；开关状态先本地标记，保存时统一提交。
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
const isAdmin = computed(() => props.permissions.includes("admin"))
const keyword = ref("")
let toastTimer = 0

const canManage = computed(() => props.permissions.includes("alert.manage"))
const dirtyCount = computed(() => rules.value.filter((rule) => rule.enabled !== rule.originalEnabled).length)

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

async function load() {
  loading.value = true
  error.value = null
  try {
    rules.value = (await getAlertRules()).map((rule) => ({ ...rule, originalEnabled: rule.enabled }))
  } catch (err) {
    error.value = err?.message || "预警规则加载失败"
  } finally {
    loading.value = false
  }
}

function toggleRule(rule) {
  if (!canManage.value || !isAdmin.value) return
  rule.enabled = !rule.enabled
}

function openEditor(rule = null) {
  if (!isAdmin.value) return
  editing.value = rule ? "edit" : "create"
  draft.value = rule
    ? { ...rule, threshold_json: rule.threshold_json || '{"days":30}' }
    : { rule_code: "CONTRACT_EXPIRY", name: "合同到期提醒", source_fct: "dim_contract", severity: "MEDIUM", enabled: true, threshold_json: '{"days":30}' }
}

function closeEditor() {
  editing.value = null
  draft.value = null
}

function draftThresholdDays() {
  try { return JSON.parse(draft.value?.threshold_json || "{}").days || 30 } catch { return 30 }
}

function setDraftThresholdDays(value) {
  if (!draft.value) return
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
  if (!isAdmin.value || saving.value) return
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
      ? rules.value.map((rule) => rule.id === draft.value.id ? { ...draft.value } : rule).map(({ originalEnabled, ...rule }) => rule)
      : [...rules.value, draft.value].map(({ originalEnabled, ...rule }) => rule)
    const saved = await putAlertRules(payload)
    rules.value = saved.map((rule) => ({ ...rule, originalEnabled: rule.enabled }))
    closeEditor()
    showToast(mode === "create" ? "规则已创建" : "规则已更新")
  } catch (err) {
    showToast(err?.message || "保存失败")
  } finally {
    saving.value = false
  }
}

async function onSave() {
  if (saving.value) return
  saving.value = true
  try {
    const saved = await putAlertRules(rules.value.map(({ originalEnabled, ...rule }) => rule))
    rules.value = saved.map((rule) => ({ ...rule, originalEnabled: rule.enabled }))
    showToast("预警规则已保存")
  } catch (err) {
    showToast(err?.message || "保存失败")
  } finally {
    saving.value = false
  }
}

async function removeRule(rule) {
  if (!isAdmin.value || saving.value || !window.confirm(`确认删除规则“${rule.name || rule.rule_code}”吗？已有历史预警的规则只能停用。`)) return
  saving.value = true
  try {
    await deleteAlertRule(rule.id)
    rules.value = rules.value.filter((item) => item.id !== rule.id)
    showToast("规则已删除")
  } catch (err) {
    showToast(err?.message || "删除失败")
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
      <button v-if="isAdmin" class="da-button" :disabled="saving" @click="openEditor()"><ConsoleIcon name="plus" />新建规则</button>
      <button class="da-button primary" :disabled="saving || !canManage || !isAdmin" @click="onSave"><ConsoleIcon name="save" />{{ saving ? '保存中…' : '保存修改' }}</button>
    </div>

    <LoadingState v-if="loading" title="预警规则加载中…" />
    <ErrorState v-else-if="error" :error="error" @retry="load" />
    <div v-else class="da-table-panel">
      <div class="da-table-scroll">
        <table class="da-table">
          <thead><tr><th>规则编码</th><th>规则名称</th><th>数据源</th><th>严重度</th><th>阈值参数</th><th>启用</th><th v-if="isAdmin">操作</th></tr></thead>
          <tbody>
            <tr v-for="rule in filteredRules" :key="rule.rule_code">
              <td class="mono"><b>{{ rule.rule_code }}</b></td>
              <td>{{ rule.name || '—' }}</td>
              <td>{{ rule.source_fct || '—' }}</td>
              <td><span class="da-badge" :class="String(rule.severity).toUpperCase() === 'HIGH' ? 'high' : String(rule.severity).toUpperCase() === 'MEDIUM' ? 'warning' : 'info'">{{ SEVERITY_LABELS[String(rule.severity).toUpperCase()] || rule.severity }}</span></td>
              <td class="mono"><small>{{ rule.threshold_json || '—' }}</small></td>
              <td><button class="da-switch" :class="{ on: rule.enabled }" :aria-label="`${rule.enabled ? '停用' : '启用'} ${rule.rule_code}`" @click="toggleRule(rule)"><i></i></button></td>
              <td v-if="isAdmin"><div class="da-rule-actions"><button class="da-button compact" @click="openEditor(rule)">编辑</button><button class="da-button compact danger" @click="removeRule(rule)">删除</button></div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <EmptyState v-if="filteredRules.length === 0" title="暂无预警规则" description="尚未配置任何预警规则" />
      <footer v-else><span>共 {{ filteredRules.length }} 条规则{{ dirtyCount ? ` · ${dirtyCount} 处未保存修改` : '' }}</span><span>变更保存后对新触发生效</span></footer>
    </div>

    <div v-if="editing && draft" class="da-modal-backdrop" @click.self="closeEditor">
      <form class="da-modal" @submit.prevent="saveEditor">
        <header><div><b>{{ editing === 'create' ? '新建预警规则' : '编辑预警规则' }}</b><span>仅超级管理员可操作</span></div><button type="button" class="da-icon-button" aria-label="关闭" @click="closeEditor">×</button></header>
        <label>规则编码<select v-model="draft.rule_code"><option value="CONTRACT_EXPIRY">CONTRACT_EXPIRY · 合同到期</option></select></label>
        <label>规则名称<input v-model="draft.name" maxlength="128" /></label>
        <label>严重度<select v-model="draft.severity"><option value="HIGH">高</option><option value="MEDIUM">中</option><option value="LOW">低</option></select></label>
        <label>提前天数<input :value="draftThresholdDays()" type="number" min="1" max="3650" step="1" @input="setDraftThresholdDays($event.target.value)" /></label>
        <p class="da-modal-help">合同结束日期在当前日期起 1～3650 天内时触发预警，系统会自动保存为标准阈值 JSON。</p>
        <footer><button type="button" class="da-button" @click="closeEditor">取消</button><button type="submit" class="da-button primary" :disabled="saving">{{ saving ? '保存中…' : '确认保存' }}</button></footer>
      </form>
    </div>

    <Transition name="da-toast"><div v-if="toast" class="da-toast"><span>✓</span>{{ toast }}</div></Transition>
  </section>
</template>
