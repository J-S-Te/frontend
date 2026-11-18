import test from 'node:test'
import assert from 'node:assert/strict'
import { loginUsername } from './loginUsername.mjs'
import { computed, effectScope, ref } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { readFile } from 'node:fs/promises'
import { getCurrentPrincipal, invalidateCurrentPrincipalCache } from '../platform/auth/api/auth.js'

test('统一优先显示当前会话登录账号，不能被姓名、角色或内部 ID 替代', () => {
  assert.equal(loginUsername({ username: ' alice ', display_name: '张三', user_id: 'internal-id' }), 'alice')
  assert.equal(loginUsername({ preferred_username: 'alice', name: '张三' }), 'alice')
  assert.equal(loginUsername({ user_name: 'alice', display_name: '张三' }), 'alice')
  assert.equal(loginUsername({ account_name: 'alice' }), 'alice')
})
test('空值和异常类型使用明确占位，不暴露内部 ID 或伪装姓名为账号', () => {
  for (const value of [null, {}, { username: '  ', display_name: '张三', user_id: 'internal-id' }, { username: {}, roles: ['admin'] }]) {
    assert.equal(loginUsername(value), '当前用户')
  }
})

const platformPrincipal = {
  tenant: { id: 'tenant-1', name: '测试租户' },
  user: { id: 'user-1', name: '张三' },
  account: { id: 'account-1', name: ' alice ', code: 'alice' },
}
const subsystemSession = {
  tenant_id: 'tenant-1', identity_id: 'user-1', sub: 'keycloak-subject',
  username: 'platform-user-1', display_name: '张三',
}
const portalSession = {
  tenant_id: 'tenant-1', platform_user_id: 'user-1', identity_id: '', customer_id: 42,
  username: 'platform-user-1', role_config_hash: '', authz_revision: 1,
  roles: ['portal_customer'], permissions: [], data_scopes: [],
  expires_at: '2026-11-18T12:00:00Z',
}

test('基础平台显示已认证账号名，不能用员工姓名替代', () => {
  assert.equal(loginUsername(platformPrincipal), 'alice')
  assert.equal(loginUsername({ ...platformPrincipal, account: { code: 'bob' } }), 'bob')
  assert.equal(loginUsername({ ...platformPrincipal, account: {} }), '当前用户')
})

test('子系统在同一租户和主体下显示平台登录账号，覆盖内部 OIDC 账号', () => {
  assert.equal(loginUsername(subsystemSession, platformPrincipal), 'alice')
  assert.equal(loginUsername({ ...subsystemSession, username: 'old-account' }, platformPrincipal), 'alice')
  assert.equal(loginUsername({
    tenant_id: 'tenant-1', subject_id: 'user-1', permissions: [],
  }, platformPrincipal), 'alice')
})

test('不同用户、不同租户或绑定信息缺失时不能借用平台账号名', () => {
  for (const principal of [
    { ...platformPrincipal, user: { id: 'user-2' } },
    { ...platformPrincipal, tenant: { id: 'tenant-2' } },
    { ...platformPrincipal, user: {} },
    { ...platformPrincipal, tenant: {} },
    null,
  ]) {
    assert.equal(loginUsername(subsystemSession, principal), '当前用户')
    assert.equal(loginUsername({ ...subsystemSession, username: 'portal.alice' }, principal), 'portal.alice')
  }
})

test('只排除与当前主体精确对应的内部投影账号，保留合法 platform 前缀用户名', () => {
  assert.equal(loginUsername(subsystemSession), '当前用户')
  assert.equal(loginUsername({ ...subsystemSession, username: 'platform-support' }), 'platform-support')
  assert.equal(loginUsername({ ...subsystemSession, username: 'platform-user-1',
    preferred_username: 'alice' }), 'alice')
})

test('客户门户真实 platform_user_id 契约可读取账号且不借用其他身份', () => {
  assert.equal(loginUsername(portalSession, platformPrincipal), 'alice')
  assert.equal(loginUsername(portalSession), '当前用户')
  assert.equal(loginUsername(portalSession, {
    ...platformPrincipal, user: { id: 'user-2' },
  }), '当前用户')
  assert.equal(loginUsername({ ...portalSession, tenant_id: 'tenant-2' }, platformPrincipal), '当前用户')
  assert.equal(loginUsername({ ...portalSession, username: 'portal.alice' }), 'portal.alice')
})

test('八个系统的实际侧栏绑定均显示同一登录账号，不能显示姓名或内部主体', async (t) => {
  invalidateCurrentPrincipalCache()
  t.after(invalidateCurrentPrincipalCache)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'OK', data: platformPrincipal }))
  await getCurrentPrincipal()
  const cases = [
    ['platform/PlatformConsoleView', 'principal', 'currentAccountName'],
    ['settlement/SettlementView', 'settlementSession', 'sessionDisplayName'],
    ['project_management/ProjectManagementView', 'session', 'currentUserName'],
    ['contract_management/ContractManagementView', 'session', 'currentLoginUsername'],
    ['customer_opportunity/CustomerOpportunityView', 'crmSession', 'currentUserLabel'],
    ['customer_portal/CustomerPortalView', 'session', 'currentLoginUsername'],
    ['data_analysis/DashboardShellView', 'me', 'currentUserName'],
    ['reimbursement/ReimbursementView', 'session', 'currentUserName'],
  ]
  for (const [path, sessionName, binding] of cases) {
    await t.test(path, async () => {
      const [module, view] = path.split('/')
      const source = await readFile(new URL(`../${module}/views/${view}.vue`, import.meta.url), 'utf8')
      const { descriptor } = parse(source)
      const { scriptSetupAst } = compileScript(descriptor, { id: view })
      const declaration = scriptSetupAst.flatMap(node => node.declarations || [])
        .find(node => node.id.name === binding)
      const expression = descriptor.scriptSetup.content.slice(declaration.init.start, declaration.init.end)
      const imports = scriptSetupAst.filter(node => node.type === 'ImportDeclaration')
      const useLoginUsername = imports.some(node =>
        node.specifiers.some(specifier => specifier.local.name === 'useLoginUsername'))
        ? (await import('./composables/useLoginUsername.js')).useLoginUsername : undefined
      const readBinding = new Function('computed', 'loginUsername', 'useLoginUsername', sessionName,
        `return (${expression})`)
      const scope = effectScope()
      try {
        const profiles = {
          platform: platformPrincipal,
          customer_portal: portalSession,
          reimbursement: { tenant_id: 'tenant-1', subject_id: 'user-1', permissions: [] },
          contract_management: { tenant_id: 'tenant-1', user_id: 'user-1', user_name: 'platform-user-1' },
          settlement: {
            tenant_id: 'tenant-1', identity_id: 'user-1', user_id: 'user-1',
            preferred_username: 'platform-user-1',
          },
        }
        const session = ref(profiles[module] || {
          tenant_id: 'tenant-1', user_id: 'user-1', username: 'platform-user-1', display_name: '张三',
        })
        const username = scope.run(() => readBinding(computed, loginUsername, useLoginUsername, session))
        await new Promise(setImmediate)
        assert.equal(username.value, 'alice')
      } finally { scope.stop() }
    })
  }
})
