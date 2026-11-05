import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./views/CustomerPortalView.vue', import.meta.url), 'utf8')

// 用途：执行真实主页面加载函数的管理员分支，核对只读管理元数据边界。
// 参数：failure为能力读取的受控失败，customer为是否使用普通客户会话。
// 返回值：实际调用记录及页面状态。
async function loadWorkspace(failure = false, customer = false) {
  const calls = []
  const state = { loading: { value: false }, error: { value: '' }, notice: { value: '' },
    session: { value: null }, capabilities: { value: { customer_directory_mode: 'local' } },
    isPortalSuperAdmin: { value: !customer }, capabilitiesLoaded: false,
    getPortalSession: async () => { calls.push('session'); return { roles: customer ? ['portal_customer'] : ['portal_super_admin'] } },
    getPortalCapabilities: async () => {
      calls.push('capabilities')
      if (failure) throw new Error('metadata unavailable')
      return { customer_directory_mode: 'local' }
    },
    section: { value: 'projects' }, hasPermission: () => true,
    listProjects: async () => { calls.push('projects'); return { items: [], total: 0 } },
    projects: { value: [] }, projectPage: { value: 0 }, projectTotal: { value: 0 },
    fail: (error) => { state.error.value = error.message },
  }
  const start = source.indexOf('async function load() {')
  assert.ok(start >= 0)
  const fn = source.slice(start, source.indexOf('\n}', start) + 2)
  await vm.runInNewContext(`${fn}; load()`, state)
  return { calls, state }
}

test('门户管理员只读取能力元数据，不以空客户范围查询业务', async () => {
  const { calls, state } = await loadWorkspace()
  assert.deepEqual(calls, ['session', 'capabilities'])
  assert.equal(state.capabilities.value.customer_directory_mode, 'local')
  assert.equal(state.loading.value, false)
  assert.match(source, /PortalLocalAdminPanel v-if="capabilities.customer_directory_mode === 'local'" :session="session"/)
})

test('管理能力异常保持本地管理入口关闭，普通客户继续原项目查询', async () => {
  const failed = await loadWorkspace(true)
  assert.deepEqual(failed.calls, ['session', 'capabilities'])
  assert.equal(failed.state.capabilities.value.customer_directory_mode, 'crm')
  assert.equal(failed.state.error.value, 'metadata unavailable')
  const customer = await loadWorkspace(false, true)
  assert.deepEqual(customer.calls, ['session', 'capabilities', 'projects'])
})
