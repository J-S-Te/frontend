import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { approvalNodeLabel } from '../rolePresentation.js'
import { claimChanges } from '../workspace.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import { PaginationBarStub } from '../../../test/helpers/paginationStub.mjs'
import { createErrorStateStub } from '../../../test/helpers/errorStateStub.mjs'

// 用途：把真实审批轮次组件编译为可注入API替身的Vue组件。
// 参数：extras 为非Vue导入的本地依赖绑定。
// 返回值：保留真实模板、条件与字段映射的组件对象。
function component(extras = {}) {
  const { descriptor } = parse(readFileSync(new URL('./ApprovalRoundsPanel.vue', import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'approval-rounds-test', inlineTemplate: true })
  const values = { PaginationBar: PaginationBarStub, ErrorState: createErrorStateStub().Stub, ...extras }
  const body = compiled.content
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?[ \t]*\n/gm, (_, name) => {
      values[name] = extras[name] ?? values[name]
      return ''
    })
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, source) => {
    for (const item of names.split(',')) {
      const [key, alias = key] = item.trim().split(/\s+as\s+/)
      values[alias] = source === 'vue' ? Vue[key] : extras[key]
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

test('真实审批轮次按轮次展示冻结责任、权威岗位来源和跨轮字段差异，标题按Vue转义', async () => {
  const request = async () => ({
    total: 2,
    items: [
      { round: 1, created_at: '2026-11-01T10:00:00+08:00', content_hash: 'hash-1', rule_version: 'v1',
        snapshot: { title: '旧标题', items: [] }, frozen_tasks: [], references: [], actions: [] },
      { round: 2, created_at: '2026-11-02T10:00:00+08:00', content_hash: 'hash-2', rule_version: 'v2',
        snapshot: { title: '<script>新标题</script>', items: [] },
        frozen_tasks: [{ id: 'task-1', node_role: 'TECHNICAL_DIRECTOR', assignee_subject_id: 'tech',
          allocation_keys: ['key-a', 'key-b'] }],
        references: [{ project_id: 'project-1', service_item_id: '', reference_version: 4,
          required_approver_refs: [{ node_role: 'FINANCE_DIRECTOR', subject_id: 'finance',
            source_field: 'finance_director', source_version: '7' }] }],
        actions: [{ ID: 'action-1', CreatedAt: '2026-11-02T11:00:00+08:00', Actor: 'actor',
          Action: 'APPROVE', Reason: '同意' }] },
    ],
  })
  const view = component({ reimbursementAPI: { request }, approvalNodeLabel, claimChanges, formatBusinessDateTime })
  const { app, html } = await mount(view, { claimId: 'claim-1' })
  try {
    const rendered = html()
    assert.match(rendered, /第 1 轮 · 2026-11-01 10:00/)
    assert.match(rendered, /第 2 轮 · 2026-11-02 10:00/)
    assert.match(rendered, /与上一轮关键字段对比（金额为元）/)
    assert.match(rendered, /标题：旧标题 → &lt;script&gt;新标题&lt;\/script&gt;/)
    assert.doesNotMatch(rendered, /<script>新标题/)
    assert.match(rendered, /项目技术总监（技术负责人） · 冻结受理人 tech · 责任分摊 key-a、key-b/)
    assert.match(rendered, /项目 project-1 \/ 项目级 · 引用版本 4/)
    assert.match(rendered, /财务负责人：finance · finance_director · 版本 7/)
    assert.match(rendered, /2026-11-02 11:00 · actor · 同意 · 同意/)
    assert.match(rendered, /第 1 页，共 2 条/)
  } finally { app.unmount() }
})

test('审批轮次读取失败显示告警且不伪造任何轮次内容', async () => {
  const request = async () => { throw new Error('审批轮次读取失败') }
  const view = component({ reimbursementAPI: { request }, approvalNodeLabel, claimChanges, formatBusinessDateTime })
  const { app, html } = await mount(view, { claimId: 'claim-1' })
  try {
    const rendered = html()
    assert.match(rendered, /class="ui-state" role="alert"/)
    assert.match(rendered, /审批轮次读取失败<\/b>/)
    assert.match(rendered, /审批轮次读取失败<\/span>/)
    assert.match(rendered, /ui-state__retry/)
    assert.doesNotMatch(rendered, /与上一轮关键字段对比/)
    assert.doesNotMatch(rendered, /第 1 页/)
  } finally { app.unmount() }
})
