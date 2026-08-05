import { createRequest, API_BASE_URL } from '../../shared/api/request.js'

export class AccessSettingsError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'AccessSettingsError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
    this.nextAction = options.nextAction || ''
  }
}



const request = createRequest({ ErrorClass: AccessSettingsError, networkMessage: '无法连接平台设置服务，请确认后端服务已启动。', failureMessage: '对外访问配置请求失败。' })

function mapAccessSettings(data) {
  if (!data) return null
  return {
    publicOrigin: data.public_origin || '',
    allowInsecureHTTPRedirect: Boolean(data.allow_insecure_http_redirect),
    version: Number(data.version || 0),
    updatedAt: data.updated_at || '',
  }
}

/** 读取对外访问配置（公开地址 / HTTP 回调策略 / 乐观锁版本）。 */
export function getAccessSettings() {
  return request('/settings/access').then(mapAccessSettings)
}

/** 保存对外访问配置；publicOrigin 留空表示仅本机访问，version 用于阻止并发覆盖。 */
export function updateAccessSettings({ publicOrigin, allowInsecureHTTPRedirect, version }) {
  return request('/settings/access', {
    method: 'PUT',
    body: JSON.stringify({
      public_origin: publicOrigin.trim(),
      allow_insecure_http_redirect: Boolean(allowInsecureHTTPRedirect),
      version,
    }),
  }).then(mapAccessSettings)
}

/**
 * 应用已经保存的对外访问配置：由部署 Agent 重写覆盖环境文件并重建相关容器。
 * 此调用不携带表单草稿，避免未经保存和版本校验的值直接进入部署运行时。
 */
export function applyAccessSettings() {
  return request('/settings/access/apply', { method: 'POST' }).then(mapAccessSettings)
}
