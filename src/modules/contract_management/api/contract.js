// 合同管理 API 客户端。
// 合同后端使用独立同源前缀，避免与基础平台的 /api/v1 接口发生路由冲突。
const CONTRACT_PUBLIC_PATH_PREFIX = (import.meta.env.VITE_CONTRACT_PUBLIC_PATH_PREFIX || '/contract_management').replace(/\/$/, '')
const API_BASE_URL = (import.meta.env.VITE_CONTRACT_API_BASE_URL || `${CONTRACT_PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')

let currentSession = null
let sessionRequest = null

async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  return contentType.includes('application/json') ? response.json() : response.text()
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
  const body = await readBody(response)
  if (!response.ok) {
    const error = new Error(body?.message || `HTTP ${response.status}`)
    error.status = response.status
    error.code = body?.code
    throw error
  }
  return body?.data ?? body
}

/**
 * 读取合同系统服务端会话。权限只以 HttpOnly Cookie 对应的后端会话为准，
 * 前端缓存仅用于菜单渲染和路由检查，不参与接口鉴权。
 */
export async function getContractSession({ force = false } = {}) {
  if (!force && currentSession) return currentSession
  if (!force && sessionRequest) return sessionRequest

  sessionRequest = request('/auth/me')
    .then((session) => {
      currentSession = session
      return session
    })
    .finally(() => { sessionRequest = null })

  return sessionRequest
}

export function clearContractSessionCache() {
  currentSession = null
  sessionRequest = null
}

/**
 * 确保浏览器已经建立合同系统自己的 OIDC 本地会话。
 *
 * 基础平台会话与合同系统会话相互独立；当 /auth/me 返回 401 时，通过
 * 同源 /contract_management/auth/login 发起授权码 + PKCE 流程。回调成功后合同后端
 * 会写入 HttpOnly Cookie，并按 APP_PUBLIC_URL 返回 Vue 合同管理页面。
 */
export async function ensureContractSession() {
  try {
    return await getContractSession({ force: true })
  } catch (error) {
    if (error?.status === 401) {
      clearContractSessionCache()
      window.location.assign(`${CONTRACT_PUBLIC_PATH_PREFIX}/auth/login`)
      return null
    }
    throw error
  }
}

export async function listContracts(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/contracts${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
}

export async function createContract(payload) {
  return request('/contracts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getContract(contractId) {
  return request(`/contracts/${contractId}`)
}

export async function listApprovalTasks(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/approvals/tasks${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
}

export async function getApproval(approvalId) {
  return request(`/approvals/${approvalId}`)
}

export async function commandApproval(approvalId, action, payload = {}) {
  return request(`/approvals/${approvalId}/${action}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function listApprovalRules() {
  const data = await request('/approval-rules')
  return Array.isArray(data) ? data : []
}
