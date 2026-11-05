import assert from 'node:assert/strict'
import test from 'node:test'
import { contractImportErrorHeaders, contractImportErrorRows, contractImportErrorsCsv,
  contractImportProvisionIssueLabels } from './contractImportErrors.js'

const labels = { REQUIRED: '必填项缺失', INVALID_AMOUNT: '金额格式不正确' }
const fieldLabel = (field) => ({ 'metadata.title': '合同标题', 'metadata.amount': '金额' })[field]

test('合同导入错误报告：逐项问题、批次错误、表头、BOM、CRLF 与行数', () => {
  const items = [
    { item: { item_key: 'one' }, issues: [
      { field_path: 'metadata.title', code: 'REQUIRED', retryable: true },
      { field_path: 'metadata.amount', code: 'INVALID_AMOUNT', retryable: false, message: '金额格式不正确' },
    ] },
    { item: { item_key: 'two', external_record_id: 'old-2' }, issues: [] },
  ]
  const rows = contractImportErrorRows(items, '批次查询失败，请保留批次号', { issueLabels: labels, fieldLabel })
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0], ['1', 'one', '合同标题', 'REQUIRED', '是', '必填项缺失'])
  assert.deepEqual(rows[1], ['1', 'one', '金额', 'INVALID_AMOUNT', '否', '金额格式不正确'])
  assert.deepEqual(rows[2], ['批次', '', '', '', '', '批次查询失败，请保留批次号'])

  const csv = contractImportErrorsCsv(items, '批次查询失败，请保留批次号', { issueLabels: labels, fieldLabel })
  assert.ok(csv.startsWith('\ufeff'))
  assert.equal(csv.split('\r\n')[0], `\ufeff${contractImportErrorHeaders.join(',')}`)
  assert.equal(csv.split('\r\n')[0], '\ufeff序号,合同标识,错误字段,错误码,可重试,说明')
  assert.equal(csv.split('\r\n').length, 4)
})

test('合同导入错误报告：空问题只保留表头，字段/错误码缺失时留空或回退错误码', () => {
  assert.equal(contractImportErrorRows([{ item: { item_key: 'one' }, issues: [] }], '').length, 0)
  assert.equal(contractImportErrorsCsv([], '').split('\r\n').length, 1)
  assert.equal(contractImportErrorsCsv(null, null).split('\r\n').length, 1)
  assert.deepEqual(contractImportErrorRows([{ item: { item_key: 'one' }, issues: [{ code: 'REQUIRED' }] }], ''),
    [['1', 'one', '', 'REQUIRED', '否', 'REQUIRED']])
})

test('合同导入错误报告：公式前缀被中和，合同标识可回退来源业务键', () => {
  const csv = contractImportErrorsCsv([
    { item: { external_record_id: 'old-2' }, issues: [{ field_path: '=field', code: '@CODE', retryable: true, message: '=1+1' }] },
  ], '+batch', {})
  assert.ok(csv.includes("'=field"))
  assert.ok(csv.includes("'@CODE"))
  assert.ok(csv.includes("'=1+1"))
  assert.ok(csv.includes("'+batch"))
  assert.ok(csv.includes('old-2'))
})

test('provision 失败原因提供中文映射，错误报告不再只显示英文错误码', () => {
  const codes = ['IMPORT_CRM_PROVISION_DISABLED', 'IMPORT_PROVISION_OWNER_UNRESOLVED', 'IMPORT_PROVISION_CUSTOMER_AMBIGUOUS',
    'IMPORT_PROVISION_CRM_REJECTED', 'IMPORT_PROVISION_CONTRACT_NOT_VERIFIED']
  for (const code of codes) {
    assert.equal(typeof contractImportProvisionIssueLabels[code], 'string', code)
    assert.match(contractImportProvisionIssueLabels[code], /[\u4e00-\u9fa5]/, code)
  }
  assert.equal(Object.isFrozen(contractImportProvisionIssueLabels), true)
  const rows = contractImportErrorRows([
    { item: { item_key: 'one' }, issues: codes.map((code) => ({ field_path: 'metadata.sales_name', code, retryable: false })) },
  ], '', { issueLabels: contractImportProvisionIssueLabels, fieldLabel: () => '销售姓名' })
  assert.equal(rows.length, codes.length)
  assert.equal(rows[1][3], 'IMPORT_PROVISION_OWNER_UNRESOLVED')
  assert.equal(rows[1][5], contractImportProvisionIssueLabels.IMPORT_PROVISION_OWNER_UNRESOLVED)
  assert.equal(rows[1][2], '销售姓名')
})
