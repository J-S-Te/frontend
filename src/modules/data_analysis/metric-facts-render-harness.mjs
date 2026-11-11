import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { formatFactMoney, formatFactRate } from './utils/metricFacts.js'
import { formatBusinessDateTime } from '../shared/utils/businessTime.js'

const source = await readFile(new URL('./components/MetricFactsDisplay.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'metric-facts-display' })
const component = new Function('Vue', 'formatFactMoney', 'formatFactRate', 'formatBusinessDateTime',
  `const { computed, ref } = Vue; ${script.content.replace(/^import.*$/gm, '').replace('export default', 'return')}`,
)(Vue, formatFactMoney, formatFactRate, formatBusinessDateTime)
const template = compileTemplate({ source: descriptor.template.content, filename: 'MetricFactsDisplay.vue',
  id: 'metric-facts-display', compilerOptions: { bindingMetadata: script.bindings } })
assert.deepEqual(template.errors, [])
component.render = new Function('Vue', template.code
  .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
  .replace('export function render', 'return function render'))(Vue)

// renderMetricFacts 执行真实新增事实SFC，供原生看板接入回归共同验证。
// 参数：props为分区和已授权统计响应，不触发网络或会话生命周期。
// 返回值：Promise解析为真实模板HTML，编译或渲染错误向调用方传播。
export async function renderMetricFacts(props) {
  return renderToString(Vue.createSSRApp(component, props))
}
