import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const viewPath = new URL('./views/CustomerOpportunityView.vue', import.meta.url)

test('客户列表重新查询前清空旧数据，失败时不会回显上一授权范围的客户', async () => {
  const source = await readFile(viewPath, 'utf8')
  const clearIndex = source.indexOf('customers.value = []\n\t  page.total = 0')
  const requestIndex = source.indexOf('listCustomers(customerAPIParams(customerFilters, page.number, page.size))')

  assert.ok(clearIndex >= 0, '客户查询前必须清空旧列表和总数')
  assert.ok(requestIndex > clearIndex, '必须先清空旧列表，再请求当前会话可见客户')
})

test('客户详情只在服务端校验成功后展示，并在越权或不可见时关闭', async () => {
  const source = await readFile(viewPath, 'utf8')

  assert.match(source, /if \(String\(selectedCustomer\.value\?\.id \|\| ''\) !== String\(id\)\) selectedCustomer\.value = null/)
  assert.match(source, /if \(value\?\.status === 403 \|\| value\?\.status === 404\) \{\s*closeCustomerDetail\(\)/)
  assert.match(source, /当前账号无权查看该客户，详情已关闭。/)
})
