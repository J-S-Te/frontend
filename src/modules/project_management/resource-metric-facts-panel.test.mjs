import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { nextTick } from 'vue'
import { mountSFC } from '../../test/helpers/mountSFC.mjs'
import { todayBusinessDate } from '../shared/utils/businessTime.js'

const api = resolve('src/modules/project_management/api/projectManagement.js')
const panel = resolve('src/modules/project_management/components/ResourceMetricFactsPanel.vue')
const automationApi = {
  getMetricCalendar: async () => [], saveMetricCalendarRule: async () => ({}),
  getMetricCalendarExceptions: async () => [], saveMetricCalendarException: async () => ({}),
  deleteMetricCalendarException: async () => ({}), generateMetricCapacities: async () => [],
  getMetricUsageCandidates: async () => [], applyMetricUsageCandidate: async () => ({}),
  getMetricAutoConfirmSetting: async () => ({ enabled: false, version: 0 }),
  setMetricAutoConfirmSetting: async () => ({ enabled: false, version: 1 }),
}

async function flush() {
  await nextTick()
  await nextTick()
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0))
}

// 用途：构造一份带实施计划人员的服务项，验证面板自动带出资源、日期和平台组织。
test('资源面板按当前服务项和实施计划自动带出人员、日期与组织归属', async () => {
  const commands = []
  const personnelQueries = []
  const mounted = await mountSFC(panel, { [api]: {
    ...automationApi,
    getMetricResources: async () => [],
    listPersonnel: async (params) => {
      personnelQueries.push(params)
      return { items: [{ user_id: 'U-1', display_name: '张三', organizations: [{ organization_id: 'ORG-1', organization_name: '交付部' }] }], total: 1 }
    },
    postMetricResource: async (...args) => { commands.push(args); return {} },
    postMetricUsageAction: async () => ({}),
    postMetricUsageBatch: async (payload) => { commands.push(payload); return { items: [] } },
  } }, {
    selectedItemId: 'SI-1',
    items: [{ id: 'SI-1', site: '杭州站点', status: '实施中', implementation_plan: {
      planned_start: '2026-11-01', planned_end: '2026-11-30',
      personnel: [{ resource_type: 'PERSON', resource_id: 'P-1', resource_name: '张三', user_id: 'U-1', window_start: '2026-11-01', window_end: '2026-11-30' }],
    } }],
    session: { user_id: 'manager', permissions: ['project.person_capacity.manage', 'project.resource_usage.record'] },
    resources: [{ resource_type: 'PERSON', resource_id: 'P-1', resource_name: '张三', user_id: 'U-1' }],
  })
  try {
    await flush()
    assert.equal(mounted.state.selectedMetricItemID.value, 'SI-1')
    assert.equal(mounted.state.form.resource_id, 'P-1')
    assert.equal(mounted.state.form.organization_id, 'ORG-1')
    assert.equal(mounted.state.form.organization_witness_id, 'U-1')
    assert.equal(mounted.state.autoOrg.value.organization_name, '交付部')
    assert.equal(mounted.state.form.note, '实施计划：张三')
    assert.ok(personnelQueries.some((query) => query.user_id === 'U-1'))
    mounted.state.form.note = '按实施计划发布'
    await mounted.state.save('capacities')
    await flush()
    assert.equal(commands.length, 1)
    assert.equal(commands[0][0], 'capacities')
    assert.equal(commands[0][1].organization_id, 'ORG-1')
    assert.equal(commands[0][1].organization_witness_id, 'U-1')
    assert.equal(commands[0][1].resource_id, 'P-1')
    assert.equal(commands[0][1].intervals.length, 2)
  } finally { mounted.unmount() }
})

