import test from 'node:test'
import assert from 'node:assert/strict'
import * as Vue from 'vue'
import { useSidebarNavigation } from './composables/useSidebarNavigation.js'

// mountSidebar 挂载真实侧栏焦点组合逻辑并替换浏览器事件边界。
// 参数：narrow 为当前断点状态。
// 返回值：可控制开合、断点及键盘事件的状态与清理方法。
function mountSidebar(narrow = true) {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const listeners = new Map()
  const media = { matches: narrow, addEventListener(_event, callback) { this.change = callback },
    removeEventListener() {} }
  const document = { activeElement: null, body: { dataset: {} },
    addEventListener(name, callback) { listeners.set(name, callback) },
    removeEventListener(name) { listeners.delete(name) } }
  globalThis.window = { matchMedia: () => media }
  globalThis.document = document
  const trigger = { focus() { document.activeElement = trigger } }
  const first = { offsetParent: {}, focus() { document.activeElement = first } }
  const last = { offsetParent: {}, focus() { document.activeElement = last } }
  const container = { querySelectorAll: () => [first, last],
    contains: value => [first, last].includes(value) }
  document.activeElement = trigger
  const open = Vue.ref(false), collapsed = Vue.ref(false)
  let hidden
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {},
    parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ setup() {
    hidden = useSidebarNavigation({ open, collapsed, container: Vue.ref(container),
      trigger: Vue.ref(trigger) }).hidden
    return () => null
  } })
  app.mount({})
  return { open, collapsed, hidden, document, first, last, trigger, media,
    key(event) { listeners.get('keydown')?.(event) },
    unmount() { app.unmount(); globalThis.window = previousWindow; globalThis.document = previousDocument } }
}

test('关闭窄屏侧栏不可交互，打开捕获Tab并在关闭后恢复按钮焦点', async () => {
  const h = mountSidebar()
  try {
    assert.equal(h.hidden.value, true)
    h.open.value = true
    await Vue.nextTick(); await Vue.nextTick()
    assert.equal(h.hidden.value, false)
    assert.equal(h.document.activeElement, h.first)
    h.last.focus()
    let prevented = false
    h.key({ key: 'Tab', preventDefault() { prevented = true } })
    assert.equal(prevented, true)
    assert.equal(h.document.activeElement, h.first)
    h.key({ key: 'Tab', shiftKey: true, preventDefault() {} })
    assert.equal(h.document.activeElement, h.last)
    h.open.value = false
    await Vue.nextTick()
    assert.equal(h.hidden.value, true)
    assert.equal(h.document.activeElement, h.trigger)
  } finally { h.unmount() }
})

test('桌面折叠不隐藏窄屏打开的抽屉，断点变化重新计算焦点边界', async () => {
  const h = mountSidebar(false)
  try {
    assert.equal(h.hidden.value, false)
    h.collapsed.value = true
    assert.equal(h.hidden.value, true)
    h.media.matches = true; h.media.change()
    h.open.value = true
    await Vue.nextTick(); await Vue.nextTick()
    assert.equal(h.hidden.value, false)
    h.media.matches = false; h.media.change()
    await Vue.nextTick()
    assert.equal(h.hidden.value, true)
  } finally { h.unmount() }
})
