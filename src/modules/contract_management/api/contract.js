// 合同管理 API 客户端。
// 合同后端使用独立同源前缀，避免与基础平台的 /api/v1 接口发生路由冲突。
import { getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import {
  normalizeAuthorizationSession,
  principalIdentityID,
  shouldStartSubsystemLogin,
  subsystemAccessMessage,
} from '../../shared/authz/sessionCompatibility.js'

const CONTRACT_PUBLIC_PATH_PREFIX = (import.meta.env.VITE_CONTRACT_PUBLIC_PATH_PREFIX || '/contract_management').replace(/\/$/, '')
const API_BASE_URL = (import.meta.env.VITE_CONTRACT_API_BASE_URL || `${CONTRACT_PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')
const CUSTOMER_API_BASE_URL = (import.meta.env.VITE_CUSTOMER_API_BASE_URL || '/customer_management/api/v1').replace(/\/$/, '')

let currentSession = null
let sessionRequest = null
let loginRedirectStarted = false

export class ContractAuthError extends Error {
  constructor(message = '合同系统登录状态已失效。', options = {}) {
    super(message, options)
    this.name = 'ContractAuthError'
    this.status = options.status || 401
    this.code = options.code || 'CONTRACT_UNAUTHENTICATED'
    this.requestID = options.requestID || ''
    this.details = options.details || null
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
  if (contentType.includes('application/json')) return response.json()
  const text = await response.text()
  return text ? { message: text } : {}
}

function userSafeErrorMessage(message) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return ''
  const exposesImplementation = /(https?:\/\/|\/api\/|\b(?:sql|http|json|uuid|trace[_ -]?id|request[_ -]?id|stack|panic)\b)/i.test(text)
  return exposesImplementation ? '' : text
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
      const authError = new ContractAuthError(userSafeErrorMessage(body?.message) || '合同系统登录状态已失效。', {
        status: response.status,
        code: body?.code,
        requestID: body?.request_id,
        details: body?.details,
      })
      // 只有普通会话失效才重新走登录。Claims/Client 配置错误保留原始分类，
      // 交给统一访问错误页展示，避免形成“登录—回调—再次登录”的循环。
      if (shouldStartSubsystemLogin(authError)) startContractLogin()
      throw authError
    }
    const fallbackMessages = {
      400: '提交的内容有误，请检查后重试。',
      403: '您没有执行此操作的权限。',
      404: '未找到相关记录，它可能已被删除。',
      409: '数据已发生变化，请刷新后重试。',
    }
    const error = new Error(userSafeErrorMessage(body?.message) || fallbackMessages[response.status] || '操作失败，请稍后重试。')
    error.status = response.status
    error.code = body?.code
    error.requestID = body?.request_id || ''
    error.details = body?.details || null
    error.message = subsystemAccessMessage(error, error.message)
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
      currentSession = normalizeAuthorizationSession(session)
      return currentSession
    })
    .finally(() => { sessionRequest = null })

  return sessionRequest
}

export function clearContractSessionCache() {
  currentSession = null
  sessionRequest = null
}

async function clearContractLocalSession() {
  clearContractSessionCache()
  try {
    await fetch(`${CONTRACT_PUBLIC_PATH_PREFIX}/auth/local-logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch {
    // 本地注销端点暂时不可用时仍继续授权；后续 OIDC 回调会覆盖旧 Cookie，
    // 避免因为清理失败把用户永久困在登录循环中。
  }
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
    const contractSession = await getContractSession({ force: true })
    try {
      const platformPrincipal = await getCurrentPrincipal()
      const platformUserID = principalIdentityID(platformPrincipal)
      const platformTenantID = String(platformPrincipal?.tenant_id || platformPrincipal?.tenant?.id || '')
      const contractIdentityID = principalIdentityID(contractSession)
      const userChanged = platformUserID && contractIdentityID && platformUserID !== contractIdentityID
      const tenantChanged = platformTenantID && platformTenantID !== String(contractSession?.tenant_id || '')
      if (userChanged || tenantChanged) {
        await clearContractLocalSession()
        startContractLogin()
        return null
      }
    } catch {
      // 平台浏览器 Cookie 过期或平台 API 暂时不可用，并不自动使合同系统自己的
      // OIDC 会话失效；只有成功读取到不同主体时才执行切换，避免依赖故障误登出。
    }
    return contractSession
  } catch (error) {
    if (shouldStartSubsystemLogin(error)) {
      startContractLogin()
      return null
    }
    throw error
  }
}

export function getContractDashboard() {
  return request('/dashboard')
}

