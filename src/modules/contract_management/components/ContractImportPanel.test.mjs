import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { ensureStableReviewAttempt } from '../utils/opportunityIntakeReview.js'
import { prepareImportManifest, formatImportMinor } from '../utils/contractImport.js'

// importPanelHarness 编译实际导入面板并替换受控外部接口以验证模式及未知结果。
// 参数：mode为测试模式，request/listResponse替代外部接口，crmLogin替代正常登录窗口。
// 返回值：实际setup状态、组件渲染器和请求记录；不冒充真实服务验收。
function importPanelHarness(mode, request, listResponse = () => ({items:[],has_more:false,next_offset:null}), crmLogin = () => true) {
  const calls = [], delays = [], listCalls = [], timers = []
  const props = Vue.reactive({enabled:true,pdfEnabled:true,canPreview:true,canCommit:true,canApprove:true,canRelease:true,actorId:'actor',initialBatchId:'',supportedModes:['NORMAL','ARCHIVE_ONLY']})
  const batch = {batch_id:'batch-A',version:11,revision:1,preview_token:'preview',state:'PREVIEWED',can_commit:true,source_system:'legacy',sources:[],items:[{id:'item-A',item:{mode,item_key:'one',external_record_id:'old-1',source_file_ref:'file-ref',metadata:{customer_name:'历史客户'},policy_options:{project_mode:'NONE',finance_mode:'NONE',report_mode:'ARCHIVE_SEPARATE'}},state:'READY',issues:[]}]}
  const deps = {computed:Vue.computed,ref:Vue.ref,onMounted(){},onBeforeUnmount(){},setTimeout(callback,delay){delays.push(delay);timers.push(callback);return 0},clearTimeout(){},ContractPDFPreview:{render(){return null}},
    contractImportRequest:async (...args)=> {calls.push(args);return request ? request(batch,...args) : structuredClone(batch)},
    listContractImportBatches:async(offset)=>{listCalls.push(offset);return listResponse(offset)},releaseContractImportItem:async()=>({}),getImportItemDocumentDescriptor:async()=>({}),importItemSourceURL:()=>'',
    prepareImportManifest,formatImportMinor,validateContractSourceFile(){},ensureStableReviewAttempt,
    openContractCRMLogin:crmLogin}
  const {descriptor}=parse(readFileSync(new URL('./ContractImportPanel.vue',import.meta.url),'utf8'))
  const script=compileScript(descriptor,{id:'import-panel-test'})
  const component=new Function(...Object.keys(deps),script.content.replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm,'').replace('export default','return'))(...Object.values(deps))
  const template=compileTemplate({source:descriptor.template.content,filename:'ContractImportPanel.vue',id:'import-panel-test',compilerOptions:{bindingMetadata:script.bindings}})
  assert.deepEqual(template.errors,[])
  const render=new Function('Vue',template.code.replace(/import \{([^}]+)\} from "vue"/g,(_,names)=>`const { ${names.replace(/ as /g,': ')} } = Vue`).replace('export function render','return function render'))(Vue)
  const state=component.setup(props,{expose(){}})
  state.batch.value=structuredClone(batch);state.batchID.value=batch.batch_id;state.lookupID.value=batch.batch_id
  return {state,props,batch,calls,delays,listCalls,timers,html:()=>renderToString(Vue.createSSRApp({render:()=>render({},[],props,Vue.proxyRefs(state),{}, {})}))}
}

test('historical PREVIEWED renders the direct confirmation entry before any contract exists', async()=>{
  const panel=importPanelHarness('ARCHIVE_ONLY')
  const html=await panel.html()
  assert.match(html,/冻结清单、建立历史记录并提交独立确认/)
  assert.doesNotMatch(html,/确认冻结清单并创建草稿<\/button>/)
  await panel.state.confirmation()
  assert.equal(panel.calls[0][0],'submit-confirmation')
})

test('NORMAL preview retains its ordinary commit entry', async()=>{
  const html=await importPanelHarness('NORMAL').html()
  assert.match(html,/确认冻结清单并创建草稿<\/button>/)
  assert.doesNotMatch(html,/冻结清单、建立历史记录并提交独立确认/)
})

test('missing CRM context offers normal login while preserving the batch, source and unsaved manifest', async()=>{
  let opens=0
  const panel=importPanelHarness('NORMAL',null,undefined,()=>{opens++;return true})
  panel.state.batch.value.items[0].issues=[{field_path:'metadata.crm_customer_id',code:'IMPORT_CRM_SESSION_REQUIRED',retryable:true}]
  panel.state.batch.value.state='BLOCKED'
  panel.state.text.value='unsaved manifest';panel.state.files.value=[{name:'one.pdf'}]
  const html=await panel.html()
  assert.match(html,/连接 CRM/)
  assert.match(html,/授权上下文.*缺失|授权上下文.*过期/)
  panel.state.connectCRM()
  assert.equal(opens,1)
  assert.equal(panel.state.batchID.value,'batch-A')
  assert.equal(panel.state.text.value,'unsaved manifest')
  assert.deepEqual(panel.state.files.value,[{name:'one.pdf'}])
  assert.equal(panel.calls.length,0,'登录动作不得自动建单、提交或重复预检')
  assert.match(panel.state.crmConnectionMessage.value,/重新预检/)
})

