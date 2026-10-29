import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PLAN_CREATE_FIELDS,
  PLAN_ADJUST_FIELDS,
  INVOICE_REQUEST_FIELDS,
  validateField,
  validateForm,
  firstInvalidField,
  retainVisibleErrors,
} from './formFeedback.js'

// DEF-01/02/03 回归：三处表单提交前的应用级必填/格式校验纯函数。
// 这些用例锁定字段声明顺序、中文文案与首个错误选择；组件只消费结果做红框、错误文案与聚焦，不访问 DOM。

const VALID_PLAN = {
  contract_snapshot_id: 'CS-1',
  installment_no: 1,
  due_date: '2026-11-30',
  planned_amount: '100000',
  reason: '自动化测试计划',
}

const VALID_ADJUSTMENT = {
  id: 'PLAN-1',
  version: 2,
  due_date: '2026-12-31',
  planned_amount: '80000',
  reason: '客户要求顺延',
}

const VALID_INVOICE = {
  receivable_id: 'AR-1',
  buyer_tax_no: '91110000MA',
  item_name: '测评服务',
  tax_classification_code: '3040201',
  amount_excl_tax: '10000',
  tax_rate: '0.06',
  tax_amount: '600',
  amount_incl_tax: '10600',
}

test('创建计划字段按合同/期次/收款日/金额/原因声明，合法值无错误', () => {
  assert.deepEqual(PLAN_CREATE_FIELDS.map((field) => field.key), [
    'contract_snapshot_id', 'installment_no', 'due_date', 'planned_amount', 'reason',
  ])
  assert.deepEqual(validateForm(PLAN_CREATE_FIELDS, VALID_PLAN), {})
})

test('创建计划必填缺失时返回逐字段中文提示', () => {
  const errors = validateForm(PLAN_CREATE_FIELDS, { installment_no: 1 })
  assert.equal(errors.contract_snapshot_id, '请选择合同。')
  assert.equal(errors.due_date, '请选择收款日。')
  assert.equal(errors.planned_amount, '请填写金额。')
  assert.equal(errors.reason, '请填写原因。')
  assert.equal('installment_no' in errors, false)
})

test('空白字符串、null 与 undefined 一律视为未填写', () => {
  const errors = validateForm(PLAN_CREATE_FIELDS, { ...VALID_PLAN, planned_amount: '   ', reason: null })
  assert.equal(errors.planned_amount, '请填写金额。')
  assert.equal(errors.reason, '请填写原因。')
  assert.deepEqual(validateForm(PLAN_CREATE_FIELDS, {}), {
    contract_snapshot_id: '请选择合同。',
    installment_no: '请填写期次。',
    due_date: '请选择收款日。',
    planned_amount: '请填写金额。',
    reason: '请填写原因。',
  })
})

test('创建计划金额与期次做数字及范围格式校验', () => {
  const amountField = PLAN_CREATE_FIELDS.find((field) => field.key === 'planned_amount')
  const installmentField = PLAN_CREATE_FIELDS.find((field) => field.key === 'installment_no')
  for (const bad of ['0', '0.00', '-1', 'abc', '1.234', '1,000', '.5', '1e3', '+1']) {
    assert.equal(validateField(amountField, bad), '金额必须大于 0，且最多保留两位小数。', bad)
  }
  for (const good of ['0.01', '1.5', '100.50', '100000', 100000, 0.01]) {
    assert.equal(validateField(amountField, good), '', String(good))
  }
  for (const bad of [0, -1, 1.5, '2.0', 'abc']) {
    assert.equal(validateField(installmentField, bad), '期次必须是大于 0 的整数。', String(bad))
  }
  for (const good of [1, 12, '3']) {
    assert.equal(validateField(installmentField, good), '', String(good))
  }
})

test('调整计划表单校验计划/收款日/金额/原因', () => {
  assert.deepEqual(PLAN_ADJUST_FIELDS.map((field) => field.key), ['id', 'due_date', 'planned_amount', 'reason'])
  assert.deepEqual(validateForm(PLAN_ADJUST_FIELDS, VALID_ADJUSTMENT), {})
  const errors = validateForm(PLAN_ADJUST_FIELDS, { id: '', due_date: '', planned_amount: '-5', reason: ' ' })
  assert.equal(errors.id, '请选择需要调整的收款计划。')
  assert.equal(errors.due_date, '请选择收款日。')
  assert.equal(errors.planned_amount, '金额必须大于 0，且最多保留两位小数。')
  assert.equal(errors.reason, '请填写调整原因。')
})

