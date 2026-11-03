import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUSINESS_TIME_ZONE,
  businessDateOffset,
  businessWallClockToInstant,
  currentBusinessMonthRange,
  formatBusinessDate,
  formatBusinessDateTime,
  formatBusinessMonth,
  instantToBusinessWallClock,
  toBusinessDate,
  todayBusinessDate,
} from './businessTime.js'

const INVALID_VALUES = [null, undefined, '', '   ', 'abc', NaN, Infinity, -Infinity, {}, [], true, '2026-02-30', '2026-13-01', '2026-1-1', 1e20]

/** 测试内独立的“日历日 → 前后 N 天”实现，不依赖被测模块的算法。 */
function shiftIsoDate(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000)
  const pad = (value) => String(value).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

test('时区常量固定为 Asia/Shanghai', () => {
  assert.equal(BUSINESS_TIME_ZONE, 'Asia/Shanghai')
})

test('formatBusinessDate 按北京时间判定日历日，跨日边界正确', () => {
  // UTC 16:30 = 北京次日 00:30
  assert.equal(formatBusinessDate('2025-12-31T16:30:00Z'), '2026-01-01')
  // UTC 15:30 = 北京当日 23:30
  assert.equal(formatBusinessDate('2025-12-31T15:30:00Z'), '2025-12-31')
  // 同一瞬间的 Date 对象与 RFC3339 串结果一致
  assert.equal(formatBusinessDate(new Date('2025-12-31T16:30:00Z')), '2026-01-01')
  assert.equal(formatBusinessDate(Date.parse('2025-12-31T16:30:00Z')), '2026-01-01')
  // 带偏移的 RFC3339 串按偏移折算，不依赖宿主机时区
  assert.equal(formatBusinessDate('2025-12-31T16:30:00+00:00'), '2026-01-01')
  assert.equal(formatBusinessDate('2025-12-31T16:30:00+08:00'), '2025-12-31')
  assert.equal(formatBusinessDate('2026-01-01T08:30:00+08:00'), '2026-01-01')
  assert.equal(formatBusinessDate('2026-01-01T00:30:00.250Z'), '2026-01-01')
})

test('纯日期串 YYYY-MM-DD 是日历日，绝不做时区平移', () => {
  assert.equal(formatBusinessDate('2026-01-01'), '2026-01-01')
  assert.equal(formatBusinessDate('2025-12-31'), '2025-12-31')
  assert.equal(formatBusinessDate('2024-02-29'), '2024-02-29')
  assert.equal(formatBusinessMonth('2026-07-01'), '2026-07')
  // 纯日期映射为北京零点瞬间，而不是 UTC 零点
  assert.equal(toBusinessDate('2026-01-01').toISOString(), '2025-12-31T16:00:00.000Z')
  assert.equal(instantToBusinessWallClock('2026-01-01'), '2026-01-01T00:00')
})

test('Unix 秒与毫秒两种输入得到同一结果', () => {
  const seconds = 1767225600 // 2026-01-01T00:00:00Z，北京 08:00
  const milliseconds = seconds * 1000
  assert.ok(seconds < 1e12)
  assert.equal(formatBusinessDate(seconds), '2026-01-01')
  assert.equal(formatBusinessDate(milliseconds), formatBusinessDate(seconds))
  assert.equal(formatBusinessDate(milliseconds), '2026-01-01')
  assert.equal(formatBusinessDateTime(seconds), formatBusinessDateTime(milliseconds))
  assert.equal(formatBusinessDateTime(seconds, { seconds: true }), formatBusinessDateTime(milliseconds, { seconds: true }))
  assert.equal(toBusinessDate(seconds).getTime(), toBusinessDate(milliseconds).getTime())

  // 单位换算错误会让日期整体落在前一天：北京边界值再校验一次
  assert.equal(formatBusinessDate(1767139200), '2025-12-31')
  assert.equal(formatBusinessDate(1767139200000), '2025-12-31')
  assert.equal(formatBusinessDate(0), '1970-01-01')
  assert.equal(formatBusinessDate(0), formatBusinessDate(0 * 1000))
  assert.equal(formatBusinessDate(1e12), formatBusinessDate(1e12))
})

