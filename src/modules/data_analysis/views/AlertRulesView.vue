<script setup>
import OperationToast from '@/modules/shared/components/OperationToast.vue'
// 预警规则配置（P-10，alert.manage）：阈值参数暂存于看板配置库，
// 由后端整表替换并写入审计；所有写操作串行，成功后才更新已保存状态。
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { useConfirmDialog } from "@/modules/shared/composables/useConfirmDialog.js"
import ConfirmDialog from "@/modules/shared/components/ConfirmDialog.vue"
import ConsoleIcon from "@/modules/shared/components/ConsoleIcon.vue"
import EmptyState from "@/modules/shared/components/EmptyState.vue"
import ErrorState from "@/modules/shared/components/ErrorState.vue"
import LoadingState from "@/modules/shared/components/LoadingState.vue"
import { deleteAlertRule, getAlertRuleExecutions, getAlertRules, getAlertRuleScopeOptions, previewAlertRule, putAlertRules } from "../api/dataAnalysis"
import { formatDataAnalysisError } from "../utils/errors.js"

const props = defineProps({ permissions: { type: Array, default: () => [] } })

const rules = ref([])
const executions = ref([])
const loading = ref(true)
const error = ref(null)
const saving = ref(false)
const { dialog: confirmDialog, askConfirm, accept: acceptConfirm, cancel: cancelConfirm } = useConfirmDialog()
const toast = ref("")
const editing = ref(null)
const draft = ref(null)
let editorInitialSnapshot = ""
const keyword = ref("")
const scopeOwnerOrgIDs = ref([])
const scopeCustomerTypes = ref([])
const scopeCurrencies = ref([])
const scopeOptions = ref({ owner_org_ids: [], organizations: [], customer_types: [], currencies: [], users: [] })
const notificationEnabled = ref(false)
const notificationRecipients = ref([])
const quietStart = ref("")
const quietEnd = ref("")
const escalationMinutes = ref("")
const escalationRecipients = ref([])
const scopeOptionsLoading = ref(false)
const scopeOptionsError = ref("")
const scopeAmountMinYuan = ref("")
const scopeAmountMaxYuan = ref("")
const previewBusy = ref(false)
const previewError = ref("")
const previewResult = ref(null)
let toastTimer = 0
let loadPending = false

const canManage = computed(() => props.permissions.includes("alert.manage"))
const canWrite = computed(() => canManage.value && !loading.value && !error.value && !saving.value)
// 同一规则编码可保存多份命名配置；最多一条启用，由保存接口再次校验。
const canCreate = computed(() => canWrite.value)

const filteredRules = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return rules.value
  return rules.value.filter((rule) => [rule.rule_code, rule.name, rule.source_fct].join(" ").toLowerCase().includes(query))
})

const SEVERITY_LABELS = { HIGH: "高", MEDIUM: "中", LOW: "低" }

function showToast(message) {
  toast.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = "" }, 5200)
}

// 用途：显示真实操作结果，保存完成后的读取故障冻结旧版本编辑直到刷新。
// 参数：err 为服务端错误回执，fallback 为当前动作的兜底提示。
// 返回值：安全中文提示；明确已保存时关闭旧编辑并开启只读错误态。
function mutationError(err, fallback) {
  const message = formatDataAnalysisError(err, { fallback })
  if (!err?.outcomeUnknown && err?.status === 500 && err?.code === 'RULE_SAVED_REFRESH_FAILED'
    && err?.details?.saved === true && err?.details?.refresh_failed === true) {
    error.value = message
    editing.value = null
    draft.value = null
    editorInitialSnapshot = ''
  }
  return message
}

async function load() {
  if (loadPending || saving.value || editing.value) return
  loadPending = true
  loading.value = true
  error.value = null
  try {
    const [loadedRules, loadedExecutions] = await Promise.all([
      getAlertRules(),
      getAlertRuleExecutions().catch(() => []),
    ])
    rules.value = loadedRules
    executions.value = Array.isArray(loadedExecutions) ? loadedExecutions : []
  } catch (err) {
    error.value = formatDataAnalysisError(err, { fallback: "预警规则加载失败，请稍后刷新。" })
  } finally {
    loadPending = false
    loading.value = false
  }
}

