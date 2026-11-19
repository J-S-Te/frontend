import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { openNotificationTarget } from '../../shared/utils/notificationNavigation.js'
import { projectApprovalTarget } from '../approvalTasks.js'

const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
const start = source.indexOf('watch([activeSection, activeNodeItems')
const end = source.indexOf('}, { immediate: true })', start) + '}, { immediate: true })'.length
const declaration = source.slice(start, end)

test('栏目读取期间不清除选中服务项，稳定快照确认移出节点后才清除', async () => {
  const scope = effectScope()
  const state = { activeSection: ref('implementation'),
    activeNodeItems: ref([{ id: 'SI-1', status: '实施准备中' }]),
    selectedServiceItemIDs: ref(['SI-1']), loading: ref(false),
    sectionExtrasLoading: ref(false), workspaceReady: ref(true) }
  try {
    scope.run(() => new Function('watch', ...Object.keys(state), declaration)(watch, ...Object.values(state)))
    state.loading.value = true
    state.workspaceReady.value = false
    state.activeNodeItems.value = [] // PREPARATION_STARTED 所需事件仍在读取，不能判断已移出节点。
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-1'])
    state.activeNodeItems.value = [{ id: 'SI-1', status: '实施准备中' }]
    state.workspaceReady.value = true
    state.loading.value = false
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-1'])
    state.activeNodeItems.value = [] // 这次稳定快照确认已移出节点，必须撤销旧选择。
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, [])
  } finally { scope.stop() }
})

// 用途：运行页面真实选中函数和监听器，隔离表单填充及远端证据读取。
// 参数：options 指定栏目、通知坐标、授权候选及可选的真实内存路由。
// 返回值：响应式页面状态、表单与提示记录，以及作用域清理入口。
function mountNotificationSelection({ section = 'methods', target = 'SI-2', items, router } = {}) {
  globalThis.window = { location: { origin: 'http://localhost:8081' } }
  const scope = effectScope()
  const rows = items || [{ id: 'SI-1' }, { id: 'SI-2' }]
  const calls = { forms: [], notices: [], evidenceReads: 0 }
  const state = {
    activeSection: ref(section), activeNodeItems: ref(rows), serviceItems: ref(rows),
    selectedServiceItemIDs: ref([]), loading: ref(true), sectionExtrasLoading: ref(false),
    workspaceReady: ref(false), loadError: ref(''), sectionExtrasError: ref(''),
    sectionDataContext: ref('tenant:user:revision-1'),
    route: reactive({ name: 'project_management', query: { service_item_id: target } }),
    saving: ref(false),
    nativeScopeLocked: ref(false), nativeScopeProjectID: ref(''),
    canReadNativeProjectScope: ref(true),
    approvalDeepLink: { task: ref(null), serviceItem: ref(null), project: ref(null),
      requested: ref(null), loading: ref(false), error: ref(''), canProcess: ref(false) },
    navigation: ref({ sections: ['approvals'] }), mobileMenuOpen: ref(false),
    operationForm: ref({ deviationID: '' }), pendingDeviations: ref([]),
    fieldEvidenceSnapshot: ref({ itemID: 'stale' }), fieldEvidenceError: ref('old error'),
    projects: ref([]), decompositionProjects: ref([]), selectedDecompositionProjectID: ref(''),
  }
  const selectStart = source.indexOf('function selectServiceItem(')
  const select = source.slice(selectStart, source.indexOf('\n}', selectStart) + 2)
  const targetStart = source.indexOf('let notificationSelectionContext')
  const targetWatch = targetStart < 0 ? '' : source.slice(targetStart,
    source.indexOf('// 会话权限异步到达', targetStart))
  const decompositionStart = source.indexOf('watch([decompositionProjects,') >= 0
    ? source.indexOf('watch([decompositionProjects,') : source.indexOf('watch(decompositionProjects,')
  const decompositionWatch = source.slice(decompositionStart,
    source.indexOf('const currentDecompositionItems', decompositionStart))
  const bindingStart = source.indexOf('useProjectNotifications({')
  const binding = source.slice(bindingStart, source.indexOf('\n})', bindingStart) + 3)
  const approvalNavigation = source.match(/async function openApprovalTarget\([^]*?\n\}/)[0]
  const controls = scope.run(() => new Function('watch', ...Object.keys(state), 'fillOperationForm',
    'refreshSelectedFieldEvidence', 'showToast', 'nextTick', 'openNotificationTarget', 'router',
    'useProjectNotifications', 'getNotification', 'getUnreadCount', 'listNotificationInbox',
    'markNotificationRead', 'listApprovalTasks', 'openApprovalRequest',
    'formatUserError', 'projectApprovalTarget', 'onBeforeRouteUpdate', 'onBeforeRouteLeave',
    `${select}\n${declaration}\n${decompositionWatch}\n${approvalNavigation}\n${targetWatch}
    return { selectServiceItem, openTarget: ${binding}.openTarget }`)(
    watch, ...Object.values(state),
    (item) => { calls.forms.push(item.id); state.operationForm.value = { deviationID: '' } },
    () => { calls.evidenceReads += 1 },
    (message, tone) => calls.notices.push({ message, tone }),
    nextTick, openNotificationTarget, router, (dependencies) => dependencies,
    () => {}, () => {}, () => {}, () => {},
    () => ({ items: [], total: 0 }), () => true,
    error => error.message,
    projectApprovalTarget, () => {}, () => {},
  ))
  return { ...state, ...controls, calls, stop: () => scope.stop() }
}

