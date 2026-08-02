import assert from 'node:assert/strict'
import test from 'node:test'

test('Portal feedback API uses cookie session, CSRF and idempotency', async () => {
  const originalFetch = globalThis.fetch
  const originalCrypto = globalThis.crypto
  const calls = []
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'feedback-idempotency-key' } })
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ code: 'OK', data: { id: 'feedback-public', items: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const api = await import(`./portal.js?feedback-test=${Date.now()}`)
    await api.createFeedback({ type: 'COMPLAINT', title: '问题', description: '详情' })
    await api.listFeedbacks({ page: 1, page_size: 20 })
    await api.addFeedbackMessage('feedback-public', '补充')
    await api.closeFeedback('feedback-public', 'stable-close-key')
    assert.equal(calls[0].options.credentials, 'include')
    assert.equal(calls[0].options.headers['Idempotency-Key'], 'feedback-idempotency-key')
    assert.equal(calls[0].options.headers['X-CSRF-Token'], '1')
    assert.match(calls[1].url, /\/feedbacks\?page=1&page_size=20$/)
    assert.equal(calls[2].options.headers['Idempotency-Key'], 'feedback-idempotency-key')
    assert.equal(JSON.parse(calls[2].options.body).content, '补充')
    assert.equal(calls[3].options.method, 'POST')
    assert.equal(calls[3].options.headers['X-CSRF-Token'], '1')
    assert.equal(calls[3].options.headers['Idempotency-Key'], 'stable-close-key')
    assert.match(calls[3].url, /\/feedbacks\/feedback-public\/close$/)
  } finally {
    globalThis.fetch = originalFetch
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto })
  }
})

test('Portal feedback and security views fail closed by exact permission', async () => {
  const { readFile } = await import('node:fs/promises')
  const view = await readFile(new URL('../views/CustomerPortalView.vue', import.meta.url), 'utf8')

  assert.match(view, /\['feedback\.create', 'feedback\.read', 'feedback\.reply'\]\.some\(hasPermission\)/)
  assert.match(view, /section\.value === 'feedback' && hasPermission\('feedback\.read'\)/)
  assert.match(view, /if \(hasPermission\('feedback\.read'\)\) await load\(\)/)
  assert.match(view, /hasPermission\('feedback\.reply'\) && !\['CLOSED','REJECTED'\]/)
  assert.match(view, /hasPermission\('feedback\.reply'\) && selectedFeedback\.feedback\.status === 'RESOLVED'/)
  assert.match(view, /feedbackCloseRetryKeys\.get\(feedbackID\)/)
  assert.match(view, /closeFeedback\(feedbackID, idempotencyKey\)/)
  assert.match(view, /feedbackCloseRetryKeys\.delete\(feedbackID\)/)
  assert.match(view, /:disabled="feedbackClosing"/)
  assert.match(view, /section\.value === 'security' && hasPermission\('account\.security\.manage'\)/)
  assert.match(view, /v-if="hasPermission\('account\.security\.manage'\)"[^>]*>账号安全/)
  assert.match(view, /当前账号没有反馈相关权限/)
  assert.match(view, /当前账号没有账户安全管理权限/)
})
