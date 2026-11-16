import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { sourceSHA256 } from '../shared/utils/sourceIntegrity.js'

const view = readFileSync(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')

// 用途：执行实际附件摘要函数，只替换浏览器密码接口这一环境边界。
// 参数：provider 为当前浏览器提供的密码接口，HTTP场景没有subtle。
// 返回值：真实组件函数，调用既有共享摘要实现，不替换摘要算法。
function attachmentDigest(provider) {
  const start = view.indexOf('async function sha256File(')
  const end = view.indexOf('\nasync function uploadOpportunityAttachment(', start)
  assert.ok(start >= 0 && end > start, '应存在实际上传前摘要函数')
  return new Function('crypto', 'sourceSHA256',
    `${view.slice(start, end)}\nreturn sha256File`)(
    provider, blob => sourceSHA256(blob, provider),
  )
}

test('HTTP浏览器没有subtle时仍能为原始附件计算正确摘要', async () => {
  const bytes = Buffer.from('合成PDF附件：保留原字节，不跳过摘要校验。'.repeat(300))
  const digest = await attachmentDigest({})(new Blob([bytes]))
  assert.equal(digest, createHash('sha256').update(bytes).digest('hex'))
})

test('HTTPS浏览器的WebCrypto路径继续返回相同的附件摘要', async () => {
  const bytes = Uint8Array.from([0, 128, 255, 1, 10])
  const digest = await attachmentDigest(webcrypto)(new Blob([bytes]))
  assert.equal(digest, createHash('sha256').update(bytes).digest('hex'))
})
