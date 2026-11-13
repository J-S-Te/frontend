import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { nextTick } from 'vue'
import { mountSFC } from '../../test/helpers/mountSFC.mjs'

const api = resolve('src/modules/project_management/api/projectManagement.js')

test('主报告待审不受专项超过50轮历史和翻页影响，按钮命令仍绑定当前轮次', async () => {
  const pending = { id: 'main-pending', subject_type: 'SERVICE_ITEM', revision: 0, decision: 'PENDING', prepared_by: 'author', submitted_by: 'manager' }
  const history = Array.from({ length: 50 }, (_, index) => ({ id: `special-${index}`, subject_type: 'PENETRATION_WORK_PACKAGE', revision: 0, round_no: 100 - index, decision: 'RETURNED' }))
  const commands = []
  const mounted = await mountSFC(resolve('src/modules/project_management/components/ReportReviewFactsPanel.vue'), { [api]: {
    getMetricReportReviews: async (_id, page) => page === 1 ? history : [pending],
    getCurrentMetricReportReviews: async () => [pending],
    postMetricReportReview: async (...args) => { commands.push(args); return pending },
  } }, { item: { id: 'SI-1', version: 5, report_revision: 0, report_status: 'COMPILING' }, session: { user_id: 'quality', permissions: ['project.report.review'] } })
  try {
    await nextTick(); await nextTick()
    assert.equal(mounted.state.current.value?.id, 'main-pending')
    assert.equal(mounted.state.canDecide.value, true)
    await mounted.state.changePage(1)
    assert.equal(mounted.state.canDecide.value, true)
    await mounted.state.submit('PASSED')
    assert.equal(commands.length, 1)
    assert.equal(commands[0][2].round_id, 'main-pending')
  } finally { mounted.unmount() }
})

test('项目经理送审带当前版本，回执未知时仅按原幂等命令重试', async () => {
  const commands = []
  let uncertain = true
  const mounted = await mountSFC(resolve('src/modules/project_management/components/ReportReviewFactsPanel.vue'), { [api]: {
    getMetricReportReviews: async () => [], getCurrentMetricReportReviews: async () => [],
    postMetricReportReview: async (...args) => {
      commands.push(args)
      if (uncertain) throw Object.assign(new Error('结果尚未确认'), {outcomeUnknown:true})
      return {}
    },
  } }, { item: {id:'SI-submit',version:5,report_revision:2,report_status:'COMPILING'},
    session: {user_id:'manager',permissions:['project.report.prepare']} })
  try {
    await nextTick(); await nextTick()
    assert.equal(mounted.state.canSubmit.value, true)
    assert.equal(mounted.state.canDecide.value, false)
    await mounted.state.submit()
    assert.equal(commands.length, 1)
    const [item, action, payload] = commands[0]
    assert.equal(item, 'SI-submit')
    assert.equal(action, 'submit')
    assert.equal(payload.subject_type, 'SERVICE_ITEM')
    assert.equal(payload.revision, 2)
    assert.equal(payload.expected_version, 5)
    assert.match(payload.idempotency_key, /^[\da-f-]{36}$/i)
    await mounted.state.submit()
    assert.equal(commands.length, 1)
    uncertain = false
    await mounted.state.execute()
    assert.deepEqual(commands[1], commands[0])
    assert.equal(mounted.state.pending.value, null)
  } finally { mounted.unmount() }
})
