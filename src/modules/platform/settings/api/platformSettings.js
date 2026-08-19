import { createRequest, API_BASE_URL } from '../../shared/api/request.js'

/**
 * PlatformSettingsError 与业务错误分类相关的错误类型定义。
 * @class
 * @property {string} name 标准错误类型名。
 */
export class PlatformSettingsError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'PlatformSettingsError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}



const request = createRequest({
  ErrorClass: PlatformSettingsError,
  networkMessage: '无法连接平台设置服务，请确认后端服务已启动。',
  failureMessage: '平台设置请求失败。',
  subsystem: 'platform',
  feature: 'platform_settings',
})

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
