import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { formatUserError } from './shared/utils/userError.js'
import { loadAllCatalogPages } from './platform/iam/utils/paginatedCatalog.js'
import { RELATED_DATA } from './platform/shared/utils/relatedDataInvalidation.js'

const source = await readFile(new URL('./platform/iam/components/PersonnelChangeCenter.vue', import.meta.url), 'utf8')
const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import\s[^\n]+\n/gm, '')
const ref = value => ({ value })
const computed = read => ({ get value() { return read() } })
const failure = (message, metadata = {}) => Object.assign(new Error(message), metadata)

function component(api = {}, permissions = true) {
  const events = []
  const dependencies = {
    ref, computed, reactive: value => value, watch: () => {}, onMounted: () => {},
    defineEmits: () => (...args) => events.push(args), defineProps: () => ({ prefillUserId: '' }), hasPermission: () => permissions,
    // 关联数据失效订阅：沙箱只验证组件逻辑，订阅本身由 relatedDataRefresh.test.mjs 覆盖。
    useRelatedDataInvalidation: () => () => {}, RELATED_DATA, loadAllCatalogPages,
    useDictionaryOptions: (_key, options) => ({ options: ref(options.fallback) }), formatUserError,
    listPersonnelChanges: async () => ({ items: [] }), listUsers: async () => ({ items: [] }),
    listPositions: async () => ({ items: [] }), listOrgUnits: async () => ({ items: [] }),
    listMemberships: async () => ({ items: [] }), listApplications: async () => ({ items: [] }),
    listPersonnelHandoverItems: async () => ({ items: [] }), getApplicationAccess: async () => ({}),
    previewPersonnelChange: async () => ({}), createPersonnelChange: async () => ({}),
    submitPersonnelChange: async () => ({}), transitionPersonnelChange: async () => ({}),
    cancelPersonnelChange: async () => ({}), completePersonnelHandoverItem: async () => ({}), retryPersonnelHandover: async () => ({ status: 'FROZEN' }), ...api,
  }
  const state = new Function(...Object.keys(dependencies), `${script}; return {
    load, openForm, refreshUserMemberships, loadPreview, save, runSubmit,
    openWorkflowAction, runImmediateExecution, confirmWorkflowAction, rejectWorkflowAction,
    openAuthorization, authorizationFailureMessage, records, users, organizations, positions,
    form, error, loading, saving, personConfirmed, membershipsLoading, showForm,
    workflowAction, workflowReference, workflowSaving, handoverItems, handoverTargetUserId,
    authorizationDetail, authorizationLoading, authorizationError
  };`)(...Object.values(dependencies))
  return { ...state, events }
}

test('人员异动读取失败显示中文且保留既有列表与错误诊断，不把失败视作无数据', async () => {
  const cause = failure('SQLSTATE HY000 SELECT password FROM accounts', { status: 500, code: 'INTERNAL_ERROR', requestID: 'personnel-read-1' })
  const state = component({ listPersonnelChanges: async () => { throw cause } })
  state.records.value = [{ id: 'existing-change' }]
  await state.load()
  assert.deepEqual(state.records.value, [{ id: 'existing-change' }])
  assert.match(state.error.value, /服务|管理员/)
  assert.doesNotMatch(state.error.value, /SQLSTATE|SELECT|password/)
  assert.equal(state.loading.value, false)
  assert.equal(cause.requestID, 'personnel-read-1')
  assert.match(source, /当前不能确认是否存在异动单/)
})

