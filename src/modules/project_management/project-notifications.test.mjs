import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { formatUserError } from '../shared/utils/userError.js'
import { notificationTarget, openNotificationTarget } from '../shared/utils/notificationNavigation.js'
import { projectApprovalTarget } from './approvalTasks.js'

const view = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const inbox = await readFile(new URL('./components/ProjectNotificationCenter.vue', import.meta.url), 'utf8')
const popover = await readFile(new URL('./components/ProjectNotificationPopover.vue', import.meta.url), 'utf8')
// 用途：执行真实项目通知组件，替换认证读取与路由外部边界。
// 参数：api 为通知接口及导航替身。
// 返回值：真实收件箱状态、动作、事件及卸载清理入口。
function mountInbox(api) {
  const script = inbox.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  const ref = (value) => ({ value })
  const computed = (read) => ({ get value() { return read() } })
  const emitted = []
  let cleanup = () => {}
  const context = { formatUserError, projectApprovalTarget, ref, computed, onMounted: () => {},
    onBeforeUnmount: callback => { cleanup = callback }, useNotificationStream: () => {},
    window: { location: { origin: 'http://localhost:8081' } },
    defineEmits: () => (event, value) => emitted.push({ event, value }), useConfirmDialog: () => ({
      dialog: ref(null), askConfirm: async () => true, accept() {}, cancel() {},
    }), getNotification: api.getNotification, listInbox: api.listInbox,
    markNotificationRead: api.markNotificationRead,
    deleteReadNotifications: api.deleteReadNotifications || (async () => ({ deleted_count: 0 })),
    useRouter: () => ({ push: api.push || (async () => {}) }), openNotificationTarget,
    notificationTarget: item => notificationTarget(item, 'http://localhost:8081'),
  }
  const state = new Function(...Object.keys(context), `${script}\nreturn { items, total, page, unreadOnly, tab,
    tabs, loading, error, detail, projectTarget, load, open, changeFilter, changePage, changeTab }`)(
    ...Object.values(context))
  return { ...state, emitted, unmount: () => cleanup() }
}
test('项目系统挂载个人通知页面并提供侧栏和铃铛入口', () => {
  assert.match(view, /key: 'notifications', label: '个人通知中心'/)
  assert.match(view, /ProjectNotificationCenter v-else-if="activeSection === 'notifications'"/)
  assert.match(popover, /查看全部通知/)
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
test('本系统/跨系统页签按来源收窄平台收件箱', async () => {
  const queries = []
  const state = mountInbox({ listInbox: async (value) => { queries.push(value); return { items: [], total: 0 } } })
  state.tab.value = 'local'
  await state.load()
  state.tab.value = 'cross'
  await state.load()
  assert.equal(queries[0].sourceApplication, 'project_management')
  assert.equal(queries[1].excludeSourceApplication, 'project_management')
})

test('个人通知复用当前用户站内信接口，提供真实分页、未读筛选和详情已读', () => {
  assert.match(inbox, /sourceApplication: 'project_management'/) 
  assert.match(inbox, /excludeSourceApplication: 'project_management'/) 
  assert.match(inbox, /listInbox\(\{ page: page\.value, pageSize, unreadOnly: unreadOnly\.value, \.\.\.scope \}\)/)
  assert.match(inbox, /Math\.ceil\(total\.value \/ pageSize\)/)
  assert.match(inbox, /getNotification\(item\.delivery_id\)/)
  assert.match(inbox, /markNotificationRead\(item\.delivery_id\)/)
  assert.match(inbox, /sequence !== loadSequence/)
  assert.doesNotMatch(inbox, /user_id:|tenant_id:|v-html/)
  assert.match(inbox, /notificationTarget\(detail\.value\)/)
})

test('项目通知的跨系统目标也通过统一校验并直接进入对应审批页面', async () => {
  const visits = []
  const state = mountInbox({
    getNotification: async () => ({ delivery_id: 'cross', read_at: 'read',
      target_url: '/contract_management/approvals?approval_id=approval' }),
    push: async path => { visits.push(path) },
  })
  await state.open({ delivery_id: 'cross' })
  assert.deepEqual(visits, ['/contract_management/approvals?approval_id=approval'])
  assert.equal(state.projectTarget.value, visits[0])
})


test('审批通知在个人中心直接进入对应申请，已读失败仍跳转并独立提醒', async () => {
  const item = { delivery_id: 'approval-1', source_application: 'project_management',
    reference_type: 'PROJECT_APPROVAL', reference_id: 'req-1', category: 'ROLLBACK_REQUESTED',
    target_url: '/project_management/approvals?request_id=req-1', read_at: null }
  for (const failRead of [false, true]) {
    const state = mountInbox({ listInbox: async () => ({ items: [], total: 0 }),
      getNotification: async () => item,
      markNotificationRead: async () => { if (failRead) throw new Error('read unavailable') },
    })
    await state.open(item)
    assert.ok(state.emitted.some(entry => entry.event === 'open-approval'
      && entry.value === '/project_management/approvals?request_id=req-1'))
    assert.equal(state.emitted.some(entry => entry.event === 'read-error'), failRead)
    assert.equal(state.detail.value, null)
  }
})

test('个人中心审批入口以详情为准，读取失败或卸载后不沿用摘要申请', async () => {
  const item = { delivery_id: 'approval-1', source_application: 'project_management',
    reference_type: 'PROJECT_APPROVAL', reference_id: 'old', category: 'ROLLBACK_REQUESTED',
    target_url: '/project_management/approvals?request_id=old' }
  const current = { ...item, reference_id: 'current', read_at: 'already-read',
    target_url: '/project_management/approvals?request_id=current' }
  const state = mountInbox({ getNotification: async () => current })
  await state.open(item)
  assert.ok(state.emitted.some(entry => entry.event === 'open-approval'
    && entry.value === '/project_management/approvals?request_id=current'))
  const failed = mountInbox({ getNotification: async () => { throw new Error('无权读取通知') } })
  await failed.open(item)
  assert.deepEqual(failed.emitted, [])
  assert.match(failed.error.value, /无权读取通知/)
  let finish
  const late = mountInbox({ getNotification: () => new Promise(resolve => { finish = resolve }) })
  const pending = late.open(item)
  late.unmount()
  finish(current)
  await pending
  assert.deepEqual(late.emitted, [])
})