test('精确偏离深链只选择指定实例，同服务项切换与已处理旧链接均不得串到新偏离', async () => {
  const state = mountNotificationSelection({ section: 'exceptions',
    items: [{ id: 'SI-2', project_id: 'PJ-2' }] })
  try {
    state.route.query.deviation_id = 'DV-2'
    state.approvalDeepLink.requested.value = { type: 'FIELD_DEVIATION', id: 'DV-2' }
    state.approvalDeepLink.task.value = { id: 'DV-2', type: 'FIELD_DEVIATION', service_item_id: 'SI-2' }
    state.approvalDeepLink.serviceItem.value = { id: 'SI-2', project_id: 'PJ-2' }
    state.approvalDeepLink.canProcess.value = true
    state.pendingDeviations.value = [
      { service_item_id: 'SI-2', payload: { deviation_id: 'DV-new' } },
      { service_item_id: 'SI-2', payload: { deviation_id: 'DV-2' } },
    ]
    state.loading.value = false; state.workspaceReady.value = true
    await nextTick()
    assert.equal(state.operationForm.value.deviationID, 'DV-2')
    state.route.query.deviation_id = 'DV-old'
    state.approvalDeepLink.task.value = { id: 'DV-old', type: 'FIELD_DEVIATION', service_item_id: 'SI-2', status: 'APPROVED' }
    state.approvalDeepLink.canProcess.value = false
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, [])
    assert.equal(state.operationForm.value.deviationID, '')
    state.saving.value = true
    state.route.query.deviation_id = 'DV-2'
    state.approvalDeepLink.canProcess.value = true
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, [])
  } finally { state.stop() }
})

test('旧偏离通知只有服务项编号时仅定位服务项，不用当前另一偏离代替原实例', async () => {
  const state = mountNotificationSelection({ section: 'exceptions' })
  try {
    state.pendingDeviations.value = [{ service_item_id: 'SI-2', payload: { deviation_id: 'DV-new' } }]
    state.loading.value = false; state.workspaceReady.value = true
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-2'])
    assert.equal(state.operationForm.value.deviationID, '')
  } finally { state.stop() }
})

test('通知服务项深链等工作区及节点数据就绪后选中真实候选，同页query变化再次定位', async () => {
  const state = mountNotificationSelection()
  try {
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, [])
    assert.deepEqual(state.calls.notices, [])
    state.workspaceReady.value = true
    state.loading.value = false
    state.sectionExtrasLoading.value = true
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, [])
    state.sectionExtrasLoading.value = false
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-2'])
    assert.deepEqual(state.calls.forms, ['SI-2'])
    assert.equal(state.fieldEvidenceSnapshot.value, null)
    assert.equal(state.calls.evidenceReads, 1)
    state.route.query.service_item_id = 'SI-1'
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-1'])
    state.activeNodeItems.value = [...state.activeNodeItems.value]
    await nextTick()
    assert.deepEqual(state.calls.forms, ['SI-2', 'SI-1'], '刷新不得清空正在填写的表单')
  } finally { state.stop() }
})

test('通知目标已离开当前节点或不在授权快照时提示原因，不选择其他服务项', async () => {
  for (const visible of [true, false]) {
    const state = mountNotificationSelection({ target: 'SI-old', items: [{ id: 'SI-current' }] })
    try {
      if (visible) state.serviceItems.value = [{ id: 'SI-old' }, { id: 'SI-current' }]
      state.selectedServiceItemIDs.value = ['SI-current']
      state.workspaceReady.value = true
      state.loading.value = false
      await nextTick()
      assert.deepEqual(state.selectedServiceItemIDs.value, [])
      assert.deepEqual(state.calls.forms, [])
      assert.equal(state.calls.notices.length, 1)
      assert.match(state.calls.notices[0].message, visible ? /不在当前|已处理/ : /不存在|无权/)
    } finally { state.stop() }
  }
})

