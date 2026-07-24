const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export class ApplicationRegistryError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'ApplicationRegistryError'
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
    throw new ApplicationRegistryError('无法连接应用注册服务，请确认后端服务已启动。', { code: 'NETWORK_ERROR' })
  }
  const body = await readBody(response)
  if (!response.ok) {
    throw new ApplicationRegistryError(body.message || '应用注册请求失败。', {
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

/** 列出租户内已登记的应用（默认只取 ACTIVE）。 */
export function listApplications({ page = 1, pageSize = 100, status = 'ACTIVE', keyword = '' } = {}) {
  return request(`/applications${pageQuery({ page, page_size: pageSize, status, keyword })}`)
}

/** 列出指定应用下的部署环境（默认只取 ACTIVE）。 */
export function listEnvironments({ applicationId, page = 1, pageSize = 50, status = 'ACTIVE' } = {}) {
  if (!applicationId) {
    return Promise.resolve({ items: [], total: 0, page: 1, page_size: pageSize })
  }
  return request(`/applications/${encodeURIComponent(applicationId)}/environments${pageQuery({ page, page_size: pageSize, status })}`)
}