test('新建异动的目录失败分别报告且仅保留既有受控分页查询，不静默假空或扩大数据范围', async () => {
  const calls = []
  const state = component(Object.fromEntries(['listUsers', 'listPositions', 'listOrgUnits'].map(name => [name, async query => {
    calls.push([name, query])
    throw failure('<html>backend failed</html>', { status: 503 })
  }])))
  await state.openForm()
  assert.deepEqual(calls, [
    ['listUsers', { page: 1, pageSize: 100 }],
    ['listPositions', { page: 1, pageSize: 100, status: 'ACTIVE' }],
    ['listOrgUnits', { page: 1, pageSize: 100, status: 'ACTIVE' }],
  ])
  for (const label of ['人员目录', '岗位目录', '组织目录']) assert.ok(state.error.value.includes(label))
  assert.doesNotMatch(state.error.value, /<html>|backend/)
  assert.equal(state.showForm.value, true)
  assert.match(source, /personnel-change-form-intro[\s\S]*?<p v-if="error"[^>]*role="alert"/)
  const denied = component({ listUsers: async () => assert.fail('无操作权限不得加载目录') }, false)
  await denied.openForm()
  assert.equal(denied.showForm.value, false)
})

test('单个目录失败不会清空成功目录，任职读取保留精确业务拒绝和未确认状态', async () => {
  const state = component({
    listUsers: async () => ({ items: [{ id: 'user-1', status: 'ACTIVE' }] }),
    listPositions: async () => { throw new TypeError('Cannot read properties of undefined') },
    listOrgUnits: async () => ({ items: [{ id: 'org-1', name: '测试组织' }] }),
    listMemberships: async () => { throw failure('该人员不在当前可管理的组织范围内。', { status: 403, requestID: 'membership-1' }) },
  })
  await state.openForm()
  assert.equal(state.users.value.length, 1)
  assert.equal(state.organizations.value.length, 1)
  assert.match(state.error.value, /岗位目录/)
  assert.doesNotMatch(state.error.value, /人员目录|组织目录|undefined/)
  state.form.userId = 'user-1'
  await state.refreshUserMemberships()
  assert.equal(state.error.value, '该人员不在当前可管理的组织范围内。')
  assert.equal(state.personConfirmed.value, false)
  assert.equal(state.membershipsLoading.value, false)
})

test('预览、保存、提交、执行、取消和驳回的意外异常均经安全错误边界且不改请求权限', async () => {
  const cause = failure('Cannot read properties of undefined')
  const reject = async () => { throw cause }
  const state = component({ previewPersonnelChange: reject, createPersonnelChange: reject, submitPersonnelChange: reject, transitionPersonnelChange: reject, cancelPersonnelChange: reject })
  Object.assign(state.form, { userId: 'user-1', reason: '测试调岗', immediate: true, sourceMembershipId: 'membership-1', targetOrgUnitId: 'org-1', targetPositionId: 'position-1' })
  await state.loadPreview()
  assert.equal(state.error.value, '权限影响预览失败。')
  await state.save()
  assert.equal(state.error.value, '保存异动单失败。')
  await state.runSubmit({ id: 'change-1' })
  assert.equal(state.error.value, '提交审批失败。')
  state.workflowAction.value = { item: { id: 'change-1' }, kind: 'execute' }
  await state.runImmediateExecution()
  assert.equal(state.error.value, '立即执行失败。')
  state.workflowAction.value.kind = 'cancel'
  await state.confirmWorkflowAction()
  assert.equal(state.error.value, '取消异动单失败。')
  state.workflowReference.value = '说明原因'
  await state.rejectWorkflowAction()
  assert.equal(state.error.value, '驳回异动单失败。')
  assert.equal(state.events.length, 0)
  assert.equal(state.saving.value, false)
  assert.equal(state.workflowSaving.value, false)
})

test('旧离职排期冻结已解除时保留受控恢复指引，不触发自动重试', async () => {
  const message = '该离职单的交接冻结已提前解除，不能直接执行。请联系管理员受控恢复交接冻结并重新核验当前业务责任；不要重复点击立即执行。'
  let attempts = 0
  const state = component({ transitionPersonnelChange: async () => {
    attempts++
    throw failure(message, { status: 409, code: 'IAM_HANDOVER_FREEZE_RELEASED' })
  } })
  state.workflowAction.value = { item: { id: 'legacy-change' }, kind: 'execute' }
  await state.runImmediateExecution()
  assert.equal(attempts, 1)
  assert.equal(state.error.value, message)
  assert.equal(state.events.length, 0)
})

