import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
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

// 只取「上一页 / 下一页」主按钮：页码、跳页、页大小属于 total 存在时的附加控件，
// 由下方独立用例断言，避免主按钮数量被新增控件带偏。
function buttonTags(html) {
  return [...html.matchAll(/<button\b[^>]*class="ui-pager__button"[^>]*>[^<]*<\/button>/g)].map((matched) => matched[0])
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


// ── total 存在时的页码 / 跳页 / 页大小（P1-3） ─────────────────────────────

function pageButtonTags(html) {
  return [...html.matchAll(/<button\b[^>]*class="ui-pager__page[^"]*"[^>]*>[^<]*<\/button>/g)].map((matched) => matched[0])
}

test('仅 total 存在时渲染页码与跳页；total 未知时两者都不渲染', async () => {
  const known = await render({ page: 2, total: 120, pageSize: 20 })
  assert.match(known, /class="ui-pager__page\b/, '有总数时必须有页码按钮')
  assert.match(known, /aria-current="page"/, '当前页必须有 aria-current')
  assert.match(known, /跳至/)

  const unknown = await render({ page: 2, total: null, count: 50, pageSize: 50, hasMore: true })
  assert.doesNotMatch(unknown, /class="ui-pager__page\b/, 'offset 分页不知道总页数，不得伪造页码')
  assert.doesNotMatch(unknown, /跳至/)
})

// P2③：页大小下拉是显式 opt-in。17 个未接 @change-page-size 的页面必须默认不出现
// 这个下拉，否则就是一个点了没反应、也不会重载列表的死控件。
test('「每页」下拉默认不渲染；只有传 pageSizeOptions 的页面才出现候选', async () => {
  const byDefault = await render({ page: 2, total: 120, pageSize: 20 })
  assert.doesNotMatch(byDefault, /每页/, '未 opt-in 的页面不得渲染「每页」标签')
  assert.doesNotMatch(byDefault, /class="ui-pager__size"/, '未 opt-in 的页面不得渲染页大小下拉')
  assert.doesNotMatch(byDefault, /<option value="50"/)

  const optIn = await render({ page: 2, total: 120, pageSize: 20, pageSizeOptions: [20, 50, 100] })
  assert.match(optIn, /每页/)
  assert.match(optIn, /class="ui-pager__size"/)
  assert.match(optIn, /<option value="20" selected>20<\/option>|value="20"/)
  assert.match(optIn, /<option value="50"/)
  assert.match(optIn, /<option value="100"/)

  // opt-in 但当前页大小不在候选里时补进候选，避免下拉值与页面实际页大小不一致。
  const missingCurrent = await render({ page: 1, total: 30, pageSize: 30, pageSizeOptions: [20, 50] })
  assert.match(missingCurrent, /<option value="30"/)
})

test('页码窗口：总页数不超过 7 时全部展示，超过时保留首尾与当前页并用省略号收束', async () => {
  const small = await render({ page: 3, total: 100, pageSize: 20 })
  assert.equal(pageButtonTags(small).length, 5, '5 页时页码全部展示')
  assert.match(small, />1</)
  assert.match(small, />5</)

  const large = await render({ page: 10, total: 400, pageSize: 20 })
  const pages = pageButtonTags(large)
  assert.ok(pages.some((tag) => />1</.test(tag)), '保留首页')
  assert.ok(pages.some((tag) => />20</.test(tag)), '保留末页')
  assert.ok(pages.some((tag) => />10</.test(tag)), '保留当前页')
  assert.ok(pages.some((tag) => />…</.test(tag)), '首尾与当前页之间用省略号')
  assert.match(large, /aria-current="page"[^>]*>10<|>10<\/button>/, '当前页按钮高亮')
})

test('点击页码 emit 目标页，当前页 / 越界 / 加载中都按语义处理', async () => {
  const events = []
  const ctx = setup({ page: 3, total: 100, pageSize: 20 }, events)
  ctx.goToPage(5)
  ctx.goToPage(3)
  ctx.goToPage(99)
  ctx.goToPage(0)
  assert.deepEqual(events, [['change', 5], ['change', 5], ['change', 1]], '当前页不 emit；越界钳到首尾页')

  const loading = []
  setup({ page: 3, total: 100, pageSize: 20, loading: true }, loading).goToPage(1)
  assert.deepEqual(loading, [], '加载中点击页码不得 emit')
})

test('跳页输入提交目标页，非法输入不 emit；翻页后清空草稿', async () => {
  const events = []
  const ctx = setup({ page: 2, total: 100, pageSize: 20 }, events)
  ctx.jumpDraft.value = '5'
  ctx.submitJump()
  assert.deepEqual(events, [['change', 5]])
  assert.equal(ctx.jumpDraft.value, '', '提交后清空跳页草稿')

  ctx.jumpDraft.value = 'abc'
  ctx.submitJump()
  ctx.jumpDraft.value = ''
  ctx.submitJump()
  assert.equal(events.length, 1, '非法 / 空输入不得 emit')
})

test('页大小选择 emit change-page-size，不重复 emit 相同值；未 opt-in 不 emit', async () => {
  const events = []
  const ctx = setup({ page: 1, total: 100, pageSize: 20, pageSizeOptions: [20, 50, 100] }, events)
  assert.equal(ctx.safePageSize.value, 20)
  ctx.changePageSize({ target: { value: '50' } })
  ctx.changePageSize({ target: { value: '20' } })
  ctx.changePageSize({ target: { value: 'abc' } })
  assert.deepEqual(events, [['change-page-size', 50]])
  assert.deepEqual(ctx.pageSizeChoices.value, [20, 50, 100])

  const notOptedIn = []
  const plain = setup({ page: 1, total: 100, pageSize: 20 }, notOptedIn)
  assert.deepEqual(plain.pageSizeChoices.value, [], '未传候选时没有可切换的页大小')
  plain.changePageSize({ target: { value: '50' } })
  assert.deepEqual(notOptedIn, [], '未 opt-in 的页面即使被误调用也不得 emit')
})


// ── 布局契约（「跳至 / 每页 / 跳转」错位与按钮换行的回归锁） ────────────────

const PAGER_SOURCE = readFileSync(join(SRC, 'modules/shared/components/PaginationBar.vue'), 'utf8')
const PAGER_STYLE = PAGER_SOURCE.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1]

test('跳页与页大小控件都有可见标签、无障碍名，且跳转按钮不在 <label> 里', async () => {
  const html = await render({ page: 1, total: 120, pageSize: 20, pageSizeOptions: [20, 50, 100] })
  assert.match(html, /<span class="ui-pager__label">跳至<\/span>/)
  assert.match(html, /<span class="ui-pager__unit">页<\/span>/)
  assert.match(html, /<span class="ui-pager__label">每页<\/span>/)
  assert.match(html, /<span class="ui-pager__unit">条<\/span>/)
  assert.match(html, /class="ui-pager__jump"[^>]*aria-label="跳转页码（共 6 页）"/)
  assert.match(html, /class="ui-pager__size"[^>]*aria-label="每页条数（当前 20 条）"/)

  const fields = [...html.matchAll(/<label class="ui-pager__field">([\s\S]*?)<\/label>/g)].map((match) => match[1])
  assert.equal(fields.length, 2, '跳至页与每页条数各有一个 label')
  for (const field of fields) {
    assert.doesNotMatch(field, /<button\b/, '按钮不能嵌进 label，否则点按钮会先聚焦输入框、读屏也会读成输入框标签')
  }
  assert.match(
    html,
    /<\/label><button type="button" class="ui-pager__button ui-pager__button--small"[^>]*>跳转<\/button>/,
    '跳转按钮与输入框同组但独立',
  )
  // 组内不拆行：跳至组 = label + 跳转按钮。
  assert.match(html, /<div class="ui-pager__group"><label class="ui-pager__field">[\s\S]*?<\/label><button[^>]*>跳转<\/button><\/div>/)
})

test('样式契约：分页条自带 scoped 样式，用双写类名压过模块通用控件规则', () => {
  assert.ok(PAGER_STYLE, 'PaginationBar.vue 必须有 <style scoped>')
  for (const selector of [
    '.ui-pager.ui-pager {',
    '.ui-pager.ui-pager .ui-pager__button',
    '.ui-pager.ui-pager .ui-pager__jump',
    '.ui-pager.ui-pager .ui-pager__extra',
  ]) {
    assert.ok(PAGER_STYLE.includes(selector), `缺少样式规则 ${selector}`)
  }
  // 固定宽度/高度与不折行是这次错位修复的核心，不允许退化成 width:100%。
  const jumpRule = PAGER_STYLE.match(/\.ui-pager\.ui-pager \.ui-pager__jump \{([\s\S]*?)\}/)?.[1] || ''
  assert.match(jumpRule, /width:\s*60px/)
  assert.match(jumpRule, /min-width:\s*60px/)
  const fieldRule = PAGER_STYLE.match(/\.ui-pager\.ui-pager \.ui-pager__field \{([\s\S]*?)\}/)?.[1] || ''
  assert.match(fieldRule, /white-space:\s*nowrap/)
  const statusRule = PAGER_STYLE.match(/\.ui-pager\.ui-pager \.ui-pager__status \{([\s\S]*?)\}/)?.[1] || ''
  assert.match(statusRule, /white-space:\s*nowrap/)
  assert.match(PAGER_STYLE, /flex:\s*0 0 auto/, '按钮不能继承模块的 flex:1（会被撑成半宽换行）')
  // 根节点显式声明行方向：页面规则（登录目标页 ≤720px 的 column 分组）不得把分页条改成纵向。
  const rootRule = PAGER_STYLE.match(/\.ui-pager\.ui-pager \{([\s\S]*?)\}/)?.[1] || ''
  assert.match(rootRule, /flex-direction:\s*row/, '分页条根节点必须显式 flex-direction: row 兜底')
  assert.match(PAGER_STYLE, /@media \(max-width: 720px\)/, '窄屏必须允许换行并改为左对齐')
  assert.match(PAGER_STYLE, /@media \(pointer: coarse\)/, '触控目标需要 44px 兜底')
})

test('只有组件自己定义 .ui-pager 内部样式；模块 CSS 不得用 !important 覆盖分页条', () => {
  const stateCss = readFileSync(join(SRC, 'modules/platform/shared/styles/state.css'), 'utf8')
  assert.doesNotMatch(stateCss, /\.ui-pager\b\s*\{/, '全局 state.css 不应再保留第二份 .ui-pager 规则')
  const offenders = []
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!['node_modules', '.mimosa'].includes(entry.name)) visit(path)
        continue
      }
      if (!/\.(css|vue)$/.test(entry.name)) continue
      const source = readFileSync(path, 'utf8')
      for (const match of source.matchAll(/([^{}]*ui-pager[^{}]*)\{([^{}]*)\}/g)) {
        if (!/!important/.test(match[2])) continue
        if (path.endsWith('PaginationBar.vue')) continue
        offenders.push(`${path}: ${match[1].trim()}`)
      }
    }
  }
  visit(join(SRC, 'modules'))
  assert.deepEqual(offenders, [], `模块样式不得用 !important 覆盖分页条：\n${offenders.join('\n')}`)
})
