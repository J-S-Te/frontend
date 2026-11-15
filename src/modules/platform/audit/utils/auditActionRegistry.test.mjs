import assert from 'node:assert/strict'
import test from 'node:test'
import { AUDIT_ACTION_CATEGORY, auditActionCategory, auditActionMeta } from './auditActionRegistry.js'

test('审计 action registry 区分通用 HTTP、业务、安全与敏感读', () => {
  assert.equal(auditActionCategory('PROJECT_MANAGEMENT_HTTP_POST_REPORTS'), AUDIT_ACTION_CATEGORY.HTTP)
  assert.equal(auditActionCategory('AUTHENTICATION_DENIED'), AUDIT_ACTION_CATEGORY.SECURITY)
  assert.equal(auditActionCategory('SETTLEMENT_REPORT_EXPORT_DOWNLOADED'), AUDIT_ACTION_CATEGORY.SENSITIVE_READ)
  assert.equal(auditActionCategory('PROJECT_MANAGEMENT:REPORT:SUBMIT'), AUDIT_ACTION_CATEGORY.BUSINESS)
  assert.equal(auditActionCategory(''), '')
})

test('未知 action 保留原编码，不臆造业务名', () => {
  assert.deepEqual(auditActionMeta('FUTURE_ACTION'), { category: AUDIT_ACTION_CATEGORY.BUSINESS, label: 'FUTURE_ACTION' })
  assert.deepEqual(auditActionMeta('AUTHENTICATION_DENIED'), { category: AUDIT_ACTION_CATEGORY.SECURITY, label: '认证失败' })
})
