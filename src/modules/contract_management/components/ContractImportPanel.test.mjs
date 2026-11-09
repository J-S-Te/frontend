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
import { historicalExcelModes, historyImportDetails, readHistoryExcelRecords } from '../utils/contractHistoryExcel.js'
import { paymentAmountMinor } from '../utils/paymentTerms.js'
import { contractImportErrorRows, contractImportErrorsCsv, contractImportProvisionIssueLabels } from '../utils/contractImportErrors.js'
import { fallbackServiceTypeOptions } from '../utils/contractDisplay.js'
import { externalContractTypes, contractSystemLevels } from '../utils/contractPayload.js'
import { importRowSourceForm, applyImportRowSourceForm } from '../utils/localImportSourceBridge.js'

// importPanelHarness 编译实际导入面板并替换受控外部接口以验证模式及未知结果。
// 参数：mode为测试模式，request/listResponse替代外部接口，crmLogin替代正常登录窗口，
//   autoApproveApi可替换自动审批的读取/保存实现。
// 返回值：实际setup状态、组件渲染器和请求记录；不冒充真实服务验收。
function importPanelHarness(mode, request, listResponse = () => ({items:[],has_more:false,next_offset:null}), crmLogin = () => true,
  excelReader = async () => { throw new Error('Excel reader not configured') },
  customerResponse = async () => ({items:[],page:1,page_size:20,total:0,has_more:false}),
  sourceCapabilities = {}, autoApproveApi = {}) {
  const calls = [], delays = [], listCalls = [], timers = [], directoryCalls = [], mounted = []
  const autoApproveGets = [], autoApprovePuts = [], copyCalls = []
  const defaultAutoApprove = {capability_enabled:true,enabled:false,version:3,updated_by:'合同超级管理员',updated_at:'2026-11-06T02:30:00Z'}
  const props = Vue.reactive({enabled:true,pdfEnabled:true,canPreview:true,canCommit:true,canApprove:true,canRelease:true,canManageAutoApprove:false,actorId:'actor',initialBatchId:'',supportedModes:['NORMAL','ARCHIVE_ONLY'],sourceCapabilities})
  const batch = {batch_id:'batch-A',version:11,revision:1,preview_token:'preview',state:'PREVIEWED',can_commit:true,source_system:'legacy',sources:[],items:[{id:'item-A',item:{mode,item_key:'one',external_record_id:'old-1',source_file_ref:'file-ref',metadata:{customer_name:'历史客户'},policy_options:{project_mode:'NONE',finance_mode:'NONE',report_mode:'ARCHIVE_SEPARATE'}},state:'READY',issues:[]}]}
  const deps = {computed:Vue.computed,ref:Vue.ref,watch:Vue.watch,nextTick:Vue.nextTick,onMounted(callback){mounted.push(callback)},onBeforeUnmount(){},setTimeout(callback,delay){delays.push(delay);timers.push(callback);return 0},clearTimeout(){},ContractPDFPreview:{render(){return null}},
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
    contractImportErrorRows,contractImportErrorsCsv,contractImportProvisionIssueLabels,
    historicalExcelModes,historyImportDetails,readHistoryExcelRecords,listLocalCatalogGrantTargets:async()=>[],
    useDictionaryOptions:()=>({options:Vue.ref(fallbackServiceTypeOptions),loading:Vue.ref(false)}),
    listMyCustomers:customerResponse,
    ensureContractCRMDirectorySession:async()=>{},
    getImportAutoApproveSetting:async()=>{autoApproveGets.push(true);return autoApproveApi.get?autoApproveApi.get():structuredClone(defaultAutoApprove)},
    setImportAutoApproveSetting:async(payload)=>{autoApprovePuts.push(structuredClone(payload));
      if(autoApproveApi.put)return autoApproveApi.put(payload)
      return {...structuredClone(defaultAutoApprove),enabled:payload.enabled,version:payload.expectedVersion+1}},
    formatBusinessDateTime:(value)=>value?String(value).replace('T',' ').replace(/\.\d+Z$/,'').replace(/Z$/,''):'',
    copyTextToClipboard:async(value)=>{copyCalls.push(String(value));return true},
    listContractDetectionCategories:async()=>{directoryCalls.push('project');return [{category:'等保测评'},{category:'软件测试'}]}}
  const {descriptor}=parse(readFileSync(new URL('./ContractImportPanel.vue',import.meta.url),'utf8'))
  const script=compileScript(descriptor,{id:'import-panel-test'})
  const component=new Function(...Object.keys(deps),script.content.replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm,'').replace('export default','return'))(...Object.values(deps))
  const template=compileTemplate({source:descriptor.template.content,filename:'ContractImportPanel.vue',id:'import-panel-test',compilerOptions:{bindingMetadata:script.bindings}})
  assert.deepEqual(template.errors,[])
  const render=new Function('Vue',template.code.replace(/import \{([^}]+)\} from "vue"/g,(_,names)=>`const { ${names.replace(/ as /g,': ')} } = Vue`).replace('export function render','return function render'))(Vue)
  const state=component.setup(props,{expose(){}})
  state.entryMode.value=mode;if(mode==='NORMAL' && (sourceCapabilities.counterparty_source==='local' || sourceCapabilities.category_source==='local'))state.normalEntryMode.value='manual';state.jsonAuthoritative.value=mode!=='NORMAL';state.batch.value=structuredClone(batch);state.batchID.value=batch.batch_id;state.lookupID.value=batch.batch_id
  return {state,props,batch,calls,delays,listCalls,timers,directoryCalls,mounted,autoApproveGets,autoApprovePuts,copyCalls,html:()=>renderToString(Vue.createSSRApp({render:()=>render({},[],props,Vue.proxyRefs(state),{}, {})}))}
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

