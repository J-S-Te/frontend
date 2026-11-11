<script setup>
import { computed } from 'vue'
import { pricingDiscountSummary } from '../utils/pricing'
const props = defineProps({ pricing: { type: Object, default: null } })
const discount = computed(() => pricingDiscountSummary(props.pricing))
</script>
<template>
  <section aria-label="审批定价快照"><h3>审批冻结定价</h3><p v-if="!pricing">基准不完整：此审批快照没有完整定价依据。</p><template v-else><p>基准日 {{ pricing.basis_date }} · {{ pricing.currency }} · {{ pricing.tax_basis === 'INCLUSIVE' ? '含税' : '未税' }} · {{ pricing.tax_rate_bps / 100 }}%</p><p v-if="discount">折扣率 {{ discount.discount }}%{{ discount.isEighty ? '（八折）' : '' }}；让利率 {{ discount.concession }}%</p><p v-if="pricing.reason">重选原因：{{ pricing.reason }}</p><ul><li v-for="line in pricing.lines" :key="line.line_id">服务项 {{ line.service_index + 1 }}：{{ line.quantity }} {{ line.unit }}；标准单价 {{ line.unit_price_minor }}；标准额 {{ line.standard_minor }}；成交额 {{ line.amount_minor }}（最小币种单位），目录版本 {{ line.price_version }}</li></ul></template></section>
</template>