test('待我确认用量支持批量独立确认，逐条携带原版本和批量说明', async () => {
  const commands = []
  const rows = [
    { id: 'U-1', status: 'PENDING', resource_type: 'PERSON', resource_id: 'P-1', service_item_id: 'SI-1', business_date: '2026-11-01', start: '2026-11-01T01:00:00Z', end: '2026-11-01T02:00:00Z', minutes: 60, version: 2, created_by: 'manager', submitted_by: 'manager', note: '实际用量' },
    { id: 'U-2', status: 'PENDING', resource_type: 'PERSON', resource_id: 'P-2', service_item_id: 'SI-1', business_date: '2026-11-01', start: '2026-11-01T03:00:00Z', end: '2026-11-01T04:00:00Z', minutes: 60, version: 5, created_by: 'engineer', submitted_by: 'engineer', note: '实际用量' },
  ]
  const mounted = await mountSFC(panel, { [api]: {
    ...automationApi,
    getMetricResources: async (kind) => kind === 'usages' ? rows : [],
    listPersonnel: async () => ({ items: [], total: 0 }),
    postMetricResource: async () => ({}),
    postMetricUsageAction: async (...args) => { commands.push(args); return {} },
    postMetricUsageBatch: async (payload) => { commands.push(payload); return { items: payload.items } },
  } }, {
    items: [{ id: 'SI-1', status: '实施中' }],
    session: { user_id: 'quality', permissions: ['project.resource_usage.confirm'] },
  })
  try {
    await flush()
    assert.equal(mounted.state.pendingConfirm.value.length, 2)
    mounted.state.armBatch('confirm')
    assert.deepEqual(mounted.state.batch.value.items.map((item) => item.id), ['U-1', 'U-2'])
    await mounted.state.executeBatch()
    await flush()
    assert.equal(commands.length, 1)
    assert.equal(commands[0].action, 'DECISION')
    assert.equal(commands[0].decision, 'CONFIRMED')
    assert.equal(commands[0].note, '批量确认')
    assert.deepEqual(commands[0].items, [{ id: 'U-1', expected_version: 2 }, { id: 'U-2', expected_version: 5 }])
  } finally { mounted.unmount() }
})

test('我的退回/草稿支持批量提交，逐条保留版本且不伪造审核结论', async () => {
  const commands = []
  const rows = [
    { id: 'U-1', status: 'DRAFT', resource_type: 'PERSON', resource_id: 'P-1', service_item_id: 'SI-1', business_date: '2026-11-01', start: '2026-11-01T01:00:00Z', end: '2026-11-01T02:00:00Z', minutes: 60, version: 1, created_by: 'engineer', submitted_by: '', note: '实际用量' },
  ]
  const mounted = await mountSFC(panel, { [api]: {
    ...automationApi,
    getMetricResources: async (kind) => kind === 'usages' ? rows : [],
    listPersonnel: async () => ({ items: [], total: 0 }),
    postMetricResource: async () => ({}),
    postMetricUsageAction: async (...args) => { commands.push(args); return {} },
    postMetricUsageBatch: async (payload) => { commands.push(payload); return { items: payload.items } },
  } }, {
    items: [{ id: 'SI-1', status: '实施中' }],
    session: { user_id: 'engineer', permissions: ['project.resource_usage.record'] },
  })
  try {
    await flush()
    assert.equal(mounted.state.myDrafts.value.length, 1)
    mounted.state.armBatch('submit')
    await mounted.state.executeBatch()
    await flush()
    assert.equal(commands.length, 1)
    assert.equal(commands[0].action, 'SUBMIT')
    assert.deepEqual(commands[0].items, [{ id: 'U-1', expected_version: 1 }])
    assert.equal(commands[0].decision, undefined)
  } finally { mounted.unmount() }
})

test('无实施计划时，现场人员自动带出自己的能力档案和今天日期', async () => {
  const mounted = await mountSFC(panel, { [api]: {
    ...automationApi,
    getMetricResources: async () => [],
    listPersonnel: async () => ({ items: [], total: 0 }),
    postMetricResource: async () => ({}),
    postMetricUsageAction: async () => ({}),
    postMetricUsageBatch: async () => ({ items: [] }),
  } }, {
    items: [{ id: 'SI-1', site: '现场', status: '实施中' }],
    session: { user_id: 'engineer-1', permissions: ['project.field.execute', 'project.resource_usage.record'] },
    resources: [{ resource_type: 'PERSON', resource_id: 'P-9', resource_name: '现场工程师', user_id: 'engineer-1' }],
  })
  try {
    await flush()
    assert.equal(mounted.state.form.resource_id, 'P-9')
    assert.equal(mounted.state.form.business_date, todayBusinessDate())
    assert.equal(mounted.state.form.note, '本人实施投入')
  } finally { mounted.unmount() }
})
