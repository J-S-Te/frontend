import { authorizationScopeKey, createAuthorizationSnapshotReader } from './authorizationSnapshot.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const cases = [
  ['平台', 'platform/auth/api/auth.js', 'getCurrentPrincipal'],
  ['项目', 'project_management/api/projectManagement.js', 'getProjectSession'],
  ['合同', 'contract_management/api/contract.js', 'getContractSession'],
  ['结算', 'settlement/api/settlement.js', 'getSettlementSession'],
  ['CRM', 'customer_opportunity/api/client.js', 'getCRMSession'],
  ['客户门户', 'customer_portal/api/portal.js', 'getPortalSession'],
  ['数析', 'data_analysis/api/dataAnalysis.js', 'getAuthMe'],
  ['报销', 'reimbursement/api/reimbursement.js', 'getReimbursementSession'],
]

// 用途：加载真实会话API及依赖，保留请求、缓存、标准化和错误处理。
// 参数：t 为临时目录清理上下文，file 为实际业务API模块。
// 返回值：可调用的真实模块导出；不连接任何外部服务。
async function loadAPI(t, file) {
  const directory = await mkdtemp(path.join(tmpdir(), 'authorization-session-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const output = path.join(directory, 'api.mjs')
  await build({ entryPoints: [path.join(root, 'src/modules', file)], outfile: output,
    bundle: true, platform: 'node', format: 'esm', alias: { '@': path.join(root, 'src') },
    define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } })
  return import(pathToFileURL(output).href)
}

// 用途：构造平台及RP均可解析的合成同身份授权事实。
// 参数：revision 为授权修订号，permissions 为本次真实响应的权限集合。
// 返回值：不包含令牌、真实客户或任何运行凭据的会话数据。
function sessionData(revision, permissions) {
  return { tenant_id: 'T', user_id: 'U', identity_id: 'U', subject_id: 'U',
    tenant: { id: 'T' }, user: { id: 'U', name: '测试人员' },
    account: { id: 'A', name: 'test-account' }, roles: ['reader'], permissions,
    permission_codes: permissions, authorization_revision: revision, catalog_version: 'test',
    data_scopes: [{ scope_type: 'USER', scope_id: 'U', role_code: 'reader' }] }
}

// 用途：在fetch边界返回完整的既有JSON响应信封。
// 参数：data 为合成数据，status 为HTTP成功或错误状态。
// 返回值：由真实Response负责解析的响应对象。
function response(data, status = 200) {
  const body = status === 200 ? { code: 'OK', data }
    : { code: 'AUTHORIZATION_UNAVAILABLE', message: '授权暂不可用' }
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

for (const [name, file, getter] of cases) {
  test(`${name}会话刷新读取最新权限并保留登录边界`, async t => {
    const originalFetch = globalThis.fetch
    const originalWindow = globalThis.window
    const redirects = []
    globalThis.window = { location: { origin: 'http://app.invalid', pathname: '/', search: '',
      replace: value => redirects.push(value), assign: value => redirects.push(value) },
    dispatchEvent() {} }
    t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow })
    const api = await loadAPI(t, file)

    await t.test('会话读取带显式新鲜标记，沿用HttpOnly Cookie', async () => {
      const requests = []
      globalThis.fetch = async (url, options) => {
        requests.push({ url, options })
        return response(sessionData(1, ['read']))
      }
      await api[getter]({ force: true })
      assert.equal(requests.length, 1)
      assert.equal(new Headers(requests[0].options.headers).get('X-Authorization-Refresh'), '1')
      assert.equal(requests[0].options.credentials, 'include')
      assert.equal(requests[0].options.method || 'GET', 'GET')
    })

    await t.test('较早响应不能恢复刷新前的角色或权限', async () => {
      const pending = []
      globalThis.fetch = () => new Promise(resolve => pending.push(resolve))
      const before = api[getter]({ force: true })
      const after = api[getter]({ force: true })
      try {
        assert.equal(pending.length, 2, 'force读取必须绕过已有缓存和在途请求')
        pending[1](response(sessionData(2, ['new.read'])))
        const current = await after
        pending[0](response(sessionData(1, ['old.write'])))
        const late = await before
        assert.deepEqual(current.permissions, ['new.read'])
        assert.deepEqual(late.permissions, ['new.read'])
      } finally {
        for (const resolve of pending) resolve(response(sessionData(2, ['new.read'])))
        await Promise.allSettled([before, after])
      }
    })

    await t.test('较早401或依赖失败不能清空较新会话或启动SSO', async () => {
      for (const status of [401, 403, 503]) {
        const pending = []
        globalThis.fetch = () => new Promise(resolve => pending.push(resolve))
        const before = api[getter]({ force: true })
        const after = api[getter]({ force: true })
        try {
          assert.equal(pending.length, 2)
          pending[1](response(sessionData(3, ['current.read'])))
          const current = await after
          pending[0](response(null, status))
          const late = await before
          assert.deepEqual(late.permissions, current.permissions)
          assert.deepEqual(late.permissions, ['current.read'])
          assert.deepEqual(redirects, [], `迟到${status}不得触发登录`)
        } finally {
          for (const resolve of pending) resolve(response(sessionData(3, ['current.read'])))
          await Promise.allSettled([before, after])
        }
      }
    })

    await t.test('入口ensure不能把旧401重新解释为当前会话失效', async () => {
      const ensure = {
        项目: 'ensureProjectSession', 合同: 'ensureContractSession',
        结算: 'ensureSettlementSession', CRM: 'ensureCRMSession',
        客户门户: 'ensurePortalSession', 数析: 'ensureDataAnalysisSession',
        报销: 'ensureReimbursementSession',
      }[name]
      if (!ensure) return
      const pending = []
      globalThis.fetch = (url) => String(url) === '/api/v1/auth/me'
        ? Promise.resolve(response(sessionData(4, ['platform.read'])))
        : new Promise(resolve => pending.push(resolve))
      const before = api[ensure]()
      const after = api[getter]({ force: true })
      try {
        assert.equal(pending.length, 2)
        pending[1](response(sessionData(4, ['latest.read'])))
        await after
        pending[0](response(null, 401))
        const late = await before
        assert.deepEqual(late.permissions, ['latest.read'])
        assert.deepEqual(redirects, [])
      } finally {
        for (const resolve of pending) resolve(response(sessionData(4, ['latest.read'])))
        await Promise.allSettled([before, after])
      }
    })

    await t.test('新鲜读取失败后不恢复旧缓存，也不启动登录跳转', async () => {
      globalThis.fetch = async () => response(null, 503)
      await assert.rejects(api[getter]({ force: true }), error => error.status === 503)
      await assert.rejects(api[getter](), error => error.status === 503)
      assert.deepEqual(redirects, [])
    })

    await t.test('无应用访问权保留403语义和基础平台登录', async () => {
      globalThis.fetch = async () => response(null, 403)
      await assert.rejects(api[getter]({ force: true }), error => error.status === 403)
      assert.deepEqual(redirects, [])
    })

    await t.test('当前401保留该会话API既有登录行为', async () => {
      const currentAPI = await loadAPI(t, file)
      globalThis.fetch = async () => response(null, 401)
      await assert.rejects(currentAPI[getter]({ force: true }), error => error.status === 401)
      assert.equal(redirects.length, ['平台', '报销'].includes(name) ? 0 : 1)
      redirects.length = 0
    })

    await t.test('普通业务401仍按原应用策略启动登录', async () => {
      const call = {
        项目: value => value.listProjects(), 合同: value => value.listContracts(),
        结算: value => value.getDashboard(), CRM: value => value.request('/customers'),
        客户门户: value => value.request('/projects'),
        数析: value => value.getContractDashboardSummary(),
      }[name]
      if (!call) return
      const currentAPI = await loadAPI(t, file)
      globalThis.fetch = async () => response(null, 401)
      await assert.rejects(call(currentAPI), error => error.status === 401)
      assert.equal(redirects.length, 1)
      redirects.length = 0
    })
  })
}


