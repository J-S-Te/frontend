// 数据看板外壳迁移到 shared/AppShell 后的可达性契约。
//
// 视图不再自己实现 aside/main/汉堡/Escape，而是把导航、品牌、用户区和顶栏插槽
// 交给 AppShell；外壳只保留一份键盘与读屏实现。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const da = readFileSync(new URL('./views/DashboardShellView.vue', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../shared/components/AppShell.vue', import.meta.url), 'utf8')

test('数据看板视图使用 AppShell，不再自建 aside/main', () => {
  assert.match(da, /<AppShell\b/)
  assert.match(da, /:nav-groups="appShellNavGroups"/)
  assert.doesNotMatch(da, /<aside\b/)
  assert.doesNotMatch(da, /<main\b/)
  assert.doesNotMatch(da, /closeMenuOnEscape/)
})

test('AppShell 提供唯一的 main 落点、汉堡关联与 Escape 收起', () => {
  assert.match(shell, /<main[^>]*:id="mainId"/)
  assert.match(shell, /mainId: \{ type: String, default: 'main-content' \}/)
  assert.match(shell, /aria-controls="SIDEBAR_ID"/)
  assert.match(shell, /function closeMenuOnEscape\(event\)/)
  assert.match(shell, /document\.addEventListener\('keydown', closeMenuOnEscape\)/)
  assert.match(shell, /document\.removeEventListener\('keydown', closeMenuOnEscape\)/)
  assert.match(shell, /menuButton\.value\?\.focus\?\.\(\)/)
})
