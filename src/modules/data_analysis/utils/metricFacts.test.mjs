import test from 'node:test'
import assert from 'node:assert/strict'
import { formatFactMoney, formatFactRate, validMetricFactsSummary } from './metricFacts.js'

test('确认金额保留冲回负数和精确分，未知金额不补零', () => {
  assert.equal(formatFactMoney(-10001), '-100.01')
  assert.equal(formatFactMoney(9007199254740991), '90,071,992,547,409.91')
  assert.equal(formatFactMoney(0), '0.00')
  assert.equal(formatFactMoney(null), '—')
  assert.equal(formatFactRate(null), '—')
  assert.equal(formatFactRate(0), '0.00%')
})

test('完整指标响应才能显示可用，零分母、分桶和币种必须自洽', () => {
  const base = { available: true, section: 'contract', source_code: 'contract_management',
    snapshot_at: '2026-11-11T12:00:00Z', stale: false, stale_reason: '', basis: '冻结可比标准价',
    discount_known: 1, discount_unknown: 1, discount_buckets: { FROM_80_TO_90: 1 } }
  assert.equal(validMetricFactsSummary(base), true)
  assert.equal(validMetricFactsSummary({ ...base, discount_buckets: { FROM_80_TO_90: 2 } }), false)
  assert.equal(validMetricFactsSummary({ ...base, source_code: 'settlement' }), false)
  assert.equal(validMetricFactsSummary({ ...base, discount_buckets: { unknown_bucket: 1 } }), false)
  assert.equal(validMetricFactsSummary({ available: false, section: 'contract', stale: true,
    stale_reason: '尚未发布' }), true)
  assert.equal(validMetricFactsSummary({ available: true, section: 'finance', currencies: [] }), false)
  const resource = { ...base, section: 'project', source_code: 'project_management',
    person: { actual_minutes: 0, capacity_minutes: 0, rate: null, pending: 0, unknown: 1 },
    equipment: { actual_minutes: 0, capacity_minutes: 0, rate: null, pending: 0, unknown: 1 } }
  assert.equal(validMetricFactsSummary(resource), true)
  assert.equal(validMetricFactsSummary({ ...resource, person: { ...resource.person, rate: 0 } }), false)
})
