<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { createIdempotencyKey } from '../api/client.js'
import {
  approveCustomerCreditApplication, createCustomerCreditApplication, getCustomerCredit,
  listCustomerCreditHistory, listCustomerCreditPayments, listPendingCustomerCreditApplications,
  rejectCustomerCreditApplication,
} from '../api/credit.js'

const props = defineProps({ customer: { type: Object, default: null }, approvals: { type: Boolean, default: false }, standalone: { type: Boolean, default: false }, canApply: { type: Boolean, default: false }, permissions: { type: Array, default: () => [] } })
const emit = defineEmits(['notice', 'error', 'updated'])
const credit = ref(null); const history = ref([]); const payments = ref([]); const applications = ref([])
const loading = ref(false); const submitting = ref(false); const showForm = ref(false); const decision = ref(null)
const form = ref({ target_level: '', reason: '' }); const decisionOpinion = ref('')
const levels = ['A', 'B', 'C', 'D']
const levelLabel = (value) => ({ A: 'A · 优秀', B: 'B · 良好', C: 'C · 关注', D: 'D · 差' })[value] || value || '未设置'
const unwrapItems = (value) => Array.isArray(value) ? value : (value?.items || value?.data?.items || [])
const customerID = computed(() => props.customer?.id)
const isApprovalView = computed(() => props.approvals || props.standalone)
const currentLevel = computed(() => credit.value?.credit_level || props.customer?.credit_level || 'B')
const risk = computed(() => ['C', 'D'].includes(currentLevel.value))
const canApplyPermission = computed(() => props.canApply || props.permissions.includes('customer.credit.apply'))

async function loadCustomerCredit() {
  if (!customerID.value || isApprovalView.value) return
  loading.value = true
  try {
    const [summary, changes, records] = await Promise.all([
      getCustomerCredit(customerID.value), listCustomerCreditHistory(customerID.value, { page: 1, page_size: 20 }), listCustomerCreditPayments(customerID.value, { page: 1, page_size: 20 }),
    ])
    credit.value = summary; history.value = unwrapItems(changes); payments.value = unwrapItems(records)
  } catch (value) { emit('error', value?.message || '信用信息暂时无法加载。') }
  finally { loading.value = false }
}
async function loadApprovals() {
  loading.value = true
  try { applications.value = unwrapItems(await listPendingCustomerCreditApplications({ page: 1, page_size: 50 })) }
  catch (value) { emit('error', value?.message || '信用审批待办暂时无法加载。') }
  finally { loading.value = false }
}
function openApply() { form.value = { target_level: '', reason: '' }; showForm.value = true }
async function submitApply() {
  if (!customerID.value || submitting.value) return
  if (!levels.includes(form.value.target_level) || form.value.target_level === currentLevel.value) return emit('error', '请选择与当前等级不同的目标等级。')
  if (!form.value.reason.trim()) return emit('error', '请填写调整原因。')
  submitting.value = true
  try {
    await createCustomerCreditApplication(customerID.value, { target_level: form.value.target_level, reason: form.value.reason.trim() }, createIdempotencyKey())
    showForm.value = false; emit('notice', '信用等级调整申请已提交。'); emit('updated'); await loadCustomerCredit()
  } catch (value) { emit('error', value?.message || '信用等级调整申请提交失败。') }
  finally { submitting.value = false }
}
function openDecision(item, action) { decision.value = { item, action }; decisionOpinion.value = '' }
async function submitDecision() {
  if (!decision.value || submitting.value) return
  if (decision.value.action === 'reject' && !decisionOpinion.value.trim()) return emit('error', '驳回必须填写审批意见。')
  submitting.value = true
  try {
    const fn = decision.value.action === 'approve' ? approveCustomerCreditApplication : rejectCustomerCreditApplication
    await fn(decision.value.item.id, { opinion: decisionOpinion.value.trim(), version: decision.value.item.version }, createIdempotencyKey())
    decision.value = null; emit('notice', '审批操作已完成。'); await loadApprovals()
  } catch (value) { emit('error', value?.message || '审批操作失败。') }
  finally { submitting.value = false }
}
watch(customerID, loadCustomerCredit, { immediate: true }); onMounted(() => { if (isApprovalView.value) loadApprovals() })
</script>

