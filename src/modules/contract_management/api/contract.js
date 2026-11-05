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
import { formatUserError } from '../../shared/utils/userError.js'
import { DOWNLOAD_TIMEOUT_MESSAGE, downloadRequestSignal } from '../../shared/utils/downloadTimeout.js'
import { externalContractMetadata } from '../utils/contractPayload.js'
import { sourceSHA256 } from '../utils/sourceIntegrity.js'

const CONTRACT_PUBLIC_PATH_PREFIX = (import.meta.env.VITE_CONTRACT_PUBLIC_PATH_PREFIX || '/contract_management').replace(/\/$/, '')
const API_BASE_URL = (import.meta.env.VITE_CONTRACT_API_BASE_URL || `${CONTRACT_PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')
// CRM 统一前端与后端都挂载在 /customer-opportunity。旧的 /customer_management
// 从未在生产 Nginx 注册，命中 SPA 回退逻辑 后会以 200 HTML 返回，最终被误判为空客户列表。
const CUSTOMER_API_BASE_URL = (import.meta.env.VITE_CUSTOMER_API_BASE_URL || '/customer-opportunity/api/v1').replace(/\/$/, '')

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
export function startContractLogin({ force = false } = {}) {
  if (loginRedirectStarted) return
  loginRedirectStarted = true
  clearContractSessionCache()
  const prompt = force ? '?prompt=login' : ''
  window.location.replace(`${CONTRACT_PUBLIC_PATH_PREFIX}/auth/login${prompt}`)
}

/**
 * openContractAuthorizationInNewTab 在新标签页建立合同子系统会话，不劫持当前页面。
 * 跨子系统调用方（项目管理的新建项目）读到 401 时使用：401 既可能是"确实没有合同
 * 授权"，也可能是"有授权但还没建立合同会话"，两者无法在本端区分。让用户在新标签页
 * 走一次 SSO 授权：有授权的账号会立即拿到会话，没授权的账号会停在合同系统的无权提示页，
 * 而当前页面始终保持可用。合同登录固定回跳合同首页，因此不做整页跳转。
 * @returns {boolean} 是否成功发起了打开动作（被浏览器拦截时返回 false）。
 */
export function openContractAuthorizationInNewTab() {
  try {
    return Boolean(window.open(`${CONTRACT_PUBLIC_PATH_PREFIX}/auth/login`, '_blank', 'noopener'))
  } catch {
    return false
  }
}

/**
 * readBody 按响应媒体类型解析 JSON 或文本错误体。
 * @param {Response} response Fetch 响应。
 * @returns {Promise<unknown>} JSON 数据，或包装为 message 字段的文本数据。
 * @throws {SyntaxError} 响应声明为 JSON 但内容无法解析时抛出。
 */
async function readBody(response) {
  const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (contentType.endsWith('/json') || contentType.endsWith('+json')) return response.json()
  const text = await response.text()
  return text ? { message: text } : {}
}

// 友好提示与结构化诊断分开保存，业务处理仍可按状态、错误码与字段定位问题。
function contractRequestError(body, response, context, { code, fallback, outcomeUnknown = false } = {}) {
  const status = response?.status || 0
  const requestId = body?.request_id || body?.requestId || response?.headers?.get('x-request-id') || ''
  const traceId = body?.trace_id || body?.traceId || response?.headers?.get('x-trace-id') || ''
  const error = new Error(formatUserError(body, { status, code: code || body?.code, method: context.method, details: body?.details ?? body?.field_errors ?? body?.fieldErrors, fallback }))
  error.status = status
  error.code = code || body?.code || ''
  error.requestID = requestId
  error.details = body?.details ?? null
  error.fieldErrors = body?.field_errors ?? body?.fieldErrors ?? body?.details?.fields ?? null
  if (outcomeUnknown) {
    // 写请求中断不能被当作“未写入”，避免用户重复创建合同或重复发起审批。
    error.outcomeUnknown = true
    error.message = '尚未确认本次操作结果，请先刷新相关列表核对是否已保存，不要重复提交；仍无法确认时请联系管理员。'
  }
  attachStructuredContext(error, {
    ...context, tenantId: String(body?.tenant_id || ''), requestId, traceId,
    metadata: { source: 'contract_api', outcomeUnknown },
  }, { status, code: error.code, requestId, traceId })
  return error
}

/**
 * downloadTimeoutError 把本端下载超时转换为可读的合同错误，并保留既有错误字段结构。
 * @param {unknown} cause 底层中断原因。
 * @param {{feature: string, path: string, code: string}} context 下载请求上下文。
 * @returns {Error} 带下载超时错误码的结构化错误。
 */
function downloadTimeoutError(cause, context) {
  const error = contractRequestError(null, null, { subsystem: 'contract_management', feature: context.feature, operation: 'GET', method: 'GET', path: context.path }, { code: context.code, fallback: DOWNLOAD_TIMEOUT_MESSAGE })
  error.message = DOWNLOAD_TIMEOUT_MESSAGE
  error.cause = cause
  return error
}

/**
 * request 调用合同子系统 API，统一解析响应、补充结构化错误上下文并处理会话失效。
 * @param {string} path 相对于合同 API 根路径的请求地址。
 * @param {RequestInit & {suppressLoginRedirect?: boolean, validateData?: (data: unknown) => boolean}} [options={}] Fetch 配置与内部响应校验。
 * @returns {Promise<unknown>} 通过服务信封及接口资源校验后的 data 字段。
 * @throws {ContractAuthError} 服务端返回 401 时抛出，并在适用时启动子系统登录。
 * @throws {Error} 网络失败、响应解析失败或服务端返回其他非成功状态时抛出。
 */
async function request(path, options = {}) {
  // 跨子系统调用方（例如项目管理页读取已审批合同）可以关闭「401 即跳转子系统登录」：
  // 对没有该应用授权的用户，子系统登录回调本身就会返回 403，跳转只会把用户甩出当前系统。
  const { suppressLoginRedirect = false, validateData, ...fetchOptions } = options
  const method = String(fetchOptions.method || 'GET').toUpperCase()
  const requestContext = {
    subsystem: 'contract_management',
    feature: 'contract',
    operation: method,
    path,
    method,
  }

  const hasFormDataBody = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...fetchOptions,
      headers: {
        Accept: 'application/json',
        ...(fetchOptions.body && !hasFormDataBody ? { 'Content-Type': 'application/json' } : {}),
        ...(fetchOptions.headers || {}),
      },
    })
  } catch {
    throw contractRequestError(null, null, requestContext, {
      code: 'NETWORK_ERROR', fallback: '无法连接合同管理服务，请检查网络后重试。', outcomeUnknown: isMutation,
    })
  }
  let body
  let invalidJSON = false
  try {
    body = await readBody(response)
  } catch {
    body = {}
    invalidJSON = true
  }
  if (response.ok) {
    const mediaType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
    const validJSONType = mediaType.endsWith('/json') || mediaType.endsWith('+json')
    // 网关路由缺失时可能返回 HTTP 200 和 SPA 的 HTML。仅接受
    // 合同服务的响应封装，避免误判写入成功。
    const validEnvelope = body && typeof body === 'object' && !Array.isArray(body)
      && body.code === 'OK' && Object.hasOwn(body, 'data')
      && (body.data === null || typeof body.data === 'object')
    if (!validJSONType || invalidJSON || !validEnvelope || (validateData && !validateData(body.data))) {
      throw contractRequestError(body, response, requestContext, {
        code: 'INVALID_CONTRACT_RESPONSE',
        fallback: '合同服务返回的数据格式异常，请刷新页面；仍无法操作时请联系管理员检查前后端版本。',
        outcomeUnknown: isMutation,
      })
    }
  }
  if (!response.ok) {
    if (response.status === 401) {
      const authError = new ContractAuthError(formatUserError(body, { status: response.status, fallback: '合同系统登录状态已失效，请重新登录。' }), {
        status: response.status,
        code: body?.code,
        requestID: body?.request_id || body?.requestId || response.headers.get('x-request-id') || '',
        details: body?.details,
      })
      authError.fieldErrors = body?.field_errors ?? body?.fieldErrors ?? body?.details?.fields ?? null
      const traceId = body?.trace_id || body?.traceId || response.headers.get('x-trace-id') || ''
      // 只有普通会话失效才重新走登录。Claims/Client 配置错误保留原始分类，
      // 交给统一访问错误页展示，避免形成“登录—回调—再次登录”的循环。
      if (!suppressLoginRedirect && shouldStartSubsystemLogin(authError)) startContractLogin()
      attachStructuredContext(authError, {
        ...requestContext,
        tenantId: String(body?.tenant_id || ''),
        requestId: authError.requestID,
        traceId,
        metadata: { auth: true, source: 'contract_api' },
      }, {
        status: response.status,
        code: body?.code,
        requestId: authError.requestID,
        traceId,
      })
      throw authError
    }
    const error = contractRequestError(body, response, requestContext, {
      fallback: '合同操作未完成，请稍后重试。',
      outcomeUnknown: isMutation && [408, 502, 504].includes(response.status),
    })
    error.message = subsystemAccessMessage(error, error.message)
    throw error
  }
  return body.data
}

function resourceObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function resourceID(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function versionedResource(value) {
  return resourceObject(value) && resourceID(value.id) && Number.isSafeInteger(value.version) && value.version > 0
}

function contractDraftResource(value) {
  return versionedResource(value) && value.status === 'draft'
}

function collectionPage(value) {
  return resourceObject(value) && Object.hasOwn(value, 'items')
    && (value.items === null || Array.isArray(value.items))
}

function contractArray(data) {
  // Go 的 nil 切片会序列化为 null。其他数据形态均视为协议错误，
  // 不能据此认为操作人员没有合同或待办。
  if (data === null) return []
  if (Array.isArray(data)) return data
  throw invalidContractResponse('合同列表返回格式不正确，请刷新后重试。')
}

function contractPage(data) {
  // 滚动发布兼容旧数组；新协议必须带 items 数组，其他形状一律视为协议失败。
  if (Array.isArray(data)) {
    const items = contractArray(data)
    return { items, total: items.length, offset: 0, limit: items.length, has_more: false, stats: null }
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
    throw invalidContractResponse('签署台账返回格式不正确，请刷新后重试。')
  }
  return { ...data, items: contractArray(data.items) }
}

function contractLedgerPage(data) {
  // 合同台账新协议：{ items, total, page, page_size }，total 是服务端计数，不是本页行数。
  // 旧版服务端（滚动发布期间）仍返回裸数组，按“单页、total=已加载条数”降级，
  // 页脚因此不会凭空显示一个假总数。
  if (data === null) return { items: [], total: 0, page: 1, page_size: 0 }
  if (Array.isArray(data)) {
    const items = contractArray(data)
    return { items, total: items.length, page: 1, page_size: items.length }
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
    throw invalidContractResponse('合同台账返回格式不正确，请刷新后重试。')
  }
  const items = contractArray(data.items)
  const total = Number(data.total)
  const page = Number(data.page)
  const pageSize = Number(data.page_size)
  return {
    items,
    total: Number.isFinite(total) && total >= 0 ? total : items.length,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    page_size: Number.isFinite(pageSize) && pageSize >= 1 ? pageSize : items.length,
  }
}

function invalidContractResponse(message) {
  const error = new Error(message)
  error.status = 200
  error.code = 'INVALID_CONTRACT_RESPONSE'
  return error
}

/**
 * getContractSession 读取并规范化合同系统服务端会话；前端缓存仅用于界面与路由判断。
 * @param {{force?: boolean}} [options={}] force 为 true 时忽略已有会话和进行中的请求。
 * @returns {Promise<Record<string, unknown>>} 规范化后的合同会话。
 * @throws {ContractAuthError} 会话失效时抛出。
 * @throws {Error} 网络失败、响应解析失败或服务端拒绝请求时抛出。
 */
export async function getContractSession({ force = false, suppressLoginRedirect = false } = {}) {
  // 非强制读取复用缓存或在途 Promise，避免路由和菜单同时初始化时重复请求。
  if (!force && currentSession) return currentSession
  if (!force && sessionRequest) return sessionRequest

  sessionRequest = request('/auth/me', { suppressLoginRedirect, cache: 'no-store' })
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
    // 子系统 `/auth/me` 与平台 `/auth/me` 互不依赖，串行等待会让进入子系统的
    // 导航多花一个往返。这里并行发起，但两侧失败语义保持原样：
    //   · 平台侧失败仍被吞掉（平台暂时不可用不使合同 OIDC 会话失效）；
    //   · 子系统侧失败仍由外层 shouldStartSubsystemLogin 分支处理。
    const [contractSession, platformResult] = await Promise.all([
      getContractSession({ force: true }),
      getCurrentPrincipal().then(
        (principal) => ({ ok: true, principal }),
        (error) => ({ ok: false, error }),
      ),
    ])
    try {
      if (platformResult.ok) {
        const platformPrincipal = platformResult.principal
        const platformUserID = principalIdentityID(platformPrincipal)
        const platformTenantID = String(platformPrincipal?.tenant_id || platformPrincipal?.tenant?.id || '')
        const contractIdentityID = principalIdentityID(contractSession)
        const userChanged = platformUserID && contractIdentityID && platformUserID !== contractIdentityID
        const tenantChanged = platformTenantID && platformTenantID !== String(contractSession?.tenant_id || '')
        if (userChanged || tenantChanged) {
          await clearContractLocalSession()
          startContractLogin({ force: true })
          return null
        }
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
 * listContracts 按查询条件读取合同台账页。
 * 带 page/page_size 时服务端返回 { items, total, page, page_size }（total 为全量计数）；
 * 不带分页参数时后端保持旧协议返回裸数组，这里统一降级成单页结构。
 * @param {Record<string, string|number|boolean>} [params={}] 台账筛选与分页参数（keyword/status/type/page/page_size）。
 * @returns {Promise<{items: Array<unknown>, total: number, page: number, page_size: number}>} 台账分页结果。
 * @throws {Error} 会话失效、网络失败、服务端拒绝或响应格式异常时抛出。
 */
export async function listContracts(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/contracts${search ? `?${search}` : ''}`)
  return contractLedgerPage(data)
}

