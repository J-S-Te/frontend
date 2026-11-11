import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMetricFacts } from './metric-facts-render-harness.mjs'

test('财务展示原币种净确认额、预付和组织成本，冲回负号不丢失', async () => {
  const html = await renderMetricFacts({ section: 'finance', summary: {
    available: true, basis: '独立复核确认账本', period: '2026-11', currencies: [
      { currency: 'CNY', income_minor: -10001, cost_minor: 4000, income_tax_minor: -600,
        cost_tax_minor: 0, spend_minor: 5000, prepayment_minor: 1000 },
      { currency: 'USD', income_minor: 20000, cost_minor: 0, income_tax_minor: 0,
        cost_tax_minor: 0, spend_minor: 0, prepayment_minor: 0 },
    ], cost_dimensions: [{ dimension: 'organization', id: 'org-a', name: '检测部',
      currency: 'CNY', amount_minor: 4000 }], pending: 1, conflicts: 1,
  } })
  for (const expected of ['-100.01', '40.00', '预付', 'CNY', 'USD', '检测部', '独立复核确认账本']) assert.ok(html.includes(expected), expected)
  assert.doesNotMatch(html, /总收入合计|折算人民币/)
})

test('旧报告未知和待审不计失败，零分母显示破折号，未发布不冒充零', async () => {
  const html = await renderMetricFacts({ section: 'report', summary: {
    available: true, first_pass_rate: null, first_reviewed: 0, first_passed: 0,
    unknown: 7, pending: 1, returned_decisions: 0, returned_reports: 0, return_reason_counts: {},
  } })
  assert.match(html, /—/); assert.match(html, /历史首次未知/); assert.match(html, /待审/)
  const missing = await renderMetricFacts({ section: 'project',
    summary: { available: false, stale_reason: '尚未完整发布' } })
  assert.match(missing, /尚未完整发布/); assert.doesNotMatch(missing, /0\.00%/)
})

test('实际SFC分别展示采集起点、来源更新与快照时间，统一北京时间并明确未知', async () => {
  const html = await renderMetricFacts({ section: 'finance', summary: {
    available: true, collection_started_at: '2026-11-01T00:01:02Z',
    source_updated_at: '2026-11-10T02:03:04Z', snapshot_at: '2026-11-11T15:04:05Z',
  } })
  for (const expected of ['新事实采集起点', '来源最后更新', '快照读取时间', '北京时间',
    '2026-11-01 08:01:02', '2026-11-10 10:03:04', '2026-11-11 23:04:05']) {
    assert.ok(html.includes(expected), expected)
  }
  const missing = await renderMetricFacts({ section: 'contract',
    summary: { available: true, unknown: 2, collection_started_at: '', source_updated_at: null, snapshot_at: '' } })
  assert.equal((missing.match(/未知（未提供）/g) || []).length, 3)
  assert.match(missing, /生效月份未知 2 份/)
  assert.match(missing, /不归入所选月份/)
})
