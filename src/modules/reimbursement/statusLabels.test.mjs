import test from 'node:test'
import assert from 'node:assert/strict'
import { borrowStatusLabels, claimStatusLabel, failureMessage, failureText, packageStatusLabels } from './statusLabels.js'

test('异步任务、原件与审批任务的状态码都显示中文，未知编码保留原文', () => {
  for (const code of ['PROCESSING', 'READY', 'PARSED', 'PARTIAL', 'RECORDED', 'WAITING',
    'TRANSFERRED', 'CANCELLED', 'VERIFIED', 'REJECTED', 'NEEDS_REVIEW', 'SYNCED']) {
    const label = claimStatusLabel(code)
    assert.match(label, /[\u3400-\u9fff]/u, `${code} 应显示中文`)
    assert.notEqual(label, code)
  }
  assert.equal(claimStatusLabel('FUTURE_BACKEND_CODE'), 'FUTURE_BACKEND_CODE')
  assert.equal(claimStatusLabel(''), '待确认')
  assert.equal(packageStatusLabels.PROCESSING, '生成中')
  assert.equal(borrowStatusLabels.PENDING, '待审核')
})

test('失败码翻译为原因和下一步，不把机器码交给用户', () => {
  for (const code of ['PARSER_FAILED', 'PARSE_LEASE_LOST', 'DELIVERY_OR_PROCESSING_FAILED',
    'ARCHIVE_FILE_GATEWAY_UNAVAILABLE', 'EXPORT_LIMIT_EXCEEDED', 'PDF_ENCRYPTED']) {
    const text = failureText(code)
    assert.match(text, /[\u3400-\u9fff]/u)
    assert.match(text, /请|联系/, `${code} 应给出下一步`)
    assert.doesNotMatch(text, new RegExp(code))
  }
  assert.equal(failureText('CHINESE_REASON_ALREADY'), '')
})

test('失败现场优先展示已知原因，未知机器码只给可执行提示', () => {
  assert.match(failureMessage('PARSER_FAILED'), /提取票面字段/)
  assert.match(failureMessage('PARSER_FAILED'), /人工录入/)
  assert.match(failureMessage('历史中文失败原因，需人工核对'), /^历史中文失败原因，需人工核对/)
  assert.match(failureMessage('历史中文失败原因，需人工核对'), /请重试|联系管理员/)
  const unknown = failureMessage('SOME_NEW_BACKEND_CODE')
  assert.match(unknown, /请重试/)
  assert.doesNotMatch(unknown, /SOME_NEW_BACKEND_CODE/)
  assert.match(failureMessage(''), /请重试/)
})
