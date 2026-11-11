import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

// 用途：编译真实业务对象选择器，只替换HTTP网络边界。
// 参数：request为测试提供的异步站内读取实现。
// 返回值：保留真实模板、异步状态和事件的Vue组件。
function component(request) {
  const { descriptor } = parse(readFileSync(new URL('./BusinessObjectSelect.vue', import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'business-object-select', inlineTemplate: true })
  const bindings = { reimbursementAPI: { request } }
  const content = compiled.content.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, source) => {
      for (const entry of names.split(',')) {
        const [name, alias = name] = entry.trim().split(/\s+as\s+/)
        if (source === 'vue') bindings[alias] = Vue[name]
      }
      return ''
    },
  )
  return new Function(...Object.keys(bindings), content.replace('export default', 'return'))(
    ...Object.values(bindings),
  )
}

// 用途：挂载真实选择组件并记录父层更新，允许验证属性变更与异步请求。
// 参数：props为组件输入，request为唯一网络替身。
// 返回值：宿主树、可变属性、父事件及卸载方法，不冒充浏览器验收。
function mount(props = {}, request = async () => ({ items: [] })) {
  const root = { children: [] }
  const events = []
  const state = Vue.reactive({ ...props })
  const view = component(request)
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
      if (index >= 0) parent.children.splice(index, 0, node)
      else parent.children.push(node)
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
  const app = renderer.createApp({
    setup: () => () => Vue.h(view, { ...state,
      'onUpdate:modelValue': (value) => events.push(['value', value]),
      onSelect: (row) => events.push(['select', row]),
    }),
  })
  app.mount(root)
  return { root, state, events, unmount: () => app.unmount() }
}

// 用途：查找当前宿主树的原生元素以触发真实绑定事件。
// 参数：node为宿主节点，tag为目标元素类型。
// 返回值：当前全部匹配元素。
function elements(node, tag) {
  return [...(node.tag === tag ? [node] : []),
    ...(node.children || []).flatMap((child) => elements(child, tag))]
}

// 用途：读取实际渲染的业务文案，避免断言组件源码。
// 参数：node为宿主树节点。
// 返回值：该节点及后代的可见文字。
function text(node) {
  return `${node.text || ''}${(node.children || []).map(text).join('')}`
}

// 用途：等待当前网络Promise与Vue响应式渲染完成。
// 参数：无。
// 返回值：异步完成信号。
async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
  await Vue.nextTick()
}

// 用途：点击当前真实组件中具有指定业务文案的按钮。
// 参数：fixture为挂载结果，name为目标按钮文字。
// 返回值：真实事件回调结果；找不到按钮时测试失败。
function click(fixture, name) {
  const button = elements(fixture.root, 'button').find((node) => text(node).includes(name))
  assert.ok(button, `missing button ${name}`)
  return button.props.onClick()
}

test('本地业务名称可搜索，选择只发内部key与原行，未命名对象不退回裸ID', async () => {
  const rows = [{ account_ref: 'secret-account', name: '工商银行结算户' },
    { account_ref: 'second-account', label: '招商银行结算户' }, { account_ref: 'raw-only' }]
  const fixture = mount({ options: rows, valueKey: 'account_ref', label: '付款账户' })
  try {
    assert.match(text(fixture.root), /工商银行结算户/)
    assert.doesNotMatch(text(fixture.root), /secret-account|raw-only/)
    elements(fixture.root, 'input')[0].props.onInput({ target: { value: '招商' } })
    await flush()
    assert.doesNotMatch(text(fixture.root), /工商银行结算户/)
    const select = elements(fixture.root, 'select')[0]
    select.props.onChange({ target: { value: 'second-account' } })
    assert.deepEqual(fixture.events, [['value', 'second-account'], ['select', rows[1]]])
    select.props.onChange({ target: { value: 'raw-only' } })
    assert.equal(fixture.events.length, 2)
  } finally { fixture.unmount() }
})

test('页外已有对象保留内部值，业务名称可缺省，禁用状态禁止请求及选择', async () => {
  const calls = []
  const fixture = mount({ modelValue: 'hidden-id', selectedLabel: '既有费用收款人',
    disabled: true, source: '/payees' }, async (path) => { calls.push(path); return { items: [] } })
  try {
    await flush()
    assert.match(text(fixture.root), /既有费用收款人/)
    assert.doesNotMatch(text(fixture.root), /hidden-id/)
    const select = elements(fixture.root, 'select')[0]
    assert.equal(select.props.value, 'hidden-id')
    assert.equal(select.props.disabled, true)
    assert.equal(elements(fixture.root, 'input')[0].props.disabled, true)
    select.props.onChange({ target: { value: '' } })
    assert.deepEqual(fixture.events, [])
    assert.deepEqual(calls, [])
    fixture.state.selectedLabel = ''
    await flush()
    assert.match(text(fixture.root), /已关联对象，请选择确认/)
    assert.equal(elements(fixture.root, 'select')[0].props.value, 'hidden-id')
  } finally { fixture.unmount() }
})

