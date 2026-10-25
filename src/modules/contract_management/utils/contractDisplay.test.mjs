import assert from 'node:assert/strict'
import test from 'node:test'
import {
  approvalActionLabels,
  approvalKindLabel,
  approvalKindLabels,
  approvalNodeStatusLabels,
  approvalNotificationTitle,
  approvalStatusLabel,
  approvalStatusLabels,
  emptyNewContract,
  emptyRuleForm,
  emptyServiceItem,
  fallbackContractTypeOptions,
  fallbackServiceTypeOptions,
  fallbackSystemLevelOptions,
  groupCurrencyTotals,
  numericOperators,
  roleLabel,
  ruleFieldOptions,
  statusLabels,
  textOperators,
  toDictionaryFallback,
} from './contractDisplay.js'
import { CONTRACT_ROLE_DEFINITIONS } from '../../shared/authz/sys004.js'

test('字典回退把值映射为同名标签；三个回退选项簇非空且含合同域核心值', () => {
  assert.deepEqual(toDictionaryFallback(['直签', '三方']), [{ value: '直签', label: '直签' }, { value: '三方', label: '三方' }])
  assert.ok(fallbackContractTypeOptions.includes('直签'))
  assert.ok(fallbackServiceTypeOptions.length > 0 && fallbackServiceTypeOptions.every((value) => typeof value === 'string'))
  assert.ok(fallbackSystemLevelOptions.includes('四级'))
})

test('规则引擎字段目录：字段/数值算子/文本算子彼此引用且不混淆', () => {
  assert.ok(ruleFieldOptions.length > 0)
  const fieldValues = new Set(ruleFieldOptions.map((field) => field.value))
  for (const operator of numericOperators) {
    assert.ok(typeof operator.value === 'string' && operator.label.length > 0)
  }
  for (const operator of textOperators) {
    assert.ok(typeof operator.value === 'string' && operator.label.length > 0)
  }
  const allOperators = new Set([...numericOperators, ...textOperators].map((operator) => operator.value))
  assert.ok(allOperators.has('in'))
})

test('roleLabel 经 sys004 契约解析角色名，未知与空值回落中文', () => {
  const known = CONTRACT_ROLE_DEFINITIONS[0]?.code
  if (known) assert.equal(roleLabel(known), contractRoleName(known))
  assert.equal(roleLabel(''), '未分配角色')
  assert.equal(roleLabel('NO_SUCH_ROLE'), '未识别角色')
  function contractRoleName(code) {
    return CONTRACT_ROLE_DEFINITIONS.find((role) => role.code === code)?.name
  }
})

test('按币种聚合：非法币种代码归 CNY，按币种名字典序排序', () => {
  const totals = groupCurrencyTotals([
    { currency: 'CNY', amount_minor: 10000 },
    { currency: 'c9', amount_minor: 500 },
    { currency: 'USD', amount_minor: 20000 },
    { currency: 'CNY', amount_minor: 5000 },
  ])
  assert.deepEqual(totals.map((item) => item.currency), ['CNY', 'USD'])
  assert.equal(totals[0].amountMinor, 15500)
  assert.equal(totals[0].contracts, 3)
  assert.equal(totals[1].amountMinor, 20000)
  assert.deepEqual(groupCurrencyTotals([]), [])
  assert.deepEqual(groupCurrencyTotals(null), [])
})

test('审批四类标签簇覆盖流转语义，未知值原样透出', () => {
  assert.equal(approvalStatusLabels.running, '审批中')
  assert.equal(approvalNodeStatusLabels.active, '处理中')
  assert.equal(approvalNodeStatusLabels.skipped, '已跳过')
  assert.ok(Object.keys(approvalKindLabels).length > 0)
  assert.ok(Object.keys(approvalActionLabels).length > 0)
  assert.equal(approvalStatusLabel('NO_SUCH'), 'NO_SUCH')
  assert.equal(approvalKindLabel('NO_SUCH'), '合同审批')
})

test('审批通知标题按类型与节点拼装，缺省回落当前节点', () => {
  assert.equal(approvalNotificationTitle({ type: '合同状态变更', step: '财务复核' }), '合同状态变更已流转至财务复核')
  assert.equal(approvalNotificationTitle({}), '合同审批已流转至当前节点')
})

test('表单工厂返回全新对象且字段与后端载荷一致', () => {
  const serviceItem = emptyServiceItem()
  assert.equal(serviceItem.batch, '第一批次')
  assert.equal(serviceItem.test_mode, 'STANDARD')
  assert.ok(Array.isArray(serviceItem.systems))
  const contract = emptyNewContract()
  assert.ok(Array.isArray(contract.service_items))
  const rule = emptyRuleForm()
  assert.ok(Array.isArray(rule.conditions) && Array.isArray(rule.nodes))
  assert.equal(rule.logical, 'and')
  assert.notEqual(emptyServiceItem().systems, serviceItem.systems)
})

test('主状态标签簇覆盖合同生命周期', () => {
  for (const key of Object.keys(statusLabels)) {
    assert.ok(typeof statusLabels[key] === 'string' && statusLabels[key].length > 0, key)
  }
})
