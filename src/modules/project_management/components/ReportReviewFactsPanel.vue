<script setup>
import { computed, ref, watch } from 'vue'
import { getMetricReportReviews, getCurrentMetricReportReviews, postMetricReportReview } from '../api/projectManagement.js'
import { canDecideMetricReport, metricOperationKey } from '../metricFacts.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'

const props = defineProps({ item: { type: Object, required: true }, session: { type: Object, default: null } })
const emit = defineEmits(['changed'])
const currentRounds = ref([])
const rows = ref([]), page = ref(1), busy = ref(false), error = ref(''), notice = ref(''), pending = ref(null)
const subject = ref('SERVICE_ITEM'), reason = ref('EVIDENCE_INCOMPLETE'), note = ref('')
const subjectState = computed(() => subject.value === 'SERVICE_ITEM' ? props.item : props.item.penetration_work_package)
const current = computed(() => currentRounds.value.find((row) => row.subject_type === subject.value && row.revision === Number(subjectState.value?.report_revision || 0)))
const canSubmit = computed(() => !!props.session?.permissions?.includes('project.report.prepare') && ['COMPILING', 'DRAFTING'].includes(subjectState.value?.report_status) && (!current.value || current.value.decision === 'RETURNED'))
const canDecide = computed(() => canDecideMetricReport(current.value, props.session))
const labels = { PENDING: '待审核', PASSED: '通过', RETURNED: '退回' }
let sequence = 0

// 用途：读取当前父项的真实轮次并保留失败状态。
// 参数：无。
// 返回值：无；失败显示真实错误，不回退为零次审核。
async function load() {
  const ticket = ++sequence
  error.value = ''
  try {
    const [result, latest] = await Promise.all([getMetricReportReviews(props.item.id, page.value), getCurrentMetricReportReviews(props.item.id)])
    if (ticket !== sequence) return
    if (!Array.isArray(result) || !Array.isArray(latest)) throw new Error('审核轮次响应不完整')
    rows.value = result
    currentRounds.value = latest
  } catch (cause) { if (ticket === sequence) error.value = cause.message || '审核轮次暂不可用' }
}

// 用途：使用冻结命令执行或精确重试，未知回执不产生新操作号。
// 参数：command 为可选的新命令，缺省复用未确认命令。
// 返回值：无；成功后刷新事实和父项版本。
async function execute(command = pending.value) {
  if (!command || busy.value) return
  pending.value = command; busy.value = true; error.value = ''; notice.value = ''
  try {
    await postMetricReportReview(command.itemID, command.action, command.payload)
    pending.value = null; notice.value = '审核事实已保存'; page.value = 1
    emit('changed'); await load()
  } catch (cause) {
    error.value = cause.message || '审核操作未完成'
    if (!cause.outcomeUnknown) pending.value = null
  } finally { busy.value = false }
}

// 用途：冻结当前报告版本提交真实送审或独立决定。
// 参数：decision 为空表示送审，否则为PASSED或RETURNED。
// 返回值：无；校验失败显示错误，服务端最终核验权限与职责分离。
async function submit(decision = '') {
  if (pending.value || busy.value) return
  if (decision === 'RETURNED' && !note.value.trim()) { error.value = '请填写退回说明'; return }
  const payload = { subject_type: subject.value, revision: Number(subjectState.value?.report_revision || 0), expected_version: Number(subjectState.value?.version), idempotency_key: metricOperationKey() }
  if (decision) Object.assign(payload, { decision, round_id: current.value?.id, reason_code: decision === 'RETURNED' ? reason.value : '', note: note.value.trim() })
  await execute({ itemID: props.item.id, action: decision ? 'decision' : 'submit', payload })
}

// 用途：切换分页历史，不把旧页轮次用于当前审核决定。
// 参数：delta 为前后页方向。
// 返回值：无；重新读取真实分页。
async function changePage(delta) { page.value = Math.max(1, page.value + delta); await load() }
watch(() => [props.item.id, props.item.version, props.item.penetration_work_package?.version], () => { page.value = 1; load() }, { immediate: true })
</script>

<template>
  <section class="pm-metric-review pm-panel" aria-label="真实报告审核轮次">
    <header><h3>报告送审与审核记录</h3><button type="button" :disabled="busy" @click="load">刷新核对</button></header>
    <p>主报告和专项分别送审。质量管理员独立审核，退回后重新送审；签发继续执行编制、审核、签发三人分离。历史首次无法证明时保留未知。</p>
    <label>报告类型 <select v-model="subject" :disabled="busy || !!pending"><option value="SERVICE_ITEM">主报告</option><option v-if="item.penetration_work_package" value="PENETRATION_WORK_PACKAGE">渗透专项报告</option></select></label>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="pending" role="status">本次结果尚未确认，请先刷新核对，再 <button type="button" :disabled="busy" @click="execute()">按原操作重试</button>。</p>
    <div v-if="!pending" class="pm-metric-actions">
      <button v-if="canSubmit" type="button" :disabled="busy || !!error" @click="submit()">{{ current?.decision === 'RETURNED' ? '修改完成，重新送审' : '提交真实审核' }}</button>
      <template v-if="canDecide">
        <label>审核说明 <textarea v-model="note" maxlength="1000" :disabled="busy" /></label>
        <label>退回原因 <select v-model="reason" :disabled="busy"><option value="EVIDENCE_INCOMPLETE">证据不完整</option><option value="TECHNICAL_ERROR">技术结论问题</option><option value="FORMAT_ERROR">格式规范问题</option><option value="SCOPE_MISMATCH">服务范围不一致</option><option value="OTHER">其他</option></select></label>
        <button type="button" :disabled="busy || !!error" @click="submit('PASSED')">独立审核通过</button><button type="button" :disabled="busy || !!error || !note.trim()" @click="submit('RETURNED')">退回并保留原因</button>
      </template>
    </div>
    <div class="pm-metric-scroll"><table><thead><tr><th>报告 / 版本 / 轮次</th><th>送审时间（北京）</th><th>决定</th><th>原因 / 说明</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.subject_type === 'SERVICE_ITEM' ? '主报告' : '专项' }} R{{ row.revision }} · 第{{ row.round_no }}轮</td><td>{{ formatBusinessDateTime(row.submitted_at) }}</td><td>{{ labels[row.decision] || row.decision }}</td><td>{{ row.reason_code }} {{ row.note }}</td></tr></tbody></table></div>
    <p v-if="!rows.length && !error">暂无真实轮次；既有报告阶段不会被换算成首次通过。</p>
    <footer><button type="button" :disabled="page === 1 || busy" @click="changePage(-1)">上一页</button> 第{{ page }}页 <button type="button" :disabled="rows.length < 50 || busy" @click="changePage(1)">下一页</button></footer>
  </section>
</template>

<style scoped>
.pm-metric-review{margin-block:16px;padding:16px;border:1px solid var(--border-color,#dce2eb);border-radius:12px}.pm-metric-review header,.pm-metric-actions,.pm-metric-review footer{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.pm-metric-review label{display:flex;gap:8px;align-items:center}.pm-metric-scroll{overflow:auto;margin-block:12px}.pm-metric-review table{width:100%;border-collapse:collapse}.pm-metric-review th,.pm-metric-review td{padding:10px;text-align:left;border-bottom:1px solid var(--border-color,#dce2eb)}.pm-metric-review textarea{min-height:64px}.pm-metric-review p{line-height:1.7}
</style>
