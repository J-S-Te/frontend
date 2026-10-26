import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
function extract(source, name) {
 let start = source.indexOf(`function ${name}(`)
 if (source.slice(start-6,start)==='async ') start-=6
 const body=source.indexOf('{',start);let depth=0
 for(let i=body;i<source.length;i++) {if(source[i]==='{')depth++;if(source[i]==='}'&&--depth===0)return source.slice(start,i+1)}
 throw new Error(name)
}
test('共享确认框打开时下层焦点限制暂停，不抢 Shift+Tab', () => {
 const source=read('./composables/useDialogFocusTrap.js');let prevented=false;let focused=false
 const last={focus(){focused=true}}
 const handler=vm.runInNewContext(`(${extract(source,'onKeydown')})`,{document:{body:{dataset:{confirmDialogOpen:'true'}},activeElement:{}},items:()=>[{},last],container:{value:{contains:()=>false}}})
 handler({key:'Tab',shiftKey:true,preventDefault(){prevented=true}})
 assert.equal(prevented,false);assert.equal(focused,false)
})
test('共享确认框消费 Escape 并阻断后续全局监听', () => {
 const source=read('./components/ConfirmDialog.vue');let stopped=false;let cancelled=false
 const handler=vm.runInNewContext(`(${extract(source,'onKeydown')})`,{isTopDialogLayer:()=>true,layerElement:null,props:{busy:false},emit:()=>{cancelled=true}})
 handler({key:'Escape',preventDefault(){},stopImmediatePropagation(){stopped=true}})
 assert.equal(cancelled,true);assert.equal(stopped,true)
})
test('项目不再处理已消费的 Escape', () => {
 const source=read('../project_management/views/ProjectManagementView.vue');let closed=false
 const handler=vm.runInNewContext(`(${extract(source,'onGlobalKeydown')})`,{closeActiveOverlay(){closed=true},document:{body:{dataset:{}}}})
 handler({key:'Escape',defaultPrevented:true,preventDefault(){}})
 assert.equal(closed,false)
})
for(const accepted of [false,true]) test(`CRM关闭脏表单遵守应用确认结果=${accepted}，不使用原生确认`,async()=>{
 const source=read('../customer_opportunity/views/CustomerOpportunityView.vue');let asks=0;let native=0
 const state={actionLoading:{value:false},customerFormDirty:{value:true},customerDialog:{value:true},customerFormInitial:'old',confirmDialog:{value:null},window:{confirm(){native++;return true}},askConfirm:async()=>{asks++;return accepted}}
 const close=vm.runInNewContext(`${extract(source,'confirmDiscardIfDirty')}\n(${extract(source,'closeCustomerDialog')})`,state)
 await close()
 assert.equal(asks,1);assert.equal(native,0);assert.equal(state.customerDialog.value,!accepted)
})

