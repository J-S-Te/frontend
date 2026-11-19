import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { useProjectApprovalDeepLink } from './useProjectApprovalDeepLink.js'

// 用途：运行真实深链控制器，仅替换授权读取接口。
// 参数：options 指定查询坐标、精确申请和可选延迟响应。
// 返回值：控制器、请求记录和响应式路由及清理函数。
function mountLink({ section = 'exceptions', query, task, readTasks } = {}) {
  const scope = effectScope(), calls = []
  const route = reactive({ query: query || { service_item_id: 'SI-2', deviation_id: 'DV-2' } })
  const current = task || { id: 'DV-2', type: 'FIELD_DEVIATION', project_id: 'PJ-2',
    service_item_id: 'SI-2', status: 'PENDING', can_decide: true, reason: '偏离二', severity: 'HIGH' }
  const busy = ref(false), context = ref('tenant:user')
  const ui = scope.run(() => useProjectApprovalDeepLink({ route, section: ref(section),
    context, ready: ref(true), busy, api: {
      listApprovalTasks: async (params) => { calls.push(['task', params]);
        return readTasks ? readTasks(params) : { items: [current], total: 1 } },
      listServiceItemsSnapshot: async (...args) => { calls.push(['item', ...args]);
        return { items: [{ id: 'SI-2', project_id: 'PJ-2', status: '异常处理中' }], total: 1 } },
      getProject: async (id) => { calls.push(['project', id]); return { id, source_kind: 'NATIVE' } },
    } }))
  return { ui, route, busy, context, calls, stop: () => scope.stop() }
}

test('冷进入偏离按类型和申请精确查询，补读快照外授权服务项并保持原业务坐标', async () => {
  const link = mountLink()
  try {
    await link.ui.load()
    assert.deepEqual(link.calls.find(([kind]) => kind === 'task')[1],
      { request_id: 'DV-2', task_type: 'FIELD_DEVIATION', page: 1, page_size: 1, view: 'assigned' })
    assert.deepEqual(link.calls.find(([kind]) => kind === 'item'), ['item', 'PJ-2', 'SI-2'])
    assert.equal(link.ui.task.value.id, 'DV-2')
    assert.equal(link.ui.serviceItem.value.id, 'SI-2')
    assert.equal(link.ui.canProcess.value, true)
  } finally { link.stop() }
})

test('同服务项切换偏离不采用迟到回执，坐标冲突与非唯一精确结果禁止处理', async () => {
  let resolveFirst
  const link = mountLink({ readTasks: ({ request_id }) => request_id === 'DV-2'
    ? new Promise(resolve => { resolveFirst = resolve })
    : Promise.resolve({ items: [{ id: request_id, type: 'FIELD_DEVIATION',
      service_item_id: 'SI-2', project_id: 'PJ-2', status: 'APPROVED', can_decide: false }], total: 1 }) })
  try {
    await nextTick()
    link.route.query.deviation_id = 'DV-3'
    await nextTick(); await link.ui.load()
    resolveFirst({ items: [{ id: 'DV-2', type: 'FIELD_DEVIATION', service_item_id: 'SI-2',
      project_id: 'PJ-2', status: 'PENDING', can_decide: true }], total: 1 })
    await nextTick()
    assert.equal(link.ui.task.value.id, 'DV-3')
    assert.equal(link.ui.canProcess.value, false)
    link.route.query.service_item_id = 'SI-other'
    await nextTick(); await link.ui.load()
    assert.equal(link.ui.task.value, null)
    assert.equal(link.ui.canProcess.value, false)
    assert.match(link.ui.error.value, /不一致/)
  } finally { link.stop() }
})

test('旧复核结果按review_id精确读取，拒绝当前新复核及无权或非法参数', async () => {
  const link = mountLink({ section: 'methods', query: { service_item_id: 'SI-2', review_id: 'EV-old' },
    task: { id: 'EV-old', type: 'SPECIAL_METHOD_REVIEW', service_item_id: 'SI-2',
      project_id: 'PJ-2', status: 'APPROVED', can_decide: true, decision_comment: '原结论' } })
  try {
    await link.ui.load()
    assert.equal(link.ui.task.value.id, 'EV-old')
    assert.equal(link.ui.canProcess.value, false)
    assert.equal(link.calls[0][1].request_id, 'EV-old')
    link.route.query.review_id = ['EV-old', 'EV-new']
    await nextTick(); await link.ui.load()
    assert.equal(link.ui.task.value, null)
    assert.match(link.ui.error.value, /参数/)
  } finally { link.stop() }
})