test('历史负责人目录在外部来源下按独立能力展示，不改变已选负责人', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY', undefined, undefined, undefined, undefined,
    undefined, { counterparty_source: 'crm', category_source: 'project',
      local_catalog_manage: false, history_owner_directory: true })
  useNewHistory(panel)
  panel.state.historyOptions.value.targetOwnerUserID = 'saved-owner'
  assert.match(await panel.html(), /读取其他可选负责人/)
  assert.equal(panel.state.historyOptions.value.targetOwnerUserID, 'saved-owner')
})

test('历史负责人目录显式无权限时隐藏，旧API缺字段时回退原能力', async () => {
  for (const [capabilities, visible] of [
    [{ local_catalog_manage: true, history_owner_directory: false }, false],
    [{ local_catalog_manage: true }, true],
    [{ local_catalog_manage: false }, false],
    [{}, false],
  ]) {
    const panel = importPanelHarness('ARCHIVE_ONLY', undefined, undefined, undefined, undefined,
      undefined, capabilities)
    useNewHistory(panel)
    const html = await panel.html()
    assert.equal(html.includes('读取其他可选负责人'), visible)
    assert.equal(panel.state.historyOptions.value.targetOwnerUserID, 'actor')
  }
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

test('服务端每批三份时页面显示真实上限，四行在任何写请求前阻断并保留表单', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY', undefined, undefined, undefined, undefined,
    undefined, { max_batch_items: 3 })
  useNewHistory(panel)
  panel.state.batch.value = null
  panel.state.batchID.value = ''
  panel.state.formRows.value = Array.from({ length: 4 }, (_, index) => normalRow({
    key: `limit-${index}`, externalRecordId: `OLD-${index}`, fileName: `limit-${index}.pdf`,
  }))
  panel.state.files.value = panel.state.formRows.value.map(row => new File(['pdf'], row.fileName))
  await panel.state.preview()
  assert.equal(panel.calls.length, 0)
  assert.equal(panel.state.formRows.value.length, 4)
  assert.equal(panel.state.files.value.length, 4)
  assert.match(panel.state.error.value, /每批最多 3 份/)
  assert.match(await panel.html(), /≤3 份/)
})

test('权威JSON三项不受旧表单四行阻断，既有暂存引用继续使用', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY', undefined, undefined, undefined, undefined,
    undefined, { max_batch_items: 3 })
  const sample = structuredClone(panel.batch.items[0].item)
  sample.history_evidence = { historical_status: 'archived', target_owner_user_id: 'actor',
    report_required_channels: 'API_ONLY' }
  const items = Array.from({ length: 3 }, (_, index) => ({ ...structuredClone(sample),
    item_key: `json-${index}`, external_record_id: `JSON-${index}`, source_file_ref: `ref-${index}`,
  }))
  panel.state.batch.value.sources = items.map(item => ({ item_key: item.item_key,
    file_ref: item.source_file_ref, filename: `${item.item_key}.pdf`, state: 'READY' }))
  panel.state.formRows.value = Array.from({ length: 4 }, () => normalRow())
  panel.state.jsonAuthoritative.value = true
  panel.state.text.value = JSON.stringify({ schema_version: 1, source_system: 'legacy', items })
  await panel.state.preview()
  const saved = panel.calls.find(([action]) => action === 'manifest')
  assert.ok(saved, panel.state.error.value)
  assert.equal(saved?.[2].manifest.items.length, 3)
  assert.deepEqual(saved[2].manifest.items.map(item => item.source_file_ref), ['ref-0', 'ref-1', 'ref-2'])
  assert.equal(panel.calls.filter(([action]) => action === 'files').length, 0)
})

test('实际文件选择使用服务端三份上限，超限重试保留已选文件及既有批次', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY', undefined, undefined, undefined, undefined,
    undefined, { max_batch_items: 3 })
  const picked = Array.from({ length: 4 }, (_, index) => new File(['pdf'], `limit-${index}.pdf`))
  panel.state.selectFiles({ target: { files: picked, value: 'picked' } })
  assert.deepEqual(panel.state.files.value.map(file => file.name), ['limit-0.pdf', 'limit-1.pdf', 'limit-2.pdf'])
  assert.match(panel.state.fileMessage.value, /每批最多 3 份/)
  panel.state.formRows.value = Array.from({ length: 4 }, (_, index) => normalRow({ key: `limit-${index}` }))
  panel.state.batch.value.sources = [{ file_ref: 'keep-ref', item_key: 'limit-0', state: 'READY' }]
  panel.state.jsonAuthoritative.value = false
  await panel.state.preview()
  assert.equal(panel.calls.length, 0)
  assert.equal(panel.state.formRows.value.length, 4)
  assert.equal(panel.state.files.value.length, 3)
  assert.equal(panel.state.batch.value.sources[0].file_ref, 'keep-ref')
})

test('入口与JSON的普通/历史类别不符时在上传及保存清单前阻断，并保留输入', async () => {
  for (const [existingBatch, selectedMode, manifestMode] of [
    [false, 'ARCHIVE_ONLY', 'NORMAL'], [false, 'NORMAL', 'ARCHIVE_ONLY'],
    [true, 'ARCHIVE_ONLY', 'NORMAL'], [true, 'NORMAL', 'ARCHIVE_ONLY'],
  ]) {
    const panel = importPanelHarness(selectedMode)
    if (!existingBatch) {
      panel.state.batch.value = null
      panel.state.batchID.value = ''
    }
    panel.state.entryMode.value = selectedMode
    panel.state.jsonAuthoritative.value = true
    const text = JSON.stringify({ schema_version: 1, source_system: 'legacy', items: [{
      item_key: 'one', external_record_id: 'old-1', mode: manifestMode, source_file_ref: 'old.pdf',
      metadata: { customer_name: '待建历史客户' }, history_evidence: {}, policy_options: {},
    }] })
    panel.state.text.value = text
    const file = new File(['PDF fixture'], 'old.pdf', { type: 'application/pdf' })
    panel.state.files.value = [file]
    await panel.state.preview()
    assert.match(panel.state.error.value, !existingBatch && selectedMode === 'NORMAL' ? /批量导入仅用于历史/ : /导入方式.*不一致/)
    assert.equal(panel.calls.length, 0, '不应上传、创建批次或保存错模式清单')
    assert.equal(panel.state.text.value, text)
    assert.equal(panel.state.files.value[0], file)
  }
})

