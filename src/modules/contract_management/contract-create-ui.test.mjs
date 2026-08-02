import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const api = await readFile(new URL('./api/contract.js', import.meta.url), 'utf8')

test('new contracts select an optional permission-scoped opportunity and have no manual number', () => {
  assert.match(source, /关联商机（选填）/)
  assert.match(source, /合同编号将在审批通过后自动生成/)
  assert.match(source, /listMyOpportunities\(\{ limit: 200 \}\)/)
  assert.doesNotMatch(source, /v-model="newContract\.contract_number"/)
  assert.match(api, /scope: 'mine'/)
})

test('contract and service types are constrained selects', () => {
  assert.match(source, /const contractTypeOptions = \['直签', '三方'\]/)
  for (const value of ['等保测评', '商用密码应用安全性评估', 'APP安全加固', '网络安全攻防演练', '安全运维']) assert.match(source, new RegExp(value))
  assert.match(source, /<select v-model="newContract\.contract_type" required>/)
  assert.match(source, /<select v-model="newContract\.service_type" required>/)
})

test('system and customer information follow creation requirements', () => {
  assert.match(source, /系统信息（选填）/)
  assert.match(source, /newContract\.value\.systems\.length < 15/)
  for (const level of ['一级', '二级', '三级', '四级']) assert.match(source, new RegExp(level))
  for (const label of ['客户名称', '客户地址', '客户联系人', '客户联系电话']) assert.match(source, new RegExp(`<span>${label}</span>`))
})

test('contract creation requires a template and removes duplicate manual fields', () => {
  assert.match(source, /<option value="" disabled>请选择合同模板<\/option>/)
  assert.doesNotMatch(source, /不使用模板，手工填写正文|v-model="newContract\.content"/)
  assert.match(source, /v-if="!templateFieldFor\('title'\)"/)
  assert.match(source, /v-if="!templateFieldFor\('customer_name'\)"/)
  assert.match(source, /title: contractFieldValue\('title'\)\.trim\(\)/)
  assert.match(source, /payload\.template_id = selectedContractTemplate\.value\.id/)
})
