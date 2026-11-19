// 项目管理外壳迁移到 shared/AppShell 后的可达性契约。
//
// 视图不再自己实现 aside/main/汉堡/Escape，只提供导航数据、品牌、用户区和顶栏插槽；
// 键盘与读屏实现只保留在 AppShell 一份。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pm = readFileSync(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../shared/components/AppShell.vue', import.meta.url), 'utf8')

test('项目管理视图使用 AppShell，不再自建 aside/main', () => {
  assert.match(pm, /<AppShell\b/)
  assert.match(pm, /:nav-groups="appShellNavGroups"/)
  assert.doesNotMatch(pm, /<main\b/)
  assert.doesNotMatch(pm, /mobileMenuButton/)
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
