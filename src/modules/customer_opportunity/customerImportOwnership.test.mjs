import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const view = await readFile(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')

test('客户导入模板只展示业务字段，不要求人员或组织 ID', () => {
  const columns = view.match(/const customerImportTemplateColumns = Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1]
  assert.ok(columns)
  assert.equal((columns.match(/\['/g) || []).length, 8)
  assert.doesNotMatch(columns, /负责人用户ID|负责人组织ID/)
  assert.match(view, /新客户自动归当前导入人/)
  assert.match(view, /导入后使用“变更负责人”/)
})

test('导入预检展示服务端确认的负责人和组织名称，不向使用人回显内部 ID', () => {
  assert.match(view, /row\.owner_display_name \|\| '当前导入人'/)
  assert.match(view, /row\.owner_org_name \|\| '未确认组织'/)
  assert.doesNotMatch(view, /\{\{\s*row\.owner_user_id|\{\{\s*row\.owner_org_id/)
})