export async function listApprovedContracts(params = {}, options = {}) {
  const search = new URLSearchParams({ limit: 200, ...params }).toString()
  const data = await request(`/approved-contracts?${search}`, options)
  return contractArray(data)
}

/**
 * listContractLifecycle 获取指定合同的生命周期事件，兼容旧版空列表并拒绝错误响应形状。
 * @param {string|number} contractId 合同标识。
 * @returns {Promise<Array<unknown>>} 按后端顺序返回的生命周期事件。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listContractLifecycle(contractId) {
  const data = await request(`/contracts/${encodeURIComponent(contractId)}/lifecycle`)
  return contractArray(data)
}

/**
 * listSigningRecords 按查询条件获取合同签署记录。
 * @param {Record<string, string|number|boolean>} [params={}] 签署记录筛选与分页参数。
 * @returns {Promise<Array<unknown>>} 签署记录列表；响应格式异常时抛出错误。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listSigningRecords(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/signing-records${search ? `?${search}` : ''}`)
  // 兼容滚动发布期间的旧数组响应；新协议返回服务端筛选/分页结果与全量统计。
  return contractPage(data)
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

/** 就地请求下载，避免拒绝下载时将用户导航至原始错误响应。 */
export async function downloadContractFile(contractId, format) {
  const contentTypes = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', 'stamped-pdf': 'application/pdf' }
  if (!contentTypes[format]) throw new Error('请选择支持的合同文件格式。')
  const path = `/approved-contracts/${encodeURIComponent(contractId)}/${format}`
  const context = { subsystem: 'contract_management', feature: 'contract_download', operation: 'GET', method: 'GET', path }
  // 合同 DOCX/PDF/盖章 PDF 属于下载类请求：附加超时 signal，避免网络挂起时永久等待。
  const downloadAbort = downloadRequestSignal()
  let response
  try {
    response = await fetch(approvedContractDownloadURL(contractId, format), { credentials: 'include', signal: downloadAbort.signal, headers: { Accept: contentTypes[format] } })
  } catch (cause) {
    if (downloadAbort.timedOut()) throw downloadTimeoutError(cause, { feature: 'contract_download', path, code: 'CONTRACT_DOWNLOAD_TIMEOUT' })
    throw contractRequestError(null, null, context, { code: 'NETWORK_ERROR', fallback: '合同文件下载未完成，请检查网络后重新下载。' })
  }
  if (!response.ok) {
    let body
    try { body = await readBody(response) } catch { /* 保留 HTTP 状态与响应头诊断。 */ }
    const error = contractRequestError(body, response, context, { fallback: '合同文件暂时无法下载，请稍后重试。' })
    if (response.status === 401) {
      const authError = Object.assign(new ContractAuthError(error.message), error)
      if (!authError.code) authError.code = 'CONTRACT_UNAUTHENTICATED'
      if (shouldStartSubsystemLogin(authError)) startContractLogin()
      throw authError
    }
    throw error
  }
  const mediaType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== contentTypes[format]) {
    throw contractRequestError(null, response, context, { code: 'INVALID_DOWNLOAD_RESPONSE', fallback: '合同下载服务返回的文件格式异常，请联系管理员检查下载配置。' })
  }
  let blob
  try { blob = await response.blob() }
  catch (cause) {
    // 超时可能发生在响应体传输阶段，不能降级成普通网络中断。
    if (downloadAbort.timedOut()) throw downloadTimeoutError(cause, { feature: 'contract_download', path, code: 'CONTRACT_DOWNLOAD_TIMEOUT' })
    throw contractRequestError(null, response, context, { code: 'NETWORK_ERROR', fallback: '合同文件传输中断，请检查网络后重新下载。' })
  }
  if (!blob.size) throw contractRequestError(null, response, context, { code: 'INVALID_DOWNLOAD_RESPONSE', fallback: '合同文件为空，请联系管理员核对已保存的合同文件。' })
  const fallback = `合同-${contractId}.${format === 'docx' ? 'docx' : 'pdf'}`
  const disposition = response.headers.get('content-disposition') || ''
  const name = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)/i)
  let filename = fallback
  if (name) {
    try { filename = decodeURIComponent(name[1]).replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim() || fallback }
    catch { /* 非法文件名编码不能阻断已经完成的文件传输。 */ }
  }
  return { blob, filename }
}

