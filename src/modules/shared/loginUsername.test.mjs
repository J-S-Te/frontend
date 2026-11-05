import test from 'node:test'
import assert from 'node:assert/strict'
import { loginUsername } from './loginUsername.mjs'

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

test('各子系统从各自认证会话取账号，客户门户不再使用账号安全页的脱敏主体标识', async () => {
  const { readFile } = await import('node:fs/promises')
  const cases = [
    ['settlement/SettlementView', 'settlementSession'],
    ['project_management/ProjectManagementView', 'session'],
    ['contract_management/ContractManagementView', 'session'],
    ['customer_opportunity/CustomerOpportunityView', 'crmSession'],
    ['customer_portal/CustomerPortalView', 'session'],
    ['data_analysis/DashboardShellView', 'me'],
  ]
  for (const [path, session] of cases) {
    const [module, view] = path.split('/')
    const source = await readFile(new URL(`../${module}/views/${view}.vue`, import.meta.url), 'utf8')
    assert.ok(source.includes(`loginUsername(${session}.value)`), path)
    if (module === 'customer_portal') {
      // 侧栏用户区已交给共享外壳 AppShell.vue：视图不再手写
      // <div class="console-sidebar-user subsystem-sidebar-user">…</aside>（原断言按这一段切片），
      // 账号来源改由 <AppShell> 的 user-name 绑定表达。语义不变：
      // 侧栏只显示登录账号，不得换成账号安全页的脱敏主体标识。
      const shellCall = source.slice(source.indexOf('<AppShell'), source.indexOf('>', source.indexOf('<AppShell')) + 1)
      assert.match(shellCall, /:user-name="currentLoginUsername"/)
      assert.doesNotMatch(shellCall, /accountSecurity/)
    }
  }
})
