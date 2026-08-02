import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  ensureStableReviewAttempt,
  isOpportunityIntakeIdempotencyConflict,
  isOpportunityIntakeVersionConflict,
  opportunityIntakeStatus,
} from '../utils/opportunityIntakeReview.js'

const apiSource = await readFile(new URL('./contract.js', import.meta.url), 'utf8')
const viewSource = await readFile(new URL('../views/ContractManagementView.vue', import.meta.url), 'utf8')

test('opportunity intake API encodes resource ids and sends explicit idempotency key', () => {
  assert.match(apiSource, /getOpportunityIntake\(intakeId\)[\s\S]*encodeURIComponent\(intakeId\)/)
  assert.match(apiSource, /reviewOpportunityIntake\(intakeId, payload, idempotencyKey\)[\s\S]*'Idempotency-Key': idempotencyKey/)
  assert.match(apiSource, /body: JSON\.stringify\(payload\)/)
})

test('opportunity intake list consumes the stable page contract with rolling array compatibility', () => {
  assert.match(apiSource, /items: Array\.isArray\(data\?\.items\) \? data\.items : \[\]/)
  assert.match(apiSource, /const nextCursor = typeof data\?\.next_cursor === 'string'/)
  assert.match(apiSource, /has_more: data\?\.has_more === true && nextCursor !== ''/)
  assert.match(apiSource, /if \(Array\.isArray\(data\)\)[\s\S]*has_more: false/)
  assert.match(apiSource, /error\?\.status === 422[\s\S]*legacyParams\.set\('limit'/)
  assert.match(viewSource, /page_size: 50/)
  assert.match(viewSource, /params\.cursor = opportunityIntakeNextCursor\.value/)
  assert.match(viewSource, /opportunityIntakes\.value = append \? \[\.\.\.opportunityIntakes\.value, \.\.\.page\.items\] : page\.items/)
  assert.match(viewSource, /opportunityIntakeLoadSequence/)
})

test('same page review retry reuses its stable key until command content changes', () => {
  let sequence = 0
  const keyFactory = () => `key-${++sequence}`
  const command = { intakeId: 'intake-1', decision: 'LINK_CONFIRMED', reason: ' 已核对 ', version: 1 }
  const first = ensureStableReviewAttempt(null, command, keyFactory)
  const retry = ensureStableReviewAttempt(first, { ...command, reason: '已核对' }, keyFactory)
  const changed = ensureStableReviewAttempt(retry, { ...command, reason: '核对发现异常' }, keyFactory)
  assert.equal(first.key, 'key-1')
  assert.equal(retry, first)
  assert.equal(changed.key, 'key-2')
})

test('only explicit version and state conflicts trigger refresh-and-reconfirm flow', () => {
  assert.equal(isOpportunityIntakeVersionConflict({ status: 409, code: 'CON_VERSION_CONFLICT' }), true)
  assert.equal(isOpportunityIntakeVersionConflict({ status: 409, code: 'CON_STATE_CONFLICT' }), true)
  assert.equal(isOpportunityIntakeVersionConflict({ status: 409, code: 'CON_INTAKE_REVIEW_IDEMPOTENCY_CONFLICT' }), false)
  assert.equal(isOpportunityIntakeIdempotencyConflict({ status: 409, code: 'CON_INTAKE_REVIEW_IDEMPOTENCY_CONFLICT' }), true)
  assert.equal(isOpportunityIntakeVersionConflict({ status: 500, code: 'CON_INTERNAL_ERROR' }), false)
})

test('queue uses clear Chinese statuses and states the authoritative-link boundary', () => {
  assert.deepEqual(opportunityIntakeStatus('ACCEPTED'), { label: '待核对', tone: 'warning' })
  assert.deepEqual(opportunityIntakeStatus('LINK_CONFIRMED'), { label: '关联已确认', tone: 'success' })
  assert.deepEqual(opportunityIntakeStatus('LINK_EXCEPTION'), { label: '关联异常', tone: 'danger' })
  assert.match(viewSource, /不会创建合同、修改合同状态或启动审批/)
  assert.match(viewSource, /建立既有合同与 CRM 客户、商机的权威关联/)
  assert.match(viewSource, /can\('opportunity_intake\.process'\)/)
  assert.match(viewSource, /opportunityIntakeReviewAttempt\.value\.key/)
  assert.match(viewSource, /await refreshSelectedOpportunityIntake\(\)/)
})
