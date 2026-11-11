import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { pricingDiscountSummary } from './utils/pricing.js'
import { hydrateContractDraft } from './utils/contractDraft.js'

// 用途：编译真实定价组件并暴露其业务事件处理器以验证界面行为。
// 参数：filename为组件名，props为界面输入，overrides为外部API依赖替身。
// 返回值：真实组件状态及SSR渲染入口。
function harness(filename, props, overrides = {}) {
  const { descriptor } = parse(readFileSync(new URL(`./components/${filename}`, import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'pricing-test' })
  const deps = { computed: Vue.computed, onMounted: Vue.onMounted, ref: Vue.ref, watch: Vue.watch, pricingDiscountSummary, PricingSnapshotSummary: { render() { return null } }, listStandardPrices: async () => ({ items: [], has_more: false }), ...overrides }
  const component = new Function(...Object.keys(deps), compiled.content.replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '').replace('export default', 'return'))(...Object.values(deps))
  const result = compileTemplate({ source: descriptor.template.content, filename, id: 'pricing-test', compilerOptions: { bindingMetadata: compiled.bindings } })
  assert.deepEqual(result.errors, [])
  const render = new Function('Vue', result.code.replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`).replace('export function render', 'return function render'))(Vue)
  let state
  const root = { setup() { state = component.setup(props, { expose() {}, emit() {} }); return () => render({}, [], props, Vue.proxyRefs(state), {}, {}) } }
  return { render: async () => { const html = await renderToString(Vue.createSSRApp(root)); return { html, state } } }
}

test('草稿恢复保留冻结价独立副本，不随本地修改重写服务端快照', () => {
  const c = { can_edit_draft: true, status: 'draft', pricing: { basis_date: '2026-01-01', lines: [{ line_id: 'stable-line', standard_minor: 10000 }] }, service_items: [] }
  const form = hydrateContractDraft(c)
  form.pricing.lines[0].standard_minor = 1
  assert.equal(c.pricing.lines[0].standard_minor, 10000)
})

test('真实定价字段只选择已发布价，启用后完整覆盖全部服务项', async () => {
  const form = Vue.reactive({ currency: 'CNY', service_items: [{ source_id: 'one', service_type: '软件测试' }, { source_id: 'two', service_type: '软件测试' }] })
  const { html, state } = await harness('ContractPricingFields.vue', { form, disabled: false }).render()
  assert.match(html, /启用定价明细/)
  state.enablePricing()
  assert.equal(form.pricing.lines.length, 2)
  assert.deepEqual(form.pricing.lines.map(line => line.service_index), [0, 1])
  assert.ok(form.pricing.lines.every(line => line.price_id === '' && line.quantity === '1'))
  assert.equal(form.pricing.basis_date, '')
  await state.loadPrices()
  assert.equal(state.error.value, '')
})

test('真实审批快照组件显示标准额成交额与税基，历史无快照清楚标未知', async () => {
  const known = { basis_date: '2026-01-01', currency: 'CNY', tax_basis: 'INCLUSIVE', tax_rate_bps: 600, lines: [{ line_id: 'x', service_index: 0, quantity: '1', unit: '项', standard_minor: 10000, amount_minor: 8000, unit_price_minor: 10000, price_version: 2 }] }
  const { html } = await harness('PricingSnapshotSummary.vue', { pricing: known }).render()
  assert.match(html, /标准额 10000/); assert.match(html, /成交额 8000/); assert.match(html, /含税/)
  const unknown = await harness('PricingSnapshotSummary.vue', { pricing: null }).render()
  assert.match(unknown.html, /基准不完整/)
})

test('真实合同定价面板从Vue响应式详情恢复冻结明细并允许金额变更入口', async () => {
  const c = { id: 'c', status: 'active', version: 2, amount_minor: 8000, currency: 'CNY', service_items: [{ source_id: 'service', service_type: '软件测试' }], payment_terms: [{ installment_no: 1, due_date: '2026-12-01', amount: '80.00' }], pricing: { basis_date: '2026-01-01', frozen_at: '2026-01-01T00:00:00Z', lines: [{ line_id: 'x', service_id: 'service', service_index: 0, price_id: 'price', quantity: '1', unit: '项', amount_minor: 8000, standard_minor: 10000 }] } }
  const { state } = await harness('ContractPricingRevisionPanel.vue', { contractId: 'c', canEdit: true }, { getContract: async () => c, changeContractPricing: async () => ({}), paymentAmountMinor: () => 8000, ContractPricingFields: { render() { return null } } }).render()
  await state.load()
  assert.equal(state.error.value, '')
  assert.equal(state.form.value.pricing.lines[0].standard_minor, 10000)
  state.form.value.pricing.lines[0].standard_minor = 1
  assert.equal(state.record.value.pricing.lines[0].standard_minor, 10000)
})


test('折扣展示用整数计算八折与溢价，让利率不会与折扣率混用', () => {
  assert.deepEqual(pricingDiscountSummary({ lines: [{ amount_minor: 8000, standard_minor: 10000 }] }), { discount: '80.00', concession: '20.00', isEighty: true })
  assert.deepEqual(pricingDiscountSummary({ lines: [{ amount_minor: 11000, standard_minor: 10000 }] }), { discount: '110.00', concession: '-10.00', isEighty: false })
  assert.equal(pricingDiscountSummary(null), null)
  assert.equal(pricingDiscountSummary({ lines: [{ amount_minor: 0, standard_minor: 0 }] }), null)
})
