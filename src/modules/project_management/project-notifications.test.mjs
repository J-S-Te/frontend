import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const view = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const inbox = await readFile(new URL('./components/ProjectNotificationCenter.vue', import.meta.url), 'utf8')
function mountInbox(api) {
  const script = inbox.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  const ref = (value) => ({ value })
  const computed = (read) => ({ get value() { return read() } })
  const emitted = []
  return new Function('ref', 'computed', 'onMounted', 'defineEmits', 'getNotification', 'listInbox', 'markNotificationRead', 'window', `${script}\nreturn { items, total, page, unreadOnly, loading, error, detail, projectTarget, load, open, changeFilter, changePage }`)(ref, computed, () => {}, () => (event) => emitted.push(event), api.getNotification, api.listInbox, api.markNotificationRead, { location: { origin: 'http://localhost:8081' } })
}
test('项目系统挂载个人通知页面并提供侧栏和铃铛入口', () => {
  assert.match(view, /key: 'notifications', label: '个人通知中心'/)
  assert.match(view, /ProjectNotificationCenter v-if="activeSection === 'notifications'"/)
  assert.match(view, /查看全部通知/)
})

test('通知列表请求携带当前页和未读筛选，并显示服务端分页总数', async () => {
  let query
  const state = mountInbox({ listInbox: async (value) => { query = value; return { items: [{ delivery_id: 'one' }], total: 45 } } })
  state.page.value = 2
  state.unreadOnly.value = true
  await state.load()
  assert.deepEqual(query, { page: 2, pageSize: 20, unreadOnly: true })
  assert.equal(state.total.value, 45)
  assert.equal(state.items.value[0].delivery_id, 'one')
})

test('读取未读通知保存已读后刷新列表，已经读过的不重复回写', async () => {
  const writes = []
  const state = mountInbox({
    listInbox: async () => ({ items: [], total: 0 }),
    getNotification: async (id) => ({ delivery_id: id, title: '通知', content: '正文', read_at: id === 'read' ? '2026-10-08' : null }),
    markNotificationRead: async (id) => writes.push(id),
  })
  await state.open({ delivery_id: 'unread' })
  assert.deepEqual(writes, ['unread'])
  assert.ok(state.detail.value.read_at)
  await state.open({ delivery_id: 'read' })
  assert.deepEqual(writes, ['unread'])
})

test('过期响应不会覆盖最新筛选，网络异常和不安全跳转不会伪装成功', async () => {
  let resolveOld
  let calls = 0
  const state = mountInbox({ listInbox: () => ++calls === 1 ? new Promise((resolve) => { resolveOld = resolve }) : Promise.resolve({ items: [{ delivery_id: 'new' }], total: 1 }) })
  const old = state.load()
  await state.load()
  resolveOld({ items: [{ delivery_id: 'old' }], total: 50 })
  await old
  assert.equal(state.items.value[0].delivery_id, 'new')
  state.detail.value = { target_url: 'https://evil.example/project_management/projects' }
  assert.equal(state.projectTarget.value, '')
  state.detail.value = { target_url: '/project_management/projects' }
  assert.equal(state.projectTarget.value, '/project_management/projects')
  const failed = mountInbox({ listInbox: async () => { throw new Error('服务不可用') } })
  await failed.load()
  assert.equal(failed.error.value, '服务不可用')
  assert.equal(failed.loading.value, false)
})
test('个人通知复用当前用户站内信接口，提供真实分页、未读筛选和详情已读', () => {
  assert.match(inbox, /listInbox\(\{ page: page\.value, pageSize, unreadOnly: unreadOnly\.value \}\)/)
  assert.match(inbox, /Math\.ceil\(total\.value \/ pageSize\)/)
  assert.match(inbox, /getNotification\(item\.delivery_id\)/)
  assert.match(inbox, /markNotificationRead\(item\.delivery_id\)/)
  assert.match(inbox, /sequence !== loadSequence/)
  assert.doesNotMatch(inbox, /user_id:|tenant_id:|v-html/)
  assert.match(inbox, /url\.origin === window\.location\.origin/)
  assert.match(inbox, /url\.pathname\.startsWith\('\/project_management\/'\)/)
})