test('授权比较键包含数析顶层范围及门户身份别名，忽略全局修订号', () => {
  const initial = { tenant_id: 'T', user_id: 'local-U', subject_id: 'S',
    identity_id: 'I', platform_user_id: 'P', customer_id: 'C',
    customer_person_id: 'CP', roles: ['reader'], permissions: ['read'],
    scope_mode: 'TENANT', organization_ids: ['O1', 'O2'], team_ids: ['T1', 'T2'],
    data_scopes: [{ scope_type: 'TENANT' }], authorization_revision: 1 }
  const before = authorizationScopeKey(initial)
  for (const change of [
    { scope_mode: 'SELF' }, { organization_ids: ['O1'] }, { team_ids: ['T1'] },
    { identity_id: 'I2' }, { platform_user_id: 'P2' }, { customer_id: 'C2' },
    { customer_person_id: 'CP2' }, { roles: ['auditor'] }, { permissions: ['write'] },
    { data_scopes: [{ scope_type: 'SELF', scope_id: 'I' }] },
  ]) assert.notEqual(authorizationScopeKey({ ...initial, ...change }), before)
  assert.equal(authorizationScopeKey({ ...initial, authorization_revision: 99,
    authz_revision: 100 }), before)
  assert.equal(authorizationScopeKey({ ...initial, organization_ids: ['O2', 'O1'],
    team_ids: ['T2', 'T1'] }), before)
})


