import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 用途：执行真实会话模块，仅注入平台主体和独立HTTP会话边界。
// 参数：session 为服务器会话，principal 为平台主体，failure 为会话故障。
// 返回值：认证方法及可观察的请求和跳转。
function sessionFixture(session, principal, failure) {
  const requests = [], redirects = []
  const source = readFileSync(new URL('./reimbursement.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replace(/import\.meta\.env/g, '{}')
    .replace(/export (const|function|async function)/g, '$1')
  const clientFactory = ({ base }) => ({ request: async (path, options) => {
    requests.push([base, path, options])
    if (path === '/auth/session' && failure) throw failure
    return path === '/auth/session' ? session : { logged_out: true }
  } })
  const api = new Function('getCurrentPrincipal', 'principalIdentityID', 'createClient', 'window',
    `${source}\nreturn {ensureReimbursementSession,startReimbursementLogin}`)(
    async () => { if (!principal) throw { status: 401 }; return principal },
    (value) => value?.identity_id || value?.user_id || '', clientFactory,
    { location: { pathname: '/reimbursement/claims', search: '?project_id=p',
      replace: (url) => redirects.push(url) } })
  return { ...api, requests, redirects }
}

test('独立报销Cookie会话有效时，平台Cookie到期不会扩大或撤销报销范围', async () => {
  const session = { tenant_id: 't', subject_id: 'u', permissions: ['expense.claim.read'] }
  const fixture = sessionFixture(session)
  assert.equal(await fixture.ensureReimbursementSession(), session)
  assert.deepEqual(fixture.redirects, [])
  assert.equal(fixture.requests[0][1], '/auth/session')
})

test('平台与报销主体或租户不一致时先清理本地会话再强制重登', async () => {
  const fixture = sessionFixture({ tenant_id: 'old', subject_id: 'u', permissions: [] },
    { tenant_id: 'new', identity_id: 'other' })
  assert.equal(await fixture.ensureReimbursementSession(), null)
  assert.equal(fixture.requests.at(-1)[1], '/auth/local-logout')
  assert.match(fixture.redirects[0], /prompt=login/)
  assert.doesNotMatch(fixture.redirects[0], /access_token|id_token/)
})

test('明确401才启动登录；503失败关闭，不把依赖故障误判成未登录', async () => {
  const unavailable = sessionFixture(null, null, { status: 503 })
  await assert.rejects(unavailable.ensureReimbursementSession(), { status: 503 })
  assert.deepEqual(unavailable.redirects, [])
  const expired = sessionFixture(null, null, { status: 401 })
  assert.equal(await expired.ensureReimbursementSession(), null)
  assert.equal(expired.redirects.length, 1)
})
