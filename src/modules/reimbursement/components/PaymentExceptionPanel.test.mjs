import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { formatMinor } from '../api/client.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'

// 用途：编译真实异常事实业务组件供SSR验证。
// 参数：name为当前目录的真实组件文件名。
// 返回值：保留真实字段、权限条件和转义规则的组件。
function component(name = './PaymentExceptionPanel.vue') {
  const { descriptor } = parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'payment-exception-test', inlineTemplate: true })
  const bindings = { formatMinor, formatBusinessDateTime,
    reimbursementAPI: { request: async () => ({ items: [], payments: [], reversals: [] }) } }
  const source = compiled.content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, specifier) => {
      if (specifier === 'vue') for (const entry of names.split(',')) {
        const [name, alias = name] = entry.trim().split(/\s+as\s+/)
        bindings[alias] = Vue[name]
      }
      else for (const entry of names.split(',')) {
        const [name, alias = name] = entry.trim().split(/\s+as\s+/)
        bindings[alias] = bindings[name]
      }
      return ''
    }).replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, name, source) => {
      bindings[name] = component(source)
      return ''
    })
  return new Function(...Object.keys(bindings), source.replace('export default', 'return'))(...Object.values(bindings))
}

test('异常原事实只读显示，不获服务端核实动作时没有核实按钮，文本正确转义', async () => {
  const props = { claim: { id: 'claim' }, form: {}, reviewForm: {}, canRecord: false, canReview: true,
    selected: { id: 'exception', amount_minor: '1234', currency: 'CNY', observed_claim_version: 8,
      claim_version: 12, version: 3, status: 'PENDING', reason: '<script>bad</script>', allowed_actions: [],
      reviews: [{ id: 'review', decision: 'CONFIRM_CONFLICT', previous_version: 2, version: 3, reason: '核对回单' }] } }
  const panel = component()
  const html = await renderToString(Vue.createSSRApp(panel, props))
  assert.match(html, /12\.34 CNY/)
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>|追加独立核实记录|仅记录异常事实/)
  assert.match(html, /核对回单/)
  props.selected.allowed_actions = ['REVIEW_EXCEPTION']
  const authorized = await renderToString(Vue.createSSRApp(panel, props))
  assert.match(authorized, /追加独立核实记录/)
  assert.match(authorized, /此处不会改变报销状态、正常付款记录或项目支出净额/)
})
