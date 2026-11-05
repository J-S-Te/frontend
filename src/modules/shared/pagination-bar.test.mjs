import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

// 共享分页条（shared/components/PaginationBar.vue）的行为锁。
//
// 这里的断言不读源码文案，而是把 SFC 真正编译后用 SSR 渲染 / 直接取 setup 绑定来驱动：
//   · SSR 用例锁「什么时候渲染、渲染出什么文字、哪一侧按钮被禁用」；
//   · setup 用例锁「点击语义」——emit 出来的目标页码，以及禁用时绝不 emit。
// 因此任意一条行为被改坏（例如单页空结果又渲染出一条全禁用的分页、末页仍可点下一页、
// 禁用态照样 emit），用例都会失败，而不是靠字符串匹配碰巧通过。

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
  const component = new Function(...Object.keys(imports), script.content
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  return component
}

const PaginationBar = await loadSfc(join(SRC, 'modules/shared/components/PaginationBar.vue'))

async function render(props) {
  return renderToString(Vue.createSSRApp(PaginationBar, props))
}

// 直接取 <script setup> 的绑定，用真实上下文 emit 驱动「点击」。
function setup(props, emit) {
  return PaginationBar.setup(props, {
    emit: (...args) => emit.push(args),
    expose: () => {},
    attrs: {},
    slots: {},
  })
}

function buttonTags(html) {
  return [...html.matchAll(/<button\b[^>]*>[^<]*<\/button>/g)].map((matched) => matched[0])
}

test('只有一页且零记录时完全不渲染分页条', async () => {
  for (const props of [
    { page: 1, total: 0, pageSize: 20 },
    { page: 1, total: 0, pageSize: 20, loading: true },
    { page: 1, total: null, count: 0, pageSize: 20 },
  ]) {
    const html = await render(props)
    // v-if 不成立时 SSR 只会留下注释占位，不能出现 nav、按钮或任何分页文案。
    assert.doesNotMatch(html, /ui-pager/, `空结果不应留下分页条：${JSON.stringify(props)}`)
    assert.doesNotMatch(html, /上一页|下一页|共 \d+ 条/, `空结果不应留下分页文案：${JSON.stringify(props)}`)
  }
})

test('页码大于 1 时即使当前页为空也保留分页条，用户才能翻回上一页', async () => {
  const html = await render({ page: 3, total: 0, pageSize: 20 })
  assert.match(html, /<nav\b[^>]*class="ui-pager"/)
  assert.match(html, /第 3 页，共 0 条/)
  assert.match(html, /<button type="button" class="ui-pager__button"(?![^>]*disabled)[^>]*>上一页/)
  assert.match(html, /<button type="button" class="ui-pager__button"[^>]*disabled[^>]*>下一页/)
})

test('有记录时一定展示总数；单页时两侧都禁用', async () => {
  const html = await render({ page: 1, total: 12, pageSize: 20 })
  assert.match(html, /第 1 页，共 12 条/)
  assert.equal(buttonTags(html).length, 2)
  for (const button of buttonTags(html)) assert.match(button, /\bdisabled\b/)
})

test('多页列表的上一页 / 下一页禁用边界由 page、pageSize、total 推导', async () => {
  const middle = await render({ page: 2, total: 60, pageSize: 20 })
  assert.match(middle, /第 2 页，共 60 条/)
  const [prevMiddle, nextMiddle] = buttonTags(middle)
  assert.doesNotMatch(prevMiddle, /\bdisabled\b/, '中间页上一页可点')
  assert.doesNotMatch(nextMiddle, /\bdisabled\b/, '中间页下一页可点')

  const first = await render({ page: 1, total: 60, pageSize: 20 })
  assert.match(buttonTags(first)[0], /\bdisabled\b/, '首页禁用上一页')
  assert.doesNotMatch(buttonTags(first)[1], /\bdisabled\b/)

  const last = await render({ page: 3, total: 60, pageSize: 20 })
  assert.doesNotMatch(buttonTags(last)[0], /\bdisabled\b/)
  assert.match(buttonTags(last)[1], /\bdisabled\b/, '末页禁用下一页')

  // 最后一页不满一页时也算末页：41 条 / 每页 20 → 第 3 页是末页。
  const partialLast = await render({ page: 3, total: 41, pageSize: 20 })
  assert.match(buttonTags(partialLast)[1], /\bdisabled\b/)
})