test('历史JSON待建客户不带CRM编号也能预检，不依赖普通Excel的CRM浏览器会话', async () => {
  let customerReads = 0
  const panel = importPanelHarness('ARCHIVE_ONLY', undefined, undefined, undefined, undefined,
    async () => { customerReads++; throw Object.assign(new Error('CRM session missing'), { status: 401 }) })
  panel.state.entryMode.value = 'ARCHIVE_ONLY'
  panel.state.batch.value.sources = [{ item_key: 'one', filename: 'old.pdf', file_ref: 'file-ref', state: 'READY' }]
  panel.state.excelIssues.value = [{ code: 'CRM_CUSTOMER_NOT_FOUND', blocking: true }]
  panel.state.text.value = JSON.stringify({ schema_version: 1, source_system: 'legacy', items: [{
    item_key: 'one', external_record_id: 'old-1', mode: 'ARCHIVE_ONLY', source_file_ref: 'old.pdf',
    metadata: { customer_name: '待建历史客户', crm_customer_id: 0, sales_name: '测试销售' },
    history_evidence: {}, policy_options: { finance_mode: 'NONE' },
  }] })
  await panel.state.preview()
  const manifest = panel.calls.find(call => call[0] === 'manifest')?.[2].manifest
  assert.ok(manifest)
  assert.equal(manifest.items[0].mode, 'ARCHIVE_ONLY')
  assert.equal(manifest.items[0].metadata.crm_customer_id, 0)
  assert.equal(manifest.items[0].source_file_ref, 'file-ref')
  assert.equal(panel.state.error.value, '')
  assert.equal(customerReads, 0)
  assert.equal(panel.directoryCalls.length, 0)
  assert.ok(panel.calls.some(call => call[0] === 'preview'))
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
  panel.state.batch.value=null;panel.state.batchID.value='';useNewHistory(panel)
  panel.state.jsonAuthoritative.value=true
  panel.state.text.value=JSON.stringify({schema_version:1,source_system:'legacy',items:[{item_key:'one',external_record_id:'old-1',mode:'ARCHIVE_ONLY',source_file_ref:'one.pdf',metadata:{},history_evidence:{},policy_options:{finance_mode:'NONE'}}]})
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

// useNewHistory 将上传及重试测试切到受支持的新历史批次，保留原文件和断言目标。
// 参数：panel为真实组件测试实例。
// 返回值：无；只提供显式历史信息，不替代组件转换实现。
function useNewHistory(panel) {
  panel.state.entryMode.value = 'ARCHIVE_ONLY'
  panel.state.jsonAuthoritative.value = false
  panel.state.sourceSystem.value = 'manual'
  panel.state.historyOptions.value = { targetOwnerUserID: 'actor', historicalStatus: 'archived', reportChannels: 'API_ONLY' }
}

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

test('历史模式默认Excel并保留高级清单兼容入口', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY')
  panel.state.entryMode.value = 'ARCHIVE_ONLY'
  const html = await panel.html()
  assert.match(html, /id="contract-import-excel"/)
  assert.match(html, /id="contract-import-history"/)
  assert.match(html, /高级：查看\/编辑清单/)
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
  useNewHistory(panel)
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
  useNewHistory(panel)
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
  useNewHistory(panel)
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
  useNewHistory(panel)
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
  useNewHistory(panel)
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
  useNewHistory(panel)
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
  useNewHistory(panel)
  panel.state.jsonAuthoritative.value = true
  panel.state.text.value = JSON.stringify({ schema_version: 1, source_system: 'manual', items: [{ mode: 'ARCHIVE_ONLY', item_key: 'one', external_record_id: 'HT-2024-001', history_evidence: {}, policy_options: {finance_mode:'NONE'} }] })
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

test('错误报告使用浏览器文档下载CSV并保留原件预览状态', async (t) => {
  const panel = importPanelHarness('ARCHIVE_ONLY')
  panel.state.batch.value.items[0].issues = [{ field_path: 'metadata.title', code: 'REQUIRED' }]
  const preview = { file_id: 'preview-source' }
  panel.state.document.value = preview
  const links = []
  let clicked = false, removed = false, csvBlob
  const link = { click() { clicked = true }, remove() { removed = true } }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(tag) { assert.equal(tag, 'a'); return link },
    body: { appendChild(value) { links.push(value) } },
  } })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else delete globalThis.document
  })
  t.mock.method(URL, 'createObjectURL', (blob) => { csvBlob = blob; return 'blob:error-report' })
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {})

  panel.state.downloadImportErrorReport()

  assert.equal(panel.state.error.value, '')
  assert.equal(panel.state.document.value.file_id, preview.file_id)
  assert.deepEqual(links, [link])
  assert.equal(link.download, '合同导入错误.csv')
  assert.equal(link.href, 'blob:error-report')
  assert.ok(clicked && removed)
  assert.match(await csvBlob.text(), /metadata.title|合同标题/)
  assert.equal(revoke.mock.calls[0].arguments[0], 'blob:error-report')
})


