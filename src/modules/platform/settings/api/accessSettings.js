import { createRequest, API_BASE_URL } from '../../shared/api/request.js'

/**
 * AccessSettingsError 与业务错误分类相关的错误类型定义。
 * @class
 * @property {string} name 标准错误类型名。
 */
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



const request = createRequest({
  ErrorClass: AccessSettingsError,
  networkMessage: '无法连接平台设置服务，请确认后端服务已启动。',
  failureMessage: '对外访问配置请求失败。',
  subsystem: 'platform',
  feature: 'access_settings',
})

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
 * 应用已经保存的对外访问配置到运行时环境。
 *
 * 说明：配置变更后仅保存不会立即生效，必须通过此接口触发部署参数回写和相关容器重建。
 *
 * @returns {Promise<object>} 返回最新应用中的对外访问配置与部署状态摘要。
 * @throws {Error} 无法连接、版本冲突、授权不足或部署链路异常时抛出。
 */
export function applyAccessSettings() {
  return request('/settings/access/apply', { method: 'POST' }).then(mapAccessSettings)
}