test('清空授权世代后旧401只拒绝旧读取，不运行当前错误副作用', async () => {
  let rejectOld
  const effects = []
  const reader = createAuthorizationSnapshotReader({
    load: () => new Promise((resolve, reject) => { rejectOld = reject }),
    onError: error => effects.push(error),
  })
  const before = reader.read()
  reader.clear()
  rejectOld(Object.assign(new Error('old session expired'), { status: 401 }))
  await assert.rejects(before, error => error.code === 'AUTHORIZATION_SNAPSHOT_CHANGED')
  assert.deepEqual(effects, [])
})

test('旧失败跟随较新在途结果且不重复处理登录副作用', async () => {
  const pending = []
  const effects = []
  const reader = createAuthorizationSnapshotReader({
    load: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    onError: error => effects.push(error),
  })
  const before = reader.read({ force: true })
  const after = reader.read({ force: true })
  pending[0].reject(Object.assign(new Error('old session expired'), { status: 401 }))
  pending[1].resolve({ permissions: ['latest.read'] })
  assert.deepEqual(await before, { permissions: ['latest.read'] })
  assert.deepEqual(await after, { permissions: ['latest.read'] })
  assert.deepEqual(effects, [])
})

test('同一数据范围集合重排不清工作区，同时保留全部范围字段', () => {
  const first = { role_code: 'reader', scope_type: 'ORG', scope_id: 'O1',
    environment_code: 'test', source: { kind: 'template', ids: ['A', 'B'] } }
  const second = { role_code: 'reader', scope_type: 'SELF', scope_id: 'I' }
  const before = authorizationScopeKey({ data_scopes: [first, second] })
  const reordered = { source: { ids: ['A', 'B'], kind: 'template' },
    environment_code: 'test', scope_id: 'O1', scope_type: 'ORG', role_code: 'reader' }
  assert.equal(authorizationScopeKey({ data_scopes: [second, reordered] }), before)
  for (const changed of [
    { ...first, environment_code: 'prod' },
    { ...first, source: { kind: 'manual', ids: ['A', 'B'] } },
    { ...first, source: { kind: 'template', ids: ['B', 'A'] } },
  ]) assert.notEqual(authorizationScopeKey({ data_scopes: [changed, second] }), before)
})