test('精确读取失败保留未知状态，保存期间不读取和切换目标', async () => {
  const link = mountLink({ readTasks: async () => { throw Object.assign(new Error('secret'), { status: 503 }) } })
  try {
    await link.ui.load()
    assert.equal(link.ui.canProcess.value, false)
    assert.doesNotMatch(link.ui.error.value, /不存在|secret/)
    link.busy.value = true
    const count = link.calls.length
    link.route.query.deviation_id = 'DV-3'
    await nextTick(); await link.ui.load()
    assert.equal(link.calls.length, count)
  } finally { link.stop() }
})

test('无状态码的远端异常不暴露内部原因，也不冒充不存在', async () => {
  const link = mountLink({ readTasks: async () => { throw new Error('secret internal failure') } })
  try {
    await link.ui.load()
    assert.match(link.ui.error.value, /暂时读取失败/)
    assert.doesNotMatch(link.ui.error.value, /secret|不存在/)
  } finally { link.stop() }
})

test('保存期间身份切换仍失效在途读取，不把旧身份申请回写到新上下文', async () => {
  let finish
  const link = mountLink({ readTasks: () => new Promise(resolve => { finish = resolve }) })
  try {
    await nextTick()
    link.busy.value = true
    link.context.value = 'another-tenant:another-user'
    finish({ items: [{ id: 'DV-2', type: 'FIELD_DEVIATION', project_id: 'PJ-2',
      service_item_id: 'SI-2', status: 'PENDING', can_decide: true }], total: 1 })
    await nextTick(); await nextTick()
    assert.equal(link.ui.task.value, null)
    assert.equal(link.ui.project.value, null)
    assert.equal(link.calls.filter(([kind]) => kind !== 'task').length, 0)
  } finally { link.stop() }
})

test('原页处理完成后重读同一偏离结果并关闭写状态，保留原原因和决定意见', async () => {
  let task = { id: 'DV-2', type: 'FIELD_DEVIATION', project_id: 'PJ-2', service_item_id: 'SI-2',
    status: 'PENDING', can_decide: true, reason: '原始原因' }
  const link = mountLink({ readTasks: async () => ({ items: [task], total: 1 }) })
  try {
    await link.ui.load()
    assert.equal(link.ui.canProcess.value, true)
    link.busy.value = true
    task = { ...task, status: 'APPROVED', can_decide: false, decision: 'RELEASE', decision_comment: '已核实放行' }
    link.busy.value = false
    await link.ui.load()
    assert.equal(link.ui.task.value.id, 'DV-2')
    assert.equal(link.ui.task.value.reason, '原始原因')
    assert.equal(link.ui.task.value.decision_comment, '已核实放行')
    assert.equal(link.ui.canProcess.value, false)
  } finally { link.stop() }
})

test('同一深链后台读取保留当前表单坐标，申请失去可见性时清除旧结果', async () => {
  const task = { id: 'DV-2', type: 'FIELD_DEVIATION', project_id: 'PJ-2',
    service_item_id: 'SI-2', status: 'PENDING', can_decide: true }
  let finish
  const before = { items: [task], total: 1 }
  let result = Promise.resolve(before)
  const link = mountLink({ readTasks: () => result })
  try {
    await link.ui.load()
    result = new Promise(resolve => { finish = resolve })
    const refresh = link.ui.load({ background: true })
    assert.equal(link.ui.loading.value, false)
    assert.equal(link.ui.serviceItem.value.id, 'SI-2')
    assert.equal(link.ui.canProcess.value, false)
    finish({ items: [], total: 0 })
    await refresh
    assert.equal(link.ui.task.value, null)
    assert.equal(link.ui.serviceItem.value, null)
    assert.equal(link.ui.project.value, null)
  } finally { link.stop() }
})
