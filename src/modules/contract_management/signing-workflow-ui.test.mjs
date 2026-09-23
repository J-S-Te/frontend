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

test('successful signing confirmations close the detail dialog automatically', () => {
  for (const action of ['saveSigningShipment', 'markSigningReceived', 'confirmSigning']) {
    assert.match(source, new RegExp(`await ${action}\\([\\s\\S]{0,260}closeSigningRecord\\(\\)`))
  }
})

test('contract specialists receive newly approved contracts through realtime signing synchronization', () => {
  assert.match(source, /activeSection\.value !== 'signing' \|\| document\.visibilityState !== 'visible'/)
  assert.match(source, /const listRequest = listSigningRecords\(\{ limit: 200 \}\)/)
  assert.match(source, /scheduleSigningRealtime\(\)/)
  assert.match(source, /immediate \? 0 : 1000/)
  assert.match(source, /scheduleSigningRealtime\(\{ immediate: document\.visibilityState === 'visible' \}\)/)
  assert.match(source, /stopSigningRealtime\(\)/)
})

// C-ii（task-62）：寄送保存的必填 recipient_phone 必须进入表单与 payload，
// 且掩码回显只作提示、不回填输入框。
test('shipment form carries recipient_phone and validates it before submit [C-ii]', () => {
  // 表单状态与回填都携带必填键（两处 recipient_phone: ''：初始状态 + 打开详情回填）
  assert.match(source, /signingShipmentForm = ref\(\{[^}]*recipient_phone: ''/)
  assert.match(source, /recipient_phone: '',/)
  // 掩码不回填：回填处保持空串，帮助文案说明掩码不会被提交
  assert.match(source, /掩码不会被提交/)
  // 模板输入与后端 JSON 键同名
  assert.match(source, /v-model\.trim="signingShipmentForm\.recipient_phone"/)
  assert.match(source, /placeholder="请输入收件人手机号（必填）"/)
  assert.match(source, /maxlength="20"/)
  // 提交前置本地校验，payload 直接携带表单（含 recipient_phone）
  assert.match(source, /validateRecipientPhoneNumber\(signingShipmentForm\.value\.recipient_phone\)/)
  assert.match(source, /saveSigningShipment\(contractID, signingShipmentForm\.value\)/)
  // 详情页按掩码原样展示读接口返回值
  assert.match(source, /\{\{ selectedSigningRecord\.recipient_phone \|\| '—' \}\}/)
})

test('realtime signing refresh does not overwrite shipment or verification forms being edited', () => {
  assert.match(source, /function applySigningRecord\(record, \{ preserveForms = false \} = \{\}\)/)
  assert.match(source, /if \(preserveForms\) return/)
  assert.match(source, /applySigningRecord\(detailResult\.value, \{ preserveForms: true \}\)/)
})
