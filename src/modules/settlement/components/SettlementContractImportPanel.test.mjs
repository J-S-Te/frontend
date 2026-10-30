import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref, computed } from 'vue'

// panelHarness 编译实际组件并仅替换外部API与生命周期，验证用户提交的数据边界。
// 参数：overrides为定向失败或业务响应替身。
// 返回值：实际setup状态与调用记录，不冒充真实服务验收。
function panelHarness(overrides = {}) {
  const calls = []
  const data = { contract_snapshot_id: 'snapshot-A', snapshot_version: 1, customer_id: 'customer-A', customer_name: '客户甲',
    currency: 'CNY', plans: [], expected_facts: [{source_system: 'old', fact_type: 'RECEIPT', external_fact_id: 'receipt-1'}] }
  const deps = { ref, computed, onMounted() {}, onBeforeUnmount() {},
    listContractImports: async () => ({items: []}),
    getContractImport: async (id, query) => { calls.push(['query', id, query]); return query?.facts ? {items: [], total: 0} : data },
    createReceipt: async payload => {calls.push(['receipt', payload]); return {id: 'local-receipt'}},
    createReceiptAllocation: async payload => {calls.push(['allocation', payload]); return {id: 'local-allocation'}},
    confirmReceivablePlan: async () => ({}),
    reconcileContractImport: async (id, payload) => {calls.push(['reconcile', id, payload]); return {}},
    contractImportExport: async () => ({id: 'export-1', status: 'FAILED', error_code: 'QUERY_FAILED'}),
    downloadContractImportExport: async (...args) => {calls.push(['download', ...args])}, ...overrides }
  const {descriptor} = parse(readFileSync(new URL('./SettlementContractImportPanel.vue', import.meta.url), 'utf8'))
  const script = compileScript(descriptor, {id: 'finance-import-test'}).content
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '').replace('export default', 'return')
  const component = new Function(...Object.keys(deps), script)(...Object.values(deps))
  const state = component.setup({can: () => true, initialSnapshotId: ''}, {expose() {}})
  return {state, calls, data}
}

test('changing query input cannot redirect writes from the opened financial snapshot', async () => {
  const {state, calls} = panelHarness()
  await state.openSnapshot('snapshot-A')
  state.queryID.value = 'snapshot-B'
  state.receipt.value = {fact: '0', amount: '90071992547409.91', receipt_date: '2017-03-05', payment_method: 'TRANSFER', bank_transaction_reference: 'ORIGINAL-1'}
  await state.restoreReceipt()
  const payload = calls.find(row => row[0] === 'receipt')[1]
  assert.equal(payload.import_fact.contract_snapshot_id, 'snapshot-A')
  assert.equal(payload.customer_id, 'customer-A')
  assert.equal(payload.amount, '90071992547409.91')
  assert.equal(payload.receipt_date, '2017-03-05')
})

test('unknown financial write refreshes actual fact mapping without automatic resubmission', async () => {
  let writes = 0
  const {state, calls} = panelHarness({createReceipt: async () => {writes++; throw new Error('response lost')}})
  await state.openSnapshot('snapshot-A')
  state.receipt.value.fact = '0'
  await state.restoreReceipt()
  assert.equal(writes, 1)
  assert.equal(calls.filter(row => row[0] === 'query' && row[2]?.facts).length, 2)
  assert.match(state.error.value, /response lost.*实际恢复映射/)
})

test('local reconciliation requires explicit credit decision and never supplies approver identity', async () => {
  const {state, calls} = panelHarness()
  await state.openSnapshot('snapshot-A')
  await state.reconcile()
  assert.equal(calls.filter(row => row[0] === 'reconcile').length, 0)
  state.statement.value = {expected_open_amount: '20.00', expected_receipt_amount: '80.00', credit_decision: 'SUPPRESSED', reason: '核对历史银行凭证'}
  state.queryID.value = 'snapshot-B'
  await state.reconcile()
  const [, id, payload] = calls.find(row => row[0] === 'reconcile')
  assert.equal(id, 'snapshot-A')
  assert.equal(payload.expected_invoiced_amount, '0.00')
  assert.equal(Object.hasOwn(payload, 'approved_by'), false)
})

test('failed full export preserves FAILED state and does not download an empty file', async () => {
  const {state, calls} = panelHarness()
  await state.openSnapshot('snapshot-A')
  await state.exportStatement()
  assert.equal(state.exportJob.value.status, 'FAILED')
  assert.match(state.error.value, /QUERY_FAILED/)
  assert.equal(calls.filter(row => row[0] === 'download').length, 0)
})
