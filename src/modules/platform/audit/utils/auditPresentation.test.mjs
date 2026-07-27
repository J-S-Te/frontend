import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  auditActionCode,
  auditActionLabel,
  auditHttpStatusLabel,
  auditResultLabel,
  auditResultMeta,
  auditResultSummary,
  auditResultTone,
} from './auditPresentation.js'

test('成功登录在缺少 HTTP 状态码时显示真实业务状态且不显示占位符', () => {
  const record = {
    action: 'auth.login',
    type: 'auth.login',
    result: 'SUCCESS',
    resultLabel: '成功',
    riskLabel: '低',
    statusCode: 0,
  }

  assert.equal(auditActionLabel(record), '登录')
  assert.equal(auditActionCode(record), 'auth.login')
  assert.equal(auditResultLabel(record), '登录成功')
  assert.equal(auditHttpStatusLabel(record.statusCode), '')
  assert.equal(auditResultMeta(record), '低风险')
  assert.equal(auditResultSummary(record), '登录成功 · 低风险')
  assert.equal(auditResultTone(record.result), 'audit-result-success')
})

test('失败登录使用失败语义并保留后端真实 HTTP 状态码', () => {
  const record = {
    action: 'auth.login.failed',
    result: 'FAILURE',
    riskLabel: '中',
    statusCode: 401,
  }

  assert.equal(auditActionLabel(record), '登录失败')
  assert.equal(auditResultLabel(record), '登录失败')
  assert.equal(auditHttpStatusLabel(record.statusCode), 'HTTP 401')
  assert.equal(auditResultMeta(record), 'HTTP 401 · 中风险')
  assert.equal(auditResultSummary(record), '登录失败 · HTTP 401 · 中风险')
  assert.equal(auditResultTone(record.result), 'audit-result-denied')
})

test('未知操作和结果保持后端原值，不猜测业务名称', () => {
  const record = { action: 'custom.sync', result: 'QUEUED', risk: 'LOW' }

  assert.equal(auditActionLabel(record), 'custom.sync')
  assert.equal(auditResultLabel(record), 'QUEUED')
  assert.equal(auditResultTone(record.result), 'audit-result-unknown')
})