/**
 * uploadStampedContractPDF 上传指定合同的盖章 PDF 文件。
 * @param {string|number} contractId 合同标识。
 * @param {File|Blob} file 待上传的 PDF 文件。
 * @returns {Promise<unknown>} 上传后的合同文件信息。
 * @throws {Error} 网络失败、响应解析失败或服务端返回非成功状态时抛出。
 */
export async function uploadStampedContractPDF(contractId, file, { expectedVersion = 0, replacementReason = '' } = {}) {
  const form = new FormData()
  form.append('file', file)
  // 服务端据此拒绝基于旧版本的覆盖；正式更换必须带原因并重新核验。
  form.append('expected_version', String(expectedVersion ?? 0))
  if (replacementReason) form.append('replacement_reason', String(replacementReason))
  const saved = await request(`/approved-contracts/${encodeURIComponent(contractId)}/stamped-pdf`, { method: 'PUT', body: form })
  if (!saved || !Number.isInteger(Number(saved.version)) || Number(saved.version) < 1 || typeof saved.content_sha256 !== 'string' || !saved.content_sha256) {
    throw new Error('盖章文件保存回执不完整，请刷新后重新核验')
  }
  return saved
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
    data = await request(`/opportunity-intakes${search ? `?${search}` : ''}`, {
      validateData: (value) => Array.isArray(value) || collectionPage(value),
    })
  } catch (error) {
    // 滚动发布期间兼容旧后端：旧版本只接受 limit 并返回数组。仅首页可降级，
    // 因为旧协议没有游标语义；继续翻页若降级会重复或遗漏记录，因此失败关闭。
    const canUseLegacyList = error?.status === 422 && error?.code === 'CON_VALIDATION_ERROR'
      && !params.cursor && Object.hasOwn(params, 'page_size')
    if (!canUseLegacyList) throw error
    const legacyParams = new URLSearchParams()
    if (params.status) legacyParams.set('status', params.status)
    legacyParams.set('limit', String(params.page_size))
    data = await request(`/opportunity-intakes?${legacyParams}`, {
      validateData: (value) => Array.isArray(value) || collectionPage(value),
    })
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
    validateData: contractDraftResource,
  })
}

