<script setup>
defineProps({ terms: { type: Array, default: () => [] }, currency: { type: String, default: 'CNY' } })
</script>

<template>
  <section class="contract-payment-summary">
    <h3>付款计划</h3>
    <p v-if="!terms.length">未维护结构化付款计划，合同不会自动生成结算应收计划。</p>
    <!-- 合同详情是模态弹窗，而 .contract-data-table 全局最小宽度 980px。表格直接作为
         弹窗内容会把整个弹窗撑出横向滚动（连标题、关闭按钮一起被推走）。这里给表格
         一个局部滚动容器，只让付款计划表自己横向滚动。 -->
    <div v-else class="contract-payment-scroll" data-table-scroll>
      <table class="contract-data-table">
        <thead><tr><th scope="col">分期号</th><th scope="col">到期日</th><th scope="col">金额（{{ currency }}）</th></tr></thead>
        <tbody><tr v-for="term in terms" :key="term.installment_no"><td>{{ term.installment_no }}</td><td>{{ term.due_date }}</td><td>{{ term.amount }}</td></tr></tbody>
      </table>
    </div>
    <p v-if="terms.length">按审批版本冻结。合同生效后投递至结算，由财务人员确认应收计划。</p>
  </section>
</template>

<style scoped>
/* 局部滚动容器：宽度不超过弹窗内容区，表格再宽也只在容器内滚动。 */
.contract-payment-scroll {
  max-width: 100%;
  overflow-x: auto;
}
</style>
