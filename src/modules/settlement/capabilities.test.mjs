import test from 'node:test'
import assert from 'node:assert/strict'
const capabilities = await import('./utils/capabilities.js').catch(() => ({}))
test('无权限与未知会话没有默认全量页面', () => {
  assert.equal(typeof capabilities.allowedSections, 'function')
  assert.deepEqual(capabilities.allowedSections({}), [])
  assert.deepEqual(capabilities.allowedSections({roles:['unknown'], permissions:[]}), [])
})
test('配置管理员仅进入设置；管理层不加载财务明细', () => {
  assert.deepEqual(capabilities.allowedSections({permissions:['settlement.settings.manage']}), ['settings'])
  const can = capabilities.permissionCheck({permissions:['settlement.dashboard.read','settlement.report.read']})
  assert.equal(capabilities.canLoad('listReceipts', can), false)
  assert.equal(capabilities.canLoad('listInvoiceRequests', can), false)
})
test('销售催收反馈不能维护策略，开票申请能力不授予普通/特殊审批', () => {
  const can = capabilities.permissionCheck({permissions:['settlement.dunning.read','settlement.dunning.feedback','settlement.invoice.request']})
  assert.equal(capabilities.canLoad('listDunningPolicies', can), false)
  assert.equal(can('settlement.invoice.approve'), false)
  assert.equal(can('settlement.invoice.special_approve'), false)
  assert.equal(capabilities.canLoad('listInvoiceEligibleReceivables', can), true)
})
