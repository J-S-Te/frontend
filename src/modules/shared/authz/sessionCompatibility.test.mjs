import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSubsystemAccessErrorRoute,
  classifySubsystemAccessError,
  normalizeAuthorizationSession,
  principalIdentityID,
  shouldStartSubsystemLogin,
  subsystemAccessMessage,
  SUBSYSTEM_ACCESS_REASON,
} from './sessionCompatibility.js'

test('new authorization session fields are carried without interpreting data scopes', () => {
  const scopes = [{ role_code: 'sales', scope_type: 'ORG', scope_id: 'org-1', environment_code: 'prod' }]
  const session = normalizeAuthorizationSession({
    sub: 'identity-1', identity_id: 'identity-1', person_id: 'person-1', data_scopes: scopes,
    authorization_revision: 18, catalog_version: '2026.08.12', permissions: ['contract.read'],
  })
  assert.equal(session.identity_id, 'identity-1')
  assert.equal(session.person_id, 'person-1')
  assert.equal(session.authorization_revision, 18)
  assert.equal(session.catalog_version, '2026.08.12')
  assert.equal(session.data_scopes, scopes)
  assert.deepEqual(session.permissions, ['contract.read'])
})

test('rolling compatibility keeps legacy fields but never treats role hash as catalog version', () => {
  const session = normalizeAuthorizationSession({ user_id: 'legacy-user', authz_revision: 7, role_config_hash: 'legacy-hash' })
  assert.equal(session.identity_id, 'legacy-user')
  assert.equal(session.authorization_revision, 7)
  assert.equal(session.catalog_version, '')
  assert.equal(session.role_config_hash, 'legacy-hash')
  assert.equal(principalIdentityID({ user: { id: 'platform-user' } }), 'platform-user')
})

test('access failures remain distinct and only plain 401 starts login', () => {
  assert.equal(classifySubsystemAccessError({ status: 401, code: 'COMMON_UNAUTHENTICATED' }).reason, SUBSYSTEM_ACCESS_REASON.UNAUTHENTICATED)
  assert.equal(classifySubsystemAccessError({ status: 403 }).reason, SUBSYSTEM_ACCESS_REASON.FORBIDDEN)
  assert.equal(classifySubsystemAccessError({ status: 503 }).reason, SUBSYSTEM_ACCESS_REASON.DEPENDENCY_UNAVAILABLE)
  assert.equal(classifySubsystemAccessError({ status: 403, code: 'PORTAL_IDENTITY_NOT_PROVISIONED' }).reason, SUBSYSTEM_ACCESS_REASON.IDENTITY_NOT_PROVISIONED)
  assert.equal(classifySubsystemAccessError({ status: 401, message: 'OIDC authorization claims are invalid' }).reason, SUBSYSTEM_ACCESS_REASON.OIDC_CLAIMS_INVALID)
  assert.equal(classifySubsystemAccessError({ status: 401, code: 'CRM_OIDC_INVALID_CLAIMS' }).reason, SUBSYSTEM_ACCESS_REASON.OIDC_CLAIMS_INVALID)
  assert.equal(shouldStartSubsystemLogin({ status: 401, code: 'COMMON_UNAUTHENTICATED' }), true)
  assert.equal(shouldStartSubsystemLogin({ status: 401, code: 'PORTAL_OIDC_INVALID_CLAIMS' }), false)
  assert.match(subsystemAccessMessage({ status: 403 }), /身份认证已经完成/)
  assert.match(subsystemAccessMessage({ status: 503 }), /统一授权上下文/)
  assert.match(subsystemAccessMessage({ status: 403, code: 'PORTAL_IDENTITY_NOT_PROVISIONED' }), /客户门户身份/)
})

test('route query exposes stable diagnostics, not backend messages or scope decisions', () => {
  const route = buildSubsystemAccessErrorRoute({ status: 403, code: 'PORTAL_IDENTITY_NOT_PROVISIONED', requestID: 'req-1', message: 'internal detail' }, '/customer-portal')
  assert.deepEqual(route, {
    name: 'subsystem_access_error',
    query: { reason: 'IDENTITY_NOT_PROVISIONED', from: '/customer-portal', code: 'PORTAL_IDENTITY_NOT_PROVISIONED', request_id: 'req-1' },
    replace: true,
  })
  assert.equal(buildSubsystemAccessErrorRoute({ status: 401, code: 'COMMON_UNAUTHENTICATED' }, '/contract_management'), null)
})
