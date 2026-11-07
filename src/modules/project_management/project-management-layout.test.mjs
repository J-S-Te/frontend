import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

// 层高 token 在文件顶部统一声明（z-index 仅 20/30/40/41/50/60）。
function zTokens(css) {
  const tokens = {}
  for (const matched of css.matchAll(/(--pm-z-[a-z]+):\s*(\d+)/g)) tokens[matched[1]] = Number(matched[2])
  return tokens
}

function narrowScreenBlock(css) {
  const start = css.indexOf('@media (max-width: 900px)')
  assert.ok(start >= 0, '缺少窄屏媒体查询')
  const next = css.indexOf('\n@media ', start + 1)
  return css.slice(start, next === -1 ? undefined : next)
}

// 回归锁定：窄屏侧栏是抽屉，与遮罩同处一层。遮罩按 DOM 顺序后渲染，
// 若侧栏层级不高于遮罩，打开菜单后侧栏条目会全部点不动。
test('项目管理窄屏抽屉的 z-index token 高于同层遮罩 token', () => {
  const css = read('./styles/project-management.css')
  const tokens = zTokens(css)
  assert.ok(Number.isFinite(tokens['--pm-z-mask']), '缺少 --pm-z-mask 声明')
  assert.ok(Number.isFinite(tokens['--pm-z-drawer']), '缺少 --pm-z-drawer 声明')
  assert.notEqual(tokens['--pm-z-drawer'], tokens['--pm-z-mask'], '抽屉与遮罩必须是两个不同层级')
  assert.ok(
    tokens['--pm-z-drawer'] > tokens['--pm-z-mask'],
    `--pm-z-drawer(${tokens['--pm-z-drawer']}) 必须大于 --pm-z-mask(${tokens['--pm-z-mask']})`,
  )
})

test('窄屏媒体查询内 .pm-sidebar 用抽屉 token、.pm-menu-mask 保持遮罩 token', () => {
  const narrow = narrowScreenBlock(read('./styles/project-management.css'))
  const sidebar = /\.pm-sidebar\s*\{([^}]*)\}/.exec(narrow)
  assert.ok(sidebar, '窄屏媒体查询缺少 .pm-sidebar 规则')
  assert.match(sidebar[1], /z-index:\s*var\(--pm-z-drawer\)/)
  const mask = /\.pm-menu-mask\s*\{([^}]*)\}/.exec(narrow)
  assert.ok(mask, '窄屏媒体查询缺少 .pm-menu-mask 规则')
  assert.match(mask[1], /z-index:\s*var\(--pm-z-mask\)/)
})

// 页脚回归（P1②）：.pm-table-panel 是 overflow: hidden 的卡片。561–900px 时左侧
// 说明文字 + 分页条放不进一行，旧规则 .pm-table-footer .ui-pager { flex: 0 0 auto }
// 让分页条既不能收缩也不能换行，「下一页 / 跳至 / 每页」被卡片右缘裁掉。
test('项目页脚允许换行，分页条可收缩且不被卡片裁切', () => {
  const css = read('./styles/project-management.css')
  const footer = /\.pm-table-footer\s*\{([^}]*)\}/.exec(css)
  assert.ok(footer, '缺少 .pm-table-footer 规则')
  assert.match(footer[1], /flex-wrap:\s*wrap/, '页脚必须允许换行')
  assert.match(footer[1], /min-width:\s*0/, '页脚必须允许收缩')

  const pager = /\.pm-table-footer \.ui-pager\s*\{([^}]*)\}/.exec(css)
  assert.ok(pager, '缺少页脚内分页条规则')
  assert.match(pager[1], /flex:\s*0 1 auto/, '分页条必须可收缩（不能是 flex: 0 0 auto）')
  assert.match(pager[1], /min-width:\s*0/, '分页条必须允许内部换行而不是溢出')
  assert.match(pager[1], /max-width:\s*100%/, '分页条宽度不得超过卡片')
})

// P2⑥：资质与能力筛选行含「标签 + 多个下拉」，窄屏必须换行或纵向，否则下拉被
// overflow: hidden 的卡片裁掉。
test('资质与能力筛选行在窄屏换行 / 纵向排列', () => {
  const css = read('./styles/project-management.css')
  const filter = /\.pm-qualification-filter\s*\{([^}]*)\}/.exec(css)
  assert.ok(filter, '缺少 .pm-qualification-filter 规则')
  assert.match(filter[1], /flex-wrap:\s*wrap/, '筛选行必须允许换行')

  const start = css.indexOf('@media (max-width: 700px)')
  assert.ok(start >= 0, '缺少 ≤700px 媒体查询')
  const next = css.indexOf('\n@media ', start + 1)
  const block = css.slice(start, next === -1 ? undefined : next)
  assert.match(block, /\.pm-qualification-filter\s*\{[^}]*flex-direction:\s*column/, '≤700px 筛选行应改为纵向')
  assert.match(block, /\.pm-qualification-filter select\s*\{[^}]*flex:\s*1 1 auto/, '≤700px 下拉应占满可用宽度')
})
