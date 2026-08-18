import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  IamError,
  createLocalAccount,
  createEmployee,
  onboardEmployee,
  createOrgUnit,
  deleteOrgUnit,
  updateOrgUnit,
  createPosition,
  deletePosition,
  createMembership,
  createUser,
  createUsersBatch,
  createEmployeesBatch,
  listUsers,
} from './iam.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => '',
  }
}

test('createUser persists through the IAM API instead of mutating local-only rows', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { user_id: 'user-1' } })
  }

  const result = await createUser({
    displayName: '张三',
    email: 'zhangsan@example.com',
    mobile: '13800000000',
  })

  assert.deepEqual(result, { user_id: 'user-1' })
  assert.equal(requested.url, '/api/v1/users')
  assert.equal(requested.options.method, 'POST')
  assert.equal(requested.options.credentials, 'include')
  assert.equal(requested.options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(requested.options.body), {
    display_name: '张三',
    email: 'zhangsan@example.com',
    mobile: '13800000000',
    status: 'ACTIVE',
  })
})

test('createUsersBatch submits human-readable Chinese application and role names from CSV', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { items: [{ user_id: 'user-1' }], total: 1 } }, { status: 201 })
  }

  await createUsersBatch([{
    displayName: '张三', email: null, mobile: null, status: 'ACTIVE',
    applicationRoles: [{ applicationName: '合同管理系统', roleName: '销售人员' }],
  }])

  assert.equal(requested.url, '/api/v1/users/batch')
  assert.deepEqual(JSON.parse(requested.options.body).items[0].application_roles, [
    { application_name: '合同管理系统', role_name: '销售人员' },
  ])
})

test('createEmployee sends the atomic employee contract to POST /employees', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { user: { user_id: 'user-1' }, account: { account_id: 'account-1' }, membership: { membership_id: 'membership-1' } } })
  }

  const payload = {
    user: { display_name: '张三', email: null, mobile: null, status: 'ACTIVE' },
    account: { account_name: 'zhangsan', initial_password: 'Temporary-Password-1', valid_until: null },
    membership: { org_unit_id: 'org-1', position_id: 'position-1', membership_type: 'PRIMARY', effective_from: null, effective_to: null, inherit_authorization: true },
  }
  await createEmployee(payload)

  assert.equal(requested.url, '/api/v1/employees')
  assert.equal(requested.options.method, 'POST')
  assert.deepEqual(JSON.parse(requested.options.body), payload)
})

test('createEmployeesBatch sends Chinese organization and position names to the atomic batch endpoint', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { items: [], total: 0 } }, { status: 201 })
  }

  await createEmployeesBatch([{
    displayName: '李四', email: 'li.si@example.com', mobile: '13900000000', status: 'ACTIVE',
    organizationName: '华东事业部', positionName: '合同专员',
    applicationRoles: [{ applicationName: '合同管理系统', roleName: '审计管理员' }],
  }])

  assert.equal(requested.url, '/api/v1/employees/batch')
  assert.deepEqual(JSON.parse(requested.options.body).items[0], {
    display_name: '李四', email: 'li.si@example.com', mobile: '13900000000', status: 'ACTIVE',
    organization: '华东事业部', position: '合同专员',
    application_roles: [{ application_name: '合同管理系统', role_name: '审计管理员' }],
  })
})

test('onboardEmployee uses the legacy sequence only when POST /employees is unavailable', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    if (url === '/api/v1/employees') {
      return jsonResponse({ message: 'not found' }, { ok: false, status: 404 })
    }
    if (url === '/api/v1/users') return jsonResponse({ data: { user_id: 'user-1', display_name: '张三' } })
    if (url === '/api/v1/accounts') return jsonResponse({ data: { account_id: 'account-1' } })
    if (url === '/api/v1/memberships') return jsonResponse({ data: { membership_id: 'membership-1' } })
    throw new Error(`unexpected URL: ${url}`)
  }

  const result = await onboardEmployee({
    user: { display_name: '张三', email: null, mobile: null, status: 'ACTIVE' },
    account: { account_name: 'zhangsan', initial_password: 'Temporary-Password-1', valid_until: null },
    membership: { org_unit_id: 'org-1', position_id: 'position-1', membership_type: 'PRIMARY', effective_from: null, effective_to: null, inherit_authorization: true },
  })

  assert.equal(result.onboarding_mode, 'COMPATIBILITY')
  assert.deepEqual(requests.map((item) => item.url), [
    '/api/v1/employees',
    '/api/v1/users',
    '/api/v1/accounts',
    '/api/v1/memberships',
  ])
  assert.equal(requests.filter((item) => item.url === '/api/v1/accounts').length, 1)
})

