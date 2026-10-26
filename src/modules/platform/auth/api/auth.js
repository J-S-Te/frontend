// 使用相对路径，确保该纯 API 模块既能被 Vite 解析，也能被 Node 原生测试运行器直接加载。
import { broadcastSessionEnded } from '../utils/sessionLifecycle.js'
import { clearAuthorizationSnapshot } from '../utils/authorizationRefresh.js'
import { normalizeAuthorizationSession } from '../../../shared/authz/sessionCompatibility.js'
import { createApiRequestContext, attachStructuredContext } from '../../shared/api/requestContext.js'
import { readBody } from '../../shared/api/request.js'
import { formatUserError, userFieldErrors } from '../../../shared/utils/userError.js'
import { postCredentialJSON } from '../../../shared/credential/credentialRequest.js'
import { CredentialProtocolError } from '../../../shared/credential/credentialProtocol.js'

// Node 原生测试没有注入 Vite 的 import.meta.env，使用可选链回退到同源 API 前缀。
const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
const CREDENTIAL_ENCRYPTION_MODE = (typeof import.meta.env === 'undefined'
  ? 'disabled'
  : (import.meta.env?.VITE_CREDENTIAL_ENCRYPTION_MODE || 'required'))
let browserSessionGeneration = 0

function requestContext(path, options = {}, extra = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  return createApiRequestContext({
    subsystem: 'platform',
    feature: 'auth',
    operation: extra.operation || method,
    method,
    path,
    actorId: extra.actorId || '',
    metadata: extra.metadata || null,
  })
}

function validAuthResult(path, body) {
  if (body?.code !== 'OK' || !Object.hasOwn(body, 'data')) return false
  const data = body.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  if (path === '/auth/login' || path === '/auth/token/refresh') {
    return typeof data.expires_at === 'string' && Number.isFinite(Date.parse(data.expires_at))
      && typeof data.redirect_url === 'string' && typeof data.must_change_password === 'boolean'
  }
  if (path === '/auth/me' || path === '/auth/activity') {
    return ['tenant', 'user', 'account'].every(key => typeof data[key]?.id === 'string' && data[key].id.trim())
  }
  // 退出登录与修改密码可合法返回空数据对象。
  return true
}

async function requestWithStructuredContext(path, options = {}, extra = {}) {
  const context = requestContext(path, options, extra)
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      cache: options.cache || 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch (error) {
    const code = error?.name === 'AbortError' ? 'REQUEST_ABORTED' : 'NETWORK_ERROR'
    const requestError = new AuthError(formatUserError(error, { code, method: options.method, fallback: extra.networkMessage || '网络不可达，暂时无法访问认证服务。' }), { code, status: 0 })
    attachStructuredContext(requestError, {
      ...context,
      metadata: { ...(context.metadata || {}), network: true },
    }, {
      status: 0,
      code,
      requestId: '',
      traceId: '',
    })
    throw requestError
  }

  let body
  try { body = await readBody(response) }
  catch (cause) {
    const code = 'INVALID_RESPONSE'
    const error = new AuthError(formatUserError(cause, { code, method: options.method }), { code, status: response.status })
    attachStructuredContext(error, context, { code, status: response.status })
    throw error
  }
  if (!response.ok) {
    // SEC-X4：认证接口的错误会直接显示在登录页等未登录面上，message 必须先过
    // userSafeErrorMessage 过滤（复用 contract 模块做法）；traceId 仅保留在错误对象
    // 里供日志排查，任何未登录页面都不得把它拼进展示文本。
    const message = formatUserError(body, { status: response.status, method: options.method, operation: extra.operation, fallback: extra.failureMessage })
    const requestError = new AuthError(message, {
      status: response.status,
      code: body.code || '',
      traceId: body.request_id || body.trace_id || body.traceId || '',
      details: body.details,
    })
    requestError.fieldErrors = [400, 422].includes(response.status) ? userFieldErrors(body.details) : []
    attachStructuredContext(requestError, {
      ...context,
      requestId: body.request_id || '',
      traceId: body.trace_id || body.traceId || '',
      metadata: { ...(context.metadata || {}), fromResponse: true },
    }, {
      status: response.status,
      code: body.code,
      requestId: body.request_id || '',
      traceId: body.trace_id || body.traceId || '',
    })
    throw requestError
  }

  // 代理返回 2xx 或将错误封装为 200 时，不得推进浏览器
  // 会话世代号，也不得清除上一账号的授权快照。
  if (!validAuthResult(path, body)) {
    const code = 'INVALID_RESPONSE'
    const error = new AuthError(formatUserError(body, { code, method: options.method }), {
      code, status: response.status, details: body?.details,
      traceId: body?.request_id || body?.trace_id || body?.traceId || '',
    })
    error.responseCode = body?.code || ''
    attachStructuredContext(error, context, {
      code, status: response.status, requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
    })
    throw error
  }

  return body
}

