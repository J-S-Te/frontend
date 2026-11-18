import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, ref } from 'vue'
import { invalidateCurrentPrincipalCache } from '../../platform/auth/api/auth.js'
import { useLoginUsername } from './useLoginUsername.js'

const sessionA = { tenant_id: 'tenant-1', identity_id: 'user-1', username: 'platform-user-1' }

// 用途：生成与真实平台认证契约一致的合成主体响应。
// 参数：identity 为平台用户标识，username 为登录名，tenant 为租户标识。
// 返回值：包含成功信封及认证主体的 HTTP 响应。
function principalResponse(identity, username, tenant = 'tenant-1') {
  return Response.json({ code: 'OK', data: {
    tenant: { id: tenant, name: '测试租户' },
    user: { id: identity, name: '员工姓名' },
    account: { id: `account-${identity}`, name: username }, roles: [], permission_codes: [],
  } })
}

// 用途：在真实 Vue 作用域中挂载用户名组合函数并隔离测试缓存。
// 参数：t 为测试生命周期，initial 为初始子系统会话。
// 返回值：会话引用、实际用户名和可停止的作用域。
function mountUsername(t, initial) {
  invalidateCurrentPrincipalCache()
  const scope = effectScope()
  t.after(() => { scope.stop(); invalidateCurrentPrincipalCache() })
  const session = ref(initial)
  return { scope, session, username: scope.run(() => useLoginUsername(session)) }
}

test('认证资料就绪后显示真实用户名，更新角色不重复读取平台账号', async (t) => {
  const requests = t.mock.method(globalThis, 'fetch', async () => principalResponse('user-1', 'alice'))
  const fixture = mountUsername(t, null)
  assert.equal(fixture.username.value, '当前用户')
  assert.equal(requests.mock.callCount(), 0)
  fixture.session.value = sessionA
  await new Promise(setImmediate)
  assert.equal(fixture.username.value, 'alice')
  fixture.session.value = { ...sessionA, roles: ['auditor'] }
  await new Promise(setImmediate)
  assert.equal(fixture.username.value, 'alice')
  assert.equal(requests.mock.callCount(), 1)
})

test('切换用户立即清空旧账号，先后完成的旧请求不能覆盖新用户名', async (t) => {
  const responses = []
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { responses.push(resolve) }))
  const fixture = mountUsername(t, sessionA)
  fixture.session.value = { ...sessionA, identity_id: 'user-2', username: 'platform-user-2' }
  assert.equal(fixture.username.value, '当前用户')
  assert.equal(responses.length, 2)
  responses[1](principalResponse('user-2', 'bob'))
  await new Promise(setImmediate)
  assert.equal(fixture.username.value, 'bob')
  responses[0](principalResponse('user-1', 'alice'))
  await new Promise(setImmediate)
  assert.equal(fixture.username.value, 'bob')
})

test('切换租户重新确认账号，卸载后迟到的资料不能回填', async (t) => {
  const responses = []
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { responses.push(resolve) }))
  const fixture = mountUsername(t, sessionA)
  responses[0](principalResponse('user-1', 'alice'))
  await new Promise(setImmediate)
  assert.equal(fixture.username.value, 'alice')
  fixture.session.value = { ...sessionA, tenant_id: 'tenant-2' }
  assert.equal(fixture.username.value, '当前用户')
  fixture.scope.stop()
  responses[1](principalResponse('user-1', 'other.account', 'tenant-2'))
  await new Promise(setImmediate)
  assert.equal(fixture.username.value, '当前用户')
})

test('平台资料不可用时保留独立会话账号，不把内部投影或姓名显示成用户名', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'UNAVAILABLE' }, { status: 503 }))
  const fixture = mountUsername(t, { ...sessionA, username: 'portal.alice', display_name: '张三' })
  await new Promise(setImmediate)
  assert.equal(fixture.username.value, 'portal.alice')
  fixture.session.value = sessionA
  assert.equal(fixture.username.value, '当前用户')
})

test('门户只提供 platform_user_id 时仍按真实主体加载平台用户名', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => principalResponse('user-1', 'alice'))
  const fixture = mountUsername(t, {
    tenant_id: 'tenant-1', platform_user_id: 'user-1', customer_id: 42,
    username: 'platform-user-1', roles: ['portal_customer'], permissions: [], data_scopes: [],
  })
  await new Promise(setImmediate)
  assert.equal(fixture.username.value, 'alice')
})
