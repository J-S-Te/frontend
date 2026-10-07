import test from 'node:test'
import assert from 'node:assert/strict'
import { pollDeployment } from './deploymentPolling.mjs'

test('deployment observer reports terminal states without more reads', async () => {
  for (const status of ['READY', 'PROVISION_FAILED', 'OFFBOARDED']) {
    let reads = 0
    assert.equal(await pollDeployment({ wait: async () => {}, readStatus: async () => {
      reads += 1
      return { status }
    } }), status)
    assert.equal(reads, 1)
  }
})
test('observer cancellation does not publish a late result', async () => {
  const controller = new AbortController()
  let published = false
  assert.equal(await pollDeployment({ signal: controller.signal, wait: async () => {},
    readStatus: async () => { controller.abort(); return { status: 'READY' } },
    onStatus: () => { published = true } }), 'CANCELLED')
  assert.equal(published, false)
})
test('unmount cancels a pending delay before any status request', async () => {
  const controller = new AbortController()
  const result = pollDeployment({ signal: controller.signal, intervalMs: 10000,
    readStatus: async () => { assert.fail('cancelled observer must not query') } })
  controller.abort()
  assert.equal(await result, 'CANCELLED')
})
test('status errors remain visible instead of being swallowed until timeout', async () => {
  await assert.rejects(pollDeployment({ wait: async () => {}, readStatus: async () => {
    throw new Error('permission denied')
  } }), /permission denied/)
})
test('timeout stops polling without reporting success', async () => {
  let clock = 0
  assert.equal(await pollDeployment({ now: () => clock, timeoutMs: 5, intervalMs: 1,
    wait: async (ms) => { clock += ms }, readStatus: async () => ({ status: 'UPDATING' }) }), 'TIMEOUT')
})
