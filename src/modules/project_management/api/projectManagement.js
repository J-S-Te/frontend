const runtimeEnv = import.meta.env || {}
const API_BASE_URL = (runtimeEnv.VITE_PROJECT_API_BASE_URL || '/project_management/api/v1').replace(/\/$/, '')

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
    const error = new Error(body?.message || `HTTP ${response.status}`)
    error.status = response.status
    error.code = body?.code
    throw error
  }
  return body?.data ?? body
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
