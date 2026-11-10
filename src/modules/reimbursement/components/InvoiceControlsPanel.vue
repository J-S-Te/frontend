<script setup>
import TravelFields from './TravelFields.vue'
import InvoiceContentFields from './InvoiceContentFields.vue'
import { invoiceContentForm, invoiceContentInput } from '../invoiceClassification.js'
import { travelInput } from '../claimFields.js'
import { computed, ref, watch } from 'vue'
import { reimbursementAPI as api } from '../api/reimbursement.js'
import { createCommandRunner, formatMinor, toMinor } from '../api/client.js'
import { evidenceIDs } from '../claimFields.js'

const props = defineProps({ invoice: { type: Object, required: true }, session: { type: Object, required: true } })
const emit = defineEmits(['changed'])
const controls = ref(null)
const reason = ref('')
const form = ref({})
const fileIDs = ref('')
const documentID = ref('')
const runID = ref('')
const candidateIndex = ref('')
const riskKind = ref('VOID')
const originalID = ref('')
const riskFiles = ref('')
const error = ref('')
const busy = ref(false)
const pending = ref(null)
const runner = createCommandRunner(api)
const owner = computed(() => props.invoice.owner_subject_id === props.session.subject_id)
const reviewer = computed(() => props.session.permissions?.includes('expense.invoice.correct')
  && props.session.permissions?.includes('expense.finance.review'))
const labels = [['invoice_type', '票种'], ['invoice_code', '发票代码'], ['invoice_number', '发票号码'],
  ['invoice_date', '开票日'], ['seller_tax_id', '销售方税号'], ['buyer_tax_id', '购买方税号'], ['amount', '价税合计（元）']]
let sequence = 0

// 用途：读取当前票据的控制记录，不将别的票据迟到结果写入页面。
// 参数：无。
// 返回值：无；失败保留错误。
async function load() {
  const ticket = ++sequence
  try {
    const value = await api.request(`/invoices/${encodeURIComponent(props.invoice.id)}/controls`)
    if (ticket === sequence) controls.value = value
  } catch (cause) { if (ticket === sequence) error.value = cause.message }
}

// 用途：发送固定票据控制命令，未知结果禁止另起请求。
// 参数：operation 为动作名，path 为固定API，payload 为版本及业务字段。
// 返回值：无；成功刷新记录并通知详情刷新。
async function send(operation, path, payload) {
  if (busy.value || pending.value) return
  busy.value = true; error.value = ''
  try {
    if (!reason.value.trim()) throw new Error('请填写本次处理原因')
    await runner.execute(operation, path, { ...payload, reason: reason.value.trim() })
    await load(); emit('changed')
  } catch (cause) { error.value = cause.message; if (cause.status === 409) await load() }
  finally { pending.value = runner.pending(); busy.value = false }
}

// 用途：提交重大票面更正申请，保留原始票面和原件集合。
// 参数：无。
// 返回值：无；申请不会直接更改批准历史。
async function requestCorrection() {
  try {
    const { amount, ...fields } = form.value
    await send('invoice.correction.request', `/invoices/${encodeURIComponent(props.invoice.id)}/corrections`,
      { expected_version: props.invoice.version, proposed_invoice: { ...props.invoice, ...fields,
        content:invoiceContentInput(fields.content), travel_facts:travelInput(fields.travel_facts,true), total_minor: toMinor(amount) } })
  } catch (cause) { error.value = cause.message }
}

// 用途：追加真实上传原件或绑定不可变解析候选来源。
// 参数：无。
// 返回值：无；来源以服务端原始运行核验，不接受手造坐标。
async function appendSources() {
  try {
    const files = evidenceIDs(fileIDs.value)
    const selections = runID.value ? [{ file_id: files[0], document_id: documentID.value,
      run_id: runID.value, candidate_index: Number(candidateIndex.value) }] : []
    if (runID.value && (!documentID.value || !Number.isSafeInteger(Number(candidateIndex.value)) || Number(candidateIndex.value) < 0 || candidateIndex.value === '')) throw new Error('请填写真实文档、解析运行及从0开始的候选序号')
    await send('invoice.source.append', `/invoices/${encodeURIComponent(props.invoice.id)}/sources`,
      { expected_version: props.invoice.version, file_ids: files, source_selections: selections })
  } catch (cause) { error.value = cause.message }
}

// 用途：将红字、作废或退款证据登记为独立财务复核案件。
// 参数：无。
// 返回值：无；不生成负费用或伪造退款。
async function reportRisk() {
  try { await send('invoice.risk.record', `/invoices/${encodeURIComponent(props.invoice.id)}/risks`,
    { expected_version: props.invoice.version, risk_kind: riskKind.value,
      original_invoice_id: originalID.value, evidence_file_ids: evidenceIDs(riskFiles.value) }) }
  catch (cause) { error.value = cause.message }
}

// 用途：申请人按当前单据版本接受已批准的更正，仍须重新提交审批。
// 参数：impact 为当前更正对本单的影响记录。
// 返回值：无；不跳过新轮次审批。
async function reconfirm(impact) {
  try {
    const claim = await api.request(`/claims/${encodeURIComponent(impact.claim_id)}`)
    await send('claim.invoice.reconfirm', `/claims/${encodeURIComponent(impact.claim_id)}/invoice-reconfirmations`,
      { expected_version: claim.version, correction_id: impact.control_id })
  } catch (cause) { error.value = cause.message }
}

