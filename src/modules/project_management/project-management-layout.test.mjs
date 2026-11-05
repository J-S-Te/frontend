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
