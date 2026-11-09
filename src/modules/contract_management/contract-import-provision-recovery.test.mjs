import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contractImportErrorRows,
  contractImportErrorsCsv,
  contractImportProvisionIssueLabels,
} from './utils/contractImportErrors.js'

test('CRM依赖故障在错误报告中明确要求从原批次恢复', () => {
  const items = [{ item: { item_key: 'legacy-one' }, issues: [{
    field_path: 'metadata', code: 'IMPORT_PROVISION_CRM_UNAVAILABLE', retryable: true,
  }] }]
  const options = { issueLabels: contractImportProvisionIssueLabels }
  const rows = contractImportErrorRows(items, '', options)
  assert.match(rows[0][5], /CRM.*暂不可用/)
  assert.match(rows[0][5], /原批次.*恢复/)
  assert.doesNotMatch(rows[0][5], /核对.*金额|签约日期/)
  assert.match(contractImportErrorsCsv(items, '', options), /原批次.*恢复/)
  assert.equal(rows[0][4], '是')
})
