// 新建合同最小隔离回归：真实字段组件、草稿编辑器、CRM API与视图选择动作。
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse as parseJS } from '@babel/parser'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = process.env.CONTRACT_CRM_OUTPUT_DIR || '/tmp/contract-crm-prefill-ui'
const { descriptor } = parse(await readFile(root + 'src/modules/contract_management/views/ContractManagementView.vue', 'utf8'))
const source = descriptor.scriptSetup.content
const ast = parseJS(source, { sourceType: 'module' }).program.body
const names = ['recordCRMDirectoryError', 'markCRMDirectoryReady', 'resetCRMDirectoryConnection',
  'ensureCRMDirectorySessionForAction', 'loadCustomerOptions', 'openCustomerPicker',
  'searchCustomerOptions', 'loadMoreCustomerOptions', 'loadOpportunityOptions', 'ensureOpportunityOptions',
  'selectCustomer', 'clearCustomer', 'selectOpportunity', 'clearOpportunity', 'selectOpportunityById']
const functions = names.map(name => {
  const node = ast.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(node, `缺少真实视图动作：${name}`)
  return source.slice(node.start, node.end)
}).join('\n')
const binding = ast.find(node => node.type === 'VariableDeclaration'
  && node.declarations.some(item => item.init?.callee?.name === 'useContractCRMPrefill'))
assert.ok(binding, '缺少真实CRM预填接线')

// 用途：定位真实模板中的表单组件和弹窗，避免复制其产品结构。
// 参数：node为当前模板节点，predicate为目标条件。
// 返回值：首个匹配节点；未匹配时返回undefined。
function findElement(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const found = findElement(child, predicate)
    if (found) return found
  }
}
const fields = findElement(descriptor.template.ast, node => node.tag === 'ContractDraftFields')
const picker = findElement(descriptor.template.ast, node => node.props?.some(prop =>
  prop.name === 'if' && prop.exp?.content === 'customerPickerOpen'))
const editor = findElement(descriptor.template.ast, node => node.props?.some(prop =>
  prop.name === 'if' && prop.exp?.content === 'templateEditDialogOpen'))
assert.ok(fields && picker && editor, '缺少真实合同字段、客户选择或模板编辑弹窗')
const compiled = compileTemplate({ filename: 'contract-crm-fixture.vue', id: 'crm-fixture', source:
  `<main class="contract-app"><section v-if="createDialogOpen" class="contract-create-modal">${fields.loc.source}</section>${picker.loc.source}${editor.loc.source}</main>` })
