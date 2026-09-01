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
  assert.match(panel, /调整原因<textarea/)
  assert.match(panel, /通过/)
  assert.match(panel, /驳回/)
})

test('信用审批待办通过人员目录显示申请人名称，不向业务用户暴露用户 ID', () => {
	const inbox = read('./components/CreditApprovalInbox.vue')
  assert.match(inbox, /listOwnerDirectory/)
  assert.match(inbox, /applicantLabel\(item\)/)
  assert.match(inbox, /applicantNames\.value\[id\]/)
  assert.match(inbox, /未命名用户/)
	assert.match(inbox, /不向业务用户暴露内部 ID/)
})

test('信用审批待办兼容已有销售总监会话并把角色传入操作组件', () => {
	const inbox = read('./components/CreditApprovalInbox.vue')
	const view = read('./views/CustomerOpportunityView.vue')
	assert.match(inbox, /roles: \{ type: Array, default: \(\) => \[\] \}/)
	assert.match(inbox, /sales_director.*crm_super_admin/)
	assert.match(inbox, /customer\.credit\.approve.*props\.roles\.some/)
	assert.match(view, /hasCreditApprovalAccess/)
	assert.match(view, /:roles="crmSession\?\.roles \|\| \[\]"/)
})

test('信用审批待办仅在提交中禁用按钮，初始状态可点击', () => {
  const inbox = read('./components/CreditApprovalInbox.vue')
  assert.match(inbox, /const actionInProgress = \(\) => actionID\.value !== ''/)
  assert.match(inbox, /:disabled="actionInProgress\(\)"/)
  assert.doesNotMatch(inbox, /:disabled="actionID"/)
})

test('客户信用调整表单不会静默吞掉校验结果，并以表单提交发送完整申请参数', () => {
  const view = read('./views/CustomerOpportunityView.vue')
  const panel = read('./components/CustomerCreditPanel.vue')
  assert.match(view, /<CustomerCreditPanel[\s\S]*@notice="notice = \$event"[\s\S]*@error="error = \$event"/)
  assert.match(panel, /<form v-if="showForm" class="crm-credit-apply-form" @submit\.prevent="submitApply">/)
  assert.match(panel, /<select v-model="form\.target_level" required>/)
  assert.match(panel, /<textarea v-model\.trim="form\.reason" required/)
  assert.match(panel, /<button type="submit" class="primary" :disabled="submitting">/)
  assert.match(panel, /createCustomerCreditApplication\(customerID\.value, \{ target_level: form\.value\.target_level, reason: form\.value\.reason\.trim\(\) \}, createIdempotencyKey\(\)\)/)
})
