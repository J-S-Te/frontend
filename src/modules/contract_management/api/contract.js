// 合同管理 API 客户端。
// 合同后端使用独立同源前缀，避免与基础平台的 /api/v1 接口发生路由冲突。
const API_BASE_URL = (import.meta.env.VITE_CONTRACT_API_BASE_URL || '/contract-api/api/v1').replace(/\/$/, '')

async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  return contentType.includes('application/json') ? response.json() : response.text()
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    ...options,
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
 * 确保浏览器已经建立合同系统自己的 OIDC 本地会话。
 *
 * 基础平台会话与合同系统会话相互独立；当合同 API 返回 401 时，通过
 * 同源 /contract/auth/login 发起授权码 + PKCE 流程。回调成功后合同后端
 * 会写入 HttpOnly Cookie 并重新回到 /contract/。
 */
export async function ensureContractSession() {
  const response = await fetch(`${API_BASE_URL}/contracts?limit=1`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) {
    window.location.assign('/contract/auth/login')
    return false
  }
  if (!response.ok) {
    const body = await readBody(response)
    const error = new Error(body?.message || '合同系统会话检查失败。')
    error.status = response.status
    error.code = body?.code
    throw error
  }
  return true
}

export async function listContracts(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/contracts${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
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

export async function listApprovalRules() {
  const data = await request('/approval-rules')
  return Array.isArray(data) ? data : []
}
