import assert from 'node:assert/strict'
import test from 'node:test'

import { copyTextToClipboard } from './clipboard.js'

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
