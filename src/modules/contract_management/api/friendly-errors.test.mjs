import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { formatUserError } from '../../shared/utils/userError.js'
import { attachStructuredContext } from '../../platform/shared/api/requestContext.js'
import { normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin, subsystemAccessMessage } from '../../shared/authz/sessionCompatibility.js'

const source = (await readFile(new URL('./contract.js', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replaceAll('import.meta.env', '({})').replace(/^export /gm, '')

function client() {
  return new Function('formatUserError', 'attachStructuredContext', 'normalizeAuthorizationSession', 'principalIdentityID', 'shouldStartSubsystemLogin', 'subsystemAccessMessage',
    `${source}; return { request, requestBusinessDirectory, ContractAuthError, downloadContractFile };`)(formatUserError, attachStructuredContext, normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin, subsystemAccessMessage)
}

async function withFetch(fetcher, run) {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window
  const redirects = []
  globalThis.fetch = fetcher
  globalThis.window = { location: { replace: (url) => redirects.push(url) } }
  try { return await run(redirects) }
  finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow }
}
const response = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

test('合同参数错误显示具体中文并完整保留字段、状态和追踪信息', async () => {
  const body = { code: 'CON_VALIDATION_ERROR', message: 'validation failed', details: { fields: [{ field: 'crm_customer_id', rule: 'required' }] }, field_errors: { crm_customer_id: 'required' }, request_id: 'contract-request-1', trace_id: 'trace-1' }
  await withFetch(async () => response(422, body), async () => {
    await assert.rejects(client().request('/contracts', { method: 'POST', body: '{}' }), error => {
      assert.equal(error.status, 422)
      assert.equal(error.code, 'CON_VALIDATION_ERROR')
      assert.equal(error.requestID, 'contract-request-1')
      assert.equal(error.context.traceId, 'trace-1')
      assert.deepEqual(error.details, body.details)
      assert.deepEqual(error.fieldErrors, body.field_errors)
      assert.match(error.message, /选择.*客户/)
      assert.doesNotMatch(error.message, /validation failed|crm_customer_id/)
      return true
    })
  })
})

test('未知字段与类型契约不一致不误报成用户没有填写必填项', async () => {
  for (const reason of ['unknown_field', 'invalid_type', 'invalid_json']) {
    await withFetch(async () => response(422, { code: 'CON_VALIDATION_ERROR', message: 'json: unknown field private_field', details: { reason } }), async () => {
      await assert.rejects(client().request('/contracts/external', { method: 'POST' }), error => {
        assert.match(error.message, /数据格式.*服务要求不一致/)
        assert.doesNotMatch(error.message, /必填|private_field|json:/)
        return true
      })
    })
  }
})

test('合同原始 SQL、HTML、英文异常不会进入用户提示', async () => {
  for (const message of ['SQLSTATE 23000: INSERT INTO secret_table VALUES (...)', '<html>504 gateway</html>', 'panic: cannot unmarshal']) {
    await withFetch(async () => response(500, { code: 'CON_INTERNAL_ERROR', message }, { 'x-request-id': 'diagnostic-1' }), async () => {
      await assert.rejects(client().request('/contracts'), error => {
        assert.match(error.message, /服务|管理员/)
        assert.doesNotMatch(error.message, /SQLSTATE|secret_table|<html>|panic|unmarshal/)
        assert.equal(error.requestID, 'diagnostic-1')
        assert.equal(error.code, 'CON_INTERNAL_ERROR')
        return true
      })
    })
  }
})

test('审批人未配置是明确的未提交拒绝，不提示写入结果未知', async () => {
  const message = '审批流程缺少可用审批人：销售总监、技术总监、财务总监。本次未提交。请先在基础平台为合同应用分配相应角色的人员，或调整审批规则后重试。'
  await withFetch(async () => response(422, { code: 'CON_APPROVAL_ASSIGNEE_UNAVAILABLE', message, details: { role_codes: ['sales_director', 'tech_director', 'finance_director'] } }), async () => {
    await assert.rejects(client().request('/contracts/contract-1/submit-approval', { method: 'POST', body: '{}' }), error => {
      assert.equal(error.status, 422)
      assert.equal(error.code, 'CON_APPROVAL_ASSIGNEE_UNAVAILABLE')
      assert.equal(error.outcomeUnknown, undefined)
      assert.match(error.message, /销售总监/)
      assert.match(error.message, /本次未提交/)
      assert.doesNotMatch(error.message, /无法确认操作结果|刷新列表|重复提交/)
      assert.deepEqual(error.details.role_codes, ['sales_director', 'tech_director', 'finance_director'])
      return true
    })
  })
})

test('写入中断和损坏成功响应明确结果未知，不自动重发或鼓励重复创建', async () => {
  for (const fetcher of [async () => { throw new TypeError('Failed to fetch') }, async () => new Response('<html>portal</html>', { headers: { 'content-type': 'text/html' } })]) {
    let count = 0
    await withFetch(async (...args) => { count++; return fetcher(...args) }, async () => {
      await assert.rejects(client().request('/contracts', { method: 'POST', body: '{}' }), error => {
        assert.equal(error.outcomeUnknown, true)
        assert.match(error.message, /核对.*不要重复提交/)
        assert.doesNotMatch(error.message, /Failed to fetch|<html>/)
        return true
      })
    })
    assert.equal(count, 1)
  }
})

test('合同保留过期会话单次重登录、配置类认证错误和跨系统禁止跳转边界', async () => {
  await withFetch(async () => response(401, { code: 'CON_UNAUTHENTICATED' }), async redirects => {
    const api = client()
    await assert.rejects(api.request('/contracts'), error => error instanceof api.ContractAuthError && error.status === 401)
    await assert.rejects(api.request('/contracts'))
    assert.equal(redirects.length, 1)
  })
  for (const [status, code, options] of [[401, 'OIDC_CLAIMS_INVALID', {}], [401, 'CON_UNAUTHENTICATED', { suppressLoginRedirect: true }], [403, 'CON_FORBIDDEN', {}]]) {
    await withFetch(async () => response(status, { code }), async redirects => {
      await assert.rejects(client().request('/contracts', options), error => error.status === status && error.code === code)
      assert.equal(redirects.length, 0)
    })
  }
})

test('CRM 目录错误保留字段诊断，错误页面不会伪装成空客户列表', async () => {
  await withFetch(async () => response(403, { code: 'CRM_SCOPE_FORBIDDEN', message: '客户不在当前权限范围内', details: { reason: 'scope' }, request_id: 'directory-1' }), async () => {
    await assert.rejects(client().requestBusinessDirectory('/crm', '/customers', '客户读取失败。', 'crm'), error => {
      assert.equal(error.status, 403)
      assert.equal(error.requestID, 'directory-1')
      assert.deepEqual(error.details, { reason: 'scope' })
      assert.match(error.message, /权限范围/)
      return true
    })
  })
  await withFetch(async () => new Response('<html>portal</html>', { headers: { 'content-type': 'text/html' } }), async () => {
    await assert.rejects(client().requestBusinessDirectory('/crm', '/customers', '客户读取失败。', 'crm'), error => error.code === 'INVALID_DIRECTORY_RESPONSE')
  })
})

test('合同下载留在当前页面展示业务拒绝，并保留 401 单次登录边界', async () => {
  await withFetch(async () => response(404, { code: 'CON_DOCUMENT_NOT_FOUND', message: '该合同没有 DOCX 文档', request_id: 'document-1' }), async redirects => {
    await assert.rejects(client().downloadContractFile('one', 'docx'), error => {
      assert.equal(error.code, 'CON_DOCUMENT_NOT_FOUND')
      assert.equal(error.requestID, 'document-1')
      assert.match(error.message, /没有 DOCX 文档/)
      return true
    })
    assert.equal(redirects.length, 0)
  })
  await withFetch(async () => response(401, { code: 'CON_UNAUTHENTICATED' }), async redirects => {
    const api = client()
    await assert.rejects(api.downloadContractFile('one', 'pdf'), error => error instanceof api.ContractAuthError)
    await assert.rejects(api.downloadContractFile('one', 'stamped-pdf'))
    assert.equal(redirects.length, 1)
  })
  await withFetch(async () => new Response('<html>portal</html>', { headers: { 'content-type': 'text/html' } }), async () => {
    await assert.rejects(client().downloadContractFile('one', 'pdf'), error => error.code === 'INVALID_DOWNLOAD_RESPONSE' && !error.message.includes('<html>'))
  })
})

test('合同文件流保留受控下载路径、格式和安全文件名，拒绝空响应', async () => {
  await withFetch(async (url, options) => {
    assert.equal(url, '/contract_management/api/v1/approved-contracts/contract%2F1/pdf')
    assert.equal(options.credentials, 'include')
    return new Response('%PDF-1.7\ntest', { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('合同编号.pdf')}` } })
  }, async () => {
    const result = await client().downloadContractFile('contract/1', 'pdf')
    assert.equal(result.filename, '合同编号.pdf')
    assert.match(await result.blob.text(), /PDF-1\.7/)
  })
  await withFetch(async () => new Response('', { headers: { 'content-type': 'application/pdf' } }), async () => {
    await assert.rejects(client().downloadContractFile('one', 'pdf'), error => error.code === 'INVALID_DOWNLOAD_RESPONSE')
  })
})
