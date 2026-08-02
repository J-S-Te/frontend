import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } })
}

test('Portal project API normalizes the complete detail snapshot and paged activities', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    if (url.includes('/activities')) {
      return jsonResponse({ items: [{ Type: 'STATUS_CHANGED', Content: '进入实施阶段', OccurredAt: '2026-08-01T01:00:00Z' }], page: 2, page_size: 20, total: 25 })
    }
    return jsonResponse({
      Snapshot: { ProjectID: 'P/002', ProjectName: '门户项目', ProgressPct: 60, CurrentStage: '实施', ExpectedEndDate: '2026-12-31', Delayed: true, ManagerName: '张经理', ManagerContactMasked: '138****0000', SourceUpdatedAt: '2026-08-01T00:00:00Z', SyncedAt: '2026-08-01T00:05:00Z' },
      Milestones: [{ StageCode: 'DELIVERY', StageName: '实施', Status: 'IN_PROGRESS', PlannedAt: '2026-07-01T00:00:00Z', SortNo: 3 }],
      Activities: [],
      Team: [{ Name: '李工', Role: '实施工程师', ContactMasked: 'li***@example.com' }],
    })
  }
  const api = await import(`./portal.js?project-test=${Date.now()}`)
  const detail = await api.getProject('P/002')
  const activities = await api.listProjectActivities('P/002', { page: 2, page_size: 20 })

  assert.equal(requests[0].url, '/customer-portal/api/v1/projects/P%2F002')
  assert.equal(requests[1].url, '/customer-portal/api/v1/projects/P%2F002/activities?page=2&page_size=20')
  assert.equal(detail.snapshot.manager_contact_masked, '138****0000')
  assert.equal(detail.snapshot.synced_at, '2026-08-01T00:05:00Z')
  assert.equal(detail.milestones[0].stage_code, 'DELIVERY')
  assert.equal(detail.milestones[0].planned_at, '2026-07-01T00:00:00Z')
  assert.equal(detail.milestones[0].sort_no, 3)
  assert.equal(detail.team[0].name, '李工')
  assert.equal(detail.team[0].role, '实施工程师')
  assert.equal(detail.team[0].contact_masked, 'li***@example.com')
  assert.equal(activities.page, 2)
  assert.equal(activities.total, 25)
  assert.equal(activities.items[0].type, 'STATUS_CHANGED')
})

test('Portal project view keeps project, activities and evaluation as independent request states', async () => {
  const view = await readFile(new URL('../views/CustomerPortalView.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(view, /Promise\.all\(\[getProject/)
  assert.match(view, /async function loadProjectActivities/)
  assert.match(view, /async function loadProjectEvaluation/)
  assert.match(view, /!hasPermission\('evaluation\.read'\) && !hasPermission\('evaluation\.create'\)/)
  assert.match(view, /eligibility\?\.evaluation_id && hasPermission\('evaluation\.read'\)/)
  assert.match(view, /evaluationEligibility\?\.eligible && hasPermission\('evaluation\.create'\)/)
  assert.match(view, /项目详情不受影响/)
  assert.match(view, /activityTotal > activityPageSize/)
  assert.match(view, /manager_contact_masked/)
  assert.match(view, /synced_at/)
})
