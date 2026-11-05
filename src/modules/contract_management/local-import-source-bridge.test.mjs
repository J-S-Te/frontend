import test from 'node:test'
import assert from 'node:assert/strict'
import { importRowSourceForm, applyImportRowSourceForm } from './utils/localImportSourceBridge.js'

test('来源选择往返保留原件、业务键、金额和原服务项身份，清除CRM商机身份', () => {
  const row = { key: 'item', fileName: 'synthetic.pdf', externalRecordId: 'OLD-1', amount: '100.00',
    crmCustomerId: '7', opportunityId: '9', opportunityName: '原商机',
    serviceItems: [{ sourceId: 'original-source', serviceType: '软件测试', category: '旧类别' }] }
  const form = importRowSourceForm(row)
  Object.assign(form, { counterparty_source: 'LOCAL', local_counterparty_id: 'local-party',
    counterparty_version: 2, customer_name: '本地单位', category_source: 'LOCAL' })
  Object.assign(form.service_items[0], { source_id: 'wrong-source', category_id: 'local-category',
    category_version: 3, category: '软件测试' })
  const result = applyImportRowSourceForm(row, form)
  assert.equal(result.fileName, 'synthetic.pdf')
  assert.equal(result.externalRecordId, 'OLD-1')
  assert.equal(result.amount, '100.00')
  assert.equal(result.crmCustomerId, '')
  assert.equal(result.opportunityId, '')
  assert.equal(result.serviceItems[0].sourceId, 'original-source')
  assert.equal(result.serviceItems[0].categoryVersion, 3)
  assert.equal(row.crmCustomerId, '7')
})

test('旧CRM行不自动改来源，服务项错位拒绝合并', () => {
  const row = { crmCustomerId: '7', serviceItems: [{ sourceId: 'source-1' }] }
  assert.deepEqual(applyImportRowSourceForm(row, importRowSourceForm(row)), row)
  assert.throws(() => applyImportRowSourceForm(row, { service_items: [] }), /服务项已变化/)
})
