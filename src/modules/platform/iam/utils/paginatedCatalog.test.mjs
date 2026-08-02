import assert from 'node:assert/strict'
import test from 'node:test'
import { loadAllCatalogPages } from './paginatedCatalog.js'

test('catalog loader requests every page and de-duplicates stable IDs', async () => {
  const requestedPages = []
  const pages = {
    1: [{ id: '1' }, { id: '2' }],
    2: [{ id: '3' }, { id: '4' }],
  }
  const items = await loadAllCatalogPages(async ({ page, pageSize, status }) => {
    requestedPages.push({ page, pageSize, status })
    return { items: pages[page] || [], total: 4, page, pageSize }
  }, { pageSize: 2, status: 'ACTIVE' }, (item) => item.id)

  assert.deepEqual(items.map((item) => item.id), ['1', '2', '3', '4'])
  assert.deepEqual(requestedPages, [
    { page: 1, pageSize: 2, status: 'ACTIVE' },
    { page: 2, pageSize: 2, status: 'ACTIVE' },
  ])
})

test('catalog loader stops when a server returns an empty page before its declared total', async () => {
  let calls = 0
  const items = await loadAllCatalogPages(async ({ page }) => {
    calls += 1
    return { items: page === 1 ? [{ id: '1' }] : [], total: 10 }
  }, {}, (item) => item.id)

  assert.deepEqual(items, [{ id: '1' }])
  assert.equal(calls, 2)
})