function advanceBrowserSessionGeneration() {
  // generation 是浏览器内的账号切换栅栏：切换 Cookie 后，旧 /auth/me 请求即使晚到
  // 也不能重新写回上一账号的权限快照。
  browserSessionGeneration += 1
  clearAuthorizationSnapshot()
}

/**
 * AuthError 表示认证接口返回的结构化错误。
 *
 * @property {number} status HTTP 状态码；网络异常时为 0。
 * @property {string} code 服务端错误码。
 * @property {string} traceId 用于排查的请求跟踪标识。
 */
export class AuthError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'AuthError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
    this.details = options.details || null
  }
}

function credentialError(error, fallback) {
  if (error instanceof CredentialProtocolError) {
    return new AuthError(formatUserError(error, { fallback }), { code: error.code, status: error.status || 0 })
  }
  return error
}

async function encryptedCredentialRequest(path, purpose, payload, headers = {}) {
  try {
    const result = await postCredentialJSON({
      url: `${API_BASE_URL}${path}`,
      purpose,
      body: payload,
      headers,
    })
    if (!result.body || !validAuthResult(path, result.body)) {
      throw new AuthError('认证服务返回了无法识别的结果。', { code: 'INVALID_RESPONSE', status: result.status })
    }
    return result.body
  } catch (error) {
    throw credentialError(error, '凭据加密请求失败，请刷新页面后重试。')
  }
}

/**
 * loginWithPassword 使用账号密码建立浏览器会话。
 *
 * 安全约定：
 * 1. 前端不持久化 访问令牌／刷新令牌；
 * 2. 浏览器通过 HttpOnly、SameSite 及受配置控制的 Secure Cookie 接收会话，生产环境强制 Secure；
 * 3. 所有后续请求均携带 credentials: 'include'；
 *
 * @param {Object} options 登录参数。
 * @param {string} options.account 登录账号。
 * @param {string} options.password 登录密码。
 * @param {string} [options.applicationId] 目标应用标识。
 * @param {string} [options.environmentId] 目标环境标识。
 * @param {string} [options.loginTargetCode] 登录目标编码。
 * @param {boolean} [options.replaceExistingSession=false] 是否替换已存在的会话。
 * @returns {Promise<{body: Object, status: number}>} 返回登录响应与成功状态码。
 * @throws {AuthError} 网络不可达、凭据无效或服务端拒绝登录时抛出。
 */
export async function loginWithPassword({
  account,
  password,
  applicationId = '',
  environmentId = '',
  loginTargetCode = '',
  replaceExistingSession = false,
}) {
  const loginPayload = {
    account,
    password,
    login_type: 'password',
    ...(applicationId ? { application_id: applicationId } : {}),
    ...(environmentId ? { environment_id: environmentId } : {}),
    ...(loginTargetCode ? { login_target_code: loginTargetCode } : {}),
    ...(replaceExistingSession ? { replace_existing_session: true } : {}),
  }
  const body = CREDENTIAL_ENCRYPTION_MODE === 'disabled'
    ? await requestWithStructuredContext('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(loginPayload),
    }, {
      operation: 'LOGIN',
      failureMessage: '账号或密码错误，请重新输入。',
      networkMessage: '无法连接登录服务，请确认后端服务已启动。',
    })
    : await encryptedCredentialRequest('/auth/login', 'LOGIN', loginPayload)

  // 登录响应中的 Set-Cookie 已切换浏览器身份；顶层跳转发生前先清除旧账号 UI 快照。
  advanceBrowserSessionGeneration()

  return {
    body,
    status: 200,
  }
}

/**
 * changeOwnPassword 修改当前登录用户的密码并清理旧权限快照。
 *
 * @param {Object} options 密码参数。
 * @param {string} options.currentPassword 当前密码。
 * @param {string} options.newPassword 新密码。
 * @returns {Promise<Object>} 返回服务端的密码修改结果。
 * @throws {AuthError} 当前密码错误、新密码不合规或认证服务不可用时抛出。
 */
export async function changeOwnPassword({ currentPassword, newPassword }) {
  const passwordPayload = { current_password: currentPassword, new_password: newPassword }
  const body = CREDENTIAL_ENCRYPTION_MODE === 'disabled'
    ? await requestWithStructuredContext('/auth/password/change', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': '1',
      },
      body: JSON.stringify(passwordPayload),
    }, {
      operation: 'CHANGE_PASSWORD',
      failureMessage: '密码修改失败，请检查当前密码和新密码。',
      networkMessage: '无法连接密码修改服务，请稍后重试。',
    })
    : await encryptedCredentialRequest('/auth/password/change', 'CHANGE_PASSWORD', passwordPayload, { 'X-CSRF-Token': '1' })
  advanceBrowserSessionGeneration()
  return body
}

