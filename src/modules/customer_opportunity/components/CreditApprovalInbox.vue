<script setup>
import { onMounted, ref } from 'vue'
import { approveCustomerCreditApplication, listPendingCustomerCreditApplications, rejectCustomerCreditApplication } from '../api/credit.js'
import { createIdempotencyKey } from '../api/client.js'
import { listOwnerDirectory } from '../api/ownerDirectory.js'

const props = defineProps({
  permissions: { type: Array, default: () => [] },
  roles: { type: Array, default: () => [] },
})
const items = ref([]); const loading = ref(false); const error = ref(''); const actionID = ref(''); const applicantNames = ref({})
const CREDIT_APPROVAL_ROLES = new Set(['sales_director', 'crm_super_admin'])
// Existing sessions can carry a signed approval role but miss the permission
// added by a later catalog publication. Keep this allow-list explicit; do not
// infer arbitrary permissions from arbitrary roles in the browser.
const canApprove = () => props.permissions.includes('customer.credit.approve') || props.roles.some((role) => CREDIT_APPROVAL_ROLES.has(role))
const applicationID = (item) => String(item?.id || item?.application_id || '').trim()
// Use an explicit boolean instead of binding the ref object itself to the
// native disabled attribute. All rows remain locked during one mutation.
const actionInProgress = () => actionID.value !== ''
function dateLabel(value) { return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—' }
function rememberApplicantNames(users) { for (const user of users || []) { if (user?.user_id) applicantNames.value[user.user_id] = String(user.username || user.account_name || user.display_name || '').trim() || '未命名用户' } }
function applicantLabel(item) { const id = String(item?.applicant_id || '').trim(); const snapshot = String(item?.applicant_name || '').trim(); return (snapshot && snapshot !== id ? snapshot : '') || applicantNames.value[id] || '未命名用户' }
async function resolveApplicantNames(applicationItems) {
  const IDs = [...new Set(applicationItems.map((item) => item?.applicant_id).filter((id) => id && !applicantNames.value[id]))]
  await Promise.all(IDs.map(async (id) => { try { const result = await listOwnerDirectory({ user_id: id, page: 1, page_size: 1 }); rememberApplicantNames(result?.items || []) } catch { /* 目录不可用时显示通用名称，不向业务用户暴露内部 ID。 */ } }))
}
async function load() { loading.value = true; error.value = ''; try { const result = await listPendingCustomerCreditApplications({ page: 1, page_size: 50 }); items.value = Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : []; await resolveApplicantNames(items.value) } catch (value) { error.value = value?.status === 403 ? '当前账号无审批权限。' : value?.message || '待审批列表加载失败。' } finally { loading.value = false } }
async function decide(item, action) {
  if (!canApprove() || actionID.value) return
  const opinion = window.prompt(action === 'approve' ? '审批意见（可选）' : '驳回意见（必填）', '')
  if (opinion === null || (action === 'reject' && opinion.trim().length < 2)) return
  actionID.value = applicationID(item)
  if (!actionID.value) { error.value = '待办编号缺失，请刷新后重试。'; actionID.value = ''; return }
  if (!Number(item.version)) { error.value = '待办版本缺失，请刷新后重试。'; actionID.value = ''; return }
  try { await (action === 'approve' ? approveCustomerCreditApplication(item.id || item.application_id, { opinion: opinion.trim(), version: item.version }, createIdempotencyKey()) : rejectCustomerCreditApplication(item.id || item.application_id, { opinion: opinion.trim(), version: item.version }, createIdempotencyKey())); await load() } catch (value) { error.value = value?.message || '审批操作失败，请刷新后重试。' } finally { actionID.value = '' }
}
onMounted(load)
</script>

<template>
  <section class="crm-panel crm-credit-approvals" aria-labelledby="credit-approval-heading">
    <div class="crm-credit-approval-header">
      <div>
        <div class="crm-credit-approval-eyebrow">CM-003 · 销售总监工作台</div>
        <div class="crm-credit-approval-title-row">
          <h2 id="credit-approval-heading">信用审批待办</h2>
          <span class="crm-credit-approval-count">{{ items.length }} 条待处理</span>
        </div>
        <p class="crm-note">仅展示当前账号可审批的信用等级调整申请。审批时服务端会重新校验申请基准等级。</p>
      </div>
      <button type="button" class="crm-credit-refresh" :disabled="loading" @click="load">
        <span aria-hidden="true">↻</span>{{ loading ? '加载中…' : '刷新列表' }}
      </button>
    </div>
    <p v-if="error" class="crm-alert error" role="alert">{{ error }}</p>
    <p v-if="!loading && !items.length" class="crm-empty">暂无待审批申请</p>
    <div v-else class="crm-credit-approval-list">
      <article v-for="item in items" :key="item.id || item.application_id" class="crm-credit-approval-item">
        <div class="crm-credit-approval-main">
          <div class="crm-credit-approval-meta">
            <span class="crm-credit-pending-tag">待审批</span>
            <span>申请时间 {{ dateLabel(item.created_at || item.applied_at) }}</span>
          </div>
          <div class="crm-credit-customer-row">
            <strong>{{ item.customer_name || item.customer_no || `客户 #${item.customer_id ?? '—'}` }}</strong>
            <span class="crm-credit-level-flow">
              <b :data-level="item.from_level">{{ item.from_level || '—' }}</b>
              <i aria-hidden="true">→</i>
              <b :data-level="item.target_level || item.to_level">{{ item.target_level || item.to_level || '—' }}</b>
            </span>
          </div>
          <p class="crm-credit-approval-reason">{{ item.reason || '未填写申请原因' }}</p>
          <small class="crm-credit-applicant">申请人：{{ applicantLabel(item) }}</small>
        </div>
        <div v-if="canApprove()" class="crm-credit-approval-actions">
          <button type="button" class="primary" :disabled="actionInProgress()" @click="decide(item, 'approve')">通过</button>
          <button type="button" class="danger" :disabled="actionInProgress()" @click="decide(item, 'reject')">驳回</button>
        </div>
      </article>
    </div>
  </section>
</template>
