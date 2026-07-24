// 合同管理 API 客户端
// 平台后端 base URL 来自 VITE_API_BASE_URL
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

// 合同管理后端的端口在 :8082，前端通过 nginx 反代
// 假设 nginx 把 /api/v1/contracts/* 转发到 platform 后端（认证），其他路径转发到 contract-management
// 这里走 nginx 路径（/api/v1/contracts, /api/v1/approval-rules 等），由 nginx 路由
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
  const data = await request(`/approval-rules`)
  return Array.isArray(data) ? data : []
}
