import { normalizeAuthorizationSession, shouldStartSubsystemLogin } from '../../shared/authz/sessionCompatibility.js'

const PUBLIC_PATH_PREFIX = (import.meta.env?.VITE_CRM_PUBLIC_PATH_PREFIX || '/customer-opportunity').replace(/\/$/, '')
const API_BASE_URL = (import.meta.env?.VITE_CRM_API_BASE_URL || `${PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')

let loginRedirectStarted = false

export function buildCRMLoginURL(location = window.location) {
  const returnTo = `${location.pathname}${location.search}${location.hash}`
  return `${PUBLIC_PATH_PREFIX}/auth/login?return_to=${encodeURIComponent(returnTo)}`
}

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

function redirectToLogin() {
  // 多个并发 API 可能同时返回 401，只允许首个请求触发导航，避免重定向风暴。
  if (loginRedirectStarted) return
  loginRedirectStarted = true
  window.location.replace(buildCRMLoginURL())
}

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

export function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const requiresCSRF = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  const hasFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData
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
    if (shouldStartSubsystemLogin(error)) redirectToLogin()
    throw error
  }
  return body?.data ?? body
}

/**
 * 下载受会话授权的 CSV，不把内容写入浏览器存储；同时对白名单媒体类型和
 * Content-Disposition 文件名做约束，避免错误页被当文件保存及路径字符注入。
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
    if (shouldStartSubsystemLogin(error)) redirectToLogin()
    throw error
  }
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('text/csv')) {
    throw new CRMAPIError('下载响应不是受支持的 CSV 文件。', { status: response.status, code: 'CRM_DOWNLOAD_CONTENT_TYPE_INVALID' })
  }
  const disposition = response.headers.get('content-disposition') || ''
  const matched = disposition.match(/filename\*?=(?:UTF-8''|")?([^;"]+)/i)
  let filename = 'customer-import-errors.csv'
  if (matched) {
    try { filename = decodeURIComponent(matched[1].replace(/"/g, '').trim()) }
    catch { filename = 'customer-import-errors.csv' }
  }
  filename = filename.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 160)
  if (!filename || filename === '.' || filename === '..' || filename.startsWith('.') || !filename.toLowerCase().endsWith('.csv')) filename = 'customer-import-errors.csv'
  return { blob: await response.blob(), filename }
}

/**
 * 下载服务端授权的业务文件。调用方必须给出 MIME 白名单，响应文件名还要剔除
 * 路径与控制字符；服务端返回 200 但类型异常时同样失败关闭。
 */
export async function requestAuthorizedFile(path, allowedMediaTypes, fallbackFilename = 'download.bin') {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include', headers: { Accept: [...allowedMediaTypes, 'application/json'].join(', ') } })
  if (!response.ok) {
    const body = await readResponse(response)
    const error = new CRMAPIError(body?.message || `HTTP ${response.status}`, { status: response.status, code: body?.code, requestID: body?.request_id, details: body?.details })
    if (shouldStartSubsystemLogin(error)) redirectToLogin()
    throw error
  }
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!allowedMediaTypes.has(contentType)) throw new CRMAPIError('下载响应的文件类型不受支持。', { status: response.status, code: 'CRM_DOWNLOAD_CONTENT_TYPE_INVALID' })
  const disposition = response.headers.get('content-disposition') || ''
  const matched = disposition.match(/filename\*?=(?:UTF-8''|")?([^;"]+)/i)
  let filename = fallbackFilename
  if (matched) { try { filename = decodeURIComponent(matched[1].replace(/"/g, '').trim()) } catch { filename = fallbackFilename } }
  filename = filename.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 160)
  if (!filename || filename === '.' || filename === '..' || filename.startsWith('.')) filename = fallbackFilename
  return { blob: await response.blob(), filename, contentType }
}

export function toQuery(params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value !== null && value !== undefined) query.set(key, String(value))
  }
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

/** 读取 CRM 子系统会话边界；HttpOnly Cookie 始终由浏览器管理，不暴露给脚本。 */
export const getCRMSession = async () => normalizeAuthorizationSession(await request('/auth/me'))

/**
 * 读取当前进程可选集成的非敏感就绪状态，仅用于禁用尚未接通的按钮；真正执行
 * 时仍以后端业务接口鉴权和状态校验为准，不能把 capability 当授权结果缓存。
 */
export const getCRMRuntimeCapabilities = () => request('/capabilities')
