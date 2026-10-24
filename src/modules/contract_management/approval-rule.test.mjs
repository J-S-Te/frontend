import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { approvalAmountInput, approvalAmountMinor, copyRuleExpression, ruleExpressionSummary } from './utils/approvalRule.js'
import { formatUserError } from '../shared/utils/userError.js'

const view = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')

test('approval amount conditions convert exact decimal cents and reject precision loss', () => {
  assert.equal(approvalAmountMinor('0.29'), 29)
  assert.equal(approvalAmountMinor('-1.05'), -105)
  assert.equal(approvalAmountMinor('90071992547409.91'), Number.MAX_SAFE_INTEGER)
  assert.equal(approvalAmountInput(29), '0.29')
  assert.equal(approvalAmountInput(-105), '-1.05')
  assert.equal(approvalAmountInput(Number.MAX_SAFE_INTEGER), '90071992547409.91')
  for (const value of ['', 'abc', '1.001', '90071992547409.92', '1e9', Infinity]) {
    assert.throws(() => approvalAmountMinor(value), /金额条件/)
  }
  assert.throws(() => approvalAmountInput(Number.MAX_SAFE_INTEGER + 1), /安全编辑/)
})

function editor() {
  const editingRuleId = { value: '' }
  const ruleForm = { value: null }
  const ruleDialogOpen = { value: false }
  const code = view.slice(view.indexOf('function editRule(rule)'), view.indexOf('\nasync function saveRule()'))
  const methods = new Function('editingRuleId', 'ruleForm', 'ruleDialogOpen', 'approvalAmountInput', 'approvalAmountMinor', 'copyRuleExpression', 'conditionField', 'showToast', 'formatUserError',
    `${code}; return { editRule, rulePayload };`)(editingRuleId, ruleForm, ruleDialogOpen, approvalAmountInput, approvalAmountMinor, copyRuleExpression,
    (field) => ({ kind: field === 'amount_minor' ? 'number' : field === 'terms_identical' ? 'boolean' : 'text' }), (message) => { throw new Error(message) }, formatUserError)
  return { ...methods, ruleForm }
}

const baseRule = {
  id: 'rule-1', name: '分组规则', priority: 1, enabled: true, version: 2,
  nodes: [{ id: 'finance', name: '财务', role_code: 'finance_director', timeout: 3600000000000, countersign: 'any' }],
}

test('editing complex group-only rules preserves the full expression and existing timeout', () => {
  const expression = {
    logical: 'or', groups: [
      { logical: 'and', conditions: [{ field: 'amount_minor', operator: 'lte', value: 100000 }], groups: [{ conditions: [{ field: 'contract_type', operator: 'in', value: ['直签', '三方'] }] }] },
      { conditions: [{ field: 'terms_identical', operator: 'eq', value: true }] },
    ],
  }
  const { editRule, rulePayload, ruleForm } = editor()
  editRule({ ...baseRule, expression })
  assert.equal(ruleForm.value.expressionReadonly, true)
  assert.deepEqual(ruleForm.value.conditions, [])
  ruleForm.value.name = '更名'
  const payload = rulePayload(ruleForm.value)
  assert.equal(payload.name, '更名')
  assert.deepEqual(payload.expression, expression)
  assert.equal(payload.nodes[0].timeout, 3600000000000)
  assert.equal(payload.version, 2)
  payload.expression.groups[0].conditions[0].value = 1
  assert.equal(expression.groups[0].conditions[0].value, 100000)
  assert.equal(ruleForm.value.originalExpression.groups[0].conditions[0].value, 100000)
  assert.match(view, /触发条件（只读）/)
})

test('simple amount rules remain editable without silent rounding or noninteger priority', () => {
  const { editRule, rulePayload, ruleForm } = editor()
  editRule({ ...baseRule, expression: { conditions: [{ field: 'amount_minor', operator: 'gt', value: 29 }] } })
  assert.equal(ruleForm.value.conditions[0].value, '0.29')
  assert.equal(rulePayload(ruleForm.value).expression.conditions[0].value, 29)
  ruleForm.value.conditions[0].value = '1.001'
  assert.throws(() => rulePayload(ruleForm.value), /最多两位小数/)
  ruleForm.value.priority = 1.5
  assert.throws(() => rulePayload(ruleForm.value), /优先级/)
  assert.match(view, /:step="conditionField\(condition\.field\)\.kind === 'number' \? '0\.01' : undefined"/)
})

test('rule summaries include nested groups rather than claiming no conditions', () => {
  const summary = ruleExpressionSummary({ groups: [{ logical: 'or', conditions: [{ field: 'a' }, { field: 'b' }] }] }, (condition) => condition.field)
  assert.equal(summary, '（a 或 b）')
})

test('read-only groups cannot silently resave amounts outside the exact integer range', () => {
  const expression = { groups: [{ conditions: [{ field: 'amount_minor', operator: 'gt', value: Number.MAX_SAFE_INTEGER + 1 }] }] }
  assert.throws(() => copyRuleExpression(expression), /安全编辑/)
  const { editRule, ruleForm } = editor()
  assert.throws(() => editRule({ ...baseRule, expression }), /安全编辑/)
  assert.equal(ruleForm.value, null)
})
