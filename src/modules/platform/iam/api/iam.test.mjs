import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  IamError,
  bindUserExternalIdentity,
  createLocalAccount,
  createOrgUnit,
  createPosition,
  createMembership,
  createUser,
  listUserExternalIdentities,
  listUsers,
  unbindUserExternalIdentity,
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
  })

  assert.equal(requested.url, '/api/v1/accounts')
  assert.deepEqual(JSON.parse(requested.options.body), {
    user_id: 'user-1',
    account_name: 'zhangsan',
    initial_password: 'Temporary-Password-1',
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
  })
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    user_id: 'user-1',
    org_unit_id: 'org-1',
    position_id: 'position-1',
    membership_type: 'SECONDARY',
    effective_from: '2026-08-01',
    effective_to: '2026-08-31',
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


test('external identity APIs use the documented user-scoped routes and optimistic version on unbind', async () => {
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (options.method === 'DELETE') return jsonResponse({ data: { binding_id: 'binding-1' } })
    if (options.method === 'POST') return jsonResponse({ data: { binding_id: 'binding-1' } })
    return jsonResponse({ data: [{ binding_id: 'binding-1', provider_id: 'provider-1', status: 'ACTIVE', version: 3 }] })
  }

  const bindings = await listUserExternalIdentities('user / 1')
  await bindUserExternalIdentity({ userId: 'user / 1', providerCode: 'oidc', externalSubject: 'subject-1' })
  await unbindUserExternalIdentity({ userId: 'user / 1', bindingId: 'binding / 1', version: 3 })

  assert.deepEqual(bindings, [{ binding_id: 'binding-1', provider_id: 'provider-1', status: 'ACTIVE', version: 3 }])
  assert.equal(requests[0].url, '/api/v1/users/user%20%2F%201/external-identities')
  assert.deepEqual(JSON.parse(requests[1].options.body), { provider_code: 'oidc', external_subject: 'subject-1' })
  assert.equal(requests[2].url, '/api/v1/users/user%20%2F%201/external-identities/binding%20%2F%201')
  assert.equal(requests[2].options.method, 'DELETE')
  assert.deepEqual(JSON.parse(requests[2].options.body), { version: 3 })
})
