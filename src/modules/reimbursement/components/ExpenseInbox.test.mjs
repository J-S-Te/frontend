import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { safeNotificationPath } from '../workspace.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import { PaginationBarStub } from '../../../test/helpers/paginationStub.mjs'
import { createErrorStateStub } from '../../../test/helpers/errorStateStub.mjs'

// 用途：把真实站内消息组件编译为可注入通知API替身的Vue组件。
// 参数：extras 为非Vue导入的本地依赖绑定。
// 返回值：保留真实模板、未读标记与安全深链条件的组件对象。
function component(extras = {}) {
  const { descriptor } = parse(readFileSync(new URL('./ExpenseInbox.vue', import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'expense-inbox-test', inlineTemplate: true })
  const values = { PaginationBar: PaginationBarStub, ErrorState: createErrorStateStub().Stub, ...extras }
  const directives = {
    vModelText: { created: (el, binding) => { el.props.value = binding.value } },
    vModelSelect: { created: (el, binding) => { el.props.value = binding.value } },
    vModelCheckbox: { created: (el, binding) => { el.props.checked = binding.value } },
    vModelDynamic: { created: () => {} },
  }
  const body = compiled.content
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?[ \t]*\n/gm, (_, name) => {
      values[name] = extras[name] ?? values[name]
      return ''
    })
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, source) => {
    for (const item of names.split(',')) {
      const [key, alias = key] = item.trim().split(/\s+as\s+/)
      values[alias] = source === 'vue' ? (directives[key] || Vue[key]) : extras[key]
    }
    return ''
  })
  return new Function(...Object.keys(values), body.replace('export default', 'return'))(...Object.values(values))
}

// 用途：创建只把节点树序列化为HTML的最小宿主，等待异步消息后仍能断言真实模板。
// 参数：无。
// 返回值：供 runtime-core 使用的宿主实现，不实现浏览器交互。
function stringHost() {
  const node = (kind, type = '', text = '') => ({ kind, type, text, props: {}, children: [], parent: null })
  const detach = (child) => {
    if (!child.parent) return
    const index = child.parent.children.indexOf(child)
    if (index >= 0) child.parent.children.splice(index, 1)
    child.parent = null
  }
  return {
    createElement: (type) => node('element', type),
    createText: (text) => node('text', '', text),
    createComment: (text) => node('comment', '', text),
    setText: (el, text) => { el.text = text },
    setElementText: (el, text) => { el.children = [node('text', '', text)] },
    insert: (child, parent, anchor) => {
      detach(child)
      child.parent = parent
      if (anchor) {
        const index = parent.children.indexOf(anchor)
        parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
      } else parent.children.push(child)
    },
    remove: detach,
    parentNode: (el) => el.parent,
    nextSibling: (el) => {
      const list = el.parent?.children || []
      return list[list.indexOf(el) + 1] || null
    },
    querySelector: () => null,
    setScopeId: () => {},
    cloneNode: (el) => structuredClone(el),
    insertStaticContent: (content, parent) => {
      const el = node('raw', '', content)
      el.parent = parent
      parent.children.push(el)
      return [el, el]
    },
    patchProp: (el, key, _previous, next) => { el.props[key] = next },
  }
}

// 用途：等待挂载后的异步加载与响应式重渲染完成。
// 参数：无。
// 返回值：Promise；微任务与定时器均冲洗后再断言。
async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Vue.nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Vue.nextTick()
}

// 用途：把宿主节点树序列化为可正则断言的真实HTML。
// 参数：el 为根节点或元素节点。
// 返回值：转义后的HTML字符串。
function serialize(el) {
  const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  if (el.kind === 'root') return el.children.map(serialize).join('')
  if (el.kind === 'text') return escape(el.text)
  if (el.kind === 'raw') return el.text
  if (el.kind === 'comment') return ''
  const attrs = Object.entries(el.props)
    .filter(([key, value]) => !key.startsWith('on') && value !== false && value !== null && value !== undefined)
    .map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${escape(value)}"`).join('')
  if (['input', 'br', 'img', 'hr', 'meta', 'link'].includes(el.type)) return `<${el.type}${attrs}>`
  return `<${el.type}${attrs}>${el.children.map(serialize).join('')}</${el.type}>`
}

