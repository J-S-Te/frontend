import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { h, nextTick } from 'vue'
import { createRenderer } from '@vue/runtime-core'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

// 全局错误边界 ErrorBoundary.vue。
//
// 边界只在“页面组件自己炸了”时生效，所以必须真挂载、真抛错、真点击才测得出来：
// 本仓库不引入 jsdom，这里沿用 shared/app-shell.test.mjs 的做法——用 runtime-core 的
// createRenderer 把组件挂到纯对象宿主树上，既能断渲染结果，也能派发真实点击。

const SRC = new URL('../../../', import.meta.url).pathname
const BOUNDARY_FILE = new URL('./ErrorBoundary.vue', import.meta.url).pathname

const sfcCache = new Map()

async function resolveDependency(fromFile, specifier) {
  if (specifier === 'vue') return Vue
  const base = specifier.startsWith('.') ? resolve(dirname(fromFile), specifier) : join(SRC, specifier.slice(2))
  if (specifier.endsWith('.vue')) return loadSfc(base)
  for (const candidate of [base, `${base}.js`, join(base, 'index.js')]) {
    try {
      return await import(pathToFileURL(candidate).href)
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(`cannot resolve ${specifier}`)
}

async function loadSfc(file) {
  if (sfcCache.has(file)) return sfcCache.get(file)
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
  const script = compileScript(descriptor, { id: file })
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: file,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(compiled.errors, [], file)
  const imports = {}
  for (const node of script.scriptSetupAst.filter((item) => item.type === 'ImportDeclaration')) {
    const dependency = await resolveDependency(file, node.source.value)
    for (const spec of node.specifiers) {
      imports[spec.local.name] = spec.type === 'ImportDefaultSpecifier'
        ? (dependency.default ?? dependency)
        : dependency[spec.imported.name]
    }
  }
  // compileScript 会为 defineModel 等宏注入 `import { ... } from 'vue'`，须从 Vue 补齐。
  for (const match of script.content.matchAll(/import \{([^}]+)\} from ['"]vue['"]/g)) {
    for (const part of match[1].split(',')) {
      const [imported, local = imported] = part.trim().split(/\s+as\s+/)
      if (imported && !(local in imports)) imports[local] = Vue[imported]
    }
  }
  const component = new Function(...Object.keys(imports), script.content
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  sfcCache.set(file, component)
  return component
}

const ErrorBoundary = await loadSfc(BOUNDARY_FILE)

// ---------------------------------------------------------------------------
// 纯对象宿主 renderer
// ---------------------------------------------------------------------------

function createHostNode(tag, text = '') {
  return { tag, text, children: [], props: {}, parent: null }
}

const hostOps = {
  patchProp(el, key, previous, next) {
    if (next === undefined || next === null) delete el.props[key]
    else el.props[key] = next
  },
  insert(child, parent, anchor = null) {
    if (child.parent) {
      const siblings = child.parent.children
      const current = siblings.indexOf(child)
      if (current >= 0) siblings.splice(current, 1)
    }
    child.parent = parent
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at >= 0) parent.children.splice(at, 0, child)
    else parent.children.push(child)
  },
  remove(child) {
    const siblings = child.parent?.children
    if (!siblings) return
    const at = siblings.indexOf(child)
    if (at >= 0) siblings.splice(at, 1)
    child.parent = null
  },
  createElement: (tag) => createHostNode(tag),
  createText: (text) => createHostNode('#text', text),
  createComment: (text) => createHostNode('#comment', text),
  setText(node, text) { node.text = text },
  setElementText(node, text) { node.text = text; node.children = [] },
  parentNode: (node) => node.parent ?? null,
  nextSibling(node) {
    const siblings = node.parent?.children ?? []
    const at = siblings.indexOf(node)
    return at >= 0 ? siblings[at + 1] ?? null : null
  },
  querySelector: () => null,
  setScopeId() {},
  cloneNode: (node) => createHostNode(node.tag, node.text),
  insertStaticContent(content, parent, anchor) {
    const node = createHostNode('#static', content)
    hostOps.insert(node, parent, anchor)
    return [node, node]
  },
}

const { createApp } = createRenderer(hostOps)

function walkVNodes(vnode, visit) {
  if (!vnode || typeof vnode !== 'object') return
  if (Array.isArray(vnode)) {
    for (const child of vnode) walkVNodes(child, visit)
    return
  }
  visit(vnode)
  if (vnode.component) walkVNodes(vnode.component.subTree, visit)
  if (Array.isArray(vnode.children)) for (const child of vnode.children) walkVNodes(child, visit)
}

function classTokens(vnode) {
  const value = vnode?.props?.class
  const text = Array.isArray(value) ? value.join(' ') : String(value ?? '')
  return text.split(/\s+/).filter(Boolean)
}

function textOf(vnode) {
  if (typeof vnode === 'string') return vnode
  if (!vnode || typeof vnode !== 'object') return ''
  let out = ''
  if (vnode.component) out += textOf(vnode.component.subTree)
  if (typeof vnode.children === 'string') out += vnode.children
  else if (Array.isArray(vnode.children)) for (const child of vnode.children) out += textOf(child)
  return out
}

// boom 控制子组件第一次 setup 是否抛错；置 false 后重试应当恢复业务内容。
let shouldThrow = true

const UnstableChild = {
  name: 'UnstableChild',
  render() {
    if (shouldThrow) throw new TypeError("Cannot read properties of undefined (reading 'rows')")
    return h('p', { class: 'business-content' }, '业务内容已恢复')
  },
}

// 边界在 errorCaptured 里改状态 → 降级界面在下一个渲染时机出现，所以挂载后要等一次 flush。
async function mountBoundary(props = {}) {
  const container = createHostNode('#root')
  const events = []
  const app = createApp({
    name: 'BoundaryHost',
    render: () => h(ErrorBoundary, { ...props, onError: (payload) => events.push(payload) }, {
      default: () => h(UnstableChild),
    }),
  })
  app.mount(container)
  await nextTick()
  return { app, events, viewport: () => viewportOf(app) }
}

function viewportOf(app) {
  const vnodes = []
  walkVNodes(app._instance.subTree, (vnode) => vnodes.push(vnode))
  const elements = vnodes.filter((vnode) => typeof vnode.type === 'string')
  return {
    vnodes,
    elements,
    text: () => textOf(app._instance.subTree),
    byClass: (name) => elements.filter((vnode) => classTokens(vnode).includes(name)),
    button: (label) => elements.find((vnode) => vnode.type === 'button' && textOf(vnode).includes(label)),
    buttonLabels: () => elements.filter((vnode) => vnode.type === 'button').map((vnode) => textOf(vnode)),
  }
}

async function clickButton(mounted, label) {
  const target = mounted.viewport().button(label)
  assert.ok(target, `没有找到按钮「${label}」，当前按钮：${mounted.viewport().buttonLabels().join(' / ')}`)
  target.props.onClick({})
  await nextTick()
}

// ---------------------------------------------------------------------------
// 降级界面
// ---------------------------------------------------------------------------

test('子组件抛错时渲染降级界面，不白屏、不把异常原文抛给用户', async () => {
  shouldThrow = true
  const mounted = await mountBoundary()
  const ui = mounted.viewport()
  assert.ok(ui.elements.length > 0, '渲染结果不能是空白')
  assert.ok(ui.elements.length > 0 && ui.text().trim().length > 0, '必须有可见文字')
  assert.match(ui.text(), /页面出现异常/, '要有明确的降级标题')
  assert.doesNotMatch(ui.text(), /TypeError|Cannot read|undefined|rows/, '异常类型和内部字段不能出现在用户界面')
})

test('降级界面提供“重试”和“返回上一页”两个出口', async () => {
  shouldThrow = true
  const mounted = await mountBoundary()
  const labels = mounted.viewport().buttonLabels()
  assert.ok(labels.some((label) => /重试/.test(label)), `缺少重试按钮：${labels.join(' / ')}`)
  assert.ok(labels.some((label) => /返回上一页/.test(label)), `缺少返回按钮：${labels.join(' / ')}`)
  // 降级界面是整页替换，必须自带 main 地标，否则“跳到主要内容”的 skip-link 失去落点。
  assert.ok(mounted.viewport().elements.some((vnode) => vnode.type === 'main' && vnode.props.id === 'main-content'))
})

test('点击重试重新挂载子组件，成功后恢复业务内容', async () => {
  shouldThrow = true
  const mounted = await mountBoundary()
  shouldThrow = false
  await clickButton(mounted, '重试')
  assert.doesNotMatch(mounted.viewport().text(), /页面出现异常/, '重试成功后要退出降级态')
  assert.match(mounted.viewport().text(), /业务内容已恢复/, '重试必须真正重新渲染业务组件')
})

test('边界把原始错误交给上层用于排查，但界面只显示清洗后的文案', async () => {
  shouldThrow = true
  const mounted = await mountBoundary()
  assert.equal(mounted.events.length, 1, '必须抛出一次 error 事件供上层记录')
  assert.equal(mounted.events[0].error.message, "Cannot read properties of undefined (reading 'rows')")
  assert.equal(typeof mounted.events[0].info, 'string')
})

test('连续重试仍失败时封顶，重试按钮禁用并提示刷新或返回', async () => {
  shouldThrow = true
  const mounted = await mountBoundary({ retryLimit: 2 })
  await clickButton(mounted, '重试')
  await clickButton(mounted, '重试')
  const ui = mounted.viewport()
  assert.match(ui.text(), /多次重试|刷新页面/, '到上限后要给出下一步指引')
  const retry = ui.button('重试')
  assert.ok(retry, '重试按钮仍然存在，只是不可再点')
  assert.ok(retry.props.disabled !== undefined && retry.props.disabled !== false, '封顶后重试按钮必须禁用')
})

test('未出错时边界不渲染任何降级内容，直接透传插槽', async () => {
  shouldThrow = false
  const mounted = await mountBoundary()
  assert.match(mounted.viewport().text(), /业务内容已恢复/)
  assert.doesNotMatch(mounted.viewport().text(), /页面出现异常/)
  shouldThrow = true
})

// ---------------------------------------------------------------------------
// 设计 token 门禁：降级界面不能靠新增硬编码色值铺出来
// ---------------------------------------------------------------------------

test('降级界面样式只引用设计 token，不新增硬编码颜色/字号/层级', () => {
  const source = readFileSync(BOUNDARY_FILE, 'utf8')
  const style = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''
  assert.ok(style.trim().length > 0, '样式必须写在组件内，便于审查')
  assert.doesNotMatch(style, /#[0-9a-fA-F]{3,8}\b/, '颜色必须走 var(--token)')
  assert.doesNotMatch(style, /\b(?:rgb|rgba|hsl|hsla)\(/, '颜色必须走 var(--token)')
  assert.doesNotMatch(style, /font-size:\s*\d/, '字号必须走 var(--fs-*)')
  assert.doesNotMatch(style, /z-index:\s*\d/, '层级必须走 var(--...)')
})
