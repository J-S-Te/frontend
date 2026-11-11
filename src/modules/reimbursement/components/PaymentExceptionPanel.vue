<script setup>
import { computed, onMounted, ref } from 'vue'
import { formatMinor } from '../api/client.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'
import BusinessOptionPicker from './BusinessOptionPicker.vue'
import { reimbursementAPI as api } from '../api/reimbursement.js'

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
})
const emit = defineEmits(['read', 'select', 'record', 'review', 'upload', 'page'])
// 实际付款账户与收款档案优先来自既有付款选项接口；异常事实本身允许外部账户，
// 因此额外保留一处带警示的高级手工入口，不把外部异常硬塞进受控目录。
const paymentAccounts = ref([])
const payeeProfiles = ref([])
const optionError = ref('')
const accounts = computed(() => (Array.isArray(paymentAccounts.value) ? paymentAccounts.value : []))
const payees = computed(() => (Array.isArray(payeeProfiles.value) ? payeeProfiles.value : []))
const accountNeedsManual = computed(() => Boolean(props.form?.source_account_ref)
  && !accounts.value.some((row) => row.account_ref === props.form.source_account_ref))
const payeeNeedsManual = computed(() => Boolean(props.form?.payee_profile_id)
  && !payees.value.some((row) => row.id === props.form.payee_profile_id))
const voucherList = computed({ get: () => splitIDs(props.form?.voucher_file_ids),
  set: (value) => { props.form.voucher_file_ids = joinIDs(value) } })
const evidenceList = computed({ get: () => splitIDs(props.reviewForm?.evidence_file_ids),
  set: (value) => { props.reviewForm.evidence_file_ids = joinIDs(value) } })

// 用途：把逗号分隔引用拆成去重列表，供选择器读写。
// 参数：value 为表单里的逗号分隔文件引用。
// 返回值：去重后的文件引用数组。
function splitIDs(value) { return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))] }
function joinIDs(value) { return (Array.isArray(value) ? value : []).slice(0, 20).join(',') }

// 用途：读取当前单据可用的受控付款账户与申请人收款档案，失败给出可重试原因。
// 参数：无。
// 返回值：无；选项缺失时不猜测目录内容。
async function loadPaymentOptions() {
  const id = props.claim?.id
  if (!id) return
  optionError.value = ''
  try {
    const result = await api.request(`/claims/${encodeURIComponent(id)}/payment-options`)
    paymentAccounts.value = Array.isArray(result?.source_accounts) ? result.source_accounts : []
    payeeProfiles.value = Array.isArray(result?.payee_profiles) ? result.payee_profiles : []
  } catch (cause) { optionError.value = cause?.message || '付款账户与收款档案选项读取失败' }
}

onMounted(() => { if (props.canRecord) void loadPaymentOptions() })
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
</script>

