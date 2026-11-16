import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { nextTick, reactive } from 'vue'
import { mountSFC } from '../../test/helpers/mountSFC.mjs'

const api = resolve('src/modules/project_management/api/projectManagement.js')
const panel = resolve('src/modules/project_management/components/ResourceMetricFactsPanel.vue')
const defaults = {
  getMetricResources: async () => [], getItemMetricResources: async () => [],
  postMetricResource: async () => ({}), postMetricUsageAction: async () => ({}),
  postMetricUsageBatch: async () => ({ items: [] }), listPersonnel: async () => ({ items: [], total: 0 }),
  getMetricCalendar: async () => [], saveMetricCalendarRule: async () => ({}),
  getMetricCalendarExceptions: async () => [], saveMetricCalendarException: async () => ({}),
  deleteMetricCalendarException: async () => ({}), generateMetricCapacities: async () => [],
  getMetricUsageCandidates: async () => [], applyMetricUsageCandidate: async () => ({}),
  getMetricAutoConfirmSetting: async () => ({ enabled: false }), setMetricAutoConfirmSetting: async () => ({}),
}

// 用途：等待实际Vue监听器及接口边界完成一个更新周期。
// 参数：无。
// 返回值：异步刷新完成。
async function flush() {
  await nextTick()
  await new Promise(resolve => setImmediate(resolve))
}

test('节点面板只读取当前服务项台账，容量快捷入口保留当前资源上下文', async () => {
  const queries = []
  const h = await mountSFC(panel, { [api]: { ...defaults,
    getMetricResources: async () => { throw new Error('不应读取全局第一页') },
    getItemMetricResources: async (...args) => { queries.push(args); return [] },
  } }, { scopeToItem: true, initialTab: 'capacity', selectedItemId: 'SI-a',
    items: [{ id: 'SI-a', implementation_plan: { personnel: [{ resource_id: 'P-a' }] } }],
    session: { user_id: 'manager', permissions: ['project.read', 'project.person_capacity.manage'] },
    resources: [{ resource_type: 'PERSON', resource_id: 'P-a' }],
  })
  try {
    await flush()
    assert.equal(h.state.activeTab.value, 'capacity')
    assert.equal(h.state.form.resource_id, 'P-a')
    assert.ok(queries.some(args => args[0] === 'SI-a' && args[1] === 'capacities'))
    assert.ok(queries.some(args => args[0] === 'SI-a' && args[1] === 'usages'))
    assert.equal(h.state.error.value, '')
  } finally { h.unmount() }
})

test('实际用量不默认全天工时，有计划时现场人员仍优先本人档案', async () => {
  let writes = 0
  const h = await mountSFC(panel, { [api]: { ...defaults,
    postMetricResource: async () => { writes++; return {} },
  } }, { scopeToItem: true, selectedItemId: 'SI-a',
    items: [{ id: 'SI-a', implementation_plan: { personnel: [
      { resource_id: 'P-other', resource_name: '其他人员' },
      { resource_id: 'P-self', resource_name: '本人' },
    ] } }],
    resources: [{ resource_type: 'PERSON', resource_id: 'P-self', user_id: 'self', resource_name: '本人' }],
    session: { user_id: 'self', permissions: ['project.read', 'project.field.execute', 'project.resource_usage.record'] },
  })
  try {
    await flush()
    assert.equal(h.state.form.resource_id, 'P-self')
    assert.equal(h.state.form.start, '')
    assert.equal(h.state.form.end, '')
    h.state.form.note = '现场实际投入'; h.state.form.evidence = '本人现场记录'
    await h.state.save('usages')
    assert.equal(writes, 0)
    assert.match(h.state.error.value, /日期|时刻/)
  } finally { h.unmount() }
})

