import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const consoleCss = readFileSync(new URL('../platform/styles/console.css', import.meta.url), 'utf8')
const crmCss = readFileSync(new URL('./styles/customer-opportunity.css', import.meta.url), 'utf8')
const dialog = readFileSync(new URL('./components/OpportunityEditorDialog.vue', import.meta.url), 'utf8')

test('通用 console-form-item 不再把 checkbox/radio 当成整行输入框', () => {
  assert.match(consoleCss, /\.console-form-item input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/)
  assert.doesNotMatch(consoleCss, /(^|\n)\.console-form-item input,\n/)
  assert.match(consoleCss, /\.console-form-item input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):focus/)
})

test('商机多选列表的复选框尺寸不受 CSS 加载顺序影响', () => {
  assert.match(crmCss, /\.crm-opportunity-check-list \.crm-opportunity-check-item input\s*\{[^}]*width:\s*16px/)
  assert.match(crmCss, /\.crm-opportunity-check-list\s*\{[^}]*overflow-x:\s*hidden/)
  assert.match(crmCss, /\.crm-opportunity-check-item span\s*\{[^}]*flex:\s*1 1 auto/)
})

test('商机弹窗仍使用两列多选容器和可访问字段集', () => {
  assert.match(dialog, /class="console-form-item crm-opportunity-multi-field"/)
  assert.match(dialog, /class="crm-opportunity-check-list"/)
  assert.match(dialog, /<legend>商机类型/)
  assert.match(dialog, /<legend>来源/)
})

test('同类通用表单 rules 均排除 checkbox/radio，避免 CSS 顺序再次撑满复选框', () => {
  const files = {
    portal: '../customer_portal/styles/customer-portal.css',
    settlement: '../settlement/styles/settlement.css',
    dataAnalysis: '../data_analysis/styles/data-analysis.css',
    platform: '../platform/styles/platform-console.css',
    project: '../project_management/styles/project-management.css',
    contract: '../contract_management/styles/contract-management.css',
    reimbursement: '../reimbursement/reimbursement.css',
    loginTarget: '../platform/login-targets/styles/application-login-target.css',
    loginSecurity: '../platform/security/styles/login-security.css',
  }
  const expected = {
    portal: /\.filing-field input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/,
    settlement: /\.settlement-form input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/,
    dataAnalysis: /\.da-modal input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/,
    platform: /\.console-form-item input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/,
    project: /\.pm-form input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/,
    contract: /\.contract-form-grid input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/,
    reimbursement: /\.expense-panel input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/,
    loginTarget: /\.login-target-dialog input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/,
    loginSecurity: /\.so-policy-grid input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/,
  }
  for (const [name, relative] of Object.entries(files)) {
    const css = readFileSync(new URL(relative, import.meta.url), 'utf8')
    assert.match(css, expected[name], name)
  }
})

test('共享视觉层给表单内原生 checkbox/radio 固定 16px，避免 grid/flex 拉伸', () => {
  const css = readFileSync(new URL('../shared/styles/ui-refresh.css', import.meta.url), 'utf8')
  assert.match(css, /input\[type="checkbox"\], input\[type="radio"\]/)
  assert.match(css, /:is\(input\[type="checkbox"\], input\[type="radio"\]\)\s*\{[^}]*width:\s*16px/)
  assert.match(css, /:is\(input\[type="checkbox"\], input\[type="radio"\]\)\s*\{[^}]*align-self:\s*flex-start/)
})
