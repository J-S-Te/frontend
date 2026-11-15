import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { principalIdentityID } from '../../shared/authz/sessionCompatibility.js'

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
    principalIdentityID, clientFactory,
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

test('同一主体和租户使用平台真实登录账号及姓名，权限仍来自报销会话', async () => {
  const session = { tenant_id: 'tenant', subject_id: 'identity', display_name: 'platform-01ABC',
    permissions: ['expense.invoice.read'], roles: ['expense_applicant'], authorization_revision: 7 }
  const fixture = sessionFixture(session, { tenant: { id: 'tenant' },
    user: { id: 'identity', name: ' 张三 ' }, account: { name: ' zhangsan ', code: 'EMP001' },
    permissions: ['platform.admin'], roles: ['platform_admin'] })
  const result = await fixture.ensureReimbursementSession()
  assert.equal(result.username, 'zhangsan')
  assert.equal(result.display_name, '张三')
  assert.equal(result.subject_id, 'identity')
  assert.equal(result.permissions, session.permissions)
  assert.equal(result.roles, session.roles)
  assert.equal(result.authorization_revision, 7)
  assert.equal(session.display_name, 'platform-01ABC')
  assert.equal(session.username, undefined)
})

test('平台账号名称空白时使用真实账号代码，不把内部主体作为用户名', async () => {
  const fixture = sessionFixture({ tenant_id: 'tenant', subject_id: 'identity', permissions: [] },
    { tenant: { id: 'tenant' }, user: { id: 'identity' }, account: { name: '  ', code: ' employee01 ' } })
  const result = await fixture.ensureReimbursementSession()
  assert.equal(result.username, 'employee01')
})

test('平台嵌套租户不一致时不混入别的登录用户资料', async () => {
  const fixture = sessionFixture({ tenant_id: 'tenant', subject_id: 'identity', permissions: [] },
    { tenant: { id: 'another' }, user: { id: 'identity', name: '另一租户用户' },
      account: { name: 'another-user' } })
  assert.equal(await fixture.ensureReimbursementSession(), null)
  assert.equal(fixture.requests.at(-1)[1], '/auth/local-logout')
  assert.match(fixture.redirects[0], /prompt=login/)
})

test('没有完整的平台主体和租户绑定时保留独立会话，不采信用户名资料', async () => {
  for (const principal of [
    { account: { name: 'unbound' }, user: { name: '未绑定用户' } },
    { user: { id: 'identity', name: '未绑定租户' }, account: { name: 'unbound' } },
  ]) {
    const session = { tenant_id: 'tenant', subject_id: 'identity', permissions: [] }
    assert.equal(await sessionFixture(session, principal).ensureReimbursementSession(), session)
  }
})

test('后续登录主体变化时重新取用户名，不沿用上一账号资料', async () => {
  const session = { tenant_id: 'tenant', subject_id: 'first', permissions: [] }
  const principal = { tenant: { id: 'tenant' }, user: { id: 'first', name: '第一用户' },
    account: { name: 'first-user' } }
  const fixture = sessionFixture(session, principal)
  const first = await fixture.ensureReimbursementSession()
  session.subject_id = 'second'
  principal.user = { id: 'second', name: '第二用户' }
  principal.account.name = 'second-user'
  const second = await fixture.ensureReimbursementSession()
  assert.equal(first.username, 'first-user')
  assert.equal(second.username, 'second-user')
  assert.equal(second.display_name, '第二用户')
})
