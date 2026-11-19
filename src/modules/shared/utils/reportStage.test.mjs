import assert from 'node:assert/strict'
import test from 'node:test'
import { REPORT_STAGE_LABELS, reportStageLabel } from './reportStage.js'

test('报告阶段码全部映射为中文，大小写与空白归一化', () => {
  assert.equal(reportStageLabel('COMPILING'), '编制中')
  assert.equal(reportStageLabel(' rectifying '), '整改中')
  assert.equal(reportStageLabel('NONE'), '待整改')
  assert.equal(reportStageLabel('REVIEWED'), '已审核')
  assert.equal(reportStageLabel('ISSUED'), '已签发')
  assert.equal(reportStageLabel('ARCHIVED'), '已归档')
  assert.deepEqual(Object.keys(REPORT_STAGE_LABELS).sort(), [
    'ARCHIVED', 'COMPILING', 'ISSUED', 'NONE', 'RECTIFYING', 'REVIEWED',
  ])
})

test('空值走未采集兜底，未知码原样返回不伪装成已知状态', () => {
  assert.equal(reportStageLabel('', '未采集'), '未采集')
  assert.equal(reportStageLabel(null, '未采集'), '未采集')
  assert.equal(reportStageLabel('   ', '未采集'), '未采集')
  assert.equal(reportStageLabel('DRAFTING'), 'DRAFTING')
})