async function toggleRule(rule) {
  if (!canWrite.value || editing.value || !rules.value.includes(rule)) return
  saving.value = true
  try {
    const nextEnabled = !rule.enabled
    const payload = rules.value.map((item) => {
      if (item.id === rule.id) return { ...item, enabled: nextEnabled }
      if (nextEnabled && item.rule_code === rule.rule_code) return { ...item, enabled: false }
      return { ...item }
    })
    const saved = await putAlertRules(payload)
    rules.value = saved
    showToast(rule.enabled ? "规则已停用" : "规则已启用；同编码其他配置已自动停用")
  } catch (err) {
    showToast(mutationError(err, "规则状态保存失败"))
  } finally {
    saving.value = false
  }
}

// 用途：生成不与现有规则重名的默认名称，避免后端唯一名称冲突。
// 参数：无；读取当前规则列表。
// 返回值：可编辑的默认名称。
function nextRuleName() {
  const base = "合同到期提醒"
  if (!rules.value.some((item) => item.name === base)) return base
  let index = 2
  while (rules.value.some((item) => item.name === `${base}（${index}）`)) index += 1
  return `${base}（${index}）`
}


function parseYuanToMinor(value, label) {
  if (String(value ?? "").trim() === "") return { value: null, error: "" }
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return { value: null, error: `${label}必须是非负金额` }
  return { value: Math.round(number * 100), error: "" }
}

function buildScopeJSON() {
  const ownerOrgIDs = [...new Set((scopeOwnerOrgIDs.value || []).map((item) => String(item).trim()).filter(Boolean))]
  const customerTypes = [...new Set((scopeCustomerTypes.value || []).map((item) => String(item).trim()).filter(Boolean))]
  const currencies = [...new Set((scopeCurrencies.value || []).map((item) => String(item).trim().toUpperCase()).filter(Boolean))]
  const min = parseYuanToMinor(scopeAmountMinYuan.value, "最低金额")
  const max = parseYuanToMinor(scopeAmountMaxYuan.value, "最高金额")
  if (min.error || max.error) return { value: null, error: min.error || max.error }
  if (min.value !== null && max.value !== null && min.value > max.value) {
    return { value: null, error: "最低金额不能高于最高金额" }
  }
  if (!ownerOrgIDs.length && !customerTypes.length && !currencies.length && min.value === null && max.value === null) {
    return { value: null, error: "" }
  }
  return {
    value: JSON.stringify({
      owner_org_ids: ownerOrgIDs,
      customer_types: customerTypes,
      currencies,
      amount_min_minor: min.value,
      amount_max_minor: max.value,
    }),
    error: "",
  }
}

function resetScopeFields(rule) {
  let scope = {}
  try { scope = rule?.scope_json ? JSON.parse(rule.scope_json) : {} } catch { scope = {} }
  scopeOwnerOrgIDs.value = Array.isArray(scope.owner_org_ids) ? [...scope.owner_org_ids] : []
  scopeCustomerTypes.value = Array.isArray(scope.customer_types) ? [...scope.customer_types] : []
  scopeCurrencies.value = Array.isArray(scope.currencies) ? [...scope.currencies] : []
  scopeAmountMinYuan.value = Number.isSafeInteger(scope.amount_min_minor) ? (scope.amount_min_minor / 100).toFixed(2) : ""
  scopeAmountMaxYuan.value = Number.isSafeInteger(scope.amount_max_minor) ? (scope.amount_max_minor / 100).toFixed(2) : ""
  let notification = {}
  try { notification = rule?.notification_json ? JSON.parse(rule.notification_json) : {} } catch { notification = {} }
  notificationEnabled.value = Boolean(notification.enabled)
  notificationRecipients.value = Array.isArray(notification.recipients) ? [...notification.recipients] : []
  quietStart.value = notification.quiet_start || ""
  quietEnd.value = notification.quiet_end || ""
  escalationMinutes.value = Number.isInteger(notification.escalation_after_minutes) && notification.escalation_after_minutes > 0 ? String(notification.escalation_after_minutes) : ""
  escalationRecipients.value = Array.isArray(notification.escalation_recipients) ? [...notification.escalation_recipients] : []
  previewResult.value = null
  previewError.value = ""
}


