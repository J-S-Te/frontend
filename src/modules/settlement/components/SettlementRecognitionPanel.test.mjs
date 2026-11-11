import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { canReviewRecognition, recognitionAmount, recognitionCandidateRows, recognitionInput } from '../recognition.js'

// 用途：装载真实财务面板脚本及模板，外部接口由用例显式提供，不冒充浏览器验收。
// 参数：api为接口边界，permissions为当前能力，user为当前身份。
// 返回值：可操作状态、真实模板渲染及卸载方法。
async function mountRecognition(api,permissions,user='maker') {
  const source=readFileSync(new URL('./SettlementRecognitionPanel.vue',import.meta.url),'utf8')
  const {descriptor}=parse(source)
  const script=compileScript(descriptor,{id:'recognition-panel-test'})
  const deps={computed:Vue.computed,onBeforeUnmount:Vue.onBeforeUnmount,onMounted:Vue.onMounted,reactive:Vue.reactive,ref:Vue.ref,canReviewRecognition,recognitionAmount,recognitionCandidateRows,recognitionInput,todayBusinessDate:()=> '2026-11-11'}
  const code=script.content.replace(/^import[\s\S]*?['"][^'"]+['"]\n/gm,'').replace('export default','return')
  const component=new Function(...Object.keys(deps),code)(...Object.values(deps))
  const props={api,can:permission=>permissions.includes(permission),session:{user_id:user},initialClaim:''}
  let state
  const setup=component.setup
  component.setup=(props,context)=>{state=setup(props,context);return ()=>null}
  const renderer=Vue.createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null,createElement:()=>({}),createText:()=>({}),setText(){},setElementText(){},patchProp(){}})
  const app=renderer.createApp(component,props);app.mount({})
  await new Promise(resolve=>setImmediate(resolve))
  // 用途：渲染真实模板，以观察权限和状态分支。
  // 参数：无。
  // 返回值：当前SSR HTML。
  async function html(){
    const compiled=compileTemplate({source:descriptor.template.content,filename:'SettlementRecognitionPanel.vue',id:'recognition-panel-test',compilerOptions:{bindingMetadata:script.bindings}})
    assert.deepEqual(compiled.errors,[])
    const render=new Function('Vue',compiled.code.replace(/import \{([^}]+)\} from "vue"/g,(_,names)=>`const { ${names.replace(/ as /g,': ')} } = Vue`).replace('export function render','return function render'))(Vue)
    return renderToString(Vue.createSSRApp({setup:()=>state,render},props))
  }
  return {state,html,unmount:()=>app.unmount()}
}

test('财务面板保存真实白名单草稿，成功后才清空表单',async()=>{
  const calls=[]
  const api={list:async()=>({items:[],source_environment:'local'}),people:async()=>({items:[]}),create:async input=>{calls.push(input);return {id:'saved'}}}
  const page=await mountRecognition(api,['settlement.recognition.read','settlement.recognition.record'])
  try{
    Object.assign(page.state.form,{amount:'40.25',tax:'2.50',organization_id:'org',organization_witness_id:'witness',evidence_reference:'voucher',source_fact_id:'line-1',note:'真实依据'})
    await page.state.saveDraft()
    assert.equal(calls.length,1)
    assert.equal(calls[0].amount_minor,4025)
    assert.equal(calls[0].tax_minor,250)
    assert.equal(calls[0].source_environment,'local')
    assert.equal(calls[0].tenant_id,undefined)
    assert.equal(calls[0].created_by,undefined)
    assert.equal(page.state.form.amount,'')
  }finally{page.unmount()}
})

test('财务面板隐藏本人独立确认，退回必须说明理由',async()=>{
  const own={id:'own',kind:'INCOME',status:'SUBMITTED',created_by:'maker',submitted_by:'maker',net_minor:100,tax_minor:0,currency:'CNY',recognition_date:'2026-11-01',occurred_date:'2026-10-30'}
  const other={...own,id:'other',created_by:'another',submitted_by:'another'}
  const calls=[]
  const api={list:async()=>({items:[own,other],source_environment:'local'}),decision:async(id,input)=>{calls.push({id,input})}}
  const page=await mountRecognition(api,['settlement.recognition.read','settlement.recognition.review'])
  try{
    const html=await page.html()
    assert.equal((html.match(/>独立确认</g)||[]).length,1)
    page.state.reviewNotes.other='需要真实凭证说明'
    await page.state.act({...other,version:2},'RETURNED')
    assert.deepEqual(calls,[{id:'other',input:{expected_version:2,note:'需要真实凭证说明',decision:'RETURNED'}}])
  }finally{page.unmount()}
})

