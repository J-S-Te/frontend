import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { createCommandRunner, timeoutSignal } from '../api/client.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import { PaginationBarStub } from '../../../test/helpers/paginationStub.mjs'
import { createErrorStateStub } from '../../../test/helpers/errorStateStub.mjs'
import { borrowStatusLabels, failureMessage, packageStatusLabels } from '../statusLabels.js'

// 用途：把真实档案借阅组件编译为可注入API替身的Vue组件。
// 参数：extras 为非Vue导入的本地依赖绑定。
// 返回值：保留真实模板、权限按钮条件与状态映射的组件对象。
function component(extras = {}) {
  const { descriptor } = parse(readFileSync(new URL('./ArchiveBorrowPanel.vue', import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'archive-borrow-test', inlineTemplate: true })
  const values = { PaginationBar: PaginationBarStub, borrowStatusLabels, packageStatusLabels,
    ErrorState: createErrorStateStub().Stub, ...extras }
  const directives = {
    vModelText: { created: (el, binding) => { el.props.value = binding.value } },
    vModelSelect: { created: (el, binding) => { el.props.value = binding.value } },
    vModelCheckbox: { created: (el, binding) => { el.props.checked = binding.value } },
    vModelRadio: { created: (el, binding) => { el.props.checked = binding.value } },
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
      values[alias] = source === 'vue' ? (directives[key] || Vue[key]) : (extras[key] ?? values[alias])
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
// 参数：view 为组件，props 为业务夹具。
// 返回值：包含当前HTML读取能力的挂载上下文。
async function mount(view, props) {
  const root = { kind: 'root', type: '', text: '', props: {}, children: [], parent: null }
  const renderer = Vue.createRenderer(stringHost())
  const app = renderer.createApp(view, props)
  app.mount(root)
  await settle()
  return { app, root, html: () => serialize(root) }
}

test('借阅列表按服务端状态显示申请与审核按钮，非封存版本不提供申请入口，原因文本转义', async () => {
  const request = async () => ({
    total: 2,
    items: [
      { id: 'borrow-1', archive_id: 'archive-1', status: 'APPROVED', requester_subject_id: 'user-1',
        reason: '审计核对', approver_subject_id: 'user-2', package_status: 'DONE',
        expires_at: '2026-11-20T10:00:00+08:00', allowed_actions: ['DOWNLOAD'], version: 2 },
      { id: 'borrow-2', archive_id: 'archive-2', status: 'PENDING', requester_subject_id: 'user-1',
        reason: '<script>x</script>', approver_subject_id: '', package_status: '',
        expires_at: null, allowed_actions: ['APPROVE', 'REJECT'], version: 1, last_error: '文件损坏' },
    ],
  })
  const view = component({ reimbursementAPI: { request }, publicPrefix: '/reimbursement',
    createCommandRunner, timeoutSignal, formatBusinessDateTime, failureMessage, onBeforeRouteLeave: () => {} })
  const props = { archives: { items: [
    { id: 'archive-1', package_version: 5, status: 'SEALED' },
    { id: 'archive-2', package_version: 6, status: 'DRAFT' },
  ] } }
  const { app, html } = await mount(view, props)
  try {
    const rendered = html()
    assert.match(rendered, /封存版本 5/)
    assert.match(rendered, /封存版本 6/)
    assert.equal((rendered.match(/申请此版本借阅/g) || []).length, 1)
    assert.match(rendered, /档案 archive-1 · 已批准/)
    assert.match(rendered, /档案 archive-2 · 待审核/)
    assert.match(rendered, /申请人 user-1 · 用途 审计核对/)
    assert.match(rendered, /用途 &lt;script&gt;x&lt;\/script&gt;/)
    assert.doesNotMatch(rendered, /<script>x/)
    assert.match(rendered, /审核人 user-2 · 文件包 已就绪 · 到期 2026-11-20 10:00/)
    assert.match(rendered, /审核人 待审核 · 文件包 未生成 · 到期 批准后生效/)
    assert.match(rendered, /文件损坏/)
    assert.match(rendered, /下载借阅包/)
    assert.match(rendered, /批准借阅/)
    assert.match(rendered, /拒绝/)
  } finally { app.unmount() }
})

test('无借阅申请时明确显示空状态，不渲染任何申请操作', async () => {
  const request = async () => ({ total: 0, items: [] })
  const view = component({ reimbursementAPI: { request }, publicPrefix: '/reimbursement',
    createCommandRunner, timeoutSignal, formatBusinessDateTime, failureMessage, onBeforeRouteLeave: () => {} })
  const { app, html } = await mount(view, { archives: null })
  try {
    const rendered = html()
    assert.match(rendered, /当前范围没有借阅申请。/)
    assert.doesNotMatch(rendered, /批准借阅|下载借阅包|>拒绝</)
    assert.doesNotMatch(rendered, /class="expense-item"/)
    assert.doesNotMatch(rendered, /第 1 页/)
  } finally { app.unmount() }
})

test('借阅读取失败交给共享错误态，不直出原始错误文本', async () => {
  const request = async () => { throw Object.assign(new Error('借阅服务暂不可用'), { status: 503 }) }
  const view = component({ reimbursementAPI: { request }, publicPrefix: '/reimbursement',
    createCommandRunner, timeoutSignal, formatBusinessDateTime, failureMessage, onBeforeRouteLeave: () => {} })
  const { app, html } = await mount(view, { archives: null })
  try {
    const rendered = html()
    assert.match(rendered, /class="ui-state" role="alert"/)
    assert.match(rendered, /档案借阅未完成/)
    assert.match(rendered, /借阅服务暂不可用/)
    assert.doesNotMatch(rendered, /<p role="alert">/)
  } finally { app.unmount() }
})
