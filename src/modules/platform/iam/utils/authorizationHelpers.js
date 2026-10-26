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

export function toDateTimeLocal(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function toRFC3339(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function normalizeScopeType(value) {
  return String(value || '').toUpperCase() === 'ENVIRONMENT' ? 'ENVIRONMENT' : 'APPLICATION'
}

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