/**
 * getCurrentPrincipal 读取当前浏览器会话对应的已认证主体。
 *
 * 服务端从 HttpOnly 会话 Cookie 中验证 JWT 和已持久化的会话状态；前端只消费
 * `/auth/me` 返回的最小身份信息，不在浏览器存储中保存令牌。
 *
 * @returns {Promise<Object>} 返回兼容处理后的当前用户及授权会话。
 * @throws {AuthError} 会话失效、请求期间账号发生切换或认证服务不可用时抛出。
 */
export async function getCurrentPrincipal() {
  const requestedGeneration = browserSessionGeneration
  const body = await requestWithStructuredContext('/auth/me', {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
  }, {
    operation: 'GET_PRINCIPAL',
    failureMessage: '当前登录状态已失效，请重新登录。',
    networkMessage: '无法读取当前登录用户信息，请确认后端服务已启动。',
    metadata: { noCache: true },
  })

  if (requestedGeneration !== browserSessionGeneration) {
    // 请求发出后发生过登录或退出，当前响应属于旧 Cookie 世代，按未认证失败关闭。
    const error = new AuthError('浏览器登录账号已切换，请按最新会话重新读取权限。', {
      status: 401,
      code: 'AUTH_SESSION_CHANGED',
    })
    attachStructuredContext(error, {
      ...requestContext('/auth/me', { method: 'GET' }, { operation: 'GET_PRINCIPAL' }),
      requestId: '',
      traceId: '',
      metadata: { staleGeneration: { requested: requestedGeneration, current: browserSessionGeneration } },
    }, {
      status: 401,
      code: 'AUTH_SESSION_CHANGED',
      requestId: '',
      traceId: '',
    })
    throw error
  }

  return normalizeAuthorizationSession(body.data)
}

/**
 * recordSessionActivity 上报一次由用户直接触发的浏览器活动。
 *
 * 该端点仅在点击、按键、滚动或触摸后被会话生命周期模块调用；常规接口请求、
 * 自动刷新和轮询都不会调用它，因此不会错误地延长无操作退出时间。
 *
 * @returns {Promise<Object>} 返回服务端记录的活动数据。
 * @throws {AuthError} 会话已失效或活动上报服务不可用时抛出。
 */
export async function recordSessionActivity() {
  const body = await requestWithStructuredContext('/auth/activity', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  }, {
    operation: 'RECORD_ACTIVITY',
    failureMessage: '当前登录状态已失效，请重新登录。',
    networkMessage: '无法记录用户活动，请确认后端服务已启动。',
  })

  return body.data
}

/**
 * refreshCurrentSession 仅在生命周期观察到真实用户交互后续期浏览器 Cookie，
 * 后台授权轮询不得调用此函数。
 *
 * @returns {Promise<Object>} 续期后的会话元数据。
 */
export async function refreshCurrentSession() {
  const body = await requestWithStructuredContext('/auth/token/refresh', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  }, {
    operation: 'REFRESH_SESSION',
    failureMessage: '当前登录状态已失效，请重新登录。',
    networkMessage: '无法刷新登录状态，请确认后端服务已启动。',
  })

  return body.data
}

/**
 * logoutCurrentSession 退出当前账号在同一租户下的所有应用会话。
 *
 * 后端会撤销当前账号在租户下的全部服务端会话并写入过期的 HttpOnly Cookie；
 * 同源应用标签页会立即收到退出通知，跨域子系统会在下一次请求时被服务端拒绝。
 *
 * @returns {Promise<Object|null>} 返回服务端退出数据；会话已失效时返回 null。
 * @throws {AuthError} 除会话已失效外，退出请求失败或服务不可用时抛出。
 */
export async function logoutCurrentSession() {
  try {
    const body = await requestWithStructuredContext('/auth/logout', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
    }, {
      operation: 'LOGOUT',
      failureMessage: '退出登录失败，请稍后重试。',
      networkMessage: '无法连接退出登录服务，请稍后重试。',
    })
    advanceBrowserSessionGeneration()
    broadcastSessionEnded('manual-logout')
    return body.data
  } catch (error) {
    const response = { status: error.status || 0 }
    // 会话已经在服务端失效时，用户的退出意图仍应完成：通知同源应用页立即返回
    // 登录界面，而不把用户滞留在受保护页面。
    if (response.status === 401) {
      advanceBrowserSessionGeneration()
      broadcastSessionEnded('manual-logout')
      return null
    }
    throw error
  }
}
