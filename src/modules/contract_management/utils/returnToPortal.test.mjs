import assert from 'node:assert/strict'
import test from 'node:test'
import { closeSubsystemTabOrFallback } from './returnToPortal.js'

function browserTab({ closeAllowed = true, closeThrows = false } = {}) {
  let callback
  return {
    tab: {
      closed: false,
      close() {
        if (closeThrows) throw new Error('blocked')
        if (closeAllowed) this.closed = true
      },
      setTimeout(next, delay) {
        callback = next
        assert.equal(delay, 100)
      },
    },
    runFallbackCheck() { callback() },
  }
}

test('closes a portal-opened subsystem tab without replacing it', () => {
  const current = browserTab()
  let fallbackCalls = 0
  closeSubsystemTabOrFallback(current.tab, () => { fallbackCalls += 1 })
  current.runFallbackCheck()
  assert.equal(current.tab.closed, true)
  assert.equal(fallbackCalls, 0)
})

test('returns to the portal in the same tab when the browser blocks close', () => {
  for (const options of [{ closeAllowed: false }, { closeThrows: true }]) {
    const current = browserTab(options)
    let fallbackCalls = 0
    closeSubsystemTabOrFallback(current.tab, () => { fallbackCalls += 1 })
    current.runFallbackCheck()
    assert.equal(fallbackCalls, 1)
  }
})
