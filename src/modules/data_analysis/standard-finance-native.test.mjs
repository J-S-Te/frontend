import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { dashboardFreshnessItems, dashboardFreshnessStatus } from './utils/freshness.js'
import * as dashboardCardVisibility from './utils/dashboardCardVisibility.js'

const source = await readFile(new URL('./views/NativeDashboardView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'standard-finance-native' })
// 指标卡显示设置给视图引入了额外的响应式 API 与本地偏好工具：这里按真实依赖注入，
// 只替换浏览器生命周期（SSR 不挂载）与图标组件，业务脚本仍然原样执行。
const component = new Function(
  'Vue',
  'ConsoleIcon',
  'dashboardFreshnessItems',
  'dashboardFreshnessStatus',
  'dashboardCardVisibility',
  `const PaginationBar = { render: () => null }
   const { computed, ref, watch, nextTick } = Vue
   const onMounted = () => {}
   const onBeforeUnmount = () => {}
   const { PROJECT_CARD_KEYS, cardHiddenStorageKey, metricColumnCount, normalizeHiddenCardKeys, readHiddenCardKeys, reportStageCount, visibleDashboardCards, writeHiddenCardKeys } = dashboardCardVisibility
   ${script.content.replace(/^import[\s\S]*?from\s+["'][^"']+["']\s*$/gm, '').replace('export default', 'return')}`,
)(Vue, { render: () => null }, dashboardFreshnessItems, dashboardFreshnessStatus, dashboardCardVisibility)
const template = compileTemplate({ source: descriptor.template.content, filename: 'NativeDashboardView.vue', id: 'standard-finance-native', compilerOptions: { bindingMetadata: script.bindings } })
assert.deepEqual(template.errors, [])
component.render = new Function('Vue', template.code.replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`).replace('export function render', 'return function render'))(Vue)

test('未发布标准源展示真实原因，已发布零值明确可用，非零指标按币种呈现', async () => {
  const unpublished = await renderToString(Vue.createSSRApp(component, { section: 'finance', businessSummary: { available: false, metrics: {}, basis: '标准经营事实尚未发布，请由管理员预览并发布。' } }))
  assert.match(unpublished, /标准经营事实尚未发布/)
  assert.doesNotMatch(unpublished, /当前租户尚无应收或回款记录/)
  const zero = await renderToString(Vue.createSSRApp(component, { section: 'finance', businessSummary: { available: true, metrics: { currencies: [] }, basis: '标准经营事实截至2026-11-04已发布' } }))
  assert.match(zero, /当前来源快照可用，当前租户尚无应收或回款记录/)
  assert.doesNotMatch(zero, /尚无可用来源快照/)
  const facts = await renderToString(Vue.createSSRApp(component, { section: 'finance', businessSummary: { available: true, metrics: { month: '2026-10', currencies: [{ currency: 'USD', original_minor: 2000000, allocated_minor: 500000, open_minor: 1500000, over_90_minor: 0, month_receipts_minor: 500000, collection_rate: 25 }] }, basis: '来源 standard-finance，批次 batch-001，截至日2026-11-04' } }))
  assert.match(facts, /USD 2026-10登记回款/)
  assert.match(facts, /USD 原始应收 2 万USD，已核销回款 0.5 万USD，未清 1.5 万USD/)
  assert.match(facts, /来源 standard-finance，批次 batch-001，截至日2026-11-04/)
})
