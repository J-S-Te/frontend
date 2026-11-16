import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { approvalKindLabel } from '../utils/contractDisplay.js'

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
// 已同步加入合同名称字段；有意变更须同步更新 golden。
const GOLDENS = {
  "with-todo": "<div class=\"contract-notification-panel\"><header><strong>通知中心</strong><span>6 项待办</span></header><!--[--><!--[--><button type=\"button\"><i class=\"warning\"></i><span><strong>合同审批已流转至部门审批</strong><small class=\"contract-notification-name\">合同名称：—</small><small>事件：流程流转 · 当前节点：部门审批 · 状态：处理中</small><small>点击查看并处理</small></span></button><button type=\"button\"><i class=\"warning\"></i><span><strong>合同审批已流转至财务审批</strong><small class=\"contract-notification-name\">合同名称：—</small><small>事件：流程流转 · 当前节点：财务审批 · 状态：待处理</small><small>点击查看并处理</small></span></button><button type=\"button\"><i class=\"warning\"></i><span><strong>合同审批已流转至N3</strong><small class=\"contract-notification-name\">合同名称：—</small><small>事件：流程流转 · 当前节点：N3 · 状态：处理中</small><small>点击查看并处理</small></span></button><button type=\"button\"><i class=\"warning\"></i><span><strong>合同审批已流转至N4</strong><small class=\"contract-notification-name\">合同名称：—</small><small>事件：流程流转 · 当前节点：N4 · 状态：处理中</small><small>点击查看并处理</small></span></button><button type=\"button\"><i class=\"warning\"></i><span><strong>合同审批已流转至N5</strong><small class=\"contract-notification-name\">合同名称：—</small><small>事件：流程流转 · 当前节点：N5 · 状态：处理中</small><small>点击查看并处理</small></span></button><!--]--><button type=\"button\"><i class=\"info\"></i><span><strong>查看全部待处理事件</strong><small>还有 1 项审批待办</small></span></button><!--]--><!--v-if--></div>",
  "no-permission": "<div class=\"contract-notification-panel\"><header><strong>通知中心</strong><span>6 项待办</span></header><p class=\"contract-notification-empty\">当前没有待处理流程事件。</p><!--v-if--></div>",
  "empty": "<div class=\"contract-notification-panel\"><header><strong>通知中心</strong><span>0 项待办</span></header><p class=\"contract-notification-empty\">当前没有待处理流程事件。</p><!--v-if--></div>"
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

test('审批接口中的合同名称经过页面归一化后显示，特殊字符按文本转义', async () => {
  const view = readFileSync(new URL('../views/ContractManagementView.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(view)
  const script = compileScript(descriptor, { id: 'contract-notification-name' })
  const node = script.scriptSetupAst.find((item) => item.type === 'FunctionDeclaration' && item.id.name === 'normalizeApproval')
  const normalize = new Function('approvalKindLabel', 'displayNameFor', 'formatDate',
    `${descriptor.scriptSetup.content.slice(node.start, node.end)}; return normalizeApproval`
  )(approvalKindLabel, () => '', () => '')
  const approval = normalize({
    approval_id: 'approval-a', contract_id: 'contract-a',
    contract_title: '安全评估 <服务> & 合同', kind: 'contract_approval',
    node_name: '部门审批', status: 'active',
  })
  const html = await renderToString(Vue.createSSRApp({
    render: () => Vue.h(component, { approvals: [approval], canProcess: true, showInbox: false }),
  }))
  assert.match(html, /合同名称：安全评估 &lt;服务&gt; &amp; 合同/)
  assert.doesNotMatch(html, /<服务>/)
  assert.match(html, /当前节点：部门审批/)
})

test('旧待办缺少合同名称时明确显示空值', async () => {
  const html = await renderToString(Vue.createSSRApp({
    render: () => Vue.h(component, props('with-todo')),
  }))
  assert.match(html, /合同名称：—/)
  assert.doesNotMatch(html, /undefined|null/)
})

function props(key) {
  // golden 只锁定审批待办段；站内通知段由独立用例覆盖，避免把平台收件箱渲染混入旧快照。
  return { approvals: CASES[key].approvals, canProcess: CASES[key].canProcess, showInbox: false }
}

test('通知面板显示合同名称空值并保留待办顺序与查看全部入口', async () => {
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

test('通知面板默认挂载站内通知并保留待办事件', () => {
  const panelSource = readFileSync(new URL('./ContractNotificationPanel.vue', import.meta.url), 'utf8')
  assert.match(panelSource, /PlatformNotificationInbox/)
  assert.match(panelSource, /app-code="contract_management"/)
  assert.match(panelSource, /showInbox/)
})
test('通知面板以事件转发打开待办与查看全部', () => {
  const panelSource = readFileSync(new URL('./ContractNotificationPanel.vue', import.meta.url), 'utf8')
  assert.ok(panelSource.includes("$emit('open-approval', approval)"))
  assert.ok(panelSource.includes("$emit('view-all')"))
})
