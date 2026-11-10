<script setup>
import { formatMinor } from '../api/client.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'

defineProps({
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
        <label>实际付款账户引用<input v-model="form.source_account_ref"></label>
        <label>实际流水号<input v-model="form.transaction_no"></label>
        <label>实际收款档案引用<input v-model="form.payee_profile_id"></label>
        <label>上传外部付款凭证
          <input type="file" accept=".pdf,.png,.jpg,.jpeg"
            @change="emit('upload', $event, 'exceptionFact')">
        </label>
        <label>已上传凭证ID（1至20份）<input v-model="form.voucher_file_ids"></label>
      </div>
      <label>事实与当前审批不符的原因<textarea v-model="form.reason" maxlength="2000" /></label>
      <button class="expense-button" @click="emit('record')">仅记录异常事实</button>
    </fieldset>

    <div v-if="rows" class="expense-table">
      <table>
        <thead><tr><th>记录 / 实际流水</th><th>实际金额</th><th>观察时状态</th>
          <th>核实状态</th><th>操作</th></tr></thead>
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
        <label>已上传核实证据ID（1至20份）<input v-model="reviewForm.evidence_file_ids"></label>
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
