import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmbedSessionActivity } from './embedSessionActivity.js'

test('isolated dashboard accepts only this frame generation and visible sequenced input', () => {
  let handleMessage
  let count = 0
  const parentDocument = { visibilityState: 'visible' }
  let challenge
  const frame = { src: 'https://bi.example/data_analysis/api/v1/embed-proxy/fixture', contentWindow: { postMessage(data, origin) {
    assert.equal(origin, 'https://bi.example')
    challenge = data.nonce
  } } }
  const bridge = createEmbedSessionActivity({ getFrame: () => frame,
    getURL: () => 'https://bi.example/data_analysis/api/v1/embed-proxy/fixture',
    documentRef: parentDocument, windowRef: {
      addEventListener(name, fn) { assert.equal(name, 'message'); handleMessage = fn },
      removeEventListener() {},
    }, onActivity: () => { count += 1 }, cryptoImpl: { getRandomValues(bytes) { bytes.fill(4); return bytes } },
  })
  bridge.initialize(frame)
  assert.equal(count, 0, 'loading or focus is never interaction')
  handleMessage({ source: frame.contentWindow, origin: 'https://bi.example',
    data: { type: 'platform-session:activity', nonce: challenge, sequence: 1, input: 'wheel' } })
  assert.equal(count, 1)
  handleMessage({ source: {}, origin: 'https://bi.example', data: { type: 'platform-session:activity', nonce: '04'.repeat(32), sequence: 2, input: 'keydown' } })
  handleMessage({ source: frame.contentWindow, origin: 'https://evil.example', data: {} })
  handleMessage({ source: frame.contentWindow, origin: 'https://bi.example', data: { type: 'platform-session:activity', nonce: '04'.repeat(32), sequence: 1, input: 'wheel' } })
  assert.equal(count, 1, 'wrong source, origin and replay are refused')
  parentDocument.visibilityState = 'hidden'
  handleMessage({ source: frame.contentWindow, origin: 'https://bi.example',
    data: { type: 'platform-session:activity', nonce: challenge, sequence: 2, input: 'keydown' } })
  assert.equal(count, 1)
  bridge.reset(); parentDocument.visibilityState = 'visible'
  handleMessage({ source: frame.contentWindow, origin: 'https://bi.example',
    data: { type: 'platform-session:activity', nonce: challenge, sequence: 3, input: 'input' } })
  assert.equal(count, 1)
  bridge.destroy()
})