function executionFor(rule) {
  return executions.value.find((item) => item.rule_id === rule.id) || null
}

function executionSummary(rule) {
  const execution = executionFor(rule)
  if (!execution) return "未执行"
  const count = Number(execution.matched_count || 0)
  if (execution.status === "FAILED") return `执行失败 · 命中 ${count}`
  return `最近执行成功 · 命中 ${count}`
}

function ruleScopeSummary(rule) {
  let scope = {}
  try { scope = rule?.scope_json ? JSON.parse(rule.scope_json) : {} } catch { scope = {} }
  const parts = []
  if (Array.isArray(scope.owner_org_ids) && scope.owner_org_ids.length) parts.push(`组织 ${scope.owner_org_ids.length}`)
  if (Array.isArray(scope.customer_types) && scope.customer_types.length) parts.push(`客户类型 ${scope.customer_types.length}`)
  if (Number.isSafeInteger(scope.amount_min_minor) || Number.isSafeInteger(scope.amount_max_minor)) {
    const min = Number.isSafeInteger(scope.amount_min_minor) ? `¥${(scope.amount_min_minor / 100).toFixed(2)}` : "不限"
    const max = Number.isSafeInteger(scope.amount_max_minor) ? `¥${(scope.amount_max_minor / 100).toFixed(2)}` : "不限"
    parts.push(`金额 ${min}–${max}`)
  }
  return parts.length ? parts.join(" · ") : "全部普通合同"
}

function ruleEffectiveSummary(rule) {
  if (!rule?.effective_from && !rule?.effective_to) return "长期有效"
  if (rule.effective_from && rule.effective_to) return `${rule.effective_from} 至 ${rule.effective_to}`
  return rule.effective_from ? `${rule.effective_from} 起` : `至 ${rule.effective_to}`
}

async function previewDraft() {
  if (!draft.value || previewBusy.value || saving.value) return
  const validation = validateDraft()
  if (validation) { previewError.value = validation; previewResult.value = null; return }
  const scope = buildScopeJSON()
  if (scope.error) { previewError.value = scope.error; previewResult.value = null; return }
  previewBusy.value = true
  previewError.value = ""
  previewResult.value = null
  try {
    previewResult.value = await previewAlertRule({ days: draftThresholdDays(), scope_json: scope.value })
  } catch (err) {
    previewError.value = formatDataAnalysisError(err, { fallback: "命中预览读取失败，请稍后重试。" })
  } finally {
    previewBusy.value = false
  }
}



async function loadScopeOptions() {
  scopeOptionsLoading.value = true
  scopeOptionsError.value = ""
  try {
    const result = await getAlertRuleScopeOptions()
    scopeOptions.value = {
      owner_org_ids: Array.isArray(result?.owner_org_ids) ? result.owner_org_ids : [],
      customer_types: Array.isArray(result?.customer_types) ? result.customer_types : [],
      currencies: Array.isArray(result?.currencies) ? result.currencies : [],
      organizations: Array.isArray(result?.organizations) ? result.organizations : [],
      users: Array.isArray(result?.users) ? result.users : [],
    }
  } catch (err) {
    scopeOptionsError.value = formatDataAnalysisError(err, { fallback: "范围选项读取失败，可直接使用已有值。" })
  } finally {
    scopeOptionsLoading.value = false
  }
}