assert.deepEqual(compiled.errors, [])
const entry = `
import {createApp,computed,ref} from 'vue';
import {useContractDraftEditor} from './src/modules/contract_management/composables/useContractDraftEditor.js';
import {useContractCRMPrefill} from './src/modules/contract_management/composables/useContractCRMPrefill.js';
import {listMyCustomers,listMyOpportunities,listMyCustomerContacts,ensureContractCRMDirectorySession} from './src/modules/contract_management/api/contract.js';
import {formatUserError} from './src/modules/shared/utils/userError.js';
import ContractDraftFields from './src/modules/contract_management/components/ContractDraftFields.vue';
import ConsoleIcon from './src/modules/platform/shared/components/ConsoleIcon.vue';
${compiled.code.replace('export function render', 'function render')}
createApp({render,components:{ContractDraftFields,ConsoleIcon},
// 用途：装配真实合同字段和动作，只将会话及HTTP数据设为隔离值。
// 参数：无。
// 返回值：实际响应式表单、目录动作及模板所需状态。
setup(){
 const session=ref({user_id:'contract-a',identity_id:'identity-a',tenant_id:'tenant-a',display_name:'合成操作人'});
 const contractTemplates=ref([{id:'template-a',name:'合成合同模板',original_filename:'synthetic.docx',fields:[
  {name:'customer_name',label:'模板单位名称'},{name:'contract_title',label:'模板合同名称'},
  {name:'customer_contact',label:'模板联系人'},{name:'locked',label:'管理员预设',default:'预设内容',locked:true}]}]);
 const crmConnectionRequired=ref(false),crmForceLogin=ref(false),crmConnectionMessage=ref('');
 const crmSessionState=ref('unknown'),crmConnecting=ref(false),crmAutoConnectAttempted=ref(false),crmConnectAttempt=ref(0);
 const customerOptions=ref([]),customerKeyword=ref(''),customerPickerOpen=ref(false),customerLoading=ref(false);
 const customerPage=ref(0),customerTotal=ref(0),customerHasMore=ref(false),customerError=ref('');
 const opportunityOptions=ref([]),opportunityKeyword=ref(''),opportunityLoading=ref(false);
 const opportunityPage=ref(0),opportunityTotal=ref(0),opportunityHasMore=ref(false),opportunityError=ref('');
 const draft=useContractDraftEditor({route:{query:{}},session,contractTemplates,termsIdentical:ref(false),
  closeContract:()=>{},resetCRMDirectoryConnection,resetTemplatePreview:()=>{},
  invalidateDetectionCategoryRequest:()=>{},loadDetectionCategoryOptions:()=>{},showToast:()=>{}});
 const {newContract,selectedContractTemplate,createDialogOpen,contractCreating,editingContract}=draft;
 const isExternalContractMode=computed(()=>draft.contractCreationMode.value==='external');
 ${functions}
 ${source.slice(binding.start, binding.end)}
 draft.openNewContract();markCRMDirectoryReady();newContract.value.template_id='template-a';draft.selectContractTemplate();
 const templateEditDialogOpen=ref(false),templateSaving=ref(false);
 const templateEditForm=ref({id:'template-a',name:'合成合同模板',number_format:'HT-{YYYYMMDD}-{ID8}',fields:[]});
 window.__crmFixture={newContract,createDialogOpen,templateEditDialogOpen};
 return {...draft,session,contractTemplates,isExternalContractMode,
  ${names.join(',')},autofillCustomer,crmPrefillLoading,crmPrefillError,crmPrefillNotice,
  customerOptions,customerKeyword,customerPickerOpen,customerLoading,customerError,customerHasMore,customerTotal,
  crmConnectionRequired,crmConnecting,crmConnectionMessage,opportunityOptions,opportunityLoading,
  templateEditDialogOpen,templateEditForm,templateSaving,
  currentUserLabel:'合成操作人',editableContractTemplateFields:computed(()=>selectedContractTemplate.value?.fields||[]),
  contractSourceCapabilities:{},contractFormSourceCapabilities:{},localContractCounterparty:false,localContractCategories:false,
  availableContractTypeOptions:['直签'],serviceTypeOptions:['等保测评'],systemLevelOptions:['三级'],
  detectionCategoryOptions:[],detectionCategoryLoading:false,detectionCategoryError:'',
  isAdmin:false,templatePreviewing:false,templatePreviewError:'',
  selectExternalContractFile:()=>{},previewNewContract:()=>{},loadDetectionCategoryOptions:()=>{},
  saveTemplate:()=>{throw new Error('最小回归禁止保存模板')}
 };
}}).mount('#app');`
const bundle = await build({ stdin: { contents: entry, resolveDir: root }, write: false,
  bundle: true, format: 'iife', platform: 'browser', alias: { '@': root + 'src' },
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'crm-sfc',
    // 用途：在内存中编译实际Vue组件。
    // 参数：builder为本次esbuild编译接口。
    // 返回值：无；不修改产品源码或构建目录。
    setup(builder) {
      builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
        const { descriptor } = parse(await readFile(path, 'utf8'))
        return { contents: compileScript(descriptor, { id: path, inlineTemplate: true }).content,
          loader: 'js', resolveDir: fileURLToPath(new URL('.', 'file://' + path)) }
      })
    },
  }],
})
const css = (await Promise.all(['platform/shared/styles/main.css','shared/styles/global-ux.css',
  'contract_management/styles/contract-management.css'].map(path => readFile(root + 'src/modules/' + path, 'utf8')))).join('\n')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const errors = [], unexpected = [], calls = [], consoleMessages = []
