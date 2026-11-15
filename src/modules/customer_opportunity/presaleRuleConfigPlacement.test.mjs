import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const view = readFileSync(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles/customer-opportunity.css', import.meta.url), 'utf8')

test('售前规则配置收进页头低频菜单，不再占用申请列表上方主路径', () => {
  assert.match(view, /class="crm-rule-config"/)
  assert.match(view, /规则配置/)
  assert.match(view, /售前审批规则/)
  assert.match(view, /v-if="canConfigurePresaleAlerts" @click="openAlertConfig"/)
  assert.match(view, /function openApprovalRuleDrawer\(\)/)
  assert.match(view, /v-if="showRuleDrawer && canManagePresaleApprovalRules"/)
  assert.doesNotMatch(view, /<PresaleApprovalRulesPanel v-if="activeSection === 'presale' && !presaleCreatePage/)
})

test('审批规则使用统一 console 遮罩/关闭按钮的右侧抽屉', () => {
  assert.match(view, /class="console-modal-backdrop crm-rule-drawer-backdrop"/)
  assert.match(view, /class="crm-rule-drawer"/)
  assert.match(view, /class="console-modal-close"/)
  assert.match(view, /<PresaleApprovalRulesPanel :is-admin="canManagePresaleApprovalRules" \/>/)
  assert.match(css, /\.crm-rule-config__menu \{/)
  assert.match(css, /\.console-modal-backdrop\.crm-rule-drawer-backdrop \{ display: flex;/)
  assert.match(css, /\.crm-rule-drawer \{/)
  assert.match(css, /\.crm-rule-drawer \.crm-approval-rules-panel\.crm-panel \{/)
  assert.match(css, /@media \(max-width: 720px\) \{\s*\.crm-rule-drawer \{ width: 100%; \}/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.crm-rule-drawer \{ animation: none; \} \}/)
})
