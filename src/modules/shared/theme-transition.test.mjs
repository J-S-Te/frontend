import test from 'node:test'
import assert from 'node:assert/strict'
import { runThemeChange, shouldAnimateTheme } from './theme/themeTransition.js'

function fakeWindow({ reduced = false } = {}) {
  return { matchMedia: () => ({ matches: reduced }) }
}

test('无 View Transitions 时立即换肤，不创建过渡', () => {
  let applied = 0
  const doc = { documentElement: {}, visibilityState: 'visible' }
  const handle = runThemeChange(() => { applied += 1 }, { document: doc, window: fakeWindow() })
  assert.equal(applied, 1)
  assert.equal(handle, null)
})

test('降敏或页面隐藏时不做整帧过渡', () => {
  const doc = {
    startViewTransition: () => { throw new Error('不应调用') },
    visibilityState: 'visible',
  }
  assert.equal(shouldAnimateTheme(doc, fakeWindow({ reduced: true })), false)
  assert.equal(shouldAnimateTheme({ ...doc, visibilityState: 'hidden' }, fakeWindow()), false)
  let applied = 0
  runThemeChange(() => { applied += 1 }, { document: doc, window: fakeWindow({ reduced: true }) })
  assert.equal(applied, 1)
})

test('支持时用 startViewTransition 包住一次同步写入', () => {
  let applied = 0
  let received = null
  const doc = {
    visibilityState: 'visible',
    startViewTransition(callback) {
      received = callback()
      return { finished: Promise.resolve() }
    },
  }
  const handle = runThemeChange(() => { applied += 1 }, { document: doc, window: fakeWindow() })
  assert.equal(applied, 1)
  assert.ok(handle)
  assert.equal(received, undefined)
})
