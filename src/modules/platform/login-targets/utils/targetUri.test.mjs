import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidTargetUri, targetUriValidationMessage } from './targetUri.js'

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

test('超过 2048 或包含非可打印字符时被拒绝', () => {
  assert.equal(isValidTargetUri(`/${'a'.repeat(2048)}`), false)
  assert.equal(isValidTargetUri('/path with space'), false)
  assert.equal(isValidTargetUri('/路径/中文'), false)
  assert.equal(targetUriValidationMessage(null), '请填写批准跳转地址。')
})
