import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { ensureStableReviewAttempt } from '../utils/opportunityIntakeReview.js'
import { prepareImportManifest, formatImportMinor } from '../utils/contractImport.js'
import { buildImportManifestFromRows, createImportFormRow, emptyImportServiceItem,
  importFieldLabel, importRowsFromItems, validateImportFormRows } from '../utils/contractImportForm.js'
import { applyContractExcelCustomerLookup, blockingContractExcelIssues, buildContractExcelImportRows,
  contractExcelTemplateHeaders, matchContractExcelRecordsToFiles, parseContractExcelWorkbook,
  summarizeContractExcelImport } from '../utils/contractExcelImport.js'
import { paymentAmountMinor } from '../utils/paymentTerms.js'
import { contractImportErrorRows, contractImportErrorsCsv } from '../utils/contractImportErrors.js'
import { fallbackServiceTypeOptions } from '../utils/contractDisplay.js'
import { externalContractTypes, contractSystemLevels } from '../utils/contractPayload.js'
import { importRowSourceForm, applyImportRowSourceForm } from '../utils/localImportSourceBridge.js'

// importPanelHarness 编译实际导入面板并替换受控外部接口以验证模式及未知结果。
// 参数：mode为测试模式，request/listResponse替代外部接口，crmLogin替代正常登录窗口。
// 返回值：实际setup状态、组件渲染器和请求记录；不冒充真实服务验收。
function importPanelHarness(mode, request, listResponse = () => ({items:[],has_more:false,next_offset:null}), crmLogin = () => true,
  excelReader = async () => { throw new Error('Excel reader not configured') },
  customerResponse = async () => ({items:[],page:1,page_size:20,total:0,has_more:false}),
  sourceCapabilities = {}) {
  const calls = [], delays = [], listCalls = [], timers = [], directoryCalls = []
  const props = Vue.reactive({enabled:true,pdfEnabled:true,canPreview:true,canCommit:true,canApprove:true,canRelease:true,actorId:'actor',initialBatchId:'',supportedModes:['NORMAL','ARCHIVE_ONLY'],sourceCapabilities})
  const batch = {batch_id:'batch-A',version:11,revision:1,preview_token:'preview',state:'PREVIEWED',can_commit:true,source_system:'legacy',sources:[],items:[{id:'item-A',item:{mode,item_key:'one',external_record_id:'old-1',source_file_ref:'file-ref',metadata:{customer_name:'历史客户'},policy_options:{project_mode:'NONE',finance_mode:'NONE',report_mode:'ARCHIVE_SEPARATE'}},state:'READY',issues:[]}]}
  const deps = {computed:Vue.computed,ref:Vue.ref,watch:Vue.watch,nextTick:Vue.nextTick,onMounted(){},onBeforeUnmount(){},setTimeout(callback,delay){delays.push(delay);timers.push(callback);return 0},clearTimeout(){},ContractPDFPreview:{render(){return null}},
    LocalContractSourcePicker:{render(){return null}},importRowSourceForm,applyImportRowSourceForm,
    contractImportRequest:async (...args)=> {calls.push(args);return request ? request(batch,...args) : structuredClone(batch)},
    listContractImportBatches:async(offset)=>{listCalls.push(offset);return listResponse(offset)},releaseContractImportItem:async()=>({}),getImportItemDocumentDescriptor:async()=>({}),importItemSourceURL:()=>'',
    prepareImportManifest,formatImportMinor,validateContractSourceFile(){},ensureStableReviewAttempt,
    openContractCRMLogin:crmLogin,
    buildImportManifestFromRows,createImportFormRow,emptyImportServiceItem,importFieldLabel,importRowsFromItems,validateImportFormRows,
    applyContractExcelCustomerLookup,blockingContractExcelIssues,buildContractExcelImportRows,matchContractExcelRecordsToFiles,
    parseContractExcelWorkbook,summarizeContractExcelImport,contractExcelMaximumBytes:5*1024*1024,contractExcelTemplateURL:'/contract-import-template.xlsx',
    readContractExcelWorkbook:excelReader,
    paymentAmountMinor,fallbackServiceTypeOptions,externalContractTypes,contractSystemLevels,
    contractImportErrorRows,contractImportErrorsCsv,
    useDictionaryOptions:()=>({options:Vue.ref(fallbackServiceTypeOptions),loading:Vue.ref(false)}),
    listMyCustomers:customerResponse,
    ensureContractCRMDirectorySession:async()=>{},
    listContractDetectionCategories:async()=>{directoryCalls.push('project');return [{category:'等保测评'},{category:'软件测试'}]}}
  const {descriptor}=parse(readFileSync(new URL('./ContractImportPanel.vue',import.meta.url),'utf8'))
  const script=compileScript(descriptor,{id:'import-panel-test'})
  const component=new Function(...Object.keys(deps),script.content.replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm,'').replace('export default','return'))(...Object.values(deps))
  const template=compileTemplate({source:descriptor.template.content,filename:'ContractImportPanel.vue',id:'import-panel-test',compilerOptions:{bindingMetadata:script.bindings}})
  assert.deepEqual(template.errors,[])
  const render=new Function('Vue',template.code.replace(/import \{([^}]+)\} from "vue"/g,(_,names)=>`const { ${names.replace(/ as /g,': ')} } = Vue`).replace('export function render','return function render'))(Vue)
  const state=component.setup(props,{expose(){}})
  state.batch.value=structuredClone(batch);state.batchID.value=batch.batch_id;state.lookupID.value=batch.batch_id
  return {state,props,batch,calls,delays,listCalls,timers,directoryCalls,html:()=>renderToString(Vue.createSSRApp({render:()=>render({},[],props,Vue.proxyRefs(state),{}, {})}))}
}

