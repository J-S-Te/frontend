<script setup>
import { formatCRMError } from '../api/errorMessages.js'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { approveCustomerCreditApplication, listPendingCustomerCreditApplications, rejectCustomerCreditApplication } from '../api/credit.js'
import { createIdempotencyKey } from '../api/client.js'
import { listOwnerDirectory } from '../api/ownerDirectory.js'
import { formatBusinessDateTime } from '@/modules/shared/utils/businessTime.js'
import PromptDialog from '@/modules/shared/components/PromptDialog.vue'
import { usePromptDialog } from '@/modules/shared/composables/usePromptDialog.js'
import { crmResourceID } from '../navigation.js'

const props = defineProps({
  permissions: { type: Array, default: () => [] },
  roles: { type: Array, default: () => [] },
  applicationId: { type: [String, Array], default: '' },
  customerId: { type: [String, Array], default: '' },
})
defineEmits(['clear-target'])
const items = ref([]); const loading = ref(false); const error = ref(''); const actionID = ref(''); const applicantNames = ref({})
let loadSequence = 0
const { dialog: promptDialog, askPrompt, accept: acceptPrompt, cancel: cancelPrompt } = usePromptDialog()
const CREDIT_APPROVAL_ROLES = new Set(['sales_director', 'crm_super_admin'])
// 现有会话可能携带已签名的审批角色，却缺少后续权限目录发布时
// 新增的权限。保持允许列表显式声明；不要在浏览器中
// 根据任意角色推导任意权限。
const canApprove = () => props.permissions.includes('customer.credit.approve') || props.roles.some((role) => CREDIT_APPROVAL_ROLES.has(role))
const applicationID = (item) => String(item?.id || item?.application_id || '').trim()
// 使用显式布尔值，避免将 ref 对象本身绑定到
// 原生 disabled 属性。执行一次写操作期间锁定所有行。
const actionInProgress = () => actionID.value !== ''
const hasTarget = computed(() => Boolean(props.applicationId || props.customerId))
const invalidTarget = computed(() => (props.applicationId && !crmResourceID(props.applicationId))
  || (props.customerId && !crmResourceID(props.customerId)))
const visibleItems = computed(() => items.value.filter(item => !invalidTarget.value
  && (!props.applicationId || applicationID(item) === String(crmResourceID(props.applicationId)))
  && (!props.customerId || String(item.customer_id) === String(crmResourceID(props.customerId)))))
const targetMessage = computed(() => {
  if (!hasTarget.value || loading.value || error.value) return ''
  if (invalidTarget.value) return '信用审批入口无效，请从通知或待办列表重新打开。'
  return visibleItems.value.length ? '已定位到通知对应的信用调整申请。'
    : '该信用调整申请已处理、当前账号不可见或不存在，请查看全部待办或刷新核对。'
})
// 审批时间按北京口径展示，24 小时制；非法取值保留破折号占位。
function dateLabel(value) { return value ? (formatBusinessDateTime(value) || '—') : '—' }
// 用途：优先显示待办服务端已核验的名字，兼容旧版接口的目录结果。
// 参数：item 为已经过授权过滤的信用待办。
// 返回值：可显示姓名或缺名提示，不向业务用户暴露内部 ID。
function applicantLabel(item) {
  const id = String(item?.applicant_id || '').trim()
  const name = String(item?.applicant_name || '').trim()
  return (name !== id ? name : '') || applicantNames.value[id] || '姓名未记录'
}

