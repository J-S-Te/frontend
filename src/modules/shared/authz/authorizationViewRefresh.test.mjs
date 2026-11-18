import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { computed, ref } from 'vue'
import * as authorization from './authorizationSnapshot.js'

// 用途：执行真实页面读取函数，只有外部API和路由由用例隔离。
// 参数：file 为页面位置，names 为真实函数名，context 为页面状态及边界依赖。
// 返回值：文件中已存在的真实函数集合；被测入口缺失时调用失败。
function functions(file, names, context) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
  const found = names.flatMap(name => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
    if (start < 0) return []
    return [{ name, body: source.slice(start, source.indexOf('\n}', start) + 2) }]
  })
  return vm.runInNewContext(`${found.map(item => item.body).join('\n')}\n({${found.map(item => item.name).join(',')}})`,
    Object.assign(context, authorization))
}

test('合同页内刷新先重读当前授权，再按最新权限决定业务查询', async () => {
  let reads = 0
  const context = { session: ref({ permissions: [], authorization_revision: 1 }),
    sessionError: ref(''), businessDataSequence: 0, businessDataLoading: ref(false),
    approvalsKnown: ref(false), businessDataErrors: ref({}), adminDashboard: ref(null),
    can: () => false, isAdmin: ref(false), formatUserError: () => '授权读取失败',
    getContractSession: async options => {
      reads++
      assert.equal(options.force, true)
      return { permissions: [], authorization_revision: 2 }
    } }
  for (const name of ['contracts', 'approvals', 'initiatedApprovals', 'rules', 'contractTemplates']) {
    context[name] = ref([])
  }
  const api = functions('contract_management/views/ContractManagementView.vue', ['loadBusinessData'], context)
  await api.loadBusinessData()
  assert.equal(reads, 1)
  assert.equal(context.session.value.authorization_revision, 2)
})

test('客户门户重新加载不沿用旧会话，收回权限后清理旧客户工作区且保留草稿', async () => {
  let reads = 0, queries = 0
  const context = { session: ref({ tenant_id: 'T', user_id: 'U', permissions: ['project.read'] }),
    loading: ref(false), refreshing: ref(false), error: ref(''), notice: ref(''),
    capabilitiesLoaded: true, capabilities: ref({}), section: ref('projects'),
    feedbackForm: ref({ title: '尚未提交的草稿' }), isPortalSuperAdmin: ref(false),
    portalLoadGeneration: 0, projectRequestGeneration: 0, reportLoadGeneration: 0,
    reportDetailGeneration: 0, feedbackDetailGeneration: 0,
    projectExportGeneration: 0, projectMessageReadGeneration: 0,
    projectExportController: null, cancelReportDownload() {},
    feedbackNotificationGeneration: 0, projectPage: ref(1), projectTotal: ref(1),
    reportTotal: ref(1), feedbackTotal: ref(1),
    reportNotificationUnreadCount: ref(1), feedbackNotificationUnreadCount: ref(1),
    projectListError: ref(''), fail: error => { throw error },
    getPortalCapabilities: async () => ({}),
    listProjects: async () => { queries++; return { items: [{ id: 'old' }] } },
    getPortalSession: async options => {
      reads++
      assert.equal(options.force, true)
      return { tenant_id: 'T', user_id: 'U', permissions: [] }
    } }
  for (const name of ['projects', 'reports', 'feedbacks', 'reportNotifications',
    'reportRiskAlerts', 'reportProjects', 'feedbackNotifications', 'activities', 'accountSessions']) {
    context[name] = ref([{ id: 'old' }])
  }
  for (const name of ['selectedProject', 'selectedReport', 'selectedFeedback',
    'accountSecurity', 'evaluationEligibility', 'evaluation', 'projectConversation']) {
    context[name] = ref({ id: 'old' })
  }
  for (const name of ['projectDetailLoading', 'activityLoading', 'evaluationLoading',
    'projectExportLoading', 'projectMessageLoading', 'projectMessageOlderLoading',
    'reportDetailLoading', 'reportListLoading', 'reportProjectsLoading',
    'reportNotificationLoading', 'feedbackNotificationLoading']) context[name] = ref(true)
  for (const name of ['projectDetailError', 'activityError', 'evaluationError',
    'projectExportError', 'projectMessageError', 'reportDetailError', 'reportListError',
    'reportProjectsError', 'reportNotificationError', 'feedbackNotificationError',
    'projectListError', 'feedbackListError']) context[name] = ref('旧错误')
  context.permissions = computed(() => context.session.value?.permissions || [])
  context.hasPermission = value => context.permissions.value.includes(value)
  const api = functions('customer_portal/views/CustomerPortalView.vue',
    ['clearPortalAuthorizationData', 'load'], context)
  await api.load()
  assert.equal(reads, 1)
  assert.equal(queries, 0)
  assert.deepEqual(Array.from(context.projects.value), [])
  assert.equal(context.selectedProject.value, null)
  assert.equal(context.feedbackForm.value.title, '尚未提交的草稿')
  assert.equal(context.reportDetailLoading.value, false)
  assert.equal(context.projectExportLoading.value, false)
})

