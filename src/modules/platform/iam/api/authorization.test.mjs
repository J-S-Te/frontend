import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRole, getAuthorizationOverview, updateRole } from './authorization.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('authorization overview normalizes account, change, handover and Keycloak state', async () => {
  let requested
  globalThis.fetch = async (url) => {
    requested = url
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: {
        user: { id: 'u-1' }, accounts: [{ status: 'ACTIVE' }], memberships: [{ status: 'ACTIVE' }],
        role_bindings: [{ role_id: 'r-1' }], pending_changes: [{ status: 'SCHEDULED' }],
        handover: [{ status: 'PENDING', system_code: 'customer_and_opportunity' }],
        keycloak_sync: [{ status: 'PENDING' }],
      } }),
      text: async () => '',
    }
  }
  const result = await getAuthorizationOverview('u / 1')
  assert.equal(requested, '/api/v1/people/u%20%2F%201/authorization-overview')
  assert.equal(result.accounts.length, 1)
  assert.equal(result.memberships.length, 1)
  assert.equal(result.role_bindings.length, 1)
  assert.equal(result.pending_changes[0].status, 'SCHEDULED')
  assert.equal(result.handover[0].system_code, 'customer_and_opportunity')
  assert.equal(result.keycloak_sync[0].status, 'PENDING')
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

test('normalizeApplicationAccess separates direct and inherited user roles without losing effective roles', async () => {
  const { normalizeApplicationAccess } = await import('./authorization.js')
  const access = normalizeApplicationAccess({
    application_code: 'contract_management',
    roles: [
      { code: 'sales', source_type: 'USER', source_id: 'user-1', direct: true },
      { code: 'sales_director', source_type: 'ORG_UNIT', source_id: 'org-1', source_name: '销售中心', direct: false },
      { code: 'audit_admin', source_type: 'POSITION', source_id: 'position-1', source_name: '审计岗', direct: false },
    ],
  })

  assert.deepEqual(access.direct_roles.map((role) => role.code), ['sales'])
  assert.deepEqual(access.inherited_roles.map((role) => role.code), ['sales_director', 'audit_admin'])
  assert.equal(access.roles.length, 3)
})

test('normalizeApplicationAccess trusts explicit role groups and reconstructs effective roles when roles is absent', async () => {
  const { normalizeApplicationAccess } = await import('./authorization.js')
  const access = normalizeApplicationAccess({
    direct_roles: [{ code: 'sales', source_type: 'USER', direct: true }],
    inherited_roles: [{ code: 'tech_director', source_type: 'POSITION', source_name: '技术总监', direct: false }],
  })

  assert.deepEqual(access.roles.map((role) => role.code), ['sales', 'tech_director'])
  assert.deepEqual(access.direct_roles.map((role) => role.code), ['sales'])
  assert.deepEqual(access.inherited_roles.map((role) => role.code), ['tech_director'])
})

test('normalizeApplicationAccess preserves explicit manual roles and role source metadata for legacy binding cleanup', async () => {
  const { normalizeApplicationAccess } = await import('./authorization.js')
  const manualRole = {
    code: 'sales',
    source_type: 'POSITION',
    grant_origin: 'MANUAL',
    source_kind: 'DIRECT',
    direct: true,
  }
  const templateRole = {
    code: 'sales_director',
    source_type: 'POSITION',
    grant_origin: 'TEMPLATE',
    source_kind: 'POSITION_TEMPLATE',
    direct: true,
  }

  const access = normalizeApplicationAccess({
    roles: [manualRole, templateRole],
    direct_roles: [manualRole, templateRole],
    inherited_roles: [],
    manual_roles: [manualRole],
  }, 'POSITION')

  assert.deepEqual(access.direct_roles.map((role) => role.code), ['sales', 'sales_director'])
  assert.deepEqual(access.manual_roles.map((role) => role.code), ['sales'])
  assert.equal(access.manual_roles[0].grant_origin, 'MANUAL')
  assert.equal(access.manual_roles[0].source_kind, 'DIRECT')
  assert.equal(access.direct_roles[1].grant_origin, 'TEMPLATE')
  assert.equal(access.direct_roles[1].source_kind, 'POSITION_TEMPLATE')
})

test('normalizeApplicationAccess derives manual roles without treating template or system roles as editable', async () => {
  const { normalizeApplicationAccess } = await import('./authorization.js')
  const access = normalizeApplicationAccess({
    direct_roles: [
      { code: 'sales', grant_origin: 'MANUAL', source_kind: 'MANUAL' },
      { code: 'sales_director', grant_origin: 'TEMPLATE', source_kind: 'INHERITED' },
      { code: 'platform-user', grant_origin: 'SYSTEM', source_kind: 'SYSTEM' },
    ],
    inherited_roles: [],
  })

  assert.deepEqual(access.manual_roles.map((role) => role.code), ['sales'])
})

test('normalizeApplicationAccess keeps source-less legacy roles editable as direct user roles', async () => {
  const { normalizeApplicationAccess } = await import('./authorization.js')
  const access = normalizeApplicationAccess({ roles: [{ code: 'sales' }, { code: 'audit_admin' }] })

  assert.deepEqual(access.direct_roles.map((role) => role.code), ['sales', 'audit_admin'])
  assert.deepEqual(access.inherited_roles, [])
})

test('subject application access APIs use the generic subject endpoint and only submit the supplied direct roles', async () => {
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return {
      ok: true,
      status: options.method === 'DELETE' ? 204 : 200,
      headers: { get: () => options.method === 'DELETE' ? '' : 'application/json' },
      json: async () => ({
        data: {
          roles: [{ code: 'sales_director', source_type: 'ORG_UNIT', source_id: 'org / 1', direct: true }],
        },
      }),
      text: async () => '',
    }
  }

  const {
    deleteSubjectApplicationAccess,
    getSubjectApplicationAccess,
    updateSubjectApplicationAccess,
  } = await import('./authorization.js')

  const access = await getSubjectApplicationAccess('ORG_UNIT', 'org / 1', 'contract management')
  await updateSubjectApplicationAccess('POSITION', 'position / 1', 'contract management', {
    roles: [{ role_code: 'sales', scope_type: 'APPLICATION', environment_code: null, valid_from: null, valid_until: null }],
  })
  await deleteSubjectApplicationAccess('POSITION', 'position / 1', 'contract management')

  assert.equal(requests[0].url, '/api/v1/authorization-subjects/ORG_UNIT/org%20%2F%201/applications/contract%20management/access')
  assert.deepEqual(access.direct_roles.map((role) => role.code), ['sales_director'])
  assert.deepEqual(access.inherited_roles, [])
  assert.equal(requests[1].url, '/api/v1/authorization-subjects/POSITION/position%20%2F%201/applications/contract%20management/access')
  assert.equal(requests[1].options.method, 'PUT')
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    roles: [{ role_code: 'sales', scope_type: 'APPLICATION', environment_code: null, valid_from: null, valid_until: null }],
  })
  assert.equal(requests[2].options.method, 'DELETE')
})

test('generic application access never serializes custom business permissions', async () => {
  let requestBody
  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(options.body)
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: { roles: [] } }),
      text: async () => '',
    }
  }

  const { updateApplicationAccess } = await import('./authorization.js')
  await updateApplicationAccess('user-1', 'contract_management', {
    roles: [{ role_code: 'sales', scope_type: 'APPLICATION' }],
    custom_permissions: ['contract.delete'],
    additional_permissions: ['all'],
  })

  assert.deepEqual(requestBody, {
    roles: [{ role_code: 'sales', scope_type: 'APPLICATION' }],
  })
})