test('开票申请八项字段逐项校验且顺序固定', () => {
  assert.deepEqual(INVOICE_REQUEST_FIELDS.map((field) => field.key), [
    'receivable_id', 'buyer_tax_no', 'item_name', 'tax_classification_code',
    'amount_excl_tax', 'tax_rate', 'tax_amount', 'amount_incl_tax',
  ])
  assert.deepEqual(validateForm(INVOICE_REQUEST_FIELDS, VALID_INVOICE), {})
  assert.deepEqual(validateForm(INVOICE_REQUEST_FIELDS, {}), {
    receivable_id: '请选择可开票应收。',
    buyer_tax_no: '请填写购方税号。',
    item_name: '请填写项目名称。',
    tax_classification_code: '请填写税收分类编码。',
    amount_excl_tax: '请填写不含税金额。',
    tax_rate: '请填写税率。',
    tax_amount: '请填写税额。',
    amount_incl_tax: '请填写价税合计。',
  })
})

test('开票申请金额与税率做数字和范围格式校验（税额/税率允许零税率与免税行）', () => {
  // 不含税金额与价税合计必须 >0；税额允许 0（服务端 nonNegativeAmount 明确支持零税率/免税行）。
  for (const key of ['amount_excl_tax', 'amount_incl_tax']) {
    const field = INVOICE_REQUEST_FIELDS.find((item) => item.key === key)
    assert.equal(validateField(field, '0'), `${field.label}必须大于 0，且最多保留两位小数。`, key)
    assert.equal(validateField(field, 'abc'), `${field.label}必须大于 0，且最多保留两位小数。`, key)
    assert.equal(validateField(field, '12.345'), `${field.label}必须大于 0，且最多保留两位小数。`, key)
    assert.equal(validateField(field, '10600.00'), '', key)
  }
  const taxAmount = INVOICE_REQUEST_FIELDS.find((field) => field.key === 'tax_amount')
  for (const bad of ['-1', '-0.01', 'abc', '1.234', '6%']) {
    assert.equal(validateField(taxAmount, bad), '税额必须大于等于 0，且最多保留两位小数。', bad)
  }
  for (const good of ['0', '0.00', '600', '10600.00', 0]) {
    assert.equal(validateField(taxAmount, good), '', String(good))
  }
  // 税率允许 0（零税率/免税行）；负数与非数字仍拒绝。
  const rate = INVOICE_REQUEST_FIELDS.find((field) => field.key === 'tax_rate')
  for (const bad of ['-0.06', 'abc', '6%', '.06']) {
    assert.equal(validateField(rate, bad), '税率必须是大于等于 0 的数字，例如 0.06 或 0。', bad)
  }
  for (const good of ['0', '0.00', '0.06', '0.13', '0.0600', 0.06]) {
    assert.equal(validateField(rate, good), '', String(good))
  }
  // 零税率免税行：税额 0、价税合计=不含税金额，应整体通过。
  assert.deepEqual(validateForm(INVOICE_REQUEST_FIELDS, { ...VALID_INVOICE, tax_rate: '0', tax_amount: '0' }), {})
})

test('首个错误按字段声明顺序选择，供提交失败后聚焦第一个错误字段', () => {
  assert.equal(firstInvalidField(PLAN_CREATE_FIELDS, validateForm(PLAN_CREATE_FIELDS, {})).key, 'contract_snapshot_id')
  assert.equal(firstInvalidField(PLAN_CREATE_FIELDS, { reason: '请填写原因。', planned_amount: '请填写金额。' }).key, 'planned_amount')
  assert.equal(firstInvalidField(PLAN_CREATE_FIELDS, {}), null)
  assert.equal(firstInvalidField(PLAN_CREATE_FIELDS, null), null)
  const invoiceErrors = validateForm(INVOICE_REQUEST_FIELDS, { ...VALID_INVOICE, buyer_tax_no: '', tax_rate: '' })
  assert.equal(firstInvalidField(INVOICE_REQUEST_FIELDS, invoiceErrors).key, 'buyer_tax_no')
  assert.equal(firstInvalidField(PLAN_ADJUST_FIELDS, validateForm(PLAN_ADJUST_FIELDS, {})).key, 'id')
})

test('用户修正字段后只保留仍失败的旧错误，不凭空出现新错误', () => {
  const previous = validateForm(PLAN_CREATE_FIELDS, {})
  assert.deepEqual(retainVisibleErrors(PLAN_CREATE_FIELDS, { ...VALID_PLAN, reason: '' }, previous), {
    reason: '请填写原因。',
  })
  assert.deepEqual(retainVisibleErrors(PLAN_CREATE_FIELDS, VALID_PLAN, previous), {})
  assert.deepEqual(retainVisibleErrors(PLAN_CREATE_FIELDS, {}, { reason: '请填写原因。' }), {
    reason: '请填写原因。',
  })
  assert.deepEqual(retainVisibleErrors(PLAN_CREATE_FIELDS, VALID_PLAN, {}), {})
})