test('切换节点服务项后忽略旧台账返回，不保留上一服务项的更正和时段', async () => {
  let finish
  const h = await mountSFC(panel, { [api]: { ...defaults,
    getItemMetricResources: async (id, kind) => {
      if (id === 'SI-a' && kind === 'usages') return new Promise(resolve => { finish = resolve })
      return kind === 'usages' ? [{ id: 'U-b', service_item_id: 'SI-b' }] : []
    },
  } }, { scopeToItem: true, selectedItemId: 'SI-a', items: [{ id: 'SI-a' }, { id: 'SI-b' }],
    session: { user_id: 'manager', permissions: ['project.read', 'project.resource_usage.record'] },
  })
  try {
    await flush()
    h.state.form.corrects_id = 'U-a'; h.state.form.start = '09:00'
    h.state.selectedMetricItemID.value = 'SI-b'
    await flush()
    assert.equal(h.state.form.corrects_id, '')
    assert.equal(h.state.form.start, '')
    assert.equal(typeof finish, 'function')
    finish([{ id: 'U-a', service_item_id: 'SI-a' }]); await flush()
    assert.deepEqual(h.state.usages.value.map(row => row.id), ['U-b'])
  } finally { h.unmount() }
})

test('节点窗口卸载后统一台账继续使用原未知登记命令，不换键重复创建', async () => {
  const commandState = reactive({ pending: null, busy: false, batch: null, batchBusy: false, revision: 0 })
  const calls = []
  const dependencies = { [api]: { ...defaults, postMetricResource: async (kind, payload) => {
    calls.push({ kind, payload })
    if (calls.length === 1) throw Object.assign(new Error('回执丢失'), { outcomeUnknown: true })
    return { id: 'U-a', version: 1 }
  } } }
  const props = { commandState, scopeToItem: true, selectedItemId: 'SI-a',
    items: [{ id: 'SI-a' }], resources: [{ resource_type: 'PERSON', resource_id: 'P-a' }],
    session: { user_id: 'manager', permissions: ['project.read', 'project.resource_usage.record'] },
  }
  const first = await mountSFC(panel, dependencies, props)
  Object.assign(first.state.form, { resource_id: 'P-a', business_date: '2026-11-01',
    start: '09:00', end: '10:00', note: '实际工作', evidence: '现场记录' })
  await first.state.save('usages')
  assert.ok(first.state.pending.value)
  first.unmount()
  const second = await mountSFC(panel, dependencies, props)
  try {
    assert.ok(second.state.pending.value, '原命令须由页面持有')
    await second.state.execute()
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1], calls[0])
    assert.equal(second.state.pending.value, null)
  } finally { second.unmount() }
})

test('未知候选登记由同一资源命令恢复，重试仍绑定原服务项和日期', async () => {
  const calls = []
  const h = await mountSFC(panel, { [api]: { ...defaults,
    applyMetricUsageCandidate: async (id, payload) => {
      calls.push({ id, payload })
      if (calls.length === 1) throw Object.assign(new Error('候选回执丢失'), { outcomeUnknown: true })
      return { id: 'U-a', version: 1 }
    },
  } }, { scopeToItem: true, selectedItemId: 'SI-a', items: [{ id: 'SI-a' }],
    session: { user_id: 'manager', permissions: ['project.read', 'project.resource_usage.record'] },
  })
  try {
    assert.equal(typeof h.state.applyCandidate, 'function')
    await h.state.applyCandidate({ item_id: 'SI-a', resource_id: 'P-a', business_date: '2026-11-01' })
    assert.ok(h.state.pending.value)
    await h.state.execute()
    assert.deepEqual(calls[1], calls[0])
  } finally { h.unmount() }
})

test('仅有设备职责时容量入口直接带出准备设备，不依赖人员目录或设备页残留', async () => {
  const h = await mountSFC(panel, { [api]: defaults }, {
    scopeToItem: true, initialTab: 'capacity', selectedItemId: 'SI-a',
    items: [{ id: 'SI-a', implementation_plan: { personnel: [],
      equipment: [{ resource_id: 'D-a', resource_name: '检测设备' }] } }],
    equipment: [], session: { user_id: 'device-admin', permissions: [
      'project.read', 'project.device.manage', 'project.equipment_capacity.manage', 'project.resource_usage.record',
    ] },
  })
  try {
    await flush()
    assert.equal(h.state.activeTab.value, 'capacity')
    assert.equal(h.state.form.resource_type, 'EQUIPMENT')
    assert.equal(h.state.form.resource_id, 'D-a')
    assert.equal(h.state.selectedResource.value?.resource_name, '检测设备')
  } finally { h.unmount() }
})

