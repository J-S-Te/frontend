<script setup>
import { computed, ref, watch, onScopeDispose, nextTick } from 'vue'
import { getRoleResource, saveRoleResource, downloadReceiptDocument } from '../api/settlement'
import { formatSettlementError } from '../utils/errors.js'
import { PLAN_CREATE_FIELDS, PLAN_ADJUST_FIELDS, validateForm, firstInvalidField, retainVisibleErrors } from '../utils/formFeedback.js'
const props = defineProps({
  section: { type: String, required: true }, can: { type: Function, required: true },
  plans: { type: Array, default: () => [] }, receipts: { type: Array, default: () => [] },
  refreshPlans: { type: Function, default: null },
})
const loading = ref(false), saving = ref(false), error = ref(''), notice = ref('')
const settings = ref(null), references = ref([]), assignments = ref([])
const differences = ref([]), vouchers = ref([]), documents = ref([]), selectedReceipt = ref('')
const projectQuery = ref(''), assistantQuery = ref('')
const projectCandidates = ref([]), assistantCandidates = ref([]), candidatesLoading = ref(false)
let candidateGeneration = 0
const mapping = ref({ project_id: '', version: 0, note: '' })
const assignment = ref({ project_id: '', user_id: '', active: true, version: 0 })
const plan = ref({ contract_snapshot_id: '', installment_no: 1, due_date: '', planned_amount: '', reason: '' })
const adjustment = ref({ id: '', version: 0, due_date: '', planned_amount: '', reason: '' })
// 表单反馈：关闭原生 required 气泡后由应用层给出字段级提示并聚焦首个错误字段（DEF-01/02）。
const planErrors = ref({}), adjustErrors = ref({})
const planForm = ref(null), adjustmentForm = ref(null)
const difference = ref({ receipt_id: '', kind: 'UNKNOWN', amount: '', reason: '' })
const resolution = ref({ id: '', version: 0, resolution: 'CARRY_FORWARD', reason: '' })
const refund = ref({ id: '', version: 0, reference: '', completed_at: '', reason: '' })
const writeoffID = ref(''), writeoffs = ref([])
const projects = computed(() => projectCandidates.value)
const resourcePages = ref({ references: 0, assignments: 0, writeoffs: 0, differences: 0, vouchers: 0 })
const recordFilters = ref({ differences: { status: '', keyword: '' }, vouchers: { status: '', keyword: '' } })
const visibleResourcePages = computed(() => {
  const rows = []
  if (props.section === 'plans' && props.can('settlement.receivable.create')) rows.push(['references', '合同候选', references.value])
  if (props.section === 'collaboration') rows.push(['assignments', '项目分配', assignments.value], ['references', '合同候选', references.value])
  if (props.section === 'finance') {
    if (props.can('settlement.difference.manage')) rows.push(['differences', '差异记录', differences.value])
    if (props.can('settlement.voucher.manage')) rows.push(['vouchers', '会计凭证', vouchers.value], ['writeoffs', '核销候选', writeoffs.value])
  }
  return rows.map(([key, label, items]) => ({ key, label, page: resourcePages.value[key], count: items.length }))
})
let generation = 0
onScopeDispose(() => { generation++; candidateGeneration++ })
// 用途：为独立资源组装有界分页和服务端筛选参数。
// 参数：path 为固定业务路径，key 为当前资源的页码及筛选键。
// 返回值：不包含任何范围扩张参数的查询路径。
function resourcePath(path, key) {
  const query = new URLSearchParams({ limit: '50', offset: String(resourcePages.value[key] * 50) })
  const filter = recordFilters.value[key]
  if (filter?.status) query.set('status', filter.status)
  if (filter?.keyword?.trim()) query.set('keyword', filter.keyword.trim())
  return `${path}?${query}`
}
// 用途：翻页或筛选时清除已离开候选集合的旧选择和版本。
// 参数：key 为即将切换的业务资源。
// 返回值：无；用户仍需选择本页当前记录。
function clearResourceSelection(key) {
  if (key === 'references') plan.value.contract_snapshot_id = ''
  if (key === 'writeoffs') writeoffID.value = ''
  if (key === 'assignments') {
    mapping.value = { project_id: '', version: 0, note: '' }
    assignment.value = { project_id: '', user_id: '', active: true, version: 0 }
    projectCandidates.value = []; assistantCandidates.value = []
  }
  if (key === 'differences') {
    resolution.value = { id: '', version: 0, resolution: 'CARRY_FORWARD', reason: '' }
    refund.value = { id: '', version: 0, reference: '', completed_at: '', reason: '' }
  }
}
// 用途：按资源独立翻页，避免一次读取所有历史财务数据。
// 参数：key 为资源键，direction 为前后翻页步长。
// 返回值：读取是否成功；失败还原页码并保留错误提示。
async function changeResourcePage(key, direction) {
  if (loading.value || saving.value) return false
  const previous = resourcePages.value[key]
  const next = Math.max(0, Math.min(2000, previous + direction))
  if (next === previous) return false
  resourcePages.value[key] = next
  clearResourceSelection(key)
  const refreshed = await load()
  if (!refreshed) resourcePages.value[key] = previous
  return refreshed
}
// 用途：从第一页重新读取筛选结果，禁止旧页码使有效结果不可见。
// 参数：key 为差异或凭证筛选资源。
// 返回值：筛选读取是否成功。
async function applyResourceFilter(key) {
  if (loading.value || saving.value) return false
  resourcePages.value[key] = 0
  clearResourceSelection(key)
  return load()
}
// 用途：读取当前角色页面所需资源，离开页面后丢弃迟到响应。
// 参数：无。
// 返回值：是否成功读取；失败时保留可见错误。
async function load() {
  const current = ++generation
  loading.value = true; error.value = ''
  const targets = []
  if (props.section === 'settings' && props.can('settlement.settings.manage')) targets.push(['/settings', settings])
  if (props.section === 'collaboration') targets.push(['/project-assignments', assignments, 'assignments'], ['/contract-references', references, 'references'])
  if (props.section === 'plans' && props.can('settlement.receivable.create')) targets.push(['/contract-references', references, 'references'])
  if (props.section === 'finance') {
    if (props.can('settlement.difference.manage')) targets.push(['/receipt-differences', differences, 'differences'])
    if (props.can('settlement.voucher.manage')) targets.push(['/accounting-vouchers', vouchers, 'vouchers'])
    if (props.can('settlement.voucher.manage') && (props.can('settlement.allocation.read') || props.can('settlement.allocation.confirm') || props.can('settlement.allocation.reverse'))) targets.push(['/receipt-allocations', writeoffs, 'writeoffs'])
  }
  const results = await Promise.allSettled(targets.map(([path, , key]) => getRoleResource(key ? resourcePath(path, key) : path)))
  if (current !== generation) return false
  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length) {
    // 同批读取要么全部发布，要么全部清空，防止回退页码后仍显示已成功的新页。
    targets.forEach(([, target]) => { target.value = target === settings ? null : [] })
    error.value = failures.map(result => formatSettlementError(result.reason)).join('；')
    loading.value = false
    return false
  }
  results.forEach((result, i) => {
    const data = result.value
    targets[i][1].value = Array.isArray(data) ? data : data.items || data
  })
  loading.value = false
  return !error.value
}
// 用途：提交一次受控写入，区分业务成功与刷新失败。
// 参数：path 为接口路径；payload 为业务数据；method 为写入方法。
// 返回值：写入是否成功；失败通过页面提示。
async function save(path, payload, method = 'POST') {
  if (saving.value) return false
  saving.value = true; error.value = ''; notice.value = ''
  try {
    const { id: resourceID, ...body } = payload
    const result = await saveRoleResource(path, body, method)
    const refreshed = await load()
    const plansRefreshed = props.section !== 'plans' || !props.refreshPlans || await props.refreshPlans()
    if (props.section === 'plans' && plansRefreshed) selectPlan()
    if (refreshed && props.section === 'collaboration') {
      selectMapping()
      const current = assignments.value.find(item => item.project_id === assignment.value.project_id &&
        item.user_id === assignment.value.user_id)
      if (current) selectAssignment(current)
    }
    notice.value = `操作已保存${result.status === 'NOT_CONFIGURED' ? '；ERP 未配置，凭证尚未回传' : ''}。${refreshed && plansRefreshed ? '' : '刷新失败，请刷新核对，勿重复提交。'}`
    return true
  } catch (value) { error.value = formatSettlementError(value); return false }
  finally { saving.value = false }
}
// 用途：提交校验失败时聚焦首个错误字段；字段 DOM 顺序与字段定义顺序一致。
// 参数：fields 字段定义；errors 字段错误映射；form 表单元素引用。
// 返回值：校验是否通过；失败时已聚焦并返回 false。
async function focusFirstInvalid(fields, errors, form) {
  const first = firstInvalidField(fields, errors.value)
  if (!first) return true
  await nextTick()
  form.value?.querySelector('[name="' + first.key + '"]')?.focus()
  return false
}
// 用途：创建人工收款计划前校验必填与期次/金额格式，校验不通过时不写入。
// 参数：无；读取当前计划表单。
// 返回值：写入是否成功；校验失败返回 false 且不调用 save。
async function submitPlanCreate() {
  if (saving.value) return false
  planErrors.value = validateForm(PLAN_CREATE_FIELDS, plan.value)
  if (!(await focusFirstInvalid(PLAN_CREATE_FIELDS, planErrors, planForm))) return false
  return save('/receivable-plans', plan.value)
}
// 用途：提交受控调整前校验计划/收款日/金额/原因，校验不通过时不写入。
// 参数：无；读取当前调整表单。
// 返回值：写入是否成功；校验失败返回 false 且不调用 save。
async function submitPlanAdjust() {
  if (saving.value) return false
  adjustErrors.value = validateForm(PLAN_ADJUST_FIELDS, adjustment.value)
  if (!(await focusFirstInvalid(PLAN_ADJUST_FIELDS, adjustErrors, adjustmentForm))) return false
  return save('/receivable-plans/' + encodeURIComponent(adjustment.value.id) + '/adjust', adjustment.value)
}
// 用途：用户修正字段后只保留仍失败的旧错误，红框与文案随输入即时消失。
// 参数：fields 字段定义；form 表单值引用；errors 字段错误引用。
// 返回值：无。
function watchResolvedErrors(fields, form, errors) {
  watch(form, () => {
    if (!Object.keys(errors.value).length) return
    errors.value = retainVisibleErrors(fields, form.value, errors.value)
  }, { deep: true })
}
watchResolvedErrors(PLAN_CREATE_FIELDS, plan, planErrors)
watchResolvedErrors(PLAN_ADJUST_FIELDS, adjustment, adjustErrors)
// 用途：将可见计划的版本及原值带入受控调整表单。
// 参数：无；读取用户选择的计划编号。
// 返回值：无。
function selectPlan() {
  const item = props.plans.find((item) => item.id === adjustment.value.id)
  if (item) adjustment.value = { id: item.id, version: item.version, due_date: item.due_date, planned_amount: item.planned_amount, reason: '' }
}
// 用途：选择需处置差异的当前版本，避免无版本提交。
// 参数：无；读取所选差异编号。
// 返回值：无。
function selectDifference() {
  const item = differences.value.find((item) => item.id === resolution.value.id)
  if (item) resolution.value.version = item.version
}
// 用途：只带入已审批待退款记录的当前版本，不预填外部执行事实。
// 参数：无；读取本页所选退款差异。
// 返回值：无；无效选择清空版本。
function selectRefund() {
  const item = differences.value.find(item => item.id === refund.value.id && item.status === 'REFUND_PENDING')
  refund.value.version = item?.version || 0
}
// 用途：回录经核实的线下退款完成事实并保留服务端拒绝结果。
// 参数：无；凭证、当地完成时间和原因来自必填表单。
// 返回值：写入是否成功；不调用银行退款。
async function confirmRefund() {
  const completed = new Date(refund.value.completed_at)
  if (!refund.value.version || Number.isNaN(completed.getTime())) {
    error.value = '请选择待确认退款并填写有效的完成时间。'
    return false
  }
  const saved = await save(`/receipt-differences/${encodeURIComponent(refund.value.id)}/confirm-refund`, {
    ...refund.value, completed_at: completed.toISOString(),
  })
  if (saved) refund.value = { id: '', version: 0, reference: '', completed_at: '', reason: '' }
  return saved
}
// 用途：选择已存在的项目人员分配版本，支持撤销和重新启用。
// 参数：item 为服务端返回的协作记录。
// 返回值：无。
function selectAssignment(item) {
  assignment.value = { project_id: item.project_id, user_id: item.user_id, active: item.active, version: item.version }
  projectCandidates.value = [{ project_id: item.project_id, project_name: item.project_name }]
  assistantCandidates.value = [{ user_id: item.user_id, display_name: item.user_id }]
}
// 用途：按明确项目编号及关键字查询权威项目和有效助理，失败不保留旧候选。
// 参数：无；读取项目编号与人员关键字。
// 返回值：候选读取完成的 Promise。
async function searchCandidates() {
  if (!props.can('settlement.collaboration.manage') || candidatesLoading.value) return
  const current = ++candidateGeneration
  candidatesLoading.value = true; error.value = ''
  projectCandidates.value = []; assistantCandidates.value = []
  assignment.value = { project_id: '', user_id: '', active: true, version: 0 }
  try {
    const [projects, assistants] = await Promise.all([
      getRoleResource(`/project-candidates?project_id=${encodeURIComponent(projectQuery.value.trim())}`),
      getRoleResource(`/project-assistants?keyword=${encodeURIComponent(assistantQuery.value.trim())}`),
    ])
    if (current !== candidateGeneration) return
    projectCandidates.value = projects
    assistantCandidates.value = assistants.items || []
    if (!projects.length || !assistantCandidates.value.length) notice.value = '未找到权威项目或有效项目助理，请核对编号及角色。'
  } catch (value) { if (current === candidateGeneration) error.value = formatSettlementError(value) }
  finally { if (current === candidateGeneration) candidatesLoading.value = false }
}
// 用途：带入当前已负责项目的映射说明及版本。
// 参数：无；读取用户所选项目编号。
// 返回值：无。
function selectMapping() {
  const item = assignments.value.find((item) => item.project_id === mapping.value.project_id && item.active)
  if (item) mapping.value = { project_id: item.project_id, version: item.version, note: item.note || '' }
}
// 用途：读取所选回款的服务端文件清单，禁止旧回款响应覆盖新选择。
// 参数：无。
// 返回值：无；失败时清空文件列表并提示。
async function loadDocuments() {
  const id = selectedReceipt.value, current = generation
  documents.value = []; error.value = ''
  if (!id) return
  try {
    const data = await getRoleResource(`/receipts/${encodeURIComponent(id)}/documents`)
    if (current === generation && id === selectedReceipt.value) documents.value = data.items || []
  } catch (value) { if (current === generation && id === selectedReceipt.value) error.value = formatSettlementError(value) }
}
// 用途：将回单影像编码后交由业务服务及文件网关校验归档。
// 参数：event 为文件选择事件。
// 返回值：无；不将本地读取当成上传成功。
async function uploadDocument(event) {
  const receiptID = selectedReceipt.value, current = generation
  const file = event.target.files?.[0]
  if (!props.can('settlement.receipt.record') || !file || !selectedReceipt.value || saving.value) return
  if (file.size > 10 * 1024 * 1024) { error.value = '回单影像不能超过 10 MiB。'; return }
  try {
    const content = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.onerror = () => reject(new Error('文件读取失败'))
      reader.readAsDataURL(file)
    })
    if (current !== generation || receiptID !== selectedReceipt.value) return
    if (await save(`/receipts/${encodeURIComponent(receiptID)}/documents`, { filename: file.name, content_type: file.type, content_base64: content })) await loadDocuments()
  } catch (value) { error.value = formatSettlementError(value) }
  event.target.value = ''
}
// 用途：下载当前回款文件并展示服务端失败。
// 参数：item 为文件网关确认的文档记录。
// 返回值：无。
async function downloadDocument(item) {
  try { await downloadReceiptDocument(selectedReceipt.value, item.id) }
  catch (value) { error.value = formatSettlementError(value) }
}
watch(() => props.section, load, { immediate: true })
</script>
<template>
  <section class="settlement-panel settlement-role-panel" :aria-busy="saving || loading">
    <p v-if="error" class="settlement-error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="loading" class="role-panel-loading">正在读取当前权限范围内的数据…</p>
    <template v-else-if="section === 'settings' && can('settlement.settings.manage')">
      <h2>结算规则设置</h2>
      <p>阈值留空表示尚未配置。接口凭据通过受控运行配置维护；此页面不接收明文密钥。</p>
      <form v-if="settings" class="settlement-operation-form" @submit.prevent="save('/settings', settings, 'PUT')">
        <label>税率（小数，逗号分隔）<input maxlength="255" :value="settings.tax_rates.join(',')" @change="settings.tax_rates = $event.target.value.split(',').map(v => v.trim())" required />
      </label>
        <label>账龄上界（天，逗号分隔；最后一档无上界）<input maxlength="100" :value="settings.aging_days.join(',')" @change="settings.aging_days = $event.target.value.split(',').map(Number)" required />
      </label>
        <label>提前提醒天数<input v-model.number="settings.reminder_lead_days" type="number" min="0" required />
      </label>
        <label>重复提醒间隔<input v-model.number="settings.repeat_days" type="number" min="1" required />
      </label>
        <label>升级天数<input v-model.number="settings.escalation_days" type="number" min="1" required />
      </label>
        <label>普通开票授权阈值<input v-model.trim="settings.special_invoice_threshold" inputmode="decimal" maxlength="18" placeholder="未配置" />
      </label>
        <label v-if="settings.field_policies">
      <input v-model="settings.field_policies.tax_number_visible" type="checkbox" />允许展示完整税号（仍需服务端字段投影）</label>
        <p>ERP 接口状态：{{ settings.erp_status || '状态未返回，请核对服务端配置' }}</p>
        <button :disabled="saving">保存设置</button>
      </form>
    </template>
    <template v-else-if="section === 'collaboration'">
      <h2>项目协作范围</h2>
      <p>仅展示服务端授权项目。助理不能给自己增加项目；项目及客户归属由权威合同引用校验。</p>
      <p v-if="!assignments.length">当前没有分配项目；请联系财务经理或业务管理员。</p>
      <table>
      <thead>
      <tr>
      <th>项目</th>
      <th>人员</th>
      <th>状态</th>
      <th>操作</th>
      </tr>
      </thead>
      <tbody>
      <tr v-for="item in assignments" :key="`${item.project_id}-${item.user_id}`">
      <td>{{ item.project_id }}</td>
      <td>{{ item.user_id }}</td>
      <td>{{ item.active ? '有效' : '已撤销' }}</td>
      <td>
      <button v-if="can('settlement.collaboration.manage')" @click="selectAssignment(item)">编辑分配</button>
      </td>
      </tr>
      </tbody>
      </table>
      <form v-if="can('settlement.collaboration.manage')" class="settlement-form" @submit.prevent="searchCandidates">
        <label>权威项目ID<input v-model.trim="projectQuery" required maxlength="128" /></label>
        <label>助理姓名或账号<input v-model.trim="assistantQuery" maxlength="100" /></label>
        <button :disabled="candidatesLoading">{{ candidatesLoading ? '查询中…' : '查询项目与有效助理' }}</button>
      </form>
      <form v-if="can('settlement.collaboration.manage')" class="settlement-form" @submit.prevent="save('/project-assignments', assignment)">
        <select v-model="assignment.project_id" required>
      <option value="">选择权威项目</option>
      <option v-for="item in projects" :key="item.project_id" :value="item.project_id">{{ item.project_name || item.project_id }}</option>
      </select>
        <label>有效项目助理用户ID<select v-model="assignment.user_id" required><option value="">选择有效项目助理</option><option v-for="item in assistantCandidates" :key="item.user_id" :value="item.user_id">{{ item.display_name || item.user_id }}</option></select>
      </label>
        <label>
      <input v-model="assignment.active" type="checkbox" />启用分配（取消后撤销）</label>
      <button :disabled="saving">保存分配</button>
      </form>
      <form v-if="can('settlement.mapping.manage')" class="settlement-form" @submit.prevent="save('/project-mappings', mapping, 'PUT')">
        <label>已分配项目<select v-model="mapping.project_id" required @change="selectMapping">
      <option value="">选择已负责项目</option>
      <option v-for="item in assignments.filter(v => v.active)" :key="item.project_id" :value="item.project_id">{{ item.project_name || item.project_id }}</option>
      </select>
      </label>
        <label>项目映射说明<textarea v-model.trim="mapping.note" required maxlength="500" />
      </label>
      <button :disabled="saving">保存映射说明</button>
      </form>
      <h3>授权合同与项目引用</h3>
      <table>
      <thead>
      <tr>
      <th>合同</th>
      <th>客户</th>
      <th>项目</th>
      </tr>
      </thead>
      <tbody>
      <tr v-for="item in references" :key="item.id">
      <td>{{ item.contract_no }}</td>
      <td>{{ item.customer_name }}</td>
      <td>{{ item.project_id || '待补齐' }}</td>
      </tr>
      </tbody>
      </table>
    </template>
    <template v-else-if="section === 'plans'">
      <h2>人工计划与受控调整</h2>
      <p v-if="can('settlement.receivable.create') && !references.length && resourcePages.references === 0" class="settlement-muted settlement-contract-empty" data-testid="contract-references-empty">
        合同候选为空：仅显示本人负责且财务已生效的合同；若合同已生效仍未显示，请核对合同→结算同步与责任人归属（不会放宽数据范围）。
      </p>
      <form v-if="can('settlement.receivable.create')" ref="planForm" class="settlement-form" novalidate @submit.prevent="submitPlanCreate">
        <label class="settlement-field">合同
          <select v-model="plan.contract_snapshot_id" name="contract_snapshot_id" :aria-invalid="planErrors.contract_snapshot_id ? 'true' : null" :aria-describedby="planErrors.contract_snapshot_id ? 'plan-contract-error' : null" required>
            <option value="">选择可见合同</option>
            <option v-for="item in references" :key="item.id" :value="item.id">{{ item.contract_no }} · {{ item.customer_name }}</option>
          </select>
          <small v-if="planErrors.contract_snapshot_id" id="plan-contract-error" class="settlement-field-error" role="alert">{{ planErrors.contract_snapshot_id }}</small>
        </label>
        <label class="settlement-field">期次
          <input v-model.number="plan.installment_no" name="installment_no" type="number" min="1" :aria-invalid="planErrors.installment_no ? 'true' : null" :aria-describedby="planErrors.installment_no ? 'plan-installment-error' : null" required />
          <small v-if="planErrors.installment_no" id="plan-installment-error" class="settlement-field-error" role="alert">{{ planErrors.installment_no }}</small>
        </label>
        <label class="settlement-field">收款日
          <input v-model="plan.due_date" name="due_date" type="date" :aria-invalid="planErrors.due_date ? 'true' : null" :aria-describedby="planErrors.due_date ? 'plan-due-date-error' : null" required />
          <small v-if="planErrors.due_date" id="plan-due-date-error" class="settlement-field-error" role="alert">{{ planErrors.due_date }}</small>
        </label>
        <label class="settlement-field">金额
          <input v-model.trim="plan.planned_amount" name="planned_amount" inputmode="decimal" maxlength="18" :aria-invalid="planErrors.planned_amount ? 'true' : null" :aria-describedby="planErrors.planned_amount ? 'plan-amount-error' : null" required />
          <small v-if="planErrors.planned_amount" id="plan-amount-error" class="settlement-field-error" role="alert">{{ planErrors.planned_amount }}</small>
        </label>
        <label class="settlement-field">原因
          <input v-model.trim="plan.reason" name="reason" maxlength="500" :aria-invalid="planErrors.reason ? 'true' : null" :aria-describedby="planErrors.reason ? 'plan-reason-error' : null" required />
          <small v-if="planErrors.reason" id="plan-reason-error" class="settlement-field-error" role="alert">{{ planErrors.reason }}</small>
        </label>
        <button :disabled="saving">创建计划</button>
      </form>
      <form v-if="can('settlement.receivable.adjust')" ref="adjustmentForm" class="settlement-form" novalidate @submit.prevent="submitPlanAdjust">
        <label class="settlement-field">计划
          <select v-model="adjustment.id" name="id" :aria-invalid="adjustErrors.id ? 'true' : null" :aria-describedby="adjustErrors.id ? 'adjust-plan-error' : null" required @change="selectPlan">
            <option value="">选择计划</option>
            <option v-for="item in plans" :key="item.id" :value="item.id">{{ item.contract_no }} · 第{{ item.installment_no }}期</option>
          </select>
          <small v-if="adjustErrors.id" id="adjust-plan-error" class="settlement-field-error" role="alert">{{ adjustErrors.id }}</small>
        </label>
        <label class="settlement-field">收款日
          <input v-model="adjustment.due_date" name="due_date" type="date" :aria-invalid="adjustErrors.due_date ? 'true' : null" :aria-describedby="adjustErrors.due_date ? 'adjust-due-date-error' : null" required />
          <small v-if="adjustErrors.due_date" id="adjust-due-date-error" class="settlement-field-error" role="alert">{{ adjustErrors.due_date }}</small>
        </label>
        <label class="settlement-field">金额
          <input v-model.trim="adjustment.planned_amount" name="planned_amount" inputmode="decimal" maxlength="18" :aria-invalid="adjustErrors.planned_amount ? 'true' : null" :aria-describedby="adjustErrors.planned_amount ? 'adjust-amount-error' : null" required />
          <small v-if="adjustErrors.planned_amount" id="adjust-amount-error" class="settlement-field-error" role="alert">{{ adjustErrors.planned_amount }}</small>
        </label>
        <label class="settlement-field">调整原因
          <input v-model.trim="adjustment.reason" name="reason" maxlength="500" :aria-invalid="adjustErrors.reason ? 'true' : null" :aria-describedby="adjustErrors.reason ? 'adjust-reason-error' : null" required />
          <small v-if="adjustErrors.reason" id="adjust-reason-error" class="settlement-field-error" role="alert">{{ adjustErrors.reason }}</small>
        </label>
        <button :disabled="saving">提交调整</button>
      </form>
    </template>
    <template v-else-if="section === 'finance'">
      <template v-if="can('settlement.difference.manage')">
        <h2>回款差异处置</h2>
      <p>审批通过后仍须核对线下退款凭证，再回录已完成事实。</p>
        <form class="settlement-form" @submit.prevent="applyResourceFilter('differences')">
          <label>差异状态筛选<select v-model="recordFilters.differences.status" aria-label="差异状态筛选">
            <option value="">全部状态</option><option value="HELD">暂挂</option>
            <option value="REVIEW_PENDING">待审批</option><option value="APPROVED">处置已批准</option>
            <option value="REFUND_PENDING">待退款确认</option><option value="REFUND_CONFIRMED">退款已确认</option>
          </select></label>
          <label>差异编号或回款筛选<input v-model.trim="recordFilters.differences.keyword" maxlength="128" /></label>
          <button :disabled="saving || loading">筛选差异</button>
        </form>
        <form class="settlement-form" @submit.prevent="save('/receipt-differences', difference)">
          <select v-model="difference.receipt_id" required>
      <option value="">选择回款</option>
      <option v-for="item in receipts" :key="item.id" :value="item.id">{{ item.receipt_no }}</option>
      </select>
      <select v-model="difference.kind">
      <option value="OVERPAYMENT">长款</option>
      <option value="SHORTPAYMENT">短款</option>
      <option value="UNKNOWN">不明款</option>
      </select>
      <label>金额<input v-model.trim="difference.amount" maxlength="18" required />
      </label>
      <label>原因<input v-model.trim="difference.reason" maxlength="500" required />
      </label>
      <button :disabled="saving">登记差异</button>
        </form>
        <table>
      <thead>
      <tr>
      <th>回款</th>
      <th>类型</th>
      <th>金额</th>
      <th>原因</th>
      <th>状态</th>
      <th>处置</th>
      <th>退款凭证</th><th>退款完成时间</th><th>退款确认人</th>
      <th>操作</th>
      </tr>
      </thead>
      <tbody>
      <tr v-for="item in differences" :key="item.id">
      <td>{{ item.receipt_id }}</td>
      <td>{{ item.kind }}</td>
      <td>{{ item.amount }}</td>
      <td>{{ item.reason }}</td>
      <td>{{ item.status }}</td>
      <td>{{ item.resolution }}</td>
      <td>{{ item.refund_reference || '—' }}</td>
      <td>{{ item.refund_completed_at || '—' }}</td>
      <td>{{ item.refund_confirmed_by || '—' }}</td>
      <td>
      <button v-if="item.status === 'REVIEW_PENDING' && can('settlement.difference.approve')" :disabled="saving" @click="save(`/receipt-differences/${encodeURIComponent(item.id)}/approve`, {version:item.version})">审批处置</button>
      </td>
      </tr>
      </tbody>
      </table>
        <form class="settlement-form" @submit.prevent="save(`/receipt-differences/${encodeURIComponent(resolution.id)}/resolve`, resolution)">
          <select v-model="resolution.id" required @change="selectDifference">
      <option value="">选择待处置差异</option>
      <option v-for="item in differences" :key="item.id" :value="item.id">{{ item.id }} · {{ item.status }}</option>
      </select>
      <select v-model="resolution.resolution">
      <option value="REFUND_PENDING">退款待执行</option>
      <option value="CARRY_FORWARD">结转</option>
      <option value="MATCHED">已匹配</option>
      </select>
      <label>处置原因<input v-model.trim="resolution.reason" maxlength="500" required />
      </label>
      <button :disabled="saving">提交处置审批</button>
        </form>
        <form class="settlement-form" @submit.prevent="confirmRefund">
          <label>待确认退款<select v-model="refund.id" aria-label="待确认退款" required @change="selectRefund">
            <option value="">选择已获审批的待退款记录</option>
            <option v-for="item in differences.filter(item => item.status === 'REFUND_PENDING')" :key="item.id" :value="item.id">{{ item.id }} · {{ item.amount }}</option>
          </select></label>
          <label>退款凭证号<input v-model.trim="refund.reference" maxlength="128" required /></label>
          <label>退款完成时间<input v-model="refund.completed_at" type="datetime-local" required /></label>
          <label>退款确认原因<input v-model.trim="refund.reason" maxlength="500" required /></label>
          <button :disabled="saving || !refund.version">确认已完成退款</button>
        </form>
      </template>
      <template v-if="can('settlement.voucher.manage')">
        <h2>会计凭证</h2>
      <p>凭证来源于已确认核销；ERP 返回状态与外部编号以服务端为准。</p>
        <form class="settlement-form" @submit.prevent="applyResourceFilter('vouchers')">
          <label>凭证状态筛选<select v-model="recordFilters.vouchers.status" aria-label="凭证状态筛选">
            <option value="">全部状态</option><option value="FAILED">回传失败</option>
            <option value="NOT_CONFIGURED">ERP未配置</option><option value="SENT">已回传</option>
          </select></label>
          <label>凭证编号或核销筛选<input v-model.trim="recordFilters.vouchers.keyword" maxlength="128" /></label>
          <button :disabled="saving || loading">筛选凭证</button>
        </form>
        <form class="settlement-form" @submit.prevent="save('/accounting-vouchers', {writeoff_id:writeoffID})">
      <select v-model="writeoffID" required>
      <option value="">选择已确认核销</option>
      <option v-for="item in writeoffs.filter(v => v.status === 'CONFIRMED')" :key="item.id" :value="item.id">{{ item.allocation_no }}</option>
      </select>
      <button :disabled="saving">生成本地凭证</button>
      </form>
        <table>
      <thead>
      <tr>
      <th>核销</th>
      <th>回传状态</th>
      <th>外部编号</th>
      <th>操作</th>
      </tr>
      </thead>
      <tbody>
      <tr v-for="item in vouchers" :key="item.id">
      <td>{{ item.writeoff_id }}</td>
      <td>{{ item.status === 'NOT_CONFIGURED' ? 'ERP 未配置 / 未回传' : item.status }}</td>
      <td>{{ item.external_no || '未回传' }}</td>
      <td>
      <button :disabled="saving" @click="save(`/accounting-vouchers/${encodeURIComponent(item.id)}/retry`, {})">重试回传</button>
      </td>
      </tr>
      </tbody>
      </table>
      </template>
    </template>
    <template v-else-if="section === 'documents' && can('settlement.receipt.read')">
      <h2>回单影像</h2>
      <select v-model="selectedReceipt" @change="loadDocuments">
      <option value="">选择回款</option>
      <option v-for="item in receipts" :key="item.id" :value="item.id">{{ item.receipt_no }}</option>
      </select>
      <input v-if="selectedReceipt && can('settlement.receipt.record')" type="file" accept=".pdf,.png,.jpg,.jpeg" :disabled="saving" @change="uploadDocument" />
      <p v-if="selectedReceipt && !documents.length">暂无归档回单影像。</p>
      <p v-for="item in documents" :key="item.id">{{ item.original_name }} · {{ item.status }} <button @click="downloadDocument(item)">下载</button>
      </p>
    </template>
    <div v-for="entry in visibleResourcePages" :key="entry.key" role="group" :aria-label="`${entry.label}分页`" class="settlement-head-actions">
      <span>{{ entry.label }} · 第 {{ entry.page + 1 }} 页 · 本页 {{ entry.count }} 条</span>
      <button :disabled="saving || loading || entry.page === 0" @click="changeResourcePage(entry.key, -1)">上一页</button>
      <button :disabled="saving || loading || entry.count < 50 || entry.page >= 2000" @click="changeResourcePage(entry.key, 1)">下一页</button>
      <button :disabled="saving || loading" @click="load">刷新</button>
    </div>
  </section>
</template>
