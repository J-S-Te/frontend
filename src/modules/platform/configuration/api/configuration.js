import { createRequest } from '../../shared/api/request.js'

export class ConfigurationError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'ConfigurationError'
    Object.assign(this, { status: options.status || 0, code: options.code || '', traceId: options.traceId || '' })
  }
}

const request = createRequest({
  ErrorClass: ConfigurationError,
  networkMessage: '无法连接配置中心。',
  failureMessage: '配置中心请求失败。',
  subsystem: 'platform',
  feature: 'configuration',
})

export const listNamespaces = ({ page = 1, pageSize = 100 } = {}) => request(`/config/namespaces?page=${page}&page_size=${pageSize}`)
export const createNamespace = (payload) => request('/config/namespaces', { method: 'POST', body: JSON.stringify(payload) })
export const listConfigItems = ({ page = 1, pageSize = 100, namespaceId = '' } = {}) => {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (namespaceId) query.set('namespace_id', namespaceId)
  return request(`/config/items?${query}`)
}
export const createConfigItem = (payload) => request('/config/items', { method: 'POST', body: JSON.stringify(payload) })
export const updateConfigItem = (itemId, payload) => request(`/config/items/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const publishConfiguration = (payload) => request('/config/releases', { method: 'POST', body: JSON.stringify(payload) })
export const getConfigurationRelease = (releaseId) => request(`/config/releases/${encodeURIComponent(releaseId)}`)
export const getPublishedConfiguration = (applicationCode, namespaceCode) => request(`/config/applications/${encodeURIComponent(applicationCode)}/namespaces/${encodeURIComponent(namespaceCode)}`)
