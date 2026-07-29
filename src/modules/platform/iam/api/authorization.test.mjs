import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRole, updateRole } from './authorization.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
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

test('generic application access APIs use application-scoped endpoints', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return {
      ok: true,
      status: options?.method === 'DELETE' ? 204 : 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: { application_code: 'contract_management', roles: [{ code: 'sales' }], effective_permissions: ['contract.read'] } }),
      text: async () => '',
    }
  }

  const {
    deleteApplicationAccess,
    getApplicationAccess,
    getApplicationAuthorizationCatalog,
    updateApplicationAccess,
  } = await import('./authorization.js')

  await getApplicationAuthorizationCatalog('application / 1')
  await getApplicationAccess('user / 1', 'contract_management')
  await updateApplicationAccess('user / 1', 'contract_management', {
    roles: [
      { role_code: 'sales', scope_type: 'APPLICATION', environment_code: null, valid_from: null, valid_until: null },
      { role_code: 'audit_admin', scope_type: 'APPLICATION', environment_code: null, valid_from: null, valid_until: null },
    ],
  })
  await deleteApplicationAccess('user / 1', 'contract_management')

  assert.equal(requests[0].url, '/api/v1/applications/application%20%2F%201/authorization-catalog')
  assert.equal(requests[1].url, '/api/v1/users/user%20%2F%201/applications/contract_management/access')
  assert.equal(requests[1].options.method, undefined)
  assert.equal(requests[2].options.method, 'PUT')
  assert.deepEqual(JSON.parse(requests[2].options.body), {
    roles: [
      { role_code: 'sales', scope_type: 'APPLICATION', environment_code: null, valid_from: null, valid_until: null },
      { role_code: 'audit_admin', scope_type: 'APPLICATION', environment_code: null, valid_from: null, valid_until: null },
    ],
  })
  assert.equal(requests[3].options.method, 'DELETE')
})