test('退款差异阻断候选选择，来源失败保留草稿与错误',async()=>{
  const api={list:async()=>({items:[],source_environment:'local'}),people:async()=>({items:[]}),candidates:async()=>({blocked:true,conflict_record_ids:['original'],claim:{status:'KNOWN',claim_type:'PREPAYMENT'}}),create:async()=>{throw new Error('凭证不存在')}}
  const page=await mountRecognition(api,['settlement.recognition.read','settlement.recognition.record'])
  try{
    page.state.claimID.value='claim'
    await page.state.readCandidates()
    assert.deepEqual(page.state.candidateRows.value,[])
    assert.match(await page.html(),/未处置的付款冲正差异/)
    Object.assign(page.state.form,{amount:'40.00',tax:'0'})
    await page.state.saveDraft()
    assert.equal(page.state.form.amount,'40.00')
    assert.equal(page.state.error.value,'凭证不存在')
  }finally{page.unmount()}
})

test('证据上传失败不预填凭证，就绪后才使用真实绑定回执',async()=>{
  let failure=true
  const api={list:async()=>({items:[],source_environment:'local'}),people:async()=>({items:[]}),uploadEvidence:async()=>{if(failure)throw new Error('网关绑定失败');return {status:'READY',evidence_reference:'file:real-evidence',name:'真实依据.pdf'}}}
  const page=await mountRecognition(api,['settlement.recognition.read','settlement.recognition.record'])
  try{
    page.state.evidenceFile.value={name:'真实依据.pdf'}
    Object.assign(page.state.form,{organization_id:'org',organization_witness_id:'witness'})
    await page.state.uploadEvidence()
    assert.equal(page.state.form.evidence_reference,'')
    assert.equal(page.state.error.value,'网关绑定失败')
    failure=false
    await page.state.uploadEvidence()
    assert.equal(page.state.form.evidence_reference,'file:real-evidence')
    assert.equal(page.state.evidenceName.value,'真实依据.pdf')
  }finally{page.unmount()}
})

test('F3-R1真实面板可提交关联原记录的残税冲回并按负税额展示',async()=>{
  const calls=[]
  const taxRow={id:'tax-reversal',original_id:'original',kind:'COST',status:'CONFIRMED',created_by:'maker',net_minor:0,tax_minor:6,currency:'CNY',recognition_date:'2026-11-01',occurred_date:'2026-10-30'}
  const api={list:async()=>({items:[taxRow],source_environment:'local'}),people:async()=>({items:[]}),create:async input=>{calls.push(input);return {id:'saved'}}}
  const page=await mountRecognition(api,['settlement.recognition.read','settlement.recognition.record'])
  try{
    Object.assign(page.state.form,{kind:'COST',cost_category:'REIMBURSEMENT',original_id:'original',amount:'0.00',tax:'0.06',tax_basis:'EXCLUSIVE',organization_id:'org',organization_witness_id:'witness',evidence_reference:'file:proof',source_fact_id:'original-line',note:'独立处置残税'})
    assert.match(await page.html(),/0\.00 \/ -0\.06 CNY/)
    await page.state.saveDraft()
    assert.equal(calls.length,1)
    assert.equal(calls[0].amount_minor,0)
    assert.equal(calls[0].tax_minor,6)
    assert.equal(calls[0].original_id,'original')
    Object.assign(page.state.form,{amount:'0.00',tax:'0.06',tax_basis:'EXCLUSIVE',original_id:''})
    await page.state.saveDraft()
    assert.equal(calls.length,1)
    assert.match(page.state.error.value,/新确认须有正净额/)
  }finally{page.unmount()}
})
