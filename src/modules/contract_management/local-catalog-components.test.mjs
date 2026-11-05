import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

// 用途：执行真实独立组件脚本，隔离网络边界并保留实际状态逻辑。
// 参数：name为组件名称，props为父组件输入。
// 返回值：组件暴露状态及实际事件/提交记录。
async function componentHarness(name, props) {
  let source = ''
  try { source = await readFile(new URL(`./components/${name}.vue`, import.meta.url), 'utf8') } catch {}
  assert.ok(source, `${name} 尚未实现`)
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: name })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: `${name}.vue`, id: name, compilerOptions: { bindingMetadata: compiled.bindings } }).errors, [])
  const calls = { events: [], save: [] }
  const context = {
    ...Vue, defineProps: () => props, defineEmits: () => (...args) => calls.events.push(args),
    onMounted: () => {}, watch: () => {},
    listLocalContractCounterparties: async () => [{ id: '01J00000000000000000000001', name: '本地交易对方', enabled: true, version: 2 }],
    listLocalContractCategories: async () => [{ id: '01J00000000000000000000002', code: 'SOFTWARE', name: '软件测试', enabled: true, version: 3 }],
    saveLocalContractCounterparty: async (id, body) => { calls.save.push({ id, body }); throw Object.assign(new Error('版本已经变化'), { status: 409 }) },
    saveLocalContractCategory: async () => {}, formatUserError: cause => cause.message,
  }
  const script = descriptor.scriptSetup.content.replace(/^import .*$/gm, '')
  const exports = name === 'LocalContractSourcePicker' ? '{ load, selectCounterparty, selectCategory, error }' : '{ load, openEditor, save, canManage, draft, editing, error }'
  const ui = vm.runInNewContext(`${script}\n;(${exports})`, context)
  return { ui, calls, props }
}

test('本地来源选择保留独立ID和版本，清除CRM/商机且不占用SourceID', async () => {
  const h = await componentHarness('LocalContractSourcePicker', { capabilities: { counterparty_source: 'local', category_source: 'local' }, disabled: false, modelValue: { customer_id: '42', opportunity_id: '7', service_items: [{ source_id: 'existing-service', service_type: '软件测试' }] } })
  await h.ui.load()
  h.ui.selectCounterparty('01J00000000000000000000001')
  let result = h.calls.events.at(-1)[1]
  assert.equal(result.counterparty_source, 'LOCAL')
  assert.equal(result.counterparty_version, 2)
  assert.equal(result.customer_id, '')
  assert.equal(result.crm_customer_id, 0)
  assert.equal(result.opportunity_id, '')
  h.props.modelValue = result
  h.ui.selectCategory(0, '01J00000000000000000000002')
  result = h.calls.events.at(-1)[1]
  assert.equal(result.service_items[0].category_version, 3)
  assert.equal(result.service_items[0].source_id, 'existing-service')
  assert.equal(result.service_items[0].category, '软件测试')
})

test('目录维护只认专有权限，版本冲突保留编辑内容且不假称保存成功', async () => {
  const denied = await componentHarness('LocalContractCatalogPanel', { permissions: ['admin'] })
  assert.equal(denied.ui.canManage.value, false)
  denied.ui.openEditor(); assert.equal(denied.ui.editing.value, null)
  const h = await componentHarness('LocalContractCatalogPanel', { permissions: ['contract.catalog.manage'] })
  await h.ui.load(); h.ui.openEditor({ id: '01J00000000000000000000001', name: '原名称', enabled: true, version: 2 })
  h.ui.draft.value.name = '修正名称'
  await h.ui.save()
  assert.equal(h.calls.save.length, 1)
  assert.equal(h.calls.save[0].body.expected_version, 2)
  assert.equal(h.ui.editing.value.id, '01J00000000000000000000001')
  assert.equal(h.ui.draft.value.name, '修正名称')
  assert.equal(h.ui.error.value, '版本已经变化')
})
