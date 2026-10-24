import assert from 'node:assert/strict'
import test from 'node:test'
import { cloneNormalizedSigningRecord, isNormalizedSigningRecord } from './utils/signingRecord.js'

// 列表接口的原始形状：contract.id 是内部标识，contract_number 才是展示编号。
const apiRecord = {
  status: 'pending_shipment',
  document_version: 0,
  contract: {
    id: '01SEEDCONTRACTAPPROV0001',
    contract_number: 'HT-20261019-A002',
    title: '软件开发合同',
    status: 'approved',
  },
}

// 页面 normalizeSigningRecord 之后的形状：recordId 保存内部标识，id 保存展示编号。
const normalized = {
  ...apiRecord,
  contract: {
    recordId: '01SEEDCONTRACTAPPROV0001',
    id: 'HT-20261019-A002',
    name: '软件开发合同',
    rawStatus: 'APPROVED',
  },
}

test('raw API signing record is not treated as normalized', () => {
  assert.equal(isNormalizedSigningRecord(apiRecord), false)
  assert.equal(isNormalizedSigningRecord(null), false)
  assert.equal(isNormalizedSigningRecord({}), false)
  assert.equal(isNormalizedSigningRecord({ contract: null }), false)
  assert.equal(isNormalizedSigningRecord({ contract: { recordId: '   ' } }), false)
  assert.throws(() => cloneNormalizedSigningRecord(apiRecord), TypeError)
})

test('normalized signing record keeps the internal recordId and display number', () => {
  assert.equal(isNormalizedSigningRecord(normalized), true)
  const opened = cloneNormalizedSigningRecord(normalized)
  assert.equal(opened.contract.recordId, '01SEEDCONTRACTAPPROV0001')
  assert.equal(opened.contract.id, 'HT-20261019-A002')
  assert.equal(opened.contract.name, '软件开发合同')
})

test('opening the dialog must not re-normalize and turn the contract number into recordId', () => {
  // 回归场景：二次归一化会把 contract.id（编号）写成 recordId，详情请求随之
  // 变成 /signing-records/HT-... 并 404，弹窗停在“正在读取签署详情…”。
  assert.equal(isNormalizedSigningRecord(normalized), true)
  const opened = cloneNormalizedSigningRecord(normalized)
  assert.equal(opened.contract.recordId, '01SEEDCONTRACTAPPROV0001')
  assert.notEqual(opened.contract.recordId, opened.contract.id)
})

test('cloning isolates dialog state from the signing list object', () => {
  const opened = cloneNormalizedSigningRecord(normalized)
  opened.contract.recordId = 'CHANGED'
  assert.equal(normalized.contract.recordId, '01SEEDCONTRACTAPPROV0001')
})
