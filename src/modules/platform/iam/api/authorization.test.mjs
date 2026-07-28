import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRole, previewEffectiveAccess, previewRoleBindingImpact, updateRole } from './authorization.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('previewEffectiveAccess requests the backend-calculated access explanation for an account', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: { account_id: 'account-1', roles: [], permissions: [] } }),
      text: async () => '',
    }
  }

  await previewEffectiveAccess({ userId: 'user / 1', accountId: 'account / 1' })

  assert.equal(requested.url, '/api/v1/authorization/effective-access?user_id=user+%2F+1&account_id=account+%2F+1')
  assert.equal(requested.options.method, undefined)
  assert.equal(requested.options.credentials, 'include')
})

test('previewRoleBindingImpact sends only the proposed binding without persisting it', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: { total_affected_users: 2 } }),
      text: async () => '',
    }
  }

  await previewRoleBindingImpact({
    roleId: 'role-1',
    subjectType: 'ORG_UNIT',
    subjectId: 'org-1',
    scopeType: 'RESOURCE',
    scopeId: 'resource-1',
    expiresAt: '2026-08-01T00:00:00Z',
  })

  assert.equal(requested.url, '/api/v1/authorization/role-binding-impact')
  assert.equal(requested.options.method, 'POST')
  assert.deepEqual(JSON.parse(requested.options.body), {
    role_id: 'role-1',
    subject_type: 'ORG_UNIT',
    subject_id: 'org-1',
    scope_type: 'RESOURCE',
    scope_id: 'resource-1',
    expires_at: '2026-08-01T00:00:00Z',
  })
})

test('createRole leaves role code generation to the backend', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return {
      ok: true,
      status: 201,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: { role_id: 'role-1', code: 'ROLE-01KTEST', name: '报表查看者' } }),
      text: async () => '',
    }
  }

  const result = await createRole({
    name: '报表查看者',
    description: '查看报表',
    permissionIds: ['permission-1', 'permission-2'],
  })

  assert.equal(requested.url, '/api/v1/roles')
  assert.equal(requested.options.method, 'POST')
  assert.deepEqual(JSON.parse(requested.options.body), {
    name: '报表查看者',
    description: '查看报表',
    permission_ids: ['permission-1', 'permission-2'],
  })
  assert.equal(result.code, 'ROLE-01KTEST')
})

test('updateRole preserves the backend-managed role code while updating the role-permission aggregate', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: { role_id: 'role-1' } }),
      text: async () => '',
    }
  }

  await updateRole({
    roleId: 'role / 1',
    name: '报表查看者',
    description: '查看报表',
    permissionIds: ['permission-1', 'permission-2'],
    status: 'ACTIVE',
    version: 4,
  })

  assert.equal(requested.url, '/api/v1/roles/role%20%2F%201')
  assert.equal(requested.options.method, 'PATCH')
  assert.deepEqual(JSON.parse(requested.options.body), {
    name: '报表查看者',
    description: '查看报表',
    permission_ids: ['permission-1', 'permission-2'],
    status: 'ACTIVE',
    version: 4,
  })
})

test('contract application access uses the task-oriented user endpoint', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: { role: { code: 'sales', name: '销售人员' }, custom_permissions: [] } }),
      text: async () => '',
    }
  }

  const { getContractApplicationAccess, updateContractApplicationAccess } = await import('./authorization.js')
  await getContractApplicationAccess('user / 1')
  await updateContractApplicationAccess('user / 1', {
    roleCode: 'sales',
    customPermissions: ['contract_template.manage'],
  })

  assert.equal(requests[0].url, '/api/v1/users/user%20%2F%201/applications/contract_management/access')
  assert.equal(requests[0].options.method, undefined)
  assert.equal(requests[1].url, '/api/v1/users/user%20%2F%201/applications/contract_management/access')
  assert.equal(requests[1].options.method, 'PUT')
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    role_code: 'sales',
    custom_permissions: ['contract_template.manage'],
  })
})
