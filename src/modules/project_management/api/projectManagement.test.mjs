import assert from 'node:assert/strict'
import test from 'node:test'

const originalFetch = global.fetch
const requests = []
global.fetch = async (url, options = {}) => {
  requests.push({ url, options })
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ data: [] }),
  }
}

const api = await import('./projectManagement.js')

test.after(() => { global.fetch = originalFetch })

test('项目管理客户端使用独立同源 API 前缀和 Cookie 会话', async () => {
  await api.listProjects({ q: '证券 交易所', status: '实施中' })
  assert.equal(requests[0].url, '/project_management/api/v1/projects?q=%E8%AF%81%E5%88%B8+%E4%BA%A4%E6%98%93%E6%89%80&status=%E5%AE%9E%E6%96%BD%E4%B8%AD')
  assert.equal(requests[0].options.credentials, 'include')
})

test('服务项确认与规则切换使用写接口', async () => {
  await api.confirmServiceItems(['SI-1'])
  await api.setRuleEnabled(7, true)
  assert.deepEqual(JSON.parse(requests[1].options.body), { ids: ['SI-1'] })
  assert.equal(requests[2].options.method, 'PATCH')
  assert.deepEqual(JSON.parse(requests[2].options.body), { enabled: true })
})
