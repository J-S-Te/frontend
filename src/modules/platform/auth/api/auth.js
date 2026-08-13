import { broadcastSessionEnded } from '@/modules/platform/auth/utils/sessionLifecycle'
import { clearAuthorizationSnapshot } from '@/modules/platform/auth/utils/authorizationRefresh'
import { normalizeAuthorizationSession } from '@/modules/shared/authz/sessionCompatibility'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
let browserSessionGeneration = 0

function advanceBrowserSessionGeneration() {
  // generation 是浏览器内的账号切换栅栏：切换 Cookie 后，旧 /auth/me 请求即使晚到
  // 也不能重新写回上一账号的权限快照。
  browserSessionGeneration += 1
  clearAuthorizationSnapshot()
}

export class AuthError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'AuthError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}

async function readResponseBody(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  const text = await response.text()
  return text ? { message: text } : {}
}

/**
 * 账号密码登录。
 *
 * 安全约定：
 * 1. 前端不持久化 access token/refresh token；
 * 2. 浏览器通过 HttpOnly、SameSite 及受配置控制的 Secure Cookie 接收会话，生产环境强制 Secure；
 * 3. 所有后续请求均携带 credentials: 'include'；
 */
export async function loginWithPassword({
  account,
  password,
  applicationId = '',
  environmentId = '',
  loginTargetCode = '',
  replaceExistingSession = false,
}) {
  let response

  try {
    response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        account,
        password,
        login_type: 'password',
        ...(applicationId ? { application_id: applicationId } : {}),
        ...(environmentId ? { environment_id: environmentId } : {}),
        ...(loginTargetCode ? { login_target_code: loginTargetCode } : {}),
        ...(replaceExistingSession ? { replace_existing_session: true } : {}),
      }),
    })
  } catch (error) {
    throw new AuthError('无法连接登录服务，请确认后端服务已启动。', {
      code: 'NETWORK_ERROR',
    })
  }

  const body = await readResponseBody(response)

  if (!response.ok) {
    throw new AuthError(body.message || body.msg || '账号或密码错误，请重新输入。', {
      status: response.status,
      code: body.code,
      traceId: body.request_id || body.trace_id || body.traceId,
    })
  }

  // 登录响应中的 Set-Cookie 已切换浏览器身份；顶层跳转发生前先清除旧账号 UI 快照。
  advanceBrowserSessionGeneration()

  return {
    body,
    status: response.status,
  }
}

/**
 * 读取当前浏览器会话对应的已认证主体。
 *
 * 服务端从 HttpOnly 会话 Cookie 中验证 JWT 和已持久化的会话状态；前端只消费
 * `/auth/me` 返回的最小身份信息，不在浏览器存储中保存令牌。
 */
export async function getCurrentPrincipal() {
  let response
  const requestedGeneration = browserSessionGeneration

  try {
    response = await fetch(`${API_BASE_URL}/auth/me`, {
      method: 'GET',
      credentials: 'include',
      // 认证主体和权限集合必须始终从服务端重新读取，不能复用浏览器或代理缓存。
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    })
  } catch {
    throw new AuthError('无法读取当前登录用户信息，请确认后端服务已启动。', {
      code: 'NETWORK_ERROR',
    })
  }

  const body = await readResponseBody(response)

  if (!response.ok) {
    throw new AuthError(body.message || body.msg || '当前登录状态已失效，请重新登录。', {
      status: response.status,
      code: body.code,
      traceId: body.request_id || body.trace_id || body.traceId,
    })
  }

  if (requestedGeneration !== browserSessionGeneration) {
    // 请求发出后发生过登录或退出，当前响应属于旧 Cookie 世代，按未认证失败关闭。
    throw new AuthError('浏览器登录账号已切换，请按最新会话重新读取权限。', {
      status: 401,
      code: 'AUTH_SESSION_CHANGED',
    })
  }

  return normalizeAuthorizationSession(body.data)
}

/**
 * 上报一次由用户直接触发的浏览器活动。
 *
 * 该端点仅在点击、按键、滚动或触摸后被会话生命周期模块调用；常规接口请求、
 * 自动刷新和轮询都不会调用它，因此不会错误地延长无操作退出时间。
 */
export async function recordSessionActivity() {
  let response

  try {
    response = await fetch(`${API_BASE_URL}/auth/activity`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    })
  } catch {
    throw new AuthError('无法记录用户活动，请确认后端服务已启动。', {
      code: 'NETWORK_ERROR',
    })
  }

  const body = await readResponseBody(response)

  if (!response.ok) {
    throw new AuthError(body.message || body.msg || '当前登录状态已失效，请重新登录。', {
      status: response.status,
      code: body.code,
      traceId: body.request_id || body.trace_id || body.traceId,
    })
  }

  return body.data
}

/**
 * 退出所有应用系统。
 *
 * 后端会撤销当前账号在租户下的全部服务端会话并写入过期的 HttpOnly Cookie；
 * 同源应用标签页会立即收到退出通知，跨域子系统会在下一次请求时被服务端拒绝。
 */
export async function logoutCurrentSession() {
  let response

  try {
    response = await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    })
  } catch {
    throw new AuthError('无法连接退出登录服务，请稍后重试。', {
      code: 'NETWORK_ERROR',
    })
  }

  const body = await readResponseBody(response)

  if (!response.ok) {
    // 会话已经在服务端失效时，用户的退出意图仍应完成：通知同源应用页立即返回
    // 登录界面，而不把用户滞留在受保护页面。
    if (response.status === 401) {
      advanceBrowserSessionGeneration()
      broadcastSessionEnded('manual-logout')
      return null
    }

    throw new AuthError(body.message || body.msg || '退出登录失败，请稍后重试。', {
      status: response.status,
      code: body.code,
      traceId: body.request_id || body.trace_id || body.traceId,
    })
  }

  advanceBrowserSessionGeneration()
  broadcastSessionEnded('manual-logout')
  return body.data
}
