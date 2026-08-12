import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const api = await readFile(new URL('./api/contract.js', import.meta.url), 'utf8')

test('signing ledger keeps the current UI system and exposes prototype workflow filters and metrics', () => {
  for (const text of ['已完成签署', '签署进行中', '本月完成', '已失效', '全部签署方式', '全部状态']) {
    assert.match(source, new RegExp(text))
  }
  assert.match(source, /contract-sign-stats/)
  assert.match(source, /contract-filter-bar/)
  assert.match(source, /contract-data-table/)
})

test('return tracking persists shipment receipt reminder upload and manual confirmation steps', () => {
  for (const action of ['submitSigningShipment', 'confirmCustomerReceived', 'sendSigningReminder', 'uploadStampedContract', 'confirmSigningRecord']) {
    assert.match(source, new RegExp(action))
  }
  for (const path of ['/shipment', '/received', '/reminders', '/confirm']) {
    assert.match(api, new RegExp(path))
  }
  assert.match(source, /已核验客户印章完整有效/)
  assert.match(source, /已核验签名完整有效/)
  assert.match(source, /系统不自动判定合同内容/)
})

test('contract specialists receive newly approved contracts through realtime signing synchronization', () => {
  assert.match(source, /activeSection\.value !== 'signing' \|\| document\.visibilityState !== 'visible'/)
  assert.match(source, /const listRequest = listSigningRecords\(\{ limit: 200 \}\)/)
  assert.match(source, /scheduleSigningRealtime\(\)/)
  assert.match(source, /immediate \? 0 : 1000/)
  assert.match(source, /scheduleSigningRealtime\(\{ immediate: document\.visibilityState === 'visible' \}\)/)
  assert.match(source, /stopSigningRealtime\(\)/)
})

test('realtime signing refresh does not overwrite shipment or verification forms being edited', () => {
  assert.match(source, /function applySigningRecord\(record, \{ preserveForms = false \} = \{\}\)/)
  assert.match(source, /if \(preserveForms\) return/)
  assert.match(source, /applySigningRecord\(detailResult\.value, \{ preserveForms: true \}\)/)
})