test('预览返回 provision_plan 时展示将自动创建客户、销售解析与商机摘要，缺失时界面不变', async () => {
  const panel = importPanelHarness('NORMAL')
  const plain = await panel.html()
  assert.doesNotMatch(plain, /将自动创建客户/)
  assert.doesNotMatch(plain, /CRM 开立计划/)

  panel.state.batch.value.provision_plan = [
    { contract_number: 'HT-1', customer_name: '新客户', customer_state: 'TO_CREATE', sales_name: '张销售', sales_state: 'RESOLVED', opportunity_amount: '10000.00', opportunity_sign_date: '2024-01-01' },
    { customer_name: '重名客户', customer_state: 'AMBIGUOUS', sales_name: '李销售', sales_state: 'UNRESOLVED' },
    { external_record_id: 'HT-3', customer_name: '老客户', customer_state: 'EXISTS', sales_name: '', sales_state: 'AMBIGUOUS', opportunity_amount: '88.00', opportunity_sign_date: '2023-05-06' },
  ]
  const html = await panel.html()
  assert.match(html, /CRM 开立计划（共 3 项）/)
  assert.match(html, /将自动创建客户 1 项/)
  assert.match(html, /客户已存在 1 项/)
  assert.match(html, /客户重名需人工确认 1 项/)
  assert.match(html, /销售已解析 1 项/)
  assert.match(html, /销售未命中 1 项/)
  assert.match(html, /销售重名需人工确认 1 项/)
  assert.match(html, /将自动创建客户/)
  assert.match(html, /商机：金额 10000\.00，签约日 2024-01-01/)
  assert.match(html, /商机：未生成/)
  // 未返回合同标识的逐项以序号定位，不伪造业务编号。
  assert.match(html, /第 2 项/)
  // 既有阻断与文案不变：批次状态与错误报告入口仍在。
  assert.match(html, /批次 batch-A/)
  assert.doesNotMatch(html, /undefined/)
})

test('provision 错误码在页面与错误报告中显示中文原因', async () => {
  const panel = importPanelHarness('NORMAL')
  panel.state.batch.value.items[0].issues = [{ field_path: 'metadata.sales_name', code: 'IMPORT_PROVISION_OWNER_UNRESOLVED', retryable: false }]
  const rows = panel.state.importErrorReportRows.value
  assert.equal(rows.length, 1)
  assert.equal(rows[0][2], '销售姓名')
  assert.equal(rows[0][5], contractImportProvisionIssueLabels.IMPORT_PROVISION_OWNER_UNRESOLVED)
  const html = await panel.html()
  assert.match(html, /销售姓名：Excel「销售姓名」未能在平台人员目录中唯一匹配/)
})

// ── 历史导入自动审批（合同超级管理员开关） ───────────────────────────────

const flushAutoApprove = () => new Promise((resolve) => setImmediate(resolve))

test('历史导入自动审批开关只对合同超级管理员渲染，非 admin 不读接口', async () => {
  const panel = importPanelHarness('NORMAL')
  const html = await panel.html()
  assert.doesNotMatch(html, /历史导入自动审批开关/)
  assert.doesNotMatch(html, /contract-import-auto-approve/)
  assert.doesNotMatch(html, /role="switch"/)
  panel.mounted.forEach((callback) => callback())
  await flushAutoApprove()
  assert.equal(panel.autoApproveGets.length, 0, '非 admin 不得读取自动审批设置')
  panel.state.requestAutoApproveToggle()
  assert.equal(panel.state.autoApproveConfirm.value, '')
  assert.equal(panel.autoApprovePuts.length, 0)
})

test('服务端能力未开启时开关禁用并说明部署配置，不可切换', async () => {
  const panel = importPanelHarness('NORMAL', undefined, undefined, undefined, undefined, undefined, {},
    { get: async () => ({ capability_enabled: false, enabled: false, version: 1, updated_by: '', updated_at: null }) })
  panel.props.canManageAutoApprove = true
  await panel.state.loadAutoApprove()
  const html = await panel.html()
  assert.match(html, /历史导入自动审批/)
  assert.match(html, /能力未开启/)
  assert.match(html, /CONTRACT_IMPORT_AUTO_APPROVE_HISTORICAL=true/)
  assert.match(html, /请联系平台运维/)
  assert.match(html, /role="switch"[^>]*disabled|disabled[^>]*role="switch"/)
  panel.state.requestAutoApproveToggle()
  assert.equal(panel.state.autoApproveConfirm.value, '', '能力未开启不得进入确认')
  assert.equal(panel.autoApprovePuts.length, 0)
})

test('开启历史导入自动审批需先确认，PUT 携带读取到的 expected_version，成功后显示已开启', async () => {
  const panel = importPanelHarness('NORMAL', undefined, undefined, undefined, undefined, undefined, {},
    { get: async () => ({ capability_enabled: true, enabled: false, version: 7, updated_by: '合同超级管理员', updated_at: '2026-11-06T02:30:00Z' }),
      put: async (payload) => ({ capability_enabled: true, enabled: payload.enabled, version: payload.expectedVersion + 1, updated_by: '当前管理员', updated_at: '2026-11-06T03:00:00Z' }) })
  panel.props.canManageAutoApprove = true
  panel.mounted.forEach((callback) => callback())
  await flushAutoApprove()
  assert.equal(panel.autoApproveGets.length, 1, '面板初始化读取一次')
  panel.mounted.forEach((callback) => callback())
  await flushAutoApprove()
  assert.equal(panel.autoApproveGets.length, 1, '已有结果时不重复读取')

  const settled = await panel.html()
  assert.match(settled, /历史导入自动审批/)
  assert.match(settled, /role="switch"/)
  assert.match(settled, /已关闭/)
  assert.match(settled, /最近更新：合同超级管理员/)

  panel.state.requestAutoApproveToggle()
  assert.equal(panel.autoApprovePuts.length, 0, '确认前不得写服务端')
  const confirming = await panel.html()
  assert.match(confirming, /跳过人工会签/)
  assert.match(confirming, /仅超级管理员可操作/)
  assert.match(confirming, /确认开启/)

  await panel.state.applyAutoApproveToggle()
  assert.deepEqual(panel.autoApprovePuts, [{ enabled: true, expectedVersion: 7 }])
  assert.equal(panel.state.autoApproveEnabled.value, true)
  assert.equal(panel.state.autoApproveConfirm.value, '')
  const done = await panel.html()
  assert.match(done, /已开启/)
  assert.doesNotMatch(done, /确认开启/)
  assert.doesNotMatch(done, /立即生效/)
})

