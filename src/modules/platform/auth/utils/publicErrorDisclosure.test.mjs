import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { userSafeErrorMessage } from '../../shared/api/request.js'
import { AuthError, loginWithPassword } from '../api/auth.js'

const loginViewSource = await readFile(new URL('../views/LoginView.vue', import.meta.url), 'utf8')
const forcePasswordSource = await readFile(new URL('../views/ForcePasswordChangeView.vue', import.meta.url), 'utf8')
const requestSource = await readFile(new URL('../../shared/api/request.js', import.meta.url), 'utf8')

test('未登录页面不展示追踪号/trace 文本 [SEC-X4 回归]', () => {
  // 断言针对真实渲染模式（“追踪号：xxx”后缀与 ${...traceId} 插值），允许注释说明其存在理由。
  for (const source of [loginViewSource, forcePasswordSource]) {
    assert.doesNotMatch(source, /追踪号：/)
    assert.doesNotMatch(source, /\$\{[^}]*traceId[^}]*\}/)
  }
})

test('request.js 用 userSafeErrorMessage 过滤面向展示的 message [SEC-X4 回归]', () => {
  assert.match(requestSource, /export function userSafeErrorMessage/)
  assert.match(requestSource, /userSafeErrorMessage\(body\?\.message\) \|\| userSafeErrorMessage\(body\?\.msg\) \|\| failureMessage/)
  // 结构化排障字段仍保留给权限门控内的管理台。
  assert.match(requestSource, /nextAction: body\?\.details\?\.next_action/)
  assert.match(requestSource, /traceId: body\?\.request_id \|\| body\?\.trace_id \|\| body\?\.traceId/)
})

test('userSafeErrorMessage 拒绝实现细节、放行本地化文案 [SEC-X4 回归]', () => {
  const leaky = [
    'upstream /api/v1/subsystem-onboarding failed',
    'see https://internal.example.com/debug',
    'trace_id=abc-123 请查询链路',
    'next_action: 重启 platform-api 后重试',
    'SQLSTATE connection refused',
    'panic: runtime error',
  ]
  for (const message of leaky) {
    assert.equal(userSafeErrorMessage(message), '', message + ' 应被过滤')
  }
  assert.equal(userSafeErrorMessage('账号或密码错误，请重新输入。'), '账号或密码错误，请重新输入。')
  assert.equal(userSafeErrorMessage(null), '')
  assert.equal(userSafeErrorMessage('  '), '')
})

function jsonResponse(payload, init = {}) {
  return {
    ok: init.status ? init.status < 400 : true,
    status: init.status ?? 200,
    headers: {
      get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

test('登录失败时展示过滤后的安全文案，trace 仅留在错误对象 [SEC-X4 回归]', async () => {
  globalThis.fetch = async () => jsonResponse({
    code: 'INVALID_CREDENTIALS',
    message: 'invalid credentials for /api/v1/accounts lookup',
    request_id: 'internal-trace-9911',
    details: { detail: 'gorm: record not found', next_action: '检查数据库' },
  }, { status: 401 })

  await assert.rejects(
    () => loginWithPassword({ account: 'alice', password: 'secret1' }),
    (error) => {
      assert.ok(error instanceof AuthError)
      // 泄露实现细节的后端 message 被整体丢弃，回退到本地化 failureMessage。
      assert.equal(error.message, '账号或密码错误，请重新输入。')
      assert.ok(!error.message.includes('/api/'))
      // trace 仍保留在对象上供服务端日志对账，但未登录页面不会渲染它。
      assert.equal(error.traceId, 'internal-trace-9911')
      return true
    },
  )
  delete globalThis.fetch
})
