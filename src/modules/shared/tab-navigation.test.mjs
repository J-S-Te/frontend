import test from 'node:test'
import assert from 'node:assert/strict'
import { activeTabIndex, nextTabIndex } from './utils/tabNavigation.js'

const items = [
  { value: 'overview' },
  { value: 'restricted', disabled: true },
  { value: 3 },
]

test('页签值缺失或已禁用时仍有一个可用的键盘入口', () => {
  assert.equal(activeTabIndex(items, 'overview'), 0)
  assert.equal(activeTabIndex(items, '3'), 2)
  assert.equal(activeTabIndex(items, 'missing'), 0)
  assert.equal(activeTabIndex(items, 'restricted'), 0)
  assert.equal(activeTabIndex([{ value: 1, disabled: true }], 1), -1)
  assert.equal(activeTabIndex([], ''), -1)
})

test('方向键跳过禁用项，首尾循环且 Home/End 能直接定位', () => {
  assert.equal(nextTabIndex(items, 0, 'ArrowRight'), 2)
  assert.equal(nextTabIndex(items, 2, 'ArrowRight'), 0)
  assert.equal(nextTabIndex(items, 0, 'ArrowLeft'), 2)
  assert.equal(nextTabIndex(items, 2, 'Home'), 0)
  assert.equal(nextTabIndex(items, 0, 'End'), 2)
  assert.equal(nextTabIndex([], 0, 'End'), -1)
  assert.equal(nextTabIndex(items, 0, 'Enter'), -1)
})

test('纵向页签只拦截上下键，横向页签保留页面上下滚动', () => {
  assert.equal(nextTabIndex(items, 0, 'ArrowDown'), -1)
  assert.equal(nextTabIndex(items, 0, 'ArrowDown', 'vertical'), 2)
  assert.equal(nextTabIndex(items, 0, 'ArrowUp', 'vertical'), 2)
  assert.equal(nextTabIndex(items, 0, 'ArrowRight', 'vertical'), -1)
})
