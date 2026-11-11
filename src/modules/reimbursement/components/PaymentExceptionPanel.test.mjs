import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { formatMinor } from '../api/client.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import { PaginationBarStub } from '../../../test/helpers/paginationStub.mjs'

// 用途：替身只记录选择器收到的接口与用途，验证凭证与证据不再手抄文件ID。
// 参数：无。
// 返回值：渲染为可断言文本的Vue组件。
const pickerStub = {
  props: ['modelValue', 'path', 'purpose', 'valueKey', 'objectLabel', 'multiple', 'disabled', 'ariaLabel'],
  setup: (props) => () => Vue.h('div', { class: 'picker-stub' },
    `${props.path} | ${props.purpose || ''} | ${Array.isArray(props.modelValue) ? props.modelValue.join(',') : props.modelValue || ''}`),
}

// 用途：编译真实异常事实业务组件供SSR验证。
// 参数：name为当前目录的真实组件文件名。
// 返回值：保留真实字段、权限条件和转义规则的组件。
function component(name = './PaymentExceptionPanel.vue') {
  const { descriptor } = parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'payment-exception-test', inlineTemplate: true })
  const bindings = { formatMinor, formatBusinessDateTime, PaginationBar: PaginationBarStub,
    BusinessOptionPicker: pickerStub, reimbursementAPI: { request: async () => ({ source_accounts: [], payee_profiles: [], items: [], payments: [], reversals: [] }) } }
  const source = compiled.content
    .replace(/^import\s+\w+\s+from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,

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
  // 凭证与核实证据走既有文件选项接口，不再让财务手抄文件ID。
  assert.match(authorized, /\/invoice-document-options \| reimbursement\.payment\.voucher/)
  assert.doesNotMatch(authorized, /已上传凭证ID|已上传核实证据ID/)
  // 外部异常账户允许目录外事实，但手工入口必须带明显警示。
  props.canRecord = true
  const recording = await renderToString(Vue.createSSRApp(panel, props))
  assert.match(recording, /选择实际付款账户/)
  assert.match(recording, /高级：外部实际账户不在受控目录时手工填写/)
  assert.match(recording, /只有确知外部真实账户引用时才手工填写/)
  assert.doesNotMatch(recording, /实际付款账户引用<input/)
  assert.match(authorized, /此处不会改变报销状态、正常付款记录或项目支出净额/)
})