/**
 * createExternalContract 上传未签署 DOCX 并使用既有合同字段创建草稿。
 * 浏览器不能手工设置 multipart Content-Type，否则会丢失 boundary。
 * @param {File} file 外部合同 DOCX。
 * @param {Record<string, unknown>} metadata 合同与服务项结构化字段。
 * @returns {Promise<unknown>} 新建合同。
 */
export async function createExternalContract(file, metadata) {
  const form = new FormData()
  form.set('file', file)
  form.set('metadata', JSON.stringify(externalContractMetadata(metadata)))
  return request('/contracts/external', { method: 'POST', body: form, validateData: contractDraftResource })
}

async function requestBusinessDirectory(baseURL, path, fallbackMessage, source, { validateData, requireEnvelope = false } = {}) {
  let response
  try {
    response = await fetch(`${baseURL}${path}`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    const requestError = new Error(fallbackMessage)
    attachStructuredContext(requestError, {
      subsystem: 'contract_management', feature: 'contract_directory', operation: 'GET', path, method: 'GET',
      metadata: { source, network: true },
    }, { status: 0, code: 'NETWORK_ERROR', requestId: '', traceId: '' })
    throw requestError
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  const mediaType = contentType.split(';', 1)[0].trim()
  const isJSON = mediaType.endsWith('/json') || mediaType.endsWith('+json')
  let body
  let invalidJSON = false
  try {
    body = await readBody(response)
  } catch {
    body = {}
    invalidJSON = true
  }
  // 同源网关会将未知前端路径回退到 index.html 并返回 200。目录请求必须失败关闭，
  // 否则 HTML 会被规范化为空数组，让用户误以为权限范围内没有业务数据。
  const data = body?.data ?? body
  const validCollection = (validateData ? validateData(data) : Array.isArray(data) || collectionPage(data))
    && (!requireEnvelope || (body?.code === 'OK' && Object.hasOwn(body, 'data')))
  if (!response.ok || !isJSON || invalidJSON || !validCollection) {
    const diagnosticBody = response.ok ? { request_id: body?.request_id, trace_id: body?.trace_id || body?.traceId } : body
    const error = contractRequestError(diagnosticBody, response, {
      subsystem: 'contract_management', feature: 'contract_directory', operation: 'GET', path, method: 'GET',
    }, { code: response.ok ? 'INVALID_DIRECTORY_RESPONSE' : body?.code, fallback: fallbackMessage })
    if (response.status === 401) {
      error.message = 'CRM 登录状态未建立或已失效，请点击“连接 CRM”在新标签页完成登录，再返回重试搜索。当前合同表单会保留。'
      error.crmLoginRequired = true
    }
    attachStructuredContext(error, {
      subsystem: 'contract_management', feature: 'contract_directory', operation: 'GET', path, method: 'GET',
      requestId: body?.request_id || '', traceId: body?.trace_id || body?.traceId || '', metadata: {
        source,
        invalidContentType: response.ok && !isJSON,
        invalidJSON: response.ok && invalidJSON,
        invalidShape: response.ok && !validCollection,
      },
    }, {
      status: response.status, code: error.code, requestId: body?.request_id || '', traceId: body?.trace_id || body?.traceId || '',
    })
    throw error
  }
  return data
}

/** 每次目录检索和提交前核对真实身份，不能把旧 CRM Cookie 当作合同当前账号。 */
export async function ensureContractCRMDirectorySession() {
  const contractSession = await getContractSession({ force: true, suppressLoginRedirect: true })
  const crmSession = await requestBusinessDirectory(CUSTOMER_API_BASE_URL, '/auth/me', '无法核对 CRM 登录状态，请稍后重试。', 'crm_session_check', {
    requireEnvelope: true,
    validateData: (data) => resourceObject(data) && resourceID(data.user_id) && resourceID(data.tenant_id),
  })
  const contractIdentity = principalIdentityID(contractSession)
  if (!contractIdentity || !resourceID(contractSession.tenant_id)) {
    const error = new Error('无法核对合同当前账号，请确认合同登录状态后重试。当前合同表单会保留。')
    error.code = 'CONTRACT_IDENTITY_UNVERIFIED'
    throw error
  }
  if (contractIdentity !== principalIdentityID(crmSession) || contractSession.tenant_id !== crmSession.tenant_id) {
    throw crmIdentityMismatchError()
  }
}

/**
 * crmIdentityMismatchError 构造“CRM 会话与合同账号不一致”的强制重新登录错误。
 * @returns {Error} 带 crmLoginRequired/crmForceLogin 标记的错误。
 */
function crmIdentityMismatchError() {
  const error = new Error('CRM 当前账号或租户与合同不一致，请点击“连接 CRM”使用合同当前账号重新登录，再返回重试搜索。当前合同表单会保留。')
  error.code = 'CRM_IDENTITY_MISMATCH'
  error.status = 409
  error.crmLoginRequired = true
  error.crmForceLogin = true
  return error
}

/**
 * contractCRMLoginPath 计算 CRM 同源登录入口；自定义挂载前缀时仍以 /api/v1 反推。
 * @param {{force?: boolean, returnTo?: string}} [options={}] force 强制重新登录；returnTo 登录完成落地页。
 * @returns {string} 同源站内登录路径；挂载前缀不安全时返回空字符串。
 */
function contractCRMLoginPath({ force = false, returnTo = '' } = {}) {
  const base = new URL(CUSTOMER_API_BASE_URL, window.location.origin)
  if (base.origin !== window.location.origin || !base.pathname.endsWith('/api/v1') || base.search || base.hash) return ''
  const query = new URLSearchParams()
  if (force) query.set('prompt', 'login')
  if (returnTo) query.set('return_to', returnTo)
  const search = query.toString()
  return `${base.pathname.slice(0, -'/api/v1'.length)}/auth/login${search ? `?${search}` : ''}`
}

/**
 * openContractCRMLogin 必须在用户点击事件内同步调用；先断开 opener，再进入正规同源 SSO。
 * 登录完成后由 CRM 自关闭落地页收起辅助标签页，合同页通过轮询自动继续。
 * @param {{force?: boolean}} [options={}] force 为 true 时要求 CRM 强制重新登录。
 * @returns {boolean} 是否成功发起打开动作（被浏览器拦截时返回 false）。
 */
export function openContractCRMLogin({ force = false } = {}) {
  let tab
  try {
    const path = contractCRMLoginPath({ force, returnTo: contractCRMLoginReturnPath() })
    if (!path) return false
    // 直接用 noopener 打开会令成功打开也返回 null，无法准确判断弹窗拦截。
    tab = window.open('about:blank', '_blank')
    if (!tab) return false
    tab.opener = null
    tab.location.replace(path)
    return true
  } catch {
    try { tab?.close() } catch { /* 关闭失败仍按无法发起登录报告。 */ }
    return false
  }
}

/**
 * contractCRMLoginReturnPath 返回 CRM 登录完成后的自关闭落地页，避免辅助标签页残留。
 * @returns {string} 与 CRM 挂载前缀一致的站内路径。
 */
function contractCRMLoginReturnPath() {
  const base = new URL(CUSTOMER_API_BASE_URL, window.location.origin)
  if (base.origin !== window.location.origin || !base.pathname.endsWith('/api/v1')) return ''
  return `${base.pathname.slice(0, -'/api/v1'.length)}/tab-close`
}

/**
 * waitForContractCRMDirectorySession 轮询 CRM 会话，直到用户完成登录或超时/取消。
 * 只在持有有效合同会话时调用；401 继续等待，身份或租户不一致立即失败关闭。
 * @param {{timeoutMs?: number, intervalMs?: number, isCancelled?: () => boolean}} [options={}]
 * @returns {Promise<boolean>} 登录完成返回 true；取消或超时返回 false。
 * @throws {Error} 合同身份无法核对、CRM 账号不一致或非登录类错误时抛出。
 */
export async function waitForContractCRMDirectorySession({ timeoutMs = 120000, intervalMs = 1000, isCancelled = () => false } = {}) {
  const contractSession = await getContractSession({ force: true, suppressLoginRedirect: true })
  const contractIdentity = principalIdentityID(contractSession)
  if (!contractIdentity || !resourceID(contractSession.tenant_id)) {
    const error = new Error('无法核对合同当前账号，请确认合同登录状态后重试。当前合同表单会保留。')
    error.code = 'CONTRACT_IDENTITY_UNVERIFIED'
    throw error
  }
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0)
  const wait = Math.max(100, Number(intervalMs) || 1000)
  for (;;) {
    if (isCancelled()) return false
    try {
      const crmSession = await requestBusinessDirectory(CUSTOMER_API_BASE_URL, '/auth/me', '无法核对 CRM 登录状态，请稍后重试。', 'crm_session_check', {
        requireEnvelope: true,
        validateData: (data) => resourceObject(data) && resourceID(data.user_id) && resourceID(data.tenant_id),
      })
      if (contractIdentity !== principalIdentityID(crmSession) || contractSession.tenant_id !== crmSession.tenant_id) {
        throw crmIdentityMismatchError()
      }
      return true
    } catch (error) {
      if (!error?.crmLoginRequired) throw error
      // 账号/租户不一致不会因继续等待而恢复，必须让用户用合同当前账号强制重登。
      if (error.crmForceLogin) throw error
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, remaining)))
  }
}

