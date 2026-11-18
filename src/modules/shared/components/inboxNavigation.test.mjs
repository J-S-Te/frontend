import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref } from 'vue'
import { openNotificationTarget } from '../utils/notificationNavigation.js'
import { formatUserError } from '../utils/userError.js'

const entries = [
  ['共享收件箱', './PlatformNotificationInbox.vue', 'open'],
  ['平台通知中心', '../../platform/notifications/components/NotificationCenterModule.vue', 'open'],
  ['项目通知中心', '../../project_management/components/ProjectNotificationCenter.vue', 'open'],
  ['报销收件箱', '../../reimbursement/components/ExpenseInbox.vue', 'open'],
  ['平台铃铛', '../../platform/views/PlatformConsoleView.vue', 'openTopbarNotification'],
]

// 用途：执行真实组件点击函数，网络与导航仅在外部边界注入。
// 参数：entry 为组件入口；options 为通知读取、已读回写或导航的失败条件。
// 返回值：点击动作、真实响应状态与实际导航记录。
function harness(entry, options = {}) {
  const [, file, name] = entry
  const { descriptor } = parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
  const script = compileScript(descriptor, { id: file })
  const node = script.scriptSetupAst.find((value) =>
    value.type === 'FunctionDeclaration' && value.id.name === name)
  const visits = [], reads = [], warnings = []
  const result = { delivery_id: 'delivery', target_url: '/reimbursement/approvals?claim_id=claim',
    title: '待审批', read_at: null, ...options.result }
  const state = {
    busy: ref(false), opening: ref(false), working: ref(false), actionID: ref(''),
    notificationOpening: ref(false), notificationMenuOpen: ref(true),
    error: ref(''), topbarNotificationsError: ref(''), detail: ref(null),
    router: { push: async (path) => { visits.push(path); return options.navigationFailure } },
    getNotification: async () => {
      if (options.readError) throw new Error('通知读取失败')
      return result
    },
    markNotificationRead: async (id) => {
      reads.push(id)
      if (options.markError) throw new Error('已读保存失败')
    },
    load: async () => {}, loadInbox: async () => {}, loadTopbarNotifications: async () => {},
    openNotificationTarget, formatUserError,
    normalize: (error) => error.message, emit: (...args) => warnings.push(args),
    showToast: (message) => warnings.push(message), activeSettingsTab: ref('iam'),
  }
  const action = new Function(...Object.keys(state),
    `${descriptor.scriptSetup.content.slice(node.start, node.end)}\nreturn ${name};`)(
    ...Object.values(state))
  return { action, visits, reads, warnings, result, state }
}

for (const entry of entries) {
  test(`${entry[0]}点击通知使用已授权详情目标直达审批`, async () => {
    const h = harness(entry)
    await h.action({ delivery_id: 'delivery', target_url: '/stale-list' })
    assert.deepEqual(h.visits, ['/reimbursement/approvals?claim_id=claim'])
    assert.deepEqual(h.reads, ['delivery'])
  })

  test(`${entry[0]}通知不可读时不使用摘要中的目标跳转`, async () => {
    const h = harness(entry, { readError: true })
    await h.action({ delivery_id: 'delivery', target_url: '/reimbursement/approvals' })
    assert.deepEqual(h.visits, [])
    assert.deepEqual(h.reads, [])
  })

  test(`${entry[0]}已读保存失败仍可进入审批，且不伪造已读`, async () => {
    const h = harness(entry, { markError: true })
    await h.action({ delivery_id: 'delivery' })
    assert.deepEqual(h.visits, ['/reimbursement/approvals?claim_id=claim'])
    assert.equal(h.state.detail.value?.read_at ?? null, null)
  })
}
