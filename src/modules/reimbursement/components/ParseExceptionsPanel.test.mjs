import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import { failureMessage } from '../statusLabels.js'
import { PaginationBarStub } from '../../../test/helpers/paginationStub.mjs'
import { createErrorStateStub } from '../../../test/helpers/errorStateStub.mjs'

// 用途：把真实解析异常组件编译为可注入API替身的Vue组件。
// 参数：extras 为非Vue导入的本地依赖绑定。
// 返回值：保留真实模板、状态文案与空态条件的组件对象。
function component(extras = {}) {
  const { descriptor } = parse(readFileSync(new URL('./ParseExceptionsPanel.vue', import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'parse-exceptions-test', inlineTemplate: true })
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

// 用途：创建只把节点树序列化为HTML的最小宿主，等待异步数据后仍能断言真实模板。
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

// 用途：挂载真实组件并等待其首次异步加载。
// 参数：view 为组件。
// 返回值：包含当前HTML读取能力的挂载上下文。
async function mount(view) {
  const root = { kind: 'root', type: '', text: '', props: {}, children: [], parent: null }
  const renderer = Vue.createRenderer(stringHost())
  const app = renderer.createApp(view)
  app.mount(root)
  await settle()
  return { app, html: () => serialize(root) }
}

test('解析异常列出原件、状态原因、候选组与运行时间，原件名按Vue转义', async () => {
  const request = async () => ({ total: 1, items: [
    { parse_run_id: 'run-1', original_name: '<img src=x onerror=alert(1)>.pdf', document_id: 'document-1',
      parse_status: 'FAILED', error_code: 'OCR_LOW_CONFIDENCE', parsed_candidate_count: 2,
      created_at: '2026-11-11T08:30:00+08:00' },
  ] })
  const view = component({ reimbursementAPI: { request }, formatBusinessDateTime, failureMessage })
  const { app, html } = await mount(view)
  try {
    const rendered = html()
    assert.match(rendered, /原件解析待处理池/)
    assert.match(rendered, /&lt;img src=x onerror=alert\(1\)&gt;\.pdf/)
    assert.doesNotMatch(rendered, /<img src=x/)
    assert.match(rendered, /提取失败 · 票面文字识别置信度不足/)
    assert.match(rendered, /2 组待核对；尚无可用业务发票/)
    assert.match(rendered, /2026-11-11 08:30/)
    assert.match(rendered, /查看原件与人工处理/)
    assert.match(rendered, /第 1 页，共 1 条/)
  } finally { app.unmount() }
})

test('没有待处理原件显示空状态，响应不完整时显示告警而不冒充空目录', async () => {
  let response = { total: 0, items: [] }
  const request = async () => response
  const view = component({ reimbursementAPI: { request }, formatBusinessDateTime, failureMessage })
  const empty = await mount(view)
  try {
    const rendered = empty.html()
    assert.match(rendered, /当前范围没有待处理原件。/)
    assert.doesNotMatch(rendered, /第 1 页/)
  } finally { empty.app.unmount() }

  response = { total: 1, items: 'invalid' }
  const broken = await mount(view)
  try {
    const rendered = broken.html()
    assert.match(rendered, /class="ui-state" role="alert"/)
    assert.match(rendered, /解析异常读取失败<\/b>/)
    assert.match(rendered, /解析异常响应不完整/)
    assert.match(rendered, /ui-state__retry/)
    assert.doesNotMatch(rendered, /当前范围没有待处理原件。/)
    assert.doesNotMatch(rendered, /查看原件与人工处理/)
  } finally { broken.app.unmount() }
})
