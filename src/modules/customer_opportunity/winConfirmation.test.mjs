import assert from 'node:assert/strict'
import test from 'node:test'
import { access } from 'node:fs/promises'

// 用途：载入真实赢单表单规则，缺少能力时给出行为断言。
// 参数：无。
// 返回值：生产模块导出。
async function tools() {
  const url = new URL('./winConfirmation.js', import.meta.url)
  assert.ok(await access(url).then(() => true, () => false), '缺少显式模式的赢单请求构造器')
  return import(url)
}

test('合同模式只发送需真实验真的合同引用，本地模式只发送人工证据', async () => {
  const { winConfirmationPayload } = await tools()
  const evidence = { evidence_type: 'CUSTOMER_CONFIRMATION', evidence_reference: '邮件-7',
    confirmed_on: '2026-08-01', confirmed_amount: '100.00', evidence_note: '客户书面确认采购' }
  assert.deepEqual(winConfirmationPayload('contract', { contract_ref: ' HT-1 ', win_evidence: evidence }),
    { contract_ref: 'HT-1' })
  assert.deepEqual(winConfirmationPayload('local_evidence', { contract_ref: 'old', win_evidence: evidence }),
    { win_evidence: evidence })
})

test('没有明确模式或证据缺字段、金额非法时不产生赢单请求', async () => {
  const { winConfirmationPayload } = await tools()
  assert.throws(() => winConfirmationPayload('disabled', {}))
  assert.throws(() => winConfirmationPayload('local_evidence', {}))
  for (const amount of ['1e999999', '-1', '1.001']) {
    assert.throws(() => winConfirmationPayload('local_evidence', { win_evidence: {
      evidence_type: 'CUSTOMER_CONFIRMATION', evidence_reference: '邮件', confirmed_on: '2026-08-01',
      confirmed_amount: amount, evidence_note: '客户确认',
    } }))
  }
})

// 用途：编译实际 SFC 并保留 Vue 的真实渲染与事件实现。
// 参数：无。
// 返回值：可进行服务端渲染的生产组件。
async function loadWinComponent() {
  const { readFile } = await import('node:fs/promises')
  const { parse, compileScript } = await import('@vue/compiler-sfc')
  const componentURL = new URL('./components/OpportunityWinConfirmationPanel.vue', import.meta.url)
  const { descriptor } = parse(await readFile(componentURL, 'utf8'))
  const compiled = compileScript(descriptor, { id: 'win-confirmation-panel', inlineTemplate: true })
  const bindings = {}
  const source = compiled.content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (statement, imported, specifier) => {
      bindings[specifier] = [bindings[specifier], imported].filter(Boolean).join(',')
      return ''
    })
  const values = {}
  for (const [specifier, imported] of Object.entries(bindings)) {
    const dependency = await import(specifier === 'vue' ? 'vue' : new URL(specifier, componentURL).href)
    for (const part of imported.split(',')) {
      const [name, alias = name] = part.trim().split(/\s+as\s+/)
      values[alias] = dependency[name]
    }
  }
  return new Function(...Object.keys(values), source.replace('export default', 'return'))(...Object.values(values))
}

test('真实组件按显式模式渲染合同或本地证据表单', async () => {
  const { createSSRApp } = await import('vue')
  const { renderToString } = await import('@vue/server-renderer')
  const component = await loadWinComponent()
  const local = await renderToString(createSSRApp(component, { mode: 'local_evidence' }))
  assert.match(local, /本地赢单确认/)
  assert.match(local, /依据编号或引用/)
  assert.doesNotMatch(local, /placeholder="请输入合同管理系统中的合同编号"/)
  const contract = await renderToString(createSSRApp(component, { mode: 'contract', contractRef: 'HT-1' }))
  assert.match(contract, /value="HT-1"/)
  assert.doesNotMatch(contract, /客户书面确认/)
})

test('真实只读证据组件展示保存依据并转义用户文本', async () => {
  const { createSSRApp } = await import('vue')
  const { renderToString } = await import('@vue/server-renderer')
  const component = await loadWinComponent()
  const html = await renderToString(createSSRApp(component, { readonly: true, confirmationDetail: {
    confirmed_on: '2026-08-01', confirmation: { evidence_type: 'CUSTOMER_CONFIRMATION',
      evidence_reference: '<script>unsafe</script>', evidence_note: '客户书面确认', confirmed_amount: '100.00' },
  } }))
  assert.match(html, /2026-08-01/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>|<input/)
})
