import assert from 'node:assert/strict'
import test from 'node:test'
import { useReceiptAllocation } from './useReceiptAllocation.js'

// act 主干本身由 useSettlementActions.test.mjs 锁定；此处用最小等价桩：
// 执行回调，成功记成功文案，失败记失败——以验证本域在失败时不改状态。
function harness({ failure = null } = {}) {
  const calls = { create: [], reverse: [], notices: [] }
  const deps = {
    act: async (callback, success) => {
      try { await callback(); calls.notices.push(success) } catch (cause) { calls.notices.push(`fail:${cause.message}`) }
    },
    createReceiptAllocation: async (payload) => { calls.create.push(payload); if (failure) throw failure },
    reverseReceiptAllocation: async (id, body) => { calls.reverse.push({ id, body }); if (failure) throw failure },
  }
  return { deps, calls, ...useReceiptAllocation(deps) }
}

test('初始形状：页签默认回款、两个编辑器关闭、核销/冲销表单默认值', () => {
  const h = harness()
  assert.equal(h.allocationTab.value, 'receipts')
  assert.equal(h.allocationComposerOpen.value, false)
  assert.equal(h.reversalComposerOpen.value, false)
  assert.deepEqual(h.allocationForm.value, { receipt_id: '', receivable_id: '', amount: '', match_mode: 'MANUAL', match_confidence: 0 })
  assert.deepEqual(h.reversalForm.value, { allocation_id: '', amount: '', reason_code: 'MATCH_ERROR', reason_detail: '' })
})

test('submitAllocation：提交当前核销表单对象本身，成功后关闭编辑器并切到核销页签', async () => {
  const h = harness()
  h.allocationComposerOpen.value = true
  Object.assign(h.allocationForm.value, { receipt_id: 'R1', receivable_id: 'A1', amount: '100', match_mode: 'SUGGESTED', match_confidence: 0.9 })
  await h.submitAllocation()
  assert.equal(h.calls.create.length, 1)
  assert.equal(h.calls.create[0], h.allocationForm.value, '提交的是表单对象引用（与原视图一致）')
  assert.equal(h.allocationComposerOpen.value, false)
  assert.equal(h.allocationTab.value, 'allocations')
  assert.deepEqual(h.calls.notices, ['核销分配已确认。'])
})

test('submitReversal：仅提交 amount/reason_code/reason_detail 三字段，allocation_id 走路径参数，成功后关闭冲销编辑器', async () => {
  const h = harness()
  h.reversalComposerOpen.value = true
  Object.assign(h.reversalForm.value, { allocation_id: 'AL-9', amount: '30', reason_code: 'DUPLICATE', reason_detail: '重复核销' })
  await h.submitReversal()
  assert.deepEqual(h.calls.reverse, [{ id: 'AL-9', body: { amount: '30', reason_code: 'DUPLICATE', reason_detail: '重复核销' } }])
  assert.equal(h.reversalComposerOpen.value, false)
  assert.equal(h.allocationTab.value, 'receipts', '冲销成功不切页签')
  assert.deepEqual(h.calls.notices, ['核销冲销已完成，余额投影已恢复。'])
})

test('接口失败时不关闭编辑器、不切页签（状态变更位于 await 之后，由 act 主干接管失败提示）', async () => {
  const h = harness({ failure: new Error('服务端保存失败') })
  h.allocationComposerOpen.value = true
  h.reversalComposerOpen.value = true
  await h.submitAllocation()
  await h.submitReversal()
  assert.equal(h.calls.create.length, 1)
  assert.equal(h.calls.reverse.length, 1)
  assert.equal(h.allocationComposerOpen.value, true, '核销失败编辑器保持打开供重试')
  assert.equal(h.reversalComposerOpen.value, true, '冲销失败编辑器保持打开供重试')
  assert.equal(h.allocationTab.value, 'receipts')
  assert.deepEqual(h.calls.notices, ['fail:服务端保存失败', 'fail:服务端保存失败'])
})
