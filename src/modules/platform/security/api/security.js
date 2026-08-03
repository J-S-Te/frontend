const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export class SecurityError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'SecurityError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}

async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return response.json()
  const text = await response.text()
  return text ? { message: text } : {}
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch {
    throw new SecurityError('无法连接登录安全服务，请确认后端服务已启动。', { code: 'NETWORK_ERROR' })
  }
  const body = await readBody(response)
  if (!response.ok) {
    throw new SecurityError(body.message || '登录安全请求失败。', {
      status: response.status,
      code: body.code,
      traceId: body.request_id || body.trace_id || body.traceId,
    })
  }
  return body.data
}

function pageQuery(parameters = {}) {
  const search = new URLSearchParams()
  Object.entries(parameters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, String(value))
  })
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

function normalize(value) {
  if (!value || typeof value !== 'object') {
    return { items: [], total: 0, page: 1, pageSize: 20 }
  }
  return {
    items: Array.isArray(value.items) ? value.items : [],
    total: Number(value.total || 0),
    page: Number(value.page || 1),
    pageSize: Number(value.page_size || 20),
  }
}

// 登录策略与具体业务系统解耦，由基础平台统一执行失败计数、锁定和无操作超时。

export function getLoginPolicy() {
  return request('/security/login-policy')
}

export function updateLoginPolicy({ maxFailedAttempts, lockoutDurationSeconds, failureResetWindowSeconds, idleTimeoutSeconds, version }) {
  return request('/security/login-policy', {
    method: 'PUT',
    body: JSON.stringify({
      max_failed_attempts: maxFailedAttempts,
      lockout_duration_seconds: lockoutDurationSeconds,
      failure_reset_window_seconds: failureResetWindowSeconds,
      idle_timeout_seconds: idleTimeoutSeconds,
      version,
    }),
  })
}

// 锁定账号列表只返回当前租户内仍处于锁定状态的账号；手动解锁由服务端审计。

export function listLockedAccounts({ page = 1, pageSize = 50 } = {}) {
  return request(`/security/locked-accounts${pageQuery({ page, page_size: pageSize })}`).then(normalize)
}

export function unlockAccount(accountId) {
  return request(`/security/locked-accounts/${encodeURIComponent(accountId)}/unlock`, { method: 'POST' })
}