test('交接的后续请求断网保留已完成数量、诊断与未知结果提示，不重复首项或继续排期', async () => {
  const calls = []
  const cause = failure('Failed to fetch', { code: 'NETWORK_ERROR', status: 0, request_method: 'POST', requestID: 'handover-1', details: { reason: 'network' } })
  const state = component({
    completePersonnelHandoverItem: async (id, itemId, target) => {
      calls.push([id, itemId, target])
      if (itemId === 'second') throw cause
      return { id: itemId, status: 'COMPLETED' }
    },
    transitionPersonnelChange: async () => assert.fail('责任未全部交接不得排期'),
  })
  const action = { kind: 'handover', item: { id: 'change-1' }, toStatus: 'SCHEDULED', autoReference: true }
  state.workflowAction.value = action
  state.handoverTargetUserId.value = 'receiver-1'
  state.handoverItems.value = [{ id: 'old', status: 'COMPLETED' }, { id: 'first' }, { id: 'second' }, { id: 'third' }]
  await state.confirmWorkflowAction()
  assert.deepEqual(calls, [['change-1', 'first', 'receiver-1'], ['change-1', 'second', 'receiver-1']])
  assert.match(formatUserError(state.error.value), /已确认完成 1 项责任交接.*尚未确认完成.*刷新.*勿重复提交/)
  assert.doesNotMatch(state.error.value, /Failed to fetch|交接失败|全部失败/)
  assert.equal(state.workflowAction.value, action)
  assert.equal(state.workflowSaving.value, false)
  assert.equal(cause.requestID, 'handover-1')
  assert.deepEqual(cause.details, { reason: 'network' })
  assert.equal(state.events.length, 0)
})

test('全部交接完成但排期超时仍保留交接成功事实，审批拒绝则不虚构部分成功', async () => {
  const calls = []
  const state = component({
    completePersonnelHandoverItem: async (_id, item) => { calls.push(item); return { status: 'COMPLETED' } },
    transitionPersonnelChange: async () => { calls.push('transition'); throw failure('gateway timeout', { status: 504, code: 'UPSTREAM_TIMEOUT' }) },
  })
  state.workflowAction.value = { kind: 'handover', item: { id: 'change-1' }, toStatus: 'SCHEDULED', autoReference: true }
  state.handoverTargetUserId.value = 'receiver-1'
  state.handoverItems.value = [{ id: 'first' }]
  await state.confirmWorkflowAction()
  assert.deepEqual(calls, ['first', 'transition'])
  assert.match(formatUserError(state.error.value), /已确认完成 1 项责任交接.*尚未确认.*核对/)
  const refused = component({ transitionPersonnelChange: async () => { throw failure('当前异动单已被其他管理员处理，请刷新后核对。', { status: 409 }) } })
  refused.workflowAction.value = { kind: 'approval', item: { id: 'change-2' }, toStatus: 'SCHEDULED' }
  refused.workflowReference.value = 'approval-record-1'
  await refused.confirmWorkflowAction()
  assert.equal(refused.error.value, '当前异动单已被其他管理员处理，请刷新后核对。')
  assert.doesNotMatch(refused.error.value, /已确认完成/)
})

test('远端交接返回待处理时保留真实状态，不伪造人工完成或排期', async () => {
  let schedules = 0
  const state = component({
    completePersonnelHandoverItem: async () => ({ id: 'remote', batch_id: 'batch-1', status: 'PENDING', next_retry_at: '2026-10-22T12:00:00Z' }),
    transitionPersonnelChange: async () => { schedules++; return {} },
  })
  state.workflowAction.value = { kind: 'handover', item: { id: 'change-1' }, toStatus: 'SCHEDULED', autoReference: true }
  state.handoverTargetUserId.value = 'successor'
  const item = { id: 'remote', batch_id: 'batch-1', status: 'PENDING' }
  state.handoverItems.value = [item]
  await state.confirmWorkflowAction()
  assert.equal(item.status, 'PENDING')
  assert.equal(schedules, 0)
  assert.ok(state.workflowAction.value)
  assert.match(state.error.value, /重试|回执/)
})