test('版本冲突提示刷新后重试并重新读取，错误码可复制', async () => {
  const conflict = new Error('设置已被其他管理员更新')
  conflict.status = 409
  conflict.code = 'IMPORT_REVISION_CONFLICT'
  const panel = importPanelHarness('NORMAL', undefined, undefined, undefined, undefined, undefined, {},
    { get: async () => ({ capability_enabled: true, enabled: false, version: 4, updated_by: '合同超级管理员', updated_at: null }),
      put: async () => { throw conflict } })
  panel.props.canManageAutoApprove = true
  panel.mounted.forEach((callback) => callback())
  await flushAutoApprove()
  const getsBefore = panel.autoApproveGets.length
  panel.state.requestAutoApproveToggle()
  await panel.state.applyAutoApproveToggle()
  assert.equal(panel.autoApproveGets.length, getsBefore + 1, '冲突后重新读取最新设置')
  const html = await panel.html()
  assert.match(html, /刷新/)
  assert.match(html, /IMPORT_REVISION_CONFLICT/)
  assert.match(html, /复制错误码/)
  assert.equal(panel.state.autoApproveConfirm.value, '')
  await panel.state.copyAutoApproveErrorCode()
  assert.deepEqual(panel.copyCalls, ['IMPORT_REVISION_CONFLICT'])
  assert.match(panel.state.autoApproveCopyHint.value, /已复制/)
})

test('能力未开启的保存拒绝显示部署配置说明并保留错误码', async () => {
  const disabled = new Error('历史导入自动审批未开启')
  disabled.status = 422
  disabled.code = 'IMPORT_AUTO_APPROVE_DISABLED'
  const panel = importPanelHarness('NORMAL', undefined, undefined, undefined, undefined, undefined, {},
    { get: async () => ({ capability_enabled: true, enabled: false, version: 2, updated_by: '', updated_at: null }),
      put: async () => { throw disabled } })
  panel.props.canManageAutoApprove = true
  await panel.state.loadAutoApprove()
  panel.state.requestAutoApproveToggle()
  await panel.state.applyAutoApproveToggle()
  assert.equal(panel.autoApprovePuts.length, 1)
  const html = await panel.html()
  assert.match(html, /CONTRACT_IMPORT_AUTO_APPROVE_HISTORICAL=true/)
  assert.match(html, /IMPORT_AUTO_APPROVE_DISABLED/)
  assert.equal(panel.state.autoApproveEnabled.value, false)
})

// ── P1-4 / P2-4 / P2-5：导入面板默认展开、批次文案一致与常驻状态条 ─────────────

test('导入页或带批次号直达默认展开，合同台账页保持折叠', async () => {
  const panel = importPanelHarness('NORMAL')
  assert.equal(panel.state.panelOpen.value, false, '台账页默认折叠')
  assert.doesNotMatch(await panel.html(), /<details[^>]*\bopen\b/, '折叠态不得带 open')

  panel.props.defaultOpen = true
  await Vue.nextTick()
  assert.equal(panel.state.panelOpen.value, true, '导入页/批次号直达默认展开')
  assert.match(await panel.html(), /<details[^>]*\bopen\b/, '展开态必须带 open')

  panel.props.defaultOpen = false
  await Vue.nextTick()
  assert.equal(panel.state.panelOpen.value, false, '回到台账页重新折叠')
})

test('自动审批开启且存在历史项时，批次页脚改按声明状态自动审批归档并加已开启徽标', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY', undefined, undefined, undefined, undefined, undefined, {},
    { get: async () => ({ capability_enabled: true, enabled: true, version: 5, updated_by: '合同超级管理员', updated_at: '2026-11-06T02:30:00Z' }) })
  panel.props.canManageAutoApprove = true
  await panel.state.loadAutoApprove()
  panel.state.batch.value.state = 'PREVIEWED'
  const html = await panel.html()
  assert.match(html, /自动审批：已开启/, '批次头必须出现自动审批已开启徽标')
  assert.match(html, /将自动审批归档/, '历史项审批路径必须与开关一致')
  assert.doesNotMatch(html, /历史模式之后独立确认/, '开启时不得再暗示人工会签')
  assert.match(html, /新建合同请走正常新建流程/, '普通合同仍走正常流程')

  // 关闭后回到原有文案且移除徽标，避免关闭态仍宣称自动归档。
  await panel.state.applyAutoApproveToggle()
  panel.state.autoApprove.value.enabled = false
  panel.state.batch.value.state = 'PREVIEWED'
  const disabled = await panel.html()
  assert.doesNotMatch(disabled, /自动审批：已开启/)
  assert.match(disabled, /仍需独立确认/)
})

test('导入页顶部常驻状态条在面板折叠时仍显示最近变更人/时间，其他页签不渲染', async () => {
  const panel = importPanelHarness('NORMAL', undefined, undefined, undefined, undefined, undefined, {},
    { get: async () => ({ capability_enabled: true, enabled: true, version: 9, updated_by: '合同超级管理员', updated_at: '2026-11-06T02:30:00Z' }) })
  panel.props.canManageAutoApprove = true
  panel.props.section = 'imports'
  await panel.state.loadAutoApprove()
  const html = await panel.html()
  assert.match(html, /contract-import-statusbar/, '导入页必须渲染常驻状态条')
  assert.match(html, /历史导入自动审批/)
  assert.match(html, /最近更新：合同超级管理员/)
  assert.match(html, /历史项将按声明状态自动审批归档/)
  assert.equal(panel.state.panelOpen.value, false, '状态条与折叠面板相互独立')

  panel.props.section = 'contracts'
  const ledger = await panel.html()
  assert.doesNotMatch(ledger, /contract-import-statusbar/, '合同台账页不渲染导入状态条')
})

