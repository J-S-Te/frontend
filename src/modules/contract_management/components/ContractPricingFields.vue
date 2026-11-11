<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { listStandardPrices } from '../api/contract'

const props = defineProps({ form: { type: Object, required: true }, disabled: Boolean, lockAmounts: Boolean })
const prices = ref([])
const error = ref('')
const loading = ref(false)
const hasMore = ref(false)
const offset = ref(0)
const frozen = computed(() => Boolean(props.form.pricing?.frozen_at))
const sum = computed(() => (props.form.pricing?.lines || []).reduce((n, line) => n + Number(line.amount_minor || 0), 0))

// 用途：按完整分页读取可选发布价，读取失败保留可重试错误。
// 参数：more决定追加下一页；默认重新读取。
// 返回值：无；只更新当前组件目录状态。
async function loadPrices(more = false) {
  loading.value = true; error.value = ''
  try {
    const nextOffset = more ? offset.value + 100 : 0
    const page = await listStandardPrices({ status: 'PUBLISHED', limit: '100', offset: String(nextOffset) })
    prices.value = more ? [...prices.value, ...page.items] : page.items
    offset.value = nextOffset; hasMore.value = page.has_more
  } catch (cause) { error.value = cause.message || '读取标准价失败。' }
  finally { loading.value = false }
}

// 用途：启用可选定价记录并为每个服务项建立成交行。
// 参数：无；从当前合同服务项读取覆盖范围。
// 返回值：无；标准单价和标准总额只由服务器冻结。
function enablePricing() {
  props.form.pricing = { basis_date: '', tax_basis: 'INCLUSIVE', tax_rate_bps: 600, lines: [] }
  synchronizeLines()
}

// 用途：随服务项增删保持一项一行，已有冻结行保留稳定身份。
// 参数：无。
// 返回值：无；不会自动选择新标准价。
function synchronizeLines() {
  if (!props.form.pricing) return
  const old = props.form.pricing.lines || []
  props.form.pricing.lines = props.form.service_items.map((item, index) => ({
    ...(old.find(line => item.source_id && line.service_id === item.source_id) || old[index] || { price_id: '', quantity: '1', amount_minor: 0 }),
    service_index: index,
  }))
}

// 用途：首次选价时展示明确的税基，实际匹配仍由服务器复核。
// 参数：line为选价行，index为服务项位置。
// 返回值：无。
function selectPrice(line, index) {
  const price = prices.value.find(item => item.id === line.price_id)
  if (price && index === 0) { props.form.pricing.tax_basis = price.tax_basis; props.form.pricing.tax_rate_bps = price.tax_rate_bps }
}
watch(() => props.form.service_items.length, synchronizeLines)
onMounted(() => loadPrices())
</script>

<template>
  <section class="contract-form-wide pricing-fields">
    <div class="contract-section-title"><div><h3>标准价与合同折扣</h3><p>按已发布价冻结基准；没有完整基准的历史合同显示“基准不完整”。</p></div><button v-if="!form.pricing" type="button" class="contract-button secondary" :disabled="disabled" @click="enablePricing">启用定价明细</button></div>
    <template v-if="form.pricing">
      <p v-if="error" role="alert">{{ error }} <button type="button" @click="loadPrices()">重新读取</button></p>
      <label v-if="frozen"><input v-model="form.pricing.reselect" type="checkbox" :disabled="disabled" />显式重选新基准（需新日期、原因并重新审批）</label>
      <div class="pricing-grid"><label>基准日<input v-model="form.pricing.basis_date" type="date" :disabled="disabled || (frozen && !form.pricing.reselect)" /><small>首次留空采用服务器北京业务日；不能选择未来日期。</small></label><label>税基<select v-model="form.pricing.tax_basis" :disabled="disabled || (frozen && !form.pricing.reselect)"><option value="INCLUSIVE">含税</option><option value="EXCLUSIVE">未税</option></select></label><label>税率（万分比）<input v-model.number="form.pricing.tax_rate_bps" type="number" min="0" max="10000" step="1" :disabled="disabled || (frozen && !form.pricing.reselect)" /></label></div>
      <label v-if="form.pricing.reselect">重选原因<input v-model="form.pricing.reason" required maxlength="500" :disabled="disabled" /></label>
      <article v-for="(line, index) in form.pricing.lines" :key="line.line_id || index" class="pricing-grid">
        <label>服务项 {{ line.service_index + 1 }} · {{ form.service_items[line.service_index]?.name || form.service_items[line.service_index]?.service_type }}<select v-model="line.price_id" required :disabled="disabled || (frozen && !form.pricing.reselect)" @change="selectPrice(line, index)"><option value="" disabled>选择已发布价格版本</option><option v-if="line.price_id && !prices.some(price => price.id === line.price_id)" :value="line.price_id">原冻结版本 {{ line.price_id }} · {{ line.unit_price_minor }} 最小币种单位/{{ line.unit }}</option><option v-for="price in prices.filter(p => p.service_type === form.service_items[line.service_index]?.service_type)" :key="price.id" :value="price.id">{{ price.name }} · {{ price.unit_price_minor }} {{ price.currency }}最小单位/{{ price.unit }} · v{{ price.version }} · {{ price.effective_from }}起</option></select></label>
        <label>数量（最多4位小数）<input v-model="line.quantity" required inputmode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" :disabled="disabled || (frozen && !form.pricing.reselect)" /></label>
        <label>成交行额（{{ form.currency || 'CNY' }}最小币种单位）<input v-model.number="line.amount_minor" required type="number" min="0" step="1" :disabled="disabled || (lockAmounts && !form.pricing.reselect)" /></label>
        <small v-if="line.standard_minor">冻结标准额：{{ line.standard_minor }}，稳定行：{{ line.line_id }}</small>
      </article>
      <p>成交行合计：{{ sum }} 最小币种单位；必须等于合同总金额。标准额由服务器按单价×数量逐行四舍五入。</p>
      <button v-if="hasMore" type="button" :disabled="loading" @click="loadPrices(true)">读取更多标准价</button>
    </template>
  </section>
</template>
<style scoped>
.pricing-fields { border: 1px solid var(--border-color, #d8dee8); padding: 16px; border-radius: 10px; }
.pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 12px 0; }
label { display: grid; gap: 6px; } small { opacity: .8; } input, select { max-width: 100%; min-width: 0; }
</style>
