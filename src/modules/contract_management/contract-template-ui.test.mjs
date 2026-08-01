import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')

test('contract template upload button is gated only by the admin role', () => {
  assert.match(source, /roleCodes\.includes\('admin'\) \|\| session\.value\?\.role\?\.code === 'admin'/)
  assert.match(source, /activeSection === 'templates' && isAdmin[\s\S]*＋ 上传模板/)
  assert.doesNotMatch(source, /activeSection === 'templates' && can\('contract_template\.manage'\)/)
})

test('contract template page loads the real API and opens the upload dialog', () => {
  assert.match(source, /listContractTemplates\(\)/)
  assert.match(source, /@click="openTemplateUpload"/)
  assert.match(source, /@submit\.prevent="submitTemplateUpload"/)
})

test('sales contract creation renders and submits template-generated fields', () => {
  assert.match(source, /v-model="newContract\.template_id" @change="selectContractTemplate"/)
  assert.match(source, /v-for="field in selectedContractTemplate\.fields \|\| \[\]"/)
  assert.match(source, /v-model="newContract\.template_values\[field\.name\]"/)
  assert.match(source, /previewContractTemplate\(selectedContractTemplate\.value\.id, newContract\.value\.template_values\)/)
  assert.match(source, /payload\.template_values = \{ \.\.\.newContract\.value\.template_values \}/)
  assert.match(source, /templatePreviewRef\.value\?\.scrollIntoView/)
  assert.match(source, /templatePreviewError\.value = `请先填写/)
})

test('admin can edit and delete templates while locked fields are read-only for other users', () => {
  assert.match(source, /v-if="isAdmin"[\s\S]*编辑字段[\s\S]*删除/)
  assert.match(source, /updateContractTemplate\(templateEditForm\.value\.id/)
  assert.match(source, /deleteContractTemplate\(item\.id\)/)
  assert.match(source, /:readonly="field\.locked && !isAdmin"/)
  assert.match(source, /该字段由管理员配置/)
})

test('saved template contracts render formatted HTML instead of plain text', () => {
  assert.match(source, /previewContractDocument\(contract\.recordId\)/)
  assert.match(source, /v-else-if="selectedContractPreviewHTML"/)
  assert.match(source, /ContractDocumentPreview[^>]*:html="selectedContractPreviewHTML"/)
})

test('approval progress renders its template contract with document formatting', () => {
  assert.match(source, /previewApprovalContract\(approval\.id\)/)
  assert.match(source, /v-else-if="approvalContractPreviewHTML"/)
  assert.match(source, /ContractDocumentPreview[^>]*:html="approvalContractPreviewHTML"/)
})