let report, page
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(5000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) consoleMessages.push(message.text())
  })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== 'http://contract-prefill.local' || request.method() !== 'GET') {
      unexpected.push(request.method() + ' ' + url.pathname); return route.abort()
    }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<style>${css}</style><div id="app"></div>` })
    let data
    if (url.pathname === '/contract_management/api/v1/auth/me') data = { user_id: 'contract-a', identity_id: 'identity-a', tenant_id: 'tenant-a' }
    else if (url.pathname === '/customer-opportunity/api/v1/auth/me') data = { user_id: 'identity-a', tenant_id: 'tenant-a' }
    else if (url.pathname === '/customer-opportunity/api/v1/customers') data = {
      items: [{id:7,name:'合成客户甲'},{id:8,name:'合成客户乙'}],page:1,page_size:50,total:2 }
    else if (url.pathname === '/customer-opportunity/api/v1/opportunities') data = {
      items: [{id:9,name:'合成商机甲',customer_id:7,customer_name:'合成客户甲',expected_amount:'1234.56',requirement_summary:'合成需求甲'},
        {id:10,name:'合成商机乙',customer_id:7,customer_name:'合成客户甲',expected_amount:'4567.89',requirement_summary:'合成需求乙'}],page:1,page_size:50,total:2 }
    else if (/\/customers\/[78]\/contacts$/.test(url.pathname)) data = [{id:1,
      name:url.pathname.includes('/7/')?'合成联系人甲':'合成联系人乙',phone:'138****0000',is_registration:true}]
    else if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 })
    else { unexpected.push(url.pathname); return route.abort() }
    calls.push({method:request.method(),path:url.pathname})
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({code:'OK',data}) })
  })
  await page.goto('http://contract-prefill.local/')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.locator('.contract-opportunity-select').click()
  await page.getByRole('button', {name:/合成客户甲/}).click()
  await page.waitForFunction(()=>window.__crmFixture.newContract.value.customer_contact==='合成联系人甲')
  assert.equal(await page.getByRole('textbox',{name:/^单位名称/}).isEditable(),false)
  await assert.equal(await page.getByRole('textbox',{name:'客户联系人',exact:true}).inputValue(),'合成联系人甲')
  const select = page.getByRole('combobox',{name:/关联商机/})
  await select.focus()
  await page.waitForFunction(()=>document.querySelector('option[value="9"]'))
  await select.selectOption('9')
  const title = page.getByRole('textbox',{name:/^合同名称/})
  await assert.equal(await title.inputValue(),'合成商机甲')
  assert.equal(await page.getByRole('spinbutton',{name:/^合同金额/}).inputValue(),'1234.56')
  assert.equal(await page.getByRole('textbox',{name:'体系 / 能力要求',exact:true}).inputValue(),'合成需求甲')
  assert.equal(await page.getByRole('textbox',{name:/^模板单位名称/}).inputValue(),'合成客户甲')
  assert.equal(await page.getByRole('textbox',{name:'客户联系电话',exact:true}).inputValue(),'')
  await page.screenshot({path:`${output}/prefilled.png`,fullPage:true})
  await title.fill('手工合同名称')
  await page.getByRole('spinbutton',{name:/^合同金额/}).fill('88.00')
  await page.getByRole('textbox',{name:'客户联系人',exact:true}).fill('手工联系人')
  await select.selectOption('10')
  assert.equal(await title.inputValue(),'手工合同名称')
  // 数字输入会由Vue规范化末尾零，核对保留的实际金额。
  assert.equal(Number(await page.getByRole('spinbutton',{name:/^合同金额/}).inputValue()),88)
  await page.getByRole('textbox',{name:'体系 / 能力要求',exact:true}).fill('')
  await select.selectOption('9')
  assert.equal(await page.getByRole('textbox',{name:'体系 / 能力要求',exact:true}).inputValue(),'')
  await page.locator('.contract-opportunity-select').click()
  await page.getByRole('button',{name:/合成客户乙/}).click()
  assert.equal(await page.getByRole('textbox',{name:'客户联系人',exact:true}).inputValue(),'手工联系人')
  assert.equal(await select.inputValue(),'')
  assert.equal(await page.getByRole('textbox',{name:'体系 / 能力要求',exact:true}).inputValue(),'')
  await page.screenshot({path:`${output}/manual-preserved.png`,fullPage:true})
  await page.evaluate(()=>{window.__crmFixture.createDialogOpen.value=false;window.__crmFixture.templateEditDialogOpen.value=true})
  await page.getByRole('heading',{name:'编辑合同模板',exact:true}).waitFor()
  assert.equal(await page.getByText('合同编号格式（只读）',{exact:true}).count(),0)
  const width = await page.locator('.contract-template-base-fields').evaluate(el=>({
    full:el.clientWidth,name:el.querySelector('label').getBoundingClientRect().width}))
  assert.ok(Math.abs(width.full-width.name)<2,'移除旧规则后模板名称须占完整一列')
  await page.screenshot({path:`${output}/template-editor.png`,fullPage:true})
  assert.deepEqual(errors,[])
  assert.deepEqual(unexpected,[])
  assert.deepEqual(consoleMessages,[])
  report={result:'PASS',scenario:'new-contract-crm-prefill',calls,errors,unexpected,consoleMessages,business_data_written:false}
} catch(error) {
  report={result:'FAIL',error:error.message,calls,errors,unexpected,consoleMessages}
  if(page) {
    await writeFile(`${output}/debug.html`,await page.content())
    await page.screenshot({path:`${output}/failure.png`,fullPage:true})
  }
  throw error
} finally {
  await browser.close()
  await writeFile(`${output}/result.json`,JSON.stringify(report,null,2)+'\n')
}
console.log(JSON.stringify({result:report.result,scenario:report.scenario,requests:calls.length}))
