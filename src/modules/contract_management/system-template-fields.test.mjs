import test from 'node:test'
import assert from 'node:assert/strict'
import { isSystemContractNumberField, synchronizeContractTemplateValues } from './utils/systemTemplateFields.js'

test('number fields cannot be submitted and amount follows ledger input', () => {
  const fields = [{ name: '系统合同编号' }, { name: '合同编号' }, { name: '合同金额' }, { name: '付款金额' }, { name: '签订日期' }]
  const result = synchronizeContractTemplateValues(fields, { 系统合同编号: 'fake', 合同编号: 'fake', 合同金额: '200', 付款金额: '300', 签订日期: '2026年10月8日' }, '10000')
  assert.deepEqual(result, { 合同金额: '10000', 付款金额: '300', 签订日期: '2026年10月8日' })
  assert.equal(isSystemContractNumberField({ name: '合同登记编号' }), false)
})
