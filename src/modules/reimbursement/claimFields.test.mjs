import test from 'node:test'
import assert from 'node:assert/strict'

test('历史尾款和差旅只发送可写声明，剔除服务端评估和引用资格，金额仍精确', async () => {
  const { editableClaimItem } = await import('./claimFields.js')
  const payload = editableClaimItem({ id: 'item', fee_type: 'TRAVEL', amount: '90071992547409.93',
    historical_tail_reason: '终止前费用尾款', historical_tail_evidence_text: 'file-1,file-1',
    historical_tail_applications: [{ policy_id: 'forged' }], classification_evidence:[{invoice_id:'forged',rule_version:999}], requires_travel_facts: true,
    travel_assessment: { status: 'MATCH', confirmed_unknown: true },
    travel_confirmation: { decision: 'CONFIRMED_UNKNOWN', reason: '原记录未保留行程', evidence_text: 'file-2', status: 'MATCH' },
    allocations: [{ project_id: 'project', service_item_id: 'service', amount: '90071992547409.93', eligible: true, participant_eligible: true }],
    invoice_usages: [] })
  assert.equal(payload.requested_minor, '9007199254740993')
  assert.deepEqual(payload.historical_tail_evidence_file_ids, ['file-1'])
  assert.deepEqual(payload.travel_confirmation, { decision: 'CONFIRMED_UNKNOWN', reason: '原记录未保留行程', evidence_file_ids: ['file-2'] })
  assert.equal(Object.hasOwn(payload, 'travel_assessment'), false)
  assert.equal(Object.hasOwn(payload, 'requires_travel_facts'), false)
  assert.equal(Object.hasOwn(payload, 'historical_tail_applications'), false)
  assert.equal(Object.hasOwn(payload, 'classification_evidence'), false)
  assert.deepEqual(payload.allocations[0], { project_id: 'project', service_item_id: 'service', amount_minor: '9007199254740993' })
})

test('未要求差旅且未选择人工决定时不强迫确认，不发送空确认对象', async () => {
  const { editableClaimItem } = await import('./claimFields.js')
  const payload = editableClaimItem({ amount: '1.00', allocations: [], invoice_usages: [], requires_travel_facts: false,
    travel_confirmation: { decision: '', reason: '', evidence_text: '' } })
  assert.equal(Object.hasOwn(payload, 'travel_confirmation'), false)
})

test('终止引用仅在当前参与资格仍有效时可选择申请尾款，不假装eligible', async () => {
  const { canSelectProjectReference } = await import('./claimFields.js')
  const reference = { eligible: false, participant_eligible: true, reason_codes: ['PROJECT_TERMINATED'] }
  assert.equal(canSelectProjectReference(reference), true)
  assert.equal(reference.eligible, false)
  assert.equal(canSelectProjectReference({ ...reference, reason_codes: ['PROJECT_TERMINATED', 'SERVICE_ITEM_UNAVAILABLE'] }), false)
  assert.equal(canSelectProjectReference({ ...reference, reason_codes: [] }), false)
  assert.equal(canSelectProjectReference({ ...reference, participant_eligible: false }), false)
  assert.equal(canSelectProjectReference({ eligible: false, participant_eligible: true, reason_codes: ['ACTOR_NOT_ELIGIBLE'] }), false)
})
