import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  NATIVE_DATE_INPUT_TYPES,
  installNativeDatePickerOnClick,
  isNativeDateInput,
  isPickerOptedOut,
  openNativePicker,
  resolveNativeDateInput,
} from './useNativeDatePickerAutoOpen.js'

// 这套测试不依赖 DOM 库：仓库里没有 jsdom，其他前端单测也是手写替身。
// 替身只实现本模块真正用到的那几个成员（tagName / type / getAttribute / closest /
// disabled / readOnly / showPicker / focus），避免用假 DOM 掩盖真实调用路径。

// createFakeDocument 造一个只支持 click 监听的 document 替身。
// 参数：无。
// 返回值：带 addEventListener / removeEventListener / click / listenerCount 的替身。
function createFakeDocument() {
  const listeners = []
  return {
    addEventListener(type, handler, options) {
      listeners.push({ type, handler, options })
    },
    removeEventListener(type, handler) {
      const index = listeners.findIndex(item => item.type === type && item.handler === handler)
      if (index >= 0) listeners.splice(index, 1)
    },
    // click 模拟一次真实派发：把事件交给所有 click 监听（本模块只挂一个）。
    // 参数：event 为手写事件对象。
    // 返回值：无。
    click(event) {
      for (const item of listeners.filter(entry => entry.type === 'click')) item.handler(event)
    },
    get listenerCount() {
      return listeners.length
    },
    get listeners() {
      return listeners
    },
  }
}

// createInput 造一个原生输入框替身。
// 参数：overrides 覆盖默认成员（例如 type、showPicker、disabled）。
// 返回值：输入框替身；calls.showPicker / calls.focus 统计实际调用次数。
function createInput(overrides = {}) {
  const calls = { showPicker: 0, focus: 0 }
  const attributes = overrides.attributes ?? {}
  const input = {
    tagName: 'INPUT',
    type: 'date',
    disabled: false,
    readOnly: false,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null
    },
    closest() {
      return null
    },
    showPicker() {
      calls.showPicker += 1
    },
    focus() {
      calls.focus += 1
    },
    ...overrides,
    calls,
  }
  return input
}

// createClickEvent 造一次主键点击事件。
// 参数：target 为点击目标，extra 覆盖其余成员。
// 返回值：记录了 preventDefault / stopPropagation 调用的事件替身。
function createClickEvent(target, extra = {}) {
  const event = {
    type: 'click',
    button: 0,
    target,
    defaultPrevented: false,
    propagationStopped: false,
    composedPath: () => [target],
    preventDefault() {
      event.defaultPrevented = true
    },
    stopPropagation() {
      event.propagationStopped = true
    },
    ...extra,
  }
  return event
}

test('五种日期类类型：点框内任意位置都调用 showPicker', () => {
  assert.deepEqual([...NATIVE_DATE_INPUT_TYPES], ['date', 'datetime-local', 'month', 'time', 'week'])
  for (const type of NATIVE_DATE_INPUT_TYPES) {
    const doc = createFakeDocument()
    installNativeDatePickerOnClick({ document: doc })
    const input = createInput({ type, attributes: { type } })
    doc.click(createClickEvent(input))
    assert.equal(input.calls.showPicker, 1, `${type} 应打开选择器`)
    assert.equal(input.calls.focus, 0, `${type} 打开成功时不该退回聚焦`)
  }
})

test('点击落在输入框内部的子节点（图标/占位）也按同一路径处理', () => {
  const doc = createFakeDocument()
  installNativeDatePickerOnClick({ document: doc })
  const input = createInput({ type: 'datetime-local', attributes: { type: 'datetime-local' } })
  const inner = { tagName: 'SPAN' }
  // composedPath 里 input 在祖先位置：点哪一段都归同一个控件。
  doc.click(createClickEvent(inner, { composedPath: () => [inner, input, { tagName: 'BODY' }] }))
  assert.equal(input.calls.showPicker, 1)
})

test('showPicker 不存在（老浏览器）时回退 focus，不抛错', () => {
  const doc = createFakeDocument()
  installNativeDatePickerOnClick({ document: doc })
  const input = createInput({ type: 'date', showPicker: undefined })
  assert.doesNotThrow(() => doc.click(createClickEvent(input)))
  assert.equal(input.calls.focus, 1)
})

test('showPicker 抛错（该类型没有选择器 / 浏览器认为没有用户手势）时回退 focus，不抛给全局兜底', () => {
  const doc = createFakeDocument()
  installNativeDatePickerOnClick({ document: doc })
  let attempts = 0
  const input = createInput({
    type: 'week',
    showPicker() {
      attempts += 1
      throw new DOMException('showPicker requires a user gesture', 'NotAllowedError')
    },
  })
  assert.doesNotThrow(() => doc.click(createClickEvent(input)))
  assert.equal(attempts, 1, '仍应真的尝试过 showPicker')
  assert.equal(input.calls.focus, 1, '失败后要退回聚焦，保留原生默认行为')
})

test('disabled / readonly 直接跳过：不弹选择器也不抢焦点', () => {
  for (const state of [{ disabled: true }, { readOnly: true }]) {
    const doc = createFakeDocument()
    installNativeDatePickerOnClick({ document: doc })
    const input = createInput(state)
    doc.click(createClickEvent(input))
    assert.equal(input.calls.showPicker, 0, `${Object.keys(state)[0]} 时不该打开选择器`)
    assert.equal(input.calls.focus, 0, `${Object.keys(state)[0]} 时不该改焦点`)
  }
  // 直接调 openNativePicker 的返回值也要一致，方便其他入口复用。
  assert.equal(openNativePicker(createInput({ disabled: true })), 'skipped')
  assert.equal(openNativePicker(createInput({ readOnly: true })), 'skipped')
  assert.equal(openNativePicker(null), 'skipped')
})