/**
 * recordContractSessionActivity 上报一次真实用户操作，用于滑动合同子系统会话空闲窗口。
 * 只有鼠标/键盘/滚动/触摸事件会触发；业务请求与后台轮询不得调用。
 * @returns {Promise<Record<string, unknown>>} 服务端权威空闲窗口。
 * @throws {Error} 会话失效或服务端拒绝时抛出。
 */
export async function recordContractSessionActivity() {
  return request('/auth/activity', {
    method: 'POST',
    suppressLoginRedirect: true,
    headers: { Accept: 'application/json', 'X-CSRF-Token': '1' },
  })
}

/** 读取当前账号数据范围内的有效 CRM 客户，作为合同客户权威选择项。 */
export async function listMyCustomers(params = {}) {
  const search = new URLSearchParams({
    keyword: String(params.keyword || '').trim(),
    status: 'ACTIVE',
    page: String(Math.max(1, Number(params.page) || 1)),
    page_size: String(Math.min(100, Math.max(1, Number(params.page_size) || 50))),
    sort_by: 'name',
    sort_order: 'asc',
  })
  const data = await requestBusinessDirectory(CUSTOMER_API_BASE_URL, `/customers?${search}`, '读取可关联客户失败，请稍后重试。', 'crm_customer_lookup')
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
  const page = Number(data?.page || params.page || 1)
  const pageSize = Number(data?.page_size || params.page_size || items.length || 50)
  const total = Number(data?.total ?? items.length)
  return { items, page, page_size: pageSize, total, has_more: page * pageSize < total }
}

