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
