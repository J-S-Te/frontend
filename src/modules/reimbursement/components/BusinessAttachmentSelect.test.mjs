import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { createRequestID } from '../api/client.js'
import { contentMappingInput } from '../invoiceClassification.js'

// 用途：编译真实附件、通用选择器及规则组件，仅替换网络边界。
// 参数：name 为当前组件文件名；request 为受控只读网络替身。
// 返回值：保留真实模板和原生事件绑定的 Vue 组件。
function component(name, request) {
  const { descriptor } = parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: name, inlineTemplate: true })
  const bindings = { reimbursementAPI: { request }, createRequestID }
  const source = compiled.content.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, specifier) => {
      for (const entry of names.split(',')) {
        const [key, alias = key] = entry.trim().split(/\s+as\s+/)
        bindings[alias] = specifier === 'vue' ? Vue[key] : bindings[key]
      }
      return ''
    },
  ).replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
    (_, key, file) => { bindings[key] = component(file, request); return '' })
  return new Function(...Object.keys(bindings), source.replace('export default', 'return'))(
    ...Object.values(bindings),
  )
}

// 用途：挂载真实组件并模拟父表单响应更新，保留完整子组件事件链。
// 参数：props 为父输入；request 为接口替身；name 为待测组件名。
// 返回值：宿主树、可变输入、事件记录和卸载方法，不冒充浏览器验收。
function mount(props, request = async () => ({ items: [] }), name = './BusinessAttachmentSelect.vue') {
  const root = { children: [] }
  const events = []
  const state = Vue.reactive({ ...props })
  const view = component(name, request)
  const renderer = Vue.createRenderer({
    createElement: (tag) => ({ tag, props: {}, children: [] }),
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
    'onUpdate:modelValue': (value) => { events.push(['files', value]); state.modelValue = value },
    'onUpdate:value': (value) => { events.push(['rules', value]); state.value = value },
    onUpload: (event) => events.push(['upload', event]),
  }) })
  app.mount(root)
  return { root, state, events, unmount: () => app.unmount() }
}

// 用途：查找真实宿主树中指定类型的元素以触发绑定事件。
// 参数：node 为宿主节点；tag 为目标元素类型。
// 返回值：全部匹配元素。
function elements(node, tag) {
  return [...(node.tag === tag ? [node] : []),
    ...(node.children || []).flatMap((child) => elements(child, tag))]
}

// 用途：提取真实渲染文案，验证内部引用不会展示给使用者。
// 参数：node 为宿主树节点。
// 返回值：当前节点及后代可见文字。
function text(node) {
  return `${node.text || ''}${(node.children || []).map(text).join('')}`
}

// 用途：等待网络 Promise 及 Vue 更新完成。
// 参数：无。
// 返回值：异步完成信号。
async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
  await Vue.nextTick()
}

// 用途：触发真实下拉选择事件，并等待父子响应式更新。
// 参数：fixture 为挂载结果；id 为接口返回的文档坐标或空选择。
// 返回值：异步完成信号。
async function choose(fixture, id) {
  elements(fixture.root, 'select')[0].props.onChange({ target: { value: id } })
  await flush()
}

test('真实文件名选择追加file_id，数组协议去重，清空选择不删除原关联', async () => {
  const calls = []
  const fixture = mount({ modelValue: ['old-file-id'], purpose: 'reimbursement.claim.evidence',
    names: { 'old-file-id': '原始证明.pdf' } }, async (path) => {
    calls.push(path)
    return { items: [{ id: 'document-id', file_id: 'new-file-id', name: '会议证明.pdf' }], total: 1 }
  })
  try {
    await flush()
    const query = new URL(calls[0], 'https://example.test')
    assert.equal(query.pathname, '/invoice-document-options')
    assert.equal(query.searchParams.get('purpose'), 'reimbursement.claim.evidence')
    await choose(fixture, 'document-id')
    assert.deepEqual(fixture.state.modelValue, ['old-file-id', 'new-file-id'])
    assert.deepEqual(fixture.events, [['files', ['old-file-id', 'new-file-id']]])
    assert.match(text(fixture.root), /原始证明.pdf|会议证明.pdf/)
    assert.doesNotMatch(text(fixture.root), /old-file-id|new-file-id|document-id/)
    await choose(fixture, 'document-id')
    await choose(fixture, '')
    assert.equal(fixture.events.length, 1)
    assert.deepEqual(fixture.state.modelValue, ['old-file-id', 'new-file-id'])
    elements(fixture.root, 'li')[0].children.find((node) => node.tag === 'button').props.onClick()
    await flush()
    assert.deepEqual(fixture.state.modelValue, ['new-file-id'])
  } finally { fixture.unmount() }
})

