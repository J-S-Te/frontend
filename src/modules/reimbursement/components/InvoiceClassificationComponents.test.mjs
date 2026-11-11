import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as classification from '../invoiceClassification.js'
import { travelInput, evidenceIDs } from '../claimFields.js'
import { createCommandRunner, createRequestID, formatMinor, toMinor } from '../api/client.js'
import { createErrorStateStub } from '../../../test/helpers/errorStateStub.mjs'


// 用途：编译真实业务组件，仅替换其外部HTTP边界。
// 参数：name为组件文件名，extras为外部依赖，inline表示同时编译模板。
// 返回值：可挂载真实Vue组件，不冒充浏览器验收。
function component(name, extras = {}, inline = true) {
 const {descriptor}=parse(readFileSync(new URL(name,import.meta.url),'utf8'))
 const compiled=compileScript(descriptor,{id:'classification-component-test',inlineTemplate:inline})
 const values={createRequestID,...extras}
 const body=compiled.content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,(_,names,source)=>{
  for(const item of names.split(',')) {const [key,alias=key]=item.trim().split(/\s+as\s+/);values[alias]=source==='vue'?Vue[key]:extras[key]}
  return ''
 }).replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm,(_,name)=>{values[name]=extras[name];return ''})
 return new Function(...Object.keys(values),body.replace('export default','return'))(...Object.values(values))
}

test('真实归类组件显示来源规则、混合原因及人工选值，文本按Vue转义',async()=>{
 const view=component('InvoiceClassificationEvidence.vue',classification)
 const html=await renderToString(Vue.createSSRApp(view,{saved:true,rows:[{invoice_id:'invoice',invoice_version:3,rule_id:'rule',rule_version:7,status:'NEEDS_REVIEW',source:'CONTENT',reasons:['MIXED_CATEGORIES'],suggested_fee_type:'',selected_fee_type:'MEAL',manual_override:true,matches:[{mapping_id:'hotel',line_index:0,line_name:'<script>住宿</script>',matched_by:'KEYWORD',matched_value:'住宿',fee_type:'HOTEL'}]}]}))
 assert.match(html,/服务器保存的归类依据（只读）/)
 assert.match(html,/人工确认票面内容/)
 assert.match(html,/明细对应不同费用类别/)
 assert.match(html,/已记录人工选择/)
 assert.match(html,/rule v7/)
 assert.match(html,/&lt;script&gt;住宿/)
 assert.doesNotMatch(html,/<script>/)
})

test('真实内容规则组件提供逐项业务字段，票面内容锁定时禁用编辑',async()=>{
 const rules=await renderToString(Vue.createSSRApp(component('InvoiceContentMappings.vue'),{value:[{id:'hotel',keywords:'住宿',tax_code_prefixes:'123',fee_type:'HOTEL',priority:1}]}))
 assert.doesNotMatch(rules,/唯一规则ID|value="hotel"/)
 assert.match(rules,/每行一个/);assert.match(rules,/HOTEL/)
 const fields=await renderToString(Vue.createSSRApp(component('InvoiceContentFields.vue'),{disabled:true,value:{lines:[{name:'住宿',amount:'1.00'}]}}))
 assert.match(fields,/<fieldset[^>]*disabled/);assert.match(fields,/人工对照原件确认/);assert.match(fields,/住宿/)
})

test('正式更正请求发送人工内容白名单，保留当前票据版本及原件',async()=>{
 const calls=[]
 const request=async(path,options)=>{if(options){calls.push([path,JSON.parse(options.body)]);return{id:'case'}}return{corrections:[],impacts:[]}}
 const view=component('InvoiceControlsPanel.vue',{...classification,travelInput,evidenceIDs,createCommandRunner,formatMinor,toMinor,reimbursementAPI:{request},TravelFields:{render:()=>null},InvoiceContentFields:{render:()=>null},ErrorState:createErrorStateStub().Stub},false)
 let state
 const setup=view.setup
 view.setup=(props,ctx)=>{state=setup(props,ctx);return()=>null}
 const renderer=Vue.createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null,createElement:()=>({}),createText:()=>({}),setText(){},setElementText(){},patchProp(){}})
 const app=renderer.createApp(view,{invoice:{id:'invoice',version:4,owner_subject_id:'actor',total_minor:'100',file_ids:['file'],content:{lines:[{name:'住宿',amount_minor:'100'}]}},session:{subject_id:'actor',permissions:[]}})
 app.mount({})
 try {
  state.reason.value='对照原件修订'
  state.form.value.content.lines[0].name='餐饮'
  await state.requestCorrection()
  assert.equal(calls.length,1)
  assert.equal(calls[0][0],'/invoices/invoice/corrections')
  assert.equal(calls[0][1].expected_version,4)
  assert.deepEqual(calls[0][1].proposed_invoice.content,{lines:[{name:'餐饮',amount_minor:'100'}]})
  assert.deepEqual(calls[0][1].proposed_invoice.file_ids,['file'])
 }finally{app.unmount()}
})
