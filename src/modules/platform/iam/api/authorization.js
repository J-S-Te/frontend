import { createRequest } from '../../shared/api/request.js'

/**
 * AuthorizationError 表示授权管理接口返回的结构化错误。
 * @property {number} status HTTP 状态码；网络异常时为 0。
 * @property {string} code 服务端错误码。
 * @property {string} traceId 请求跟踪标识。
 */
export class AuthorizationError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'AuthorizationError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}



const request = createRequest({
  ErrorClass: AuthorizationError,
  networkMessage: '无法连接授权管理服务，请确认后端服务已启动。',
  failureMessage: '授权管理请求失败。',
  subsystem: 'platform',
  feature: 'iam_authorization',
})

/**
 * getApplicationAuthorizationCatalog 查询应用自主维护、由平台校验展示的权限目录。
 * @param {string} applicationId 应用标识。
 * @returns {Promise<Object>} 返回应用的角色与权限目录。
 * @throws {AuthorizationError} 应用不存在、目录未接入、无访问权限或服务不可用时抛出。
 */
export function getApplicationAuthorizationCatalog(applicationId) {
  return request(`/applications/${encodeURIComponent(applicationId)}/authorization-catalog`)
}

function roleSourceType(role) {
  return String(role?.source_type || role?.subject_type || '').trim().toUpperCase()
}

function roleHasSourceMetadata(role) {
  return Boolean(role && typeof role === 'object' && (
    Object.prototype.hasOwnProperty.call(role, 'direct')
    || Object.prototype.hasOwnProperty.call(role, 'source_type')
    || Object.prototype.hasOwnProperty.call(role, 'subject_type')
  ))
}

function isDirectApplicationRole(role, directSourceType = 'USER') {
  if (!role || typeof role !== 'object') return true
  if (role.direct === true) return true
  return roleSourceType(role) === String(directSourceType || 'USER').trim().toUpperCase()
}

function isManualApplicationRole(role) {
  if (!role || typeof role !== 'object') return true
  const grantOrigin = String(role.grant_origin || '').trim().toUpperCase()
  if (grantOrigin) return grantOrigin === 'MANUAL'
  const sourceKind = String(role.source_kind || '').trim().toUpperCase()
  if (sourceKind) return sourceKind === 'MANUAL' || sourceKind === 'DIRECT'
  // 兼容尚未返回授权来源字段的旧服务端：此时 direct_roles 本身就是唯一可用依据。
  return true
}

/**
 * normalizeApplicationAccess 统一新旧后端的应用授权响应。
 *
 * 新后端直接返回 direct_roles / inherited_roles；旧后端缺少这两个字段时，
 * 优先根据 direct/source_type 判断来源。若整份旧数据完全没有来源字段，
 * 则维持历史行为，将 roles 全部视为用户直接授权。
 *
 * @param {Object|null} value 服务端返回的应用授权数据。
 * @param {string} [directSourceType='USER'] 判定直接授权的主体类型。
 * @returns {Object|null} 返回补齐 roles、direct_roles、inherited_roles 和 manual_roles 的数据；输入无效时返回 null。
 */
export function normalizeApplicationAccess(value, directSourceType = 'USER') {
  if (!value || typeof value !== 'object') return null

  const fallbackRoles = value.role ? [value.role] : []
  let roles = Array.isArray(value.roles) ? value.roles : fallbackRoles
  const hasDirectRoles = Array.isArray(value.direct_roles)
  const hasInheritedRoles = Array.isArray(value.inherited_roles)
  const hasManualRoles = Array.isArray(value.manual_roles)
  const hasSourceMetadata = roles.some(roleHasSourceMetadata)

  const directRoles = hasDirectRoles
    ? value.direct_roles
    : (hasSourceMetadata ? roles.filter((role) => isDirectApplicationRole(role, directSourceType)) : roles)
  const inheritedRoles = hasInheritedRoles
    ? value.inherited_roles
    : (hasSourceMetadata ? roles.filter((role) => !isDirectApplicationRole(role, directSourceType)) : [])
  const manualRoles = hasManualRoles
    ? value.manual_roles
    : directRoles.filter(isManualApplicationRole)

  if (!roles.length && (directRoles.length || inheritedRoles.length)) {
    roles = [...directRoles, ...inheritedRoles]
  }

  return {
    ...value,
    roles,
    direct_roles: directRoles,
    inherited_roles: inheritedRoles,
    manual_roles: manualRoles,
  }
}

/**
 * getApplicationAccess 查询用户在指定应用下的完整有效授权。
 * @param {string} userId 用户标识。
 * @param {string} applicationCode 应用编码。
 * @returns {Promise<Object|null>} 返回标准化的直接、继承与手工角色集合。
 * @throws {AuthorizationError} 用户或应用不存在、无访问权限或授权服务不可用时抛出。
 */
export function getApplicationAccess(userId, applicationCode) {
  return request(`/users/${encodeURIComponent(userId)}/applications/${encodeURIComponent(applicationCode)}/access`)
    .then(normalizeApplicationAccess)
}

