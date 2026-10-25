import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

const SRC = new URL('../../../', import.meta.url).pathname

async function resolveDependency(fromFile, specifier) {
  if (specifier === 'vue') return Vue
  const base = specifier.startsWith('.') ? resolve(dirname(fromFile), specifier) : join(SRC, specifier.slice(2))
  if (specifier.endsWith('.vue')) return loadSfc(base)
  for (const candidate of [base, `${base}.js`, join(base, 'index.js')]) {
    try {
      return await import(pathToFileURL(candidate).href)
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(`cannot resolve ${specifier}`)
}

async function loadSfc(file) {
  const { descriptor } = parse(readFileSync(file, 'utf8'))
  const script = compileScript(descriptor, { id: file })
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: file,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(compiled.errors, [], file)
  const imports = {}
  for (const node of script.scriptSetupAst.filter((item) => item.type === 'ImportDeclaration')) {
    const dependency = await resolveDependency(file, node.source.value)
    for (const spec of node.specifiers) {
      imports[spec.local.name] = spec.type === 'ImportDefaultSpecifier' ? (dependency.default ?? dependency) : dependency[spec.imported.name]
    }
  }
  const component = new Function(...Object.keys(imports), script.content
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  return component
}

// golden 为提取前 SettlementView.vue 红冲申请弹窗片段的 SSR 渲染结果
// （批次 3 结算第三步采集）；提取后本组件必须逐字节复现同一 DOM。
const GOLDENS = {
  "default": "<article class=\"settlement-panel settlement-operation-card\"><div class=\"settlement-panel-head\"><div><h2>发起红冲申请</h2><p>申请先由财务复核，通过后才提交税控，最终结果以税控回执为准。</p></div><button class=\"console-text-button\"> 取消 </button></div><form class=\"settlement-operation-form\"><label><span>红冲原因类型</span><select required><option value=\"INVOICE_ERROR\">开票信息错误</option><option value=\"CONTRACT_CHANGE\">合同变更</option><option value=\"RETURN_OR_DISCOUNT\">退货或折让</option><option value=\"OTHER\">其他</option></select></label><label class=\"wide\"><span>具体原因</span><textarea rows=\"3\" maxlength=\"500\" required></textarea></label><div class=\"settlement-operation-actions wide\"><button type=\"button\" class=\"console-button secondary\"> 取消 </button><button class=\"console-button danger\"> 提交红冲申请 </button></div></form></article>",
  "filled": "<article class=\"settlement-panel settlement-operation-card\"><div class=\"settlement-panel-head\"><div><h2>发起红冲申请</h2><p>申请先由财务复核，通过后才提交税控，最终结果以税控回执为准。</p></div><button class=\"console-text-button\"> 取消 </button></div><form class=\"settlement-operation-form\"><label><span>红冲原因类型</span><select required><option value=\"INVOICE_ERROR\">开票信息错误</option><option value=\"CONTRACT_CHANGE\">合同变更</option><option value=\"RETURN_OR_DISCOUNT\">退货或折让</option><option value=\"OTHER\">其他</option></select></label><label class=\"wide\"><span>具体原因</span><textarea rows=\"3\" maxlength=\"500\" required>合同主体变更后重新开票</textarea></label><div class=\"settlement-operation-actions wide\"><button type=\"button\" class=\"console-button secondary\"> 取消 </button><button class=\"console-button danger\"> 提交红冲申请 </button></div></form></article>",
  "saving": "<article class=\"settlement-panel settlement-operation-card\"><div class=\"settlement-panel-head\"><div><h2>发起红冲申请</h2><p>申请先由财务复核，通过后才提交税控，最终结果以税控回执为准。</p></div><button class=\"console-text-button\"> 取消 </button></div><form class=\"settlement-operation-form\"><label><span>红冲原因类型</span><select required><option value=\"INVOICE_ERROR\">开票信息错误</option><option value=\"CONTRACT_CHANGE\">合同变更</option><option value=\"RETURN_OR_DISCOUNT\">退货或折让</option><option value=\"OTHER\">其他</option></select></label><label class=\"wide\"><span>具体原因</span><textarea rows=\"3\" maxlength=\"500\" required>x</textarea></label><div class=\"settlement-operation-actions wide\"><button type=\"button\" class=\"console-button secondary\"> 取消 </button><button class=\"console-button danger\" disabled> 提交红冲申请 </button></div></form></article>"
}
const CASES = {
  "default": {
    "form": {
      "reason_code": "INVOICE_ERROR",
      "reason_detail": ""
    },
    "saving": false
  },
  "filled": {
    "form": {
      "reason_code": "CONTRACT_CHANGE",
      "reason_detail": "合同主体变更后重新开票"
    },
    "saving": false
  },
  "saving": {
    "form": {
      "reason_code": "OTHER",
      "reason_detail": "x"
    },
    "saving": true
  }
}

const component = await loadSfc(new URL('./RedFlushDialog.vue', import.meta.url).pathname)

test('红冲弹窗复现提取前 golden：默认表单', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES.default) }))
  assert.equal(html, GOLDENS.default)
})

test('红冲弹窗复现提取前 golden：已填写原因', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES.filled) }))
  assert.equal(html, GOLDENS.filled)
})

test('红冲弹窗复现提取前 golden：保存中禁用提交', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES.saving) }))
  assert.equal(html, GOLDENS.saving)
})

test('红冲弹窗以 cancel/submit 事件与父组件交互', () => {
  const source = readFileSync(new URL('./RedFlushDialog.vue', import.meta.url), 'utf8')
  const cancels = source.split("$emit('cancel')").length - 1
  assert.equal(cancels, 2, '取消按钮（头部与表单底部）各自发出 cancel')
  assert.ok(source.includes("$emit('submit')"), '表单提交发出 submit')
})
