import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { createCommandRunner, timeoutSignal } from '../api/client.js'
import { claimStatusLabel, failureMessage } from '../statusLabels.js'
import { pollTask, taskSettled } from '../asyncTask.js'
import { recallTask, rememberTask, savedAtLabel } from '../taskPersistence.js'
import { createErrorStateStub } from '../../../test/helpers/errorStateStub.mjs'

// 用途：把真实档案包组件编译为可注入API替身的Vue组件。
// 参数：extras 为非Vue导入的本地依赖绑定。
// 返回值：保留真实模板、封存版本门禁与任务状态的组件对象。
function component(extras = {}) {
  const { descriptor } = parse(readFileSync(new URL('./ArchivePackagePanel.vue', import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'archive-package-test', inlineTemplate: true })
  const values = { ErrorState: createErrorStateStub().Stub, ...extras }
  const body = compiled.content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, source) => {
    for (const item of names.split(',')) {
      const [key, alias = key] = item.trim().split(/\s+as\s+/)
      values[alias] = source === 'vue' ? Vue[key] : extras[key]
    }
    return ''
  }).replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?[ \t]*$/gm, (_, name) => {
    values[name] = extras[name] ?? values[name]
    return ''
  })
  return new Function(...Object.keys(values), body.replace('export default', 'return'))(...Object.values(values))
}

// 用途：创建只把节点树序列化为HTML的最小宿主，等待异步任务后仍能断言真实模板。
// 参数：无。
// 返回值：供 runtime-core 使用的宿主实现，不实现浏览器下载。
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

// 用途：等待命令执行、异步任务状态与响应式重渲染完成。
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

// 用途：收集节点树中的元素并读取其可见文本。
// 参数：el 为起点节点。
// 返回值：元素数组；文本为后代文本拼接。
function findElement(el, text, tag = 'button', found = []) {
  if (el.kind === 'element' && (!tag || el.type === tag)) {
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
async function mount(view, props) {
  const root = { kind: 'root', type: '', text: '', props: {}, children: [], parent: null }
  const renderer = Vue.createRenderer(stringHost())
  const app = renderer.createApp(view, props)
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

test('仅封存版本提供生成入口并声明容量边界，未生成任务前不展示下载或查询按钮', async () => {
  const request = async () => { throw new Error('不应发请求') }
  const view = component({ reimbursementAPI: { request }, publicPrefix: '/reimbursement',
    createCommandRunner, timeoutSignal, claimStatusLabel, failureMessage, pollTask, taskSettled, recallTask, rememberTask, savedAtLabel })
  const props = { archives: { items: [
    { id: 'archive-1', package_version: 3, status: 'SEALED' },
    { id: 'archive-2', package_version: 4, status: 'DRAFT' },
  ] } }
  const { app, html } = await mount(view, props)
  try {
    const rendered = html()
    assert.match(rendered, /档案版本 3 · 已封存/)
    assert.match(rendered, /档案版本 4 · 草稿/)
    assert.equal((rendered.match(/生成文件包/g) || []).length, 1)
    assert.match(rendered, /单包上限20MiB，原件合计上限100MiB/)
    assert.doesNotMatch(rendered, /查询生成状态|下载证据包/)
  } finally { app.unmount() }
})

test('建包后自动读取任务状态，完成后提示并出现下载入口', async () => {
  const paths = []
  const request = async (path) => {
    paths.push(path)
    if (path === '/archives/archive-1/packages') {
      return { id: 'job-1', status: 'PROCESSING', last_error: '' }
    }
    if (path === '/archive-packages/job-1') {
      return { id: 'job-1', status: 'DONE', last_error: '' }
    }
    throw new Error(`未知路径：${path}`)
  }
  const view = component({ reimbursementAPI: { request }, publicPrefix: '/reimbursement',
    createCommandRunner, timeoutSignal, claimStatusLabel, failureMessage, pollTask, taskSettled, recallTask, rememberTask, savedAtLabel })
  const { app, html, click } = await mount(view, {
    archives: { items: [{ id: 'archive-1', package_version: 3, status: 'SEALED' }] },
  })
  try {
    await click('生成文件包')
    assert.ok(paths.includes('/archive-packages/job-1'), '建包后应自动查询任务状态')
    const rendered = html()
    assert.match(rendered, /任务 已完成/)
    assert.match(rendered, /证据包已生成，可下载/)
    assert.match(rendered, /下载证据包/)
  } finally { app.unmount() }
})

test('建包失败显示原因和下一步，重试沿用同一封存版本', async () => {
  let posts = 0
  const request = async (path) => {
    if (path === '/archives/archive-1/packages') {
      posts += 1
      return { id: `job-${posts}`, status: 'PROCESSING', last_error: '' }
    }
    if (path === '/archive-packages/job-1') {
      return { id: 'job-1', status: 'FAILED', last_error: 'ARCHIVE_PACKAGE_SIZE_LIMIT' }
    }
    if (path === '/archive-packages/job-2') {
      return { id: 'job-2', status: 'DONE', last_error: '' }
    }
    throw new Error(`未知路径：${path}`)
  }
  const view = component({ reimbursementAPI: { request }, publicPrefix: '/reimbursement',
    createCommandRunner, timeoutSignal, claimStatusLabel, failureMessage, pollTask, taskSettled, recallTask, rememberTask, savedAtLabel })
  const { app, html, click } = await mount(view, {
    archives: { items: [{ id: 'archive-1', package_version: 3, status: 'SEALED' }] },
  })
  try {
    await click('生成文件包')
    let rendered = html()
    assert.match(rendered, /证据包未生成/)
    assert.match(rendered, /超过单包大小上限/)
    assert.match(rendered, /重试生成/)
    await click('重试生成')
    assert.equal(posts, 2)
    rendered = html()
    assert.match(rendered, /任务 已完成/)
    assert.match(rendered, /下载证据包/)
  } finally { app.unmount() }
})

test('刷新后仍能找回上次证据包任务并继续查询，不重复建包', async () => {
  const store = new Map([['reimbursement.task.archive', JSON.stringify({
    task_id: 'job-9', archive_id: 'archive-1', status: 'PROCESSING', saved_at: Date.now(),
  })]])
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  try {
    const paths = []
    const request = async (path) => {
      paths.push(path)
      if (path === '/archive-packages/job-9') return { id: 'job-9', status: 'DONE', last_error: '' }
      throw new Error(`未知路径：${path}`)
    }
    const view = component({ reimbursementAPI: { request }, publicPrefix: '/reimbursement',
      createCommandRunner, timeoutSignal, claimStatusLabel, failureMessage, pollTask, taskSettled,
      recallTask, rememberTask, savedAtLabel })
    const { app, html, click } = await mount(view, { archives: { items: [] } })
    try {
      let rendered = html()
      assert.match(rendered, /上次生成任务 job-9/)
      assert.match(rendered, /继续查询上次任务/)
      assert.equal(paths.length, 0, '只显示入口，不在挂载时自动请求')
      await click('继续查询上次任务')
      assert.deepEqual(paths, ['/archive-packages/job-9'])
      rendered = html()
      assert.match(rendered, /证据包已生成，可下载/)
      // 重建包命令没有再次发出，避免刷新造成重复任务。
      assert.equal(paths.some((path) => path.endsWith('/packages')), false)
    } finally { app.unmount() }
  } finally { delete globalThis.localStorage }
})
