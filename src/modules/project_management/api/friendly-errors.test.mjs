import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { formatUserError } from '../../shared/utils/userError.js'
import { attachStructuredContext } from '../../platform/shared/api/requestContext.js'
import { normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin } from '../../shared/authz/sessionCompatibility.js'

const source = (await readFile(new URL('./projectManagement.js', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replaceAll('import.meta.env', '({})').replace(/^export /gm, '')
function client() {
  return new Function('formatUserError', 'attachStructuredContext', 'normalizeAuthorizationSession', 'principalIdentityID', 'shouldStartSubsystemLogin',
    `${source}; return { request, downloadCapabilityImportTemplate, downloadEquipmentImportTemplate, downloadDetectionCategoryImportTemplate, exportCapabilities };`)(formatUserError, attachStructuredContext, normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin)
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

test('项目参数契约不一致给出版本与格式指引，具体业务拒绝保留原义', async () => {
  const scenarios = [
    [400, 'PM_INVALID_JSON', '请求内容不合法', /数据格式.*服务要求不一致/],
    [409, 'PM_RESOURCE_CONFLICT', '该设备在所选时段已被占用，请更换设备或时间', /更换设备或时间/],
    [409, 'PM_PRECONDITION_FAILED', '请先维护有效的人员资质后再分配', /维护有效的人员资质/],
    [409, 'PM_DUPLICATE_PROJECT', '该合同版本已存在项目，不能重复创建', /不能重复创建/],
    [403, 'PM_SCOPE_FORBIDDEN', '资源不在当前授权数据范围内', /授权数据范围/],
  ]
  for (const [status, code, message, match] of scenarios) {
    await withFetch(async () => response(status, { code, message, request_id: 'project-1', details: { reason: 'business' } }), async () => {
      await assert.rejects(client().request('/service-items/item-1/preparation', { method: 'POST' }), error => {
        assert.equal(error.status, status)
        assert.equal(error.code, code)
        assert.equal(error.requestID, 'project-1')
        assert.deepEqual(error.details, { reason: 'business' })
        assert.match(error.message, match)
        return true
      })
    })
  }
})

test('项目 Gin 校验翻译字段，内部异常和网关 HTML 均不向用户透出', async () => {
  await withFetch(async () => response(422, { code: 'PM_VALIDATION_ERROR', message: "Key: 'Input.CustomerID' Error:Field validation for 'CustomerID' failed on the 'required' tag" }), async () => {
    await assert.rejects(client().request('/projects', { method: 'POST' }), error => /选择.*客户/.test(error.message) && !error.message.includes('CustomerID'))
  })
  for (const body of ['SQLSTATE HY000: SELECT * FROM secrets', '<html>gateway error</html>']) {
    await withFetch(async () => new Response(body, { status: 502, headers: { 'content-type': 'text/html', 'x-request-id': 'gateway-1' } }), async () => {
      await assert.rejects(client().request('/projects'), error => {
        assert.doesNotMatch(error.message, /SQLSTATE|secrets|<html>/)
        assert.equal(error.requestID, 'gateway-1')
        return true
      })
    })
  }
})

test('项目读写响应校验与写入超时不允许静默成功或盲重试', async () => {
  for (const body of ['<html>portal</html>', '{broken', '{}', 'null']) {
    await withFetch(async () => new Response(body, { headers: { 'content-type': body.startsWith('<') ? 'text/html' : 'application/json' } }), async () => {
      const api = client()
      await assert.rejects(api.request('/projects'), error => error.code === 'INVALID_PROJECT_RESPONSE')
      await assert.rejects(api.request('/projects', { method: 'POST' }), error => error.outcomeUnknown === true && /不要重复提交/.test(error.message))
    })
  }
  for (const fetcher of [async () => { throw new TypeError('Failed to fetch') }, async () => response(503, { code: 'PM_SERVICE_TIMEOUT', message: '服务处理超时，请稍后重试' })]) {
    let calls = 0
    await withFetch(async (...args) => { calls++; return fetcher(...args) }, async () => {
      await assert.rejects(client().request('/projects', { method: 'POST' }), error => error.outcomeUnknown === true && /核对状态.*不要重复提交/.test(error.message))
    })
    assert.equal(calls, 1)
  }
})

test('所有项目 CSV 下载都统一会话处理，禁止下载错误页作为文件', async () => {
  for (const download of ['downloadCapabilityImportTemplate', 'downloadEquipmentImportTemplate', 'downloadDetectionCategoryImportTemplate', 'exportCapabilities']) {
    await withFetch(async () => response(401, { code: 'PM_UNAUTHENTICATED', request_id: 'download-1' }), async redirects => {
      await assert.rejects(client()[download](), error => error.status === 401 && error.requestID === 'download-1')
      assert.equal(redirects.length, 1)
    })
    await withFetch(async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }), async () => {
      await assert.rejects(client()[download](), error => error.code === 'INVALID_DOWNLOAD_RESPONSE' && !error.message.includes('<html>'))
    })
  }
})

test('项目文件下载保留权限拒绝，不因 403 或配置认证错误启动登录循环', async () => {
  for (const [status, code] of [[403, 'PM_FORBIDDEN'], [401, 'OIDC_CLAIMS_INVALID']]) {
    await withFetch(async () => response(status, { code, message: 'denied' }), async redirects => {
      await assert.rejects(client().downloadCapabilityImportTemplate(), error => error.status === status && error.code === code && /权限|登录/.test(error.message))
      assert.equal(redirects.length, 0)
    })
  }
})

test('项目正常 envelope 与 CSV 不改变成功协议、筛选和文件名', async () => {
  await withFetch(async () => response(200, { data: { id: 'project-1' } }), async () => {
    assert.deepEqual(await client().request('/projects'), { id: 'project-1' })
  })
  await withFetch(async url => {
    assert.match(url, /resource_type=PERSON/)
    return new Response('\ufeff姓名,资质\n张三,测试', { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="capabilities-20261015.csv"' } })
  }, async () => {
    const result = await client().exportCapabilities('PERSON')
    assert.equal(result.filename, 'capabilities-20261015.csv')
    assert.match(await result.blob.text(), /张三,测试/)
  })
})
