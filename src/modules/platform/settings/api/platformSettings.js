const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export class PlatformSettingsError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'PlatformSettingsError'
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
    throw new PlatformSettingsError('无法连接平台设置服务，请确认后端服务已启动。', { code: 'NETWORK_ERROR' })
  }
  const body = await readBody(response)
  if (!response.ok) {
    throw new PlatformSettingsError(body.message || '平台设置请求失败。', {
      status: response.status,
      code: body.code,
      traceId: body.trace_id || body.traceId,
    })
  }
  return body.data
}

/** 拉取平台基础设置（organization_name / organization_alias / timezone / qualification）。 */
export function getPlatformSettings() {
  return request('/settings/platform').then(mapPlatformSettings)
}

/** 更新平台基础设置；需要乐观锁 version。 */
export function updatePlatformSettings({ organizationName, organizationAlias, timezone = '', qualification = '', version }) {
  return request('/settings/platform', {
    method: 'PUT',
    body: JSON.stringify({
      organization_name: organizationName,
      organization_alias: organizationAlias,
      timezone,
      qualification,
      version,
    }),
  }).then(mapPlatformSettings)
}

function mapPlatformSettings(data) {
  if (!data) return null
  return {
    organizationName: data.organization_name || '',
    organizationAlias: data.organization_alias || '',
    timezone: data.timezone || '',
    qualification: data.qualification || '',
    version: Number(data.version || 0),
    updatedAt: data.updated_at || '',
  }
}
