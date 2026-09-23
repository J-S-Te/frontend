import assert from 'node:assert/strict'
import test from 'node:test'
import { RECIPIENT_PHONE_MAX_LENGTH, validateRecipientPhoneNumber } from './utils/recipientPhone.js'

// C-ii（task-62）：寄送表单收件人手机号校验与后端契约对齐。
test('与后端 MaxSigningPhonePlaintextLen 对齐为 20 字符上限', () => {
  assert.equal(RECIPIENT_PHONE_MAX_LENGTH, 20)
})

test('空值与空白被拒绝（后端 TrimSpace 后非空必填）', () => {
  for (const value of ['', '   ', null, undefined]) {
    assert.notEqual(validateRecipientPhoneNumber(value), '', String(value) + ' 应被拒绝')
  }
})

test('读接口返回的掩码号码不能直接提交 [C-ii 回归]', () => {
  // task-43 后读接口回显 138****5678；掩码含 *，必须要求操作员重新输入完整号码，
  // 避免"回显掩码 + 直接保存"把掩码写回后端覆盖真实手机号。
  assert.notEqual(validateRecipientPhoneNumber('138****5678'), '')
})

test('合法手机号通过校验（允许 +、空格、- 分隔）', () => {
  const accepted = ['13800138000', '+86 138-0013-8000', '0755-12345678', '123456']
  for (const value of accepted) {
    assert.equal(validateRecipientPhoneNumber(value), '', value + ' 应通过')
  }
})

test('超长与非法格式被拒绝', () => {
  assert.notEqual(validateRecipientPhoneNumber('1'.repeat(21)), '')
  assert.notEqual(validateRecipientPhoneNumber('abc'), '')
  assert.notEqual(validateRecipientPhoneNumber('1380013800a'), '')
  assert.notEqual(validateRecipientPhoneNumber('12345'), '') // 小于最短数字位数
})