test('CRM reconnect is unavailable without preview permission and reports blocked popups', async()=>{
  let opens=0
  const panel=importPanelHarness('NORMAL',null,undefined,()=>{opens++;return false})
  panel.state.batch.value.items[0].issues=[{field_path:'metadata.crm_customer_id',code:'IMPORT_CRM_SESSION_REQUIRED'}]
  panel.state.connectCRM()
  assert.match(panel.state.crmConnectionMessage.value,/弹出窗口/)
  panel.state.crmConnectionMessage.value=''
  panel.props.canPreview=false
  assert.doesNotMatch(await panel.html(),/连接 CRM<\/button>/)
  panel.state.connectCRM()
  assert.equal(opens,1,'无预检权限不能触发重连')
  panel.props.canPreview=true
  panel.state.batch.value.items[0].issues=[{field_path:'metadata.crm_customer_id',code:'IMPORT_VALIDATION_FAILED'}]
  assert.doesNotMatch(await panel.html(),/连接 CRM<\/button>/)
  panel.state.connectCRM()
  assert.equal(opens,1,'非上下文错误不能随意触发重连')
})

test('explicit project validation rejection offers same-command retry while unknown results stay blocked', async()=>{
  const panel = importPanelHarness('CONTINUE_LIVE')
  panel.batch.state = 'PARTIAL'
  panel.batch.confirmation = {state:'APPROVED',roles:[],approved_roles:[]}
  panel.batch.items[0].confirmed = true
  panel.batch.items[0].targets = [{target:'PROJECT',phase:'RELEASE',state:'BLOCKED',version:5,
    recipient_http_status:422,recipient_code:'IMPORT_VALIDATION_FAILED'}]
  panel.state.batch.value = structuredClone(panel.batch)
  assert.match(await panel.html(), /核对项目参数和负责人后重试同一命令/)
  for (const [status,code] of [[0,''],[200,''],[409,'IMPORT_IDEMPOTENCY_CONFLICT'],[422,'IMPORT_POLICY_UNSUPPORTED']]) {
    panel.state.batch.value.items[0].targets[0].recipient_http_status = status
    panel.state.batch.value.items[0].targets[0].recipient_code = code
    assert.doesNotMatch(await panel.html(), /核对项目参数和负责人后重试同一命令/)
  }
})

test('completed target shows its receipt without a stale previous wait error', async()=>{
  const panel = importPanelHarness('ARCHIVE_ONLY')
  panel.batch.items[0].confirmed = true
  panel.batch.items[0].targets = [{target:'REPORT',state:'COMPLETE',receipt_id:'import-62',error_code:'IMPORT_TARGET_WAITING'}]
  panel.state.batch.value = structuredClone(panel.batch)
  const html = await panel.html()
  assert.match(html,/import-62/)
  assert.doesNotMatch(html,/IMPORT_TARGET_WAITING/)
})

test('unknown approval response keeps command key and original expected version across refreshes',async()=>{
  let writes=0
  const panel=importPanelHarness('ARCHIVE_ONLY',(batch,action)=>{
    if(action==='confirmation-actions'){writes++;batch.version++;throw new Error('response lost')}
    return structuredClone(batch)
  })
  panel.batch.confirmation={state:'PENDING',workflow_id:'workflow-1',roles:['finance'],assignees:{finance:['actor']},approved_roles:[],commands:[]}
  panel.state.batch.value=structuredClone(panel.batch)
  await panel.state.confirmation('APPROVE')
  await panel.state.confirmation('APPROVE')
  const commands=panel.calls.filter(row=>row[0]==='confirmation-actions')
  assert.equal(writes,2)
  assert.equal(commands[0][2].command_key,commands[1][2].command_key)
  assert.equal(commands[0][2].expected_version,11)
  assert.equal(commands[1][2].expected_version,11)
})

test('persisted pending approval prevents a second human command before workflow consumption', async()=>{
  const panel=importPanelHarness('ARCHIVE_ONLY')
  panel.batch.confirmation={state:'PENDING',workflow_id:'workflow-1',roles:['finance'],assignees:{finance:['actor']},approved_roles:[],commands:[{actor_id:'actor',action:'APPROVE',command_key:'persisted'}]}
  panel.state.batch.value=structuredClone(panel.batch)
  assert.equal(panel.state.canVote.value,false)
  await panel.state.confirmation('APPROVE')
  assert.equal(panel.calls.some(row=>row[0]==='confirmation-actions'),false)
})

