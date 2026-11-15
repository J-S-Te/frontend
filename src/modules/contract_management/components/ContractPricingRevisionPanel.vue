<script setup>
import { onMounted, ref } from 'vue'
import { changeContractPricing, getContract } from '../api/contract'
import PricingSnapshotSummary from './PricingSnapshotSummary.vue'
import ContractPricingFields from './ContractPricingFields.vue'
import { paymentAmountMinor } from '../utils/paymentTerms'
const props = defineProps({ contractId: { type: String, required: true }, canEdit: Boolean })
const emit = defineEmits(['changed'])
const record = ref(null), form = ref(null), error = ref(''), notice = ref(''), busy = ref(false), open = ref(false)
// 用途：载入权威合同和冻结定价，历史无基准明确显示未知。
// 参数：无；使用当前合同身份。
// 返回值：无。
async function load() {
  busy.value = true; error.value = ''
  try { record.value = await getContract(props.contractId); const c = record.value; form.value = { amount: String(c.amount_minor / 100), currency: c.currency, service_items: c.service_items || [], pricing: c.pricing ? JSON.parse(JSON.stringify(c.pricing)) : undefined, payment_terms: JSON.parse(JSON.stringify(c.payment_terms || [])), reason: '' } }
  catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
// 用途：提交默认沿原基准的金额变更或显式新基准审批。
// 参数：无；金额和计划来自明确表单，服务器重验版本与完整性。
// 返回值：无；成功后显示真实新版本或待审批身份。
async function submit() {
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const reselect = form.value.pricing?.reselect === true
    if (!record.value.pricing && form.value.pricing && !reselect) throw new Error('历史合同首次建立基准须显式勾选重选，并提供新日期与原因。')
    const result = await changeContractPricing(props.contractId, { version: record.value.version, amount_minor: paymentAmountMinor(form.value.amount), currency: record.value.currency, payment_terms: form.value.payment_terms, reason: form.value.reason, ...(reselect ? { pricing: { ...form.value.pricing, reason: form.value.reason } } : {}) }, reselect)
    notice.value = reselect ? `定价修订已提交审批 ${result.approval_id}，批准前原合同金额和基准继续有效。` : `金额变更已保存为版本 ${result.version}；继续使用原冻结基准。`
    open.value = false; emit('changed', result); await load()
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
onMounted(load)
</script>
<template>
  <section><h3>冻结定价与财务变更</h3><p v-if="error" role="alert">{{ error }} <button type="button" @click="load">重新载入</button></p><p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="record"><PricingSnapshotSummary v-if="record.pricing" :pricing="record.pricing" /><p v-if="!record.pricing">基准不完整：本合同没有可证明的历史标准价，不自动套用当前目录。</p><template v-else><p>基准日 {{ record.pricing.basis_date }} · {{ record.pricing.currency }} · {{ record.pricing.tax_basis === 'INCLUSIVE' ? '含税' : '未税' }} · 冻结于 {{ record.pricing.frozen_at }}</p><ul><li v-for="line in record.pricing.lines" :key="line.line_id">服务项 {{ line.service_index + 1 }}：{{ line.quantity }} {{ line.unit }} × 标准单价 {{ line.unit_price_minor }} = 标准额 {{ line.standard_minor }}；成交额 {{ line.amount_minor }}（最小币种单位）</li></ul></template>
      <button v-if="canEdit && ['approved', 'active', 'in_progress', 'pending_pay'].includes(record.status)" type="button" :disabled="busy" @click="open = !open">{{ open ? '收起变更' : '变更金额或申请重选基准' }}</button>
      <form v-if="open && form" @submit.prevent="submit"><p>默认改额沿原冻结标准额，成交行额按原占比分配，尾差归最后一行。重选须独立审批；原审批快照保留。</p><label>新合同金额（元）<input v-model="form.amount" required inputmode="decimal" /></label><label>变更原因<input v-model="form.reason" required maxlength="500" /></label><h4>完整付款计划</h4><div v-for="term in form.payment_terms" :key="term.installment_no"><span>第{{ term.installment_no }}期</span><input v-model="term.due_date" type="date" required aria-label="付款到期日" /><input v-model="term.amount" required inputmode="decimal" aria-label="本期金额元" /></div><p v-if="!form.payment_terms.length">当前缺少付款计划，需先补齐完整计划后才能提交受控变更。</p><button type="button" @click="form.payment_terms.push({ installment_no: form.payment_terms.length + 1, due_date: '', amount: '' })">增加付款期</button><ContractPricingFields :form="form" :disabled="busy" lock-amounts /><label v-if="form.pricing && !record.pricing"><input v-model="form.pricing.reselect" type="checkbox" />首次建立基准也使用独立修订审批</label><button type="submit" :disabled="busy">{{ busy ? '正在提交…' : form.pricing?.reselect ? '提交重选审批' : '提交金额变更' }}</button></form>
    </template>
  </section>
</template>
