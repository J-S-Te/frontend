import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 全局弹窗守护的静态契约。
//
// 行为级证据在 src/test/ui-harness/modal-guard-browser.mjs（真实 Chrome 合成页面）：
// 打开后 body 锁滚动、背景 inert、焦点进入弹窗、Tab 内循环、关闭还焦、导航遮罩不误判。
// 这里守住三件容易被后续改动悄悄破坏、而单元测试又跑不进浏览器的事：
// 1. 根组件确实只安装一次并在卸载时释放；
// 2. 守护复用共享 bodyScrollLock 计数，而不是自己再写一套 overflow；
// 3. 自带焦点陷阱的共享弹窗被标记为 managed，避免两套 Tab 处理互相抢焦点。

const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const guardSource = read('./utils/modalGuard.js')
const appSource = read('../platform/app/App.vue')
const formDialog = read('./components/FormDialog.vue')
const confirmDialog = read('./components/ConfirmDialog.vue')
const promptDialog = read('./components/PromptDialog.vue')

test('App 根组件安装并释放全局弹窗守护', () => {
  assert.match(appSource, /import \{ installModalGuard \} from '@\/modules\/shared\/utils\/modalGuard'/)
  assert.match(appSource, /const disposeModalGuard = installModalGuard\(\)/)
  assert.match(appSource, /disposeModalGuard\(\)/)
})

test('守护复用共享滚动锁，未知弹窗也能锁住页面', () => {
  assert.match(guardSource, /import \{ acquireBodyScrollLock, releaseBodyScrollLock \} from '\.\/bodyScrollLock\.js'/)
  assert.match(guardSource, /acquireBodyScrollLock\(\)/)
  assert.match(guardSource, /releaseBodyScrollLock\(\)/)
  // 不再自写 document.body.style.overflow，避免和共享弹窗的计数锁互相覆盖。
  assert.doesNotMatch(guardSource, /document\.body\.style\.overflow\s*=/)
})

test('守护同时识别标准 ARIA 弹窗与全屏 fixed 历史浮层', () => {
  assert.match(guardSource, /role="dialog"\]\[aria-modal="true"\]/)
  assert.match(guardSource, /getComputedStyle\(element\)\.position !== 'fixed'/)
  assert.match(guardSource, /coversViewport/)
  assert.match(guardSource, /setAttribute\('inert', ''\)/)
})

test('导航点击遮罩不会被当成模态', () => {
  assert.match(guardSource, /menu-mask/)
  assert.match(guardSource, /element\.children\.length/)
})

test('共享弹窗标记 managed，避免两套焦点陷阱', () => {
  for (const [name, source] of [['FormDialog', formDialog], ['ConfirmDialog', confirmDialog], ['PromptDialog', promptDialog]]) {
    assert.match(source, /data-ui-dialog-managed="true"/, `${name} 需要声明由自身管理焦点`)
  }
  assert.match(guardSource, /MANAGED_LAYER/)
})