// 用途：兼容仅返回申请人标识的旧版接口，异步读取缺名申请的姓名。
// 参数：applicationItems 为当前待办，sequence 为当前加载代次。
// 返回值：无；仅将精确身份匹配的姓名写入当前页面。
async function resolveApplicantNames(applicationItems, sequence) {
  const missing = applicationItems.filter((item) => {
    const id = item?.applicant_id
    const name = String(item?.applicant_name || '').trim()
    return id && (!name || name === id) && !applicantNames.value[id]
  })
  const IDs = [...new Set(missing.map((item) => item.applicant_id))]
  await Promise.all(IDs.map(async (id) => {
    try {
      const result = await listOwnerDirectory({ user_id: id, page: 1, page_size: 1 })
      const user = result?.items?.find((entry) => entry.user_id === id)
      const name = String(user?.display_name || user?.username || user?.account_name || '').trim()
      if (name && sequence === loadSequence) applicantNames.value[id] = name
    } catch { /* 人员目录失败时保留待办及缺名提示。 */ }
  }))
}
// 用途：读取完整授权待审集合，并隔离通知切换或卸载后的迟到响应。
// 参数：无；筛选坐标只控制展示，服务端仍按当前会话裁剪待办。
// 返回值：异步完成；读取失败显式提示，不把失败当作申请已处理。
async function load() {
  const sequence = ++loadSequence
  error.value = ''; items.value = []
  if (!canApprove()) { loading.value = false; error.value = '当前账号无审批权限。'; return }
  loading.value = true
  try {
    // 此接口返回全部授权 PENDING 记录；不以第一页查找结果判断通知目标是否存在。
    const result = await listPendingCustomerCreditApplications()
    const records = Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : []
    if (sequence !== loadSequence) return
    items.value = records
    void resolveApplicantNames(records, sequence)
  } catch (value) {
    if (sequence === loadSequence) error.value = value?.status === 403
      ? '当前账号无审批权限。' : formatCRMError(value, { fallback: '待审批列表加载失败。' })
  } finally { if (sequence === loadSequence) loading.value = false }
}
// 用途：收集审批意见，在弹窗结束后复核申请版本和权限再提交信用审批。
// 参数：item 为待审批申请，action 为通过或驳回动作。
// 返回值：无；取消或状态变化不提交，失败写入错误提示。
async function decide(item, action) {
  if (!canApprove() || actionID.value) return
  const id = applicationID(item)
  const requestID = item.id || item.application_id
  const version = Number(item.version)
  if (!id) { error.value = '待办编号缺失，请刷新后重试。'; return }
  if (!version) { error.value = '待办版本缺失，请刷新后重试。'; return }
  const approving = action === 'approve'
  const opinion = await askPrompt({
    title: approving ? '通过信用调整' : '驳回信用调整',
    label: approving ? '审批意见（选填）' : '驳回意见（至少两个字）',
    confirmText: approving ? '通过信用调整' : '驳回信用调整',
    minlength: approving ? 0 : 2, maxlength: 500, danger: !approving,
  })
  if (opinion === null || !canApprove() || actionID.value) return
  const current = items.value.find((value) => applicationID(value) === id)
  if (!current || Number(current.version) !== version || applicationID(item) !== id) return
  if ((!approving && opinion.trim().length < 2) || opinion.trim().length > 500) return
  actionID.value = id
  try {
    const submit = approving ? approveCustomerCreditApplication : rejectCustomerCreditApplication
    await submit(requestID, { opinion: opinion.trim(), version }, createIdempotencyKey())
    await load()
  } catch (value) {
    error.value = formatCRMError(value, { fallback: '审批操作失败，请刷新后重试。' })
  } finally { actionID.value = '' }
}
watch(() => [props.applicationId, props.customerId, canApprove()], () => {
  cancelPrompt()
  void load()
}, { immediate: true })
onScopeDispose(() => { loadSequence++ })
</script>

<template>
  <section class="crm-panel crm-credit-approvals" aria-labelledby="credit-approval-heading">
    <div class="crm-credit-approval-header">
      <div>
        <div class="crm-credit-approval-eyebrow">销售总监工作台</div>
        <div class="crm-credit-approval-title-row">
          <h2 id="credit-approval-heading">信用审批待办</h2>
          <span class="crm-credit-approval-count">{{ visibleItems.length }} 条待处理</span>
        </div>
        <p class="crm-note">仅展示当前账号可审批的信用等级调整申请。审批时服务端会重新校验申请基准等级。</p>
      </div>
      <button type="button" class="crm-credit-refresh" :disabled="loading" @click="load">
        <span aria-hidden="true">↻</span>{{ loading ? '加载中…' : '刷新列表' }}
      </button>
    </div>
    <p v-if="error" class="crm-alert error" role="alert">{{ error }}</p>
    <p v-if="targetMessage" class="crm-note" role="status">{{ targetMessage }}</p>
    <button v-if="hasTarget" type="button" class="crm-credit-refresh"
      @click="$emit('clear-target')">查看全部待办</button>
    <p v-if="!loading && !error && !hasTarget && !visibleItems.length" class="crm-empty">暂无待审批申请</p>
    <div v-else class="crm-credit-approval-list">
      <article v-for="item in visibleItems" :key="item.id || item.application_id" class="crm-credit-approval-item">
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
          <button type="button" class="primary" :disabled="actionInProgress()" @click="decide(item, 'approve')">通过信用调整</button>
          <button type="button" class="danger" :disabled="actionInProgress()" @click="decide(item, 'reject')">驳回信用调整</button>
        </div>
      </article>
    </div>
  </section>
  <PromptDialog :open="Boolean(promptDialog)" v-bind="promptDialog || {}" @confirm="acceptPrompt" @cancel="cancelPrompt" />
</template>
