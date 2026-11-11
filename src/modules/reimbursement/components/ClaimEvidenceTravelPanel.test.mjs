import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { approvalNodeLabel } from '../rolePresentation.js'
import { renderToString } from '@vue/server-renderer'

// 用途：编译真实尾款与差旅业务面板供SSR检查。
// 参数：name 为真实组件文件名；request 为受控目录读取替身。
// 返回值：保留真实条件、证据按钮和只读状态的Vue组件。
function component(name = './ClaimEvidenceTravelPanel.vue', request = async () => ({ items: [] })) {
  const { descriptor } = parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'claim-tail-travel', inlineTemplate: true })
  const bindings = { approvalNodeLabel, reimbursementAPI: { request } }
  const body = compiled.content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, specifier) => {
    if (specifier !== 'vue') return ''
    for (const entry of names.split(',')) {
      const [name, alias = name] = entry.trim().split(/\s+as\s+/)
      bindings[alias] = Vue[name]
    }
    return ''
  }).replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
    (_, key, file) => { bindings[key] = component(file, request); return '' })
  return new Function(...Object.keys(bindings), body.replace('export default', 'return'))(...Object.values(bindings))
}

// 用途：挂载真实面板与附件选择器，使用原生事件验证父子接线。
// 参数：props 为费用项、名称及权限；request 为唯一网络替身。
// 返回值：宿主树、响应式父输入、事件记录与卸载方法，不冒充浏览器验收。
function mount(props, request) {
  const root = { children: [] }
  const events = []
  const state = Vue.reactive({ ...props })
  const view = component('./ClaimEvidenceTravelPanel.vue', request)
  const renderer = Vue.createRenderer({
    createElement: (tag) => ({ tag, tagName: tag.toUpperCase(), props: {}, children: [],
      options: [], addEventListener: () => {}, removeEventListener: () => {} }),
    createText: (text) => ({ text }), createComment: () => ({}),
    insert: (node, parent, anchor) => {
      if (node.parent) {
        const index = node.parent.children.indexOf(node)
        if (index >= 0) node.parent.children.splice(index, 1)
      }
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    },
    remove: (node) => {
      const siblings = node.parent?.children || []
      const index = siblings.indexOf(node)
      if (index >= 0) siblings.splice(index, 1)
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1],
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text },
    patchProp: (node, key, _old, value) => { node.props[key] = value },
  })
  const app = renderer.createApp({ setup: () => () => Vue.h(view, { ...state,
    onUpload: (event, kind) => events.push(['upload', event, kind]),
    onDownload: (file) => events.push(['download', file]),
  }) })
  app.mount(root)
  return { root, state, events, unmount: () => app.unmount() }
}

// 用途：查找真实组件宿主树中的原生事件目标。
// 参数：node 为宿主节点；tag 为目标元素类型。
// 返回值：全部匹配元素。
function elements(node, tag) {
  return [...(node.tag === tag ? [node] : []),
    ...(node.children || []).flatMap((child) => elements(child, tag))]
}

// 用途：提取当前实际渲染文案以检查附件名称和编号边界。
// 参数：node 为宿主树节点。
// 返回值：当前节点及后代可见文字。
function text(node) {
  return `${node.text || ''}${(node.children || []).map(text).join('')}`
}

// 用途：等待附件目录读取和父子响应式更新完成。
// 参数：无。
// 返回值：异步完成信号。
async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
  await Vue.nextTick()
}

test('人工补证后UNKNOWN仍显示未知，无差旅要求不强迫确认，终止引用不称已放行', async () => {
  const html = await renderToString(Vue.createSSRApp(component(), { itemNumber: 1, disabled: true, canDownload: true,
    item: { id: 'item', requires_travel_facts: false, historical_tail_evidence_text: 'tail-file',
      travel_assessment: { status: 'UNKNOWN', confirmed_unknown: true },
      travel_confirmation: { decision: '', reason: '', evidence_text: '' }, historical_tail_applications: [
        { project_id: 'project', policy: { id: 'policy', version: 3, expense_cutoff: '2026-10-31', valid_from: '2026-11-01', valid_until: '2026-11-30' } },
      ] },
    references: [{ project_id: 'project', eligible: false, participant_eligible: true, project_status: '已终止',
      travel_snapshot: { status: 'UNKNOWN', mode: 'NO_TRAVEL', actor_in_travelers: null, reason_codes: ['NOT_TRAVEL_APPROVAL'] } }] }))
  assert.match(html, /当前标准不要求差旅事实，不必填写人工确认/)
  assert.match(html, /事实未知/)
  assert.match(html, /状态仍为UNKNOWN/)
  assert.match(html, /历史尾款须有效政策、证据及额外审批/)
  assert.match(html, /实施准备、行程安排均不是出差审批/)
  assert.match(html, /policy · v3/)
  assert.match(html, /:disabled|disabled/)
  assert.match(html, /查看尾款证据/)
  assert.doesNotMatch(html, /tail-file|尾款证据文件ID|差旅证据文件ID/)
  assert.doesNotMatch(html, /<select[^>]* required/)
})

