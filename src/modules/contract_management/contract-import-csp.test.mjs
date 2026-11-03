import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const nginxConfig = readFileSync(new URL('../../../nginx/default.conf', import.meta.url), 'utf8')
const cspLines = nginxConfig.split('\n').filter((line) => line.includes('add_header Content-Security-Policy'))

test('合同 Excel 大条目解压所需的 blob worker 已在所有 CSP 位置显式放行', () => {
  assert.ok(cspLines.length > 0, '必须存在 CSP 头')
  for (const line of cspLines) {
    assert.match(line, /worker-src 'self' blob:/, '每个 CSP 位置都必须允许同源 blob worker')
  }
})

test('CSP 仍保持脚本仅同源，不引入 unsafe-eval 或远程脚本', () => {
  for (const line of cspLines) {
    assert.match(line, /script-src 'self'/)
    assert.doesNotMatch(line, /unsafe-eval|https?:\/\//)
  }
})
