import { normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin } from '../../shared/authz/sessionCompatibility.js'
import { attachStructuredContext } from '../../platform/shared/api/requestContext.js'

const PUBLIC_PATH_PREFIX = (import.meta.env?.VITE_CRM_PUBLIC_PATH_PREFIX || '/customer-opportunity').replace(/\/$/, '')
const API_BASE_URL = (import.meta.env?.VITE_CRM_API_BASE_URL || `${PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')

let loginRedirectStarted = false

/**
 * buildCRMLoginURL 生成 CRM 登录地址，并将当前相对地址编码为登录后的回跳目标。
 * @param {{pathname: string, search: string, hash: string}} [location=window.location] 当前页面地址对象。
 * @returns {string} CRM 同源登录地址。
 */
export function buildCRMLoginURL(location = window.location) {
  const returnTo = `${location.pathname}${location.search}${location.hash}`
  return `${PUBLIC_PATH_PREFIX}/auth/login?return_to=${encodeURIComponent(returnTo)}`
}

/**
 * CRMAPIError 表示 CRM API 调用失败，并保留状态码、业务代码和请求追踪信息。
 * @param {string} message 错误信息。
 * @param {{status?: number, code?: string, requestID?: string, details?: unknown}} [context={}] 后端错误上下文。
 */
export class CRMAPIError extends Error {
  constructor(message, { status = 0, code = '', requestID = '', details = null } = {}) {
    super(message)
    this.name = 'CRMAPIError'
    this.status = status
    this.code = code
    this.requestID = requestID
    this.details = details
  }
}

/**
 * redirectToLogin 在会话失效时发起 CRM 登录；并发失败请求只允许首次跳转生效。
 * @returns {void}
 */
function redirectToLogin() {
  // 多个并发 API 可能同时返回 401，只允许首个请求触发导航，避免重定向风暴。
  if (loginRedirectStarted) return
  loginRedirectStarted = true
  window.location.replace(buildCRMLoginURL())
}

function startForcedCRMLogin() {
  if (loginRedirectStarted) return
  loginRedirectStarted = true
  const target = new URL(buildCRMLoginURL(), window.location.origin)
  target.searchParams.set('prompt', 'login')
  window.location.replace(`${target.pathname}${target.search}`)
}

async function clearCRMLocalSession() {
  try {
    await fetch(`${PUBLIC_PATH_PREFIX}/auth/local-logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch {
    // 强制登录仍会覆盖旧 CRM Cookie；清理失败不应让账号切换卡死。
  }
}

async function getPlatformPrincipalForSessionCheck() {
  const response = await fetch('/api/v1/auth/me', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`platform session check failed: ${response.status}`)
  const body = await response.json()
  return normalizeAuthorizationSession(body?.data ?? body)
}

/**
 * readResponse 按响应媒体类型解析 JSON 或文本响应体。
 * @param {Response} response Fetch 响应。
 * @returns {Promise<unknown>} 已解析数据；无效 JSON 安全降级为空对象。
 */
async function readResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return {}
    }
  }
  const text = await response.text()
  return text ? { message: text } : {}
}

/**
 * createIdempotencyKey 生成写操作幂等键；优先使用浏览器安全随机 UUID。
 * @returns {string} 当前页面进程内新生成的幂等键。
 */
export function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * request 调用 CRM API，统一附加 CSRF、幂等请求头和结构化错误上下文。
 * @param {string} path 相对于 CRM API 根路径的请求地址。
 * @param {RequestInit & {idempotent?: boolean, idempotencyKey?: string}} [options={}] Fetch 配置及幂等选项。
 * @returns {Promise<unknown>} 优先返回响应 data 字段，否则返回完整响应体。
 * @throws {CRMAPIError} 服务端返回非成功状态时抛出；会话失效时同时启动登录跳转。
 * @throws {TypeError} 网络连接或 Fetch 调用失败时抛出。
 */
