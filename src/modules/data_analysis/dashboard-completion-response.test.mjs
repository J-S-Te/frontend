import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source=readFileSync(new URL('./api/dataAnalysis.js',import.meta.url),'utf8')
const start=source.indexOf('function isRecord(')
const end=source.indexOf('/**\n * startDataAnalysisLogin')
const context=vm.createContext({})
vm.runInContext(source.slice(start,end)+';globalThis.valid=validDataEnvelope',context)
const valid=(route,data)=>context.valid({data},route,'GET')

test('看板畸形数值和类型必须拒绝，合法零值仍有效',()=>{
 assert.equal(valid('/dashboard/contract',{available:true,total_contracts:'bad'}),false)
 assert.equal(valid('/dashboard/contract',{available:true,total_contracts:0,approval_contracts:0,active_contracts:0,expired_contracts:0,opportunity_count:0,won_contract_count:0,total_amount_minor:0,currency_totals:[],conversion_available:true,discount_available:false}),true)
 assert.equal(valid('/alerts/summary',{total:'bad',by_severity:{HIGH:'bad'}}),false)
 assert.equal(valid('/dashboard/project',{available:true,project_count:null}),false)
 assert.equal(valid('/dashboard/contracts',{items:[{amount_minor:'bad'}],total:1,page:1,page_size:20}),false)
 // 新后端无明细时返回 items:null；前端归一为 [] 后仍应被视为合法空结果。
 assert.equal(valid('/dashboard/contracts',{items:null,total:0,page:1,page_size:20}),true)
 // 新后端预警列表改为 {items,page,page_size,total} 分页信封。
 assert.equal(valid('/alerts',{items:[],page:1,page_size:20,total:0}),true)
 assert.equal(valid('/dashboard/projects',{available:false,items:[],total:0,page:1,page_size:20}),true)
 assert.equal(valid('/dashboard/trend',[{period:'2026-11',contract_count:1,project_count:1,currency_totals:[{currency:'USD',amount_minor:'bad',contracts:1}]}]),false)
 // 区域分布信封：可用性、币种、金额/数量都必须合法；不可用也必须是空数组而不是 null。
 assert.equal(valid('/dashboard/contract-regions',{available:true,items:[{region:'华东',currency:'CNY',amount_minor:100,contract_count:2}],basis:'按区域归集'}),true)
 assert.equal(valid('/dashboard/contract-regions',{available:false,items:[],basis:'当前范围不支持'}),true)
 assert.equal(valid('/dashboard/contract-regions',{available:true,items:null,basis:''}),false)
 assert.equal(valid('/dashboard/contract-regions',{available:true,items:[{region:'华东',currency:'CNY',amount_minor:'bad',contract_count:2}],basis:''}),false)
})