test('跨系统交接先恢复发现并回读责任，再按已确认回执排期', async () => {
  const calls = []
  const state = component({
    listPersonnelHandoverItems: async () => { calls.push('list'); return { cross_system_enabled: true, items: [{ id: 'remote', batch_id: 'batch-1', status: 'PENDING' }] } },
    retryPersonnelHandover: async () => { calls.push('discover'); return { status: 'FROZEN' } },
    completePersonnelHandoverItem: async () => { calls.push('transfer'); return { status: 'TRANSFERRED' } },
    transitionPersonnelChange: async () => { calls.push('schedule'); return { handover_reference: 'HANDOVER-1' } },
  })
  await state.openWorkflowAction({ id: 'change-1', status: 'PENDING_HANDOVER' })
  state.handoverTargetUserId.value = 'successor'
  await state.confirmWorkflowAction()
  assert.deepEqual(calls, ['list', 'discover', 'list', 'transfer', 'schedule'])
  assert.equal(state.workflowAction.value, null)
})

test('交接读取失败安全展示，真实用户说明与后台全部完成闸门一致', async () => {
  const state = component({ listPersonnelHandoverItems: async () => { throw new ReferenceError('handover_secret is not defined') } })
  await state.openWorkflowAction({ id: 'change-1', status: 'PENDING_HANDOVER' })
  assert.equal(state.error.value, '加载责任交接项失败。')
  assert.equal(state.workflowAction.value, null)
  assert.equal(state.workflowSaving.value, false)
  assert.match(source, /本地责任由管理员确认；远端责任按机器协议转移并核对回执，全部成功后才允许排期离职/)
  assert.doesNotMatch(source, /全部待办责任一次性转移/)
})

test('授权概览标识部分读取失败，持久化授权错误也安全转换且不改写原对象', async () => {
  const queries = []
  const rawAccess = { authorization_error: 'SQLSTATE HY000 SELECT secret', authorization_state: 'CONFLICT' }
  const cause = failure('<html>upstream failure</html>', { status: 500, code: 'INTERNAL_ERROR', requestID: 'access-1' })
  const state = component({
    listApplications: async query => { queries.push(query); return { items: [{ code: 'one' }, { code: 'two' }] } },
    getApplicationAccess: async (userId, code) => { assert.equal(userId, 'user-1'); if (code === 'two') throw cause; return rawAccess },
  })
  await state.openAuthorization({ user_id: 'user-1', display_name: '测试人员' })
  assert.deepEqual(queries, [{ page: 1, pageSize: 100, status: 'ACTIVE' }])
  assert.equal(state.authorizationDetail.value.rows.length, 1)
  assert.match(state.authorizationError.value, /1 个应用.*不完整/)
  assert.doesNotMatch(state.authorizationError.value, /<html>|upstream/)
  assert.match(state.authorizationFailureMessage(rawAccess.authorization_error), /管理员|无法确认/)
  assert.equal(rawAccess.authorization_error, 'SQLSTATE HY000 SELECT secret')
  assert.equal(cause.requestID, 'access-1')
  assert.equal(state.authorizationLoading.value, false)
  assert.match(source, /authorizationFailureMessage\(row\.access\.authorization_error\)/)
})

test('授权目录失败不伪装为无授权，所有 catch 均无原样错误信息捷径', async () => {
  const state = component({ listApplications: async () => { throw new TypeError('Cannot read properties of null') } })
  await state.openAuthorization({ user_id: 'user-1' })
  assert.equal(state.authorizationError.value, '加载人员授权失败。')
  assert.match(source, /当前不能判断该人员是否拥有应用权限/)
  assert.doesNotMatch(source, /(?:e|err|error)\?*\.message\s*\|\|/)
  assert.doesNotMatch(source, /catch\s*\{/)
})
