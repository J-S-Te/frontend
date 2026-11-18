import assert from 'node:assert/strict'
import { test } from 'node:test'
import { notificationTargetPath } from './target.js'

const ORIGIN = 'https://crm.example'

test('通知跳转接受同源业务路径并保留查询参数', () => {
  assert.equal(
    notificationTargetPath('/customer-opportunity/opportunities?opportunity_id=31', ORIGIN),
    '/customer-opportunity/opportunities?opportunity_id=31',
  )
  assert.equal(
    notificationTargetPath('https://crm.example/customer-opportunity/presale?request_id=17', ORIGIN),
    '/customer-opportunity/presale?request_id=17',
  )
})

test('通知跳转拒绝跨源、协议相对、凭据和非法协议', () => {
  for (const target of [
    'https://evil.example/customer-opportunity/opportunities?opportunity_id=31',
    '//evil.example/customer-opportunity/opportunities?opportunity_id=31',
    'https://user:pass@crm.example/customer-opportunity/opportunities?opportunity_id=31',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '',
    null,
  ]) assert.equal(notificationTargetPath(target, ORIGIN), '')
})

test('缺少可信 origin 时失败关闭', () => {
  assert.equal(notificationTargetPath('/customer-opportunity/opportunities?opportunity_id=31', ''), '')
})
