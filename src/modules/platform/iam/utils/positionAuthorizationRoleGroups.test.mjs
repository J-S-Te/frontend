import test from 'node:test'
import assert from 'node:assert/strict'
import { expandPositionAuthorizationRoleGroups, expandPositionAuthorizationRoleMappings } from './positionAuthorizationRoleGroups.js'

test('expands one primary platform role mapping without creating authorization groups', () => {
  assert.deepEqual(expandPositionAuthorizationRoleMappings({
    platform_application_id: 'platform-app',
    platform_role_id: 'platform-sales',
    subsystem_roles: [{ application_id: 'contract-app', role_id: 'contract-sales' }],
  }), [
    { application_id: 'platform-app', role_id: 'platform-sales', scope_type: 'TENANT', scope_id: '' },
    { application_id: 'contract-app', role_id: 'contract-sales', scope_type: 'TENANT', scope_id: '' },
  ])
})

test('expands one platform role into multiple subsystem role bindings', () => {
  assert.deepEqual(expandPositionAuthorizationRoleGroups([
    {
      platform_application_id: 'platform-app',
      platform_role_id: 'platform-sales',
      subsystem_roles: [
        { application_id: 'contract-app', role_id: 'contract-sales' },
        { application_id: 'customer-app', role_id: 'customer-sales', scope_type: 'ENVIRONMENT', scope_id: 'prod' },
      ],
    },
  ]), [
    { application_id: 'platform-app', role_id: 'platform-sales', scope_type: 'TENANT', scope_id: '' },
    { application_id: 'contract-app', role_id: 'contract-sales', scope_type: 'TENANT', scope_id: '' },
    { application_id: 'customer-app', role_id: 'customer-sales', scope_type: 'ENVIRONMENT', scope_id: 'prod' },
  ])
})

test('ignores incomplete platform and subsystem selections', () => {
  assert.deepEqual(expandPositionAuthorizationRoleGroups([
    { platform_application_id: 'platform-app', subsystem_roles: [{ application_id: 'contract-app' }] },
    { platform_role_id: 'platform-admin', subsystem_roles: [{ role_id: 'customer-admin' }] },
  ]), [])
})
