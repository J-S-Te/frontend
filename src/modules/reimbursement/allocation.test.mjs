import test from 'node:test'
import assert from 'node:assert/strict'
import { allocationInput } from './allocation.js'

test('比例分摊以整数分派生，尾分按项目排序且不随输入顺序漂移', () => {
  const input = { amount: '1.01', allocation_mode: 'RATIO', allocations: [
    { project_id: 'b', ratio: '50' }, { project_id: 'a', ratio: '50' }] }
  assert.deepEqual(allocationInput(input), { allocation_mode: 'RATIO', allocations: [
    { project_id: 'b', service_item_id: '', ratio_basis_points: 5000, amount_minor: '50' },
    { project_id: 'a', service_item_id: '', ratio_basis_points: 5000, amount_minor: '51' }] })
})

test('比例精度、合计、重复引用和零分目标必须明确拒绝', () => {
  for (const ratios of [['50.001','49.999'],['60','50'],['0','100']]) {
    assert.throws(() => allocationInput({ amount:'1', allocation_mode:'RATIO', allocations:
      ratios.map((ratio,index) => ({ project_id:String(index), ratio })) }))
  }
  assert.throws(() => allocationInput({ amount:'0.01', allocation_mode:'RATIO', allocations:
    [{ project_id:'a',ratio:'50' },{ project_id:'b',ratio:'50' }] }), /零分|金额过小/)
})
