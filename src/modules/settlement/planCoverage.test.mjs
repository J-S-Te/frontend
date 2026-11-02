import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PLAN_COVERAGE_TRIGGER_LABELS,
  planCoverageGapLabel,
  planCoverageHint,
  planCoverageStateMeta,
  planCoverageTriggerLabels,
} from './utils/planCoverage.js'

// SET-04 计划覆盖：视图字段来自 GET /api/v1/plan-coverage，超阈值必须提示财务 override 且不自动重试。
test('差额触发原因翻译：合计差额与单期降幅同时命中，未知代码保留原文不静默丢弃', () => {
  assert.deepEqual(planCoverageTriggerLabels(['COVERAGE_GAP', 'SINGLE_INSTALLMENT_DROP']), ['合计差额超阈值', '单期降幅超阈值'])
  assert.deepEqual(planCoverageTriggerLabels(['COVERAGE_GAP']), ['合计差额超阈值'])
  assert.deepEqual(planCoverageTriggerLabels([]), [])
  assert.deepEqual(planCoverageTriggerLabels(null), [])
  assert.deepEqual(planCoverageTriggerLabels(['COVERAGE_GAP', '', '  ', 'FUTURE_TRIGGER']), ['合计差额超阈值', '未识别触发原因（FUTURE_TRIGGER）'])
  assert.equal(Object.keys(PLAN_COVERAGE_TRIGGER_LABELS).length, 2)
})

test('阈值判定：exceeds_threshold 为真时给失败语义并要求 override，否则为阈值内', () => {
  assert.deepEqual(planCoverageStateMeta({ exceeds_threshold: true }), { label: '超阈值 · 需财务 override', tone: 'danger' })
  assert.deepEqual(planCoverageStateMeta({ exceeds_threshold: false }), { label: '阈值内', tone: 'success' })
  // 字段缺失（老版本服务端）按阈值内处理：不能凭空判成超阈值。
  assert.deepEqual(planCoverageStateMeta({}), { label: '阈值内', tone: 'success' })
  assert.deepEqual(planCoverageStateMeta(null), { label: '阈值内', tone: 'success' })
})

test('差额方向：正数为计划少计（合同金额更高），负数为计划超计', () => {
  assert.equal(planCoverageGapLabel('5.50'), '计划少计')
  assert.equal(planCoverageGapLabel('-5.50'), '计划超计')
  assert.equal(planCoverageGapLabel('0'), '计划少计')
  assert.equal(planCoverageGapLabel(''), '计划少计')
})

test('超阈值提示按 override 能力区分，均申明不自动重试', () => {
  const withOverride = planCoverageHint(true)
  const withoutOverride = planCoverageHint(false)
  assert.match(withOverride, /settlement\.finance\.override/)
  assert.match(withOverride, /不会自动重试/)
  assert.match(withoutOverride, /没有结算财务 override 权限/)
  assert.match(withoutOverride, /409/)
  assert.match(withoutOverride, /不会自动重试/)
  assert.notEqual(withOverride, withoutOverride)
})
