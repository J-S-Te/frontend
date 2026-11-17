import test from 'node:test'
import assert from 'node:assert/strict'
import { STATUS_TONES, normalizeStatusTone, resolveStatusTone } from './theme/statusCatalog.js'

// 状态色调的历史别名统一在 catalog 归一：任何模块输出 amber / violet / 风险 等旧名，
// 最终都只能落到五档之一，避免同一语义在不同子系统落成两种颜色。
test('历史色调名归一到五档', () => {
  assert.equal(normalizeStatusTone('amber'), 'warning')
  assert.equal(normalizeStatusTone('blue'), 'processing')
  assert.equal(normalizeStatusTone('violet'), 'processing')
  assert.equal(normalizeStatusTone('purple'), 'processing')
  assert.equal(normalizeStatusTone('风险'), 'danger')
  assert.equal(normalizeStatusTone('normal'), 'success')
  assert.equal(normalizeStatusTone(''), 'neutral')
  assert.equal(normalizeStatusTone('unknown-tone'), 'neutral')
})

test('域映射未命中或缺失时回中性，不臆测语义', () => {
  assert.equal(resolveStatusTone({ A: 'green' }, 'A'), 'success')
  assert.equal(resolveStatusTone({ A: 'green' }, 'B'), 'neutral')
  assert.equal(resolveStatusTone(null, 'A'), 'neutral')
  assert.equal(resolveStatusTone({ A: 'violet' }, ' A '), 'processing')
})

test('五档白名单封闭，分类色不得混入', () => {
  assert.deepEqual([...STATUS_TONES], ['neutral', 'processing', 'success', 'warning', 'danger'])
  for (const tone of ['violet', 'purple', 'amber', 'blue']) {
    assert.equal(STATUS_TONES.includes(tone), false)
  }
})