// ── P1：已提交批次按台账 policy_decision 展示自动审批，不用 live 开关反推 ────────
// 自动审批批次提交即 APPROVED，但台账里没有人工签署事实；确认区必须说清是按租户
// 策略自动审批，避免操作者把 APPROVED 读成“有人签过”。

function autoApprovedConfirmation(overrides = {}) {
  return { state: 'APPROVED', revision: 1, roles: ['销售总监'], approved_roles: ['销售总监'],
    commands: [], assignees: {}, ...overrides }
}

test('AUTO 批次确认区展示按租户策略自动审批及策略版本，不出现人工签署文案', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY')
  panel.state.batch.value.confirmation = autoApprovedConfirmation({ policy_decision: 'AUTO', policy_version: 3 })
  const html = await panel.html()
  assert.match(html, /按租户策略自动审批/, 'AUTO 批次必须说明是自动审批')
  assert.match(html, /策略版本 3/, '展示判定所依据的租户开关版本')
  assert.doesNotMatch(html, /确认通过/, 'APPROVED 不得渲染成人工“确认通过”')
  assert.doesNotMatch(html, /已批准/, '不得出现暗示人工签署的“已批准”')
  assert.doesNotMatch(html, /审批人/, '不得出现“审批人”占位')
  assert.doesNotMatch(html, /已确认：销售总监/, '自动审批批次不展示人工已确认角色')
})

test('AUTO 批次缺失策略版本时只展示自动审批文案', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY')
  panel.state.batch.value.confirmation = autoApprovedConfirmation({ policy_decision: 'AUTO' })
  const html = await panel.html()
  assert.match(html, /按租户策略自动审批/)
  assert.doesNotMatch(html, /策略版本/)
  assert.doesNotMatch(html, /确认通过/)
})

test('MANUAL 与旧数据缺省策略保持原有确认文案与角色展示', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY')
  panel.state.batch.value.confirmation = autoApprovedConfirmation({ policy_decision: 'MANUAL', policy_version: 3 })
  let html = await panel.html()
  assert.match(html, /当前确认：确认通过/)
  assert.match(html, /要求角色：销售总监；已确认：销售总监/)
  assert.doesNotMatch(html, /按租户策略自动审批/)

  // 引入 policy_decision 之前的旧批次：字段缺省，按原人工确认路径展示。
  delete panel.state.batch.value.confirmation.policy_decision
  delete panel.state.batch.value.confirmation.policy_version
  html = await panel.html()
  assert.match(html, /当前确认：确认通过/)
  assert.match(html, /要求角色：销售总监；已确认：销售总监/)
  assert.doesNotMatch(html, /按租户策略自动审批/)
})

test('确认状态以 batch.confirmation.policy_decision 为准，不随 live 自动审批开关变化', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY', undefined, undefined, undefined, undefined, undefined, {},
    { get: async () => ({ capability_enabled: true, enabled: true, version: 4, updated_by: '合同超级管理员', updated_at: '2026-11-06T02:30:00Z' }) })
  panel.props.canManageAutoApprove = true
  await panel.state.loadAutoApprove()
  assert.equal(panel.state.autoApproveEnabled.value, true, 'live 开关已开启')

  // live 开启，但历史批次台账是 MANUAL：仍按台账展示人工确认。
  panel.state.batch.value.confirmation = autoApprovedConfirmation({ policy_decision: 'MANUAL', policy_version: 4 })
  let html = await panel.html()
  assert.match(html, /当前确认：确认通过/)
  assert.doesNotMatch(html, /按租户策略自动审批（策略版本 4）/)

  // live 关闭，但历史批次台账是 AUTO：仍按台账展示自动审批。
  panel.state.autoApprove.value.enabled = false
  panel.state.batch.value.confirmation = autoApprovedConfirmation({ policy_decision: 'AUTO', policy_version: 2 })
  html = await panel.html()
  assert.match(html, /按租户策略自动审批（策略版本 2）/)
  assert.doesNotMatch(html, /当前确认：确认通过/)
})

test('无 confirmation 时确认区保持空态且不报错', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY')
  panel.state.batch.value.confirmation = null
  const html = await panel.html()
  assert.doesNotMatch(html, /当前确认：/)
  assert.doesNotMatch(html, /按租户策略自动审批/)
})


test('新批次只展示两种历史模式与Excel入口，历史信息可显式填写', async () => {
  const panel = importPanelHarness('NORMAL')
  panel.props.supportedModes = ['NORMAL', 'ARCHIVE_ONLY', 'CONTINUE_LIVE', 'HISTORICAL_CLOSED']
  panel.state.startNewBatch()
  assert.equal(panel.state.entryMode.value, 'ARCHIVE_ONLY')
  assert.deepEqual(panel.state.newBatchModes.value, ['ARCHIVE_ONLY', 'HISTORICAL_CLOSED'])
  const html = await panel.html()
  assert.match(html, /id="contract-import-excel"/)
  assert.match(html, /id="contract-import-history"/)
  assert.doesNotMatch(html, /name="contract-import-entry-mode"[^>]*value="NORMAL"/)
  assert.doesNotMatch(html, /name="contract-import-entry-mode"[^>]*value="CONTINUE_LIVE"/)
})

