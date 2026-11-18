import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { ref } from 'vue'
import { createRequestScope } from '../../platform/shared/composables/requestScope.js'
import { formatUserError } from '../../shared/utils/userError.js'
import { subsystemAccessMessage } from '../../shared/authz/sessionCompatibility.js'
import { authorizationScopeKey } from '../../shared/authz/authorizationSnapshot.js'

function functions(names, context) {
  const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
  const bodies = names.map((name) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
    assert.ok(start >= 0, `missing ${name}`)
    return source.slice(start, source.indexOf('\n}', start) + 2)
  })
  return vm.runInNewContext(`${bodies.join('\n')}\n({${names.join(',')}})`, context)
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
// 用途：构造已登录、同授权范围的后台刷新状态，隔离业务快照接口。
// 参数：snapshot 为可控制完成时机的项目快照读取。
// 返回值：真实工作区函数消费的响应式页面上下文。
function context(snapshot) {
  return {
    ref, createRequestScope, formatUserError, subsystemAccessMessage, authorizationScopeKey,
    window: { clearTimeout: () => {}, setTimeout: () => 0 }, toastTimer: 0,
    toastMessage: ref(''), toastType: ref('success'),
    loading: ref(false), refreshing: ref(false), refreshWarning: ref(''), loadError: ref(''), ruleConfigurationCatalogError: ref(''),
    workspaceTruncated: ref(false), workspaceReady: ref(true), lastUpdatedAt: ref(null),
    workspaceAuthorizationPending: ref(false),
    projects: ref([{ id: 'PJ-OLD', name: '旧快照' }]), serviceItems: ref([]), rules: ref([]), deliveryEvents: ref([]),
    capabilities: ref([]), dashboard: ref({}), session: ref({ permissions: ['project.read'] }), navigation: ref({ sections: ['projects'] }),
    detectionCategories: ref([]), automationTriggerOptions: ref([]), slaStatusOptions: ref([]), slaOverdueItems: ref([]),
    activeSection: ref('projects'), route: { params: { section: 'projects' } }, router: { replace: async () => {} },
    workspaceScope: createRequestScope(), decorateRule: (rule) => rule, loadSectionExtras: async () => true,
    listProjectsSnapshot: () => snapshot.promise,
    listServiceItemsSnapshot: async () => ({ items: [], total: 0, truncated: false }),
    listRules: async () => [], listDeliveryEvents: async () => [], listCapabilities: async () => [],
    getDashboard: async () => ({}), getProjectSession: async () => ({ permissions: ['project.read'] }),
    getProjectNavigation: async () => ({ sections: ['projects'], default_section: 'projects' }),
    listDetectionCategories: async () => [], listRuleConfigurationCatalog: async () => ({ automation_triggers: [], sla_statuses: [] }),
    loadPersonnel: async () => {}, refreshNotificationCount: async () => {}, loadApplicationRoles: () => {}, loadSplitConfig: async () => {},
    loadEquipment: async () => {}, loadPersonnelNames: async () => {}, refreshSelectedFieldEvidence: async () => {}, listSlaOverdue: async () => [],
    showToast() {},
  }
}

test('项目写后后台同步期间保留旧快照，不进入整页 loading', async () => {
  const snapshot = deferred()
  const ctx = context(snapshot)
  const { loadWorkspace } = functions(['loadWorkspace'], ctx)
  const pending = loadWorkspace({ reportError: false, background: true })
  assert.equal(ctx.loading.value, false, '后台同步不得打开整页 loading')
  assert.equal(ctx.workspaceReady.value, true, '后台同步不得卸载工作区')
  assert.equal(ctx.projects.value[0].name, '旧快照', '等待响应期间必须保留旧快照')
  assert.equal(ctx.refreshing.value, true, '必须有轻量同步状态')

  snapshot.resolve({ items: [{ id: 'PJ-NEW', name: '新快照' }], total: 1, truncated: false })
  await pending
  assert.equal(ctx.projects.value[0].name, '新快照', '成功后原地替换快照')
  assert.equal(ctx.refreshing.value, false)
  assert.equal(ctx.loading.value, false)
  assert.equal(ctx.workspaceReady.value, true)
})