/** 读取项目管理当前启用的检测类别目录，合同表单不得保存自由文本类别。 */
export async function listContractDetectionCategories() {
  // 合同后端使用机器身份读取项目管理目录；浏览器只访问合同同源接口，避免要求
  // 合同专员同时持有项目管理的浏览器会话或 project.read 权限。
  const data = await request('/detection-categories', { validateData: collectionPage })
  const items = Array.isArray(data?.items) ? data.items : []
  return items.filter((item) => item?.enabled !== false && String(item?.category || '').trim())
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
  const data = await requestBusinessDirectory(
    CUSTOMER_API_BASE_URL,
    `/opportunities?${search}`,
    '读取可关联商机失败，请稍后重试。',
    'crm_opportunity_lookup',
  )
  if (Array.isArray(data)) return { items: data, page: 1, page_size: data.length, total: data.length, has_more: false }
  const items = Array.isArray(data?.items) ? data.items : []
  const page = Number(data?.page || params.page || 1)
  const pageSize = Number(data?.page_size || params.page_size || items.length)
  const total = Number(data?.total ?? items.length)
  return { items, page, page_size: pageSize, total, has_more: page * pageSize < total }
}

/**
 * listContractTemplates 获取可用合同模板列表。
 * @returns {Promise<Array<unknown>>} 合同模板列表；响应格式异常时抛出错误。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listContractTemplates() {
  const data = await request('/contract-templates')
  return contractArray(data)
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

// 替换源文件，但不改变模板标识或已保存的合同。
export async function replaceContractTemplateSource(templateId, file) {
  const form = new FormData()
  form.append('file', file)
  return request(`/contract-templates/${encodeURIComponent(templateId)}/source`, {
    method: 'PUT',
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

// 系统级合同编号规则的响应校验：缺字段或枚举越界一律视为协议错误，
// 不能把不完整的规则当成“未配置”继续展示或保存。
const CONTRACT_NUMBER_YEAR_SEGMENT_VALUES = ['NONE', 'YY', 'YYYY']

function contractNumberRuleResource(value) {
  return resourceObject(value)
    && typeof value.prefix === 'string'
    && CONTRACT_NUMBER_YEAR_SEGMENT_VALUES.includes(value.year_segment)
    && Number.isSafeInteger(value.seq_width) && value.seq_width >= 1 && value.seq_width <= 9
    && typeof value.suffix === 'string'
    && typeof value.sample === 'string'
}

/**
 * getContractNumberRule 读取系统级合同编号规则，包含后端给出的下一号示例与年度流水用量。
 * @returns {Promise<Record<string, unknown>>} 编号规则；响应结构不符时抛错。
 * @throws {Error} 会话失效、网络失败、服务端返回非成功状态或响应结构异常时抛出。
 */
export async function getContractNumberRule() {
  return request('/contract-number-rule', { validateData: contractNumberRuleResource })
}

/**
 * updateContractNumberRule 全量保存系统级合同编号规则，只提交四个可编辑字段。
 * @param {{prefix: string, year_segment: string, seq_width: number, suffix: string}} payload 编号规则。
 * @returns {Promise<Record<string, unknown>>} 保存后的编号规则。
 * @throws {Error} 网络失败、校验失败（422）、响应结构异常或服务端拒绝请求时抛出。
 */
export async function updateContractNumberRule(payload) {
  return request('/contract-number-rule', {
    method: 'PUT',
    body: JSON.stringify(payload || {}),
    validateData: contractNumberRuleResource,
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
    validateData: (data) => resourceObject(data) && resourceID(data.approval_id),
  })
}

export async function getContract(contractId) {
  return request(`/contracts/${encodeURIComponent(contractId)}`)
}

export async function updateContractDraft(contractId, payload) {
  return request(`/contracts/${encodeURIComponent(contractId)}/draft`, {
    method: 'PUT',
    body: JSON.stringify(payload),
    validateData: (data) => contractDraftResource(data) && data.id === contractId
      && Number.isSafeInteger(payload?.expected_version) && payload.expected_version > 0 && data.version > payload.expected_version,
  })
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
 * getContractSourceCapabilities 获取当前服务端开放的原件接入能力。
 * 参数：无；使用当前合同会话。
 * 返回值：经契约校验的能力及体积限制；不可用时抛出错误，不默认开启PDF。
 */
export async function getContractSourceCapabilities() {
  return request('/contract-source-capabilities', { validateData: (data) => data &&
    (data.counterparty_source === undefined || ['crm', 'local'].includes(data.counterparty_source)) &&
    (data.category_source === undefined || ['project', 'local'].includes(data.category_source)) &&
    (data.local_catalog_manage === undefined || typeof data.local_catalog_manage === 'boolean') &&
    typeof data.pdf_enabled === 'boolean' && data.max_docx_bytes === 10 * 1024 * 1024 &&
    data.max_pdf_bytes === 20 * 1024 * 1024 })
}

/**
 * contractImportRequest 调用受控批次操作并保留未知写入结果语义。
 * 参数：action为固定操作，id为批次ID，payload为DTO或FormData，key为提交幂等键。
 * 返回值：服务器权威台账或结构化错误。
 */
export async function contractImportRequest(action, id = '', payload, key = '') {
  const methods = { create: 'POST', get: 'GET', files: 'POST', manifest: 'PUT', preview: 'POST', commit: 'POST', pause: 'POST', resume: 'POST', 'submit-confirmation': 'POST', 'confirmation-actions': 'POST' }
  if (!methods[action] || (action !== 'create' && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))) throw new Error('批次操作或编号不合法。')
  const suffix = action === 'create' ? '' : `/${id}${action === 'get' ? '' : `/${action}`}`
  const options = { method: methods[action], headers: key ? { 'Idempotency-Key': key } : {} }
  if (payload !== undefined) options.body = payload instanceof FormData ? payload : JSON.stringify(payload)
  return request(`/contract-import-batches${suffix}`, options)
}

/**
 * listContractImportBatches 查询本人批次及当前真正受派的历史确认任务。
 * 参数：offset为有界列表的偏移。
 * 返回值：服务器按当前权限过滤的台账页。
 */
export function listContractImportBatches(offset = 0) {
  return request(`/contract-import-batches?limit=50&offset=${Math.max(0, Number(offset) || 0)}`)
}

/**
 * releaseContractImportItem 申请独立目标放行，不从浏览器自报审批或财务核对结果。
 * 参数：itemID为单项ID，payload为目标、服务端读取版本及明确阶段。
 * 返回值：真实目标状态；受理不代表业务完成。
 */
