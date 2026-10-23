import assert from 'node:assert/strict'
import test from 'node:test'
import { formatUserError, safeUserMessage, userFieldErrors, userErrorDiagnostics } from './userError.js'

test('precise safe localized business messages survive generic HTTP classification', () => {
  const message = '当前服务项尚未完成实施准备，不能开始现场测评。'
  assert.equal(formatUserError({ status: 409, code: 'PM_PRECONDITION_FAILED', message }), message)
  assert.equal(formatUserError({ status: 422, message: '请先选择 CRM 客户。' }), '请先选择 CRM 客户。')
})

test('approval assignee configuration failure is an explicit not-submitted rejection, not an unknown write outcome', () => {
  const message = '审批流程缺少可用审批人：销售总监。本次未提交。请先在基础平台为合同应用分配相应角色的人员，或调整审批规则后重试。'
  const result = formatUserError({ status: 422, code: 'CON_APPROVAL_ASSIGNEE_UNAVAILABLE', message }, { method: 'POST' })
  assert.equal(result, message)
  assert.doesNotMatch(result, /无法确认操作结果|刷新列表|重复提交/)
  const fallback = formatUserError({ status: 422, code: 'CON_APPROVAL_ASSIGNEE_UNAVAILABLE' }, { method: 'POST' })
  assert.match(fallback, /缺少可用审批人/)
  assert.match(fallback, /本次未提交/)
})

test('English, proxy HTML, SQL, stack and credentials never become user-facing text', () => {
  for (const value of ['invalid request', '<html><body>502 Bad Gateway</body></html>', '查询失败 SQLSTATE 42000 SELECT secret FROM user', '服务错误 https://private.example/api/v1/debug', '处理失败 client_secret=private', '查询失败 /Users/operator/secret.txt', '接口异常 TypeError: undefined', '追踪 trace_id=private', '同步失败：dial tcp 10.0.0.2:3306: connection refused', '报表生成失败：Error 1146 (42S02) internal_table']) {
    assert.equal(safeUserMessage(value), '')
    const result = formatUserError({ status: 500, message: value })
    assert.match(result, /服务.*暂时|暂时无法/)
    assert.doesNotMatch(result, /SELECT|SQLSTATE|secret|TypeError|html|private/)
  }
})

test('parameter type/version mismatches blame incompatible page data, not nonexistent mandatory input', () => {
  for (const error of [
    { status: 422, code: 'CON_VALIDATION_ERROR', details: { reason: 'unknown_field', field: 'private_debug_value' } },
    { status: 400, code: 'CON_VALIDATION_ERROR', details: { reason: 'invalid_type', field: 'amount_minor' } },
    { status: 400, code: 'PM_INVALID_JSON', message: '请求内容不合法' },
    { status: 422, message: 'json: cannot unmarshal string into Go struct field Body.Version of type uint64' },
  ]) {
    const result = formatUserError(error)
    assert.match(result, /格式与服务要求不一致/)
    assert.match(result, /刷新.*管理员/)
    assert.doesNotMatch(result, /private_debug_value|uint64|Body.Version/)
  }
})

test('localized prefixes do not make database diagnostics safe for toasts or field issues', () => {
  for (const message of [
    '查询失败：Table db.customers does not exist',
    '保存失败：Duplicate entry example-value for key users.email',
    '加载失败：Unknown column internal_customer_secret in field list',
    '查询失败：column customer_secret does not exist',
    '保存失败：duplicate key value violates unique constraint customers_key',
    '保存失败：foreign key constraint fails customers.account_id',
  ]) {
    assert.equal(safeUserMessage(message), '')
    assert.doesNotMatch(formatUserError({ status: 500, message }), /Table|column|Duplicate|example-value|customers|users\.email|constraint/)
    assert.deepEqual(userFieldErrors({ issues: [{ field: 'email', rule: 'required', message }] }), [{ field: 'email', message: '请填写邮箱。' }])
  }
})

