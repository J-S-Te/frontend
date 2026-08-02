import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const jsonResponse = (data, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } })

test('project message API encodes opaque IDs and binds idempotency headers', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  globalThis.fetch = async (url, options = {}) => { calls.push({ url, options }); return jsonResponse({ id: 'conversation-1' }) }
  const api = await import(`./portal.js?project-message=${Date.now()}`)
  await api.createProjectConversation('P/1', 'create-key-1')
  await api.getProjectConversation('P/1', { before: 'opaque-anchor', page_size: 100 })
  await api.sendProjectConversationMessage('C/1', '纯文本', 'message-key-1')
  await api.readProjectConversationMessages('C/1', ['cursor-1', 'cursor-2'])
  assert.equal(calls[0].url, '/customer-portal/api/v1/projects/P%2F1/conversation')
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'create-key-1')
  assert.equal(calls[1].url, '/customer-portal/api/v1/projects/P%2F1/conversation?before=opaque-anchor&page_size=100')
  assert.equal(calls[2].url, '/customer-portal/api/v1/project-conversations/C%2F1/messages')
  assert.equal(calls[2].options.headers['Idempotency-Key'], 'message-key-1')
  assert.deepEqual(JSON.parse(calls[2].options.body), { content: '纯文本' })
  assert.equal(calls[3].url, '/customer-portal/api/v1/project-conversations/C%2F1/read')
  assert.deepEqual(JSON.parse(calls[3].options.body), { message_cursors: ['cursor-1', 'cursor-2'] })
})

test('project message UI fails closed and preserves retry keys', async () => {
  const view = await readFile(new URL('../views/CustomerPortalView.vue', import.meta.url), 'utf8')
  assert.match(view, /manager_message_available/)
  assert.match(view, /姓名和脱敏联系方式不代表可投递身份/)
  assert.match(view, /projectConversationRetryKeys\.get\(projectId\)/)
  assert.match(view, /projectMessageRetryKeys\.get\(fingerprint\)/)
  assert.match(view, /hasPermission\('project\.message\.send'\)/)
  assert.match(view, /maxlength="2000"/)
  assert.match(view, /加载更早消息/)
  assert.match(view, /before: messages\.next_before/)
  assert.match(view, /\.\.\.\(older\.messages\?\.items \|\| \[\]\), \.\.\.\(messages\.items \|\| \[\]\)/)
  assert.match(view, /acknowledgeVisibleManagerMessages/)
  assert.match(view, /managerMessageCursors/)
  assert.match(view, /messages\?\.has_more/)
  assert.match(view, /消息已显示，但已读状态同步失败/)
})
