import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { MAX_LICENSE_BYTES, restoreLicenseClock } from './api.js'
import {
  CLOCK_RECOVERY_CONFIRMATION,
  CLOCK_RECOVERY_FAILURE_NEXT,
  CLOCK_RECOVERY_READONLY_HINT,
  CLOCK_RECOVERY_RISKS,
  CLOCK_RECOVERY_SUCCESS,
  clockRecoveryEntryVisible,
  clockRecoveryReady,
  clockRecoverySubmitted,
  clockRecoverySummary,
} from './clock-recovery.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
function respond(data, status = 200) {
  return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => ({ data, message: '时间恢复凭据已消费' }) }
}

test('时钟恢复必须“勾选确认 + 提交”两步，缺一步都不发请求', () => {
  // 只有勾选没有凭据、只有凭据没有勾选、只读账号、正在提交，四种情况都不能提交。
  assert.equal(clockRecoveryReady({ canManage: true, raw: 'token', confirmed: false }), false)
  assert.equal(clockRecoveryReady({ canManage: true, raw: '   ', confirmed: true }), false)
  assert.equal(clockRecoveryReady({ canManage: false, raw: 'token', confirmed: true }), false)
  assert.equal(clockRecoveryReady({ canManage: true, raw: 'token', confirmed: true, busy: true }), false)
  assert.equal(clockRecoveryReady(), false, '缺省参数不能放行')
  // 两项确认都满足才允许提交，且首尾空白不影响判定。
  assert.equal(clockRecoveryReady({ canManage: true, raw: ' token ', confirmed: true }), true)
  assert.equal(clockRecoveryReady({ canManage: true, raw: 'token', confirmed: true, busy: false }), true)
})

test('只读账号没有可点击的恢复入口，只显示联系管理员的指引', () => {
  assert.equal(clockRecoveryEntryVisible({ status: { clock_blocked: true }, canManage: false }), false)
  assert.equal(clockRecoveryEntryVisible({ status: { clock_blocked: false }, canManage: true }), false)
  assert.equal(clockRecoveryEntryVisible({ status: { clock_blocked: true }, canManage: true }), true)
  assert.equal(clockRecoveryEntryVisible(), false)
  assert.match(CLOCK_RECOVERY_READONLY_HINT, /platform:license:manage/)
  assert.match(CLOCK_RECOVERY_READONLY_HINT, /联系授权管理员/)
})

test('风险说明与提交后的提示都强调凭据一次性', () => {
  assert.ok(CLOCK_RECOVERY_RISKS.length >= 3)
  const risks = CLOCK_RECOVERY_RISKS.join(' ')
  assert.match(risks, /只能使用一次/)
  assert.match(risks, /不写入浏览器存储/)
  assert.match(risks, /输入框自动清空/)
  assert.match(CLOCK_RECOVERY_CONFIRMATION, /确认/)
  assert.doesNotMatch(CLOCK_RECOVERY_CONFIRMATION, /自动|默认/, '确认必须由用户主动勾选')
  assert.match(CLOCK_RECOVERY_SUCCESS, /恢复凭据已消费/)
  assert.match(CLOCK_RECOVERY_SUCCESS, /不可重复使用/)
  assert.match(clockRecoverySummary(true), /不可重复使用/)
  assert.match(clockRecoverySummary(false), /刷新授权状态/)
  assert.match(CLOCK_RECOVERY_FAILURE_NEXT, /已被消费/, '失败后不能假设凭据没被消费')
})

test('提交尝试一结束就清空凭据并撤销勾选', () => {
  // 无论成功还是失败都走同一份复位：凭据不能留在输入框里被再次提交。
  assert.deepEqual(clockRecoverySubmitted(), { raw: '', confirmed: false })
})

test('恢复凭据只进请求体，不拼进 URL、不持久化', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url: String(url), options }); return respond({ revision: 4 }) }
  const token = 'recovery.jws.value'
  await restoreLicenseClock(`  ${token}\n`)
  assert.equal(requests.length, 1)
  assert.match(requests[0].url, /\/api\/v1\/licenses\/clock-recoveries$/)
  assert.doesNotMatch(requests[0].url, /recovery\.jws/, '凭据不得出现在 URL 里')
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(requests[0].options.credentials, 'include')
  assert.equal(requests[0].options.cache, 'no-store')
  // 首尾空白会被裁掉，请求体只有契约字段。
  assert.deepEqual(JSON.parse(requests[0].options.body), { raw_jws: token })
})

test('空凭据、超长凭据与私钥在本地就被拒绝，不发出请求', async () => {
  let called = 0
  globalThis.fetch = async () => { called += 1; return respond({}) }
  assert.throws(() => restoreLicenseClock(''), /请粘贴/)
  assert.throws(() => restoreLicenseClock('   '), /请粘贴/)
  assert.throws(() => restoreLicenseClock(null), /请粘贴/)
  assert.throws(() => restoreLicenseClock('-----BEGIN PRIVATE KEY-----'), /私钥/)
  assert.throws(() => restoreLicenseClock('a'.repeat(MAX_LICENSE_BYTES + 1)), /256 KiB/)
  assert.equal(called, 0)
})

test('恢复失败的响应保留可复制的错误码与请求标识', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    headers: { get: () => 'application/json' },
    json: async () => ({ code: 'LICENSE_VERSION_CONFLICT', message: '授权状态已变化', request_id: 'req-abc:1' }),
  })
  await assert.rejects(restoreLicenseClock('recovery.jws.value'), error => {
    assert.equal(error.status, 409)
    assert.equal(error.code, 'LICENSE_VERSION_CONFLICT')
    assert.ok(error.traceId || error.requestId, '错误对象保留请求标识供页面展示')
    return true
  })
})

test('授权页把恢复入口放在权限与勾选之后，且从不持久化凭据', () => {
  const source = readFileSync(new URL('./CommercialLicenseView.vue', import.meta.url), 'utf8')
  // 两步确认：勾选框 + 只有两项都满足才可点的提交按钮。
  assert.match(source, /v-model="clockConfirmed"/)
  assert.match(source, /:disabled="!clockReady"/)
  assert.match(source, /clockRecoveryReady\(/)
  assert.match(source, /restoreLicenseClock\(credential\)/)
  // 只读账号只有文字指引，没有可点按钮。
  assert.match(source, /CLOCK_RECOVERY_READONLY_HINT/)
  // 凭据不进 localStorage/sessionStorage、不进地址栏。
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/)
  assert.doesNotMatch(source, /location\.(?:href|hash|search)\s*=/)
  // 提交后清空输入框与勾选。
  assert.match(source, /clockRecoverySubmitted\(\)/)
  // 刷新只在写入成功之后发生：刷新失败不能反过来报“恢复未完成”。
  assert.match(source, /restored = true[\s\S]*?await refreshAfterWrite\(\)/)
  const api = readFileSync(new URL('./api.js', import.meta.url), 'utf8')
  assert.doesNotMatch(api, /\$\{raw\}|raw_jws=\$\{|\?raw_jws/, '凭据不能被拼进 URL')
})
