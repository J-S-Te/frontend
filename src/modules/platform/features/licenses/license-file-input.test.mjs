import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { MAX_LICENSE_BYTES, commitLicense, previewLicense } from './api.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('签发文件外围换行在预览和提交时统一移除，签名内部保持原样', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) })
    return { ok: true, status: 200, headers: { get: () => 'application/json' },
      json: async () => ({ data: {} }) }
  }
  const token = 'signed.payload.signature'
  await previewLicense(`\r\n ${token}\n`)
  await commitLicense(` ${token}\r\n`, {
    digest: 'digest', revision: 41, current_version: 1, pending_digest: '',
  }, true, false)
  assert.equal(requests[0].body.raw_jws, token)
  assert.equal(requests[1].body.raw_jws, token)
  await previewLicense('signed.pay load.signature\n')
  assert.equal(requests[2].body.raw_jws, 'signed.pay load.signature')
})

test('移除外围换行前仍按原始文件大小和私钥规则拒绝非法输入', () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('不应请求') }
  assert.throws(() => previewLicense(' '.repeat(MAX_LICENSE_BYTES) + 'a.b.c'), /256 KiB/)
  assert.throws(() => commitLicense('\n-----BEGIN PRIVATE KEY-----\n', {}, true, false), /私钥/)
  assert.throws(() => previewLicense('\r\n '), /请选择/)
  assert.equal(calls, 0)
})