// 用途：收集节点树中可见文本匹配的元素。
// 参数：el 为起点节点，text 为目标文本，tag 为标签名。
// 返回值：匹配元素数组。
function findElement(el, text, tag = 'button', found = []) {
  if (el.kind === 'element' && el.type === tag) {
    const textOf = (node) => node.kind === 'text' ? node.text
      : (node.kind === 'element' || node.kind === 'root') ? node.children.map(textOf).join('') : ''
    if (textOf(el).trim() === text) found.push(el)
  }
  if (el.kind === 'element' || el.kind === 'root') for (const child of el.children) findElement(child, text, tag, found)
  return found
}

// 用途：挂载真实组件并暴露按可见文本触发按钮点击的能力。
// 参数：view 为组件，props 为业务夹具。
// 返回值：包含HTML读取与点击能力的挂载上下文。
async function mount(view) {
  const root = { kind: 'root', type: '', text: '', props: {}, children: [], parent: null }
  const renderer = Vue.createRenderer(stringHost())
  const app = renderer.createApp(view)
  app.mount(root)
  await settle()
  return {
    app,
    html: () => serialize(root),
    click: async (text) => {
      const [target] = findElement(root, text)
      assert.ok(target, `缺少按钮：${text}`)
      target.props.onClick()
      await settle()
    },
  }
}

test('收件箱显示未读计数、未读标记、正文与业务时间，并转义消息内容', async () => {
  const rows = { total: 1, items: [{ delivery_id: 'delivery-1', title: '审批待办', content: '<b>请处理</b>',
    delivered_at: '2026-11-11T09:00:00+08:00', read_at: null }] }
  const view = component({
    listInbox: async () => rows,
    getUnreadCount: async () => ({ unread_count: 1 }),
    getNotification: async () => { throw new Error('不应读取详情') },
    markNotificationRead: async () => ({}),
    safeNotificationPath,
    formatBusinessDateTime,
  })
  const { app, html } = await mount(view)
  try {
    const rendered = html()
    assert.match(rendered, /未读 1/)
    assert.match(rendered, /审批待办/)
    assert.match(rendered, /class="expense-flag">未读/)
    assert.match(rendered, /&lt;b&gt;请处理&lt;\/b&gt;/)
    assert.doesNotMatch(rendered, /<b>请处理/)
    assert.match(rendered, /2026-11-11 09:00/)
    assert.match(rendered, /查看消息/)
  } finally { app.unmount() }
})

test('消息详情只渲染站内安全路径，脚本或跨站协议链接不显示关联业务入口', async () => {
  const view = component({
    listInbox: async () => ({ total: 1, items: [{ delivery_id: 'delivery-9', title: '待办', content: '正文',
      delivered_at: '2026-11-11T09:00:00+08:00', read_at: '2026-11-11T09:05:00+08:00' }] }),
    getUnreadCount: async () => ({ unread_count: 0 }),
    getNotification: async () => ({ title: '<b>详情</b>', content: '详情正文', target_url: currentTarget }),
    markNotificationRead: async () => ({}),
    safeNotificationPath,
    formatBusinessDateTime,
  })
  let currentTarget = ''
  for (const [target, allowed] of [['/claims/42', true], ['javascript:alert(1)', false]]) {
    currentTarget = target
    const { app, html, click } = await mount(view)
    try {
      await click('查看消息')
      const rendered = html()
      assert.match(rendered, /&lt;b&gt;详情&lt;\/b&gt;/)
      assert.doesNotMatch(rendered, /<b>详情/)
      if (allowed) {
        assert.match(rendered, /href="\/claims\/42"/)
        assert.match(rendered, /查看关联业务（重新校验权限）/)
      } else {
        assert.doesNotMatch(rendered, /查看关联业务/)
        assert.doesNotMatch(rendered, /javascript:alert/)
      }
    } finally { app.unmount() }
  }
})
