import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  createPositionAuthorizationTemplate,
  disablePositionAuthorizationTemplate,
  listPositionAuthorizationTargets,
  listPositionAuthorizationPositions,
  listPositionAuthorizationTemplateAssignments,
  previewPositionAuthorization,
  replacePositionAuthorizationTemplateAssignments,
  updatePositionAuthorizationTemplate,
} from './positionAuthorization.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function response(data = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ data }),
    text: async () => '',
  }
}

test('position authorization template APIs keep application-role mappings and position assignments explicit', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return response()
  }

  await listPositionAuthorizationTargets()
  await listPositionAuthorizationPositions()
  await createPositionAuthorizationTemplate({
    // A legacy caller may still pass code, but browser clients must never submit it.
    code: 'sales_standard',
    name: '销售岗位模板',
    roles: [{ application_id: 'app-1', role_id: 'role-1', scope_type: 'TENANT', scope_id: '' }],
  })
  await updatePositionAuthorizationTemplate('template / 1', { code: 'PT-20260729-001', name: '销售岗位模板（更新）' })
  await listPositionAuthorizationTemplateAssignments('position / 1')
  await replacePositionAuthorizationTemplateAssignments('position / 1', [{ template_id: 'template-1', status: 'ACTIVE' }])
  await previewPositionAuthorization({ position_id: 'position / 1', inherit_authorization: true })
  await disablePositionAuthorizationTemplate('template / 1', 4)

  assert.equal(requests[0].url, '/api/v1/position-authorization-targets')
  assert.equal(requests[0].options.method, undefined)
  assert.equal(requests[1].url, '/api/v1/position-authorization-positions')
  assert.equal(requests[1].options.method, undefined)
  assert.equal(requests[2].url, '/api/v1/position-authorization-templates')
  assert.equal(requests[2].options.method, 'POST')
  assert.deepEqual(JSON.parse(requests[2].options.body), {
    name: '销售岗位模板',
    roles: [{ application_id: 'app-1', role_id: 'role-1', scope_type: 'TENANT', scope_id: '' }],
  })
  assert.equal(requests[3].url, '/api/v1/position-authorization-templates/template%20%2F%201')
  assert.equal(requests[3].options.method, 'PATCH')
  assert.deepEqual(JSON.parse(requests[3].options.body), { name: '销售岗位模板（更新）' })
  assert.equal(requests[4].url, '/api/v1/positions/position%20%2F%201/authorization-templates')
  assert.equal(requests[5].options.method, 'PUT')
  assert.deepEqual(JSON.parse(requests[5].options.body), { assignments: [{ template_id: 'template-1', status: 'ACTIVE' }] })
  assert.equal(requests[6].url, '/api/v1/position-authorization-preview')
  assert.deepEqual(JSON.parse(requests[6].options.body), { position_id: 'position / 1', inherit_authorization: true })
  assert.equal(requests[7].url, '/api/v1/position-authorization-templates/template%20%2F%201?version=4')
  assert.equal(requests[7].options.method, 'DELETE')
})
