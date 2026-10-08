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

test('template source replacement retains identity and explains existing contract integrity', () => {
  assert.match(source, /@click="openTemplateReplacement\(item\)"/)
  assert.match(source, /同名字段配置会保留[\s\S]*已生成合同的固化正文不变/)
  assert.match(source, /replaceContractTemplateSource\(templateReplacementID\.value, file\)/)
  assert.match(source, /templateUploadError"[\s\S]*role="alert"/)
  assert.match(source, /newContract\.value\.template_id === templateReplacementID\.value\) selectContractTemplate/)
})

test('sales contract creation renders and submits template-generated fields', () => {
  assert.match(source, /v-model="newContract\.template_id" :disabled="Boolean\(editingContract\)" required @change="selectContractTemplate"/)
  assert.match(source, /v-for="field in editableContractTemplateFields"/)
  assert.match(source, /v-model="newContract\.template_values\[field\.name\]"/)
  assert.match(source, /previewContractTemplate\(selectedContractTemplate\.value\.id, newContract\.value\.template_values\)/)
  assert.match(source, /template_values: \{ \.\.\.newContract\.value\.template_values \}/)
  assert.match(source, /templatePreviewRef\.value\?\.scrollIntoView/)
  assert.match(source, /templatePreviewError\.value = `请先填写/)
})

test('admin can edit and delete templates while locked fields are read-only for other users', () => {
  assert.match(source, /<footer v-if="isAdmin" class="contract-template-actions">[\s\S]*>编辑<[\s\S]*>删除</)
  assert.match(source, /updateContractTemplate\(templateEditForm\.value\.id/)
  assert.match(source, /deleteContractTemplate\(item\.id\)/)
  assert.match(source, /:readonly="isContractAmountField\(field\) \|\| \(field\.locked && !isAdmin\)"/)
  assert.match(source, /此项已由管理员预设/)
  assert.match(source, /:title="field\.locked && !isAdmin \? '此项已由管理员预设' : undefined"/)
})

test('admin can edit the automatic contract number format on a template', () => {
  assert.match(source, /v-model="templateEditForm\.number_format"/)
  assert.match(source, /number_format: templateEditForm\.value\.number_format\.trim\(\)/)
  assert.match(source, /必须包含 \{ID8\}/)
})

test('saved template contracts render formatted HTML instead of plain text', () => {
  assert.match(source, /previewContractDocument\(contract\.recordId\)/)
  assert.match(source, /v-else-if="selectedContractPreviewHTML"/)
  assert.match(source, /ContractDocumentPreview[^>]*:html="selectedContractPreviewHTML"/)
})

test('contract detail shows persisted lifecycle transitions', () => {
  assert.match(source, /listContractLifecycle\(contract\.recordId\)/)
  assert.match(source, /<h3>流转明细<\/h3>/)
  assert.match(source, /contractStatusLabel\(event\.from_status\)[\s\S]*contractStatusLabel\(event\.to_status\)/)
  assert.match(source, /formatDateTime\(event\.occurred_at\)/)
})

test('approval progress renders its template contract with document formatting', () => {
  assert.match(source, /listOpportunityIntakes,\s*previewApprovalContract,\s*previewContractTemplate,/)
  assert.match(source, /previewApprovalContract\(approval\.id\)/)
  assert.match(source, /v-else-if="approvalContractPreviewHTML"/)
  assert.match(source, /ContractDocumentPreview[^>]*:html="approvalContractPreviewHTML"/)
})
