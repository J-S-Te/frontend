import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { nextTick } from 'vue'
import { mountSFC } from '../../test/helpers/mountSFC.mjs'

const api = resolve('src/modules/project_management/api/projectManagement.js')
const panel = resolve('src/modules/project_management/components/ResourceMetricAutomationPanel.vue')

async function flush() {
  await nextTick()
  await nextTick()
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0))
}

test('自动化助手保存星期规则、生成容量、应用现场候选并切换自动确认策略', async () => {
  const calls = []
  const mounted = await mountSFC(panel, { [api]: {
    getMetricCalendar: async () => [{ weekday: 1, version: 3, intervals: [{ start: '2026-01-05T01:00:00Z', end: '2026-01-05T10:00:00Z' }] }],
    saveMetricCalendarRule: async (payload) => { calls.push(['rule', payload]); return payload },
    getMetricCalendarExceptions: async () => [],
    saveMetricCalendarException: async (payload) => { calls.push(['exception', payload]); return payload },
    deleteMetricCalendarException: async () => ({}),
    generateMetricCapacities: async (payload) => { calls.push(['generate', payload]); return [{ business_date: '2026-11-15', status: 'PUBLISHED', minutes: 480 }] },
    getMetricUsageCandidates: async () => [{ resource_id: 'P-1', business_date: '2026-11-15', start: '2026-11-15T01:00:00Z', end: '2026-11-15T02:00:00Z', minutes: 60, complete: true, auto_confirmable: false, source_event_ids: ['E1'], evidence: '现场签到 + 现场记录' }],
    applyMetricUsageCandidate: async (itemID, payload) => { calls.push(['apply', itemID, payload]); return {} },
    getMetricAutoConfirmSetting: async () => ({ enabled: false, version: 1 }),
    setMetricAutoConfirmSetting: async (payload) => { calls.push(['auto', payload]); return { enabled: true, version: 2 } },
  } }, {
    session: { user_id: 'engineer', permissions: ['project.resource_usage.record'] },
    item: { id: 'SI-1' }, resource: { resource_type: 'PERSON', resource_id: 'P-1', resource_name: '张三' },
    organization: 'ORG-1', witness: 'U-1', canCapacity: true, canRecord: true, canConfirm: true,
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
    assert.equal(apply[1], 'SI-1')
    assert.equal(apply[2].resource_id, 'P-1')
    await mounted.state.toggleAutoConfirm()
    const auto = calls.find((call) => call[0] === 'auto')?.[1]
    assert.equal(auto.enabled, true)
    assert.equal(auto.expected_version, 1)
  } finally { mounted.unmount() }
})
