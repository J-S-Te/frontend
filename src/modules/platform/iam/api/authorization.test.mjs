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
