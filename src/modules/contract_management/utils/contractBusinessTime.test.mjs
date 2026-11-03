import assert from 'node:assert/strict'
import test from 'node:test'

import { businessDateOffset, todayBusinessDate } from '../../shared/utils/businessTime.js'
import {
  ACTIVE_CONTRACT_STATUSES,
  isContractExpired,
  isInBusinessMonth,
  isPastBusinessDay,
} from './contractBusinessTime.js'

const JANUARY_2026 = { from: '2026-01-01', to: '2026-01-31' }
const DECEMBER_2025 = { from: '2025-12-01', to: '2025-12-31' }

test('本月盖章数按北京自然月判定：凌晨窗口归入北京当天所属月份', () => {
  // UTC 2025-12-31 16:30 = 北京 2026-01-01 00:30：浏览器若在东八区以西的 12 月，旧逻辑会算进 12 月。
  assert.equal(isInBusinessMonth('2025-12-31T16:30:00Z', JANUARY_2026), true)
  assert.equal(isInBusinessMonth('2025-12-31T16:30:00Z', DECEMBER_2025), false)
  // UTC 2025-12-31 15:59:59 = 北京 2025-12-31 23:59:59：仍属 12 月。
  assert.equal(isInBusinessMonth('2025-12-31T15:59:59Z', DECEMBER_2025), true)
  assert.equal(isInBusinessMonth('2025-12-31T15:59:59Z', JANUARY_2026), false)
  // 月末同理：北京 2026-01-31 23:59:59 属于 1 月，北京 2026-02-01 00:00 起不属于。
  assert.equal(isInBusinessMonth('2026-01-31T15:59:59Z', JANUARY_2026), true)
  assert.equal(isInBusinessMonth('2026-01-31T16:00:00Z', JANUARY_2026), false)
  // Date 实例与带偏移的 RFC3339 串得到同一结论，不依赖宿主机时区。
  assert.equal(isInBusinessMonth(new Date('2025-12-31T16:30:00Z'), JANUARY_2026), true)
  assert.equal(isInBusinessMonth('2026-01-01T08:30:00+08:00', JANUARY_2026), true)
  assert.equal(isInBusinessMonth('2025-12-31T23:30:00+08:00', JANUARY_2026), false)
})

test('本月盖章数对无确认时间或非法时间的记录不计入', () => {
  const records = [
    { confirmed_at: '2025-12-31T16:30:00Z' }, // 北京 2026-01-01
    { confirmed_at: '2026-01-15T02:00:00Z' }, // 北京 2026-01-15
    { confirmed_at: '2026-01-31T16:00:00Z' }, // 北京 2026-02-01
    { confirmed_at: 'not-a-time' },
    { confirmed_at: '' },
    {},
  ]
  const monthly = records.filter((item) => isInBusinessMonth(item.confirmed_at, JANUARY_2026))
  assert.equal(monthly.length, 2)
})

test('本月区间缺省取北京当前自然月，而不是浏览器本地月', () => {
  assert.equal(isInBusinessMonth(todayBusinessDate()), true)
  // 40 天前一定落在上一个自然月或更早，不属于当前月。
  assert.equal(isInBusinessMonth(businessDateOffset(-40)), false)
})

test('区间非法或缺失时一律判定为不属于该月，不抛异常', () => {
  for (const range of [null, undefined, {}, { from: '', to: '' }, { from: '2026-01-01' }]) {
    assert.equal(isInBusinessMonth('2026-01-01T00:00:00Z', range), false)
  }
})

test('合同过期判定按北京日历日比较 end_date 与北京今天', () => {
  const active = { status: 'ACTIVE', end_date: '2026-01-01' }
  // 到期日当天不算过期（与既有“日历日”语义一致）。
  assert.equal(isContractExpired(active, { today: '2026-01-01' }), false)
  assert.equal(isContractExpired(active, { today: '2026-01-02' }), true)
  assert.equal(isContractExpired(active, { today: '2025-12-31' }), false)
  // IN_PROGRESS / PENDING_PAY 同样参与过期判定。
  for (const status of ACTIVE_CONTRACT_STATUSES) {
    assert.equal(isContractExpired({ status, end_date: '2026-01-01' }, { today: '2026-01-02' }), true)
  }
})

