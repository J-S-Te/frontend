import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { createGlobalToastBus, globalToastBus } from './toastBus.js'

// 全局提示宿主 GlobalErrorToasts.vue：把“谁都没接住”的错误显示出来。
//
// 它和业务视图自己的 showToast 是两套通道：业务侧接住的错误照旧走 OperationToast，
// 这里只接兜底通道，所以既不能重复弹，也不能在没消息时留一个空壳节点。

const SRC = new URL('../../../', import.meta.url).pathname
const HOST_FILE = new URL('./GlobalErrorToasts.vue', import.meta.url).pathname

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

const GlobalErrorToasts = await loadSfc(HOST_FILE)

// Teleport 的内容不在主 HTML 里，SSR 会放进 context.teleports.body。
async function renderHost(props = {}) {
  const context = {}
  const html = await renderToString(Vue.createSSRApp(GlobalErrorToasts, props), context)
  return { html, teleport: context.teleports?.body || '' }
}

test('队列为空时不渲染任何提示节点（不留空壳占位）', async () => {
  globalToastBus.clear()
  const { html, teleport } = await renderHost()
  assert.doesNotMatch(html + teleport, /global-error-toast/, '空队列不该渲染提示条或容器')
})

test('把队列里的错误提示渲染成可读文案，并带上错误语义', async () => {
  globalToastBus.clear()
  globalToastBus.push({ message: '页面遇到错误，操作未完成。请重试或刷新页面。', detail: '未捕获的脚本错误' })
  const { teleport } = await renderHost()
  assert.match(teleport, /页面遇到错误，操作未完成/)
  assert.match(teleport, /未捕获的脚本错误/, 'detail 作为一行补充说明显示')
  assert.match(teleport, /role="alert"/, '错误提示要让读屏软件立即播报')
  assert.match(teleport, /aria-live="assertive"/)
  assert.match(teleport, /global-error-toast__close/, '必须能手动关掉，不能只等自动消失')
  globalToastBus.clear()
})

test('单例总线同时最多渲染 3 条，先来的在前', async () => {
  globalToastBus.clear()
  for (let index = 1; index <= 3; index += 1) {
    globalToastBus.push({ message: `第 ${index} 条兜底提示` })
  }
  const { teleport } = await renderHost()
  const shown = teleport.match(/第 (\d) 条兜底提示/g) ?? []
  assert.equal(shown.length, 3, '同时可见条数必须封顶，避免遮住整页')
  assert.deepEqual(shown, ['第 1 条兜底提示', '第 2 条兜底提示', '第 3 条兜底提示'])
  globalToastBus.clear()
})

test('可见条数封顶时丢弃最旧的一条（注入独立总线验证）', async () => {
  const bus = createGlobalToastBus({ maxVisible: 2, maxPerWindow: 10 })
  for (let index = 1; index <= 5; index += 1) {
    bus.push({ message: `第 ${index} 条兜底提示` })
  }
  const { teleport } = await renderHost({ bus })
  const shown = teleport.match(/第 (\d) 条兜底提示/g) ?? []
  assert.deepEqual(shown, ['第 4 条兜底提示', '第 5 条兜底提示'], '保留最新的，丢弃最旧的')
  bus.clear()
})

test('关闭一条之后其它提示仍保留', async () => {
  globalToastBus.clear()
  globalToastBus.push({ message: '第一条提示' })
  globalToastBus.push({ message: '第二条提示' })
  const first = globalToastBus.items.value[0]
  globalToastBus.dismiss(first.id)
  const { teleport } = await renderHost()
  assert.doesNotMatch(teleport, /第一条提示/)
  assert.match(teleport, /第二条提示/)
  globalToastBus.clear()
})

test('提示宿主样式只引用设计 token，且层级高于业务提示条', () => {
  const source = readFileSync(HOST_FILE, 'utf8')
  const style = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''
  assert.ok(style.trim().length > 0)
  assert.doesNotMatch(style, /#[0-9a-fA-F]{3,8}\b/, '颜色必须走 var(--token)')
  assert.doesNotMatch(style, /\b(?:rgb|rgba|hsl|hsla)\(/, '颜色必须走 var(--token)')
  assert.doesNotMatch(style, /font-size:\s*\d/, '字号必须走 var(--fs-*)')
  assert.doesNotMatch(style, /z-index:\s*\d/, '层级必须走 var(--...)')
  // 兜底提示比业务提示（OperationToast，12000）更靠上：两条同时出现时不能让业务提示压住崩溃提示。
  assert.match(source, /<Teleport to="body">/)
  assert.match(style, /z-index:\s*var\(--global-error-toast-z,\s*12100\)/)
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)/)
})
