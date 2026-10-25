import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultAccountValidUntil,
  optionalText,
  parseBatchUserRows,
  resolveExpiresAt,
  validateLocalAccountInput,
  validateUserInput,
} from './userInputValidation.js'
import { IamError } from '../api/iam.js'

test('validateUserInput normalizes fields and defaults status', () => {
  const result = validateUserInput({ displayName: '  张三 ', email: ' a@B.io ', mobile: ' 138-0013 8000 ', status: '' })
  // 与提取前一致：手机号仅去首尾空白，内嵌空格/连字符只在校验时压缩，不回写。
  assert.deepEqual(result, { displayName: '张三', email: 'a@B.io', mobile: '138-0013 8000', status: 'ACTIVE' })
})

test('validateUserInput rejects blank name, long name and bad email/mobile with original messages', () => {
  assert.throws(() => validateUserInput({ displayName: ' ' }), IamErrorWith('请填写用户姓名。'))
  assert.throws(() => validateUserInput({ displayName: '长'.repeat(101) }), IamErrorWith('用户姓名不能超过 100 个字符。'))
  assert.throws(() => validateUserInput({ displayName: '张三', email: 'not-an-email' }), IamErrorWith('邮箱格式不正确。'))
  assert.throws(() => validateUserInput({ displayName: '张三', mobile: '138abc' }), IamErrorWith('手机号只能包含数字、空格、连字符或开头的加号。'))
  assert.throws(() => validateUserInput({ displayName: '张三', mobile: '1'.repeat(33) }), IamErrorWith('手机号不能超过 32 个字符。'))
})

test('parseBatchUserRows splits rows, prefixes row labels and enforces bounds', () => {
  const rows = parseBatchUserRows('张三, a@b.io\n李四,,', 'ACTIVE')
  assert.deepEqual(rows.map(row => row.displayName), ['张三', '李四'])
  assert.throws(() => parseBatchUserRows(''), IamErrorWith('请至少填写一行用户数据。'))
  assert.throws(() => parseBatchUserRows(Array.from({ length: 101 }, () => '用户').join('\n')), IamErrorWith('一次最多批量创建 100 位用户。'))
  assert.throws(() => parseBatchUserRows('张三,a@b.io,13800138000,extra'), IamErrorWith('第 1 行：字段过多，请使用“姓名,邮箱,手机号”格式。'))
  assert.throws(() => parseBatchUserRows('\n'), IamErrorWith('请至少填写一行用户数据。'))
})

test('validateLocalAccountInput enforces account and password rules', () => {
  assert.deepEqual(validateLocalAccountInput(' ops.admin-1 ', 'Sup3r$ecret'), { accountName: 'ops.admin-1', password: 'Sup3r$ecret' })
  assert.throws(() => validateLocalAccountInput('ab', 'Sup3r$ecret'), IamErrorWith('账号名长度必须为 3–64 个字符。'))
  assert.throws(() => validateLocalAccountInput('-bad', 'Sup3r$ecret'), IamErrorWith('账号名必须以字母或数字开头，且只能包含字母、数字、点、下划线和连字符。'))
  assert.throws(() => validateLocalAccountInput('opsadmin', 'short'), IamErrorWith('初始密码长度必须为 8–128 个字符。'))
  assert.throws(() => validateLocalAccountInput('opsadmin', 'has space123A'), IamErrorWith('初始密码不能包含空白字符。'))
  assert.throws(() => validateLocalAccountInput('opsadmin', 'onlylowercase1'), IamErrorWith('初始密码必须同时包含大写字母、小写字母、数字和特殊字符。'))
})

test('optionalText, resolveExpiresAt and defaultAccountValidUntil keep original semantics', () => {
  assert.equal(optionalText('  '), null)
  assert.equal(optionalText(' x '), 'x')
  assert.equal(resolveExpiresAt(''), null)
  assert.equal(resolveExpiresAt('not-a-date'), null)
  assert.equal(resolveExpiresAt('2026-01-02T03:04:05Z'), '2026-01-02T03:04:05.000Z')
  const value = defaultAccountValidUntil()
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
})

function IamErrorWith(message) {
  return (error) => error instanceof IamError && error.message === message
}
