import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { useReceiptRegistration } from './useReceiptRegistration.js'
import { todayBusinessDate } from '../../shared/utils/businessTime.js'

function harness({ receivables = [], created = { id: 'RCPT-1', receipt_no: 'RCPT-1' }, matches = [], refreshed = true, createError = null, matchError = null } = {}) {
  const calls = { create: [], matches: [], load: 0, notify: [], references: [] }
  const deps = {
    can: () => true,
    receivables: ref(receivables),
    saving: ref(false),
    // 第二个参数是业务编号：单独记录，保证“提示里必须带得走回款号”这条能被断言。
    notify: (value, reference) => { calls.notify.push(value); calls.references.push(reference) },
    load: async () => { calls.load++; return refreshed },
    formatSettlementError: (cause, options) => options ? `${options.fallback}|${cause.code}` : `fmt:${cause.code}`,
    createReceipt: async (payload) => { calls.create.push(payload); if (createError) throw createError; return created },
    listReceiptMatches: async (id) => { calls.matches.push(id); if (matchError) throw matchError; return matches },
  }
  return { deps, calls, ...useReceiptRegistration(deps) }
}

test('receiptCustomers 自正式应收按客户去重、名称缺省回落为 ID、按中文排序；syncReceiptCustomer 联动名称', () => {
  const h = harness({ receivables: [
    { customer_id: 'C2', customer_name: '乙公司' },
    { customer_id: 'C1', customer_name: '甲公司' },
    { customer_id: 'C2', customer_name: '乙公司（重复）' },
    { customer_id: 'C3' },
    { customer_id: '', customer_name: '无 ID 应忽略' },
  ] })
  const customers = h.receiptCustomers.value
  assert.deepEqual(customers.map((item) => item.id).sort(), ['C1', 'C2', 'C3'], '按 customer_id 去重且忽略无 ID 项')
  assert.equal(customers.find((item) => item.id === 'C2').name, '乙公司', '同客户以首次出现的名称为准')
  assert.equal(customers.find((item) => item.id === 'C3').name, 'C3', '名称缺省回落为 ID')
  // 排序结果与 zh-CN locale 比较器一致（不硬编码 ICU 具体次序，避免运行时差异）。
  assert.deepEqual(customers, [...customers].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')))
  h.receiptForm.value.customer_id = 'C1'
  h.syncReceiptCustomer()
  assert.equal(h.receiptForm.value.customer_name, '甲公司')
  h.receiptForm.value.customer_id = 'NOPE'
  h.syncReceiptCustomer()
  assert.equal(h.receiptForm.value.customer_name, '', '选中项不存在时清空名称')
})

test('初始表单：币种 CNY、转账、回款日期默认北京今天', () => {
  const h = harness()
  assert.equal(h.receiptComposerOpen.value, false)
  assert.equal(h.receiptMatchFor.value, '')
  assert.deepEqual(h.receiptMatches.value, [])
  assert.equal(h.receiptForm.value.currency, 'CNY')
  assert.equal(h.receiptForm.value.payment_method, 'TRANSFER')
  assert.equal(h.receiptForm.value.receipt_date, todayBusinessDate(), '回款日是纯日期，按北京日历日取今天')
  assert.match(h.receiptForm.value.receipt_date, /^\d{4}-\d{2}-\d{2}$/)
})

test('submitReceipt 成功：提交表单对象、关编辑器、记录回款 ID 并拉取匹配建议，按条数提示后刷新；无建议与刷新失败各有文案', async () => {
  const h = harness({ matches: [{ receivable_id: 'A1' }, { receivable_id: 'A2' }] })
  h.receiptComposerOpen.value = true
  await h.submitReceipt()
  assert.equal(h.calls.create[0], h.receiptForm.value)
  assert.equal(h.receiptComposerOpen.value, false)
  assert.equal(h.receiptMatchFor.value, 'RCPT-1')
  assert.deepEqual(h.calls.matches, ['RCPT-1'])
  assert.equal(h.receiptMatches.value.length, 2)
  assert.deepEqual(h.calls.notify, ['回款已登记，找到 2 条可核销应收。'])
  assert.equal(h.calls.load, 1)
  assert.equal(h.deps.saving.value, false)

  const none = harness({ matches: [], refreshed: false })
  await none.submitReceipt()
  assert.deepEqual(none.calls.notify, ['回款已登记，暂未找到同客户、同币种的可核销应收。', '回款已登记，但页面刷新失败。请刷新回款列表核对结果，勿重复登记。'])
})

test('submitReceipt：登记成功但匹配查询失败 → 保留"已登记"事实、告诫勿重复登记并仍刷新；登记本身失败 → 失败文案不刷新；进行中不重入', async () => {
  const matchFailed = harness({ matchError: Object.assign(new TypeError('Failed to fetch'), { code: 'E_NET' }) })
  matchFailed.receiptComposerOpen.value = true
  await matchFailed.submitReceipt()
  assert.equal(matchFailed.receiptComposerOpen.value, false)
  assert.equal(matchFailed.receiptMatchFor.value, 'RCPT-1')
  assert.deepEqual(matchFailed.calls.notify, ['回款已登记，但可核销应收查询失败。请刷新回款列表继续核销，勿重复登记。fmt:E_NET'])
  assert.equal(matchFailed.calls.load, 1)
  assert.equal(matchFailed.deps.saving.value, false)

  const createFailed = harness({ createError: Object.assign(new Error('x'), { code: 'E_CREATE' }) })
  createFailed.receiptComposerOpen.value = true
  await createFailed.submitReceipt()
  assert.equal(createFailed.receiptComposerOpen.value, true, '登记失败编辑器保持打开')
  assert.deepEqual(createFailed.calls.notify, ['回款登记失败，请稍后重试。|E_CREATE'])
  assert.equal(createFailed.calls.load, 0)

  const busy = harness()
  busy.deps.saving.value = true
  await busy.submitReceipt()
  assert.equal(busy.calls.create.length, 0)
  assert.equal(busy.deps.saving.value, true)
})
test('仅登记回款能力不请求核销匹配建议', async () => {
  const h = harness()
  h.deps.can = permission => permission === 'settlement.receipt.record'
  const ui = useReceiptRegistration(h.deps)
  await ui.submitReceipt()
  assert.equal(h.calls.create.length, 1)
  assert.equal(h.calls.matches.length, 0)
  assert.match(h.calls.notify.at(-1), /回款已登记/)
})

// 回款登记后续每条提示都必须带同一回款号：否则“勿重复登记”的提示出现时用户拿不到对账依据。
test('回款登记的每条后续提示都带上同一回款号', async () => {
  const cases = [
    harness(),
    harness({ refreshed: false }),
    harness({ matchError: new Error('E_NET') }),
  ]
  for (const h of cases) {
    h.receiptComposerOpen.value = true
    await h.submitReceipt()
    assert.ok(h.calls.references.length > 0, '至少应有一条提示')
    assert.deepEqual(new Set(h.calls.references), new Set(['RCPT-1']), `回款号缺失: ${JSON.stringify(h.calls.references)}`)
  }
})