for (const name of ['closeCustomerDialog','closeOpportunityDialog','closePresaleCreatePage']) {
 for (const accepted of [false,true]) test(`${name} 关闭确认=${accepted}，保留或丢弃对应草稿`,async()=>{
  const source=read('../customer_opportunity/views/CustomerOpportunityView.vue')
  let invalidated=0
  const state={actionLoading:{value:false},presaleCreateLoading:{value:false},customerFormDirty:{value:true},opportunityFormDirty:{value:true},presaleFormDirty:{value:true},customerDialog:{value:true},opportunityDialog:{value:true},presaleCreatePage:{value:true},customerFormInitial:'old',opportunityFormInitial:'old',presaleFormInitial:'old',presaleOpportunityOptionsLoadSequence:{value:0},presaleReopenRequest:{value:{}},presaleCreateOptionsScope:{invalidate(){invalidated++}},resetMessages(){},confirmDialog:{value:null},askConfirm:async()=>accepted}
  const close=vm.runInNewContext(`${extract(source,'confirmDiscardIfDirty')}\n(${extract(source,name)})`,state)
  await close()
  const key={closeCustomerDialog:'customerDialog',closeOpportunityDialog:'opportunityDialog',closePresaleCreatePage:'presaleCreatePage'}[name]
  assert.equal(state[key].value,!accepted)
  if(name==='closePresaleCreatePage')assert.equal(invalidated,accepted?1:0)
 })
}
test('CRM保存中不关闭也不弹确认，未修改时直接关闭',async()=>{
 const source=read('../customer_opportunity/views/CustomerOpportunityView.vue');let asks=0
 const state={actionLoading:{value:true},customerFormDirty:{value:true},customerDialog:{value:true},customerFormInitial:'old',confirmDialog:{value:null},askConfirm:async()=>{asks++;return true}}
 const close=vm.runInNewContext(`${extract(source,'confirmDiscardIfDirty')}\n(${extract(source,'closeCustomerDialog')})`,state)
 await close();assert.equal(state.customerDialog.value,true);assert.equal(asks,0)
 state.actionLoading.value=false;state.customerFormDirty.value=false
 await close();assert.equal(state.customerDialog.value,false);assert.equal(asks,0)
})
test('确认框繁忙时 Escape 只拦截事件，不能取消进行中的操作',()=>{
 let cancelled=false;let stopped=false
 const handler=vm.runInNewContext(`(${extract(read('./components/ConfirmDialog.vue'),'onKeydown')})`,{isTopDialogLayer:()=>true,layerElement:null,props:{busy:true},emit(){cancelled=true}})
 handler({key:'Escape',preventDefault(){},stopImmediatePropagation(){stopped=true}})
 assert.equal(cancelled,false);assert.equal(stopped,true)
})

test('说明输入框消费 Escape，不能继续关闭下层编辑器',()=>{
 let stopped=false;let cancelled=false
 const handler=vm.runInNewContext(`(${extract(read('./components/PromptDialog.vue'),'onKeydown')})`,{isTopDialogLayer:()=>true,layerElement:null,cancel(){cancelled=true}})
 handler({key:'Escape',preventDefault(){},stopImmediatePropagation(){stopped=true}})
 assert.equal(cancelled,true);assert.equal(stopped,true)
})
test('非顶层确认框不响应 Escape',()=>{
 let cancelled=false
 const handler=vm.runInNewContext(`(${extract(read('./components/ConfirmDialog.vue'),'onKeydown')})`,{isTopDialogLayer:()=>false,layerElement:null,props:{busy:false},emit(){cancelled=true}})
 handler({key:'Escape',preventDefault(){},stopImmediatePropagation(){}})
 assert.equal(cancelled,false)
})

for (const name of ['ConfirmDialog.vue','PromptDialog.vue']) {
 test(`${name} 繁忙无可聚焦项时 Tab 不穿透`,()=>{
  let prevented=false,focused=false
  const dialog={value:{querySelectorAll:()=>[],focus(){focused=true}}}
  const handler=vm.runInNewContext(`(${extract(read('./components/'+name),'onKeydown')})`,{isTopDialogLayer:()=>true,layerElement:null,props:{busy:true},dialog,focusable:()=>[],document:{activeElement:{}}})
  handler({key:'Tab',preventDefault(){prevented=true}})
  assert.equal(prevented,true);assert.equal(focused,true)
 })
 test(`${name} 正向 Tab 将外部焦点带回弹窗`,()=>{
  let focused=false
  const first={offsetParent:{},focus(){focused=true}}
  const handler=vm.runInNewContext(`(${extract(read('./components/'+name),'onKeydown')})`,{isTopDialogLayer:()=>true,layerElement:null,props:{busy:false},focusable:()=>[first,{}],dialog:{value:{querySelectorAll:()=>[first,{}],contains:()=>false}},document:{activeElement:{}}})
  handler({key:'Tab',preventDefault(){}})
  assert.equal(focused,true)
 })
}
