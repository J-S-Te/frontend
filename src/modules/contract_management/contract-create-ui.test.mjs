import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const api = await readFile(new URL('./api/contract.js', import.meta.url), 'utf8')

test('new contracts select an optional permission-scoped opportunity and have no manual number', () => {
  assert.match(source, /关联商机（选填）/)
  assert.match(source, /合同编号将在审批通过后自动生成/)
  assert.match(source, /listMyOpportunities\(\)/)
  assert.doesNotMatch(source, /v-model="newContract\.contract_number"/)
  assert.match(api, /created_by: 'me'/)
  assert.match(api, /page_size: '100'/)
})

test('opportunity selection fills customer context and returns the created draft to CRM', () => {
  assert.match(source, /newContract\.value\.customer_id = String\(item\.customer_id/)
  assert.match(source, /newContract\.value\.customer_name = item\.customer_name/)
  assert.match(source, /crm_customer_id: Number\(newContract\.value\.customer_id/)
  assert.match(source, /linkOpportunityContractDraft\(newContract\.value\.opportunity_id/)
  assert.match(api, /\/contract-drafts`/)
  assert.match(api, /'X-CSRF-Token': '1'/)
})

test('contract and service types are constrained selects', () => {
  assert.match(source, /const contractTypeOptions = \['直签', '三方'\]/)
  for (const value of ['等保测评', '商用密码应用安全性评估', 'APP安全加固', '网络安全攻防演练', '安全运维']) assert.match(source, new RegExp(value))
  assert.match(source, /<select v-model="newContract\.contract_type" required>/)
  assert.match(source, /<select v-model="serviceItem\.service_type" required>/)
})

test('service items own their system information and customer fields remain available', () => {
  assert.match(source, /service_items: \[emptyServiceItem\(\)\]/)
  assert.match(source, /newContract\.value\.service_items\.length < 20/)
  assert.match(source, /v-for="\(serviceItem, serviceIndex\) in newContract\.service_items"/)
  assert.match(source, /系统信息（选填）/)
  assert.match(source, /serviceItem\.systems\.length < 15/)
  assert.match(source, /v-for="\(system, systemIndex\) in serviceItem\.systems"/)
  assert.match(source, /service_items: newContract\.value\.service_items\.map/)
  for (const level of ['一级', '二级', '三级', '四级']) assert.match(source, new RegExp(level))
  for (const label of ['客户名称', '客户地址', '客户联系人', '客户联系电话']) assert.match(source, new RegExp(`<span>${label}</span>`))
})

test('template selection is first and mandatory with no manual-content creation path', () => {
  const templatePosition = source.indexOf('第一步：选择合同模板')
  const opportunityPosition = source.indexOf('关联商机（选填）', templatePosition)
  assert.ok(templatePosition > -1 && opportunityPosition > templatePosition)
  assert.match(source, /v-model="newContract\.template_id" required/)
  assert.match(source, /新合同必须基于模板创建，不支持手工填写正文/)
  assert.doesNotMatch(source, /不使用模板，手工填写正文|v-model="newContract\.content"/)
})

test('template fields reuse the current user profile', () => {
  assert.match(source, /<span>合同负责人<\/span><input :value="currentUserLabel" readonly/)
  assert.match(source, /已根据当前登录用户自动填入/)
  assert.match(source, /buildTemplateValues\(/)
  assert.match(source, /当前用户已有信息会自动填入空白字段/)
})