test('technical commands and raw environment keys remain diagnostics rather than user instructions', () => {
  for (const message of ['请执行 docker compose restart api', '请执行 sudo systemctl restart service', '请检查 CONTRACT_CLIENT_SECRET 后重新部署', '错误代码 AUTH_TOKEN_EXCHANGE_FAILED，请重试']) {
    assert.equal(safeUserMessage(message), '')
    assert.doesNotMatch(formatUserError({ status: 503, message }), /docker|sudo|systemctl|CONTRACT_CLIENT_SECRET|AUTH_TOKEN_EXCHANGE_FAILED/)
  }
  assert.equal(safeUserMessage('请联系管理员检查应用接入配置。'), '请联系管理员检查应用接入配置。')
})

test('field issues identify selection, input and stale hidden versions without values', () => {
  const error = { status: 422, details: { issues: [{ field: 'crm_customer_id', rule: 'required', value: 'secret-id' }, { field: 'services[0].batch', rule: 'required' }, { field: 'version', rule: 'required' }] } }
  const result = formatUserError(error)
  assert.match(result, /请选择客户/)
  assert.match(result, /请填写实施批次/)
  assert.match(result, /刷新后重新操作/)
  assert.doesNotMatch(result, /secret-id|version|services\[/)
  assert.equal(formatUserError({ status: 422, message: "Key: 'Create.CRMCustomerID' Error:Field validation for 'CRMCustomerID' failed on the 'required' tag" }), '请选择客户。')
})

test('batch field validation remains bounded and supports row number', () => {
  const result = userFieldErrors({ issues: Array.from({ length: 30 }, (_, index) => ({ field: 'email', row: index + 1, rule: 'email' })) })
  assert.ok(result.length <= 3)
  assert.match(result[0].message, /^第 1 行：邮箱格式不正确/)
})

test('no HTTP label is used as the only action guidance', () => {
  for (const [status, pattern] of [[401, /登录/], [403, /权限/], [404, /不存在.*刷新/], [409, /状态.*刷新/], [413, /过大/], [415, /格式.*模板/], [422, /校验.*必填/], [429, /频繁.*稍候/], [500, /服务.*暂时/], [504, /超时/]]) {
    const result = formatUserError({ status, message: `HTTP ${status}` })
    assert.match(result, pattern)
    assert.doesNotMatch(result, /HTTP/)
  }
})

test('mutating timeout, broken response and network ambiguity never suggest blind re-submission', () => {
  for (const input of [{ code: 'NETWORK_ERROR' }, { code: 'CRM_NETWORK_ERROR' }, { code: 'PORTAL_NETWORK_ERROR' }, { status: 504 }, { code: 'INVALID_RESPONSE', status: 201 }, { code: 'CRM_RESPONSE_INVALID', status: 201 }, { code: 'INVALID_CONTRACT_RESPONSE', status: 201 }, { status: 500 }, { name: 'AbortError' }]) {
    const result = formatUserError(input, { method: 'POST' })
    assert.match(result, /确认操作结果/)
    assert.match(result, /核对.*重复提交/)
  }
  assert.match(formatUserError({ code: 'NETWORK_ERROR' }, { method: 'GET' }), /检查网络连接后重试/)
})

test('technical diagnostics require opt-in, are bounded identifiers, and never enter message', () => {
  const error = { status: 409, code: 'IAM_VERSION_CONFLICT', requestID: 'req-safe-1', details: { detail: 'SQLSTATE sensitive', next_action: 'private internal command' } }
  assert.deepEqual(userErrorDiagnostics(error), { code: 'IAM_VERSION_CONFLICT', requestId: 'req-safe-1' })
  assert.doesNotMatch(formatUserError(error), /req-safe-1|SQLSTATE|next_action/)
  assert.deepEqual(userErrorDiagnostics({ code: '<script>', traceId: 'https://secret?token=key' }), { code: '', requestId: '' })
})