<template>
  <section class="expense-panel" aria-label="独立外部付款异常">
    <h2>独立外部付款异常</h2>
    <p>
      只追加实际观察的外部付款事实及核实记录。此处不会改变报销状态、正常付款记录或项目支出净额；
      不能用异常核实替代合法付款或冲正流程。
    </p>
    <button class="expense-button" @click="emit('read')">读取异常记录</button>
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
        <div class="expense-option-field">
          <span>实际付款账户（受控账户名称）</span>
          <select v-model="form.source_account_ref" aria-label="实际付款账户">
            <option value="">
              选择实际付款账户
            </option>
            <option v-if="accountNeedsManual" :value="form.source_account_ref">
              当前已保存账户 {{ form.source_account_ref }}
            </option>
            <option v-for="account in accounts" :key="account.id" :value="account.account_ref">
              {{ account.name }} · {{ account.account_ref }}
            </option>
          </select>
          <small v-if="optionError" class="expense-option-error">{{ optionError }}</small>
        </div>
        <label>实际流水号<input v-model="form.transaction_no"></label>
        <div class="expense-option-field">
          <span>实际收款档案（本人已审核）</span>
          <select v-model="form.payee_profile_id" aria-label="实际收款档案">
            <option value="">
              选择已审核收款档案
            </option>
            <option v-if="payeeNeedsManual" :value="form.payee_profile_id">
              当前已保存收款档案 {{ form.payee_profile_id }}
            </option>
            <option v-for="payee in payees" :key="payee.id" :value="payee.id">
              {{ payee.name }} · {{ payee.account_ref }} · v{{ payee.version }}
            </option>
          </select>
        </div>
        <label>上传外部付款凭证
          <input type="file" accept=".pdf,.png,.jpg,.jpeg"
            @change="emit('upload', $event, 'exceptionFact')">
        </label>
        <div class="expense-option-field">
          <span>已上传外部付款凭证（1至20份，按文件名选择）</span>
          <BusinessOptionPicker
            v-model="voucherList"
            path="/invoice-document-options"
            purpose="reimbursement.payment.voucher"
            value-key="file_id"
            object-label="付款凭证"
            multiple
            :disabled="saving || pending"
            aria-label="选择外部付款凭证"
          />
        </div>
      </div>
      <details class="expense-option-field">
        <summary>高级：外部实际账户不在受控目录时手工填写</summary>
        <p class="expense-alert warning">
          异常事实可能发生在本平台目录之外的账户。只有确知外部真实账户引用时才手工填写；正常付款请回到「全额付款事实登记」用受控账户登记。
        </p>
        <label>外部付款账户引用<input v-model="form.source_account_ref" maxlength="128"></label>
        <label>外部收款档案引用<input v-model="form.payee_profile_id" maxlength="64"></label>
      </details>
      <label>事实与当前审批不符的原因<textarea v-model="form.reason" maxlength="2000" /></label>
      <button class="expense-button" @click="emit('record')">仅记录异常事实</button>
    </fieldset>

    <div v-if="rows" class="expense-table">
      <table class="expense-table-body">
        <thead><tr><th scope="col">记录 / 实际流水</th><th scope="col">实际金额</th><th scope="col">观察时状态</th>
          <th scope="col">核实状态</th><th scope="col">操作</th></tr></thead>
        <tbody>
          <tr v-for="record in rows" :key="record.id">
            <td>{{ record.id }}<small>{{ record.transaction_no }}</small></td>
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
      <PaginationBar label="异常事实分页" :page="page" :total="total" :page-size="20"
        @change="nextPage => emit('page', nextPage)" />
    </div>

    <article v-if="selected" class="expense-item">
      <h3>原始异常事实 {{ selected.id }}</h3>
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
      <p>证据：{{ selected.voucher_file_ids?.join('、') }}</p>
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
        <div class="expense-option-field">
          <span>已上传核实证据（1至20份，按文件名选择）</span>
          <BusinessOptionPicker
            v-model="evidenceList"
            path="/invoice-document-options"
            purpose="reimbursement.payment.voucher"
            value-key="file_id"
            object-label="核实证据"
            multiple
            :disabled="saving || pending"
            aria-label="选择独立核实证据"
          />
        </div>
        <label v-if="['RESOLVE_WITH_PAYMENT', 'RESOLVE_WITH_REVERSAL'].includes(reviewForm.decision)">
          已有合法付款ID<input v-model="reviewForm.linked_payment_id">
        </label>
        <label v-if="reviewForm.decision === 'RESOLVE_WITH_REVERSAL'">
          已有批准全额冲正ID<input v-model="reviewForm.linked_reversal_id">
        </label>
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
          <p>证据：{{ review.evidence_file_ids?.join('、') }}</p>
          <p v-if="review.linked_payment_id">关联合法付款 {{ review.linked_payment_id }}
            <span v-if="review.linked_reversal_id"> · 已批准冲正 {{ review.linked_reversal_id }}</span></p>
        </li>
      </ol>
    </article>
  </section>
</template>
