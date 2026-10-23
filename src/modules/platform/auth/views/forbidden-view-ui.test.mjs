// ForbiddenView 行为约定测试（source-check，对齐 subsystem-access-error-ui.test.mjs 模式）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./ForbiddenView.vue', import.meta.url), 'utf8')

// SEC-X8：from 必须拒绝 //host、含 ::// 的绝对地址与反斜杠伪装。
test('from 参数拒绝 //host、:// 绝对地址与反斜杠 [SEC-X8 回归]', () => {
  assert.match(source, /raw\.startsWith\('\/'\)/)
  assert.match(source, /!raw\.startsWith\('\/\/'\)/)
  assert.match(source, /!raw\.includes\('\:\/\/'\)/)
  assert.match(source, /!raw\.includes\('\\\\'\)/)
})

test('原始请求只渲染经过校验的 fromPath', () => {
  assert.match(source, /原始请求：<code>\{\{ fromPath \}\}<\/code>/)
  assert.match(source, /const fromPath = computed/)
})

// 有效会话存在时，登录路由守卫会恢复会话并把用户送回门户；切号必须先结束会话。
test('切换账号先结束当前会话，再进入登录页', () => {
  assert.match(source, /import \{ logoutCurrentSession \} from '@\/modules\/platform\/auth\/api\/auth'/)
  assert.match(source, /await logoutCurrentSession\(\)/)
  assert.match(source, /clearAuthorizationSnapshot\(\)/)
  assert.match(source, /router\.push\(\{ name: 'login', query: \{ reason: 'forbidden' \} \}\)/)
  // 退出失败（会话已失效）也不能把用户卡在错误页。
  assert.match(source, /catch \{\s*\n\s*\/\/ 退出失败通常意味着会话已失效/)
})