test('LOCAL普通导入抽屉保留来源版本、无需CRM/项目目录，实际生成清单不丢引用', async () => {
  let customerCalls = 0
  const panel = importPanelHarness('NORMAL', undefined, undefined, undefined, undefined,
    async () => { customerCalls++; return { items: [] } },
    { counterparty_source: 'local', category_source: 'local' })
  assert.equal(panel.state.normalEntryMode.value, 'manual')
  const row = createImportFormRow({ fileName: 'local.pdf', key: 'local-1', externalRecordId: 'LOCAL-1' })
  Object.assign(row, { title: '合成合同', contractType: '直签', amount: '100.00' })
  row.serviceItems = [{ ...emptyImportServiceItem(), serviceType: '软件测试', site: '合成现场', batch: '第一批' }]
  panel.state.formRows.value = [row]
  panel.state.files.value = [{ name: 'local.pdf', type: 'application/pdf', size: 64 }]
  panel.state.openRow(row)
  const form = importRowSourceForm(row)
  Object.assign(form, { counterparty_source: 'LOCAL', local_counterparty_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    counterparty_version: 2, customer_name: '合成单位', category_source: 'LOCAL' })
  Object.assign(form.service_items[0], { category: '软件测试', category_id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', category_version: 3 })
  panel.state.updateDrawerSource(form)
  await panel.state.loadCustomers(row)
  await panel.state.ensureDetectionCategories()
  assert.equal(customerCalls, 0)
  assert.equal(panel.directoryCalls.length, 0)
  panel.state.regenerateJSON()
  const metadata = JSON.parse(panel.state.text.value).items[0].metadata
  assert.equal(metadata.counterparty_source, 'LOCAL')
  assert.equal(metadata.crm_customer_id, 0)
  assert.equal(metadata.counterparty_version, 2)
  assert.equal(metadata.service_items[0].category_version, 3)
  const html = await panel.html()
  assert.doesNotMatch(html, /id="contract-import-row-customer-id"/)
  panel.state.selectNormalEntryMode('excel')
  assert.equal(panel.state.normalEntryMode.value, 'manual')
})

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
  panel.state.formRows.value=[createImportFormRow({fileName:'old.pdf'})];panel.state.jsonAuthoritative.value=true
  panel.state.commitKey.value='old-commit';panel.state.actionAttempt.value={key:'old-command'}
  const reading=panel.state.refresh('batch-A')
  assert.equal(typeof panel.state.startNewBatch,'function')
  panel.state.startNewBatch()
  assert.equal(panel.state.batch.value,null)
  assert.equal(panel.state.batchID.value,'')
  assert.equal(panel.state.text.value,'')
  assert.deepEqual(panel.state.files.value,[])
  assert.deepEqual(panel.state.formRows.value,[])
  assert.equal(panel.state.jsonAuthoritative.value,false)
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
  panel.state.jsonAuthoritative.value=true
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

// normalRow 提供普通模式最小可预检合同行，测试只替换必要的业务值。
function normalRow(overrides = {}) {
  return {
    ...createImportFormRow({ fileName: '年度测评合同.pdf', externalRecordId: 'HT-2024-001' }),
    title: '年度等级保护测评合同',
    contractType: '直签',
    crmCustomerId: '42',
    customerName: '示例客户',
    amount: '1234.56',
    currency: 'CNY',
    serviceItems: [{ serviceType: '等保测评', name: '', site: '上海总部', batch: '第一批次', category: '等保测评', requirement: '', testMode: 'STANDARD', systems: [] }],
    ...overrides,
  }
}

test('普通模式默认隐藏必填的原始 JSON，并呈现 PDF+Excel 批量入口', async () => {
  const panel = importPanelHarness('NORMAL')
  const html = await panel.html()
  assert.match(html, /Excel 批量导入（推荐）/)
  assert.match(html, /手动逐份填写/)
  assert.match(html, /第一步：选择或拖入 PDF 原件/)
  assert.match(html, /id="contract-import-excel"/)
  assert.match(html, /下载 Excel 标准模板/)
  assert.match(html, /高级：查看\/编辑清单/)
  assert.match(html, /用当前表单重新生成 JSON/)
  assert.match(html, /id="contract-import-advanced-json"[^>]*readonly/)
  assert.doesNotMatch(html, /id="contract-import-json"/)
  assert.doesNotMatch(html, /<textarea[^>]*required/)
})

test('历史模式保留完整 JSON 清单工作流并说明需要历史证据与策略', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY')
  panel.state.entryMode.value = 'ARCHIVE_ONLY'
  const html = await panel.html()
  assert.match(html, /历史导入需要完整清单/)
  assert.match(html, /history_evidence/)
  assert.match(html, /policy_options/)
  assert.match(html, /id="contract-import-json"/)
  assert.doesNotMatch(html, /高级：查看\/编辑清单/)
})

test('文件选择按原件生成行，重名原件被阻止并显示可访问错误', async () => {
  const panel = importPanelHarness('NORMAL')
  panel.state.selectNormalEntryMode('manual')
  const file = new File(['PDF fixture'], '合同A.pdf', { type: 'application/pdf' })
  panel.state.selectFiles({ target: { files: [file, file], value: '' } })
  assert.equal(panel.state.files.value.length, 1)
  assert.equal(panel.state.formRows.value.length, 1)
  assert.equal(panel.state.formRows.value[0].fileName, '合同A.pdf')
  assert.equal(panel.state.formRows.value[0].title, '合同A')
  assert.equal(panel.state.formRows.value[0].externalRecordId, '', '新建行不得随机生成来源业务键')
  assert.match(panel.state.formRows.value[0].key, /^row-/)
  assert.match(panel.state.fileMessage.value, /只能选择一次/)
  const html = await panel.html()
  assert.match(html, /role="alert"[^>]*>[^<]*同一文件/)
  panel.state.dropFiles({ dataTransfer: { files: [new File(['DOCX fixture'], '合同B.docx', { type: 'application/octet-stream' })] } })
  assert.equal(panel.state.files.value.length, 2)
  assert.deepEqual(panel.state.formRows.value.map(row => row.fileName), ['合同A.pdf', '合同B.docx'])
})

test('普通模式新建行不自动生成来源业务键，编辑抽屉要求显式填写', async () => {
  const panel = importPanelHarness('NORMAL')
  panel.state.selectNormalEntryMode('manual')
  panel.state.selectFiles({ target: { files: [new File(['PDF fixture'], '合同A.pdf', { type: 'application/pdf' })], value: '' } })
  const [row] = panel.state.formRows.value
  assert.equal(row.externalRecordId, '', '不得随机生成来源业务键')
  const keyIssue = row.issues.find(issue => issue.field === 'externalRecordId')
  assert.equal(keyIssue?.code, 'REQUIRED')
  const html = await panel.html()
  assert.match(html, /来源业务键：未填写/)
  assert.match(html, /发现 1 处问题/)
  panel.state.openRow(row, { currentTarget: { focus() {} } })
  const drawer = await panel.html()
  assert.match(drawer, /来源业务键：原系统合同编号\/业务键（必填，用于重复导入识别）/)
  assert.match(drawer, /id="contract-import-row-external-record-id"[^>]*maxlength="128"/)
  assert.match(drawer, /aria-invalid="true"/)
  row.externalRecordId = 'HT-2024-001'
  panel.state.clearExternalRecordIdIssue(row)
  assert.equal(row.issues.some(issue => issue.field === 'externalRecordId'), false)
})

test('缺来源业务键时写前阻断，补填后清单携带来源业务键', async () => {
  let created
  const panel = importPanelHarness('NORMAL', (original, action, id, payload) => {
    if (action === 'create') {
      created = { ...structuredClone(original), batch_id: 'batch-B', version: 12, revision: 1, state: 'DRAFT', items: [], sources: [], source_system: 'manual' }
      return created
    }
    if (action === 'files') {
      created.sources = [{ file_ref: 'file-B', item_key: payload.get('item_key'), filename: '年度测评合同.pdf', state: 'READY' }]
      return { file_ref: 'file-B' }
    }
    if (action === 'manifest') {
      created.items = payload.manifest.items.map(item => ({ id: 'item-B', item, state: 'READY', issues: [] }))
      created.revision = 2
      return structuredClone(created)
    }
    if (action === 'preview') {
      created.state = 'PREVIEWED'
      return structuredClone(created)
    }
    return structuredClone(created || original)
  })
  panel.state.batch.value = null
  panel.state.batchID.value = ''
  const row = normalRow({ externalRecordId: '' })
  panel.state.formRows.value = [row]
  panel.state.files.value = [new File(['PDF fixture'], '年度测评合同.pdf', { type: 'application/pdf' })]
  await panel.state.preview()
  assert.equal(panel.calls.length, 0, '缺业务键不得先建批次或上传')
  assert.match(panel.state.error.value, /来源业务键/)
  assert.ok(row.issues.some(issue => issue.field === 'externalRecordId' && issue.code === 'REQUIRED'))
  row.externalRecordId = 'HT-2024-001'
  await panel.state.preview()
  assert.equal(panel.state.error.value, '')
  const manifestCall = panel.calls.find(call => call[0] === 'manifest')
  assert.equal(manifestCall[2].manifest.items[0].external_record_id, 'HT-2024-001')
  assert.equal(panel.state.batchID.value, 'batch-B')
})

test('批次已保存清单后导入方式固定，防止普通表单和历史清单混用', async () => {
  const panel = importPanelHarness('NORMAL')
  const html = await panel.html()
  assert.match(html, /导入方式随当前批次固定/)
  assert.match(html, /<fieldset[^>]*disabled/)
})

test('普通模式预检由表单生成清单，金额转为分且原子上传后使用暂存 file_ref', async () => {
  let created
  const panel = importPanelHarness('NORMAL', (original, action, id, payload) => {
    if (action === 'create') {
      created = { ...structuredClone(original), batch_id: 'batch-B', version: 12, revision: 1, state: 'DRAFT', items: [], sources: [], source_system: 'manual' }
      return created
    }
    if (action === 'files') {
      created.sources = [{ file_ref: 'file-B', item_key: payload.get('item_key'), filename: '合同A.pdf', state: 'READY' }]
      return { file_ref: 'file-B' }
    }
    if (action === 'manifest') {
      created.items = payload.manifest.items.map(item => ({ id: 'item-B', item, state: 'READY', issues: [] }))
      created.revision = 2
      return structuredClone(created)
    }
    if (action === 'preview') {
      created.state = 'PREVIEWED'
      return structuredClone(created)
    }
    return structuredClone(created || original)
  })
  panel.state.batch.value = null
  panel.state.batchID.value = ''
  panel.state.formRows.value = [normalRow()]
  panel.state.files.value = [new File(['PDF fixture'], '年度测评合同.pdf', { type: 'application/pdf' })]
  await panel.state.preview()
  assert.equal(panel.state.error.value, '')
  const manifestCall = panel.calls.find(row => row[0] === 'manifest')
  assert.equal(manifestCall[2].manifest.items[0].metadata.amount_minor, 123456)
  assert.equal(manifestCall[2].manifest.items[0].external_record_id, 'HT-2024-001')
  assert.equal(manifestCall[2].manifest.items[0].source_file_ref, 'file-B')
  assert.equal(manifestCall[2].manifest.source_system, 'manual')
  assert.equal(panel.state.batchID.value, 'batch-B')
  assert.deepEqual(panel.calls.filter(row => ['files', 'manifest', 'preview'].includes(row[0])).map(row => row[1]), ['batch-B', 'batch-B', 'batch-B'])
})

test('表单缺字段在写请求前失败关闭，并把问题挂回具体行', async () => {
  const panel = importPanelHarness('NORMAL')
  panel.state.batch.value = null
  panel.state.batchID.value = ''
  panel.state.formRows.value = [createImportFormRow({ fileName: '合同A.pdf' })]
  panel.state.files.value = [new File(['PDF fixture'], '合同A.pdf', { type: 'application/pdf' })]
  await panel.state.preview()
  assert.equal(panel.calls.length, 0, '表单错误不得先建批次或上传')
  assert.match(panel.state.error.value, /表单有 \d+ 处需要修正/)
  assert.ok(panel.state.formRows.value[0].issues.length > 0)
  assert.match(await panel.html(), /发现 \d+ 处问题/)
})

test('高级模式由表单重新生成可核对的清单 JSON，勾选后转为人工编辑', async () => {
  const panel = importPanelHarness('NORMAL')
  panel.state.formRows.value = [normalRow()]
  panel.state.regenerateJSON()
  const manifest = JSON.parse(panel.state.text.value)
  assert.equal(manifest.items[0].metadata.amount_minor, 123456)
  assert.equal(manifest.items[0].metadata.service_items[0].site, '上海总部')
  assert.match(panel.state.advancedMessage.value, /重新生成/)
  panel.state.jsonAuthoritative.value = true
  panel.state.toggleJsonAuthoritative()
  assert.match(panel.state.advancedMessage.value, /表单修改不会生效/)
})

test('单行编辑抽屉提供对话框语义、字段错误和键盘关闭说明', async () => {
  const panel = importPanelHarness('NORMAL')
  const row = normalRow()
  row.issues = [{ rowKey: row.key, field: 'title', code: 'REQUIRED', message: '请填写合同标题。' }]
  panel.state.formRows.value = [row]
  panel.state.openRow(row, { currentTarget: { focus() {} } })
  const html = await panel.html()
  assert.match(html, /role="dialog"/)
  assert.match(html, /aria-modal="true"/)
  assert.match(html, /id="contract-import-drawer-title"/)
  assert.match(html, /aria-invalid="true"/)
  assert.match(html, /role="alert"[^>]*>请填写合同标题/)
  assert.match(html, /从 CRM 选择客户/)
  assert.match(html, /增加服务项/)
})

test('重新预检沿用已暂存原件，不重复上传且保留表单修订', async () => {
  let uploads = 0
  let created
  const panel = importPanelHarness('NORMAL', (original, action, id, payload) => {
    if (action === 'create') {
      created = { ...structuredClone(original), batch_id: 'batch-C', version: 20, revision: 1, state: 'DRAFT', items: [], sources: [], source_system: 'manual' }
      return created
    }
    if (action === 'files') {
      uploads += 1
      created.sources = [{ file_ref: `file-${uploads}`, item_key: payload.get('item_key'), filename: '年度测评合同.pdf', state: 'READY' }]
      return { file_ref: `file-${uploads}` }
    }
    if (action === 'manifest') {
      created.items = payload.manifest.items.map(item => ({ id: 'item-C', item, state: 'READY', issues: [] }))
      created.revision += 1
      return structuredClone(created)
    }
    if (action === 'preview') {
      created.state = 'PREVIEWED'
      return structuredClone(created)
    }
    return structuredClone(created || original)
  })
  panel.state.batch.value = null
  panel.state.batchID.value = ''
  panel.state.formRows.value = [normalRow({ fileName: '年度测评合同.pdf' })]
  panel.state.files.value = [new File(['PDF fixture'], '年度测评合同.pdf', { type: 'application/pdf' })]
  await panel.state.preview()
  assert.equal(uploads, 1)
  panel.state.formRows.value[0].amount = '1235.00'
  await panel.state.preview()
  assert.equal(uploads, 1, '已暂存原件必须按 file_ref 复用')
  const manifestCalls = panel.calls.filter(row => row[0] === 'manifest')
  assert.equal(manifestCalls.length, 2)
  assert.equal(manifestCalls[1][2].manifest.items[0].source_file_ref, 'file-1')
  assert.equal(manifestCalls[1][2].manifest.items[0].metadata.amount_minor, 123500)
  assert.deepEqual(panel.calls.filter(row => row[0] === 'files').map(row => row[1]), ['batch-C'])
})

test('原件上传被服务端拒绝时透出具体原因、原因码与文件名，并保留批次查询提示', async () => {
  let created
  const panel = importPanelHarness('NORMAL', (original, action) => {
    if (action === 'create') {
      created = { ...structuredClone(original), batch_id: 'batch-D', version: 30, revision: 1, state: 'DRAFT', items: [], sources: [], source_system: 'manual' }
      return created
    }
    if (action === 'files') {
      // 与 contract.js 一致：message 是已本地化的具体原因，details 保留原因码与文件名。
      const failure = new Error('PDF图片像素或渲染内存超出接入上限')
      failure.status = 422
      failure.code = 'IMPORT_SOURCE_REJECTED'
      failure.details = { reason_code: 'PDF_IMAGE_BUDGET_EXCEEDED', file_name: 'GTSR-261122.pdf' }
      throw failure
    }
    return structuredClone(created || original)
  })
  panel.state.batch.value = null
  panel.state.batchID.value = ''
  panel.state.formRows.value = [normalRow({ fileName: 'GTSR-261122.pdf' })]
  panel.state.files.value = [new File(['PDF fixture'], 'GTSR-261122.pdf', { type: 'application/pdf' })]
  await panel.state.preview()
  assert.match(panel.state.error.value, /PDF图片像素或渲染内存超出接入上限/)
  assert.match(panel.state.error.value, /GTSR-261122\.pdf/)
  assert.match(panel.state.error.value, /PDF_IMAGE_BUDGET_EXCEEDED/)
  assert.match(panel.state.error.value, /批次已保留，请先查询状态/)
  assert.doesNotMatch(panel.state.error.value, /请检查必填项、选择项和格式/)
})

test('PDF 校验繁忙（503）提示稍后重试，不引导用户改动已填数据', async () => {
  let created
  const panel = importPanelHarness('NORMAL', (original, action) => {
    if (action === 'create') {
      created = { ...structuredClone(original), batch_id: 'batch-E', version: 40, revision: 1, state: 'DRAFT', items: [], sources: [], source_system: 'manual' }
      return created
    }
    if (action === 'files') {
      const failure = new Error('PDF 校验繁忙，请稍后重试。')
      failure.status = 503
      failure.code = 'IMPORT_SOURCE_BUSY'
      failure.details = { reason_code: 'IMPORT_SOURCE_BUSY' }
      throw failure
    }
    return structuredClone(created || original)
  })
  panel.state.batch.value = null
  panel.state.batchID.value = ''
  panel.state.formRows.value = [normalRow({ fileName: 'GTSR-261122.pdf' })]
  panel.state.files.value = [new File(['PDF fixture'], 'GTSR-261122.pdf', { type: 'application/pdf' })]
  await panel.state.preview()
  assert.match(panel.state.error.value, /PDF 校验繁忙/)
  assert.match(panel.state.error.value, /稍后直接重新预检/)
  assert.match(panel.state.error.value, /已填数据无需修改/)
  assert.match(panel.state.error.value, /IMPORT_SOURCE_BUSY/)
  assert.doesNotMatch(panel.state.error.value, /请检查必填项|重新填写|刷新页面/)
})

test('原件未就绪时不发任何请求，直接给出可定位的中文错误', async () => {
  const panel = importPanelHarness('NORMAL')
  panel.state.batch.value = null
  panel.state.batchID.value = ''
  panel.state.jsonAuthoritative.value = true
  panel.state.text.value = JSON.stringify({ schema_version: 1, source_system: 'manual', items: [{ mode: 'NORMAL', item_key: 'one', external_record_id: 'HT-2024-001' }] })
  // 普通对象 stub：没有字符串 name，不能被塞进 FormData 变成 "undefined"。
  panel.state.files.value = [{ size: 64 }]
  await panel.state.preview()
  assert.equal(panel.calls.length, 0, '原件未就绪不得建批次、上传或提交清单')
  assert.match(panel.state.error.value, /原件未就绪/)
  assert.match(panel.state.error.value, /请重新选择原件后再预检/)
  assert.match(panel.state.error.value, /one/)
  assert.doesNotMatch(panel.state.error.value, /undefined/)
})

test('查询已保存普通批次会反填表单行，预检问题保持可见', async () => {
  const panel = importPanelHarness('NORMAL', () => JSON.parse(JSON.stringify(panel.state.batch.value)))
  panel.state.batch.value = structuredClone(panel.batch)
  panel.state.batch.value.items[0].issues = [{ field_path: 'metadata.title', code: 'REQUIRED', retryable: true }]
  panel.state.formRows.value = []
  await panel.state.refresh('batch-A')
  assert.equal(panel.state.formRows.value.length, 1)
  assert.equal(panel.state.formRows.value[0].key, 'one')
  assert.equal(panel.state.formRows.value[0].externalRecordId, 'old-1', '反填须保留已保存批次的来源业务键')
  assert.equal(panel.state.formRows.value[0].batchIssues[0].code, 'REQUIRED')
  assert.match(await panel.html(), /合同标题：必填项缺失/)
})

function excelWorkbook(rows, extra = {}) {
  const mainHeaders = [...contractExcelTemplateHeaders.main]
  const mainRows = rows.map((values) => mainHeaders.map((header) => values[header] ?? ''))
  return [
    { sheet: '合同明细', data: [mainHeaders, ...mainRows] },
    { sheet: '服务项', data: [[...contractExcelTemplateHeaders.services], ...(extra.services || [])] },
    { sheet: '系统信息', data: [[...contractExcelTemplateHeaders.systems], ...(extra.systems || [])] },
    { sheet: '付款条款', data: [[...contractExcelTemplateHeaders.payments], ...(extra.payments || [])] },
  ]
}

function excelMainRow(overrides = {}) {
  return {
    合同编号: 'HT-2026001',
    合同标题: 'Excel合同',
    合同类型: '直签',
    服务类型: '软件测试',
    CRM客户编号: '42',
    客户名称: 'Excel客户',
    '金额（元）': '10000',
    币种: 'CNY',
    开始日期: '2024-01-01',
    结束日期: '2024-12-31',
    实施场所: '上海',
    实施批次: '第一批次',
    检测类别: '等保测评',
    检测方式: '常规检测',
    ...overrides,
  }
}

test('Excel 批量导入按合同编号匹配 PDF 并写入编辑详情', async () => {
  const sheets = excelWorkbook([excelMainRow()])
  const panel = importPanelHarness('NORMAL', null, undefined, undefined, async () => sheets)
  const pdf = new File(['%PDF'], 'HT-2026001.pdf', { type: 'application/pdf' })
  panel.state.selectFiles({ target: { files: [pdf], value: '' } })
  const xlsx = new File(['xlsx'], '合同导入.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  await panel.state.selectExcelFile({ target: { files: [xlsx], value: '' } })
  assert.equal(panel.state.formRows.value.length, 1)
  const row = panel.state.formRows.value[0]
  assert.equal(row.fileName, 'HT-2026001.pdf')
  assert.equal(row.externalRecordId, 'HT-2026001')
  assert.equal(row.title, 'Excel合同')
  assert.equal(row.customerName, 'Excel客户')
  assert.equal(row.crmCustomerId, '42')
  assert.equal(row.amount, '10000')
  assert.equal(row.serviceItems[0].site, '上海')
  assert.equal(panel.state.excelStructuralIssues.value.length, 0)
  assert.equal(panel.state.canPreviewAction.value, true)
  const html = await panel.html()
  assert.match(html, /已按 Excel 写入 1 行合同详情/)
  assert.match(html, /Excel 合同 1 份/)
  assert.match(html, /contract-import-template\.xlsx/)
})

test('Excel 缺 PDF 或多出 PDF 时阻断预检并给出合同编号定位', async () => {
  const sheets = excelWorkbook([
    excelMainRow({ 合同编号: 'HT-1' }),
    excelMainRow({ 合同编号: 'HT-2', 合同标题: '第二份' }),
  ])
  const panel = importPanelHarness('NORMAL', null, undefined, undefined, async () => sheets)
  panel.state.selectFiles({ target: { files: [new File(['%PDF'], 'HT-1.pdf', { type: 'application/pdf' })], value: '' } })
  const xlsx = new File(['xlsx'], '合同导入.xlsx')
  await panel.state.selectExcelFile({ target: { files: [xlsx], value: '' } })
  assert.equal(panel.state.formRows.value.length, 1, '匹配成功的合同仍写入当前详情，便于核对')
  assert.ok(panel.state.excelStructuralIssues.value.some((issue) => issue.code === 'PDF_MISSING_FOR_ROW'))
  assert.equal(panel.state.canPreviewAction.value, false)
  const html = await panel.html()
  assert.match(html, /合同编号「HT-2」没有找到同名 PDF 原件/)
})

test('Excel 只有客户名称时按 CRM 唯一精确匹配写入客户编号', async () => {
  const sheets = excelWorkbook([excelMainRow({ CRM客户编号: '', 客户名称: '唯一客户' })])
  const panel = importPanelHarness('NORMAL', null, undefined, undefined, async () => sheets,
    async () => ({ items: [{ id: 7, name: '唯一客户' }], page: 1, page_size: 100, total: 1, has_more: false }))
  panel.state.selectFiles({ target: { files: [new File(['%PDF'], 'HT-2026001.pdf')], value: '' } })
  await panel.state.selectExcelFile({ target: { files: [new File(['xlsx'], '合同导入.xlsx')], value: '' } })
  assert.equal(panel.state.formRows.value[0].crmCustomerId, '7')
  assert.equal(panel.state.formRows.value[0].customerName, '唯一客户')
  assert.equal(panel.state.excelStructuralIssues.value.length, 0)
})

test('已有创建完成的合同时 Excel 不能覆盖详情', async () => {
  const panel = importPanelHarness('NORMAL')
  panel.state.batch.value = { batch_id: 'batch-A', version: 11, revision: 1, sources: [], items: [{ id: 'item-A', contract_id: 'contract-A' }] }
  panel.state.excelFile.value = new File(['xlsx'], '合同导入.xlsx')
  await panel.state.applyExcelImport()
  assert.match(panel.state.excelMessage.value, /已有创建完成的合同/)
  assert.deepEqual(panel.state.excelIssues.value, [])
})

test('Excel 重复合同编号即使只有一份 PDF 也阻断预检', async () => {
  const sheets = excelWorkbook([
    excelMainRow({ 合同编号: 'HT-DUP', 合同标题: '第一行' }),
    excelMainRow({ 合同编号: 'HT-DUP', 合同标题: '第二行' }),
  ])
  const panel = importPanelHarness('NORMAL', null, undefined, undefined, async () => sheets)
  panel.state.selectFiles({ target: { files: [new File(['%PDF'], 'HT-DUP.pdf')], value: '' } })
  await panel.state.selectExcelFile({ target: { files: [new File(['xlsx'], '合同导入.xlsx')], value: '' } })
  assert.ok(panel.state.excelIssues.value.some((issue) => issue.code === 'CONTRACT_NUMBER_DUPLICATE'))
  assert.ok(panel.state.excelStructuralIssues.value.some((issue) => issue.code === 'CONTRACT_NUMBER_DUPLICATE'))
  assert.equal(panel.state.canPreviewAction.value, false)
})

test('Excel 空合同编号行会阻断预检，不会静默只导入其余合同', async () => {
  const sheets = excelWorkbook([
    excelMainRow({ 合同编号: 'HT-OK' }),
    excelMainRow({ 合同编号: '', 合同标题: '缺编号行' }),
  ])
  const panel = importPanelHarness('NORMAL', null, undefined, undefined, async () => sheets)
  panel.state.selectFiles({ target: { files: [new File(['%PDF'], 'HT-OK.pdf')], value: '' } })
  await panel.state.selectExcelFile({ target: { files: [new File(['xlsx'], '合同导入.xlsx')], value: '' } })
  assert.ok(panel.state.excelIssues.value.some((issue) => issue.code === 'CONTRACT_NUMBER_REQUIRED' && issue.scope === 'match'))
  assert.equal(panel.state.canPreviewAction.value, false)
})

test('切换手动模式会作废在途 Excel 响应，不覆盖手工行', async () => {
  let resolveReader
  const reader = () => new Promise((resolve) => { resolveReader = resolve })
  const panel = importPanelHarness('NORMAL', null, undefined, undefined, reader)
  panel.state.selectFiles({ target: { files: [new File(['%PDF'], 'HT-A.pdf'), new File(['%PDF'], 'HT-B.pdf')], value: '' } })
  const pending = panel.state.selectExcelFile({ target: { files: [new File(['xlsx'], '合同导入.xlsx')], value: '' } })
  for (let attempt = 0; attempt < 20 && !resolveReader; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(typeof resolveReader, 'function')
  panel.state.selectNormalEntryMode('manual')
  assert.equal(panel.state.formRows.value.length, 2)
  panel.state.formRows.value[0].title = '手工标题'
  resolveReader(excelWorkbook([excelMainRow({ 合同编号: 'HT-A' })]))
  await pending
  assert.equal(panel.state.normalEntryMode.value, 'manual')
  assert.equal(panel.state.formRows.value.length, 2, '迟到 Excel 结果不能替换手动行')
  assert.equal(panel.state.formRows.value[0].title, '手工标题')
})

test('Excel 应用后再增删原件只标记待重新应用，不静默覆盖已编辑详情', async () => {
  const sheets = excelWorkbook([excelMainRow({ 合同编号: 'HT-A' })])
  const panel = importPanelHarness('NORMAL', null, undefined, undefined, async () => sheets)
  panel.state.selectFiles({ target: { files: [new File(['%PDF'], 'HT-A.pdf')], value: '' } })
  await panel.state.selectExcelFile({ target: { files: [new File(['xlsx'], '合同导入.xlsx')], value: '' } })
  panel.state.formRows.value[0].title = '手工修改标题'
  panel.state.selectFiles({ target: { files: [new File(['%PDF'], 'HT-B.pdf')], value: '' } })
  assert.equal(panel.state.excelStale.value, true)
  assert.equal(panel.state.canPreviewAction.value, false)
  assert.match(panel.state.excelMessage.value, /重新应用 Excel/)
  assert.equal(panel.state.formRows.value[0].title, '手工修改标题')
})

test('CRM 名称候选超过一页时失败关闭并要求填写客户编号', async () => {
  const sheets = excelWorkbook([excelMainRow({ CRM客户编号: '', 客户名称: '模糊客户' })])
  const panel = importPanelHarness('NORMAL', null, undefined, undefined, async () => sheets,
    async () => ({ items: [], page: 1, page_size: 100, total: 500, has_more: true }))
  panel.state.selectFiles({ target: { files: [new File(['%PDF'], 'HT-2026001.pdf')], value: '' } })
  await panel.state.selectExcelFile({ target: { files: [new File(['xlsx'], '合同导入.xlsx')], value: '' } })
  assert.equal(panel.state.formRows.value[0].crmCustomerId, '')
  const issue = panel.state.excelIssues.value.find((item) => item.code === 'CRM_CUSTOMER_LOOKUP_UNAVAILABLE')
  assert.ok(issue)
  assert.match(issue.message, /相似候选/)
})

test('Excel 直填的检测类别不在目录时提前发现问题并由预检阻断', async () => {
  const sheets = excelWorkbook([excelMainRow({ 检测类别: '未知类别' })])
  const panel = importPanelHarness('NORMAL', null, undefined, undefined, async () => sheets)
  panel.state.selectFiles({ target: { files: [new File(['%PDF'], 'HT-2026001.pdf')], value: '' } })
  await panel.state.selectExcelFile({ target: { files: [new File(['xlsx'], '合同导入.xlsx')], value: '' } })
  assert.ok(panel.state.formRows.value[0].issues.some((issue) => issue.field === 'serviceItems.0.category' && issue.code === 'UNSUPPORTED_ENUM'))
  assert.ok(panel.state.detectionCategoryOptions.value.length > 0, '检测类别目录应已加载')
  assert.equal(panel.state.applyExcelDirectoryIssues(panel.state.formRows.value), 1)
  await panel.state.preview()
  assert.match(panel.state.error.value, /检测类别|服务类型/)
  assert.equal(panel.calls.filter(([action]) => ['create', 'files', 'manifest', 'preview'].includes(action)).length, 0, '目录字段问题不得先发写请求')
})

test('预检问题与批次错误提供下载错误报告入口，无问题时按钮禁用', async () => {
  const panel = importPanelHarness('NORMAL')
  assert.equal(panel.state.importErrorReportRows.value.length, 0)
  const disabledHtml = await panel.html()
  assert.match(disabledHtml, /下载错误报告 CSV/)
  assert.match(disabledHtml, /disabled[^>]*>下载错误报告 CSV/)

  panel.state.batch.value.items[0].issues = [{ field_path: 'metadata.title', code: 'REQUIRED', retryable: true }]
  assert.equal(panel.state.importErrorReportRows.value.length, 1)
  const enabledHtml = await panel.html()
  assert.doesNotMatch(enabledHtml, /disabled[^>]*>下载错误报告 CSV/)

  panel.state.error.value = '批次查询失败，请保留批次号'
  assert.equal(panel.state.importErrorReportRows.value.length, 2)
})

