import test from 'node:test'
import assert from 'node:assert/strict'
import * as payload from './utils/contractPayload.js'

const partyID = '01J00000000000000000000001'
const categoryID = '01J00000000000000000000002'

// 用途：构造明确本地来源的普通合同表单，不提供CRM身份。
// 参数：无。
// 返回值：带本地目录版本和完整服务项的表单。
function localForm() {
  return { title: '本地合同', contract_type: '直签', amount: '100.00', currency: 'CNY', customer_id: '', customer_name: '本地交易对方', counterparty_source: 'LOCAL', local_counterparty_id: partyID, counterparty_version: 2, category_source: 'LOCAL', service_items: [{ service_type: '软件测试', name: '软件测试', site: '测试站', batch: '第一批', category: '软件测试', category_id: categoryID, category_version: 3, test_mode: 'STANDARD', systems: [] }] }
}

test('LOCAL白名单保留独立引用，不造CRM身份且旧请求不增加来源字段', () => {
  assert.equal(typeof payload.localContractReferencePayload, 'function', '本地引用白名单尚未实现')
  const wire = payload.localContractReferencePayload(localForm())
  assert.equal(wire.local_counterparty_id, partyID)
  assert.equal(wire.counterparty_version, 2)
  assert.equal(wire.crm_customer_id, 0)
  assert.equal(wire.service_items[0].category_id, categoryID)
  assert.equal(wire.service_items[0].source_id, undefined)
  assert.deepEqual(payload.localContractReferencePayload({ customer_id: '42' }), {})
  const external = payload.externalContractMetadata({ ...wire, content: '不能冒充原件正文' })
  assert.equal(external.counterparty_source, 'LOCAL')
  assert.equal(external.content, undefined)
})

test('LOCAL缺版本、混CRM/商机、坏类别引用被阻止，合法本地付款计划可校验', () => {
  assert.doesNotThrow(() => payload.validateContractForm(localForm(), { external: true }))
  for (const mutate of [
    f => { f.counterparty_version = 0 },
    f => { f.customer_id = '42' },
    f => { f.opportunity_id = '7' },
    f => { f.service_items[0].category_version = 0 },
    f => { f.local_counterparty_id = '../other' },
  ]) {
    const form = localForm(); mutate(form)
    assert.throws(() => payload.validateContractForm(form, { external: true }))
  }
})