export async function listContracts(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/contracts${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
}

export async function listContractLifecycle(contractId) {
  const data = await request(`/contracts/${encodeURIComponent(contractId)}/lifecycle`)
  return Array.isArray(data) ? data : []
}

export async function listApprovedContracts(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/approved-contracts${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
}

export async function listSigningRecords(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/signing-records${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
}

export function getSigningRecord(contractId) {
  return request(`/signing-records/${encodeURIComponent(contractId)}`)
}

export function saveSigningShipment(contractId, payload) {
  return request(`/signing-records/${encodeURIComponent(contractId)}/shipment`, { method: 'PUT', body: JSON.stringify(payload) })
}

export function markSigningReceived(contractId) {
  return request(`/signing-records/${encodeURIComponent(contractId)}/received`, { method: 'POST' })
}

export function recordSigningReminder(contractId) {
  return request(`/signing-records/${encodeURIComponent(contractId)}/reminders`, { method: 'POST' })
}

export function confirmSigning(contractId, payload) {
  return request(`/signing-records/${encodeURIComponent(contractId)}/confirm`, { method: 'POST', body: JSON.stringify(payload) })
}

export function approvedContractDownloadURL(contractId, format) {
  return `${API_BASE_URL}/approved-contracts/${encodeURIComponent(contractId)}/${format}`
}

export async function uploadStampedContractPDF(contractId, file) {
  const form = new FormData()
  form.append('file', file)
  return request(`/approved-contracts/${encodeURIComponent(contractId)}/stamped-pdf`, { method: 'PUT', body: form })
}

export async function listOpportunityIntakes(params = {}) {
  const search = new URLSearchParams(params).toString()
  let data
  try {
    data = await request(`/opportunity-intakes${search ? `?${search}` : ''}`)
  } catch (error) {
    // 滚动发布期间兼容旧后端：旧版本只接受 limit 并返回数组。仅首页可降级，
    // 因为旧协议没有游标语义；继续翻页若降级会重复或遗漏记录，因此失败关闭。
    const canUseLegacyList = error?.status === 422 && error?.code === 'CON_VALIDATION_ERROR'
      && !params.cursor && Object.hasOwn(params, 'page_size')
    if (!canUseLegacyList) throw error
    const legacyParams = new URLSearchParams()
    if (params.status) legacyParams.set('status', params.status)
    legacyParams.set('limit', String(params.page_size))
    data = await request(`/opportunity-intakes?${legacyParams}`)
  }
  // 对象是当前稳定分页协议；数组只用于读取旧版本首页，绝不为旧响应伪造游标。
  if (Array.isArray(data)) {
    return { items: data, page_size: data.length, next_cursor: '', has_more: false }
  }
  const nextCursor = typeof data?.next_cursor === 'string' ? data.next_cursor : ''
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    page_size: Number(data?.page_size || 0),
    next_cursor: nextCursor,
    has_more: data?.has_more === true && nextCursor !== '',
  }
}

export async function getOpportunityIntake(intakeId) {
  return request(`/opportunity-intakes/${encodeURIComponent(intakeId)}`)
}

/**
 * 核对 CRM 已投递的签单与既有合同引用。LINK_CONFIRMED 会持久化
 * 已有合同与 CRM 客户、商机的权威关联；两种结论都不创建合同、
 * 不修改合同状态，也不启动合同审批。
 */
export async function reviewOpportunityIntake(intakeId, payload, idempotencyKey) {
  return request(`/opportunity-intakes/${encodeURIComponent(intakeId)}/reviews`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  })
}

export async function createContract(payload) {
  return request('/contracts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// CRM 仅接受 created_by=me，不允许浏览器提交任意创建人。逐页读取确保负责人已转交的
// 商机仍会完整出现在其原创建人的合同选择器中。
export async function listMyOpportunities(params = {}) {
  const items = []
  for (let page = 1; page <= 100; page += 1) {
    const search = new URLSearchParams({ ...params, created_by: 'me', page: String(page), page_size: '100' }).toString()
    const response = await fetch(`${CUSTOMER_API_BASE_URL}/opportunities?${search}`, { credentials: 'include', headers: { Accept: 'application/json' } })
    const body = await readBody(response)
    if (!response.ok) {
      const error = new Error(userSafeErrorMessage(body?.message) || '读取可关联商机失败，请稍后重试。')
      error.status = response.status
      throw error
    }
    const data = body?.data ?? body
    const pageItems = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    items.push(...pageItems)
    const total = Number(data?.total ?? items.length)
    if (!pageItems.length || items.length >= total || pageItems.length < 100) break
  }
  return items
}

export async function linkOpportunityContractDraft(opportunityId, payload) {
  const response = await fetch(`${CUSTOMER_API_BASE_URL}/opportunities/${encodeURIComponent(opportunityId)}/contract-drafts`, {
    method: 'POST', credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': '1' },
    body: JSON.stringify(payload),
  })
  const body = await readBody(response)
  if (!response.ok) {
    const error = new Error(userSafeErrorMessage(body?.message) || '合同已创建，但回传客户与商机系统失败。')
    error.status = response.status
    throw error
  }
  return body?.data ?? body
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

export async function updateContractTemplate(templateId, payload) {
  return request(`/contract-templates/${encodeURIComponent(templateId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteContractTemplate(templateId) {
  return request(`/contract-templates/${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
  })
}

export async function previewContractTemplate(templateId, values) {
  return request(`/contract-templates/${encodeURIComponent(templateId)}/preview`, {
    method: 'POST',
    body: JSON.stringify({ values }),
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

export async function previewContractDocument(contractId) {
  return request(`/contracts/${encodeURIComponent(contractId)}/preview`)
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

export async function previewApprovalContract(approvalId) {
  return request(`/approvals/${encodeURIComponent(approvalId)}/contract-preview`)
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
