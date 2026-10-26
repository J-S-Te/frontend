import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
for (const path of ['contract_management/views/ContractManagementView.vue', 'project_management/views/ProjectManagementView.vue', 'data_analysis/views/AlertRulesView.vue', 'data_analysis/views/DictionaryView.vue', 'settlement/views/SettlementView.vue', 'customer_opportunity/views/CustomerOpportunityView.vue', 'customer_portal/views/CustomerPortalView.vue']) {
  test(`${path} 操作结果使用共享顶层提示`, () => {
    const source = read('../' + path)
    assert.match(source, /import OperationToast from/)
    assert.match(source, /<OperationToast\b/)
  })
}
test('共享提示脱离模块层叠上下文，高于确认框并支持长文字和小屏幕', () => {
  const source = read('./components/OperationToast.vue')
  assert.match(source, /<Teleport to="body">/)
  assert.match(source, /z-index:\s*12000/)
  assert.match(source, /overflow-wrap:\s*anywhere/)
  assert.match(source, /aria-atomic="true"/)
  assert.match(source, /max-width:/)
})
