import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { ref } from 'vue'
import * as Vue from 'vue'
import { compile } from '@vue/compiler-dom'
import { renderToString } from '@vue/server-renderer'
import { parse as parseJavaScript } from '@babel/parser'
import { authorizationScopeKey } from '../shared/authz/authorizationSnapshot.js'

const source = readFileSync(new URL('./views/CustomerPortalView.vue', import.meta.url), 'utf8')

// notificationOpenHarness 执行真实已读与详情函数并允许延迟网络回执。
// 参数：kind 为反馈或报告栏目，read 为可控的已读HTTP边界。
// 返回值：真实打开入口、可见状态和网络调用记录。
function notificationOpenHarness(kind, read) {
  const calls = []
  const context = {
    section: ref(kind), hasPermission: () => true,
    feedbackDetailGeneration: 0, reportDetailGeneration: 0,
    feedbackNotificationOpening: new Set(), reportNotificationOpening: new Set(),
    feedbackNotifications: ref([{ id: 'notice-a', status: 'UNREAD' }]),
    reportNotifications: ref([{ id: 'notice-a', status: 'UNREAD' }]),
    feedbackNotificationUnreadCount: ref(3), reportNotificationUnreadCount: ref(3),
    feedbackNotificationError: ref(''), reportNotificationError: ref(''),
    selectedFeedback: ref(null), selectedReport: ref(null),
    reportDetailLoading: ref(false), reportDetailError: ref(''),
    cancelReportDownload() {}, fail(error) { throw error }, formatPortalError: error => error.message,
    readFeedbackNotification: read, readReportNotification: read,
    getFeedback: async id => { calls.push(id); return { feedback: { id } } },
    getReportRequest: async id => { calls.push(id); return { id, events: [] } },
  }
  const names = ['openFeedback', 'openReport', 'openFeedbackNotification', 'openReportNotification']
  const script = source.match(/<script setup>([^]*?)<\/script>/)[1]
  const declarations = parseJavaScript(script, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
    .map(node => script.slice(node.start, node.end)).join('\n')
  vm.runInNewContext(declarations + ';globalThis.ui = {openFeedback,openReport,openFeedbackNotification,openReportNotification}', context)
  const feedback = kind === 'feedback'
  return { context, calls, open: context.ui[feedback ? 'openFeedback' : 'openReport'],
    notify: context.ui[feedback ? 'openFeedbackNotification' : 'openReportNotification'],
    selected: context[feedback ? 'selectedFeedback' : 'selectedReport'],
    count: context[feedback ? 'feedbackNotificationUnreadCount' : 'reportNotificationUnreadCount'] }
}

for (const kind of ['feedback', 'reports']) {
  test(`${kind} 已读迟到时不得跨栏目重新打开详情`, async () => {
    let complete
    const h = notificationOpenHarness(kind, () => new Promise(resolve => { complete = resolve }))
    const pending = h.notify({ id: 'notice-a', status: 'UNREAD', feedback_id: 'a', request_id: 'a' })
    h.context.section.value = 'projects'
    complete()
    await pending
    assert.equal(h.selected.value, null)
    assert.deepEqual(h.calls, [])
    assert.equal(h.count.value, 3)
  })

  test(`${kind} 先点慢通知A再点同栏详情B，B必须保留`, async () => {
    let complete
    const h = notificationOpenHarness(kind, () => new Promise(resolve => { complete = resolve }))
    const pending = h.notify({ id: 'notice-a', status: 'UNREAD', feedback_id: 'a', request_id: 'a' })
    await h.open({ id: 'b' })
    complete()
    await pending
    assert.equal((h.selected.value.feedback || h.selected.value).id, 'b')
    assert.deepEqual(h.calls, ['b'])
  })

  test(`${kind} 重复点击同一未读通知只请求一次并扣减一次`, async () => {
    let complete
    let reads = 0
    const h = notificationOpenHarness(kind, () => { reads++; return new Promise(resolve => { complete = resolve }) })
    const item = { id: 'notice-a', status: 'UNREAD', feedback_id: 'a', request_id: 'a' }
    const first = h.notify(item)
    const duplicate = h.notify(item)
    assert.equal(reads, 1)
    complete()
    await Promise.all([first, duplicate])
    assert.equal(h.count.value, 2)
    assert.deepEqual(h.calls, ['a'])
  })
}

// notificationHarness 执行客户门户真实通知及列表加载函数，替换认证和HTTP边界。
// 参数：section 为反馈或报告栏目，overrides 为受控接口或权限。
// 返回值：真实加载入口和状态，不模拟浏览器验收。
function notificationHarness(section, overrides = {}) {
  const names = ['feedbackNotifications', 'reportNotifications', 'feedbacks', 'projects']
  const context = { ref, section: ref(section), session: ref({}), capabilitiesLoaded: true,
    portalLoadGeneration: 0, authorizationScopeKey, capabilities: ref({}),
    getPortalSession: async () => ({}), getPortalCapabilities: async () => ({}),
    isPortalSuperAdmin: ref(false), hasPermission: () => true,
    feedbackNotificationGeneration: 0, reportLoadGeneration: 0,
    feedbackNotificationUnreadCount: ref(7), reportNotificationUnreadCount: ref(5),
    feedbackNotificationLoading: ref(false), reportNotificationLoading: ref(false),
    feedbackNotificationError: ref(''), reportNotificationError: ref(''),
    loading: ref(false), error: ref(''), notice: ref(''),
    feedbackPage: ref(1), feedbackTotal: ref(0), feedbackListError: ref(''),
    listFeedbacks: async () => ({items:[{id:'feedback-main'}],total:1}),
    listProjects: async () => ({items:[]}),
    listFeedbackNotifications: async () => ({items:[{id:'feedback-notice'}]}),
    listReportNotifications: async () => ({items:[{id:'report-notice'}]}),
    getFeedbackNotificationUnreadCount: async () => ({count:1}),
    getReportNotificationUnreadCount: async () => ({count:2}),
    formatPortalError: error => error.message, subsystemAccessMessage: () => '',
    fail: error => { throw error }, ...overrides }
  for (const name of names) context[name] = ref([])
  const functions = ['load', 'loadFeedbackNotifications', 'loadReportNotifications'].map(name => {
    const match = source.match(new RegExp(`async function ${name}\\([^]*?^}`, 'm'))
    assert.ok(match, name)
    return match[0]
  }).join('\n')
  vm.runInNewContext(functions + '; globalThis.ui = {load,loadFeedbackNotifications,loadReportNotifications}', context)
  return {context,...context.ui}
}

test('反馈主列表先显示，通知失败局部重试且未读数保持未知', async () => {
  let reject
  const pending = new Promise((_resolve, fail) => { reject = fail })
  const h = notificationHarness('feedback', {listFeedbackNotifications:()=>pending})
  await h.load()
  assert.equal(h.context.feedbacks.value[0].id, 'feedback-main')
  assert.equal(h.context.loading.value, false)
  assert.equal(h.context.feedbackNotificationLoading.value, true)
  reject(new Error('通知暂时不可用'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.context.feedbackNotificationUnreadCount.value, null)
  assert.match(h.context.feedbackNotificationError.value, /通知暂时不可用/)
  assert.equal(h.context.feedbackListError.value, '')
  h.context.listFeedbackNotifications = async () => ({items:[]})
  h.context.getFeedbackNotificationUnreadCount = async () => ({count:0})
  await h.loadFeedbackNotifications()
  assert.equal(h.context.feedbackNotificationUnreadCount.value, 0)
  assert.equal(h.context.feedbackNotificationError.value, '')
})

test('报告通知失败不声明零未读，恢复后显示服务端真实计数', async () => {
  const h = notificationHarness('reports', {getReportNotificationUnreadCount:async()=>{throw new Error('计数失败')}})
  await h.loadReportNotifications()
  assert.equal(h.context.reportNotificationUnreadCount.value, null)
  assert.equal(h.context.reportNotificationError.value, '计数失败')
  h.context.getReportNotificationUnreadCount = async () => ({count:3})
  await h.loadReportNotifications()
  assert.equal(h.context.reportNotificationUnreadCount.value, 3)
})

test('没有读取权限不请求通知', async () => {
  let requests = 0
  const h = notificationHarness('feedback', {hasPermission:()=>false,
    listFeedbackNotifications:async()=>{requests++;return {items:[]}}})
  await h.loadFeedbackNotifications()
  assert.equal(requests, 0)
})


test('通知错误与反馈主体同时渲染，局部错误不隐藏我的反馈', async () => {
  const start = source.indexOf('<section v-if="section === \'feedback\'')
  const end = source.indexOf('<template v-else-if="section === \'security\'', start)
  const markup = source.slice(start, end)
  const render = new Function('Vue', compile(markup, {mode:'function',prefixIdentifiers:true}).code)(Vue)
  const state = { section:'feedback', hasPermission:()=>true, canUseFeedback:true,
    feedbackNotifications:[],feedbackNotificationLoading:false,feedbackNotificationError:'通知失败',
    feedbackNotificationUnreadCount:null,loadFeedbackNotifications(){}, feedbackForm:{},
    projects:[],feedbackContactError:'',feedbackSubmitError:'',submitFeedback(){},
    feedbacks:[{id:'f1',feedback_no:'FB-1',title:'真实反馈'}],feedbackTotal:1,
    feedbackListError:'',loading:false,feedbackType:()=>'',slaText:()=>'',feedbackStatus:()=>'',
    openFeedback(){},loadMoreFeedbacks(){},reloadList(){} }
  const html=await renderToString(Vue.createSSRApp({setup:()=>state,render}))
  assert.match(html,/通知失败/)
  assert.match(html,/我的反馈/)
  assert.match(html,/FB-1/)
})