test('合同过期判定不平移纯日期，也不把时间戳当作日历日本身', () => {
  // 纯日期 end_date 不做时区平移：北京今天正是 end_date 时仍不算过期。
  assert.equal(isContractExpired({ status: 'ACTIVE', end_date: '2026-01-01' }, { today: '2026-01-01' }), false)
  // 时间戳 end_date 先折算北京日历日再比较：UTC 2026-01-01T16:30Z = 北京 2026-01-02。
  assert.equal(isContractExpired({ status: 'ACTIVE', end_date: '2026-01-01T16:30:00Z' }, { today: '2026-01-02' }), false)
  assert.equal(isContractExpired({ status: 'ACTIVE', end_date: '2026-01-01T16:30:00Z' }, { today: '2026-01-03' }), true)
})

test('合同过期判定保留后端标记与非生效状态的既有语义', () => {
  // 后端已判定过期时直接返回 true，即使状态不在生效集合里。
  assert.equal(isContractExpired({ expired: true, status: 'DRAFT', end_date: '2099-01-01' }), true)
  for (const status of ['DRAFT', 'PENDING_APPROVAL', 'TERMINATED', '', undefined]) {
    assert.equal(isContractExpired({ status, end_date: '2020-01-01' }, { today: '2026-01-01' }), false)
  }
  // 缺少 end_date、end_date 非法、入参不是对象时都不判定为过期。
  assert.equal(isContractExpired({ status: 'ACTIVE' }, { today: '2026-01-01' }), false)
  assert.equal(isContractExpired({ status: 'ACTIVE', end_date: 'abc' }, { today: '2026-01-01' }), false)
  assert.equal(isContractExpired({ status: 'ACTIVE', end_date: '2026-02-30' }, { today: '2026-03-01' }), false)
  assert.equal(isContractExpired(null), false)
  assert.equal(isContractExpired(undefined), false)
})

test('缺省今天取北京今天：昨天到期的生效合同已过期，明天到期的不算', () => {
  assert.equal(isContractExpired({ status: 'ACTIVE', end_date: businessDateOffset(-1) }), true)
  assert.equal(isContractExpired({ status: 'ACTIVE', end_date: businessDateOffset(1) }), false)
  assert.equal(isContractExpired({ status: 'ACTIVE', end_date: todayBusinessDate() }), false)
})

test('到期判定统一按北京日历日：到期当天仍有效，签署与合同台账同口径', () => {
  // 合同台账
  assert.equal(isContractExpired({ status: 'ACTIVE', end_date: '2026-03-31' }, { today: '2026-03-31' }), false)
  assert.equal(isContractExpired({ status: 'ACTIVE', end_date: '2026-03-31' }, { today: '2026-04-01' }), true)
  // 签署台账（endAt 由 end_date 派生）——旧实现用 end.getTime() < Date.now()，
  // 会在北京 03-31 08:00 就判失效；现在与合同台账一致。
  assert.equal(isPastBusinessDay('2026-03-31', { today: '2026-03-31' }), false)
  assert.equal(isPastBusinessDay('2026-03-31', { today: '2026-04-01' }), true)
  // UTC 零点的时间戳折算到北京日历日后再比较，不会因为 8 小时偏移提前一天判定
  assert.equal(isPastBusinessDay('2026-03-31T00:00:00Z', { today: '2026-03-31' }), false)
  // 北京 03-30 23:59（UTC 03-30T15:59Z）才是“昨天”；UTC 16:00Z 已是北京 03-31 00:00。
  assert.equal(isPastBusinessDay('2026-03-30T15:59:00Z', { today: '2026-03-31' }), true)
  // 缺值/非法值不过期
  assert.equal(isPastBusinessDay('', { today: '2026-03-31' }), false)
  assert.equal(isPastBusinessDay('不是日期', { today: '2026-03-31' }), false)
})
