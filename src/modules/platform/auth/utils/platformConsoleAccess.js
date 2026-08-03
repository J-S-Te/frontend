import { checkAnyPermission } from './permissions.js'
import { DICTIONARY_ENTRY_PERMISSIONS } from '../../dictionaries/utils/dictionaryPermissions.js'
import { IAM_ENTRY_PERMISSIONS } from '../../iam/utils/iamPermissions.js'

export const PLATFORM_AUDIT_VIEW_PERMISSION = 'platform:audit:view'
export const PLATFORM_AUDIT_EXPORT_PERMISSION = 'platform:audit:export'

// 设置页按业务分区独立判定入口权限。用户拥有任一相关权限即可看到该分区，分区内部
// 再按具体 read/create/update 权限控制内容与按钮，避免 platform:user:read 成为无关总门槛。
export const PLATFORM_SETTINGS_SECTION_PERMISSIONS = Object.freeze({
  base: Object.freeze([
    'platform:settings:read',
    'platform:settings:update',
  ]),
  access: Object.freeze([
    'platform:settings:read',
    'platform:settings:update',
  ]),
  iam: IAM_ENTRY_PERMISSIONS,
  notify: Object.freeze([
    'platform:notification-setting:read',
    'platform:notification-setting:update',
    'platform:notification:template:read',
    'platform:notification:template:create',
    'platform:notification:template:update',
    'platform:notification:operate',
  ]),
  security: Object.freeze([
    'platform:security-policy:read',
    'platform:security-policy:update',
    'platform:locked-account:read',
    'platform:locked-account:unlock',
  ]),
  dict: DICTIONARY_ENTRY_PERMISSIONS,
  applications: Object.freeze([
    'platform:application:read',
    'platform:application:create',
    'platform:application:update',
    'platform:application-environment:read',
    'platform:application-environment:create',
    'platform:application-environment:update',
    'platform:application-environment:delete',
    'platform:application-login-target:read',
    'platform:application-login-target:create',
    'platform:application-login-target:update',
    'platform:oauth-client:create',
    'platform:oauth-client:disable',
  ]),
})

export const PLATFORM_SETTINGS_SECTION_KEYS = Object.freeze(Object.keys(PLATFORM_SETTINGS_SECTION_PERMISSIONS))
export const PLATFORM_SETTINGS_ENTRY_PERMISSIONS = Object.freeze([
  ...new Set(Object.values(PLATFORM_SETTINGS_SECTION_PERMISSIONS).flat()),
])
export const PLATFORM_CONSOLE_ENTRY_PERMISSIONS = Object.freeze([
  ...PLATFORM_SETTINGS_ENTRY_PERMISSIONS,
  PLATFORM_AUDIT_VIEW_PERMISSION,
])

export function visiblePlatformSettingsSections(principal) {
  return PLATFORM_SETTINGS_SECTION_KEYS.filter((section) => (
    checkAnyPermission(principal, PLATFORM_SETTINGS_SECTION_PERMISSIONS[section])
  ))
}

export function firstVisiblePlatformSettingsSection(principal) {
  return visiblePlatformSettingsSections(principal)[0] || ''
}

export function canAccessPlatformConsole(principal) {
  return checkAnyPermission(principal, PLATFORM_CONSOLE_ENTRY_PERMISSIONS)
}

export function platformConsoleLandingRoute(principal) {
  // 默认落到第一个真正可见的设置分区；只有审计权限时直接进入审计页，无权限则交给路由守卫拒绝。
  const section = firstVisiblePlatformSettingsSection(principal)
  if (section) return { name: 'settings', params: { section } }
  if (checkAnyPermission(principal, [PLATFORM_AUDIT_VIEW_PERMISSION])) return { name: 'audit' }
  return null
}
