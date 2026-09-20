import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const api = await readFile(new URL('./api/contract.js', import.meta.url), 'utf8')

test('external contract creation uploads multipart file and metadata without a template', () => {
  assert.match(source, /contractCreationMode = ref\('template'\)/)
  assert.match(source, /selectContractCreationMode\('external'\)/)
  assert.match(source, /await createExternalContract\(externalContractFile\.value, payload\)/)
  assert.match(api, /export async function createExternalContract\(file, metadata\)/)
  assert.match(api, /form\.set\('file', file\)/)
  assert.match(api, /form\.set\('metadata', JSON\.stringify\(metadata\)\)/)
  assert.match(api, /request\('\/contracts\/external', \{ method: 'POST', body: form \}\)/)
})

test('external DOCX validation is bounded and gives actionable errors', () => {
  assert.match(source, /file\.name\.toLowerCase\(\)\.endsWith\('\.docx'\)/)
  assert.match(source, /file\.size <= 0/)
  assert.match(source, /file\.size > 10 \* 1024 \* 1024/)
  assert.match(source, /仅支持有效的 DOCX 文件/)
  assert.match(source, /DOCX 文件不能超过 10MB/)
})

test('external contracts select CRM customers and controlled project categories', () => {
  assert.match(source, /listMyCustomers\(\{ keyword: customerKeyword\.value, page, page_size: 50 \}\)/)
  assert.match(source, /crm_customer_id: Number\(newContract\.value\.customer_id \|\| 0\)/)
  assert.match(source, /请选择 CRM 客户/)
  assert.match(source, /await refreshSelectedCRMAccess\(\)/)
  assert.match(source, /所选 CRM 商机已失效、不在当前权限范围内或不属于所选客户/)
  assert.match(source, /listContractDetectionCategories\(\)/)
  assert.match(source, /allowedCategories\.has\(item\.category\.trim\(\)\)/)
  assert.match(source, /v-model="serviceItem\.category" required/)
  assert.match(api, /CUSTOMER_API_BASE_URL, `\/customers\?\$\{search\}`/)
  assert.match(api, /const data = await request\('\/detection-categories'\)/)
  assert.doesNotMatch(api, /PROJECT_API_BASE_URL/)
})

test('existing contract dates are submitted and no payment-plan fields are introduced', () => {
  assert.match(source, /v-model="newContract\.start_date" type="date"/)
  assert.match(source, /v-model="newContract\.end_date" type="date"/)
  assert.match(source, /start_date: contractDateValue\(newContract\.value\.start_date\)/)
  assert.match(source, /end_date: contractDateValue\(newContract\.value\.end_date\)/)
  assert.doesNotMatch(source, /payment_terms|付款计划|付款比例|付款节点/)
  assert.doesNotMatch(api, /payment_terms|payment_plan/)
})

test('external project decomposition fields are required while template mode stays compatible', () => {
  assert.match(source, /v-model="serviceItem\.site" :required="isExternalContractMode"/)
  assert.match(source, /v-model="serviceItem\.batch" :required="isExternalContractMode"/)
  assert.match(source, /v-if="isExternalContractMode" v-model="serviceItem\.category" required/)
  assert.match(source, /v-else v-model="serviceItem\.category" placeholder="默认使用服务类型"/)
})
