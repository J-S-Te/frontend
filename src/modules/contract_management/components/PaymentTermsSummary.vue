<script setup>
defineProps({ terms: { type: Array, default: () => [] }, currency: { type: String, default: 'CNY' } })
</script>

<template>
  <section class="contract-payment-summary">
    <h3>付款计划</h3>
    <p v-if="!terms.length">未维护结构化付款计划，合同不会自动生成结算应收计划。</p>
    <table v-else class="contract-data-table">
      <thead><tr><th>分期号</th><th>到期日</th><th>金额（{{ currency }}）</th></tr></thead>
      <tbody><tr v-for="term in terms" :key="term.installment_no"><td>{{ term.installment_no }}</td><td>{{ term.due_date }}</td><td>{{ term.amount }}</td></tr></tbody>
    </table>
    <p v-if="terms.length">按审批版本冻结。合同生效后投递至结算，由财务人员确认应收计划。</p>
  </section>
</template>
