import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { canLoad } from './utils/capabilities.js'

const source = readFileSync(new URL('./views/SettlementView.vue', import.meta.url), 'utf8')

// viewFunction 读取真实视图函数以覆盖生产压缩后的调用路径。
// 参数：name为已有命名函数。
// 返回值：实际函数声明；缺失时返回空文本。
function viewFunction(name) {
  const start = source.indexOf(`function ${name}(`)
  return start < 0 ? '' : source.slice(start, source.indexOf('\n}', start) + 2)
}

// targetHarness 装配视图实际读取策略与生产压缩后的接口函数。
// 参数：loaders为真实压缩产物，permissions为本用例的精确会话能力。
// 返回值：可执行loadTargets与隔离依赖，不发送真实业务请求。
function targetHarness(loaders, permissions) {
  const context = {canLoad,canLoadKey:canLoad,can:permission => permissions.includes(permission),
    invoiceDetailID:{value:''},invoiceDetail:{value:null},plans:{value:[]},receivables:{value:[]},
    invoiceEligibleReceivables:{value:[]},invoiceRequests:{value:[]},taxInvoices:{value:[]}}
  for (const name of ['getDashboard','getAgingSummary','getInvoicedReceivablesTop10','getDunningOverview',
    'getDunningCoverage','listReceivablePlans','listReceivables','listReceipts','listReceiptAllocations',
    'listInvoiceRequests','listTaxInvoices','listInvoiceEligibleReceivables','listDunningCases',
    'listDunningActions','listDunningPolicies','listDunningRecipients','getTaxInvoice']) context[name] = () => []
  Object.assign(context,loaders)
  const start = source.indexOf('const loaderKeys =')
  const keys = start < 0 ? '' : source.slice(start,source.indexOf('));',start)+3)
  const local = viewFunction('canLoad')
  return {...vm.runInNewContext(`${keys}\n${local}\n${viewFunction('loadTargets')}\n({loadTargets,canLoad})`,context),context}
}

test('production-minified loader identities retain exact receivable permissions',async()=>{
  const compiled = await transform('const listReceivablePlans=()=>[];const listReceivables=()=>[];export{listReceivablePlans,listReceivables};',{format:'esm',minify:true})
  const loaders = await import(`data:text/javascript,${encodeURIComponent(compiled.code)}`)
  assert.notEqual(loaders.listReceivablePlans.name,'listReceivablePlans')
  const allowed = targetHarness(loaders,['settlement.receivable.read']).loadTargets('receivables')
  assert.equal(allowed.length,2,'authorized production readers were silently filtered')
  assert.equal(allowed[0][0],loaders.listReceivablePlans)
  assert.equal(allowed[1][0],loaders.listReceivables)
  assert.equal(targetHarness(loaders,[]).loadTargets('receivables').length,0)
})

test('invoice detail carries its explicit read capability and unknown functions remain denied',()=>{
  const harness = targetHarness({getTaxInvoice:id=>id},['settlement.invoice.read'])
  harness.context.invoiceDetailID.value = 'QA-INVOICE'
  const targets = harness.loadTargets('invoices')
  assert.equal(targets.length,3)
  assert.equal(targets[2][0](),'QA-INVOICE')
  assert.equal(harness.canLoad(()=>[]),false)
  const denied = targetHarness({},[])
  denied.context.invoiceDetailID.value = 'QA-INVOICE'
  assert.equal(denied.loadTargets('invoices').length,0)
})
