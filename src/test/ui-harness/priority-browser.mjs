import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

const browser = await chromium.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true })
const results=[]
const output = new URL('../../../../.ai/qa/priority-remediation-20261026/',import.meta.url)
try {
  for (const [width,height] of [[1366,768],[1024,700],[640,480],[375,667]]) {
    const page = await browser.newPage({ viewport:{width,height} })
    const errors=[]
    page.on('pageerror', error=>errors.push(error.message))
    const metrics = width === 1366 ? [1,2].map(i=>({code:'fixture_'+i,name:'夹具指标'+i,origin:'CUSTOM',version:1,enabled:false,status:'待确认',dashboard:'合同看板',definition:'定义',formula:'公式',source:'夹具',period:'月'})) : []
    await page.route('http://127.0.0.1:5179/data_analysis/api/**', route=> {
      assert.equal(route.request().method(),'GET','fixture must not make business writes')
      return route.fulfill({json:{code:'OK',data:{metrics}}})
    })
    await page.goto('http://127.0.0.1:5179/src/test/ui-harness/priority.html')
    await page.locator('#open-both').click()
    await page.waitForFunction(()=>{
      const layers=[...document.querySelectorAll('.shared-confirm-mask,.shared-prompt-mask')]
      if(layers.length!==2)return false
      const top=layers.sort((a,b)=>Number(getComputedStyle(b).zIndex)-Number(getComputedStyle(a).zIndex))[0]
      return top.contains(document.activeElement)
    })
    const topSelector=await page.evaluate(()=>{
      const top=[...document.querySelectorAll('.shared-confirm-mask,.shared-prompt-mask')].sort((a,b)=>Number(getComputedStyle(b).zIndex)-Number(getComputedStyle(a).zIndex))[0]
      return '.'+top.classList[0]
    })
    for (const key of ['Tab','Tab','Shift+Tab']) {
      await page.keyboard.press(key)
      assert.equal(await page.locator(topSelector).evaluate(e=>e.contains(document.activeElement)),true)
    }
    await page.keyboard.press('Escape')
    await page.locator(topSelector).waitFor({state:'detached'})
    assert.equal(await page.locator('.shared-confirm-mask,.shared-prompt-mask').count(),1,'Escape must close only the visually top layer')
    const remaining=page.locator('.shared-confirm-mask,.shared-prompt-mask')
    assert.equal(await remaining.evaluate(e=>e.contains(document.activeElement)),true,'closing top must focus the remaining dialog')
    await page.evaluate(()=>document.querySelector('#toggle-busy').click())
    await page.keyboard.press('Tab')
    assert.equal(await remaining.evaluate(e=>e.contains(document.activeElement)),true,'busy dialog must contain keyboard focus')
    await page.keyboard.press('Escape')
    assert.equal(await remaining.count(),1,'busy Escape must not cancel the operation')
    await page.evaluate(()=>document.querySelector('#toggle-busy').click())

    await page.evaluate(()=>document.querySelector('#open-toast').click())
    await page.locator('.shared-operation-toast').waitFor()
    const geometry=await page.evaluate(()=> {
      const selectors=['.shared-confirm,.shared-prompt','.shared-operation-toast','.operation-result']
      return {items:selectors.map(selector=>{
        const e=document.querySelector(selector), r=e.getBoundingClientRect()
        return {selector,left:r.left,right:r.right,client:e.clientWidth,scroll:e.scrollWidth}
      }),toastZ:Number(getComputedStyle(document.querySelector('.shared-operation-toast')).zIndex),dialogZ:Number(getComputedStyle(document.querySelector('.shared-confirm-mask,.shared-prompt-mask')).zIndex)}
    })
    for (const item of geometry.items) {
      assert.ok(item.left>=0 && item.right<=width+1,JSON.stringify(item))
      assert.ok(item.scroll<=item.client+1,JSON.stringify(item))
    }
    assert.ok(geometry.toastZ>geometry.dialogZ)
    if(width===375) await page.screenshot({path:new URL('overlay-375.png',output).pathname})
    // Even a long dialog can scroll to its cancel action.
    await page.getByRole('button',{name:'取消',exact:true}).click()
    await page.locator('.shared-confirm-mask,.shared-prompt-mask').waitFor({state:'detached'})
    assert.equal(await page.evaluate(()=>document.body.dataset.confirmDialogOpen),undefined)
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
    // Real Dictionary component, empty backend fixture: dirty close still opens once.
    await page.locator('#dictionary').click()
    await page.getByRole('button',{name:'新建指标',exact:true}).click()
    await page.getByRole('textbox',{name:'编码',exact:true}).fill('changed')
    await page.locator('.da-modal header button').click()
    await page.getByRole('alertdialog',{name:'放弃指标编辑？'}).waitFor()
    assert.equal(await page.locator('.shared-confirm-mask').count(),1)
    await page.getByRole('button',{name:'继续编辑',exact:true}).click()
    assert.equal(await page.locator('.da-modal').count(),1)
    await page.locator('.da-modal header button').click()
    await page.getByRole('button',{name:'放弃修改',exact:true}).click()
    await page.locator('.da-modal').waitFor({state:'detached'})
    assert.deepEqual(errors,[])
    if(width===375) await page.screenshot({path:new URL('ui-375.png',output).pathname,fullPage:true})
    results.push({width,height,status:'PASS',geometry,dictionaryRows:metrics.length,checks:['busy keyboard containment','focus restoration','top-layer Tab/Shift+Tab','nested Escape','cancel','scroll unlock','toast layering','long text containment','empty dictionary dirty cancel/discard']})
    await page.close()
  }
  await writeFile(new URL('browser-results.json',output),JSON.stringify(results,null,2))
  console.log(JSON.stringify(results.map(({width,height,status})=>({width,height,status}))))
} finally {await browser.close()}