test('真实混合计划为设备岗位带出准备设备，并为容量建议计划日期', async () => {
  const h = await mountSFC(panel, { [api]: defaults }, {
    scopeToItem: true, initialTab: 'capacity', selectedItemId: 'SI-a',
    items: [{ id: 'SI-a', implementation_plan: {
      planned_start: '2026-12-01', planned_end: '2026-12-03',
      personnel: [{ resource_id: 'P-a' }],
      equipment: [{ resource_id: 'D-a', resource_name: '检测设备', window_start: '2026-12-02', window_end: '2026-12-03' }],
    } }], session: { user_id: 'device-admin', permissions: ['project.read', 'project.device.manage', 'project.equipment_capacity.manage'] },
  })
  try {
    await flush()
    assert.equal(h.state.form.resource_type, 'EQUIPMENT')
    assert.equal(h.state.form.resource_id, 'D-a')
    assert.equal(h.state.form.business_date, '2026-12-02')
    assert.deepEqual(h.state.capacityDates.value, { from: '2026-12-02', to: '2026-12-03' })
  } finally { h.unmount() }
})

test('集中台账从A更正B已确认记录，切项后仍保留原记录和实际资源', async () => {
  const writes = []
  const h = await mountSFC(panel, { [api]: { ...defaults,
    postMetricResource: async (...args) => { writes.push(args); return { id: 'new', version: 1 } },
  } }, { selectedItemId: 'SI-a', items: [{ id: 'SI-a' }, { id: 'SI-b' }],
    resources: [{ resource_type: 'PERSON', resource_id: 'P-b' }],
    session: { user_id: 'manager', permissions: ['project.read', 'project.resource_usage.record', 'project.implementation.plan'] },
  })
  try {
    await h.state.correctUsage({ id: 'old-b', service_item_id: 'SI-b', resource_type: 'PERSON',
      resource_id: 'P-b', business_date: '2026-11-01', status: 'CONFIRMED', created_by: 'manager' })
    await flush()
    assert.equal(h.state.form.corrects_id, 'old-b')
    assert.equal(h.state.form.resource_id, 'P-b')
    Object.assign(h.state.form, { start: '10:00', end: '11:00', note: '更正', evidence: '原始记录' })
    await h.state.save('usages')
    assert.equal(writes[0]?.[1].corrects_id, 'old-b')
    assert.equal(writes[0]?.[1].service_item_id, 'SI-b')
  } finally { h.unmount() }
})

test('失效深链保留未选择，不能静默改成列表第一项', async () => {
  const h = await mountSFC(panel, { [api]: defaults }, {
    selectedItemId: 'SI-not-in-snapshot', items: [{ id: 'SI-visible' }],
    session: { user_id: 'reader', permissions: ['project.read'] },
  })
  try {
    await flush()
    assert.equal(h.state.activeItem.value, null)
    assert.equal(h.state.selectedMetricItemID.value, '')
    assert.match(h.state.notice.value, /重新选择|可见列表/)
  } finally { h.unmount() }
})

test('从有计划A切到无计划B，清空原资源与组织，不沿用上一项窗口', async () => {
  const h = await mountSFC(panel, { [api]: defaults }, {
    selectedItemId: 'SI-a', items: [{ id: 'SI-a', implementation_plan: { personnel: [{ resource_id: 'P-a' }] } }, { id: 'SI-b' }],
    session: { user_id: 'manager', permissions: ['project.read', 'project.implementation.plan', 'project.resource_usage.record'] },
  })
  try {
    await flush(); assert.equal(h.state.form.resource_id, 'P-a')
    h.state.autoOrg.value = { user_id: 'u-a', organization_id: 'org-a' }
    h.state.capacityWindows.value = [{ start: '20:00', end: '21:00' }]
    h.state.selectedMetricItemID.value = 'SI-b'; await flush()
    assert.equal(h.state.form.resource_id, '')
    assert.equal(h.state.form.organization_id, '')
    assert.equal(h.state.autoOrg.value.organization_id, '')
    assert.notEqual(h.state.capacityWindows.value[0]?.start, '20:00')
  } finally { h.unmount() }
})

