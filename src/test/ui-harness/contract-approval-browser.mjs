// 审批按钮最小隔离回归：真实刷新/命令函数和弹窗按钮，仅会话与HTTP返回使用合成数据。
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { chromium } from 'playwright-core'
import { contractApprovalViewParts } from '../helpers/contractApprovalView.mjs'

const scenario = process.argv[2] || 'active'
assert.ok(['active', 'pending', 'finished'].includes(scenario), '每次只选一个审批按钮场景')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = process.env.CONTRACT_APPROVAL_OUTPUT_DIR || '/tmp/contract-approval-ui'
const parts = contractApprovalViewParts()
const compiled = compileTemplate({ source:
  `<div class="contract-app"><article v-if="selectedApproval" class="contract-detail-modal contract-approval-modal">
    <header><h2>合成审批按钮回归</h2></header>${parts.node}${parts.footer}</article></div>`,
filename: 'contract-approval-fixture.vue', id: 'approval-fixture' })
assert.deepEqual(compiled.errors, [])
const entry = `
import {createApp,computed,ref} from 'vue';
import {useApprovalDetail} from './src/modules/contract_management/composables/useApprovalDetail.js';
import {createRequestScope} from './src/modules/platform/shared/composables/requestScope.js';
import {hasContractPermission} from './src/modules/shared/authz/sys004.js';
import {approvalKindLabel} from './src/modules/contract_management/utils/contractDisplay.js';
import {formatContractDate} from './src/modules/contract_management/utils/contractBusinessTime.js';
import ConsoleIcon from './src/modules/shared/components/ConsoleIcon.vue';
${compiled.code.replace('export function render', 'function render')}
window.__approvalCommands=[];
createApp({render,components:{ConsoleIcon},
// 用途：装配真实审批状态和按钮，所有请求均在隔离边界内完成。
// 参数：无。
// 返回值：模板依赖的真实响应式状态和动作方法。
setup(){
 const session=ref({user_id:'reviewer',permissions:['approval.view','approval.process']});
 const activeSection=ref('approvals'),currentUserLabel=ref('合成审批人'),userDirectory=ref([]);
 const approvals=ref([]),initiatedApprovals=ref([]),approvalsKnown=ref(false);
 const route={query:{}};
 const approvalRealtimeScope=createRequestScope();
 let approvalRealtimeBusy=false,approvalRealtimePending=false;
 let refreshed=false,submitted=false;
 const notices=[];
 const detail={meta:{id:'approval',applicant_user_id:'applicant',kind:'contract_approval'},
  state:{status:'running',current_node_index:0,nodes:[{
   node:{id:'current-node',name:'合成审批节点',role_code:'sales_director'},status:'active',revision:4}]},
  contract:{status:'pending'},actions:[]};
 // 用途：返回与真实接口相同形状的合成流程状态。
 // 参数：无。
 // 返回值：当前流程详情；提交后提供已持久化动作和对应合同终态。
 async function getApproval(){
  const value=structuredClone(detail);
  if(submitted){value.state.status='approved';value.contract.status='active';value.actions=[{command_id:'accepted'}]}
  else if(refreshed && ${JSON.stringify(scenario)}==='finished')value.state.status='approved';
  return value;
 }
 // 用途：返回合成的当前用户任务，刻意与流程running状态区分。
 // 参数：无。
 // 返回值：本人active任务，或模拟待办已移出的空集合。
 async function listApprovalTasks(){
  refreshed=true;
  return ${JSON.stringify(scenario)}==='pending' || submitted ? []
   : [{approval_id:'approval',status:'active',node_id:'current-node',node_name:'合成审批节点'}];
 }
 // 用途：隔离与本次按钮回归无关的本人发起列表。
 // 参数：无。
 // 返回值：空列表，不请求任何业务服务。
 const listApprovals=async()=>[];
 const ui=useApprovalDetail({getApproval,previewApprovalContract:async()=>({}),
  commandApproval:async(id,action,payload)=>{window.__approvalCommands.push({id,action,payload});submitted=true;return {command_id:'accepted'}},
  can:permission=>hasContractPermission(session.value,permission),session,
  showToast:(message)=>notices.push(message),formatUserError:String,refreshApprovalRealtime:()=>refreshApprovalRealtime()});
 const {selectedApproval,approvalDetail,approvalCommandBusy,approvalComment,executeApprovalCommand}=ui;
 selectedApproval.value={id:'approval',status:'active',step:'合成审批节点'};
 approvalDetail.value=detail;
 ${parts.functions}
 ${parts.bindings}
 window.__approvalFixture={refresh:refreshApprovalRealtime,selectedApproval,approvalDetail,
  processApproval,notices};
 return {...ui,session,can,canActOnApproval,processApproval};
}}).mount('#app');`

const result = await build({ stdin: { contents: entry, resolveDir: root }, bundle: true,
  write: false, format: 'iife', platform: 'browser', alias: { '@': root + 'src' },
  plugins: [{ name: 'approval-sfc',
    // 用途：编译真实图标组件，不复制审批按钮的渲染实现。
    // 参数：builder为本次esbuild编译接口。
    // 返回值：无；只注册内存SFC读取规则。
    setup(builder) {
      builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
        const { descriptor } = parse(await readFile(path, 'utf8'))
        return { contents: compileScript(descriptor, { id: path, inlineTemplate: true }).content,
          loader: 'js', resolveDir: fileURLToPath(new URL('.', 'file://' + path)) }
      })
    },
  }],
})
const css = (await Promise.all(['platform/shared/styles/main.css', 'shared/styles/global-ux.css',
  'contract_management/styles/contract-management.css'].map(path =>
  readFile(root + 'src/modules/' + path, 'utf8')))).join('\n')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const errors = [], unexpected = []
let report
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } })
  page.setDefaultTimeout(4000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => { unexpected.push(route.request().url()); return route.abort() })
  await page.setContent(`<style>${css}</style><div id="app"></div>`)
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const approve = page.getByRole('button', { name: '同意', exact: true })
  await approve.waitFor()
  await approve.hover()
  await page.evaluate(() => window.__approvalFixture.refresh())
  await page.screenshot({ path: `${output}/${scenario}.png` })
  if (scenario === 'active') {
    assert.equal(await approve.count(), 1, '轮询后同意按钮消失，被评论入口占据')
    assert.equal(await page.getByText('合成审批节点', { exact: true }).isVisible(), true)
    await page.evaluate(() => window.__approvalFixture.refresh())
    await approve.click()
    await page.waitForFunction(() => window.__approvalFixture.selectedApproval.value === null)
    const commands = await page.evaluate(() => window.__approvalCommands)
    assert.deepEqual(commands.map(row => row.action), ['approve'])
    assert.equal(commands[0].payload.origin_node_id, 'current-node')
    assert.equal(commands[0].payload.origin_node_revision, 4)
  } else {
    assert.equal(await approve.count(), 0, '待办移出或流程终态后必须关闭审批入口')
    await page.evaluate(() => window.__approvalFixture.processApproval('approve'))
    assert.equal(await page.evaluate(() => window.__approvalCommands.length), 0)
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(unexpected, [])
  report = { scenario, result: 'PASS', errors, unexpected, business_data_written: false }
} catch (error) {
  report = { scenario, result: 'FAIL', error: error.message, errors, unexpected }
  throw error
} finally {
  await browser.close()
  await writeFile(`${output}/${scenario}.json`, JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report))
