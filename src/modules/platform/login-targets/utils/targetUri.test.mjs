import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidTargetUri, isSafeOpenTarget, targetUriValidationMessage } from './targetUri.js'

test('相对路径与绝对 https 均被视为有效', () => {
  const valid = [
    '/dashboard',
    '/reports/monthly',
    '/customer-portal/',
    '/customer-opportunity/',
    'https://contracts.example.com/dashboard',
    'https://portal.example.com/workbench',
  ]
  for (const value of valid) {
    assert.equal(isValidTargetUri(value), true, `${value} 应为有效`)
    assert.equal(targetUriValidationMessage(value), '', `${value} 不应有错误提示`)
  }
})

test('后端拒绝的输入在前端同样被拒绝', () => {
  const invalid = [
    'http://contracts.example.com/dashboard',
    '//evil.example/dashboard',
    'evil.example/dashboard',
    '/../admin',
    '/%2e%2e/admin',
    '/reports%2fadmin',
    '/%252e%252e/admin',
    '/reports\\admin',
    '/reports%5cadmin',
    '/dashboard?next=/admin',
    '/dashboard#section',
    '',
    ' ',
    'https://user:pass@example.com/dashboard',
  ]
  for (const value of invalid) {
    assert.equal(isValidTargetUri(value), false, `${value} 应为无效`)
    assert.notEqual(targetUriValidationMessage(value), '', `${value} 应返回错误提示`)
  }
})

// SEC-X2 回归：window.open / location.replace 前的打开目标白名单。
test('isSafeOpenTarget 拒绝 javascript:/data://host，放行 https 与同源路径', () => {
  const base = 'https://platform.example.com/console'
  const rejected = [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example/dashboard',
    '//evil.example/',
    'http://evil.example/dashboard',
    'https://user:pass@example.com/dashboard',
    '',
    '   ',
  ]
  for (const value of rejected) {
    assert.equal(isSafeOpenTarget(value, base), false, `${value} 应被拒绝`)
  }
  const accepted = [
    'https://portal.example.com/external-system',
    '/customer-portal/',
    '/customer-opportunity/auth/login?return_to=%2Fcustomer-opportunity%2Fcustomers',
    'https://platform.example.com/other-path',
  ]
  for (const value of accepted) {
    assert.equal(isSafeOpenTarget(value, base), true, `${value} 应被放行`)
  }
  assert.equal(isSafeOpenTarget(null, base), false)
  // 严格单斜杠相对路径本身即同源，base 缺失不影响其安全性；http 绝对地址在无 base 时无法收敛，拒绝。
  assert.equal(isSafeOpenTarget('/path', ''), true)
  assert.equal(isSafeOpenTarget('http://other-host.example/path', ''), false)
  // 开发环境 http 同源仍然可用（同源 http(s) 收敛放行）。
  assert.equal(isSafeOpenTarget('/dev/path', 'http://localhost:5173'), true)
  assert.equal(isSafeOpenTarget('http://other-host:8080/x', 'http://localhost:5173'), false)
})

test('超过 2048 或包含非可打印字符时被拒绝', () => {
  assert.equal(isValidTargetUri(`/${'a'.repeat(2048)}`), false)
  assert.equal(isValidTargetUri('/path with space'), false)
  assert.equal(isValidTargetUri('/路径/中文'), false)
  assert.equal(targetUriValidationMessage(null), '请填写批准跳转地址。')
})
