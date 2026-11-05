import test from 'node:test'
import assert from 'node:assert/strict'

// 用途：读取本地财务表单的真实生产规则。
// 参数：无。
// 返回值：生产导出；尚未实现时测试失败。
async function tools() { return import('./nativeFinancial.js') }

test('本地财务请求只保留本地依据和精确分期，不携带伪合同或CRM身份', async () => {
  const { nativeFinancialPayload } = await tools()
  const input = { customer_key: `settlement_local:${'A'.repeat(32)}`, document_no: ' PO-7 ',
    currency: 'cny', amount: '100.00', effective_date: '2020-01-01',
    evidence_type: 'PURCHASE_ORDER', evidence_reference: 'PO-7', evidence_note: '客户采购单',
    reason: '登记依据', contract_id: 'fake', crm_customer_id: 7,
    payment_terms: [{ installment_no: 1, due_date: '2020-02-01', amount: '40.00' },
      { installment_no: 2, due_date: '2020-03-01', amount: '60.00' }] }
  const payload = nativeFinancialPayload(input, '2026-11-04')
  assert.equal(payload.currency, 'CNY')
  assert.equal(payload.document_no, 'PO-7')
  assert.equal(payload.contract_id, undefined)
  assert.equal(payload.crm_customer_id, undefined)
  assert.equal(payload.payment_terms.length, 2)
  for (const patch of [{ customer_key: '7' }, { amount: '1e9' }, { effective_date: '2020-02-30' },
    { payment_terms: [{ installment_no: 1, due_date: '2020-02-01', amount: '99.99' }] }]) {
    assert.throws(() => nativeFinancialPayload({ ...input, ...patch }, '2026-11-04'))
  }
})

test('独立API通过现有transport请求并保留幂等、分页和作废版本', async () => {
  const { createNativeFinancialAPI } = await import('./api/nativeFinancial.js')
  const calls = []
  const api = createNativeFinancialAPI(async (path, options) => { calls.push({ path, options }); return { id: 'real' } })
  await api.createCustomer({ name: '本地客户' })
  await api.listBaselines({ limit: 10, offset: 20 })
  await api.voidBaseline('id/1', { version: 2, reason: '未确认作废' })
  assert.equal(calls[0].options.idempotent, true)
  assert.equal(calls[1].path, '/financial-baselines?limit=10&offset=20')
  assert.equal(calls[2].path, '/financial-baselines/id%2F1/void')
  assert.deepEqual(JSON.parse(calls[2].options.body), { version: 2, reason: '未确认作废' })
})

// 用途：编译实际独立SFC，使测试检查真实模板和Vue转义。
// 参数：无。
// 返回值：可由Vue服务端渲染的真实组件。
async function component() {
  const { readFile } = await import('node:fs/promises')
  const { parse, compileScript } = await import('@vue/compiler-sfc')
  const url = new URL('./components/SettlementNativeFinancialPanel.vue', import.meta.url)
  const { descriptor } = parse(await readFile(url, 'utf8'))
  const compiled = compileScript(descriptor, { id: 'native-financial', inlineTemplate: true })
  const values = {}
  // 默认 import（含 .vue 组件）无法被 Node 解析：先剥离，再在 bindings 里注入桩，
  // 与既有的具名 import 处理方式一致。
  const source = compiled.content
    .replace(/^import\s+[A-Za-z_$][\w$]*\s+from\s+['"][^'"]+['"];?\n?/gm, '')
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (statement, imported, specifier) => {
      values[specifier] = [values[specifier], imported].filter(Boolean).join(',')
      return ''
    })
  const bindings = {}
  for (const [specifier, imported] of Object.entries(values)) {
    const dependency = await import(specifier === 'vue' ? 'vue' : new URL(specifier, url).href)
    for (const part of imported.split(',')) {
      const [name, alias = name] = part.trim().split(/\s+as\s+/)
      bindings[alias] = dependency[name]
    }
  }
  bindings.PaginationBar = { props: ['label', 'prevText', 'nextText', 'page', 'count', 'pageSize', 'hasMore', 'loading', 'disabled'], render: () => null }
  return new Function(...Object.keys(bindings), source.replace('export default', 'return'))(...Object.values(bindings))
}

test('真实组件按服务端能力关闭写入，已有依据明确标记且转义文本', async () => {
  const { createSSRApp } = await import('vue')
  const { renderToString } = await import('@vue/server-renderer')
  const panel = await component()
  const api = {}
  const closed = await renderToString(createSSRApp(panel, { api,
    initialCapabilities: { native_financial_enabled: false, can_create: false } }))
  assert.match(closed, /未启用/)
  assert.doesNotMatch(closed, /依据总额/)
  const open = await renderToString(createSSRApp(panel, { api,
    initialCapabilities: { native_financial_enabled: true, can_create: true },
    initialItems: [{ id: 'local-1', local_document_no: '<script>bad</script>',
      customer_name: '本地客户', amount: '100.00', currency: 'CNY', status: 'EFFECTIVE',
      evidence_reference: 'PO-1', evidence_note: '留存依据' }] }))
  assert.match(open, /依据总额/)
  assert.match(open, /本地财务依据/)
  assert.match(open, /&lt;script&gt;/)
  assert.doesNotMatch(open, /<script>/)
})