export async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const requiresCSRF = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  const hasFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData
  const requestContext = {
    subsystem: 'customer_opportunity',
    feature: 'crm_api',
    operation: method,
    path,
    method,
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body && !hasFormDataBody ? { 'Content-Type': 'application/json' } : {}),
      // Cookie 会自动随同源请求发送；写操作必须显式携带 CSRF 标记，后端仍会
      // 结合 Origin/Sec-Fetch-Site 校验，不能把该固定值视为身份凭据。
      ...(requiresCSRF ? { 'X-CSRF-Token': '1' } : {}),
      ...(options.idempotent ? { 'Idempotency-Key': options.idempotencyKey || createIdempotencyKey() } : {}),
      ...(options.headers || {}),
    },
  })
  const body = await readResponse(response)
  if (!response.ok) {
    const error = new CRMAPIError(body?.message || `HTTP ${response.status}`, {
      status: response.status,
      code: body?.code,
      requestID: body?.request_id,
      details: body?.details,
    })
    attachStructuredContext(error, {
      ...requestContext,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
      metadata: { source: 'crm_api' },
    }, {
      status: response.status,
      code: body?.code,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
    })
    if (shouldStartSubsystemLogin(error)) redirectToLogin()
    throw error
  }
  return body?.data ?? body
}

/**
 * requestBlob 下载受会话授权的 CSV，并约束媒体类型与响应文件名。
 * @param {string} path 相对于 CRM API 根路径的下载地址。
 * @returns {Promise<{blob: Blob, filename: string}>} CSV 二进制数据与清理后的文件名。
 * @throws {CRMAPIError} 服务端返回非成功状态，或成功响应的媒体类型不是 CSV 时抛出。
 * @throws {TypeError} 网络连接或 Fetch 调用失败时抛出。
 */
