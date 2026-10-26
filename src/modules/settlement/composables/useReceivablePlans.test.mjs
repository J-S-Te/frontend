import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { useReceivablePlans } from './useReceivablePlans.js'

const day = 86400000
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString()

function harness({ plans = [] } = {}) {
  const calls = { confirm: [], notify: [], act: [] }
  const deps = {
    plans: ref(plans),
    notify: (value) => calls.notify.push(value),
    act: async (callback, success) => { try { await callback(); calls.act.push(success) } catch (cause) { calls.act.push(`fail:${cause.message}`) } },
    confirmReceivablePlan: async (id, body) => { calls.confirm.push({ id, body }) },
  }
  return { deps, calls, ...useReceivablePlans(deps) }
}

test('visiblePlans：关键字匹配合同号 / 客户名 / ID（忽略大小写），确认状态与到期状态按展示标签过滤，reset 清空三路筛选', () => {
  const plans = [
    { id: 'P1', contract_no: 'HT-2026-001', customer_name: '甲公司', status: 'CONFIRMED', due_date: iso(-10) },
    { id: 'P2', contract_no: 'HT-2026-002', customer_name: '乙公司', status: 'PENDING_CONFIRMATION', due_date: iso(3) },
    { id: 'P3', contract_no: 'XX-9', customer_name: '丙公司', status: 'PENDING_CONFIRMATION', due_date: '' },
  ]
  const h = harness({ plans })
  assert.deepEqual(h.visiblePlans.value.map((item) => item.id), ['P1', 'P2', 'P3'])
  h.planKeyword.value = '  ht-2026  '
  assert.deepEqual(h.visiblePlans.value.map((item) => item.id), ['P1', 'P2'])
  h.planKeyword.value = '丙'
  assert.deepEqual(h.visiblePlans.value.map((item) => item.id), ['P3'])
  h.planKeyword.value = ''
  h.planConfirmationFilter.value = '已确认'
  assert.deepEqual(h.visiblePlans.value.map((item) => item.id), ['P1'])
  h.planConfirmationFilter.value = '待确认'
  h.planMaturityFilter.value = '即将到期'
  assert.deepEqual(h.visiblePlans.value.map((item) => item.id), ['P2'])
  h.planMaturityFilter.value = '待确认'
  assert.deepEqual(h.visiblePlans.value.map((item) => item.id), ['P3'], '无到期日的计划归"待确认"到期态')
  h.resetPlanFilters()
  assert.deepEqual([h.planKeyword.value, h.planConfirmationFilter.value, h.planMaturityFilter.value], ['', '', ''])
  assert.equal(h.visiblePlans.value.length, 3)
})

test('confirmPlan 以原值快照装载编辑器并打开；空字段回落为空串', () => {
  const h = harness()
  h.confirmPlan({ id: 'P1', version: 2, contract_no: 'HT-1', due_date: '2026-11-01', planned_amount: '1000' })
  assert.equal(h.planEditorOpen.value, true)
  assert.deepEqual(h.planEditor.value, {
    id: 'P1', version: 2, contract_no: 'HT-1', customer_name: '', due_date: '2026-11-01', planned_amount: '1000',
    original_due_date: '2026-11-01', original_planned_amount: '1000', reason: '',
  })
})

test('submitPlanConfirmation：调整了收款日或金额却无原因 → 只提示不提交；未调整或已填原因 → 经 act 提交并关闭编辑器', async () => {
  const h = harness()
  h.confirmPlan({ id: 'P1', version: 2, due_date: '2026-11-01', planned_amount: '1000' })
  h.planEditor.value.planned_amount = 1000
  await h.submitPlanConfirmation()
  assert.deepEqual(h.calls.confirm, [{ id: 'P1', body: { version: 2, due_date: '2026-11-01', planned_amount: 1000, reason: '' } }], '数字 1000 与字符串 "1000" 视为未调整')
  assert.equal(h.planEditorOpen.value, false)
  assert.deepEqual(h.calls.act, ['应收计划已确认，并已生成正式应收。'])

  h.confirmPlan({ id: 'P2', version: 1, due_date: '2026-11-01', planned_amount: '1000' })
  h.planEditor.value.due_date = '2026-12-01'
  h.planEditor.value.reason = '   '
  await h.submitPlanConfirmation()
  assert.equal(h.calls.confirm.length, 1, '无原因不得提交')
  assert.deepEqual(h.calls.notify, ['调整计划收款日或金额时必须填写调整原因。'])
  assert.equal(h.planEditorOpen.value, true)

  h.planEditor.value.reason = '  客户申请延期  '
  await h.submitPlanConfirmation()
  assert.deepEqual(h.calls.confirm.at(-1), { id: 'P2', body: { version: 1, due_date: '2026-12-01', planned_amount: '1000', reason: '客户申请延期' } })
  assert.equal(h.planEditorOpen.value, false)
})