test('节点读取失败不误报目标不存在，读取恢复后只定位旧通知的服务项', async () => {
  const state = mountNotificationSelection({ section: 'exceptions' })
  try {
    state.workspaceReady.value = true
    state.loading.value = false
    state.sectionExtrasError.value = '事件读取失败'
    state.pendingDeviations.value = [
      { service_item_id: 'SI-1', payload: { deviation_id: 'DV-1' } },
      { service_item_id: 'SI-2', payload: { deviation_id: 'DV-2' } },
    ]
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, [])
    assert.deepEqual(state.calls.notices, [])
    state.sectionExtrasError.value = ''
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-2'])
    assert.equal(state.operationForm.value.deviationID, '', '缺少偏离坐标时不得猜测当前实例')
  } finally { state.stop() }
})

test('inbox 候选合入可见的待审批回退服务项，拒绝仅有事件而不可见的记录', () => {
  const items = ref([{ id: 'SI-assign' }, { id: 'SI-rollback' }, { id: 'SI-other' }])
  const inbox = ref([items.value[0]])
  const requests = ref([{ service_item_id: 'SI-rollback' }, { service_item_id: 'SI-hidden' }])
  const blockStart = source.indexOf('const inboxWorkflowItems = computed(')
  const block = blockStart < 0 ? '' : source.slice(blockStart,
    source.indexOf('\n})', blockStart) + 3)
  const result = new Function('computed', 'serviceItems', 'inboxItems', 'pendingRollbackRequests',
    `${block}\nreturn ${block ? 'inboxWorkflowItems' : 'inboxItems'}`)(
    computed, items, inbox, requests)
  assert.deepEqual(result.value.map(item => item.id), ['SI-assign', 'SI-rollback'])
})

test('拆解通知消费project坐标并支持同页切换，失效项目不回退到另一项目', async () => {
  const state = mountNotificationSelection({ section: 'decomposition', target: '' })
  try {
    delete state.route.query.service_item_id
    state.decompositionProjects.value = [{ id: 'PJ-1' }, { id: 'PJ-2' }]
    state.projects.value = [...state.decompositionProjects.value, { id: 'PJ-done' }]
    state.selectedDecompositionProjectID.value = 'PJ-1'
    state.route.query.project = 'PJ-2'
    state.workspaceReady.value = true
    state.loading.value = false
    await nextTick()
    assert.equal(state.selectedDecompositionProjectID.value, 'PJ-2')
    state.route.query.project = 'PJ-done'
    await nextTick()
    assert.equal(state.selectedDecompositionProjectID.value, '')
    assert.match(state.calls.notices.at(-1).message, /不在当前|已处理/)
    delete state.route.query.project
    await nextTick()
    assert.equal(state.selectedDecompositionProjectID.value, 'PJ-1', '返回无坐标栏目后恢复普通选择')
  } finally { state.stop() }
})

test('同页服务项参数重复或为空时立即清除旧选择及偏离目标，缺省参数保持普通选择', async () => {
  const state = mountNotificationSelection({ section: 'exceptions' })
  try {
    state.pendingDeviations.value = [
      { service_item_id: 'SI-2', payload: { deviation_id: 'DV-2' } },
    ]
    state.workspaceReady.value = true
    state.loading.value = false
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-2'])
    assert.equal(state.operationForm.value.deviationID, '', '旧服务项链接不代选偏离实例')
    for (const invalid of [['SI-1', 'SI-3'], null, '  ']) {
      state.selectedServiceItemIDs.value = ['SI-2']
      state.selectedDecompositionProjectID.value = 'PJ-old'
      state.operationForm.value.deviationID = 'DV-2'
      state.sectionExtrasLoading.value = true
      state.route.query.service_item_id = invalid
      await nextTick()
      assert.deepEqual(state.selectedServiceItemIDs.value, [])
      assert.equal(state.selectedDecompositionProjectID.value, '')
      assert.equal(state.operationForm.value.deviationID, '')
      assert.match(state.calls.notices.at(-1)?.message, /单个|重复|参数|格式/)
    }
    state.sectionExtrasLoading.value = false
    state.route.query.service_item_id = 'SI-1'
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-1'])
    const noticeCount = state.calls.notices.length
    delete state.route.query.service_item_id
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-1'])
    assert.equal(state.calls.notices.length, noticeCount)
  } finally { state.stop() }
})

