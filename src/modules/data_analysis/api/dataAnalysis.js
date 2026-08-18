// 数据看板后端 API 封装（骨架，对齐 project_management/api/projectManagement.js 模式）
// 认证约定：HttpOnly Cookie 会话；401 由本客户端发起 OIDC 跳转；403 交由页面展示无权限。
// TODO: 联调时按后端实际响应结构校准字段名（code/message/request_id/data 信封）。

const runtimeEnv = import.meta.env || {}
const PUBLIC_PATH_PREFIX = (runtimeEnv.VITE_DATA_ANALYSIS_PUBLIC_PATH_PREFIX || '/data_analysis').replace(/\/$/, '')
const API_BASE_URL = (runtimeEnv.VITE_DATA_ANALYSIS_API_BASE_URL || `${PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')

let loginRedirectStarted = false

export function startDataAnalysisLogin() {
  if (loginRedirectStarted) return
  loginRedirectStarted = true
  window.location.replace(`${PUBLIC_PATH_PREFIX}/auth/login`)
}

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const requiresCSRF = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      // 写操作必须携带同源 CSRF 标记；后端仍会结合 Origin/Sec-Fetch-Site 校验，
      // 该固定值不构成身份凭据（对齐 CRM crmauth 客户端约定）。
      ...(requiresCSRF ? { 'X-CSRF-Token': '1' } : {}),
      ...(options.headers || {}),
    },
  })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : { message: await response.text() }
  if (!response.ok) {
    const error = new Error(body?.message || `HTTP ${response.status}`)
    error.status = response.status
    error.code = body?.code
    error.requestID = body?.request_id || ''
    if (response.status === 401) startDataAnalysisLogin()
    throw error
  }
  return body?.data ?? body
}

// —— 会话 ——
export function getAuthMe() {
  return request('/auth/me')
}

// 路由守卫使用：确认看板后端已建立 OIDC 会话；401 自动跳登录。
export async function ensureDataAnalysisSession() {
  try {
    return await getAuthMe()
  } catch (error) {
    if (error.status === 401) return null
    throw error
  }
}

// —— 嵌入桥（P-01~P-05）——
// 返回 { token, expires_at }；页面据此加载 /data_analysis/api/v1/embed-proxy/{token}
export function getEmbedToken(dashboardCode) {
  return request(`/embed/${encodeURIComponent(dashboardCode)}`)
}

// 合同/项目摘要来自聚合库最新快照；完整图表仍由 Metabase 嵌入桥提供。
export function getContractDashboardSummary() { return request('/dashboard/contract') }
export function getProjectDashboardSummary() { return request('/dashboard/project') }

// —— 预警中心（P-08）——
export function getAlerts(params = {}) {
  const query = new URLSearchParams(params).toString()
  return request(`/alerts${query ? `?${query}` : ''}`)
}
export function ackAlert(id) { return request(`/alerts/${encodeURIComponent(id)}/ack`, { method: 'POST' }) }
export function closeAlert(id) { return request(`/alerts/${encodeURIComponent(id)}/close`, { method: 'POST' }) }

// —— 预警规则（P-10，alert.manage）——
export function getAlertRules() { return request('/alert-rules') }
export function putAlertRules(payload) {
  return request('/alert-rules', { method: 'PUT', body: JSON.stringify(payload) })
}

// —— 指标字典（P-07）——
export function getDictionary() { return request('/dictionary') }

// —— 数据源状态（P-09，aggregation.manage）——
export function listSources() { return request('/admin/sources') }
export function triggerSource(id) { return request(`/admin/sources/${encodeURIComponent(id)}/trigger`, { method: 'POST' }) }
