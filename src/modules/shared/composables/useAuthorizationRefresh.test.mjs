import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('页面可见时每 15 秒补查一次授权，卸载后清理计时器', async () => {
  const source = readFileSync(new URL('./useAuthorizationRefresh.js', import.meta.url), 'utf8')
    .replace(/^import.*\n/, '').replace('export function', 'function')
  let tick, interval, unmount, calls = 0
  const cleared = []
  const doc = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  const host = {
    addEventListener() {}, removeEventListener() {},
    setInterval(handler, value) { tick = handler; interval = value; return 7 },
    clearInterval(id) { cleared.push(id) },
  }
  const setup = new Function('onMounted', 'onBeforeUnmount', 'window', 'document',
    source + '\nreturn useAuthorizationRefresh')
  const useRefresh = setup(callback => callback(), callback => { unmount = callback }, host, doc)
  useRefresh(async () => { calls++ })
  assert.equal(interval, 15000)
  tick()
  await Promise.resolve()
  assert.equal(calls, 1)
  doc.visibilityState = 'hidden'
  tick()
  assert.equal(calls, 1)
  unmount()
  assert.deepEqual(cleared, [7])
})