test('逗号字符串保持原协议，未知历史名称明确待核对且不暴露编号', async () => {
  const fixture = mount({ modelValue: 'historic-file', purpose: 'reimbursement.payment.voucher' },
    async () => ({ items: [{ id: 'doc-second', file_id: 'file-second', name: '付款回单.pdf' }] }))
  try {
    await flush()
    assert.match(text(fixture.root), /已关联附件（名称待核对）/)
    assert.doesNotMatch(text(fixture.root), /historic-file/)
    await choose(fixture, 'doc-second')
    assert.equal(fixture.state.modelValue, 'historic-file,file-second')
    const remove = elements(fixture.root, 'li')[1].children.find((node) => node.tag === 'button')
    remove.props.onClick()
    await flush()
    assert.equal(fixture.state.modelValue, 'historic-file')
  } finally { fixture.unmount() }
})

test('名称加载失败保留关联且不能通过伪造选项增加，重试后才能选择', async () => {
  let calls = 0
  const fixture = mount({ modelValue: ['retained-file'], purpose: 'reimbursement.claim.evidence' },
    async () => {
      if (++calls === 1) throw new Error('private SQL failure')
      return { items: [{ id: 'retry-doc', file_id: 'retry-file', name: '补充说明.pdf' }] }
    })
  try {
    await flush()
    assert.match(text(fixture.root), /加载失败/)
    assert.doesNotMatch(text(fixture.root), /retained-file|private|SQL/)
    await choose(fixture, 'retry-doc')
    assert.deepEqual(fixture.events, [])
    assert.deepEqual(fixture.state.modelValue, ['retained-file'])
    elements(fixture.root, 'button').find((node) => text(node) === '重试').props.onClick()
    await flush()
    await choose(fixture, 'retry-doc')
    assert.deepEqual(fixture.state.modelValue, ['retained-file', 'retry-file'])
  } finally { fixture.unmount() }
})

test('上传只转发真实事件，固定用途控制accept，禁用不请求或增删', async () => {
  const calls = []
  const fixture = mount({ modelValue: ['hidden'], disabled: true,
    purpose: 'reimbursement.invoice.original' }, async (path) => { calls.push(path); return { items: [] } })
  try {
    await flush()
    let file = elements(fixture.root, 'input').find((node) => node.props.type === 'file')
    assert.match(file.props.accept, /\.ofd/)
    assert.equal(file.props.disabled, true)
    file.props.onChange({ target: { files: [{ name: '发票.ofd' }] } })
    elements(fixture.root, 'li')[0].children.find((node) => node.tag === 'button').props.onClick()
    assert.deepEqual(fixture.events, [])
    assert.deepEqual(calls, [])
    fixture.state.disabled = false
    fixture.state.purpose = 'reimbursement.payment.voucher'
    await flush()
    file = elements(fixture.root, 'input').find((node) => node.props.type === 'file')
    assert.doesNotMatch(file.props.accept, /\.ofd/)
    const event = { target: { files: [{ name: '付款回单.pdf' }] } }
    file.props.onChange(event)
    assert.equal(fixture.events[0][0], 'upload')
    assert.equal(fixture.events[0][1], event)
    assert.equal(new URL(calls[0], 'https://example.test').searchParams.get('purpose'),
      'reimbursement.payment.voucher')
    assert.deepEqual(fixture.state.modelValue, ['hidden'])
  } finally { fixture.unmount() }
})

test('规则真实添加事件自动生成不同稳定编号，编辑及移除不改已有编号', async () => {
  const original = { id: 'legacy-rule-id', keywords: '住宿', tax_code_prefixes: '123',
    fee_type: 'HOTEL', default_claim_type: '', priority: 1 }
  const fixture = mount({ value: [original] }, undefined, './InvoiceContentMappings.vue')
  try {
    const add = () => elements(fixture.root, 'button').find((node) => text(node) === '添加内容归类规则')
    add().props.onClick()
    await flush()
    add().props.onClick()
    await flush()
    const ids = fixture.state.value.map((row) => row.id)
    assert.equal(ids[0], 'legacy-rule-id')
    assert.equal(new Set(ids).size, 3)
    assert.ok(ids.every((id) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id)))
    assert.doesNotMatch(text(fixture.root), /唯一规则ID|legacy-rule-id|[0-9a-f]{8}-[0-9a-f]{4}-/)
    elements(fixture.root, 'input')[0].props.onInput({ target: { value: '456' } })
    await flush()
    assert.equal(fixture.state.value[0].id, 'legacy-rule-id')
    assert.equal(fixture.state.value[0].tax_code_prefixes, '456')
    const payload = contentMappingInput([fixture.state.value[0]])
    assert.equal(payload[0].id, 'legacy-rule-id')
    elements(fixture.root, 'button').find((node) => text(node) === '移除此规则').props.onClick()
    await flush()
    assert.deepEqual(fixture.state.value.map((row) => row.id), ids.slice(1))
  } finally { fixture.unmount() }
})
