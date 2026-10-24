import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const api = await readFile(new URL('./api/contract.js', import.meta.url), 'utf8')
const payload = await readFile(new URL('./utils/contractPayload.js', import.meta.url), 'utf8')

test('external contract creation uploads multipart file and metadata without a template', () => {
  assert.match(source, /contractCreationMode = ref\('template'\)/)
  assert.match(source, /selectContractCreationMode\('external'\)/)
  assert.match(source, /await createExternalContract\(fileSnapshot, payload\)/)
  assert.match(api, /export async function createExternalContract\(file, metadata\)/)
  assert.match(api, /form\.set\('file', file\)/)
  assert.match(api, /form\.set\('metadata', JSON\.stringify\(externalContractMetadata\(metadata\)\)\)/)
  assert.match(api, /request\('\/contracts\/external', \{ method: 'POST', body: form, validateData: contractDraftResource \}\)/)
})

test('external DOCX validation is bounded and gives actionable errors', () => {
  assert.match(source, /if \(!isContractDOCXFile\(file\)\)/)
  assert.match(payload, /file\.name\.toLowerCase\(\)\.endsWith\('\.docx'\)/)
  assert.match(source, /file\.size <= 0/)
  assert.match(source, /file\.size > 10 \* 1024 \* 1024/)
  assert.match(source, /仅支持有效的 DOCX 文件/)
  assert.match(source, /DOCX 文件不能超过 10MB/)
})

test('external contracts select CRM customers and controlled project categories', () => {
  assert.match(source, /listMyCustomers\(\{ keyword: customerKeyword\.value, page, page_size: 50 \}\)/)
  assert.match(source, /crm_customer_id: Number\(form\.customer_id \|\| 0\)/)
  assert.match(source, /请选择 CRM 客户/)
  assert.match(source, /await refreshSelectedCRMAccess\(formSnapshot\)/)
  assert.match(source, /所选 CRM 商机已失效、不在当前权限范围内或不属于所选客户/)
  assert.match(source, /listContractDetectionCategories\(\)/)
  assert.match(source, /allowedCategories\.has\(item\.category\.trim\(\)\)/)
  assert.match(source, /v-model="serviceItem\.category" required/)
  assert.match(api, /VITE_CUSTOMER_API_BASE_URL \|\| '\/customer-opportunity\/api\/v1'/)
  assert.doesNotMatch(api, /\/customer_management\/api\/v1/)
  assert.match(api, /CUSTOMER_API_BASE_URL, `\/customers\?\$\{search\}`/)
  assert.match(api, /code: response\.ok \? 'INVALID_DIRECTORY_RESPONSE' : body\?\.code/)
  assert.match(api, /invalidContentType: response\.ok && !isJSON/)
  assert.match(api, /invalidJSON: response\.ok && invalidJSON/)
  assert.match(api, /CUSTOMER_API_BASE_URL,\s*`\/opportunities\?\$\{search\}`/)
  assert.match(api, /const data = await request\('\/detection-categories', \{ validateData: collectionPage \}\)/)
  assert.doesNotMatch(api, /PROJECT_API_BASE_URL/)
})

test('existing contract dates and structured payment plans are submitted together', () => {
  assert.match(source, /v-model="newContract\.start_date" type="date"/)
  assert.match(source, /v-model="newContract\.end_date" type="date"/)
  assert.match(source, /start_date: contractDateValue\(form\.start_date\)/)
  assert.match(source, /end_date: contractDateValue\(form\.end_date\)/)
  assert.match(source, /payment_terms: normalizePaymentTerms\(form\.payment_terms/)
  assert.match(source, /v-model="term\.due_date" required type="date"/)
  assert.match(source, /v-model="term\.amount" required type="text"/)
})

test('external project decomposition fields are required while template mode stays compatible', () => {
  assert.match(source, /batch: '第一批次'/)
  assert.match(source, /if \(!serviceItem\.batch\.trim\(\)\) serviceItem\.batch = '第一批次'/)
  assert.match(source, /v-model="serviceItem\.site" :required="isExternalContractMode"/)
  assert.match(source, /v-model="serviceItem\.batch" :required="isExternalContractMode"/)
  assert.match(source, /v-if="isExternalContractMode" v-model="serviceItem\.category" required/)
  assert.match(source, /v-else v-model="serviceItem\.category" maxlength="120" placeholder="默认使用服务类型"/)
})
