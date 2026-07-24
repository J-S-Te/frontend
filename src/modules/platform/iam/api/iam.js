// IAM API 客户端
// 平台后端 base URL 来自 VITE_API_BASE_URL
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    const error = new Error(body?.message || `HTTP ${response.status}`)
    error.status = response.status
    error.code = body?.code
    throw error
  }
  return body?.data ?? body
}

// ===== 用户 =====
export async function listUsers(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/users${search ? `?${search}` : ''}`)
  return Array.isArray(data?.items) ? data.items : []
}

export async function getUser(userId) {
  return request(`/users/${userId}`)
}

// ===== 账号 =====
export async function listAccounts(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/accounts${search ? `?${search}` : ''}`)
  return Array.isArray(data?.items) ? data.items : []
}

// ===== 组织 =====
export async function listOrgUnits(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/org-units${search ? `?${search}` : ''}`)
  return Array.isArray(data?.items) ? data.items : []
}

// ===== 角色 =====
export async function listRoles(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/roles${search ? `?${search}` : ''}`)
  return Array.isArray(data?.items) ? data.items : []
}

// ===== 角色绑定 =====
export async function listRoleBindings(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/role-bindings${search ? `?${search}` : ''}`)
  return Array.isArray(data?.items) ? data.items : []
}

// ===== 权限点 =====
export async function listPermissions(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/permissions${search ? `?${search}` : ''}`)
  return Array.isArray(data?.items) ? data.items : []
}

// ===== 资源 =====
export async function listResources(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/resources${search ? `?${search}` : ''}`)
  return Array.isArray(data?.items) ? data.items : []
}