export async function requestBlob(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'text/csv, application/json' },
  })
  if (!response.ok) {
    const body = await readResponse(response)
    const error = new CRMAPIError(body?.message || `HTTP ${response.status}`, {
      status: response.status,
      code: body?.code,
      requestID: body?.request_id,
      details: body?.details,
    })
    attachStructuredContext(error, {
      subsystem: 'customer_opportunity',
      feature: 'crm_export',
      operation: 'GET',
      path,
      method: 'GET',
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
      metadata: { source: 'crm_blob' },
    }, {
      status: response.status,
      code: body?.code,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
    })
    if (shouldStartSubsystemLogin(error)) redirectToLogin()
    throw error
  }
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('text/csv')) {
    const contentTypeError = new CRMAPIError('下载响应不是受支持的 CSV 文件。', { status: response.status, code: 'CRM_DOWNLOAD_CONTENT_TYPE_INVALID' })
    attachStructuredContext(contentTypeError, {
      subsystem: 'customer_opportunity',
      feature: 'crm_export',
      operation: 'GET',
      path,
      method: 'GET',
      metadata: {
        source: 'crm_blob',
        actualContentType: contentType,
      },
    }, {
      status: response.status,
      code: 'CRM_DOWNLOAD_CONTENT_TYPE_INVALID',
    })
    throw contentTypeError
  }
  const disposition = response.headers.get('content-disposition') || ''
  const matched = disposition.match(/filename\*?=(?:UTF-8''|")?([^;"]+)/i)
  let filename = 'customer-import-errors.csv'
  if (matched) {
    try { filename = decodeURIComponent(matched[1].replace(/"/g, '').trim()) }
    // 非法百分号编码不能阻止文件下载，统一回退到受控文件名。
    catch { filename = 'customer-import-errors.csv' }
  }
  // 清除路径分隔符和控制字符，防止服务端文件名影响浏览器保存路径。
  filename = filename.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 160)
  if (!filename || filename === '.' || filename === '..' || filename.startsWith('.') || !filename.toLowerCase().endsWith('.csv')) filename = 'customer-import-errors.csv'
  return { blob: await response.blob(), filename }
}

/**
 * requestAuthorizedFile 下载受会话授权的业务文件，并按调用方白名单校验媒体类型。
 * @param {string} path 相对于 CRM API 根路径的下载地址。
 * @param {Set<string>} allowedMediaTypes 允许的小写 MIME 类型集合。
 * @param {string} [fallbackFilename='download.bin'] 响应未提供安全文件名时使用的回退名称。
 * @returns {Promise<{blob: Blob, filename: string, contentType: string}>} 文件数据、安全文件名和规范化媒体类型。
 * @throws {CRMAPIError} 服务端返回非成功状态，或成功响应的媒体类型不在白名单时抛出。
 * @throws {TypeError} 网络连接或 Fetch 调用失败时抛出。
 */
export async function requestAuthorizedFile(path, allowedMediaTypes, fallbackFilename = 'download.bin') {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include', headers: { Accept: [...allowedMediaTypes, 'application/json'].join(', ') } })
  if (!response.ok) {
    const body = await readResponse(response)
    const error = new CRMAPIError(body?.message || `HTTP ${response.status}`, { status: response.status, code: body?.code, requestID: body?.request_id, details: body?.details })
    attachStructuredContext(error, {
      subsystem: 'customer_opportunity',
      feature: 'crm_export',
      operation: 'GET',
      path,
      method: 'GET',
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
      metadata: { source: 'crm_authorized_file' },
    }, {
      status: response.status,
      code: body?.code,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
    })
    if (shouldStartSubsystemLogin(error)) redirectToLogin()
    throw error
  }
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!allowedMediaTypes.has(contentType)) {
    const downloadTypeError = new CRMAPIError('下载响应的文件类型不受支持。', { status: response.status, code: 'CRM_DOWNLOAD_CONTENT_TYPE_INVALID' })
    attachStructuredContext(downloadTypeError, {
      subsystem: 'customer_opportunity',
      feature: 'crm_export',
      operation: 'GET',
      path,
      method: 'GET',
      metadata: {
        source: 'crm_authorized_file',
        actualContentType: contentType,
      },
    }, {
      status: response.status,
      code: 'CRM_DOWNLOAD_CONTENT_TYPE_INVALID',
    })
    throw downloadTypeError
  }
  const disposition = response.headers.get('content-disposition') || ''
  const matched = disposition.match(/filename\*?=(?:UTF-8''|")?([^;"]+)/i)
  let filename = fallbackFilename
  // Content-Disposition 解码失败时使用调用方提供的受控文件名。
  if (matched) { try { filename = decodeURIComponent(matched[1].replace(/"/g, '').trim()) } catch { filename = fallbackFilename } }
  filename = filename.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 160)
  if (!filename || filename === '.' || filename === '..' || filename.startsWith('.')) filename = fallbackFilename
  return { blob: await response.blob(), filename, contentType }
}

/**
 * toQuery 将非空查询参数编码为带问号的 URL 查询串。
 * @param {Record<string, unknown>} [params={}] 待编码参数；空字符串、null 和 undefined 会被忽略。
 * @returns {string} 查询串；没有有效参数时返回空字符串。
 */
export function toQuery(params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value !== null && value !== undefined) query.set(key, String(value))
  }
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

/**
 * getCRMSession 读取并规范化 CRM 子系统会话；HttpOnly Cookie 始终由浏览器管理。
 * @returns {Promise<Record<string, unknown>>} 规范化后的 CRM 会话。
 * @throws {CRMAPIError} 会话失效或服务端返回非成功状态时抛出。
 * @throws {TypeError} 网络连接失败时抛出。
 */
export async function ensureCRMSession() {
  const crmSession = normalizeAuthorizationSession(await request('/auth/me'))
  try {
    const platformPrincipal = await getPlatformPrincipalForSessionCheck()
    const platformIdentityID = principalIdentityID(platformPrincipal)
    const crmIdentityID = principalIdentityID(crmSession)
    const platformTenantID = String(platformPrincipal?.tenant_id || platformPrincipal?.tenant?.id || '')
    const crmTenantID = String(crmSession?.tenant_id || '')
    if ((platformIdentityID && crmIdentityID && platformIdentityID !== crmIdentityID) || (platformTenantID && crmTenantID && platformTenantID !== crmTenantID)) {
      await clearCRMLocalSession()
      startForcedCRMLogin()
      return null
    }
  } catch {
    // 平台短暂不可用时保留 CRM 自己的有效会话；平台恢复后下一次校验会完成切换。
  }
  return crmSession
}

export const getCRMSession = async () => normalizeAuthorizationSession(await request('/auth/me'))

/**
 * getCRMRuntimeCapabilities 获取非敏感集成就绪状态，仅用于界面能力提示，不作为授权依据。
 * @returns {Promise<unknown>} CRM 运行时能力状态。
 * @throws {CRMAPIError} 会话失效或服务端返回非成功状态时抛出。
 * @throws {TypeError} 网络连接失败时抛出。
 */
export const getCRMRuntimeCapabilities = () => request('/capabilities')
