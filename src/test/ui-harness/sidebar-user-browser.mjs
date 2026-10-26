import { chromium } from 'playwright-core'
import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const modules=[['结算','settlement','SettlementView','settlement.css','settlement-sidebar-footer'],['项目','project_management','ProjectManagementView','project-management.css','pm-sidebar-user'],['合同','contract_management','ContractManagementView','contract-management.css','contract-sidebar-user'],['CRM','customer_opportunity','CustomerOpportunityView','customer-opportunity.css','console-sidebar-user'],['客户门户','customer_portal','CustomerPortalView','customer-portal.css','console-sidebar-user'],['数析','data_analysis','DashboardShellView','data-analysis.css','da-sidebar-user']]
const sourceRoot=new URL('../../modules/',import.meta.url)
const output=new URL('../../../../.ai/qa/sidebar-user-unification-20261026/',import.meta.url)
let styles=await readFile(new URL('shared/styles/global-ux.css',sourceRoot),'utf8')
styles+=await readFile(new URL('platform/styles/console.css',sourceRoot),'utf8')
const footers=[]
for(const [name,module,view,css,cls] of modules){
 styles+=await readFile(new URL(`${module}/styles/${css}`,sourceRoot),'utf8')
 const source=await readFile(new URL(`${module}/views/${view}.vue`,sourceRoot),'utf8')
 const start=source.indexOf(`<div class="${cls} subsystem-sidebar-user"`)
 assert.ok(start>=0)
 let html=source.slice(start,source.indexOf('</div>',start)+6)
 html=html.replace(/<ConsoleIcon[^>]*\/>/g,'<svg viewBox="0 0 24 24"><path d="M4 3h9v3H7v12h6v3H4zM14 7l6 5-6 5v-4H9v-2h5z" fill="currentColor"/></svg>')
 let field=0
 html=html.replace(/\{\{[^}]+\}\}/g,()=>field++===0?'本':'01M594AD09J03FRJV8SDXMH72S'.repeat(4))
 footers.push({name,html})
}
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const rows=[]
try{
 for(const width of [1280,760]){
  const page=await browser.newPage({viewport:{width,height:600}})
  await page.setContent(`<style>${styles}</style><style>body{margin:24px;background:#f1f5f9;font-family:system-ui}main{display:flex;gap:16px;flex-wrap:wrap}article{width:248px}h2{font-size:16px}</style><main>${footers.map(({name,html})=>`<article><h2>${name}</h2><div>${html}</div></article>`).join('')}</main>`)
  const metrics=await page.locator('.subsystem-sidebar-user').evaluateAll(elements=>elements.map(e=>{
   const avatar=e.children[0],copy=e.children[1],button=e.querySelector('button'),r=e.getBoundingClientRect()
   return {width:r.width,height:r.height,avatar:avatar.getBoundingClientRect().width,font:getComputedStyle(copy.querySelector('strong')).fontSize,background:getComputedStyle(e).backgroundColor,button:button.getBoundingClientRect().width,overflows:e.scrollWidth>e.clientWidth,ellipsis:getComputedStyle(copy.querySelector('strong')).textOverflow,buttonFits:button.getBoundingClientRect().right<=r.right}
  }))
  assert.equal(metrics.length,6)
  for(const m of metrics){assert.deepEqual(m,metrics[0]);assert.equal(m.overflows,false);assert.equal(m.buttonFits,true);assert.equal(m.avatar,36);assert.equal(m.ellipsis,'ellipsis')}
  if(width===1280)await page.screenshot({path:new URL('six-subsystems.png',output).pathname})
  // Existing settlement compact sidebar must retain both avatar and logout.
  await page.setContent(`<style>${styles}</style><aside class="settlement-sidebar" style="width:64px">${footers[0].html}</aside>`)
  if(width===760){
   const compact=await page.locator('.subsystem-sidebar-user').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,copy:getComputedStyle(e.children[1]).display,button:e.querySelector('button').getBoundingClientRect().width}))
   assert.equal(compact.scroll,compact.width);assert.equal(compact.copy,'none');assert.equal(compact.button,32)
  }
  rows.push({viewport:width,status:'PASS',metrics});await page.close()
 }
 await writeFile(new URL('browser-results.json',output),JSON.stringify(rows,null,2));console.log('PASS: six sidebar footers have identical computed styles, long text is contained, compact settlement logout remains visible')
}finally{await browser.close()}
