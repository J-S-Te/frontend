import test from 'node:test'
import assert from 'node:assert/strict'
import { borrowStatusLabels, claimStatusLabel, claimStatusTone, failureMessage, failureText, packageStatusLabels, parseIssueLabel } from './statusLabels.js'

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

test('解析问题码显示中文人工核对提示，字段缺失不暴露机器码', () => {
  assert.equal(parseIssueLabel('TEXT_EXTRACTION_IS_NOT_TAX_VERIFICATION'), '仅提取票面文字，不代表税务验真')
  assert.equal(parseIssueLabel('MANUAL_CONFIRMATION_REQUIRED'), '需人工确认')
  assert.equal(parseIssueLabel('DETAIL_AMOUNTS_INCOMPLETE'), '明细金额不完整')
  assert.equal(parseIssueLabel('FIELD_MISSING:gross_minor'), '缺少字段：价税合计（票面总额）')
  assert.equal(parseIssueLabel('FIELD_CONFLICT:invoice_number'), '字段存在冲突：发票号码')
  assert.equal(parseIssueLabel('AMOUNT_PRECISION_OR_FORMAT_INVALID:tax_minor'), '金额格式或精度需核对：税额')
  const unknown = parseIssueLabel('FUTURE_PARSER_ISSUE')
  assert.match(unknown, /[\u3400-\u9fff]/u)
  assert.doesNotMatch(unknown, /FUTURE_PARSER_ISSUE/)
})

test('状态胶囊 tone 稳定，未知状态不被误标为成功', () => {
  assert.equal(claimStatusTone('PAID'), 'success')
  assert.equal(claimStatusTone('IN_APPROVAL'), 'warning')
  assert.equal(claimStatusTone('RETURNED'), 'danger')
  assert.equal(claimStatusTone('APPROVED'), 'info')
  assert.equal(claimStatusTone('DRAFT'), 'gray')
  assert.equal(claimStatusTone('FUTURE_BACKEND_CODE'), 'gray')
  assert.equal(claimStatusTone(''), 'gray')
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
