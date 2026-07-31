import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./contract_management/views/ContractManagementView.vue', import.meta.url), 'utf8')

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
