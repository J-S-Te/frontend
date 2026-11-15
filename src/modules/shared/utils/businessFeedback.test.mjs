import assert from 'node:assert/strict'
import test from 'node:test'
import { formatUserError, userFieldErrors } from './userError.js'

test('通用写入故障从各客户端方法字段识别结果未知，不只显示服务处理失败', () => {
  for (const context of [
    { method: 'POST' }, { request_method: 'PATCH' }, { context: { method: 'DELETE' } },
  ]) {
    const message = formatUserError({
      status: 500, code: 'SETTLEMENT_INTERNAL_ERROR', message: '服务处理失败', ...context,
    })
    assert.match(message, /确认操作结果/)
    assert.match(message, /核对.*重复提交/)
  }
  assert.match(formatUserError({ status: 503, message: '服务暂不可用' }), /服务.*暂时/)
})

test('调用链已标记结果未知时不能被具体中文或业务错误码覆盖', () => {
  const error = {
    status: 409, code: 'METRIC_IN_USE', message: '当前记录已被引用，不能删除。',
    outcomeUnknown: true, method: 'POST',
  }
  assert.match(formatUserError(error), /确认操作结果.*核对.*重复提交/)
  assert.equal(formatUserError({ ...error, outcomeUnknown: false }), error.message)
})

test('顶层字段错误与details中的错误均能解释具体输入，不回显拒绝值', () => {
  const message = formatUserError({ status: 422,
    field_errors: [{ field: 'email', rule: 'email', value: 'private-input' }],
  })
  assert.match(message, /邮箱格式不正确/)
  assert.doesNotMatch(message, /private-input/)
})

test('嵌套费用发票错误保留真实路径和费用行号，金额不被叫作合同金额', () => {
  const path = 'items[2].invoice_usages[0].amount_minor'
  const issues = userFieldErrors({ issues: [{ field: path, rule: 'max' }] })
  assert.equal(issues[0].field, path)
  assert.match(issues[0].message, /^第 3 行：金额/)
  assert.doesNotMatch(issues[0].message, /合同|items\[|invoice_usages/)
})

test('相同字段的跨行错误不会被去重丢失，输出仍保持数量上限', () => {
  const issues = userFieldErrors({ issues: Array.from({ length: 10 }, (_, index) => ({
    field: `items[${index}].email`, rule: 'email',
  })) })
  assert.equal(issues.length, 3)
  assert.match(issues[0].message, /^第 1 行：/)
  assert.match(issues[1].message, /^第 2 行：/)
  assert.match(issues[2].message, /^第 3 行：/)
})

test('新增财务和任职字段有可执行中文，确定的审批配置拒绝不被改成未知', () => {
  for (const field of ['paid_date', 'transaction_no', 'source_account_ref', 'voucher_file_ids', 'membership_type']) {
    const issues = userFieldErrors([{ field, rule: 'required' }])
    assert.equal(issues.length, 1, field)
    assert.doesNotMatch(issues[0].message, new RegExp(field))
    assert.match(issues[0].message, /请(?:填写|选择|添加)/)
  }
  const message = '审批流程缺少可用审批人，本次未提交。请联系管理员补充审批人员后重试。'
  assert.equal(formatUserError({ status: 503, code: 'APPROVAL_SETUP_MISSING', message },
    { method: 'POST' }), message)
})

test('未知字段与异常字段映射不应让错误提示自身崩溃', () => {
  for (const field of ['constructor', '__proto__', 'toString', 'unknown_field']) {
    assert.deepEqual(userFieldErrors([{ field, rule: 'required' }]), [])
  }
})
