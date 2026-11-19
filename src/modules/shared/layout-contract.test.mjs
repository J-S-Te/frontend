import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const consoleCss = read('../platform/styles/console.css')
const contractCss = read('../contract_management/styles/contract-management.css')
const daCss = read('../data_analysis/styles/data-analysis.css')
const pmCss = read('../project_management/styles/project-management.css')
const platformCss = read('../platform/styles/platform-console.css')
const settlementCss = read('../settlement/styles/settlement.css')
const refreshCss = read('./styles/ui-refresh.css')
const mainCss = read('../platform/shared/styles/main.css')

test('所有壳层主区偏移只读同一个侧栏令牌', () => {
  for (const css of [consoleCss, contractCss, daCss, pmCss]) {
    assert.match(css, /margin-left:\s*var\(--shell-sidebar\)/)
    assert.doesNotMatch(css, /margin-left:\s*(248px|232px|224px|210px)/)
  }
  assert.match(pmCss, /--pm-w-sidebar:\s*var\(--shell-sidebar\)/)
})

test('侧栏最终背景只来自全局令牌，不再被 Ant 色块覆盖', () => {
  assert.doesNotMatch(refreshCss, /#001529/)
  assert.match(refreshCss, /background:\s*var\(--sidebar\);/)
  assert.match(pmCss, /--pm-sidebar:\s*var\(--sidebar\);/)
})

test('内容宽度与页面标题收敛到统一契约', () => {
  for (const css of [consoleCss, contractCss, daCss, platformCss]) {
    assert.doesNotMatch(css, /max-width:\s*(1680px|1720px)/)
  }
  assert.match(daCss, /\.da-page \{[^}]*max-width:\s*1600px/)
  assert.match(settlementCss, /\.settlement-content \{[^}]*max-width:\s*1600px/)
  assert.match(pmCss, /\.pm-page \{[^}]*width:\s*min\(100%, 1600px\)/)
  assert.match(daCss, /font-size:\s*var\(--fs-title\)/)
})

test('项目管理语义色复用全局状态色，登录页页脚达到可读对比', () => {
  assert.match(pmCss, /--pm-green:\s*var\(--success\)/)
  assert.match(pmCss, /--pm-amber:\s*var\(--warning\)/)
  assert.match(pmCss, /--pm-red:\s*var\(--danger\)/)
  assert.match(mainCss, /\.brand-footer \{[^}]*color:\s*#94a3b8/s)
})
