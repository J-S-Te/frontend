import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  createDictionary,
  createDictionaryItem,
  listActiveDictionaryItemsByCode,
  listDictionaries,
  listDictionaryItems,
  updateDictionary,
  updateDictionaryItem,
} from './dictionaries.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => '',
  }
}

test('listDictionaries sends pagination and normalized filters', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { items: [], total: 0 } })
  }

  await listDictionaries({ page: 2, pageSize: 10, keyword: ' audit ', status: 'ACTIVE' })

  assert.equal(requested.url, '/api/v1/dictionaries?page=2&page_size=10&keyword=audit&status=ACTIVE')
  assert.equal(requested.options.credentials, 'include')
})

test('createDictionary sends the backend dictionary payload', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { dictionary_id: 'dict-1' } }, { status: 201 })
  }

  await createDictionary({ code: 'AUDIT_ACTION', name: '审计操作', description: '审计操作类型' })

  assert.equal(requested.url, '/api/v1/dictionaries')
  assert.equal(requested.options.method, 'POST')
  assert.deepEqual(JSON.parse(requested.options.body), {
    code: 'AUDIT_ACTION',
    name: '审计操作',
    description: '审计操作类型',
    status: 'ACTIVE',
  })
})

test('updateDictionary carries the optimistic-lock version', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { version: 4 } })
  }

  await updateDictionary({
    dictionaryId: 'dict/1', code: 'RISK_LEVEL', name: '风险等级', description: '', status: 'DISABLED', version: 3,
  })

  assert.equal(requested.url, '/api/v1/dictionaries/dict%2F1')
  assert.equal(requested.options.method, 'PATCH')
  assert.equal(JSON.parse(requested.options.body).version, 3)
})

test('dictionary item requests use the nested resource routes', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return jsonResponse({ data: { items: [], total: 0 } })
  }

  await listDictionaryItems({ dictionaryId: 'dict-1', page: 1, pageSize: 50, status: 'ACTIVE' })
  await createDictionaryItem({ dictionaryId: 'dict-1', code: 'HIGH', label: '高', value: 'HIGH', sortOrder: 10 })
  await updateDictionaryItem({ dictionaryId: 'dict-1', itemId: 'item-1', code: 'HIGH', label: '高风险', value: 'HIGH', sortOrder: 10, status: 'ACTIVE', version: 2 })

  assert.equal(requests[0].url, '/api/v1/dictionaries/dict-1/items?page=1&page_size=50&status=ACTIVE')
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    code: 'HIGH', label: '高', value: 'HIGH', sort_order: 10, status: 'ACTIVE',
  })
  assert.equal(requests[2].url, '/api/v1/dictionaries/dict-1/items/item-1')
  assert.equal(JSON.parse(requests[2].options.body).version, 2)
})

test('listActiveDictionaryItemsByCode uses the business read endpoint', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { items: [] } })
  }

  await listActiveDictionaryItemsByCode({ dictionaryCode: 'AUDIT.ACTION', pageSize: 100 })

  assert.equal(requested.url, '/api/v1/dictionaries/code/AUDIT.ACTION/items?page=1&page_size=100')
})
