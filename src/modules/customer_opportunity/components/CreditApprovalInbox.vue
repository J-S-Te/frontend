<script setup>
import { onMounted, ref } from 'vue'
import { approveCustomerCreditApplication, listPendingCustomerCreditApplications, rejectCustomerCreditApplication } from '../api/credit.js'
import { createIdempotencyKey } from '../api/client.js'

const props = defineProps({ permissions: { type: Array, default: () => [] } })
const items = ref([]); const loading = ref(false); const error = ref(''); const actionID = ref('')
const canApprove = () => props.permissions.includes('customer.credit.approve')
function dateLabel(value) { return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—' }
async function load() { loading.value = true; error.value = ''; try { const result = await listPendingCustomerCreditApplications({ page: 1, page_size: 50 }); items.value = result?.items || result || [] } catch (value) { error.value = value?.status === 403 ? '当前账号无审批权限。' : value?.message || '待审批列表加载失败。' } finally { loading.value = false } }
async function decide(item, action) {
  if (!canApprove() || actionID.value) return
  const opinion = window.prompt(action === 'approve' ? '审批意见（可选）' : '驳回意见（必填）', '')
  if (opinion === null || (action === 'reject' && !opinion.trim())) return
  actionID.value = String(item.id || item.application_id)
  if (!Number(item.version)) { error.value = '待办版本缺失，请刷新后重试。'; actionID.value = ''; return }
  try { await (action === 'approve' ? approveCustomerCreditApplication(item.id || item.application_id, { opinion: opinion.trim(), version: item.version }, createIdempotencyKey()) : rejectCustomerCreditApplication(item.id || item.application_id, { opinion: opinion.trim(), version: item.version }, createIdempotencyKey())); await load() } catch (value) { error.value = value?.message || '审批操作失败，请刷新后重试。' } finally { actionID.value = '' }
}
onMounted(load)
</script>

<template>
  <section class="crm-panel crm-credit-approvals" aria-labelledby="credit-approval-heading"><div class="crm-panel-heading"><div><h2 id="credit-approval-heading">信用调整审批待办</h2><p class="crm-note">审批时服务端会重新校验申请基准等级；等级已变化的申请不会覆盖最新结果。</p></div><button type="button" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button></div><p v-if="error" class="crm-alert error" role="alert">{{ error }}</p><p v-if="!loading && !items.length" class="crm-empty">暂无待审批申请</p><div v-else class="crm-credit-approval-list"><article v-for="item in items" :key="item.id || item.application_id"><div><strong>{{ item.customer_name || `客户 #${item.customer_id}` }}</strong><span>{{ item.from_level || '—' }} → {{ item.target_level || item.to_level || '—' }} · {{ dateLabel(item.created_at || item.applied_at) }}</span><p>{{ item.reason }}</p><small>申请人：{{ item.applicant_name || item.applicant_id || '—' }}</small></div><div v-if="canApprove()" class="crm-actions"><button type="button" class="primary" :disabled="actionID" @click="decide(item, 'approve')">通过</button><button type="button" class="danger" :disabled="actionID" @click="decide(item, 'reject')">驳回</button></div></article></div></section>
</template>
