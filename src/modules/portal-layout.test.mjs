import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PORTAL_PAGE_SIZE,
  portalGridForCount,
  portalPageCount,
  portalPageItems,
} from './platform/views/portalLayout.js'

test('子系统门户按卡片数量选择可读的一屏网格', () => {
  assert.equal(PORTAL_PAGE_SIZE, 9)
  assert.deepEqual(portalGridForCount(1), { columns: 1, rows: 1, density: 'spacious' })
  assert.deepEqual(portalGridForCount(2), { columns: 2, rows: 1, density: 'spacious' })
  assert.deepEqual(portalGridForCount(3), { columns: 3, rows: 1, density: 'spacious' })
  assert.deepEqual(portalGridForCount(4), { columns: 2, rows: 2, density: 'standard' })
  assert.deepEqual(portalGridForCount(6), { columns: 3, rows: 2, density: 'standard' })
  assert.deepEqual(portalGridForCount(8), { columns: 4, rows: 2, density: 'compact' })
  assert.deepEqual(portalGridForCount(9), { columns: 3, rows: 3, density: 'compact' })
})

test('子系统超过九个时稳定分页且不会产生空白越界页', () => {
  const items = Array.from({ length: 20 }, (_, index) => index + 1)
  assert.equal(portalPageCount(items.length), 3)
  assert.deepEqual(portalPageItems(items, 1), items.slice(0, 9))
  assert.deepEqual(portalPageItems(items, 2), items.slice(9, 18))
  assert.deepEqual(portalPageItems(items, 99), items.slice(18, 20))
  assert.deepEqual(portalPageItems(null, 1), [])
})
