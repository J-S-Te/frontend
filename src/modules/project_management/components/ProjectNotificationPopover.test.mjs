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

// golden 为提取前 ProjectManagementView.vue 通知弹层片段的 SSR 渲染结果（批次 3 第三步b 采集），
// 提取后本组件必须逐字节复现同一 DOM；有意变更须同步重采 golden。
const GOLDENS = {
  "loaded-items": "<div id=\"project-notifications\" class=\"pm-notifications\" role=\"status\" aria-live=\"polite\"><div class=\"pm-popover-head\"><b>业务待办</b><span>2 条</span></div><!--v-if--><!--[--><button disabled><i class=\"danger\"></i><span><b>NOTIF alpha</b><small>content alpha</small></span></button><button><i class=\"warning\"></i><span><b>NOTIF beta</b><small>content beta</small></span></button><!--]--><!--v-if--><button type=\"button\">查看全部通知</button></div>",
  "loading": "<div id=\"project-notifications\" class=\"pm-notifications\" role=\"status\" aria-live=\"polite\"><div class=\"pm-popover-head\"><b>业务待办</b><span>0 条</span></div><p class=\"pm-notification-state\">正在加载未读通知…</p><!--[--><!--]--><!--v-if--><button type=\"button\">查看全部通知</button></div>",
  "error-state": "<div id=\"project-notifications\" class=\"pm-notifications\" role=\"status\" aria-live=\"polite\"><div class=\"pm-popover-head\"><b>业务待办</b><span>0 条</span></div><p class=\"pm-notification-state danger\">ERR unreadable</p><!--[--><!--]--><!--v-if--><button type=\"button\">查看全部通知</button></div>",
  "empty-no-viewall": "<div id=\"project-notifications\" class=\"pm-notifications\" role=\"status\" aria-live=\"polite\"><div class=\"pm-popover-head\"><b>业务待办</b><span>0 条</span></div><!--v-if--><!--[--><!--]--><div class=\"pm-empty-mini\" role=\"status\">暂无未读通知</div><!--v-if--></div>"
}
const CASES = {
  "loaded-items": {
    "count": 2,
    "loading": false,
    "error": "",
    "items": [
      {
        "delivery_id": "d1",
        "category": "DEVIATION_REPORTED",
        "title": "NOTIF alpha",
        "content": "content alpha"
      },
      {
        "delivery_id": "d2",
        "category": "SPLIT_RULE_MISSING",
        "title": "NOTIF beta",
        "content": "content beta"
      }
    ],
    "actionId": "d1",
    "showViewAll": true
  },
  "loading": {
    "count": 0,
    "loading": true,
    "error": "",
    "items": [],
    "actionId": "",
    "showViewAll": true
  },
  "error-state": {
    "count": 0,
    "loading": false,
    "error": "ERR unreadable",
    "items": [],
    "actionId": "",
    "showViewAll": true
  },
  "empty-no-viewall": {
    "count": 0,
    "loading": false,
    "error": "",
    "items": [],
    "actionId": "",
    "showViewAll": false
  }
}

const component = await loadSfc(new URL('./ProjectNotificationPopover.vue', import.meta.url).pathname)

test('通知弹层复现提取前 golden：已装载的未读列表与操作中条目禁用', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES['loaded-items']) }))
  assert.equal(html, GOLDENS['loaded-items'])
})

test('通知弹层复现提取前 golden：加载中状态', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES['loading']) }))
  assert.equal(html, GOLDENS['loading'])
})

test('通知弹层复现提取前 golden：读取失败状态', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES['error-state']) }))
  assert.equal(html, GOLDENS['error-state'])
})

test('通知弹层复现提取前 golden：空列表且分区不可见时无查看全部入口', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES['empty-no-viewall']) }))
  assert.equal(html, GOLDENS['empty-no-viewall'])
})

test('通知弹层以事件转发条目点击与查看全部', () => {
  const popoverSource = readFileSync(new URL('./ProjectNotificationPopover.vue', import.meta.url), 'utf8')
  assert.ok(popoverSource.includes("$emit('open-item', item)"))
  assert.ok(popoverSource.includes("$emit('view-all')"))
})