test('历史Excel两种模式从文件选择到预检完整传递，不调用浏览器CRM目录', async () => {
  for (const mode of ['ARCHIVE_ONLY', 'HISTORICAL_CLOSED']) {
    let stored, customerReads = 0
    const sheets = excelWorkbook([excelMainRow({ CRM客户编号: '', 销售姓名: '合成销售',
      客户联系人: '合成联系人', 客户联系电话: '13800000000', 当前负责人: '现任负责人' })])
    const panel = importPanelHarness(mode, (original, action, id, payload) => {
      if (action === 'create') stored = { ...structuredClone(original), batch_id: 'new-history',
        source_system: payload.source_system, state: 'DRAFT', items: [], sources: [] }
      if (action === 'files') {
        stored.sources = [{ file_ref: 'history-file', item_key: payload.get('item_key'), filename: 'HT-2026001.pdf', state: 'READY' }]
        return { file_ref: 'history-file' }
      }
      if (action === 'manifest') stored.items = payload.manifest.items.map(item => ({ id: 'history-item', item: structuredClone(item), state: 'READY', issues: [] }))
      if (action === 'preview') {
        stored.state = 'PREVIEWED'
        for (const entry of stored.items) if (entry.item.history_evidence.target_owner_name) entry.item.history_evidence.target_owner_user_id = 'actor'
        stored.provision_plan = [{ customer_name: 'Excel客户', customer_action: 'TO_CREATE' }]
      }
      return structuredClone(stored || original)
    }, undefined, undefined, async () => sheets, async () => { customerReads++; throw new Error('CRM未登录') })
    panel.props.supportedModes = ['NORMAL', 'ARCHIVE_ONLY', 'HISTORICAL_CLOSED']
    panel.state.startNewBatch()
    panel.state.selectEntryMode(mode)
    panel.state.historyOptions.value = { targetOwnerUserID: 'actor', historicalStatus: mode === 'ARCHIVE_ONLY' ? 'archived' : 'completed',
      declaredSignedDate: '2024-01-03', reportChannels: 'API_ONLY', financeMode: 'EVIDENCE_ONLY', reportMode: 'HISTORICAL_SEPARATE' }
    panel.state.selectFiles({ target: { files: [new File(['%PDF'], 'HT-2026001.pdf', { type: 'application/pdf' })], value: '' } })
    await panel.state.selectExcelFile({ target: { files: [new File(['xlsx'], '历史合同.xlsx')], value: '' } })
    assert.equal(panel.state.formRows.value[0].crmCustomerId, '')
    assert.deepEqual(panel.state.formRows.value[0].issues, [])
    await panel.state.preview()
    assert.equal(panel.state.error.value, '')
    const manifest = panel.calls.find(call => call[0] === 'manifest')[2].manifest
    assert.equal(manifest.items[0].mode, mode)
    assert.equal(manifest.items[0].metadata.crm_customer_id, 0)
    assert.equal(manifest.items[0].metadata.sales_name, '合成销售')
    assert.equal(manifest.items[0].source_file_ref, 'history-file')
    assert.equal(manifest.items[0].history_evidence.declared_signed_date, '2024-01-03')
    assert.equal(manifest.items[0].history_evidence.target_owner_user_id, '')
    assert.equal(manifest.items[0].history_evidence.target_owner_name, '现任负责人')
    assert.equal(panel.state.formRows.value[0].historyEvidence.target_owner_user_id, 'actor')
    assert.equal(customerReads, 0)
    assert.ok(panel.calls.some(call => call[0] === 'preview'))
    panel.state.formRows.value = []
    await panel.state.refresh('new-history')
    assert.equal(panel.state.formRows.value[0].historyEvidence.declared_signed_date, '2024-01-03')
    assert.equal(panel.state.formRows.value[0].key, manifest.items[0].item_key)
    assert.equal(panel.state.formRows.value[0].policyOptions.finance_mode, 'NONE')
    await panel.state.preview()
    assert.equal(panel.calls.filter(call => call[0] === 'files').length, 1)
  }
})

test('历史Excel解析迟到不覆盖另一模式，旧批次本地校验失败不刷新丢输入', async () => {
  let finish
  const panel = importPanelHarness('ARCHIVE_ONLY', undefined, undefined, undefined,
    () => new Promise(resolve => { finish = resolve }))
  panel.props.supportedModes = ['ARCHIVE_ONLY', 'HISTORICAL_CLOSED']
  panel.state.startNewBatch()
  panel.state.selectFiles({ target: { files: [new File(['%PDF'], 'HT-2026001.pdf', { type: 'application/pdf' })], value: '' } })
  const pending = panel.state.selectExcelFile({ target: { files: [new File(['xlsx'], '历史.xlsx')], value: '' } })
  await new Promise(resolve => setImmediate(resolve))
  panel.state.selectEntryMode('HISTORICAL_CLOSED')
  finish(excelWorkbook([excelMainRow()]))
  await pending
  assert.equal(panel.state.entryMode.value, 'HISTORICAL_CLOSED')
  assert.equal(panel.state.formRows.value.length, 0)
  const old = importPanelHarness('ARCHIVE_ONLY')
  old.state.jsonAuthoritative.value = false
  old.state.formRows.value = [normalRow({ title: '未保存修改', amount: '' })]
  old.state.historyOptions.value = { targetOwnerUserID: 'actor', historicalStatus: 'archived', reportChannels: 'API_ONLY' }
  await old.state.preview()
  assert.equal(old.calls.length, 0)
  assert.equal(old.state.formRows.value[0].title, '未保存修改')
  assert.ok(old.state.formRows.value[0].issues.some(issue => issue.field === 'amount'))
})

test('新批次不接受普通合同或接续履约高级清单，能力关闭不回退普通模式', async () => {
  const panel = importPanelHarness('NORMAL')
  panel.props.supportedModes = ['NORMAL']
  panel.state.startNewBatch()
  assert.equal(panel.state.entryMode.value, '')
  assert.match(await panel.html(), /尚未开放历史存档或历史结清导入/)
  await panel.state.preview()
  assert.equal(panel.calls.length, 0)
  assert.match(panel.state.error.value, /批量导入仅用于历史/)
  panel.props.supportedModes = ['NORMAL', 'ARCHIVE_ONLY', 'CONTINUE_LIVE']
  panel.state.startNewBatch()
  panel.state.jsonAuthoritative.value = true
  panel.state.files.value = [new File(['%PDF'], 'one.pdf', { type: 'application/pdf' })]
  panel.state.text.value = JSON.stringify({ schema_version: 1, source_system: 'legacy', items: [{
    mode: 'CONTINUE_LIVE', item_key: 'one', external_record_id: 'old-1', source_file_ref: 'one.pdf',
    metadata: {}, history_evidence: { expected_facts: [] }, policy_options: { finance_mode: 'FULL_REPLAY' },
  }] })
  await panel.state.preview()
  assert.equal(panel.calls.length, 0)
  assert.match(panel.state.error.value, /新批量导入只接受历史/)
})

