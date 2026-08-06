import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const view = await readFile(new URL('./platform/iam/components/IamSettingsModule.vue', import.meta.url), 'utf8')
const onboarding = await readFile(new URL('./platform/iam/components/EmployeeOnboardingModal.vue', import.meta.url), 'utf8')
const style = await readFile(new URL('./platform/iam/styles/iam-settings.css', import.meta.url), 'utf8')

test('基础平台用户模块展示并导出脱敏手机号', () => {
  assert.match(view, /<th>手机号<\/th>/)
  assert.match(view, /data-label="手机号" class="console-mono iam-user-mobile-cell"/)
  assert.match(view, /\{\{ item\.mobile_masked \|\| '—' \}\}/)
  assert.match(view, /'手机号（脱敏）'/)
  assert.match(view, /item\.mobile_masked \|\| ''/)
  assert.match(style, /\.iam-user-table \.iam-user-mobile-cell/)
})

test('新增员工表单使用明确的手机号字段名称', () => {
  assert.match(onboarding, /<span>手机号<\/span><input v-model="form\.mobile"/)
})
