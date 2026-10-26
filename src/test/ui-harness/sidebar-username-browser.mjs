// Isolated component fixture: actual footer templates + actual identity helper + actual styles.
// No business API, browser session, or database access.
import { chromium } from 'playwright-core'
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { loginUsername } from '../../modules/shared/loginUsername.mjs'
const modules = [['settlement','SettlementView','settlement.css','settlement-sidebar-footer'],['project_management','ProjectManagementView','project-management.css','pm-sidebar-user'],['contract_management','ContractManagementView','contract-management.css','contract-sidebar-user'],['customer_opportunity','CustomerOpportunityView','customer-opportunity.css','console-sidebar-user'],['customer_portal','CustomerPortalView','customer-portal.css','console-sidebar-user'],['data_analysis','DashboardShellView','data-analysis.css','da-sidebar-user']]
const root = new URL('../../modules/', import.meta.url)
const output = new URL('../../../../.ai/qa/sidebar-login-username-20261026/', import.meta.url)
let css = await readFile(new URL('shared/styles/global-ux.css',root),'utf8')
css += await readFile(new URL('platform/styles/console.css',root),'utf8')
const templates=[]
for(const [module,view,style,cls] of modules){
 const source=await readFile(new URL(`${module}/views/${view}.vue`,root),'utf8')
 css+=await readFile(new URL(`${module}/styles/${style}`,root),'utf8')
 const start=source.indexOf(`<div class="${cls} subsystem-sidebar-user"`)
 assert.ok(start>=0)
 templates.push(source.slice(start,source.indexOf('</div>',start)+6))
}
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const results=[]
try {
 for(const width of [1280,760]) {
  const page=await browser.newPage({viewport:{width,height:600}})
  await page.setContent(`<style>${css}</style><style>body{font-family:system-ui;margin:20px;background:#f1f5f9}main{display:flex;flex-wrap:wrap;gap:16px}article{width:248px}h2{font-size:14px}</style><main>${modules.map(([m],i)=>`<article><h2>${m}</h2><div id="footer-${i}"></div></article>`).join('')}</main>`)
  await page.addScriptTag({content:await readFile(new URL('../../../node_modules/vue/dist/vue.global.prod.js',import.meta.url),'utf8')})
  await page.evaluate(({templates,helper})=>{
    const {ref,computed,createApp}=Vue
    const resolveUsername = new Function(`return (${helper})`)()
    const session=ref({username:'alice',display_name:'张三',user_id:'internal-id'})
    window.identityFixture=session
    for(let i=0;i<templates.length;i++){
      createApp({template:templates[i],components:{ConsoleIcon:{template:'<svg aria-hidden="true" viewBox="0 0 24 24"></svg>'}},setup(){
        const username=computed(()=>resolveUsername(session.value))
        const initial=computed(()=>username.value.slice(0,1).toUpperCase())
        return {currentUserName:username,currentUserLabel:username,currentLoginUsername:username,sessionDisplayName:username,sessionAvatar:initial,currentUserInitial:initial,accountInitial:initial,sessionAccount:'当前登录账号',currentUserRole:'管理员',currentUserRoleLabel:'管理员',currentRoleLabel:'管理员',isLoggingOut:false,logoutSystem(){}}
      }}).mount(`#footer-${i}`)
    }
  },{templates,helper:loginUsername.toString()})
  for(const username of ['alice','very-long-current-login-username-'.repeat(8),'bob']) {
    await page.evaluate(username=>{window.identityFixture.value={username,display_name:'另一个姓名',user_id:'internal-id'}},username)
    const labels=page.locator('.subsystem-sidebar-user strong')
    await labels.first().waitFor()
    assert.deepEqual(await labels.allTextContents(),Array(6).fill(username))
    assert.deepEqual(await labels.evaluateAll(nodes=>nodes.map(n=>n.title)),Array(6).fill(username))
    const overflow=await page.locator('.subsystem-sidebar-user').evaluateAll(nodes=>nodes.map(n=>n.scrollWidth>n.clientWidth))
    assert.deepEqual(overflow,Array(6).fill(false))
  }
  await page.evaluate(()=>{window.identityFixture.value={display_name:'张三',user_id:'internal-id'}})
  assert.deepEqual(await page.locator('.subsystem-sidebar-user strong').allTextContents(),Array(6).fill('当前用户'))
  results.push({width,footers:6,usernameAndTooltip:true,reactiveAccountSwitch:true,longTextContained:true,internalIDNeverUsed:true})
  await page.close()
 }
 await writeFile(new URL('browser-results.json',output),JSON.stringify(results,null,2))
 console.log(JSON.stringify(results))
} finally { await browser.close() }
