<script setup>
import { computed } from 'vue'
import { todayBusinessDate } from '../../shared/utils/businessTime.js'
import { WIN_EVIDENCE_TYPES } from '../winConfirmation.js'

const props = defineProps({
  mode: { type: String, default: 'contract' },
  modelValue: { type: Object, default: () => ({}) },
  contractRef: { type: String, default: '' },
  disabled: Boolean,
  readonly: Boolean,
  confirmationDetail: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'update:contractRef'])
const today = todayBusinessDate()
const confirmation = computed(() => props.confirmationDetail?.confirmation)
const evidenceTypeLabel = computed(() => WIN_EVIDENCE_TYPES.find(({ value }) =>
  value === confirmation.value?.evidence_type)?.label || '其他正式依据')

// 用途：将当前本地证据字段交给父表单，不原地修改传入对象。
// 参数：field 为字段名，event 为浏览器输入事件。
// 返回值：无，通过 update:modelValue 发送完整证据表单。
function updateEvidence(field, event) {
  if (props.disabled || props.readonly) return
  emit('update:modelValue', { ...props.modelValue, [field]: event.target.value })
}

// 用途：将合同引用交给父表单，保持原合同验真请求语义。
// 参数：event 为合同编号输入事件。
// 返回值：无，通过 update:contractRef 发送合同引用。
function updateContract(event) {
  if (!props.disabled && !props.readonly) emit('update:contractRef', event.target.value)
}
</script>

<template>
  <section v-if="readonly" class="crm-win-confirmation" aria-label="赢单确认依据">
    <template v-if="confirmation">
      <h3>本地赢单记录</h3>
      <dl>
        <dt>依据类型</dt><dd>{{ evidenceTypeLabel }}</dd>
        <dt>依据编号或引用</dt><dd>{{ confirmation.evidence_reference }}</dd>
        <dt>确认日期</dt><dd>{{ confirmationDetail.confirmed_on }}</dd>
        <dt>确认金额</dt><dd>{{ confirmation.confirmed_amount }}</dd>
        <dt>依据说明</dt><dd class="crm-win-note">{{ confirmation.evidence_note }}</dd>
      </dl>
    </template>
    <p v-else class="crm-note">尚未登记本地赢单依据。</p>
  </section>
  <fieldset v-else class="crm-win-confirmation" :disabled="disabled">
    <template v-if="mode === 'local_evidence'">
      <legend>本地赢单确认</legend>
      <p class="crm-note">填写客户确认采购的正式依据，记录将随商机变更保存并进入审计。</p>
      <label>依据类型
        <select :value="modelValue.evidence_type || ''" required @change="updateEvidence('evidence_type', $event)">
          <option value="" disabled>请选择依据类型</option>
          <option v-for="item in WIN_EVIDENCE_TYPES" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </label>
      <label>依据编号或引用
        <input :value="modelValue.evidence_reference || ''" required maxlength="200"
          placeholder="如采购单号、中标通知号或确认邮件编号" @input="updateEvidence('evidence_reference', $event)">
      </label>
      <label>确认日期
        <input type="date" :value="modelValue.confirmed_on || ''" :max="today" required
          @input="updateEvidence('confirmed_on', $event)">
      </label>
      <label>确认金额
        <input :value="modelValue.confirmed_amount || ''" required inputmode="decimal" maxlength="19"
          pattern="[0-9]{1,16}(\.[0-9]{1,2})?" @input="updateEvidence('confirmed_amount', $event)">
      </label>
      <label>依据说明
        <textarea :value="modelValue.evidence_note || ''" required maxlength="1000"
          @input="updateEvidence('evidence_note', $event)"></textarea>
      </label>
    </template>
    <label v-else-if="mode === 'contract'">合同编号
      <input :value="contractRef" required maxlength="64" placeholder="请输入合同管理系统中的合同编号"
        @input="updateContract">
      <small>提交时会精确校验合同是否属于当前客户。</small>
    </label>
    <p v-else class="crm-alert warning" role="alert">当前赢单确认模式不可用，请刷新后重试。</p>
  </fieldset>
</template>

<style scoped>
.crm-win-confirmation {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
  padding: 1rem;
  border: 1px solid var(--border-color, #d7dce5);
  border-radius: 0.5rem;
}
.crm-win-confirmation label { display: grid; gap: 0.35rem; }
.crm-win-confirmation dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.5rem 1rem;
  margin: 0;
}
.crm-win-confirmation dd { margin: 0; overflow-wrap: anywhere; }
.crm-win-note { white-space: pre-wrap; }
</style>
