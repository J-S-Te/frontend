import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { ref } from 'vue'
import { validateContractForm, localContractReferencePayload } from './utils/contractPayload.js'
import { normalizePaymentTerms, paymentAmountMinor } from './utils/paymentTerms.js'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')

// 用途：执行实际主View来源构造及目录复核函数，观察本地身份是否泄露到CRM。
// 参数：无。
// 返回值：可调用函数与记录的CRM调用次数。
function harness() {
  const calls = []
  const context = { ref, newContract: ref({}), editingContract: ref(null),
    isExternalContractMode: ref(true), validateContractForm, localContractReferencePayload,
    normalizePaymentTerms, paymentAmountMinor,
    checkCRMDirectorySession: async () => { calls.push('session') },
    listMyCustomers: async () => { calls.push('customers'); return { items: [{ id: 7 }] } },
  }
  const names = ['buildNewContractPayload', 'contractDateValue', 'refreshSelectedCRMAccess']
  const functions = names.map((name) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
    assert.ok(start >= 0, `missing ${name}`)
    return source.slice(start, source.indexOf('\n}', start) + 2)
  })
  return { ui: vm.runInNewContext(`${functions.join('\n')}\n;({${names.join(',')}})`, context), calls }
}

// 用途：构造一份含精确付款计划的独立本地合同表单。
// 参数：无。
// 返回值：只含合成目录和业务字段的草稿。
function localForm() {
  return { counterparty_source: 'LOCAL', local_counterparty_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    counterparty_version: 3, category_source: 'LOCAL', customer_id: '', opportunity_id: '',
    opportunity_name: '', title: '合成合同', contract_type: '直签', amount: '100.00',
    currency: 'CNY', customer_name: '合成单位', customer_address: '', customer_contact: '',
    customer_phone: '', start_date: '', end_date: '',
    payment_terms: [{ installment_no: 1, due_date: '2026-12-01', amount: '100.00' }],
    service_items: [{ source_id: 'forged-new-source', service_type: '软件测试', name: '',
      site: '合成现场', batch: '第一批', category: '软件测试', requirement: '',
      category_id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', category_version: 2,
      test_mode: 'STANDARD', systems: [] }] }
}

test('正式PDF载荷保留本地引用与精确付款计划，不借用CRM或新建来源ID', () => {
  const { ui } = harness()
  const payload = ui.buildNewContractPayload(localForm(), { editing: false })
  assert.equal(payload.crm_customer_id, 0)
  assert.equal(payload.counterparty_source, 'LOCAL')
  assert.equal(payload.counterparty_version, 3)
  assert.equal(payload.service_items[0].category_version, 2)
  assert.equal(payload.service_items[0].source_id, undefined)
  assert.equal(payload.payment_terms[0].amount, '100.00')
})

test('本地引用复核不连接CRM，旧CRM引用继续检查同账号可见性', async () => {
  const h = harness()
  await h.ui.refreshSelectedCRMAccess(localForm())
  assert.equal(h.calls.length, 0)
  await h.ui.refreshSelectedCRMAccess({ customer_id: '7', customer_name: '合成CRM', opportunity_id: '' })
  assert.deepEqual(h.calls, ['session', 'customers'])
})
