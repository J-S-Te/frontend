import test from 'node:test'
import assert from 'node:assert/strict'
import { businessReasonLabel } from './businessFeedback.js'

test('项目来源的阶段、参与资格和行程原因给出对应核对入口', () => {
  for (const [reason, expected] of [
    ['PROJECT_REPORT_STAGE_REQUIRED', /报告.*项目/],
    ['ACTOR_NOT_ELIGIBLE', /费用参与资格.*项目/],
    ['TRAVEL_PREPARATION_MISSING', /实施准备.*项目/],
    ['OCCURRED_DATE_OUTSIDE_TRAVEL_WINDOW', /费用发生日.*行程日期/],
  ]) {
    assert.match(businessReasonLabel(reason), expected)
    assert.doesNotMatch(businessReasonLabel(reason), new RegExp(reason))
  }
})

test('未知原因和对象原型键均给人工核对提示，内部诊断不进入文案', () => {
  for (const reason of ['FUTURE_REASON', 'constructor', '__proto__', 'toString',
    '错误 SQLSTATE 42S02 SELECT * FROM internal_table', '错误 password=private-value']) {
    const message = businessReasonLabel(reason)
    assert.equal(typeof message, 'string')
    assert.match(message, /人工核对.*原件.*项目来源/)
    assert.doesNotMatch(message, /FUTURE_REASON|constructor|proto|toString|SQLSTATE|private-value/)
  }
})
