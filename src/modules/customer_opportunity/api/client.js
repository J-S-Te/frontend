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
      ...(requiresCSRF ? { 'X-CSRF-Token': '1' } : {}),
      ...(options.idempotent ? { 'Idempotency-Key': options.idempotencyKey || createIdempotencyKey() } : {}),
      ...(options.headers || {}),
    },
  })
  const body = await readResponse(response)
  if (!response.ok) {
    if (response.status === 401) redirectToLogin()
    throw new CRMAPIError(body?.message || `HTTP ${response.status}`, {
      status: response.status,
      code: body?.code,
      requestID: body?.request_id,
      details: body?.details,
    })
  }
  return body?.data ?? body
}

/** Downloads an authorized response without persisting its contents in browser storage. */
export async function requestBlob(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'text/csv, application/json' },
  })
  if (!response.ok) {
    const body = await readResponse(response)
    if (response.status === 401) redirectToLogin()
    throw new CRMAPIError(body?.message || `HTTP ${response.status}`, {
      status: response.status,
      code: body?.code,
      requestID: body?.request_id,
      details: body?.details,
    })
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

/** Downloads a server-authorized business file with an explicit MIME allowlist. */
export async function requestAuthorizedFile(path, allowedMediaTypes, fallbackFilename = 'download.bin') {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include', headers: { Accept: [...allowedMediaTypes, 'application/json'].join(', ') } })
  if (!response.ok) {
    const body = await readResponse(response)
    if (response.status === 401) redirectToLogin()
    throw new CRMAPIError(body?.message || `HTTP ${response.status}`, { status: response.status, code: body?.code, requestID: body?.request_id, details: body?.details })
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

/** Reads the CRM subsystem session boundary; the HttpOnly cookie is never exposed. */
export const getCRMSession = () => request('/auth/me')

/**
 * Reads non-secret optional-integration readiness for the current process.
 * This is presentation guidance only; business endpoints remain authoritative.
 */
export const getCRMRuntimeCapabilities = () => request('/capabilities')
