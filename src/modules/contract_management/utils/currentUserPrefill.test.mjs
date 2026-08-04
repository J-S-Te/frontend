import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTemplateValues, currentUserValueForTemplateField } from './currentUserPrefill.js'

const session = {
  display_name: '章六',
  user_name: 'zhangliu',
  email: 'zhangliu@example.com',
}

test('maps current user profile to common contract template field names and labels', () => {
  assert.equal(currentUserValueForTemplateField({ name: 'applicant_name' }, session), '章六')
  assert.equal(currentUserValueForTemplateField({ name: 'custom', label: '经办人姓名' }, session), '章六')
  assert.equal(currentUserValueForTemplateField({ name: 'login_name' }, session), 'zhangliu')
  assert.equal(currentUserValueForTemplateField({ label: '电子邮箱' }, session), 'zhangliu@example.com')
})

test('keeps existing and administrator defaults ahead of profile prefill', () => {
  const fields = [
    { name: 'applicant_name', default: '管理员预设' },
    { name: 'owner_name' },
    { name: 'email' },
  ]
  assert.deepEqual(buildTemplateValues(fields, session, { email: 'manual@example.com' }), {
    applicant_name: '管理员预设',
    owner_name: '章六',
    email: 'manual@example.com',
  })
})

test('leaves unrelated fields empty', () => {
  assert.equal(currentUserValueForTemplateField({ name: 'customer_name' }, session), '')
})