test('未知批次不能换键覆盖或普通取消，单笔与批量互斥并保留真实来源', async () => {
  const commandState = reactive({ pending: null, busy: false, batch: null, batchBusy: false, revision: 0 })
  const h = await mountSFC(panel, { [api]: { ...defaults,
    getMetricResources: async kind => kind === 'usages' ? [{ id: 'U-a', service_item_id: 'SI-a',
      status: 'DRAFT', version: 1, created_by: 'manager' }] : [],
    postMetricUsageBatch: async () => { throw Object.assign(new Error('回执丢失'), { outcomeUnknown: true }) },
  } }, { commandState, selectedItemId: 'SI-a', items: [{ id: 'SI-a' }, { id: 'SI-b' }],
    session: { user_id: 'manager', permissions: ['project.read', 'project.resource_usage.record'] },
  })
  try {
    await flush(); h.state.armBatch('submit')
    const originalKey = h.state.batch.value.key
    await h.state.executeBatch()
    h.state.armBatch('submit')
    assert.equal(h.state.batch.value.key, originalKey)
    assert.equal(typeof h.state.cancelBatch, 'function')
    h.state.cancelBatch()
    assert.equal(h.state.batch.value.key, originalKey)
    assert.deepEqual(h.state.batch.value.itemIDs, ['SI-a'])
    h.state.selectedMetricItemID.value = 'SI-b'; await flush()
    assert.deepEqual(h.state.batch.value.itemIDs, ['SI-a'])
  } finally { h.unmount() }
})

test('窗口关闭后的明确拒绝保留共享回执，未知操作可暂存并用原键恢复', async () => {
  const commandState = reactive({ pending: null, busy: false, batch: null, batchBusy: false, revision: 0 })
  let reject
  const dependencies = { [api]: { ...defaults, postMetricResource: () => new Promise((resolve, fail) => { reject = fail }) } }
  const props = { commandState, selectedItemId: 'SI-a', items: [{ id: 'SI-a' }],
    resources: [{ resource_type: 'PERSON', resource_id: 'P-a' }],
    session: { user_id: 'manager', permissions: ['project.read', 'project.resource_usage.record'] },
  }
  const first = await mountSFC(panel, dependencies, props)
  Object.assign(first.state.form, { resource_id: 'P-a', business_date: '2026-11-01',
    start: '09:00', end: '10:00', note: '实际', evidence: '记录' })
  const write = first.state.save('usages')
  first.unmount()
  reject(Object.assign(new Error('容量已变化'), { status: 422 })); await write
  assert.equal(commandState.outcome?.status, 'REJECTED')
  assert.match(commandState.outcome.message, /容量已变化/)
  assert.deepEqual(commandState.outcome.itemIDs, ['SI-a'])
  const h = await mountSFC(panel, dependencies, props)
  try {
    commandState.pending = { kind: 'usages', context_item_id: 'SI-a', payload: {
      service_item_id: 'SI-a', resource_type: 'PERSON', resource_id: 'P-a', business_date: '2026-11-01', idempotency_key: 'original-key',
    }, state: 'UNKNOWN' }
    assert.equal(typeof h.state.parkPending, 'function')
    h.state.parkPending()
    assert.equal(commandState.pending, null)
    assert.equal(commandState.unresolved.length, 1)
    h.state.restorePending(commandState.unresolved[0])
    assert.equal(commandState.pending.payload.idempotency_key, 'original-key')
  } finally { h.unmount() }
})

test('手动目录新查询完成后，旧查询不能覆盖人员与组织候选', async () => {
  let release
  const h = await mountSFC(panel, { [api]: { ...defaults,
    listPersonnel: async query => query.keyword === 'old'
      ? new Promise(resolve => { release = resolve })
      : { items: [{ user_id: 'new-user', display_name: '新查询' }], total: 1 },
  } }, { session: { user_id: 'manager', permissions: ['project.read'] } })
  try {
    h.state.peopleKeyword.value = 'old'
    const old = h.state.searchPeople()
    h.state.peopleKeyword.value = 'new'; await h.state.searchPeople()
    release({ items: [{ user_id: 'old-user', display_name: '旧查询' }], total: 1 }); await old
    assert.equal(h.state.people.value[0].user_id, 'new-user')
  } finally { h.unmount() }
})