test('远程失败显示可重试状态，查询只携带固定用途及显式搜索分页参数', async () => {
  const calls = []
  const fixture = mount({ source: '/payees', extraParams: { purpose: 'payment' },
    selectedLabel: '已有收款人', modelValue: 'do-not-send' }, async (path) => {
    calls.push(path)
    if (calls.length === 1) throw new Error('private SQL detail')
    return { items: [{ id: 'payee-id', name: '张三' }], total: 1 }
  })
  try {
    await flush()
    assert.match(text(fixture.root), /加载失败/)
    assert.doesNotMatch(text(fixture.root), /SQL|private|do-not-send/)
    await click(fixture, '重试')
    await flush()
    assert.match(text(fixture.root), /张三/)
    assert.equal(calls.length, 2)
    const url = new URL(calls[1], 'https://test.invalid')
    assert.equal(url.pathname, '/payees')
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      purpose: 'payment', keyword: '', page: '1', page_size: '20',
    })
  } finally { fixture.unmount() }
})

test('必填搜索阻止空姓名查询，过期响应和卸载后的响应均不能覆盖新结果', async () => {
  const pending = []
  const fixture = mount({ source: '/people', requiredSearch: true }, (path) =>
    new Promise((resolve) => pending.push({ path, resolve })))
  try {
    await flush()
    assert.equal(pending.length, 0)
    const input = elements(fixture.root, 'input')[0]
    input.props.onInput({ target: { value: '张' } })
    click(fixture, '搜索')
    await flush()
    input.props.onInput({ target: { value: '李' } })
    click(fixture, '搜索')
    await flush()
    assert.equal(pending.length, 2)
    pending[1].resolve({ items: [{ id: 'new-id', name: '李四' }], total: 1 })
    await flush()
    pending[0].resolve({ items: [{ id: 'old-id', name: '张三' }], total: 1 })
    await flush()
    assert.match(text(fixture.root), /李四/)
    assert.doesNotMatch(text(fixture.root), /张三/)
    input.props.onInput({ target: { value: '王' } })
    fixture.unmount()
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(pending.length, 2)
  } finally { fixture.unmount() }
})

test('分页逐次读取，支持服务端游标，source变更不读取外部URL', async () => {
  const calls = []
  const fixture = mount({ source: '/objects' }, async (path) => {
    calls.push(path)
    return calls.length === 1
      ? { items: [{ id: 'one', name: '第一对象' }], next_cursor: 'opaque/page2' }
      : { items: [{ id: 'two', name: '第二对象' }], next_cursor: '' }
  })
  try {
    await flush()
    await click(fixture, '下一页')
    await flush()
    assert.equal(calls.length, 2)
    const query = new URL(calls[1], 'https://test.invalid').searchParams
    assert.equal(query.get('page'), '2')
    assert.equal(query.get('cursor'), 'opaque/page2')
    assert.match(text(fixture.root), /第二对象/)
    fixture.state.source = '//outside.invalid/people'
    await flush()
    assert.equal(calls.length, 2)
    assert.match(text(fixture.root), /配置不可用/)
    assert.doesNotMatch(text(fixture.root), /第二对象/)
  } finally { fixture.unmount() }
})

test('普通页码按total显示下一页，前后翻页不发送伪造游标，labelKey展示业务字段', async () => {
  const calls = []
  const fixture = mount({ source: '/accounts', labelKey: 'business_name' }, async (path) => {
    calls.push(path)
    return { items: [{ id: 'internal-key', business_name: '财务专户' }], total: 21 }
  })
  try {
    await flush()
    assert.match(text(fixture.root), /财务专户/)
    assert.doesNotMatch(text(fixture.root), /internal-key/)
    await click(fixture, '下一页')
    await flush()
    assert.equal(new URL(calls[1], 'https://test.invalid').searchParams.get('page'), '2')
    assert.equal(new URL(calls[1], 'https://test.invalid').searchParams.has('cursor'), false)
    const next = elements(fixture.root, 'button').find((button) => /下一页/.test(text(button)))
    assert.equal(next.props.disabled, true)
    await click(fixture, '上一页')
    assert.equal(new URL(calls[2], 'https://test.invalid').searchParams.get('page'), '1')
  } finally { fixture.unmount() }
})

test('卸载后在途响应不重新渲染或发射选择，缺业务名称响应不暴露内部ID', async () => {
  let resolve
  const fixture = mount({ source: '/objects' }, () =>
    new Promise((done) => { resolve = done }))
  await flush()
  fixture.unmount()
  resolve({ items: [{ id: 'private-only' }] })
  await flush()
  assert.equal(fixture.root.children.length, 0)
  assert.deepEqual(fixture.events, [])

  const unnamed = mount({ source: '/objects' }, async () => ({ items: [{ id: 'private-only' }] }))
  try {
    await flush()
    assert.doesNotMatch(text(unnamed.root), /private-only/)
    assert.match(text(unnamed.root), /没有匹配/)
  } finally { unnamed.unmount() }
})