// 用途：确认原未知命令的结果并继续使用同一请求重试。
// 参数：无。
// 返回值：无；失败继续保留原命令。
async function retry() {
  busy.value = true
  try { await runner.retry(); await load(); emit('changed') }
  catch (cause) { error.value = cause.message }
  finally { pending.value = runner.pending(); busy.value = false }
}

watch(() => [props.invoice.id, props.invoice.version], () => {
  form.value = { ...props.invoice, content:invoiceContentForm(props.invoice.content), amount: formatMinor(props.invoice.total_minor) }
  originalID.value = props.invoice.id
  controls.value = null; error.value = ''; void load()
}, { immediate: true })
</script>

<template>
  <article class="expense-item">
    <h3>票据更正与财务复核</h3>
    <p v-if="error" role="alert">{{ error }}</p>
    <label>本次原因<textarea v-model="reason" maxlength="2000" :disabled="busy || !!pending" /></label>
    <fieldset v-if="owner" :disabled="busy || !!pending"><legend>申请重大更正（保留原批准历史）</legend>
      <div class="expense-form-grid"><label v-for="[key, label] in labels" :key="key">{{ label }}<input v-model="form[key]" :type="key === 'invoice_date' ? 'date' : 'text'"></label></div>
      <InvoiceContentFields v-model:value="form.content" />
      <TravelFields v-model:value="form.travel_facts" invoice />
      <button class="expense-button" @click="requestCorrection">提交独立更正申请</button>
    </fieldset>
    <details v-for="item in controls?.corrections || []" :key="item.id">
      <summary>更正 {{ item.id }} · {{ item.status }} · 版本 {{ item.version }}</summary>
      <p>申请人 {{ item.requester_subject_id }} · 原因 {{ item.content?.reason }}</p>
      <p v-for="[key, label] in labels.filter(([key]) => key !== 'amount')" :key="key">{{ label }}：{{ item.content?.previous?.[key] }} → {{ item.content?.proposed_invoice?.[key] }}</p>
      <p>商品服务明细：{{ item.content?.previous?.content?.lines?.map(row=>row.name).join('、') || '未录入' }} → {{ item.content?.proposed_invoice?.content?.lines?.map(row=>row.name).join('、') || '未录入' }}</p>
      <p>价税合计：{{ formatMinor(item.content?.previous?.total_minor) }} → {{ formatMinor(item.content?.proposed_invoice?.total_minor) }}</p>
      <template v-if="reviewer && item.status === 'PENDING' && item.requester_subject_id !== session.subject_id">
        <button class="expense-button" :disabled="busy || !!pending" @click="send('invoice.correction.decide', `/invoice-corrections/${item.id}/decisions`, { expected_version: item.version, approve: true })">独立批准</button>
        <button class="expense-button" :disabled="busy || !!pending" @click="send('invoice.correction.decide', `/invoice-corrections/${item.id}/decisions`, { expected_version: item.version, approve: false })">拒绝更正</button>
      </template>
    </details>
    <div v-for="impact in controls?.impacts || []" :key="impact.id"><p>相关单据 {{ impact.claim_id }} · {{ impact.status }}</p><button v-if="owner && impact.status === 'RECONFIRM_REQUIRED'" class="expense-button" :disabled="busy || !!pending" @click="reconfirm(impact)">接受更正后重新提交审批</button></div>
    <fieldset v-if="owner" :disabled="busy || !!pending"><legend>补充原件或解析来源</legend>
      <label>已上传原件文件ID（逗号分隔）<input v-model="fileIDs"></label>
      <label>文档ID（绑定解析来源时填写）<input v-model="documentID"></label>
      <label>真实解析运行ID<input v-model="runID"></label><label>候选序号（从0开始）<input v-model="candidateIndex" type="number" min="0"></label>
      <button class="expense-button" @click="appendSources">受控追加证据来源</button>
    </fieldset>
    <p v-for="source in controls?.sources || []" :key="source.id">来源 {{ source.document_id }} · {{ source.source_kind }} · 运行 {{ source.run_id || '明确人工关联' }} · 候选 {{ source.candidate_index }} · {{ source.sources?.map(part => part.page ? `第${part.page}页` : part.xml_path).join('、') }}</p>
    <fieldset v-if="owner" :disabled="busy || !!pending"><legend>登记异常票据事实</legend>
      <label>事实类型<select v-model="riskKind"><option value="RED_LETTER">红字</option><option value="VOID">作废</option><option value="REFUND">退款</option></select></label>
      <label>原票ID<input v-model="originalID"></label><label>已上传风险证据文件ID<input v-model="riskFiles"></label>
      <button class="expense-button" @click="reportRisk">登记并发起财务复核</button>
    </fieldset>
    <div v-for="risk in controls?.risks || []" :key="risk.id">
      <p>{{ risk.risk_kind }} · 原票 {{ risk.original_invoice_id }} · {{ risk.status }} · {{ risk.resolution }}</p>
      <template v-if="reviewer && risk.status === 'OPEN' && risk.recorder_subject_id !== session.subject_id">
        <button class="expense-button" :disabled="busy || !!pending" @click="send('invoice.risk.close', `/invoice-risks/${risk.id}/resolutions`, { expected_version: risk.version, resolution: 'CONFIRMED_RISK' })">确认风险并结束核查</button>
        <button class="expense-button" :disabled="busy || !!pending" @click="send('invoice.risk.close', `/invoice-risks/${risk.id}/resolutions`, { expected_version: risk.version, resolution: 'DISMISSED' })">有依据排除风险</button>
      </template>
    </div>
    <button v-if="pending" class="expense-button" :disabled="busy" @click="retry">确认并重试原命令</button>
  </article>
</template>