function buildNotificationJSON() {
  const recipients = [...new Set((notificationRecipients.value || []).map((item) => String(item).trim()).filter(Boolean))]
  const escalated = [...new Set((escalationRecipients.value || []).map((item) => String(item).trim()).filter(Boolean))]
  const minutes = String(escalationMinutes.value ?? "").trim() === "" ? 0 : Number(escalationMinutes.value)
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) return { value: null, error: "升级时间必须是 0–10080 分钟" }
  if ((quietStart.value && !quietEnd.value) || (!quietStart.value && quietEnd.value)) return { value: null, error: "静默开始和结束必须同时填写" }
  if (notificationEnabled.value && recipients.length === 0) return { value: null, error: "开启通知后至少选择一个通知对象" }
  if (minutes > 0 && escalated.length === 0) return { value: null, error: "配置升级时至少选择一个升级对象" }
  if (!notificationEnabled.value && recipients.length === 0 && !quietStart.value && minutes === 0) return { value: null, error: "" }
  return {
    value: JSON.stringify({
      enabled: notificationEnabled.value,
      recipients,
      quiet_start: quietStart.value,
      quiet_end: quietEnd.value,
      escalation_after_minutes: minutes,
      escalation_recipients: escalated,
    }),
    error: "",
  }
}


function recipientOptions() {
  return (scopeOptions.value.users || []).filter((user) => String(user?.display_name || "").trim())
}

function recipientName(userID) {
  const option = (scopeOptions.value.users || []).find((item) => item.user_id === userID)
  return option?.display_name || userID
}


function organizationOptions() {
  if (Array.isArray(scopeOptions.value.organizations) && scopeOptions.value.organizations.length) {
    return scopeOptions.value.organizations
  }
  return (scopeOptions.value.owner_org_ids || []).map((id) => ({ org_unit_id: id, org_unit_name: "" }))
}

function orgLabel(id) {
  const org = organizationOptions().find((item) => item.org_unit_id === id)
  return org?.org_unit_name ? `${org.org_unit_name}（${id}）` : id
}

function selectedRecipientLabel(values, placeholder) {
  const selected = Array.isArray(values) ? values.filter(Boolean) : []
  if (!selected.length) return placeholder
  if (selected.length <= 2) return selected.map(recipientName).join("、")
  return `已选 ${selected.length} 人`
}

function selectedScopeLabel(values, placeholder) {
  const selected = Array.isArray(values) ? values.filter(Boolean) : []
  if (!selected.length) return placeholder
  if (selected.length <= 2) return selected.map((id) => orgLabel(id)).join("、")
  return `已选 ${selected.length} 项`
}

function scopeOptionValues(key) {
  const selected = key === "owner_org_ids"
    ? scopeOwnerOrgIDs.value
    : key === "customer_types" ? scopeCustomerTypes.value : scopeCurrencies.value
  return [...new Set([...(scopeOptions.value[key] || []), ...(selected || [])])]
}

function editorSnapshot() {
  return JSON.stringify({
    draft: draft.value,
    ownerOrgIDs: [...scopeOwnerOrgIDs.value],
    customerTypes: [...scopeCustomerTypes.value],
    currencies: [...scopeCurrencies.value],
    amountMin: scopeAmountMinYuan.value,
    amountMax: scopeAmountMaxYuan.value,
    notificationEnabled: notificationEnabled.value,
    notificationRecipients: [...notificationRecipients.value],
    quietStart: quietStart.value,
    quietEnd: quietEnd.value,
    escalationMinutes: escalationMinutes.value,
    escalationRecipients: [...escalationRecipients.value],
  })
}

function openEditor(rule = null) {
  if (!canWrite.value || (rule ? !rules.value.includes(rule) : !canCreate.value)) return
  editing.value = rule ? "edit" : "create"
  draft.value = rule
    ? { ...rule, threshold_json: rule.threshold_json || '{"days":30}' }
    : { rule_code: "CONTRACT_EXPIRY", name: nextRuleName(), source_fct: "dim_contract", severity: "MEDIUM", enabled: false, threshold_json: '{"days":30}', scope_json: null, effective_from: null, effective_to: null }
  resetScopeFields(rule)
  void loadScopeOptions()
  editorInitialSnapshot = editorSnapshot()
}

async function closeEditor() {
  if (saving.value || !editing.value || confirmDialog.value) return
  const current = draft.value
  if (editorInitialSnapshot !== editorSnapshot()) {
    const discard = await askConfirm({ title: '放弃预警规则编辑？', description: '当前表单有未保存的修改，放弃后不会保留。', confirmText: '放弃修改', cancelText: '继续编辑', danger: true })
    if (!discard || saving.value || draft.value !== current) return
  }
  editing.value = null
  draft.value = null
  editorInitialSnapshot = ""
}