test('starting another batch clears the local operation while preserving the saved task and fencing late reads', async()=>{
  let finish
  const panel=importPanelHarness('NORMAL',()=>new Promise(resolve=>{finish=resolve}))
  panel.state.text.value='old manifest';panel.state.files.value=[{name:'old.pdf'}]
  panel.state.commitKey.value='old-commit';panel.state.actionAttempt.value={key:'old-command'}
  const reading=panel.state.refresh('batch-A')
  assert.equal(typeof panel.state.startNewBatch,'function')
  panel.state.startNewBatch()
  assert.equal(panel.state.batch.value,null)
  assert.equal(panel.state.batchID.value,'')
  assert.equal(panel.state.text.value,'')
  assert.deepEqual(panel.state.files.value,[])
  assert.equal(panel.state.actionAttempt.value,null)
  finish(structuredClone(panel.batch));await reading
  assert.equal(panel.state.batch.value,null,'late saved-batch result must not replace the new form')
  assert.deepEqual(panel.calls.map(row=>row[0]),['get'],'starting another batch must not cancel/delete the saved server task')
})

test('unreleased manual targets do not trigger idle polling but active target work does', async()=>{
  const panel=importPanelHarness('ARCHIVE_ONLY')
  panel.batch.state='TARGETS_PENDING'
  panel.batch.items[0].targets=[{target:'REPORT',state:'WAITING_RELEASE'}]
  await panel.state.refresh('batch-A')
  assert.deepEqual(panel.delays,[])
  panel.batch.items[0].targets[0].state='WAITING'
  await panel.state.refresh('batch-A')
  assert.deepEqual(panel.delays,[5000])
})

test('a delayed old-batch read cannot redirect a new preview upload and manifest', {timeout:2000}, async()=>{
  let finishOldRead, finishUpload
  let created
  const panel=importPanelHarness('NORMAL',(original,action,id,payload)=>{
    if(action==='get' && id==='batch-A') {
      if(finishOldRead) return structuredClone(original)
      return new Promise(resolve=>{finishOldRead=()=>resolve(structuredClone(original))})
    }
    if(action==='create') {created={...structuredClone(original),batch_id:'batch-B',state:'DRAFT',items:[],sources:[]};return created}
    if(action==='files') return new Promise(resolve=>{finishUpload=()=>{created.sources=[{file_ref:'file-B',item_key:'one',filename:'one.pdf',state:'READY'}];resolve({file_ref:'file-B'})}})
    if(action==='manifest') created.items=payload.manifest.items.map(item=>({id:'item-B',item,state:'READY',issues:[]}))
    return structuredClone(created)
  })
  panel.state.batch.value=null;panel.state.batchID.value=''
  panel.state.text.value=JSON.stringify({schema_version:1,source_system:'legacy',items:[{item_key:'one',external_record_id:'old-1',mode:'NORMAL',source_file_ref:'one.pdf',metadata:{}}]})
  panel.state.files.value=[new File(['PDF fixture'],'one.pdf',{type:'application/pdf'})]
  const oldRead=panel.state.refresh('batch-A')
  const preview=panel.state.preview()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(typeof finishUpload,'function')
  finishOldRead();await oldRead
  finishUpload();await preview
  assert.deepEqual(panel.calls.filter(row=>['files','manifest','preview'].includes(row[0])).map(row=>row[1]),['batch-B','batch-B','batch-B'])
  assert.equal(panel.state.batchID.value,'batch-B')
})

test('an empty authorized candidate page still exposes the server cursor for later visible tasks',async()=>{
  const panel=importPanelHarness('NORMAL',null,offset=>offset===0
    ? {items:[],has_more:true,next_offset:50}
    : {items:[{batch_id:'visible-next',state:'PREVIEWED'}],has_more:false,next_offset:null})
  await panel.state.loadBatches()
  let html=await panel.html()
  assert.match(html,/列表下一页/)
  assert.doesNotMatch(html,/disabled[^>]*>列表下一页/)
  await panel.state.loadBatches(50)
  html=await panel.html()
  assert.match(html,/visible-next/)
  assert.deepEqual(panel.listCalls,[0,50])
})

test('a slow task-list read does not consume and lose active batch polling',async()=>{
  let finishList
  const panel=importPanelHarness('ARCHIVE_ONLY',null,()=>new Promise(resolve=>{finishList=resolve}))
  panel.batch.state='TARGETS_PENDING';panel.batch.items[0].targets=[{target:'REPORT',state:'WAITING'}]
  await panel.state.refresh('batch-A')
  const listing=panel.state.loadBatches()
  await panel.timers[0]()
  const scheduled=panel.delays.length
  finishList({items:[],has_more:false,next_offset:null});await listing
  assert.equal(scheduled,2,'active polling must continue independently of list loading')
})

test('a failed pause request refreshes current state and restores active polling',async()=>{
  const panel=importPanelHarness('NORMAL',(batch,action)=>{if(action==='pause')throw new Error('response unknown');return structuredClone(batch)})
  panel.batch.state='RUNNING'
  await panel.state.refresh('batch-A')
  await panel.state.control('pause')
  assert.equal(panel.calls.filter(row=>row[0]==='get').length,2)
  assert.equal(panel.delays.length,2)
  assert.match(panel.state.error.value,/response unknown/)
})

test('background refresh preserves a different batch number being typed for the next lookup',async()=>{
  const panel=importPanelHarness('NORMAL')
  panel.state.lookupID.value='batch-next'
  await panel.state.refresh('batch-A')
  assert.equal(panel.state.lookupID.value,'batch-next')
  assert.equal(panel.state.batchID.value,'batch-A')
})