test('审批岗位来源逐项展示项目权威node_role，不用本地映射或旧teamlead代替', async () => {
  const html = await renderToString(Vue.createSSRApp(component(), {
    item: { id: 'item', travel_confirmation: { decision: '', reason: '', evidence_text: '' } },
    references: [{ project_id: 'project', eligible: true, required_approver_refs: [
      { node_role: 'PROJECT_EXPENSE_OWNER', subject_id: 'manager', source_field: 'project_manager_id', source_version: '9' },
      { node_role: 'TECHNICAL_DIRECTOR', subject_id: 'technical', source_field: 'technical_director', source_digest: 'digest-technical', source_org_id: 'org' },
      { node_role: 'SALES_DIRECTOR', subject_id: 'sales', source_field: 'sales_director', source_digest: 'digest-sales', source_org_id: 'org' },
    ] }],
  }))
  assert.match(html, /项目经理（费用负责人）/)
  assert.match(html, /项目技术总监（技术负责人）/)
  assert.match(html, /项目销售总监（销售负责人）/)
  assert.match(html, /project_manager_id/)
  assert.match(html, /来源版本 9/)
  assert.match(html, /目录摘要 digest-technical/)
  assert.match(html, /授权组织 org/)
  assert.doesNotMatch(html, /team_lead_id|owner_identity_id/)
})


test('行程交叉核验展示每个可见分摊及人工票面来源，未知结论不称自动通过', async () => {
  const html = await renderToString(Vue.createSSRApp(component(), {
    item: { id: 'item', travel_confirmation: { decision: '', reason: '', evidence_text: '' },
      travel_assessment: { status: 'UNKNOWN', references: [{ project_id: 'project', service_item_id: 'service',
        cross_check_status: 'UNKNOWN', cross_check: { status: 'UNKNOWN', project_status: 'MATCH',
          reason_codes: ['INVOICE_FACTS_MISSING'], invoices: [
            { invoice_id: 'invoice', source_kind: 'MANUAL_FACE_CONFIRMATION', status: 'UNKNOWN', reason_codes: ['FACTS_MISSING'] },
          ] } }] } },
  }))
  assert.match(html, /申报与票据行程交叉核验/)
  assert.match(html, /project \/ service/)
  assert.match(html, /INVOICE_FACTS_MISSING/)
  assert.match(html, /invoice/)
  assert.match(html, /人工票面复核/)
  assert.match(html, /不代表自动识别或税务验真/)
})

test('尾款和差旅按名称选择更新各自原字段，上传事件原样携带既有用途', async () => {
  const calls = []
  const fixture = mount({ canDownload: true, names: { 'old-tail-file': '终止前服务证明.pdf' },
    item: { id: 'item', historical_tail_evidence_text: 'old-tail-file',
      travel_confirmation: { decision: '', reason: '', evidence_text: '' } } }, async (path) => {
    calls.push(path)
    return { items: [{ id: 'tail-doc', file_id: 'tail-new-file', name: '尾款说明.pdf' },
      { id: 'travel-doc', file_id: 'travel-new-file', name: '行程证明.pdf' }] }
  })
  try {
    await flush()
    assert.equal(calls.length, 2)
    for (const path of calls) {
      const url = new URL(path, 'https://example.test')
      assert.equal(url.pathname, '/invoice-document-options')
      assert.equal(url.searchParams.get('purpose'), 'reimbursement.claim.evidence')
    }
    const selectors = elements(fixture.root, 'select').filter((node) => node.props.onChange)
    selectors[0].props.onChange({ target: { value: 'tail-doc' } })
    selectors[1].props.onChange({ target: { value: 'travel-doc' } })
    await flush()
    assert.equal(fixture.state.item.historical_tail_evidence_text, 'old-tail-file,tail-new-file')
    assert.equal(fixture.state.item.travel_confirmation.evidence_text, 'travel-new-file')
    assert.match(text(fixture.root), /终止前服务证明.pdf/)
    assert.doesNotMatch(text(fixture.root), /old-tail-file|tail-new-file|travel-new-file/)
    const files = elements(fixture.root, 'input').filter((node) => node.props.type === 'file')
    const tailEvent = { target: { files: [{ name: '尾款.pdf' }] } }
    const travelEvent = { target: { files: [{ name: '差旅.pdf' }] } }
    files[0].props.onChange(tailEvent)
    files[1].props.onChange(travelEvent)
    assert.deepEqual(fixture.events, [
      ['upload', tailEvent, 'claimTail'], ['upload', travelEvent, 'claimTravel'],
    ])
    elements(fixture.root, 'button').find((node) => text(node).includes('查看尾款证据')).props.onClick()
    assert.deepEqual(fixture.events.at(-1), ['download', 'old-tail-file'])
  } finally { fixture.unmount() }
})

test('禁用面板保留历史关联并阻断上传和增删，缺名称不显示技术文件编号', async () => {
  const calls = []
  const fixture = mount({ disabled: true,
    item: { id: 'item', historical_tail_evidence_text: 'hidden-tail-file',
      travel_confirmation: { decision: '', reason: '', evidence_text: 'hidden-travel-file' } } },
  async (path) => { calls.push(path); return { items: [] } })
  try {
    await flush()
    assert.deepEqual(calls, [])
    assert.match(text(fixture.root), /名称待核对/)
    assert.doesNotMatch(text(fixture.root), /hidden-tail-file|hidden-travel-file|证据文件ID/)
    for (const file of elements(fixture.root, 'input').filter((node) => node.props.type === 'file')) {
      assert.equal(file.props.disabled, true)
      file.props.onChange({ target: { files: [{ name: '不应上传.pdf' }] } })
    }
    for (const remove of elements(fixture.root, 'button').filter((node) => text(node) === '移除')) {
      remove.props.onClick()
    }
    assert.deepEqual(fixture.events, [])
    assert.equal(fixture.state.item.historical_tail_evidence_text, 'hidden-tail-file')
    assert.equal(fixture.state.item.travel_confirmation.evidence_text, 'hidden-travel-file')
  } finally { fixture.unmount() }
})