function setRuleCode(code) {
  if (!draft.value) return
  draft.value.rule_code = code
  draft.value.source_fct = code === "PAYMENT_OVERDUE" ? "standard_finance_fact" : "dim_contract"
  if (code === "PAYMENT_OVERDUE") {
    draft.value.threshold_json = '{"days":7}'
    draft.value.scope_json = null
    draft.value.notification_json = draft.value.notification_json || null
  }
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
  const scope = buildScopeJSON()
  if (scope.error) return scope.error
  if (draft.value.effective_from && draft.value.effective_to && draft.value.effective_from > draft.value.effective_to) return "生效开始日期不能晚于结束日期"
  return ""
}

async function saveEditor() {
  if (!canWrite.value || !editing.value || !draft.value) return
  const validationError = validateDraft()
  if (validationError) { showToast(validationError); return }
  if (rules.value.some((rule) => rule.id !== draft.value.id && rule.name.trim() === draft.value.name.trim())) {
    showToast("规则名称已存在，请换一个名称")
    return
  }
  const mode = editing.value
  const scope = buildScopeJSON()
  if (scope.error) { showToast(scope.error); return }
  draft.value.scope_json = scope.value
  const notification = buildNotificationJSON()
  if (notification.error) { showToast(notification.error); return }
  draft.value.notification_json = notification.value
  draft.value.effective_from = draft.value.effective_from || null
  draft.value.effective_to = draft.value.effective_to || null
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
  if (!canWrite.value || editing.value || !rules.value.includes(rule)) return
  const ok = await askConfirm({
    title: '删除预警规则？',
    description: `确认删除规则“${rule.name || rule.rule_code}”吗？已有历史预警的规则只能停用。`,
    confirmText: '删除规则',
    cancelText: '取消',
    danger: true,
  })
  if (!ok) return
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
      <label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索规则编码 / 名称 / 数据源"  maxlength="100"/></label>
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
          <thead><tr><th scope="col">规则编码</th><th scope="col">规则名称</th><th scope="col">数据源</th><th scope="col">严重度</th><th scope="col">阈值参数</th><th scope="col">启用</th><th scope="col" v-if="canManage">操作</th></tr></thead>
          <tbody>
            <tr v-for="rule in filteredRules" :key="rule.id">
              <td class="mono"><b>{{ rule.rule_code }}</b></td>
              <td>{{ rule.name || '—' }}<small class="alert-rule-summary">{{ ruleScopeSummary(rule) }} · {{ ruleEffectiveSummary(rule) }}</small>
                <small class="alert-rule-execution" :class="{ failed: executionFor(rule)?.status === 'FAILED' }">{{ executionSummary(rule) }}</small></td>
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
      <footer><span>同一规则编码可配置多条命名规则，但同时只能启用一条；启用新配置会自动停用同编码其他配置。</span><span>开关立即保存；已有历史预警的规则只能停用。</span></footer>
    </div>

    <div v-if="editing && draft" class="da-modal-backdrop" @click.self="closeEditor">
      <form class="da-modal alert-rule-editor" @submit.prevent="saveEditor">
        <header><div><b>{{ editing === 'create' ? '新建预警规则' : '编辑预警规则' }}</b><span>需要预警管理权限</span></div><button type="button" class="da-icon-button" :disabled="saving" aria-label="关闭" @click="closeEditor">×</button></header>
        <label>规则编码<select v-model="draft.rule_code" :disabled="editing === 'edit'" @change="setRuleCode(draft.rule_code)"><option value="CONTRACT_EXPIRY">CONTRACT_EXPIRY · 合同到期</option><option value="PAYMENT_OVERDUE">PAYMENT_OVERDUE · 应收逾期</option></select></label>
        <label>规则名称<input v-model="draft.name" :disabled="!canWrite" maxlength="128" required /></label>
        <label>严重度<select v-model="draft.severity" :disabled="!canWrite"><option value="HIGH">高</option><option value="MEDIUM">中</option><option value="LOW">低</option></select></label>
        <label>{{ draft.rule_code === 'PAYMENT_OVERDUE' ? '宽限天数' : '提前天数' }}<input :value="draftThresholdDays()" :disabled="!canWrite" type="number" min="1" max="3650" step="1" required @input="setDraftThresholdDays($event.target.value)" /></label>
        <section class="alert-rule-scope">
          <div class="alert-rule-scope-head"><b>适用范围</b><span>留空表示全部普通合同</span></div>
          <div class="alert-rule-form-grid">
            <div class="alert-rule-field">
              <span class="alert-rule-field-label">归属组织</span>
              <details class="alert-rule-picker">
                <summary>{{ selectedScopeLabel(scopeOwnerOrgIDs, '全部组织') }}</summary>
                <div class="alert-rule-picker-menu">
                  <label v-for="org in organizationOptions()" :key="org.org_unit_id"><input v-model="scopeOwnerOrgIDs" type="checkbox" :value="org.org_unit_id" :disabled="!canWrite" /><span>{{ org.org_unit_name || org.org_unit_id }}<small v-if="org.org_unit_name"> · {{ org.org_unit_id }}</small></span></label>
                  <p v-if="!organizationOptions().length" class="da-modal-help">暂无可选组织</p>
                </div>
              </details>
            </div>
            <div class="alert-rule-field">
              <span class="alert-rule-field-label">客户类型</span>
              <details class="alert-rule-picker">
                <summary>{{ selectedScopeLabel(scopeCustomerTypes, '全部客户类型') }}</summary>
                <div class="alert-rule-picker-menu">
                  <label v-for="value in scopeOptionValues('customer_types')" :key="value"><input v-model="scopeCustomerTypes" type="checkbox" :value="value" :disabled="!canWrite" /><span>{{ value }}</span></label>
                  <p v-if="!scopeOptionValues('customer_types').length" class="da-modal-help">暂无可选客户类型</p>
                </div>
              </details>
            </div>
            <div class="alert-rule-field">
              <span class="alert-rule-field-label">币种</span>
              <details class="alert-rule-picker">
                <summary>{{ selectedScopeLabel(scopeCurrencies, '全部币种') }}</summary>
                <div class="alert-rule-picker-menu">
                  <label v-for="value in scopeOptionValues('currencies')" :key="value"><input v-model="scopeCurrencies" type="checkbox" :value="value" :disabled="!canWrite" /><span>{{ value }}</span></label>
                  <p v-if="!scopeOptionValues('currencies').length" class="da-modal-help">暂无可选币种</p>
                </div>
              </details>
            </div>
            <label>最低金额（元）<input v-model="scopeAmountMinYuan" :disabled="!canWrite" type="number" min="0" step="0.01" placeholder="不限" /></label>
            <label>最高金额（元）<input v-model="scopeAmountMaxYuan" :disabled="!canWrite" type="number" min="0" step="0.01" placeholder="不限" /></label>
            <label>生效开始<input v-model="draft.effective_from" :disabled="!canWrite" type="date" /></label>
            <label>生效结束<input v-model="draft.effective_to" :disabled="!canWrite" type="date" /></label>
          </div>
          <p v-if="scopeOptionsLoading" class="da-modal-help">正在读取组织、客户类型和币种选项…</p>
          <p v-if="scopeOptionsError" class="alert-rule-preview-error" role="alert">{{ scopeOptionsError }}</p>
          <p class="da-modal-help">选项来自数据看板聚合维度；点击展开勾选，留空表示不限制。</p>
        </section>
        <section class="alert-rule-scope">
          <div class="alert-rule-scope-head"><b>通知与升级</b><label class="alert-rule-toggle"><input v-model="notificationEnabled" type="checkbox" :disabled="!canWrite" /> 启用站内信</label></div>
          <div class="alert-rule-form-grid">
            <div class="alert-rule-field">
              <span class="alert-rule-field-label">通知对象</span>
              <details class="alert-rule-picker">
                <summary>{{ selectedRecipientLabel(notificationRecipients, '未选择通知对象') }}</summary>
                <div class="alert-rule-picker-menu">
                  <label v-for="user in recipientOptions()" :key="user.user_id"><input v-model="notificationRecipients" type="checkbox" :value="user.user_id" :disabled="!canWrite" /><span>{{ user.display_name || user.user_id }}<small v-if="user.org_unit_name"> · {{ user.org_unit_name }}</small></span></label>
                  <p v-if="!recipientOptions().length" class="da-modal-help">暂无已同步姓名的通知对象</p>
                </div>
              </details>
            </div>
            <div class="alert-rule-field">
              <span class="alert-rule-field-label">升级对象</span>
              <details class="alert-rule-picker">
                <summary>{{ selectedRecipientLabel(escalationRecipients, '未选择升级对象') }}</summary>
                <div class="alert-rule-picker-menu">
                  <label v-for="user in recipientOptions()" :key="user.user_id"><input v-model="escalationRecipients" type="checkbox" :value="user.user_id" :disabled="!canWrite" /><span>{{ user.display_name || user.user_id }}<small v-if="user.org_unit_name"> · {{ user.org_unit_name }}</small></span></label>
                  <p v-if="!recipientOptions().length" class="da-modal-help">暂无已同步姓名的升级对象</p>
                </div>
              </details>
            </div>
            <label>静默开始<input v-model="quietStart" :disabled="!canWrite" type="time" maxlength="5" /></label>
            <label>静默结束<input v-model="quietEnd" :disabled="!canWrite" type="time" maxlength="5" /></label>
            <label>到期后升级（分钟）<input v-model="escalationMinutes" :disabled="!canWrite" type="number" min="0" max="10080" step="1" placeholder="不升级" /></label>
          </div>
          <p class="da-modal-help">通知仅在预警命中时发送；静默时段不发送普通通知，已到期升级通知不受静默限制。</p>
        </section>
        <div class="alert-rule-preview-actions">
          <button v-if="draft.rule_code === 'CONTRACT_EXPIRY'" type="button" class="da-button" :disabled="!canWrite || previewBusy" @click="previewDraft">{{ previewBusy ? '预览中…' : '预览命中' }}</button>
          <span v-if="previewResult" class="alert-rule-preview-count">当前条件预计命中 {{ previewResult.matched_count }} 份合同</span>
        </div>
        <p v-if="previewError" class="alert-rule-preview-error" role="alert">{{ previewError }}</p>
        <div v-if="previewResult" class="alert-rule-preview-result">
          <p class="da-modal-help">以下为最多 20 条样例，预览不会创建预警。</p>
          <div v-if="previewResult.sample?.length" class="alert-rule-preview-scroll">
            <table class="da-table"><thead><tr><th>合同</th><th>归属组织</th><th>客户类型</th><th>金额</th><th>到期日</th></tr></thead><tbody>
              <tr v-for="item in previewResult.sample" :key="item.contract_id">
                <td>{{ item.title }}<small>{{ item.contract_id }}</small></td>
                <td>{{ item.owner_org_id || '—' }}</td>
                <td>{{ item.customer_type || '—' }}</td>
                <td>{{ (Number(item.amount_minor || 0) / 100).toFixed(2) }}</td>
                <td>{{ item.due_date }}</td>
              </tr>
            </tbody></table>
          </div>
          <p v-else class="da-modal-help">当前条件下没有命中合同。</p>
          <p v-if="previewResult.limited" class="da-modal-help">仅展示前 20 条，实际命中数高于当前样例数。</p>
        </div>
        <p v-if="editing === 'create'" class="da-modal-help">新规则默认停用，创建后可通过列表开关启用。</p>
        <p v-if="draft.rule_code === 'CONTRACT_EXPIRY'" class="da-modal-help">合同结束日期在当前日期前后 N 天内时触发预警；适用范围只影响规则命中，不改变合同本身。</p>
        <p v-else class="da-modal-help">应收未清金额大于 0 且到期日早于“今天 - 宽限天数”时触发；组织/客户类型范围不适用于应收事实。</p>
        <footer><button type="button" class="da-button" :disabled="saving" @click="closeEditor">取消</button><button type="submit" class="da-button primary" :disabled="!canWrite">{{ saving ? '保存中…' : '确认保存' }}</button></footer>
      </form>
    </div>

    <ConfirmDialog
      :open="Boolean(confirmDialog)"
      v-bind="confirmDialog || {}"
      @confirm="acceptConfirm"
      @cancel="cancelConfirm"
    />

    <OperationToast :message="toast" />
  </section>
</template>

<style scoped>
.alert-rule-editor {
  width: min(760px, 100%);
}


.alert-rule-execution {
  display: block;
  margin-top: 2px;
  color: var(--da-muted);
  font-size: var(--fs-xs);
  font-weight: 400;
}

.alert-rule-execution.failed {
  color: var(--da-red-text);
}

.alert-rule-summary {
  display: block;
  margin-top: 3px;
  color: var(--da-muted);
  font-size: var(--fs-xs);
  font-weight: 400;
  line-height: 1.5;
}

.alert-rule-scope {
  display: grid;
  gap: 9px;
  padding: 12px;
  border: 1px solid var(--da-line);
  border-radius: 9px;
  background: var(--da-soft);
}

.alert-rule-scope-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.alert-rule-scope-head b {
  color: var(--da-ink);
  font-size: var(--fs-xs);
}

.alert-rule-scope-head span {
  color: var(--da-muted);
  font-size: var(--fs-xs);
}


.alert-rule-field {
  display: grid;
  gap: 6px;
  color: var(--da-body);
  font-size: 12px;
  font-weight: 600;
}

.alert-rule-field-label {
  line-height: 1.3;
}

.alert-rule-picker {
  position: relative;
}

.alert-rule-picker summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  box-sizing: border-box;
  min-height: 36px;
  padding: 8px 10px;
  border: 1px solid var(--da-line);
  border-radius: 7px;
  color: var(--da-ink);
  background: var(--surface-card, #fff);
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  list-style: none;
}

.alert-rule-picker summary::-webkit-details-marker {
  display: none;
}

.alert-rule-picker summary::after {
  content: "⌄";
  flex: 0 0 auto;
  color: var(--da-muted);
  font-size: 14px;
}

.alert-rule-picker[open] summary {
  border-color: var(--da-accent);
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.alert-rule-picker-menu {
  display: grid;
  gap: 2px;
  max-height: 168px;
  overflow: auto;
  padding: 5px;
  border: 1px solid var(--da-accent);
  border-top: 0;
  border-radius: 0 0 7px 7px;
  background: var(--surface-card, #fff);
  box-shadow: 0 8px 18px rgba(15, 23, 42, .1);
}

.alert-rule-picker-menu label {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 6px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
}

.alert-rule-picker-menu label:hover {
  background: var(--da-soft);
}

.alert-rule-picker-menu input {
  width: auto;
  margin: 0;
}


.alert-rule-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--da-body);
  font-size: var(--fs-xs);
  font-weight: 600;
}

.alert-rule-toggle input {
  width: auto;
  margin: 0;
}

.alert-rule-picker-menu small {
  color: var(--da-muted);
  font-size: var(--fs-xs);
}

.alert-rule-picker-menu .da-modal-help {
  margin: 3px 6px;
}

.alert-rule-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px 12px;
}

.alert-rule-preview-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.alert-rule-preview-count {
  color: var(--da-ink);
  font-size: var(--fs-xs);
  font-weight: 600;
}

.alert-rule-preview-error {
  margin: 0;
  padding: 8px 10px;
  color: var(--da-red-text);
  font-size: var(--fs-xs);
  border: 1px solid var(--danger-border);
  border-radius: 7px;
  background: var(--da-red-soft);
}

.alert-rule-preview-result {
  display: grid;
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--da-line);
  border-radius: 8px;
  background: var(--surface-card);
}

.alert-rule-preview-scroll {
  max-height: 220px;
  overflow: auto;
}

.alert-rule-preview-result .da-table {
  font-size: var(--fs-xs);
}

.alert-rule-preview-result .da-table th,
.alert-rule-preview-result .da-table td {
  padding: 7px 8px;
}

.alert-rule-preview-result .da-table small {
  margin-top: 2px;
  color: var(--da-muted);
  font-size: var(--fs-xs);
}

@media (max-width: 640px) {
  .alert-rule-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
