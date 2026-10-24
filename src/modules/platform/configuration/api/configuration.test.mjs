import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { listConfigItems, updateConfigItem } from './configuration.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => '',
  }
}

test('配置项列表按服务端契约发送 filter[namespace_id]', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { items: [], total: 0, page: 1, page_size: 100 } })
  }

  await listConfigItems({ page: 2, pageSize: 50, namespaceId: '01J000000000000000000000NS1' })

  const query = new URL(requested.url, 'http://localhost').searchParams
  assert.equal(query.get('filter[namespace_id]'), '01J000000000000000000000NS1')
  // 裸 namespace_id 会被服务端忽略，选择命名空间后仍返回租户内其他命名空间的配置。
  assert.equal(query.get('namespace_id'), null)
  assert.equal(query.get('page'), '2')
  assert.equal(query.get('page_size'), '50')
})

test('配置项列表在未选择命名空间时不带命名空间过滤', async () => {
  let requested
  globalThis.fetch = async (url) => {
    requested = url
    return jsonResponse({ data: { items: [] } })
  }

  await listConfigItems({})

  const query = new URL(requested, 'http://localhost').searchParams
  assert.equal(query.get('filter[namespace_id]'), null)
})

test('更新配置项仍提交命名空间字段，供服务端校验不得跨命名空间移动', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { item_id: 'item-1' } })
  }

  await updateConfigItem('item / 1', { namespace_id: 'ns-1', key: 'k', value_type: 'STRING', value: 'v', version: 2 })

  assert.equal(requested.url, '/api/v1/config/items/item%20%2F%201')
  assert.equal(requested.options.method, 'PATCH')
  assert.deepEqual(JSON.parse(requested.options.body), { namespace_id: 'ns-1', key: 'k', value_type: 'STRING', value: 'v', version: 2 })
})

test('切换命名空间使用请求序号丢弃迟到响应，保存使用条目自身命名空间', () => {
  const module = readFileSync(fileURLToPath(new URL('../components/ConfigurationCenterModule.vue', import.meta.url)), 'utf8')
  // 迟到的旧响应不得覆盖当前命名空间的列表。
  assert.match(module, /let itemsRequestSeq = 0/)
  assert.match(module, /if \(seq !== itemsRequestSeq \|\| namespaceId !== selectedNamespace\.value\) return/)
  // 切换时先清空列表，避免展示上一个命名空间的配置。
  assert.match(module, /watch\(selectedNamespace, \(\) => \{ items\.value = \[\]; loadItems\(\) \}\)/)
  // 保存按条目自身命名空间提交，不随下拉切换移动草稿。
  assert.match(module, /namespace_id: item\.namespace\?\.id \|\| selectedNamespace\.value/)
})
