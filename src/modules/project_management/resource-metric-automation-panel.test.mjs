import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { nextTick, reactive, toRaw } from 'vue'
import { mountSFC } from '../../test/helpers/mountSFC.mjs'

const api = resolve('src/modules/project_management/api/projectManagement.js')
const panel = resolve('src/modules/project_management/components/ResourceMetricAutomationPanel.vue')

async function flush() {
  await nextTick()
  await nextTick()
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0))
}

test('自动化助手保存星期规则、生成容量、触发候选登记并切换自动确认策略', async () => {
  const calls = []
  const mounted = await mountSFC(panel, { [api]: {
    getMetricCalendar: async () => [{ weekday: 1, version: 3, intervals: [{ start: '2026-01-05T01:00:00Z', end: '2026-01-05T10:00:00Z' }] }],
    saveMetricCalendarRule: async (payload) => { calls.push(['rule', payload]); return payload },
    getMetricCalendarExceptions: async () => [],
    saveMetricCalendarException: async (payload) => { calls.push(['exception', payload]); return payload },
    deleteMetricCalendarException: async () => ({}),
    generateMetricCapacities: async (payload) => { calls.push(['generate', payload]); return [{ business_date: '2026-11-15', status: 'PUBLISHED', minutes: 480 }] },
    getMetricUsageCandidates: async () => [{ resource_id: 'P-1', business_date: '2026-11-15', start: '2026-11-15T01:00:00Z', end: '2026-11-15T02:00:00Z', minutes: 60, complete: true, auto_confirmable: false, source_event_ids: ['E1'], evidence: '现场签到 + 现场记录' }],
    applyMetricUsageCandidate: async () => { throw new Error('候选应交由父面板共享命令执行') },
    getMetricAutoConfirmSetting: async () => ({ enabled: false, version: 1 }),
    setMetricAutoConfirmSetting: async (payload) => { calls.push(['auto', payload]); return { enabled: true, version: 2 } },
  } }, {
    session: { user_id: 'engineer', permissions: ['project.resource_usage.record'] },
    item: { id: 'SI-1' }, resource: { resource_type: 'PERSON', resource_id: 'P-1', resource_name: '张三' },
    organization: 'ORG-1', witness: 'U-1', canCapacity: true, canRecord: true, canConfirm: true,
    onApplyCandidate: row => calls.push(['apply', row.item_id, row]),
  })
  try {
    await flush()
    assert.equal(mounted.state.calendar.value[0].version, 3)
    await mounted.state.saveWeekday(mounted.state.calendar.value[0])
    const rule = calls.find((call) => call[0] === 'rule')?.[1]
    assert.equal(rule.organization_id, 'ORG-1')
    assert.equal(rule.weekday, 1)
    assert.equal(rule.expected_version, 3)
    assert.equal(rule.organization_witness_id, 'U-1')
    await mounted.state.generate()
    const generate = calls.find((call) => call[0] === 'generate')?.[1]
    assert.equal(generate.resource_ids[0], 'P-1')
    assert.equal(generate.organization_id, 'ORG-1')
    await mounted.state.applyCandidate(mounted.state.candidates.value[0])
    const apply = calls.find((call) => call[0] === 'apply')
    assert.ok(apply, '候选应发出父面板登记事件')
    assert.equal(apply[1], 'SI-1')
    assert.equal(apply[2].resource_id, 'P-1')
    await mounted.state.toggleAutoConfirm()
    const auto = calls.find((call) => call[0] === 'auto')?.[1]
    assert.equal(auto.enabled, true)
    assert.equal(auto.expected_version, 1)
  } finally { mounted.unmount() }
})

test('现场版本变化重新读取候选，切换父项后旧候选返回不能串入新服务项', async () => {
  const item = reactive({ id: 'SI-a', version: 1 })
  const queries = []
  let release, delayed = false
  const h = await mountSFC(panel, { [api]: {
    getMetricCalendar: async () => [], saveMetricCalendarRule: async () => ({}),
    getMetricCalendarExceptions: async () => [], saveMetricCalendarException: async () => ({}),
    deleteMetricCalendarException: async () => ({}), generateMetricCapacities: async () => [],
    getMetricUsageCandidates: async id => {
      queries.push(id)
      if (delayed && id === 'SI-a') return new Promise(resolve => { release = resolve })
      return [{ resource_id: `resource-${id}`, complete: true }]
    },
    applyMetricUsageCandidate: async () => ({}),
    getMetricAutoConfirmSetting: async () => ({ enabled: false }), setMetricAutoConfirmSetting: async () => ({}),
  } }, { item, canRecord: true })
  try {
    await flush(); assert.equal(queries.length, 1)
    item.version = 2; await flush()
    assert.equal(queries.length, 2)
    delayed = true
    const oldRead = h.state.loadCandidates()
    item.id = 'SI-b'; item.version = 1; await flush()
    release([{ resource_id: 'stale-resource', complete: true }]); await oldRead
    assert.equal(h.state.candidates.value[0].resource_id, 'resource-SI-b')
  } finally { h.unmount() }
})

test('组织B的日历与例外已读后，组织A迟到返回不能覆盖或提供可删除的旧行', async () => {
  let calendarA, exceptionsA
  const deletes = []
  const h = await mountSFC(panel, { [api]: {
    getMetricCalendar: async org => org === 'A' ? new Promise(resolve => { calendarA = resolve })
      : [{ weekday: 1, version: 1, intervals: [{ start: '2026-01-05T01:00:00Z', end: '2026-01-05T02:00:00Z' }] }],
    saveMetricCalendarRule: async () => ({}),
    getMetricCalendarExceptions: async org => org === 'A' ? new Promise(resolve => { exceptionsA = resolve })
      : [{ id: 'exception-B', organization_id: 'B', version: 1 }],
    saveMetricCalendarException: async () => ({}),
    deleteMetricCalendarException: async id => { deletes.push(id) }, generateMetricCapacities: async () => [],
    getMetricUsageCandidates: async () => [], getMetricAutoConfirmSetting: async () => ({ enabled: false }),
    setMetricAutoConfirmSetting: async () => ({}),
  } }, { organization: 'A', item: { id: 'SI-a' }, canCapacity: true })
  try {
    await flush()
    const input = reactive(toRaw(h.state.props))
    input.organization = 'B'; await flush()
    calendarA([{ weekday: 1, version: 1, intervals: [{ start: '2026-01-05T05:00:00Z', end: '2026-01-05T06:00:00Z' }] }])
    exceptionsA([{ id: 'exception-A', organization_id: 'A', version: 1 }]); await flush()
    assert.equal(h.state.calendar.value[0].start, '09:00')
    assert.equal(h.state.exceptions.value[0].id, 'exception-B')
    await h.state.removeException({ id: 'exception-A', organization_id: 'A', version: 1 })
    assert.deepEqual(deletes, [])
  } finally { h.unmount() }
})
