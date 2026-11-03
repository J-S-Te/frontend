import test from 'node:test'
import assert from 'node:assert/strict'

import { toDateTimeLocal, toRFC3339 } from './authorizationHelpers.js'

// 角色授权有效期的回填与提交必须严格对称：都用北京时间墙钟解释。
// 旧实现用浏览器本地时区（getFullYear/getHours + toISOString），UTC 浏览器下每保存一次
// 有效期就平移 8 小时——与售前 expected_start 是同一类缺陷。
test('授权有效期回填按北京墙钟，UTC 浏览器下不再平移', () => {
  // UTC 2025-12-31T16:30Z = 北京 2026-01-01 00:30
  assert.equal(toDateTimeLocal('2025-12-31T16:30:00Z'), '2026-01-01T00:30')
  // 北京 23:59 仍是当天
  assert.equal(toDateTimeLocal('2025-12-31T15:59:00Z'), '2025-12-31T23:59')
})

test('授权有效期提交把北京墙钟换算成 UTC，与回填互逆', () => {
  assert.equal(toRFC3339('2026-01-01T00:30'), '2025-12-31T16:30:00.000Z')
  // 往返：回填 → 原样提交 → 再回填，值不变
  const source = '2026-06-15T09:15:00Z'
  const backfilled = toDateTimeLocal(source)
  const submitted = toRFC3339(backfilled)
  assert.equal(toDateTimeLocal(submitted), backfilled)
})

test('授权有效期对空值与非法的处理保持既有语义', () => {
  assert.equal(toDateTimeLocal(''), '')
  assert.equal(toDateTimeLocal(null), '')
  assert.equal(toDateTimeLocal('不是时间'), '')
  assert.equal(toRFC3339(''), null)
  assert.equal(toRFC3339(null), null)
  assert.equal(toRFC3339('不是时间'), null)
})

test('授权有效期已带偏移的值按瞬间解析，不做二次平移', () => {
  // 带 +08:00 的值本身已是绝对时刻，换算结果应与同一瞬间的 Z 形式一致
  assert.equal(toRFC3339('2026-01-01T09:15:00+08:00'), '2026-01-01T01:15:00.000Z')
})
