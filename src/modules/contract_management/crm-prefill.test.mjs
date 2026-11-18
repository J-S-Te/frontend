import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse } from '@babel/parser'
import { effectScope, ref, nextTick } from 'vue'
import { emptyNewContract } from './utils/contractDisplay.js'
import { formatUserError } from '../shared/utils/userError.js'

const source = parseSFC(await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
const ast = parse(source, { sourceType: 'module' }).program.body
const names = ['selectCustomer', 'clearCustomer', 'selectOpportunity', 'clearOpportunity', 'selectOpportunityById']
const functions = ast.filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
  .map(node => source.slice(node.start, node.end)).join('\n')
const binding = ast.find(node => node.type === 'VariableDeclaration'
  && node.declarations.some(item => item.init?.callee?.name === 'useContractCRMPrefill'))
// 基线没有预填组合函数时直接执行原选择函数；接线后加载实际组合函数，HTTP仍是唯一替身。
const prefillModule = binding ? await import('./composables/useContractCRMPrefill.js') : {}

// 用途：用真实视图动作及组合函数创建独立表单，替换联系人HTTP返回。
// 参数：options为联系人读取函数和初始表单。
// 返回值：真实响应式表单、选择动作及作用域清理方法。
function harness({ listContacts = async () => [{ id: 1, name: '合成联系人甲', phone: '138****0000', is_registration: true }], form = emptyNewContract() } = {}) {
  const scope = effectScope()
  const context = { newContract: ref(form), selectedContractTemplate: ref(null),
    createDialogOpen: ref(true), contractCreating: ref(false), editingContract: ref(null),
    customerPickerOpen: ref(true), opportunityOptions: ref([]),
    listMyCustomerContacts: listContacts, recordCRMDirectoryError: () => {},
    formatUserError, ...prefillModule }
  const api = scope.run(() => vm.runInNewContext(
    (binding ? source.slice(binding.start, binding.end) : '') + '\n' + functions
      + '\n;({' + names.join(',')
      + (binding ? ',crmPrefillLoading,crmPrefillError,crmPrefillNotice' : '') + '})', context))
  return { ...context, ...api, stop: () => scope.stop() }
}

const customer = { id: 7, name: '合成客户甲' }
const opportunity = { id: 9, name: '合成商机甲', customer_id: 7, customer_name: '合成客户甲',
  expected_amount: '1234.56', requirement_summary: '合成需求说明' }

test('选择客户后读取真实联系人接口并带入注册联系人，不填脱敏号码或区域', async () => {
  const ui = harness()
  try {
    await ui.selectCustomer({ ...customer, region: '合成区域' })
    assert.equal(ui.newContract.value.customer_name, customer.name)
    assert.equal(ui.newContract.value.customer_contact, '合成联系人甲')
    assert.equal(ui.newContract.value.customer_phone, '')
    assert.equal(ui.newContract.value.customer_address, '')
  } finally { ui.stop() }
})

test('选择商机补齐合同名称、金额、单个服务项需求，并联动客户联系人', async () => {
  const ui = harness()
  try {
    await ui.selectOpportunity(opportunity)
    assert.equal(ui.newContract.value.title, opportunity.name)
    assert.equal(ui.newContract.value.amount, '1234.56')
    assert.equal(ui.newContract.value.service_items[0].requirement, opportunity.requirement_summary)
    assert.equal(ui.newContract.value.customer_contact, '合成联系人甲')
  } finally { ui.stop() }
})

test('手工输入、金额零值和管理员预设保留，明确对应的模板空白字段可以带入', async () => {
  const form = emptyNewContract()
  Object.assign(form, { title: '手工合同', amount: '0', customer_contact: '手工联系人' })
  form.service_items[0].requirement = '手工需求'
  form.template_values = { unit: '', contact: '模板手填', locked: '', preset: '管理员默认' }
  const ui = harness({ form })
  ui.selectedContractTemplate.value = { fields: [
    { name: 'unit', label: '单位名称' }, { name: 'contact', label: '客户联系人' },
    { name: 'locked', label: '合同名称', locked: true },
    { name: 'preset', label: '商机名称', default: '管理员默认' },
  ] }
  try {
    await ui.selectOpportunity(opportunity)
    assert.equal(form.title, '手工合同')
    assert.equal(form.amount, '0')
    assert.equal(form.customer_contact, '手工联系人')
    assert.equal(form.service_items[0].requirement, '手工需求')
    assert.deepEqual({ ...ui.newContract.value.template_values },
      { unit: '合成客户甲', contact: '模板手填', locked: '', preset: '管理员默认' })
  } finally { ui.stop() }
})

test('切换商机更新仍为自动值的字段，清除关联不清除手工修改', async () => {
  const ui = harness()
  try {
    await ui.selectOpportunity(opportunity)
    ui.newContract.value.amount = '88.00'
    await ui.selectOpportunity({ ...opportunity, id: 10, name: '合成商机乙', requirement_summary: '合成需求乙' })
    assert.equal(ui.newContract.value.title, '合成商机乙')
    assert.equal(ui.newContract.value.amount, '88.00')
    ui.clearOpportunity()
    assert.equal(ui.newContract.value.title, '')
    assert.equal(ui.newContract.value.amount, '88.00')
    assert.equal(ui.newContract.value.service_items[0].requirement, '')
  } finally { ui.stop() }
})

test('手工清空已带入的合同和模板字段后，切换来源不重新填写', async () => {
  const ui = harness()
  ui.selectedContractTemplate.value = { fields: [{ name: 'customer_name', label: '单位名称' }] }
  try {
    await ui.selectOpportunity(opportunity)
    ui.newContract.value.title = ''
    ui.newContract.value.amount = ''
    ui.newContract.value.service_items[0].requirement = ''
    ui.newContract.value.template_values.customer_name = ''
    await ui.selectOpportunity({ ...opportunity, id: 10, name: '商机乙' })
    assert.equal(ui.newContract.value.title, '')
    assert.equal(ui.newContract.value.amount, '')
    assert.equal(ui.newContract.value.service_items[0].requirement, '')
    assert.equal(ui.newContract.value.template_values.customer_name, '')
  } finally { ui.stop() }
})

test('联系人请求期间手填再清空也保留空白，不接受迟到预填', async () => {
  let resolve
  const ui = harness({ listContacts: () => new Promise(done => { resolve = done }) })
  try {
    const request = ui.selectCustomer(customer)
    ui.newContract.value.customer_contact = '手工输入'
    ui.newContract.value.customer_contact = ''
    resolve([{ id: 1, name: '接口联系人', is_registration: true }])
    await request
    assert.equal(ui.newContract.value.customer_contact, '')
  } finally { ui.stop() }
})

test('旧客户迟到响应不覆盖新客户，关闭或保存期间的响应不回填', async () => {
  for (const action of ['switch', 'close', 'reopen', 'save', 'save-return', 'replace']) {
    const pending = []
    const ui = harness({ listContacts: () => new Promise(resolve => pending.push(resolve)) })
    try {
      const first = ui.selectCustomer(customer)
      assert.equal(pending.length, 1)
      if (action === 'switch') {
        const second = ui.selectCustomer({ id: 8, name: '合成客户乙' })
        pending[1]([{ id: 2, name: '联系人乙', is_registration: true }])
        await second
      } else if (['close', 'reopen'].includes(action)) {
        ui.createDialogOpen.value = false
        if (action === 'reopen') ui.createDialogOpen.value = true
      } else if (['save', 'save-return'].includes(action)) {
        ui.contractCreating.value = true
        if (action === 'save-return') ui.contractCreating.value = false
      }
      else ui.newContract.value = emptyNewContract()
      pending[0]([{ id: 1, name: '迟到联系人', is_registration: true }])
      await first
      assert.equal(ui.newContract.value.customer_contact, action === 'switch' ? '联系人乙' : '')
    } finally { ui.stop() }
  }
})

test('组件卸载后，未完成的联系人请求不能回填旧表单', async () => {
  let resolve
  const ui = harness({ listContacts: () => new Promise(done => { resolve = done }) })
  const request = ui.selectCustomer(customer)
  ui.stop()
  resolve([{ id: 1, name: '卸载后迟到联系人', is_registration: true }])
  await request
  assert.equal(ui.newContract.value.customer_contact, '')
})

test('编辑既有草稿不自动补齐，换客户保留手填联系人及其余合同内容', async () => {
  let calls = 0
  const ui = harness({ listContacts: async () => {
    calls += 1
    return [{ id: calls, name: `合成联系人${calls}`, is_registration: true }]
  } })
  try {
    ui.editingContract.value = { id: 'existing-draft' }
    await ui.selectOpportunity(opportunity)
    assert.equal(calls, 0)
    assert.equal(ui.newContract.value.title, '')
    ui.editingContract.value = null
    await ui.selectCustomer(customer)
    ui.newContract.value.customer_contact = '手工核对联系人'
    await ui.selectCustomer({ id: 8, name: '合成客户乙' })
    assert.equal(ui.newContract.value.customer_contact, '手工核对联系人')
    ui.clearCustomer()
    assert.equal(ui.newContract.value.customer_contact, '手工核对联系人')
  } finally { ui.stop() }
})

test('多个联系人无唯一注册人、超长需求和多个服务项均不猜测或截断', async () => {
  const ui = harness({ listContacts: async () => [
    { id: 1, name: '候选甲', is_registration: false }, { id: 2, name: '候选乙', is_registration: false },
  ] })
  try {
    await ui.selectOpportunity({ ...opportunity, requirement_summary: '长'.repeat(1001) })
    assert.equal(ui.newContract.value.customer_contact, '')
    assert.equal(ui.newContract.value.service_items[0].requirement, '')
    assert.match(ui.crmPrefillNotice.value, /1000/)
    ui.newContract.value.service_items.push({ requirement: '' })
    await ui.selectOpportunity(opportunity)
    assert.equal(ui.newContract.value.service_items[0].requirement, '')
    assert.equal(ui.newContract.value.service_items[1].requirement, '')
    assert.match(ui.crmPrefillNotice.value, /多个服务项/)
  } finally { ui.stop() }
})

test('联系人读取失败保留手填并显示重试信息，选择模板后补齐新增空白字段', async () => {
  const ui = harness({ listContacts: async () => { throw new Error('读取失败') } })
  try {
    await ui.selectOpportunity(opportunity)
    assert.match(ui.crmPrefillError.value, /读取失败/)
    ui.newContract.value.template_values = { title: '' }
    ui.selectedContractTemplate.value = { fields: [{ name: 'title', label: '合同名称' }] }
    await nextTick()
    assert.equal(ui.newContract.value.template_values.title, opportunity.name)
  } finally { ui.stop() }
})