test('非日期输入与普通元素完全不触发', () => {
  const doc = createFakeDocument()
  installNativeDatePickerOnClick({ document: doc })
  const others = [
    createInput({ type: 'text', attributes: { type: 'text' } }),
    createInput({ type: 'checkbox', attributes: { type: 'checkbox' } }),
    createInput({ type: 'number', attributes: { type: 'number' } }),
    createInput({ type: 'search' }),
    createInput({ type: '' }),
    { tagName: 'SELECT' },
    { tagName: 'BUTTON' },
    { tagName: 'DIV' },
    { tagName: 'INPUT', type: 'text' },
  ]
  for (const target of others) {
    doc.click(createClickEvent(target))
    assert.equal(target.calls?.showPicker ?? 0, 0, `${target.tagName}/${target.type} 不该被劫持`)
    assert.equal(target.calls?.focus ?? 0, 0)
  }
})

test('自带 picker 的自定义日期组件用 data-native-picker="off" 退出，祖先上标记同样生效', () => {
  const ownMark = createInput({ attributes: { type: 'date', 'data-native-picker': 'off' } })
  const wrapper = {}
  const nested = createInput({
    attributes: { type: 'date' },
    closest(selector) {
      return selector === '[data-native-picker="off"]' ? wrapper : null
    },
  })
  for (const input of [ownMark, nested]) {
    const doc = createFakeDocument()
    installNativeDatePickerOnClick({ document: doc })
    doc.click(createClickEvent(input))
    assert.equal(input.calls.showPicker, 0, '已自带 picker 的组件不能被重复打开')
    assert.equal(isPickerOptedOut(input), true)
    assert.equal(resolveNativeDateInput(createClickEvent(input)), null)
  }
})

test('不阻断默认行为：既不 preventDefault 也不 stopPropagation', () => {
  const doc = createFakeDocument()
  installNativeDatePickerOnClick({ document: doc })
  const input = createInput({ type: 'time', attributes: { type: 'time' } })
  const event = createClickEvent(input)
  doc.click(event)
  assert.equal(input.calls.showPicker, 1)
  assert.equal(event.defaultPrevented, false, '阻止默认行为会连带挡掉定位光标与表单提交')
  assert.equal(event.propagationStopped, false, '阻止冒泡会挡掉页面自己的点击逻辑')
})

test('只响应主键点击，中键/右键不抢', () => {
  const doc = createFakeDocument()
  installNativeDatePickerOnClick({ document: doc })
  const input = createInput({ type: 'date' })
  doc.click(createClickEvent(input, { button: 1 }))
  doc.click(createClickEvent(input, { button: 2 }))
  assert.equal(input.calls.showPicker, 0)
  doc.click(createClickEvent(input, { button: 0 }))
  assert.equal(input.calls.showPicker, 1)
})

test('只挂一个 click 监听：重复安装不叠加，dispose 后不再触发', () => {
  const doc = createFakeDocument()
  const disposeFirst = installNativeDatePickerOnClick({ document: doc })
  const disposeSecond = installNativeDatePickerOnClick({ document: doc })
  assert.equal(doc.listenerCount, 1, '重复安装必须幂等')
  const input = createInput({ type: 'date' })
  doc.click(createClickEvent(input))
  assert.equal(input.calls.showPicker, 1, '一次点击只开一次选择器')

  disposeSecond()
  assert.equal(doc.listenerCount, 1, '第二个 dispose 是空操作，不能摘掉仍在用的监听')
  disposeFirst()
  assert.equal(doc.listenerCount, 0)
  doc.click(createClickEvent(input))
  assert.equal(input.calls.showPicker, 1, 'dispose 之后不再处理点击')
})

test('监听挂在捕获阶段，弹层里 stopPropagation 的点击也能收到', () => {
  const doc = createFakeDocument()
  installNativeDatePickerOnClick({ document: doc })
  assert.equal(doc.listeners.length, 1)
  assert.equal(doc.listeners[0].type, 'click')
  assert.equal(doc.listeners[0].options, true, '必须是捕获阶段监听（options 为 true）')
})

test('没有 document（SSR / 单测环境）时安装是安全的空操作', () => {
  const dispose = installNativeDatePickerOnClick({ document: null })
  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(() => dispose())
})

test('isNativeDateInput 认 type 特性：浏览器把 type 属性退化成 text 时仍按日期控件处理', () => {
  const degraded = createInput({ type: 'text', attributes: { type: 'datetime-local' } })
  assert.equal(isNativeDateInput(degraded), true)
  assert.equal(isNativeDateInput(createInput({ type: 'TEXT', attributes: { type: 'TEXT' } })), false)
  assert.equal(isNativeDateInput(null), false)
  assert.equal(isNativeDateInput({ tagName: 'DIV', type: 'date' }), false)
})

test('应用入口注册了全站委托（防止静默丢失）', () => {
  const main = readFileSync(new URL('../../../main.js', import.meta.url), 'utf8')
  assert.match(main, /from '@\/modules\/shared\/composables\/useNativeDatePickerAutoOpen'/)
  assert.equal((main.match(/installNativeDatePickerOnClick\(\)/g) ?? []).length, 1, 'main.js 只注册一次')
})
