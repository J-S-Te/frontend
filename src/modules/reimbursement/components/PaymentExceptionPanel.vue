<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import BusinessObjectSelect from './BusinessObjectSelect.vue'
import { reimbursementAPI as api } from '../api/reimbursement.js'
import { formatMinor } from '../api/client.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'

const props = defineProps({
  claim: { type: Object, required: true },
  rows: { type: Array, default: null },
  page: { type: Number, default: 1 },
  total: { type: Number, default: 0 },
  selected: { type: Object, default: null },
  form: { type: Object, required: true },
  reviewForm: { type: Object, required: true },
  canRecord: { type: Boolean, default: false },
  canReview: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
  evidenceNames: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['read', 'select', 'record', 'review', 'upload', 'page'])
const decisions = {
  CONFIRM_CONFLICT: '核实确有冲突，保留待处置',
  DISMISS: '证据排除异常',
  RESOLVE_WITH_PAYMENT: '关联已有合法付款解除冲突',
  RESOLVE_WITH_REVERSAL: '关联已有批准全额冲正解除冲突',
}
const statuses = {
  PENDING: '待核实', VERIFIED_CONFLICT: '已核实存在冲突',
  DISMISSED: '已排除', RESOLVED: '已关联合法账本解除冲突',
}
const paymentOptions = ref({ source_accounts: [], payee_profiles: [] })
const resolutionOptions = ref({ payments: [], reversals: [] })
const paymentLoading = ref(false)
const resolutionLoading = ref(false)
const paymentError = ref('')
const resolutionError = ref('')
const evidenceError = ref('')
const evidenceChoice = ref('')
const reviewEvidenceChoice = ref('')
const chosenEvidenceNames = ref({})
const availablePayments = computed(() => resolutionOptions.value.payments.filter((row) => row.can_resolve_payment))
let paymentSequence = 0
let resolutionSequence = 0

// 用途：读取当前单据可引用的账户和档案，不改写实际付款金额或收款事实。
// 参数：无。
// 返回值：无；失败关闭可选列表并保留明确重试入口。
async function loadPaymentOptions() {
  const ticket = ++paymentSequence
  paymentOptions.value = { source_accounts: [], payee_profiles: [] }
  paymentError.value = ''; paymentLoading.value = false
  if (!props.canRecord || !props.claim.id) return
  paymentLoading.value = true
  try {
    const value = await api.request(`/claims/${encodeURIComponent(props.claim.id)}/payment-options`)
    if (ticket !== paymentSequence) return
    if (!Array.isArray(value.source_accounts) || !Array.isArray(value.payee_profiles)) throw new Error('invalid options')
    paymentOptions.value = value
  } catch { if (ticket === paymentSequence) paymentError.value = '付款账户和收款档案读取失败，请重试。' }
  finally { if (ticket === paymentSequence) paymentLoading.value = false }
}

// 用途：读取异常事实允许关联的真实付款与实际冲正账本，不拿申请ID冒充冲正。
// 参数：无。
// 返回值：无；旧异常的迟到结果丢弃，失败不可手填引用绕过。
async function loadResolutionOptions() {
  const ticket = ++resolutionSequence
  resolutionOptions.value = { payments: [], reversals: [] }
  resolutionError.value = ''; resolutionLoading.value = false
  if (!props.canReview || !props.selected?.allowed_actions?.includes('REVIEW_EXCEPTION')) return
  resolutionLoading.value = true
  try {
    const value = await api.request(`/payment-exceptions/${encodeURIComponent(props.selected.id)}/resolution-options`)
    if (ticket !== resolutionSequence) return
    if (!Array.isArray(value.payments) || !Array.isArray(value.reversals)) throw new Error('invalid options')
    resolutionOptions.value = value
  } catch { if (ticket === resolutionSequence) resolutionError.value = '付款和冲正记录读取失败，请重试。' }
  finally { if (ticket === resolutionSequence) resolutionLoading.value = false }
}

// 用途：按用户选中的实际冲正记录自动绑定其所属付款。
// 参数：row为resolution-options返回的实际冲正账本行，清空时为null。
// 返回值：无；仅复制真实引用，不生成付款或冲正。
function chooseReversal(row) {
  props.reviewForm.linked_reversal_id = row?.id || ''
  props.reviewForm.linked_payment_id = row?.payment_id || ''
}

// 用途：选择当前允许解除冲突的合法付款并清除旧冲正引用。
// 参数：row为服务端允许关联的付款行，清空时为null。
// 返回值：无。
function choosePayment(row) {
  props.reviewForm.linked_payment_id = row?.id || ''
  props.reviewForm.linked_reversal_id = ''
}

// 用途：读取当前表单已经关联的凭证集合，兼容父层上传后的逗号字符串。
// 参数：key为实际付款凭证或核实证据字段。
// 返回值：去重的内部文件引用，仅用于选择和计数，不作为显示名。
function evidenceFiles(key) {
  const form = key === 'voucher_file_ids' ? props.form : props.reviewForm
  const value = form[key]
  return [...new Set((Array.isArray(value) ? value : String(value || '').split(','))
    .map((id) => id.trim()).filter(Boolean))]
}

// 用途：加入用户选中的已上传付款用途凭证并保留文件名。
// 参数：row为用途限定的文档选项，key为目标证据字段。
// 返回值：无；不改变异常金额、渠道或账户事实。
function addEvidence(row, key) {
  if (!row?.file_id || props.saving || props.pending) return
  const files = evidenceFiles(key)
  if (files.length >= 20 && !files.includes(row.file_id)) {
    evidenceError.value = '每组凭证最多选择20份'
    return
  }
  const form = key === 'voucher_file_ids' ? props.form : props.reviewForm
  form[key] = [...new Set([...files, row.file_id])].join(',')
  chosenEvidenceNames.value[row.file_id] = row.name
  evidenceError.value = ''
}

// 用途：展示凭证原文件名，缺名称时显式提示核对而不显示技术ID。
// 参数：id为当前已经关联的内部文件引用。
// 返回值：业务文件名或待核对提示。
function evidenceName(id) {
  return chosenEvidenceNames.value[id] || props.evidenceNames[id] || '已上传凭证（名称待核对）'
}

// 用途：从当前异常声明中移除一份凭证引用，不删除上传文件。
// 参数：key为证据字段，id为本次移除的文件引用。
// 返回值：无。
function removeEvidence(key, id) {
  const form = key === 'voucher_file_ids' ? props.form : props.reviewForm
  form[key] = evidenceFiles(key).filter((value) => value !== id).join(',')
}

watch(() => [props.claim.id, props.canRecord], loadPaymentOptions, { immediate: true })
watch(() => [props.selected?.id, props.selected?.version, props.canReview], loadResolutionOptions, { immediate: true })
watch(() => props.reviewForm.decision, () => {
  props.reviewForm.linked_payment_id = ''; props.reviewForm.linked_reversal_id = ''
})
onBeforeUnmount(() => { paymentSequence++; resolutionSequence++ })
</script>

<template>
  <section class="expense-panel" aria-label="独立外部付款异常">
    <h2>独立外部付款异常</h2>
    <p>
      只追加实际观察的外部付款事实及核实记录。此处不会改变报销状态、正常付款记录或项目支出净额；
      不能用异常核实替代合法付款或冲正流程。
    </p>
    <button class="expense-button" @click="emit('read')">读取异常记录</button>
    <p v-if="evidenceError" role="alert">{{ evidenceError }}</p>
    <fieldset v-if="canRecord" :disabled="saving || pending" class="expense-item">
      <h3>记录实际外部付款</h3>
      <div class="expense-grid">
        <label>实际付款金额（元，不自动套用批准额）
          <input v-model="form.amount" inputmode="decimal">
        </label>
        <label>币种<input v-model="form.currency" readonly></label>
        <label>实际付款日期<input v-model="form.paid_date" type="date"></label>
        <label>实际方式<select v-model="form.method">
          <option value="BANK">银行转账</option><option value="CASH">现金</option>
        </select></label>
        <BusinessObjectSelect v-model="form.source_account_ref" label="实际付款账户"
          :options="paymentOptions.source_accounts" value-key="account_ref"
          :disabled="saving || pending || paymentLoading || !!paymentError" />
        <label>实际流水号<input v-model="form.transaction_no"></label>
        <BusinessObjectSelect v-model="form.payee_profile_id" label="实际收款档案"
          :options="paymentOptions.payee_profiles" :disabled="saving || pending || paymentLoading || !!paymentError" />
        <label>上传外部付款凭证
          <input type="file" accept=".pdf,.png,.jpg,.jpeg"
            @change="emit('upload', $event, 'exceptionFact')">
        </label>
        <BusinessObjectSelect v-model="evidenceChoice" label="已上传付款凭证"
          source="/invoice-document-options" :extra-params="{ purpose: 'reimbursement.payment.voucher' }"
          :disabled="saving || pending" @select="addEvidence($event, 'voucher_file_ids')" />
        <ul><li v-for="id in evidenceFiles('voucher_file_ids')" :key="id">{{ evidenceName(id) }}
          <button type="button" class="expense-button" @click="removeEvidence('voucher_file_ids', id)">移除</button>
        </li></ul>
      </div>
      <p v-if="paymentLoading" role="status">正在读取账户和档案选项…</p>
      <p v-if="paymentError" role="alert">{{ paymentError }}
        <button type="button" class="expense-button" @click="loadPaymentOptions">重试选项</button>
      </p>
      <p>请选择实际观察到的账户和档案；没有对应主数据时请先核对维护，不得用批准收款替代实际事实。</p>
      <label>事实与当前审批不符的原因<textarea v-model="form.reason" maxlength="2000" /></label>
      <button class="expense-button" @click="emit('record')">仅记录异常事实</button>
    </fieldset>

    <div v-if="rows" class="expense-table">
      <table>
        <thead><tr><th>记录 / 实际流水</th><th>实际金额</th><th>观察时状态</th>
          <th>核实状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="record in rows" :key="record.id">
            <td>外部付款异常<small>{{ record.transaction_no }}</small></td>
            <td>{{ formatMinor(record.amount_minor) }} {{ record.currency }}</td>
            <td>{{ record.observed_claim_status }} · v{{ record.observed_claim_version }}</td>
            <td>{{ statuses[record.status] || record.status }} · v{{ record.version }}</td>
            <td><button class="expense-button" @click="emit('select', record.id)">
              查看原事实与核实历史
            </button></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="5">当前单据暂无异常事实记录。</td></tr>
        </tbody>
      </table>
      <div class="expense-actions">
        <span>共 {{ total }} 条 · 第 {{ page }} 页</span>
        <button class="expense-button" :disabled="page <= 1" @click="emit('page', page - 1)">
          上一页
        </button>
        <button class="expense-button" :disabled="page * 20 >= total"
          @click="emit('page', page + 1)">下一页</button>
      </div>
    </div>

    <article v-if="selected" class="expense-item">
      <h3>原始异常事实</h3>
      <dl class="expense-grid">
        <div><dt>实际付款</dt><dd>{{ formatMinor(selected.amount_minor) }} {{ selected.currency }}</dd></div>
        <div><dt>渠道 / 日期</dt><dd>{{ selected.method }} · {{ selected.paid_date }}</dd></div>
        <div><dt>来源账户 / 流水</dt><dd>{{ selected.source_account_ref }} · {{ selected.transaction_no }}</dd></div>
        <div><dt>事实记录人</dt><dd>{{ selected.recorder_subject_id }}</dd></div>
        <div><dt>原观察状态</dt><dd>{{ selected.observed_claim_status }} · 单据v{{ selected.observed_claim_version }}</dd></div>
        <div><dt>当前核实游标</dt><dd>{{ statuses[selected.status] || selected.status }}
          · 异常v{{ selected.version }} · 当前单据v{{ selected.claim_version }}</dd></div>
      </dl>
      <p>原事实原因：{{ selected.reason }}</p>
      <p>证据：{{ selected.voucher_file_ids?.map(evidenceName).join('、') }}</p>
      <fieldset
        v-if="canReview && selected.allowed_actions?.includes('REVIEW_EXCEPTION')"
        :disabled="saving || pending"
      >
        <h3>独立核实决定</h3>
        <label>结论<select v-model="reviewForm.decision">
          <option v-for="(label, decision) in decisions" :key="decision" :value="decision">
            {{ label }}
          </option>
        </select></label>
        <label>独立核实依据<textarea v-model="reviewForm.reason" maxlength="2000" /></label>
        <label>上传核实证据<input type="file" accept=".pdf,.png,.jpg,.jpeg"
          @change="emit('upload', $event, 'exceptionReview')"></label>
        <BusinessObjectSelect v-model="reviewEvidenceChoice" label="已上传核实凭证"
          source="/invoice-document-options" :extra-params="{ purpose: 'reimbursement.payment.voucher' }"
          :disabled="saving || pending" @select="addEvidence($event, 'evidence_file_ids')" />
        <ul><li v-for="id in evidenceFiles('evidence_file_ids')" :key="id">{{ evidenceName(id) }}
          <button type="button" class="expense-button" @click="removeEvidence('evidence_file_ids', id)">移除</button>
        </li></ul>
        <BusinessObjectSelect v-if="reviewForm.decision === 'RESOLVE_WITH_PAYMENT'"
          v-model="reviewForm.linked_payment_id" label="已有合法付款" :options="availablePayments"
          :disabled="saving || pending || resolutionLoading || !!resolutionError" @select="choosePayment" />
        <BusinessObjectSelect v-if="reviewForm.decision === 'RESOLVE_WITH_REVERSAL'"
          v-model="reviewForm.linked_reversal_id" label="已有批准全额冲正" :options="resolutionOptions.reversals"
          :disabled="saving || pending || resolutionLoading || !!resolutionError" @select="chooseReversal" />
        <p v-if="reviewForm.decision === 'RESOLVE_WITH_REVERSAL' && reviewForm.linked_payment_id">
          已自动关联该实际冲正对应的付款。
        </p>
        <p v-if="resolutionLoading" role="status">正在读取允许关联的账本记录…</p>
        <p v-if="resolutionError" role="alert">{{ resolutionError }}
          <button type="button" class="expense-button" @click="loadResolutionOptions">重试账本选项</button>
        </p>
        <p>解除冲突时由服务端逐项核对同单金额、币种、日期、方式、来源账户、流水及收款档案。</p>
        <button class="expense-button primary" @click="emit('review')">追加独立核实记录</button>
      </fieldset>
      <h3>追加核实历史</h3>
      <ol class="expense-history">
        <li v-for="review in selected.reviews || []" :key="review.id">
          <header><strong>{{ decisions[review.decision] || review.decision }}</strong>
            <time>{{ formatBusinessDateTime(review.created_at) }}</time></header>
          <p>核实人 {{ review.actor_subject_id }} · 异常v{{ review.previous_version }}
            → v{{ review.version }} · {{ statuses[review.status] || review.status }}</p>
          <p>{{ review.reason }}</p>
          <p>证据：{{ review.evidence_file_ids?.map(evidenceName).join('、') }}</p>
          <p v-if="review.linked_payment_id">已关联合法付款
            <span v-if="review.linked_reversal_id"> · 已批准实际冲正</span></p>
        </li>
      </ol>
    </article>
  </section>
</template>