test('混合历史旧批次包含接续项时整体保留原清单，不能通过表单过滤丢项', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY')
  panel.batch.items.push({ ...structuredClone(panel.batch.items[0]), id: 'continue-item',
    item: { ...structuredClone(panel.batch.items[0].item), item_key: 'continue-1', mode: 'CONTINUE_LIVE' } })
  await panel.state.refresh('batch-A')
  assert.equal(panel.state.usesJsonManifest.value, true)
  assert.equal(panel.state.formRows.value.length, 0)
  assert.equal(JSON.parse(panel.state.text.value).items.length, 2)
  assert.match(await panel.html(), /id="contract-import-json"/)
})

test('批量历史补填跳过成功项，不能清空已有财务事实或编辑移除成功项', () => {
  const panel = importPanelHarness('ARCHIVE_ONLY')
  panel.state.jsonAuthoritative.value = false
  const done = normalRow({ key: 'done', contractId: 'created',
    historyEvidence: { declared_signed_date: '2020-01-01', target_owner_user_id: 'old-owner' },
    policyOptions: { finance_mode: 'NONE' } })
  const pending = normalRow({ key: 'pending', historyEvidence: { expected_facts: [
    { source_system: 'legacy', fact_type: 'RECEIPT', external_fact_id: 'r1' },
  ] } })
  const original = JSON.stringify(done)
  panel.state.formRows.value = [done, pending]
  panel.state.historyOptions.value = { targetOwnerUserID: 'actor', historicalStatus: 'archived',
    reportChannels: 'API_ONLY', declaredSignedDate: '2024-01-01', noHistoricalFacts: true }
  panel.state.applyBatchHistory()
  assert.equal(panel.state.error.value, '')
  assert.equal(pending.historyEvidence.expected_facts.length, 1)
  panel.state.historyOptions.value.noHistoricalFacts = false
  panel.state.applyBatchHistory()
  assert.equal(JSON.stringify(done), original)
  assert.equal(pending.historyEvidence.declared_signed_date, '2024-01-01')
  assert.equal(pending.historyEvidence.expected_facts[0].external_fact_id, 'r1')
  panel.state.openRow(done)
  assert.equal(panel.state.drawerRowKey.value, '')
  panel.state.removeRow(done)
  assert.equal(panel.state.formRows.value.length, 2)
})

test('重新应用Excel更换当前负责人时清空旧账号，旧批次隐藏通道不随批量补填改变', async () => {
  const sheets = excelWorkbook([excelMainRow({ 当前负责人: '负责人乙' })])
  const panel = importPanelHarness('ARCHIVE_ONLY', undefined, undefined, undefined, async () => sheets)
  panel.state.jsonAuthoritative.value = false
  const row = normalRow({ fileName: 'HT-2026001.pdf', historyEvidence: {
    target_owner_name: '负责人甲', target_owner_user_id: 'user-A', report_required_channels: 'API_AND_SOURCE_FACTS',
  } })
  panel.state.formRows.value = [row]
  panel.state.files.value = [new File(['%PDF'], 'HT-2026001.pdf', { type: 'application/pdf' })]
  await panel.state.selectExcelFile({ target: { files: [new File(['xlsx'], '历史.xlsx')], value: '' } })
  const updated = panel.state.formRows.value[0]
  assert.equal(updated.historyEvidence.target_owner_name, '负责人乙')
  assert.equal(updated.historyEvidence.target_owner_user_id, undefined)
  panel.state.historyOptions.value = { historicalStatus: 'archived', declaredSignedDate: '2020-01-01' }
  panel.state.applyBatchHistory()
  assert.equal(updated.historyEvidence.report_required_channels, 'API_AND_SOURCE_FACTS')
})

test('新历史Excel页面不展示财务重建及报表技术通道，保留姓名自动匹配说明', async () => {
  const panel = importPanelHarness('ARCHIVE_ONLY')
  panel.props.supportedModes = ['ARCHIVE_ONLY', 'HISTORICAL_CLOSED']
  panel.state.startNewBatch()
  panel.state.selectEntryMode('HISTORICAL_CLOSED')
  const html = await panel.html()
  assert.doesNotMatch(html, /<select[^>]*>[^]*?请选择财务处理方式/)
  assert.doesNotMatch(html, /<span>报表来源通道<\/span>/)
  assert.doesNotMatch(html, /完整 JSON 清单）/)
  assert.match(html, /当前负责人.*唯一匹配/)
  assert.match(html, /历史导入不参与结算开票/)
})

test('批量显式选择负责人账号时清空旧Excel姓名，未选账号时保留原负责人', () => {
  const panel = importPanelHarness('ARCHIVE_ONLY')
  const row = normalRow({ historyEvidence: { target_owner_name: '姓名甲', target_owner_user_id: 'user-A' } })
  panel.state.formRows.value = [row]
  panel.state.historyOptions.value = { targetOwnerUserID: 'user-B', historicalStatus: 'archived' }
  panel.state.applyBatchHistory()
  assert.equal(row.historyEvidence.target_owner_user_id, 'user-B')
  assert.equal(row.historyEvidence.target_owner_name, '')
  row.historyEvidence.target_owner_name = '姓名乙'
  panel.state.historyOptions.value = { declaredSignedDate: '2020-01-01', historicalStatus: 'archived' }
  panel.state.applyBatchHistory()
  assert.equal(row.historyEvidence.target_owner_user_id, 'user-B')
  assert.equal(row.historyEvidence.target_owner_name, '姓名乙')
})
