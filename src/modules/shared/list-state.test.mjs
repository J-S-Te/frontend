import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import { renderToString } from '@vue/server-renderer'

// 三态闸门（shared/components/ListState.vue）的行为锁。
//
// 要锁的不是「某个组件长什么样」，而是一条产品规则：
//   请求失败时，列表区域必须出现「失败 + 重试」，**绝不能**回落成「暂无数据」。
// 改造前 CRM 就是这样：接口 500 时列表区域显示「暂无符合条件的客户」，
// 用户以为筛选没匹配到，于是反复改筛选条件，而不是重试。
//
// 用例直接把真实 SFC 编译后渲染：SSR 看文案归属，自定义渲染器看「点重试真的会 emit」。
// 只要优先级被调换（空态优先于错误），或者重试按钮没接上事件，用例就会失败。

const SRC = new URL('../../', import.meta.url).pathname

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
  const { descriptor } = parse(readFileSync(file, 'utf8'))
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
      imports[spec.local.name] = spec.type === 'ImportDefaultSpecifier' ? (dependency.default ?? dependency) : dependency[spec.imported.name]
    }
  }
  for (const match of script.content.matchAll(/import \{([^}]+)\} from ['"]vue['"]/g)) {
    for (const part of match[1].split(',')) {
      const [imported, local = imported] = part.trim().split(/\s+as\s+/)
      if (imported && !(local in imports)) imports[local] = Vue[imported]
    }
  }
  // 共享组件已改为 `<script lang="ts">`：compileScript 只展开宏、不擦除类型标注，
  // 因此先用 esbuild 把编译产物降级成 JS，再交给 new Function 求值。
  // esbuild 会把 import 重排成单行并补分号：在这里一次性去掉，下游 new Function 只吃纯 JS。
  const scriptCode = transformSync(script.content, { loader: 'ts' }).code
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"];?\n/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?\n?/gm, '')
  const component = new Function(...Object.keys(imports), scriptCode
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  return component
}

const ListState = await loadSfc(join(SRC, 'modules/shared/components/ListState.vue'))
const EmptyState = await loadSfc(join(SRC, 'modules/shared/components/EmptyState.vue'))

function render(props, slots = {}) {
  const host = { render: () => Vue.h(ListState, props, slots) }
  return renderToString(Vue.createSSRApp(host))
}

// 无 DOM 渲染器：把 vnode 树落成普通对象，便于直接调用按钮上的真实事件处理器。
const nodeOps = {
  createElement: (tag) => ({ tag, props: {}, children: [] }),
  createText: (text) => ({ text }),
  createComment: (text) => ({ comment: text }),
  setText: () => {},
  setElementText: () => {},
  insert: (child, parent) => { parent.children.push(child) },
  remove: () => {},
  parentNode: (node) => node.parent,
  nextSibling: () => null,
  querySelector: () => null,
  setScopeId: () => {},
  cloneNode: (node) => ({ ...node }),
  insertStaticContent: () => [null, null],
  patchProp: (el, key, _previous, next) => { el.props[key] = next },
}
const renderer = Vue.createRenderer(nodeOps)

function mount(props, slots = {}) {
  const root = { tag: 'root', props: {}, children: [] }
  renderer.createApp({ render: () => Vue.h(ListState, props, slots) }).mount(root)
  return root
}

function collect(node, predicate, found = []) {
  if (node && predicate(node)) found.push(node)
  for (const child of node?.children || []) collect(child, predicate, found)
  return found
}

test('请求失败时渲染失败状态与重试，绝不渲染「暂无数据」', async () => {
  const html = await render({ error: '客户列表读取失败，请稍后重试。', emptyTitle: '暂无符合条件的客户' })
  assert.match(html, /客户列表读取失败，请稍后重试。/, '失败原因必须显示出来')
  assert.match(html, /role="alert"/, '失败状态是告警角色')
  assert.match(html, /重新加载/, '失败状态带重试入口')
  assert.doesNotMatch(html, /暂无符合条件的客户/, '失败时不得显示空状态文案')
  assert.doesNotMatch(html, /ui-state__spinner/, '失败时不得同时渲染加载态')
})

test('加载中优先于失败：不把「加载中」显示成错误，也不显示空态', async () => {
  const html = await render({ loading: true, error: '客户列表读取失败', emptyTitle: '暂无符合条件的客户' })
  assert.match(html, /ui-state__spinner/, '加载态必须出现')
  assert.match(html, /加载中…/)
  assert.doesNotMatch(html, /客户列表读取失败/, '加载中不提前暴露上一次的失败')
  assert.doesNotMatch(html, /暂无符合条件的客户/)
})

test('没有失败也没有加载时才显示空状态，并保留调用方的空态动作', async () => {
  const html = await render(
    { emptyTitle: '暂无符合条件的客户', emptyDescription: '可以放宽筛选条件后再试。' },
    { 'empty-action': () => Vue.h('button', { type: 'button' }, '重置筛选') },
  )
  assert.match(html, /暂无符合条件的客户/)
  assert.match(html, /可以放宽筛选条件后再试。/)
  assert.match(html, /重置筛选/, '空状态动作必须渲染')
  assert.doesNotMatch(html, /role="alert"/)
  assert.doesNotMatch(html, /ui-state__spinner/)
})

test('点击失败状态里的重试按钮会 emit retry', () => {
  const events = []
  const root = mount({ error: '客户列表读取失败' })
  const buttons = collect(root, (node) => node.tag === 'button')
  assert.equal(buttons.length, 1, '失败状态只有一个重试按钮')
  assert.equal(buttons[0].props.type, 'button')
  buttons[0].props.onClick()
  assert.equal(events.length, 0, '未接监听时不会凭空产生事件')

  const retryEvents = []
  const wired = Vue.createRenderer(nodeOps).createApp({
    render: () => Vue.h(ListState, { error: '客户列表读取失败', onRetry: () => retryEvents.push('retry') }),
  })
  const host = { tag: 'root', props: {}, children: [] }
  wired.mount(host)
  const [retryButton] = collect(host, (node) => node.tag === 'button')
  retryButton.props.onClick()
  assert.deepEqual(retryEvents, ['retry'], '重试按钮必须把事件抛给调用方')
})

test('retry=false 时不渲染重试按钮（调用方自己处理恢复）', async () => {
  const html = await render({ error: '无权限读取该列表', retry: false })
  assert.match(html, /无权限读取该列表/)
  assert.doesNotMatch(html, /重新加载/)
})

test('默认标题与文案：不传参数时是三态组件自己的默认值', async () => {
  const loading = await render({ loading: true })
  assert.match(loading, /加载中…/)
  const empty = await render({})
  assert.match(empty, /暂无数据/)
  assert.match(empty, /ui-state__icon/)
})

test('错误对象按 ErrorState 的口径展示，而不是直接输出对象', async () => {
  const html = await render({ error: new Error('网络连接已断开') })
  assert.match(html, /网络连接已断开/)
  assert.doesNotMatch(html, /\[object Object\]/)
})

// 结构回归：闸门本身必须继续用三个共享三态组件实现，避免各模块又长出一套自定义状态块。
test('闸门复用共享的三态组件而不是自有样式', async () => {
  const source = readFileSync(join(SRC, 'modules/shared/components/ListState.vue'), 'utf8')
  for (const component of ['LoadingState', 'ErrorState', 'EmptyState']) {
    assert.match(source, new RegExp(`import ${component} from './${component}\\.vue'`), `应复用 ${component}`)
  }
  // 三种状态渲染出来的是共享组件的根类，说明视觉仍由 state.css 统一供给。
  for (const props of [{ loading: true }, { error: '读取失败' }, { emptyTitle: '暂无数据' }]) {
    assert.match(await render(props), /class="ui-state/, `${JSON.stringify(props)} 应渲染共享三态样式类`)
  }
  assert.ok(EmptyState !== undefined)
})
