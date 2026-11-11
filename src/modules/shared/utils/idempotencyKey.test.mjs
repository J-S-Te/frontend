// 幂等键生成的降级回归护栏。
//
// 现场缺陷：明文 HTTP（非安全上下文）部署下 crypto.randomUUID 为 undefined，
// 直接调用会让写操作在构造 Idempotency-Key 请求头时抛 TypeError，业务被阻断。
// 这里按“有/无 randomUUID”两类浏览器环境验证同一个生成器，并确认 CRM 客户端
// 复用的是同一份实现，避免两个模块各写一套后再次分叉。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createIdempotencyKey } from './idempotencyKey.js'
import { createIdempotencyKey as createCRMIdempotencyKey } from '../../customer_opportunity/api/client.js'

// 用途：临时替换 globalThis.crypto，返回恢复函数。
// 参数：value 为模拟的 crypto 对象，传 undefined 表示浏览器完全没有 crypto 全局。
// 返回值：无参恢复函数。
function withCrypto(value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, enumerable: true, writable: true, value })
  return () => {
    if (original) Object.defineProperty(globalThis, 'crypto', original)
    else delete globalThis.crypto
  }
}

test('安全上下文优先使用 crypto.randomUUID', () => {
  const restore = withCrypto({ randomUUID: () => '0b6f3a2e-1111-4222-8333-444455556666' })
  try {
    assert.equal(createIdempotencyKey(), '0b6f3a2e-1111-4222-8333-444455556666')
  } finally { restore() }
})

test('非安全上下文（crypto 存在但无 randomUUID）降级为 fallback 键', () => {
  // 明文 HTTP 下浏览器保留 crypto.getRandomValues，但 randomUUID 不存在。
  const restore = withCrypto({ getRandomValues: (bytes) => bytes })
  try {
    const key = createIdempotencyKey()
    assert.match(key, /^fallback-[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/, '降级键格式稳定且带 fallback 前缀')
    assert.ok(key.length >= 16 && key.length <= 80, `降级键长度应合理，实际 ${key.length}`)
    assert.doesNotThrow(() => createIdempotencyKey(), '不能再抛异常中断写操作')
  } finally { restore() }
})

test('连续生成的降级键互不相同', () => {
  const restore = withCrypto({})
  try {
    const keys = new Set(Array.from({ length: 200 }, () => createIdempotencyKey()))
    assert.equal(keys.size, 200, '同一毫秒内的连续调用也必须唯一，重放靠复用原键而不是碰撞')
  } finally { restore() }
})

test('完全没有 crypto 全局时仍能生成幂等键', () => {
  const restore = withCrypto(undefined)
  try {
    assert.match(createIdempotencyKey(), /^fallback-/)
  } finally { restore() }
})

test('randomUUID 存在但调用抛错时继续降级', () => {
  const restore = withCrypto({ randomUUID: () => { throw new TypeError('crypto.randomUUID is not a function') } })
  try {
    assert.match(createIdempotencyKey(), /^fallback-/)
  } finally { restore() }
})

test('CRM 客户端复用同一份幂等键实现，非安全上下文不再抛异常', () => {
  assert.equal(createCRMIdempotencyKey, createIdempotencyKey, 'CRM 客户端必须导出同一实现，避免两套逻辑分叉')
  const restore = withCrypto({ getRandomValues: (bytes) => bytes })
  try {
    assert.match(createCRMIdempotencyKey(), /^fallback-/)
  } finally { restore() }
})
