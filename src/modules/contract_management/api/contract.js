// 合同管理 API 客户端。
// 合同后端使用独立同源前缀，避免与基础平台的 /api/v1 接口发生路由冲突。
const CONTRACT_PUBLIC_PATH_PREFIX = (import.meta.env.VITE_CONTRACT_PUBLIC_PATH_PREFIX || '/contract_management').replace(/\/$/, '')
const API_BASE_URL = (import.meta.env.VITE_CONTRACT_API_BASE_URL || `${CONTRACT_PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')

let currentSession = null
let sessionRequest = null
let loginRedirectStarted = false

export class ContractAuthError extends Error {
  constructor(message = '合同系统登录状态已失效。', options = {}) {
    super(message, options)
    this.name = 'ContractAuthError'
    this.status = 401
    this.code = 'CONTRACT_UNAUTHENTICATED'
  }
}

function startContractLogin() {
  if (loginRedirectStarted) return
  loginRedirectStarted = true
  clearContractSessionCache()
  window.location.replace(`${CONTRACT_PUBLIC_PATH_PREFIX}/auth/login`)
}

async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  return contentType.includes('application/json') ? response.json() : response.text()
}

async function request(path, options = {}) {
  const hasFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body && !hasFormDataBody ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const body = await readBody(response)
  if (!response.ok) {
    if (response.status === 401) {
      // 会话可能在页面停留期间过期或因平台权限变化被后端撤销。任意合同 API
      // 返回 401 都统一进入 OIDC，不允许每个并发请求各显示一条“登录状态无效”。
      startContractLogin()
      throw new ContractAuthError()
    }
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
      startContractLogin()
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

export async function listContractTemplates() {
  const data = await request('/contract-templates')
  return Array.isArray(data) ? data : []
}

export async function uploadContractTemplate({ name, file }) {
  const form = new FormData()
  form.append('name', name)
  form.append('file', file)
  return request('/contract-templates', {
    method: 'POST',
    body: form,
  })
}

export async function submitContract(contractId, payload = {}) {
  return request(`/contracts/${contractId}/submit-approval`, {
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

export async function listApprovals(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/approvals${search ? `?${search}` : ''}`)
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

export async function createApprovalRule(payload) {
  return request('/approval-rules', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateApprovalRule(ruleId, payload) {
  return request(`/approval-rules/${ruleId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteApprovalRule(ruleId, version) {
  return request(`/approval-rules/${ruleId}?version=${encodeURIComponent(version)}`, {
    method: 'DELETE',
  })
}