test('数析刷新先核验最新授权，无访问权或依赖错误时不再取业务数据', async () => {
  let reads = 0, summaries = 0
  const context = { me: ref({ permissions: ['read'] }), meRequestVersion: 0, disposed: false,
    loading: ref(false), loadError: ref(''), section: ref('contract'),
    DASHBOARD_CODES: { contract: 'contract' }, invalidateDashboardRequests() {},
    getAuthMe: async () => { reads++; throw Object.assign(Error('暂不可用'), { status: 503 }) },
    formatDataAnalysisError: () => '授权暂不可用', canViewDashboard: () => true,
    loadSummary: async () => { summaries++ }, metricFactsPanel: ref(null), historyPanel: ref(null),
    dashboardEmbedEnabled: ref(false) }
  const api = functions('data_analysis/views/DashboardShellView.vue',
    ['loadMe', 'refreshCurrentDashboard'], context)
  await api.refreshCurrentDashboard()
  assert.equal(reads, 1)
  assert.equal(summaries, 0)
  assert.equal(context.me.value, null)
  assert.equal(context.loadError.value, '授权暂不可用')
})

for (const [name, rows, page, total, query] of [
  ['loadMoreProjects', 'projects', 'projectPage', 'projectTotal', 'listProjects'],
  ['loadMoreReports', 'reports', 'reportPage', 'reportTotal', 'listReportRequests'],
  ['loadMoreFeedbacks', 'feedbacks', 'feedbackPage', 'feedbackTotal', 'listFeedbacks'],
]) {
  test(`门户${name}在授权刷新后丢弃旧范围分页结果`, async () => {
    let finish
    const context = { portalLoadGeneration: 1, reportLoadGeneration: 1,
      hasPermission: () => true, [rows]: ref([{ id: 'previous-page-1' }]),
      [page]: ref(1), [total]: ref(100), reportListLoading: ref(false),
      [query]: () => new Promise(resolve => { finish = resolve }), fail(error) { throw error } }
    const api = functions('customer_portal/views/CustomerPortalView.vue', [name], context)
    const pending = api[name]()
    context.portalLoadGeneration++
    context.reportLoadGeneration++
    context[rows].value = [{ id: 'new-scope-page-1' }]
    finish({ items: [{ id: 'old-scope-page-2' }], total: 100 })
    await pending
    assert.deepEqual(Array.from(context[rows].value), [{ id: 'new-scope-page-1' }])
  })
}

for (const status of [403, 503]) {
  test(`项目工作区授权${status}后停用旧菜单权限且保留表单内容`, async () => {
    const context = { workspaceScope: { begin: () => ({}), isCurrent: () => true },
      workspaceReady: ref(true), loading: ref(false), refreshing: ref(false),
      workspaceAuthorizationPending: ref(false),
      reportStageListScope: { invalidate() {} }, fieldEvidenceScope: { invalidate() {} },
      reportStageProjects: ref([]), fieldEvidenceSnapshot: ref(null),
      loadError: ref(''), ruleConfigurationCatalogError: ref(''),
      session: ref({ permissions: ['project.create'] }),
      navigation: ref({ sections: ['projects', 'automations'] }),
      selectedServiceItemIDs: ref(['old']), projectForm: ref({ name: '尚未提交的项目' }),
      getProjectSession: async () => { throw Object.assign(Error('当前授权不可用'), { status }) },
      subsystemAccessMessage: error => error.message }
    for (const name of ['projects', 'serviceItems', 'rules', 'capabilities']) {
      context[name] = ref([{ id: 'old' }])
    }
    const api = functions('project_management/views/ProjectManagementView.vue',
      ['clearProjectAuthorizationData', 'loadWorkspace'], context)
    await api.loadWorkspace({ background: true })
    assert.equal(context.session.value, null)
    assert.deepEqual(Array.from(context.navigation.value.sections), [])
    assert.equal(context.projectForm.value.name, '尚未提交的项目')
    assert.equal(context.loadError.value, '当前授权不可用')
  })
}
