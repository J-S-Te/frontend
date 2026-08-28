import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('./', import.meta.url)
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8')

test('信用等级 API 覆盖客户查询、申请和审批动作，并对写操作启用幂等键', () => {
  const source = read('./api/credit.js')
  assert.match(source, /\/customers\/\$\{encodeURIComponent\(id\)\}\/credit/)
  assert.match(source, /createCustomerCreditApplication[\s\S]*idempotent: true/)
  assert.match(source, /approveCustomerCreditApplication[\s\S]*\/credit\/applications\//)
  assert.match(source, /rejectCustomerCreditApplication[\s\S]*\/credit\/applications\//)
})

test('客户信用界面包含列表等级、详情页签、申请表单和独立审批入口', () => {
  const view = read('./views/CustomerOpportunityView.vue')
  const panel = read('./components/CustomerCreditPanel.vue')
  assert.match(view, /信用等级/)
  assert.match(view, /credit-approvals/)
  assert.match(view, /CustomerCreditPanel/)
  assert.match(view, /import CreditApprovalInbox from '\.\.\/components\/CreditApprovalInbox\.vue'/)
  assert.match(view, /<CreditApprovalInbox v-if="activeSection === 'credit-approvals'"/)
  assert.match(panel, /至少 20/)
  assert.match(panel, /通过/)
  assert.match(panel, /驳回/)
})