/**
 * getAuthorizationOverview 只读汇总人员账号、任职、待异动、交接和 Keycloak 同步状态。
 * @param {string} userId 用户标识。
 * @returns {Promise<Object>} 返回用户详情页所需的一致状态摘要。
 * @throws {AuthorizationError} 用户不存在、无访问权限或汇总服务不可用时抛出。
 */
export function getAuthorizationOverview(userId) {
  return request(`/people/${encodeURIComponent(userId)}/authorization-overview`).then((value) => ({
    user: value?.user || null,
    accounts: Array.isArray(value?.accounts) ? value.accounts : [],
    memberships: Array.isArray(value?.memberships) ? value.memberships : [],
    role_bindings: Array.isArray(value?.role_bindings) ? value.role_bindings : [],
    pending_changes: Array.isArray(value?.pending_changes) ? value.pending_changes : [],
    handover: Array.isArray(value?.handover) ? value.handover : [],
    keycloak_sync: Array.isArray(value?.keycloak_sync) ? value.keycloak_sync : [],
  }))
}

/**
 * updateApplicationAccess 用完整角色集合替换用户在应用下的直接角色绑定。
 * @param {string} userId 用户标识。
 * @param {string} applicationCode 应用编码。
 * @param {Object} [options] 替换参数。
 * @param {Array<Object>} [options.roles] 包含 role_code、scope_type 和可选有效期的完整角色集合。
 * @returns {Promise<Object|null>} 返回标准化的有效授权。
 * @throws {AuthorizationError} 用户、应用或角色不存在，作用域无效或操作无权限时抛出。
 */
export function updateApplicationAccess(userId, applicationCode, { roles = [] } = {}) {
  return request(`/users/${encodeURIComponent(userId)}/applications/${encodeURIComponent(applicationCode)}/access`, {
    method: 'PUT',
    body: JSON.stringify({ roles }),
  }).then(normalizeApplicationAccess)
}

/**
 * deleteApplicationAccess 撤销用户在指定应用下的全部直接访问授权。
 * @param {string} userId 用户标识。
 * @param {string} applicationCode 应用编码。
 * @returns {Promise<Object>} 返回撤销结果。
 * @throws {AuthorizationError} 用户或应用不存在、授权不可撤销或操作无权限时抛出。
 */
export function deleteApplicationAccess(userId, applicationCode) {
  return request(`/users/${encodeURIComponent(userId)}/applications/${encodeURIComponent(applicationCode)}/access`, {
    method: 'DELETE',
  })
}

function subjectApplicationAccessPath(subjectType, subjectId, applicationCode) {
  return `/authorization-subjects/${encodeURIComponent(subjectType)}/${encodeURIComponent(subjectId)}/applications/${encodeURIComponent(applicationCode)}/access`
}

/**
 * getSubjectApplicationAccess 查询组织单元或岗位主体在应用下的角色绑定。
 * @param {string} subjectType 主体类型，如 ORG_UNIT 或 POSITION。
 * @param {string} subjectId 主体标识。
 * @param {string} applicationCode 应用编码。
 * @returns {Promise<Object|null>} 返回标准化的主体授权。
 * @throws {AuthorizationError} 主体或应用不存在、主体类型无效或无访问权限时抛出。
 */
export function getSubjectApplicationAccess(subjectType, subjectId, applicationCode) {
  return request(subjectApplicationAccessPath(subjectType, subjectId, applicationCode))
    .then((value) => normalizeApplicationAccess(value, subjectType))
}

/**
 * updateSubjectApplicationAccess 用完整角色集合替换组织或岗位在应用下的直接绑定。
 * @param {string} subjectType 主体类型。
 * @param {string} subjectId 主体标识。
 * @param {string} applicationCode 应用编码。
 * @param {Object} [options] 包含 roles 完整角色集合的替换参数。
 * @returns {Promise<Object|null>} 返回标准化的主体授权。
 * @throws {AuthorizationError} 主体、应用或角色不存在，角色集合无效或操作无权限时抛出。
 */
export function updateSubjectApplicationAccess(subjectType, subjectId, applicationCode, { roles = [] } = {}) {
  return request(subjectApplicationAccessPath(subjectType, subjectId, applicationCode), {
    method: 'PUT',
    body: JSON.stringify({ roles }),
  }).then((value) => normalizeApplicationAccess(value, subjectType))
}

/**
 * deleteSubjectApplicationAccess 撤销组织或岗位主体在应用下的全部直接角色绑定。
 * @param {string} subjectType 主体类型。
 * @param {string} subjectId 主体标识。
 * @param {string} applicationCode 应用编码。
 * @returns {Promise<Object>} 返回撤销结果。
 * @throws {AuthorizationError} 主体或应用不存在、绑定不可撤销或操作无权限时抛出。
 */
export function deleteSubjectApplicationAccess(subjectType, subjectId, applicationCode) {
  return request(subjectApplicationAccessPath(subjectType, subjectId, applicationCode), {
    method: 'DELETE',
  })
}
