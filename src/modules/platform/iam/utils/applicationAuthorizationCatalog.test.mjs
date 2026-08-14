import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assignableActiveCatalogRoles,
  catalogLastSyncedAt,
  catalogMaxEffectiveRoles,
  catalogSyncText,
  catalogVersion,
  isAssignableActiveCatalogRole,
  isCatalogSynchronized,
} from './applicationAuthorizationCatalog.js'

test('application catalog only exposes ACTIVE and assignable roles', () => {
  const roles = [
    { code: 'sales', status: 'ACTIVE', assignable: true },
    { code: 'auditor', status: 'ACTIVE' },
    { code: 'disabled', status: 'DISABLED', assignable: true },
    { code: 'restricted', status: 'ACTIVE', assignable: false },
  ]

  assert.equal(isAssignableActiveCatalogRole(roles[0]), true)
  assert.equal(isAssignableActiveCatalogRole(roles[1]), true)
  assert.equal(isAssignableActiveCatalogRole(roles[2]), false)
  assert.equal(isAssignableActiveCatalogRole(roles[3]), false)
  assert.deepEqual(assignableActiveCatalogRoles({ roles }).map((role) => role.code), ['sales', 'auditor'])
})

test('catalog max effective roles reads the declared policy and defaults to unlimited', () => {
  assert.equal(catalogMaxEffectiveRoles({ policy: { max_effective_roles: 3 } }), 3)
  assert.equal(catalogMaxEffectiveRoles({ policy: { max_effective_roles: 0 } }), 0)
  assert.equal(catalogMaxEffectiveRoles({ policy: { max_effective_roles: -1 } }), 0)
  assert.equal(catalogMaxEffectiveRoles({ policy: {} }), 0)
  assert.equal(catalogMaxEffectiveRoles({ max_effective_roles: 8 }), 8)
  assert.equal(catalogMaxEffectiveRoles(null), 0)
})

test('application catalog metadata presents version and synchronization state', () => {
  assert.equal(catalogVersion({ catalog_version: '2026.07.29.1' }), '2026.07.29.1')
  assert.equal(catalogSyncText({ sync_status: 'SYNCED' }), '已同步')
  assert.equal(catalogSyncText({ sync_status: 'NOT_SYNCED' }), '未同步')
  assert.equal(catalogSyncText({ sync_status: 'FAILED' }), '同步失败')
  assert.equal(isCatalogSynchronized({ sync_status: 'SYNCED' }), true)
  assert.equal(isCatalogSynchronized({ sync_status: 'STALE' }), false)
  assert.equal(catalogLastSyncedAt({ metadata: { synced_at: '2026-07-29T06:00:00Z' } }), '2026-07-29T06:00:00Z')
})