test('非法输入不抛异常且返回空值', () => {
  for (const value of INVALID_VALUES) {
    assert.equal(toBusinessDate(value), null, `toBusinessDate(${String(value)}) 应为 null`)
    assert.equal(formatBusinessDate(value), '', `formatBusinessDate(${String(value)}) 应为空串`)
    assert.equal(formatBusinessDateTime(value), '', `formatBusinessDateTime(${String(value)}) 应为空串`)
    assert.equal(formatBusinessDateTime(value, { seconds: true }), '')
    assert.equal(formatBusinessMonth(value), '', `formatBusinessMonth(${String(value)}) 应为空串`)
    assert.equal(instantToBusinessWallClock(value), '', `instantToBusinessWallClock(${String(value)}) 应为空串`)
  }
  assert.equal(businessWallClockToInstant(null), '')
  assert.equal(businessWallClockToInstant(undefined), '')
  assert.equal(businessWallClockToInstant(''), '')
  assert.equal(businessWallClockToInstant('abc'), '')
  assert.equal(businessWallClockToInstant(20260101), '')
  assert.equal(businessWallClockToInstant('2026-02-30T10:00'), '')
  assert.equal(businessWallClockToInstant('2026-01-01T24:00'), '')
  assert.equal(businessWallClockToInstant('2026-01-01T10:60'), '')
})

test('所有导出函数对任意输入都不抛异常', () => {
  const calls = [
    (value) => toBusinessDate(value),
    (value) => formatBusinessDate(value),
    (value) => formatBusinessDateTime(value, { seconds: true }),
    (value) => formatBusinessMonth(value),
    (value) => instantToBusinessWallClock(value),
    (value) => businessWallClockToInstant(value),
    () => todayBusinessDate(),
    () => currentBusinessMonthRange(),
  ]
  for (const value of [...INVALID_VALUES, new Date('invalid'), Symbol.iterator, () => {}, 0, -1]) {
    for (const call of calls) {
      assert.doesNotThrow(() => call(value))
    }
  }
  assert.equal(businessDateOffset(null), '')
  assert.equal(businessDateOffset(undefined), '')
  assert.equal(businessDateOffset(''), '')
  assert.equal(businessDateOffset('abc'), '')
  assert.equal(businessDateOffset(NaN), '')
  assert.equal(businessDateOffset(Infinity), '')
})

test('formatBusinessDateTime 支持秒开关', () => {
  assert.equal(formatBusinessDateTime('2025-12-31T16:30:00Z'), '2026-01-01 00:30')
  assert.equal(formatBusinessDateTime('2025-12-31T16:30:45Z'), '2026-01-01 00:30')
  assert.equal(formatBusinessDateTime('2025-12-31T16:30:45Z', { seconds: true }), '2026-01-01 00:30:45')
  assert.equal(formatBusinessDateTime('2025-12-31T15:59:59Z'), '2025-12-31 23:59')
  assert.equal(formatBusinessDateTime('2025-12-31T16:30:45Z', { seconds: false }), '2026-01-01 00:30')
  assert.equal(formatBusinessDateTime('2025-12-31T16:30:45Z', { seconds: 'true' }), '2026-01-01 00:30')
})

test('formatBusinessMonth 按北京月份取值', () => {
  assert.equal(formatBusinessMonth('2025-12-31T16:30:00Z'), '2026-01')
  assert.equal(formatBusinessMonth('2025-12-31T15:30:00Z'), '2025-12')
  assert.equal(formatBusinessMonth(new Date('2026-03-31T16:00:00Z')), '2026-04')
})

test('businessWallClockToInstant 把北京墙钟反算成瞬间', () => {
  assert.equal(businessWallClockToInstant('2026-01-01T00:30'), '2025-12-31T16:30:00.000Z')
  assert.equal(businessWallClockToInstant('2026-01-01T08:00'), '2026-01-01T00:00:00.000Z')
  assert.equal(businessWallClockToInstant('2026-07-01T12:00'), '2026-07-01T04:00:00.000Z')
  assert.equal(businessWallClockToInstant('2025-12-31T23:59'), '2025-12-31T15:59:00.000Z')
  assert.equal(businessWallClockToInstant('2026-01-01T00:30:15'), '2025-12-31T16:30:15.000Z')
})

test('instantToBusinessWallClock 与 businessWallClockToInstant 可往返', () => {
  const samples = ['2026-01-01T00:30', '2026-01-01T00:00', '2025-12-31T23:59', '2026-07-01T12:00', '2024-02-29T08:05', '2026-12-31T23:59']
  for (const wallClock of samples) {
    const instant = businessWallClockToInstant(wallClock)
    assert.match(instant, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    assert.equal(instantToBusinessWallClock(instant), wallClock)
    assert.equal(instantToBusinessWallClock(Date.parse(instant)), wallClock)
  }
  // 反向：瞬间 → 墙钟 → 瞬间
  const instant = '2026-03-15T23:45:00.000Z'
  assert.equal(instantToBusinessWallClock(instant), '2026-03-16T07:45')
  assert.equal(businessWallClockToInstant(instantToBusinessWallClock(instant)), instant)
})

test('todayBusinessDate 按北京时间取“今天”', (t) => {
  // UTC 16:30 = 北京次日 00:30
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2025, 11, 31, 16, 30, 0) })
  assert.equal(todayBusinessDate(), '2026-01-01')
  assert.equal(formatBusinessDate(new Date()), '2026-01-01')
})

