export function uniqueValues(values) {
  return [...new Set(values.filter((value) => String(value || '').trim()).map((value) => String(value).trim()))].sort()
}

export function roleCode(role) {
  return typeof role === 'string' ? role : role?.code || role?.role_code || ''
}

export function permissionCode(permission) {
  if (typeof permission === 'string') return permission
  return permission?.code || permission?.permission_code || ''
}

// 授权有效期的回填/提交必须成对且同一口径：一律按北京墙钟解释，
// 否则 UTC 浏览器下每保存一次就会把有效期平移 8 小时（与售前 expected_start 同一类缺陷）。
export function toDateTimeLocal(value) {
  if (!value) return ''
  return instantToBusinessWallClock(value)
}

export function toRFC3339(value) {
  const text = String(value || '').trim()
  if (!text) return null
  // 已带 Z/偏移的值本身是绝对时刻，直接解析；否则按北京墙钟换算，避免二次平移。
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const parsed = new Date(text)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return businessWallClockToInstant(text) || null
}

export function normalizeScopeType(value) {
  return String(value || '').toUpperCase() === 'ENVIRONMENT' ? 'ENVIRONMENT' : 'APPLICATION'
}

import { businessWallClockToInstant, instantToBusinessWallClock } from '../../../shared/utils/businessTime.js'
import { catalogRolePermissions } from './applicationAuthorizationCatalog.js'
import { formatDateTime } from './iamPresentation.js'

export function authorizationSourceTypeName(role) {
  const type = String(role?.source_type || '').toUpperCase()
  if (type === 'ORG_UNIT') return '组织单元'
  if (type === 'POSITION') return '岗位'
  if (type === 'USER') return '用户直接授权'
  return type || '未知来源'
}

export function authorizationSourceName(role) {
  return role?.source_name || role?.source_id || '—'
}

export function authorizationScopeText(role) {
  if (normalizeScopeType(role?.scope_type) === 'ENVIRONMENT') {
    return `指定环境：${role?.environment_code || '未指定'}`
  }
  return '整个应用'
}

export function authorizationValidityText(role) {
  if (!role?.valid_from && !role?.valid_until) return '长期有效'
  const start = role?.valid_from ? formatDateTime(role.valid_from) : '立即生效'
  const end = role?.valid_until ? formatDateTime(role.valid_until) : '长期有效'
  return `${start} 至 ${end}`
}

export function rolePermissionsFor(role) {
  return catalogRolePermissions(role)
}

export function rolePermissionCodes(role) {
  return uniqueValues(rolePermissionsFor(role).map((permission) => permissionCode(permission)))
}

export function applicationDisplayName(application) {
  return application?.name || application?.display_name || application?.code || '未命名应用'
}

export function roleAuthorizationSignature(role) {
  return [
    normalizeScopeType(role?.scope_type),
    String(role?.environment_code || ''),
    String(role?.valid_from || ''),
    String(role?.valid_until || ''),
  ].join('|')
}
