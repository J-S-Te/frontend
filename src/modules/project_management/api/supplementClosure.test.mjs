import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { formatUserError } from '../../shared/utils/userError.js'
import { attachStructuredContext } from '../../platform/shared/api/requestContext.js'
import { normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin } from '../../shared/authz/sessionCompatibility.js'

const source = (await readFile(new URL('./projectManagement.js', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replaceAll('import.meta.env', '({})').replace(/^export /gm, '')
const client = new Function('formatUserError', 'attachStructuredContext', 'normalizeAuthorizationSession', 'principalIdentityID', 'shouldStartSubsystemLogin',
  `${source}; return { closeSupplement };`)(formatUserError, attachStructuredContext, normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin)

test('补充协议关账以 POST 调用目标项目路由并提交补充协议与原因', async () => {
  const original = globalThis.fetch
  let captured
  globalThis.fetch = async (url, options) => {
    captured = { url, options }
    return new Response(JSON.stringify({ code: 'OK', data: { status: '待分配' } }), { headers: { 'Content-Type': 'application/json' } })
  }
  try {
    assert.deepEqual(await client.closeSupplement('PJ/1', { supplement_contract_id: 'SUP-1', reason: '补充协议已回写' }), { status: '待分配' })
    assert.equal(captured.url, '/project_management/api/v1/projects/PJ%2F1/supplement-closure')
    assert.equal(captured.options.method, 'POST')
    assert.equal(captured.options.credentials, 'include')
    assert.equal(captured.options.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(captured.options.body), { supplement_contract_id: 'SUP-1', reason: '补充协议已回写' })
  } finally { globalThis.fetch = original }
})

test('无权限与状态冲突必须带状态码上抛，由页面展示业务拒绝原因', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'PM_SCOPE_FORBIDDEN', message: '资源不在当前授权数据范围内' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    await assert.rejects(client.closeSupplement('PJ-1', { supplement_contract_id: 'SUP-1', reason: 'r' }), (error) => error.status === 403 && error.code === 'PM_SCOPE_FORBIDDEN')
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'PM_PRECONDITION_FAILED', message: '当前项目不在补充协议处理中，无需关账' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
    await assert.rejects(client.closeSupplement('PJ-1', { supplement_contract_id: 'SUP-1', reason: 'r' }), (error) => error.status === 409 && /补充协议处理中/.test(error.message))
  } finally { globalThis.fetch = original }
})
