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

// golden 为提取前 ContractManagementView.vue 通知面板片段的 SSR 渲染结果
// （批次 3 合同页第三步采集，绑定真实 approvalNotificationTitle/approvalStatusLabel）；
// 提取后本组件必须逐字节复现同一 DOM；有意变更须同步重采 golden。
const GOLDENS = {
  "with-todo": "<div class=\"contract-notification-panel\"><header><strong>通知中心</strong><span>6 项待办</span></header><!--[--><!--[--><button type=\"button\"><i class=\"warning\"></i><span><strong>合同审批已流转至部门审批</strong><small>事件：流程流转 · 当前节点：部门审批 · 状态：处理中</small><small>点击查看并处理</small></span></button><button type=\"button\"><i class=\"warning\"></i><span><strong>合同审批已流转至财务审批</strong><small>事件：流程流转 · 当前节点：财务审批 · 状态：待处理</small><small>点击查看并处理</small></span></button><button type=\"button\"><i class=\"warning\"></i><span><strong>合同审批已流转至N3</strong><small>事件：流程流转 · 当前节点：N3 · 状态：处理中</small><small>点击查看并处理</small></span></button><button type=\"button\"><i class=\"warning\"></i><span><strong>合同审批已流转至N4</strong><small>事件：流程流转 · 当前节点：N4 · 状态：处理中</small><small>点击查看并处理</small></span></button><button type=\"button\"><i class=\"warning\"></i><span><strong>合同审批已流转至N5</strong><small>事件：流程流转 · 当前节点：N5 · 状态：处理中</small><small>点击查看并处理</small></span></button><!--]--><button type=\"button\"><i class=\"info\"></i><span><strong>查看全部待处理事件</strong><small>还有 1 项审批待办</small></span></button><!--]--></div>",
  "no-permission": "<div class=\"contract-notification-panel\"><header><strong>通知中心</strong><span>6 项待办</span></header><p class=\"contract-notification-empty\">当前没有待处理流程事件。</p></div>",
  "empty": "<div class=\"contract-notification-panel\"><header><strong>通知中心</strong><span>0 项待办</span></header><p class=\"contract-notification-empty\">当前没有待处理流程事件。</p></div>"
}
const CASES = {
  "with-todo": {
    "approvals": [
      {
        "id": "a1",
        "type": "合同审批",
        "step": "部门审批",
        "status": "active"
      },
      {
        "id": "a2",
        "type": "合同审批",
        "step": "财务审批",
        "status": "pending"
      },
      {
        "id": "a3",
        "type": "合同审批",
        "step": "N3",
        "status": "active"
      },
      {
        "id": "a4",
        "type": "合同审批",
        "step": "N4",
        "status": "active"
      },
      {
        "id": "a5",
        "type": "合同审批",
        "step": "N5",
        "status": "active"
      },
      {
        "id": "a6",
        "type": "合同审批",
        "step": "N6",
        "status": "active"
      }
    ],
    "canProcess": true
  },
  "no-permission": {
    "approvals": [
      {
        "id": "a1",
        "type": "合同审批",
        "step": "部门审批",
        "status": "active"
      },
      {
        "id": "a2",
        "type": "合同审批",
        "step": "财务审批",
        "status": "pending"
      },
      {
        "id": "a3",
        "type": "合同审批",
        "step": "N3",
        "status": "active"
      },
      {
        "id": "a4",
        "type": "合同审批",
        "step": "N4",
        "status": "active"
      },
      {
        "id": "a5",
        "type": "合同审批",
        "step": "N5",
        "status": "active"
      },
      {
        "id": "a6",
        "type": "合同审批",
        "step": "N6",
        "status": "active"
      }
    ],
    "canProcess": false
  },
  "empty": {
    "approvals": [],
    "canProcess": true
  }
}

const component = await loadSfc(new URL('./ContractNotificationPanel.vue', import.meta.url).pathname)

function props(key) {
  return { approvals: CASES[key].approvals, canProcess: CASES[key].canProcess }
}

test('通知面板复现提取前 golden：有待办且具处理权限', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, props('with-todo')) }))
  assert.equal(html, GOLDENS['with-todo'])
})

test('通知面板复现提取前 golden：无处理权限时隐藏待办列表', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, props('no-permission')) }))
  assert.equal(html, GOLDENS['no-permission'])
})

test('通知面板复现提取前 golden：无待办', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, props('empty')) }))
  assert.equal(html, GOLDENS['empty'])
})

test('通知面板以事件转发打开待办与查看全部', () => {
  const panelSource = readFileSync(new URL('./ContractNotificationPanel.vue', import.meta.url), 'utf8')
  assert.ok(panelSource.includes("$emit('open-approval', approval)"))
  assert.ok(panelSource.includes("$emit('view-all')"))
})