export function releaseContractImportItem(itemID, payload) {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(itemID) || !['PROJECT', 'FINANCE', 'REPORT'].includes(payload?.target)) throw new Error('导入单项或放行目标不合法。')
  return request(`/contract-import-items/${itemID}/release`, { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * importItemSourceURL 生成只允许当前应用批次原件的受控下载地址。
 * 参数：batchID及itemID为服务器分配的不透明身份。
 * 返回值：同源下载URL；无效身份失败关闭。
 */
export function importItemSourceURL(batchID, itemID) {
  if (![batchID, itemID].every(id => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))) throw new Error('批次原件标识不合法。')
  return `${API_BASE_URL}/contract-import-batches/${batchID}/items/${itemID}/source`
}

/**
 * getImportItemDocumentDescriptor 读取当前受派权限下的冻结原件描述。
 * 参数：batchID及itemID为已授权批次及单项。
 * 返回值：不含文件字节的描述；后端同时执行持久访问审计。
 */
export function getImportItemDocumentDescriptor(batchID, itemID) {
  importItemSourceURL(batchID, itemID)
  return request(`/contract-import-batches/${batchID}/items/${itemID}/document-descriptor`)
}

/**
 * fetchContractPDFSource 获取受鉴权及审计保护的当前PDF或审批原件。
 * 参数：sourcePath仅允许本应用原件路径，options提供取消信号及可选权威哈希。
 * 返回值：非空PDF Blob；路径、鉴权、内容类型、传输或哈希异常时抛出错误。
 */
export async function fetchContractPDFSource(sourcePath, { signal, expectedSHA256 } = {}) {
  if (!/^\/(?:contracts\/[A-Za-z0-9_-]{1,128}\/source|approvals\/[A-Za-z0-9_-]{1,128}\/contract-source|contract-import-batches\/[A-Za-z0-9_-]{1,128}\/items\/[A-Za-z0-9_-]{1,128}\/source)$/.test(sourcePath || '')) {
    throw new Error('合同原件地址不符合受控路径要求。')
  }
  const context = { subsystem: 'contract_management', feature: 'contract_source', method: 'GET', path: sourcePath }
  // 预览可传入调用方取消信号（切换原件时中止旧请求）；与下载超时合并，取消语义保持不变。
  const downloadAbort = downloadRequestSignal(signal)
  let response
  try { response = await fetch(`${API_BASE_URL}${sourcePath}`, { credentials: 'include', signal: downloadAbort.signal, headers: { Accept: 'application/pdf' } }) }
  catch (error) {
    if (downloadAbort.cancelled()) throw error
    if (downloadAbort.timedOut()) throw downloadTimeoutError(error, { feature: 'contract_source', path: sourcePath, code: 'CONTRACT_SOURCE_TIMEOUT' })
    throw contractRequestError(null, null, context, { code: 'NETWORK_ERROR', fallback: 'PDF 原件读取中断，请重试。' })
  }
  if (!response.ok) {
    let body
    try { body = await readBody(response) } catch { /* 保留状态和请求追踪信息。 */ }
    throw contractRequestError(body, response, context, { fallback: 'PDF 原件暂时无法读取，请核对会话和权限。' })
  }
  const media = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (media !== 'application/pdf' || Number(response.headers.get('content-length')) > 20 * 1024 * 1024) {
    throw new Error('PDF 原件响应格式或大小异常。')
  }
  let blob
  try { blob = await response.blob() }
  catch (cause) {
    if (downloadAbort.cancelled()) throw cause
    if (downloadAbort.timedOut()) throw downloadTimeoutError(cause, { feature: 'contract_source', path: sourcePath, code: 'CONTRACT_SOURCE_TIMEOUT' })
    throw cause
  }
  if (!blob.size || blob.size > 20 * 1024 * 1024 || await blob.slice(0, 5).text() !== '%PDF-') {
    throw new Error('PDF 原件内容格式或大小异常。')
  }
  if (expectedSHA256) {
    if (!/^[a-f0-9]{64}$/.test(expectedSHA256)) throw new Error('PDF 原件完整性校验不可用。')
    const actual = await sourceSHA256(blob)
    if (actual !== expectedSHA256) throw new Error('PDF 原件校验不一致，请重新读取合同。')
  }
  return blob
}

/**
 * listApprovalTasks 获取当前用户的合同审批任务。
 * @param {Record<string, string|number|boolean>} [params={}] 状态筛选与分页参数。
 * @returns {Promise<Array<unknown>>} 审批任务列表；响应格式异常时抛出错误。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listApprovalTasks(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/approvals/tasks${search ? `?${search}` : ''}`)
  return contractArray(data)
}

/**
 * listApprovals 获取合同审批实例列表。
 * @param {Record<string, string|number|boolean>} [params={}] 审批筛选与分页参数。
 * @returns {Promise<Array<unknown>>} 审批实例列表；响应格式异常时抛出错误。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listApprovals(params = {}) {
  const search = new URLSearchParams(params).toString()
  const data = await request(`/approvals${search ? `?${search}` : ''}`)
  return contractArray(data)
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
 * recoverApproval 在审批工作流已停止但数据库仍为 running 时，按持久化运行状态
 * 调用幂等收口；工作流仍在运行时服务端会拒绝。
 */
export function recoverApproval(approvalId) {
  return request(`/approvals/${encodeURIComponent(approvalId)}/recover`, { method: 'POST', body: JSON.stringify({}) })
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
    validateData: (data) => resourceObject(data) && data.status === 'accepted' && resourceID(data.command_id),
  })
}

/**
 * listApprovalRules 获取合同审批规则列表。
 * @returns {Promise<Array<unknown>>} 审批规则列表；响应格式异常时抛出错误。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export async function listApprovalRules() {
  const data = await request('/approval-rules')
  return contractArray(data)
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
    validateData: versionedResource,
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
    validateData: (data) => versionedResource(data) && data.id === ruleId
      && Number.isSafeInteger(payload?.version) && payload.version > 0 && data.version > payload.version,
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

// 集成死信（Outbox）运维：四类出站边只允许使用后端受管枚举，
// 浏览器不拼接表名，也不把未知 kind 发送到服务端。
const INTEGRATION_OUTBOX_KINDS = ['financial', 'responsibility', 'project', 'link']

function integrationOutboxKind(kind) {
  if (!INTEGRATION_OUTBOX_KINDS.includes(kind)) throw new Error('集成死信类型不合法。')
  return kind
}

// 死信条目必须字段完整：缺字段时失败关闭，无法确认的列表不能当作“暂无死信”。
function integrationOutboxItemResource(value) {
  return resourceObject(value)
    && resourceID(value.id)
    && INTEGRATION_OUTBOX_KINDS.includes(value.kind)
    && resourceID(value.event)
    && typeof value.aggregate_id === 'string'
    && Number.isSafeInteger(value.attempts) && value.attempts >= 0
    && typeof value.last_error === 'string'
    && resourceID(value.created_at)
    && resourceID(value.updated_at)
}

/**
 * listFailedIntegrationOutboxEvents 读取指定队列当前处于 dead 状态的事件。
 * @param {string} kind 受管队列：financial、responsibility、project 或 link。
 * @param {{limit?: number}} [options={}] limit 为服务端上限内的读取条数。
 * @returns {Promise<Array<unknown>>} 死信列表；响应结构不符时抛错。
 * @throws {Error} 会话失效、网络失败、服务端拒绝或响应结构异常时抛出。
 */