<template>
  <section v-if="isApprovalView" class="crm-panel crm-credit-approvals" aria-labelledby="credit-approvals-title">
    <div class="crm-panel-heading"><div><h2 id="credit-approvals-title">信用等级审批待办</h2><p class="crm-note">审批时服务端会再次校验申请基准等级；等级已变化的申请不会覆盖最新结果。</p></div><button type="button" @click="loadApprovals">刷新</button></div>
    <p v-if="loading">正在加载审批待办…</p><div v-else-if="applications.length" class="crm-credit-approval-list"><article v-for="item in applications" :key="item.id" class="crm-credit-approval-item"><div><strong>{{ item.customer_name || `客户 #${item.customer_id}` }}</strong><span>{{ levelLabel(item.from_level) }} → {{ levelLabel(item.target_level) }}</span><small>申请人：{{ item.applicant_name || item.applicant_id || '—' }} · {{ item.reason }}</small></div><div class="crm-actions"><button type="button" class="primary" @click="openDecision(item, 'approve')">通过</button><button type="button" class="danger" @click="openDecision(item, 'reject')">驳回</button></div></article></div><p v-else class="crm-empty">暂无待审批信用调整申请</p>
  </section>
  <section v-else class="crm-credit-panel" aria-labelledby="customer-credit-title">
    <div class="crm-credit-summary"><div><span class="crm-credit-kicker">客户信用等级</span><strong :class="`credit-level-${currentLevel}`">{{ currentLevel }}</strong><span>{{ levelLabel(currentLevel) }}</span></div><div><small>最近变更</small><span>{{ credit?.credit_updated_time || credit?.updated_at || '—' }}</span></div><button v-if="canApplyPermission && customer?.status === 'ACTIVE'" type="button" @click="openApply">申请调整</button></div>
    <p v-if="risk" class="crm-alert warning" role="status">该客户信用等级为 {{ levelLabel(currentLevel) }}，请关注回款与交易风险。最近变更：{{ credit?.updated_at || '—' }}；最近一次不及时回款期次：{{ credit?.last_late_period_no || '暂无' }}。等级提示不阻断业务流程。</p>
    <p v-if="loading">正在加载信用记录…</p><template v-else>
      <div class="crm-credit-counters"><span>连续按时：<strong>{{ credit?.consecutive_ontime_count ?? 0 }}</strong></span><span>连续逾期：<strong>{{ credit?.consecutive_late_count ?? 0 }}</strong></span><span>规则来源：{{ credit?.credit_change_source || 'INITIAL' }}</span></div>
      <details open><summary>等级变更历史</summary><p v-if="!history.length" class="crm-empty compact">暂无变更记录</p><ul v-else><li v-for="item in history" :key="item.id"><strong>{{ levelLabel(item.from_level) }} → {{ levelLabel(item.to_level || item.credit_level) }}</strong> · {{ item.source || item.change_source }} · {{ item.reason || item.rule_result || '—' }}<small>操作人：{{ item.operator_id || '系统' }} · {{ item.occurred_at || '—' }}<template v-if="item.payment_id"> · 回款号：{{ item.payment_id }}</template><template v-if="item.application_id"> · 申请单：#{{ item.application_id }}</template></small></li></ul></details>
      <details><summary>回款评估记录</summary><p v-if="!payments.length" class="crm-empty compact">暂无回款评估记录</p><ul v-else><li v-for="item in payments" :key="item.id"><strong>{{ item.payment_id || item.receipt_id }}</strong> · {{ item.evaluation || item.evaluation_result || item.result || '未参与评估' }} · 宽限期 {{ item.grace_days ?? item.grace_days_applied ?? '—' }} 天<small>合同：{{ item.contract_no || '—' }} · 期次：{{ item.period_no || '—' }} · 应收 {{ item.due_amount || '—' }}（{{ item.due_date || '—' }}）· 实收 {{ item.paid_amount || '—' }}（{{ item.paid_date || '—' }}）<template v-if="item.ignore_reason"> · 忽略原因：{{ item.ignore_reason }}</template></small></li></ul></details>
    </template>
    <form v-if="showForm" class="crm-credit-apply-form" @submit.prevent="submitApply"><h3>申请调整信用等级</h3><label>目标等级<select v-model="form.target_level" required><option value="" disabled>请选择</option><option v-for="item in levels" :key="item" :value="item" :disabled="item === currentLevel">{{ levelLabel(item) }}</option></select></label><label>调整原因<textarea v-model.trim="form.reason" required rows="4"></textarea></label><div class="crm-actions"><button type="button" @click="showForm = false">取消</button><button type="submit" class="primary" :disabled="submitting">{{ submitting ? '提交中…' : '提交申请' }}</button></div></form>
  </section>
  <div v-if="decision" class="crm-credit-decision"><h3>{{ decision.action === 'approve' ? '通过信用调整' : '驳回信用调整' }}</h3><p>{{ decision.item.customer_name || `客户 #${decision.item.customer_id}` }}：{{ levelLabel(decision.item.from_level) }} → {{ levelLabel(decision.item.target_level) }}</p><label>{{ decision.action === 'approve' ? '审批意见（选填）' : '驳回意见（必填）' }}<textarea v-model.trim="decisionOpinion" rows="3"></textarea></label><div class="crm-actions"><button type="button" @click="decision = null">取消</button><button type="button" :class="decision.action === 'approve' ? 'primary' : 'danger'" :disabled="submitting" @click="submitDecision">确认{{ decision.action === 'approve' ? '通过' : '驳回' }}</button></div></div>
</template>
