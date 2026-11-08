import assert from 'node:assert/strict'
import test from 'node:test'
import { penetrationParentAllows } from './penetrationLifecycle.js'

test('专项结论只在父项现场完成前可变更，后续报告动作仍可执行', () => {
  assert.equal(penetrationParentAllows({ status: '实施中', report_status: 'NONE' }, 'decision'), true)
  assert.equal(penetrationParentAllows({ status: '现场实施完成', report_status: 'RECTIFYING' }, 'decision'), false)
  assert.equal(penetrationParentAllows({ status: '现场实施完成', report_status: 'ISSUED' }), true)
  assert.equal(penetrationParentAllows({ status: '现场实施完成', report_status: 'ARCHIVED' }), false)
  assert.equal(penetrationParentAllows({ status: '已终止', report_status: 'NONE' }), false)
  assert.equal(penetrationParentAllows({ status: '实施中', archived_at: '2026-11-08T00:00:00Z' }), false)
})
