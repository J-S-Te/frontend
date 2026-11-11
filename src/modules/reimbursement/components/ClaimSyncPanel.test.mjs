import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { createCommandRunner } from '../api/client.js'
import { claimStatusLabel, failureMessage } from '../statusLabels.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import { createErrorStateStub } from '../../../test/helpers/errorStateStub.mjs'

// 用途：把真实支出同步组件编译为可注入API替身的Vue组件。
// 参数：extras 为非Vue导入的本地依赖绑定。
// 返回值：保留真实模板、权限门禁与容量告警的组件对象。
function component(extras = {}) {
  const { descriptor } = parse(readFileSync(new URL('./ClaimSyncPanel.vue', import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'claim-sync-test', inlineTemplate: true })
  const values = { ...extras }
  const directives = {
    vModelText: { created: (el, binding) => { el.props.value = binding.value } },
    vModelSelect: { created: (el, binding) => { el.props.value = binding.value } },
    vModelCheckbox: { created: (el, binding) => { el.props.checked = binding.value } },
    vModelDynamic: { created: () => {} },
  }
  const body = compiled.content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, source) => {
    for (const item of names.split(',')) {
      const [key, alias = key] = item.trim().split(/\s+as\s+/)
      values[alias] = source === 'vue' ? (directives[key] || Vue[key]) : extras[key]
    }
    return ''
  }).replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?[ \t]*$/gm, (_, name) => {
    values[name] = extras[name]
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

// 用途：在最小宿主节点树中定位真实模板生成的元素，用于触发内联事件处理器。
// 参数：el 为根节点；type 为标签名。
// 返回值：命中的节点或 null。
function findNode(el, type) {
  if (el.type === type) return el
  for (const child of el.children) {
    const found = findNode(child, type)
    if (found) return found
  }
  return null
}
test('有同步管理能力时显示真实财务版本、失败原因、容量告警和重投入口', async () => {
  const request = async (path) => {
    if (path === '/claims/claim-1/sync-status') {
      return { current_revision: 7, successful_revision: 6, status: 'SYNCED',
        last_error: '<script>同步失败</script>', next_attempt_at: '2026-11-12T10:00:00+08:00' }
    }
    if (path === '/claims/claim-1/spend-capacity') {
      return { allocations_used: 10, allocation_limit: 100, allocation_reservation: 2,
        warning: true, can_record: false }
    }
    throw new Error(`未知路径：${path}`)
  }
  const view = component({ reimbursementAPI: { request }, createCommandRunner, formatBusinessDateTime, claimStatusLabel, failureMessage,
    ErrorState: createErrorStateStub().Stub })
  const props = { claim: { id: 'claim-1', version: 5 },
    permissions: ['expense.integration.manage', 'expense.payment.read'] }
  const { app, html } = await mount(view, props)
  try {
    const rendered = html()
    assert.match(rendered, /当前财务版本 7 · 最后成功投递版本 6 · 已同步/)
    assert.match(rendered, /同步失败：&lt;script&gt;同步失败&lt;\/script&gt;/)
    assert.doesNotMatch(rendered, /<script>同步失败/)
    assert.match(rendered, /下一次重试：2026-11-12 10:00/)
    assert.match(rendered, /累计历史分摊 10 \/ 100；本次付款及全额冲正预留 2 条。/)
    assert.match(rendered, /当前不能安全预留全额冲正空间，需财务受控处理。/)
    assert.match(rendered, /重投权威快照/)
  } finally { app.unmount() }
})

test('缺少同步管理能力时仍可读状态但不显示重投入口，缺少付款读取能力不拉取容量', async () => {
  const paths = []
  const request = async (path) => {
    paths.push(path)
    return { current_revision: 3, successful_revision: 3, status: 'PENDING', last_error: '', next_attempt_at: null }
  }
  const view = component({ reimbursementAPI: { request }, createCommandRunner, formatBusinessDateTime, claimStatusLabel, failureMessage,
    ErrorState: createErrorStateStub().Stub })
  const { app, html } = await mount(view, { claim: { id: 'claim-2', version: 1 }, permissions: [] })
  try {
    const rendered = html()
    assert.match(rendered, /当前财务版本 3 · 最后成功投递版本 3 · 待处理/)
    assert.doesNotMatch(rendered, /重投权威快照/)
    assert.doesNotMatch(rendered, /累计历史分摊/)
    assert.deepEqual(paths, ['/claims/claim-2/sync-status'])
  } finally { app.unmount() }
})

test('同步状态读取失败交给共享错误态，重试重新读取同步状态而不是直出原文', async () => {
  let requests = 0
  const request = async () => {
    requests += 1
    throw Object.assign(new Error('同步服务暂不可用'), { status: 503 })
  }
  const errors = createErrorStateStub()
  const view = component({ reimbursementAPI: { request }, createCommandRunner, formatBusinessDateTime,
    claimStatusLabel, failureMessage, ErrorState: errors.Stub })
  const { app, html } = await mount(view, { claim: { id: 'claim-3', version: 1 }, permissions: [] })
  try {
    const rendered = html()
    assert.match(rendered, /class="ui-state" role="alert"/)
    assert.match(rendered, /同步状态读取失败/)
    assert.match(rendered, /同步服务暂不可用/)
    assert.equal(errors.seen.length, 1, '读取失败只能渲染一个统一错误态')
    assert.equal(errors.seen[0].retry, true, '读取失败必须保留重试入口')
    await errors.seen[0].onRetry()
    await settle()
    assert.equal(requests, 2, '重试必须重新读取同步状态')
    assert.match(html(), /同步状态读取失败/)
  } finally { app.unmount() }
})

test('重投校验失败显示统一错误态，但不提供与动作无关的重试按钮', async () => {
  const request = async () => ({ current_revision: 7, successful_revision: 6, status: 'SYNCED',
    last_error: '', next_attempt_at: null })
  const errors = createErrorStateStub()
  const view = component({ reimbursementAPI: { request }, createCommandRunner, formatBusinessDateTime,
    claimStatusLabel, failureMessage, ErrorState: errors.Stub })
  const { app, root, html } = await mount(view, { claim: { id: 'claim-4', version: 2 },
    permissions: ['expense.integration.manage'] })
  try {
    const form = findNode(root, 'form')
    assert.ok(form?.props.onSubmit, '存在同步管理能力时应渲染重投表单')
    await form.props.onSubmit({ preventDefault() {} })
    await settle()
    const rendered = html()
    assert.match(rendered, /同步操作未完成/)
    assert.match(rendered, /请填写重投原因/)
    assert.equal(errors.seen.at(-1).retry, false, '动作失败不应冒充可重新加载')
    assert.doesNotMatch(rendered, /ui-state__retry/)
  } finally { app.unmount() }
})
