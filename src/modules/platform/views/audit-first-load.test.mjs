import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 直接打开 /audit（不是从设置页切过去）时，currentView 从初始值起就是 'audit'，
// 只监听"变化"的 watch 永远不会执行，页面停在空列表。权限同样在挂载后才就绪。
const consoleView = readFileSync(fileURLToPath(new URL('./PlatformConsoleView.vue', import.meta.url)), 'utf8')

test('审计视图有统一的首次加载入口，且在被路由直接打开时也会查询', () => {
  assert.match(consoleView, /function loadAuditViewOnce\(\) \{/)
  assert.match(consoleView, /if \(currentView\.value !== 'audit' \|\| !canViewAudit\.value\) return/)
  assert.match(consoleView, /loadAuditViewOnce\(\)/)
  // 权限就绪（principal 到达）后必须补一次查询。
  const principalWatcher = consoleView.slice(consoleView.indexOf('watch(principal, (current) => {'))
  const watcherBody = principalWatcher.slice(0, principalWatcher.indexOf('\n})'))
  assert.match(watcherBody, /loadAuditViewOnce\(\)/)
})
