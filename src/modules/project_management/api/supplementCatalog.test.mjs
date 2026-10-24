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
  `${source}; return { listSupplementContracts };`)(formatUserError, attachStructuredContext, normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin)

test('补充协议目录通过项目会话调用目标项目路由并保留摘要DTO', async () => {
  const original = globalThis.fetch
  const contracts = [{ id: 'SUP', contract_number: 'HT-SUP', customer_id: 'C', status: 'active', approval_passed: true }]
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/project_management/api/v1/projects/PJ%2F1/supplement-contracts?limit=200')
    assert.equal(options.credentials, 'include')
    return new Response(JSON.stringify({ code: 'OK', data: contracts }), { headers: { 'Content-Type': 'application/json' } })
  }
  try { assert.deepEqual(await client.listSupplementContracts('PJ/1', { limit: 200 }), contracts) }
  finally { globalThis.fetch = original }
})
test('目录依赖错误必须传递给页面，不得用旧候选或空成功覆盖', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'PM_CONTRACT_UNAVAILABLE', message: '合同服务不可用' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  try { await assert.rejects(client.listSupplementContracts('PJ-1'), (error) => error.status === 503) }
  finally { globalThis.fetch = original }
})