test('拆解项目参数重复或项目与服务项冲突时不保留此前项目目标', async () => {
  const state = mountNotificationSelection({ section: 'decomposition', target: '',
    items: [{ id: 'SI-2', project_id: 'PJ-2' }] })
  try {
    delete state.route.query.service_item_id
    state.decompositionProjects.value = [{ id: 'PJ-1' }, { id: 'PJ-2' }]
    state.projects.value = [...state.decompositionProjects.value]
    state.route.query.project = 'PJ-2'
    state.workspaceReady.value = true
    state.loading.value = false
    await nextTick()
    assert.equal(state.selectedDecompositionProjectID.value, 'PJ-2')
    state.route.query.project = ['PJ-1', 'PJ-3']
    await nextTick()
    assert.equal(state.selectedDecompositionProjectID.value, '')
    assert.match(state.calls.notices.at(-1)?.message, /单个|重复|参数|格式/)
    state.route.query.project = 'PJ-1'
    state.route.query.service_item_id = 'SI-2'
    await nextTick()
    assert.equal(state.selectedDecompositionProjectID.value, '')
    assert.deepEqual(state.selectedServiceItemIDs.value, [])
    assert.match(state.calls.notices.at(-1)?.message, /不一致|冲突/)
  } finally { state.stop() }
})

test('处理页附带冲突项目坐标时撤销原服务项选择，保留原授权候选', async () => {
  const state = mountNotificationSelection({
    items: [{ id: 'SI-1', project_id: 'PJ-1' }, { id: 'SI-2', project_id: 'PJ-2' }],
  })
  try {
    state.workspaceReady.value = true
    state.loading.value = false
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-2'])
    state.route.query.project = 'PJ-1'
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, [])
    assert.match(state.calls.notices.at(-1)?.message, /不一致|冲突/)
    assert.deepEqual(state.activeNodeItems.value.map(item => item.id), ['SI-1', 'SI-2'])
  } finally { state.stop() }
})

test('同路径再点通知重选其真实服务项，相同目标保留草稿，保存期间保护原目标', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/project_management/:section?', name: 'project_management', component: {} },
  ] })
  const target = '/project_management/methods?service_item_id=SI-2'
  await router.push(target)
  const state = mountNotificationSelection({ router })
  try {
    state.workspaceReady.value = true
    state.loading.value = false
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-2'])
    state.selectServiceItem(state.serviceItems.value[0])
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-1'])
    const item = { delivery_id: 'd2', target_url: target }
    assert.equal(await state.openTarget(item), true)
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-2'])
    state.operationForm.value.reviewComment = '尚未保存的复核意见'
    const fills = state.calls.forms.length
    assert.equal(await state.openTarget(item), true)
    assert.equal(state.operationForm.value.reviewComment, '尚未保存的复核意见')
    assert.equal(state.calls.forms.length, fills)
    state.selectServiceItem(state.serviceItems.value[0])
    state.saving.value = true
    await assert.rejects(state.openTarget(item), /保存|操作/)
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-1'])
    assert.equal(router.currentRoute.value.fullPath, target)
  } finally { state.stop() }
})

test('统一项目审批通知保留申请坐标与权限，守卫拒绝或引用不符不假报导航成功', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/project_management/:section?', name: 'project_management', component: {} },
  ] })
  await router.push('/project_management/notifications')
  const state = mountNotificationSelection({ router })
  const detail = { delivery_id: 'approval', source_application: 'project_management',
    reference_type: 'PROJECT_APPROVAL', reference_id: 'request-1', category: 'ROLLBACK_REQUESTED',
    target_url: '/project_management/approvals?request_id=request-1' }
  try {
    assert.equal(await state.openTarget(detail), true)
    assert.equal(router.currentRoute.value.fullPath, detail.target_url)
    state.navigation.value.sections = []
    assert.equal(await state.openTarget(detail), false)
    assert.match(state.calls.notices.at(-1)?.message, /无权/)
    state.navigation.value.sections = ['approvals']
    router.beforeEach(to => to.query.request_id === 'blocked' ? false : undefined)
    assert.equal(await state.openTarget({ ...detail, reference_id: 'blocked',
      target_url: '/project_management/approvals?request_id=blocked' }), false)
    assert.equal(router.currentRoute.value.fullPath, detail.target_url)
    await assert.rejects(state.openTarget({ ...detail, reference_id: 'different' }), /不一致/)
  } finally { state.stop() }
})
