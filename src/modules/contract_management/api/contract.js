// 合同管理 API 客户端。
// 合同后端使用独立同源前缀，避免与基础平台的 /api/v1 接口发生路由冲突。
import { getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import {
  normalizeAuthorizationSession,
  principalIdentityID,
  shouldStartSubsystemLogin,
  subsystemAccessMessage,
} from '../../shared/authz/sessionCompatibility.js'
import { attachStructuredContext } from '../../platform/shared/api/requestContext.js'

const CONTRACT_PUBLIC_PATH_PREFIX = (import.meta.env.VITE_CONTRACT_PUBLIC_PATH_PREFIX || '/contract_management').replace(/\/$/, '')
const API_BASE_URL = (import.meta.env.VITE_CONTRACT_API_BASE_URL || `${CONTRACT_PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')
const CUSTOMER_API_BASE_URL = (import.meta.env.VITE_CUSTOMER_API_BASE_URL || '/customer_management/api/v1').replace(/\/$/, '')

let currentSession = null
let sessionRequest = null
let loginRedirectStarted = false

/**
 * ContractAuthError 表示合同子系统认证失败，并保留后端返回的状态码与追踪信息。
 * @param {string} [message='合同系统登录状态已失效。'] 面向用户的错误信息。
 * @param {{status?: number, code?: string, requestID?: string, details?: unknown, cause?: unknown}} [options={}] 错误上下文。
 */
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

/**
 * startContractLogin 清理会话缓存并发起合同子系统登录；并发调用只允许首次跳转生效。
 * @returns {void}
 */
function startContractLogin() {
  if (loginRedirectStarted) return
  loginRedirectStarted = true
  clearContractSessionCache()
  window.location.replace(`${CONTRACT_PUBLIC_PATH_PREFIX}/auth/login`)
}

/**
 * readBody 按响应媒体类型解析 JSON 或文本错误体。
 * @param {Response} response Fetch 响应。
 * @returns {Promise<unknown>} JSON 数据，或包装为 message 字段的文本数据。
 * @throws {SyntaxError} 响应声明为 JSON 但内容无法解析时抛出。
 */
async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return response.json()
  const text = await response.text()
  return text ? { message: text } : {}
}

/**
 * userSafeErrorMessage 过滤可能泄露接口地址、追踪标识或服务端实现细节的错误信息。
 * @param {unknown} message 待筛选的错误信息。
 * @returns {string} 可安全展示的文本；不安全或空文本返回空字符串。
 */
function userSafeErrorMessage(message) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return ''
  const exposesImplementation = /(https?:\/\/|\/api\/|\b(?:sql|http|json|uuid|trace[_ -]?id|request[_ -]?id|stack|panic)\b)/i.test(text)
  return exposesImplementation ? '' : text
}

/**
 * request 调用合同子系统 API，统一解析响应、补充结构化错误上下文并处理会话失效。
 * @param {string} path 相对于合同 API 根路径的请求地址。
 * @param {RequestInit} [options={}] Fetch 请求配置。
 * @returns {Promise<unknown>} 优先返回响应 data 字段，否则返回完整响应体。
 * @throws {ContractAuthError} 服务端返回 401 时抛出，并在适用时启动子系统登录。
 * @throws {Error} 网络失败、响应解析失败或服务端返回其他非成功状态时抛出。
 */
async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const requestContext = {
    subsystem: 'contract_management',
    feature: 'contract',
    operation: method,
    path,
    method,
  }

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
      attachStructuredContext(authError, {
        ...requestContext,
        tenantId: String(body?.tenant_id || ''),
        requestId: body?.request_id || '',
        traceId: body?.trace_id || body?.traceId || '',
        metadata: { auth: true, source: 'contract_api' },
      }, {
        status: response.status,
        code: body?.code,
        requestId: body?.request_id || '',
        traceId: body?.trace_id || body?.traceId || '',
      })
      throw authError
    }
    const fallbackMessages = {
      400: '提交的内容有误，请检查后重试。',
      403: '您没有执行此操作的权限。',
      404: '未找到相关记录，它可能已被删除。',
      409: '数据已发生变化，请刷新后重试。',
    }
    const error = new Error(userSafeErrorMessage(body?.message) || fallbackMessages[response.status] || '操作失败，请稍后重试。')
    attachStructuredContext(error, {
      ...requestContext,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
      metadata: { source: 'contract_api', fallback: true },
    }, {
      status: response.status,
      code: body?.code,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
    })
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
 * getContractSession 读取并规范化合同系统服务端会话；前端缓存仅用于界面与路由判断。
 * @param {{force?: boolean}} [options={}] force 为 true 时忽略已有会话和进行中的请求。
 * @returns {Promise<Record<string, unknown>>} 规范化后的合同会话。
 * @throws {ContractAuthError} 会话失效时抛出。
 * @throws {Error} 网络失败、响应解析失败或服务端拒绝请求时抛出。
 */
export async function getContractSession({ force = false } = {}) {
  // 非强制读取复用缓存或在途 Promise，避免路由和菜单同时初始化时重复请求。
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

/**
 * clearContractSessionCache 清空合同会话及在途请求缓存，不发起网络请求。
 * @returns {void}
 */
export function clearContractSessionCache() {
  currentSession = null
  sessionRequest = null
}

/**
 * clearContractLocalSession 请求合同后端清理本地 Cookie；清理失败不会中断后续重新授权。
 * @returns {Promise<void>}
 */
async function clearContractLocalSession() {
  clearContractSessionCache()
  try {
    await fetch(`${CONTRACT_PUBLIC_PATH_PREFIX}/auth/local-logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch {
    attachStructuredContext(new Error('本地会话清理失败。'), {
      subsystem: 'contract_management',
      feature: 'contract_session',
      operation: 'POST',
      path: `${CONTRACT_PUBLIC_PATH_PREFIX}/auth/local-logout`,
      method: 'POST',
      metadata: { source: 'contract_local_logout' },
    }, {
      status: 0,
      code: 'NETWORK_ERROR',
      requestId: '',
      traceId: '',
    })
    // 本地注销端点暂时不可用时仍继续授权；后续 OIDC 回调会覆盖旧 Cookie，
    // 避免因为清理失败把用户永久困在登录循环中。
  }
}

/**
 * ensureContractSession 确认合同会话与基础平台主体一致，必要时清理旧会话并启动 OIDC 登录。
 * @returns {Promise<Record<string, unknown>|null>} 有效合同会话；已启动登录跳转时返回 null。
 * @throws {Error} 非登录类鉴权错误、网络失败或服务端异常时抛出。
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

/**
 * getContractDashboard 获取合同看板汇总数据。
 * @returns {Promise<unknown>} 合同看板响应。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export function getContractDashboard() {
  return request('/dashboard')
}

/**
 * listContracts 按查询条件获取合同列表，并将非数组响应安全降级为空列表。
 * @param {Record<string, string|number|boolean>} [params={}] 合同筛选与分页参数。
 * @returns {Promise<Array<unknown>>} 合同列表。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listContracts(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/contracts${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
}

/**
 * listContractLifecycle 获取指定合同的生命周期事件，并将非数组响应安全降级为空列表。
 * @param {string|number} contractId 合同标识。
 * @returns {Promise<Array<unknown>>} 按后端顺序返回的生命周期事件。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listContractLifecycle(contractId) {
  const data = await request(`/contracts/${encodeURIComponent(contractId)}/lifecycle`)
  return Array.isArray(data) ? data : []
}

/**
 * listApprovedContracts 按查询条件获取已审批合同列表。
 * @param {Record<string, string|number|boolean>} [params={}] 筛选与分页参数。
 * @returns {Promise<Array<unknown>>} 已审批合同列表；响应异常时返回空列表。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listApprovedContracts(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/approved-contracts${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
}

/**
 * listSigningRecords 按查询条件获取合同签署记录。
 * @param {Record<string, string|number|boolean>} [params={}] 签署记录筛选与分页参数。
 * @returns {Promise<Array<unknown>>} 签署记录列表；响应异常时返回空列表。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listSigningRecords(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/signing-records${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
}

/**
 * getSigningRecord 获取指定合同的签署记录。
 * @param {string|number} contractId 合同标识。
 * @returns {Promise<unknown>} 签署记录详情。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export function getSigningRecord(contractId) {
  return request(`/signing-records/${encodeURIComponent(contractId)}`)
}

/**
 * saveSigningShipment 保存指定合同的寄送信息。
 * @param {string|number} contractId 合同标识。
 * @param {Record<string, unknown>} payload 寄送信息。
 * @returns {Promise<unknown>} 更新后的签署记录。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export function saveSigningShipment(contractId, payload) {
  return request(`/signing-records/${encodeURIComponent(contractId)}/shipment`, { method: 'PUT', body: JSON.stringify(payload) })
}

/**
 * markSigningReceived 将指定合同标记为已收件。
 * @param {string|number} contractId 合同标识。
 * @returns {Promise<unknown>} 更新后的签署记录。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export function markSigningReceived(contractId) {
  return request(`/signing-records/${encodeURIComponent(contractId)}/received`, { method: 'POST' })
}

/**
 * recordSigningReminder 记录一次合同签署催办操作。
 * @param {string|number} contractId 合同标识。
 * @returns {Promise<unknown>} 更新后的催办或签署记录。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export function recordSigningReminder(contractId) {
  return request(`/signing-records/${encodeURIComponent(contractId)}/reminders`, { method: 'POST' })
}

/**
 * confirmSigning 提交指定合同的签署确认信息。
 * @param {string|number} contractId 合同标识。
 * @param {Record<string, unknown>} payload 签署确认内容。
 * @returns {Promise<unknown>} 确认后的签署记录。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export function confirmSigning(contractId, payload) {
  return request(`/signing-records/${encodeURIComponent(contractId)}/confirm`, { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * approvedContractDownloadURL 生成指定已审批合同的同源下载地址。
 * @param {string|number} contractId 合同标识。
 * @param {string} format 下载格式或后端定义的文件路径片段。
 * @returns {string} 合同文件下载地址。
 */
export function approvedContractDownloadURL(contractId, format) {
  return `${API_BASE_URL}/approved-contracts/${encodeURIComponent(contractId)}/${format}`
}

/**
 * uploadStampedContractPDF 上传指定合同的盖章 PDF 文件。
 * @param {string|number} contractId 合同标识。
 * @param {File|Blob} file 待上传的 PDF 文件。
 * @returns {Promise<unknown>} 上传后的合同文件信息。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function uploadStampedContractPDF(contractId, file) {
  const form = new FormData()
  form.append('file', file)
  return request(`/approved-contracts/${encodeURIComponent(contractId)}/stamped-pdf`, { method: 'PUT', body: form })
}

/**
 * listOpportunityIntakes 获取 CRM 商机接入队列，并兼容仅首页可用的旧版数组协议。
 * @param {{cursor?: string, page_size?: number, status?: string, [key: string]: unknown}} [params={}] 游标分页与状态筛选参数。
 * @returns {Promise<{items: Array<unknown>, page_size: number, next_cursor: string, has_more: boolean}>} 规范化后的接入队列分页结果。
 * @throws {Error} 非兼容性校验错误、网络失败或服务端返回非成功状态时抛出。
 */
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

/**
 * getOpportunityIntake 获取指定 CRM 商机接入记录。
 * @param {string|number} intakeId 接入记录标识。
 * @returns {Promise<unknown>} 商机接入详情。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function getOpportunityIntake(intakeId) {
  return request(`/opportunity-intakes/${encodeURIComponent(intakeId)}`)
}

/**
 * reviewOpportunityIntake 核对 CRM 已投递签单与既有合同的关联，不创建合同或启动审批。
 * @param {string|number} intakeId 接入记录标识。
 * @param {Record<string, unknown>} payload 核对结论及关联信息；LINK_CONFIRMED 会持久化权威关联。
 * @param {string} idempotencyKey 幂等键，用于避免重复提交核对结论。
 * @returns {Promise<unknown>} 更新后的接入记录。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function reviewOpportunityIntake(intakeId, payload, idempotencyKey) {
  return request(`/opportunity-intakes/${encodeURIComponent(intakeId)}/reviews`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  })
}

/**
 * createContract 创建合同草稿。
 * @param {Record<string, unknown>} payload 合同基础信息及业务关联数据。
 * @returns {Promise<unknown>} 新建合同。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function createContract(payload) {
  return request('/contracts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * listMyOpportunities 使用 CRM 服务端关键字检索和分页获取当前用户可关联的商机。
 * @param {{keyword?: string, page?: number, page_size?: number}} [params={}] 关键字与页码参数；page_size 会限制在 1 至 100。
 * @returns {Promise<{items: Array<unknown>, page: number, page_size: number, total: number, has_more: boolean}>} 规范化后的商机分页结果。
 * @throws {Error} 网络失败、响应解析失败或 CRM 返回非成功状态时抛出。
 */
export async function listMyOpportunities(params = {}) {
  const search = new URLSearchParams({
    keyword: String(params.keyword || '').trim(),
    page: String(Math.max(1, Number(params.page) || 1)),
    page_size: String(Math.min(100, Math.max(1, Number(params.page_size) || 50))),
  })
  const requestContext = {
    subsystem: 'contract_management',
    feature: 'contract_opportunity_intake',
    operation: 'GET',
    path: `/opportunities?${search.toString()}`,
    method: 'GET',
  }
  let response
  try {
    response = await fetch(`${CUSTOMER_API_BASE_URL}/opportunities?${search}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    const requestError = new Error('读取可关联商机失败，请稍后重试。')
    attachStructuredContext(requestError, {
      ...requestContext,
      metadata: { source: 'crm_opportunity_lookup' },
    }, {
      status: 0,
      code: 'NETWORK_ERROR',
      requestId: '',
      traceId: '',
    })
    throw requestError
  }
  const body = await readBody(response)
  if (!response.ok) {
    const error = new Error(userSafeErrorMessage(body?.message) || '读取可关联商机失败，请稍后重试。')
    attachStructuredContext(error, {
      ...requestContext,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
      metadata: { source: 'crm_opportunity_lookup', tenantAware: true },
    }, {
      status: response.status,
      code: body?.code,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
    })
    error.status = response.status
    throw error
  }
  const data = body?.data ?? body
  if (Array.isArray(data)) return { items: data, page: 1, page_size: data.length, total: data.length, has_more: false }
  const items = Array.isArray(data?.items) ? data.items : []
  const page = Number(data?.page || params.page || 1)
  const pageSize = Number(data?.page_size || params.page_size || items.length)
  const total = Number(data?.total ?? items.length)
  return { items, page, page_size: pageSize, total, has_more: page * pageSize < total }
}

/**
 * listContractTemplates 获取可用合同模板列表。
 * @returns {Promise<Array<unknown>>} 合同模板列表；响应异常时返回空列表。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listContractTemplates() {
  const data = await request('/contract-templates')
  return Array.isArray(data) ? data : []
}

/**
 * uploadContractTemplate 上传新的合同模板文件。
 * @param {{name: string, file: File|Blob}} input 模板名称与文件。
 * @returns {Promise<unknown>} 新建模板信息。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function uploadContractTemplate({ name, file }) {
  const form = new FormData()
  form.append('name', name)
  form.append('file', file)
  return request('/contract-templates', {
    method: 'POST',
    body: form,
  })
}

/**
 * updateContractTemplate 更新指定合同模板的元数据或状态。
 * @param {string|number} templateId 模板标识。
 * @param {Record<string, unknown>} payload 模板更新内容。
 * @returns {Promise<unknown>} 更新后的模板信息。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function updateContractTemplate(templateId, payload) {
  return request(`/contract-templates/${encodeURIComponent(templateId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

/**
 * deleteContractTemplate 删除指定合同模板。
 * @param {string|number} templateId 模板标识。
 * @returns {Promise<unknown>} 服务端删除结果。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function deleteContractTemplate(templateId) {
  return request(`/contract-templates/${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
  })
}

/**
 * previewContractTemplate 使用给定变量生成指定模板的预览内容。
 * @param {string|number} templateId 模板标识。
 * @param {Record<string, unknown>} values 模板变量值。
 * @returns {Promise<unknown>} 模板预览结果。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function previewContractTemplate(templateId, values) {
  return request(`/contract-templates/${encodeURIComponent(templateId)}/preview`, {
    method: 'POST',
    body: JSON.stringify({ values }),
  })
}

/**
 * submitContract 将合同提交审批。
 * @param {string|number} contractId 合同标识。
 * @param {Record<string, unknown>} [payload={}] 提交说明及后端要求的版本信息。
 * @returns {Promise<unknown>} 审批提交结果。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function submitContract(contractId, payload = {}) {
  return request(`/contracts/${contractId}/submit-approval`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * getContract 获取指定合同详情。
 * @param {string|number} contractId 合同标识。
 * @returns {Promise<unknown>} 合同详情。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function getContract(contractId) {
  return request(`/contracts/${contractId}`)
}

/**
 * previewContractDocument 获取指定合同当前文档预览。
 * @param {string|number} contractId 合同标识。
 * @returns {Promise<unknown>} 合同文档预览数据。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function previewContractDocument(contractId) {
  return request(`/contracts/${encodeURIComponent(contractId)}/preview`)
}

/**
 * listApprovalTasks 获取当前用户的合同审批任务。
 * @param {Record<string, string|number|boolean>} [params={}] 状态筛选与分页参数。
 * @returns {Promise<Array<unknown>>} 审批任务列表；响应异常时返回空列表。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listApprovalTasks(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/approvals/tasks${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
}

/**
 * listApprovals 获取合同审批实例列表。
 * @param {Record<string, string|number|boolean>} [params={}] 审批筛选与分页参数。
 * @returns {Promise<Array<unknown>>} 审批实例列表；响应异常时返回空列表。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listApprovals(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/approvals${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
}

/**
 * getApproval 获取指定合同审批实例详情。
 * @param {string|number} approvalId 审批实例标识。
 * @returns {Promise<unknown>} 审批详情。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function getApproval(approvalId) {
  return request(`/approvals/${approvalId}`)
}

/**
 * previewApprovalContract 获取审批实例对应的合同文档预览。
 * @param {string|number} approvalId 审批实例标识。
 * @returns {Promise<unknown>} 审批合同预览数据。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function previewApprovalContract(approvalId) {
  return request(`/approvals/${encodeURIComponent(approvalId)}/contract-preview`)
}

/**
 * commandApproval 对指定审批实例执行后端支持的审批动作。
 * @param {string|number} approvalId 审批实例标识。
 * @param {string} action 审批动作路径，如通过、驳回或撤回。
 * @param {Record<string, unknown>} [payload={}] 审批意见及版本信息。
 * @returns {Promise<unknown>} 动作执行后的审批结果。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function commandApproval(approvalId, action, payload = {}) {
  return request(`/approvals/${approvalId}/${action}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * listApprovalRules 获取合同审批规则列表。
 * @returns {Promise<Array<unknown>>} 审批规则列表；响应异常时返回空列表。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listApprovalRules() {
  const data = await request('/approval-rules')
  return Array.isArray(data) ? data : []
}

/**
 * createApprovalRule 创建合同审批规则。
 * @param {Record<string, unknown>} payload 审批条件、步骤与启用状态。
 * @returns {Promise<unknown>} 新建审批规则。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function createApprovalRule(payload) {
  return request('/approval-rules', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * updateApprovalRule 更新指定合同审批规则。
 * @param {string|number} ruleId 审批规则标识。
 * @param {Record<string, unknown>} payload 规则更新内容及后端要求的版本信息。
 * @returns {Promise<unknown>} 更新后的审批规则。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function updateApprovalRule(ruleId, payload) {
  return request(`/approval-rules/${ruleId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

/**
 * deleteApprovalRule 按版本删除指定合同审批规则。
 * @param {string|number} ruleId 审批规则标识。
 * @param {string|number} version 期望版本，用于阻止覆盖并发修改。
 * @returns {Promise<unknown>} 服务端删除结果。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function deleteApprovalRule(ruleId, version) {
  return request(`/approval-rules/${ruleId}?version=${encodeURIComponent(version)}`, {
    method: 'DELETE',
  })
}
