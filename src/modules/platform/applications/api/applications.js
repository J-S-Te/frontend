const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

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

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch {
    throw new ApplicationRegistryError('无法连接应用注册服务，请确认后端服务已启动。', { code: 'NETWORK_ERROR' })
  }
  const body = await readBody(response)
  if (!response.ok) {
    throw new ApplicationRegistryError(body?.message || '应用注册请求失败。', {
      status: response.status,
      code: body?.code,
      traceId: body?.request_id || body?.trace_id || body?.traceId,
    })
  }
  return body?.data
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

/** 创建一个业务子系统登记；OAuth 客户端与登录目标仍通过各自独立接口维护。 */
export function createApplication({ code, name, applicationType = 'web', description = null, status = 'ACTIVE' } = {}) {
  return request('/applications', {
    method: 'POST',
    body: JSON.stringify({
      code,
      name,
      application_type: applicationType,
      description,
      status,
    }),
  })
}

/** 列出指定应用下的部署环境（默认只取 ACTIVE）。 */
export function listEnvironments({ applicationId, page = 1, pageSize = 50, status = 'ACTIVE' } = {}) {
  if (!applicationId) {
    return Promise.resolve({ items: [], total: 0, page: 1, page_size: pageSize })
  }
  return request(`/applications/${encodeURIComponent(applicationId)}/environments${pageQuery({ page, page_size: pageSize, status })}`)
}

/** 创建应用环境。网关字段用于把外部公开地址映射到门户主机可达的内部上游。 */
export function createEnvironment({ applicationId, environment, baseUrl = null, upstreamUrl = null, pathPrefix = null, issuerAlias = null, metadata = {}, status = 'ACTIVE' } = {}) {
  if (!applicationId) throw new ApplicationRegistryError('applicationId 不能为空。', { code: 'VALIDATION_ERROR' })
  return request(`/applications/${encodeURIComponent(applicationId)}/environments`, {
    method: 'POST',
    body: JSON.stringify({
      environment,
      base_url: baseUrl,
      upstream_url: upstreamUrl,
      path_prefix: pathPrefix,
      issuer_alias: issuerAlias,
      metadata,
      status,
    }),
  })
}

/** 更新应用环境；version 必须使用最近一次查询返回的乐观锁版本。 */
export function updateEnvironment({ applicationId, environmentId, baseUrl = null, upstreamUrl = null, pathPrefix = null, issuerAlias = null, metadata = {}, status = 'ACTIVE', version } = {}) {
  if (!applicationId || !environmentId) throw new ApplicationRegistryError('applicationId 和 environmentId 不能为空。', { code: 'VALIDATION_ERROR' })
  return request(`/applications/${encodeURIComponent(applicationId)}/environments/${encodeURIComponent(environmentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      base_url: baseUrl,
      upstream_url: upstreamUrl,
      path_prefix: pathPrefix,
      issuer_alias: issuerAlias,
      metadata,
      status,
      version,
    }),
  })
}
