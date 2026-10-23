// A12 数析时间口径：源更新时间、同步时间、本次查询时间必须分开标注。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dashboardFreshnessItems,
  dashboardFreshnessStatus,
  formatDashboardTimestamp,
  normalizeDashboardFreshness,
} from './freshness.js'

const summary = {
  available: true,
  snapshot_at: '2026-10-20 02:15:00.000',
  freshness: {
    source_updated_at: '2026-10-19T08:30:00Z',
    synced_at: '2026-10-20T02:15:00Z',
    computed_at: '2026-10-22T09:45:00Z',
    sync_status: 'SUCCESS',
    stale: false,
    stale_reason: '',
  },
}

test('源更新时间、同步时间和本次查询时间分别展示，不把查询时间标成数据更新时间', () => {
  const items = dashboardFreshnessItems(summary)
  assert.deepEqual(items.map((item) => item.label), ['源数据更新', '最近成功同步', '本次查询计算'])
  assert.match(items[0].value, /2026/)
  assert.match(items[1].value, /2026/)
  assert.match(items[2].value, /2026/)
  // 三个值来自不同字段，不能互相替代。
  assert.match(items[0].value, /10月19日|2026/);
  assert.match(items[1].value, /10月20日|2026/);
  assert.match(items[2].value, /10月22日|2026/);
  assert.ok(items.every((item) => item.label !== '数据更新时间'))
})

test('同步失败时标记陈旧并给出原因，同时保留旧数据展示字段', () => {
  const staleSummary = {
    ...summary,
    freshness: { ...summary.freshness, sync_status: 'FAILED', stale: true, stale_reason: '最近一次源同步失败，当前展示的是最近一次成功同步的旧数据。' },
  }
  const status = dashboardFreshnessStatus(staleSummary)
  assert.equal(status.stale, true)
  assert.match(status.label, /同步失败/)
  assert.match(status.label, /可能已过期/)
  assert.equal(status.badge, '数据可能已过期')
  assert.equal(status.reason, staleSummary.freshness.stale_reason)
  assert.equal(dashboardFreshnessItems(staleSummary).length, 3)
})

test('持久快照分支保持可用且不伪装成源数据更新时间', () => {
  const snapshotSummary = {
    available: true,
    snapshot_at: '2026-10-21 03:00:00.000',
    freshness: { source_updated_at: '', synced_at: '2026-10-21T03:00:00Z', computed_at: '2026-10-22T09:45:00Z', sync_status: 'SNAPSHOT', stale: false },
  }
  const status = dashboardFreshnessStatus(snapshotSummary)
  assert.equal(status.stale, false)
  assert.match(status.label, /持久快照/)
  // 持久快照不能声明“同步正常”，避免把旧快照说成当前同步健康。
  assert.equal(status.badge, '持久化快照')
  const items = dashboardFreshnessItems(snapshotSummary)
  assert.equal(items[0].value, '来源未提供更新时间')
  assert.match(items[1].value, /2026/)
})

test('后端标记陈旧的持久快照展示过期原因并保留三个时间口径', () => {
  const snapshotSummary = {
    available: true,
    snapshot_at: '2026-10-20 03:00:00.000',
    freshness: {
      source_updated_at: '',
      synced_at: '2026-10-20 03:00:00.000',
      computed_at: '2026-10-22T09:45:00Z',
      sync_status: 'SNAPSHOT',
      stale: true,
      stale_reason: '持久快照已超过 48 小时，当前展示的是旧数据。',
    },
  }
  const status = dashboardFreshnessStatus(snapshotSummary)
  assert.equal(status.stale, true)
  assert.match(status.label, /持久快照.*可能已过期/)
  assert.equal(status.badge, '数据可能已过期')
  assert.equal(status.reason, snapshotSummary.freshness.stale_reason)
  assert.deepEqual(dashboardFreshnessItems(snapshotSummary, (value) => value).map((item) => item.value), [
    '来源未提供更新时间',
    '2026-10-20 03:00:00.000',
    '2026-10-22T09:45:00Z',
  ])
})

test('旧响应缺少 freshness 时只把 snapshot_at 当作快照时间，不回退成数据更新时间', () => {
  const legacy = { available: true, snapshot_at: '2026-10-20 02:15:00.000' }
  const normalized = normalizeDashboardFreshness(legacy)
  assert.equal(normalized.present, false)
  assert.equal(normalized.legacySnapshotAt, legacy.snapshot_at)
  const status = dashboardFreshnessStatus(legacy)
  assert.match(status.label, /快照于/)
  assert.doesNotMatch(status.label, /数据更新时间/)
  assert.deepEqual(dashboardFreshnessItems(legacy), [])
})

test('时间格式化兼容 RFC3339 与 MySQL 文本，非法值原样返回', () => {
  assert.match(formatDashboardTimestamp('2026-10-22T09:45:00Z'), /2026/)
  assert.match(formatDashboardTimestamp('2026-10-22 09:45:00.000'), /2026/)
  assert.equal(formatDashboardTimestamp('not-a-time'), 'not-a-time')
  assert.equal(formatDashboardTimestamp(''), '')
  assert.equal(formatDashboardTimestamp(null), '')
})
