import assert from 'node:assert/strict'
import test from 'node:test'
import { useOpportunityCustomerDirectory } from './useOpportunityCustomerDirectory.js'

function harness({ result, failure = null, dialogOpen = false, selectedID = '', requests = [] } = {}) {
  const cleared = []
  const deps = {
    listCustomers: async (query) => {
      requests.push(query)
      if (failure) throw failure
      return result
    },
    formatCRMError: (error, options) => options?.fallback || error.message,
    isDialogOpen: () => dialogOpen,
    selectedCustomerID: () => selectedID,
    clearSelectedCustomer: () => cleared.push(true),
  }
  return { deps, cleared, ...useOpportunityCustomerDirectory(deps) }
}

test('成功装载：按关键字请求 ACTIVE 客户并回填选项与总数', async () => {
  const requests = []
  const h = harness({
    result: { items: [{ id: 'c1', name: '甲' }], total: 7 },
    selectedID: 'c1',
    requests,
  })
  h.opportunityCustomerKeyword.value = '  甲 '
  await h.loadOpportunityCustomerOptions()
  assert.deepEqual(requests, [{ keyword: '甲', status: 'ACTIVE', page: 1, page_size: 100, sort_by: 'name', sort_order: 'asc' }])
  assert.deepEqual(h.opportunityCustomerOptions.value.map((item) => item.id), ['c1'])
  assert.equal(h.opportunityCustomerOptionsTotal.value, 7)
  assert.equal(h.opportunityCustomerOptionsLoading.value, false)
  assert.equal(h.opportunityCustomerOptionsError.value, '')
  assert.deepEqual(h.cleared, [], '选中项仍存在时不得清除')
})

test('选中客户不在返回目录中时清除表单选择', async () => {
  const h = harness({ result: { items: [{ id: 'c1' }], total: 1 }, selectedID: 'c9' })
  await h.loadOpportunityCustomerOptions()
  assert.deepEqual(h.cleared, [true])
})

test('迟到响应被序号守卫丢弃；编辑模式打开时结果不回填', async () => {
  const deferred = []
  const deps = {
    listCustomers: () => new Promise((resolve) => { deferred.push(resolve) }),
    formatCRMError: (error, options) => options.fallback,
    isDialogOpen: () => false,
    selectedCustomerID: () => '',
    clearSelectedCustomer: () => {},
  }
  const c = useOpportunityCustomerDirectory(deps)
  const first = c.loadOpportunityCustomerOptions()
  const second = c.loadOpportunityCustomerOptions()
  deferred[0]({ items: [{ id: 'stale' }], total: 1 })
  await first
  deferred[1]({ items: [{ id: 'fresh' }], total: 1 })
  await second
  assert.deepEqual(c.opportunityCustomerOptions.value.map((item) => item.id), ['fresh'], '旧响应不得覆盖新响应')

  let releaseBlocked
  const blocked = useOpportunityCustomerDirectory({
    listCustomers: () => new Promise((resolve) => { releaseBlocked = resolve }),
    formatCRMError: (error, options) => options.fallback,
    isDialogOpen: () => true,
    selectedCustomerID: () => '',
    clearSelectedCustomer: () => {},
  })
  const pending = blocked.loadOpportunityCustomerOptions()
  releaseBlocked({ items: [{ id: 'x' }], total: 1 })
  await pending
  assert.deepEqual(blocked.opportunityCustomerOptions.value, [], '编辑模式打开时不得回填')
})

test('失败路径：清空目录、总数归零并写入格式化错误文案，加载态复位', async () => {
  const h = harness({ result: null, failure: Object.assign(new Error('boom'), { code: 'X' }) })
  await h.loadOpportunityCustomerOptions()
  assert.deepEqual(h.opportunityCustomerOptions.value, [])
  assert.equal(h.opportunityCustomerOptionsTotal.value, 0)
  assert.equal(h.opportunityCustomerOptionsError.value, '客户列表加载失败，请稍后重试。')
  assert.equal(h.opportunityCustomerOptionsLoading.value, false)
})
