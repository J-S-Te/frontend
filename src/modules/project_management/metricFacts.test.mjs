import test from 'node:test'
import assert from 'node:assert/strict'
import { metricInstant, canDecideMetricReport, metricUtilization } from './metricFacts.js'

test('北京业务时刻跨UTC日且审核者须独立于编制与提交', () => {
  assert.equal(metricInstant('2026-11-01', '00:30'), '2026-10-31T16:30:00.000Z')
  const round = { decision: 'PENDING', prepared_by: 'author', submitted_by: 'manager' }
  assert.equal(canDecideMetricReport(round, { user_id: 'manager', permissions: ['project.report.review'] }), false)
  assert.equal(canDecideMetricReport(round, { user_id: 'quality', permissions: [] }), false)
  assert.equal(canDecideMetricReport(round, { user_id: 'quality', permissions: ['project.report.review'] }), true)
})
test('资源无容量的比率是null，确认实际60分钟除240分钟为25%', () => {
  assert.equal(metricUtilization(0, 0), null)
  assert.equal(metricUtilization(60, 240), 25)
  assert.equal(metricUtilization(-1, 240), null)
})
