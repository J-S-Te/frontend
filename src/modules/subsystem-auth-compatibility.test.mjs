import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const files = await Promise.all([
  './contract_management/api/contract.js',
  './project_management/api/projectManagement.js',
  './customer_opportunity/api/client.js',
  './customer_portal/api/portal.js',
].map((path) => readFile(new URL(path, import.meta.url), 'utf8')))
const router = await readFile(new URL('../router/index.js', import.meta.url), 'utf8')
const errorView = await readFile(new URL('./platform/auth/views/SubsystemAccessErrorView.vue', import.meta.url), 'utf8')
const compatibility = await readFile(new URL('./shared/authz/sessionCompatibility.js', import.meta.url), 'utf8')

test('subsystem auth clients consume normalized server sessions without depending on rich token hashes', () => {
  for (const source of files) {
    assert.match(source, /normalizeAuthorizationSession/)
    assert.doesNotMatch(source, /role_config_hash|authz_revision/)
  }
})

test('router preserves server-side access failure categories instead of swallowing them', () => {
  assert.match(router, /name: 'subsystem_access_error'/)
  assert.match(router, /buildSubsystemAccessErrorRoute/)
  assert.match(router, /subsystemAccessFailure\(error, to\)/)
  assert.match(compatibility, /客户门户身份尚未预配/)
  assert.match(errorView, /重新发起 Keycloak 登录/)
  assert.match(errorView, /request_id/)
})

test('the compatibility layer carries data scopes but views never interpret scope types', () => {
  for (const source of files) assert.doesNotMatch(source, /scope_type\s*===|switch\s*\([^)]*scope_type/)
})
