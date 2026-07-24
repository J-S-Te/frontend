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
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      ...options,
    })
  } catch {
    throw new SecurityError('无法连接安全运营服务，请确认后端服务已启动。', { code: 'NETWORK_ERROR' })
  }
  const body = await readBody(response)
  if (!response.ok) {
    throw new SecurityError(body.message || '安全运营请求失败。', {
      status: response.status,
      code: body.code,
      traceId: body.trace_id || body.traceId,
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

// --- Login policy ---

export function getLoginPolicy() {
  return request('/security/login-policy')
}

export function updateLoginPolicy({ maxFailedAttempts, lockoutDurationSeconds, failureResetWindowSeconds, version }) {
  return request('/security/login-policy', {
    method: 'PUT',
    body: JSON.stringify({
      max_failed_attempts: maxFailedAttempts,
      lockout_duration_seconds: lockoutDurationSeconds,
      failure_reset_window_seconds: failureResetWindowSeconds,
      version,
    }),
  })
}

// --- Locked accounts ---

export function listLockedAccounts({ page = 1, pageSize = 50 } = {}) {
  return request(`/security/locked-accounts${pageQuery({ page, page_size: pageSize })}`).then(normalize)
}

export function unlockAccount(accountId, version) {
  // The unlock endpoint does not require a body; pass an empty payload for safety.
  return request(`/security/locked-accounts/${encodeURIComponent(accountId)}/unlock`, {
    method: 'POST',
    body: JSON.stringify(version ? { version } : {}),
  })
}

// --- Risk events ---

export function listRiskEvents({ page = 1, pageSize = 50, riskLevel = '', status = '' } = {}) {
  return request(`/security/risk-events${pageQuery({ page, page_size: pageSize, risk_level: riskLevel, status })}`).then(normalize)
}

export function resolveRiskEvent({ riskEventId, resolutionComment = '', version }) {
  return request(`/security/risk-events/${encodeURIComponent(riskEventId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution_comment: resolutionComment, version }),
  })
}
