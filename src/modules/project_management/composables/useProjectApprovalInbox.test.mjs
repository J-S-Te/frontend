import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, ref } from 'vue'
import { useProjectApprovalInbox } from './useProjectApprovalInbox.js'

// 用途：装配真实待办逻辑，只替换远程读写边界。
// 参数：overrides 为特定场景的隔离接口行为。
// 返回值：待办状态、路由与身份上下文、业务调用及清理方法。
async function fixture(overrides = {}) {
  const requestID = ref(''), context = ref('tenant-a:user-a'), userID = ref('user-a')
  const task = { id: 'req-1', type: 'REPORT_REWORK', project_id: 'P-1', service_item_id: 'SI-1',
    site: '杭州', reason: '需要补测', requester_user_id: 'manager', approver_user_id: 'user-a',
    created_at: '2026-11-18T01:00:00Z', version: 7, report_status: 'COMPILING',
    service_item_status: '现场实施完成', status: 'PENDING', can_decide: true, decision_comment: '' }
  const queries = [], writes = [], changes = []
  const scope = effectScope()
  const state = scope.run(() => useProjectApprovalInbox({ requestID, context, userID,
    listApprovalTasks: async query => { queries.push(query); return { items: [task], total: 1, page: query.page, page_size: 20 } },
    decideRollback: async (...args) => writes.push(['rollback', ...args]),
    decideReportCorrection: async (...args) => writes.push(['correction', ...args]),
    onChanged: () => changes.push(true), ...overrides,
  }))
  return { ...state, requestID, context, userID, task, queries, writes, changes,
    stop: () => scope.stop() }
}

test('默认查询独立待审批分页，我提交的视图携带 submitted，精确申请不自动审批', async () => {
  const h = await fixture()
  try {
    await h.load()
    assert.deepEqual(h.queries[0], { page: 1, page_size: 20, view: 'assigned' })
    await h.changeView('submitted')
    assert.equal(h.queries.at(-1).view, 'submitted')
    h.requestID.value = 'req-1'
    await h.load()
    assert.equal(h.queries.at(-1).request_id, 'req-1')
    assert.equal(h.items.value[0].id, 'req-1')
    assert.equal(h.writes.length, 0)
  } finally { h.stop() }
})

test('返工与更正使用正确业务接口且提交读取到的当前版本，成功后保持已确认提示', async () => {
  for (const [type, api] of [['REPORT_REWORK', 'rollback'], ['REPORT_CORRECTION', 'correction']]) {
    const h = await fixture()
    try {
      h.task.type = type
      h.task.approver_user_id = ''
      await h.load()
      assert.equal(await h.decide(h.items.value[0], 'APPROVED', '  同意补测  '), true)
      assert.deepEqual(h.writes, [[api, 'SI-1', 'req-1',
        { decision: 'APPROVED', comment: '同意补测', expected_version: 7 }]])
      assert.equal(h.changes.length, 1)
      assert.match(h.success.value, /已批准/)
    } finally { h.stop() }
  }
})

test('无权、自批、已处理、非法决定、空意见及无版本均不发送审批', async () => {
  for (const change of [
    { can_decide: false }, { requester_user_id: 'user-a' }, { status: 'APPROVED' },
    { version: undefined }, { type: 'UNKNOWN' },
  ]) {
    const h = await fixture()
    try {
      Object.assign(h.task, change); await h.load()
      await h.decide(h.items.value[0], 'APPROVED', '同意')
      assert.equal(h.writes.length, 0, JSON.stringify(change))
    } finally { h.stop() }
  }
  const h = await fixture()
  try {
    await h.load()
    await h.decide(h.items.value[0], 'APPROVED', '  ')
    await h.decide(h.items.value[0], 'INVALID', '同意')
    assert.equal(h.writes.length, 0)
  } finally { h.stop() }
})

test('精确申请已处理时保留结果，找不到与无权分别显示明确反馈', async () => {
  const h = await fixture()
  try {
    h.task.status = 'REJECTED'; h.task.can_decide = false; h.task.decision_comment = '材料不足'
    h.requestID.value = 'req-1'; await h.load()
    assert.equal(h.items.value[0].decision_comment, '材料不足')
    assert.equal(h.writes.length, 0)
  } finally { h.stop() }
  const missing = await fixture({ listApprovalTasks: async () => ({ items: [], total: 0 }) })
  try {
    missing.requestID.value = 'missing'; await missing.load()
    assert.match(missing.error.value, /不存在|无权|不可见/)
  } finally { missing.stop() }
  const forbidden = await fixture({ listApprovalTasks: async () => { throw Object.assign(new Error('forbidden'), { status: 403 }) } })
  try { await forbidden.load(); assert.match(forbidden.error.value, /无权/) }
  finally { forbidden.stop() }
})

