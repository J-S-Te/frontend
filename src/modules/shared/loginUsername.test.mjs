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
      const footer = source.slice(source.indexOf('class="console-sidebar-user subsystem-sidebar-user"'), source.indexOf('</aside>'))
      assert.match(footer, /currentLoginUsername/)
      assert.doesNotMatch(footer, /accountSecurity/)
    }
  }
})
