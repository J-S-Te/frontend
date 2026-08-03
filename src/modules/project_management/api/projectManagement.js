import { getCurrentPrincipal } from '@/modules/platform/auth/api/auth'

const runtimeEnv = import.meta.env || {}
const PUBLIC_PATH_PREFIX = (runtimeEnv.VITE_PROJECT_PUBLIC_PATH_PREFIX || '/project_management').replace(/\/$/, '')
const API_BASE_URL = (runtimeEnv.VITE_PROJECT_API_BASE_URL || `${PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')
let currentSession = null
let sessionRequest = null
let loginRedirectStarted = false

function startProjectLogin() {
  // 并发请求共享一次登录跳转，并在跳转前清空旧主体缓存。
  if (loginRedirectStarted) return
  loginRedirectStarted = true
  clearProjectSessionCache()
  window.location.replace(`${PUBLIC_PATH_PREFIX}/auth/login`)
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    if (response.status === 401) {
      startProjectLogin()
      const error = new Error('项目系统登录状态已失效。')
      error.status = 401
      error.code = 'PROJECT_UNAUTHENTICATED'
      throw error
    }
    const error = new Error(body?.message || `HTTP ${response.status}`)
    error.status = response.status
    error.code = body?.code
    throw error
  }
  return body?.data ?? body
}

export function clearProjectSessionCache() { currentSession = null; sessionRequest = null }

export async function getProjectSession({ force = false } = {}) {
  // 合并同一时刻的 /auth/me 请求，防止多个组件各自读取并提交不同时间点的会话。
  if (!force && currentSession) return currentSession
  if (!force && sessionRequest) return sessionRequest
  sessionRequest = request('/auth/me').then((session) => { currentSession = session; return session }).finally(() => { sessionRequest = null })
  return sessionRequest
}

async function clearProjectLocalSession() {
  clearProjectSessionCache()
  try { await fetch(`${PUBLIC_PATH_PREFIX}/auth/local-logout`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } }) } catch { /* 本地清理暂时失败时，后续 OIDC 回调仍会覆盖旧会话。 */ }
}

/**
 * 项目系统与基础平台各持有自己的 Cookie。项目会话有效时再对比平台主体，若
 * 用户或租户已经切换，先清理项目本地会话再重新走 OIDC，防止沿用上一用户的
 * 菜单和数据权限；平台暂时不可用不会误撤销仍有效的项目会话。
 */
export async function ensureProjectSession() {
  try {
    const projectSession = await getProjectSession({ force: true })
    try {
      const platformPrincipal = await getCurrentPrincipal()
      const userChanged = String(platformPrincipal?.user?.id || '') && String(platformPrincipal.user.id) !== String(projectSession?.user_id || '')
      const tenantChanged = String(platformPrincipal?.tenant?.id || '') && String(platformPrincipal.tenant.id) !== String(projectSession?.tenant_id || '')
      if (userChanged || tenantChanged) { await clearProjectLocalSession(); startProjectLogin(); return null }
    } catch { /* 基础平台暂时不可用时，项目 OIDC 会话仍按自身有效期独立生效。 */ }
    return projectSession
  } catch (error) {
    if (error?.status === 401) { startProjectLogin(); return null }
    throw error
  }
}

export async function listProjects(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/projects${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
}

export function getProject(projectID) {
  return request(`/projects/${encodeURIComponent(projectID)}`)
}

export function createProject(payload) {
  return request('/projects', { method: 'POST', body: JSON.stringify(payload) })
}

export async function listServiceItems(projectID = '') {
  const search = projectID ? `?project_id=${encodeURIComponent(projectID)}` : ''
  const data = await request(`/service-items${search}`)
  return Array.isArray(data) ? data : []
}

export function confirmServiceItems(ids) {
  return request('/service-items/confirm', { method: 'POST', body: JSON.stringify({ ids }) })
}

export async function listRules() {
  const data = await request('/rules')
  return Array.isArray(data) ? data : []
}

export function createRule(payload) {
  return request('/rules', { method: 'POST', body: JSON.stringify(payload) })
}

export function setRuleEnabled(id, enabled) {
  return request(`/rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) })
}

export function getDashboard() {
  return request('/dashboard')
}