test('中心深链只预选不锁定服务项，切换资源类型自动带出准备设备', async () => {
  const h = await mountSFC(panel, { [api]: defaults }, {
    selectedItemId: 'SI-a', items: [{ id: 'SI-a', implementation_plan: {
      personnel: [{ resource_id: 'P-a' }], equipment: [{ resource_id: 'D-a', resource_name: '准备设备' }],
    } }, { id: 'SI-b' }], session: { user_id: 'manager', permissions: [
      'project.read', 'project.implementation.plan', 'project.resource_usage.record',
    ] },
  })
  try {
    await flush()
    assert.equal(h.state.hasSelectedItem.value, false)
    h.state.form.resource_type = 'EQUIPMENT'; await flush()
    assert.equal(h.state.form.resource_id, 'D-a')
  } finally { h.unmount() }
})

test('暂存未知命令后同目标不能换键重登，其他资源仍可正常登记', async () => {
  const writes = []
  const h = await mountSFC(panel, { [api]: { ...defaults,
    postMetricResource: async (...args) => { writes.push(args); return { id: 'new', version: 1 } },
  } }, { selectedItemId: 'SI-a', items: [{ id: 'SI-a' }],
    resources: [{ resource_type: 'PERSON', resource_id: 'P-a' }, { resource_type: 'PERSON', resource_id: 'P-b' }],
    session: { user_id: 'manager', permissions: ['project.read', 'project.implementation.plan', 'project.resource_usage.record'] },
  })
  try {
    await flush()
    h.state.pending.value = { kind: 'usages', state: 'UNKNOWN', context_item_id: 'SI-a', payload: {
      service_item_id: 'SI-a', resource_type: 'PERSON', resource_id: 'P-a', business_date: '2026-11-01', idempotency_key: 'original',
    } }
    h.state.parkPending()
    Object.assign(h.state.form, { resource_id: 'P-a', business_date: '2026-11-01',
      start: '09:00', end: '10:00', note: '实际', evidence: '证据' })
    await h.state.save('usages')
    assert.equal(writes.length, 0)
    assert.match(h.state.error.value, /原操作|待核对/)
    h.state.form.resource_id = 'P-b'
    await h.state.save('usages')
    assert.equal(writes.length, 1)
    assert.equal(writes[0][1].resource_id, 'P-b')
  } finally { h.unmount() }
})

test('同一人员跨服务项切换仍重新解析当前组织，表单与显示归属一致', async () => {
  let calls = 0
  const h = await mountSFC(panel, { [api]: { ...defaults,
    listPersonnel: async () => ({ items: [{ user_id: 'person', organizations: [{
      organization_id: ++calls === 1 ? 'org-a' : 'org-b',
    }] }] }),
  } }, { selectedItemId: 'SI-a', items: ['SI-a', 'SI-b'].map(id => ({ id,
    implementation_plan: { personnel: [{ resource_id: 'P-a', user_id: 'person' }] },
  })), session: { user_id: 'manager', permissions: ['project.read', 'project.implementation.plan',
    'project.person_capacity.manage'] } })
  try {
    await flush()
    assert.equal(h.state.form.organization_id, 'org-a')
    h.state.selectedMetricItemID.value = 'SI-b'; await flush()
    assert.ok(calls >= 2)
    assert.equal(h.state.form.organization_id, 'org-b')
    assert.equal(h.state.autoOrg.value.organization_id, h.state.form.organization_id)
    assert.equal(h.state.form.organization_witness_id, 'person')
  } finally { h.unmount() }
})

test('在A服务项页面处理B用量行，最终回执标识B而非当前选择', async () => {
  const commandState = reactive({ pending: null, busy: false, batch: null, batchBusy: false, revision: 0 })
  const h = await mountSFC(panel, { [api]: { ...defaults,
    postMetricUsageAction: async () => ({ id: 'U-b', version: 2 }),
  } }, { commandState, selectedItemId: 'SI-a', items: [{ id: 'SI-a' }, { id: 'SI-b' }],
    session: { user_id: 'manager', permissions: ['project.read', 'project.resource_usage.record'] },
  })
  try {
    await flush()
    await h.state.act({ id: 'U-b', version: 1, service_item_id: 'SI-b' }, 'submit')
    assert.deepEqual([...commandState.outcome.itemIDs], ['SI-b'])
    assert.equal(commandState.outcome.status, 'CONFIRMED')
  } finally { h.unmount() }
})
