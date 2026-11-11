<script setup>
defineProps({claim:{type:Object,required:true},settlementEnabled:Boolean})
</script>
<template>
  <aside class="expense-card" aria-label="报销支出与财务确认口径">
    <h3>支出与成本确认</h3>
    <p>付款及全额冲正是现金支出事实，独立财务确认后才计入经营成本；项目内的报销支出是同笔付款的副本，不重复累计。</p>
    <p v-if="claim.items?.some(item => item.expense_nature === 'PREPAYMENT')">本单含预付费用：必须具备实际发生或摊销依据，并由其他财务人员独立复核，才能确认成本。</p>
    <p>原付款冲正后，已确认成本保留并产生待处理差异。原确认独立冲回前，即使重新付款也不能再次确认本单费用。</p>
    <RouterLink v-if="settlementEnabled" :to="{name:'settlement',params:{section:'recognition'},query:{claim_id:claim.id}}">前往结算核对费用并登记确认</RouterLink>
    <p>结算入口按结算应用的独立动作与组织范围授权；报销岗位不自动取得财务确认权限。</p>
  </aside>
</template>
