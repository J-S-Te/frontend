import assert from 'node:assert/strict'
import test from 'node:test'
import { easeOutCubic, formatMetricNumber, parseMetricValue } from './animatedNumber.js'

test('指标数字只解析纯数字，带单位或复合文案保持原样', () => {
  assert.equal(parseMetricValue(14), 14)
  assert.equal(parseMetricValue('1,234'), 1234)
  assert.equal(parseMetricValue(' 12.5 '), 12.5)
  assert.equal(parseMetricValue('12.5万'), null)
  assert.equal(parseMetricValue('3 / 4'), null)
  assert.equal(parseMetricValue('—'), null)
  assert.equal(parseMetricValue(null), null)
})

test('指标数字按中文千分位与小数位格式化', () => {
  assert.equal(formatMetricNumber(1234), '1,234')
  assert.equal(formatMetricNumber(12.5, { decimals: 1 }), '12.5')
  assert.equal(formatMetricNumber(12.345, { decimals: 1 }), '12.3')
})

test('缓出曲线端点与单调性稳定', () => {
  assert.equal(easeOutCubic(0), 0)
  assert.equal(easeOutCubic(1), 1)
  assert.ok(easeOutCubic(0.5) > 0.5)
  assert.ok(easeOutCubic(0.5) < easeOutCubic(0.75))
})
