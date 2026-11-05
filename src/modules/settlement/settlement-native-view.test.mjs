import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

const view = readFileSync(new URL('./views/SettlementView.vue', import.meta.url), 'utf8')

// viewFunction 读取正式View命名函数，避免测试复制接线行为。
// 参数：name为预期函数名。
// 返回值：实际源码；不存在时返回空串使对应行为测试失败。
function viewFunction(name) {
  const start = view.indexOf(`function ${name}(`)
  return start < 0 ? '' : view.slice(start, view.indexOf('\n}', start) + 2)
}

test('结算主View复用真实transport装配原生API，并沿原刷新函数响应changed', () => {
  assert.match(view, /import\s+SettlementNativeFinancialPanel\s+from/)
  assert.match(view, /import\s*\{\s*createNativeFinancialAPI\s*\}\s*from/)
  assert.match(view, /const\s+nativeFinancialAPI\s*=\s*createNativeFinancialAPI\(request\)/)
  const panel = view.match(/<SettlementNativeFinancialPanel\b[\s\S]*?\/>/)?.[0] || ''
  assert.match(panel, /active === 'receivables'/)
  assert.match(panel, /can\('settlement\.receivable\.read'\)/)
  assert.match(panel, /:api="nativeFinancialAPI"/)
  assert.match(panel, /@changed="refreshRolePlans"/)
  const { descriptor } = parse(view)
  const script = compileScript(descriptor, { id: 'settlement-native-view' })
  const template = compileTemplate({ source: descriptor.template.content,
    filename: 'SettlementView.vue', id: 'settlement-native-view',
    compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
})

test('原生财务changed沿真实刷新链读取当前页计划和应收，撤权不读', async () => {
  const calls = []
  const context = { active: { value: 'receivables' }, can: () => true,
    listPages: { value: { 0: 2, 1: 3 } }, plans: { value: [] }, receivables: { value: [] },
    error: { value: '' }, settlementScope: { begin: () => 'ticket', isCurrent: () => true },
    listReceivablePlans: async (query) => { calls.push(['plans', query]); return [{ id: 'plan' }] },
    listReceivables: async (query) => { calls.push(['receivables', query]); return [{ id: 'receivable' }] },
    formatSettlementError: () => '读取失败' }
  const refresh = vm.runInNewContext(`async ${viewFunction('refreshRolePlans')}; refreshRolePlans`, context)
  assert.equal(await refresh(), true)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['plans', { limit: 50, offset: 100 }], ['receivables', { limit: 50, offset: 150 }]])
  assert.equal(context.plans.value[0].id, 'plan')
  assert.equal(context.receivables.value[0].id, 'receivable')
  context.can = () => false
  assert.equal(await refresh(), false)
  assert.equal(calls.length, 2)
})

test('确认编辑器恢复本地来源显示元数据，不改合同号或提交身份', () => {
  const context = { planEditor: { value: {} }, confirmPlan: (plan) => {
    context.planEditor.value = { id: plan.id, version: plan.version, contract_no: plan.contract_no || '' }
  } }
  assert.ok(viewFunction('confirmFinancialPlan'), '缺少正式确认包装函数')
  const confirm = vm.runInNewContext(`${viewFunction('confirmFinancialPlan')}; confirmFinancialPlan`, context)
  confirm({ id: 'p', version: 4, contract_no: '', basis_type: 'LOCAL_FINANCIAL', local_document_no: 'PO-7' })
  assert.equal(context.planEditor.value.contract_no, '')
  assert.equal(context.planEditor.value.local_document_no, 'PO-7')
  assert.equal(context.planEditor.value.basis_type, 'LOCAL_FINANCIAL')
  assert.equal(context.planEditor.value.id, 'p')
  confirm({ id: 'old', version: 2, contract_no: 'HT-7' })
  assert.deepEqual(JSON.parse(JSON.stringify(context.planEditor.value)), { id: 'old', version: 2, contract_no: 'HT-7' })
})

// financialPanel 编译实际应收组件，使用真实Vue/金额工具，只替换无业务逻辑的图标。
// 参数：无。
// 返回值：可SSR的正式组件，用于验证用户实际可见来源文本与转义。
async function financialPanel() {
  const source = readFileSync(new URL('./components/SettlementReceivablesPanel.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'native-basis-panel', inlineTemplate: true })
  const bindings = {}
  let body = compiled.content.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, (_, imported, specifier) => {
    for (const part of imported.split(',')) {
      const [name, alias = name] = part.trim().split(/\s+as\s+/)
      bindings[alias] = { specifier, name }
    }
    return ''
  })
  body = body.replace(/import\s+(\w+)\s+from\s+['"][^'"]+\.vue['"];?/g, (_, name) => { bindings[name] = { icon: true }; return '' })
  const display = await import('./utils/settlementDisplay.js')
  const values = Object.values(bindings).map((item) => item.icon ? { render: () => null } : (item.specifier === 'vue' ? Vue : display)[item.name])
  return new Function(...Object.keys(bindings), body.replace('export default', 'return'))(...values)
}

test('计划、应收和确认框明确显示真实本地依据编号，旧合同仍显示原号', async () => {
  const component = await financialPanel()
  const local = { id: 'p', version: 2, contract_no: '', basis_type: 'LOCAL_FINANCIAL',
    local_document_no: 'PO-<7>', customer_name: '本地客户', due_date: '2026-11-04',
    planned_amount: '100.00', original_amount: '100.00', open_amount: '100.00', status: 'PENDING_CONFIRMATION' }
  const html = await renderToString(Vue.createSSRApp(component, { can: () => true,
    visiblePlans: [local, { ...local, id: 'legacy', basis_type: 'CONTRACT', contract_no: 'HT-7' }],
    receivables: [{ ...local, id: 'r', receivable_no: 'AR-7' }],
    planEditor: local, planEditorOpen: true }))
  assert.equal((html.match(/本地财务依据 · PO-&lt;7&gt;/g) || []).length, 3)
  assert.match(html, /财务依据 \/ 合同/)
  assert.match(html, /HT-7/)
  assert.doesNotMatch(html, /未关联合同/)
  assert.equal(local.contract_no, '')
})