test('businessDateOffset 相对北京今天偏移，跨月跨年正确', (t) => {
  // 北京 2026-01-01 00:30
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2025, 11, 31, 16, 30, 0) })
  assert.equal(todayBusinessDate(), '2026-01-01')
  assert.equal(businessDateOffset(0), '2026-01-01')
  assert.equal(businessDateOffset(-1), '2025-12-31')
  assert.equal(businessDateOffset(1), '2026-01-02')
  assert.equal(businessDateOffset(-31), '2025-12-01')
  assert.equal(businessDateOffset(365), '2027-01-01')

  // 北京 2026-03-01 00:30：前移一天落在 2 月（2026 非闰年）
  t.mock.timers.setTime(Date.UTC(2026, 1, 28, 16, 30, 0))
  assert.equal(todayBusinessDate(), '2026-03-01')
  assert.equal(businessDateOffset(-1), '2026-02-28')
  assert.equal(businessDateOffset(1), '2026-03-02')

  // 北京 2024-03-01 00:30：闰年 2 月 29 天
  t.mock.timers.setTime(Date.UTC(2024, 1, 29, 16, 30, 0))
  assert.equal(todayBusinessDate(), '2024-03-01')
  assert.equal(businessDateOffset(-1), '2024-02-29')
})

test('businessDateOffset 与真实今天保持一致', () => {
  const today = todayBusinessDate()
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(businessDateOffset(0), today)
  assert.equal(businessDateOffset(-1), shiftIsoDate(today, -1))
  assert.equal(businessDateOffset(1), shiftIsoDate(today, 1))
  assert.equal(businessDateOffset(-7), shiftIsoDate(today, -7))
  assert.equal(businessDateOffset(7), shiftIsoDate(today, 7))
  // 数字串按数字处理，小数按天截断
  assert.equal(businessDateOffset('-1'), shiftIsoDate(today, -1))
  assert.equal(businessDateOffset(1.9), shiftIsoDate(today, 1))
})

test('currentBusinessMonthRange 返回自然月闭区间（含 2 月与 31 天月）', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 1, 15, 4, 0, 0) }) // 北京 2026-02-15
  assert.deepEqual(currentBusinessMonthRange(), { from: '2026-02-01', to: '2026-02-28' })

  t.mock.timers.setTime(Date.UTC(2028, 1, 10, 4, 0, 0)) // 闰年 2 月
  assert.deepEqual(currentBusinessMonthRange(), { from: '2028-02-01', to: '2028-02-29' })

  t.mock.timers.setTime(Date.UTC(2026, 6, 15, 4, 0, 0)) // 7 月，31 天
  assert.deepEqual(currentBusinessMonthRange(), { from: '2026-07-01', to: '2026-07-31' })

  t.mock.timers.setTime(Date.UTC(2026, 10, 15, 4, 0, 0)) // 11 月，30 天
  assert.deepEqual(currentBusinessMonthRange(), { from: '2026-11-01', to: '2026-11-30' })

  // UTC 2025-11-30T16:30Z = 北京 2025-12-01T00:30，跨月边界跟随北京日期
  t.mock.timers.setTime(Date.UTC(2025, 10, 30, 16, 30, 0))
  assert.equal(todayBusinessDate(), '2025-12-01')
  assert.deepEqual(currentBusinessMonthRange(), { from: '2025-12-01', to: '2025-12-31' })

  // UTC 2025-12-31T15:30Z = 北京 2025-12-31T23:30，仍是 12 月
  t.mock.timers.setTime(Date.UTC(2025, 11, 31, 15, 30, 0))
  assert.deepEqual(currentBusinessMonthRange(), { from: '2025-12-01', to: '2025-12-31' })
})

test('currentBusinessMonthRange 与真实今天一致', () => {
  const today = todayBusinessDate()
  const { from, to } = currentBusinessMonthRange()
  assert.match(from, /^\d{4}-\d{2}-01$/)
  assert.match(to, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(from.slice(0, 7), today.slice(0, 7))
  assert.equal(to.slice(0, 7), today.slice(0, 7))
  // from..to 必须覆盖今天，且 to 是该月最后一天
  assert.ok(from <= today && today <= to)
  const [year, month] = from.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  assert.equal(to, `${from.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`)
})
