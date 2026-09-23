import assert from 'node:assert/strict'
import test from 'node:test'

import { copyTextToClipboard, SENSITIVE_CLIPBOARD_CLEAR_DELAY_MS, scheduleSensitiveClipboardClear } from './clipboard.js'

function fakeDocument({ copyResult = true } = {}) {
  const state = { appended: null, copied: '', removed: false, restoredFocus: false }
  const activeElement = { focus() { state.restoredFocus = true } }
  return {
    state,
    documentObject: {
      activeElement,
      body: {
        appendChild(node) { state.appended = node },
        removeChild(node) { assert.equal(node, state.appended); state.removed = true },
      },
      createElement(tag) {
        assert.equal(tag, 'textarea')
        return {
          value: '',
          style: {},
          setAttribute() {},
          focus() {},
          select() {},
          setSelectionRange(start, end) { state.selection = [start, end] },
        }
      },
      execCommand(command) {
        assert.equal(command, 'copy')
        state.copied = state.appended.value
        return copyResult
      },
    },
  }
}

test('安全上下文优先使用 Clipboard API', async () => {
  let written = ''
  const { documentObject, state } = fakeDocument()
  await copyTextToClipboard('Temp-Password', {
    navigatorObject: { clipboard: { async writeText(value) { written = value } } },
    documentObject,
    secureContext: true,
  })
  assert.equal(written, 'Temp-Password')
  assert.equal(state.appended, null)
})

test('HTTP 页面没有 Clipboard API 时使用隐藏文本框完成复制', async () => {
  const { documentObject, state } = fakeDocument()
  await copyTextToClipboard('One-Time-Secret', {
    navigatorObject: {},
    documentObject,
    secureContext: false,
  })
  assert.equal(state.copied, 'One-Time-Secret')
  assert.deepEqual(state.selection, [0, 'One-Time-Secret'.length])
  assert.equal(state.removed, true)
  assert.equal(state.restoredFocus, true)
})

test('Clipboard API 被权限策略拒绝后继续执行兼容复制', async () => {
  const { documentObject, state } = fakeDocument()
  await copyTextToClipboard('Fallback-Secret', {
    navigatorObject: { clipboard: { async writeText() { throw new Error('denied') } } },
    documentObject,
    secureContext: true,
  })
  assert.equal(state.copied, 'Fallback-Secret')
  assert.equal(state.removed, true)
})

// SEC-X10：敏感复制后的延时自动清除。
test('延时到达且剪贴板仍是原文时自动清空 [SEC-X10 回归]', async () => {
  const timers = []
  const writes = []
  let clipboardValue = 'Temp-Password'
  const navigatorObject = {
    clipboard: {
      async readText() { return clipboardValue },
      async writeText(value) { writes.push(value); clipboardValue = value },
    },
  }
  const result = scheduleSensitiveClipboardClear('Temp-Password', {
    navigatorObject,
    timerObject: { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return 7 } },
  })
  assert.equal(result.supported, true)
  assert.equal(result.timerId, 7)
  assert.equal(timers.length, 1)
  assert.equal(timers[0].ms, SENSITIVE_CLIPBOARD_CLEAR_DELAY_MS)
  await timers[0].fn()
  assert.deepEqual(writes, [''])
})

test('剪贴板已被其它内容覆盖时跳过清除，避免误删 [SEC-X10 回归]', async () => {
  const timers = []
  const writes = []
  const navigatorObject = {
    clipboard: {
      async readText() { return 'user-copied-something-else' },
      async writeText(value) { writes.push(value) },
    },
  }
  scheduleSensitiveClipboardClear('Temp-Password', {
    navigatorObject,
    timerObject: { setTimeout: (fn) => { timers.push(fn); return 1 } },
  })
  await timers[0]()
  assert.deepEqual(writes, [])
})

test('readText 被拒绝时仍清空剪贴板（宁可覆盖不残留明文）[SEC-X10 回归]', async () => {
  const timers = []
  const writes = []
  const navigatorObject = {
    clipboard: {
      async readText() { throw new Error('read permission denied') },
      async writeText(value) { writes.push(value) },
    },
  }
  scheduleSensitiveClipboardClear('Temp-Password', {
    navigatorObject,
    timerObject: { setTimeout: (fn) => { timers.push(fn); return 1 } },
  })
  await timers[0]()
  assert.deepEqual(writes, [''])
})

test('非安全上下文没有 Clipboard API 时返回不支持，由调用方降级提示 [SEC-X10 回归]', () => {
  const result = scheduleSensitiveClipboardClear('Temp-Password', {
    navigatorObject: {},
    timerObject: { setTimeout: () => 1 },
  })
  assert.equal(result.supported, false)
  assert.equal(scheduleSensitiveClipboardClear('', { navigatorObject: {} }).supported, false)
})

test('兼容复制失败时抛错且始终清理明文节点', async () => {
  const { documentObject, state } = fakeDocument({ copyResult: false })
  await assert.rejects(copyTextToClipboard('Do-Not-Leak', {
    navigatorObject: {},
    documentObject,
    secureContext: false,
  }), /copy command was rejected/)
  assert.equal(state.removed, true)
  assert.equal(state.restoredFocus, true)
})