test('快速切换申请与身份后，旧读取、错误及审批回执不得污染当前页面', async () => {
  let resolveOld
  const h = await fixture()
  try {
    h.requestID.value = 'old'
    let calls = 0
    // 只在远程边界延迟；真实查询世代守卫仍由 composable 执行。
    h.stop()
    const race = await fixture({ listApprovalTasks: () => ++calls === 1
      ? new Promise(resolve => { resolveOld = resolve })
      : Promise.resolve({ items: [{ ...h.task, id: 'new' }], total: 1 }) })
    try {
      const old = race.load(); race.requestID.value = 'new'; await race.load()
      resolveOld({ items: [{ ...h.task, id: 'old' }], total: 1 }); await old
      assert.equal(race.items.value[0].id, 'new')
      assert.equal(race.error.value, '')
    } finally { race.stop() }
  } finally { h.stop() }
  let finish
  const write = await fixture({ decideRollback: () => new Promise(resolve => { finish = resolve }) })
  try {
    await write.load()
    const pending = write.decide(write.items.value[0], 'APPROVED', '同意')
    assert.equal(await write.decide(write.items.value[0], 'APPROVED', '同意'), false)
    write.context.value = 'tenant-b:another'
    finish(); await pending
    assert.equal(write.success.value, '')
    assert.equal(write.changes.length, 0)
    assert.equal(write.saving.value, false)
  } finally { write.stop() }
})

test('审批冲突保留失败并刷新最新结果，写成功但刷新失败明确已保存且禁止旧数据重批', async () => {
  let reads = 0
  const h = await fixture({ listApprovalTasks: async () => {
    if (++reads > 1) throw new Error('查询不可用')
    return { items: [h.task], total: 1 }
  } })
  try {
    await h.load()
    assert.equal(await h.decide(h.items.value[0], 'APPROVED', '同意'), true)
    assert.match(h.success.value, /已批准/)
    assert.match(h.error.value, /已保存|已处理|最新/)
    assert.equal(h.items.value.length, 0)
    assert.equal(h.writes.length, 1)
  } finally { h.stop() }
  const conflict = await fixture({ decideRollback: async () => {
    throw Object.assign(new Error('版本冲突'), { status: 409 })
  } })
  try {
    await conflict.load(); await conflict.decide(conflict.items.value[0], 'APPROVED', '同意')
    assert.match(conflict.error.value, /冲突|已变化/)
    assert.equal(conflict.queries.length, 2)
    assert.equal(conflict.success.value, '')
  } finally { conflict.stop() }
})

test('写回后刷新期间切换申请，不把旧审批成功或失败发布到新详情', async () => {
  for (const conflict of [false, true]) {
    let finishRead, reads = 0
    const h = await fixture({ listApprovalTasks: async () => {
      if (++reads === 2) return new Promise(resolve => { finishRead = resolve })
      return { items: [{ ...h.task, id: reads > 2 ? 'next' : 'req-1' }], total: 1 }
    }, decideRollback: async () => {
      if (conflict) throw Object.assign(new Error('冲突'), { status: 409 })
    } })
    try {
      await h.load()
      const pending = h.decide(h.items.value[0], 'APPROVED', '同意')
      await Promise.resolve()
      h.requestID.value = 'next'; await h.load()
      finishRead({ items: [h.task], total: 1 }); await pending
      assert.equal(h.success.value, '')
      assert.equal(h.error.value, '')
      assert.equal(h.changes.length, 0)
      assert.equal(h.items.value[0].id, 'next')
    } finally { h.stop() }
  }
})

test('后台读取成功返回空结果时撤下之前可见的精确申请', async () => {
  const task = { id: 'req-1', status: 'PENDING', can_decide: true }
  let response = { items: [task], total: 1 }
  const h = await fixture({ listApprovalTasks: async () => response })
  try {
    h.requestID.value = task.id
    assert.equal(await h.load(), true)
    response = { items: [], total: 0 }
    assert.equal(await h.load({ background: true }), false)
    assert.equal(h.items.value.length, 0)
    assert.equal(h.total.value, 0)
  } finally { h.stop() }
})