test('onboardEmployee does not fall back after a non-capability atomic error', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push(url)
    return jsonResponse({ message: 'account name already exists' }, { ok: false, status: 409 })
  }

  await assert.rejects(
    onboardEmployee({ user: { display_name: '张三', email: null, mobile: null, status: 'ACTIVE' } }),
    (error) => error instanceof IamError && error.status === 409,
  )
  assert.deepEqual(requests, ['/api/v1/employees'])
})

test('createLocalAccount calls the account endpoint with the backend field names', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { account_id: 'account-1' } })
  }

  await createLocalAccount({
    userId: 'user-1',
    accountName: 'zhangsan',
    initialPassword: 'Temporary-Password-1',
    validUntil: '2026-08-01T00:00:00.000Z',
  })

  assert.equal(requested.url, '/api/v1/accounts')
  assert.deepEqual(JSON.parse(requested.options.body), {
    user_id: 'user-1',
    account_name: 'zhangsan',
    initial_password: 'Temporary-Password-1',
    valid_until: '2026-08-01T00:00:00.000Z',
  })
})

test('createOrgUnit leaves organization code generation to the backend', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { org_unit_id: 'org-1', code: 'ORG-01KTEST', name: '研发中心' } })
  }

  const result = await createOrgUnit({
    parentId: 'parent-1',
    name: '研发中心',
    sortOrder: 100,
  })

  assert.equal(requested.url, '/api/v1/org-units')
  assert.deepEqual(JSON.parse(requested.options.body), {
    parent_id: 'parent-1',
    name: '研发中心',
    sort_order: 100,
  })
  assert.equal(result.code, 'ORG-01KTEST')
})

test('updateOrgUnit and deleteOrgUnit use versioned organization API contracts', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return jsonResponse({ data: { org_unit_id: 'org-1', name: '研发中心', version: 2 } })
  }

  await updateOrgUnit({
    orgUnitId: 'org-1',
    parentId: 'parent-2',
    name: '研发中心',
    sortOrder: 200,
    version: 1,
  })
  await deleteOrgUnit({ orgUnitId: 'org-1', version: 2 })

  assert.equal(requests[0].url, '/api/v1/org-units/org-1')
  assert.equal(requests[0].options.method, 'PATCH')
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    parent_id: 'parent-2',
    name: '研发中心',
    sort_order: 200,
    version: 1,
  })
  assert.equal(requests[1].url, '/api/v1/org-units/org-1')
  assert.equal(requests[1].options.method, 'DELETE')
  assert.deepEqual(JSON.parse(requests[1].options.body), { version: 2 })
})


test('createPosition leaves position code generation to the backend', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { position_id: 'position-1', code: 'POS-01KTEST', name: '研发经理' } })
  }

  const result = await createPosition({ orgUnitId: 'org-1', name: '研发经理' })

  assert.equal(requested.url, '/api/v1/positions')
  assert.deepEqual(JSON.parse(requested.options.body), {
    org_unit_id: 'org-1',
    name: '研发经理',
  })
  assert.equal(result.code, 'POS-01KTEST')
})

test('createMembership represents long-term and short-term validity with the documented date contract', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return jsonResponse({ data: { membership_id: `membership-${requests.length}` } })
  }

  await createMembership({
    userId: 'user-1',
    orgUnitId: 'org-1',
    positionId: 'position-1',
    membershipType: 'PRIMARY',
    effectiveFrom: null,
    effectiveTo: null,
  })
  await createMembership({
    userId: 'user-1',
    orgUnitId: 'org-1',
    positionId: 'position-1',
    membershipType: 'SECONDARY',
    effectiveFrom: '2026-08-01',
    effectiveTo: '2026-08-31',
  })

  assert.equal(requests[0].url, '/api/v1/memberships')
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    user_id: 'user-1',
    org_unit_id: 'org-1',
    position_id: 'position-1',
    membership_type: 'PRIMARY',
    effective_from: null,
    effective_to: null,
    inherit_authorization: true,
  })
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    user_id: 'user-1',
    org_unit_id: 'org-1',
    position_id: 'position-1',
    membership_type: 'SECONDARY',
    effective_from: '2026-08-01',
    effective_to: '2026-08-31',
    inherit_authorization: true,
  })
})

test('IAM API converts malformed JSON error bodies into a stable IamError', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    headers: { get: () => 'application/json' },
    json: async () => { throw new SyntaxError('Unexpected end of JSON input') },
    text: async () => '',
  })

  await assert.rejects(
    listUsers(),
    (error) => error instanceof IamError && error.status === 502 && error.message === 'IAM 请求失败。',
  )
})


test('deletePosition uses the versioned logical-delete API contract', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: {} })
  }

  await deletePosition({ positionId: 'position / 1', version: 4 })

  assert.equal(requested.url, '/api/v1/positions/position%20%2F%201')
  assert.equal(requested.options.method, 'DELETE')
  assert.deepEqual(JSON.parse(requested.options.body), { version: 4 })
})
