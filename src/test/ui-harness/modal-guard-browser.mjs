// 手工证据脚本：验证全局弹窗守护的滚动锁、背景隔离、焦点收拢与还焦。
// 不依赖 dev server：用 esbuild 把被测模块打成 IIFE，再注入到合成页面。
// 运行：node src/test/ui-harness/modal-guard-browser.mjs
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const bundle = await build({
  entryPoints: [resolve(root, 'src/modules/shared/utils/modalGuard.js')],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'ModalGuard',
})
const source = bundle.outputFiles[0].text

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))

await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 14px/1.5 system-ui; }
  .long { height: 2600px; padding: 12px; }
  .pm-overlay { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: rgba(15,23,42,.45); }
  .pm-dialog { width: 520px; padding: 24px; border-radius: 12px; background: #fff; display: grid; gap: 10px; }
  .contract-modal-mask { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; background: rgba(15,23,42,.48); }
  .contract-detail-modal { width: 640px; padding: 22px; border-radius: 13px; background: #fff; display: grid; gap: 10px; }
  .pm-menu-mask { position: fixed; inset: 0; z-index: 40; background: transparent; }
</style></head><body>
  <button id="open">打开弹窗</button>
  <main id="page-body" class="long"><p>背景页面</p></main>
  <div id="host"></div>
</body></html>`)
await page.addScriptTag({ content: source })

const opened = await page.evaluate(async () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 60))
  window.__disposeGuard = window.ModalGuard.installModalGuard()
  window.scrollTo(0, 500)
  await tick()
  const out = { scrollBefore: window.scrollY, beforeOverflow: document.body.style.overflow }
  const opener = document.getElementById('open')
  opener.focus({ preventScroll: true })
  opener.click()
  document.getElementById('host').innerHTML = '<div class="pm-overlay"><form class="pm-dialog" role="dialog" aria-modal="true">'
    + '<input id="a"><input id="b"><button type="button" id="c">提交</button></form></div>'
  await tick()
  out.overflow = document.body.style.overflow
  out.marker = document.body.dataset.modalGuardOpen
  out.backgroundInert = document.getElementById('page-body').hasAttribute('inert')
  out.openerInert = opener.hasAttribute('inert')
  out.focusId = document.activeElement?.id
  return out
})

// 真实滚轮输入：弹窗打开时滚轮不得滚动背景页面
await page.mouse.move(640, 500)
await page.mouse.wheel(0, 900)
await page.waitForTimeout(120)
const scrollAfterWheel = await page.evaluate(() => window.scrollY)

const cycled = await page.evaluate(async () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 30))
  const out = {}
  document.getElementById('c').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  out.tabCycle = document.activeElement?.id
  document.getElementById('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
  out.tabBack = document.activeElement?.id
  document.getElementById('host').innerHTML = ''
  await tick()
  out.closedOverflow = document.body.style.overflow
  out.closedInert = document.getElementById('page-body').hasAttribute('inert')
  out.closedFocus = document.activeElement?.id
  return out
})

const suspended = await page.evaluate(async () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 60))
  const host = document.getElementById('host')
  const out = {}
  host.innerHTML = '<div class="pm-overlay"><form class="pm-dialog" role="dialog" aria-modal="true"><input id="d"></form></div>'
  await tick()
  out.rawOpen = document.body.style.overflow
  host.insertAdjacentHTML('beforeend', '<div class="pm-overlay" data-ui-dialog-managed="true"><section role="dialog" aria-modal="true"><button id="e">确定</button></section></div>')
  await tick()
  out.managedSuspend = document.body.style.overflow
  out.managedInert = document.getElementById('page-body').hasAttribute('inert')
  host.innerHTML = ''
  await tick()
  // 复现截图里的合同寄出弹窗：遮罩 + 没有 role 的面板，只能靠结构识别兜底
  host.innerHTML = '<div class="contract-modal-mask"><article class="contract-detail-modal contract-signing-modal">'
    + '<input id="zip"><button type="button" id="ok">确认寄出并开始跟踪</button></article></div>'
  await tick()
  out.contractOverflow = document.body.style.overflow
  out.contractFocus = document.activeElement?.id
  out.contractInert = document.getElementById('page-body').hasAttribute('inert')
  // 祖先带 transform 时 fixed 遮罩只有 700x500，不能被尺寸判断漏掉
  host.innerHTML = '<div style="width:700px;height:500px;transform:translateZ(0)">'
    + '<div class="contract-modal-mask"><article class="contract-detail-modal"><input id="z2"></article></div></div>'
  await tick()
  out.transformedOverflow = document.body.style.overflow
  out.transformedFocus = document.activeElement?.id
  host.innerHTML = '<div class="pm-menu-mask"></div>'
  await tick()
  out.menuMaskOverflow = document.body.style.overflow
  host.innerHTML = ''
  await tick()
  window.__disposeGuard()
  await tick()
  out.disposedOverflow = document.body.style.overflow
  return out
})

const result = { ...opened, scrollAfterWheel, ...cycled, ...suspended }
assert.equal(result.beforeOverflow, '')
assert.equal(result.overflow, 'hidden', '弹窗打开后必须锁定页面滚动')
assert.equal(result.marker, '1')
assert.equal(result.backgroundInert, true, '背景必须移出可交互范围')
assert.equal(result.openerInert, true)
assert.equal(result.focusId, 'a', '打开后焦点应进入弹窗首个输入框')
assert.equal(result.scrollBefore, 500)
assert.equal(result.scrollAfterWheel, 500, '弹窗打开时滚轮不得滚动背景')
assert.equal(result.tabCycle, 'a', 'Tab 在弹窗内循环')
assert.equal(result.tabBack, 'c', 'Shift+Tab 反向循环')
assert.equal(result.closedOverflow, '', '关闭后必须恢复页面滚动')
assert.equal(result.closedInert, false, '关闭后必须移除 background inert')
assert.equal(result.closedFocus, 'open', '关闭后焦点应还给触发按钮')
assert.equal(result.rawOpen, 'hidden')
assert.equal(result.managedSuspend, '', '共享弹窗接管时守护应让出滚动锁')
assert.equal(result.managedInert, false)
assert.equal(result.contractOverflow, 'hidden', '无 role 的历史弹窗也必须锁定滚动')
assert.equal(result.contractFocus, 'zip', '焦点应落到寄出登记首个输入框')
assert.equal(result.contractInert, true)
assert.equal(result.transformedOverflow, 'hidden', '祖先 transform 收敛尺寸后仍须锁定滚动')
assert.equal(result.transformedFocus, 'z2')
assert.equal(result.menuMaskOverflow, '', '导航点击遮罩不是模态，不得锁滚动')
assert.equal(result.disposedOverflow, '')
assert.deepEqual(errors, [])

const output = resolve(root, '../.ai/qa/modal-guard-20261117')
await mkdir(output, { recursive: true })
await writeFile(resolve(output, 'modal-guard-evidence.json'), JSON.stringify(result, null, 2))
await browser.close()
console.log(JSON.stringify(result, null, 2))
console.log('modal guard browser assertions passed')
