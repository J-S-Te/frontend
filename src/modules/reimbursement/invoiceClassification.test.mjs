import test from 'node:test'
import assert from 'node:assert/strict'
import { invoiceContentForm, invoiceContentInput, contentMappingForm, contentMappingInput,
  classificationLabel, returnRateLabel, autoReturnNotice } from './invoiceClassification.js'

test('候选明细预填仅保留人工字段，元金额精确往返且不能夹带确认或来源',()=>{
 const form=invoiceContentForm({lines:[{name:'住宿',tax_classification_code:'123',amount_minor:'9007199254740993',tax_minor:'0',sources:[{xml_path:'secret'}],review_status:'CONFIRMED'}]})
 assert.equal(form.lines[0].amount,'90071992547409.93')
 assert.deepEqual(invoiceContentInput(form),{lines:[{name:'住宿',tax_classification_code:'123',amount_minor:'9007199254740993',tax_minor:'0'}]})
 assert.deepEqual(invoiceContentInput(invoiceContentForm({lines:[{name:'住宿',amount_minor:'invalid'}]})),{lines:[{name:'住宿'}]})
 for(const line of [{name:''},{name:'x'.repeat(257)},{name:'住宿\n服务'},{name:'住宿',tax_classification_code:'1.*'},{name:'住宿',amount:'-1'}])assert.throws(()=>invoiceContentInput({lines:[line]}))
 assert.throws(()=>invoiceContentForm({lines:Array(101).fill({name:'住宿'})}),/100/)
})

test('规则关键词原样保留字面逗号，空历史配置兼容且危险规则拒绝',()=>{
 const original=[{id:'hotel',tax_code_prefixes:['123'],keywords:['会议,培训','住宿'],fee_type:'HOTEL',default_claim_type:'TRAVEL',priority:1}]
 assert.deepEqual(contentMappingInput(contentMappingForm(original)),original)
 assert.deepEqual(contentMappingForm(null),[])
 assert.throws(()=>contentMappingInput([{id:'x',tax_code_prefixes:'12.*',fee_type:'HOTEL'}]),/税码/)
 assert.throws(()=>contentMappingInput([{id:'x',keywords:'住宿',fee_type:'HOTEL',priority:10001}]),/优先级/)
 assert.throws(()=>contentMappingInput([{id:'x',keywords:'住宿',fee_type:'HOTEL'},{id:'x',keywords:'餐饮',fee_type:'MEAL'}]),/不重复/)
})

test('建议标签及退回提示忠实显示真实来源和服务端退回率',()=>{
 assert.equal(classificationLabel('CONTENT'),'人工确认票面内容')
 assert.equal(classificationLabel('UNKNOWN_CODE'),'UNKNOWN_CODE')
 assert.equal(returnRateLabel(null),'暂无已提交单据')
 assert.equal(returnRateLabel(undefined),'退回率数据未提供')
 assert.equal(returnRateLabel(0),'0.00%')
 assert.equal(returnRateLabel(3333),'33.33%')
 assert.equal(autoReturnNotice({action:'APPROVE'}),'')
 assert.match(autoReturnNotice({auto_returned:true,reason:'标准不合规',compliance_codes:['OVER_STANDARD']}),/实际退回.*标准不合规.*OVER_STANDARD/)
})
