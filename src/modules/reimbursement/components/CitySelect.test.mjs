import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import * as cities from '../cities.js'

// 用途：编译真实城市及行程组件，保留模板和事件绑定。
// 参数：name为当前目录的组件文件名，extras为真实子组件依赖。
// 返回值：可由Vue渲染的组件定义。
function compileComponent(name, extras = {}) {
  const { descriptor } = parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: name, inlineTemplate: true })
  const bindings = { ...cities, ...extras }
  const body = compiled.content.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, source) => {
      for (const entry of names.split(',')) {
        const [name, alias = name] = entry.trim().split(/\s+as\s+/)
        bindings[alias] = source === 'vue' ? Vue[name] : bindings[name]
      }
      return ''
    },
  ).replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, () => '')
  return new Function(...Object.keys(bindings), body.replace('export default', 'return'))(
    ...Object.values(bindings),
  )
}

// 用途：在内存宿主树挂载真实Vue组件以观察原生选项及触发绑定事件。
// 参数：component为组件，props为受控输入，events记录父层收到的业务更新。
// 返回值：宿主树及卸载方法；不冒充浏览器键盘或DOM验收。
function mountComponent(component, props, events = []) {
  const root = { children: [] }
  const renderer = Vue.createRenderer({
    createElement: (tag) => ({ tag, props: {}, children: [] }),
    createText: (text) => ({ text }), createComment: () => ({}),
    insert: (node, parent) => { node.parent = parent; parent.children.push(node) },
    remove: (node) => {
      const siblings = node.parent?.children || []
      const index = siblings.indexOf(node)
      if (index !== -1) siblings.splice(index, 1)
    },
    parentNode: (node) => node.parent, nextSibling: () => null,
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text },
    patchProp: (node, key, _previous, value) => { node.props[key] = value },
  })
  const app = renderer.createApp(component, {
    ...props, 'onUpdate:modelValue': (value) => events.push(value),
    'onUpdate:value': (value) => events.push(value),
  })
  app.mount(root)
  return { root, unmount: () => app.unmount() }
}

// 用途：按原生元素种类查询当前渲染树。
// 参数：node为宿主节点，tag为目标元素名。
// 返回值：全部匹配元素，保留组件的实际事件属性。
function elements(node, tag) {
  return [ ...(node.tag === tag ? [node] : []),
    ...(node.children || []).flatMap((child) => elements(child, tag)) ]
}

test('真实城市下拉按中文或拼音过滤，搜索不入库且选择只发射六位码', async () => {
  const events = []
  const fixture = mountComponent(compileComponent('CitySelect.vue'), { label: '出发城市' }, events)
  try {
    const input = elements(fixture.root, 'input')[0]
    input.props.onInput({ target: { value: 'shenzhen' } })
    await Vue.nextTick()
    const options = elements(fixture.root, 'option')
    assert.ok(options.some((option) => option.props.value === '440300' && /深圳市/.test(option.text)))
    assert.ok(!options.some((option) => option.props.value === '310100'))
    assert.deepEqual(events, [])
    input.props.onInput({ target: { value: '杭州' } })
    await Vue.nextTick()
    assert.ok(elements(fixture.root, 'option').some((option) =>
      option.props.value === '330100' && /杭州市/.test(option.text)))
    const select = elements(fixture.root, 'select')[0]
    select.props.onChange({ target: { value: '440300' } })
    select.props.onChange({ target: { value: '自由文本' } })
    select.props.onChange({ target: { value: '' } })
    assert.deepEqual(events, ['440300', ''])
    input.props.onInput({ target: { value: '不存在的城市' } })
    await Vue.nextTick()
    assert.equal(elements(fixture.root, 'option').filter((option) => option.props.value).length, 0)
  } finally { fixture.unmount() }
})

test('搜索其他城市时保留当前中文选值，过滤本身不会清空已保存城市', async () => {
  const events = []
  const fixture = mountComponent(compileComponent('CitySelect.vue'), {
    label: '目的城市', modelValue: '440300',
  }, events)
  try {
    elements(fixture.root, 'input')[0].props.onInput({ target: { value: '杭州' } })
    await Vue.nextTick()
    assert.equal(elements(fixture.root, 'select')[0].props.value, '440300')
    assert.ok(elements(fixture.root, 'option').some((option) =>
      option.props.value === '440300' && /已选：深圳市/.test(option.text)))
    assert.deepEqual(events, [])
  } finally { fixture.unmount() }
})

test('未知历史编码显式保留待重选且不自动发射更改，禁用态禁止改码', () => {
  const events = []
  const fixture = mountComponent(compileComponent('CitySelect.vue'), {
    label: '目的城市', modelValue: '999999', disabled: true,
  }, events)
  try {
    const select = elements(fixture.root, 'select')[0]
    assert.equal(select.props.value, '999999')
    assert.equal(select.props.disabled, true)
    assert.equal(elements(fixture.root, 'input')[0].props.disabled, true)
    assert.ok(elements(fixture.root, 'option').some((option) =>
      option.props.value === '999999' && /待重新选择/.test(option.text)))
    select.props.onChange({ target: { value: '440300' } })
    assert.deepEqual(events, [])
  } finally { fixture.unmount() }
})

test('票面酒店与本人行程共用城市下拉，原字段名及其他行程字段完整保留', () => {
  const CitySelect = compileComponent('CitySelect.vue')
  const TravelFields = compileComponent('TravelFields.vue', { CitySelect })
  for (const invoice of [true, false]) {
    const events = []
    const value = { kind: 'HOTEL', destination_city_code: '440300', start_date: '2026-11-11' }
    const fixture = mountComponent(TravelFields, { invoice, value }, events)
    try {
      const selects = elements(fixture.root, 'select')
      assert.equal(selects.length, invoice ? 3 : 2)
      const origin = selects[invoice ? 1 : 0]
      const destination = selects[invoice ? 2 : 1]
      origin.props.onChange({ target: { value: '310100' } })
      destination.props.onChange({ target: { value: '110100' } })
      assert.deepEqual(events[0], { ...value, origin_city_code: '310100' })
      assert.deepEqual(events[1], { ...value, destination_city_code: '110100' })
      if (invoice) {
        assert.match(origin.children[0].text, /可不选择/)
        origin.props.onChange({ target: { value: '' } })
        assert.deepEqual(events[2], { ...value, origin_city_code: '' })
      }
    } finally { fixture.unmount() }
    const lockedEvents = []
    const locked = mountComponent(TravelFields, { invoice, value, disabled: true }, lockedEvents)
    try {
      for (const select of elements(locked.root, 'select').slice(invoice ? 1 : 0)) {
        assert.equal(select.props.disabled, true)
        select.props.onChange({ target: { value: '110100' } })
      }
      assert.deepEqual(lockedEvents, [])
    } finally { locked.unmount() }
  }
})
