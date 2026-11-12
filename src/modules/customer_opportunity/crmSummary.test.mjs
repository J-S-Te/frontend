import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CRM_OPPORTUNITY_STAGES,
  customerStatusTone,
  opportunityStageSteps,
  opportunityStageTone,
  opportunityStatusTone,
  personInitial,
  presaleBoardCounts,
  presaleStatusTone,
  presaleWorkHours,
} from './crmSummary.js'

test('商机阶段进度按服务端阶段标记已完成、当前和未开始，终态带赢单/失单语义', () => {
  const steps = opportunityStageSteps('方案制定')
  assert.equal(steps.length, CRM_OPPORTUNITY_STAGES.length)
  assert.deepEqual(steps.map((step) => step.state), ['done', 'done', 'current', 'pending', 'pending', 'pending', 'pending'])
  assert.equal(steps[2].label, '方案制定')
  assert.equal(steps[0].index, 1)
  assert.equal(opportunityStageSteps('已签约')[5].state, 'current')
  assert.equal(opportunityStageSteps('已签约')[5].terminal, 'win')
  assert.equal(opportunityStageSteps('失败')[6].terminal, 'lose')
  // 未知阶段不能让整条漏斗误显示为已完成或当前阶段。
  assert.ok(opportunityStageSteps('未知阶段').every((step) => step.state === 'pending'))
})

test('状态徽标映射覆盖原型中的客户、商机阶段、商机状态与售前状态', () => {
  assert.equal(customerStatusTone('ACTIVE'), 'crm-badge--success')
  assert.equal(customerStatusTone('VOID'), 'crm-badge--danger')
  assert.equal(customerStatusTone('MERGED'), 'crm-badge--purple')
  assert.equal(opportunityStageTone('报价'), 'crm-badge--warning')
  assert.equal(opportunityStageTone('已签约'), 'crm-badge--success')
  assert.equal(opportunityStageTone('失败'), 'crm-badge--danger')
  assert.equal(opportunityStatusTone('FOLLOWING'), 'crm-badge--info')
  assert.equal(opportunityStatusTone('UNKNOWN'), 'crm-badge--gray')
  assert.equal(presaleStatusTone('PENDING_APPROVAL'), 'crm-badge--warning')
  assert.equal(presaleStatusTone('EXECUTING'), 'crm-badge--info')
  assert.equal(presaleStatusTone('COMPLETED'), 'crm-badge--success')
  assert.equal(presaleStatusTone('REJECTED'), 'crm-badge--danger')
  assert.equal(presaleStatusTone('CANCELLED'), 'crm-badge--gray')
})

test('售前看板统计只汇总服务端列总数，不把截断后的卡片数当总量', () => {
  const counts = presaleBoardCounts([
    { status: 'PENDING_APPROVAL', total: 3, items: [{}] },
    { status: 'EXECUTING', total: 5, items: [{}] },
    { status: 'COMPLETED', total: 2, items: [] },
    { status: 'REJECTED', total: 1, items: [] },
  ])
  assert.equal(counts.total, 11)
  assert.equal(counts.pending, 3)
  assert.equal(counts.executing, 5)
  assert.equal(counts.completed, 2)
  assert.equal(counts.rejected, 1)
  assert.equal(counts.cancelled, 0)
  assert.deepEqual(presaleBoardCounts([]), { total: 0, pending: 0, executing: 0, completed: 0, rejected: 0, cancelled: 0 })
})

test('售前当前页工时只累加合法数值，保留一位小数且拒绝负数与无穷值', () => {
  assert.equal(presaleWorkHours([{ total_work_hours: '2.5' }, { total_work_hours: 3 }, { total_work_hours: null }]), '5.5')
  assert.equal(presaleWorkHours([{ total_work_hours: '-1' }, { total_work_hours: 'Infinity' }, { total_work_hours: 'x' }]), '0.0')
  assert.equal(presaleWorkHours([]), '0.0')
})

test('人员头像缩写对中文取首字、对 ASCII 取前两位且不产生空值', () => {
  assert.equal(personInitial('王建国'), '王')
  assert.equal(personInitial('alice'), 'AL')
  assert.equal(personInitial('  李婷芳 '), '李')
  assert.equal(personInitial(''), '人')
})
