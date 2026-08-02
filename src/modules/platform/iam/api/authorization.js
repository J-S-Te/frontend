const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export class AuthorizationError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'AuthorizationError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}

async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return {}
    }
  }
  const text = await response.text()
  return text ? { message: text } : {}
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch {
    throw new AuthorizationError('无法连接授权管理服务，请确认后端服务已启动。', { code: 'NETWORK_ERROR' })
  }
  const body = await readBody(response)
  if (!response.ok) {
    throw new AuthorizationError(body?.message || '授权管理请求失败。', {
      status: response.status,
      code: body?.code,
      traceId: body?.request_id || body?.trace_id || body?.traceId,
    })
  }
  return body?.data
}

function pageQuery(parameters = {}) {
  const search = new URLSearchParams()
  Object.entries(parameters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, String(value))
  })
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

function normalize(value) {
  if (!value || typeof value !== 'object') {
    return { items: [], total: 0, page: 1, pageSize: 20 }
  }
  return {
    items: Array.isArray(value.items) ? value.items : [],
    total: Number(value.total || 0),
    page: Number(value.page || 1),
    pageSize: Number(value.page_size || 20),
  }
}

// ============================================================================
// 以下 API（resources / permissions / roles / role-bindings 的 CRUD）目前没有
// 前端 UI 入口——基础平台的角色/权限管理走"子系统目录只读同步 + 用户/组织/岗位
// 例外授权"路线，不在平台侧提供平台自营角色的创建编辑。
//
// 这些导出保留是为了：
// 1) 兼容早期 seed 脚本与运维 CLI；
// 2) 后端后续若开放平台侧角色管理，可在不破坏模块结构的情况下挂回 UI。
// 新增 UI 时请同步去掉本注释，并恢复 `/* unused */` 行的调用。
// ============================================================================
export function listResources({ page = 1, pageSize = 100, keyword = '', status = '' } = {}) {
  return request(`/resources${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

export function listPermissions({ page = 1, pageSize = 100, keyword = '', status = '' } = {}) {
  return request(`/permissions${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

export function listRoles({ page = 1, pageSize = 100, keyword = '', status = '' } = {}) {
  return request(`/roles${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

export function getRole(roleId) {
  return request(`/roles/${encodeURIComponent(roleId)}`)
}

export function listRoleBindings({ page = 1, pageSize = 100, keyword = '', status = '' } = {}) {
  return request(`/role-bindings${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

export function createRole({ name, description = '', permissionIds = [] }) {
  return request('/roles', {
    method: 'POST',
    body: JSON.stringify({ name, description, permission_ids: permissionIds }),
  })
}

export function updateRole({ roleId, name, description = '', permissionIds = [], status = 'ACTIVE', version }) {
  return request(`/roles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, description, permission_ids: permissionIds, status, version }),
  })
}

export function createRoleBinding({ roleId, subjectType, subjectId, scopeType, scopeId = null, status = 'ACTIVE', expiresAt = null }) {
  return request('/role-bindings', {
    method: 'POST',
    body: JSON.stringify({
      role_id: roleId,
      subject_type: subjectType,
      subject_id: subjectId,
      scope_type: scopeType,
      scope_id: scopeId,
      status,
      expires_at: expiresAt,
    }),
  })
}

export function createPermission({ resourceId, code, name, action }) {
  return request('/permissions', {
    method: 'POST',
    body: JSON.stringify({ resource_id: resourceId, code, name, action }),
  })
}

/**
 * 查询应用的权限目录。目录由应用自己维护，平台只负责校验并展示。
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
 * 统一新旧后端的应用授权响应。
 *
 * 新后端直接返回 direct_roles / inherited_roles；旧后端缺少这两个字段时，
 * 优先根据 direct/source_type 判断来源。若整份旧数据完全没有来源字段，
 * 则维持历史行为，将 roles 全部视为用户直接授权。
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
 * 查询用户在指定应用下的完整有效授权。
 */
export function getApplicationAccess(userId, applicationCode) {
  return request(`/users/${encodeURIComponent(userId)}/applications/${encodeURIComponent(applicationCode)}/access`)
    .then(normalizeApplicationAccess)
}

/**
 * 用完整角色集合替换用户在应用下的角色绑定。
 * roles 中的每一项使用后端通用授权接口约定的 role_code、scope_type 和有效期字段。
 */
export function updateApplicationAccess(userId, applicationCode, { roles = [] } = {}) {
  return request(`/users/${encodeURIComponent(userId)}/applications/${encodeURIComponent(applicationCode)}/access`, {
    method: 'PUT',
    body: JSON.stringify({ roles }),
  }).then(normalizeApplicationAccess)
}

/**
 * 撤销用户在指定应用下的全部访问授权。
 */
export function deleteApplicationAccess(userId, applicationCode) {
  return request(`/users/${encodeURIComponent(userId)}/applications/${encodeURIComponent(applicationCode)}/access`, {
    method: 'DELETE',
  })
}

function subjectApplicationAccessPath(subjectType, subjectId, applicationCode) {
  return `/authorization-subjects/${encodeURIComponent(subjectType)}/${encodeURIComponent(subjectId)}/applications/${encodeURIComponent(applicationCode)}/access`
}

/** 查询组织单元或岗位主体在应用下的角色绑定。 */
export function getSubjectApplicationAccess(subjectType, subjectId, applicationCode) {
  return request(subjectApplicationAccessPath(subjectType, subjectId, applicationCode))
    .then((value) => normalizeApplicationAccess(value, subjectType))
}

/** 用完整角色集合替换组织单元或岗位主体在应用下的直接角色绑定。 */
export function updateSubjectApplicationAccess(subjectType, subjectId, applicationCode, { roles = [] } = {}) {
  return request(subjectApplicationAccessPath(subjectType, subjectId, applicationCode), {
    method: 'PUT',
    body: JSON.stringify({ roles }),
  }).then((value) => normalizeApplicationAccess(value, subjectType))
}

/** 撤销组织单元或岗位主体在应用下的全部直接角色绑定。 */
export function deleteSubjectApplicationAccess(subjectType, subjectId, applicationCode) {
  return request(subjectApplicationAccessPath(subjectType, subjectId, applicationCode), {
    method: 'DELETE',
  })
}
