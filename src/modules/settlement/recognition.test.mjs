import test from 'node:test'
import assert from 'node:assert/strict'
import { recognitionInput, canReviewRecognition, recognitionCandidateRows } from './recognition.js'

test('确认输入使用精确整数分并保留发生日与确认日', () => {
  const input = recognitionInput({kind:'COST',amount:'40.25',tax:'2.50',tax_basis:'EXCLUSIVE',occurred_date:'2026-10-30',recognition_date:'2026-11-01'})
  assert.equal(input.amount_minor,4025)
  assert.equal(input.tax_minor,250)
  assert.equal(input.occurred_date,'2026-10-30')
  assert.equal(input.recognition_date,'2026-11-01')
  assert.throws(() => recognitionInput({amount:'1.001',tax:'0'}))
})
test('登记人和提交人都不能自审', () => {
  const row={status:'SUBMITTED',created_by:'maker',submitted_by:'submitter'}
  assert.equal(canReviewRecognition(row,'maker'),false)
  assert.equal(canReviewRecognition(row,'submitter'),false)
  assert.equal(canReviewRecognition(row,'reviewer'),true)
  assert.equal(canReviewRecognition({...row,status:'CONFIRMED'},'reviewer'),false)
})
test('冲正付款不成为新候选，退款重付差异阻断选择', () => {
  const claim={status:'KNOWN',effects:[{effect_id:'e1',kind:'PAYMENT_RECORDED',approved_content_hash:'h'},{effect_id:'r1',kind:'PAYMENT_FULLY_REVERSED',reverses_effect_id:'e1'},{effect_id:'e2',kind:'PAYMENT_RECORDED',approved_content_hash:'h'}],frozen_items:[{item_id:'i',allocation_key:'a',approved_content_hash:'h'}]}
  assert.deepEqual(recognitionCandidateRows({claim,blocked:false}).map(row=>row.effect_id),['e2'])
  assert.deepEqual(recognitionCandidateRows({claim,blocked:true}),[])
})

test('F3-R1仅关联冲回支持零净额正税额，普通确认和零效果仍拒绝', () => {
  const base={kind:'COST',tax_basis:'EXCLUSIVE',original_id:'confirmed-original',amount:'0.00',tax:'0.06'}
  assert.equal(recognitionInput(base).amount_minor,0)
  assert.equal(recognitionInput({...base,tax_basis:'INCLUSIVE',amount:'0.06'}).tax_minor,6)
  assert.throws(()=>recognitionInput({...base,original_id:''}))
  assert.throws(()=>recognitionInput({...base,original_id:'',tax_basis:'INCLUSIVE',amount:'0.06'}))
  assert.throws(()=>recognitionInput({...base,tax:'0.00'}))
  assert.throws(()=>recognitionInput({...base,tax_basis:'INCLUSIVE',amount:'0.05'}))
})