test('加载中显示占位文案并禁用两侧，不先闪出页码', async () => {
  const html = await render({ page: 2, total: 60, pageSize: 20, loading: true })
  assert.match(html, /正在加载…/)
  assert.doesNotMatch(html, /第 2 页，共 60 条/)
  for (const button of buttonTags(html)) assert.match(button, /\bdisabled\b/)
  assert.match(html, /class="ui-pager__status is-loading"/)
})

test('调用方互斥态（如保存中）同样禁用两侧', async () => {
  const html = await render({ page: 2, total: 60, pageSize: 20, disabled: true })
  for (const button of buttonTags(html)) assert.match(button, /\bdisabled\b/)
  assert.match(html, /第 2 页，共 60 条/, '禁用不等于加载，仍应展示真实页码')
})

test('后端不返回总数时展示本页条数，并按 hasMore 决定是否能翻下一页', async () => {
  const more = await render({ page: 2, total: null, count: 50, pageSize: 50, hasMore: true })
  assert.match(more, /第 2 页 · 50 条/)
  assert.doesNotMatch(buttonTags(more)[1], /\bdisabled\b/)

  const end = await render({ page: 2, total: null, count: 13, pageSize: 50, hasMore: false })
  assert.match(end, /第 2 页 · 13 条/)
  assert.match(buttonTags(end)[1], /\bdisabled\b/)
  assert.doesNotMatch(buttonTags(end)[0], /\bdisabled\b/)
})

test('无障碍：根节点是带 aria-label 的 nav，按钮均为 type="button"', async () => {
  const html = await render({ page: 1, total: 5, pageSize: 20, label: '合同台账分页' })
  assert.match(html, /<nav class="ui-pager" aria-label="合同台账分页">/)
  for (const button of buttonTags(html)) assert.match(button, /^<button type="button"/)
  assert.match(html, /aria-live="polite"/)

  const fallback = await render({ page: 1, total: 5, pageSize: 20 })
  assert.match(fallback, /aria-label="列表分页"/, '未传 label 时给出默认无障碍名')
  assert.match(html, />上一页</)
  assert.match(html, />下一页</)
})

test('自定义文案可覆盖上一页 / 下一页 / 加载占位', async () => {
  const html = await render({ page: 2, total: 60, pageSize: 20, loading: true, prevText: '‹', nextText: '›', loadingText: '正在同步…' })
  assert.match(html, />‹</)
  assert.match(html, />›</)
  assert.match(html, /正在同步…/)
})

test('点击语义：emit 目标页码；禁用时不 emit', async () => {
  const events = []
  const middle = setup({ page: 2, total: 60, pageSize: 20 }, events)
  middle.goNext()
  middle.goPrev()
  assert.deepEqual(events, [['change', 3], ['change', 1]], '中间页前后翻各 emit 一次目标页码')

  const atFirst = []
  setup({ page: 1, total: 60, pageSize: 20 }, atFirst).goPrev()
  assert.deepEqual(atFirst, [], '首页点上一页不得 emit')

  const atLast = []
  setup({ page: 3, total: 60, pageSize: 20 }, atLast).goNext()
  assert.deepEqual(atLast, [], '末页点下一页不得 emit')

  const loading = []
  const loadingCtx = setup({ page: 2, total: 60, pageSize: 20, loading: true }, loading)
  loadingCtx.goNext()
  loadingCtx.goPrev()
  assert.deepEqual(loading, [], '加载中不得 emit')

  const disabled = []
  const disabledCtx = setup({ page: 2, total: 60, pageSize: 20, disabled: true }, disabled)
  disabledCtx.goNext()
  disabledCtx.goPrev()
  assert.deepEqual(disabled, [], '禁用态不得 emit')

  const offsetPaging = []
  const offsetCtx = setup({ page: 1, total: null, count: 50, pageSize: 50, hasMore: true }, offsetPaging)
  offsetCtx.goNext()
  assert.deepEqual(offsetPaging, [['change', 2]], 'offset 分页按 hasMore 翻页')

  const samePage = []
  setup({ page: 2, total: 60, pageSize: 20 }, samePage).goTo(2)
  assert.deepEqual(samePage, [], '目标页等于当前页时不 emit')

  // 非法目标页码钳到第 1 页；它确实是另一页，所以要 emit 一次 change(1)。
  const clamped = []
  setup({ page: 2, total: 60, pageSize: 20 }, clamped).goTo(0)
  assert.deepEqual(clamped, [['change', 1]], '非法目标页码钳到第 1 页后 emit')
})
