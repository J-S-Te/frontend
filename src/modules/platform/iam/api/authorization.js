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

/**
 * 查询用户在指定应用下的完整有效授权。
 */
export function getApplicationAccess(userId, applicationCode) {
  return request(`/users/${encodeURIComponent(userId)}/applications/${encodeURIComponent(applicationCode)}/access`)
}

/**
 * 用完整角色集合替换用户在应用下的角色绑定。
 * roles 中的每一项使用后端通用授权接口约定的 role_code、scope_type 和有效期字段。
 */
export function updateApplicationAccess(userId, applicationCode, { roles = [] } = {}) {
  return request(`/users/${encodeURIComponent(userId)}/applications/${encodeURIComponent(applicationCode)}/access`, {
    method: 'PUT',
    body: JSON.stringify({ roles }),
  })
}

/**
 * 撤销用户在指定应用下的全部访问授权。
 */
export function deleteApplicationAccess(userId, applicationCode) {
  return request(`/users/${encodeURIComponent(userId)}/applications/${encodeURIComponent(applicationCode)}/access`, {
    method: 'DELETE',
  })
}

// 合同管理系统旧接口保留给旧版本调用方；新的平台界面优先使用通用接口。
export function getContractApplicationAccess(userId) {
  return request(`/users/${encodeURIComponent(userId)}/applications/contract_management/access`)
}

export function updateContractApplicationAccess(userId, { roleCode, customPermissions = [] }) {
  return request(`/users/${encodeURIComponent(userId)}/applications/contract_management/access`, {
    method: 'PUT',
    body: JSON.stringify({
      role_code: roleCode,
      custom_permissions: customPermissions,
    }),
  })
}