export async function listFailedIntegrationOutboxEvents(kind, { limit = 100 } = {}) {
  const queue = integrationOutboxKind(kind)
  const size = Math.min(200, Math.max(1, Number(limit) || 100))
  const search = new URLSearchParams({ kind: queue, limit: String(size) }).toString()
  const data = await request(`/integration-outbox/failed?${search}`, {
    validateData: (value) => collectionPage(value) && Array.isArray(value.items)
      && value.items.every(integrationOutboxItemResource),
  })
  return data.items
}

/**
 * retryFailedIntegrationOutboxEvent 把一条 dead 事件重置为待投递；是否送达仍由后台投递决定。
 * @param {string} kind 受管队列。
 * @param {string|number} id 死信事件标识。
 * @returns {Promise<Record<string, unknown>>} 服务端重置回执；结构不符时抛错。
 * @throws {Error} 参数不合法、会话失效、网络失败、服务端拒绝或响应结构异常时抛出。
 */
export async function retryFailedIntegrationOutboxEvent(kind, id) {
  const queue = integrationOutboxKind(kind)
  const eventID = String(id ?? '').trim()
  if (!resourceID(eventID) || eventID.length > 64) throw new Error('集成死信标识不合法，无法重试。')
  return request(`/integration-outbox/failed/${queue}/${encodeURIComponent(eventID)}/retry`, {
    method: 'POST',
    validateData: (data) => resourceObject(data) && data.id === eventID
      && data.kind === queue && data.status === 'retry',
  })
}

// 用途：读取当前真实范围内的本地交易对方，失败不伪装空目录。
// 参数：params为关键词及有界数量。
// 返回值：经ID、名称、状态和版本校验的目录，错误保留原分类。
export function listLocalContractCounterparties(params = {}) {
  const search = new URLSearchParams({ keyword: params.keyword || '', limit: String(params.limit || 200) })
  return request(`/local-catalog/counterparties?${search}`, { validateData: data => Array.isArray(data) && data.every(item => versionedResource(item) && typeof item.name === 'string' && typeof item.enabled === 'boolean') })
}

// 用途：保存或停用本地交易对方，仅提交名称、启用状态与已读版本。
// 参数：id为空创建，否则更新；payload为白名单目录信息。
// 返回值：权威新版本；失败不自动重试写入。
export function saveLocalContractCounterparty(id, payload) {
  return request(`/local-catalog/counterparties${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify({ name: payload.name, enabled: payload.enabled, expected_version: payload.expected_version || 0 }), validateData: versionedResource })
}

// 用途：读取真实范围内的本地类别，保留稳定编码和版本。
// 参数：params为关键词及有界数量。
// 返回值：经协议校验的目录；错误不转为空数组。
export function listLocalContractCategories(params = {}) {
  const search = new URLSearchParams({ keyword: params.keyword || '', limit: String(params.limit || 200) })
  return request(`/local-catalog/categories?${search}`, { validateData: data => Array.isArray(data) && data.every(item => versionedResource(item) && typeof item.code === 'string' && typeof item.name === 'string' && typeof item.enabled === 'boolean') })
}

// 用途：保存或停用本地类别，既有稳定编码不能替换。
// 参数：id为空创建，否则更新；payload为编码、名称、启用和已读版本。
// 返回值：权威新版本；失败不推断已保存。
export function saveLocalContractCategory(id, payload) {
  return request(`/local-catalog/categories${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify({ code: payload.code, name: payload.name, enabled: payload.enabled, expected_version: payload.expected_version || 0 }), validateData: versionedResource })
}

// 用途：读取同租户当前有效销售及其组织作为显式授权候选。
// 参数：无。
// 返回值：权威USER/ORG候选，失败保留目录错误。
export function listLocalCatalogGrantTargets() {
  return request('/local-catalog/grant-targets', { validateData: data => Array.isArray(data) && data.every(item => ['USER','ORG'].includes(item.subject_type) && typeof item.subject_id === 'string' && !!item.subject_id && typeof item.name === 'string') })
}

// 用途：读取可管理条目的授权及撤销历史。
// 参数：kind为固定目录种类，id为真实目录条目。
// 返回值：带版本的授权列表，不把目录失败当作空授权。
export function listLocalCatalogGrants(kind, id) {
  if (!['counterparties','categories'].includes(kind) || !id) throw new Error('目录条目不合法')
  return request(`/local-catalog/${kind}/${encodeURIComponent(id)}/grants`, { validateData: data => Array.isArray(data) && data.every(item => ['USER','ORG'].includes(item.subject_type) && typeof item.subject_id === 'string' && Number.isSafeInteger(item.version) && item.version > 0 && typeof item.enabled === 'boolean') })
}

// 用途：按稳定目标和CAS版本授权或撤销目录可见性，不提交客户端租户或归属。
// 参数：kind/id为真实目录条目，input为平台候选目标、显式启停和预期版本。
// 返回值：真实授权新版本或服务端范围/版本错误，不自动重试写入。
export function saveLocalCatalogGrant(kind, id, input) {
  if (!['counterparties','categories'].includes(kind) || !id) throw new Error('目录条目不合法')
  return request(`/local-catalog/${kind}/${encodeURIComponent(id)}/grants`, { method: 'POST', body: JSON.stringify({ subject_type: input.subject_type, subject_id: input.subject_id, enabled: input.enabled, expected_version: input.expected_version }), validateData: data => Number.isSafeInteger(data?.version) && data.version > 0 && typeof data.enabled === 'boolean' })
}
