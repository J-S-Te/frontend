import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canAccessPlatformConsole,
  firstVisiblePlatformSettingsSection,
  platformConsoleLandingRoute,
  visiblePlatformSettingsSections,
} from './platformConsoleAccess.js'

function principal(...permissionCodes) {
  return { permission_codes: permissionCodes }
}

test('平台设置页签只由各自后端权限决定', () => {
  assert.deepEqual(visiblePlatformSettingsSections(principal('platform:user:read')), ['iam'])
  assert.deepEqual(visiblePlatformSettingsSections(principal('platform:settings:read')), ['base', 'access'])
  assert.deepEqual(visiblePlatformSettingsSections(principal('platform:security-policy:read')), ['security'])
  assert.deepEqual(visiblePlatformSettingsSections(principal('platform:dictionary-item:update')), ['dict'])
})

test('审计权限可以进入平台控制台但不会放大为系统设置权限', () => {
  const auditPrincipal = principal('platform:audit:view')
  assert.equal(canAccessPlatformConsole(auditPrincipal), true)
  assert.deepEqual(visiblePlatformSettingsSections(auditPrincipal), [])
  assert.equal(firstVisiblePlatformSettingsSection(auditPrincipal), '')
  assert.deepEqual(platformConsoleLandingRoute(auditPrincipal), { name: 'audit' })
})

test('普通业务账号没有平台管理入口', () => {
  const businessPrincipal = principal('contract.read')
  assert.equal(canAccessPlatformConsole(businessPrincipal), false)
  assert.deepEqual(visiblePlatformSettingsSections(businessPrincipal), [])
  assert.equal(platformConsoleLandingRoute(businessPrincipal), null)
})

test('通配权限可访问所有设置页签', () => {
  assert.deepEqual(visiblePlatformSettingsSections(principal('*')), ['base', 'access', 'iam', 'notify', 'security', 'dict', 'applications'])
  assert.deepEqual(platformConsoleLandingRoute(principal('*')), { name: 'settings', params: { section: 'base' } })
})
